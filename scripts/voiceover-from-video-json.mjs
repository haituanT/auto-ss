import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { generateVoiceover, getDuration, loadAimaxEnv, minimumReadableDuration, trimVoiceSilence } from "./aimax-tts.mjs";
import { contentByCompareSetFromLines, TIMELINE_START_SECONDS, lineGapAfterSeconds } from "../studio/backend/services/linePlanner.mjs";
import { contentHash } from "../studio/backend/services/projectConfig.mjs";
import { syncProjectState } from "../studio/backend/services/projectState.mjs";
import { alignProjectLinesWithElevenLabs, normalizeAlignmentProvider, writeAudioManifest, writeVoiceSettingsLock } from "../studio/backend/services/voiceTiming.mjs";
import { displayTextForLine, explicitTtsForLine, voiceTextForLine } from "../shared/ttsPronunciation.mjs";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeLine(line, index) {
  const id = String(line.id || `line-${index + 1}`);
  const text = displayTextForLine(line);
  const tts = explicitTtsForLine(line);
  if (!text) {
    throw new Error(`Missing TTS text for ${id} in video.json`);
  }
  return { id, text, ...(tts ? { tts } : {}) };
}

function assertCommittedContent(config) {
  const officialSections = contentByCompareSetFromLines(config.lines || []);
  const officialHash = config.contentOfficial?.hash || contentHash(officialSections);
  const draftComparable = config.contentDraft?.sections || config.contentDraft?.text;
  if (draftComparable && contentHash(draftComparable) !== officialHash) {
    throw new Error("Bản nháp chưa lưu chính thức. Bấm Lưu content chính thức trước khi tạo âm thanh.");
  }
}

function pipelineAfterVoiceReady(config = {}) {
  const pipeline = config.pipeline || {};
  const dirty = {
    content: false,
    audio: false,
    assets: true,
    style: Boolean(pipeline.dirty?.style),
    layout: Boolean(pipeline.dirty?.layout),
    render: true,
  };
  const dirtyReasons = [
    ...new Set([
      ...(pipeline.dirtyReasons || []).filter((reason) => !["content", "audio"].includes(reason)),
      "assets",
      "render",
    ]),
  ];
  return {
    ...config,
    pipeline: {
      dirty,
      dirtyReasons,
      officialSnapshot: {
        propsHash: String(pipeline.officialSnapshot?.propsHash || ""),
        assetManifestHash: String(pipeline.officialSnapshot?.assetManifestHash || ""),
        createdAt: String(pipeline.officialSnapshot?.createdAt || ""),
      },
    },
  };
}

function twoDigits(value) {
  return String(value).padStart(2, "0");
}

function threeDigits(value) {
  return String(value).padStart(3, "0");
}

function srtTimestamp(seconds) {
  const safe = Math.max(0, Math.round(Number(seconds) * 1000));
  const hours = Math.floor(safe / 3600000);
  const minutes = Math.floor((safe % 3600000) / 60000);
  const secs = Math.floor((safe % 60000) / 1000);
  const millis = safe % 1000;
  return `${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(secs)},${threeDigits(millis)}`;
}

function poseTag(pose) {
  if (pose === "point-left") return "L";
  if (pose === "point-right") return "R";
  return "Q";
}

function voiceTextHash(lines = []) {
  return crypto.createHash("sha256").update(lines.map((line) => line.text).join("\n"), "utf8").digest("hex");
}

function voiceSettingsPatch(settings = {}) {
  const patch = {};
  const voiceId = String(settings.voiceId || "").trim();
  const speed = Number(settings.speed);
  const pitch = Number(settings.pitch);
  if (voiceId) patch.voiceId = voiceId;
  if (Number.isFinite(speed) && speed > 0) patch.speed = speed;
  if (Number.isFinite(pitch)) patch.pitch = Math.round(Math.max(-12, Math.min(12, pitch)));
  return patch;
}

export function rewriteVoiceTimingsForVideo(root, durations, config = null, generatedVoiceSettings = {}) {
  const sourceConfig = config || readJson(path.join(root, "video.json"));
  let cursor = TIMELINE_START_SECONDS;
  const lines = (sourceConfig.lines || []).map((line, index) => {
    const lineWithoutWords = { ...(line || {}) };
    delete lineWithoutWords.words;
    delete lineWithoutWords.dirtyVoiceReason;
    const id = String(line.id || `line-${index + 1}`);
    const duration = Number(durations[id]) || Number(line.duration) || 2.2;
    const start = Number(cursor.toFixed(3));
    cursor += duration + lineGapAfterSeconds(index);
    return {
      ...lineWithoutWords,
      id,
      start,
      duration: Number(duration.toFixed(3)),
      dirtyVoice: false,
    };
  });

  const srt = `${lines.map((line, index) => [
    String(index + 1),
    `${srtTimestamp(line.start)} --> ${srtTimestamp(line.start + line.duration)}`,
    `[${poseTag(line.pose)}] ${line.text || line.caption || line.tts || ""}`,
  ].join("\n")).join("\n\n")}\n`;

  const srtPath = path.join(root, "assets", "vo", "audio.srt");
  fs.mkdirSync(path.dirname(srtPath), { recursive: true });
  fs.writeFileSync(srtPath, srt, "utf8");

  const nextConfig = {
    ...sourceConfig,
    lines,
    audio: {
      ...(sourceConfig.audio || {}),
      provider: sourceConfig.audio?.provider || "aimax",
      ...voiceSettingsPatch(generatedVoiceSettings),
      srt: "assets/vo/audio.srt",
    },
  };
  const savedConfig = pipelineAfterVoiceReady(nextConfig);
  fs.writeFileSync(path.join(root, "video.json"), `${JSON.stringify(savedConfig, null, 2)}\n`, "utf8");
  writeVoiceSettingsLock(root, savedConfig, {
    ...generatedVoiceSettings,
    source: "rewrite-voice-timings",
  });
  const audioManifest = writeAudioManifest(root, savedConfig, {
    ...generatedVoiceSettings,
    durations,
    source: "rewrite-voice-timings",
  });
  syncProjectState(root, savedConfig, { audioManifest });
  return savedConfig;
}

async function applyConfiguredAlignment(root, config) {
  if (normalizeAlignmentProvider(config.audio?.alignmentProvider) !== "elevenlabs") return config;
  const result = await alignProjectLinesWithElevenLabs(root, config);
  if (result.alignedCount > 0) {
    const nextConfig = pipelineAfterVoiceReady(result.config);
    fs.writeFileSync(path.join(root, "video.json"), `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
    syncProjectState(root, nextConfig);
    console.log(`ElevenLabs alignment: aligned ${result.alignedCount}/${nextConfig.lines.length} line(s).`);
    if (result.errors.length) console.warn(`ElevenLabs alignment fallback for: ${result.errors.join("; ")}`);
    return nextConfig;
  }
  if (result.errors.length) console.warn(`ElevenLabs alignment skipped: ${result.errors.join("; ")}`);
  return config;
}

async function generateFromSampleAudio({ lines, root, sampleAudioPath }) {
  if (!fs.existsSync(sampleAudioPath)) {
    throw new Error(`Sample audio not found: ${sampleAudioPath}`);
  }

  const outDir = path.join(root, "assets", "vo");
  fs.mkdirSync(outDir, { recursive: true });
  const durations = {};
  const env = loadAimaxEnv();

  for (const line of lines) {
    const outPath = path.join(outDir, `${line.id}.mp3`);
    fs.copyFileSync(sampleAudioPath, outPath);
    durations[line.id] = await getDuration(outPath, env);
    console.log(`Copied sample audio for ${line.id}: ${durations[line.id].toFixed(2)}s`);
  }

  fs.writeFileSync(
    path.join(outDir, "durations.json"),
    JSON.stringify(durations, null, 2),
  );
  fs.writeFileSync(path.join(outDir, "aimax-batch.json"), `${JSON.stringify({
    mode: "sample_audio",
    lineCount: lines.length,
    textHash: voiceTextHash(lines),
    provider: "sample",
    outputs: lines.map((line) => ({ id: line.id, file: `${line.id}.mp3`, duration: durations[line.id] })),
    generatedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  console.log("Done. Sample durations written to assets/vo/durations.json");
  return { durations, outputs: lines.map((line) => ({ id: line.id, file: `${line.id}.mp3`, duration: durations[line.id] })) };
}

export async function generateVoiceoverForVideo(root) {
  const configPath = path.join(root, "video.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing video.json in ${root}`);
  }

  const rawConfig = readJson(configPath);
  assertCommittedContent(rawConfig);
  const lines = (rawConfig.lines || []).map(normalizeLine);
  if (!lines.length) {
    throw new Error("video.json must contain at least one line.");
  }

  const sampleAudioPath = process.env.SAMPLE_AUDIO_PATH
    || (process.env.USE_SAMPLE_AUDIO === "1"
      ? path.resolve(root, "..", "..", "shared-assets", "sample-voice.mp3")
      : "");

  if (sampleAudioPath) {
    const result = await generateFromSampleAudio({ lines, root, sampleAudioPath });
    const durations = readJson(path.join(root, "assets", "vo", "durations.json"));
    const savedConfig = rewriteVoiceTimingsForVideo(root, durations, rawConfig, {
      provider: "sample",
      kind: "sample-audio",
      outputs: result.outputs || [],
    });
    await applyConfiguredAlignment(root, savedConfig);
    return;
  }

  const result = await generateVoiceover({ lines, root });
  const savedConfig = rewriteVoiceTimingsForVideo(root, result.durations || {}, rawConfig, {
    ...(result.settings || {}),
    outputs: result.outputs || [],
  });
  await applyConfiguredAlignment(root, savedConfig);
}

function sumDurations(durations) {
  return Object.values(durations || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

export async function trimExistingVoiceoverForVideo(root, {
  env = loadAimaxEnv(),
  getDurationFn = getDuration,
  trimVoiceSilenceFn = trimVoiceSilence,
} = {}) {
  const configPath = path.join(root, "video.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing video.json in ${root}`);
  }

  const rawConfig = readJson(configPath);
  if (rawConfig.audio?.mainAudio) {
    throw new Error("Trim VO hiện có chỉ hỗ trợ VO AIMAX từng dòng, không hỗ trợ full audio upload.");
  }

  const lines = Array.isArray(rawConfig.lines) ? rawConfig.lines : [];
  if (!lines.length) {
    throw new Error("Project has no official lines to trim.");
  }

  const voDir = path.join(root, "assets", "vo");
  const missing = lines
    .map((line, index) => String(line.id || `line-${index + 1}`))
    .filter((id) => !fs.existsSync(path.join(voDir, `${id}.mp3`)));
  if (missing.length) {
    throw new Error(`Missing per-line VO file(s): ${missing.join(", ")}. Tao lai am thanh truoc khi cat nghi VO.`);
  }

  const beforeDurations = {};
  const afterDurations = {};
  let trimmedCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const id = String(line.id || `line-${index + 1}`);
    const filePath = path.join(voDir, `${id}.mp3`);
    const originalDuration = await getDurationFn(filePath, env);
    beforeDurations[id] = Number(originalDuration.toFixed(3));
    const result = await trimVoiceSilenceFn(filePath, env, {
      originalDuration,
      getDurationFn,
      minDurationSeconds: minimumReadableDuration(displayTextForLine(line), { voiceText: voiceTextForLine(line) }),
    });
    if (result?.trimmed) trimmedCount += 1;
    afterDurations[id] = Number((await getDurationFn(filePath, env)).toFixed(3));
    console.log(`Trimmed ${index + 1}/${lines.length} VO line(s): ${id} ${beforeDurations[id].toFixed(3)}s -> ${afterDurations[id].toFixed(3)}s`);
  }

  fs.writeFileSync(path.join(voDir, "durations.json"), `${JSON.stringify(afterDurations, null, 2)}\n`, "utf8");
  const nextConfig = await applyConfiguredAlignment(root, rewriteVoiceTimingsForVideo(root, afterDurations, rawConfig));
  const beforeDuration = Number(sumDurations(beforeDurations).toFixed(3));
  const afterDuration = Number(sumDurations(afterDurations).toFixed(3));
  const savedSeconds = Number(Math.max(0, beforeDuration - afterDuration).toFixed(3));

  return {
    root,
    lineCount: lines.length,
    trimmedCount,
    beforeDuration,
    afterDuration,
    savedSeconds,
    durations: afterDurations,
    config: nextConfig,
  };
}
