import { badRequest } from "./httpErrors.mjs";

export const PROJECT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,100}$/i;

export function assertSlug(value, { allowEmpty = false } = {}) {
  const slug = String(value ?? "").trim();
  if (!slug && allowEmpty) return slug;
  if (!PROJECT_SLUG_PATTERN.test(slug)) throw badRequest("Invalid project id.");
  return slug;
}

export function assertBodyObject(value, label = "Request body") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(`${label} must be an object.`);
  }
  return value;
}

export function assertArray(value, label = "Value") {
  if (!Array.isArray(value)) throw badRequest(`${label} must be an array.`);
  return value;
}

export function assertRequired(value, field) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw badRequest(`Missing required field: ${field}.`);
  }
  return value;
}

export function assertEnum(value, allowed, field) {
  if (value === undefined || value === null || value === "") return value;
  const normalized = String(value).trim();
  if (!allowed.includes(normalized)) {
    throw badRequest(`Invalid ${field}. Expected one of: ${allowed.join(", ")}.`);
  }
  return normalized;
}
