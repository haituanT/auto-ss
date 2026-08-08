function optionalString(value) {
  return String(value || "").trim();
}

function validatedOptionalString(value, label, maxLength = 240) {
  const text = optionalString(value);
  if (text.length > maxLength || /[\r\n]/.test(text)) {
    throw new Error(`${label} is invalid.`);
  }
  return text;
}

function validatedBaseUrl(value) {
  const text = validatedOptionalString(value, "AIMAX base URL", 2048);
  if (!text) return "";
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("AIMAX base URL must be a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("AIMAX base URL must use http or https.");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function aimaxRuntimeEnv({ voiceId, speed, pitch, apiKey, baseUrl } = {}) {
  const env = {};
  const selectedVoice = optionalString(voiceId);
  const selectedApiKey = validatedOptionalString(apiKey, "AIMAX API key", 2048);
  const selectedBaseUrl = validatedBaseUrl(baseUrl);

  if (selectedVoice) {
    env.AIMAX_VOICE_ID = selectedVoice;
    env.AIMAX_TTS_VOICE_ID = selectedVoice;
  }

  if (selectedApiKey) env.AIMAX_API_KEY = selectedApiKey;
  if (selectedBaseUrl) env.AIMAX_BASE_URL = selectedBaseUrl;

  if (speed !== undefined && speed !== null && String(speed).trim() !== "") {
    const selectedSpeed = Number(speed);
    if (!Number.isFinite(selectedSpeed) || selectedSpeed < 0.5 || selectedSpeed > 2) {
      throw new Error("Tốc độ AIMAX phải nằm trong khoảng 0.5x đến 2.0x.");
    }
    env.AIMAX_TTS_SPEED = String(selectedSpeed);
  }

  if (pitch !== undefined && pitch !== null && String(pitch).trim() !== "") {
    const selectedPitch = Math.round(Number(pitch));
    if (!Number.isFinite(selectedPitch) || selectedPitch < -12 || selectedPitch > 12) {
      throw new Error("Cao độ AIMAX phải nằm trong khoảng -12 đến 12.");
    }
    env.AIMAX_TTS_PITCH = String(selectedPitch);
  }

  return env;
}
