import fs from "node:fs";
import path from "node:path";
import { VIDEOS_DIR } from "../studio/backend/paths.mjs";
import { normalizeProjectConfig } from "../studio/backend/services/projectConfig.mjs";
import { syncProjectState } from "../studio/backend/services/projectState.mjs";
import {
  readAimaxManifest,
  readAudioManifest,
  readDurations,
  readVoiceSettingsLock,
  writeAudioManifest,
} from "../studio/backend/services/voiceTiming.mjs";

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function legacyOutputsFromDurations(durations = {}) {
  return Object.entries(durations || {}).map(([id, duration]) => ({
    id,
    file: `${id}.mp3`,
    duration,
  }));
}

function migrateProject(slug) {
  const root = path.join(VIDEOS_DIR, slug);
  const configPath = path.join(root, "video.json");
  const rawConfig = readJson(configPath, null);
  if (!rawConfig) return { slug, skipped: "missing video.json" };

  const config = normalizeProjectConfig(rawConfig, slug);
  let audioManifest = readAudioManifest(root);
  const durations = readDurations(root);

  if (!audioManifest) {
    const aimaxManifest = readAimaxManifest(root) || {};
    const settingsLock = readVoiceSettingsLock(root) || {};
    const hasAudioMetadata = Boolean(
      Object.keys(durations || {}).length
      || aimaxManifest.textHash
      || settingsLock.textHash
      || config.audio?.mainAudio,
    );
    if (hasAudioMetadata) {
      const legacy = { ...settingsLock, ...aimaxManifest };
      audioManifest = writeAudioManifest(root, config, {
        ...legacy,
        kind: config.audio?.mainAudio ? "full-upload" : (legacy.mode === "sample_audio" ? "sample-audio" : "per-line-tts"),
        durations,
        outputs: Array.isArray(legacy.outputs) ? legacy.outputs : legacyOutputsFromDurations(durations),
        mainAudio: config.audio?.mainAudio || legacy.mainAudio || "",
        srt: config.audio?.srt || legacy.srt || "",
        source: "migration",
      });
    }
  }

  const state = syncProjectState(root, config, { audioManifest });
  return {
    slug,
    audioManifest: Boolean(audioManifest),
    state: true,
    audioReady: state.ready.audio,
    previewReady: state.ready.preview,
    renderReady: state.ready.render,
  };
}

const results = fs.existsSync(VIDEOS_DIR)
  ? fs.readdirSync(VIDEOS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => migrateProject(entry.name))
  : [];

for (const result of results) {
  console.log(JSON.stringify(result));
}
