import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { FFMPEG_PATH, REPO_ROOT, videoPath } from "../paths.mjs";
import { normalizeProjectConfig } from "./projectConfig.mjs";
import { markDirty } from "./projectPipeline.mjs";
import { syncProjectState } from "./projectState.mjs";
import { appendLog, updateJob } from "./jobStore.mjs";
import { enqueueJob } from "./jobQueue.mjs";
import { withProjectLock } from "./projectLocks.mjs";

const execFileAsync = promisify(execFile);
const CHARACTER_POSES = new Set(["point-left", "point-right", "question"]);
const CHARACTER_POSE_LIST = ["point-left", "point-right", "question"];
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".jpe", ".jfif", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".mov", ".mp4", ".webm", ".gif"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg"]);
const CHARACTER_VIDEO_CACHE_DIR = path.join(REPO_ROOT, "tmp", "character-video-cache");
const DEFAULT_BACKGROUND_SRC = "assets/backgrounds/paper.png";
const COMPARE_ASSET_KINDS = new Map([
  ["compare-left", { setId: "compare-1", side: "left" }],
  ["compare-right", { setId: "compare-1", side: "right" }],
  ["compare-1-left", { setId: "compare-1", side: "left" }],
  ["compare-1-right", { setId: "compare-1", side: "right" }],
  ["compare-2-left", { setId: "compare-2", side: "left" }],
  ["compare-2-right", { setId: "compare-2", side: "right" }],
]);
const runningCharacterConversions = new Map();

class CharacterConversionSupersededError extends Error {
  constructor(pose) {
    super(`Character conversion superseded for ${pose}.`);
    this.name = "CharacterConversionSupersededError";
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function nextAssetRevision() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

function withAssetRevision(config) {
  return { ...config, assetRevision: nextAssetRevision() };
}

function relativeAssetPath(root, target) {
  return path.relative(root, target).replace(/\\/g, "/");
}

function readConfigForRoot(root, slug = path.basename(root)) {
  return normalizeProjectConfig(readJson(path.join(root, "video.json")), slug);
}

function writeProjectConfig(root, config, slug = path.basename(root)) {
  const next = normalizeProjectConfig(config, slug);
  writeJson(path.join(root, "video.json"), next);
  syncProjectState(root, next);
  return next;
}

function fileHash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function cachePathsForHash(hash) {
  const dir = path.join(CHARACTER_VIDEO_CACHE_DIR, hash);
  return {
    dir,
    fallback: path.join(dir, "fallback.png"),
    preview: path.join(dir, "preview.webm"),
    render: path.join(dir, "render.webm"),
  };
}

function fileReady(filePath) {
  try {
    return fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function cacheReady(hash) {
  const cache = cachePathsForHash(hash);
  return fileReady(cache.fallback) && fileReady(cache.preview) && fileReady(cache.render);
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

async function cleanupUploadedTemp(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.rm(filePath, { force: true, maxRetries: 5, retryDelay: 120 });
  } catch {
    // Windows can briefly keep a Multer temp file locked after Sharp/FFmpeg.
    // Leaving one temp file behind is better than reporting a failed upload.
  }
}

function assertUploadedFile(file) {
  if (!file?.path) throw new Error("Missing uploaded file.");
}

function assertUploadExtension(kind, originalName) {
  const extension = path.extname(String(originalName || "")).toLowerCase();
  if (String(kind || "").startsWith("character-")) {
    if (!IMAGE_EXTENSIONS.has(extension) && !VIDEO_EXTENSIONS.has(extension)) {
      throw new Error("Character pose must be MOV, MP4, WebM, GIF, PNG, JPG, JFIF or WebP.");
    }
    return;
  }
  if (["logo", "background", ...COMPARE_ASSET_KINDS.keys()].includes(kind) && !IMAGE_EXTENSIONS.has(extension)) {
    throw new Error("This project asset must be PNG, JPG, JFIF or WebP.");
  }
  if (kind === "bgm" && !AUDIO_EXTENSIONS.has(extension)) {
    throw new Error("Background music must be MP3, WAV, M4A, AAC or OGG.");
  }
}

async function imageToPng(source, target) {
  ensureDir(path.dirname(target));
  await sharp(source).png().toFile(target);
}

async function characterImageToPng(source, target) {
  ensureDir(path.dirname(target));
  try {
    await sharp(source)
      .ensureAlpha()
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 })
      .extend({
        top: 32,
        right: 32,
        bottom: 32,
        left: 32,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(target);
  } catch {
    await sharp(source).png().toFile(target);
  }
}

async function logoImageToPng(source, target) {
  ensureDir(path.dirname(target));
  try {
    await sharp(source)
      .ensureAlpha()
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 })
      .extend({
        top: 8,
        right: 8,
        bottom: 8,
        left: 8,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(target);
  } catch {
    await sharp(source).png().toFile(target);
  }
}

function copyMedia(source, target) {
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
}

async function runFfmpeg(args, label) {
  try {
    await execFileAsync(FFMPEG_PATH, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    const stderr = String(error?.stderr || "").trim();
    throw new Error(`${label} failed${stderr ? `: ${stderr.split(/\r?\n/).slice(-4).join(" ")}` : ""}`);
  }
}

async function createVideoFallbackFrame(source, target) {
  ensureDir(path.dirname(target));
  await runFfmpeg([
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", source,
    "-frames:v", "1",
    target,
  ], "Character fallback frame");
  if (!fileReady(target)) throw new Error("Character fallback frame failed: empty PNG output");
  return target;
}

async function convertCharacterVideo(source, target, { maxHeight = 0, crf = 34, cpuUsed = 6 } = {}) {
  ensureDir(path.dirname(target));
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", source,
    "-an",
  ];
  if (maxHeight > 0) args.push("-vf", `scale=-2:min(ih\\,${maxHeight})`);
  args.push(
    "-c:v", "libvpx-vp9",
    "-crf", String(crf),
    "-b:v", "0",
    "-pix_fmt", "yuva420p",
    "-auto-alt-ref", "0",
    "-deadline", "good",
    "-cpu-used", String(cpuUsed),
    "-r", "30",
    target,
  );
  await runFfmpeg(args, "Character WebM transcode");
  if (!fileReady(target)) throw new Error("Character WebM transcode failed: empty WebM output");
  return target;
}

function poseJobKey(root, pose) {
  return `${path.resolve(root)}:${pose}`;
}

function setPoseConversionJob(root, pose, job) {
  runningCharacterConversions.set(poseJobKey(root, pose), job);
}

function getPoseConversionJob(root, pose) {
  return runningCharacterConversions.get(poseJobKey(root, pose));
}

function clearPoseConversionJob(root, pose, job) {
  const key = poseJobKey(root, pose);
  if (!job || runningCharacterConversions.get(key) === job) runningCharacterConversions.delete(key);
}

function supersedePoseConversion(root, pose) {
  const job = getPoseConversionJob(root, pose);
  if (job) {
    job.superseded = true;
    job.state.superseded = true;
  }
}

function assertActivePoseConversion(root, pose, job) {
  if (job?.superseded || getPoseConversionJob(root, pose) !== job) {
    throw new CharacterConversionSupersededError(pose);
  }
}

function poseSourceForConfig(config, pose) {
  return config.character?.poseSources?.[pose] || {};
}

function updatePoseSource(root, slug, pose, expectedHash, updater, { dirty = true } = {}) {
  const config = readConfigForRoot(root, slug);
  const current = poseSourceForConfig(config, pose);
  if (expectedHash && current.hash && current.hash !== expectedHash) return null;
  const nextSource = updater(current, config) || current;
  const nextConfig = normalizeProjectConfig({
    ...config,
    character: {
      ...(config.character || {}),
      poseSources: {
        ...(config.character?.poseSources || {}),
        [pose]: nextSource,
      },
    },
  }, slug);
  const withRevision = dirty ? withAssetRevision(markDirty(nextConfig, ["assets", "render"])) : nextConfig;
  return writeProjectConfig(root, withRevision, slug);
}

function installCachedCharacterVideo(root, pose, hash, paths) {
  const cache = cachePathsForHash(hash);
  copyOrLink(cache.fallback, paths.fallback);
  copyOrLink(cache.preview, paths.preview);
  copyOrLink(cache.render, paths.render);
  return {
    original: relativeAssetPath(root, paths.original),
    fallback: relativeAssetPath(root, paths.fallback),
    preview: relativeAssetPath(root, paths.preview),
    render: relativeAssetPath(root, paths.render),
    state: "ready",
    progress: 100,
    error: "",
    hash,
  };
}

function characterPaths(root, pose, extension, hash = "") {
  const hashSuffix = String(hash || "").replace(/[^a-f0-9]/gi, "").slice(0, 12);
  return {
    original: path.join(root, "assets", "character", "originals", `${pose}${hashSuffix ? `-${hashSuffix}` : ""}${extension}`),
    fallback: path.join(root, "assets", "character", "fallback", `${pose}.png`),
    preview: path.join(root, "assets", "character", "preview", `${pose}.webm`),
    render: path.join(root, "assets", "character", "render", `${pose}.webm`),
  };
}

function isLockedFileError(error) {
  return ["EBUSY", "EPERM", "ENOTEMPTY"].includes(error?.code);
}

function removeFileBestEffort(target) {
  try {
    fs.rmSync(target, { force: true });
    return true;
  } catch (error) {
    if (isLockedFileError(error)) return false;
    throw error;
  }
}

function removeCharacterPoseFiles(root, pose) {
  for (const extension of [".webm", ".mov", ".mp4", ".gif", ".png", ".jpg", ".jpeg", ".jpe", ".jfif", ".webp"]) {
    for (const target of [
      path.join(root, "assets", "character", `${pose}${extension}`),
      path.join(root, "assets", "character", "fallback", `${pose}${extension}`),
      path.join(root, "assets", "character", "preview", `${pose}${extension}`),
      path.join(root, "assets", "character", "render", `${pose}${extension}`),
    ]) {
      removeFileBestEffort(target);
    }
  }
  const originalsDir = path.join(root, "assets", "character", "originals");
  try {
    for (const entry of fs.readdirSync(originalsDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const name = entry.name.replace(/\\/g, "/");
      if (name === pose || name.startsWith(`${pose}.`) || name.startsWith(`${pose}-`)) {
        removeFileBestEffort(path.join(originalsDir, entry.name));
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function updateCharacterJob(progressJob, progress, message) {
  if (!progressJob) return;
  appendLog(progressJob, `${message}\n`);
  updateJob(progressJob, { progress, message });
}

export async function inspectCharacterImageTransparency(source) {
  const metadata = await sharp(source).metadata();
  return Boolean(metadata.hasAlpha);
}

async function saveLogoAsset(source, targetRoot, originalName) {
  const extension = path.extname(String(originalName || "")).toLowerCase();
  ensureDir(path.join(targetRoot, "assets", "logo"));

  if (!IMAGE_EXTENSIONS.has(extension)) {
    throw new Error("Logo must be PNG, JPG, JFIF or WebP.");
  }

  const target = path.join(targetRoot, "assets", "logo", "logo.png");
  const hasAlpha = await inspectCharacterImageTransparency(source);
  await logoImageToPng(source, target);
  return {
    relativePath: path.relative(targetRoot, target).replace(/\\/g, "/"),
    warning: hasAlpha ? "" : "Logo khÃ´ng cÃ³ kÃªnh trong suá»‘t. DÃ¹ng PNG/WebP cÃ³ ná»n trong suá»‘t Ä‘á»ƒ khÃ´ng che ná»n video.",
  };
}

async function convertCharacterVideoForProject({ slug, root, pose, originalPath, hash, paths, progressJob = null }) {
  const existing = getPoseConversionJob(root, pose);
  if (existing?.hash === hash && !existing.superseded) return existing.promise;

  const cache = cachePathsForHash(hash);
  const state = { hash, progress: 20 };
  const job = { hash, state, promise: null, superseded: false };
  setPoseConversionJob(root, pose, job);
  const promise = (async () => {
    try {
      assertActivePoseConversion(root, pose, job);
      updateCharacterJob(progressJob, 18, `Preparing character ${pose}.`);
      if (cacheReady(hash)) {
        updateCharacterJob(progressJob, 55, `Installing cached character ${pose}.`);
        const ready = installCachedCharacterVideo(root, pose, hash, paths);
        assertActivePoseConversion(root, pose, job);
        updatePoseSource(root, slug, pose, hash, (_current, config) => {
          config.character.poses[pose] = ready.preview;
          return ready;
        });
        updateCharacterJob(progressJob, 100, `Character ${pose} ready from cache.`);
        return ready;
      }

      ensureDir(cache.dir);
      state.progress = 35;
      updateCharacterJob(progressJob, 35, `Creating fallback frame for ${pose}.`);
      assertActivePoseConversion(root, pose, job);
      updatePoseSource(root, slug, pose, hash, (current) => ({
        ...current,
        state: "processing",
        progress: 35,
        error: "",
      }), { dirty: false });

      if (!fileReady(cache.fallback)) await createVideoFallbackFrame(originalPath, cache.fallback);
      assertActivePoseConversion(root, pose, job);
      copyOrLink(cache.fallback, paths.fallback);
      state.progress = 50;
      updateCharacterJob(progressJob, 50, `Fallback frame ready for ${pose}.`);
      updatePoseSource(root, slug, pose, hash, (current) => ({
        ...current,
        fallback: relativeAssetPath(root, paths.fallback),
        state: "processing",
        progress: 50,
        error: "",
      }), { dirty: false });

      if (!fileReady(cache.preview)) await convertCharacterVideo(originalPath, cache.preview, { maxHeight: 960, crf: 34, cpuUsed: 6 });
      assertActivePoseConversion(root, pose, job);
      copyOrLink(cache.preview, paths.preview);
      const preview = relativeAssetPath(root, paths.preview);
      state.progress = 78;
      updateCharacterJob(progressJob, 78, `Preview WebM ready for ${pose}.`);
      updatePoseSource(root, slug, pose, hash, (current, config) => {
        config.character.poses[pose] = preview;
        return {
          ...current,
          preview,
          state: "processing",
          progress: 78,
          error: "",
        };
      }, { dirty: false });

      if (!fileReady(cache.render)) await convertCharacterVideo(originalPath, cache.render, { maxHeight: 0, crf: 24, cpuUsed: 4 });
      assertActivePoseConversion(root, pose, job);
      copyOrLink(cache.render, paths.render);
      updateCharacterJob(progressJob, 95, `Render WebM ready for ${pose}.`);

      const ready = {
        original: relativeAssetPath(root, paths.original),
        fallback: relativeAssetPath(root, paths.fallback),
        preview: relativeAssetPath(root, paths.preview),
        render: relativeAssetPath(root, paths.render),
        state: "ready",
        progress: 100,
        error: "",
        hash,
      };
      updatePoseSource(root, slug, pose, hash, (_current, config) => {
        config.character.poses[pose] = ready.preview;
        return ready;
      });
      updateCharacterJob(progressJob, 100, `Character ${pose} ready.`);
      return ready;
    } catch (error) {
      if (error instanceof CharacterConversionSupersededError) return null;
      updateCharacterJob(progressJob, 99, `Character ${pose} conversion failed.`);
      for (const target of [paths.preview, paths.render, cache.preview, cache.render]) {
        if (fs.existsSync(target) && !fileReady(target)) removeFileBestEffort(target);
      }
      const message = error.message || String(error);
      updatePoseSource(root, slug, pose, hash, (current, config) => {
        const fallback = current.fallback || (fileReady(paths.fallback) ? relativeAssetPath(root, paths.fallback) : "");
        config.character.poses[pose] = fallback;
        return {
          ...current,
          fallback,
          preview: current.preview || relativeAssetPath(root, paths.preview),
          render: current.render || relativeAssetPath(root, paths.render),
          state: "error",
          progress: 100,
          error: message,
          hash,
        };
      });
      throw error;
    } finally {
      clearPoseConversionJob(root, pose, job);
    }
  })();

  job.promise = promise;
  return promise;
}

function startCharacterVideoConversion({ slug, root, pose, originalPath, hash, paths }) {
  return enqueueJob({
    type: "character-convert",
    slug,
    family: "character",
    resource: pose,
    message: `Waiting to normalize ${pose}.`,
    startMessage: `Normalizing character ${pose}.`,
    runner: async (job) => {
      const ready = await convertCharacterVideoForProject({ slug, root, pose, originalPath, hash, paths, progressJob: job });
      return {
        slug,
        pose,
        superseded: !ready,
        sourceInfo: ready,
        outputPath: ready?.render || ready?.preview || "",
      };
    },
  });
}

async function saveCharacterAsset(source, targetRoot, pose, originalName) {
  const extension = path.extname(String(originalName || "")).toLowerCase();
  ensureDir(path.join(targetRoot, "assets", "character"));
  supersedePoseConversion(targetRoot, pose);

  if (IMAGE_EXTENSIONS.has(extension)) {
    removeCharacterPoseFiles(targetRoot, pose);
    const target = path.join(targetRoot, "assets", "character", `${pose}.png`);
    const hasAlpha = await inspectCharacterImageTransparency(source);
    await characterImageToPng(source, target);
    const relativePath = relativeAssetPath(targetRoot, target);
    return {
      relativePath,
      sourceInfo: {
        original: "",
        fallback: "",
        preview: relativePath,
        render: relativePath,
        state: "image-ready",
        progress: 100,
        error: "",
        hash: fileHash(target),
      },
      warning: hasAlpha ? "" : "Ảnh này không có kênh trong suốt. Dùng PNG/WebP có nền trong suốt để nhân vật không che nền video.",
    };
  }

  if (!VIDEO_EXTENSIONS.has(extension)) {
    throw new Error("Character pose must be MOV, MP4, WebM, GIF, PNG, JPG, JFIF or WebP.");
  }

  const hash = fileHash(source);
  const paths = characterPaths(targetRoot, pose, extension, hash);
  removeCharacterPoseFiles(targetRoot, pose);
  copyMedia(source, paths.original);

  let fallback = "";
  try {
    await createVideoFallbackFrame(paths.original, paths.fallback);
    fallback = relativeAssetPath(targetRoot, paths.fallback);
  } catch {
    fallback = "";
  }

  if (cacheReady(hash)) {
    const ready = installCachedCharacterVideo(targetRoot, pose, hash, paths);
    return { relativePath: ready.preview, warning: "", sourceInfo: ready, originalPath: paths.original, hash, paths, cached: true };
  }

  return {
    relativePath: fallback,
    warning: "",
    sourceInfo: {
      original: relativeAssetPath(targetRoot, paths.original),
      fallback,
      preview: relativeAssetPath(targetRoot, paths.preview),
      render: relativeAssetPath(targetRoot, paths.render),
      state: "processing",
      progress: fallback ? 20 : 10,
      error: "",
      hash,
    },
    originalPath: paths.original,
    hash,
    paths,
    cached: false,
  };
}

async function uploadVideoAssetUnlocked({ slug, kind, file } = {}) {
  assertUploadedFile(file);

  try {
    assertUploadExtension(kind, file.originalname);
    const root = videoPath(slug);
    const configPath = path.join(root, "video.json");
    if (!fs.existsSync(configPath)) throw new Error(`Missing video.json for ${slug}`);
    const config = normalizeProjectConfig(readJson(configPath), slug);
    if (String(kind || "").startsWith("character-")) {
      const pose = String(kind).slice("character-".length);
      if (!CHARACTER_POSES.has(pose)) throw new Error("Invalid character pose.");
      const saved = await saveCharacterAsset(file.path, root, pose, file.originalname);
      config.character.poses[pose] = saved.relativePath;
      config.character.poseSources = {
        ...(config.character.poseSources || {}),
        [pose]: saved.sourceInfo,
      };
      config.character.poseWarnings = { ...(config.character.poseWarnings || {}) };
      if (saved.warning) config.character.poseWarnings[pose] = saved.warning;
      else delete config.character.poseWarnings[pose];
      const next = withAssetRevision(markDirty(config, ["assets", "render"]));
      writeJson(configPath, next);
      syncProjectState(root, next);
      const characterJob = saved.originalPath && !saved.cached
        ? startCharacterVideoConversion({
          slug,
          root,
          pose,
          originalPath: saved.originalPath,
          hash: saved.hash,
          paths: saved.paths,
        })
        : null;
      return {
        slug,
        kind,
        pose,
        path: saved.relativePath ? path.join(root, saved.relativePath) : "",
        assetPath: saved.relativePath,
        assetRevision: next.assetRevision,
        warning: saved.warning,
        characterStatus: saved.sourceInfo,
        characterJob,
        config: next,
      };
    }

    if (kind === "logo") {
      const saved = await saveLogoAsset(file.path, root, file.originalname);
      const next = withAssetRevision(markDirty(normalizeProjectConfig({
        ...config,
        logo: {
          ...(config.logo || {}),
          enabled: true,
          src: saved.relativePath,
          backdrop: false,
        },
      }, slug), ["assets", "render"]));
      writeJson(configPath, next);
      syncProjectState(root, next);
      return {
        slug,
        kind,
        path: path.join(root, saved.relativePath),
        assetPath: saved.relativePath,
        assetRevision: next.assetRevision,
        warning: saved.warning,
        config: next,
      };
    }

    if (COMPARE_ASSET_KINDS.has(kind)) {
      const slot = COMPARE_ASSET_KINDS.get(kind);
      const name = `${slot.setId}-${slot.side}.png`;
      const target = path.join(root, "assets", "compare", name);
      await imageToPng(file.path, target);
      const assetPath = `assets/compare/${name}`;
      const compareSets = (config.compareSets || []).map((set) => ({ ...set }));
      const index = compareSets.findIndex((set) => set.id === slot.setId);
      const set = index >= 0 ? compareSets[index] : { id: slot.setId, leftLabel: config.compare?.leftLabel || "A", rightLabel: config.compare?.rightLabel || "B" };
      set[`${slot.side}Image`] = assetPath;
      const aiSlot = set.aiImages?.[slot.side];
      if (aiSlot && (aiSlot.asset || aiSlot.selectedVariant || aiSlot.state === "ready" || aiSlot.variants?.length)) {
        set.aiImages = {
          ...(set.aiImages || {}),
          [slot.side]: {
            ...aiSlot,
            state: aiSlot.variants?.length ? "ready" : "empty",
            selectedVariant: 0,
            asset: "",
            jobId: "",
            error: "",
            updatedAt: new Date().toISOString(),
          },
        };
      }
      if (index >= 0) compareSets[index] = set;
      else compareSets.push(set);
      const nextConfig = { ...config, compareSets };
      const next = withAssetRevision(markDirty(normalizeProjectConfig(nextConfig, slug), ["assets", "render"]));
      writeJson(configPath, next);
      syncProjectState(root, next);
      return {
        slug,
        kind,
        path: target,
        assetPath: relativeAssetPath(root, target),
        assetRevision: next.assetRevision,
        compareSetId: slot.setId,
        side: slot.side,
        config: next,
      };
    }

    if (kind === "background") {
      const target = path.join(root, DEFAULT_BACKGROUND_SRC);
      await imageToPng(file.path, target);
      config.background = {
        ...config.background,
        type: "image",
        src: DEFAULT_BACKGROUND_SRC,
        custom: true,
        treatment: "raw",
        detail: 0,
        shade: 0,
        blur: 0,
        autoFromCompare: "",
      };
      const next = withAssetRevision(markDirty(config, ["assets", "render"]));
      writeJson(configPath, next);
      syncProjectState(root, next);
      return {
        slug,
        kind,
        path: target,
        assetPath: relativeAssetPath(root, target),
        assetRevision: next.assetRevision,
        config: next,
      };
    }

    if (kind === "bgm") {
      const extension = path.extname(file.originalname || "").toLowerCase() || ".mp3";
      const target = path.join(root, "assets", "audio", `bgm${extension}`);
      copyMedia(file.path, target);
      const next = withAssetRevision(markDirty(normalizeProjectConfig({
        ...config,
        audio: { ...config.audio, bgm: path.relative(root, target).replace(/\\/g, "/") },
      }, slug), ["assets", "render"]));
      writeJson(configPath, next);
      syncProjectState(root, next);
      return { slug, kind, path: target, assetPath: relativeAssetPath(root, target), assetRevision: next.assetRevision, config: next };
    }

    throw new Error("Invalid project asset kind.");
  } finally {
    await cleanupUploadedTemp(file.path);
  }
}

export async function uploadVideoAsset(options = {}) {
  assertUploadedFile(options.file);
  return withProjectLock(options.slug, "upload project asset", () => uploadVideoAssetUnlocked(options));
}

function resolveProjectPath(root, rel) {
  if (!rel) return "";
  if (path.isAbsolute(rel)) return rel;
  return path.join(root, String(rel).replace(/\//g, path.sep));
}

function normalizePoseStatus(root, pose, source = {}) {
  const job = getPoseConversionJob(root, pose);
  const previewReady = fileReady(resolveProjectPath(root, source.preview));
  const renderReady = fileReady(resolveProjectPath(root, source.render));
  const fallbackReady = fileReady(resolveProjectPath(root, source.fallback));
  let state = source.state || "empty";
  let progress = Number(source.progress) || 0;
  if (state === "processing" && job?.hash === source.hash) progress = Math.max(progress, job.state.progress || 0);
  if (state === "processing" && previewReady && renderReady) {
    state = "ready";
    progress = 100;
  }
  if (state === "image-ready") progress = 100;
  if (!source.original && !source.preview && !source.fallback && !source.render) state = "empty";
  return {
    state,
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    original: source.original || "",
    fallback: source.fallback || "",
    preview: source.preview || "",
    render: source.render || "",
    error: source.error || "",
    hash: source.hash || "",
    files: {
      fallback: fallbackReady,
      preview: previewReady,
      render: renderReady,
    },
  };
}

export function getCharacterAssetStatus(slug) {
  const root = videoPath(slug);
  const configPath = path.join(root, "video.json");
  if (!fs.existsSync(configPath)) throw new Error(`Missing video.json for ${slug}`);
  const config = normalizeProjectConfig(readJson(configPath), slug);
  return Object.fromEntries(CHARACTER_POSE_LIST.map((pose) => [
    pose,
    normalizePoseStatus(root, pose, config.character?.poseSources?.[pose] || {}),
  ]));
}

export function deleteCharacterAsset({ slug, pose } = {}) {
  if (!CHARACTER_POSES.has(pose)) throw new Error("Invalid character pose.");
  const root = videoPath(slug);
  const configPath = path.join(root, "video.json");
  if (!fs.existsSync(configPath)) throw new Error(`Missing video.json for ${slug}`);

  const config = normalizeProjectConfig(readJson(configPath), slug);
  const deleted = [];
  for (const extension of [".webm", ".png", ".mp4", ".mov", ".gif", ".jpg", ".jpeg", ".jpe", ".jfif", ".webp"]) {
    for (const target of [
      path.join(root, "assets", "character", `${pose}${extension}`),
      path.join(root, "assets", "character", "originals", `${pose}${extension}`),
      path.join(root, "assets", "character", "fallback", `${pose}${extension}`),
      path.join(root, "assets", "character", "preview", `${pose}${extension}`),
      path.join(root, "assets", "character", "render", `${pose}${extension}`),
    ]) {
      if (fs.existsSync(target)) deleted.push(relativeAssetPath(root, target));
    }
  }
  removeCharacterPoseFiles(root, pose);

  config.character = {
    ...(config.character || {}),
    poses: {
      ...(config.character?.poses || {}),
      [pose]: "",
    },
    poseWarnings: {
      ...(config.character?.poseWarnings || {}),
    },
    poseSources: {
      ...(config.character?.poseSources || {}),
    },
  };
  delete config.character.poseWarnings[pose];
  delete config.character.poseSources[pose];

  const next = withAssetRevision(markDirty(normalizeProjectConfig(config, slug), ["assets", "render"]));
  next.character.poses[pose] = "";
  delete next.character.poseWarnings[pose];
  delete next.character.poseSources[pose];
  writeJson(configPath, next);
  syncProjectState(root, next);
  return {
    slug,
    pose,
    deleted,
    assetRevision: next.assetRevision,
    config: next,
  };
}
