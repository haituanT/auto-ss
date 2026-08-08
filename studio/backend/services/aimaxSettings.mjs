import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../paths.mjs";
import { loadAimaxEnv } from "../../../scripts/aimax-tts.mjs";

const ENV_PATH = path.join(REPO_ROOT, ".env");
const DEFAULTS = {
  baseUrl: "https://aimaxstudio.com",
  provider: "minimax",
  model: "speech-2.8-hd",
  language: "Vietnamese",
  speed: 1.1,
  volume: 1,
};

function stringValue(value, fallback, label, maxLength = 240) {
  const text = String(value ?? fallback).trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maxLength || /[\r\n]/.test(text)) {
    throw new Error(`${label} is invalid.`);
  }
  return text;
}

function optionalString(value, label, maxLength = 240) {
  const text = String(value ?? "").trim();
  if (text.length > maxLength || /[\r\n]/.test(text)) {
    throw new Error(`${label} is invalid.`);
  }
  return text;
}

function numberValue(value, fallback, label, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return Number(number.toFixed(2));
}

function configuredVoice(env) {
  return String(
    env.AIMAX_VOICE_ID
    || env.AIMAX_TTS_VOICE_ID
    || env.TTS_VOICE_NAME
    || env.AIMAX_VOICE_NAME
    || "",
  ).trim();
}

export function publicAimaxSettings(env = loadAimaxEnv()) {
  return {
    apiKeyConfigured: Boolean(String(env.AIMAX_API_KEY || "").trim()),
    baseUrl: String(env.AIMAX_BASE_URL || DEFAULTS.baseUrl).trim(),
    provider: String(env.AIMAX_TTS_PROVIDER || DEFAULTS.provider).trim().toLowerCase(),
    model: String(env.AIMAX_TTS_MODEL || DEFAULTS.model).trim(),
    voiceId: configuredVoice(env),
    language: String(env.AIMAX_TTS_LANGUAGE || DEFAULTS.language).trim(),
    speed: numberValue(env.AIMAX_TTS_SPEED || env.AIMAX_SPEED, DEFAULTS.speed, "Speed", 0.5, 2),
    volume: numberValue(env.AIMAX_TTS_VOLUME, DEFAULTS.volume, "Volume", 0, 2),
    batchMode: "split_by_line",
  };
}

export function updateEnvFile(envPath, updates) {
  const raw = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const updateKeys = new Set(Object.keys(updates));
  const found = new Set();
  const lines = raw ? raw.split(/\r?\n/) : [];
  if (lines.at(-1) === "") lines.pop();

  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || !updateKeys.has(match[1])) return line;
    found.add(match[1]);
    return `${match[1]}=${updates[match[1]]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!found.has(key)) nextLines.push(`${key}=${value}`);
  }

  fs.writeFileSync(envPath, `${nextLines.join(newline)}${newline}`, "utf8");
}

export function getAimaxSettings() {
  return publicAimaxSettings();
}

export function saveAimaxSettings(input = {}) {
  const current = publicAimaxSettings();
  const baseUrl = stringValue(input.baseUrl, current.baseUrl, "AIMAX Base URL");
  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error("AIMAX Base URL must be a valid URL.");
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("AIMAX Base URL must use http or https.");
  }

  const provider = stringValue(input.provider, current.provider, "AIMAX provider", 80).toLowerCase();
  const model = stringValue(input.model, current.model, "AIMAX model", 160);
  const language = stringValue(input.language, current.language, "Language", 80);
  const voiceId = optionalString(input.voiceId ?? current.voiceId, "Voice ID", 200);
  const hasApiKey = Object.prototype.hasOwnProperty.call(input, "apiKey");
  const apiKey = hasApiKey ? optionalString(input.apiKey, "AIMAX API key", 2048) : "";
  const speed = numberValue(input.speed, current.speed, "Speed", 0.5, 2);
  const volume = numberValue(input.volume, current.volume, "Volume", 0, 2);

  const updates = {
    AIMAX_BASE_URL: parsedUrl.toString().replace(/\/$/, ""),
    AIMAX_TTS_PROVIDER: provider,
    AIMAX_TTS_MODEL: model,
    AIMAX_TTS_LANGUAGE: language,
    AIMAX_TTS_SPEED: String(speed),
    AIMAX_TTS_VOLUME: String(volume),
    AIMAX_VOICE_ID: voiceId,
    AIMAX_TTS_VOICE_ID: voiceId,
  };
  if (hasApiKey) updates.AIMAX_API_KEY = apiKey;

  updateEnvFile(ENV_PATH, updates);
  return publicAimaxSettings();
}
