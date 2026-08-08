import fs from "node:fs";
import path from "node:path";
import { STUDIO_TEMPLATES_DIR } from "../paths.mjs";

export const PROJECT_TEMPLATE_TYPE = "full";

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function isInside(child, root) {
  const resolvedChild = path.resolve(child);
  const resolvedRoot = path.resolve(root);
  return resolvedChild === resolvedRoot || resolvedChild.startsWith(`${resolvedRoot}${path.sep}`);
}

export function normalizeProjectTemplateType(type) {
  const safeType = String(type || "").trim();
  if (safeType !== PROJECT_TEMPLATE_TYPE) {
    throw new Error("Only full templates can group projects.");
  }
  return safeType;
}

export function normalizeProjectTemplateId(id) {
  const safeId = String(id || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/i.test(safeId)) {
    throw new Error("Invalid template id.");
  }
  return safeId;
}

export function projectTemplateRoot(type, id) {
  const safeType = normalizeProjectTemplateType(type);
  const safeId = normalizeProjectTemplateId(id);
  const typeRoot = path.resolve(STUDIO_TEMPLATES_DIR, safeType);
  const root = path.resolve(typeRoot, safeId);
  if (!isInside(typeRoot, STUDIO_TEMPLATES_DIR) || !isInside(root, typeRoot)) {
    throw new Error("Template path is outside the template folder.");
  }
  return root;
}

export function getProjectTemplate(type, id) {
  const template = readJson(path.join(projectTemplateRoot(type, id), "template.json"), null);
  if (!template) throw new Error("Template not found.");
  if (template.type !== PROJECT_TEMPLATE_TYPE) {
    throw new Error("Only full templates can group projects.");
  }
  return template;
}

export function normalizeSavedTemplateRef(value) {
  if (!value || typeof value !== "object") return null;
  try {
    const type = normalizeProjectTemplateType(value.type);
    const id = normalizeProjectTemplateId(value.id);
    const version = Math.max(1, Math.floor(Number(value.version) || 1));
    return {
      type,
      id,
      name: String(value.name || id).trim() || id,
      version,
      linkedAt: String(value.linkedAt || ""),
    };
  } catch {
    return null;
  }
}

export function savedTemplateRefFromTemplate(template, linkedAt = new Date().toISOString()) {
  const type = normalizeProjectTemplateType(template?.type);
  const id = normalizeProjectTemplateId(template?.id);
  return {
    type,
    id,
    name: String(template?.name || id).trim() || id,
    version: Math.max(1, Math.floor(Number(template?.version) || 1)),
    linkedAt: String(linkedAt || new Date().toISOString()),
  };
}

export function sameSavedTemplateRef(ref, type, id) {
  const safeRef = normalizeSavedTemplateRef(ref);
  if (!safeRef) return false;
  return safeRef.type === normalizeProjectTemplateType(type) && safeRef.id === normalizeProjectTemplateId(id);
}
