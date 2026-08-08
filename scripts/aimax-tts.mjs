import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  displayTextForLine,
  hasPronunciationExpansion,
  minimumReadableDuration,
  normalizeVoiceWhitespace,
  voiceTextForLine,
} from "../shared/ttsPronunciation.mjs";

const execFileAsync = promisify(execFile);
const inflateRawAsync = promisify(zlib.inflateRaw);

const DEFAULT_BASE_URL = "https://aimaxstudio.com";
const DEFAULT_PROVIDER = "minimax";
const DEFAULT_MODEL = "speech-2.8-hd";
const DEFAULT_LANGUAGE = "Vietnamese";
const DEFAULT_SPEED = 1.1;
const DEFAULT_PITCH = 0;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLLS = 180;
const DEFAULT_MAX_LINES = 200;
const DEFAULT_TRIM_THRESHOLD = "-50dB";
const DEFAULT_TRIM_KEEP_SECONDS = 0.08;
const DEFAULT_TRIM_MIN_DURATION_SECONDS = 0.35;
const DEFAULT_TRIM_MIN_SAVED_SECONDS = 0.05;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_FILE_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export { minimumReadableDuration };

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function mergeNonBlank(...sources) {
  const result = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source || {})) {
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        result[key] = value;
      }
    }
  }
  return result;
}

export function loadAimaxEnv() {
  return mergeNonBlank(
    parseEnvFile(path.join(REPO_ROOT, ".env")),
    process.env,
  );
}

function trimSlashes(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function baseUrl(env) {
  return trimSlashes(env.AIMAX_BASE_URL || DEFAULT_BASE_URL);
}

function apiKey(env) {
  const key = String(env.AIMAX_API_KEY || "").trim();
  if (!key) {
    throw new Error("Missing AIMAX_API_KEY. Paste an API key in Studio or provide it through the runtime environment.");
  }
  return key;
}

function firstString(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function extractSegmentsUrl(data = {}) {
  return firstString(
    data.segments_url,
    data.segmentsUrl,
    data.chunks_url,
    data.chunksUrl,
    data.segment_zip_url,
    data.segmentZipUrl,
    data.result?.segments_url,
    data.result?.segmentsUrl,
    data.result?.chunks_url,
    data.result?.chunksUrl,
    data.output?.segments_url,
    data.output?.segmentsUrl,
    data.output?.chunks_url,
    data.output?.chunksUrl,
  );
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function requestJson(endpoint, env, fetchImpl, options = {}) {
  const response = await fetchImpl(`${baseUrl(env)}${endpoint}`, {
    ...options,
    headers: {
      "X-API-Key": apiKey(env),
      ...(options.headers || {}),
    },
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    const detail = data.error_message || data.message || data.detail || data.raw || response.statusText;
    throw new Error(`AIMAX API failed (${response.status}): ${String(detail || "").replace(/\s+/g, " ").trim()}`);
  }
  return data;
}

async function resolveVoiceId(env, fetchImpl) {
  const configured = firstString(
    env.AIMAX_VOICE_ID,
    env.AIMAX_TTS_VOICE_ID,
    env.TTS_VOICE_NAME,
    env.AIMAX_VOICE_NAME,
  );
  if (configured) return configured;

  const data = await requestJson("/api/v1/voices/my", env, fetchImpl);
  const voices = Array.isArray(data.voices) ? data.voices : [];
  const firstVoice = voices
    .map((voice) => firstString(voice.voice_id, voice.id, voice.name))
    .find(Boolean);
  if (!firstVoice) {
    throw new Error("AIMAX TTS requires AIMAX_VOICE_ID, or at least one voice in /api/v1/voices/my.");
  }
  return firstVoice;
}

function positiveInteger(value, fallback, min, max) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeLines(lines) {
  const seenIds = new Set();
  const normalized = (Array.isArray(lines) ? lines : []).map((line, index) => {
    const id = String(line?.id || `line-${index + 1}`).trim();
    const text = displayTextForLine(line);
    const voiceText = voiceTextForLine(line);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid TTS line id: ${id}`);
    }
    if (seenIds.has(id)) {
      throw new Error(`Duplicate TTS line id: ${id}`);
    }
    if (!text) {
      throw new Error(`Missing TTS text for ${id}`);
    }
    seenIds.add(id);
    return { id, text, voiceText };
  });

  if (!normalized.length) {
    throw new Error("AIMAX batch TTS requires at least one line.");
  }
  return normalized;
}

function batchText(lines) {
  return lines.map((line) => normalizeVoiceWhitespace(line.voiceText || line.text)).join("\n");
}

function displayBatchText(lines) {
  return lines.map((line) => line.text).join("\n");
}

function ttsProvider(env = {}) {
  return String(env.AIMAX_TTS_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();
}

function ttsModel(env = {}) {
  return String(env.AIMAX_TTS_MODEL || DEFAULT_MODEL).trim();
}

function ttsSpeed(env = {}) {
  const speed = Number(env.AIMAX_TTS_SPEED || env.AIMAX_SPEED || DEFAULT_SPEED);
  return Number.isFinite(speed) ? speed : DEFAULT_SPEED;
}

function ttsPitch(env = {}) {
  const pitch = Math.round(Number(env.AIMAX_TTS_PITCH || env.AIMAX_PITCH || DEFAULT_PITCH));
  return Number.isFinite(pitch) ? Math.max(-12, Math.min(12, pitch)) : DEFAULT_PITCH;
}

function configuredVoiceId(env = {}) {
  return firstString(
    env.AIMAX_VOICE_ID,
    env.AIMAX_TTS_VOICE_ID,
    env.TTS_VOICE_NAME,
    env.AIMAX_VOICE_NAME,
  );
}

function ttsSettings(env = {}, voiceId = "") {
  return {
    provider: ttsProvider(env),
    model: ttsModel(env),
    speed: ttsSpeed(env),
    pitch: ttsPitch(env),
    voiceId: String(voiceId || configuredVoiceId(env)).trim(),
  };
}

function assertReadableDurations(lines, durations) {
  const bad = unreadableDurationDetails(lines, durations);
  if (bad.length) {
    throw new Error(`AIMAX returned audio that is too short for the text. Split the script or regenerate: ${bad.map((item) => item.message).join("; ")}`);
  }
}

function unreadableDurationDetails(lines, durations) {
  const bad = [];
  for (const line of lines) {
    const duration = Number(durations[line.id]);
    const minimum = minimumReadableDuration(line.text, { voiceText: line.voiceText });
    if (Number.isFinite(duration) && duration + 0.08 < minimum) {
      bad.push({
        id: line.id,
        duration,
        minimum,
        textLength: line.text.length,
        message: `${line.id}: ${duration.toFixed(3)}s for ${line.text.length} chars`,
      });
    }
  }
  return bad;
}

function shouldTrimSilence(env = {}) {
  const value = String(env.AIMAX_TTS_TRIM_SILENCE ?? "1").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(value);
}

function isSameHistorySettings(item, env) {
  const settings = item.voice_settings || item.voiceSettings || {};
  const expected = ttsSettings(env);
  const volume = Number(env.AIMAX_TTS_VOLUME || 1);

  if (settings.provider && String(settings.provider).trim().toLowerCase() !== expected.provider) return false;
  if (settings.model && String(settings.model).trim() !== expected.model) return false;
  if (Number.isFinite(Number(settings.speed)) && Number(settings.speed) !== expected.speed) return false;
  if (expected.pitch !== 0 && (!Number.isFinite(Number(settings.pitch)) || Number(settings.pitch) !== expected.pitch)) return false;
  if (Number.isFinite(Number(settings.pitch)) && Number(settings.pitch) !== expected.pitch) return false;
  if (Number.isFinite(Number(settings.vol)) && Number(settings.vol) !== volume) return false;
  return settings.split_by_line !== false && settings.enable_srt !== false;
}

async function findReusableHistoryBatch(lines, env, fetchImpl) {
  if (String(env.AIMAX_TTS_DISABLE_HISTORY_CACHE || "").trim() === "1") return null;

  try {
    const data = await requestJson("/api/v1/tts/history/?limit=20", env, fetchImpl);
    const text = batchText(lines);
    const items = Array.isArray(data.items) ? data.items : [];
    const match = items.find((item) => (
      String(item.status || "").toLowerCase() === "success"
      && String(item.text || "") === text
      && extractSegmentsUrl(item)
      && isSameHistorySettings(item, env)
    ));
    if (!match) return null;
    return {
      jobId: String(match.job_id || match.jobId || match.id || "").trim(),
      segmentsUrl: extractSegmentsUrl(match),
    };
  } catch {
    // History reuse is optional. A failed lookup must not block new synthesis.
    return null;
  }
}

async function createBatchJob(lines, env, fetchImpl) {
  const maxLines = positiveInteger(env.AIMAX_TTS_MAX_LINES, DEFAULT_MAX_LINES, 1, 200);
  if (lines.length > maxLines) {
    throw new Error(`AIMAX batch accepts at most ${maxLines} lines. This video has ${lines.length}.`);
  }

  const form = new FormData();
  const voiceId = await resolveVoiceId(env, fetchImpl);
  const settings = ttsSettings(env, voiceId);
  form.append("provider", settings.provider);
  form.append("voice_id", settings.voiceId);
  form.append("text", batchText(lines));
  form.append("speed", String(settings.speed));
  form.append("pitch", String(settings.pitch));
  form.append("vol", String(Number(env.AIMAX_TTS_VOLUME || 1)));
  form.append("model", settings.model);
  form.append("language", String(env.AIMAX_TTS_LANGUAGE || DEFAULT_LANGUAGE).trim());
  form.append("normalize", "true");
  form.append("enable_srt", "true");
  form.append("split_by_line", "true");
  form.append("match_srt_time", "false");

  const data = await requestJson("/api/v1/tts/generate", env, fetchImpl, {
    method: "POST",
    body: form,
  });
  const jobId = String(data.job_id || data.jobId || data.id || "").trim();
  const segmentsUrl = extractSegmentsUrl(data);
  if (!jobId && !segmentsUrl) {
    throw new Error(`AIMAX TTS did not return job_id/segments_url. Response: ${JSON.stringify(data)}`);
  }
  return { jobId, segmentsUrl, ...settings };
}

async function waitForSegments(jobId, env, fetchImpl, sleepImpl) {
  const pollIntervalMs = positiveInteger(
    env.AIMAX_TTS_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS,
    250,
    10000,
  );
  const maxPolls = positiveInteger(env.AIMAX_TTS_MAX_POLLS, DEFAULT_MAX_POLLS, 1, 3600);

  for (let index = 0; index < maxPolls; index += 1) {
    await sleepImpl(pollIntervalMs);
    const data = await requestJson(`/api/v1/tts/jobs/${encodeURIComponent(jobId)}`, env, fetchImpl);
    const status = String(data.status || "").toLowerCase();
    const segmentsUrl = extractSegmentsUrl(data);
    if (segmentsUrl) return { jobId, segmentsUrl };
    if (status === "failed" || status === "error") {
      throw new Error(`AIMAX TTS job failed: ${data.error_message || data.message || jobId}`);
    }
  }
  throw new Error(`Timeout waiting for AIMAX segments_url for job ${jobId}.`);
}

async function downloadBinary(assetUrl, outputPath, env, fetchImpl) {
  const url = /^https?:\/\//i.test(assetUrl) ? assetUrl : `${baseUrl(env)}${assetUrl}`;
  const response = await fetchImpl(url, {
    headers: { "X-API-Key": apiKey(env) },
  });
  if (!response.ok) {
    throw new Error(`AIMAX segments download failed (${response.status}): ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("AIMAX segments download returned an empty file.");
  await fsp.writeFile(outputPath, bytes);
}

function findZipEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) return offset;
  }
  throw new Error("AIMAX segments ZIP is invalid: missing end of central directory.");
}

function safeZipEntryRelativePath(entryName = "") {
  const normalized = String(entryName).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.endsWith("/")) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === ".." || part.includes(":"))) return "";
  return path.join(...parts);
}

async function extractZipToDirectory(zipPath, outputDir) {
  const root = path.resolve(outputDir);
  const buffer = await fsp.readFile(zipPath);
  const eocdOffset = findZipEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const extracted = [];
  let cursor = centralDirectoryOffset;

  await fsp.mkdir(root, { recursive: true });
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_FILE_SIGNATURE) {
      throw new Error("AIMAX segments ZIP is invalid: bad central directory entry.");
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const entryName = buffer.subarray(cursor + 46, cursor + 46 + fileNameLength).toString("utf8");
    cursor += 46 + fileNameLength + extraLength + commentLength;

    const relativePath = safeZipEntryRelativePath(entryName);
    if (!relativePath) continue;
    if (flags & 0x01) throw new Error(`AIMAX segments ZIP entry is encrypted: ${entryName}`);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new Error("AIMAX segments ZIP64 archives are not supported.");
    }
    if (buffer.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_SIGNATURE) {
      throw new Error(`AIMAX segments ZIP is invalid: bad local header for ${entryName}`);
    }

    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let content;
    if (method === 0) content = compressed;
    else if (method === 8) content = await inflateRawAsync(compressed);
    else throw new Error(`AIMAX segments ZIP uses unsupported compression method ${method}: ${entryName}`);

    const targetPath = path.resolve(root, relativePath);
    if (targetPath !== root && !targetPath.startsWith(`${root}${path.sep}`)) continue;
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.writeFile(targetPath, content);
    extracted.push(targetPath);
  }
  return extracted;
}

function findSegmentFiles(files, expectedCount) {
  const numbered = files
    .map((filePath) => {
      const match = path.basename(filePath).match(/^line_(\d+)\.mp3$/i);
      return match ? { lineNumber: Number(match[1]), filePath } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.lineNumber - right.lineNumber);

  if (numbered.length !== expectedCount) {
    throw new Error(`AIMAX returned ${numbered.length} line audio file(s), expected ${expectedCount}.`);
  }
  for (let index = 0; index < expectedCount; index += 1) {
    if (numbered[index]?.lineNumber !== index + 1) {
      throw new Error(`AIMAX segments ZIP is missing line_${String(index + 1).padStart(3, "0")}.mp3.`);
    }
  }
  return numbered;
}

function toolExecutable(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function numberFromEnv(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

export function resolveFfprobePath(env = loadAimaxEnv()) {
  const candidates = [
    env.FFPROBE_PATH,
    path.join(REPO_ROOT, "tools", "ffmpeg", "bin", toolExecutable("ffprobe")),
    "ffprobe",
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === "ffprobe" || fs.existsSync(candidate)) || "ffprobe";
}

export function resolveFfmpegPath(env = loadAimaxEnv()) {
  const candidates = [
    env.FFMPEG_PATH,
    path.join(REPO_ROOT, "tools", "ffmpeg", "bin", toolExecutable("ffmpeg")),
    "ffmpeg",
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === "ffmpeg" || fs.existsSync(candidate)) || "ffmpeg";
}

export async function trimVoiceSilence(filePath, env = loadAimaxEnv(), options = {}) {
  const parsedPath = path.parse(filePath);
  const trimmedPath = path.join(parsedPath.dir, `${parsedPath.name}.trimmed-${process.pid}-${Date.now()}${parsedPath.ext || ".mp3"}`);
  const logger = options.logger || console;
  const getDurationFn = options.getDurationFn || getDuration;
  const execFileFn = options.execFileFn || execFileAsync;
  const threshold = String(options.threshold || env.AIMAX_TTS_TRIM_THRESHOLD || DEFAULT_TRIM_THRESHOLD).trim();
  const keepSeconds = numberFromEnv(
    options.keepSeconds ?? env.AIMAX_TTS_TRIM_KEEP_SECONDS,
    DEFAULT_TRIM_KEEP_SECONDS,
    0.02,
    0.5,
  );
  const minDurationSeconds = numberFromEnv(
    options.minDurationSeconds ?? env.AIMAX_TTS_TRIM_MIN_DURATION_SECONDS,
    DEFAULT_TRIM_MIN_DURATION_SECONDS,
    0.1,
    60,
  );
  const minSavedSeconds = numberFromEnv(
    options.minSavedSeconds ?? env.AIMAX_TTS_TRIM_MIN_SAVED_SECONDS,
    DEFAULT_TRIM_MIN_SAVED_SECONDS,
    0,
    2,
  );
  let originalDuration = Number(options.originalDuration);
  try {
    if (!Number.isFinite(originalDuration) || originalDuration <= 0) {
      originalDuration = await getDurationFn(filePath, env);
    }
    await execFileFn(resolveFfmpegPath(env), [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      filePath,
      "-af",
      `silenceremove=start_periods=1:start_threshold=${threshold}:start_silence=${keepSeconds}:stop_periods=1:stop_threshold=${threshold}:stop_silence=${keepSeconds}`,
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      trimmedPath,
    ], { windowsHide: true });
    const trimmedDuration = await getDurationFn(trimmedPath, env);
    const savedSeconds = originalDuration - trimmedDuration;
    if (trimmedDuration >= minDurationSeconds && savedSeconds >= minSavedSeconds) {
      await fsp.copyFile(trimmedPath, filePath);
      return {
        trimmed: true,
        originalDuration,
        duration: trimmedDuration,
        savedSeconds,
      };
    }
    logger.warn?.(`Skipped silence trim for ${path.basename(filePath)}: output ${trimmedDuration.toFixed(3)}s, saved ${savedSeconds.toFixed(3)}s.`);
    return {
      trimmed: false,
      originalDuration,
      duration: originalDuration,
      savedSeconds: Math.max(0, savedSeconds),
      reason: "unsafe-output",
    };
  } catch (error) {
    // Keep the original segment if FFmpeg cannot safely trim this file.
    logger.warn?.(`Skipped silence trim for ${path.basename(filePath)}: ${error.message || error}`);
    return {
      trimmed: false,
      originalDuration: Number.isFinite(originalDuration) ? originalDuration : 0,
      duration: Number.isFinite(originalDuration) ? originalDuration : 0,
      savedSeconds: 0,
      reason: "trim-failed",
      error: error.message || String(error),
    };
  } finally {
    await fsp.rm(trimmedPath, { force: true });
  }
}

export async function getDuration(filePath, env = loadAimaxEnv()) {
  try {
    const { stdout } = await execFileAsync(resolveFfprobePath(env), [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const duration = parseFloat(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`Invalid duration: ${stdout.trim()}`);
    }
    return duration;
  } catch (error) {
    throw new Error(`Cannot read audio duration. Add FFPROBE_PATH or tools/ffmpeg/bin/ffprobe: ${error.message || error}`);
  }
}

function textHash(lines) {
  return crypto.createHash("sha256").update(displayBatchText(lines), "utf8").digest("hex");
}

function voiceTextHash(lines) {
  return crypto.createHash("sha256").update(batchText(lines), "utf8").digest("hex");
}

function trimOptionsForLine(line, getDurationFn) {
  const expanded = hasPronunciationExpansion(line.text, line.voiceText);
  return {
    getDurationFn,
    minDurationSeconds: minimumReadableDuration(line.text, { voiceText: line.voiceText }),
    ...(expanded ? { keepSeconds: 0.22 } : {}),
  };
}

export async function generateVoiceover({
  lines,
  root,
  env = loadAimaxEnv(),
  fetchImpl = fetch,
  sleepImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  getDurationFn = getDuration,
  trimVoiceSilenceFn = trimVoiceSilence,
} = {}) {
  const normalizedLines = normalizeLines(lines);
  const outDir = path.join(root, "assets", "vo");
  await fsp.mkdir(outDir, { recursive: true });
  const workDir = await fsp.mkdtemp(path.join(outDir, ".aimax-batch-"));
  const stageDir = path.join(workDir, "staged");
  const zipPath = path.join(workDir, "segments.zip");
  const segmentsDir = path.join(workDir, "segments");

  try {
    console.log(`Generating ${normalizedLines.length} AIMAX lines in one batch request...`);
    const reusable = await findReusableHistoryBatch(normalizedLines, env, fetchImpl);
    if (reusable) {
      console.log(`Reusing completed AIMAX job ${reusable.jobId} for identical narration.`);
    }
    const created = reusable || await createBatchJob(normalizedLines, env, fetchImpl);
    const completed = created.segmentsUrl
      ? created
      : await waitForSegments(created.jobId, env, fetchImpl, sleepImpl);
    await downloadBinary(completed.segmentsUrl, zipPath, env, fetchImpl);

    const extracted = await extractZipToDirectory(zipPath, segmentsDir);
    const segmentFiles = findSegmentFiles(extracted, normalizedLines.length);
    const durations = {};
    const outputs = [];
    await fsp.mkdir(stageDir, { recursive: true });

    for (let index = 0; index < normalizedLines.length; index += 1) {
      const line = normalizedLines[index];
      const stagedPath = path.join(stageDir, `${line.id}.mp3`);
      await fsp.copyFile(segmentFiles[index].filePath, stagedPath);
      if (shouldTrimSilence(env)) {
        await trimVoiceSilenceFn(stagedPath, env, trimOptionsForLine(line, getDurationFn));
      }
      durations[line.id] = Number((await getDurationFn(stagedPath, env)).toFixed(3));
      outputs.push({ id: line.id, file: `${line.id}.mp3`, duration: durations[line.id] });
    }

    const badBatchLines = unreadableDurationDetails(normalizedLines, durations);
    if (badBatchLines.length) {
      console.warn(`AIMAX batch returned ${badBatchLines.length} too-short line(s); retrying them one by one.`);
      const retryEnv = { ...env, AIMAX_TTS_DISABLE_HISTORY_CACHE: "1" };
      for (const badLine of badBatchLines) {
        const line = normalizedLines.find((item) => item.id === badLine.id);
        if (!line) continue;
        const retryDir = await fsp.mkdtemp(path.join(workDir, `retry-${line.id}-`));
        try {
          const retryZipPath = path.join(retryDir, "segments.zip");
          const retrySegmentsDir = path.join(retryDir, "segments");
          const retryJob = await createBatchJob([line], retryEnv, fetchImpl);
          const retryCompleted = retryJob.segmentsUrl
            ? retryJob
            : await waitForSegments(retryJob.jobId, retryEnv, fetchImpl, sleepImpl);
          await downloadBinary(retryCompleted.segmentsUrl, retryZipPath, retryEnv, fetchImpl);
          const retryExtracted = await extractZipToDirectory(retryZipPath, retrySegmentsDir);
          const [retrySegment] = findSegmentFiles(retryExtracted, 1);
          const stagedPath = path.join(stageDir, `${line.id}.mp3`);
          await fsp.copyFile(retrySegment.filePath, stagedPath);
          if (shouldTrimSilence(retryEnv)) {
            await trimVoiceSilenceFn(stagedPath, retryEnv, trimOptionsForLine(line, getDurationFn));
          }
          durations[line.id] = Number((await getDurationFn(stagedPath, retryEnv)).toFixed(3));
          const output = outputs.find((item) => item.id === line.id);
          if (output) output.duration = durations[line.id];
          console.log(`Retried ${line.id}: ${durations[line.id].toFixed(3)}s.`);
        } finally {
          await fsp.rm(retryDir, { recursive: true, force: true });
        }
      }
    }

    assertReadableDurations(normalizedLines, durations);

    for (const output of outputs) {
      await fsp.copyFile(path.join(stageDir, output.file), path.join(outDir, output.file));
    }
    await fsp.writeFile(path.join(outDir, "durations.json"), `${JSON.stringify(durations, null, 2)}\n`, "utf8");
    const settings = ttsSettings(env, created.voiceId);
    await fsp.writeFile(path.join(outDir, "aimax-batch.json"), `${JSON.stringify({
      mode: "aimax_segments_batch",
      jobId: completed.jobId || created.jobId || "",
      lineCount: normalizedLines.length,
      reusedHistory: Boolean(reusable),
      textHash: textHash(normalizedLines),
      voiceTextHash: voiceTextHash(normalizedLines),
      provider: settings.provider,
      model: settings.model,
      speed: settings.speed,
      pitch: settings.pitch,
      voiceId: settings.voiceId,
      pronunciations: normalizedLines
        .filter((line) => normalizeVoiceWhitespace(line.voiceText) !== normalizeVoiceWhitespace(line.text))
        .map((line) => ({ id: line.id, text: line.text, voiceText: line.voiceText })),
      outputs,
      generatedAt: new Date().toISOString(),
    }, null, 2)}\n`, "utf8");
    console.log(`Done. One AIMAX job returned ${outputs.length} line MP3 files.`);
    return { jobId: completed.jobId || created.jobId || "", durations, outputs, settings };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

export const __test = {
  batchText,
  extractZipToDirectory,
  findSegmentFiles,
  minimumReadableDuration,
  normalizeLines,
  voiceTextHash,
  shouldTrimSilence,
  trimVoiceSilence,
};
