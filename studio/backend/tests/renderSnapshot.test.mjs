import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { REMOTION_JOBS_DIR, videoPath } from "../paths.mjs";
import { buildPreviewProps, cleanupOldRenderArtifacts, createFinalSnapshot, getFinalSnapshot, prepareRemotionJob } from "../services/remotionRenderer.mjs";
import { CAPTION_FONT_OPTIONS } from "../../../shared/captionOptions.mjs";

const POSES = ["point-left", "point-right", "question"];

function writeFile(filePath, content = "") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeSilentWav(filePath, durationSeconds) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sampleRate = 8000;
  const channels = 1;
  const bitsPerSample = 16;
  const samples = Math.max(1, Math.round(durationSeconds * sampleRate));
  const dataSize = samples * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(filePath, buffer);
}

function makeProject(slug, overrides = {}) {
  const root = videoPath(slug);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  writeFile(path.join(root, "assets", "compare-left.png"));
  writeFile(path.join(root, "assets", "compare-right.png"));
  writeFile(path.join(root, "assets", "backgrounds", "paper.png"));
  writeFile(path.join(root, "assets", "vo", "full.mp3"));
  for (const pose of POSES) writeFile(path.join(root, "assets", "character", `${pose}.webm`));

  const config = {
    version: 2,
    slug,
    title: "Snapshot test",
    template: { id: "compare-dual-v1", version: 1 },
    compare: {
      leftLabel: "A",
      rightLabel: "B",
      leftImage: "assets/compare-left.png",
      rightImage: "assets/compare-right.png",
      leftZoom: 1,
      rightZoom: 1,
      leftCrop: { x: 0, y: 0, rotation: 0 },
      rightCrop: { x: 0, y: 0, rotation: 0 },
    },
    background: { type: "image", src: "assets/backgrounds/paper.png", color: "#f7efe1" },
    character: {
      scale: 1,
      x: 0,
      y: 0,
      poses: Object.fromEntries(POSES.map((pose) => [pose, `assets/character/${pose}.webm`])),
    },
    audio: {
      provider: "uploaded",
      mainAudio: "assets/vo/full.mp3",
      voiceVolume: 1,
      bgm: "",
      bgmVolume: 0.18,
      sceneStartSfx: {
        enabled: true,
        skipFirst: true,
        mode: "pose",
        name: "mixkit-hard-pop-click.wav",
        volume: 0.82,
        offsetMs: 0,
      },
    },
    poseSfx: {
      "point-left": "__none__",
      "point-right": "__none__",
      question: "__none__",
    },
    caption: { fontSize: 72, normalColor: "#2b2118", hotColor: "#f05b25", strokeColor: "#ffffff" },
    layout: { captionY: 810, compareTop: 170, compareHeight: 520 },
    lines: [
      { id: "line-1", text: "Day la A.", pose: "point-left", start: 0, duration: 1.2, dirtyVoice: false },
      { id: "line-2", text: "Day la B.", pose: "point-right", start: 1.4, duration: 1.2, dirtyVoice: false },
      { id: "line-3", text: "Khac nhau o dau?", pose: "question", start: 2.8, duration: 1.4, dirtyVoice: false },
    ],
    ...overrides,
  };
  fs.writeFileSync(path.join(root, "video.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return root;
}

function cleanup(slug) {
  fs.rmSync(videoPath(slug), { recursive: true, force: true });
  fs.rmSync(path.join(REMOTION_JOBS_DIR, slug), { recursive: true, force: true });
}

test("final snapshot writes props, manifest and metadata from the preview composition", () => {
  const slug = `snapshot-test-${Date.now()}`;
  try {
    const root = makeProject(slug);
    const snapshot = createFinalSnapshot(slug);

    assert.equal(snapshot.exists, true);
    assert.equal(snapshot.state, "final");
    assert.equal(snapshot.props.previewHash, snapshot.propsHash);
    assert.ok(fs.existsSync(path.join(root, "snapshots", "render-final", "props.json")));
    assert.ok(fs.existsSync(path.join(root, "snapshots", "render-final", "asset-manifest.json")));
    assert.ok(fs.existsSync(path.join(root, "snapshots", "render-final", "snapshot.json")));

    const savedConfig = JSON.parse(fs.readFileSync(path.join(root, "video.json"), "utf8"));
    assert.equal(savedConfig.pipeline.officialSnapshot.propsHash, snapshot.propsHash);
    assert.equal(savedConfig.pipeline.officialSnapshot.assetManifestHash, snapshot.assetManifestHash);
    assert.equal(savedConfig.pipeline.dirty.content, false);
    assert.equal(savedConfig.pipeline.dirty.audio, false);
    assert.equal(savedConfig.pipeline.dirty.assets, false);
    assert.equal(savedConfig.pipeline.dirty.style, false);
    assert.equal(savedConfig.pipeline.dirty.layout, false);
    assert.equal(savedConfig.pipeline.dirty.render, true);
  } finally {
    cleanup(slug);
  }
});

test("dirty voice blocks final snapshot creation", () => {
  const slug = `snapshot-dirty-${Date.now()}`;
  try {
    makeProject(slug, {
      lines: [{ id: "line-1", text: "Changed", pose: "point-left", start: 0, duration: 1, dirtyVoice: true }],
    });

    assert.throws(() => createFinalSnapshot(slug), /Voice cũ không khớp/);
  } finally {
    cleanup(slug);
  }
});

test("pipeline content or audio dirty blocks final snapshot creation", () => {
  const slug = `snapshot-pipeline-dirty-${Date.now()}`;
  try {
    makeProject(slug, {
      pipeline: {
        dirty: { content: true, audio: false, assets: false, style: false, layout: false, render: true },
        dirtyReasons: ["content", "render"],
      },
    });

    assert.throws(() => createFinalSnapshot(slug), /content\/audio is dirty/);
  } finally {
    cleanup(slug);
  }
});

test("saved snapshot becomes stale after project layout changes", () => {
  const slug = `snapshot-stale-${Date.now()}`;
  try {
    const root = makeProject(slug);
    const snapshot = createFinalSnapshot(slug);
    const configPath = path.join(root, "video.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.layout.captionY = 940;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const next = getFinalSnapshot(slug);

    assert.equal(next.exists, true);
    assert.equal(next.stale, true);
    assert.equal(next.propsHash, snapshot.propsHash);
    assert.notEqual(next.currentPropsHash, snapshot.propsHash);
  } finally {
    cleanup(slug);
  }
});

test("legacy per-line SFX metadata does not affect preview hash or stale state", () => {
  const slug = `snapshot-ignore-line-sfx-${Date.now()}`;
  try {
    const root = makeProject(slug);
    const before = createFinalSnapshot(slug);
    const configPath = path.join(root, "video.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.lines[1].sfx = "line-pop.wav";
    config.lines[1].sfxOffsetMs = 999;
    config.lines[1].sfxVolume = 0.1;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const after = getFinalSnapshot(slug);
    const live = buildPreviewProps(slug);

    assert.equal(live.propsHash, before.propsHash);
    assert.equal(after.stale, false);
  } finally {
    cleanup(slug);
  }
});

test("line focus side is included in preview props and hash", () => {
  const slug = `snapshot-focus-${Date.now()}`;
  try {
    const root = makeProject(slug);
    const first = buildPreviewProps(slug);
    const configPath = path.join(root, "video.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.lines[0].focusSide = "center";
    config.lines[0].focusSideLocked = true;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const second = buildPreviewProps(slug);

    assert.equal(first.props.lines[0].focusSide, "right");
    assert.equal(second.props.lines[0].focusSide, "center");
    assert.notEqual(second.propsHash, first.propsHash);
  } finally {
    cleanup(slug);
  }
});

test("render job requires an existing final snapshot", async () => {
  const slug = `snapshot-render-missing-${Date.now()}`;
  try {
    makeProject(slug);

    await assert.rejects(
      () => prepareRemotionJob(slug),
      /Missing Preview final/,
    );
  } finally {
    cleanup(slug);
  }
});

test("render job requires a fresh final snapshot after project changes", async () => {
  const slug = `snapshot-render-dirty-${Date.now()}`;
  try {
    const root = makeProject(slug);
    createFinalSnapshot(slug);
    const configPath = path.join(root, "video.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.pipeline = {
      ...(config.pipeline || {}),
      dirty: {
        ...(config.pipeline?.dirty || {}),
        style: true,
        render: true,
      },
      dirtyReasons: ["style", "render"],
    };
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    await assert.rejects(
      () => prepareRemotionJob(slug),
      /Preview final is stale/,
    );
  } finally {
    cleanup(slug);
  }
});

test("render job props keep final preview hash and asset manifest", async () => {
  const slug = `snapshot-render-${Date.now()}`;
  try {
    makeProject(slug);
    const freshSnapshot = createFinalSnapshot(slug);
    const prepared = await prepareRemotionJob(slug);
    const quickPreview = buildPreviewProps(slug);
    const props = JSON.parse(fs.readFileSync(prepared.propsPath, "utf8"));

    assert.equal(prepared.propsHash, freshSnapshot.propsHash);
    assert.equal(prepared.snapshot.propsHash, freshSnapshot.propsHash);
    assert.deepEqual(prepared.assetManifest, freshSnapshot.props.assetManifest);
    assert.equal(quickPreview.propsHash, freshSnapshot.propsHash);
    assert.notEqual(freshSnapshot.propsHash, "");
    assert.deepEqual(props.lines.map((line) => line.focusSide), ["right", "left", "center"]);
    assert.match(props.assets.background, /^background-[a-f0-9]{12}\.png$/);
    assert.ok(fs.existsSync(path.join(prepared.jobDir, props.assets.background)));
    for (const font of CAPTION_FONT_OPTIONS) {
      assert.ok(fs.existsSync(path.join(prepared.jobDir, "fonts", font.file)), `missing copied font ${font.file}`);
    }
    assert.deepEqual(prepared.backgroundAsset, {
      src: props.assets.background,
      manifest: props.assetManifest.background,
    });
  } finally {
    cleanup(slug);
  }
});

test("logo config and file changes affect preview hash and render job props", async () => {
  const slug = `snapshot-logo-${Date.now()}`;
  try {
    const root = makeProject(slug, {
      logo: {
        enabled: true,
        src: "assets/logo/logo.png",
        width: 220,
        anchor: "bottom-right",
        x: -48,
        y: -72,
        opacity: 1,
        layer: "above-character",
      },
    });
    const logoPath = path.join(root, "assets", "logo", "logo.png");
    writeFile(logoPath, "logo-one");

    const first = buildPreviewProps(slug);
    assert.equal(first.props.logo.enabled, true);
    assert.equal(first.props.logo.width, 220);
    assert.match(first.props.assets.logo, /assets%2Flogo%2Flogo\.png|assets\/logo\/logo\.png/);
    assert.ok(first.props.assetManifest.logo.sha256);

    const configPath = path.join(root, "video.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.logo.width = 260;
    config.logo.x = 30;
    config.logo.y = -120;
    config.logo.opacity = 0.55;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const moved = buildPreviewProps(slug);
    assert.notEqual(moved.propsHash, first.propsHash);

    writeFile(logoPath, "logo-two-updated");
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(logoPath, future, future);
    const replaced = buildPreviewProps(slug);
    assert.notEqual(replaced.props.assetManifest.logo.sha256, moved.props.assetManifest.logo.sha256);
    assert.notEqual(replaced.propsHash, moved.propsHash);

    const snapshot = createFinalSnapshot(slug);
    const prepared = await prepareRemotionJob(slug);
    const props = JSON.parse(fs.readFileSync(prepared.propsPath, "utf8"));

    assert.equal(prepared.propsHash, snapshot.propsHash);
    assert.equal(props.assets.logo, "logo.png");
    assert.equal(props.logo.width, 260);
    assert.equal(props.logo.opacity, 0.55);
    assert.ok(fs.existsSync(path.join(prepared.jobDir, "logo.png")));
  } finally {
    cleanup(slug);
  }
});

test("render job output names include the selected render mode", async () => {
  const slug = `snapshot-render-mode-${Date.now()}`;
  try {
    makeProject(slug);
    createFinalSnapshot(slug);
    const gpu = await prepareRemotionJob(slug, { renderMode: "gpu" });
    const classic = await prepareRemotionJob(slug, { renderMode: "classic" });

    assert.equal(gpu.renderMode, "gpu");
    assert.equal(classic.renderMode, "classic");
    assert.match(path.basename(gpu.outputPath), /-remotion-gpu-/);
    assert.match(path.basename(classic.outputPath), /-remotion-classic-/);
  } finally {
    cleanup(slug);
  }
});

test("render job props include scene-start SFX and BGM", async () => {
  const slug = `snapshot-audio-${Date.now()}`;
  try {
    const root = makeProject(slug, {
      audio: {
        provider: "aimax",
        mainAudio: "",
        voiceVolume: 1,
        bgm: "assets/audio/bgm.mp3",
        bgmVolume: 0.18,
        sceneStartSfx: {
          enabled: true,
          skipFirst: true,
          mode: "pose",
          name: "mixkit-hard-pop-click.wav",
          volume: 0.82,
          offsetMs: 0,
        },
      },
      poseSfx: {
        "point-left": "mixkit-hard-pop-click.wav",
        "point-right": "mixkit-hard-pop-click.wav",
        question: "mixkit-bubble-pop.wav",
      },
    });
    fs.rmSync(path.join(root, "assets", "vo", "full.mp3"), { force: true });
    writeFile(path.join(root, "assets", "vo", "line-1.mp3"), "voice-1");
    writeFile(path.join(root, "assets", "vo", "line-2.mp3"), "voice-2");
    writeFile(path.join(root, "assets", "vo", "line-3.mp3"), "voice-3");
    writeFile(path.join(root, "assets", "vo", "durations.json"), JSON.stringify({
      "line-1": 1.2,
      "line-2": 1.2,
      "line-3": 1.4,
    }));
    writeFile(path.join(root, "assets", "audio", "bgm.mp3"), "bgm");

    createFinalSnapshot(slug);
    const prepared = await prepareRemotionJob(slug);
    const props = JSON.parse(fs.readFileSync(prepared.propsPath, "utf8"));

    assert.equal(prepared.audioSummary.expected, true);
    assert.equal(prepared.audioSummary.voice, 0);
    assert.equal(prepared.audioSummary.voiceClips, 3);
    assert.equal(prepared.audioSummary.sfxClips, 2);
    assert.equal(prepared.audioSummary.bgm, 1);
    assert.deepEqual(props.assets.audioClips.map((clip) => clip.src), [
      "audio/line-1.mp3",
      "audio/line-2.mp3",
      "audio/line-3.mp3",
    ]);
    assert.equal(props.assets.sfxClips.length, 2);
    assert.deepEqual(props.assets.sfxClips.map((clip) => clip.lineId), props.lines.slice(1).map((line) => line.id));
    assert.deepEqual(props.assets.sfxClips.map((clip) => clip.name), ["mixkit-hard-pop-click.wav", "mixkit-bubble-pop.wav"]);
    assert.deepEqual(props.assets.sfxClips.map((clip) => clip.startMs), props.lines.slice(1).map((line) => line.startMs));
    assert.equal(props.assets.bgm, "audio/bgm.mp3");
    assert.ok(fs.existsSync(path.join(prepared.jobDir, "audio", "line-1.mp3")));
    assert.ok(fs.existsSync(path.join(prepared.jobDir, "sfx", "01-mixkit-hard-pop-click.wav")));
    assert.ok(fs.existsSync(path.join(prepared.jobDir, "sfx", "02-mixkit-bubble-pop.wav")));
    assert.ok(fs.existsSync(path.join(prepared.jobDir, "audio", "bgm.mp3")));
  } finally {
    cleanup(slug);
  }
});

test("per-line render timing uses measured audio duration when metadata is short", async () => {
  const slug = `snapshot-measured-audio-${Date.now()}`;
  try {
    const root = makeProject(slug, {
      audio: {
        provider: "aimax",
        mainAudio: "",
        voiceVolume: 1,
        bgm: "",
        bgmVolume: 0.18,
        sceneStartSfx: { enabled: false },
      },
      lines: [
        { id: "line-1", text: "Day la A.", pose: "point-left", start: 0, duration: 0.6, dirtyVoice: false },
        { id: "line-2", text: "Day la B.", pose: "point-right", start: 0.72, duration: 1.2, dirtyVoice: false },
        { id: "line-3", text: "Khac nhau?", pose: "question", start: 2.04, duration: 1.4, dirtyVoice: false },
      ],
    });
    fs.rmSync(path.join(root, "assets", "vo", "full.mp3"), { force: true });
    writeSilentWav(path.join(root, "assets", "vo", "line-1.wav"), 1);
    writeSilentWav(path.join(root, "assets", "vo", "line-2.wav"), 1.2);
    writeSilentWav(path.join(root, "assets", "vo", "line-3.wav"), 1.4);
    writeFile(path.join(root, "assets", "vo", "durations.json"), JSON.stringify({
      "line-1": 0.6,
      "line-2": 1.2,
      "line-3": 1.4,
    }));

    const snapshot = createFinalSnapshot(slug);
    const prepared = await prepareRemotionJob(slug);
    const props = JSON.parse(fs.readFileSync(prepared.propsPath, "utf8"));

    assert.equal(snapshot.props.lines[0].durationMs, 1000);
    assert.equal(props.lines[0].durationMs, 1000);
    assert.equal(props.assets.audioClips[0].durationMs, 1000);
    assert.match(props.srt, /00:00:00,550 --> 00:00:01,550/);
    assert.equal(props.assets.audioClips[0].src, "audio/line-1.wav");
    assert.ok(snapshot.durationInSeconds >= 4.07);
  } finally {
    cleanup(slug);
  }
});

test("render snapshot scene-start SFX ignores line overrides and applies offset and volume", async () => {
  const slug = `snapshot-sfx-logic-${Date.now()}`;
  try {
    makeProject(slug, {
      audio: {
        provider: "uploaded",
        mainAudio: "assets/vo/full.mp3",
        voiceVolume: 1,
        bgm: "",
        bgmVolume: 0.18,
        sceneStartSfx: {
          enabled: true,
          skipFirst: true,
          mode: "pose",
          name: "mixkit-bubble-pop.wav",
          volume: 1.25,
          poseVolumes: {
            "point-left": 1.25,
            "point-right": 0.5,
            question: 0.9,
          },
          offsetMs: 200,
        },
      },
      poseSfx: {
        "point-left": "mixkit-hard-pop-click.wav",
        "point-right": "mixkit-hard-pop-click.wav",
        question: "mixkit-bubble-pop.wav",
      },
      lines: [
        { id: "line-1", text: "Day la A.", pose: "point-left", sfx: "line-pop.wav", start: 0, duration: 1.2, dirtyVoice: false },
        { id: "line-2", text: "Day la B.", pose: "point-right", sfx: "__none__", start: 1.4, duration: 1.2, dirtyVoice: false },
        { id: "line-3", text: "Khac nhau o dau?", pose: "question", sfx: "mixkit-hard-pop-click.wav", start: 2.8, duration: 1.4, dirtyVoice: false },
      ],
    });

    createFinalSnapshot(slug);
    const prepared = await prepareRemotionJob(slug);
    const props = JSON.parse(fs.readFileSync(prepared.propsPath, "utf8"));

    assert.deepEqual(props.assets.sfxClips.map((clip) => clip.lineId), props.lines.slice(1).map((line) => line.id));
    assert.deepEqual(props.assets.sfxClips.map((clip) => clip.name), ["mixkit-hard-pop-click.wav", "mixkit-bubble-pop.wav"]);
    assert.deepEqual(props.assets.sfxClips.map((clip) => clip.startMs), props.lines.slice(1).map((line) => line.startMs + 200));
    assert.deepEqual(props.assets.sfxClips.map((clip) => clip.durationMs), props.lines.slice(1).map((line) => Math.min(1400, Math.max(80, line.durationMs - 200))));
    assert.deepEqual(props.assets.sfxClips.map((clip) => clip.volume), [0.5, 0.9]);
  } finally {
    cleanup(slug);
  }
});

test("cleanup keeps the latest official render and removes stale render artifacts", () => {
  const slug = `snapshot-cleanup-${Date.now()}`;
  try {
    const root = makeProject(slug);
    const rendersDir = path.join(root, "renders");
    fs.mkdirSync(rendersDir, { recursive: true });
    const keep = path.join(rendersDir, `${slug}-remotion-gpu-keep-222.mp4`);
    const stale = path.join(rendersDir, `${slug}-remotion-gpu-old-111.mp4`);
    const staleStem = path.basename(stale, ".mp4");
    const rootStale = path.join(root, `${slug}-legacy.mp4`);
    writeFile(keep, "new");
    writeFile(stale, "old");
    writeFile(path.join(rendersDir, `${staleStem}.verification.json`), "{}");
    writeFile(path.join(rendersDir, `${staleStem}-frame-1.jpg`), "jpg");
    writeFile(rootStale, "legacy");
    writeFile(path.join(root, "poster.jpg"), "asset");

    const removed = cleanupOldRenderArtifacts(root, keep);

    assert.ok(fs.existsSync(keep));
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(path.join(rendersDir, `${staleStem}.verification.json`)), false);
    assert.equal(fs.existsSync(path.join(rendersDir, `${staleStem}-frame-1.jpg`)), false);
    assert.equal(fs.existsSync(rootStale), false);
    assert.ok(fs.existsSync(path.join(root, "poster.jpg")));
    assert.ok(removed.includes(`renders/${path.basename(stale)}`));
    assert.ok(removed.includes(path.basename(rootStale)));
  } finally {
    cleanup(slug);
  }
});
