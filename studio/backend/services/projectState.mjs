import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  hasFullAudio,
  lineAudioPath,
  readAudioManifest,
  voiceTextHash,
} from "./voiceTiming.mjs";

export const PROJECT_STATE_FILE = "project-state.json";

const STATE_VERSION = 1;
const REVISION_KEYS = ["content", "audio", "visual", "assets", "preview", "render"];
const OFFICIAL_RENDER_FILE = "official-render.json";

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableJson(value[key])]),
    );
  }
  return value;
}

export function hashJson(value) {
  return crypto
    .createHash("sha1")
    .update(JSON.stringify(stableJson(value ?? null)), "utf8")
    .digest("hex")
    .slice(0, 16);
}

function sameNumeric(left, right) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) && !Number.isFinite(b)) return true;
  return Math.abs((Number.isFinite(a) ? a : 0) - (Number.isFinite(b) ? b : 0)) < 0.000001;
}

function normalizedVoiceId(value) {
  return String(value || "").trim();
}

function cleanObject(value = {}) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, item]) => item !== undefined));
}

function defaultRevisions(source = {}) {
  return Object.fromEntries(REVISION_KEYS.map((key) => [key, Math.max(0, Math.floor(Number(source[key]) || 0))]));
}

function nextRevision(currentRevision, oldHash, nextHash, initial = 0) {
  const current = Math.max(0, Math.floor(Number(currentRevision) || 0));
  if (!nextHash) return current;
  if (!oldHash) return current || initial || 1;
  return oldHash === nextHash ? current : current + 1;
}

export function projectStatePath(root) {
  return path.join(root, PROJECT_STATE_FILE);
}

export function readProjectState(root) {
  return readJson(projectStatePath(root), null);
}

function readFinalSnapshot(root) {
  return readJson(path.join(root, "snapshots", "render-final", "snapshot.json"), null);
}

function readOfficialRenderMetadata(root) {
  const metadata = readJson(path.join(root, "renders", OFFICIAL_RENDER_FILE), null);
  if (!metadata?.fileName) return null;
  const renderPath = path.join(root, "renders", metadata.fileName);
  if (!fs.existsSync(renderPath)) return null;
  return metadata;
}

export function normalizeProjectState(state = {}, { slug = "" } = {}) {
  const source = state && typeof state === "object" ? state : {};
  return {
    version: STATE_VERSION,
    slug: String(source.slug || slug || ""),
    revisions: defaultRevisions(source.revisions),
    hashes: {
      content: String(source.hashes?.content || ""),
      audioSelection: String(source.hashes?.audioSelection || ""),
      audio: String(source.hashes?.audio || ""),
      visual: String(source.hashes?.visual || ""),
      assets: String(source.hashes?.assets || ""),
      previewProps: String(source.hashes?.previewProps || ""),
      assetManifest: String(source.hashes?.assetManifest || ""),
      renderProps: String(source.hashes?.renderProps || ""),
    },
    ready: {
      audio: Boolean(source.ready?.audio),
      preview: Boolean(source.ready?.preview),
      render: Boolean(source.ready?.render),
    },
    artifacts: {
      audioManifest: String(source.artifacts?.audioManifest || ""),
      previewSnapshot: String(source.artifacts?.previewSnapshot || ""),
      officialRender: String(source.artifacts?.officialRender || ""),
    },
    updatedAt: String(source.updatedAt || ""),
  };
}

export function contentStateHash(config = {}) {
  return String(config.contentOfficial?.hash || "") || hashJson({
    lines: (config.lines || []).map((line) => ({
      id: line.id,
      compareSetId: line.compareSetId,
      text: line.text || line.tts || line.caption || "",
    })),
  });
}

export function audioSelectionHash(config = {}) {
  const audio = config.audio || {};
  return hashJson({
    provider: audio.provider || "",
    alignmentProvider: audio.alignmentProvider || "",
    voiceId: normalizedVoiceId(audio.voiceId),
    speed: Number(audio.speed) || 0,
    pitch: Number(audio.pitch) || 0,
    mainAudio: audio.mainAudio || "",
    srt: audio.srt || "",
    textHash: voiceTextHash(config.lines || []),
    lineCount: (config.lines || []).length,
  });
}

export function visualStateHash(config = {}) {
  return hashJson({
    template: config.template,
    compare: config.compare,
    compareSets: config.compareSets,
    logo: config.logo,
    background: config.background,
    character: config.character,
    poseSfx: config.poseSfx,
    caption: config.caption,
    layout: config.layout,
    render: config.render,
  });
}

export function assetStateHash(config = {}) {
  return hashJson({
    assetRevision: config.assetRevision || "",
    compareSets: (config.compareSets || []).map((set) => ({
      id: set.id,
      leftImage: set.leftImage || "",
      rightImage: set.rightImage || "",
    })),
    logo: config.logo?.src || "",
    background: config.background?.src || "",
    characterPoses: config.character?.poses || {},
    bgm: config.audio?.bgm || "",
    sceneStartSfx: config.audio?.sceneStartSfx || {},
    poseSfx: config.poseSfx || {},
  });
}

export function audioManifestHash(manifest = {}) {
  return hashJson({
    kind: manifest.kind || "",
    provider: manifest.provider || "",
    model: manifest.model || "",
    voiceId: manifest.voiceId || "",
    speed: manifest.speed ?? "",
    pitch: manifest.pitch ?? "",
    textHash: manifest.textHash || "",
    lineCount: manifest.lineCount ?? "",
    mainAudio: manifest.mainAudio || "",
    srt: manifest.srt || "",
    durations: manifest.durations || {},
    outputs: manifest.outputs || [],
  });
}

export function audioManifestMatchesConfig(root, config = {}, manifest = null) {
  if (!manifest) return false;
  const lines = Array.isArray(config.lines) ? config.lines : [];
  if (lines.some((line) => line?.dirtyVoice)) return false;
  if (manifest.textHash && manifest.textHash !== voiceTextHash(lines)) return false;
  if (Number.isFinite(Number(manifest.lineCount)) && Number(manifest.lineCount) !== lines.length) return false;
  if (manifest.voiceId && normalizedVoiceId(manifest.voiceId) !== normalizedVoiceId(config.audio?.voiceId)) return false;
  if (manifest.speed !== undefined && manifest.speed !== null && !sameNumeric(manifest.speed, config.audio?.speed)) return false;
  if (manifest.pitch !== undefined && manifest.pitch !== null && !sameNumeric(manifest.pitch, config.audio?.pitch)) return false;
  if (Number(config.audio?.pitch) !== 0 && (manifest.pitch === undefined || manifest.pitch === null)) return false;

  if (hasFullAudio(root, config)) return true;
  const durations = manifest.durations || {};
  return lines.length > 0 && lines.every((line, index) => {
    const id = String(line.id || `line-${index + 1}`);
    const duration = Number(durations[id]);
    return Number.isFinite(duration) && duration > 0 && Boolean(lineAudioPath(root, id));
  });
}

function sameStateWithoutUpdatedAt(left, right) {
  const clean = (value) => {
    const clone = { ...(value || {}) };
    delete clone.updatedAt;
    return JSON.stringify(stableJson(clone));
  };
  return clean(left) === clean(right);
}

export function deriveProjectState(root, config = {}, {
  currentState = null,
  audioManifest = readAudioManifest(root),
  snapshot = readFinalSnapshot(root),
  officialRender = readOfficialRenderMetadata(root),
  now = new Date().toISOString(),
} = {}) {
  const current = normalizeProjectState(currentState || readProjectState(root), {
    slug: config.slug || path.basename(root),
  });
  const dirty = config.pipeline?.dirty || {};
  const snapshotInfo = config.pipeline?.officialSnapshot || {};
  const hashes = {
    ...current.hashes,
    content: contentStateHash(config),
    audioSelection: audioSelectionHash(config),
    audio: audioManifest ? audioManifestHash(audioManifest) : "",
    visual: visualStateHash(config),
    assets: assetStateHash(config),
    previewProps: String(snapshot?.propsHash || current.hashes.previewProps || ""),
    assetManifest: String(snapshot?.assetManifestHash || current.hashes.assetManifest || ""),
    renderProps: String(officialRender?.propsHash || current.hashes.renderProps || ""),
  };
  const revisions = {
    content: nextRevision(current.revisions.content, current.hashes.content, hashes.content, Number(config.contentOfficial?.revision) || 1),
    audio: nextRevision(current.revisions.audio, current.hashes.audio, hashes.audio, audioManifest ? 1 : 0),
    visual: nextRevision(current.revisions.visual, current.hashes.visual, hashes.visual, 1),
    assets: nextRevision(current.revisions.assets, current.hashes.assets, hashes.assets, config.assetRevision ? 1 : 0),
    preview: nextRevision(current.revisions.preview, current.hashes.previewProps, hashes.previewProps, snapshot ? 1 : 0),
    render: nextRevision(current.revisions.render, current.hashes.renderProps, hashes.renderProps, officialRender ? 1 : 0),
  };
  const previewDirty = Boolean(dirty.content || dirty.audio || dirty.assets || dirty.style || dirty.layout);
  const previewReady = Boolean(snapshot
    && !previewDirty
    && snapshotInfo.propsHash
    && snapshot.propsHash === snapshotInfo.propsHash
    && snapshot.assetManifestHash === snapshotInfo.assetManifestHash);
  const renderReady = Boolean(officialRender
    && !dirty.render
    && previewReady
    && officialRender.propsHash === snapshot?.propsHash);

  return {
    version: STATE_VERSION,
    slug: String(config.slug || current.slug || path.basename(root)),
    revisions,
    hashes,
    ready: {
      audio: audioManifestMatchesConfig(root, config, audioManifest),
      preview: previewReady,
      render: renderReady,
    },
    artifacts: cleanObject({
      audioManifest: audioManifest ? "assets/vo/manifest.json" : current.artifacts.audioManifest,
      previewSnapshot: snapshot ? "snapshots/render-final/snapshot.json" : current.artifacts.previewSnapshot,
      officialRender: officialRender?.fileName
        ? `renders/${officialRender.fileName}`
        : current.artifacts.officialRender,
    }),
    updatedAt: now,
  };
}

export function writeProjectState(root, state = {}) {
  fs.mkdirSync(root, { recursive: true });
  const normalized = normalizeProjectState(state, { slug: path.basename(root) });
  writeJson(projectStatePath(root), normalized);
  return normalized;
}

export function syncProjectState(root, config = {}, options = {}) {
  const current = normalizeProjectState(readProjectState(root), { slug: config.slug || path.basename(root) });
  const next = deriveProjectState(root, config, { currentState: current, ...options });
  if (sameStateWithoutUpdatedAt(current, next)) return current;
  return writeProjectState(root, next);
}
