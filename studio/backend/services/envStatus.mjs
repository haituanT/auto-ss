import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG_PATH, FFPROBE_PATH, REPO_ROOT } from "../paths.mjs";
import { loadAimaxEnv } from "../../../scripts/aimax-tts.mjs";
import { APP_VERSION } from "../../../shared/appVersion.mjs";
import { badRequest } from "./httpErrors.mjs";
import { aimaxRuntimeEnv } from "./aimaxRuntimeOptions.mjs";

const execFileAsync = promisify(execFile);
const RENDER_CONCURRENCY = process.env.REMOTION_CONCURRENCY || "50%";
const RENDER_HARDWARE_ACCELERATION = process.env.REMOTION_HARDWARE_ACCELERATION || "if-possible";
const RENDER_VIDEO_BITRATE = process.env.REMOTION_VIDEO_BITRATE || "8M";

async function commandVersion(command, args = ["--version"]) {
  try {
    const { stdout } = await execFileAsync(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 });
    return { ok: true, version: stdout.split(/\r?\n/)[0] || "ok" };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function commandText(command, args = [], maxBuffer = 1024 * 1024) {
  try {
    const { stdout } = await execFileAsync(command, args, { windowsHide: true, maxBuffer });
    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, error: error.message, stdout: error.stdout || "" };
  }
}

function remotionBundledFfmpegPath() {
  if (process.platform !== "win32") return "";
  return path.join(REPO_ROOT, "node_modules", "@remotion", "compositor-win32-x64-msvc", "ffmpeg.exe");
}

async function getNvidiaStatus() {
  const result = await commandText("nvidia-smi", [
    "--query-gpu=name,driver_version,memory.total",
    "--format=csv,noheader,nounits",
  ]);
  if (!result.ok) return { ok: false, error: result.error };
  const [name = "", driverVersion = "", memoryTotalMb = ""] = result.stdout.split(/\r?\n/)[0]?.split(",").map((part) => part.trim()) || [];
  return {
    ok: Boolean(name),
    name,
    driverVersion,
    memoryTotalMb: Number(memoryTotalMb) || 0,
  };
}

async function getBundledNvencStatus(ffmpegPath) {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) return { ok: false, path: ffmpegPath, error: "Remotion bundled FFmpeg not found" };
  const result = await commandText(ffmpegPath, ["-hide_banner", "-encoders"], 2 * 1024 * 1024);
  const h264 = /\bh264_nvenc\b/.test(result.stdout);
  const hevc = /\bhevc_nvenc\b/.test(result.stdout);
  return {
    ok: result.ok && h264,
    path: ffmpegPath,
    h264,
    hevc,
    error: result.ok ? "" : result.error,
  };
}

function trimSlashes(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function aimaxBaseUrl(env) {
  return trimSlashes(env.AIMAX_BASE_URL || "https://aimaxstudio.com");
}

function aimaxVoiceId(env) {
  return String(env.AIMAX_VOICE_ID || env.AIMAX_TTS_VOICE_ID || env.TTS_VOICE_NAME || env.AIMAX_VOICE_NAME || "").trim();
}

function normalizeVoice(voice) {
  const id = String(voice.voice_id || voice.id || voice.name || "").trim();
  if (!id) return null;
  return {
    id,
    name: String(voice.name || voice.display_name || voice.voice_name || id).trim(),
    provider: String(voice.provider || voice.source || "").trim(),
  };
}

function hideKey(value, key) {
  const text = String(value || "");
  const secret = String(key || "").trim();
  return secret ? text.split(secret).join("[redacted]") : text;
}

async function listAimaxVoicesFromEnv(env) {
  const configured = aimaxVoiceId(env);
  if (!env.AIMAX_API_KEY) {
    return { ok: false, defaultVoice: configured, voices: [], error: "Missing AIMAX_API_KEY" };
  }

  try {
    const response = await fetch(`${aimaxBaseUrl(env)}/api/v1/voices/my`, {
      headers: { "X-API-Key": env.AIMAX_API_KEY },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        defaultVoice: configured,
        voices: configured ? [{ id: configured, name: configured, provider: "env" }] : [],
        error: hideKey(data.error_message || data.message || response.statusText, env.AIMAX_API_KEY),
      };
    }
    const voices = (Array.isArray(data.voices) ? data.voices : [])
      .map(normalizeVoice)
      .filter(Boolean);
    return {
      ok: true,
      defaultVoice: configured || voices[0]?.id || "",
      voices,
    };
  } catch (error) {
    return {
      ok: false,
      defaultVoice: configured,
      voices: configured ? [{ id: configured, name: configured, provider: "env" }] : [],
      error: hideKey(error.message || String(error), env.AIMAX_API_KEY),
    };
  }
}

export async function listAimaxVoices() {
  return listAimaxVoicesFromEnv(loadAimaxEnv());
}

export async function testAimaxVoices({ apiKey, baseUrl, voiceId } = {}) {
  const suppliedKey = String(apiKey || "").trim();
  if (!suppliedKey) throw badRequest("AIMAX API key is required.", { field: "apiKey" });
  const env = {
    ...loadAimaxEnv(),
    ...aimaxRuntimeEnv({ apiKey: suppliedKey, baseUrl, voiceId }),
  };
  return listAimaxVoicesFromEnv(env);
}

export async function getStatus() {
  const env = loadAimaxEnv();
  const voiceId = aimaxVoiceId(env);
  const node = { ok: true, version: process.version };
  const ffmpeg = await commandVersion(FFMPEG_PATH, ["-version"]);
  const ffprobe = await commandVersion(FFPROBE_PATH, ["-version"]);
  const remotionCli = path.join(REPO_ROOT, "node_modules", "@remotion", "cli", "remotion-cli.js");
  const bundledFfmpeg = remotionBundledFfmpegPath();
  const [gpu, nvenc] = await Promise.all([
    getNvidiaStatus(),
    getBundledNvencStatus(bundledFfmpeg),
  ]);

  return {
    version: APP_VERSION,
    repoRoot: REPO_ROOT,
    toolsRoot: path.dirname(FFMPEG_PATH),
    node,
    aimax: {
      ok: Boolean(env.AIMAX_API_KEY),
      baseUrl: env.AIMAX_BASE_URL || "https://aimaxstudio.com",
      provider: env.AIMAX_TTS_PROVIDER || "minimax",
      model: env.AIMAX_TTS_MODEL || "speech-2.8-hd",
      voiceConfigured: Boolean(voiceId),
      voiceId,
    },
    ffmpeg: { ...ffmpeg, path: FFMPEG_PATH },
    ffprobe: { ...ffprobe, path: FFPROBE_PATH },
    remotion: {
      ok: fs.existsSync(remotionCli),
      path: remotionCli,
      version: fs.existsSync(remotionCli) ? "installed" : "",
    },
    render: {
      engine: "remotion",
      concurrency: RENDER_CONCURRENCY,
      hardwareAcceleration: RENDER_HARDWARE_ACCELERATION,
      videoBitrate: RENDER_VIDEO_BITRATE,
      ffmpegMode: "remotion-bundled",
      gpu,
      nvenc,
      gpuReady: Boolean(gpu.ok && nvenc.ok),
    },
  };
}
