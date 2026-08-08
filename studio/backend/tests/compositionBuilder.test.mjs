import assert from "node:assert/strict";
import test from "node:test";
import { buildCompositionHtml } from "../services/compositionBuilder.mjs";

test("showdown composition reserves a label strip below full comparison images", () => {
  const html = buildCompositionHtml({
    leftLabel: "Sấm",
    rightLabel: "Chớp",
    lines: [{ id: "line-1", caption: "Đây là Sấm.", pose: "point-left" }],
  }, process.cwd());

  assert.match(html, /class="compare-img"[^>]+src="assets\/compare-left\.png"/);
  assert.match(html, /\.compare-img \{ display: block;[^}]+width: 100%; height: 560px/);
  assert.match(html, /\.label \{ display: flex; flex: 1;/);
  assert.match(html, /--bg: #ffffff/);
  assert.doesNotMatch(html, /<img id="paper-bg"/);
  assert.match(html, /#character-stage \{[^}]+inset: 0[^}]+width: 1080px; height: 1920px/);
  assert.match(html, /\.caption-line span \{[^}]+border: 5px solid var\(--panel-edge\)/);
  assert.doesNotMatch(html, /#glow-top|ghost-word|id="eyebrow"/);
});

test("composition leaves character video sources blank when poses are explicit blank", () => {
  const html = buildCompositionHtml({
    character: { poses: {} },
    lines: [{ id: "line-1", caption: "Free", pose: "point-left" }],
  }, process.cwd());

  assert.doesNotMatch(html, /assets\/character/);
  assert.match(html, /id="pose-point-left"[^>]+src=""/);
});

test("custom raw backgrounds skip texture boost treatment", () => {
  const html = buildCompositionHtml({
    background: {
      type: "image",
      src: "assets/backgrounds/paper.png",
      custom: true,
      treatment: "raw",
      detail: 0,
      shade: 0,
    },
    lines: [{ id: "line-1", caption: "Free", pose: "point-left" }],
  }, process.cwd());

  assert.match(html, /#paper-bg \{[^}]+filter: contrast\(1\) brightness\(1\) saturate\(1\.02\)/);
  assert.match(html, /#paper-bg-boost \{[^}]+opacity: 0/);
  assert.match(html, /rgba\(232, 216, 193, 0\)/);
  assert.match(html, /rgba\(42, 27, 15, 0\)/);
});

test("background blur is passed to rendered background layers", () => {
  const html = buildCompositionHtml({
    background: {
      type: "image",
      src: "assets/backgrounds/paper.png",
      custom: true,
      treatment: "raw",
      detail: 0,
      shade: 0,
      blur: 8,
    },
    lines: [{ id: "line-1", caption: "Free", pose: "point-left" }],
  }, process.cwd());

  assert.match(html, /#paper-bg \{[^}]+filter: contrast\(1\) brightness\(1\) saturate\(1\.02\) blur\(8\.0px\)/);
  assert.match(html, /#paper-bg \{[^}]+transform: scale\(1\.0178\)/);
  assert.match(html, /#paper-bg-boost \{[^}]+filter: contrast\(1\) brightness\(\.94\) saturate\(\.42\) blur\(8\.0px\)/);
});

test("clean photo frame template removes the connector and frame treatment", () => {
  const html = buildCompositionHtml({
    template: { id: "photo-clean-frame-v1" },
    layout: {
      compareLabelUppercase: false,
      photoCompareSize: 420,
    },
    leftLabel: "gạo nếp",
    rightLabel: "gạo tẻ",
    lines: [{ id: "line-1", caption: "Đây là gạo nếp.", pose: "point-left" }],
  }, process.cwd());

  assert.doesNotMatch(html, /<div id="vs">VS<\/div>/);
  assert.match(html, /\.card \{[^}]+border: none; border-radius: 0; background: transparent; box-shadow: none/);
  assert.match(html, /\.label \{[^}]+text-transform: none/);
  assert.match(html, /tl\.set\("#card-left, #card-right"/);
});

test("composition applies custom VS and photo frame colors", () => {
  const html = buildCompositionHtml({
    template: { id: "photo-compare-v1" },
    layout: {
      compareVsColor: "#123456",
      compareVsTextColor: "#abcdef",
      compareVsBorderColor: "#654321",
      photoFrameBorderColor: "#112233",
      photoFrameShadowColor: "#334455",
      photoLabelColor: "#556677",
    },
    leftLabel: "A",
    rightLabel: "B",
    lines: [{ id: "line-1", caption: "Đây là A.", pose: "point-left" }],
  }, process.cwd());

  assert.match(html, /border: 6px solid #112233/);
  assert.match(html, /color: #556677/);
  assert.match(html, /border: 6px solid #654321/);
  assert.match(html, /background: #123456/);
  assert.match(html, /color: #abcdef/);
});

test("comparison content can be placed below images with fully customizable label styling", () => {
  const html = buildCompositionHtml({
    template: { id: "photo-compare-v1" },
    layout: {
      compareLabelPlacement: "below",
      compareLabelAlign: "left",
      compareLabelFontSize: 36,
      compareLabelHeight: 128,
      compareLabelPaddingX: 22,
      compareLabelPaddingY: 14,
      compareLabelColor: "#102030",
      compareLabelBackground: "#123456",
      compareLabelBackgroundOpacity: 0.8,
      compareLabelBorderColor: "#abcdef",
      compareLabelBorderWidth: 4,
      compareLabelRadius: 16,
      compareLabelShadow: "hard",
    },
    leftLabel: "Nội dung A",
    rightLabel: "Nội dung B",
    lines: [{ id: "line-1", caption: "A", pose: "point-left" }],
  }, process.cwd());

  assert.match(html, /\.card \{[^}]+height: 518px/);
  assert.match(html, /\.label \{[^}]+height: 128px[^}]+padding: 14px 22px[^}]+color: #102030[^}]+background: rgba\(18,52,86,0\.8\)[^}]+border: 4px solid #abcdef[^}]+border-radius: 16px[^}]+text-align: left/);
  assert.ok(html.indexOf('id="compare-img-left"') < html.indexOf('id="compare-label-left"'));
});

test("photo template label alignment and styling also apply in the default above-image placement", () => {
  const html = buildCompositionHtml({
    template: { id: "photo-compare-v1" },
    layout: {
      compareLabelAlign: "right",
      compareLabelHeight: 128,
      compareLabelPaddingX: 24,
      compareLabelPaddingY: 16,
      compareLabelBackground: "#203040",
      compareLabelBackgroundOpacity: 0.75,
      compareLabelBorderColor: "#304050",
      compareLabelBorderWidth: 4,
      compareLabelRadius: 18,
      compareLabelShadow: "hard",
    },
    leftLabel: "A",
    rightLabel: "B",
    lines: [{ id: "line-1", caption: "A", pose: "point-left" }],
  }, process.cwd());

  assert.match(html, /\.label \{[^}]+display: flex[^}]+height: 128px[^}]+padding: 16px 24px[^}]+background: rgba\(32,48,64,0\.75\)[^}]+border: 4px solid #304050[^}]+border-radius: 18px[^}]+box-shadow: 8px 8px 0 rgba\(32, 22, 15, 0\.22\)[^}]+text-align: right/);
  assert.match(html, /justify-content: flex-end/);
});

test("comparison label box can be disabled without hiding the label text", () => {
  const html = buildCompositionHtml({
    template: { id: "photo-compare-v1" },
    layout: {
      compareLabelBoxEnabled: false,
      compareLabelBackgroundOpacity: 1,
      compareLabelBorderWidth: 6,
      compareLabelRadius: 18,
      compareLabelShadow: "hard",
    },
    leftLabel: "A",
    rightLabel: "B",
    lines: [{ id: "line-1", caption: "A", pose: "point-left" }],
  }, process.cwd());

  assert.match(html, /\.label \{[^}]+background: transparent; border: 0 solid transparent; border-radius: 0px; box-shadow: none/);
  assert.match(html, /id="compare-label-left" class="label">A/);
});

test("comparison content can be hidden without removing live label targets", () => {
  const html = buildCompositionHtml({
    layout: { compareLabelPlacement: "hidden" },
    leftLabel: "A",
    rightLabel: "B",
    lines: [{ id: "line-1", caption: "A", pose: "point-left" }],
  }, process.cwd());

  assert.match(html, /\.card \{[^}]+height: 560px/);
  assert.match(html, /\.label \{ display: none;/);
  assert.match(html, /id="compare-label-left"/);
  assert.match(html, /id="compare-label-right"/);
});

test("dual compare template applies custom size and vertical offset", () => {
  const html = buildCompositionHtml({
    template: { id: "compare-dual-v1" },
    layout: {
      dualCompareSize: 460,
      dualCompareOffsetY: 120,
    },
    leftLabel: "A",
    rightLabel: "B",
    lines: [{ id: "line-1", caption: "A", pose: "point-left" }],
  }, process.cwd());

  assert.match(html, /\.card \{[^}]+top: 190px;[^}]+width: 460px; height: 570px/);
  assert.match(html, /\.compare-img \{ display: block;[^}]+width: 100%; height: 460px/);
  assert.match(html, /#card-left \{ left: 42px; \}/);
  assert.match(html, /#card-right \{ left: 578px; \}/);
});

test("focus scale template removes VS and animates the focused card", () => {
  const html = buildCompositionHtml({
    template: { id: "focus-scale-v1" },
    layout: {
      focusScaleLarge: 1.24,
      focusScaleSmall: 0.78,
      focusMotionDuration: 0.6,
      focusImageBlur: 4,
      focusImageDarkness: 0.5,
    },
    leftLabel: "A",
    rightLabel: "B",
    lines: [
      { id: "line-1", caption: "A", pose: "point-left" },
      { id: "line-2", caption: "B", pose: "point-right" },
    ],
  }, process.cwd());

  assert.doesNotMatch(html, /<div id="vs">VS<\/div>/);
  assert.match(html, /const focusScaleTemplate = true/);
  assert.match(html, /const focusScaleLarge = 1\.24/);
  assert.match(html, /const focusScaleSmall = 0\.78/);
  assert.match(html, /const focusMotionDuration = 0\.6/);
  assert.match(html, /const focusImageBlur = 4/);
  assert.match(html, /background: rgba\(0, 0, 0, 0\.500\)/);
  assert.match(html, /if \(name === "point-left"\) return "right"/);
  assert.match(html, /if \(name === "point-right"\) return "left"/);
  assert.match(html, /tl\.to\("#card-left", \{ scale: state\.left\.scale/);
  assert.match(html, /tl\.to\("#compare-img-right", \{ filter: "blur\(" \+ imageState\.right\.blur/);
});
