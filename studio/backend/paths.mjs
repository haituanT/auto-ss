import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const VIDEOS_DIR = path.join(REPO_ROOT, "videos");
export const STUDIO_TEMPLATES_DIR = path.join(REPO_ROOT, "studio-templates");
export const PUBLIC_DIR = path.join(REPO_ROOT, "public");
export const REMOTION_JOBS_DIR = path.join(PUBLIC_DIR, "remotion", "jobs");
export const REMOTION_ENTRY = path.join(REPO_ROOT, "remotion", "src", "index.jsx");
export const SHARED_ASSETS_DIR = path.join(REPO_ROOT, "shared-assets");
export const CHARACTER_DIR = path.join(SHARED_ASSETS_DIR, "characters", "default");
export const BACKGROUND_PATH = path.join(SHARED_ASSETS_DIR, "backgrounds", "paper.png");
export const SAMPLE_AUDIO_PATH = path.join(SHARED_ASSETS_DIR, "sample-voice.mp3");
export const FFMPEG_BIN = process.env.FFMPEG_BIN || path.join(REPO_ROOT, "tools", "ffmpeg", "bin");
export const FFMPEG_PATH = process.env.FFMPEG_PATH || path.join(FFMPEG_BIN, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
export const FFPROBE_PATH = process.env.FFPROBE_PATH || path.join(FFMPEG_BIN, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");

export function exists(filePath) {
  return fs.existsSync(filePath);
}

export function videoPath(slug) {
  const safeSlug = String(slug || "").replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safeSlug) throw new Error("Missing video slug.");
  return path.join(VIDEOS_DIR, safeSlug);
}
