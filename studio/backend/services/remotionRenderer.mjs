import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import {
  BACKGROUND_PATH,
  CHARACTER_DIR,
  FFMPEG_BIN,
  FFMPEG_PATH,
  FFPROBE_PATH,
  REMOTION_ENTRY,
  REMOTION_JOBS_DIR,
  REPO_ROOT,
  SHARED_ASSETS_DIR,
  videoPath,
} from "../paths.mjs";
import {
  JobCancelledError,
  appendLog,
  isJobCancelled,
  killChildTree,
  setJobCanceller,
  updateJob,
} from "./jobStore.mjs";
import { enqueueJob } from "./jobQueue.mjs";
import { withProjectLock } from "./projectLocks.mjs";
import { DEFAULT_CHARACTER_POSES, normalizeProjectConfig } from "./projectConfig.mjs";
import { SFX_DIR } from "./sfxLibrary.mjs";
import { COMPARE_SET_IDS, TIMELINE_START_SECONDS, focusSideForPose, lineGapAfterSeconds, migrateSfxName, normalizeCompareSetId, normalizeFocusSide } from "./linePlanner.mjs";
import { captionSpeedWarnings, normalizeLineWords, readAudioManifest, readDurations, shouldUseDurationTimeline, voiceSyncIssues } from "./voiceTiming.mjs";
import { CAPTION_FONT_OPTIONS } from "../../../shared/captionOptions.mjs";
import {
  assertReadyForRender,
  assertReadyForSnapshot,
  clearOfficialRenderDirty,
  setOfficialSnapshot,
  writeOfficialRender,
  writeProjectConfig,
} from "./projectPipeline.mjs";

const execFileAsync = promisify(execFile);
const POSES = ["point-left", "point-right", "question"];
const DEFAULT_RENDER_MODE = "gpu";
const RENDER_PROFILES = {
  classic: {
    renderMode: "classic",
    concurrency: "50%",
    hardwareAcceleration: "if-possible",
    gl: "auto",
  },
  gpu: {
    renderMode: "gpu",
    concurrency: "8",
    hardwareAcceleration: "required",
    gl: "vulkan",
  },
};
const RENDER_VIDEO_BITRATE = process.env.REMOTION_VIDEO_BITRATE || "8M";
const AUDIO_DURATION_CORRECTION_THRESHOLD_SECONDS = 1 / 30;
const assetHashCache = new Map();

function resolveRenderProfile(renderMode = DEFAULT_RENDER_MODE) {
  const profile = RENDER_PROFILES[String(renderMode || DEFAULT_RENDER_MODE).toLowerCase()] || RENDER_PROFILES[DEFAULT_RENDER_MODE];
  if (profile.renderMode !== "gpu") return profile;
  const envConcurrency = String(process.env.REMOTION_GPU_CONCURRENCY || "").trim();
  return envConcurrency ? { ...profile, concurrency: envConcurrency } : profile;
}

function findBundledRemotionFfmpegBin() {
  const remotionRoot = path.join(REPO_ROOT, "node_modules", "@remotion");
  const executable = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const preferred = process.platform === "win32"
    ? path.join(remotionRoot, "compositor-win32-x64-msvc")
    : "";
  if (preferred && fs.existsSync(path.join(preferred, executable))) return preferred;
  if (!fs.existsSync(remotionRoot)) return null;
  for (const entry of fs.readdirSync(remotionRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("compositor-")) continue;
    const candidate = path.join(remotionRoot, entry.name);
    if (fs.existsSync(path.join(candidate, executable))) return candidate;
  }
  return null;
}

const REMOTION_FFMPEG_BIN = process.env.REMOTION_FFMPEG_BIN || findBundledRemotionFfmpegBin() || FFMPEG_BIN;
const REMOTION_FFPROBE_PATH = process.env.REMOTION_FFPROBE_PATH || path.join(REMOTION_FFMPEG_BIN, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeResetDir(dir, parent) {
  const resolved = path.resolve(dir);
  const root = `${path.resolve(parent)}${path.sep}`;
  if (!resolved.startsWith(root)) {
    throw new Error(`Refusing to reset outside Remotion jobs dir: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

function copyOrLink(source, target) {
  ensureDir(path.dirname(target));
  fs.rmSync(target, { force: true });
  try {
    fs.linkSync(source, target);
  } catch {
    fs.copyFileSync(source, target);
  }
}

function isPathInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isRenderSidecarForStem(fileName, stem) {
  if (!stem) return false;
  const lowerName = fileName.toLowerCase();
  const lowerStem = stem.toLowerCase();
  return lowerName === `${lowerStem}.verification.json`
    || (lowerName.startsWith(`${lowerStem}-frame-`) && /\.(jpe?g|png)$/i.test(lowerName));
}

function isRenderGeneratedSidecar(fileName) {
  const lowerName = fileName.toLowerCase();
  return lowerName.includes("-remotion-")
    && (lowerName.endsWith(".verification.json") || /-frame-\d+\.(jpe?g|png)$/i.test(lowerName));
}

function cleanupRenderArtifactsInDir(dir, projectRoot, keepPath) {
  const resolvedDir = path.resolve(dir);
  const resolvedRoot = path.resolve(projectRoot);
  if (!isPathInside(resolvedDir, resolvedRoot)) {
    throw new Error(`Refusing to clean render files outside project: ${resolvedDir}`);
  }
  if (!fs.existsSync(resolvedDir)) return [];

  const keep = keepPath ? path.resolve(keepPath) : "";
  const keepStem = keep && path.dirname(keep) === resolvedDir ? path.basename(keep, path.extname(keep)) : "";
  const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
  const staleMp4Stems = new Set();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".mp4")) continue;
    const target = path.resolve(resolvedDir, entry.name);
    if (target === keep) continue;
    staleMp4Stems.add(path.basename(entry.name, path.extname(entry.name)));
  }

  const removed = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const target = path.resolve(resolvedDir, entry.name);
    if (target === keep) continue;
    const lowerName = entry.name.toLowerCase();
    const staleMp4 = lowerName.endsWith(".mp4") && staleMp4Stems.has(path.basename(entry.name, path.extname(entry.name)));
    const staleSidecar = [...staleMp4Stems].some((stem) => isRenderSidecarForStem(entry.name, stem));
    const orphanSidecar = isRenderGeneratedSidecar(entry.name) && !isRenderSidecarForStem(entry.name, keepStem);
    if (!staleMp4 && !staleSidecar && !orphanSidecar) continue;
    try {
      fs.rmSync(target, { force: true });
      removed.push(path.relative(resolvedRoot, target).replace(/\\/g, "/"));
    } catch {
      // The browser or OS can briefly hold an old MP4. It will no longer be
      // selected because the new render has a unique URL.
    }
  }
  return removed;
}

export function cleanupOldRenderArtifacts(projectRoot, keepPath) {
  const resolvedRoot = path.resolve(projectRoot);
  const keep = keepPath ? path.resolve(keepPath) : "";
  if (keep && !isPathInside(keep, resolvedRoot)) {
    throw new Error(`Refusing to keep render outside project: ${keep}`);
  }
  return [
    ...cleanupRenderArtifactsInDir(resolvedRoot, resolvedRoot, keep),
    ...cleanupRenderArtifactsInDir(path.join(resolvedRoot, "renders"), resolvedRoot, keep),
  ];
}

function findExisting(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function finiteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function lineTiming(line = {}) {
  const startMs = Math.max(0, Math.round(finiteNumber(
    line.startMs,
    finiteNumber(line.start, 0) * 1000,
  )));
  const durationMs = Math.max(300, Math.round(finiteNumber(
    line.durationMs,
    finiteNumber(line.duration, 2.2) * 1000,
  )));
  return { startMs, durationMs, endMs: startMs + durationMs };
}

function projectFile(videoRoot, value) {
  if (!value) return "";
  if (path.isAbsolute(value)) return value;
  return path.join(videoRoot, String(value).replace(/\//g, path.sep));
}

function sharedSfx(name) {
  if (!name) return "";
  const parts = String(name).replace(/\\/g, "/").split("/").filter((part) => part && part !== "." && part !== "..");
  return path.join(SFX_DIR, ...parts);
}

function mediaUrl(slug, relativePath) {
  if (!relativePath) return "";
  const value = String(relativePath).replace(/\\/g, "/").replace(/^\/+/, "");
  return `/videos-media/${encodeURIComponent(slug)}/${value.split("/").map(encodeURIComponent).join("/")}`;
}

function sharedAssetUrl(relativePath) {
  if (!relativePath) return "";
  return `/shared-assets/${String(relativePath).replace(/\\/g, "/").replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")}`;
}

function assetIdentity(source, root) {
  if (!source || !fs.existsSync(source)) return null;
  const stat = fs.statSync(source);
  const cached = assetHashCache.get(source);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.value;

  const relativeToProject = relativeIfInside(root, source);
  const relativeToShared = relativeIfInside(SHARED_ASSETS_DIR, source);
  const identity = {
    file: relativeToProject || (relativeToShared ? `shared-assets/${relativeToShared}` : path.basename(source)),
    bytes: stat.size,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex"),
  };
  assetHashCache.set(source, { size: stat.size, mtimeMs: stat.mtimeMs, value: identity });
  return identity;
}

function withAssetVersion(url, identity) {
  if (!url || !identity?.sha256) return url || "";
  const separator = String(url).includes("?") ? "&" : "?";
  return `${url}${separator}v=${identity.sha256.slice(0, 12)}`;
}

function versionedUrlForSource(slug, root, source) {
  return withAssetVersion(urlForSource(slug, root, source), assetIdentity(source, root));
}

function buildAssetManifest({ root, background, compareSets = {}, characters = {}, logo = null, audio = null, audioClips = [], sfxClips = [], bgm = null }) {
  return {
    version: 1,
    background: assetIdentity(background, root),
    logo: assetIdentity(logo, root),
    compareSets: Object.fromEntries(COMPARE_SET_IDS.map((id) => [
      id,
      {
        left: assetIdentity(compareSets[id]?.left, root),
        right: assetIdentity(compareSets[id]?.right, root),
      },
    ])),
    characters: Object.fromEntries(POSES.map((pose) => [pose, assetIdentity(characters[pose], root)])),
    voice: audio ? assetIdentity(audio, root) : null,
    voiceClips: audioClips.map(({ lineId, source }) => ({ lineId, asset: assetIdentity(source, root) })),
    sfxClips: sfxClips.map(({ lineId, name, source }) => ({ lineId, name, asset: assetIdentity(source, root) })),
    bgm: bgm ? assetIdentity(bgm, root) : null,
  };
}

function propsHash(props) {
  // URLs differ between Player and a render job. The content-addressed manifest
  // makes the revision change whenever a background, image, pose or sound does.
  const comparable = {
    title: props.title,
    template: props.template,
    leftLabel: props.leftLabel,
    rightLabel: props.rightLabel,
    compareSets: props.compareSets,
    durationInSeconds: props.durationInSeconds,
    compare: props.compare,
    background: props.background,
    logo: props.logo,
    caption: props.caption,
    character: props.character,
    layout: props.layout,
    audioConfig: props.audioConfig,
    lines: props.lines,
    assetManifest: props.assetManifest,
  };
  return crypto.createHash("sha256").update(JSON.stringify(comparable)).digest("hex").slice(0, 12);
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function renderRelevantConfig(config = {}) {
  const { pipeline, render, ...rest } = config || {};
  const renderRest = render ? { ...render } : render;
  if (renderRest) delete renderRest.preferredMode;
  return {
    ...rest,
    render: render ? renderRest : render,
    lines: Array.isArray(rest.lines)
      ? rest.lines.map(({ sfx, sfxOffsetMs, sfxVolume, ...line }) => line)
      : rest.lines,
  };
}

async function mediaDuration(filePath) {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ], { windowsHide: true });
  const value = Number.parseFloat(stdout);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function mediaDurationSync(filePath) {
  try {
    const stdout = execFileSync(REMOTION_FFPROBE_PATH, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ], { windowsHide: true, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
    const value = Number.parseFloat(stdout);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function lineAudioSource(root, lineId) {
  return findExisting([
    path.join(root, "assets", "vo", `${lineId}.mp3`),
    path.join(root, "assets", "vo", `${lineId}.wav`),
    path.join(root, "assets", "vo", `${lineId}.m4a`),
  ]);
}

function lineAudioSourceMap(root, config) {
  const sources = new Map();
  const lines = Array.isArray(config.lines) ? config.lines : [];
  for (let index = 0; index < lines.length; index += 1) {
    const id = String(lines[index]?.id || `line-${index + 1}`);
    const source = lineAudioSource(root, id);
    if (source) sources.set(id, source);
  }
  return sources;
}

function correctedVoiceDurations(durations = {}, audioSources = new Map()) {
  const corrected = { ...(durations || {}) };
  const measured = {};
  const corrections = {};

  for (const [lineId, source] of audioSources.entries()) {
    const actual = mediaDurationSync(source);
    if (!actual) continue;
    const rounded = Number(actual.toFixed(3));
    measured[lineId] = rounded;
    const declared = Number(corrected[lineId]);
    if (!Number.isFinite(declared) || declared <= 0 || Math.abs(rounded - declared) > AUDIO_DURATION_CORRECTION_THRESHOLD_SECONDS) {
      corrected[lineId] = rounded;
      corrections[lineId] = {
        declared: Number.isFinite(declared) && declared > 0 ? Number(declared.toFixed(3)) : null,
        measured: rounded,
      };
    }
  }

  return { durations: corrected, measured, corrections };
}

function timedLines(config, durations, { useDurationTimeline = false } = {}) {
  const source = Array.isArray(config.lines) && config.lines.length
    ? config.lines
    : [
      { id: "line-1", text: `Đây là ${config.compare?.leftLabel || "A"}.`, pose: "point-left", focusSide: "right" },
      { id: "line-2", text: `Đây là ${config.compare?.rightLabel || "B"}.`, pose: "point-right", focusSide: "left" },
      { id: "line-3", text: "Sự khác biệt ở đâu??", pose: "question", focusSide: "center" },
    ];
  let cursor = TIMELINE_START_SECONDS;

  return source.map((line, index) => {
    const id = String(line.id || `line-${index + 1}`);
    const text = String(line.text || line.caption || line.tts || "").trim();
    const explicitStart = Number(line.start);
    const explicitDuration = Number(line.duration);
    const hasExplicitTiming = Number.isFinite(explicitStart)
      && explicitStart >= 0
      && Number.isFinite(explicitDuration)
      && explicitDuration > 0;
    const durationFromVoice = Number(durations[id]);
    const hasVoiceDuration = Number.isFinite(durationFromVoice) && durationFromVoice > 0;
    const useVoiceTiming = useDurationTimeline && hasVoiceDuration;
    const duration = useVoiceTiming ? durationFromVoice : (hasExplicitTiming ? explicitDuration : durationFromVoice || 2.2);
    const start = useVoiceTiming ? cursor : (hasExplicitTiming ? explicitStart : cursor);
    const startMs = Math.max(0, Math.round(start * 1000));
    const durationMs = Math.max(300, Math.round(duration * 1000));
    const pose = POSES.includes(line.pose) ? line.pose : "question";
    const words = normalizeLineWords(line.words || [], { lineStartMs: startMs, lineEndMs: startMs + durationMs });
    const item = {
      id,
      compareSetId: normalizeCompareSetId(line.compareSetId),
      text,
      role: line.role || "",
      pose,
      focusSide: normalizeFocusSide(line.focusSide, focusSideForPose(pose)),
      highlight: line.highlight || "",
      dirtyVoice: Boolean(line.dirtyVoice),
      ...(words.length ? { words } : {}),
      startMs,
      endMs: startMs + durationMs,
      durationMs,
    };
    cursor = start + duration + lineGapAfterSeconds(index);
    return item;
  });
}

function twoDigits(value) {
  return String(value).padStart(2, "0");
}

function threeDigits(value) {
  return String(value).padStart(3, "0");
}

function srtTimestamp(ms) {
  const safe = Math.max(0, Math.round(ms));
  const hours = Math.floor(safe / 3600000);
  const minutes = Math.floor((safe % 3600000) / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const millis = safe % 1000;
  return `${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(seconds)},${threeDigits(millis)}`;
}

function poseTag(pose) {
  if (pose === "point-left") return "L";
  if (pose === "point-right") return "R";
  return "Q";
}

function srtFromLines(lines) {
  return `${lines.map((line, index) => [
    String(index + 1),
    `${srtTimestamp(line.startMs)} --> ${srtTimestamp(line.endMs)}`,
    `[${poseTag(line.pose)}] ${line.text}`,
  ].join("\n")).join("\n\n")}\n`;
}

function sharedCharacterCandidates(pose) {
  return [
    path.join(CHARACTER_DIR, "processed", `${pose}.webm`),
    path.join(CHARACTER_DIR, "processed", `${pose}.mp4`),
    path.join(CHARACTER_DIR, "originals", `${pose}.png`),
    path.join(CHARACTER_DIR, "originals", `${pose}.webp`),
    path.join(CHARACTER_DIR, "originals", `${pose}.mov`),
    path.join(CHARACTER_DIR, "originals", `${pose}.mp4`),
    path.join(CHARACTER_DIR, "originals", `${pose}.webm`),
    path.join(CHARACTER_DIR, `${pose}.png`),
    path.join(CHARACTER_DIR, `${pose}.webp`),
  ];
}

function projectCharacterCandidates(pose, videoRoot, configured) {
  return [
    projectFile(videoRoot, configured),
    path.join(videoRoot, "assets", "character", "preview", `${pose}.webm`),
    path.join(videoRoot, "assets", "character", "render", `${pose}.webm`),
    path.join(videoRoot, "assets", "character", "fallback", `${pose}.png`),
    path.join(videoRoot, "assets", "character", `${pose}.webm`),
    path.join(videoRoot, "assets", "character", `${pose}.mp4`),
    path.join(videoRoot, "assets", "character", `${pose}.mov`),
    path.join(videoRoot, "assets", "character", `${pose}.png`),
    path.join(videoRoot, "assets", "character", `${pose}.webp`),
  ];
}

function characterSourceRel(pose, config, purpose = "preview") {
  const info = config.character?.poseSources?.[pose] || null;
  if (info) {
    if (info.state === "image-ready") return info.preview || config.character?.poses?.[pose] || "";
    if (purpose === "render" && info.state === "ready") return info.render || "";
    if (purpose === "preview") {
      if (info.state === "ready") return info.preview || info.fallback || "";
      if (info.state === "processing") {
        const configured = config.character?.poses?.[pose] || "";
        return configured === info.preview ? info.preview : info.fallback || "";
      }
      if (info.state === "error") return info.fallback || "";
    }
  }
  return config.character?.poses?.[pose] || "";
}

function managedRenderSource(pose, videoRoot, config) {
  const info = config.character?.poseSources?.[pose] || null;
  if (!info || info.state !== "ready" || !info.render) return "";
  const source = projectFile(videoRoot, info.render);
  try {
    return source && fs.statSync(source).size > 0 ? source : "";
  } catch {
    return "";
  }
}

function characterSource(pose, videoRoot, config, purpose = "preview") {
  const configured = String(characterSourceRel(pose, config, purpose)).replace(/\\/g, "/").trim();
  if (!configured) return "";

  const projectSource = findExisting(projectCharacterCandidates(pose, videoRoot, configured));
  if (projectSource) return projectSource;

  if (configured === DEFAULT_CHARACTER_POSES[pose]) {
    return findExisting(sharedCharacterCandidates(pose));
  }
  return "";
}

function compareSetSources(root, config) {
  return Object.fromEntries(COMPARE_SET_IDS.map((id) => {
    const set = (config.compareSets || []).find((item) => item.id === id) || config.compare || {};
    const legacyLeft = id === "compare-1" ? path.join(root, "assets", "compare-left.png") : "";
    const legacyRight = id === "compare-1" ? path.join(root, "assets", "compare-right.png") : "";
    return [id, {
      left: findExisting([projectFile(root, set.leftImage), legacyLeft]),
      right: findExisting([projectFile(root, set.rightImage), legacyRight]),
    }];
  }));
}

function remotionCommand(args) {
  return {
    command: process.execPath,
    args: [path.join(REPO_ROOT, "node_modules", "@remotion", "cli", "remotion-cli.js"), ...args],
  };
}

function pathKey(env) {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
}

function runCommand({ label, command, args, cwd, log, job = null }) {
  return new Promise((resolve, reject) => {
    log(`\n\n=== ${label} ===\n`);
    const env = { ...process.env };
    const key = pathKey(env);
    env[key] = `${REMOTION_FFMPEG_BIN}${path.delimiter}${env[key] || ""}`;

    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
    });
    if (job) {
      setJobCanceller(job, () => {
        log(`\nStopping ${label}...\n`);
        killChildTree(child);
      });
    }
    child.stdout.on("data", (data) => log(data));
    child.stderr.on("data", (data) => log(data));
    child.on("error", (error) => {
      if (job) setJobCanceller(job, null);
      if (isJobCancelled(job)) reject(new JobCancelledError(`${label} cancelled`));
      else reject(error);
    });
    child.on("exit", (code) => {
      if (job) setJobCanceller(job, null);
      if (isJobCancelled(job)) {
        reject(new JobCancelledError(`${label} cancelled`));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with code ${code}`));
    });
  });
}

function resolveSceneStartSfxSettings(config) {
  const sceneStartSfx = config.audio?.sceneStartSfx || {};
  if (sceneStartSfx.enabled === false) {
    return {
      enabled: false,
      skipFirst: true,
      offsetMs: 0,
      volume: 0.82,
      poseVolumes: Object.fromEntries(POSES.map((pose) => [pose, 0.82])),
    };
  }

  const volume = Math.max(0, Math.min(1.5, finiteNumber(sceneStartSfx.volume, 0.82)));
  const poseVolumeSource = sceneStartSfx.poseVolumes && typeof sceneStartSfx.poseVolumes === "object"
    ? sceneStartSfx.poseVolumes
    : {};
  return {
    enabled: true,
    skipFirst: sceneStartSfx.skipFirst !== false,
    offsetMs: Math.max(0, Math.min(3000, Math.round(finiteNumber(sceneStartSfx.offsetMs, 0)))),
    volume,
    poseVolumes: Object.fromEntries(POSES.map((pose) => [
      pose,
      Math.max(0, Math.min(1.5, finiteNumber(poseVolumeSource[pose], volume))),
    ])),
  };
}

function resolvePoseSfxSource(config, line, root) {
  const name = migrateSfxName(config.poseSfx?.[line.pose] || "");
  if (!name || name === "__none__") return null;

  const source = findExisting([
    projectFile(root, name),
    projectFile(root, `assets/sfx/${path.basename(name)}`),
    sharedSfx(name),
  ]);
  if (!source) return null;

  return {
    name,
    source,
  };
}

function resolvedSfxClips(lines, config, root) {
  const sceneStartSfx = resolveSceneStartSfxSettings(config);
  if (!sceneStartSfx.enabled) return [];

  return lines.flatMap((line, index) => {
    if (sceneStartSfx.skipFirst && index === 0) return [];
    const poseSfx = resolvePoseSfxSource(config, line, root);
    if (!poseSfx) return [];
    const timing = lineTiming(line);
    const offsetMs = Math.max(0, Math.min(Math.max(0, timing.durationMs - 80), sceneStartSfx.offsetMs));
    const volume = sceneStartSfx.poseVolumes?.[line.pose] ?? sceneStartSfx.volume;
    return [{
      lineId: line.id,
      name: poseSfx.name,
      source: poseSfx.source,
      startMs: timing.startMs + offsetMs,
      durationMs: Math.min(1400, Math.max(80, timing.durationMs - offsetMs)),
      volume,
    }];
  });
}

function copySfxClips({ resolvedClips, jobDir }) {
  ensureDir(path.join(jobDir, "sfx"));
  return resolvedClips.map((clip) => {
    const rel = `sfx/${path.basename(clip.source)}`;
    copyOrLink(clip.source, path.join(jobDir, rel));
    return {
      src: rel,
      startMs: clip.startMs,
      durationMs: clip.durationMs,
      volume: clip.volume,
    };
  });
}

function copyCaptionFonts(jobDir) {
  const targetDir = path.join(jobDir, "fonts");
  ensureDir(targetDir);
  for (const font of CAPTION_FONT_OPTIONS) {
    const source = path.join(SHARED_ASSETS_DIR, "fonts", font.file);
    if (fs.existsSync(source)) copyOrLink(source, path.join(targetDir, font.file));
  }
}

function durationForPreview(config, lines) {
  const timelineSeconds = Math.max(...lines.map((line) => line.endMs), 1000) / 1000;
  return Number(Math.max(Number(config.audioDuration) || 0, timelineSeconds + 0.8).toFixed(3));
}

function relativeIfInside(root, source) {
  const resolvedRoot = path.resolve(root);
  const resolvedSource = path.resolve(source);
  if (resolvedSource.startsWith(`${resolvedRoot}${path.sep}`)) {
    return path.relative(resolvedRoot, resolvedSource).replace(/\\/g, "/");
  }
  return "";
}

function characterAlphaProxy(source, root, pose, { folder = "preview", maxHeight = 0 } = {}) {
  if (!source || !/\.(mov|mp4)$/i.test(source)) return source;
  const safeFolder = String(folder || "preview").replace(/[^a-z0-9-]/gi, "");
  const target = path.join(root, "assets", safeFolder, "character-alpha", `${pose}.webm`);
  try {
    const sourceStat = fs.statSync(source);
    const targetStat = fs.existsSync(target) ? fs.statSync(target) : null;
    if (targetStat && targetStat.mtimeMs >= sourceStat.mtimeMs && targetStat.size > 0) return target;

    ensureDir(path.dirname(target));
    const args = [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", source,
      "-an",
    ];
    if (maxHeight > 0) args.push("-vf", `scale=-2:min(ih\\,${maxHeight})`);
    args.push(
      "-c:v", "libvpx-vp9",
      "-crf", "34",
      "-b:v", "0",
      "-pix_fmt", "yuva420p",
      "-auto-alt-ref", "0",
      "-deadline", "good",
      "-cpu-used", "6",
      "-r", "30",
      target,
    );
    execFileSync(FFMPEG_PATH, args, { windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
    if (fs.existsSync(target) && fs.statSync(target).size > 0) return target;
    fs.rmSync(target, { force: true });
    throw new Error(`Character proxy output is empty for ${pose}.`);
  } catch (error) {
    fs.rmSync(target, { force: true });
    throw new Error(`Failed to prepare ${pose} character video proxy: ${error.message || error}`);
  }
}

function previewCharacterProxy(source, root, pose) {
  return characterAlphaProxy(source, root, pose, { folder: "preview", maxHeight: 960 });
}

function renderCharacterProxy(source, root, pose) {
  return characterAlphaProxy(source, root, pose, { folder: "render-alpha", maxHeight: 960 });
}

function isManagedCharacterDerivative(source, root) {
  const rel = relativeIfInside(root, source);
  return Boolean(rel && /^(assets\/character\/(?:preview|render|fallback)\/)/i.test(rel));
}

function urlForSource(slug, root, source) {
  if (!source) return "";
  const localPath = relativeIfInside(root, source);
  if (localPath) return mediaUrl(slug, localPath);
  const sharedPath = relativeIfInside(SHARED_ASSETS_DIR, source);
  if (sharedPath) return sharedAssetUrl(sharedPath);
  return "";
}

function sourceRef(root, source) {
  if (!source) return null;
  const localPath = relativeIfInside(root, source);
  if (localPath) return { scope: "project", path: localPath };
  const sharedPath = relativeIfInside(SHARED_ASSETS_DIR, source);
  if (sharedPath) return { scope: "shared", path: sharedPath };
  return { scope: "absolute", path: path.resolve(source) };
}

function resolveSourceRef(root, ref) {
  if (!ref) return "";
  if (typeof ref === "string") return projectFile(root, ref);
  if (ref.scope === "project") return projectFile(root, ref.path);
  if (ref.scope === "shared") return path.join(SHARED_ASSETS_DIR, String(ref.path || "").replace(/\//g, path.sep));
  if (ref.scope === "absolute") return ref.path;
  return "";
}

function assetManifestHash(manifest) {
  return hashJson(manifest || {});
}

function audioSummaryFromProps(props = {}) {
  const assets = props.assets || {};
  const voiceClips = Array.isArray(assets.audioClips)
    ? assets.audioClips.filter((clip) => clip?.src).length
    : 0;
  const sfxClips = Array.isArray(assets.sfxClips)
    ? assets.sfxClips.filter((clip) => clip?.src).length
    : 0;
  const summary = {
    voice: assets.audio ? 1 : 0,
    voiceClips,
    sfxClips,
    bgm: assets.bgm ? 1 : 0,
  };
  return {
    ...summary,
    expected: summary.voice > 0 || summary.voiceClips > 0 || summary.sfxClips > 0 || summary.bgm > 0,
  };
}

function audioSummaryLabel(summary = {}) {
  const voiceText = summary.voice
    ? "full voice"
    : `${Number(summary.voiceClips) || 0} voice clip(s)`;
  return `${voiceText}, ${Number(summary.sfxClips) || 0} SFX clip(s), ${summary.bgm ? "BGM" : "no BGM"}`;
}

async function probeAudioStreams(filePath) {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    "-v", "error",
    "-select_streams", "a",
    "-show_entries", "stream=index,codec_name,sample_rate,channels,channel_layout,duration,bit_rate",
    "-of", "json",
    filePath,
  ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const parsed = JSON.parse(stdout || "{}");
  return Array.isArray(parsed.streams) ? parsed.streams.map((stream) => ({
    index: stream.index,
    codecName: stream.codec_name || "",
    sampleRate: Number(stream.sample_rate) || 0,
    channels: Number(stream.channels) || 0,
    channelLayout: stream.channel_layout || "",
    duration: Number(stream.duration) || 0,
    bitRate: Number(stream.bit_rate) || 0,
  })) : [];
}

function finalSnapshotDir(root) {
  return path.join(root, "snapshots", "render-final");
}

function safeResetSnapshotDir(dir, root) {
  const resolved = path.resolve(dir);
  const allowed = `${path.resolve(root)}${path.sep}`;
  if (!resolved.startsWith(allowed)) {
    throw new Error(`Refusing to reset snapshot outside project: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

function buildCanonicalComposition(slug, { exactDuration = false, characterProxy = "none" } = {}) {
  const root = videoPath(slug);
  const rawConfig = readJson(path.join(root, "video.json"));
  if (!rawConfig) throw new Error(`Missing video.json for ${slug}`);
  const config = normalizeProjectConfig(rawConfig, slug);
  const durations = readDurations(root);
  const voiceManifest = readAudioManifest(root) || readJson(path.join(root, "assets", "vo", "aimax-batch.json"), null);
  const fullAudio = findExisting([
    projectFile(root, config.audio?.mainAudio),
    path.join(root, "assets", "vo", "full.mp3"),
    path.join(root, "assets", "vo", "full.wav"),
    path.join(root, "assets", "vo", "full.m4a"),
  ]);
  const audioSourceMap = fullAudio ? new Map() : lineAudioSourceMap(root, config);
  const durationAudit = fullAudio
    ? { durations, measured: {}, corrections: {} }
    : correctedVoiceDurations(durations, audioSourceMap);
  const renderDurations = durationAudit.durations;
  const lines = timedLines(config, renderDurations, {
    useDurationTimeline: shouldUseDurationTimeline(root, config, renderDurations),
  });
  const voiceIssues = voiceSyncIssues(root, config, { durations: renderDurations });

  const backgroundSrc = String(config.background?.src || "").trim();
  const background = backgroundSrc
    ? findExisting([
      projectFile(root, backgroundSrc),
      path.join(root, "assets", "backgrounds", "paper.png"),
      BACKGROUND_PATH,
    ])
    : null;
  const logo = config.logo?.enabled === false
    ? ""
    : findExisting([
      projectFile(root, config.logo?.src),
    ]);
  const compareSetSourceMap = compareSetSources(root, config);
  const characters = Object.fromEntries(POSES.map((pose) => {
    const purpose = characterProxy === "render" ? "render" : "preview";
    const source = characterSource(pose, root, config, purpose);
    if (characterProxy !== "render") return [pose, source];
    const managedRender = managedRenderSource(pose, root, config);
    return [pose, managedRender || renderCharacterProxy(source, root, pose)];
  }));

  const audioClipSources = [];
  if (!fullAudio) {
    for (const line of lines) {
      const source = audioSourceMap.get(line.id) || lineAudioSource(root, line.id);
      if (source) audioClipSources.push({ lineId: line.id, source });
    }
  }

  const resolvedSfx = resolvedSfxClips(lines, config, root);
  const bgmSource = projectFile(root, config.audio?.bgm);
  const bgm = bgmSource && fs.existsSync(bgmSource) ? bgmSource : null;
  const timelineDuration = Math.max(...lines.map((line) => line.endMs), 1000) / 1000;
  const audioDuration = exactDuration && fullAudio ? mediaDurationSync(fullAudio) : 0;
  const durationInSeconds = Number(Math.max(
    Number(config.audioDuration) || 0,
    audioDuration,
    timelineDuration + 0.8,
  ).toFixed(3));

  const assetManifest = buildAssetManifest({
    root,
    background,
    compareSets: compareSetSourceMap,
    characters,
    logo,
    audio: fullAudio,
    audioClips: audioClipSources,
    sfxClips: resolvedSfx,
    bgm,
  });
  const audioClips = audioClipSources.map(({ lineId, source }) => {
    const line = lines.find((item) => item.id === lineId) || {};
    return {
      lineId,
      src: "",
      startMs: line.startMs,
      durationMs: line.durationMs,
      volume: config.audio.voiceVolume,
    };
  });
  const sfxClips = resolvedSfx.map((clip) => ({
    lineId: clip.lineId,
    name: clip.name,
    src: "",
    startMs: clip.startMs,
    durationMs: clip.durationMs,
    volume: clip.volume,
  }));
  const props = {
    title: config.title || `${config.compare.leftLabel} vs ${config.compare.rightLabel}`,
    template: config.template,
    leftLabel: config.compare.leftLabel,
    rightLabel: config.compare.rightLabel,
    compareSets: config.compareSets,
    durationInSeconds,
    assetBase: "",
    compare: config.compare,
    background: config.background,
    logo: config.logo,
    caption: config.caption,
    character: config.character,
    layout: config.layout,
    audioConfig: config.audio,
    srt: srtFromLines(lines),
    lines,
    assetManifest,
    assets: {
      background: "",
      logo: "",
      compareSets: Object.fromEntries(COMPARE_SET_IDS.map((id) => [id, { left: "", right: "" }])),
      compareLeft: "",
      compareRight: "",
      characters: {},
      audio: "",
      audioClips,
      sfxClips,
      bgm: "",
    },
  };
  const hasVoice = Boolean(fullAudio) || audioClipSources.length === lines.length;
  const timingReady = lines.length > 0 && lines.every((line) => Number.isFinite(line.startMs) && Number.isFinite(line.durationMs));
  const voiceReady = hasVoice && timingReady && !voiceIssues.length;
  props.voiceReady = voiceReady;
  props.voiceIssues = voiceIssues;
  const propsHashValue = propsHash(props);

  return {
    slug,
    root,
    config,
    lines,
    durations,
    voiceManifest,
    props,
    propsHash: propsHashValue,
    state: voiceReady ? "final" : "draft",
    hasVoice,
    timingReady,
    voiceReady,
    voiceIssues,
    warnings: captionSpeedWarnings(lines),
    durationAudit,
    sourceConfigHash: hashJson({ version: 3, config: renderRelevantConfig(config), durations: renderDurations, durationAudit, voiceManifest }),
    assetManifestHash: assetManifestHash(assetManifest),
    sources: {
      background,
      logo,
      compareSets: compareSetSourceMap,
      characters,
      voice: fullAudio,
      voiceClips: audioClipSources,
      sfxClips: resolvedSfx,
      bgm,
    },
  };
}

function withPreviewAssetUrls(canonical, { previewPose = "", useProxy = false } = {}) {
  const { slug, root, sources } = canonical;
  const characters = {};
  for (const pose of POSES) {
    const source = sources.characters?.[pose];
    if (!source) continue;
    const previewSource = useProxy && pose === previewPose && !isManagedCharacterDerivative(source, root)
      ? previewCharacterProxy(source, root, pose)
      : source;
    characters[pose] = versionedUrlForSource(slug, root, previewSource);
  }
  const audioClips = canonical.props.assets.audioClips.map((clip) => {
    const source = sources.voiceClips.find((item) => item.lineId === clip.lineId)?.source;
    return { ...clip, src: versionedUrlForSource(slug, root, source) };
  });
  const sfxClips = canonical.props.assets.sfxClips.map((clip) => {
    const source = sources.sfxClips.find((item) => item.lineId === clip.lineId && item.name === clip.name)?.source;
    return { ...clip, src: versionedUrlForSource(slug, root, source) };
  });
  const props = {
    ...canonical.props,
    assets: {
      background: versionedUrlForSource(slug, root, sources.background),
      logo: versionedUrlForSource(slug, root, sources.logo),
      compareSets: Object.fromEntries(COMPARE_SET_IDS.map((id) => [
        id,
        {
          left: versionedUrlForSource(slug, root, sources.compareSets?.[id]?.left),
          right: versionedUrlForSource(slug, root, sources.compareSets?.[id]?.right),
        },
      ])),
      compareLeft: versionedUrlForSource(slug, root, sources.compareSets?.["compare-1"]?.left),
      compareRight: versionedUrlForSource(slug, root, sources.compareSets?.["compare-1"]?.right),
      characters,
      audio: versionedUrlForSource(slug, root, sources.voice),
      audioClips,
      sfxClips,
      bgm: versionedUrlForSource(slug, root, sources.bgm),
    },
  };
  props.previewHash = canonical.propsHash;
  return props;
}

function snapshotSourceRefs(canonical) {
  const { root, sources } = canonical;
  return {
    background: sourceRef(root, sources.background),
    logo: sourceRef(root, sources.logo),
    compareSets: Object.fromEntries(COMPARE_SET_IDS.map((id) => [
      id,
      {
        left: sourceRef(root, sources.compareSets?.[id]?.left),
        right: sourceRef(root, sources.compareSets?.[id]?.right),
      },
    ])),
    compareLeft: sourceRef(root, sources.compareSets?.["compare-1"]?.left),
    compareRight: sourceRef(root, sources.compareSets?.["compare-1"]?.right),
    characters: Object.fromEntries(POSES.map((pose) => [pose, sourceRef(root, sources.characters?.[pose])])),
    voice: sourceRef(root, sources.voice),
    voiceClips: sources.voiceClips.map(({ lineId, source }) => ({ lineId, source: sourceRef(root, source) })),
    sfxClips: sources.sfxClips.map(({ lineId, name, source }) => ({ lineId, name, source: sourceRef(root, source) })),
    bgm: sourceRef(root, sources.bgm),
  };
}

function snapshotResponse(bundle) {
  if (!bundle) return { exists: false, stale: true };
  const { snapshot, props } = bundle;
  const { sources, ...publicSnapshot } = snapshot;
  return {
    exists: true,
    stale: false,
    ...publicSnapshot,
    props,
  };
}

function readFinalSnapshotBundle(slug) {
  const root = videoPath(slug);
  const dir = finalSnapshotDir(root);
  const snapshotPath = path.join(dir, "snapshot.json");
  const propsPath = path.join(dir, "props.json");
  if (!fs.existsSync(snapshotPath) || !fs.existsSync(propsPath)) return null;
  const snapshot = readJson(snapshotPath);
  const props = readJson(propsPath);
  if (!snapshot || !props) return null;
  return { root, dir, snapshot, props, snapshotPath, propsPath };
}

function snapshotMatchesCurrent(snapshot, canonical) {
  return Boolean(snapshot)
    && snapshot.propsHash === canonical.propsHash
    && snapshot.sourceConfigHash === canonical.sourceConfigHash
    && snapshot.assetManifestHash === canonical.assetManifestHash;
}

export function createFinalSnapshot(slug, { allowWarnings = true } = {}) {
  const { config: pipelineConfig, check } = assertReadyForSnapshot(slug);
  if (!allowWarnings && check.warnings.length) throw new Error(check.warnings.join("\n"));

  const canonical = buildCanonicalComposition(slug, { exactDuration: true, characterProxy: "render" });
  const root = canonical.root;
  const dir = finalSnapshotDir(root);
  safeResetSnapshotDir(dir, root);
  const props = withPreviewAssetUrls(canonical, { useProxy: false });
  const snapshot = {
    snapshotId: `${canonical.propsHash}-${Date.now()}`,
    createdAt: new Date().toISOString(),
    slug,
    propsHash: canonical.propsHash,
    state: canonical.state,
    voiceReady: canonical.voiceReady,
    sourceConfigHash: canonical.sourceConfigHash,
    assetManifestHash: canonical.assetManifestHash,
    durationInSeconds: canonical.props.durationInSeconds,
    lineCount: canonical.lines.length,
    warnings: [...(check.warnings || []), ...(canonical.warnings || [])],
    sources: snapshotSourceRefs(canonical),
  };

  fs.writeFileSync(path.join(dir, "props.json"), `${JSON.stringify(props, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(dir, "asset-manifest.json"), `${JSON.stringify(props.assetManifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(dir, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  writeProjectConfig(root, setOfficialSnapshot(pipelineConfig, snapshot), slug);
  return snapshotResponse({ root, dir, snapshot, props });
}

export function getFinalSnapshot(slug) {
  const bundle = readFinalSnapshotBundle(slug);
  if (!bundle) return { exists: false, stale: true };
  try {
    const canonical = buildCanonicalComposition(slug, { exactDuration: true, characterProxy: "render" });
    return {
      ...snapshotResponse(bundle),
      stale: !snapshotMatchesCurrent(bundle.snapshot, canonical),
      currentPropsHash: canonical.propsHash,
    };
  } catch (error) {
    return {
      ...snapshotResponse(bundle),
      stale: true,
      currentError: error.message || String(error),
    };
  }
}

function ensureFinalSnapshotBundle(slug, { allowWarnings = true, requireExisting = false } = {}) {
  const existing = readFinalSnapshotBundle(slug);
  const canonical = buildCanonicalComposition(slug, { exactDuration: true, characterProxy: "render" });
  if (existing && snapshotMatchesCurrent(existing.snapshot, canonical)) {
    if (!allowWarnings && existing.snapshot.warnings?.length) throw new Error(existing.snapshot.warnings.join("\n"));
    return existing;
  }
  if (requireExisting) {
    throw new Error(existing ? "Preview final is stale. Recreate Preview final before rendering MP4." : "Missing Preview final. Create Preview final before rendering MP4.");
  }
  createFinalSnapshot(slug, { allowWarnings });
  return readFinalSnapshotBundle(slug);
}

/**
 * Build the canonical composition data for the interactive Player. The render
 * pipeline uses the same normalized lines, timings, layout and audio choices;
 * only the file URLs differ because render copies assets into a job directory.
 */
export function buildPreviewProps(slug, { previewPose = "" } = {}) {
  const requestedPreviewPose = POSES.includes(previewPose) ? previewPose : "";
  const canonical = buildCanonicalComposition(slug);
  const props = withPreviewAssetUrls(canonical, {
    previewPose: requestedPreviewPose,
    useProxy: process.env.AUTO_COMPARE_PREVIEW_PROXY === "1",
  });
  return {
    props,
    propsHash: canonical.propsHash,
    previewPose: requestedPreviewPose,
    state: canonical.state,
    hasVoice: canonical.hasVoice,
    timingReady: canonical.timingReady,
    voiceReady: canonical.voiceReady,
    voiceIssues: canonical.voiceIssues,
  };
}

function copySnapshotSource(root, jobDir, ref, rel, label) {
  const source = resolveSourceRef(root, ref);
  if (!source || !fs.existsSync(source)) throw new Error(`Snapshot missing ${label}: ${source || "empty"}`);
  copyOrLink(source, path.join(jobDir, rel));
  return rel.replace(/\\/g, "/");
}

function copyOptionalSnapshotSource(root, jobDir, ref, rel) {
  const source = resolveSourceRef(root, ref);
  if (!source || !fs.existsSync(source)) return "";
  copyOrLink(source, path.join(jobDir, rel));
  return rel.replace(/\\/g, "/");
}

function hashedJobAssetName(baseName, identity, extension) {
  const hash = String(identity?.sha256 || "").slice(0, 12);
  const safeBase = String(baseName || "asset").replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "asset";
  const safeExtension = String(extension || ".bin").startsWith(".")
    ? String(extension || ".bin")
    : `.${String(extension || "bin").replace(/^\.+/, "")}`;
  return `${safeBase}${hash ? `-${hash}` : ""}${safeExtension}`;
}

function assertCopiedAssetMatchesManifest(jobDir, rel, expected, label) {
  if (!expected) return;
  const filePath = path.join(jobDir, String(rel || "").replace(/\//g, path.sep));
  if (!rel || !fs.existsSync(filePath)) {
    throw new Error(`Render job missing ${label} asset: ${rel || "empty"}`);
  }
  const stat = fs.statSync(filePath);
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  if (Number(expected.bytes) !== stat.size || String(expected.sha256 || "") !== sha256) {
    throw new Error(`Render job ${label} asset does not match the final preview snapshot.`);
  }
}

function extensionForRef(root, ref, fallback = "") {
  const source = resolveSourceRef(root, ref);
  return path.extname(source || "").toLowerCase() || fallback;
}

function buildJobPropsFromSnapshot(bundle, jobDir) {
  const { root, snapshot, props } = bundle;
  const sources = snapshot.sources || {};
  const backgroundRel = hashedJobAssetName(
    "background",
    props.assetManifest?.background,
    extensionForRef(root, sources.background, ".png"),
  );
  const logoRel = `logo${extensionForRef(root, sources.logo, ".png")}`;
  const logo = props.logo?.enabled
    ? copySnapshotSource(root, jobDir, sources.logo, logoRel, "logo")
    : copyOptionalSnapshotSource(root, jobDir, sources.logo, logoRel);
  const characters = {};
  for (const pose of POSES) {
    const ref = sources.characters?.[pose];
    const rel = `characters/${pose}${extensionForRef(root, ref, ".webm")}`;
    characters[pose] = copyOptionalSnapshotSource(root, jobDir, ref, rel);
  }

  let audio = "";
  const audioClips = [];
  if (sources.voice) {
    const rel = `audio/full${extensionForRef(root, sources.voice, ".mp3")}`;
    audio = copySnapshotSource(root, jobDir, sources.voice, rel, "voice");
  } else {
    const voiceRefsByLine = new Map((sources.voiceClips || []).map((clip) => [clip.lineId, clip.source]));
    for (const clip of props.assets.audioClips || []) {
      const ref = voiceRefsByLine.get(clip.lineId);
      const rel = `audio/${clip.lineId}${extensionForRef(root, ref, ".mp3")}`;
      audioClips.push({
        ...clip,
        src: copySnapshotSource(root, jobDir, ref, rel, `voice clip ${clip.lineId}`),
      });
    }
  }

  const sfxRefs = new Map((sources.sfxClips || []).map((clip, index) => [`${clip.lineId}\u0000${clip.name}\u0000${index}`, clip]));
  const sfxClips = [];
  for (let index = 0; index < (props.assets.sfxClips || []).length; index += 1) {
    const clip = props.assets.sfxClips[index];
    const saved = sfxRefs.get(`${clip.lineId}\u0000${clip.name}\u0000${index}`)
      || (sources.sfxClips || []).find((item) => item.lineId === clip.lineId && item.name === clip.name);
    const base = path.basename(resolveSourceRef(root, saved?.source) || `${clip.name || `sfx-${index + 1}`}.wav`);
    const rel = `sfx/${String(index + 1).padStart(2, "0")}-${base}`;
    sfxClips.push({
      ...clip,
      src: copySnapshotSource(root, jobDir, saved?.source, rel, `sfx ${clip.lineId}`),
    });
  }

  let bgm = "";
  if (sources.bgm) {
    const rel = `audio/bgm${extensionForRef(root, sources.bgm, ".mp3")}`;
    bgm = copySnapshotSource(root, jobDir, sources.bgm, rel, "bgm");
  }

  const jobProps = {
    ...props,
    assetBase: "",
    assets: {
      background: copyOptionalSnapshotSource(root, jobDir, sources.background, backgroundRel),
      logo,
      compareSets: Object.fromEntries(COMPARE_SET_IDS.map((id) => {
        const leftRef = sources.compareSets?.[id]?.left || (id === "compare-1" ? sources.compareLeft : null);
        const rightRef = sources.compareSets?.[id]?.right || (id === "compare-1" ? sources.compareRight : null);
        const used = id === "compare-1" || (props.lines || []).some((line) => (line.compareSetId || "compare-1") === id);
        const copy = used ? copySnapshotSource : copyOptionalSnapshotSource;
        return [id, {
          left: copy(root, jobDir, leftRef, `compare/${id}-left${extensionForRef(root, leftRef, ".png")}`, `${id} compare left`),
          right: copy(root, jobDir, rightRef, `compare/${id}-right${extensionForRef(root, rightRef, ".png")}`, `${id} compare right`),
        }];
      })),
      compareLeft: copySnapshotSource(root, jobDir, sources.compareSets?.["compare-1"]?.left || sources.compareLeft, `compare-left${extensionForRef(root, sources.compareSets?.["compare-1"]?.left || sources.compareLeft, ".png")}`, "compare left"),
      compareRight: copySnapshotSource(root, jobDir, sources.compareSets?.["compare-1"]?.right || sources.compareRight, `compare-right${extensionForRef(root, sources.compareSets?.["compare-1"]?.right || sources.compareRight, ".png")}`, "compare right"),
      characters,
      audio,
      audioClips,
      sfxClips,
      bgm,
    },
  };
  jobProps.previewHash = propsHash(jobProps);
  if (jobProps.previewHash !== snapshot.propsHash) {
    throw new Error(`Snapshot props hash mismatch before render: ${jobProps.previewHash} != ${snapshot.propsHash}`);
  }
  if (assetManifestHash(jobProps.assetManifest) !== snapshot.assetManifestHash) {
    throw new Error("Snapshot asset manifest mismatch before render.");
  }
  assertCopiedAssetMatchesManifest(jobDir, jobProps.assets.background, props.assetManifest?.background, "background");
  return jobProps;
}

export async function prepareRemotionJob(slug, { allowWarnings = true, renderMode = DEFAULT_RENDER_MODE } = {}) {
  const renderProfile = resolveRenderProfile(renderMode);
  assertReadyForRender(slug);
  const snapshotBundle = ensureFinalSnapshotBundle(slug, { allowWarnings, requireExisting: true });
  const { root, snapshot } = snapshotBundle;
  const jobDir = path.join(REMOTION_JOBS_DIR, slug);
  safeResetDir(jobDir, REMOTION_JOBS_DIR);
  ensureDir(path.join(jobDir, "audio"));
  ensureDir(path.join(jobDir, "characters"));
  ensureDir(path.join(jobDir, "sfx"));
  copyCaptionFonts(jobDir);
  const props = buildJobPropsFromSnapshot(snapshotBundle, jobDir);
  const audioSummary = audioSummaryFromProps(props);

  const propsPath = path.join(jobDir, "props.json");
  fs.writeFileSync(propsPath, `${JSON.stringify(props, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(jobDir, "asset-manifest.json"), `${JSON.stringify(props.assetManifest, null, 2)}\n`, "utf8");

  const rendersDir = path.join(root, "renders");
  ensureDir(rendersDir);
  const outputPath = path.join(rendersDir, `${slug}-remotion-${renderProfile.renderMode}-${props.previewHash}-${Date.now()}.mp4`);
  return {
    slug,
    renderMode: renderProfile.renderMode,
    renderProfile,
    root,
    jobDir,
    propsPath,
    outputPath,
    durationInSeconds: snapshot.durationInSeconds,
    lineCount: snapshot.lineCount,
    propsHash: props.previewHash,
    assetManifest: props.assetManifest,
    backgroundAsset: {
      src: props.assets?.background || "",
      manifest: props.assetManifest?.background || null,
    },
    audioSummary,
    snapshot,
    warnings: snapshot.warnings || [],
  };
}

export async function verifyRenderedOutput(prepared, log = () => {}) {
  if (prepared.snapshot?.propsHash && prepared.propsHash !== prepared.snapshot.propsHash) {
    throw new Error(`Rendered props hash ${prepared.propsHash} does not match snapshot ${prepared.snapshot.propsHash}.`);
  }
  if (prepared.snapshot?.assetManifestHash && assetManifestHash(prepared.assetManifest) !== prepared.snapshot.assetManifestHash) {
    throw new Error("Rendered asset manifest does not match the final preview snapshot.");
  }
  const outputDir = path.dirname(prepared.outputPath);
  const outputStem = path.basename(prepared.outputPath, path.extname(prepared.outputPath));
  const checkpoints = [...new Set([
    0.3,
    Number((prepared.durationInSeconds / 2).toFixed(3)),
    Math.max(0.3, Number((prepared.durationInSeconds - 0.45).toFixed(3))),
  ])];
  const audioStreams = await probeAudioStreams(prepared.outputPath);
  if (prepared.audioSummary?.expected && audioStreams.length === 0) {
    throw new Error(`Rendered MP4 is missing audio stream even though render props include ${audioSummaryLabel(prepared.audioSummary)}.`);
  }
  const frames = [];
  for (let index = 0; index < checkpoints.length; index += 1) {
    const atSeconds = checkpoints[index];
    const framePath = path.join(outputDir, `${outputStem}-frame-${index + 1}.jpg`);
    await execFileAsync(FFMPEG_PATH, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", String(atSeconds),
      "-i", prepared.outputPath,
      "-frames:v", "1",
      "-q:v", "3",
      framePath,
    ], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    frames.push({ atSeconds, path: framePath, bytes: fs.statSync(framePath).size });
  }
  const verification = {
    renderedAt: new Date().toISOString(),
    outputPath: prepared.outputPath,
    propsHash: prepared.propsHash,
    assetManifest: prepared.assetManifest,
    snapshot: prepared.snapshot ? {
      snapshotId: prepared.snapshot.snapshotId,
      propsHash: prepared.snapshot.propsHash,
      assetManifestHash: prepared.snapshot.assetManifestHash,
      sourceConfigHash: prepared.snapshot.sourceConfigHash,
    } : null,
    audio: {
      expected: prepared.audioSummary || audioSummaryFromProps({}),
      streams: audioStreams,
    },
    background: prepared.backgroundAsset || null,
    frames,
  };
  const verificationPath = path.join(outputDir, `${outputStem}.verification.json`);
  fs.writeFileSync(verificationPath, `${JSON.stringify(verification, null, 2)}\n`, "utf8");
  log(`Verified output: ${frames.length} frame(s) extracted with asset manifest ${prepared.propsHash}.\n`);
  log(`Verified audio: ${audioStreams.length} stream(s); render props include ${audioSummaryLabel(prepared.audioSummary)}.\n`);
  return { ...verification, verificationPath };
}

async function renderVideoWithRemotionUnlocked(slug, log = () => {}, { renderMode = DEFAULT_RENDER_MODE, job = null } = {}) {
  const renderProfile = resolveRenderProfile(renderMode);
  const prepared = await prepareRemotionJob(slug, { renderMode: renderProfile.renderMode });
  if (isJobCancelled(job)) throw new JobCancelledError("Render cancelled before Remotion started");
  log(`Prepared Remotion job: ${prepared.lineCount} captions, ${prepared.durationInSeconds}s.\n`);
  log(`Audio in render props: ${audioSummaryLabel(prepared.audioSummary)}.\n`);
  log(`Render profile: ${renderProfile.renderMode}.\n`);
  log(`Render settings: concurrency ${renderProfile.concurrency}, hardware ${renderProfile.hardwareAcceleration}, gl ${renderProfile.gl || "auto"}, bitrate ${RENDER_VIDEO_BITRATE}.\n`);
  log(`Remotion FFmpeg bin: ${REMOTION_FFMPEG_BIN}.\n`);
  for (const warning of prepared.warnings || []) log(`Warning: ${warning}\n`);

  const renderArgs = [
    "render",
    REMOTION_ENTRY,
    "AutoCompare",
    prepared.outputPath,
    "--props",
    prepared.propsPath,
    "--public-dir",
    prepared.jobDir,
    "--overwrite",
    "--codec",
    "h264",
    "--pixel-format",
    "yuv420p",
    "--image-format",
    "jpeg",
    "--concurrency",
    renderProfile.concurrency,
    "--hardware-acceleration",
    renderProfile.hardwareAcceleration,
    "--video-bitrate",
    RENDER_VIDEO_BITRATE,
    "--audio-codec",
    "aac",
    "--audio-bitrate",
    "320k",
    "--enforce-audio-track",
  ];
  if (renderProfile.gl && renderProfile.gl !== "auto") renderArgs.push("--gl", renderProfile.gl);
  const render = remotionCommand(renderArgs);
  await runCommand({
    label: "Remotion render",
    command: render.command,
    args: render.args,
    cwd: REPO_ROOT,
    log,
    job,
  });
  if (isJobCancelled(job)) throw new JobCancelledError("Render cancelled");
  prepared.verification = await verifyRenderedOutput(prepared, log);
  if (isJobCancelled(job)) throw new JobCancelledError("Render cancelled");
  prepared.officialRender = writeOfficialRender(prepared.root, {
    outputPath: prepared.outputPath,
    propsHash: prepared.propsHash,
    assetManifestHash: prepared.snapshot?.assetManifestHash,
    renderMode: prepared.renderMode,
    verification: prepared.verification,
  });
  clearOfficialRenderDirty(prepared.root);
  const removed = cleanupOldRenderArtifacts(prepared.root, prepared.outputPath);
  if (removed.length) log(`\nRemoved old render(s): ${removed.join(", ")}\n`);
  return prepared;
}

export async function renderVideoWithRemotion(slug, log = () => {}, options = {}) {
  return withProjectLock(slug, "render project", () => renderVideoWithRemotionUnlocked(slug, log, options));
}

export async function checkVideoWithRemotion(slug, log = () => {}, { job = null } = {}) {
  const prepared = await prepareRemotionJob(slug);
  if (isJobCancelled(job)) throw new JobCancelledError("Check cancelled before Remotion started");
  log(`Prepared Remotion job: ${prepared.lineCount} captions, ${prepared.durationInSeconds}s.\n`);
  log(`Audio in render props: ${audioSummaryLabel(prepared.audioSummary)}.\n`);
  for (const warning of prepared.warnings || []) log(`Warning: ${warning}\n`);

  const check = remotionCommand([
    "compositions",
    REMOTION_ENTRY,
    "--props",
    prepared.propsPath,
    "--public-dir",
    prepared.jobDir,
  ]);
  await runCommand({
    label: "Remotion check",
    command: check.command,
    args: check.args,
    cwd: REPO_ROOT,
    log,
    job,
  });
  return prepared;
}

function latestRegexMatch(text, regex) {
  let match;
  let latest = null;
  while ((match = regex.exec(text))) latest = match;
  return latest;
}

function clampProgress(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(99, Math.round(value)));
}

function appendRemotionLog(job, chunk, fallbackMessage = "Running Remotion.") {
  appendLog(job, chunk);
  const logs = (job.logs || []).join("");
  const encoded = latestRegexMatch(logs, /Encoded\s+(\d+)\/(\d+)/gi);
  if (encoded) {
    const done = Number(encoded[1]) || 0;
    const total = Number(encoded[2]) || 1;
    updateJob(job, {
      progress: clampProgress(88 + (done / Math.max(1, total)) * 11),
      message: `Encoding video ${done}/${total} frame(s).`,
    });
    return;
  }
  const rendered = latestRegexMatch(logs, /Rendered\s+(\d+)\/(\d+)/gi);
  if (rendered) {
    const done = Number(rendered[1]) || 0;
    const total = Number(rendered[2]) || 1;
    updateJob(job, {
      progress: clampProgress(8 + (done / Math.max(1, total)) * 78),
      message: `Rendering frame ${done}/${total}.`,
    });
    return;
  }
  const bundling = latestRegexMatch(logs, /Bundling\s+(\d+)%/gi);
  if (bundling) {
    updateJob(job, {
      progress: clampProgress(2 + ((Number(bundling[1]) || 0) / 100) * 6),
      message: "Bundling Remotion project.",
    });
    return;
  }
  if (/Verified output/i.test(logs)) {
    updateJob(job, { progress: 98, message: "Verifying render output." });
    return;
  }
  if (/Prepared Remotion job/i.test(logs)) {
    updateJob(job, { progress: 5, message: "Prepared Remotion job." });
    return;
  }
  updateJob(job, { progress: Math.max(1, Number(job.progress) || 1), message: fallbackMessage });
}

export function runRemotionRenderJob(slug, { renderMode = DEFAULT_RENDER_MODE } = {}) {
  const renderProfile = resolveRenderProfile(renderMode);
  return enqueueJob({
    type: "remotion-render",
    slug,
    family: "render",
    resource: renderProfile.renderMode,
    idempotencyKey: "remotion-render:" + slug + ":" + renderProfile.renderMode,
    message: "Waiting for render worker.",
    startMessage: "Starting Remotion render.",
    runner: async (job) => {
      try {
        const rendered = await renderVideoWithRemotion(slug, (chunk) => appendRemotionLog(job, chunk, "Rendering MP4."), { renderMode: renderProfile.renderMode, job });
        if (isJobCancelled(job)) return null;
        updateJob(job, {
          progress: 99,
          message: "Saving render metadata.",
          outputPath: rendered.outputPath,
        });
        return {
          slug,
          renderMode: rendered.renderMode,
          durationInSeconds: rendered.durationInSeconds,
          size: rendered.outputPath && fs.existsSync(rendered.outputPath) ? fs.statSync(rendered.outputPath).size : 0,
          rendered: true,
          outputPath: rendered.outputPath,
          propsHash: rendered.propsHash,
          assetManifest: rendered.assetManifest,
          audioSummary: rendered.audioSummary,
          snapshot: snapshotResponse({ snapshot: rendered.snapshot, props: {} }),
          verification: rendered.verification,
          officialRender: rendered.officialRender,
        };
      } catch (error) {
        if (error instanceof JobCancelledError || isJobCancelled(job)) {
          appendLog(job, "\nRender stopped by user.\n");
          return null;
        }
        appendLog(job, `\nRemotion render failed: ${error.message || error}\n`);
        throw error;
      }
    },
  });
}

export function runRemotionCheckJob(slug) {
  return enqueueJob({
    type: "remotion-check",
    slug,
    family: "render",
    idempotencyKey: "remotion-check:" + slug,
    message: "Waiting for render worker.",
    startMessage: "Starting Remotion check.",
    runner: async (job) => {
      try {
        const checked = await checkVideoWithRemotion(slug, (chunk) => appendRemotionLog(job, chunk, "Checking Remotion project."), { job });
        if (isJobCancelled(job)) return null;
        updateJob(job, { progress: 99, message: "Saving check result." });
        return {
          slug,
          checked: true,
          propsPath: checked.propsPath,
          propsHash: checked.propsHash,
          audioSummary: checked.audioSummary,
          snapshot: snapshotResponse({ snapshot: checked.snapshot, props: {} }),
        };
      } catch (error) {
        if (error instanceof JobCancelledError || isJobCancelled(job)) {
          appendLog(job, "\nCheck stopped by user.\n");
          return null;
        }
        appendLog(job, `\nRemotion check failed: ${error.message || error}\n`);
        throw error;
      }
    },
  });
}
