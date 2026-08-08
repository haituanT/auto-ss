import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BACKGROUND_PATH, CHARACTER_DIR, FFPROBE_PATH, SAMPLE_AUDIO_PATH, SHARED_ASSETS_DIR } from "../paths.mjs";

const execFileAsync = promisify(execFile);

async function probeMedia(filePath) {
  if (!fs.existsSync(filePath)) return { ok: false, path: filePath, error: "Missing file" };
  try {
    const stat = fs.statSync(filePath);
    const { stdout } = await execFileAsync(FFPROBE_PATH, [
      "-v", "error",
      "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels",
      "-of", "json",
      filePath,
    ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, path: filePath, mtimeMs: stat.mtimeMs, metadata: JSON.parse(stdout) };
  } catch (error) {
    return { ok: false, path: filePath, error: error.message };
  }
}

function firstExisting(paths) {
  return paths.find((filePath) => fs.existsSync(filePath)) || paths[0];
}

function publicAssetUrl(filePath) {
  const relative = path.relative(SHARED_ASSETS_DIR, filePath).split(path.sep);
  return `/shared-assets/${relative.map(encodeURIComponent).join("/")}`;
}

async function mediaStatus(filePath) {
  const status = await probeMedia(filePath);
  return status.ok ? { ...status, url: publicAssetUrl(filePath) } : status;
}

function originalCharacterPath(pose) {
  return firstExisting([
    path.join(CHARACTER_DIR, "originals", `${pose}.png`),
    path.join(CHARACTER_DIR, "originals", `${pose}.webp`),
    path.join(CHARACTER_DIR, "originals", `${pose}.mov`),
    path.join(CHARACTER_DIR, "originals", `${pose}.mp4`),
    path.join(CHARACTER_DIR, "originals", `${pose}.webm`),
    path.join(CHARACTER_DIR, `${pose}.png`),
    path.join(CHARACTER_DIR, `${pose}.webp`),
    path.join(CHARACTER_DIR, `${pose}.mp4`),
  ]);
}

function processedCharacterPath(pose) {
  return firstExisting([
    path.join(CHARACTER_DIR, "processed", `${pose}.webm`),
    path.join(CHARACTER_DIR, "processed", `${pose}.mp4`),
  ]);
}

function fileStatus(filePath) {
  if (!fs.existsSync(filePath)) return { ok: false, path: filePath };
  const stat = fs.statSync(filePath);
  return { ok: true, path: filePath, mtimeMs: stat.mtimeMs, url: publicAssetUrl(filePath) };
}

async function assetStatus(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) return fileStatus(filePath);
  return mediaStatus(filePath);
}

export async function getAssetStatus() {
  const poses = {
    "point-left": await assetStatus(originalCharacterPath("point-left")),
    "point-right": await assetStatus(originalCharacterPath("point-right")),
    question: await assetStatus(originalCharacterPath("question")),
  };
  const processed = {
    "point-left": await mediaStatus(processedCharacterPath("point-left")),
    "point-right": await mediaStatus(processedCharacterPath("point-right")),
    question: await mediaStatus(processedCharacterPath("question")),
  };

  return {
    characterDir: CHARACTER_DIR,
    poses,
    processed,
    manifest: fileStatus(path.join(CHARACTER_DIR, "manifest.json")),
    background: fileStatus(BACKGROUND_PATH),
    sampleAudio: await probeMedia(SAMPLE_AUDIO_PATH),
  };
}
