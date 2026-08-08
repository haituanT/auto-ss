import fs from "node:fs";
import path from "node:path";
import { videoPath } from "../paths.mjs";
import { normalizeProjectConfig } from "./projectConfig.mjs";
import { checkProjectData } from "./projectChecker.mjs";
import { deriveProjectState, syncProjectState } from "./projectState.mjs";

export const PIPELINE_DIRTY_KEYS = ["content", "audio", "assets", "style", "layout", "render"];
const SNAPSHOT_DIRTY_KEYS = ["content", "audio", "assets", "style", "layout"];
const OFFICIAL_RENDER_FILE = "official-render.json";

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeKeys(keys = []) {
  return unique(Array.isArray(keys) ? keys : [keys]).filter((key) => PIPELINE_DIRTY_KEYS.includes(key));
}

function dirtyReasonForKey(key) {
  return {
    content: "content",
    audio: "audio",
    assets: "assets",
    style: "style",
    layout: "layout",
    render: "render",
  }[key] || key;
}

function renderUrl(slug, fileName, mtimeMs = Date.now()) {
  return `/videos-media/${encodeURIComponent(slug)}/renders/${encodeURIComponent(fileName)}?v=${Math.round(mtimeMs)}`;
}

export function configPathForRoot(root) {
  return path.join(root, "video.json");
}

export function readProjectConfig(slug) {
  const root = videoPath(slug);
  const configPath = configPathForRoot(root);
  return normalizeProjectConfig(readJson(configPath, {}), slug);
}

export function writeProjectConfig(root, config, slug = path.basename(root)) {
  const normalized = normalizeProjectConfig(config, slug);
  writeJson(configPathForRoot(root), normalized);
  syncProjectState(root, normalized, {
    snapshot: finalSnapshotMetadata(root),
    officialRender: readOfficialRender(root),
  });
  return normalized;
}

export function markDirty(config = {}, keys = [], extraReasons = []) {
  const normalized = normalizeProjectConfig(config, config.slug);
  const dirtyKeys = normalizeKeys(keys);
  if (!dirtyKeys.length) return normalized;
  const pipeline = normalized.pipeline || {};
  const dirty = { ...(pipeline.dirty || {}) };
  for (const key of dirtyKeys) dirty[key] = true;
  const reasons = unique([
    ...(pipeline.dirtyReasons || []),
    ...dirtyKeys.map(dirtyReasonForKey),
    ...(Array.isArray(extraReasons) ? extraReasons : [extraReasons]),
  ]);
  return normalizeProjectConfig({
    ...normalized,
    pipeline: {
      ...pipeline,
      dirty,
      dirtyReasons: reasons,
    },
  }, normalized.slug);
}

export function clearDirty(config = {}, keys = []) {
  const normalized = normalizeProjectConfig(config, config.slug);
  const clearKeys = normalizeKeys(keys);
  if (!clearKeys.length) return normalized;
  const pipeline = normalized.pipeline || {};
  const dirty = { ...(pipeline.dirty || {}) };
  for (const key of clearKeys) dirty[key] = false;
  const clearReasonSet = new Set(clearKeys.map(dirtyReasonForKey));
  const dirtyReasons = (pipeline.dirtyReasons || []).filter((reason) => !clearReasonSet.has(reason));
  return normalizeProjectConfig({
    ...normalized,
    pipeline: {
      ...pipeline,
      dirty,
      dirtyReasons,
    },
  }, normalized.slug);
}

export function setOfficialSnapshot(config = {}, snapshot = {}) {
  const normalized = normalizeProjectConfig(config, config.slug);
  const cleared = clearDirty(normalized, SNAPSHOT_DIRTY_KEYS);
  return markDirty({
    ...cleared,
    pipeline: {
      ...(cleared.pipeline || {}),
      officialSnapshot: {
        propsHash: String(snapshot.propsHash || ""),
        assetManifestHash: String(snapshot.assetManifestHash || ""),
        createdAt: String(snapshot.createdAt || new Date().toISOString()),
      },
    },
  }, ["render"], ["render"]);
}

export function finalSnapshotMetadata(root) {
  return readJson(path.join(root, "snapshots", "render-final", "snapshot.json"), null);
}

export function officialRenderPath(root) {
  return path.join(root, "renders", OFFICIAL_RENDER_FILE);
}

export function readOfficialRender(root) {
  const slug = path.basename(root);
  const metadata = readJson(officialRenderPath(root), null);
  if (!metadata?.fileName) return null;
  const renderPath = path.join(root, "renders", metadata.fileName);
  if (!fs.existsSync(renderPath)) return null;
  const stat = fs.statSync(renderPath);
  return {
    ...metadata,
    name: metadata.fileName,
    path: renderPath,
    location: "renders",
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    url: renderUrl(slug, metadata.fileName, stat.mtimeMs),
  };
}

export function writeOfficialRender(root, renderInfo = {}) {
  const slug = path.basename(root);
  const rendersDir = path.join(root, "renders");
  fs.mkdirSync(rendersDir, { recursive: true });
  const outputPath = renderInfo.outputPath || renderInfo.path || "";
  const fileName = renderInfo.fileName || path.basename(outputPath);
  if (!fileName) throw new Error("Missing official render file name.");
  const renderPath = path.join(rendersDir, fileName);
  if (!fs.existsSync(renderPath)) throw new Error(`Official render file missing: ${renderPath}`);
  const stat = fs.statSync(renderPath);
  const verification = renderInfo.verification || {};
  const verificationPath = verification.verificationPath || renderInfo.verificationPath || "";
  const framePaths = (verification.frames || renderInfo.framePaths || [])
    .map((frame) => typeof frame === "string" ? frame : frame?.path)
    .filter(Boolean);
  const metadata = {
    fileName,
    url: renderUrl(slug, fileName, stat.mtimeMs),
    size: stat.size,
    propsHash: String(renderInfo.propsHash || verification.propsHash || ""),
    assetManifestHash: String(renderInfo.assetManifestHash || verification.snapshot?.assetManifestHash || ""),
    renderMode: String(renderInfo.renderMode || ""),
    verificationPath,
    framePaths,
    verifiedAt: String(renderInfo.verifiedAt || verification.renderedAt || new Date().toISOString()),
  };
  writeJson(officialRenderPath(root), metadata);
  const config = normalizeProjectConfig(readJson(configPathForRoot(root), {}), slug);
  syncProjectState(root, config, {
    snapshot: finalSnapshotMetadata(root),
    officialRender: readOfficialRender(root),
  });
  return readOfficialRender(root);
}

export function clearOfficialRenderDirty(root, config = null) {
  const current = config || normalizeProjectConfig(readJson(configPathForRoot(root), {}), path.basename(root));
  return writeProjectConfig(root, clearDirty(current, ["render"]));
}

function pipelineDirty(config) {
  return config?.pipeline?.dirty || {};
}

function snapshotFileExists(root) {
  return Boolean(finalSnapshotMetadata(root));
}

export function buildPipelineStatus(slug) {
  const root = videoPath(slug);
  const config = readProjectConfig(slug);
  const dirty = pipelineDirty(config);
  const check = checkProjectData(slug);
  const officialRender = readOfficialRender(root);
  const snapshotMeta = finalSnapshotMetadata(root);
  const projectState = deriveProjectState(root, config, { snapshot: snapshotMeta, officialRender });
  const snapshotInfo = config.pipeline?.officialSnapshot || {};
  const snapshotHashesMatch = Boolean(snapshotMeta
    && snapshotInfo.propsHash
    && snapshotMeta.propsHash === snapshotInfo.propsHash
    && snapshotMeta.assetManifestHash === snapshotInfo.assetManifestHash);
  const audioMissing = check.errors.some((error) => /audio|voice|AIMAX|VO/i.test(error));

  return {
    audio: dirty.audio || dirty.content ? "dirty" : audioMissing ? "missing" : "ready",
    snapshot: dirty.content || dirty.audio || dirty.assets || dirty.style || dirty.layout
      ? "dirty"
      : snapshotHashesMatch ? "ready" : snapshotFileExists(root) ? "dirty" : "missing",
    render: dirty.render ? "dirty" : officialRender ? "official" : "missing",
    errors: check.errors,
    warnings: check.warnings,
    dirtyReasons: config.pipeline?.dirtyReasons || [],
    officialRender,
    projectState,
  };
}

export function assertReadyForSnapshot(slug) {
  const config = readProjectConfig(slug);
  const dirty = pipelineDirty(config);
  if (dirty.content || dirty.audio) {
    throw new Error("Project content/audio is dirty. Save official content and regenerate audio before creating Preview final.");
  }
  const check = checkProjectData(slug);
  if (!check.ok) throw new Error(check.errors.join("\n"));
  return { config, check };
}

export function assertReadyForRender(slug) {
  const { config, check } = assertReadyForSnapshot(slug);
  const root = videoPath(slug);
  const dirty = pipelineDirty(config);
  const snapshotDirtyKeys = SNAPSHOT_DIRTY_KEYS.filter((key) => dirty[key]);
  if (snapshotDirtyKeys.length) {
    throw new Error("Preview final is stale. Recreate Preview final before rendering MP4.");
  }
  const snapshotMeta = finalSnapshotMetadata(root);
  const officialSnapshot = config.pipeline?.officialSnapshot || {};
  if (!snapshotMeta) throw new Error("Missing Preview final. Create Preview final before rendering MP4.");
  if (officialSnapshot.propsHash && snapshotMeta.propsHash !== officialSnapshot.propsHash) {
    throw new Error("Preview final is stale. Recreate Preview final before rendering MP4.");
  }
  if (officialSnapshot.assetManifestHash && snapshotMeta.assetManifestHash !== officialSnapshot.assetManifestHash) {
    throw new Error("Preview final assets are stale. Recreate Preview final before rendering MP4.");
  }
  return { config, check, snapshot: snapshotMeta };
}
