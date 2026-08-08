import test from "node:test";
import assert from "node:assert/strict";
import { APP_VERSION } from "../../../shared/appVersion.mjs";
import { defaultProjectConfig, normalizeProjectConfig } from "../services/projectConfig.mjs";

test("app version export matches the 0.1.44 release", () => {
  assert.equal(APP_VERSION, "0.1.44");
});

test("a new comparison project starts from blank A/B image slots", () => {
  const config = defaultProjectConfig({
    slug: "template-smoke",
    leftLabel: "Ly than",
    rightLabel: "Ly hon",
  });

  assert.equal(config.template.id, "compare-dual-v1");
  assert.equal(config.savedTemplateRef, null);
  assert.equal(config.compare.leftImage, "");
  assert.equal(config.compare.rightImage, "");

  const normalized = normalizeProjectConfig(config, config.slug);
  assert.equal(normalized.compare.leftImage, "");
  assert.equal(normalized.compare.rightImage, "");
});

test("explicit blank character poses stay blank while legacy configs keep defaults", () => {
  const blank = normalizeProjectConfig({
    character: { poses: {} },
  }, "blank-character");
  const legacy = normalizeProjectConfig({
    character: { scale: 1.1 },
  }, "legacy-character");

  assert.deepEqual(blank.character.poses, {});
  assert.equal(legacy.character.poses["point-left"], "assets/character/point-left.webm");
});

test("explicit blank comparison labels stay blank", () => {
  const normalized = normalizeProjectConfig({
    slug: "blank-labels",
    compare: { leftLabel: "", rightLabel: "" },
    compareSets: [
      { id: "compare-1", leftLabel: "", rightLabel: "" },
      { id: "compare-2", leftLabel: "", rightLabel: "" },
    ],
  }, "blank-labels");

  assert.equal(normalized.leftLabel, "");
  assert.equal(normalized.rightLabel, "");
  assert.equal(normalized.compare.leftLabel, "");
  assert.equal(normalized.compare.rightLabel, "");
  assert.equal(normalized.compareSets[0].leftLabel, "");
  assert.equal(normalized.compareSets[0].rightLabel, "");
  assert.equal(normalized.compareSets[1].leftLabel, "");
  assert.equal(normalized.compareSets[1].rightLabel, "");
});

test("saved template refs are normalized separately from layout templates", () => {
  const config = normalizeProjectConfig({
    template: { id: "photo-compare-v1" },
    savedTemplateRef: {
      type: "full",
      id: "my-saved-template",
      name: "My Saved Template",
      version: 3,
      linkedAt: "2026-07-30T00:00:00.000Z",
    },
  }, "saved-template-ref");

  assert.equal(config.template.id, "photo-compare-v1");
  assert.deepEqual(config.savedTemplateRef, {
    type: "full",
    id: "my-saved-template",
    name: "My Saved Template",
    version: 3,
    linkedAt: "2026-07-30T00:00:00.000Z",
  });
});

test("an old project keeps its existing comparison image paths", () => {
  const normalized = normalizeProjectConfig({
    slug: "existing-project",
    compare: {
      leftLabel: "A",
      rightLabel: "B",
      leftImage: "assets/compare/left.png",
      rightImage: "assets/compare/right.png",
    },
  }, "existing-project");

  assert.equal(normalized.compare.leftImage, "assets/compare/left.png");
  assert.equal(normalized.compare.rightImage, "assets/compare/right.png");
});

test("legacy projects get a clean pipeline state", () => {
  const normalized = normalizeProjectConfig({
    slug: "legacy-without-pipeline",
    lines: [{ id: "line-1", text: "Old project line" }],
  }, "legacy-without-pipeline");

  assert.deepEqual(normalized.pipeline, {
    dirty: {
      content: false,
      audio: false,
      assets: false,
      style: false,
      layout: false,
      render: false,
    },
    dirtyReasons: [],
    officialSnapshot: {
      propsHash: "",
      assetManifestHash: "",
      createdAt: "",
    },
  });
});

test("pipeline state is normalized without losing official snapshot metadata", () => {
  const normalized = normalizeProjectConfig({
    slug: "pipeline-normalize",
    pipeline: {
      dirty: {
        content: 1,
        render: true,
        unknown: true,
      },
      dirtyReasons: ["content", "render", "content", ""],
      officialSnapshot: {
        propsHash: "props-123",
        assetManifestHash: "assets-456",
        createdAt: "2026-07-31T00:00:00.000Z",
      },
    },
  }, "pipeline-normalize");

  assert.equal(normalized.pipeline.dirty.content, true);
  assert.equal(normalized.pipeline.dirty.audio, false);
  assert.equal(normalized.pipeline.dirty.render, true);
  assert.deepEqual(normalized.pipeline.dirtyReasons, ["content", "render"]);
  assert.deepEqual(normalized.pipeline.officialSnapshot, {
    propsHash: "props-123",
    assetManifestHash: "assets-456",
    createdAt: "2026-07-31T00:00:00.000Z",
  });
});

test("old projects get a safe disabled logo config", () => {
  const normalized = normalizeProjectConfig({
    slug: "legacy-without-logo",
  }, "legacy-without-logo");

  assert.deepEqual(normalized.logo, {
    enabled: false,
    src: "",
    width: 110,
    anchor: "bottom-left",
    x: 32,
    y: -72,
    opacity: 0.9,
    layer: "above-character",
    backdrop: false,
  });
});

test("logo settings are clamped and restricted to supported values", () => {
  const normalized = normalizeProjectConfig({
    logo: {
      enabled: true,
      src: "assets\\logo\\logo.png",
      width: 9999,
      anchor: "middle-side",
      x: -9999,
      y: 9999,
      opacity: 9,
      layer: "over-everything",
      backdrop: true,
    },
  }, "logo-clamp");

  assert.equal(normalized.logo.enabled, true);
  assert.equal(normalized.logo.src, "assets/logo/logo.png");
  assert.equal(normalized.logo.width, 700);
  assert.equal(normalized.logo.anchor, "bottom-left");
  assert.equal(normalized.logo.x, -540);
  assert.equal(normalized.logo.y, 960);
  assert.equal(normalized.logo.opacity, 1);
  assert.equal(normalized.logo.layer, "above-character");
  assert.equal(normalized.logo.backdrop, true);
});

test("a legacy logo string enables the logo source", () => {
  const normalized = normalizeProjectConfig({
    logo: "assets/logo/legacy.png",
  }, "logo-string");

  assert.equal(normalized.logo.enabled, true);
  assert.equal(normalized.logo.src, "assets/logo/legacy.png");
  assert.equal(normalized.logo.backdrop, false);
});

test("scene start SFX deep-merges defaults and normalizes legacy names", () => {
  const normalized = normalizeProjectConfig({
    audio: {
      sceneStartSfx: {
        name: "transition-pop.mp3",
        volume: 1.7,
      },
    },
  }, "scene-start-sfx");

  assert.deepEqual(normalized.audio.sceneStartSfx, {
    enabled: true,
    skipFirst: true,
    mode: "pose",
    name: "popular-riser-metallic-sound-effect.wav",
    volume: 1.5,
    poseVolumes: {
      "point-left": 1.5,
      "point-right": 1.5,
      question: 1.5,
    },
    offsetMs: 0,
  });

  const blankName = normalizeProjectConfig({
    audio: { sceneStartSfx: { name: "" } },
  }, "scene-start-sfx-blank");
  assert.equal(blankName.audio.sceneStartSfx.name, "mixkit-hard-pop-click.wav");
});

test("the fixed photo template is preserved with crop settings", () => {
  const config = normalizeProjectConfig({
    slug: "photo-template",
    template: { id: "photo-compare-v1" },
    compare: {
      leftCrop: { x: 12, y: -8, rotation: 90 },
      rightCrop: { x: -4, y: 5, rotation: 0 },
    },
  }, "photo-template");

  assert.equal(config.template.id, "photo-compare-v1");
  assert.deepEqual(config.compare.leftCrop, { x: 12, y: -8, rotation: 90 });
  assert.deepEqual(config.compare.rightCrop, { x: -4, y: 5, rotation: 0 });
});

test("region crop settings are preserved and clamped", () => {
  const config = normalizeProjectConfig({
    slug: "region-crop-template",
    template: { id: "photo-compare-v1" },
    compare: {
      leftCrop: { mode: "region", x: 0.18, y: 0.12, width: 0.55, height: 0.55, rotation: 90 },
      rightCrop: { mode: "region", x: 0.9, y: 0.9, width: 0.4, height: 0.4, rotation: 0 },
    },
  }, "region-crop-template");

  assert.deepEqual(config.compare.leftCrop, { mode: "region", x: 0.18, y: 0.12, width: 0.55, height: 0.55, rotation: 90 });
  assert.deepEqual(config.compare.rightCrop, { mode: "region", x: 0.6, y: 0.6, width: 0.4, height: 0.4, rotation: 0 });
});

test("the clean photo frame template is preserved with label casing settings", () => {
  const config = normalizeProjectConfig({
    slug: "clean-photo-template",
    template: { id: "photo-clean-frame-v1" },
    layout: {
      compareLabelUppercase: false,
      photoCompareSize: 460,
      photoCompareOffsetY: 50,
    },
  }, "clean-photo-template");

  assert.equal(config.template.id, "photo-clean-frame-v1");
  assert.equal(config.layout.compareLabelUppercase, false);
  assert.equal(config.layout.photoCompareSize, 460);
  assert.equal(config.layout.photoCompareOffsetY, 50);
});

test("comparison labels stay uppercase by default for existing projects", () => {
  const config = normalizeProjectConfig({}, "default-label-casing");

  assert.equal(config.layout.compareLabelUppercase, true);
});

test("layout color controls keep defaults and preserve custom colors", () => {
  const defaults = normalizeProjectConfig({}, "default-layout-colors");
  const custom = normalizeProjectConfig({
    layout: {
      compareVsColor: "#123456",
      compareVsTextColor: "#abcdef",
      compareVsBorderColor: "#654321",
      photoFrameBorderColor: "#112233",
      photoFrameShadowColor: "#334455",
      photoLabelColor: "#556677",
    },
  }, "custom-layout-colors");

  assert.equal(defaults.layout.compareVsColor, "#ff4f2f");
  assert.equal(defaults.layout.compareVsTextColor, "#fffdf8");
  assert.equal(defaults.layout.compareVsBorderColor, "#20160f");
  assert.equal(defaults.layout.photoFrameBorderColor, "#20160f");
  assert.equal(defaults.layout.photoFrameShadowColor, "#20160f");
  assert.equal(defaults.layout.photoLabelColor, "#20160f");
  assert.equal(custom.layout.compareVsColor, "#123456");
  assert.equal(custom.layout.compareVsTextColor, "#abcdef");
  assert.equal(custom.layout.compareVsBorderColor, "#654321");
  assert.equal(custom.layout.photoFrameBorderColor, "#112233");
  assert.equal(custom.layout.photoFrameShadowColor, "#334455");
  assert.equal(custom.layout.photoLabelColor, "#556677");
});

test("comparison label placement and styling normalize with safe bounds", () => {
  const defaults = normalizeProjectConfig({}, "default-compare-label-style");
  const custom = normalizeProjectConfig({
    layout: {
      compareLabelPlacement: "below",
      compareLabelBoxEnabled: false,
      compareLabelAlign: "right",
      compareLabelFontSize: 44,
      compareLabelHeight: 130,
      compareLabelPaddingX: 24,
      compareLabelPaddingY: 12,
      compareLabelColor: "#102030",
      compareLabelBackground: "#203040",
      compareLabelBackgroundOpacity: 0.75,
      compareLabelBorderColor: "#304050",
      compareLabelBorderWidth: 4,
      compareLabelRadius: 18,
      compareLabelShadow: "hard",
    },
  }, "custom-compare-label-style");
  const clamped = normalizeProjectConfig({
    layout: {
      compareLabelPlacement: "not-supported",
      compareLabelAlign: "diagonal",
      compareLabelFontSize: 999,
      compareLabelHeight: 999,
      compareLabelBackgroundOpacity: 4,
      compareLabelBorderWidth: -4,
      compareLabelRadius: 999,
      compareLabelShadow: "glow",
    },
  }, "clamped-compare-label-style");

  assert.equal(defaults.layout.compareLabelPlacement, "auto");
  assert.equal(defaults.layout.compareLabelBoxEnabled, true);
  assert.equal(defaults.layout.compareLabelAlign, "center");
  assert.equal(defaults.layout.compareLabelHeight, 110);
  assert.equal(custom.layout.compareLabelPlacement, "below");
  assert.equal(custom.layout.compareLabelBoxEnabled, false);
  assert.equal(custom.layout.compareLabelAlign, "right");
  assert.equal(custom.layout.compareLabelFontSize, 44);
  assert.equal(custom.layout.compareLabelHeight, 130);
  assert.equal(custom.layout.compareLabelColor, "#102030");
  assert.equal(custom.layout.compareLabelBackgroundOpacity, 0.75);
  assert.equal(custom.layout.compareLabelBorderWidth, 4);
  assert.equal(custom.layout.compareLabelRadius, 18);
  assert.equal(custom.layout.compareLabelShadow, "hard");
  assert.equal(clamped.layout.compareLabelPlacement, "auto");
  assert.equal(clamped.layout.compareLabelAlign, "center");
  assert.equal(clamped.layout.compareLabelFontSize, 96);
  assert.equal(clamped.layout.compareLabelHeight, 220);
  assert.equal(clamped.layout.compareLabelBackgroundOpacity, 1);
  assert.equal(clamped.layout.compareLabelBorderWidth, 0);
  assert.equal(clamped.layout.compareLabelRadius, 32);
  assert.equal(clamped.layout.compareLabelShadow, "none");
});

test("custom backgrounds default to raw treatment unless adjusted", () => {
  const defaults = normalizeProjectConfig({}, "default-background-treatment");
  const uploadedLegacy = normalizeProjectConfig({
    background: {
      type: "image",
      src: "assets/backgrounds/paper.png",
      custom: true,
      detail: 1.15,
      shade: 0.1,
    },
  }, "custom-background-legacy");
  const adjusted = normalizeProjectConfig({
    background: {
      type: "image",
      src: "assets/backgrounds/paper.png",
      custom: true,
      detail: 0.45,
      shade: 0.03,
      blur: 7,
    },
  }, "custom-background-adjusted");

  assert.equal(defaults.background.type, "color");
  assert.equal(defaults.background.src, "");
  assert.equal(defaults.background.color, "#ffffff");
  assert.equal(defaults.background.treatment, "raw");
  assert.equal(defaults.background.detail, 0);
  assert.equal(defaults.background.shade, 0);
  assert.equal(defaults.background.blur, 0);
  assert.equal(uploadedLegacy.background.treatment, "raw");
  assert.equal(uploadedLegacy.background.detail, 0);
  assert.equal(uploadedLegacy.background.shade, 0);
  assert.equal(uploadedLegacy.background.blur, 0);
  assert.equal(adjusted.background.treatment, "enhanced");
  assert.equal(adjusted.background.detail, 0.45);
  assert.equal(adjusted.background.shade, 0.03);
  assert.equal(adjusted.background.blur, 7);
});

test("focus scale template is preserved with motion settings", () => {
  const defaults = normalizeProjectConfig({
    template: { id: "focus-scale-v1" },
  }, "focus-scale-defaults");
  const custom = normalizeProjectConfig({
    template: { id: "focus-scale-v1" },
    layout: {
      focusScaleLarge: 1.26,
      focusScaleSmall: 0.76,
      focusMotionDuration: 0.65,
      focusImageBlur: 4.5,
      focusImageDarkness: 0.45,
    },
  }, "focus-scale-custom");
  const clamped = normalizeProjectConfig({
    template: { id: "focus-scale-v1" },
    layout: {
      focusScaleLarge: 2,
      focusScaleSmall: 0.2,
      focusMotionDuration: 4,
      focusImageBlur: 20,
      focusImageDarkness: 2,
    },
  }, "focus-scale-clamped");

  assert.equal(defaults.template.id, "focus-scale-v1");
  assert.equal(defaults.layout.focusScaleLarge, 1.18);
  assert.equal(defaults.layout.focusScaleSmall, 0.82);
  assert.equal(defaults.layout.focusMotionDuration, 0.5);
  assert.equal(defaults.layout.focusImageBlur, 2.5);
  assert.equal(defaults.layout.focusImageDarkness, 0.35);
  assert.equal(custom.layout.focusScaleLarge, 1.26);
  assert.equal(custom.layout.focusScaleSmall, 0.76);
  assert.equal(custom.layout.focusMotionDuration, 0.65);
  assert.equal(custom.layout.focusImageBlur, 4.5);
  assert.equal(custom.layout.focusImageDarkness, 0.45);
  assert.equal(clamped.layout.focusScaleLarge, 1.35);
  assert.equal(clamped.layout.focusScaleSmall, 0.65);
  assert.equal(clamped.layout.focusMotionDuration, 1);
  assert.equal(clamped.layout.focusImageBlur, 8);
  assert.equal(clamped.layout.focusImageDarkness, 0.7);
});

test("untouched legacy caption position moves above the character", () => {
  const migrated = normalizeProjectConfig({ layout: { captionY: 900 } }, "legacy-caption");
  const manual = normalizeProjectConfig({ layout: { captionY: 900, captionYExplicit: true } }, "manual-caption");

  assert.equal(migrated.layout.captionY, 810);
  assert.equal(manual.layout.captionY, 900);
});

test("caption presets keep the selected Remotion visual style", () => {
  for (const style of ["karaoke-pill", "clean-outline", "impact-pop", "soft-box", "neon-glow", "capcut-karaoke"]) {
    const config = normalizeProjectConfig({ caption: { style } }, `caption-${style}`);
    assert.equal(config.caption.style, style);
  }
});

test("capcut karaoke caption settings are normalized", () => {
  const config = normalizeProjectConfig({
    caption: {
      style: "capcut-karaoke",
      animation: "word-color",
      fontFamily: "Anton",
      strokeWidth: 12,
      wordGap: 8,
      uppercase: true,
      shadowPreset: "capcut-heavy",
    },
  }, "caption-capcut");

  assert.equal(config.caption.style, "capcut-karaoke");
  assert.equal(config.caption.animation, "word-color");
  assert.equal(config.caption.fontFamily, "Anton");
  assert.equal(config.caption.strokeWidth, 12);
  assert.equal(config.caption.wordGap, 8);
  assert.equal(config.caption.uppercase, true);
  assert.equal(config.caption.shadowPreset, "capcut-heavy");
});

test("caption font and stroke fallbacks stay safe", () => {
  const unknownFont = normalizeProjectConfig({
    caption: { fontFamily: "Missing Font", strokeWidth: 40, wordGap: 90 },
  }, "caption-unknown-font");
  const thinStroke = normalizeProjectConfig({
    caption: { strokeWidth: 1, wordGap: -12 },
  }, "caption-thin-stroke");

  assert.equal(unknownFont.caption.fontFamily, "Be Vietnam Pro");
  assert.equal(unknownFont.caption.strokeWidth, 18);
  assert.equal(unknownFont.caption.wordGap, 32);
  assert.equal(thinStroke.caption.strokeWidth, 4);
  assert.equal(thinStroke.caption.wordGap, 0);
});

test("caption font catalog normalizes new Vietnamese-safe fonts", () => {
  for (const family of [
    "Lexend",
    "Nata Sans",
    "Public Sans",
    "Noto Sans",
    "Baloo 2",
    "Chakra Petch",
    "Bungee",
    "Freeman",
    "Bricolage Grotesque",
  ]) {
    const config = normalizeProjectConfig({
      caption: { fontFamily: family },
    }, `caption-${family.toLowerCase().replace(/\s+/g, "-")}`);

    assert.equal(config.caption.fontFamily, family);
    assert.equal(config.character.captionFontFamily, family);
  }
});

test("render preferred mode is normalized with GPU as fallback", () => {
  const classic = normalizeProjectConfig({ render: { preferredMode: "classic" } }, "render-classic");
  const invalid = normalizeProjectConfig({ render: { preferredMode: "software" } }, "render-invalid");

  assert.equal(classic.render.preferredMode, "classic");
  assert.equal(invalid.render.preferredMode, "gpu");
});

test("audio alignment provider is normalized without changing AIMAX provider", () => {
  const aligned = normalizeProjectConfig({ audio: { alignmentProvider: "elevenlabs" } }, "align-elevenlabs");
  const invalid = normalizeProjectConfig({ audio: { provider: "aimax", alignmentProvider: "other" } }, "align-invalid");

  assert.equal(aligned.audio.provider, "aimax");
  assert.equal(aligned.audio.alignmentProvider, "elevenlabs");
  assert.equal(invalid.audio.alignmentProvider, "none");
});

test("photo comparison size is clamped to the supported range", () => {
  const tooSmall = normalizeProjectConfig({ layout: { photoCompareSize: 120 } }, "small-photo");
  const tooLarge = normalizeProjectConfig({ layout: { photoCompareSize: 700 } }, "large-photo");
  const custom = normalizeProjectConfig({ layout: { photoCompareSize: 470 } }, "custom-photo");

  assert.equal(tooSmall.layout.photoCompareSize, 340);
  assert.equal(tooLarge.layout.photoCompareSize, 500);
  assert.equal(custom.layout.photoCompareSize, 470);
});

test("photo comparison vertical offset is clamped to the supported range", () => {
  const tooHigh = normalizeProjectConfig({ layout: { photoCompareOffsetY: -200 } }, "high-photo");
  const tooLow = normalizeProjectConfig({ layout: { photoCompareOffsetY: 400 } }, "low-photo");
  const custom = normalizeProjectConfig({ layout: { photoCompareOffsetY: 80 } }, "custom-photo-y");

  assert.equal(tooHigh.layout.photoCompareOffsetY, -80);
  assert.equal(tooLow.layout.photoCompareOffsetY, 220);
  assert.equal(custom.layout.photoCompareOffsetY, 80);
});

test("character transparency warnings are preserved in project data", () => {
  const config = normalizeProjectConfig({
    character: {
      poseWarnings: {
        "point-left": "PNG needs alpha",
      },
    },
  }, "character-warning");

  assert.equal(config.character.poseWarnings["point-left"], "PNG needs alpha");
  assert.equal(config.character.poseWarnings.question, undefined);
});
