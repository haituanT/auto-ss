import fs from "node:fs";
import path from "node:path";
import { TIMELINE_START_SECONDS, lineGapAfterSeconds } from "./linePlanner.mjs";
import { readDurations } from "./voiceTiming.mjs";

const PHOTO_LAYOUT_TEMPLATE_IDS = new Set(["photo-compare-v1", "photo-clean-frame-v1"]);
const COMPARE_DUAL_TEMPLATE_ID = "compare-dual-v1";
const CLEAN_PHOTO_TEMPLATE_ID = "photo-clean-frame-v1";
const FOCUS_SCALE_TEMPLATE_ID = "focus-scale-v1";

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function hasOwnValue(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function labelFromSource(source, key, fallback) {
  return hasOwnValue(source, key) ? String(source[key] ?? "") : fallback;
}

function hexToRgba(value, alpha = 1) {
  const match = String(value || "").trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return `rgba(23,20,17,${alpha})`;
  const hex = match[1];
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}

function timing(lines, durations) {
  let cursor = TIMELINE_START_SECONDS;
  return lines.map((line, index) => {
    const explicitStart = Number(line.start);
    const explicitDuration = Number(line.duration);
    const hasExplicitTiming = Number.isFinite(explicitStart) && explicitStart >= 0 && Number.isFinite(explicitDuration) && explicitDuration > 0;
    const dur = hasExplicitTiming ? explicitDuration : Number(durations[line.id]) || 2.2;
    const start = hasExplicitTiming ? explicitStart : cursor;
    const item = { ...line, start: Number(start.toFixed(3)), dur: Number(dur.toFixed(3)) };
    cursor = start + dur + lineGapAfterSeconds(index);
    return item;
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function compareLabelPlacementForTemplate(value, isPhotoTemplate) {
  const requested = ["auto", "below", "above", "overlay", "hidden"].includes(String(value || "").toLowerCase())
    ? String(value || "").toLowerCase()
    : "auto";
  if (requested !== "auto") return requested;
  return isPhotoTemplate ? "legacy-above" : "below";
}

function compareLabelShadow(value) {
  if (value === "soft") return "0 8px 18px rgba(32, 22, 15, 0.16)";
  if (value === "hard") return "8px 8px 0 rgba(32, 22, 15, 0.22)";
  return "none";
}

function characterSource(config, pose) {
  return String(config.character?.poses?.[pose] || "").replace(/\\/g, "/");
}

function compareSetsForHtml(config) {
  const sets = Array.isArray(config.compareSets) && config.compareSets.length
    ? config.compareSets
    : [{ id: "compare-1", ...(config.compare || {}), leftLabel: config.leftLabel, rightLabel: config.rightLabel }];
  return Object.fromEntries(["compare-1", "compare-2"].map((id) => {
    const set = sets.find((item) => item.id === id) || {};
    const fallbackLeft = labelFromSource(config, "leftLabel", "A");
    const fallbackRight = labelFromSource(config, "rightLabel", "B");
    return [id, {
      leftLabel: labelFromSource(set, "leftLabel", fallbackLeft),
      rightLabel: labelFromSource(set, "rightLabel", fallbackRight),
      leftImage: set.leftImage || (id === "compare-1" ? "assets/compare-left.png" : ""),
      rightImage: set.rightImage || (id === "compare-1" ? "assets/compare-right.png" : ""),
      leftZoom: Number(set.leftZoom) || 1,
      rightZoom: Number(set.rightZoom) || 1,
      leftCrop: set.leftCrop || {},
      rightCrop: set.rightCrop || {},
    }];
  }));
}

export function buildCompositionHtml(config, root) {
  const lines = Array.isArray(config.lines) ? config.lines : [];
  const timed = timing(lines, readDurations(root));
  const last = timed[timed.length - 1] || { start: 0.55, dur: 3 };
  const audioDuration = Number(config.audioDuration) || 0;
  const rootDuration = Number(Math.max(last.start + last.dur + 1.5, audioDuration + 0.2).toFixed(2));
  const templateId = config.template?.id || COMPARE_DUAL_TEMPLATE_ID;
  const isPhotoTemplate = PHOTO_LAYOUT_TEMPLATE_IDS.has(templateId);
  const isCleanPhotoTemplate = templateId === CLEAN_PHOTO_TEMPLATE_ID;
  const isFocusScaleTemplate = templateId === FOCUS_SCALE_TEMPLATE_ID;
  const isDualTemplate = templateId === COMPARE_DUAL_TEMPLATE_ID || (!isPhotoTemplate && !isFocusScaleTemplate);
  const photoCompareSize = clamp(Math.round(Number(config.layout?.photoCompareSize) || 390), 340, 500);
  const photoCompareOffsetY = clamp(Math.round(Number(config.layout?.photoCompareOffsetY) || 0), -80, 220);
  const photoSideInset = clamp(Math.round((1080 - (photoCompareSize * 2) - 40) / 2), 24, 100);
  const hasDualCompareSize = Number.isFinite(Number(config.layout?.dualCompareSize));
  const dualCompareSize = clamp(Math.round(Number(config.layout?.dualCompareSize) || 410), 340, 500);
  const dualCompareOffsetY = clamp(Math.round(Number(config.layout?.dualCompareOffsetY) || 0), -80, 220);
  const dualSideInset = clamp(Math.round((1080 - (dualCompareSize * 2) - 76) / 2), 24, 180);
  const useDualCompareSize = isDualTemplate && hasDualCompareSize;
  const cardWidth = isPhotoTemplate ? photoCompareSize : (isFocusScaleTemplate ? 410 : (useDualCompareSize ? dualCompareSize : 400));
  const cardTop = isPhotoTemplate
    ? clamp(175 - Math.round((photoCompareSize - 390) * 0.35) + photoCompareOffsetY, 95, 340)
    : (isFocusScaleTemplate ? 170 : clamp(70 + dualCompareOffsetY, 0, 430));
  const cardHeight = isPhotoTemplate ? photoCompareSize : (isFocusScaleTemplate ? 520 : (useDualCompareSize ? dualCompareSize + 110 : 680));
  const compareImageHeight = isPhotoTemplate ? photoCompareSize : (isFocusScaleTemplate ? 410 : (useDualCompareSize ? dualCompareSize : 560));
  const leftCardLeft = isPhotoTemplate ? photoSideInset : (isFocusScaleTemplate ? 92 : (useDualCompareSize ? dualSideInset : 120));
  const rightCardLeft = isPhotoTemplate ? 1080 - photoSideInset - photoCompareSize : (isFocusScaleTemplate ? 578 : (useDualCompareSize ? 1080 - dualSideInset - dualCompareSize : 560));
  const compareLabelPlacement = compareLabelPlacementForTemplate(config.layout?.compareLabelPlacement, isPhotoTemplate);
  const compareLabelHeight = clamp(Math.round(Number(config.layout?.compareLabelHeight) || 110), 60, 220);
  const compareLabelFontSizeValue = Number(config.layout?.compareLabelFontSize);
  const compareLabelFontSize = Number.isFinite(compareLabelFontSizeValue) && compareLabelFontSizeValue > 0
    ? clamp(Math.round(compareLabelFontSizeValue), 24, 96)
    : 42;
  const compareLabelInFlow = compareLabelPlacement === "above" || compareLabelPlacement === "below";
  const resolvedCardHeight = compareLabelInFlow ? compareImageHeight + compareLabelHeight : compareImageHeight;
  const vsTop = cardTop
    + (compareLabelPlacement === "above" ? compareLabelHeight : 0)
    + Math.round(compareImageHeight / 2)
    - 55;
  const labelTextTransform = config.layout?.compareLabelUppercase === false ? "none" : "uppercase";
  const compareLabelAlign = ["left", "center", "right"].includes(config.layout?.compareLabelAlign) ? config.layout.compareLabelAlign : "center";
  const compareLabelJustifyContent = compareLabelAlign === "left" ? "flex-start" : compareLabelAlign === "right" ? "flex-end" : "center";
  const compareLabelBoxEnabled = config.layout?.compareLabelBoxEnabled !== false;
  const compareLabelColor = String(config.layout?.compareLabelColor || config.layout?.photoLabelColor || "#171411");
  const compareLabelBackground = String(config.layout?.compareLabelBackground || "#fffdf8");
  const compareLabelBackgroundOpacity = clamp(Number.isFinite(Number(config.layout?.compareLabelBackgroundOpacity)) ? Number(config.layout.compareLabelBackgroundOpacity) : 0, 0, 1);
  const compareLabelBorderColor = String(config.layout?.compareLabelBorderColor || "#171411");
  const compareLabelBorderWidth = clamp(Number(config.layout?.compareLabelBorderWidth) || 0, 0, 10);
  const compareLabelRadius = clamp(Number(config.layout?.compareLabelRadius) || 0, 0, 32);
  const compareLabelPaddingX = clamp(Number.isFinite(Number(config.layout?.compareLabelPaddingX)) ? Number(config.layout.compareLabelPaddingX) : 18, 0, 60);
  const compareLabelPaddingY = clamp(Number.isFinite(Number(config.layout?.compareLabelPaddingY)) ? Number(config.layout.compareLabelPaddingY) : 10, 0, 36);
  const compareLabelBackgroundRgba = hexToRgba(compareLabelBackground, compareLabelBackgroundOpacity);
  const compareLabelShadowValue = compareLabelShadow(config.layout?.compareLabelShadow);
  const panelEdge = String(config.layout?.photoFrameBorderColor || "#171411");
  const photoLabelColor = String(config.layout?.photoLabelColor || compareLabelColor || "#171411");
  const cardBorder = isCleanPhotoTemplate ? "none" : `6px solid ${isPhotoTemplate ? panelEdge : "var(--panel-edge)"}`;
  const cardRadius = isCleanPhotoTemplate ? "0" : "22px";
  const cardBackground = isCleanPhotoTemplate ? "transparent" : "var(--panel)";
  const cardShadow = isCleanPhotoTemplate ? "none" : `0 20px 0 ${isPhotoTemplate ? hexToRgba(config.layout?.photoFrameShadowColor || "#171411", 0.15) : "rgba(23,20,17,.18)"}`;
  const cardOverflow = compareLabelPlacement === "legacy-above" ? "visible" : "hidden";
  const vsBackground = String(config.layout?.compareVsColor || "#ff4f2f");
  const vsTextColor = String(config.layout?.compareVsTextColor || "#ffffff");
  const vsBorderColor = String(config.layout?.compareVsBorderColor || "#171411");
  const backgroundDetailValue = Number(config.background?.detail);
  const backgroundShadeValue = Number(config.background?.shade);
  const backgroundBlurValue = Number(config.background?.blur ?? config.background?.blurPx);
  const backgroundDetail = clamp(Number.isFinite(backgroundDetailValue) ? backgroundDetailValue : 1.15, 0, 2);
  const backgroundShade = clamp(Number.isFinite(backgroundShadeValue) ? backgroundShadeValue : 0.1, 0, 0.24);
  const backgroundBlur = clamp(Number.isFinite(backgroundBlurValue) ? backgroundBlurValue : 0, 0, 18);
  const backgroundBlurFilter = backgroundBlur > 0 ? ` blur(${backgroundBlur.toFixed(1)}px)` : "";
  const backgroundBlurScale = backgroundBlur > 0 ? (1 + Math.min(0.04, backgroundBlur / 450)).toFixed(4) : "1";
  const backgroundSrc = String(config.background?.src || "").replace(/\\/g, "/");
  const colorOnlyBackground = !backgroundSrc || config.background?.type === "color";
  const backgroundColor = String(config.background?.color || "#ffffff");
  const rawCustomBackground = colorOnlyBackground
    || config.background?.treatment === "raw"
    || (config.background?.custom && backgroundDetail === 0 && backgroundShade === 0);
  const backgroundContrast = rawCustomBackground ? "1" : (1.12 + backgroundDetail * 0.16).toFixed(2);
  const backgroundBrightness = rawCustomBackground ? "1" : (0.99 - backgroundShade * 0.38).toFixed(2);
  const backgroundTextureOpacity = rawCustomBackground ? "0" : clamp(0.26 + backgroundDetail * 0.17 + backgroundShade * 0.28, 0.2, 0.64).toFixed(3);
  const backgroundTextureContrast = rawCustomBackground ? "1" : (2.15 + backgroundDetail * 0.92).toFixed(2);
  const backgroundDepthAlpha = rawCustomBackground ? "0" : clamp(backgroundShade * 1.25, 0, 0.32).toFixed(3);
  const backgroundEdgeAlpha = rawCustomBackground ? "0" : clamp(0.035 + backgroundShade * 0.72, 0.025, 0.22).toFixed(3);
  const focusScaleLarge = clamp(Number(config.layout?.focusScaleLarge) || 1.18, 1.05, 1.35);
  const focusScaleSmall = clamp(Number(config.layout?.focusScaleSmall) || 0.82, 0.65, 0.98);
  const focusMotionDuration = clamp(Number(config.layout?.focusMotionDuration) || 0.5, 0.25, 1);
  const focusImageBlurValue = Number(config.layout?.focusImageBlur);
  const focusImageDarknessValue = Number(config.layout?.focusImageDarkness);
  const focusImageBlur = clamp(Number.isFinite(focusImageBlurValue) ? focusImageBlurValue : 2.5, 0, 8);
  const focusImageDarkness = clamp(Number.isFinite(focusImageDarknessValue) ? focusImageDarknessValue : 0.35, 0, 0.7);
  const showVs = !isCleanPhotoTemplate && !isFocusScaleTemplate;
  const vsHtml = showVs ? '<div id="vs">VS</div>' : "";
  const introSelector = showVs ? "#card-left, #card-right, #vs" : "#card-left, #card-right";
  const fullAudioPath = path.join(root, "assets", "vo", "full.mp3");
  const hasFullAudio = fs.existsSync(fullAudioPath);
  const characterSources = {
    "point-left": characterSource(config, "point-left"),
    "point-right": characterSource(config, "point-right"),
    question: characterSource(config, "question"),
  };
  const compareSets = compareSetsForHtml(config);
  const initialCompareSet = compareSets["compare-1"];
  const labelHtml = (id, value) => `<div id="${id}" class="label">${escapeHtml(value)}</div>`;
  const leftLabelHtml = labelHtml("compare-label-left", initialCompareSet.leftLabel);
  const rightLabelHtml = labelHtml("compare-label-right", initialCompareSet.rightLabel);
  const leftImageHtml = `<div class="image-window"><img id="compare-img-left" class="compare-img" src="${escapeHtml(initialCompareSet.leftImage)}" /><div id="focus-shade-left" class="focus-shade"></div>${compareLabelPlacement === "overlay" ? leftLabelHtml : ""}</div>`;
  const rightImageHtml = `<div class="image-window"><img id="compare-img-right" class="compare-img" src="${escapeHtml(initialCompareSet.rightImage)}" /><div id="focus-shade-right" class="focus-shade"></div>${compareLabelPlacement === "overlay" ? rightLabelHtml : ""}</div>`;
  const cardInner = (imageHtml, label) => compareLabelPlacement === "above" || compareLabelPlacement === "legacy-above"
    ? `${label}${imageHtml}`
    : `${imageHtml}${label}`;
  const leftCardInner = compareLabelPlacement === "overlay" ? leftImageHtml : cardInner(leftImageHtml, leftLabelHtml);
  const rightCardInner = compareLabelPlacement === "overlay" ? rightImageHtml : cardInner(rightImageHtml, rightLabelHtml);
  const lineHtml = timed.map((line) => (
    `<div class="caption-line" id="${line.id}"><span>${escapeHtml(line.caption || line.text || line.tts)}</span></div>`
  )).join("\n          ");
  const audioHtml = hasFullAudio
    ? `<audio id="vo-full" src="assets/vo/full.mp3" data-start="0" data-duration="${audioDuration || rootDuration}" data-track-index="20"></audio>`
    : timed.map((line, index) => (
      `<audio id="vo-${index + 1}" src="assets/vo/${line.id}.mp3" data-start="${line.start}" data-duration="${line.dur}" data-track-index="20"></audio>`
    )).join("\n      ");
  const voObject = timed.map((line, index) => (
    `${index + 1}: { id: "${line.id}", compareSetId: "${line.compareSetId || "compare-1"}", pose: "${line.pose || "question"}", focusSide: "${line.focusSide || ""}", start: ${line.start}, dur: ${line.dur} }`
  )).join(",\n        ");

  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      @font-face {
        font-family: "Be Vietnam Pro";
        src: url("https://fonts.gstatic.com/s/bevietnampro/v11/QdVMSTAyLFyeg_IDWvOJmVES_HT4JG86Rb0.woff2") format("woff2");
        font-weight: 900;
      }
      :root {
        --bg: ${backgroundColor};
        --fg: #171411;
        --panel: #fffdf7;
        --panel-edge: #171411;
        --accent-pink: #ff4fa3;
        --accent-cyan: #37e6c4;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: var(--bg); font-family: "Be Vietnam Pro", sans-serif; }
      #root { position: relative; width: 1080px; height: 1920px; background: var(--bg); }
      #scene { position: absolute; inset: 0; overflow: hidden; }
      #paper-bg { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; object-fit: cover; opacity: ${colorOnlyBackground ? "0" : "1"}; filter: contrast(${backgroundContrast}) brightness(${backgroundBrightness}) saturate(1.02)${backgroundBlurFilter}; transform: scale(${backgroundBlurScale}); transform-origin: 50% 50%; }
      #paper-bg-boost { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; object-fit: cover; opacity: ${colorOnlyBackground ? "0" : backgroundTextureOpacity}; filter: contrast(${backgroundTextureContrast}) brightness(.94) saturate(.42)${backgroundBlurFilter}; transform: scale(${backgroundBlurScale}); transform-origin: 50% 50%; mix-blend-mode: multiply; }
      #paper-bg-wash { position: absolute; inset: 0; z-index: 2; pointer-events: none; mix-blend-mode: multiply; background: linear-gradient(180deg, rgba(255, 253, 248, .08) 0%, rgba(232, 216, 193, ${backgroundDepthAlpha}) 100%), radial-gradient(ellipse at 50% 50%, rgba(255, 255, 255, 0) 0 50%, rgba(42, 27, 15, ${backgroundEdgeAlpha}) 100%); }
      .card { position: absolute; top: ${cardTop}px; z-index: 3; width: ${cardWidth}px; height: ${resolvedCardHeight}px; display: flex; flex-direction: column; overflow: ${cardOverflow}; border: ${cardBorder}; border-radius: ${cardRadius}; background: ${cardBackground}; box-shadow: ${cardShadow}; transform-origin: 50% 50%; }
      #card-left { left: ${leftCardLeft}px; }
      #card-right { left: ${rightCardLeft}px; }
      .image-window { position: relative; width: 100%; height: ${compareImageHeight}px; overflow: hidden; background: #fffdf7; }
      .compare-img { display: block; position: relative; z-index: 1; width: 100%; height: ${compareImageHeight}px; object-fit: cover; background: #fffdf7; }
      .focus-shade { position: absolute; inset: 0; z-index: 2; pointer-events: none; background: rgba(0, 0, 0, ${focusImageDarkness.toFixed(3)}); opacity: 0; }
      .label { display: ${compareLabelPlacement === "hidden" ? "none" : "flex"}; flex: ${compareLabelPlacement === "below" ? "1" : "0 0 auto"}; align-items: center; justify-content: ${compareLabelJustifyContent}; width: 100%; height: ${compareLabelHeight}px; min-height: ${compareLabelHeight}px; overflow: hidden; padding: ${compareLabelPaddingY}px ${compareLabelPaddingX}px; color: ${compareLabelColor}; background: ${compareLabelBoxEnabled ? compareLabelBackgroundRgba : "transparent"}; border: ${compareLabelBoxEnabled ? `${compareLabelBorderWidth}px solid ${compareLabelBorderColor}` : "0 solid transparent"}; border-radius: ${compareLabelBoxEnabled ? compareLabelRadius : 0}px; box-shadow: ${compareLabelBoxEnabled ? compareLabelShadowValue : "none"}; font-size: ${compareLabelFontSize}px; font-weight: 900; letter-spacing: .01em; line-height: 1.08; text-align: ${compareLabelAlign}; text-transform: ${labelTextTransform}; overflow-wrap: anywhere; ${compareLabelPlacement === "legacy-above" ? `position: absolute; z-index: 2; top: -${compareLabelHeight + 12}px; right: 0; left: 0;` : compareLabelPlacement === "overlay" ? "position: absolute; z-index: 3; right: 0; bottom: 0; left: 0;" : ""} }
      #vs { position: absolute; top: ${vsTop}px; left: 485px; z-index: 4; width: 110px; height: 110px; display: grid; place-items: center; border: 6px solid ${vsBorderColor}; border-radius: 50%; background: ${vsBackground}; color: ${vsTextColor}; font-size: 34px; font-weight: 900; box-shadow: 0 12px 0 rgba(23,20,17,.22); }
      #caption-zone { position: absolute; left: 55px; top: 800px; z-index: 4; width: 970px; height: 330px; display: grid; place-items: center; }
      .caption-line { position: absolute; max-width: 900px; opacity: 0; color: var(--fg); font-family: "Be Vietnam Pro", sans-serif; font-size: 58px; font-weight: 900; line-height: 1.18; text-align: center; text-shadow: none; }
      .caption-line span { display: inline; background: #fffdf7; border: 5px solid var(--panel-edge); box-decoration-break: clone; -webkit-box-decoration-break: clone; padding: 14px 24px 16px; box-shadow: 12px 12px 0 rgba(23,20,17,.22); }
      #character-stage { position: absolute; inset: 0; z-index: 2; width: 1080px; height: 1920px; overflow: hidden; pointer-events: none; }
      .pose-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; object-position: center; opacity: 0; filter: drop-shadow(0 18px 22px rgba(0,0,0,.24)); }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-duration="${rootDuration}">
      <section id="scene">
        ${backgroundSrc ? `<img id="paper-bg" src="${escapeHtml(backgroundSrc)}" />
        <img id="paper-bg-boost" src="${escapeHtml(backgroundSrc)}" />` : ""}
        <div id="paper-bg-wash"></div>
        <div id="card-left" class="card">${leftCardInner}</div>
        <div id="card-right" class="card">${rightCardInner}</div>
        ${vsHtml}
        <div id="character-stage">
          <video id="pose-point-left" class="pose-video clip" src="${characterSources["point-left"]}" muted loop playsinline data-start="0" data-duration="${rootDuration}" data-track-index="10"></video>
          <video id="pose-point-right" class="pose-video clip" src="${characterSources["point-right"]}" muted loop playsinline data-start="0" data-duration="${rootDuration}" data-track-index="11"></video>
          <video id="pose-question" class="pose-video clip" src="${characterSources.question}" muted loop playsinline data-start="0" data-duration="${rootDuration}" data-track-index="12"></video>
        </div>
        <div id="caption-zone">
          ${lineHtml}
        </div>
      </section>
      ${audioHtml}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      const VO = {
        ${voObject}
      };
      const COMPARE_SETS = ${scriptJson(compareSets)};
      const poses = ["point-left", "point-right", "question"];
      function applyImageCrop(img, zoom, crop) {
        const source = crop || {};
        if (source.mode === "region" && Number.isFinite(Number(source.width)) && Number.isFinite(Number(source.height))) {
          const width = Math.max(0.01, Math.min(1, Number(source.width) || 1));
          const height = Math.max(0.01, Math.min(1, Number(source.height) || 1));
          const x = Math.max(0, Math.min(1 - width, Number(source.x) || 0));
          const y = Math.max(0, Math.min(1 - height, Number(source.y) || 0));
          const rotation = Number(source.rotation) || 0;
          Object.assign(img.style, {
            position: "absolute",
            left: ((-x / width) * 100) + "%",
            top: ((-y / height) * 100) + "%",
            width: (100 / width) + "%",
            height: (100 / height) + "%",
            maxWidth: "none",
            objectFit: "fill",
            transform: rotation ? "rotate(" + rotation + "deg)" : "none",
            transformOrigin: "50% 50%",
          });
          return;
        }
        const x = Number(source.x) || 0;
        const y = Number(source.y) || 0;
        const rotation = Number(source.rotation) || 0;
        Object.assign(img.style, {
          position: "relative",
          left: "0",
          top: "0",
          width: "100%",
          height: "${compareImageHeight}px",
          maxWidth: "",
          objectFit: "cover",
          transform: "translate(" + x + "%, " + y + "%) scale(" + (Number(zoom) || 1) + ") rotate(" + rotation + "deg)",
          transformOrigin: "50% 50%",
        });
      }
      function applyCompareSet(setId) {
        const set = COMPARE_SETS[setId] || COMPARE_SETS["compare-1"];
        const leftImg = document.getElementById("compare-img-left");
        const rightImg = document.getElementById("compare-img-right");
        leftImg.src = set.leftImage || "";
        rightImg.src = set.rightImage || "";
        applyImageCrop(leftImg, set.leftZoom, set.leftCrop);
        applyImageCrop(rightImg, set.rightZoom, set.rightCrop);
        document.getElementById("compare-label-left").textContent = set.leftLabel == null ? "A" : String(set.leftLabel);
        document.getElementById("compare-label-right").textContent = set.rightLabel == null ? "B" : String(set.rightLabel);
      }
      function setCompare(setId, at) {
        tl.call(() => applyCompareSet(setId), [], at);
      }
      applyCompareSet("compare-1");
      function showPose(name, at) {
        poses.forEach((pose) => tl.to("#pose-" + pose, { opacity: pose === name ? 1 : 0, duration: 0.16 }, at));
      }
      function showLine(lineId, at, outAt) {
        tl.fromTo("#" + lineId, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.28, ease: "power3.out" }, at);
        if (outAt != null) tl.to("#" + lineId, { y: -18, opacity: 0, duration: 0.18, ease: "power2.in" }, outAt);
      }
      const focusScaleTemplate = ${scriptJson(isFocusScaleTemplate)};
      const focusScaleLarge = ${focusScaleLarge};
      const focusScaleSmall = ${focusScaleSmall};
      const focusMotionDuration = ${focusMotionDuration};
      const focusImageBlur = ${focusImageBlur};
      function focusSideForPose(name) {
        if (name === "point-left") return "right";
        if (name === "point-right") return "left";
        return "center";
      }
      function focusState(side) {
        if (side === "left") return { left: { scale: focusScaleLarge, x: -24, opacity: 1, z: 5 }, right: { scale: focusScaleSmall, x: 34, opacity: .84, z: 3 } };
        if (side === "right") return { left: { scale: focusScaleSmall, x: -34, opacity: .84, z: 3 }, right: { scale: focusScaleLarge, x: 24, opacity: 1, z: 5 } };
        return { left: { scale: 1, x: 0, opacity: 1, z: 3 }, right: { scale: 1, x: 0, opacity: 1, z: 3 } };
      }
      function focusImageState(side) {
        if (side === "left") return { left: { blur: 0, shade: 0 }, right: { blur: focusImageBlur, shade: 1 } };
        if (side === "right") return { left: { blur: focusImageBlur, shade: 1 }, right: { blur: 0, shade: 0 } };
        return { left: { blur: 0, shade: 0 }, right: { blur: 0, shade: 0 } };
      }
      function applyFocus(line, at) {
        if (!focusScaleTemplate) return;
        const side = line.focusSide || focusSideForPose(line.pose);
        const state = focusState(side);
        const imageState = focusImageState(side);
        tl.to("#card-left", { scale: state.left.scale, x: state.left.x, zIndex: state.left.z, duration: focusMotionDuration, ease: "power3.out" }, at);
        tl.to("#card-right", { scale: state.right.scale, x: state.right.x, zIndex: state.right.z, duration: focusMotionDuration, ease: "power3.out" }, at);
        tl.to("#compare-img-left", { filter: "blur(" + imageState.left.blur + "px)", duration: focusMotionDuration, ease: "power3.out" }, at);
        tl.to("#compare-img-right", { filter: "blur(" + imageState.right.blur + "px)", duration: focusMotionDuration, ease: "power3.out" }, at);
        tl.to("#focus-shade-left", { opacity: imageState.left.shade, duration: focusMotionDuration, ease: "power3.out" }, at);
        tl.to("#focus-shade-right", { opacity: imageState.right.shade, duration: focusMotionDuration, ease: "power3.out" }, at);
      }
      ${isPhotoTemplate
        ? `tl.set("${introSelector}", { scale: 1, opacity: 1 });`
        : isFocusScaleTemplate
          ? `tl.fromTo("#card-left", { scale: .94, opacity: 0 }, { scale: 1, opacity: 1, duration: .42, ease: "power3.out" }, 0);
      tl.fromTo("#card-right", { scale: .94, opacity: 0 }, { scale: 1, opacity: 1, duration: .42, ease: "power3.out" }, .12);`
        : `tl.fromTo("#card-left", { scale: .9, opacity: 0 }, { scale: 1, opacity: 1, duration: .45, ease: "power3.out" }, 0);
      tl.fromTo("#card-right", { scale: .9, opacity: 0 }, { scale: 1, opacity: 1, duration: .45, ease: "power3.out" }, .12);
      tl.fromTo("#vs", { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: .35, ease: "power3.out" }, .32);`}
      Object.values(VO).forEach((line, index, all) => {
        const next = all[index + 1];
        const outAt = index === all.length - 1 ? null : Math.min(line.start + line.dur, (next?.start ?? line.start + line.dur) - .02);
        setCompare(line.compareSetId || "compare-1", line.start);
        applyFocus(line, line.start);
        showPose(line.pose, line.start);
        showLine(line.id, line.start, outAt);
      });
      ${isPhotoTemplate || isFocusScaleTemplate ? "" : `tl.to("#card-left", { scale: 1.04, duration: .25, yoyo: true, repeat: 1 }, VO[1]?.start || .55);
      tl.to("#card-right", { scale: 1.04, duration: .25, yoyo: true, repeat: 1 }, VO[2]?.start || 2);`}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`;
}
