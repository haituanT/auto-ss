import React, { useEffect, useMemo, useState } from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  continueRender,
  delayRender,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Audio, Video } from "@remotion/media";
import { isImageAsset } from "../../shared/assetTypes.mjs";
import { CAPTION_FONT_OPTIONS, captionFontStack, DEFAULT_CAPTION_FONT_FAMILY, normalizeCaptionFontFamily } from "../../shared/captionOptions.mjs";
import {
  alignTimedWordsToTokens,
  captionChunkLimit as weightedCaptionChunkLimit,
  captionCueForFrame as weightedCaptionCueForFrame,
  captionTimingWindow as weightedCaptionTimingWindow,
  speechWeightForToken as weightedSpeechWeightForToken,
  TIMING_EDGE_EPSILON_MS,
} from "./captionTiming.mjs";

const POSES = ["point-left", "point-right", "question"];
const FOCUS_SIDES = ["left", "right", "center"];
const COMPARE_SET_IDS = ["compare-1", "compare-2"];
const COMPARE_DUAL_TEMPLATE_ID = "compare-dual-v1";
const PHOTO_LAYOUT_TEMPLATE_IDS = new Set(["photo-compare-v1", "photo-clean-frame-v1"]);
const CLEAN_PHOTO_TEMPLATE_ID = "photo-clean-frame-v1";
const FOCUS_SCALE_TEMPLATE_ID = "focus-scale-v1";
const FONT_FAMILY = captionFontStack(DEFAULT_CAPTION_FONT_FAMILY);

const FONT_CSS = `
@font-face { font-family: "Be Vietnam Pro"; font-style: normal; font-weight: 900; font-display: block; src: url("https://fonts.gstatic.com/s/bevietnampro/v12/QdVMSTAyLFyeg_IDWvOJmVES_HS0Im86Rb0bcw.woff2") format("woff2"); unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB; }
@font-face { font-family: "Be Vietnam Pro"; font-style: normal; font-weight: 900; font-display: block; src: url("https://fonts.gstatic.com/s/bevietnampro/v12/QdVMSTAyLFyeg_IDWvOJmVES_HS0Im81Rb0.woff2") format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
`;

function captionFontCss() {
  return CAPTION_FONT_OPTIONS.map((font) => `
@font-face {
  font-family: "${font.family}";
  font-style: normal;
  font-weight: ${font.weight};
  font-display: block;
  src: url("${staticFile(`fonts/${font.file}`)}") format("truetype"), url("/shared-assets/fonts/${font.file}") format("truetype");
}`).join("\n");
}

function useCaptionFonts(fontFamily = DEFAULT_CAPTION_FONT_FAMILY, skipDelay = false) {
  const family = normalizeCaptionFontFamily(fontFamily);
  const [handle] = useState(() => skipDelay ? null : delayRender("Loading Be Vietnam Pro"));
  useEffect(() => {
    if (skipDelay) {
      document.fonts?.load(`900 72px "${family}"`, "Tieng Viet").catch(() => {});
      document.fonts?.load('900 72px "Be Vietnam Pro"', "Đây là tiếng Việt").catch(() => {});
      return undefined;
    }
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        continueRender(handle);
      }
    };
    const timer = setTimeout(finish, 10000);
    Promise.all([
      document.fonts.load(`900 72px "${family}"`, "Tieng Viet"),
      document.fonts.load('900 72px "Be Vietnam Pro"', "Ly thân và ly hôn khác nhau ở đâu"),
      document.fonts.load('900 72px "Be Vietnam Pro"', "Đây là tiếng Việt"),
    ])
      .catch(() => {})
      .then(() => {
        clearTimeout(timer);
        finish();
      });
    return () => clearTimeout(timer);
  }, [family, handle, skipDelay]);
}

function cleanAssetPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function isExternalAsset(value) {
  const source = String(value || "");
  return source.startsWith("/") || source.startsWith("data:") || /^(?:https?:)?\/\//i.test(source);
}

function hexToRgba(value, alpha = 1) {
  const match = String(value || "").trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return `rgba(32, 22, 15, ${alpha})`;
  const hex = match[1];
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function normalizeVietnamese(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

function focusSideForPose(pose) {
  if (pose === "point-left") return "right";
  if (pose === "point-right") return "left";
  return "center";
}

function normalizeFocusSide(value, fallback = "center") {
  return FOCUS_SIDES.includes(value) ? value : (FOCUS_SIDES.includes(fallback) ? fallback : "center");
}

function lerp(from, to, progress) {
  return from + (to - from) * progress;
}

function easeOutCubic(progress) {
  const t = clamp(progress, 0, 1);
  return 1 - Math.pow(1 - t, 3);
}

function focusMotionForSide(side, layout = {}) {
  const largeScale = clamp(Number(layout.focusScaleLarge) || 1.18, 1.05, 1.35);
  const smallScale = clamp(Number(layout.focusScaleSmall) || 0.82, 0.65, 0.98);
  const base = {
    left: { scale: 1, x: 0, opacity: 1, zIndex: 3 },
    right: { scale: 1, x: 0, opacity: 1, zIndex: 3 },
  };
  if (side === "left") {
    return {
      left: { scale: largeScale, x: -24, opacity: 1, zIndex: 5 },
      right: { scale: smallScale, x: 34, opacity: 0.84, zIndex: 3 },
    };
  }
  if (side === "right") {
    return {
      left: { scale: smallScale, x: -34, opacity: 0.84, zIndex: 3 },
      right: { scale: largeScale, x: 24, opacity: 1, zIndex: 5 },
    };
  }
  return base;
}

function mixFocusMotion(from, to, progress) {
  return {
    left: {
      scale: lerp(from.left.scale, to.left.scale, progress),
      x: lerp(from.left.x, to.left.x, progress),
      opacity: lerp(from.left.opacity, to.left.opacity, progress),
      zIndex: progress > 0.5 ? to.left.zIndex : from.left.zIndex,
    },
    right: {
      scale: lerp(from.right.scale, to.right.scale, progress),
      x: lerp(from.right.x, to.right.x, progress),
      opacity: lerp(from.right.opacity, to.right.opacity, progress),
      zIndex: progress > 0.5 ? to.right.zIndex : from.right.zIndex,
    },
  };
}

function previousCueFor(cues, cue) {
  if (!cue) return null;
  const index = cues.findIndex((item) => item.id === cue.id);
  return index > 0 ? cues[index - 1] : null;
}

function cuesFromProps(props) {
  const lines = Array.isArray(props.lines) ? props.lines : [];
  return lines.map((line, index) => {
    const startMs = Number(line.startMs ?? (Number(line.start) || 0) * 1000);
    const durationMs = Number(line.durationMs ?? (Number(line.duration) || 2.2) * 1000);
    const pose = POSES.includes(line.pose) ? line.pose : "question";
    return {
      id: line.id || `line-${index + 1}`,
      compareSetId: COMPARE_SET_IDS.includes(line.compareSetId) ? line.compareSetId : "compare-1",
      text: String(line.text || line.caption || line.tts || "").trim(),
      role: line.role || "",
      pose,
      focusSide: normalizeFocusSide(line.focusSide, focusSideForPose(pose)),
      highlight: line.highlight || "",
      words: Array.isArray(line.words) ? line.words : [],
      startMs: Math.max(0, Math.round(startMs)),
      endMs: Math.max(300, Math.round(startMs + durationMs)),
      timestampMs: null,
      confidence: null,
    };
  });
}

function currentCue(cues, currentMs) {
  return cues.find((cue) => currentMs >= cue.startMs && currentMs < cue.endMs) || null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function numberOr(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function poseCueForFrame(cues, currentMs) {
  const active = currentCue(cues, currentMs);
  if (active) return active;

  const next = cues.find((cue) => currentMs < cue.startMs);
  if (next && next.pose !== "question") return next;

  for (let index = cues.length - 1; index >= 0; index -= 1) {
    const cue = cues[index];
    if (currentMs >= cue.endMs && cue.pose !== "question") return cue;
  }

  return next || cues[0] || null;
}

function fontSizeForLabel(value) {
  const length = String(value || "").length;
  if (length > 20) return 34;
  if (length > 14) return 42;
  return 52;
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

function compareLabelVisualStyle(layout = {}, isPhotoTemplate = false, placement = "below") {
  const color = layout.compareLabelColor || (isPhotoTemplate ? layout.photoLabelColor : "#20160f") || "#20160f";
  const background = layout.compareLabelBackground || "#fffdf8";
  const backgroundOpacity = clamp(Number.isFinite(Number(layout.compareLabelBackgroundOpacity)) ? Number(layout.compareLabelBackgroundOpacity) : 0, 0, 1);
  const borderColor = layout.compareLabelBorderColor || "#20160f";
  const borderWidth = clamp(Number.isFinite(Number(layout.compareLabelBorderWidth)) ? Number(layout.compareLabelBorderWidth) : 0, 0, 10);
  const radius = clamp(Number.isFinite(Number(layout.compareLabelRadius)) ? Number(layout.compareLabelRadius) : 0, 0, 32);
  const paddingX = clamp(Number.isFinite(Number(layout.compareLabelPaddingX)) ? Number(layout.compareLabelPaddingX) : 18, 0, 60);
  const paddingY = clamp(Number.isFinite(Number(layout.compareLabelPaddingY)) ? Number(layout.compareLabelPaddingY) : 10, 0, 36);
  const height = clamp(Number.isFinite(Number(layout.compareLabelHeight)) ? Number(layout.compareLabelHeight) : 110, 60, 220);
  const align = ["left", "center", "right"].includes(layout.compareLabelAlign) ? layout.compareLabelAlign : "center";
  const justifyContent = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
  const boxEnabled = layout.compareLabelBoxEnabled !== false;
  const style = {
    height,
    minHeight: height,
    color,
    backgroundColor: boxEnabled ? hexToRgba(background, backgroundOpacity) : "transparent",
    border: boxEnabled ? `${borderWidth}px solid ${borderColor}` : "0 solid transparent",
    borderRadius: boxEnabled ? radius : 0,
    padding: `${paddingY}px ${paddingX}px`,
    justifyContent,
    textAlign: align,
    boxShadow: boxEnabled ? compareLabelShadow(layout.compareLabelShadow) : "none",
    boxSizing: "border-box",
    overflow: "hidden",
    overflowWrap: "anywhere",
  };

  if (placement === "legacy-above") {
    return {
      ...style,
      position: "absolute",
      zIndex: 2,
      top: -(height + 12),
      right: 0,
      left: 0,
    };
  }

  if (placement === "overlay") {
    return {
      ...style,
      position: "absolute",
      zIndex: 3,
      right: 0,
      bottom: 0,
      left: 0,
    };
  }

  return style;
}

function normalizedKeyword(value) {
  return normalizeVietnamese(value).replace(/[^a-z0-9]+/g, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenIsHighlighted(token, activeCue) {
  const highlight = normalizeVietnamese(activeCue?.highlight || "");
  if (!highlight) return false;
  const tokenText = normalizedKeyword(token.text);
  return Boolean(tokenText && highlight.includes(tokenText));
}

function isSpaceToken(value) {
  return /^\s+$/u.test(String(value || ""));
}

function speechWeightForToken(value) {
  const text = String(value || "");
  const letterCount = [...text.replace(/[^\p{L}\p{N}]+/gu, "")].length;
  const pauseWeight = /[.!?…]+$/u.test(text) ? 0.9 : /[,;:]+$/u.test(text) ? 0.45 : 0;
  return Math.max(0.75, letterCount * 0.36 + pauseWeight);
}

function captionTimingWindow(cue) {
  const startMs = Number(cue?.startMs) || 0;
  const endMs = Math.max(startMs + 300, Number(cue?.endMs) || startMs + 2200);
  const chunkCount = Math.max(1, Number(cue?.captionChunkCount) || 1);
  if (chunkCount <= 1) return { startMs, endMs };

  const chunkIndex = Math.max(0, Math.min(chunkCount - 1, Number(cue?.captionChunkIndex) || 0));
  const chunkDuration = (endMs - startMs) / chunkCount;
  return {
    startMs: startMs + chunkDuration * chunkIndex,
    endMs: chunkIndex === chunkCount - 1 ? endMs : startMs + chunkDuration * (chunkIndex + 1),
  };
}

function withWordTiming(tokens, cue, currentMs) {
  const wordIndexes = tokens
    .map((token, index) => (token.space ? -1 : index))
    .filter((index) => index >= 0);
  if (!wordIndexes.length) return tokens;

  const timingMs = currentMs + TIMING_EDGE_EPSILON_MS;
  const timedWords = Array.isArray(cue?.words)
    ? cue.words
      .map((word) => ({
        text: String(word?.text || "").trim(),
        startMs: Number(word?.startMs),
        endMs: Number(word?.endMs),
      }))
      .filter((word) => word.text && Number.isFinite(word.startMs) && Number.isFinite(word.endMs) && word.endMs > word.startMs)
    : [];
  if (timedWords.length) {
    const nextTokens = tokens.map((token) => ({ ...token }));
    const alignedTimings = alignTimedWordsToTokens(tokens, cue);
    wordIndexes.forEach((tokenIndex, wordIndex) => {
      const timing = alignedTimings[tokenIndex] || timedWords[Math.min(wordIndex, timedWords.length - 1)];
      const startMs = timing.startMs;
      const endMs = timing.endMs;
      const wordDuration = Math.max(1, endMs - startMs);
      Object.assign(nextTokens[tokenIndex], {
        startMs,
        endMs,
        progress: Math.max(0, Math.min(1, (timingMs - startMs) / wordDuration)),
        spoken: timingMs >= endMs,
        active: timingMs >= startMs && timingMs < endMs,
      });
    });
    return nextTokens;
  }

  const window = weightedCaptionTimingWindow(cue);
  const duration = Math.max(300, window.endMs - window.startMs);
  const weights = wordIndexes.map((index) => weightedSpeechWeightForToken(tokens[index].text));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const nextTokens = tokens.map((token) => ({ ...token }));
  let cursor = window.startMs;

  wordIndexes.forEach((tokenIndex, wordIndex) => {
    const startMs = cursor;
    const endMs = wordIndex === wordIndexes.length - 1
      ? window.endMs
      : cursor + duration * (weights[wordIndex] / totalWeight);
    const wordDuration = Math.max(1, endMs - startMs);
    const progress = Math.max(0, Math.min(1, (timingMs - startMs) / wordDuration));
    Object.assign(nextTokens[tokenIndex], {
      startMs,
      endMs,
      progress,
      spoken: timingMs >= endMs,
      active: timingMs >= startMs && timingMs < endMs,
    });
    cursor = endMs;
  });

  return nextTokens;
}

function captionTokensFromCue(cue, currentMs, wordTiming = false) {
  const text = String(cue?.text || "");
  if (!text) return [];
  const highlight = String(cue?.highlight || "").trim();
  const parts = text.split(/(\s+)/).filter(Boolean);
  const tokens = parts.map((part) => ({
    text: part,
    space: isSpaceToken(part),
    hot: !isSpaceToken(part) && (highlight ? tokenIsHighlighted({ text: part }, cue) : false),
  }));
  return wordTiming ? withWordTiming(tokens, cue, currentMs) : tokens;
}

function captionTokenStyle(token, caption, wordTiming) {
  if (token.space) {
    return {
      display: "inline-block",
      whiteSpace: "pre",
      marginRight: clamp(Number(caption.wordGap) || 0, 0, 32),
    };
  }
  const isActiveWord = Boolean(wordTiming && token.active);
  const isWordColor = caption.animation === "word-color";
  const isCapcutKaraoke = caption.style === "capcut-karaoke";
  const usesActiveOnlyKaraoke = isWordColor || isCapcutKaraoke;
  const lift = isActiveWord ? Math.sin((token.progress || 0) * Math.PI) : 0;
  if (usesActiveOnlyKaraoke) {
    return {
      color: isActiveWord ? caption.hotColor : caption.normalColor,
      display: "inline-block",
      opacity: 1,
      transform: "none",
      transformOrigin: "50% 82%",
    };
  }
  return {
    color: isActiveWord || token.hot ? caption.hotColor : caption.normalColor,
    display: "inline-block",
    opacity: wordTiming && !token.spoken && !isActiveWord ? 0 : 1,
    transform: wordTiming
      ? `translateY(${-7 * lift}px) scale(${isActiveWord ? 1 + lift * 0.18 : 1})`
      : "none",
    transformOrigin: "50% 82%",
  };
}

function captionChunkLimit(baseSize, style = "", wordGap = 0) {
  const size = Math.max(34, Math.min(Number(baseSize || 72), 108));
  const gap = clamp(Number(wordGap) || 0, 0, 32);
  if (style === "capcut-karaoke") {
    return Math.max(8, Math.min(18, Math.floor(760 / (size * 0.72 + gap * 0.55))));
  }
  return Math.max(10, Math.min(22, Math.floor(850 / (size * 0.62 + gap * 0.45))));
}

function splitCaptionChunks(text, maxCharacters = 19) {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = "";

  for (const word of words) {
    const trimmedCurrent = current.trim();
    const shouldBreakAfterSentence = /[.,;:!?…]$/u.test(trimmedCurrent)
      && [...trimmedCurrent].length >= Math.floor(maxCharacters * 0.62);
    const candidate = current ? `${current} ${word}` : word;
    if (current && (shouldBreakAfterSentence || [...candidate].length > maxCharacters)) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks.length ? chunks : [String(text || "")];
}

function captionCueForFrame(cue, currentMs, caption) {
  if (!cue) return null;
  const text = String(cue.text || "").trim();
  const maxCharacters = captionChunkLimit(caption.fontSize, caption.style, caption.wordGap);
  if ([...text].length <= maxCharacters) return cue;

  const chunks = splitCaptionChunks(text, maxCharacters);
  if (chunks.length <= 1) return cue;

  const duration = Math.max(1, cue.endMs - cue.startMs);
  const progress = Math.max(0, Math.min(0.999, (currentMs - cue.startMs) / duration));
  const index = Math.min(chunks.length - 1, Math.floor(progress * chunks.length));
  return {
    ...cue,
    text: chunks[index],
    captionChunkIndex: index,
    captionChunkCount: chunks.length,
  };
}

function captionFontSizeForCue(baseSize, cue, style = "", wordGap = 0) {
  const base = Math.max(34, Math.min(Number(baseSize || 72), 108));
  const text = String(cue?.text || "").trim();
  const characters = Math.max(1, [...text].length);
  if (characters <= weightedCaptionChunkLimit(base, style, wordGap)) return base;
  if (style === "capcut-karaoke") return Math.min(base, 68);
  if (characters <= 28) return Math.min(base, 64);
  return Math.min(base, 56);
}

function numberFrom(source, keys, fallback, min, max) {
  const names = Array.isArray(keys) ? keys : [keys];
  for (const key of names) {
    const numeric = Number(source?.[key]);
    if (Number.isFinite(numeric)) return clamp(numeric, min, max);
  }
  return fallback;
}

function backgroundTreatment(background = {}) {
  const detail = numberFrom(background, ["detail", "textureBoost"], 1.15, 0, 2);
  const shade = numberFrom(background, ["shade", "warmShade"], 0.1, 0, 0.24);
  const blur = numberFrom(background, ["blur", "blurPx"], 0, 0, 18);
  const blurFilter = blur > 0 ? ` blur(${blur.toFixed(1)}px)` : "";
  const blurScale = blur > 0 ? 1 + Math.min(0.04, blur / 450) : 1;
  const imageSource = cleanAssetPath(background.src || "");
  const colorOnlyBackground = !imageSource || background.type === "color";
  const rawCustomBackground = colorOnlyBackground || background.treatment === "raw" || (background.custom && detail === 0 && shade === 0);
  if (rawCustomBackground) {
    return {
      baseColor: background.color || "#ffffff",
      image: {
        opacity: colorOnlyBackground ? 0 : 1,
        filter: blur > 0 ? `blur(${blur.toFixed(1)}px)` : "none",
        transform: `scale(${blurScale.toFixed(4)})`,
      },
      texture: {
        opacity: 0,
        filter: "none",
      },
      depth: {
        background: "transparent",
      },
    };
  }

  const imageContrast = 1.12 + detail * 0.16;
  const imageBrightness = 0.99 - shade * 0.38;
  const textureOpacity = clamp(0.26 + detail * 0.17 + shade * 0.28, 0.2, 0.64);
  const textureContrast = 2.15 + detail * 0.92;
  const depthAlpha = clamp(shade * 1.25, 0, 0.32);
  const edgeAlpha = clamp(0.035 + shade * 0.72, 0.025, 0.22);

  return {
    baseColor: background.color || "#ffffff",
    image: {
      opacity: 0.98,
      filter: `contrast(${imageContrast.toFixed(2)}) brightness(${imageBrightness.toFixed(2)}) saturate(1.02)${blurFilter}`,
      transform: `scale(${blurScale.toFixed(4)})`,
    },
    texture: {
      opacity: textureOpacity,
      filter: `contrast(${textureContrast.toFixed(2)}) brightness(${(0.96 - shade * 0.2).toFixed(2)}) saturate(0.42)${blurFilter}`,
      transform: `scale(${blurScale.toFixed(4)})`,
    },
    depth: {
      background: [
        `linear-gradient(180deg, rgba(255, 253, 248, 0.08) 0%, rgba(232, 216, 193, ${depthAlpha.toFixed(3)}) 100%)`,
        `radial-gradient(ellipse at 50% 50%, rgba(255, 255, 255, 0) 0 50%, rgba(42, 27, 15, ${edgeAlpha.toFixed(3)}) 100%)`,
      ].join(", "),
    },
  };
}

function normalizeCompareSets(props) {
  const source = Array.isArray(props.compareSets) && props.compareSets.length
    ? props.compareSets
    : [{ id: "compare-1", ...(props.compare || {}), leftLabel: props.leftLabel, rightLabel: props.rightLabel }];
  const byId = Object.fromEntries(source.map((set) => [set?.id, set]));
  return Object.fromEntries(COMPARE_SET_IDS.map((id) => {
    const fallback = id === "compare-1" ? { ...(props.compare || {}), leftLabel: props.leftLabel, rightLabel: props.rightLabel } : {};
    const set = { id, ...fallback, ...(byId[id] || {}) };
    return [id, {
      id,
      leftLabel: set.leftLabel || "A",
      rightLabel: set.rightLabel || "B",
      leftZoom: numberOr(set.leftZoom, 1),
      rightZoom: numberOr(set.rightZoom, 1),
      leftCrop: set.leftCrop || {},
      rightCrop: set.rightCrop || {},
    }];
  }));
}

function compareAssetsForSet(props, id) {
  const nested = props.assets?.compareSets?.[id] || {};
  if (id === "compare-1") {
    return {
      left: nested.left || props.assets?.compareLeft || "",
      right: nested.right || props.assets?.compareRight || "",
    };
  }
  return {
    left: nested.left || "",
    right: nested.right || "",
  };
}

function compareSetAtTime(cues, currentMs) {
  let selected = "compare-1";
  for (const cue of cues) {
    if (currentMs < cue.startMs) break;
    selected = cue.compareSetId || selected;
  }
  return selected;
}

function compareTransition(cues, currentMs, durationMs = 180) {
  let previous = "compare-1";
  for (const cue of cues) {
    const next = cue.compareSetId || "compare-1";
    if (next !== previous && currentMs >= cue.startMs && currentMs < cue.startMs + durationMs) {
      return {
        from: previous,
        to: next,
        progress: clamp((currentMs - cue.startMs) / durationMs, 0, 1),
      };
    }
    if (currentMs >= cue.startMs) previous = next;
  }
  return null;
}

function CharacterLayer({ src, asset, config, layout }) {
  const common = {
    position: "absolute",
    zIndex: 2,
    transform: `translate(${Number(config?.x || 0)}px, ${Number(config?.y || 0)}px) scale(${Number(config?.scale || 1)})`,
    transformOrigin: "50% 78%",
    filter: "drop-shadow(0 22px 24px rgba(33, 25, 17, 0.22))",
  };

  if (!src) return null;
  if (isImageAsset(src)) {
    return (
      <Img
        src={asset(src)}
        style={{
          ...common,
          left: 0,
          top: layout.characterY,
          width: "100%",
          height: layout.characterHeight,
          objectFit: "contain",
          objectPosition: "center bottom",
        }}
      />
    );
  }

  return (
    <Video
      key={src}
      src={asset(src)}
      muted
      loop
      volume={0}
      objectFit="contain"
      style={{
        ...common,
        inset: 0,
        width: "100%",
        height: "100%",
        objectPosition: "center center",
      }}
    />
  );
}

function LogoLayer({ src, asset, logo, layout }) {
  if (!src || !logo?.enabled) return null;

  const width = clamp(Number(logo.width) || 220, 40, 700);
  const opacityValue = Number(logo.opacity);
  const opacity = clamp(Number.isFinite(opacityValue) ? opacityValue : 1, 0, 1);
  const x = Number(logo.x) || 0;
  const y = Number(logo.y) || 0;
  const anchor = logo.anchor || "bottom-right";
  const canvasWidth = Number(layout?.width) || 1080;
  const canvasHeight = Number(layout?.height) || 1920;
  const margin = 72;
  const zIndex = logo.layer === "below-character" ? 1 : 12;

  let position = {};
  if (anchor === "top-left") {
    position = { left: margin + x, top: margin + y };
  } else if (anchor === "top-right") {
    position = { left: canvasWidth - margin + x, top: margin + y, transform: "translateX(-100%)" };
  } else if (anchor === "center") {
    position = {
      left: canvasWidth / 2 + x,
      top: canvasHeight / 2 + y,
      transform: "translate(-50%, -50%)",
    };
  } else if (anchor === "bottom-left") {
    position = { left: margin + x, top: canvasHeight - margin + y, transform: "translateY(-100%)" };
  } else {
    position = {
      left: canvasWidth - margin + x,
      top: canvasHeight - margin + y,
      transform: "translate(-100%, -100%)",
    };
  }

  return (
    <div
      style={{
        position: "absolute",
        zIndex,
        opacity,
        pointerEvents: "none",
        lineHeight: 0,
        ...position,
      }}
    >
      {logo.backdrop === true ? (
        <div
          style={{
            position: "absolute",
            inset: -14,
            borderRadius: Math.min(22, Math.max(10, width * 0.18)),
            backgroundColor: "rgba(255, 253, 248, 0.58)",
            boxShadow: "0 10px 24px rgba(32, 22, 15, 0.12), inset 0 0 0 1px rgba(32, 22, 15, 0.1)",
            backdropFilter: "blur(1.5px)",
          }}
        />
      ) : null}
      <Img
        src={asset(src)}
        style={{
          position: "relative",
          zIndex: 1,
          display: "block",
          width,
          height: "auto",
          filter: "drop-shadow(0 0 2px rgba(255, 253, 248, 0.95)) drop-shadow(0 0 4px rgba(32, 22, 15, 0.42)) drop-shadow(0 8px 14px rgba(32, 22, 15, 0.18))",
        }}
      />
    </div>
  );
}

function imageTransform(zoom, crop = {}) {
  const x = Number(crop?.x) || 0;
  const y = Number(crop?.y) || 0;
  const rotation = Number(crop?.rotation) || 0;
  return `translate(${x}%, ${y}%) scale(${Number(zoom || 1)}) rotate(${rotation}deg)`;
}

function isRegionCrop(crop) {
  return crop?.mode === "region" && Number.isFinite(Number(crop.width)) && Number.isFinite(Number(crop.height));
}

function regionCropImageStyle(crop = {}) {
  if (!isRegionCrop(crop)) return null;
  const width = clamp(Number(crop.width) || 1, 0.01, 1);
  const height = clamp(Number(crop.height) || 1, 0.01, 1);
  const x = clamp(Number(crop.x) || 0, 0, 1 - width);
  const y = clamp(Number(crop.y) || 0, 0, 1 - height);
  const rotation = Number(crop.rotation) || 0;
  return {
    position: "absolute",
    left: `${(-x / width) * 100}%`,
    top: `${(-y / height) * 100}%`,
    width: `${100 / width}%`,
    height: `${100 / height}%`,
    maxWidth: "none",
    objectFit: "fill",
    transform: rotation ? `rotate(${rotation}deg)` : "none",
    transformOrigin: "50% 50%",
  };
}

function captionAppearance(caption) {
  if (caption.style === "capcut-karaoke") {
    const strokeWidth = clamp(Number(caption.strokeWidth) || 12, 4, 18);
    const strokeColor = caption.strokeColor || "#000000";
    return {
      padding: "4px 26px",
      backgroundColor: "transparent",
      WebkitTextStroke: `${strokeWidth}px ${strokeColor}`,
      paintOrder: "stroke fill",
      lineHeight: 0.98,
      letterSpacing: 0,
      textShadow: `0 4px 0 ${strokeColor}, 0 10px 15px rgba(0, 0, 0, 0.38)`,
    };
  }

  if (caption.style === "karaoke-pill") {
    return {
      padding: "18px 28px",
      borderRadius: 34,
      backgroundColor: "rgba(20, 25, 36, 0.88)",
      boxShadow: "0 12px 30px rgba(19, 15, 11, 0.28)",
      WebkitTextStroke: "0px transparent",
      textShadow: "0 3px 0 rgba(0, 0, 0, 0.22)",
    };
  }

  if (caption.style === "clean-outline") {
    return {
      padding: "4px 28px",
      WebkitTextStroke: `7px ${caption.strokeColor || "#fffaf0"}`,
      textShadow: "0 5px 14px rgba(32, 22, 15, 0.18)",
    };
  }

  if (caption.style === "impact-pop") {
    return {
      padding: "8px 30px",
      WebkitTextStroke: "10px #20160f",
      textShadow: "0 9px 0 rgba(32, 22, 15, 0.9), 0 16px 25px rgba(32, 22, 15, 0.2)",
    };
  }

  if (caption.style === "soft-box") {
    return {
      padding: "18px 28px",
      borderRadius: 20,
      border: "3px solid rgba(32, 22, 15, 0.16)",
      backgroundColor: "rgba(255, 253, 248, 0.94)",
      boxShadow: "0 12px 30px rgba(32, 22, 15, 0.16)",
      WebkitTextStroke: "0px transparent",
      textShadow: "0 2px 0 rgba(255, 255, 255, 0.9)",
    };
  }

  if (caption.style === "neon-glow") {
    return {
      padding: "16px 30px",
      borderRadius: 22,
      border: `3px solid ${caption.strokeColor || "#00d7e7"}`,
      backgroundColor: "rgba(9, 18, 35, 0.84)",
      boxShadow: `0 0 14px ${caption.strokeColor || "#00d7e7"}, 0 0 34px rgba(255, 76, 172, 0.35)`,
      WebkitTextStroke: "0px transparent",
      textShadow: `0 0 12px ${caption.strokeColor || "#00d7e7"}`,
    };
  }

  return {
    padding: "0 34px",
    WebkitTextStroke: `10px ${caption.strokeColor || "#fffaf0"}`,
    textShadow: "0 7px 0 rgba(32, 22, 15, 0.12), 0 14px 28px rgba(32, 22, 15, 0.18)",
  };
}

function CompareImage({ src, asset, label, zoom, crop, height = 410, imageStyle = {} }) {
  if (!src) {
    return (
      <div style={{ ...styles.emptyCompareImage, height }}>
        <div style={styles.emptyComparePlus}>+</div>
        <div style={styles.emptyCompareText}>Thêm ảnh {label}</div>
      </div>
    );
  }

  const regionStyle = regionCropImageStyle(crop);
  const finalStyle = regionStyle
    ? { ...styles.compareImage, height, ...regionStyle, ...imageStyle }
    : { ...styles.compareImage, height, transform: imageTransform(zoom, crop), ...imageStyle };
  return <Img src={asset(src)} style={finalStyle} />;
}

function focusImageEffect(imageSide, focusedSide, focusImageBlur, focusImageDarkness) {
  const normalizedImageSide = imageSide === "left" || imageSide === "right" ? imageSide : "center";
  const normalizedFocusedSide = normalizeFocusSide(focusedSide, "center");
  const isUnfocused = normalizedFocusedSide !== "center" && normalizedImageSide !== normalizedFocusedSide;
  if (!isUnfocused) return { imageStyle: {}, overlayStyle: null };

  const blur = clamp(Number(focusImageBlur) || 0, 0, 8);
  const darkness = clamp(Number(focusImageDarkness) || 0, 0, 0.7);
  return {
    imageStyle: blur > 0
      ? { filter: `blur(${blur.toFixed(1)}px)` }
      : {},
    overlayStyle: darkness > 0
      ? { ...styles.focusImageDarkOverlay, backgroundColor: `rgba(0, 0, 0, ${darkness.toFixed(3)})` }
      : null,
  };
}

function ComparePair({
  compareSet,
  compareAssets,
  asset,
  isPhotoTemplate,
  photoCardStyle,
  photoLeftStyle,
  photoRightStyle,
  photoImageWindowStyle,
  labelStyle,
  labelPlacement = "below",
  labelHeight = 110,
  labelFontSize = 0,
  vsStyle,
  showVs = true,
  isFocusScaleTemplate = false,
  focusMotionState = null,
  compareTop,
  compareHeight,
  compareImageHeight,
  vsTop,
  cardIntro,
  opacity = 1,
  focusSide = "center",
  focusImageBlur = 2.5,
  focusImageDarkness = 0.35,
}) {
  const normalizedFocusSide = normalizeFocusSide(focusSide, "center");
  const motionState = focusMotionState || focusMotionForSide("center");
  // The focused side stays clear; only the other side receives blur and darkness.
  const leftEffect = focusImageEffect("left", normalizedFocusSide, focusImageBlur, focusImageDarkness);
  const rightEffect = focusImageEffect("right", normalizedFocusSide, focusImageBlur, focusImageDarkness);
  const focusScale = 0.9 + cardIntro * 0.1;
  const leftTransform = isFocusScaleTemplate
    ? `translateX(${motionState.left.x}px) scale(${focusScale * motionState.left.scale})`
    : `scale(${focusScale})`;
  const rightTransform = isFocusScaleTemplate
    ? `translateX(${motionState.right.x}px) scale(${focusScale * motionState.right.scale})`
    : `scale(${focusScale})`;
  const leftMotionStyle = isFocusScaleTemplate ? { zIndex: motionState.left.zIndex, transformOrigin: "50% 50%" } : {};
  const rightMotionStyle = isFocusScaleTemplate ? { zIndex: motionState.right.zIndex, transformOrigin: "50% 50%" } : {};
  const labelHeightValue = clamp(Number(labelHeight) || 110, 60, 220);
  const resolvedLabelStyle = {
    ...styles.label,
    ...labelStyle,
    ...(labelPlacement === "legacy-above" ? {} : {
      height: labelHeightValue,
      minHeight: labelHeightValue,
      flex: "0 0 auto",
    }),
  };
  const renderLabel = (value) => {
    if (labelPlacement === "hidden") return null;
    const size = Number(labelFontSize) > 0
      ? clamp(Number(labelFontSize), 24, 96)
      : fontSizeForLabel(value);
    return <div style={{ ...resolvedLabelStyle, fontSize: size }}>{value}</div>;
  };
  const renderImageWindow = (image, effect, label) => {
    const windowStyle = isPhotoTemplate
      ? photoImageWindowStyle
      : { ...styles.compareImageWindow, height: compareImageHeight };
    return (
      <div style={windowStyle}>
        {image}
        {effect.overlayStyle ? <div style={effect.overlayStyle} /> : null}
        {labelPlacement === "overlay" ? label : null}
      </div>
    );
  };
  const leftLabel = renderLabel(compareSet.leftLabel);
  const rightLabel = renderLabel(compareSet.rightLabel);
  const resolvedVsTop = Number.isFinite(Number(vsTop))
    ? Number(vsTop)
    : compareTop + Math.round(compareHeight / 2) - 55;
  const leftImage = <CompareImage src={compareAssets.left} asset={asset} label="A" zoom={compareSet.leftZoom} crop={compareSet.leftCrop} height={compareImageHeight} imageStyle={leftEffect.imageStyle} />;
  const rightImage = <CompareImage src={compareAssets.right} asset={asset} label="B" zoom={compareSet.rightZoom} crop={compareSet.rightCrop} height={compareImageHeight} imageStyle={rightEffect.imageStyle} />;
  return (
    <>
      <div style={{ ...styles.card, ...styles.leftCard, ...(isPhotoTemplate ? styles.photoCard : {}), ...photoCardStyle, ...photoLeftStyle, ...leftMotionStyle, top: compareTop, height: compareHeight, opacity, transform: leftTransform }}>
        {labelPlacement === "above" || labelPlacement === "legacy-above" ? leftLabel : null}
        {renderImageWindow(leftImage, leftEffect, leftLabel)}
        {labelPlacement === "below" ? leftLabel : null}
      </div>

      <div style={{ ...styles.card, ...styles.rightCard, ...(isPhotoTemplate ? styles.photoCard : {}), ...photoCardStyle, ...photoRightStyle, ...rightMotionStyle, top: compareTop, height: compareHeight, opacity, transform: rightTransform }}>
        {labelPlacement === "above" || labelPlacement === "legacy-above" ? rightLabel : null}
        {renderImageWindow(rightImage, rightEffect, rightLabel)}
        {labelPlacement === "below" ? rightLabel : null}
      </div>

      {showVs ? <div style={{ ...styles.vs, ...vsStyle, top: resolvedVsTop, opacity, transform: `scale(${0.75 + cardIntro * 0.25})` }}>VS</div> : null}
    </>
  );
}

export const AutoCompareVideo = (props) => {
  const isLinePreview = props.previewMode === "line";
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentMs = (frame / fps) * 1000;
  const assetBase = cleanAssetPath(props.assetBase);
  const asset = (file) => {
    if (isExternalAsset(file)) return String(file);
    return staticFile(cleanAssetPath(`${assetBase}/${file}`));
  };
  const backgroundAssetSource = props.assets?.background || "";
  const backgroundSrc = backgroundAssetSource ? asset(backgroundAssetSource) : "";
  const backgroundStyle = backgroundTreatment(props.background || {});
  const layout = {
    width: 1080,
    height: 1920,
    compareTop: 170,
    compareHeight: 520,
    dualCompareSize: 410,
    dualCompareOffsetY: 0,
    photoCompareSize: 390,
    photoCompareOffsetY: 0,
    compareLabelPlacement: "auto",
    compareLabelUppercase: true,
    compareLabelBoxEnabled: true,
    compareLabelAlign: "center",
    compareLabelFontSize: 0,
    compareLabelHeight: 110,
    compareLabelPaddingX: 18,
    compareLabelPaddingY: 10,
    compareLabelColor: "#20160f",
    compareLabelBackground: "#fffdf8",
    compareLabelBackgroundOpacity: 0,
    compareLabelBorderColor: "#20160f",
    compareLabelBorderWidth: 0,
    compareLabelRadius: 0,
    compareLabelShadow: "none",
    compareVsColor: "#ff4f2f",
    compareVsTextColor: "#fffdf8",
    compareVsBorderColor: "#20160f",
    photoFrameBorderColor: "#20160f",
    photoFrameShadowColor: "#20160f",
    photoLabelColor: "#20160f",
    focusScaleLarge: 1.18,
    focusScaleSmall: 0.82,
    focusMotionDuration: 0.5,
    focusImageBlur: 2.5,
    focusImageDarkness: 0.35,
    captionY: 810,
    characterY: 1180,
    characterHeight: 650,
    ...(props.layout || {}),
  };
  const caption = {
    style: "vietnam-bold-highlight",
    animation: "word-pop",
    fontFamily: DEFAULT_CAPTION_FONT_FAMILY,
    fontSize: 72,
    normalColor: "#20160f",
    hotColor: "#ff4f2f",
    strokeColor: "#fffaf0",
    strokeWidth: 10,
    wordGap: 0,
    uppercase: false,
    shadowPreset: "default",
    ...(props.caption || {}),
  };
  useCaptionFonts(caption.fontFamily, isLinePreview);

  const cues = useMemo(() => cuesFromProps(props), [props.lines]);
  const activeCue = currentCue(cues, currentMs);
  const poseCue = poseCueForFrame(cues, currentMs);
  const displayCue = weightedCaptionCueForFrame(activeCue, currentMs, caption);
  const wordTiming = caption.animation === "word-pop" || caption.animation === "word-color";
  const captionTokens = captionTokensFromCue(displayCue, currentMs, wordTiming);
  const activePose = POSES.includes(poseCue?.pose) ? poseCue.pose : "point-left";
  const templateId = props.template?.id || COMPARE_DUAL_TEMPLATE_ID;
  const isFocusScaleTemplate = templateId === FOCUS_SCALE_TEMPLATE_ID;
  const visualFocusSide = isFocusScaleTemplate && !poseCue
    ? "center"
    : normalizeFocusSide(poseCue?.focusSide, focusSideForPose(activePose));
  const characterSrc = props.assets?.characters?.[activePose] || props.assets?.characters?.question;
  const isPhotoTemplate = PHOTO_LAYOUT_TEMPLATE_IDS.has(templateId);
  const isCleanPhotoTemplate = templateId === CLEAN_PHOTO_TEMPLATE_ID;
  const isDualTemplate = templateId === COMPARE_DUAL_TEMPLATE_ID || (!isPhotoTemplate && !isFocusScaleTemplate);
  const compareLabelPlacement = compareLabelPlacementForTemplate(layout.compareLabelPlacement, isPhotoTemplate);
  const compareLabelHeight = clamp(Number(layout.compareLabelHeight) || 110, 60, 220);
  const compareLabelFontSize = clamp(Number(layout.compareLabelFontSize) || 0, 0, 96);
  const compareLabelInFlow = compareLabelPlacement === "above" || compareLabelPlacement === "below";
  const compareLabelStyle = compareLabelVisualStyle(layout, isPhotoTemplate, compareLabelPlacement);
  const compareSets = normalizeCompareSets(props);
  const currentCompareSetId = compareSetAtTime(cues, currentMs);
  const transition = isLinePreview ? null : compareTransition(cues, currentMs);
  const cardIntro = isLinePreview || isPhotoTemplate ? 1 : spring({ frame, fps, config: { damping: 18, stiffness: 110 } });
  const previousFocusCue = previousCueFor(cues, poseCue);
  const previousFocusSide = previousFocusCue
    ? normalizeFocusSide(previousFocusCue.focusSide, focusSideForPose(previousFocusCue.pose))
    : "center";
  const focusMotionDuration = clamp(Number(layout.focusMotionDuration) || 0.5, 0.25, 1);
  const focusImageBlur = clamp(Number(layout.focusImageBlur) || 0, 0, 8);
  const focusImageDarkness = clamp(Number(layout.focusImageDarkness) || 0, 0, 0.7);
  const focusMotionProgress = isFocusScaleTemplate && poseCue && !isLinePreview
    ? easeOutCubic((currentMs - poseCue.startMs) / (focusMotionDuration * 1000))
    : 1;
  const focusMotionState = isFocusScaleTemplate
    ? mixFocusMotion(
      focusMotionForSide(previousFocusSide, layout),
      focusMotionForSide(visualFocusSide, layout),
      focusMotionProgress,
    )
    : null;
  const photoCompareSize = clamp(Math.round(Number(layout.photoCompareSize) || 390), 340, 500);
  const photoCompareOffsetY = clamp(Math.round(Number(layout.photoCompareOffsetY) || 0), -80, 220);
  const photoSideInset = clamp(Math.round((1080 - (photoCompareSize * 2) - 40) / 2), 24, 100);
  const dualCompareSize = clamp(Math.round(Number(layout.dualCompareSize) || 410), 340, 500);
  const dualCompareOffsetY = clamp(Math.round(Number(layout.dualCompareOffsetY) || 0), -80, 220);
  const dualCompareTop = Number.isFinite(Number(layout.compareTop)) ? Math.round(Number(layout.compareTop)) : 170;
  const dualSideInset = clamp(Math.round((1080 - (dualCompareSize * 2) - 76) / 2), 24, 180);
  const compareTop = isPhotoTemplate
    ? clamp(175 - Math.round((photoCompareSize - 390) * 0.35) + photoCompareOffsetY, 95, 340)
    : (isDualTemplate ? clamp(dualCompareTop + dualCompareOffsetY, 40, 430) : layout.compareTop);
  const compareImageHeight = isPhotoTemplate ? photoCompareSize : (isDualTemplate ? dualCompareSize : 410);
  const compareHeight = compareLabelInFlow
    ? compareImageHeight + compareLabelHeight
    : compareImageHeight;
  const compareVsTop = compareTop
    + (compareLabelPlacement === "above" ? compareLabelHeight : 0)
    + Math.round(compareImageHeight / 2)
    - 55;
  const photoCardStyle = isPhotoTemplate ? { width: photoCompareSize } : (isDualTemplate ? { width: dualCompareSize } : {});
  const photoLeftStyle = isPhotoTemplate ? { left: photoSideInset } : (isDualTemplate ? { left: dualSideInset } : {});
  const photoRightStyle = isPhotoTemplate ? { right: photoSideInset } : (isDualTemplate ? { right: dualSideInset } : {});
  const photoImageWindowStyle = isPhotoTemplate
    ? {
      ...styles.photoImageWindow,
      border: `5px solid ${layout.photoFrameBorderColor || "#20160f"}`,
      boxShadow: `0 16px 0 ${hexToRgba(layout.photoFrameShadowColor || "#20160f", 0.15)}`,
      ...(isCleanPhotoTemplate ? styles.cleanPhotoImageWindow : {}),
      height: photoCompareSize,
    }
    : styles.photoImageWindow;
  const compareLabelStyleWithCasing = {
    ...compareLabelStyle,
    ...(layout.compareLabelUppercase === false ? { textTransform: "none" } : {}),
  };
  const compareVsStyle = {
    backgroundColor: layout.compareVsColor || "#ff4f2f",
    color: layout.compareVsTextColor || "#fffdf8",
    borderColor: layout.compareVsBorderColor || "#20160f",
  };
  const captionStyle = captionAppearance(caption);
  const captionFontSize = captionFontSizeForCue(caption.fontSize, displayCue, caption.style, caption.wordGap);
  const bgmVolume = numberOr(props.audioConfig?.bgmVolume, 0.18);
  const voiceIsActive = Boolean(activeCue);

  return (
    <AbsoluteFill style={styles.root}>
      <style>{`${FONT_CSS}\n${captionFontCss()}`}</style>
      <div style={{ ...styles.backgroundBase, backgroundColor: backgroundStyle.baseColor }} />
      {backgroundSrc ? <Img src={backgroundSrc} style={{ ...styles.background, ...backgroundStyle.image }} /> : null}
      {backgroundSrc ? <Img src={backgroundSrc} style={{ ...styles.backgroundTextureBoost, ...backgroundStyle.texture }} /> : null}
      <div style={{ ...styles.backgroundDepthWash, ...backgroundStyle.depth }} />

      {transition ? (
        <>
          <ComparePair
            compareSet={compareSets[transition.from] || compareSets["compare-1"]}
            compareAssets={compareAssetsForSet(props, transition.from)}
            asset={asset}
            isPhotoTemplate={isPhotoTemplate}
            photoCardStyle={photoCardStyle}
            photoLeftStyle={photoLeftStyle}
            photoRightStyle={photoRightStyle}
            photoImageWindowStyle={photoImageWindowStyle}
            labelStyle={compareLabelStyleWithCasing}
            labelPlacement={compareLabelPlacement}
            labelHeight={compareLabelHeight}
            labelFontSize={compareLabelFontSize}
            vsStyle={compareVsStyle}
            showVs={!isCleanPhotoTemplate && !isFocusScaleTemplate}
            isFocusScaleTemplate={isFocusScaleTemplate}
            focusMotionState={focusMotionState}
            compareTop={compareTop}
            compareHeight={compareHeight}
            compareImageHeight={compareImageHeight}
            vsTop={compareVsTop}
            cardIntro={cardIntro}
            opacity={1 - transition.progress}
            focusSide={visualFocusSide}
            focusImageBlur={focusImageBlur}
            focusImageDarkness={focusImageDarkness}
          />
          <ComparePair
            compareSet={compareSets[transition.to] || compareSets["compare-1"]}
            compareAssets={compareAssetsForSet(props, transition.to)}
            asset={asset}
            isPhotoTemplate={isPhotoTemplate}
            photoCardStyle={photoCardStyle}
            photoLeftStyle={photoLeftStyle}
            photoRightStyle={photoRightStyle}
            photoImageWindowStyle={photoImageWindowStyle}
            labelStyle={compareLabelStyleWithCasing}
            labelPlacement={compareLabelPlacement}
            labelHeight={compareLabelHeight}
            labelFontSize={compareLabelFontSize}
            vsStyle={compareVsStyle}
            showVs={!isCleanPhotoTemplate && !isFocusScaleTemplate}
            isFocusScaleTemplate={isFocusScaleTemplate}
            focusMotionState={focusMotionState}
            compareTop={compareTop}
            compareHeight={compareHeight}
            compareImageHeight={compareImageHeight}
            vsTop={compareVsTop}
            cardIntro={cardIntro}
            opacity={transition.progress}
            focusSide={visualFocusSide}
            focusImageBlur={focusImageBlur}
            focusImageDarkness={focusImageDarkness}
          />
        </>
      ) : (
        <ComparePair
          compareSet={compareSets[currentCompareSetId] || compareSets["compare-1"]}
          compareAssets={compareAssetsForSet(props, currentCompareSetId)}
          asset={asset}
          isPhotoTemplate={isPhotoTemplate}
          photoCardStyle={photoCardStyle}
          photoLeftStyle={photoLeftStyle}
          photoRightStyle={photoRightStyle}
          photoImageWindowStyle={photoImageWindowStyle}
          labelStyle={compareLabelStyleWithCasing}
          labelPlacement={compareLabelPlacement}
          labelHeight={compareLabelHeight}
          labelFontSize={compareLabelFontSize}
          vsStyle={compareVsStyle}
          showVs={!isCleanPhotoTemplate && !isFocusScaleTemplate}
          isFocusScaleTemplate={isFocusScaleTemplate}
          focusMotionState={focusMotionState}
          compareTop={compareTop}
          compareHeight={compareHeight}
          compareImageHeight={compareImageHeight}
          vsTop={compareVsTop}
          cardIntro={cardIntro}
          focusSide={visualFocusSide}
          focusImageBlur={focusImageBlur}
          focusImageDarkness={focusImageDarkness}
        />
      )}

      <CharacterLayer src={characterSrc} asset={asset} config={props.character} layout={layout} />
      <LogoLayer src={props.assets?.logo} asset={asset} logo={props.logo} layout={layout} />

      {activeCue ? (
        <div style={{
          ...styles.captionWrap,
          top: layout.captionY,
          fontSize: captionFontSize,
          fontFamily: captionFontStack(caption.fontFamily),
          ...captionStyle,
          transform: "translateX(-50%)",
        }}>
          {captionTokens.map((token, index) => {
            return (
              <span key={`${token.text}-${index}`} style={captionTokenStyle(token, caption, wordTiming)}>
                {caption.uppercase && !token.space ? token.text.toLocaleUpperCase("vi-VN") : token.text}
              </span>
            );
          })}
        </div>
      ) : null}

      {props.assets?.audio ? <Audio src={asset(props.assets.audio)} volume={numberOr(props.audioConfig?.voiceVolume, 1)} /> : null}
      {(props.assets?.audioClips || []).map((clip, index) => (
        <Sequence
          key={`${clip.src}-${clip.trimBeforeMs || 0}-${index}`}
          from={Math.max(0, Math.round((Number(clip.startMs) || 0) / 1000 * fps))}
          durationInFrames={Math.max(1, Math.round((Number(clip.durationMs) || 1000) / 1000 * fps))}
        >
          <Audio
            src={asset(clip.src)}
            volume={numberOr(clip.volume, numberOr(props.audioConfig?.voiceVolume, 1))}
            trimBefore={Math.max(0, Math.round((Number(clip.trimBeforeMs) || 0) / 1000 * fps)) || undefined}
            delayRenderTimeoutInMilliseconds={isLinePreview ? 120 : undefined}
            fallbackHtml5AudioProps={isLinePreview ? { pauseWhenBuffering: false } : undefined}
          />
        </Sequence>
      ))}
      {(props.assets?.sfxClips || []).map((clip, index) => (
        <Sequence
          key={`${clip.src}-sfx-${index}`}
          from={Math.max(0, Math.round((Number(clip.startMs) || 0) / 1000 * fps))}
          durationInFrames={Math.max(1, Math.round((Number(clip.durationMs) || 650) / 1000 * fps))}
        >
          <Audio
            src={asset(clip.src)}
            volume={numberOr(clip.volume, 0.82)}
            delayRenderTimeoutInMilliseconds={isLinePreview ? 120 : undefined}
            fallbackHtml5AudioProps={isLinePreview ? { pauseWhenBuffering: false } : undefined}
          />
        </Sequence>
      ))}
      {props.assets?.bgm ? <Audio src={asset(props.assets.bgm)} volume={voiceIsActive ? bgmVolume * 0.42 : bgmVolume} loop /> : null}
    </AbsoluteFill>
  );
};

const styles = {
  root: {
    width: 1080,
    height: 1920,
    overflow: "hidden",
    backgroundColor: "#f4efe6",
    fontFamily: FONT_FAMILY,
  },
  backgroundBase: {
    position: "absolute",
    inset: 0,
    backgroundColor: "#f0e7d8",
  },
  background: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    opacity: 0.96,
    filter: "contrast(1.14) brightness(0.995) saturate(1.03)",
  },
  backgroundTextureBoost: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    opacity: 0.32,
    filter: "contrast(2.5) saturate(0.45)",
    mixBlendMode: "multiply",
  },
  backgroundDepthWash: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    mixBlendMode: "multiply",
  },
  card: {
    position: "absolute",
    zIndex: 3,
    width: 410,
    overflow: "hidden",
    borderRadius: 28,
    border: "6px solid #20160f",
    backgroundColor: "#fffdf8",
    boxShadow: "0 20px 0 rgba(32, 22, 15, 0.16)",
  },
  leftCard: {
    left: 92,
  },
  rightCard: {
    right: 92,
  },
  photoCard: {
    width: 390,
    overflow: "visible",
    border: "none",
    borderRadius: 0,
    backgroundColor: "transparent",
    boxShadow: "none",
  },
  photoLeftCard: {
    left: 100,
  },
  photoRightCard: {
    right: 100,
  },
  photoImageWindow: {
    position: "relative",
    width: "100%",
    height: 390,
    overflow: "hidden",
    border: "5px solid #20160f",
    borderRadius: 22,
    backgroundColor: "#fffdf8",
    boxShadow: "0 16px 0 rgba(32, 22, 15, 0.15)",
  },
  cleanPhotoImageWindow: {
    border: "none",
    borderRadius: 0,
    backgroundColor: "transparent",
    boxShadow: "none",
  },
  compareImageWindow: {
    position: "relative",
    width: "100%",
    overflow: "hidden",
    backgroundColor: "#f8f4ed",
  },
  focusImageDarkOverlay: {
    position: "absolute",
    inset: 0,
    zIndex: 2,
    pointerEvents: "none",
  },
  compareImage: {
    display: "block",
    position: "relative",
    zIndex: 1,
    width: "100%",
    height: 410,
    objectFit: "cover",
    backgroundColor: "#f8f4ed",
  },
  emptyCompareImage: {
    display: "flex",
    width: "100%",
    height: 410,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    border: "4px dashed #cfc3b0",
    backgroundColor: "rgba(255, 253, 248, 0.76)",
    color: "#756a5c",
  },
  emptyComparePlus: {
    display: "grid",
    width: 76,
    height: 76,
    placeItems: "center",
    borderRadius: "50%",
    backgroundColor: "#f6e7d7",
    color: "#e7521f",
    fontSize: 58,
    fontWeight: 400,
    lineHeight: 1,
  },
  emptyCompareText: {
    fontSize: 28,
    fontWeight: 900,
  },
  label: {
    height: 110,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 18px",
    color: "#20160f",
    fontWeight: 900,
    textAlign: "center",
    textTransform: "uppercase",
    lineHeight: 1.08,
    overflowWrap: "anywhere",
  },
  photoLabel: {
    position: "absolute",
    zIndex: 2,
    left: 0,
    right: 0,
    top: -68,
    height: 56,
    color: "#20160f",
    backgroundColor: "transparent",
    letterSpacing: 0.4,
  },
  vs: {
    position: "absolute",
    zIndex: 4,
    left: 485,
    width: 110,
    height: 110,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    border: "6px solid #20160f",
    backgroundColor: "#ff4f2f",
    color: "#fffdf8",
    fontSize: 36,
    fontWeight: 900,
    boxShadow: "0 12px 0 rgba(32, 22, 15, 0.25)",
  },
  captionWrap: {
    position: "absolute",
    zIndex: 999,
    left: "50%",
    width: "max-content",
    maxWidth: 940,
    padding: "0 34px",
    fontWeight: 900,
    lineHeight: 1,
    textAlign: "center",
    whiteSpace: "nowrap",
    overflowWrap: "normal",
    wordBreak: "keep-all",
    overflow: "visible",
    fontFamily: FONT_FAMILY,
    paintOrder: "stroke fill",
    textShadow: "0 7px 0 rgba(32, 22, 15, 0.12), 0 14px 28px rgba(32, 22, 15, 0.18)",
  },
};
