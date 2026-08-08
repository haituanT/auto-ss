import fs from "node:fs";
import path from "node:path";
import { VIDEOS_DIR, videoPath } from "../paths.mjs";
import { contentHash, normalizeProjectConfig } from "./projectConfig.mjs";
import {
  contentByCompareSetFromLines,
  contentFromSections,
  editableContentByCompareSet,
  editableContentFromSections,
  normalizeContentByCompareSet,
  planGroupedLines,
} from "./linePlanner.mjs";
import {
  getProjectTemplate,
  normalizeProjectTemplateId,
  normalizeProjectTemplateType,
  savedTemplateRefFromTemplate,
  sameSavedTemplateRef,
} from "./templateRefs.mjs";
import { buildPipelineStatus, markDirty, readOfficialRender } from "./projectPipeline.mjs";
import { syncProjectState } from "./projectState.mjs";
import { hasFullAudio, lineAudioPath, writeVoiceSettingsLock } from "./voiceTiming.mjs";
import { activeJobsForSlug } from "./jobStore.mjs";
import { projectBusy, notFound } from "./httpErrors.mjs";
import { assertSlug } from "./validation.mjs";

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

function timestamp() {
  return new Date().toISOString();
}

function rootForSlug(slug) {
  const safeSlug = assertSlug(slug);

  const root = path.resolve(videoPath(safeSlug));
  const videosRoot = path.resolve(VIDEOS_DIR);
  if (!root.startsWith(`${videosRoot}${path.sep}`)) {
    throw new Error("Project path is outside the videos folder.");
  }
  return root;
}

function mediaUrl(slug, location, name) {
  const parts = ["/videos-media", encodeURIComponent(slug)];
  if (location === "renders") parts.push("renders");
  parts.push(encodeURIComponent(name));
  return parts.join("/");
}

function strippedRegularSaveBody(body = {}) {
  const next = { ...(body || {}) };
  delete next.savedTemplateRef;
  delete next.lines;
  delete next.contentDraft;
  delete next.contentOfficial;
  delete next.audioDuration;
  delete next.subtitleSource;
  return next;
}

function linesContentHash(lines = []) {
  return contentHash(contentByCompareSetFromLines(lines));
}

function contentSectionsFromBody(body = {}, fallbackSections = {}) {
  if (body.contentByCompareSet || body.sections) {
    return normalizeContentByCompareSet(body.contentByCompareSet || body.sections);
  }
  if (Object.prototype.hasOwnProperty.call(body, "content") || Object.prototype.hasOwnProperty.call(body, "text")) {
    return normalizeContentByCompareSet(body.content ?? body.text ?? "");
  }
  return normalizeContentByCompareSet(fallbackSections);
}

function editableContentSectionsFromBody(body = {}, fallbackSections = {}) {
  if (body.contentByCompareSet || body.sections) {
    return editableContentByCompareSet(body.contentByCompareSet || body.sections);
  }
  if (Object.prototype.hasOwnProperty.call(body, "content") || Object.prototype.hasOwnProperty.call(body, "text")) {
    return editableContentByCompareSet(body.content ?? body.text ?? "");
  }
  return editableContentByCompareSet(fallbackSections);
}

function mergeLineMetadata(currentLines = [], incomingLines = []) {
  if (!Array.isArray(incomingLines)) return currentLines;
  if (incomingLines.length !== currentLines.length) return currentLines;
  if (linesContentHash(incomingLines) !== linesContentHash(currentLines)) return currentLines;

  return currentLines.map((line, index) => {
    const incoming = incomingLines[index] || {};
    return {
      ...line,
      role: incoming.role || line.role,
      pose: incoming.pose || line.pose,
      focusSide: incoming.focusSide || line.focusSide,
      highlight: Object.prototype.hasOwnProperty.call(incoming, "highlight") ? incoming.highlight : line.highlight,
      sfx: Object.prototype.hasOwnProperty.call(incoming, "sfx") ? incoming.sfx : line.sfx,
      sfxOffsetMs: Object.prototype.hasOwnProperty.call(incoming, "sfxOffsetMs") ? incoming.sfxOffsetMs : line.sfxOffsetMs,
      sfxVolume: Object.prototype.hasOwnProperty.call(incoming, "sfxVolume") ? incoming.sfxVolume : line.sfxVolume,
      poseLocked: Object.prototype.hasOwnProperty.call(incoming, "poseLocked") ? Boolean(incoming.poseLocked) : line.poseLocked,
      focusSideLocked: Object.prototype.hasOwnProperty.call(incoming, "focusSideLocked") ? Boolean(incoming.focusSideLocked) : line.focusSideLocked,
      dirtyVoice: Boolean(line.dirtyVoice || incoming.dirtyVoice),
      dirtyVoiceReason: incoming.dirtyVoiceReason || line.dirtyVoiceReason || "",
      start: line.start,
      duration: line.duration,
    };
  });
}

function voiceSettingsChanged(currentAudio = {}, incomingAudio = {}) {
  if (!incomingAudio || typeof incomingAudio !== "object") return false;
  const checks = [
    ["provider", (value) => String(value || "")],
    ["voiceId", (value) => String(value || "")],
    ["speed", (value) => Number(value || 0)],
    ["noise", (value) => String(value || "")],
  ];
  return checks.some(([key, normalize]) => Object.prototype.hasOwnProperty.call(incomingAudio, key)
    && normalize(incomingAudio[key]) !== normalize(currentAudio[key]));
}

function markLinesDirty(lines = [], reason = "audio-settings") {
  return lines.map((line) => ({
    ...line,
    dirtyVoice: true,
    dirtyVoiceReason: reason,
  }));
}

function hasPerLineVoice(root, config = {}) {
  if (hasFullAudio(root, config)) return false;
  const lines = Array.isArray(config.lines) ? config.lines : [];
  return lines.length > 0 && lines.every((line, index) => {
    const id = String(line.id || `line-${index + 1}`);
    return Boolean(lineAudioPath(root, id));
  });
}

function lockCurrentVoiceSettingsBeforeChange(root, config = {}) {
  if (config.audio?.provider && config.audio.provider !== "aimax") return;
  if (!hasPerLineVoice(root, config)) return;
  writeVoiceSettingsLock(root, config, { source: "pre-audio-settings-change" });
}

function jsonStable(value) {
  return JSON.stringify(value ?? null);
}

function changed(current, next, key) {
  return jsonStable(current?.[key]) !== jsonStable(next?.[key]);
}

function changedPath(currentValue, nextValue) {
  return String(currentValue || "") !== String(nextValue || "");
}

function compareImagePaths(config = {}) {
  return (config.compareSets || []).flatMap((set) => [set.leftImage || "", set.rightImage || ""]);
}

function dirtyKeysForSave(current = {}, next = {}, incomingAudio = {}) {
  const keys = new Set();
  const markRender = () => keys.add("render");
  const markAssets = () => { keys.add("assets"); markRender(); };
  const markStyle = () => { keys.add("style"); markRender(); };
  const markLayout = () => { keys.add("layout"); markRender(); };
  const markAudio = () => { keys.add("audio"); markRender(); };

  if (voiceSettingsChanged(current.audio, incomingAudio)) markAudio();

  if (changed(current, next, "caption")) markStyle();
  if (changed(current, next, "logo")) {
    markStyle();
    if (changedPath(current.logo?.src, next.logo?.src)) markAssets();
  }
  if (changed(current, next, "layout")) markLayout();
  if (changed(current, next, "background")) markAssets();
  if (jsonStable(current.character?.poses) !== jsonStable(next.character?.poses)) markAssets();
  if (
    Number(current.character?.scale) !== Number(next.character?.scale)
    || Number(current.character?.x) !== Number(next.character?.x)
    || Number(current.character?.y) !== Number(next.character?.y)
  ) {
    markLayout();
  }
  if (changed(current, next, "poseSfx")) markAssets();
  if (changed(current, next, "audio")) {
    const currentAudio = current.audio || {};
    const nextAudio = next.audio || {};
    if (changedPath(currentAudio.bgm, nextAudio.bgm) || jsonStable(currentAudio.sceneStartSfx) !== jsonStable(nextAudio.sceneStartSfx)) {
      markAssets();
    } else {
      markRender();
    }
  }
  if (changed(current, next, "compare") || changed(current, next, "compareSets")) {
    if (jsonStable(compareImagePaths(current)) !== jsonStable(compareImagePaths(next))) markAssets();
    else markLayout();
  }
  if ((next.lines || []).some((line) => line.dirtyVoice) && !(current.lines || []).every((line) => line.dirtyVoice)) markAudio();
  if (jsonStable((current.lines || []).map((line) => ({ id: line.id, pose: line.pose, poseLocked: line.poseLocked, focusSide: line.focusSide, focusSideLocked: line.focusSideLocked })))
    !== jsonStable((next.lines || []).map((line) => ({ id: line.id, pose: line.pose, poseLocked: line.poseLocked, focusSide: line.focusSide, focusSideLocked: line.focusSideLocked })))) {
    markStyle();
  }

  return [...keys];
}

export function commitContentConfig(config = {}, body = {}, slug = "") {
  const current = normalizeProjectConfig(config, slug);
  // Content commit is intentionally content-only. Layout/compare fields are
  // saved by the regular project save first; accepting them here lets an old
  // UI payload overwrite a newer template update with stale state.
  const nextCompareSets = current.compareSets;
  const nextCompare = current.compare;
  const fallbackSections = current.contentDraft?.sections || contentByCompareSetFromLines(current.lines);
  const nextSections = contentSectionsFromBody(body, fallbackSections);
  const nextContent = contentFromSections(nextSections);
  const previousSections = contentByCompareSetFromLines(current.lines);
  const contentChanged = contentHash(nextSections) !== contentHash(previousSections);
  let lines = planGroupedLines({
    contentByCompareSet: nextSections,
    compareSets: nextCompareSets,
    previousLines: current.lines,
    preserveExisting: true,
    poseStartSide: current.poseStartSide,
    allowEmptyContent: true,
  });

  if (contentChanged) {
    lines = lines.map((line) => ({
      ...line,
      start: null,
      duration: null,
      dirtyVoice: true,
      dirtyVoiceReason: "content",
    }));
  }

  const now = timestamp();
  const hash = contentHash(nextSections);
  const next = {
    ...current,
    compare: nextCompare,
    compareSets: nextCompareSets,
    leftLabel: nextCompare.leftLabel,
    rightLabel: nextCompare.rightLabel,
    lines,
    contentDraft: {
      text: nextContent,
      sections: nextSections,
      updatedAt: now,
      hash,
    },
    contentOfficial: {
      revision: Math.max(0, Number(current.contentOfficial?.revision) || 0) + 1,
      savedAt: now,
      lineCount: lines.length,
      hash,
    },
  };

  if (contentChanged) {
    next.audio = {
      ...(current.audio || {}),
      mainAudio: "",
      srt: "",
    };
    delete next.audioDuration;
    delete next.subtitleSource;
  }

  return normalizeProjectConfig(next, slug);
}

function renderEntry(slug, filePath, name, location) {
  const stat = fs.statSync(filePath);
  return {
    name,
    path: filePath,
    location,
    url: `${mediaUrl(slug, location, name)}?v=${Math.round(stat.mtimeMs)}`,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

export function listVideos() {
  if (!fs.existsSync(VIDEOS_DIR)) return [];
  return fs.readdirSync(VIDEOS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => fs.existsSync(path.join(VIDEOS_DIR, entry.name, "package.json")) || fs.existsSync(path.join(VIDEOS_DIR, entry.name, "video.json")))
    .flatMap((entry) => {
      try {
        return [getVideo(entry.name)];
      } catch (error) {
        if (error?.code === "ENOENT" || error?.code === "NOT_FOUND") return [];
        throw error;
      }
    });
}

export function getVideo(slug) {
  const root = rootForSlug(slug);
  if (!fs.existsSync(root)) throw notFound("Project not found.");
  const meta = readJson(path.join(root, "meta.json"), {});
  const configPath = path.join(root, "video.json");
  const rawConfig = readJson(configPath, null);
  const config = rawConfig ? normalizeProjectConfig(rawConfig, slug) : null;
  const rendersDir = path.join(root, "renders");
  const renderMp4 = fs.existsSync(rendersDir)
    ? fs.readdirSync(rendersDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp4"))
      .map((entry) => renderEntry(slug, path.join(rendersDir, entry.name), entry.name, "renders"))
    : [];
  const fallbackRenders = renderMp4.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const officialRender = readOfficialRender(root);
  const renders = officialRender ? [officialRender] : fallbackRenders.slice(0, 1);
  const pipelineStatus = config ? buildPipelineStatus(slug) : null;

  return {
    slug,
    root,
    name: config?.title || meta.name || slug,
    hasVideoJson: Boolean(config),
    config,
    renders,
    officialRender,
    pipelineStatus,
    hasIndex: fs.existsSync(path.join(root, "index.html")),
    hasPackage: fs.existsSync(path.join(root, "package.json")),
  };
}

export function saveVideo(slug, body = {}) {
  const root = rootForSlug(slug);
  const configPath = path.join(root, "video.json");
  if (!fs.existsSync(configPath)) throw new Error(`Missing video.json for ${slug}`);
  const current = normalizeProjectConfig(readJson(configPath, {}), slug);
  const safeBody = strippedRegularSaveBody(body);
  const lines = mergeLineMetadata(current.lines, body.lines);
  const voiceChanged = voiceSettingsChanged(current.audio, safeBody.audio);
  if (voiceChanged) lockCurrentVoiceSettingsBeforeChange(root, current);
  const dirtyLines = voiceChanged ? markLinesDirty(lines, "audio-settings") : lines;
  const merged = normalizeProjectConfig({ ...current, ...safeBody, lines: dirtyLines, slug }, slug);
  const dirtyKeys = dirtyKeysForSave(current, merged, safeBody.audio || {});
  const next = dirtyKeys.length ? markDirty(merged, dirtyKeys) : merged;
  writeJson(configPath, next);
  syncProjectState(root, next);
  return getVideo(slug);
}

export function attachVideoToTemplate(slug, body = {}) {
  const root = rootForSlug(slug);
  const configPath = path.join(root, "video.json");
  if (!fs.existsSync(configPath)) throw new Error(`Missing video.json for ${slug}`);

  const current = normalizeProjectConfig(readJson(configPath, {}), slug);
  if (current.savedTemplateRef) {
    if (sameSavedTemplateRef(current.savedTemplateRef, body.type, body.id)) return getVideo(slug);
    throw new Error("Project already belongs to a template. Use Update template for the linked template.");
  }

  const template = getProjectTemplate(body.type, body.id);
  const next = normalizeProjectConfig({
    ...current,
    savedTemplateRef: savedTemplateRefFromTemplate(template),
  }, slug);
  writeJson(configPath, next);
  syncProjectState(root, next);
  return getVideo(slug);
}

export function clearTemplateRefFromVideos(type, id) {
  const safeType = normalizeProjectTemplateType(type);
  const safeId = normalizeProjectTemplateId(id);
  const cleared = [];

  for (const video of listVideos()) {
    if (!sameSavedTemplateRef(video.config?.savedTemplateRef, safeType, safeId)) continue;
    const configPath = path.join(video.root, "video.json");
    const next = normalizeProjectConfig({
      ...video.config,
      savedTemplateRef: null,
    }, video.slug);
    writeJson(configPath, next);
    syncProjectState(video.root, next);
    cleared.push(video.slug);
  }

  return cleared;
}

export function saveContentDraft(slug, body = {}) {
  const root = rootForSlug(slug);
  const configPath = path.join(root, "video.json");
  if (!fs.existsSync(configPath)) throw new Error(`Missing video.json for ${slug}`);
  const current = normalizeProjectConfig(readJson(configPath, {}), slug);
  const sections = editableContentSectionsFromBody(body, current.contentDraft?.sections || contentByCompareSetFromLines(current.lines));
  const text = editableContentFromSections(sections);
  const next = normalizeProjectConfig({
    ...current,
    contentDraft: {
      text,
      sections,
      updatedAt: timestamp(),
      hash: contentHash(sections),
    },
  }, slug);
  writeJson(configPath, next);
  syncProjectState(root, next);
  return getVideo(slug);
}

export function commitVideoContent(slug, body = {}) {
  const root = rootForSlug(slug);
  const configPath = path.join(root, "video.json");
  if (!fs.existsSync(configPath)) throw new Error(`Missing video.json for ${slug}`);
  const current = normalizeProjectConfig(readJson(configPath, {}), slug);
  let next = commitContentConfig(current, body, slug);
  const contentChanged = current.contentOfficial?.hash !== next.contentOfficial?.hash;
  const compareChanged = changed(current, next, "compare") || changed(current, next, "compareSets");
  if (contentChanged) next = markDirty(next, ["content", "audio", "render"]);
  else if (compareChanged) next = markDirty(next, ["layout", "render"]);
  writeJson(configPath, next);
  syncProjectState(root, next);
  return getVideo(slug);
}

export function normalizeVideoLines(slug, body = {}) {
  const root = rootForSlug(slug);
  const configPath = path.join(root, "video.json");
  if (!fs.existsSync(configPath)) throw new Error(`Missing video.json for ${slug}`);
  const current = normalizeProjectConfig(readJson(configPath, {}), slug);
  const compareConfig = normalizeProjectConfig({
    ...current,
    compare: {
      ...current.compare,
      ...(body.compare || {}),
    },
    compareSets: body.compareSets || current.compareSets,
    poseStartSide: body.poseStartSide || current.poseStartSide,
  }, slug);
  const sections = contentSectionsFromBody(body, contentByCompareSetFromLines(current.lines));
  const lines = planGroupedLines({
    contentByCompareSet: sections,
    compareSets: compareConfig.compareSets,
    previousLines: current.lines,
    preserveExisting: false,
    // "Gán nhân vật" is an explicit user choice: the selected side owns the
    // first pointing line, then the remaining pointing lines alternate. Text
    // labels must not silently override that choice.
    forceAlternatingPoses: true,
    poseStartSide: compareConfig.poseStartSide,
    allowEmptyContent: Number(current.contentOfficial?.lineCount) === 0 && !contentFromSections(sections),
  });
  let next = normalizeProjectConfig({
    ...current,
    compare: compareConfig.compare,
    compareSets: compareConfig.compareSets,
    poseStartSide: compareConfig.poseStartSide,
    lines,
  }, slug);
  const contentChanged = contentHash(contentByCompareSetFromLines(current.lines)) !== contentHash(contentByCompareSetFromLines(next.lines));
  next = markDirty(next, contentChanged ? ["content", "audio", "render"] : ["style", "render"]);
  writeJson(configPath, next);
  syncProjectState(root, next);
  return getVideo(slug);
}

export function deleteVideo(slug) {
  const root = rootForSlug(slug);
  if (!fs.existsSync(root)) throw notFound("Project not found.");
  const activeJobs = activeJobsForSlug(slug);
  if (activeJobs.length) throw projectBusy(slug, activeJobs);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
  return { slug, deleted: true };
}

export function deleteAllVideos() {
  const slugs = listVideos().map((video) => video.slug);
  for (const slug of slugs) deleteVideo(slug);
  return { deleted: slugs };
}

export function deleteVideosBySlug(slugs = []) {
  const requested = Array.isArray(slugs) ? slugs : [];
  const uniqueSlugs = [...new Set(requested.map((slug) => String(slug || "").trim()).filter(Boolean))];
  if (!uniqueSlugs.length) return { deleted: [], blocked: [] };

  const deleted = [];
  const blocked = [];
  for (const slug of uniqueSlugs) {
    try {
      deleteVideo(slug);
      deleted.push(slug);
    } catch (error) {
      if (error?.code === "PROJECT_BUSY") {
        blocked.push({ slug, reason: error.message });
        continue;
      }
      throw error;
    }
  }
  return { deleted, blocked };
}
