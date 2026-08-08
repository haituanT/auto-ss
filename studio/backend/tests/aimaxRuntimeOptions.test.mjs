import assert from "node:assert/strict";
import test from "node:test";
import { aimaxRuntimeEnv } from "../services/aimaxRuntimeOptions.mjs";

test("AIMAX runtime options pass a per-job voice and speed override", () => {
  assert.deepEqual(aimaxRuntimeEnv({ voiceId: "voice-123", speed: "1.2", pitch: "-1" }), {
    AIMAX_VOICE_ID: "voice-123",
    AIMAX_TTS_VOICE_ID: "voice-123",
    AIMAX_TTS_SPEED: "1.2",
    AIMAX_TTS_PITCH: "-1",
  });
});

test("AIMAX runtime options reject an invalid per-job speed", () => {
  assert.throws(() => aimaxRuntimeEnv({ speed: "2.5" }), /0.5x đến 2.0x/);
});

test("AIMAX runtime options reject an invalid per-job pitch", () => {
  assert.throws(() => aimaxRuntimeEnv({ pitch: "13" }), /-12 đến 12/);
});

test("AIMAX runtime options accept a temporary key and base URL override", () => {
  assert.deepEqual(aimaxRuntimeEnv({
    apiKey: "temporary-key",
    baseUrl: "https://example.test/",
  }), {
    AIMAX_API_KEY: "temporary-key",
    AIMAX_BASE_URL: "https://example.test",
  });
});

test("AIMAX runtime options reject multiline temporary keys", () => {
  assert.throws(() => aimaxRuntimeEnv({ apiKey: "temporary\nkey" }), /AIMAX API key is invalid/);
});
