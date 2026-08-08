import crypto from "node:crypto";
import {
  COMPARE_SET_IDS,
  contentByCompareSetFromLines,
  contentFromLines,
  contentFromSections,
  DEFAULT_CAPTION,
  DEFAULT_LAYOUT,
  DEFAULT_RENDER,
  editableContentByCompareSet,
  editableContentFromSections,
  migrateSfxName,
  normalizeContentByCompareSet,
  normalizePoseStartSide,
  planGroupedLines,
} from "./linePlanner.mjs";
import { CAPTION_ANIMATION_IDS, CAPTION_STYLE_IDS, normalizeCaptionFontFamily } from "../../../shared/captionOptions.mjs";
import { normalizeSavedTemplateRef } from "./templateRefs.mjs";
import { normalizeAlignmentProvider } from "./voiceTiming.mjs";

const RENDER_MODES = ["gpu", "classic"];
const COMPARE_LABEL_PLACEMENTS = ["auto", "below", "above", "overlay", "hidden"];
const COMPARE_LABEL_ALIGNS = ["left", "center", "right"];
const COMPARE_LABEL_SHADOWS = ["none", "soft", "hard"];
export const CHARACTER_POSES = ["point-left", "point-right", "question"];
export const DEFAULT_CHARACTER_POSES = {
  "point-left": "assets/character/point-left.webm",
  "point-right": "assets/character/point-right.webm",
  question: "assets/character/question.webm",
};

function numberOr(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampNumber(value, fallback, min, max) {
  return Math.max(min, Math.min(max, numberOr(value, fallback)));
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function textLabelOr(value, fallback) {
  return value === undefined || value === null
    ? String(fallback ?? "").trim()
    : String(value);
}

function firstOwnValue(sources, fallback) {
  for (const [object, key] of sources) {
    if (hasOwn(object, key)) return object[key];
  }
  return fallback;
}

function booleanOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function hexColorOr(value, fallback) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function normalizeRenderMode(value, fallback = "gpu") {
  const mode = String(value || "").trim().toLowerCase();
  return RENDER_MODES.includes(mode) ? mode : fallback;
}

function normalizeCompareLabelPlacement(value, fallback = "auto") {
  const placement = String(value || "").trim().toLowerCase();
  return COMPARE_LABEL_PLACEMENTS.includes(placement) ? placement : fallback;
}

function normalizeCompareLabelAlign(value, fallback = "center") {
  const align = String(value || "").trim().toLowerCase();
  return COMPARE_LABEL_ALIGNS.includes(align) ? align : fallback;
}

function normalizeCompareLabelShadow(value, fallback = "none") {
  const shadow = String(value || "").trim().toLowerCase();
  return COMPARE_LABEL_SHADOWS.includes(shadow) ? shadow : fallback;
}

const LOGO_ANCHORS = ["top-left", "top-right", "center", "bottom-left", "bottom-right"];
const LOGO_LAYERS = ["below-character", "above-character"];
const CHARACTER_SOURCE_STATES = ["empty", "image-ready", "processing", "ready", "error"];
const AI_IMAGE_STATES = ["empty", "processing", "ready", "error", "cancelled"];
const AI_IMAGE_PROVIDERS = ["agy", "codex"];
const AI_IMAGE_STYLES = ["realistic", "science", "cartoon", "3d"];
const DEFAULT_LOGO = {
  enabled: false,
  src: "",
  width: 110,
  anchor: "bottom-left",
  x: 32,
  y: -72,
  opacity: 0.9,
  layer: "above-character",
  backdrop: false,
};

const DEFAULT_BACKGROUND = {
  type: "color",
  src: "",
  color: "#ffffff",
  treatment: "raw",
  detail: 0,
  shade: 0,
  blur: 0,
};

const DEFAULT_SCENE_START_SFX = {
  enabled: true,
  skipFirst: true,
  mode: "pose",
  name: "mixkit-hard-pop-click.wav",
  volume: 0.82,
  poseVolumes: {
    "point-left": 0.82,
    "point-right": 0.82,
    question: 0.82,
  },
  offsetMs: 0,
};

const DEFAULT_PIPELINE = {
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
};

export function normalizeContentText(value = "") {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function contentHash(value = "") {
  const normalized = typeof value === "string"
    ? normalizeContentText(value)
    : JSON.stringify(normalizeContentByCompareSet(value));
  return crypto
    .createHash("sha1")
    .update(normalized, "utf8")
    .digest("hex")
    .slice(0, 16);
}

function timestamp() {
  return new Date().toISOString();
}

export const PROJECT_TEMPLATES = {
  "compare-dual-v1": {
    id: "compare-dual-v1",
    name: "So sanh 2 ben",
    version: 1,
  },
  "photo-compare-v1": {
    id: "photo-compare-v1",
    name: "Anh xep theo bo cuc",
    version: 1,
  },
  "photo-clean-frame-v1": {
    id: "photo-clean-frame-v1",
    name: "Anh khung tron",
    version: 1,
  },
  "focus-scale-v1": {
    id: "focus-scale-v1",
    name: "Tro dau phong do",
    version: 1,
  },
};

function normalizeTemplateId(value) {
  return PROJECT_TEMPLATES[value] ? value : "compare-dual-v1";
}

function cropFrom(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  if (source.mode === "region" || hasOwn(source, "width") || hasOwn(source, "height")) {
    const width = clampNumber(source.width, 1, 0.01, 1);
    const height = clampNumber(source.height, 1, 0.01, 1);
    return {
      mode: "region",
      x: clampNumber(source.x, 0, 0, 1 - width),
      y: clampNumber(source.y, 0, 0, 1 - height),
      width,
      height,
      rotation: numberOr(source.rotation, 0),
    };
  }
  return {
    x: numberOr(source.x, 0),
    y: numberOr(source.y, 0),
    rotation: numberOr(source.rotation, 0),
  };
}

function normalizeAiImageSlot(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const state = AI_IMAGE_STATES.includes(source.state) ? source.state : "empty";
  const provider = AI_IMAGE_PROVIDERS.includes(source.provider) ? source.provider : "agy";
  const style = AI_IMAGE_STYLES.includes(source.style) ? source.style : "science";
  const variants = Array.isArray(source.variants)
    ? source.variants.map((item) => String(item || "").replace(/\\/g, "/")).filter(Boolean).slice(0, 12)
    : [];
  const history = Array.isArray(source.history)
    ? source.history.map((item) => String(item || "").replace(/\\/g, "/")).filter(Boolean).slice(0, 12)
    : [];
  const selectedVariant = Math.max(0, Math.min(variants.length, Math.floor(numberOr(source.selectedVariant, 0))));
  return {
    state,
    provider,
    style,
    selectedVariant,
    asset: String(source.asset || "").replace(/\\/g, "/"),
    variants,
    prompt: String(source.prompt || ""),
    error: String(source.error || ""),
    updatedAt: String(source.updatedAt || ""),
    jobId: String(source.jobId || ""),
    history,
  };
}

function normalizeAiImages(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    left: normalizeAiImageSlot(source.left),
    right: normalizeAiImageSlot(source.right),
  };
}

function defaultCompareSet(id, leftLabel = "A", rightLabel = "B") {
  return {
    id,
    leftLabel: textLabelOr(leftLabel, "A"),
    rightLabel: textLabelOr(rightLabel, "B"),
    leftImage: "",
    rightImage: "",
    leftZoom: 1,
    rightZoom: 1,
    leftCrop: cropFrom(),
    rightCrop: cropFrom(),
    aiImages: normalizeAiImages(),
  };
}

function normalizeCompareSet(value = {}, fallback = defaultCompareSet("compare-1")) {
  const source = value || {};
  return {
    ...fallback,
    ...source,
    id: fallback.id,
    leftLabel: textLabelOr(hasOwn(source, "leftLabel") ? source.leftLabel : undefined, fallback.leftLabel ?? "A"),
    rightLabel: textLabelOr(hasOwn(source, "rightLabel") ? source.rightLabel : undefined, fallback.rightLabel ?? "B"),
    leftImage: String(source.leftImage ?? source.left ?? fallback.leftImage ?? ""),
    rightImage: String(source.rightImage ?? source.right ?? fallback.rightImage ?? ""),
    leftZoom: numberOr(source.leftZoom, fallback.leftZoom ?? 1),
    rightZoom: numberOr(source.rightZoom, fallback.rightZoom ?? 1),
    leftCrop: cropFrom(source.leftCrop || fallback.leftCrop),
    rightCrop: cropFrom(source.rightCrop || fallback.rightCrop),
    aiImages: normalizeAiImages(source.aiImages || fallback.aiImages),
  };
}

function normalizeLogo(value = {}, fallback = DEFAULT_LOGO) {
  const source = typeof value === "string" ? { src: value } : (value || {});
  const src = String(source.src ?? fallback.src ?? "").replace(/\\/g, "/");
  const hasSource = Boolean(src.trim());
  return {
    ...fallback,
    ...source,
    enabled: typeof source.enabled === "boolean" ? source.enabled : (hasSource ? true : Boolean(fallback.enabled)),
    src,
    width: clampNumber(source.width, fallback.width ?? 110, 40, 700),
    anchor: LOGO_ANCHORS.includes(source.anchor) ? source.anchor : fallback.anchor || "bottom-left",
    x: clampNumber(source.x, fallback.x ?? 0, -540, 540),
    y: clampNumber(source.y, fallback.y ?? 0, -960, 960),
    opacity: clampNumber(source.opacity, fallback.opacity ?? 0.9, 0, 1),
    layer: LOGO_LAYERS.includes(source.layer) ? source.layer : fallback.layer || "above-character",
    backdrop: typeof source.backdrop === "boolean" ? source.backdrop : Boolean(fallback.backdrop),
  };
}

function normalizeBackground(value = {}, fallback = DEFAULT_BACKGROUND) {
  const source = typeof value === "string" ? { src: value } : (value || {});
  const src = String(source.src ?? fallback.src ?? "").replace(/\\/g, "/");
  const custom = booleanOr(source.custom, Boolean(fallback.custom));
  const requestedTreatment = String(source.treatment || "").toLowerCase();
  const hasValidTreatment = requestedTreatment === "raw" || requestedTreatment === "enhanced";
  const detailCandidate = source.detail ?? source.textureBoost;
  const shadeCandidate = source.shade ?? source.warmShade;
  const hasEffectValue = detailCandidate !== undefined || shadeCandidate !== undefined;
  const detailNumber = Number(detailCandidate);
  const shadeNumber = Number(shadeCandidate);
  const matchesDefaultEffect = (detailValue, shadeValue) => (
    (!Number.isFinite(detailNumber) || Math.abs(detailNumber - detailValue) < 0.0001)
    && (!Number.isFinite(shadeNumber) || Math.abs(shadeNumber - shadeValue) < 0.0001)
  );
  const hasLegacyCustomDefaults = custom
    && hasEffectValue
    && (matchesDefaultEffect(DEFAULT_BACKGROUND.detail, DEFAULT_BACKGROUND.shade) || matchesDefaultEffect(1.15, 0.1));
  const treatment = hasValidTreatment
    ? requestedTreatment
    : (custom ? (!hasEffectValue || hasLegacyCustomDefaults ? "raw" : "enhanced") : fallback.treatment || "enhanced");
  const detail = treatment === "raw"
    ? 0
    : clampNumber(detailCandidate, fallback.detail ?? DEFAULT_BACKGROUND.detail, 0, 2);
  const shade = treatment === "raw"
    ? 0
    : clampNumber(shadeCandidate, fallback.shade ?? DEFAULT_BACKGROUND.shade, 0, 0.24);
  const blur = clampNumber(source.blur ?? source.blurPx, fallback.blur ?? DEFAULT_BACKGROUND.blur, 0, 18);

  return {
    ...fallback,
    ...source,
    type: source.type || (src ? "image" : fallback.type || "color"),
    src,
    color: hexColorOr(source.color, fallback.color || "#ffffff"),
    custom,
    treatment,
    detail,
    shade,
    blur,
  };
}

function compareSetsFromConfig(config = {}, baseSets = []) {
  const baseLeftLabel = firstOwnValue([[config.compare, "leftLabel"], [config, "leftLabel"], [config, "left"]], "A");
  const baseRightLabel = firstOwnValue([[config.compare, "rightLabel"], [config, "rightLabel"], [config, "right"]], "B");
  const baseById = Object.fromEntries(COMPARE_SET_IDS.map((id, index) => [
    id,
    baseSets[index] || defaultCompareSet(id, baseLeftLabel, baseRightLabel),
  ]));
  const sourceSets = Array.isArray(config.compareSets)
    ? config.compareSets
    : Object.entries(config.compareSets || {}).map(([id, set]) => ({ id, ...(set || {}) }));
  const sourceById = Object.fromEntries(sourceSets.map((set) => [set?.id, set]));
  const hasModernCompareSlots = Number(config.version) >= 2
    || hasOwn(config.compare, "leftImage")
    || hasOwn(config.compare, "rightImage");
  const legacyCompare = {
    ...(config.compare || {}),
    leftLabel: firstOwnValue([[config.compare, "leftLabel"], [config, "leftLabel"], [config, "left"]], baseById["compare-1"].leftLabel),
    rightLabel: firstOwnValue([[config.compare, "rightLabel"], [config, "rightLabel"], [config, "right"]], baseById["compare-1"].rightLabel),
    leftImage: hasOwn(config.compare, "leftImage")
      ? String(config.compare.leftImage || "")
      : (config.compare?.left || config.leftImage || (hasModernCompareSlots ? "" : "assets/compare-left.png")),
    rightImage: hasOwn(config.compare, "rightImage")
      ? String(config.compare.rightImage || "")
      : (config.compare?.right || config.rightImage || (hasModernCompareSlots ? "" : "assets/compare-right.png")),
    leftZoom: config.compare?.leftZoom ?? config.leftZoom,
    rightZoom: config.compare?.rightZoom ?? config.rightZoom,
    leftCrop: config.compare?.leftCrop,
    rightCrop: config.compare?.rightCrop,
  };

  return COMPARE_SET_IDS.map((id) => normalizeCompareSet(
    id === "compare-1" ? { ...legacyCompare, ...(sourceById[id] || {}) } : (sourceById[id] || {}),
    baseById[id],
  ));
}

function normalizePoseSfxMap(value = {}) {
  return Object.fromEntries(
    Object.entries(value || {}).map(([pose, sound]) => [pose, migrateSfxName(sound)]),
  );
}

function normalizePoseSfxVolumeMap(value = {}, fallbackVolume = 0.82) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(CHARACTER_POSES.map((pose) => [
    pose,
    clampNumber(source[pose], fallbackVolume, 0, 1.5),
  ]));
}

function normalizeSceneStartSfx(value = {}, fallback = DEFAULT_SCENE_START_SFX) {
  const source = typeof value === "string" ? { name: value } : (value || {});
  const rawName = source.name === "__none__"
    ? "__none__"
    : (String(source.name ?? "").trim() || fallback.name || "");
  const mode = source.mode === "single" ? "single" : "pose";
  const volume = clampNumber(source.volume, fallback.volume ?? 0.82, 0, 1.5);
  return {
    ...fallback,
    ...source,
    enabled: booleanOr(source.enabled, fallback.enabled ?? true),
    skipFirst: booleanOr(source.skipFirst, fallback.skipFirst ?? true),
    mode,
    name: migrateSfxName(rawName),
    volume,
    poseVolumes: normalizePoseSfxVolumeMap(source.poseVolumes, volume),
    offsetMs: clampNumber(source.offsetMs, fallback.offsetMs ?? 0, 0, 3000),
  };
}

function normalizeCharacterPoses(value = {}, fallback = DEFAULT_CHARACTER_POSES) {
  const source = value && typeof value === "object" ? value : {};
  const entries = Object.entries(source)
    .filter(([pose]) => CHARACTER_POSES.includes(pose))
    .map(([pose, rel]) => [pose, String(rel || "").replace(/\\/g, "/")]);
  return {
    ...fallback,
    ...Object.fromEntries(entries),
  };
}

function normalizeCharacterPoseSources(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(Object.entries(source)
    .filter(([pose]) => CHARACTER_POSES.includes(pose))
    .map(([pose, item]) => {
      const state = CHARACTER_SOURCE_STATES.includes(item?.state) ? item.state : "";
      return [pose, {
        original: String(item?.original || "").replace(/\\/g, "/"),
        fallback: String(item?.fallback || "").replace(/\\/g, "/"),
        preview: String(item?.preview || "").replace(/\\/g, "/"),
        render: String(item?.render || "").replace(/\\/g, "/"),
        state: state || "empty",
        progress: clampNumber(item?.progress, 0, 0, 100),
        error: String(item?.error || ""),
        hash: String(item?.hash || ""),
      }];
    }));
}

function normalizePipeline(value = {}) {
  const source = value || {};
  const dirty = { ...DEFAULT_PIPELINE.dirty };
  for (const key of Object.keys(dirty)) {
    dirty[key] = Boolean(source.dirty?.[key]);
  }
  const dirtyReasons = Array.isArray(source.dirtyReasons)
    ? [...new Set(source.dirtyReasons.map((reason) => String(reason || "").trim()).filter(Boolean))]
    : [];
  return {
    dirty,
    dirtyReasons,
    officialSnapshot: {
      propsHash: String(source.officialSnapshot?.propsHash || ""),
      assetManifestHash: String(source.officialSnapshot?.assetManifestHash || ""),
      createdAt: String(source.officialSnapshot?.createdAt || ""),
    },
  };
}

export function defaultProjectConfig({ slug, leftLabel = "A", rightLabel = "B", content = "", contentByCompareSet = null, title = "", templateId = "compare-dual-v1", savedTemplateRef = null, poseStartSide = "left" } = {}) {
  const safeLeft = String(leftLabel || "A").trim();
  const safeRight = String(rightLabel || "B").trim();
  const safePoseStartSide = normalizePoseStartSide(poseStartSide);
  const template = PROJECT_TEMPLATES[normalizeTemplateId(templateId)];
  const compareSets = [
    defaultCompareSet("compare-1", safeLeft, safeRight),
    defaultCompareSet("compare-2", safeLeft, safeRight),
  ];
  const sections = contentByCompareSet
    ? normalizeContentByCompareSet(contentByCompareSet)
    : normalizeContentByCompareSet({ "compare-1": content, "compare-2": "" });
  const lines = planGroupedLines({
    contentByCompareSet: sections,
    compareSets,
    poseStartSide: safePoseStartSide,
  });
  const officialText = contentFromLines(lines);
  const officialSections = contentByCompareSetFromLines(lines);
  const now = timestamp();
  const hash = contentHash(officialSections);
  return {
    version: 4,
    slug,
    title: title || `${safeLeft} vs ${safeRight}`,
    savedTemplateRef: normalizeSavedTemplateRef(savedTemplateRef),
    template: { ...template },
    compare: { ...compareSets[0] },
    compareSets,
    poseStartSide: safePoseStartSide,
    logo: { ...DEFAULT_LOGO },
    background: { ...DEFAULT_BACKGROUND },
    character: {
      packId: "default",
      captionFontFamily: DEFAULT_CAPTION.fontFamily,
      scale: 1,
      x: 0,
      y: 0,
      poseWarnings: {},
      poseSources: {},
      poses: { ...DEFAULT_CHARACTER_POSES },
    },
    lines,
    contentDraft: {
      text: officialText,
      sections: officialSections,
      updatedAt: now,
      hash,
    },
    contentOfficial: {
      revision: 1,
      savedAt: now,
      lineCount: lines.length,
      hash,
    },
    audio: {
      provider: "aimax",
      alignmentProvider: "none",
      voiceId: "",
      speed: 1.1,
      pitch: 0,
      voiceVolume: 1,
      mainAudio: "",
      srt: "",
      bgm: "",
      bgmVolume: 0.18,
      sceneStartSfx: {
        ...DEFAULT_SCENE_START_SFX,
        poseVolumes: { ...DEFAULT_SCENE_START_SFX.poseVolumes },
      },
    },
    poseSfx: {
      "point-left": "mixkit-hard-pop-click.wav",
      "point-right": "mixkit-hard-pop-click.wav",
      question: "mixkit-bubble-pop.wav",
    },
    caption: { ...DEFAULT_CAPTION },
    render: { ...DEFAULT_RENDER },
    layout: { ...DEFAULT_LAYOUT },
    pipeline: normalizePipeline(),
    leftLabel: safeLeft,
    rightLabel: safeRight,
  };
}

export function normalizeProjectConfig(config = {}, slug = "") {
  const legacyLeft = firstOwnValue([[config, "leftLabel"], [config, "left"], [config.compare, "leftLabel"]], "A");
  const legacyRight = firstOwnValue([[config, "rightLabel"], [config, "right"], [config.compare, "rightLabel"]], "B");
  const base = defaultProjectConfig({
    slug: config.slug || slug,
    title: config.title || `${legacyLeft} vs ${legacyRight}`,
    leftLabel: legacyLeft,
    rightLabel: legacyRight,
    content: contentFromLines(config.lines),
    templateId: config.template?.id,
    poseStartSide: config.poseStartSide,
  });

  const compareSets = compareSetsFromConfig(config, base.compareSets);
  const compare = { ...compareSets[0] };
  const poseStartSide = normalizePoseStartSide(config.poseStartSide, base.poseStartSide);

  const background = normalizeBackground(config.background, base.background);

  const logo = normalizeLogo(config.logo, base.logo);

  const character = {
    ...base.character,
    ...(config.character || {}),
    captionFontFamily: normalizeCaptionFontFamily(config.character?.captionFontFamily || config.caption?.fontFamily || base.character.captionFontFamily),
    scale: numberOr(config.character?.scale, base.character.scale),
    x: numberOr(config.character?.x, base.character.x),
    y: numberOr(config.character?.y, base.character.y),
    poses: hasOwn(config.character, "poses")
      ? normalizeCharacterPoses(config.character?.poses, {})
      : normalizeCharacterPoses(base.character.poses),
    poseWarnings: {
      ...base.character.poseWarnings,
      ...(config.character?.poseWarnings || {}),
    },
    poseSources: normalizeCharacterPoseSources(config.character?.poseSources || {}),
  };

  const previousLines = Array.isArray(config.lines) ? config.lines : [];
  const officialSectionsInput = contentByCompareSetFromLines(previousLines);
  const allowEmptyOfficialContent = hasOwn(config, "contentOfficial") && Number(config.contentOfficial?.lineCount) === 0;
  const lines = planGroupedLines({
    contentByCompareSet: officialSectionsInput,
    compareSets,
    previousLines,
    poseStartSide,
    allowEmptyContent: allowEmptyOfficialContent,
  });
  const officialText = contentFromLines(lines);
  const officialSections = contentByCompareSetFromLines(lines);
  const officialHash = contentHash(officialSections);
  const hasDraftText = hasOwn(config.contentDraft, "text");
  const hasDraftSections = hasOwn(config.contentDraft, "sections");
  const draftSections = hasDraftSections
    ? editableContentByCompareSet(config.contentDraft.sections)
    : editableContentByCompareSet(hasDraftText ? config.contentDraft.text : officialSections);
  const draftText = editableContentFromSections(draftSections);
  const contentDraft = {
    text: draftText,
    sections: draftSections,
    updatedAt: String(config.contentDraft?.updatedAt || config.contentOfficial?.savedAt || ""),
    hash: contentHash(draftSections),
  };
  const contentOfficial = {
    revision: Math.max(0, Math.floor(numberOr(config.contentOfficial?.revision, 0))),
    savedAt: String(config.contentOfficial?.savedAt || ""),
    lineCount: lines.length,
    hash: officialHash,
  };

  const audio = {
    ...base.audio,
    ...(config.audio || {}),
    alignmentProvider: normalizeAlignmentProvider(config.audio?.alignmentProvider),
    sceneStartSfx: normalizeSceneStartSfx(config.audio?.sceneStartSfx, base.audio.sceneStartSfx),
    speed: numberOr(config.audio?.speed ?? config.speed, 1.1),
    pitch: Math.round(clampNumber(config.audio?.pitch ?? config.pitch, 0, -12, 12)),
    voiceVolume: numberOr(config.audio?.voiceVolume, 1),
    bgmVolume: numberOr(config.audio?.bgmVolume, 0.18),
  };

  return {
    ...base,
    ...config,
    version: 4,
    slug: config.slug || slug || base.slug,
    title: config.title || `${compare.leftLabel} vs ${compare.rightLabel}`,
    savedTemplateRef: normalizeSavedTemplateRef(config.savedTemplateRef),
    template: {
      ...PROJECT_TEMPLATES[normalizeTemplateId(config.template?.id)],
      ...(config.template || {}),
      id: normalizeTemplateId(config.template?.id),
    },
    compare,
    compareSets,
    poseStartSide,
    logo,
    background,
    character,
    lines,
    contentDraft,
    contentOfficial,
    audio,
    poseSfx: {
      ...base.poseSfx,
      ...normalizePoseSfxMap(config.poseSfx || {}),
    },
    caption: {
      ...base.caption,
      ...(config.caption || config.captionStyle || {}),
      style: CAPTION_STYLE_IDS.includes(config.caption?.style)
        ? config.caption.style
        : "vietnam-bold-highlight",
      animation: CAPTION_ANIMATION_IDS.includes(config.caption?.animation)
        ? config.caption.animation
        : base.caption.animation,
      fontFamily: normalizeCaptionFontFamily(config.caption?.fontFamily || character.captionFontFamily || base.caption.fontFamily),
      strokeWidth: clampNumber(config.caption?.strokeWidth, base.caption.strokeWidth, 4, 18),
      wordGap: clampNumber(config.caption?.wordGap, base.caption.wordGap, 0, 32),
      uppercase: booleanOr(config.caption?.uppercase, base.caption.uppercase),
      shadowPreset: ["default", "capcut-heavy"].includes(config.caption?.shadowPreset)
        ? config.caption.shadowPreset
        : base.caption.shadowPreset,
    },
    render: {
      ...base.render,
      ...(config.render || {}),
      engine: "remotion",
      width: numberOr(config.render?.width, 1080),
      height: numberOr(config.render?.height, 1920),
      fps: numberOr(config.render?.fps, 30),
      preferredMode: normalizeRenderMode(config.render?.preferredMode, base.render.preferredMode),
    },
    layout: {
      ...base.layout,
      ...(config.layout || {}),
      // Version 2 originally used 900px for every new project, which can
      // overlap a tall character. Keep a manually selected 900px position,
      // but move untouched legacy defaults to the safer position.
      captionY: Number(config.layout?.captionY) === 900 && !config.layout?.captionYExplicit
        ? base.layout.captionY
        : numberOr(config.layout?.captionY, base.layout.captionY),
      captionYExplicit: Boolean(config.layout?.captionYExplicit),
      photoCompareSize: clampNumber(config.layout?.photoCompareSize, base.layout.photoCompareSize, 340, 500),
      photoCompareOffsetY: clampNumber(config.layout?.photoCompareOffsetY, base.layout.photoCompareOffsetY, -80, 220),
      compareLabelPlacement: normalizeCompareLabelPlacement(config.layout?.compareLabelPlacement, base.layout.compareLabelPlacement),
      compareLabelUppercase: booleanOr(config.layout?.compareLabelUppercase, base.layout.compareLabelUppercase),
      compareLabelBoxEnabled: booleanOr(config.layout?.compareLabelBoxEnabled, base.layout.compareLabelBoxEnabled),
      compareLabelAlign: normalizeCompareLabelAlign(config.layout?.compareLabelAlign, base.layout.compareLabelAlign),
      compareLabelFontSize: clampNumber(config.layout?.compareLabelFontSize, base.layout.compareLabelFontSize, 0, 96),
      compareLabelHeight: clampNumber(config.layout?.compareLabelHeight, base.layout.compareLabelHeight, 60, 220),
      compareLabelPaddingX: clampNumber(config.layout?.compareLabelPaddingX, base.layout.compareLabelPaddingX, 0, 60),
      compareLabelPaddingY: clampNumber(config.layout?.compareLabelPaddingY, base.layout.compareLabelPaddingY, 0, 36),
      compareLabelColor: hexColorOr(config.layout?.compareLabelColor, hexColorOr(config.layout?.photoLabelColor, base.layout.compareLabelColor)),
      compareLabelBackground: hexColorOr(config.layout?.compareLabelBackground, base.layout.compareLabelBackground),
      compareLabelBackgroundOpacity: clampNumber(config.layout?.compareLabelBackgroundOpacity, base.layout.compareLabelBackgroundOpacity, 0, 1),
      compareLabelBorderColor: hexColorOr(config.layout?.compareLabelBorderColor, base.layout.compareLabelBorderColor),
      compareLabelBorderWidth: clampNumber(config.layout?.compareLabelBorderWidth, base.layout.compareLabelBorderWidth, 0, 10),
      compareLabelRadius: clampNumber(config.layout?.compareLabelRadius, base.layout.compareLabelRadius, 0, 32),
      compareLabelShadow: normalizeCompareLabelShadow(config.layout?.compareLabelShadow, base.layout.compareLabelShadow),
      compareVsColor: hexColorOr(config.layout?.compareVsColor, base.layout.compareVsColor),
      compareVsTextColor: hexColorOr(config.layout?.compareVsTextColor, base.layout.compareVsTextColor),
      compareVsBorderColor: hexColorOr(config.layout?.compareVsBorderColor, base.layout.compareVsBorderColor),
      photoFrameBorderColor: hexColorOr(config.layout?.photoFrameBorderColor, base.layout.photoFrameBorderColor),
      photoFrameShadowColor: hexColorOr(config.layout?.photoFrameShadowColor, base.layout.photoFrameShadowColor),
      photoLabelColor: hexColorOr(config.layout?.photoLabelColor, base.layout.photoLabelColor),
      focusScaleLarge: clampNumber(config.layout?.focusScaleLarge, base.layout.focusScaleLarge, 1.05, 1.35),
      focusScaleSmall: clampNumber(config.layout?.focusScaleSmall, base.layout.focusScaleSmall, 0.65, 0.98),
      focusMotionDuration: clampNumber(config.layout?.focusMotionDuration, base.layout.focusMotionDuration, 0.25, 1),
      focusImageBlur: clampNumber(config.layout?.focusImageBlur, base.layout.focusImageBlur, 0, 8),
      focusImageDarkness: clampNumber(config.layout?.focusImageDarkness, base.layout.focusImageDarkness, 0, 0.7),
    },
    pipeline: normalizePipeline(config.pipeline),
    leftLabel: compare.leftLabel,
    rightLabel: compare.rightLabel,
  };
}
