import assert from "node:assert/strict";
import test from "node:test";
import { applyLiveSoundToPreviewProps, buildLineScopedPreviewProps, buildLiveSfxClips, resolveLineSound } from "../../frontend/src/soundPreview.js";

const sounds = [
  { name: "pose-left.wav", label: "Pose left", url: "/shared-assets/sfx/pose-left.wav" },
  { name: "pose-right.wav", label: "Pose right", url: "/shared-assets/sfx/pose-right.wav" },
  { name: "line-pop.wav", label: "Line pop", url: "/shared-assets/sfx/line-pop.wav" },
  { name: "mixkit-hard-pop-click.wav", label: "Hard pop click", url: "/shared-assets/sfx/mixkit-hard-pop-click.wav" },
  { name: "mixkit-bubble-pop.wav", label: "Bubble pop", url: "/shared-assets/sfx/mixkit-bubble-pop.wav" },
];

test("resolveLineSound ignores legacy line override and uses pose map", () => {
  assert.deepEqual(resolveLineSound(
    { id: "line-1", pose: "point-left", sfx: "line-pop.wav" },
    { "point-left": "pose-left.wav" },
    sounds,
  ), {
    name: "pose-left.wav",
    src: "/shared-assets/sfx/pose-left.wav",
    label: "Pose left",
  });

  assert.deepEqual(resolveLineSound(
    { id: "line-1", pose: "point-left", sfx: "" },
    { "point-left": "pose-left.wav" },
    sounds,
  ), {
    name: "pose-left.wav",
    src: "/shared-assets/sfx/pose-left.wav",
    label: "Pose left",
  });

  assert.equal(resolveLineSound(
    { id: "line-1", pose: "point-left", sfx: "line-pop.wav" },
    { "point-left": "__none__" },
    sounds,
  ), null);
});

test("buildLiveSfxClips skips the first scene and plays pose-mapped sounds at later scene starts", () => {
  const props = {
    lines: [
      { id: "line-1", pose: "point-left", sfx: "line-pop.wav", startMs: 1000, durationMs: 1200 },
      { id: "line-2", pose: "point-right", sfx: "__none__", startMs: 2400, durationMs: 900 },
      { id: "line-3", pose: "question", sfx: "line-pop.wav", startMs: 3400, durationMs: 900 },
    ],
    assets: {
      sfxClips: [{ lineId: "line-1", name: "old.wav", src: "/old.wav", startMs: 1000, durationMs: 400, volume: 0.5 }],
    },
  };
  const config = {
    audio: {
      sceneStartSfx: {
        enabled: true,
        skipFirst: true,
        name: "mixkit-hard-pop-click.wav",
        volume: 0.82,
        poseVolumes: {
          "point-left": 0.82,
          "point-right": 0.4,
          question: 1.1,
        },
        offsetMs: 0,
      },
    },
    poseSfx: {
      "point-left": "pose-left.wav",
      "point-right": "pose-right.wav",
      question: "mixkit-bubble-pop.wav",
    },
  };

  const clips = buildLiveSfxClips(props, config, sounds);

  assert.deepEqual(clips.map((clip) => ({
    lineId: clip.lineId,
    name: clip.name,
    src: clip.src,
    startMs: clip.startMs,
    durationMs: clip.durationMs,
    volume: clip.volume,
  })), [
    {
      lineId: "line-2",
      name: "pose-right.wav",
      src: "/shared-assets/sfx/pose-right.wav",
      startMs: 2400,
      durationMs: 900,
      volume: 0.4,
    },
    {
      lineId: "line-3",
      name: "mixkit-bubble-pop.wav",
      src: "/shared-assets/sfx/mixkit-bubble-pop.wav",
      startMs: 3400,
      durationMs: 900,
      volume: 1.1,
    },
  ]);
});

test("buildLiveSfxClips skips poses mapped to no sound", () => {
  const props = {
    lines: [
      { id: "line-1", pose: "point-left", startMs: 1000, durationMs: 1200 },
      { id: "line-2", pose: "point-right", startMs: 2400, durationMs: 900 },
      { id: "line-3", pose: "question", startMs: 3400, durationMs: 900 },
    ],
    assets: { sfxClips: [] },
  };
  const config = {
    audio: {
      sceneStartSfx: {
        enabled: true,
        skipFirst: true,
        volume: 0.82,
        offsetMs: 0,
      },
    },
    poseSfx: {
      "point-left": "pose-left.wav",
      "point-right": "__none__",
      question: "mixkit-bubble-pop.wav",
    },
  };

  const clips = buildLiveSfxClips(props, config, sounds);

  assert.deepEqual(clips.map((clip) => [clip.lineId, clip.name]), [["line-3", "mixkit-bubble-pop.wav"]]);
});

test("applyLiveSoundToPreviewProps replaces stale backend SFX clips with scene-start clips", () => {
  const props = {
    lines: [
      { id: "line-1", pose: "point-left", startMs: 500, durationMs: 800 },
      { id: "line-2", pose: "point-right", startMs: 1800, durationMs: 900 },
    ],
    assets: {
      background: "/background.png",
      sfxClips: [{ lineId: "line-1", name: "old.wav", src: "/old.wav", startMs: 500, durationMs: 800, volume: 0.82 }],
    },
  };
  const config = {
    audio: {
      sceneStartSfx: {
        enabled: true,
        skipFirst: true,
        name: "mixkit-hard-pop-click.wav",
        volume: 0.82,
        offsetMs: 0,
      },
    },
    poseSfx: {
      "point-left": "pose-left.wav",
      "point-right": "pose-right.wav",
      question: "mixkit-bubble-pop.wav",
    },
  };

  const next = applyLiveSoundToPreviewProps(props, config, sounds);

  assert.equal(next.assets.background, "/background.png");
  assert.deepEqual(next.assets.sfxClips.map((clip) => clip.lineId), ["line-2"]);
  assert.deepEqual(next.assets.sfxClips.map((clip) => clip.name), ["pose-right.wav"]);
});

test("buildLineScopedPreviewProps keeps the current scene-start sound after the 120ms preroll", () => {
  const props = {
    lines: [
      { id: "line-1", pose: "point-left", startMs: 1000, durationMs: 1200, text: "Line one" },
      { id: "line-2", pose: "point-right", startMs: 2400, durationMs: 900, text: "Line two" },
    ],
    assets: {
      audio: "",
      audioClips: [],
      sfxClips: [{ lineId: "line-2", name: "pose-right.wav", src: "/shared-assets/sfx/pose-right.wav", startMs: 2400, durationMs: 900, volume: 0.82 }],
    },
  };
  const config = {
    audio: {
      sceneStartSfx: {
        enabled: true,
        skipFirst: true,
        name: "mixkit-hard-pop-click.wav",
        volume: 0.82,
        offsetMs: 0,
      },
    },
    poseSfx: {
      "point-left": "pose-left.wav",
      "point-right": "pose-right.wav",
      question: "mixkit-bubble-pop.wav",
    },
  };

  const preview = buildLineScopedPreviewProps(applyLiveSoundToPreviewProps(props, config, sounds), 1);

  assert.equal(preview.previewMode, "line");
  assert.equal(preview.lines[0].startMs, 0);
  assert.equal(preview.assets.sfxClips.length, 1);
  assert.equal(preview.assets.sfxClips[0].startMs, 120);
  assert.equal(preview.assets.sfxClips[0].trimBeforeMs, 0);
  assert.equal(preview.assets.sfxClips[0].lineId, "line-2");
});
