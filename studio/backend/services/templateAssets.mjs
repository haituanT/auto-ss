import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SHARED_ASSETS_DIR, STUDIO_TEMPLATES_DIR } from "../paths.mjs";

const URL_RE = /^(?:https?:)?\/\//i;
const DATA_RE = /^data:/i;
const TEMPLATE_ASSET_ROOT = "assets/template";

function normalizeRel(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function isInside(child, root) {
  const resolvedChild = path.resolve(child);
  const resolvedRoot = path.resolve(root);
  return resolvedChild === resolvedRoot || resolvedChild.startsWith(`${resolvedRoot}${path.sep}`);
}

function assertInside(child, root, message) {
  if (!isInside(child, root)) throw new Error(message);
}

function safeTemplateId(value) {
  const id = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/i.test(id)) throw new Error("Invalid template id.");
  return id;
}

function safeVersion(value) {
  return Math.max(1, Math.floor(Number(value) || 1));
}

function isExternal(value) {
  const raw = String(value || "").trim();
  return !raw || URL_RE.test(raw) || DATA_RE.test(raw);
}

function candidatePaths(reference, { projectRoot = "", templateDir = "", allowShared = true } = {}) {
  const raw = String(reference || "").trim();
  if (isExternal(raw)) return [];
  const roots = [];
  const addRelative = (root, rel) => {
    if (!root) return;
    const target = path.resolve(root, rel);
    if (isInside(target, root)) roots.push(target);
  };

  if (path.isAbsolute(raw)) {
    roots.push(path.resolve(raw));
  } else {
    addRelative(projectRoot, raw);
    addRelative(templateDir, raw);
    if (allowShared) {
      addRelative(SHARED_ASSETS_DIR, raw);
      addRelative(SHARED_ASSETS_DIR, path.join("sfx", raw));
      addRelative(SHARED_ASSETS_DIR, path.join("backgrounds", raw));
      addRelative(SHARED_ASSETS_DIR, path.join("characters", "default", raw));
    }
  }
  return [...new Set(roots)];
}

function firstFile(candidates) {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // A concurrently removed upload is simply treated as missing.
    }
  }
  return "";
}

/** Resolve only files inside the project, template, or approved shared roots. */
export function resolveReadableAsset(reference, options = {}) {
  const source = firstFile(candidatePaths(reference, options));
  if (!source) return "";
  const allowedRoots = [options.projectRoot, options.templateDir, SHARED_ASSETS_DIR]
    .filter(Boolean)
    .map((root) => path.resolve(root))
    .filter((root) => fs.existsSync(root))
    .map((root) => {
      try { return fs.realpathSync(root); } catch { return root; }
    });
  let realSource = source;
  try { realSource = fs.realpathSync(source); } catch { /* treated as lexical path below */ }
  if (!allowedRoots.some((root) => isInside(realSource, root))) {
    throw new Error(`Asset path is outside allowed folders: ${reference}`);
  }
  return realSource;
}

function safeFileName(value, fallback = "asset") {
  const raw = path.basename(String(value || "").replace(/\\/g, "/"));
  const safe = raw.replace(/[\0<>:"|?*]/g, "-").replace(/\s+/g, "-");
  return safe || fallback;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(source, target) {
  ensureDir(path.dirname(target));
  if (path.resolve(source) !== path.resolve(target)) fs.copyFileSync(source, target);
}

function relativeAssetPath(templateDir, target) {
  return path.relative(templateDir, target).replace(/\\/g, "/");
}

/**
 * Copy a project/shared asset into the current template. The returned path is
 * always relative to templateDir and never points back to shared-assets.
 */
export function copyProjectAssetToTemplate(reference, {
  projectRoot,
  templateDir,
  group = "misc",
  fileName = "",
  assets = null,
  required = false,
  label = "asset",
} = {}) {
  const raw = String(reference || "").trim();
  if (isExternal(raw)) {
    if (required && !raw) throw new Error(`Project is missing required asset: ${label}.`);
    return raw;
  }
  const source = resolveReadableAsset(raw, { projectRoot, templateDir, allowShared: true });
  if (!source) {
    if (required) throw new Error(`Project is missing required asset: ${label} (${raw}).`);
    return raw.replace(/\\/g, "/");
  }
  const targetName = safeFileName(fileName || path.basename(source), path.basename(source));
  const safeGroup = normalizeRel(group).split("/").filter(Boolean).join("/") || "misc";
  const target = path.resolve(templateDir, "assets", safeGroup, targetName);
  assertInside(target, path.resolve(templateDir, "assets"), "Template asset target is outside the template assets folder.");
  copyFile(source, target);
  const relative = relativeAssetPath(templateDir, target);
  if (assets) {
    assets[safeGroup] = assets[safeGroup] || {};
    assets[safeGroup][path.parse(targetName).name] = relative;
  }
  return relative;
}

function templateAssetSource(reference, { templateDir, projectRoot } = {}) {
  return resolveReadableAsset(reference, { templateDir, projectRoot, allowShared: true });
}

function projectTemplateAssetPath({ projectRoot, templateId, version, relative }) {
  const root = path.resolve(projectRoot);
  const id = safeTemplateId(templateId);
  const safeVersionNumber = safeVersion(version);
  const rel = normalizeRel(relative);
  const assetRoot = path.resolve(root, TEMPLATE_ASSET_ROOT, id, `v${safeVersionNumber}`);
  const target = path.resolve(assetRoot, rel.replace(/^assets\//i, ""));
  assertInside(target, assetRoot, "Project template asset target is outside the project template version folder.");
  assertInside(assetRoot, root, "Project template asset root is outside the project folder.");
  return target;
}

/** Copy all template assets into an isolated, versioned project folder. */
export function copyTemplateAssetsToProject({ templateDir, projectRoot, templateId, version }) {
  const sourceRoot = path.resolve(templateDir, "assets");
  if (!fs.existsSync(sourceRoot)) return {};
  assertInside(sourceRoot, path.resolve(STUDIO_TEMPLATES_DIR), "Template asset source is outside the template folder.");
  const result = {};
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const source = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(source);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(templateDir, source).replace(/\\/g, "/");
      const target = projectTemplateAssetPath({ projectRoot, templateId, version, relative });
      copyFile(source, target);
      result[relative] = path.relative(projectRoot, target).replace(/\\/g, "/");
    }
  };
  visit(sourceRoot);
  return result;
}

/**
 * Resolve one stored template reference into the project's versioned asset
 * folder. `assetMap` avoids duplicate copies when the complete tree was copied.
 */
export function copyTemplateAssetToProject(reference, {
  templateDir,
  projectRoot,
  templateId,
  version,
  assetMap = null,
  required = false,
  label = "asset",
} = {}) {
  const raw = String(reference || "").trim();
  if (isExternal(raw)) {
    if (required && !raw) throw new Error(`Template is missing required asset: ${label}.`);
    return raw;
  }
  const normalized = normalizeRel(raw);
  if (assetMap?.[normalized]) return assetMap[normalized];
  const source = templateAssetSource(normalized, { templateDir, projectRoot });
  if (!source) {
    if (required) throw new Error(`Template is missing required asset: ${label} (${raw}).`);
    return normalized;
  }
  const sourceRelative = isInside(source, templateDir)
    ? path.relative(templateDir, source).replace(/\\/g, "/")
    : `assets/audio/${safeFileName(path.basename(source))}`;
  const target = projectTemplateAssetPath({
    projectRoot,
    templateId,
    version,
    relative: sourceRelative,
  });
  copyFile(source, target);
  return path.relative(projectRoot, target).replace(/\\/g, "/");
}

export function projectAssetExists(projectRoot, reference) {
  return Boolean(resolveReadableAsset(reference, { projectRoot, allowShared: false }));
}

export function validateRequiredProjectAssets(entries = [], { projectRoot } = {}) {
  const missing = [];
  for (const entry of entries) {
    const reference = typeof entry === "string" ? entry : entry?.reference;
    const label = typeof entry === "string" ? entry : entry?.label || reference;
    if (!reference || !resolveReadableAsset(reference, { projectRoot, allowShared: true })) {
      missing.push({ label: String(label || "asset"), reference: String(reference || "") });
    }
  }
  if (missing.length) {
    const detail = missing.map((item) => item.reference ? `${item.label} (${item.reference})` : item.label).join(", ");
    throw new Error(`Project is missing required asset(s): ${detail}. Add them before updating the template.`);
  }
  return { valid: true, missing: [] };
}

export function assetFingerprint(reference, options = {}) {
  const raw = String(reference || "").trim();
  if (isExternal(raw)) return raw;
  const source = resolveReadableAsset(raw, options);
  if (!source) return { missing: true, reference: normalizeRel(raw) };
  const stat = fs.statSync(source);
  return {
    bytes: stat.size,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex"),
  };
}

export function templateAssetRoot(templateDir) {
  return path.resolve(templateDir, "assets");
}

export function projectTemplateAssetRoot(projectRoot, templateId, version) {
  return path.resolve(projectRoot, TEMPLATE_ASSET_ROOT, safeTemplateId(templateId), `v${safeVersion(version)}`);
}
