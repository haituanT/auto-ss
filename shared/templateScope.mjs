// The canonical contract for data that may cross the project/template boundary.
// Keep this module dependency-free: it is imported by both the studio backend
// and browser-facing tooling.

export const TEMPLATE_SCOPE_VERSION = 2;

export const TEMPLATE_SCOPE_PARTS = Object.freeze([
  "caption",
  "character",
  "audio",
  "layout",
  "background",
  "render",
]);

export const TEMPLATE_DIFF_LABELS = Object.freeze({
  "layout.compareLabelPlacement": "Vi tri noi dung A/B",
  "layout.compareLabelAlign": "Can noi dung A/B",
  "layout.compareLabelFontSize": "Co chu noi dung A/B",
  "layout.compareLabelHeight": "Chieu cao noi dung A/B",
  "layout.compareLabelPaddingX": "Dem ngang noi dung A/B",
  "layout.compareLabelPaddingY": "Dem doc noi dung A/B",
  "layout.compareLabelColor": "Mau chu noi dung A/B",
  "layout.compareLabelBackground": "Mau nen noi dung A/B",
  "layout.compareLabelBackgroundOpacity": "Do trong nen noi dung A/B",
  "layout.compareLabelBorderColor": "Mau vien noi dung A/B",
  "layout.compareLabelBorderWidth": "Do day vien noi dung A/B",
  "layout.compareLabelRadius": "Bo goc noi dung A/B",
  "layout.compareLabelShadow": "Bong noi dung A/B",
  "caption.style": "Kiểu phụ đề",
  "caption.animation": "Hiệu ứng phụ đề",
  "caption.fontFamily": "Font phụ đề",
  "caption.fontSize": "Cỡ chữ phụ đề",
  "caption.normalColor": "Màu chữ phụ đề",
  "caption.hotColor": "Màu nhấn phụ đề",
  "caption.strokeColor": "Màu viền phụ đề",
  "caption.strokeWidth": "Độ dày viền phụ đề",
  "caption.wordGap": "Khoảng cách từ phụ đề",
  "caption.uppercase": "Viết hoa phụ đề",
  "caption.shadowPreset": "Bóng phụ đề",
  "layout.captionY": "Vị trí phụ đề",
  "character.packId": "Pack nhân vật",
  "character.captionFontFamily": "Font liên quan nhân vật",
  "character.scale": "Scale nhân vật",
  "character.x": "Vị trí nhân vật ngang",
  "character.y": "Vị trí nhân vật dọc",
  "character.poses.point-left": "Pose chỉ trái",
  "character.poses.point-right": "Pose chỉ phải",
  "character.poses.question": "Pose câu hỏi",
  "audio.provider": "Provider âm thanh",
  "audio.voiceId": "Giọng đọc",
  "audio.speed": "Tốc độ đọc",
  "audio.pitch": "Cao độ giọng",
  "audio.voiceVolume": "Âm lượng giọng",
  "audio.bgm": "BGM",
  "audio.bgmVolume": "Âm lượng BGM",
  "audio.sceneStartSfx": "Sound đầu cảnh",
  "poseSfx.point-left": "Sound pose chỉ trái",
  "poseSfx.point-right": "Sound pose chỉ phải",
  "poseSfx.question": "Sound pose câu hỏi",
  "template.id": "Bố cục video",
  "layout.width": "Chiều rộng layout",
  "layout.height": "Chiều cao layout",
  "layout.compareTop": "Vị trí vùng so sánh",
  "layout.compareHeight": "Chiều cao vùng so sánh",
  "layout.dualCompareSize": "Cỡ ảnh so sánh 2 bên",
  "layout.dualCompareOffsetY": "Dịch ảnh so sánh 2 bên",
  "layout.photoCompareSize": "Cỡ ảnh A/B",
  "layout.photoCompareOffsetY": "Dịch ảnh A/B",
  "layout.compareLabelUppercase": "Viết hoa nhãn A/B",
  "layout.compareVsColor": "Màu nền VS",
  "layout.compareVsTextColor": "Màu chữ VS",
  "layout.compareVsBorderColor": "Màu viền VS",
  "layout.photoFrameBorderColor": "Viền khung ảnh",
  "layout.photoFrameShadowColor": "Bóng khung ảnh",
  "layout.photoLabelColor": "Màu chữ A/B",
  "layout.focusScaleLarge": "Scale ảnh đang trỏ",
  "layout.focusScaleSmall": "Scale ảnh còn lại",
  "layout.focusMotionDuration": "Độ mượt focus",
  "layout.focusImageBlur": "Độ mờ ảnh phụ",
  "layout.focusImageDarkness": "Độ tối ảnh phụ",
  "layout.characterY": "Vị trí nhân vật trong layout",
  "layout.characterHeight": "Chiều cao nhân vật",
  "poseStartSide": "Bắt đầu chỉ bên",
  "background.type": "Kiểu nền",
  "background.src": "Ảnh nền",
  "background.color": "Màu nền",
  "background.treatment": "Kiểu xử lý nền",
  "background.detail": "Chi tiết nền",
  "background.shade": "Độ phủ nền",
  "background.blur": "Làm mờ nền",
  "logo.enabled": "Bật logo",
  "logo.src": "Logo",
  "logo.width": "Kích thước logo",
  "logo.anchor": "Vị trí logo",
  "logo.x": "Logo ngang",
  "logo.y": "Logo dọc",
  "logo.opacity": "Độ trong logo",
  "logo.layer": "Lớp logo",
  "logo.backdrop": "Nền logo",
  "render.engine": "Engine render",
  "render.width": "Chiều rộng render",
  "render.height": "Chiều cao render",
  "render.fps": "FPS render",
  "render.preferredMode": "Chế độ render",
});

const CAPTION_KEYS = [
  "style",
  "animation",
  "fontFamily",
  "fontSize",
  "normalColor",
  "hotColor",
  "strokeColor",
  "strokeWidth",
  "wordGap",
  "uppercase",
  "shadowPreset",
];

const CHARACTER_KEYS = ["packId", "captionFontFamily", "scale", "x", "y"];
const CHARACTER_POSES = ["point-left", "point-right", "question"];
const AUDIO_KEYS = ["provider", "voiceId", "speed", "pitch", "voiceVolume", "bgm", "bgmVolume", "sceneStartSfx"];
const LAYOUT_KEYS = [
  "compareLabelPlacement",
  "compareLabelAlign",
  "compareLabelFontSize",
  "compareLabelHeight",
  "compareLabelPaddingX",
  "compareLabelPaddingY",
  "compareLabelColor",
  "compareLabelBackground",
  "compareLabelBackgroundOpacity",
  "compareLabelBorderColor",
  "compareLabelBorderWidth",
  "compareLabelRadius",
  "compareLabelShadow",
  "width",
  "height",
  "compareTop",
  "compareHeight",
  "dualCompareSize",
  "dualCompareOffsetY",
  "photoCompareSize",
  "photoCompareOffsetY",
  "compareLabelUppercase",
  "compareVsColor",
  "compareVsTextColor",
  "compareVsBorderColor",
  "photoFrameBorderColor",
  "photoFrameShadowColor",
  "photoLabelColor",
  "focusScaleLarge",
  "focusScaleSmall",
  "focusMotionDuration",
  "focusImageBlur",
  "focusImageDarkness",
  "characterY",
  "characterHeight",
];
const RENDER_KEYS = ["engine", "width", "height", "fps", "preferredMode"];
const BACKGROUND_KEYS = ["type", "src", "color", "treatment", "detail", "shade", "blur"];
const LOGO_KEYS = ["enabled", "src", "width", "anchor", "x", "y", "opacity", "layer", "backdrop"];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function pick(source, keys) {
  const result = {};
  for (const key of keys) {
    if (source && Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
      result[key] = clone(source[key]);
    }
  }
  return result;
}

function sourceConfig(value) {
  // Accept both a project config and a stored template object. This keeps all
  // comparison callers on the same canonical path.
  if (isObject(value?.config) && value?.type && value?.parts) return value.config;
  return isObject(value) ? value : {};
}

function enabledPart(parts, name, fallback = true) {
  return parts ? Boolean(parts[name]) : fallback;
}

function sanitizeSceneStartSfx(value) {
  const source = isObject(value) ? value : {};
  return pick(source, ["enabled", "skipFirst", "mode", "name", "volume", "poseVolumes", "offsetMs"]);
}

function sanitizePoseSources(value = {}, poses = {}) {
  const result = {};
  for (const pose of CHARACTER_POSES) {
    const source = isObject(value?.[pose]) ? value[pose] : {};
    const posePath = poses[pose] || "";
    if (!posePath && !Object.keys(source).length) continue;
    // Runtime fields (progress/error/temp/original conversion jobs) never cross
    // the boundary. The main pose is the stable preview/render asset.
    result[pose] = {
      preview: source.preview || posePath,
      render: source.render || posePath,
      state: source.state === "image-ready" ? "image-ready" : "ready",
    };
  }
  return result;
}

/**
 * Pick only the stable, whitelisted portion of a project configuration.
 * Full templates intentionally do not include content, compare labels/images,
 * crops, AI history, voiceover output, timing, render output, or pipeline state.
 */
export function pickTemplateScope(value = {}, options = {}) {
  const config = sourceConfig(value);
  const parts = options.parts || null;
  const includeContent = Boolean(options.includeContent || (parts && parts.content));
  const result = {};

  if (enabledPart(parts, "caption")) {
    result.caption = pick(config.caption, CAPTION_KEYS);
    result.layout = {
      ...(result.layout || {}),
      ...pick(config.layout, ["captionY", "captionYExplicit"]),
    };
  }

  if (enabledPart(parts, "character")) {
    const character = pick(config.character, CHARACTER_KEYS);
    const poses = {};
    for (const pose of CHARACTER_POSES) {
      if (config.character?.poses?.[pose] !== undefined) poses[pose] = String(config.character.poses[pose] || "").replace(/\\/g, "/");
    }
    character.poses = poses;
    character.poseSources = sanitizePoseSources(config.character?.poseSources, poses);
    result.character = character;
  }

  if (enabledPart(parts, "audio")) {
    const audio = pick(config.audio, AUDIO_KEYS);
    if (audio.sceneStartSfx) audio.sceneStartSfx = sanitizeSceneStartSfx(audio.sceneStartSfx);
    result.audio = audio;
    result.poseSfx = pick(config.poseSfx, CHARACTER_POSES);
  }

  if (enabledPart(parts, "layout")) {
    result.template = pick(config.template, ["id", "name", "version"]);
    result.layout = { ...(result.layout || {}), ...pick(config.layout, LAYOUT_KEYS) };
    if (config.poseStartSide !== undefined) result.poseStartSide = config.poseStartSide === "right" ? "right" : "left";
    // Do not pick config.compare or compareSets here. Their labels, images,
    // crop, zoom and per-content focus are project data by contract.
  }

  if (enabledPart(parts, "background")) {
    result.background = pick(config.background, BACKGROUND_KEYS);
    result.logo = pick(config.logo, LOGO_KEYS);
  }

  if (enabledPart(parts, "render")) {
    result.render = pick(config.render, RENDER_KEYS);
  } else if (enabledPart(parts, "layout")) {
    // Existing UI has no separate Render part. Layout/full saves still carry
    // the render contract so applying a template is complete.
    result.render = pick(config.render, RENDER_KEYS);
  }

  if (includeContent) {
    result.content = {
      lines: (Array.isArray(config.lines) ? config.lines : []).map((line, index) => ({
        id: line?.id || `line-${index + 1}`,
        compareSetId: line?.compareSetId || "compare-1",
        text: String(line?.text || line?.caption || line?.tts || "").trim(),
        role: line?.role || "neutral",
        pose: line?.pose || "question",
        highlight: line?.highlight || "",
        sfx: line?.sfx || "",
        poseLocked: Boolean(line?.poseLocked),
      })).filter((line) => line.text),
    };
  }

  return result;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

/** Stable JSON is used by both UI diagnostics and backend writes. */
export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function normalizeTemplateScope(value, options = {}) {
  return stableValue(pickTemplateScope(value, options));
}

function pathLabel(path, part) {
  const joined = path.join(".");
  return TEMPLATE_DIFF_LABELS[joined]
    || TEMPLATE_DIFF_LABELS[`${part}.${path.slice(1).join(".")}`]
    || path.join(" ");
}

function displayValue(value) {
  if (value === undefined || value === null || value === "") return "trống";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function walkDiffs(before, after, path, part, output, normalizeValue) {
  const normalizedBefore = normalizeValue ? normalizeValue(before, path, "project") : before;
  const normalizedAfter = normalizeValue ? normalizeValue(after, path, "template") : after;
  if (stableJson(normalizedBefore) === stableJson(normalizedAfter)) return;

  if (isObject(normalizedBefore) || isObject(normalizedAfter)) {
    const keys = new Set([
      ...Object.keys(isObject(normalizedBefore) ? normalizedBefore : {}),
      ...Object.keys(isObject(normalizedAfter) ? normalizedAfter : {}),
    ]);
    for (const key of [...keys].sort()) {
      walkDiffs(
        normalizedBefore?.[key],
        normalizedAfter?.[key],
        [...path, key],
        part,
        output,
        normalizeValue,
      );
    }
    return;
  }

  output.push({
    part,
    path,
    key: path.join("."),
    label: pathLabel(path, part),
    before: displayValue(normalizedBefore),
    after: displayValue(normalizedAfter),
    beforeValue: clone(normalizedBefore),
    afterValue: clone(normalizedAfter),
  });
}

/**
 * Return only whitelist diffs. `normalizeValue` is intentionally injectable so
 * the backend can compare asset contents instead of versioned path strings.
 */
export function diffTemplateScope(projectConfig = {}, templateConfig = {}, options = {}) {
  const project = pickTemplateScope(projectConfig, options);
  const template = pickTemplateScope(templateConfig, options);
  const result = [];
  const keys = new Set([...Object.keys(project), ...Object.keys(template)]);
  for (const key of [...keys].sort()) {
    const part = key === "template" || key === "layout" || key === "poseStartSide" ? "layout" : key;
    walkDiffs(project[key], template[key], [key], part, result, options.normalizeValue);
  }
  return result;
}

export const TEMPLATE_BLACKLIST = Object.freeze([
  "lines",
  "contentDraft",
  "contentOfficial",
  "compare.leftLabel",
  "compare.rightLabel",
  "compare.leftImage",
  "compare.rightImage",
  "compare.leftZoom",
  "compare.rightZoom",
  "compare.leftCrop",
  "compare.rightCrop",
  "compareSets",
  "aiImages",
  "audio.mainAudio",
  "audio.srt",
  "audio.duration",
  "audio.wordTiming",
  "pipeline",
  "preview",
  "renderOutput",
  "snapshot",
  "job",
  "temp",
  "cache",
]);
