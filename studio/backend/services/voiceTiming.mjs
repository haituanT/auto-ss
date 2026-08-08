import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  displayTextForLine,
  hasPronunciationExpansion,
  minimumReadableDuration,
  normalizeVoiceWhitespace,
  voiceTextForLine,
} from "../../../shared/ttsPronunciation.mjs";

const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus"];
const DEFAULT_VOICE_SPEED = 1;
const VOICE_SETTINGS_FILE = "voice-settings.json";
const AUDIO_MANIFEST_FILE = "manifest.json";
const DEFAULT_VOICE_PITCH = 0;
const ELEVENLABS_FORCED_ALIGNMENT_URL = "https://api.elevenlabs.io/v1/forced-alignment";
const ALIGNMENT_PROVIDERS = new Set(["none", "elevenlabs"]);

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function projectFile(root, value) {
  if (!value) return "";
  if (path.isAbsolute(value)) return value;
  return path.join(root, String(value).replace(/\//g, path.sep));
}

export function lineVoiceText(line) {
  return normalizeVoiceWhitespace(line?.tts || displayTextForLine(line));
}

export function normalizeAlignmentProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return ALIGNMENT_PROVIDERS.has(provider) ? provider : "none";
}

export function voiceTextHash(lines = []) {
  const text = (Array.isArray(lines) ? lines : [])
    .map(lineVoiceText)
    .join("\n");
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function readLegacyDurations(root) {
  return readJson(path.join(root, "assets", "vo", "durations.json"), {});
}

export function readAudioManifest(root) {
  return readJson(path.join(root, "assets", "vo", AUDIO_MANIFEST_FILE), null);
}

export function readDurations(root) {
  const manifest = readAudioManifest(root);
  if (manifest?.durations && typeof manifest.durations === "object") return manifest.durations;
  return readLegacyDurations(root);
}

export function readAimaxManifest(root) {
  return readJson(path.join(root, "assets", "vo", "aimax-batch.json"), null);
}

export function readVoiceSettingsLock(root) {
  return readJson(path.join(root, "assets", "vo", VOICE_SETTINGS_FILE), null);
}

function normalizedVoiceId(value) {
  return String(value || "").trim();
}

function normalizedSpeed(value) {
  const speed = Number(value);
  return Number.isFinite(speed) && speed > 0 ? speed : DEFAULT_VOICE_SPEED;
}

function normalizedPitch(value) {
  const pitch = Math.round(Number(value));
  return Number.isFinite(pitch) ? Math.max(-12, Math.min(12, pitch)) : DEFAULT_VOICE_PITCH;
}

export function voiceSettingsLockForConfig(config = {}, extra = {}) {
  const lines = Array.isArray(config.lines) ? config.lines : [];
  const audio = config.audio || {};
  return {
    version: 1,
    provider: String(extra.provider ?? audio.provider ?? "aimax").trim() || "aimax",
    model: String(extra.model ?? "").trim(),
    voiceId: normalizedVoiceId(extra.voiceId ?? audio.voiceId),
    speed: normalizedSpeed(extra.speed ?? audio.speed),
    pitch: normalizedPitch(extra.pitch ?? audio.pitch),
    textHash: voiceTextHash(lines),
    lineCount: lines.length,
    source: String(extra.source || "voice").trim() || "voice",
    generatedAt: String(extra.generatedAt || new Date().toISOString()),
  };
}

export function audioManifestForConfig(config = {}, extra = {}) {
  const lines = Array.isArray(config.lines) ? config.lines : [];
  const audio = config.audio || {};
  const durations = extra.durations && typeof extra.durations === "object" ? extra.durations : {};
  const outputs = Array.isArray(extra.outputs)
    ? extra.outputs
    : Object.entries(durations).map(([id, duration]) => ({ id, file: `${id}.mp3`, duration }));
  const mainAudio = String(extra.mainAudio ?? audio.mainAudio ?? "").trim();
  return {
    version: 1,
    kind: String(extra.kind || (mainAudio ? "full-upload" : "per-line-tts")).trim(),
    provider: String(extra.provider ?? audio.provider ?? "aimax").trim() || "aimax",
    model: String(extra.model ?? "").trim(),
    voiceId: normalizedVoiceId(extra.voiceId ?? audio.voiceId),
    speed: normalizedSpeed(extra.speed ?? audio.speed),
    pitch: normalizedPitch(extra.pitch ?? audio.pitch),
    textHash: String(extra.textHash || voiceTextHash(lines)),
    lineCount: Number.isFinite(Number(extra.lineCount)) ? Number(extra.lineCount) : lines.length,
    mainAudio,
    srt: String(extra.srt ?? audio.srt ?? "").trim(),
    durations,
    outputs,
    source: String(extra.source || "voice").trim() || "voice",
    generatedAt: String(extra.generatedAt || new Date().toISOString()),
  };
}

export function writeAudioManifest(root, config = {}, extra = {}) {
  const voDir = path.join(root, "assets", "vo");
  fs.mkdirSync(voDir, { recursive: true });
  const manifest = audioManifestForConfig(config, extra);
  fs.writeFileSync(path.join(voDir, AUDIO_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export function writeVoiceSettingsLock(root, config = {}, extra = {}) {
  const voDir = path.join(root, "assets", "vo");
  fs.mkdirSync(voDir, { recursive: true });
  const lock = voiceSettingsLockForConfig(config, extra);
  fs.writeFileSync(path.join(voDir, VOICE_SETTINGS_FILE), `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  return lock;
}

export function hasFullAudio(root, config) {
  const candidates = [
    projectFile(root, config.audio?.mainAudio),
    path.join(root, "assets", "vo", "full.mp3"),
    path.join(root, "assets", "vo", "full.wav"),
    path.join(root, "assets", "vo", "full.m4a"),
  ];
  return candidates.some((candidate) => candidate && fs.existsSync(candidate));
}

export function hasSrtTiming(root, config) {
  const srtPath = projectFile(root, config.audio?.srt);
  return Boolean(srtPath && fs.existsSync(srtPath) && config.subtitleSource === "srt");
}

export function lineAudioPath(root, lineId) {
  for (const extension of AUDIO_EXTENSIONS) {
    const candidate = path.join(root, "assets", "vo", `${lineId}${extension}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return "";
}

export function normalizeLineWords(words = [], { lineStartMs = 0, lineEndMs = Infinity } = {}) {
  const startOffset = Math.max(0, Math.round(Number(lineStartMs) || 0));
  const maxEnd = Number.isFinite(Number(lineEndMs)) ? Math.max(startOffset + 1, Math.round(Number(lineEndMs))) : Infinity;
  return (Array.isArray(words) ? words : [])
    .map((word) => {
      const text = String(word?.text || "").trim();
      const rawStartMs = Number.isFinite(Number(word?.startMs))
        ? Number(word.startMs)
        : startOffset + (Number(word?.start) || 0) * 1000;
      const rawEndMs = Number.isFinite(Number(word?.endMs))
        ? Number(word.endMs)
        : startOffset + (Number(word?.end) || 0) * 1000;
      const startMs = Math.max(startOffset, Math.round(rawStartMs));
      const endMs = Math.min(maxEnd, Math.max(startMs + 1, Math.round(rawEndMs)));
      return text && endMs > startMs ? { text, startMs, endMs } : null;
    })
    .filter(Boolean);
}

export function wordsFromElevenLabsAlignment(response = {}, options = {}) {
  return normalizeLineWords(response.words || [], options);
}

export async function fetchElevenLabsForcedAlignment({
  audioPath,
  text,
  apiKey = process.env.ELEVENLABS_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) throw new Error("Missing ELEVENLABS_API_KEY.");
  if (!audioPath || !fs.existsSync(audioPath)) throw new Error(`Missing audio file for alignment: ${audioPath || "empty"}`);
  if (!String(text || "").trim()) throw new Error("Missing text for alignment.");
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available for ElevenLabs alignment.");

  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(audioPath)]), path.basename(audioPath));
  form.append("text", String(text || ""));

  const response = await fetchImpl(ELEVENLABS_FORCED_ALIGNMENT_URL, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  const data = await response.json().catch(async () => ({ message: await response.text().catch(() => "") }));
  if (!response.ok) {
    throw new Error(data?.detail?.message || data?.message || data?.error || response.statusText || "ElevenLabs alignment failed.");
  }
  return data;
}

export async function alignProjectLinesWithElevenLabs(root, config = {}, {
  apiKey = process.env.ELEVENLABS_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) {
    return { config, alignedCount: 0, errors: ["Missing ELEVENLABS_API_KEY."] };
  }

  const errors = [];
  let alignedCount = 0;
  const nextLines = [];
  for (let index = 0; index < (config.lines || []).length; index += 1) {
    const line = config.lines[index];
    const id = String(line.id || `line-${index + 1}`);
    const audioPath = lineAudioPath(root, id);
    const text = voiceTextForLine(line);
    try {
      const alignment = await fetchElevenLabsForcedAlignment({ audioPath, text, apiKey, fetchImpl });
      const startMs = Math.max(0, Math.round((Number(line.start) || 0) * 1000));
      const endMs = startMs + Math.max(1, Math.round((Number(line.duration) || 0) * 1000));
      const words = wordsFromElevenLabsAlignment(alignment, { lineStartMs: startMs, lineEndMs: endMs });
      if (!words.length) throw new Error("Alignment returned no usable words.");
      alignedCount += 1;
      nextLines.push({ ...line, id, words });
    } catch (error) {
      errors.push(`${id}: ${error.message || String(error)}`);
      nextLines.push({ ...line, id });
    }
  }

  return {
    config: {
      ...config,
      lines: nextLines,
      audio: {
        ...(config.audio || {}),
        alignmentProvider: "elevenlabs",
      },
    },
    alignedCount,
    errors,
  };
}

export function shouldUseDurationTimeline(root, config, durations = readDurations(root)) {
  if (hasSrtTiming(root, config)) return false;
  const lines = Array.isArray(config.lines) ? config.lines : [];
  return lines.length > 0 && lines.every((line, index) => {
    const id = String(line.id || `line-${index + 1}`);
    const duration = Number(durations[id]);
    return Number.isFinite(duration) && duration > 0;
  });
}

function hasManifestField(manifest, key) {
  return Object.prototype.hasOwnProperty.call(manifest || {}, key)
    && manifest[key] !== undefined
    && manifest[key] !== null
    && String(manifest[key]).trim() !== "";
}

function sameNumericSetting(left, right) {
  const a = normalizedSpeed(left);
  const b = normalizedSpeed(right);
  return Math.abs(a - b) < 0.000001;
}

function pushVoiceSettingIssues(issues, settings, config) {
  if (hasManifestField(settings, "speed") && !sameNumericSetting(settings.speed, config.audio?.speed)) {
    issues.push("Tốc độ voice hiện tại khác audio đã tạo. Cần tạo lại âm thanh để sub khớp voice.");
  }
  if (hasManifestField(settings, "pitch") && Math.abs(normalizedPitch(settings.pitch) - normalizedPitch(config.audio?.pitch)) >= 0.000001) {
    issues.push("Cao độ voice hiện tại khác audio đã tạo. Cần tạo lại âm thanh để sub khớp voice.");
  }
  if (hasManifestField(settings, "voiceId") && normalizedVoiceId(settings.voiceId) !== normalizedVoiceId(config.audio?.voiceId)) {
    issues.push("Voice hiện tại khác audio đã tạo. Cần tạo lại âm thanh để sub khớp voice.");
  }
  if (settings?.textHash) {
    const currentHash = voiceTextHash(config.lines || []);
    if (settings.textHash !== currentHash) {
      issues.push("Text hiện tại khác với audio đã tạo. Cần tạo lại âm thanh để sub khớp voice.");
    }
  }
  if (Number.isFinite(Number(settings?.lineCount)) && Number(settings.lineCount) !== (config.lines || []).length) {
    issues.push(`Số dòng hiện tại (${(config.lines || []).length}) khác số dòng voice đã tạo (${settings.lineCount}). Cần tạo lại âm thanh.`);
  }
}

export function voiceSyncIssues(root, config, { durations: providedDurations = null } = {}) {
  const lines = Array.isArray(config.lines) ? config.lines : [];
  const issues = [];
  const audioManifest = readAudioManifest(root);
  const manifest = audioManifest || readAimaxManifest(root);
  const settingsLock = audioManifest ? null : readVoiceSettingsLock(root);
  pushVoiceSettingIssues(issues, manifest, config);
  pushVoiceSettingIssues(issues, settingsLock, config);

  const dirtyLines = lines
    .map((line, index) => (line?.dirtyVoice ? {
      number: index + 1,
      reason: String(line.dirtyVoiceReason || "").trim(),
    } : null))
    .filter(Boolean);
  if (dirtyLines.length) {
    const settingIssueExists = issues.some((issue) => /Tốc độ voice|Cao độ voice|Voice hiện tại|Text hiện tại|Số dòng hiện tại/.test(issue));
    const contentDirtyLines = dirtyLines.filter((line) => !line.reason || line.reason === "content");
    if (contentDirtyLines.length) {
      issues.push(`Voice cũ không khớp text mới ở dòng ${contentDirtyLines.map((line) => line.number).join(", ")}. Hãy bấm Tạo âm thanh lại trước khi render.`);
    } else if (!settingIssueExists) {
      issues.push(`Có dòng cần tạo lại âm thanh: ${dirtyLines.map((line) => line.number).join(", ")}.`);
    }
  }

  const usingFullAudio = hasFullAudio(root, config);
  const missingLegacySpeed = !hasManifestField(manifest, "speed") && normalizedSpeed(config.audio?.speed) !== DEFAULT_VOICE_SPEED;
  const missingLegacyPitch = !hasManifestField(manifest, "pitch") && normalizedPitch(config.audio?.pitch) !== DEFAULT_VOICE_PITCH;
  if (!usingFullAudio && !audioManifest && manifest && !settingsLock && (missingLegacySpeed || missingLegacyPitch)) {
    issues.push(missingLegacySpeed && missingLegacyPitch
      ? "Batch AIMAX cũ chưa ghi đủ cài đặt voice. Hãy tạo lại âm thanh sau khi đổi tốc độ/cao độ để khóa timing mới."
      : missingLegacyPitch
        ? "Batch AIMAX cũ chưa ghi cao độ voice. Hãy tạo lại âm thanh sau khi đổi cao độ để khóa timing mới."
        : "Batch AIMAX cũ chưa ghi tốc độ voice. Hãy tạo lại âm thanh sau khi đổi speed để khóa timing mới.");
  }

  const durations = providedDurations || readDurations(root);
  if (!usingFullAudio) {
    const missing = [];
    for (let index = 0; index < lines.length; index += 1) {
      const id = String(lines[index].id || `line-${index + 1}`);
      const duration = Number(durations[id]);
      if (!Number.isFinite(duration) || duration <= 0 || !lineAudioPath(root, id)) missing.push(index + 1);
    }
    if (missing.length) {
      issues.push(`Thiếu audio/timing cho dòng ${missing.join(", ")}. Hãy tạo lại âm thanh.`);
    }
  }

  const tooFast = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const id = String(line.id || `line-${index + 1}`);
    const duration = Number(durations[id] ?? line.duration);
    if (!Number.isFinite(duration) || duration <= 0) continue;
    const text = displayTextForLine(line);
    const voiceText = voiceTextForLine(line);
    const letters = [...text.replace(/[^\p{L}\p{N}]+/gu, "")].length;
    const minimum = minimumReadableDuration(text, { voiceText });
    const qualityRisk = letters >= 50 || hasPronunciationExpansion(text, voiceText);
    if (qualityRisk && duration + 0.08 < minimum) {
      tooFast.push(`${index + 1} (${duration.toFixed(2)}s/${letters} ky tu)`);
    }
  }
  if (tooFast.length) {
    issues.push(`Voice quá ngắn so với text ở dòng ${tooFast.join(", ")}. Hãy tạo lại âm thanh; app sẽ tự tách dòng dài để sub không bắn quá nhanh.`);
  }

  return [...new Set(issues)];
}

export function captionSpeedWarnings(lines = []) {
  const warnings = [];
  for (const line of lines) {
    const durationSeconds = Math.max(0.001, Number(line.durationMs || 0) / 1000);
    const text = lineVoiceText(line);
    const letters = [...text.replace(/[^\p{L}\p{N}]+/gu, "")].length;
    const words = text.split(/\s+/).filter(Boolean).length;
    const charsPerSecond = letters / durationSeconds;
    const wordsPerSecond = words / durationSeconds;
    if (letters >= 80 && (charsPerSecond > 30 || wordsPerSecond > 5.2)) {
      warnings.push(`Dòng ${line.id} đang quá dài so với audio (${charsPerSecond.toFixed(1)} ký tự/s). Nên tách dòng hoặc tạo lại VO tốc độ chậm hơn.`);
    }
  }
  return warnings;
}
