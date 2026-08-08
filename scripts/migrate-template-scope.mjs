import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STUDIO_TEMPLATES_DIR, VIDEOS_DIR } from "../studio/backend/paths.mjs";
import {
  TEMPLATE_BLACKLIST,
  TEMPLATE_SCOPE_VERSION,
  pickTemplateScope,
} from "../shared/templateScope.mjs";
import { copyProjectAssetToTemplate } from "../studio/backend/services/templateAssets.mjs";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fullParts(template) {
  return {
    caption: template.parts?.caption !== false,
    character: template.parts?.character !== false,
    audio: template.parts?.audio !== false,
    layout: template.parts?.layout !== false,
    background: template.parts?.background !== false,
    render: true,
    content: false,
  };
}

function hasPath(value, pathParts) {
  let current = value;
  for (const part of pathParts) {
    if (!current || !Object.prototype.hasOwnProperty.call(current, part)) return false;
    current = current[part];
  }
  return true;
}

function migrationReport(template, before, after) {
  const stripped = TEMPLATE_BLACKLIST.filter((entry) => {
    const parts = entry.split(".");
    return hasPath(before, parts) || hasPath(before.config || {}, parts);
  });
  if (JSON.stringify(before.config || {}) !== JSON.stringify(after.config || {}) && !stripped.length) {
    stripped.push("legacy non-whitelisted template config");
  }
  return {
    id: template.id,
    type: template.type,
    file: template.file,
    changed: before.scopeVersion !== TEMPLATE_SCOPE_VERSION || stripped.length > 0,
    stripped,
  };
}

function packageLegacyAssets(template, config, filePath) {
  const templateDir = path.dirname(filePath);
  const projectRoot = path.join(VIDEOS_DIR, String(template.sourceSlug || ""));
  const assets = template.assets && typeof template.assets === "object" ? template.assets : {};
  const copy = (reference, group, fileName, label) => {
    if (!reference || reference === "__none__") return reference || "";
    return copyProjectAssetToTemplate(reference, {
      projectRoot,
      templateDir,
      group,
      fileName,
      assets,
      required: false,
      label,
    });
  };

  if (config.character?.poses) {
    for (const pose of ["point-left", "point-right", "question"]) {
      const reference = config.character.poses[pose] || "";
      if (!reference) continue;
      config.character.poses[pose] = copy(reference, "character", `${pose}${path.extname(reference) || ".webm"}`, `character.${pose}`);
    }
    config.character.poseSources = Object.fromEntries(Object.entries(config.character.poses).map(([pose, reference]) => [pose, {
      preview: reference,
      render: reference,
      state: "ready",
    }]));
  }
  if (config.audio?.bgm) {
    config.audio.bgm = copy(config.audio.bgm, "audio", `bgm${path.extname(config.audio.bgm) || ".mp3"}`, "audio.bgm");
  }
  if (config.audio?.sceneStartSfx?.name && config.audio.sceneStartSfx.name !== "__none__") {
    config.audio.sceneStartSfx.name = copy(config.audio.sceneStartSfx.name, "audio/sfx", path.basename(config.audio.sceneStartSfx.name), "audio.sceneStartSfx.name");
  }
  if (config.poseSfx) {
    for (const pose of ["point-left", "point-right", "question"]) {
      if (!config.poseSfx[pose] || config.poseSfx[pose] === "__none__") continue;
      config.poseSfx[pose] = copy(config.poseSfx[pose], "audio/sfx", path.basename(config.poseSfx[pose]), `poseSfx.${pose}`);
    }
  }
  if (config.background?.src) config.background.src = copy(config.background.src, "background", path.basename(config.background.src), "background.src");
  if (config.logo?.src) config.logo.src = copy(config.logo.src, "logo", path.basename(config.logo.src), "logo.src");
  return assets;
}

export function migrateTemplateFile(filePath, { dryRun = false } = {}) {
  const template = readJson(filePath);
  if (template.type !== "full") {
    return {
      id: template.id,
      type: template.type,
      file: filePath,
      changed: false,
      stripped: [],
      skipped: true,
    };
  }
  const before = JSON.parse(JSON.stringify(template));
  const parts = fullParts(template);
  const next = {
    ...template,
    scopeVersion: TEMPLATE_SCOPE_VERSION,
    parts,
    config: pickTemplateScope(template, { parts }),
  };
  if (!Object.keys(next.config.render || {}).length) {
    next.config.render = {
      engine: "remotion",
      width: Number(next.config.layout?.width) || 1080,
      height: Number(next.config.layout?.height) || 1920,
      fps: 30,
      preferredMode: "gpu",
    };
  }
  next.assets = packageLegacyAssets(next, next.config, filePath);
  const report = migrationReport({ ...next, file: filePath }, before, next);
  if (!report.changed) return report;
  const now = new Date().toISOString();
  next.updatedAt = now;
  next.changelog = [
    ...(Array.isArray(template.changelog) ? template.changelog : []),
    {
      version: Math.max(1, Number(template.version) || 1),
      updatedAt: now,
      sourceSlug: template.sourceSlug || "",
      migration: "template-scope-v2",
      diffs: report.stripped.map((key) => ({ key, label: `Strip ${key}` })),
    },
  ];
  if (!dryRun) writeJson(filePath, next);
  return report;
}

export function migrateTemplateLibrary({ root = STUDIO_TEMPLATES_DIR, dryRun = false } = {}) {
  const reports = [];
  if (!fs.existsSync(root)) return reports;
  for (const typeEntry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!typeEntry.isDirectory()) continue;
    const typeRoot = path.join(root, typeEntry.name);
    for (const templateEntry of fs.readdirSync(typeRoot, { withFileTypes: true })) {
      if (!templateEntry.isDirectory()) continue;
      const filePath = path.join(typeRoot, templateEntry.name, "template.json");
      if (!fs.existsSync(filePath)) continue;
      try {
        reports.push(migrateTemplateFile(filePath, { dryRun }));
      } catch (error) {
        reports.push({ file: filePath, changed: false, error: error.message });
      }
    }
  }
  return reports;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const dryRun = process.argv.includes("--dry-run");
  const reports = migrateTemplateLibrary({ dryRun });
  console.log(JSON.stringify({ dryRun, templates: reports }, null, 2));
}
