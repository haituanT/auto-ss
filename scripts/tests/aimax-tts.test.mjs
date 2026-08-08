import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { __test, generateVoiceover, trimVoiceSilence } from "../aimax-tts.mjs";

function createStoredZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.from(entry.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, content);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(content.length, 20);
    directory.writeUInt32LE(content.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += local.length + name.length + content.length;
  }

  const directoryBody = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBody.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directoryBody, end]);
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("AIMAX batch TTS sends all lines once and maps ZIP segments to video audio", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aimax-video-batch-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const lines = Array.from({ length: 12 }, (_, index) => ({
    id: `line-${index + 1}`,
    text: `Cau thu ${index + 1}.`,
  }));
  const zip = createStoredZip(lines.map((line, index) => ({
    name: `line_${String(index + 1).padStart(3, "0")}.mp3`,
    content: `audio-${index + 1}`,
  })));
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const requestUrl = String(url);
    calls.push({ url: requestUrl, options });
    if (requestUrl.endsWith("/api/v1/tts/generate")) {
      return json({ job_id: "job-123" });
    }
    if (requestUrl.endsWith("/api/v1/tts/jobs/job-123")) {
      return json({ status: "success", segments_url: "https://cdn.aimax.test/segments.zip" });
    }
    if (requestUrl === "https://cdn.aimax.test/segments.zip") {
      return new Response(zip, { status: 200 });
    }
    throw new Error(`Unexpected request: ${requestUrl}`);
  };

  const result = await generateVoiceover({
    lines,
    root,
    env: {
      AIMAX_API_KEY: "test-key",
      AIMAX_VOICE_ID: "voice-1",
      AIMAX_TTS_SPEED: "1.25",
      AIMAX_TTS_PITCH: "-1",
      AIMAX_TTS_MAX_LINES: "200",
      AIMAX_TTS_TRIM_SILENCE: "0",
    },
    fetchImpl,
    sleepImpl: async () => {},
    getDurationFn: async (filePath) => Number(path.basename(filePath).match(/line-(\d+)/)[1]),
  });

  const generateCalls = calls.filter((call) => call.url.endsWith("/api/v1/tts/generate"));
  assert.equal(generateCalls.length, 1);
  assert.equal(generateCalls[0].options.body.get("text"), lines.map((line) => line.text).join("\n"));
  assert.equal(generateCalls[0].options.body.get("enable_srt"), "true");
  assert.equal(generateCalls[0].options.body.get("split_by_line"), "true");
  assert.equal(generateCalls[0].options.body.get("speed"), "1.25");
  assert.equal(generateCalls[0].options.body.get("pitch"), "-1");
  assert.equal(result.outputs.length, 12);
  assert.deepEqual(result.settings, {
    provider: "minimax",
    model: "speech-2.8-hd",
    speed: 1.25,
    pitch: -1,
    voiceId: "voice-1",
  });
  assert.equal(await fs.readFile(path.join(root, "assets", "vo", "line-12.mp3"), "utf8"), "audio-12");

  const durations = JSON.parse(await fs.readFile(path.join(root, "assets", "vo", "durations.json"), "utf8"));
  assert.equal(durations["line-1"], 1);
  assert.equal(durations["line-12"], 12);
  const manifest = JSON.parse(await fs.readFile(path.join(root, "assets", "vo", "aimax-batch.json"), "utf8"));
  assert.equal(manifest.jobId, "job-123");
  assert.equal(manifest.lineCount, 12);
  assert.equal(manifest.provider, "minimax");
  assert.equal(manifest.model, "speech-2.8-hd");
  assert.equal(manifest.speed, 1.25);
  assert.equal(manifest.pitch, -1);
  assert.equal(manifest.voiceId, "voice-1");

  const scriptPath = fileURLToPath(new URL("../aimax-tts.mjs", import.meta.url));
  assert.doesNotMatch(await fs.readFile(scriptPath, "utf8"), /DUBFLOW_ROOT|DubFlow/);
});

test("AIMAX batch TTS trims segments by default", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aimax-video-trim-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const lines = [{ id: "line-1", text: "Cau trim." }];
  const zip = createStoredZip([{ name: "line_001.mp3", content: "raw-audio" }]);
  const fetchImpl = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.endsWith("/api/v1/tts/generate")) return json({ job_id: "job-trim" });
    if (requestUrl.endsWith("/api/v1/tts/jobs/job-trim")) return json({ status: "success", segments_url: "https://cdn.aimax.test/trim.zip" });
    if (requestUrl === "https://cdn.aimax.test/trim.zip") return new Response(zip, { status: 200 });
    throw new Error(`Unexpected request: ${requestUrl}`);
  };
  const trimCalls = [];
  const trimOptions = [];

  const result = await generateVoiceover({
    lines,
    root,
    env: {
      AIMAX_API_KEY: "test-key",
      AIMAX_VOICE_ID: "voice-1",
    },
    fetchImpl,
    sleepImpl: async () => {},
    trimVoiceSilenceFn: async (filePath, _env, options = {}) => {
      trimCalls.push(path.basename(filePath));
      trimOptions.push(options);
      await fs.writeFile(filePath, "trimmed-audio");
      return { trimmed: true, originalDuration: 1.2, duration: 0.8, savedSeconds: 0.4 };
    },
    getDurationFn: async (filePath) => {
      const content = await fs.readFile(filePath, "utf8");
      return content === "trimmed-audio" ? 0.8 : 1.2;
    },
  });

  assert.deepEqual(trimCalls, ["line-1.mp3"]);
  assert.ok(trimOptions[0].minDurationSeconds >= 0.45);
  assert.equal(result.durations["line-1"], 0.8);
  assert.equal(await fs.readFile(path.join(root, "assets", "vo", "line-1.mp3"), "utf8"), "trimmed-audio");
});

test("AIMAX batch TTS expands Vietnamese acronyms for voice only", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aimax-video-acronym-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const lines = [{ id: "line-1", text: "Đây là ADN." }];
  const zip = createStoredZip([{ name: "line_001.mp3", content: "clear-adn" }]);
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const requestUrl = String(url);
    calls.push({ url: requestUrl, options });
    if (requestUrl.endsWith("/api/v1/tts/generate")) return json({ job_id: "job-acronym" });
    if (requestUrl.endsWith("/api/v1/tts/jobs/job-acronym")) return json({ status: "success", segments_url: "https://cdn.aimax.test/acronym.zip" });
    if (requestUrl === "https://cdn.aimax.test/acronym.zip") return new Response(zip, { status: 200 });
    throw new Error(`Unexpected request: ${requestUrl}`);
  };

  const result = await generateVoiceover({
    lines,
    root,
    env: {
      AIMAX_API_KEY: "test-key",
      AIMAX_VOICE_ID: "voice-1",
      AIMAX_TTS_TRIM_SILENCE: "0",
    },
    fetchImpl,
    sleepImpl: async () => {},
    getDurationFn: async () => 1.2,
  });

  const [generateCall] = calls.filter((call) => call.url.endsWith("/api/v1/tts/generate"));
  assert.equal(generateCall.options.body.get("text"), "Đây là a đê en.");
  assert.equal(result.durations["line-1"], 1.2);

  const manifest = JSON.parse(await fs.readFile(path.join(root, "assets", "vo", "aimax-batch.json"), "utf8"));
  assert.equal(manifest.pronunciations[0].text, "Đây là ADN.");
  assert.equal(manifest.pronunciations[0].voiceText, "Đây là a đê en.");
  assert.notEqual(manifest.textHash, manifest.voiceTextHash);
  assert.ok(__test.minimumReadableDuration("Đây là ADN.", { voiceText: "Đây là a đê en." }) >= 1.1);
});

test("AIMAX batch TTS retries unreadably short lines individually", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aimax-video-retry-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const lines = [
    { id: "line-1", text: "Cau mot du dai." },
    { id: "line-2", text: "Cau hai du dai." },
  ];
  const batchZip = createStoredZip([
    { name: "line_001.mp3", content: "good-one" },
    { name: "line_002.mp3", content: "too-short" },
  ]);
  const retryZip = createStoredZip([{ name: "line_001.mp3", content: "good-two" }]);
  const calls = [];
  const fetchImpl = async (url) => {
    const requestUrl = String(url);
    calls.push(requestUrl);
    if (requestUrl.endsWith("/api/v1/tts/generate")) {
      const count = calls.filter((call) => call.endsWith("/api/v1/tts/generate")).length;
      return json({ job_id: count === 1 ? "job-batch" : "job-retry" });
    }
    if (requestUrl.endsWith("/api/v1/tts/jobs/job-batch")) return json({ status: "success", segments_url: "https://cdn.aimax.test/batch.zip" });
    if (requestUrl.endsWith("/api/v1/tts/jobs/job-retry")) return json({ status: "success", segments_url: "https://cdn.aimax.test/retry.zip" });
    if (requestUrl === "https://cdn.aimax.test/batch.zip") return new Response(batchZip, { status: 200 });
    if (requestUrl === "https://cdn.aimax.test/retry.zip") return new Response(retryZip, { status: 200 });
    throw new Error(`Unexpected request: ${requestUrl}`);
  };

  const result = await generateVoiceover({
    lines,
    root,
    env: {
      AIMAX_API_KEY: "test-key",
      AIMAX_VOICE_ID: "voice-1",
      AIMAX_TTS_TRIM_SILENCE: "0",
    },
    fetchImpl,
    sleepImpl: async () => {},
    getDurationFn: async (filePath) => {
      const content = await fs.readFile(filePath, "utf8");
      if (content === "too-short") return 0.1;
      if (content === "good-two") return 1.1;
      return 1.0;
    },
  });

  assert.equal(calls.filter((call) => call.endsWith("/api/v1/tts/generate")).length, 2);
  assert.equal(result.durations["line-1"], 1);
  assert.equal(result.durations["line-2"], 1.1);
  assert.equal(await fs.readFile(path.join(root, "assets", "vo", "line-2.mp3"), "utf8"), "good-two");
});

test("trimVoiceSilence keeps original audio when ffmpeg fails or output is unsafe", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aimax-trim-helper-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const logger = { warn: () => {} };

  const failedPath = path.join(root, "line-1.mp3");
  await fs.writeFile(failedPath, "original-failed");
  const failed = await trimVoiceSilence(failedPath, {}, {
    execFileFn: async () => { throw new Error("ffmpeg boom"); },
    getDurationFn: async () => 1.2,
    logger,
  });
  assert.equal(failed.trimmed, false);
  assert.equal(failed.reason, "trim-failed");
  assert.equal(await fs.readFile(failedPath, "utf8"), "original-failed");

  const unsafePath = path.join(root, "line-2.mp3");
  await fs.writeFile(unsafePath, "original-unsafe");
  const unsafe = await trimVoiceSilence(unsafePath, {}, {
    execFileFn: async (_command, args) => {
      await fs.writeFile(args.at(-1), "too-short");
    },
    getDurationFn: async (filePath) => String(filePath).includes(".trimmed-") ? 0.2 : 1.2,
    logger,
  });
  assert.equal(unsafe.trimmed, false);
  assert.equal(unsafe.reason, "unsafe-output");
  assert.equal(await fs.readFile(unsafePath, "utf8"), "original-unsafe");
});
