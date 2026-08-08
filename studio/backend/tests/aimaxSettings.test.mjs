import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { updateEnvFile } from "../services/aimaxSettings.mjs";

test("AIMAX settings preserve unrelated .env entries and replace matching keys", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aimax-settings-"));
  const envPath = path.join(dir, ".env");
  fs.writeFileSync(envPath, "KEEP_ME=yes\nAIMAX_TTS_MODEL=old-model\n", "utf8");

  updateEnvFile(envPath, {
    AIMAX_API_KEY: "aimax-key",
    AIMAX_TTS_MODEL: "speech-2.8-hd",
    AIMAX_VOICE_ID: "voice-123",
  });

  assert.equal(
    fs.readFileSync(envPath, "utf8"),
    "KEEP_ME=yes\nAIMAX_TTS_MODEL=speech-2.8-hd\nAIMAX_API_KEY=aimax-key\nAIMAX_VOICE_ID=voice-123\n",
  );
});
