import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { BACKGROUND_PATH, CHARACTER_DIR, FFMPEG_PATH, FFPROBE_PATH, SAMPLE_AUDIO_PATH, SHARED_ASSETS_DIR } from "../paths.mjs";

const execFileAsync = promisify(execFile);
const POSES = new Set(["point-left", "point-right", "question"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".jpe", ".jfif", ".webp"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg"]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function assertUploadedFile(file) {
  if (!file?.path) throw new Error("Missing uploaded file.");
}

function assertAssetExtension(kind, originalName) {
  const extension = path.extname(String(originalName || "")).toLowerCase();
  if (kind === "character" && ![".mov", ".mp4", ".webm", ".png", ".webp"].includes(extension)) {
    throw new Error("Character asset must be MOV, MP4, WebM, PNG or WebP.");
  }
  if (kind === "background" && !IMAGE_EXTENSIONS.has(extension)) {
    throw new Error("Background asset must be PNG, JPG, JFIF or WebP.");
  }
  if (kind === "sample-audio" && !AUDIO_EXTENSIONS.has(extension)) {
    throw new Error("Sample audio must be MP3, WAV, M4A, AAC or OGG.");
  }
}

function characterExtension(originalName) {
  const extension = path.extname(String(originalName || "")).toLowerCase();
  return [".mov", ".mp4", ".webm", ".png", ".webp"].includes(extension) ? extension : ".mov";
}

async function processCharacterAsset(source, pose, originalName) {
  ensureDir(CHARACTER_DIR);
  const originalDir = path.join(CHARACTER_DIR, "originals");
  const processedDir = path.join(CHARACTER_DIR, "processed");
  const extension = characterExtension(originalName);
  const originalPath = path.join(originalDir, `${pose}${extension}`);
  const processedPath = path.join(processedDir, `${pose}.webm`);
  ensureDir(originalDir);
  ensureDir(processedDir);

  fs.copyFileSync(source, originalPath);
  if ([".png", ".webp"].includes(extension)) {
    fs.rmSync(processedPath, { force: true });
    return { originalPath, processedPath: "" };
  }

  await execFileAsync(FFMPEG_PATH, [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-i", originalPath,
    "-an",
    "-c:v", "libvpx-vp9",
    "-crf", "24",
    "-b:v", "0",
    "-pix_fmt", "yuva420p",
    "-auto-alt-ref", "0",
    "-deadline", "good",
    "-cpu-used", "4",
    "-r", "30",
    processedPath
  ], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });

  return { originalPath, processedPath };
}

async function processBackground(source) {
  ensureDir(path.dirname(BACKGROUND_PATH));
  await sharp(source).png().toFile(BACKGROUND_PATH);
  return { path: BACKGROUND_PATH };
}

async function processSampleAudio(source) {
  await execFileAsync(FFPROBE_PATH, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    source,
  ], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  ensureDir(path.dirname(SAMPLE_AUDIO_PATH));
  fs.copyFileSync(source, SAMPLE_AUDIO_PATH);
  return { path: SAMPLE_AUDIO_PATH };
}

function storedOriginalName(pose) {
  const originalDir = path.join(CHARACTER_DIR, "originals");
  const extension = [".png", ".webp", ".mov", ".mp4", ".webm"]
    .find((candidate) => fs.existsSync(path.join(originalDir, `${pose}${candidate}`))) || ".mov";
  return `originals/${pose}${extension}`;
}

function writeManifest() {
  const manifestPath = path.join(CHARACTER_DIR, "manifest.json");
  const manifest = {
    id: "default",
    updatedAt: new Date().toISOString(),
    poses: {
      "point-left": {
        label: "Tay chỉ trái màn hình",
        original: storedOriginalName("point-left"),
        processed: "processed/point-left.webm"
      },
      "point-right": {
        label: "Tay chỉ phải màn hình",
        original: storedOriginalName("point-right"),
        processed: "processed/point-right.webm"
      },
      question: {
        label: "Đặt câu hỏi",
        original: storedOriginalName("question"),
        processed: "processed/question.webm"
      }
    }
  };
  ensureDir(CHARACTER_DIR);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function uploadAsset({ kind, pose, file }) {
  assertUploadedFile(file);
  const tmpPath = file.path;
  try {
    assertAssetExtension(kind, file.originalname);
    if (kind === "character") {
      if (!POSES.has(pose)) throw new Error("Invalid character pose.");
      const result = await processCharacterAsset(tmpPath, pose, file.originalname);
      writeManifest();
      return { kind, pose, ...result };
    }

    if (kind === "background") {
      return { kind, ...(await processBackground(tmpPath)) };
    }

    if (kind === "sample-audio") {
      return { kind, ...(await processSampleAudio(tmpPath)) };
    }

    throw new Error("Invalid asset kind.");
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

export function uploadTempDir() {
  const dir = path.join(SHARED_ASSETS_DIR, ".uploads");
  ensureDir(dir);
  return dir;
}
