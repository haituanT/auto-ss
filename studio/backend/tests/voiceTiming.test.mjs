import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  alignProjectLinesWithElevenLabs,
  readDurations,
  shouldUseDurationTimeline,
  voiceSyncIssues,
  voiceTextHash,
  writeAudioManifest,
  wordsFromElevenLabsAlignment,
} from "../services/voiceTiming.mjs";

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-compare-voice-"));
  fs.mkdirSync(path.join(root, "assets", "vo"), { recursive: true });
  return root;
}

test("voice sync catches stale AIMAX text even if dirtyVoice is missing", () => {
  const root = tempProject();
  const oldLines = [{ id: "line-1", text: "Old line" }];
  fs.writeFileSync(path.join(root, "assets", "vo", "line-1.mp3"), "");
  fs.writeFileSync(path.join(root, "assets", "vo", "durations.json"), JSON.stringify({ "line-1": 1.2 }));
  fs.writeFileSync(path.join(root, "assets", "vo", "aimax-batch.json"), JSON.stringify({
    lineCount: 1,
    textHash: voiceTextHash(oldLines),
  }));

  const issues = voiceSyncIssues(root, {
    audio: { provider: "aimax" },
    lines: [{ id: "line-1", text: "New line" }],
  });

  assert.match(issues.join("\n"), /Text hiện tại khác/);
});

test("SRT uploaded projects keep explicit SRT timings", () => {
  const root = tempProject();
  fs.writeFileSync(path.join(root, "assets", "vo", "audio.srt"), "1\n00:00:00,000 --> 00:00:01,000\nA\n");

  assert.equal(shouldUseDurationTimeline(root, {
    subtitleSource: "srt",
    audio: { srt: "assets/vo/audio.srt" },
    lines: [{ id: "line-1", text: "A", start: 0, duration: 1 }],
  }, { "line-1": 2 }), false);
});

test("voice sync rejects audio that is too short for long text", () => {
  const root = tempProject();
  const longText = "This is a long narration line that cannot possibly fit into half a second of speech.";
  fs.writeFileSync(path.join(root, "assets", "vo", "line-1.mp3"), "");
  fs.writeFileSync(path.join(root, "assets", "vo", "durations.json"), JSON.stringify({ "line-1": 0.5 }));

  const issues = voiceSyncIssues(root, {
    audio: { provider: "aimax" },
    lines: [{ id: "line-1", text: longText }],
  });

  assert.match(issues.join("\n"), /Voice quá ngắn/);
});

test("voice sync rejects short acronym audio that would swallow the final word", () => {
  const root = tempProject();
  fs.writeFileSync(path.join(root, "assets", "vo", "line-1.mp3"), "");
  fs.writeFileSync(path.join(root, "assets", "vo", "durations.json"), JSON.stringify({ "line-1": 0.723 }));

  const issues = voiceSyncIssues(root, {
    audio: { provider: "aimax" },
    lines: [{ id: "line-1", text: "Đây là ADN." }],
  });

  assert.match(issues.join("\n"), /Voice qu/);
  assert.match(issues.join("\n"), /1 \(0\.72s/);
});

test("voice sync catches AIMAX voice setting mismatches when manifest records them", () => {
  const root = tempProject();
  const lines = [{ id: "line-1", text: "Same line" }];
  fs.writeFileSync(path.join(root, "assets", "vo", "line-1.mp3"), "");
  fs.writeFileSync(path.join(root, "assets", "vo", "durations.json"), JSON.stringify({ "line-1": 1.2 }));
  fs.writeFileSync(path.join(root, "assets", "vo", "aimax-batch.json"), JSON.stringify({
    lineCount: 1,
    textHash: voiceTextHash(lines),
    speed: 1.1,
    voiceId: "voice-a",
  }));

  const issues = voiceSyncIssues(root, {
    audio: { provider: "aimax", speed: 1, voiceId: "voice-b" },
    lines,
  });

  assert.match(issues.join("\n"), /Tốc độ voice hiện tại khác/);
  assert.match(issues.join("\n"), /Voice hiện tại khác/);
});

test("voice sync catches voice settings lock mismatches for legacy AIMAX manifests", () => {
  const root = tempProject();
  const lines = [{ id: "line-1", text: "Same line" }];
  fs.writeFileSync(path.join(root, "assets", "vo", "line-1.mp3"), "");
  fs.writeFileSync(path.join(root, "assets", "vo", "durations.json"), JSON.stringify({ "line-1": 1.2 }));
  fs.writeFileSync(path.join(root, "assets", "vo", "aimax-batch.json"), JSON.stringify({
    lineCount: 1,
    textHash: voiceTextHash(lines),
  }));
  fs.writeFileSync(path.join(root, "assets", "vo", "voice-settings.json"), JSON.stringify({
    lineCount: 1,
    textHash: voiceTextHash(lines),
    speed: 1,
    voiceId: "voice-a",
  }));

  const issues = voiceSyncIssues(root, {
    audio: { provider: "aimax", speed: 1.2, voiceId: "voice-a" },
    lines,
  });

  assert.match(issues.join("\n"), /Tốc độ voice hiện tại khác/);
});

test("voice sync blocks non-default speed on legacy AIMAX manifests without a settings lock", () => {
  const root = tempProject();
  const lines = [{ id: "line-1", text: "Same line" }];
  fs.writeFileSync(path.join(root, "assets", "vo", "line-1.mp3"), "");
  fs.writeFileSync(path.join(root, "assets", "vo", "durations.json"), JSON.stringify({ "line-1": 1.2 }));
  fs.writeFileSync(path.join(root, "assets", "vo", "aimax-batch.json"), JSON.stringify({
    lineCount: 1,
    textHash: voiceTextHash(lines),
  }));

  const issues = voiceSyncIssues(root, {
    audio: { provider: "aimax", speed: 1.2, voiceId: "voice-a" },
    lines,
  });

  assert.match(issues.join("\n"), /Batch AIMAX cũ chưa ghi tốc độ voice/);
});

test("voice sync allows legacy AIMAX manifests without voice setting metadata", () => {
  const root = tempProject();
  const lines = [{ id: "line-1", text: "Same line" }];
  fs.writeFileSync(path.join(root, "assets", "vo", "line-1.mp3"), "");
  fs.writeFileSync(path.join(root, "assets", "vo", "durations.json"), JSON.stringify({ "line-1": 1.2 }));
  fs.writeFileSync(path.join(root, "assets", "vo", "aimax-batch.json"), JSON.stringify({
    lineCount: 1,
    textHash: voiceTextHash(lines),
  }));

  const issues = voiceSyncIssues(root, {
    audio: { provider: "aimax", speed: 1, voiceId: "voice-b" },
    lines,
  });

  assert.deepEqual(issues, []);
});

test("voice durations prefer the new audio manifest over legacy durations", () => {
  const root = tempProject();
  fs.writeFileSync(path.join(root, "assets", "vo", "durations.json"), JSON.stringify({ "line-1": 1.2 }));
  writeAudioManifest(root, {
    audio: { provider: "aimax", speed: 1, voiceId: "voice-a" },
    lines: [{ id: "line-1", text: "Same line" }],
  }, {
    durations: { "line-1": 2.5 },
    voiceId: "voice-a",
    speed: 1,
  });

  assert.equal(readDurations(root)["line-1"], 2.5);
});

test("voice sync ignores stale legacy locks when the new audio manifest exists", () => {
  const root = tempProject();
  const lines = [{ id: "line-1", text: "Same line" }];
  fs.writeFileSync(path.join(root, "assets", "vo", "line-1.mp3"), "");
  fs.writeFileSync(path.join(root, "assets", "vo", "durations.json"), JSON.stringify({ "line-1": 1.2 }));
  fs.writeFileSync(path.join(root, "assets", "vo", "aimax-batch.json"), JSON.stringify({
    lineCount: 1,
    textHash: voiceTextHash(lines),
    voiceId: "old-voice",
  }));
  fs.writeFileSync(path.join(root, "assets", "vo", "voice-settings.json"), JSON.stringify({
    lineCount: 1,
    textHash: voiceTextHash(lines),
    speed: 1,
    voiceId: "old-voice",
  }));
  writeAudioManifest(root, {
    audio: { provider: "aimax", speed: 1, voiceId: "voice-a" },
    lines,
  }, {
    durations: { "line-1": 1.2 },
    voiceId: "voice-a",
    speed: 1,
  });

  const issues = voiceSyncIssues(root, {
    audio: { provider: "aimax", speed: 1, voiceId: "voice-a" },
    lines,
  });

  assert.deepEqual(issues, []);
});

test("audio-setting dirty lines are not reported as changed text", () => {
  const root = tempProject();
  const lines = [{ id: "line-1", text: "Same line", dirtyVoice: true, dirtyVoiceReason: "audio-settings" }];
  fs.writeFileSync(path.join(root, "assets", "vo", "line-1.mp3"), "");
  fs.writeFileSync(path.join(root, "assets", "vo", "durations.json"), JSON.stringify({ "line-1": 1.2 }));
  writeAudioManifest(root, {
    audio: { provider: "aimax", speed: 1, voiceId: "voice-a" },
    lines,
  }, {
    durations: { "line-1": 1.2 },
    voiceId: "voice-a",
    speed: 1,
  });

  const issues = voiceSyncIssues(root, {
    audio: { provider: "aimax", speed: 1, voiceId: "voice-a" },
    lines,
  });

  assert.doesNotMatch(issues.join("\n"), /text mới/);
  assert.match(issues.join("\n"), /Có dòng cần tạo lại âm thanh/);
});

test("content dirty lines keep the line-specific changed-text warning", () => {
  const root = tempProject();
  const lines = [{ id: "line-1", text: "New line", dirtyVoice: true, dirtyVoiceReason: "content" }];
  fs.writeFileSync(path.join(root, "assets", "vo", "line-1.mp3"), "");
  fs.writeFileSync(path.join(root, "assets", "vo", "durations.json"), JSON.stringify({ "line-1": 1.2 }));

  const issues = voiceSyncIssues(root, {
    audio: { provider: "aimax", speed: 1, voiceId: "voice-a" },
    lines,
  });

  assert.match(issues.join("\n"), /Voice cũ không khớp text mới ở dòng 1/);
});

test("ElevenLabs word timings are normalized to absolute line timing", () => {
  const words = wordsFromElevenLabsAlignment({
    words: [
      { text: "Xin", start: 0.1, end: 0.32 },
      { text: "", start: 0.4, end: 0.5 },
      { text: "loi", start: 0.6, end: 0.5 },
    ],
  }, { lineStartMs: 2000, lineEndMs: 2600 });

  assert.deepEqual(words, [
    { text: "Xin", startMs: 2100, endMs: 2320 },
  ]);
});

test("ElevenLabs project alignment accepts mocked word timing and never calls network in tests", async () => {
  const root = tempProject();
  fs.writeFileSync(path.join(root, "assets", "vo", "line-1.mp3"), "audio");
  const calls = [];
  const result = await alignProjectLinesWithElevenLabs(root, {
    audio: { provider: "aimax", alignmentProvider: "elevenlabs" },
    lines: [{ id: "line-1", text: "Xin chao", start: 2, duration: 1 }],
  }, {
    apiKey: "test-key",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({
          words: [
            { text: "Xin", start: 0, end: 0.4 },
            { text: "chao", start: 0.42, end: 0.8 },
          ],
        }),
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.elevenlabs.io/v1/forced-alignment");
  assert.equal(calls[0].init.headers["xi-api-key"], "test-key");
  assert.equal(result.alignedCount, 1);
  assert.deepEqual(result.config.lines[0].words, [
    { text: "Xin", startMs: 2000, endMs: 2400 },
    { text: "chao", startMs: 2420, endMs: 2800 },
  ]);
});

test("ElevenLabs alignment falls back when the API key is missing", async () => {
  const root = tempProject();
  const config = {
    audio: { provider: "aimax", alignmentProvider: "elevenlabs" },
    lines: [{ id: "line-1", text: "Xin chao", start: 0, duration: 1 }],
  };
  const result = await alignProjectLinesWithElevenLabs(root, config, { apiKey: "" });

  assert.equal(result.alignedCount, 0);
  assert.equal(result.config, config);
  assert.match(result.errors.join("\n"), /ELEVENLABS_API_KEY/);
});
