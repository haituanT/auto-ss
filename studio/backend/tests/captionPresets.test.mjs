import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { CAPTION_FONT_OPTIONS } from "../../../shared/captionOptions.mjs";
import { CAPTION_PRESETS, applyCaptionPreset } from "../../../shared/captionPresets.mjs";
import { SHARED_ASSETS_DIR } from "../paths.mjs";

const NEW_VIETNAMESE_FONT_FAMILIES = [
  "Nata Sans",
  "Public Sans",
  "Noto Sans",
  "Baloo 2",
  "Chakra Petch",
  "Bungee",
  "Freeman",
  "Bricolage Grotesque",
];

test("new Vietnamese-safe caption fonts are cataloged with local files", () => {
  for (const family of NEW_VIETNAMESE_FONT_FAMILIES) {
    const font = CAPTION_FONT_OPTIONS.find((option) => option.family === family);
    assert.ok(font, `${family} should be in CAPTION_FONT_OPTIONS`);
    assert.equal(fs.existsSync(path.join(SHARED_ASSETS_DIR, "fonts", font.file)), true);
  }
});

test("Vietnamese caption presets point to cataloged fonts", () => {
  const catalogFamilies = new Set(CAPTION_FONT_OPTIONS.map((font) => font.family));
  const presets = CAPTION_PRESETS.filter((preset) => preset.id.startsWith("vn-"));

  assert.equal(presets.length, 6);
  for (const preset of presets) {
    assert.equal(catalogFamilies.has(preset.fontFamily), true, `${preset.id} font should be cataloged`);
  }
});

test("applying a caption preset does not touch voice timing or audio clips", () => {
  const draft = {
    caption: {
      style: "vietnam-bold-highlight",
      animation: "line-pop",
      fontFamily: "Be Vietnam Pro",
      fontSize: 72,
      normalColor: "#20160f",
      hotColor: "#ff4f2f",
      strokeColor: "#fffaf0",
    },
    layout: {
      captionY: 790,
      captionYExplicit: true,
      characterY: 1180,
    },
    character: {
      captionFontFamily: "Be Vietnam Pro",
      scale: 1.15,
    },
    lines: [
      {
        id: "line-1",
        text: "Đây là tiếng Việt",
        start: 0.55,
        duration: 1.6,
        words: [
          { text: "Đây", startMs: 550, endMs: 820 },
          { text: "là", startMs: 820, endMs: 1040 },
          { text: "tiếng", startMs: 1040, endMs: 1360 },
          { text: "Việt", startMs: 1360, endMs: 1900 },
        ],
      },
    ],
    assets: {
      audioClips: [{ lineId: "line-1", src: "assets/vo/line-1.mp3", startMs: 550, durationMs: 1600 }],
      sfxClips: [{ lineId: "line-1", src: "assets/sfx/pop.wav", startMs: 540, durationMs: 240 }],
    },
  };
  const beforeLines = structuredClone(draft.lines);
  const beforeAssets = structuredClone(draft.assets);
  const preset = CAPTION_PRESETS.find((item) => item.id === "vn-capcut-public");

  applyCaptionPreset(draft, preset);

  assert.deepEqual(draft.lines, beforeLines);
  assert.deepEqual(draft.assets, beforeAssets);
  assert.equal(draft.caption.fontFamily, "Public Sans");
  assert.equal(draft.caption.animation, "word-color");
  assert.equal(draft.caption.uppercase, true);
  assert.equal(draft.layout.captionY, 900);
  assert.equal(draft.character.captionFontFamily, "Public Sans");
});
