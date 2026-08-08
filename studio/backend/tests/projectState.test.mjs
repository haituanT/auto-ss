import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultProjectConfig, normalizeProjectConfig } from "../services/projectConfig.mjs";
import { projectStatePath, syncProjectState } from "../services/projectState.mjs";
import { writeAudioManifest } from "../services/voiceTiming.mjs";

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-compare-state-"));
  fs.mkdirSync(path.join(root, "assets", "vo"), { recursive: true });
  return root;
}

test("project state records audio readiness from the generated manifest", () => {
  const root = tempProject();
  const config = normalizeProjectConfig(defaultProjectConfig({
    slug: "state-ready",
    content: "Same line",
  }), "state-ready");
  config.audio.voiceId = "voice-a";
  config.audio.speed = 1.1;
  config.audio.pitch = -1;
  fs.writeFileSync(path.join(root, "assets", "vo", "line-1.mp3"), "audio");
  const manifest = writeAudioManifest(root, config, {
    provider: "minimax",
    model: "speech-2.8-hd",
    voiceId: "voice-a",
    speed: 1.1,
    pitch: -1,
    durations: { "line-1": 1.2 },
    outputs: [{ id: "line-1", file: "line-1.mp3", duration: 1.2 }],
    source: "test",
  });

  const state = syncProjectState(root, config, { audioManifest: manifest });

  assert.equal(fs.existsSync(projectStatePath(root)), true);
  assert.equal(state.ready.audio, true);
  assert.equal(state.artifacts.audioManifest, "assets/vo/manifest.json");
  assert.equal(state.revisions.content, 1);
  assert.equal(state.revisions.audio, 1);
});

test("project state marks audio not ready when the selected voice changes", () => {
  const root = tempProject();
  const config = normalizeProjectConfig(defaultProjectConfig({
    slug: "state-dirty-audio",
    content: "Same line",
  }), "state-dirty-audio");
  config.audio.voiceId = "voice-a";
  config.audio.pitch = -1;
  fs.writeFileSync(path.join(root, "assets", "vo", "line-1.mp3"), "audio");
  const manifest = writeAudioManifest(root, config, {
    voiceId: "voice-a",
    speed: config.audio.speed,
    pitch: -1,
    durations: { "line-1": 1.2 },
    source: "test",
  });
  syncProjectState(root, config, { audioManifest: manifest });

  const changed = normalizeProjectConfig({
    ...config,
    audio: { ...config.audio, voiceId: "voice-b", pitch: 2 },
  }, "state-dirty-audio");
  const state = syncProjectState(root, changed, { audioManifest: manifest });

  assert.equal(state.ready.audio, false);
  assert.notEqual(state.hashes.audioSelection, "");
});
