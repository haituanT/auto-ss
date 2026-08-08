import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { VIDEOS_DIR } from "../paths.mjs";
import { contentHash, defaultProjectConfig, normalizeProjectConfig } from "../services/projectConfig.mjs";
import { commitVideoContent, getVideo, saveContentDraft, saveVideo } from "../services/videoManager.mjs";
import { generateVoiceoverForVideo, rewriteVoiceTimingsForVideo, trimExistingVoiceoverForVideo } from "../../../scripts/voiceover-from-video-json.mjs";

const FIXTURE_SLUG = "test-content-official-fixture";
const fixtureRoot = path.join(VIDEOS_DIR, FIXTURE_SLUG);
const configPath = path.join(fixtureRoot, "video.json");

function linesText(count, prefix = "Dong") {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join("\n");
}

function sectionsHash(compare1, compare2 = "") {
  return contentHash({ "compare-1": compare1, "compare-2": compare2 });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function setupProject({ count = 55, prefix = "Official" } = {}) {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const config = normalizeProjectConfig({
    ...defaultProjectConfig({
      slug: FIXTURE_SLUG,
      title: "Content Official Fixture",
      leftLabel: "A",
      rightLabel: "B",
      content: linesText(count, prefix),
    }),
    audio: {
      provider: "aimax",
      voiceId: "voice-a",
      speed: 1.1,
      voiceVolume: 1,
      mainAudio: "assets/vo/full.mp3",
      srt: "assets/vo/audio.srt",
      bgm: "",
      bgmVolume: 0.18,
    },
    audioDuration: 99,
    subtitleSource: "assets/vo/audio.srt",
  }, FIXTURE_SLUG);
  config.lines = config.lines.map((line, index) => ({
    ...line,
    start: index,
    duration: 0.9,
    dirtyVoice: false,
  }));
  writeJson(configPath, config);
  return config;
}

function withFixture(run) {
  setupProject();
  const cleanup = () => fs.rmSync(fixtureRoot, { recursive: true, force: true });
  try {
    const result = run();
    if (result && typeof result.then === "function") {
      return result.finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

test("regular video save ignores stale body lines", () => {
  withFixture(() => {
    const staleLines = linesText(9, "Stale")
      .split("\n")
      .map((text, index) => ({ id: `line-${index + 1}`, text }));

    const saved = saveVideo(FIXTURE_SLUG, {
      lines: staleLines,
      audio: { speed: 1.4 },
      caption: { fontSize: 82 },
    });

    assert.equal(saved.config.lines.length, 55);
    assert.equal(saved.config.lines[0].text, "Official 1");
    assert.equal(saved.config.audio.speed, 1.4);
    assert.equal(saved.config.caption.fontSize, 82);
    assert.equal(saved.config.contentOfficial.lineCount, 55);
    assert.equal(saved.config.lines.every((line) => line.dirtyVoice), true);
  });
});

test("saving content draft does not change official lines", () => {
  withFixture(() => {
    const draftText = linesText(9, "Draft");
    const saved = saveContentDraft(FIXTURE_SLUG, { content: draftText });

    assert.equal(saved.config.lines.length, 55);
    assert.equal(saved.config.lines[0].text, "Official 1");
    assert.equal(saved.config.contentDraft.text, draftText);
    assert.equal(saved.config.contentDraft.hash, sectionsHash(draftText));
    assert.equal(saved.config.contentOfficial.lineCount, 55);
    assert.deepEqual(saved.config.pipeline.dirty, {
      content: false,
      audio: false,
      assets: false,
      style: false,
      layout: false,
      render: false,
    });
  });
});

test("saving content draft preserves editable whitespace until commit", () => {
  withFixture(() => {
    const saved = saveContentDraft(FIXTURE_SLUG, {
      contentByCompareSet: {
        "compare-1": "Draft A \n\n  Draft B  ",
        "compare-2": "Draft C  ",
      },
    });

    assert.deepEqual(saved.config.contentDraft.sections, {
      "compare-1": "Draft A \n\n  Draft B  ",
      "compare-2": "Draft C  ",
    });
    assert.equal(saved.config.contentDraft.text, "Draft A \n\n  Draft B  \nDraft C  ");
    assert.equal(saved.config.lines.length, 55);

    const committed = commitVideoContent(FIXTURE_SLUG, {
      contentByCompareSet: saved.config.contentDraft.sections,
      compare: { leftLabel: "A", rightLabel: "B" },
    });

    assert.deepEqual(committed.config.lines.map((line) => line.text), ["Draft A", "Draft B", "Draft C"]);
    assert.deepEqual(committed.config.contentDraft.sections, {
      "compare-1": "Draft A\nDraft B",
      "compare-2": "Draft C",
    });
  });
});

test("committing content preserves the current template layout over stale compare fields", () => {
  withFixture(() => {
    const current = setupProject({ count: 3, prefix: "Current" });
    const linked = normalizeProjectConfig({
      ...current,
      template: { id: "photo-compare-v1", name: "Photo compare", version: 1 },
      layout: {
        ...(current.layout || {}),
        photoCompareSize: 480,
      },
      compare: {
        ...current.compare,
        leftLabel: "Current A",
        rightLabel: "Current B",
      },
      compareSets: current.compareSets.map((set) => ({
        ...set,
        leftLabel: "Current A",
        rightLabel: "Current B",
      })),
      savedTemplateRef: {
        type: "full",
        id: "linked-template",
        name: "Linked template",
        version: 2,
        linkedAt: "2026-01-01T00:00:00.000Z",
      },
    }, FIXTURE_SLUG);
    writeJson(configPath, linked);

    const staleCompareSets = linked.compareSets.map((set) => ({
      ...set,
      leftLabel: "Old A",
      rightLabel: "Old B",
    }));
    const saved = commitVideoContent(FIXTURE_SLUG, {
      content: "New content one\nNew content two",
      compare: { leftLabel: "Old A", rightLabel: "Old B" },
      compareSets: staleCompareSets,
    });

    assert.equal(saved.config.layout.photoCompareSize, 480);
    assert.equal(saved.config.compare.leftLabel, "Current A");
    assert.equal(saved.config.compare.rightLabel, "Current B");
    assert.equal(saved.config.compareSets[0].leftLabel, "Current A");
    assert.equal(saved.config.savedTemplateRef.version, 2);
    assert.equal(saved.config.template.id, "photo-compare-v1");
  });
});

test("normalizing config preserves in-progress compare label spacing", () => {
  const config = normalizeProjectConfig({
    ...defaultProjectConfig({
      slug: FIXTURE_SLUG,
      title: "Compare Label Fixture",
      leftLabel: "A",
      rightLabel: "B",
      content: "Line 1",
    }),
    compare: {
      leftLabel: "May giat ",
      rightLabel: " Cua ngang",
    },
    compareSets: [
      {
        id: "compare-1",
        leftLabel: "May giat ",
        rightLabel: " Cua ngang",
      },
      {
        id: "compare-2",
        leftLabel: "Dong co ",
        rightLabel: " 3 pha",
      },
    ],
  }, FIXTURE_SLUG);

  assert.equal(config.compare.leftLabel, "May giat ");
  assert.equal(config.compare.rightLabel, " Cua ngang");
  assert.equal(config.compareSets[1].leftLabel, "Dong co ");
  assert.equal(config.compareSets[1].rightLabel, " 3 pha");
});

test("empty content draft can be committed without restoring fallback lines", () => {
  withFixture(() => {
    const draft = saveContentDraft(FIXTURE_SLUG, {
      contentByCompareSet: { "compare-1": "", "compare-2": "" },
    });

    assert.equal(draft.config.lines.length, 55);
    assert.equal(draft.config.contentDraft.text, "");
    assert.deepEqual(draft.config.contentDraft.sections, { "compare-1": "", "compare-2": "" });

    const saved = commitVideoContent(FIXTURE_SLUG, {
      contentByCompareSet: { "compare-1": "", "compare-2": "" },
      compare: { leftLabel: "A", rightLabel: "B" },
    });
    const reloaded = getVideo(FIXTURE_SLUG);

    assert.equal(saved.config.lines.length, 0);
    assert.equal(saved.config.contentOfficial.lineCount, 0);
    assert.equal(saved.config.contentOfficial.hash, sectionsHash(""));
    assert.equal(saved.config.contentDraft.text, "");
    assert.equal(saved.config.audio.mainAudio, "");
    assert.equal(saved.config.audio.srt, "");
    assert.equal(saved.config.pipeline.dirty.content, true);
    assert.equal(reloaded.config.lines.length, 0);
    assert.equal(reloaded.config.contentOfficial.lineCount, 0);
  });
});

test("committing content replaces official lines and invalidates old audio", () => {
  withFixture(() => {
    const officialText = linesText(55, "New official");
    const saved = commitVideoContent(FIXTURE_SLUG, {
      content: officialText,
      compare: { leftLabel: "A", rightLabel: "B" },
    });

    assert.equal(saved.config.lines.length, 55);
    assert.equal(saved.config.lines[0].text, "New official 1");
    assert.equal(saved.config.contentOfficial.lineCount, 55);
    assert.equal(saved.config.contentOfficial.hash, sectionsHash(officialText));
    assert.equal(saved.config.contentDraft.text, officialText);
    assert.equal(saved.config.audio.mainAudio, "");
    assert.equal(saved.config.audio.srt, "");
    assert.equal(saved.config.audioDuration, undefined);
    assert.equal(saved.config.subtitleSource, undefined);
    assert.equal(saved.config.lines.every((line) => line.dirtyVoice), true);
    assert.equal(saved.config.pipeline.dirty.content, true);
    assert.equal(saved.config.pipeline.dirty.audio, true);
    assert.equal(saved.config.pipeline.dirty.render, true);
  });
});

test("voice and speed changes after commit keep official content", () => {
  withFixture(() => {
    commitVideoContent(FIXTURE_SLUG, { content: linesText(55, "Locked") });
    const saved = saveVideo(FIXTURE_SLUG, {
      lines: linesText(9, "Old")
        .split("\n")
        .map((text, index) => ({ id: `line-${index + 1}`, text })),
      audio: { voiceId: "voice-b", speed: 1.65 },
    });

    assert.equal(saved.config.lines.length, 55);
    assert.equal(saved.config.lines[0].text, "Locked 1");
    assert.equal(saved.config.audio.voiceId, "voice-b");
    assert.equal(saved.config.audio.speed, 1.65);
  });
});

test("speed changes lock existing per-line voice settings before forcing new audio", () => {
  withFixture(() => {
    const current = setupProject({ count: 3, prefix: "Speed lock" });
    current.audio = {
      ...(current.audio || {}),
      provider: "aimax",
      mainAudio: "",
      srt: "assets/vo/audio.srt",
      speed: 1.1,
      voiceId: "voice-a",
    };
    current.lines = current.lines.map((line) => ({ ...line, dirtyVoice: false }));
    writeJson(configPath, current);

    const voDir = path.join(fixtureRoot, "assets", "vo");
    fs.mkdirSync(voDir, { recursive: true });
    for (const line of current.lines) fs.writeFileSync(path.join(voDir, `${line.id}.mp3`), "");

    const saved = saveVideo(FIXTURE_SLUG, {
      audio: { speed: 1.35, voiceId: "voice-a" },
    });
    const lock = JSON.parse(fs.readFileSync(path.join(voDir, "voice-settings.json"), "utf8"));

    assert.equal(lock.speed, 1.1);
    assert.equal(lock.voiceId, "voice-a");
    assert.equal(lock.lineCount, 3);
    assert.equal(saved.config.audio.speed, 1.35);
    assert.equal(saved.config.lines.every((line) => line.dirtyVoice), true);
    assert.equal(saved.config.pipeline.dirty.audio, true);
  });
});

test("regular save can update metadata for matching official lines", () => {
  withFixture(() => {
    const current = getVideo(FIXTURE_SLUG).config;
    const incomingLines = current.lines.map((line, index) => ({
      ...line,
      pose: index === 0 ? "question" : line.pose,
      sfx: index === 0 ? "mixkit-bubble-pop.wav" : line.sfx,
    }));

    const saved = saveVideo(FIXTURE_SLUG, { lines: incomingLines });

    assert.equal(saved.config.lines.length, 55);
    assert.equal(saved.config.lines[0].text, "Official 1");
    assert.equal(saved.config.lines[0].pose, "question");
    assert.equal(saved.config.lines[0].sfx, "mixkit-bubble-pop.wav");
  });
});

test("voice generation rejects an uncommitted draft before TTS", async () => {
  await withFixture(async () => {
    saveContentDraft(FIXTURE_SLUG, { content: linesText(9, "Draft") });

    await assert.rejects(
      () => generateVoiceoverForVideo(fixtureRoot),
      /Bản nháp chưa lưu chính thức/,
    );
  });
});

test("voice generation sends long TTS lines as-is without changing official content", async () => {
  await withFixture(async () => {
    const content = [
      "Đây là vàng miếng.",
      "Đây là vàng nhẫn.",
      "Khác nhau ở đâu?",
      "Vàng miếng thường được làm theo miếng, có thương hiệu, seri, bao bì rõ ràng. Nó giống kiểu tài sản để cất giữ, ít ai mua vàng miếng về để đeo.",
      "Còn vàng nhẫn có thể vừa để tích trữ, vừa để mua theo số tiền nhỏ hơn. Nhiều người thích vàng nhẫn vì linh hoạt, mua một chỉ, hai chỉ cũng được.",
    ].join("\n");
    commitVideoContent(FIXTURE_SLUG, { content });

    const previousUseSample = process.env.USE_SAMPLE_AUDIO;
    const previousSamplePath = process.env.SAMPLE_AUDIO_PATH;
    process.env.USE_SAMPLE_AUDIO = "1";
    delete process.env.SAMPLE_AUDIO_PATH;

    try {
      await generateVoiceoverForVideo(fixtureRoot);
    } finally {
      if (previousUseSample === undefined) delete process.env.USE_SAMPLE_AUDIO;
      else process.env.USE_SAMPLE_AUDIO = previousUseSample;
      if (previousSamplePath === undefined) delete process.env.SAMPLE_AUDIO_PATH;
      else process.env.SAMPLE_AUDIO_PATH = previousSamplePath;
    }

    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const durations = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "assets", "vo", "durations.json"), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "assets", "vo", "manifest.json"), "utf8"));
    const state = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "project-state.json"), "utf8"));

    assert.equal(saved.lines.length, 5);
    assert.equal(saved.lines.map((line) => line.text).join("\n"), content);
    assert.equal(saved.lines.every((line) => line.dirtyVoice === false), true);
    assert.deepEqual(Object.keys(durations), ["line-1", "line-2", "line-3", "line-4", "line-5"]);
    assert.equal(fs.existsSync(path.join(fixtureRoot, "assets", "vo", "line-4.mp3")), true);
    assert.equal(fs.existsSync(path.join(fixtureRoot, "assets", "vo", "line-5.mp3")), true);
    assert.equal(fs.existsSync(path.join(fixtureRoot, "assets", "vo", "line-4__part_1.mp3")), false);
    assert.equal(fs.existsSync(path.join(fixtureRoot, "assets", "vo", "line-5__part_1.mp3")), false);
    const lock = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "assets", "vo", "voice-settings.json"), "utf8"));
    assert.equal(lock.speed, 1.1);
    assert.equal(lock.voiceId, "voice-a");
    assert.equal(lock.lineCount, 5);
    assert.equal(manifest.kind, "sample-audio");
    assert.equal(manifest.lineCount, 5);
    assert.deepEqual(Object.keys(manifest.durations), ["line-1", "line-2", "line-3", "line-4", "line-5"]);
    assert.equal(state.ready.audio, true);
    assert.equal(saved.pipeline.dirty.audio, false);
    assert.equal(saved.pipeline.dirty.assets, true);
    assert.equal(saved.pipeline.dirty.render, true);
    assert.deepEqual(saved.pipeline.dirtyReasons.sort(), ["assets", "render"]);
  });
});

test("targeted voice generation replaces only the requested line audio", async () => {
  await withFixture(async () => {
    const config = setupProject({ count: 3, prefix: "Targeted" });
    config.audio = {
      ...(config.audio || {}),
      mainAudio: "",
      srt: "",
    };
    config.lines = config.lines.map((line, index) => ({
      ...line,
      start: index,
      duration: 1,
      dirtyVoice: true,
      dirtyVoiceReason: "content",
    }));
    writeJson(configPath, config);

    const voDir = path.join(fixtureRoot, "assets", "vo");
    fs.mkdirSync(voDir, { recursive: true });
    fs.writeFileSync(path.join(voDir, "line-1.mp3"), "old-line-1", "utf8");
    fs.writeFileSync(path.join(voDir, "line-3.mp3"), "old-line-3", "utf8");

    const previousUseSample = process.env.USE_SAMPLE_AUDIO;
    const previousSamplePath = process.env.SAMPLE_AUDIO_PATH;
    process.env.USE_SAMPLE_AUDIO = "1";
    delete process.env.SAMPLE_AUDIO_PATH;

    try {
      await generateVoiceoverForVideo(fixtureRoot, { lineId: "line-2" });
    } finally {
      if (previousUseSample === undefined) delete process.env.USE_SAMPLE_AUDIO;
      else process.env.USE_SAMPLE_AUDIO = previousUseSample;
      if (previousSamplePath === undefined) delete process.env.SAMPLE_AUDIO_PATH;
      else process.env.SAMPLE_AUDIO_PATH = previousSamplePath;
    }

    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const durations = JSON.parse(fs.readFileSync(path.join(voDir, "durations.json"), "utf8"));

    assert.equal(saved.lines.find((line) => line.id === "line-2").dirtyVoice, false);
    assert.equal(saved.lines.find((line) => line.id === "line-1").dirtyVoice, true);
    assert.equal(saved.lines.find((line) => line.id === "line-3").dirtyVoice, true);
    assert.deepEqual(Object.keys(durations), ["line-2"]);
    assert.equal(fs.readFileSync(path.join(voDir, "line-1.mp3"), "utf8"), "old-line-1");
    assert.equal(fs.readFileSync(path.join(voDir, "line-3.mp3"), "utf8"), "old-line-3");
    assert.ok(fs.statSync(path.join(voDir, "line-2.mp3")).size > 0);
  });
});

test("voice timing rewrite stores resolved AIMAX voice settings", () => {
  withFixture(() => {
    const config = setupProject({ count: 1, prefix: "Resolved voice" });
    config.audio = {
      ...(config.audio || {}),
      voiceId: "",
      speed: 1,
      mainAudio: "",
      srt: "",
    };
    writeJson(configPath, config);

    const saved = rewriteVoiceTimingsForVideo(fixtureRoot, { "line-1": 1.2 }, config, {
      provider: "minimax",
      model: "speech-2.8-hd",
      voiceId: "uv_resolved",
      speed: 1.25,
      pitch: -1,
    });
    const lock = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "assets", "vo", "voice-settings.json"), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "assets", "vo", "manifest.json"), "utf8"));

    assert.equal(saved.audio.voiceId, "uv_resolved");
    assert.equal(saved.audio.speed, 1.25);
    assert.equal(saved.audio.pitch, -1);
    assert.equal(lock.voiceId, "uv_resolved");
    assert.equal(lock.speed, 1.25);
    assert.equal(lock.pitch, -1);
    assert.equal(lock.model, "speech-2.8-hd");
    assert.equal(manifest.voiceId, "uv_resolved");
    assert.equal(manifest.speed, 1.25);
    assert.equal(manifest.pitch, -1);
    assert.equal(manifest.model, "speech-2.8-hd");
  });
});

test("trimming existing per-line voice rewrites timing without changing compare mapping", async () => {
  await withFixture(async () => {
    const config = setupProject({ count: 3, prefix: "Trim" });
    config.audio = {
      ...(config.audio || {}),
      provider: "aimax",
      mainAudio: "",
      srt: "assets/vo/audio.srt",
    };
    delete config.audioDuration;
    config.lines = config.lines.map((line, index) => ({
      ...line,
      compareSetId: index === 1 ? "compare-2" : "compare-1",
      start: index + 5,
      duration: 9,
      dirtyVoice: false,
    }));
    writeJson(configPath, config);

    const voDir = path.join(fixtureRoot, "assets", "vo");
    fs.mkdirSync(voDir, { recursive: true });
    for (const line of config.lines) {
      fs.writeFileSync(path.join(voDir, `${line.id}.mp3`), `original-${line.id}`, "utf8");
    }

    const before = { "line-1": 1.2, "line-2": 1.4, "line-3": 1.6 };
    const after = { "line-1": 0.8, "line-2": 1.0, "line-3": 1.1 };
    const getDurationFn = async (filePath) => {
      const id = path.basename(filePath, ".mp3");
      const content = fs.readFileSync(filePath, "utf8");
      return content.startsWith("trimmed-") ? after[id] : before[id];
    };
    const trimVoiceSilenceFn = async (filePath, _env, options = {}) => {
      const id = path.basename(filePath, ".mp3");
      fs.writeFileSync(filePath, `trimmed-${id}`, "utf8");
      return {
        trimmed: true,
        originalDuration: options.originalDuration,
        duration: after[id],
        savedSeconds: before[id] - after[id],
      };
    };

    const result = await trimExistingVoiceoverForVideo(fixtureRoot, { getDurationFn, trimVoiceSilenceFn });
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const durations = JSON.parse(fs.readFileSync(path.join(voDir, "durations.json"), "utf8"));
    const srt = fs.readFileSync(path.join(voDir, "audio.srt"), "utf8");

    assert.equal(result.lineCount, 3);
    assert.equal(result.trimmedCount, 3);
    assert.deepEqual(durations, after);
    assert.deepEqual(saved.lines.map((line) => line.compareSetId), ["compare-1", "compare-2", "compare-1"]);
    assert.equal(saved.lines.every((line) => line.dirtyVoice === false), true);
    assert.deepEqual(saved.lines.map((line) => line.start), [0.55, 1.35, 2.35]);
    assert.deepEqual(saved.lines.map((line) => line.duration), [0.8, 1, 1.1]);
    assert.equal(saved.pipeline.dirty.audio, false);
    assert.equal(saved.pipeline.dirty.assets, true);
    assert.equal(saved.pipeline.dirty.render, true);
    assert.match(srt, /00:00:00,550 --> 00:00:01,350/);
    assert.match(srt, /00:00:01,350 --> 00:00:02,350/);
  });
});

test("trimming existing voice rejects full uploaded audio", async () => {
  await withFixture(async () => {
    await assert.rejects(
      () => trimExistingVoiceoverForVideo(fixtureRoot, { getDurationFn: async () => 1 }),
      /full audio upload/,
    );
  });
});
