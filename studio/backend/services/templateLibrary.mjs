import fs from "node:fs";
import path from "node:path";
import { SHARED_ASSETS_DIR, STUDIO_TEMPLATES_DIR, VIDEOS_DIR, videoPath } from "../paths.mjs";
import { contentByCompareSetFromLines, slugify } from "./linePlanner.mjs";
import { clearTemplateRefFromVideos, commitContentConfig, getVideo } from "./videoManager.mjs";
import { normalizeProjectConfig } from "./projectConfig.mjs";
import { markDirty } from "./projectPipeline.mjs";
import { syncProjectState } from "./projectState.mjs";
import {
  PROJECT_TEMPLATE_TYPE,
  normalizeProjectTemplateId,
  normalizeProjectTemplateType,
  savedTemplateRefFromTemplate,
  sameSavedTemplateRef,
} from "./templateRefs.mjs";
import {
  TEMPLATE_SCOPE_VERSION,
  diffTemplateScope,
  pickTemplateScope,
} from "../../../shared/templateScope.mjs";
import {
  assetFingerprint,
  copyProjectAssetToTemplate,
  copyTemplateAssetToProject,
  copyTemplateAssetsToProject,
  validateRequiredProjectAssets,
} from "./templateAssets.mjs";

export const TEMPLATE_TYPES = ["caption", "character", "audio", "layout", "background", "content", "full"];
export const TEMPLATE_PARTS = ["caption", "character", "audio", "layout", "background", "render", "content"];
const CHARACTER_POSES = ["point-left", "point-right", "question"];
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".jpe", ".jfif", ".webp"]);

const DEFAULT_FULL_PARTS = {
  caption: true,
  character: true,
  audio: true,
  layout: true,
  background: true,
  render: true,
  content: false,
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function dirtyKeysForTemplateParts(parts = {}) {
  const keys = new Set();
  const add = (...values) => values.forEach((value) => keys.add(value));
  if (parts.caption) add("style", "layout", "render");
  if (parts.character) add("assets", "layout", "render");
  if (parts.audio) add("audio", "assets", "render");
  if (parts.layout) add("layout", "render");
  if (parts.background) add("assets", "style", "render");
  if (parts.render) add("render");
  if (parts.content) add("content", "audio", "render");
  return [...keys];
}

function timestamp() {
  return new Date().toISOString();
}

function isUrl(value) {
  return /^(?:https?:)?\/\//i.test(String(value || "")) || String(value || "").startsWith("data:");
}

function isInside(child, root) {
  const resolvedChild = path.resolve(child);
  const resolvedRoot = path.resolve(root);
  return resolvedChild === resolvedRoot || resolvedChild.startsWith(`${resolvedRoot}${path.sep}`);
}

function assertInside(child, root, message) {
  if (!isInside(child, root)) throw new Error(message);
}

function normalizeType(type) {
  const safeType = String(type || "").trim();
  if (!TEMPLATE_TYPES.includes(safeType)) {
    throw new Error("Invalid template type.");
  }
  return safeType;
}

function normalizeId(id) {
  const safeId = String(id || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/i.test(safeId)) {
    throw new Error("Invalid template id.");
  }
  return safeId;
}

function typeRoot(type) {
  const safeType = normalizeType(type);
  const root = path.resolve(STUDIO_TEMPLATES_DIR, safeType);
  assertInside(root, STUDIO_TEMPLATES_DIR, "Template path is outside the template folder.");
  return root;
}

function templateRoot(type, id) {
  const root = path.resolve(typeRoot(type), normalizeId(id));
  assertInside(root, typeRoot(type), "Template path is outside its type folder.");
  return root;
}

function templateJsonPath(type, id) {
  return path.join(templateRoot(type, id), "template.json");
}

function safeName(value, fallback = "mau") {
  const name = String(value || "").trim();
  return name || fallback;
}

function uniqueTemplateId(type, name) {
  const base = slugify(name) || `template-${Date.now()}`;
  let candidate = base;
  let index = 2;
  while (fs.existsSync(templateRoot(type, candidate))) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function normalizeParts(type, parts = {}) {
  if (type === "full") {
    return Object.fromEntries(TEMPLATE_PARTS.map((part) => [
      part,
      part === "content"
        ? false
        : Boolean(parts?.[part] ?? DEFAULT_FULL_PARTS[part]),
    ]));
  }

  if (!TEMPLATE_PARTS.includes(type)) throw new Error("Invalid template part.");
  return Object.fromEntries(TEMPLATE_PARTS.map((part) => [part, part === type]));
}

function projectRootForSlug(slug) {
  const root = path.resolve(videoPath(slug));
  assertInside(root, VIDEOS_DIR, "Project path is outside the videos folder.");
  return root;
}

function projectSlugsLinkedToTemplate(type, id) {
  if (!fs.existsSync(VIDEOS_DIR)) return [];
  const linked = [];
  for (const entry of fs.readdirSync(VIDEOS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = projectRootForSlug(entry.name);
    const config = readJson(path.join(root, "video.json"), null);
    if (!config) continue;
    if (sameSavedTemplateRef(config.savedTemplateRef, type, id)) linked.push(entry.name);
  }
  return linked;
}

function resolveReadableAsset(reference, projectRoot) {
  const raw = String(reference || "").trim();
  if (!raw || isUrl(raw) || raw.startsWith("/")) return null;

  const candidate = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectRoot, raw);
  const allowed = [projectRoot, SHARED_ASSETS_DIR];
  if (!allowed.some((root) => isInside(candidate, root))) {
    throw new Error(`Asset path is outside allowed folders: ${raw}`);
  }
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
}

function copyAssetToTemplate(reference, { projectRoot, templateDir, group, fileName, assets }) {
  const source = resolveReadableAsset(reference, projectRoot);
  if (!source) return reference || "";

  const extension = path.extname(source).toLowerCase();
  const baseName = String(fileName || path.basename(source)).replace(/[\\/]+/g, "-");
  const targetName = path.extname(baseName) ? baseName : `${baseName}${extension}`;
  const target = path.join(templateDir, "assets", group, targetName);
  assertInside(target, templateDir, "Template asset target is outside the template folder.");
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
  const relative = path.relative(templateDir, target).replace(/\\/g, "/");
  assets[group] = assets[group] || {};
  assets[group][path.parse(targetName).name] = relative;
  return relative;
}

function legacyCopyTemplateAssetToProject(reference, { templateDir, projectRoot }) {
  const raw = String(reference || "").trim();
  if (!raw || isUrl(raw) || raw.startsWith("/")) return raw;

  const source = path.resolve(templateDir, raw);
  if (!isInside(source, templateDir) || !fs.existsSync(source) || !fs.statSync(source).isFile()) {
    return raw;
  }

  const target = path.resolve(projectRoot, raw);
  assertInside(target, projectRoot, "Project asset target is outside the project folder.");
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
  return path.relative(projectRoot, target).replace(/\\/g, "/");
}

function projectAssetExists(projectRoot, reference) {
  const raw = String(reference || "").trim();
  if (!raw || isUrl(raw) || raw.startsWith("/") || path.isAbsolute(raw)) return false;
  const target = path.resolve(projectRoot, raw);
  return isInside(target, projectRoot) && fs.existsSync(target) && fs.statSync(target).isFile();
}

function characterPoseSourceFromRel(rel, fallback = {}) {
  const safeRel = String(rel || "").replace(/\\/g, "/");
  if (!safeRel) return null;
  const extension = path.extname(safeRel).toLowerCase();
  const imageReady = IMAGE_EXTENSIONS.has(extension);
  return {
    original: "",
    fallback: "",
    preview: safeRel,
    render: safeRel,
    state: imageReady ? "image-ready" : "ready",
    progress: 100,
    error: "",
    hash: String(fallback?.hash || ""),
  };
}

function copyCharacterPoseToTemplate(pose, rel, { projectRoot, templateDir, assets, previousCharacter = {}, includeAssets }) {
  const raw = String(rel || "").trim();
  if (!includeAssets) return raw.replace(/\\/g, "/");

  const source = resolveReadableAsset(raw, projectRoot);
  if (source) {
    return copyAssetToTemplate(raw, {
      projectRoot,
      templateDir,
      group: "character",
      fileName: `${pose}${path.extname(source).toLowerCase()}`,
      assets,
    });
  }

  const previousRel = String(previousCharacter.poses?.[pose] || "").replace(/\\/g, "/");
  if ((!raw || (!isUrl(raw) && !raw.startsWith("/"))) && previousRel) return previousRel;
  return raw.replace(/\\/g, "/");
}

function packageCharacterForTemplate(character, context = {}) {
  const next = clone(character || {});
  const previousCharacter = context.previousTemplate?.config?.character || {};
  const poses = {};
  const poseSources = {};

  for (const pose of CHARACTER_POSES) {
    if (!Object.prototype.hasOwnProperty.call(next.poses || {}, pose)
      && !Object.prototype.hasOwnProperty.call(previousCharacter.poses || {}, pose)) {
      continue;
    }

    const sourceRel = next.poses?.[pose] || "";
    const copiedRel = copyCharacterPoseToTemplate(pose, sourceRel, {
      ...context,
      previousCharacter,
    });
    if (!copiedRel) continue;

    poses[pose] = copiedRel;
    if (copiedRel === previousCharacter.poses?.[pose] && previousCharacter.poseSources?.[pose]) {
      poseSources[pose] = clone(previousCharacter.poseSources[pose]);
    } else {
      poseSources[pose] = characterPoseSourceFromRel(copiedRel, next.poseSources?.[pose]);
    }
  }

  next.poses = poses;
  next.poseSources = poseSources;
  return next;
}

function copyTemplateCharacterToProject(character, context) {
  const next = clone(character || {});
  const poses = {};
  const poseSources = {};

  for (const pose of CHARACTER_POSES) {
    const copiedPose = copyTemplateAssetToProject(next.poses?.[pose], {
      ...context,
      required: Boolean(next.poses?.[pose]),
      label: `character.${pose}`,
    });
    if (copiedPose) poses[pose] = copiedPose;

    const source = next.poseSources?.[pose] || {};
    if (!copiedPose && !source.preview && !source.render) continue;
    const preview = source.preview
      ? copyTemplateAssetToProject(source.preview, { ...context, required: false, label: `character.${pose}.preview` })
      : copiedPose;
    const render = source.render
      ? copyTemplateAssetToProject(source.render, { ...context, required: false, label: `character.${pose}.render` })
      : copiedPose;
    poseSources[pose] = {
      preview: preview || copiedPose,
      render: render || copiedPose,
      state: source.state === "image-ready" ? "image-ready" : "ready",
      progress: 100,
      error: "",
      hash: "",
    };
  }

  next.poses = poses;
  next.poseSources = poseSources;
  return next;
}

function stripAudioTiming(line, index) {
  return {
    id: line?.id || `line-${index + 1}`,
    compareSetId: line?.compareSetId || "compare-1",
    text: String(line?.text || line?.caption || line?.tts || "").trim(),
    role: line?.role || "neutral",
    pose: line?.pose || "question",
    focusSide: line?.focusSide || "",
    highlight: line?.highlight || "",
    sfx: line?.sfx || "",
    poseLocked: Boolean(line?.poseLocked),
    focusSideLocked: Boolean(line?.focusSideLocked),
    start: null,
    duration: null,
    dirtyVoice: true,
  };
}

function lineFocusFromConfig(lines = []) {
  return (Array.isArray(lines) ? lines : [])
    .map((line, index) => ({
      id: line?.id || `line-${index + 1}`,
      index,
      focusSide: line?.focusSide || "",
      focusSideLocked: Boolean(line?.focusSideLocked),
    }))
    .filter((line) => line.focusSideLocked);
}

function copyTemplateScopeAssets(config, picked, parts, {
  projectRoot,
  templateDir,
  assets,
  includeAssets = true,
  requireAssets = false,
} = {}) {
  if (!includeAssets) return picked;

  if (parts.character && picked.character) {
    const poses = {};
    for (const pose of CHARACTER_POSES) {
      const reference = config.character?.poses?.[pose] || "";
      if (!reference && !requireAssets) continue;
      const copied = copyProjectAssetToTemplate(reference, {
        projectRoot,
        templateDir,
        group: "character",
        fileName: `${pose}${path.extname(String(reference || ".webm")) || ".webm"}`,
        assets,
        required: requireAssets,
        label: `character.${pose}`,
      });
      if (copied) poses[pose] = copied;
    }
    picked.character.poses = poses;
    picked.character.poseSources = Object.fromEntries(Object.entries(poses).map(([pose, source]) => [pose, {
      preview: source,
      render: source,
      state: "ready",
    }]));
  }

  if (parts.audio && picked.audio) {
    if (picked.audio.bgm) {
      picked.audio.bgm = copyProjectAssetToTemplate(picked.audio.bgm, {
        projectRoot,
        templateDir,
        group: "audio",
        fileName: `bgm${path.extname(String(picked.audio.bgm || ".mp3")) || ".mp3"}`,
        assets,
        required: requireAssets,
        label: "audio.bgm",
      });
    }

    const poseSfx = {};
    for (const pose of CHARACTER_POSES) {
      const reference = picked.poseSfx?.[pose] || "";
      if (!reference || reference === "__none__") {
        poseSfx[pose] = reference;
        continue;
      }
      poseSfx[pose] = copyProjectAssetToTemplate(reference, {
        projectRoot,
        templateDir,
        group: "audio/sfx",
        fileName: path.basename(String(reference)),
        assets,
        required: requireAssets,
        label: `poseSfx.${pose}`,
      });
    }
    picked.poseSfx = poseSfx;

    if (picked.audio.sceneStartSfx?.name && picked.audio.sceneStartSfx.name !== "__none__") {
      picked.audio.sceneStartSfx.name = copyProjectAssetToTemplate(picked.audio.sceneStartSfx.name, {
        projectRoot,
        templateDir,
        group: "audio/sfx",
        fileName: path.basename(String(picked.audio.sceneStartSfx.name)),
        assets,
        required: requireAssets,
        label: "audio.sceneStartSfx.name",
      });
    }
  }

  if (parts.background) {
    if (picked.background?.src) {
      picked.background.src = copyProjectAssetToTemplate(picked.background.src, {
        projectRoot,
        templateDir,
        group: "background",
        fileName: path.basename(String(picked.background.src)),
        assets,
        required: requireAssets,
        label: "background.src",
      });
    }
    if (picked.logo?.src) {
      picked.logo.src = copyProjectAssetToTemplate(picked.logo.src, {
        projectRoot,
        templateDir,
        group: "logo",
        fileName: path.basename(String(picked.logo.src)),
        assets,
        required: requireAssets,
        label: "logo.src",
      });
    }
  }
  return picked;
}

function extractConfigParts(config, parts, {
  projectRoot,
  templateDir,
  includeAssets = true,
  previousTemplate = null,
  requireAssets = false,
} = {}) {
  const picked = pickTemplateScope(config, {
    parts,
    includeContent: Boolean(parts.content),
  });
  const assets = {};
  copyTemplateScopeAssets(config, picked, parts, {
    projectRoot,
    templateDir,
    assets,
    includeAssets,
    requireAssets,
  });

  // Keep the legacy content-template representation while full templates
  // remain content-free. This path is intentionally never enabled by full.
  if (parts.content) {
    picked.lines = (picked.content?.lines || config.lines || [])
      .map(stripAudioTiming)
      .filter((line) => line.text);
    delete picked.content;
  }
  // `previousTemplate` is accepted for API compatibility with older callers;
  // no project data is copied from it into a full template.
  void previousTemplate;
  return { config: picked, assets };
}

function templateSummary(template) {
  return {
    version: template.version || 1,
    scopeVersion: template.scopeVersion || 1,
    id: template.id,
    type: template.type,
    name: template.name,
    description: template.description || "",
    createdAt: template.createdAt || "",
    updatedAt: template.updatedAt || "",
    sourceSlug: template.sourceSlug || "",
    parts: template.parts || {},
    assetGroups: Object.keys(template.assets || {}),
    changelog: Array.isArray(template.changelog) ? template.changelog : [],
  };
}

export function listTemplates(type = "") {
  ensureDir(STUDIO_TEMPLATES_DIR);
  const types = type ? [normalizeType(type)] : TEMPLATE_TYPES;
  const templates = [];
  for (const templateType of types) {
    const root = typeRoot(templateType);
    ensureDir(root);
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const template = readJson(path.join(root, entry.name, "template.json"), null);
      if (template?.id && template?.type) templates.push(templateSummary(template));
    }
  }
  return templates.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) || a.name.localeCompare(b.name, "vi"));
}

export function getTemplate(type, id) {
  const template = readJson(templateJsonPath(type, id), null);
  if (!template) throw new Error("Template not found.");
  return template;
}

function isAssetScopePath(pathParts = []) {
  const key = pathParts.join(".");
  return key === "background.src"
    || key === "logo.src"
    || key === "audio.bgm"
    || key === "audio.sceneStartSfx.name"
    || /^poseSfx\.(point-left|point-right|question)$/.test(key)
    || /^character\.poses\.(point-left|point-right|question)$/.test(key)
    || /^character\.poseSources\.(point-left|point-right|question)\.(preview|render)$/.test(key);
}

function scopeDiffs(projectConfig, template, { parts, projectRoot, templateDir } = {}) {
  return diffTemplateScope(projectConfig, template, {
    parts,
    normalizeValue(value, pathParts, side) {
      if (!isAssetScopePath(pathParts) || typeof value !== "string") return value;
      return assetFingerprint(value, side === "project"
        ? { projectRoot, allowShared: true }
        : { templateDir, allowShared: true });
    },
  });
}

function requiredProjectAssets(config, parts) {
  const entries = [];
  const add = (reference, label) => {
    const raw = String(reference || "").trim();
    if (raw && raw !== "__none__") entries.push({ reference: raw, label });
  };
  if (parts.character) {
    for (const pose of CHARACTER_POSES) add(config.character?.poses?.[pose], `character.${pose}`);
  }
  if (parts.audio) {
    add(config.audio?.bgm, "audio.bgm");
    add(config.audio?.sceneStartSfx?.name, "audio.sceneStartSfx.name");
    for (const pose of CHARACTER_POSES) add(config.poseSfx?.[pose], `poseSfx.${pose}`);
  }
  if (parts.background) {
    add(config.background?.src, "background.src");
    if (config.logo?.enabled !== false) add(config.logo?.src, "logo.src");
  }
  return entries;
}

function initialChangelog(template, now, diffs = []) {
  return [{
    version: template.version || 1,
    updatedAt: now,
    sourceSlug: template.sourceSlug || "",
    diffs: diffs.map(({ part, key, label, before, after }) => ({ part, key, label, before, after })),
  }];
}

export function saveTemplateFromVideo(slug, body = {}) {
  const type = normalizeType(body.type || "full");
  const projectRoot = projectRootForSlug(slug);
  const configPath = path.join(projectRoot, "video.json");
  const rawConfig = readJson(configPath, null);
  if (!rawConfig) throw new Error(`Missing video.json for ${slug}`);

  const name = safeName(body.name, type === "full" ? "Mau toan bo" : `Mau ${type}`);
  const id = uniqueTemplateId(type, body.id || name);
  const templateDir = templateRoot(type, id);
  const now = timestamp();
  const parts = normalizeParts(type, body.parts || {});
  const sourceConfig = normalizeProjectConfig(rawConfig, slug);
  if (type === PROJECT_TEMPLATE_TYPE && sourceConfig.savedTemplateRef) {
    throw new Error("Project already belongs to a template. Use Update template instead.");
  }
  const picked = extractConfigParts(sourceConfig, parts, {
    projectRoot,
    templateDir,
    // A saved template must be self-contained; never allow a project path to
    // leak into template.json through an "includeAssets: false" request.
    includeAssets: true,
    requireAssets: type === PROJECT_TEMPLATE_TYPE,
  });

  const template = {
    version: 1,
    scopeVersion: TEMPLATE_SCOPE_VERSION,
    id,
    type,
    name,
    description: String(body.description || ""),
    createdAt: now,
    updatedAt: now,
    sourceSlug: slug,
    parts,
    config: picked.config,
    assets: picked.assets,
    changelog: [],
  };
  template.changelog = initialChangelog(template, now);
  writeJson(path.join(templateDir, "template.json"), template);
  if (type === PROJECT_TEMPLATE_TYPE) {
    const nextConfig = normalizeProjectConfig({
      ...sourceConfig,
      savedTemplateRef: savedTemplateRefFromTemplate(template, now),
    }, slug);
    writeJson(configPath, nextConfig);
    syncProjectState(projectRoot, nextConfig);
  }
  return template;
}

export function updateTemplateFromVideo(slug, type, id, body = {}) {
  const safeType = normalizeProjectTemplateType(type);
  const safeId = normalizeProjectTemplateId(id);
  const projectRoot = projectRootForSlug(slug);
  const configPath = path.join(projectRoot, "video.json");
  const rawConfig = readJson(configPath, null);
  if (!rawConfig) throw new Error(`Missing video.json for ${slug}`);

  const sourceConfig = normalizeProjectConfig(rawConfig, slug);
  const ref = sourceConfig.savedTemplateRef;
  if (!sameSavedTemplateRef(ref, safeType, safeId)) {
    throw new Error("Project is not linked to this template.");
  }

  const template = getTemplate(safeType, safeId);
  const expectedVersion = Math.max(1, Math.floor(Number(body.expectedVersion ?? ref.version) || 1));
  const currentVersion = Math.max(1, Math.floor(Number(template.version) || 1));
  if (!body.force && currentVersion !== expectedVersion) {
    throw new Error(`Template version changed from ${expectedVersion} to ${currentVersion}. Confirm overwrite before updating.`);
  }

  const templateDir = templateRoot(safeType, safeId);
  const parts = normalizeParts(safeType, template.parts || {});
  const diffs = scopeDiffs(sourceConfig, template, {
    parts,
    projectRoot,
    templateDir,
  });
  if (!diffs.length) {
    return {
      template: templateSummary(template),
      video: getVideo(slug),
      updatedProjects: [],
      updated: false,
      diffs: [],
      blockedReasons: [],
    };
  }
  validateRequiredProjectAssets(requiredProjectAssets(sourceConfig, parts), { projectRoot });
  const picked = extractConfigParts(sourceConfig, parts, {
    projectRoot,
    templateDir,
    // Updating a canonical template always packages its assets. Allowing a
    // config-only update would leave the template pointing at a project file.
    includeAssets: true,
    previousTemplate: template,
    requireAssets: true,
  });
  const now = timestamp();
  const updated = {
    ...template,
    scopeVersion: TEMPLATE_SCOPE_VERSION,
    version: currentVersion + 1,
    updatedAt: now,
    sourceSlug: slug,
    parts,
    config: picked.config,
    assets: picked.assets,
    changelog: [
      ...(Array.isArray(template.changelog) ? template.changelog : []),
      {
        version: currentVersion + 1,
        updatedAt: now,
        sourceSlug: slug,
        diffs: diffs.map(({ part, key, label, before, after }) => ({ part, key, label, before, after })),
      },
    ],
  };
  writeJson(templateJsonPath(safeType, safeId), updated);

  const nextSourceConfig = normalizeProjectConfig({
    ...sourceConfig,
    savedTemplateRef: savedTemplateRefFromTemplate(updated, ref.linkedAt || now),
  }, slug);
  writeJson(configPath, nextSourceConfig);
  syncProjectState(projectRoot, nextSourceConfig);

  return {
    template: templateSummary(updated),
    video: getVideo(slug),
    updatedProjects: [slug],
    updated: true,
    diffs,
    blockedReasons: [],
  };
}

function applyCaption(next, templateConfig) {
  if (templateConfig.caption) next.caption = clone(templateConfig.caption);
  if (templateConfig.layout) {
    next.layout = { ...(next.layout || {}) };
    if (Number.isFinite(Number(templateConfig.layout.captionY))) next.layout.captionY = Number(templateConfig.layout.captionY);
    if ("captionYExplicit" in templateConfig.layout) next.layout.captionYExplicit = Boolean(templateConfig.layout.captionYExplicit);
  }
}

function applyCharacter(next, templateConfig, context) {
  const character = copyTemplateCharacterToProject(templateConfig.character || {}, context);
  next.character = { ...(next.character || {}), ...character };
  if (character.captionFontFamily) {
    next.caption = {
      ...(next.caption || {}),
      fontFamily: character.captionFontFamily,
    };
  }
}

function applyAudio(next, templateConfig, context) {
  const audio = clone(templateConfig.audio || {});
  if (audio.bgm) audio.bgm = copyTemplateAssetToProject(audio.bgm, {
    ...context,
    required: true,
    label: "audio.bgm",
  });
  if (audio.sceneStartSfx?.name && audio.sceneStartSfx.name !== "__none__") {
    audio.sceneStartSfx.name = copyTemplateAssetToProject(audio.sceneStartSfx.name, {
      ...context,
      required: true,
      label: "audio.sceneStartSfx.name",
    });
  }
  next.audio = {
    ...(next.audio || {}),
    ...audio,
    mainAudio: next.audio?.mainAudio || "",
    srt: next.audio?.srt || "",
  };
  if (templateConfig.poseSfx) {
    next.poseSfx = Object.fromEntries(CHARACTER_POSES.map((pose) => {
      const value = templateConfig.poseSfx?.[pose] || "";
      return [pose, value && value !== "__none__"
        ? copyTemplateAssetToProject(value, { ...context, required: true, label: `poseSfx.${pose}` })
        : value];
    }));
  }
}

function applyRender(next, templateConfig) {
  if (!templateConfig.render) return;
  next.render = {
    ...(next.render || {}),
    ...clone(templateConfig.render),
  };
}

function applyLayout(next, templateConfig) {
  if (templateConfig.template) next.template = clone(templateConfig.template);
  if (templateConfig.poseStartSide === "left" || templateConfig.poseStartSide === "right") {
    next.poseStartSide = templateConfig.poseStartSide;
  }
  if (templateConfig.layout) {
    next.layout = {
      ...(next.layout || {}),
      ...clone(templateConfig.layout),
    };
  }
}

function applyBackground(next, templateConfig, context) {
  const background = clone(templateConfig.background || {});
  if (background.src) background.src = copyTemplateAssetToProject(background.src, {
    ...context,
    required: true,
    label: "background.src",
  });
  next.background = { ...(next.background || {}), ...background };
  if (templateConfig.logo) {
    const logo = clone(templateConfig.logo || {});
    if (logo.src) logo.src = copyTemplateAssetToProject(logo.src, {
      ...context,
      required: true,
      label: "logo.src",
    });
    next.logo = { ...(next.logo || {}), ...logo };
  }
}

function applyContent(next, templateConfig, slug) {
  const lines = Array.isArray(templateConfig.lines) ? templateConfig.lines : [];
  return commitContentConfig(next, {
    contentByCompareSet: contentByCompareSetFromLines(lines),
  }, slug);
}

function allowedTemplateParts(template, requestedParts = {}) {
  const requested = normalizeParts(template.type, requestedParts || template.parts || {});
  const allowed = template.parts || {};
  return Object.fromEntries(TEMPLATE_PARTS.map((part) => [part, Boolean(requested[part] && allowed[part])]));
}

export function applyTemplateConfigParts(config, template, { slug = "", projectRoot = "", parts = template?.parts || {} } = {}) {
  const safeSlug = String(slug || config?.slug || "").trim();
  const root = projectRoot || projectRootForSlug(safeSlug);
  const appliedParts = allowedTemplateParts(template, parts);
  let next = clone(normalizeProjectConfig(config, safeSlug));
  const templateDir = templateRoot(template.type, template.id);
  const templateVersion = Math.max(1, Math.floor(Number(template.version) || 1));
  const assetMap = copyTemplateAssetsToProject({
    templateDir,
    projectRoot: root,
    templateId: template.id,
    version: templateVersion,
  });
  const context = {
    templateDir,
    projectRoot: root,
    templateId: template.id,
    version: templateVersion,
    assetMap,
  };

  if (appliedParts.caption) applyCaption(next, template.config || {});
  if (appliedParts.character) applyCharacter(next, template.config || {}, context);
  if (appliedParts.audio) applyAudio(next, template.config || {}, context);
  if (appliedParts.layout) applyLayout(next, template.config || {});
  if (appliedParts.render) applyRender(next, template.config || {});
  if (appliedParts.background) applyBackground(next, template.config || {}, context);
  if (appliedParts.content) next = applyContent(next, template.config || {}, safeSlug);

  return {
    config: next,
    parts: appliedParts,
  };
}

export function applyTemplateToVideo(slug, body = {}) {
  const template = getTemplate(body.type, body.id);
  const projectRoot = projectRootForSlug(slug);
  const configPath = path.join(projectRoot, "video.json");
  const rawConfig = readJson(configPath, null);
  if (!rawConfig) throw new Error(`Missing video.json for ${slug}`);

  const applied = applyTemplateConfigParts(rawConfig, template, {
    slug,
    projectRoot,
    parts: body.parts || template.parts || {},
  });
  const next = template.type === PROJECT_TEMPLATE_TYPE
    ? { ...applied.config, savedTemplateRef: savedTemplateRefFromTemplate(template) }
    : applied.config;

  const normalized = normalizeProjectConfig({ ...next, slug }, slug);
  const dirtyKeys = dirtyKeysForTemplateParts(applied.parts);
  const saved = dirtyKeys.length ? markDirty(normalized, dirtyKeys) : normalized;
  writeJson(configPath, saved);
  syncProjectState(projectRoot, saved);
  return {
    video: getVideo(slug),
    template: templateSummary(template),
    appliedParts: applied.parts,
  };
}

export function getTemplateStatus(slug) {
  const projectRoot = projectRootForSlug(slug);
  const rawConfig = readJson(path.join(projectRoot, "video.json"), null);
  if (!rawConfig) throw new Error(`Missing video.json for ${slug}`);
  const config = normalizeProjectConfig(rawConfig, slug);
  const linkedTemplateRef = config.savedTemplateRef || null;
  if (!linkedTemplateRef) {
    return {
      linkedTemplateRef: null,
      latestVersion: null,
      isBehind: false,
      canUpdateTemplate: false,
      updateDiffs: [],
      blockedReasons: [],
    };
  }

  let template;
  try {
    template = getTemplate(linkedTemplateRef.type, linkedTemplateRef.id);
  } catch (error) {
    return {
      linkedTemplateRef,
      latestVersion: null,
      isBehind: false,
      canUpdateTemplate: false,
      updateDiffs: [],
      blockedReasons: [error.message || "Template not found."],
    };
  }

  const templateDir = templateRoot(template.type, template.id);
  const parts = normalizeParts(template.type, template.parts || {});
  const updateDiffs = scopeDiffs(config, template, { parts, projectRoot, templateDir });
  const blockedReasons = [];
  try {
    validateRequiredProjectAssets(requiredProjectAssets(config, parts), { projectRoot });
  } catch (error) {
    blockedReasons.push(error.message || "Project đang thiếu asset bắt buộc.");
  }

  const latestVersion = Math.max(1, Math.floor(Number(template.version) || 1));
  return {
    linkedTemplateRef,
    latestVersion,
    isBehind: latestVersion > Number(linkedTemplateRef.version || 1),
    canUpdateTemplate: updateDiffs.length > 0 && blockedReasons.length === 0,
    updateDiffs,
    blockedReasons,
  };
}

export function applyLatestTemplateUpdate(slug) {
  const projectRoot = projectRootForSlug(slug);
  const configPath = path.join(projectRoot, "video.json");
  const rawConfig = readJson(configPath, null);
  if (!rawConfig) throw new Error(`Missing video.json for ${slug}`);
  const current = normalizeProjectConfig(rawConfig, slug);
  const ref = current.savedTemplateRef;
  if (!ref) throw new Error("Project is not linked to a full template.");
  const template = getTemplate(ref.type, ref.id);
  const parts = normalizeParts(template.type, template.parts || {});
  parts.content = false;
  validateRequiredProjectAssets(requiredProjectAssets(current, parts), { projectRoot });

  const applied = applyTemplateConfigParts(current, template, {
    slug,
    projectRoot,
    parts,
  });
  const next = normalizeProjectConfig({
    ...applied.config,
    savedTemplateRef: savedTemplateRefFromTemplate(template, ref.linkedAt),
    slug,
  }, slug);
  const dirtyKeys = dirtyKeysForTemplateParts(applied.parts);
  const saved = dirtyKeys.length ? markDirty(next, dirtyKeys) : next;
  writeJson(configPath, saved);
  syncProjectState(projectRoot, saved);
  return {
    video: getVideo(slug),
    template: templateSummary(template),
    appliedParts: applied.parts,
    preserved: ["content", "compareImages", "compareCrop", "voiceover", "srt", "timing"],
  };
}

export function deleteTemplate(type, id) {
  const safeType = normalizeType(type);
  const safeId = normalizeId(id);
  const root = templateRoot(safeType, safeId);
  if (!fs.existsSync(root)) throw new Error("Template not found.");
  const clearedProjects = safeType === PROJECT_TEMPLATE_TYPE ? clearTemplateRefFromVideos(safeType, safeId) : [];
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
  return { type: safeType, id: safeId, deleted: true, clearedProjects };
}

export function renameTemplate(type, id, body = {}) {
  const template = getTemplate(type, id);
  template.name = safeName(body.name, template.name);
  template.description = String(body.description ?? template.description ?? "");
  template.updatedAt = timestamp();
  writeJson(templateJsonPath(type, id), template);
  return template;
}

export function duplicateTemplate(type, id) {
  const template = getTemplate(type, id);
  const nextName = `${template.name || template.id} copy`;
  const nextId = uniqueTemplateId(type, nextName);
  const sourceRoot = templateRoot(type, id);
  const targetRoot = templateRoot(type, nextId);
  fs.cpSync(sourceRoot, targetRoot, { recursive: true });
  const now = timestamp();
  const duplicated = {
    ...template,
    id: nextId,
    name: nextName,
    createdAt: now,
    updatedAt: now,
  };
  writeJson(path.join(targetRoot, "template.json"), duplicated);
  return duplicated;
}
