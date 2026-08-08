import fs from "node:fs";
import path from "node:path";
import { VIDEOS_DIR } from "../paths.mjs";

const ALLOWED_MEDIA_EXTENSIONS = new Set([
  ".aac",
  ".gif",
  ".jpg",
  ".jpeg",
  ".m4a",
  ".mp3",
  ".mp4",
  ".mov",
  ".ogg",
  ".png",
  ".wav",
  ".webm",
  ".webp",
]);

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return null;
  }
}

export function resolveVideoMediaPath(slug, relativePath) {
  const decodedSlug = decodeSegment(slug);
  if (!decodedSlug || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(decodedSlug)) return "";

  const rawSegments = String(relativePath || "").replace(/^[/\\]+/, "").split(/[\\/]+/);
  const segments = rawSegments.map(decodeSegment);
  if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === ".." || /[/\\\0]/.test(segment))) {
    return "";
  }

  const root = path.resolve(VIDEOS_DIR, decodedSlug);
  const target = path.resolve(root, ...segments);
  if (!isInside(root, target) || !fs.existsSync(target)) return "";

  let stat;
  let realRoot;
  let realTarget;
  try {
    stat = fs.statSync(target);
    if (!stat.isFile()) return "";
    realRoot = fs.realpathSync(root);
    realTarget = fs.realpathSync(target);
  } catch {
    return "";
  }

  if (!isInside(realRoot, realTarget)) return "";
  if (!ALLOWED_MEDIA_EXTENSIONS.has(path.extname(realTarget).toLowerCase())) return "";
  return realTarget;
}

export function serveVideoMedia(req, res, next) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }

  const relativePath = String(req.path || "").replace(/^[/\\]+/, "");
  const separator = relativePath.indexOf("/");
  if (separator <= 0) {
    res.sendStatus(404);
    return;
  }

  const target = resolveVideoMediaPath(relativePath.slice(0, separator), relativePath.slice(separator + 1));
  if (!target) {
    res.sendStatus(404);
    return;
  }

  res.sendFile(target, { dotfiles: "deny" }, (error) => {
    if (error && !res.headersSent) next(error);
  });
}
