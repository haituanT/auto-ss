import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { APP_VERSION } from "../../../shared/appVersion.mjs";
import { CAPTION_FONT_OPTIONS, DEFAULT_CAPTION_FONT_FAMILY, captionFontStack } from "../../../shared/captionOptions.mjs";
import { CAPTION_PRESETS, applyCaptionPreset } from "../../../shared/captionPresets.mjs";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Crop,
  Download,
  ExternalLink,
  FileAudio,
  FolderOpen,
  Image as ImageIcon,
  Link2,
  MoreHorizontal,
  Play,
  Pause,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
  Volume2,
  Wand2,
  X,
} from "lucide-react";
import { applyLiveSoundToPreviewProps, buildLineScopedPreviewProps } from "./soundPreview.js";
import { requestJson as api, requestText, uploadForm as uploadApi } from "./api/client.js";
import { GlobalJobStrip, HomeJobsPanel } from "./components/GlobalJobStatus.jsx";
import { isRunningJob as isActiveJob, isTerminalJob } from "./jobUtils.js";
import "./styles.css";

const RemotionPlayerView = lazy(() => import("./components/RemotionPlayerView.jsx"));

const TEST_CONTENT = `Đây là ly thân,
đây là ly hôn.
Sự khác biệt ở đâu??

Ly thân là khi hai vợ chồng không còn sống chung, không còn sinh hoạt chung, thậm chí mỗi người một nơi. Nhưng trên giấy tờ, họ vẫn là vợ chồng.

Còn ly hôn là khi quan hệ vợ chồng chấm dứt theo bản án hoặc quyết định có hiệu lực của Tòa án.`;

const LAYOUT = {
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
};
const BACKGROUND_DEFAULTS = {
  detail: 0,
  shade: 0,
  blur: 0,
};

const POSE_LABELS = {
  "point-left": "Chỉ trái",
  "point-right": "Chỉ phải",
  question: "Đặt câu hỏi",
};
const FOCUS_SIDE_LABELS = {
  left: "Trái",
  center: "Giữa",
  right: "Phải",
};
const FOCUS_SIDE_OPTIONS = Object.entries(FOCUS_SIDE_LABELS).map(([id, label]) => ({ id, label }));
const DEFAULT_POSE_SFX = {
  "point-left": "mixkit-hard-pop-click.wav",
  "point-right": "mixkit-hard-pop-click.wav",
  question: "mixkit-bubble-pop.wav",
};
const DEFAULT_POSE_SFX_VOLUME = 0.82;
const DEFAULT_POSE_SFX_VOLUMES = Object.fromEntries(Object.keys(DEFAULT_POSE_SFX).map((pose) => [pose, DEFAULT_POSE_SFX_VOLUME]));
const AIMAX_PITCH_MIN = -12;
const AIMAX_PITCH_MAX = 12;
const COMPLETION_SOUND_URL = "/shared-assets/sfx/kenney/confirmation_001.ogg";
const LOGO_ANCHOR_OPTIONS = [
  { id: "bottom-right", label: "Dưới phải" },
  { id: "bottom-left", label: "Dưới trái" },
  { id: "top-right", label: "Trên phải" },
  { id: "top-left", label: "Trên trái" },
  { id: "center", label: "Giữa" },
];
const LOGO_LAYER_OPTIONS = [
  { id: "above-character", label: "Trên nhân vật" },
  { id: "below-character", label: "Dưới nhân vật" },
];
const COMPARE_SET_IDS = ["compare-1", "compare-2"];
const AI_IMAGE_PROVIDER_OPTIONS = [
  { id: "agy", label: "Agy" },
  { id: "codex", label: "Codex" },
];
const AI_IMAGE_STYLE_OPTIONS = [
  { id: "science", label: "Khoa học" },
  { id: "realistic", label: "Thực tế" },
  { id: "cartoon", label: "Hoạt hình" },
  { id: "3d", label: "3D" },
];
const AI_IMAGE_VARIANT_OPTIONS = [1, 2, 3];
const IMAGE_FILE_ACCEPT = "image/*,.png,.jpg,.jpeg,.jpe,.jfif,.webp";
const EDITOR_TAB_IDS = ["content", "character", "audio", "caption", "render"];
const COMPARE_LABEL_PLACEMENT_OPTIONS = [
  { id: "auto", label: "Theo template" },
  { id: "below", label: "Dưới hình ảnh" },
  { id: "above", label: "Trên hình ảnh" },
  { id: "overlay", label: "Đè lên hình ảnh" },
  { id: "hidden", label: "Ẩn nội dung A/B" },
];
const COMPARE_LABEL_ALIGN_OPTIONS = [
  { id: "left", label: "Trái" },
  { id: "center", label: "Giữa" },
  { id: "right", label: "Phải" },
];
const COMPARE_LABEL_SHADOW_OPTIONS = [
  { id: "none", label: "Không bóng" },
  { id: "soft", label: "Bóng mềm" },
  { id: "hard", label: "Bóng cứng" },
];

const TEMPLATE_PARTS = ["caption", "character", "audio", "layout", "background", "render", "content"];
const TEMPLATE_TYPE_TABS = [
  { id: "all", label: "Tất cả" },
  { id: "full", label: "Toàn bộ" },
  { id: "caption", label: "Phụ đề" },
  { id: "character", label: "Nhân vật" },
  { id: "audio", label: "Âm thanh" },
  { id: "layout", label: "Bố cục" },
  { id: "background", label: "Nền" },
  { id: "content", label: "Nội dung" },
];
const TEMPLATE_PART_LABELS = {
  caption: "Phụ đề",
  character: "Nhân vật",
  audio: "Âm thanh",
  layout: "Bố cục",
  background: "Nền",
  render: "Render",
  content: "Kịch bản",
};
const TEMPLATE_TYPE_LABELS = {
  full: "Toàn bộ",
  ...TEMPLATE_PART_LABELS,
};
const DEFAULT_FULL_TEMPLATE_PARTS = {
  caption: true,
  character: true,
  audio: true,
  layout: true,
  background: true,
  render: true,
  content: false,
};

function roleForPose(pose) {
  if (pose === "point-left") return "A";
  if (pose === "point-right") return "B";
  return "question";
}

function focusSideForPose(pose) {
  if (pose === "point-left") return "right";
  if (pose === "point-right") return "left";
  return "center";
}

function normalizeFocusSide(value, fallback = "center") {
  return Object.prototype.hasOwnProperty.call(FOCUS_SIDE_LABELS, value) ? value : fallback;
}

function BrandLogo() {
  return (
    <img src="/auto-compare-logo-v2.png" alt="" aria-hidden="true" />
  );
}

function applyManualPose(line, pose) {
  if (!line) return;
  line.pose = pose;
  line.poseLocked = true;
  line.focusSide = focusSideForPose(pose);
  line.focusSideLocked = true;
  line.role = roleForPose(pose);
  if (pose === "question") line.highlight = "";
}

function applyManualFocusSide(line, focusSide) {
  if (!line) return;
  line.focusSide = normalizeFocusSide(focusSide, focusSideForPose(line.pose));
  line.focusSideLocked = true;
}

function markVoiceDirty(draft) {
  draft.lines = (draft.lines || []).map((line) => ({
    ...line,
    dirtyVoice: line.dirtyVoice || Number.isFinite(Number(line.start)),
    dirtyVoiceReason: line.dirtyVoiceReason || (Number.isFinite(Number(line.start)) ? "audio-settings" : ""),
  }));
}

function templatePartsForType(type, parts = {}) {
  const hasExplicitParts = TEMPLATE_PARTS.some((part) => Object.prototype.hasOwnProperty.call(parts || {}, part));
  if (type === "full") {
    return Object.fromEntries(TEMPLATE_PARTS.map((part) => [part, Boolean(parts[part] ?? DEFAULT_FULL_TEMPLATE_PARTS[part])]));
  }
  if (hasExplicitParts) {
    return Object.fromEntries(TEMPLATE_PARTS.map((part) => [part, Boolean(parts[part])]));
  }
  return Object.fromEntries(TEMPLATE_PARTS.map((part) => [part, part === type]));
}

function templatePartNames(parts = {}) {
  return TEMPLATE_PARTS
    .filter((part) => parts?.[part])
    .map((part) => TEMPLATE_PART_LABELS[part])
    .join(", ");
}

function defaultTemplateName(type, config) {
  const title = config?.title || "project";
  const label = TEMPLATE_TYPE_LABELS[type] || "Mẫu";
  return type === "full" ? `${title} full` : `${label} - ${title}`;
}

const PROJECT_TEMPLATES = [
  {
    id: "compare-dual-v1",
    name: "So sánh 2 bên",
    description: "Hai thẻ A/B có nhãn VS ở giữa. Bạn chỉ cần thêm ảnh A và ảnh B.",
  },
  {
    id: "photo-compare-v1",
    name: "Ảnh xếp theo bố cục",
    description: "Hai ảnh vuông cố định theo mẫu, tên nằm phía trên. Chỉ thêm ảnh, crop và zoom trong khung mẫu.",
  },
  {
    id: "photo-clean-frame-v1",
    name: "Ảnh khung trơn",
    description: "Hai ảnh vuông cùng bố cục nhưng không viền, không bo góc, không bóng đổ và không có nhãn VS.",
  },
  {
    id: "focus-scale-v1",
    name: "Trỏ đâu phóng đó",
    description: "Ảnh đang được nhắc tới phóng to mượt, ảnh còn lại thu nhỏ. Không dùng nhãn VS.",
  },
];

const COMPARE_DUAL_TEMPLATE_ID = "compare-dual-v1";
const PHOTO_LAYOUT_TEMPLATE_IDS = new Set(["photo-compare-v1", "photo-clean-frame-v1"]);
const VS_TEMPLATE_IDS = new Set(["compare-dual-v1", "photo-compare-v1"]);
const FOCUS_SCALE_TEMPLATE_ID = "focus-scale-v1";
const TEMPLATE_IMAGE_SPECS = {
  "compare-dual-v1": { width: 410, height: 410 },
  "photo-compare-v1": { width: 390, height: 390 },
  "photo-clean-frame-v1": { width: 390, height: 390 },
  "focus-scale-v1": { width: 410, height: 410 },
};

function isPhotoLayoutTemplateId(templateId) {
  return PHOTO_LAYOUT_TEMPLATE_IDS.has(templateId);
}

function hasVsTemplateId(templateId) {
  return VS_TEMPLATE_IDS.has(templateId);
}

function isFocusScaleTemplateId(templateId) {
  return templateId === FOCUS_SCALE_TEMPLATE_ID;
}

function resolveCompareLabelPlacement(value, templateId) {
  const requested = COMPARE_LABEL_PLACEMENT_OPTIONS.some((option) => option.id === value) ? value : "auto";
  if (requested !== "auto") return requested;
  return isPhotoLayoutTemplateId(templateId) ? "above" : "below";
}

const CAPTION_STYLES = [
  {
    id: "vietnam-bold-highlight",
    name: "Vietnam Bold Highlight",
    description: "Chữ đậm, viền sáng, từ khóa cam. Dễ đọc trên nền sáng.",
  },
  {
    id: "karaoke-pill",
    name: "Karaoke Pill",
    description: "Chữ chạy trong nền đen bo tròn. Hợp với nền nhiều chi tiết.",
  },
  {
    id: "clean-outline",
    name: "Clean Outline",
    description: "Chữ sạch, viền trắng nhẹ, ít chiếm diện tích.",
  },
  {
    id: "impact-pop",
    name: "Impact Pop",
    description: "Chữ đậm, viền tối, hợp với câu ngắn cần nhấn mạnh.",
  },
  {
    id: "soft-box",
    name: "Soft Box",
    description: "Nền sáng mềm, dễ đọc trên ảnh tối hoặc video nhiều chi tiết.",
  },
  {
    id: "neon-glow",
    name: "Neon Glow",
    description: "Viền cyan và từ khóa hồng, dùng cho nội dung năng động.",
  },
  {
    id: "capcut-karaoke",
    name: "CapCut Viral Karaoke",
    description: "Chữ trắng viền đen dày, từ đang đọc đổi vàng theo tiếng.",
  },
];

const CAPTION_ANIMATIONS = [
  {
    id: "word-pop",
    name: "Nhảy từng từ",
    description: "Nhiều từ trên một hàng, đọc tới từ nào thì từ đó bật màu và nảy nhẹ.",
  },
  {
    id: "line-pop",
    name: "Hiện cả dòng",
    description: "Giữ cách cũ: cả dòng phụ đề hiện cùng một nhịp.",
  },
  {
    id: "word-color",
    name: "Đổi màu theo tiếng",
    description: "Từ đang đọc chuyển màu, không phóng to và không nảy.",
  },
];

const CAPTION_STROKE_WIDTH_OPTIONS = [4, 8, 10, 12, 14, 16, 18];
const CAPTION_PRESET_COLLAPSED_COUNT = 4;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  return JSON.stringify(value ?? null);
}

function valueAt(source, path) {
  return path.reduce((value, key) => (value == null ? undefined : value[key]), source);
}

function assetName(value) {
  return String(value || "").replace(/\\/g, "/").split("/").pop() || "";
}

function compactValue(value) {
  if (value == null || value === "") return "trống";
  if (typeof value === "boolean") return value ? "bật" : "tắt";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
  if (typeof value === "string") return value.length > 42 ? `${value.slice(0, 39)}...` : value;
  if (Array.isArray(value)) return `${value.length} mục`;
  return "đã chỉnh";
}

function lineFocusSnapshot(lines = []) {
  return (Array.isArray(lines) ? lines : []).map((line, index) => ({
    id: line?.id || `line-${index + 1}`,
    index,
    focusSide: normalizeFocusSide(line?.focusSide, focusSideForPose(line?.pose)),
    focusSideLocked: Boolean(line?.focusSideLocked),
  }));
}

function focusLabel(value) {
  return FOCUS_SIDE_LABELS[normalizeFocusSide(value, "center")] || "Giữa";
}

function compareSummary(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const left = source.leftLabel || "A";
  const right = source.rightLabel || "B";
  return `${left} / ${right}`;
}

function compareSetsSummary(value = []) {
  const sets = Array.isArray(value) ? value : [];
  if (!sets.length) return "trống";
  return sets.map((set, index) => `${compareSetLabel(set.id || `compare-${index + 1}`)}: ${compareSummary(set)}`).join("; ");
}

function pushPathDiff(diffs, part, label, beforeConfig, afterConfig, path, formatter = compactValue) {
  const before = valueAt(beforeConfig, path);
  const after = valueAt(afterConfig, path);
  if (stableJson(before) === stableJson(after)) return;
  diffs.push({
    part,
    label,
    before: formatter(before),
    after: formatter(after),
  });
}

function compareLineFocus(diffs, beforeFocus = [], afterLines = []) {
  const beforeById = Object.fromEntries((beforeFocus || []).map((item) => [item.id, item]));
  const afterFocus = lineFocusSnapshot(afterLines);
  afterFocus.forEach((after, index) => {
    const before = beforeById[after.id] || beforeFocus[index] || {};
    if (!before.focusSideLocked && !after.focusSideLocked) return;
    const beforeValue = {
      focusSide: normalizeFocusSide(before.focusSide, "center"),
      focusSideLocked: Boolean(before.focusSideLocked),
    };
    const afterValue = {
      focusSide: normalizeFocusSide(after.focusSide, "center"),
      focusSideLocked: Boolean(after.focusSideLocked),
    };
    if (stableJson(beforeValue) === stableJson(afterValue)) return;
    diffs.push({
      part: "layout",
      label: `Focus dòng ${index + 1}`,
      before: `${focusLabel(beforeValue.focusSide)}${beforeValue.focusSideLocked ? " (khóa)" : ""}`,
      after: `${focusLabel(afterValue.focusSide)}${afterValue.focusSideLocked ? " (khóa)" : ""}`,
    });
  });
}

function templateChangeDiffs(projectConfig = {}, template = {}) {
  const parts = template.parts || {};
  const templateConfig = template.config || {};
  const diffs = [];
  if (parts.caption) {
    [
      ["Kiểu phụ đề", ["caption", "style"]],
      ["Hiệu ứng phụ đề", ["caption", "animation"]],
      ["Font phụ đề", ["caption", "fontFamily"]],
      ["Cỡ chữ phụ đề", ["caption", "fontSize"]],
      ["Màu chữ phụ đề", ["caption", "normalColor"]],
      ["Màu nhấn phụ đề", ["caption", "hotColor"]],
      ["Màu viền phụ đề", ["caption", "strokeColor"]],
      ["Độ dày viền phụ đề", ["caption", "strokeWidth"]],
      ["Viết hoa phụ đề", ["caption", "uppercase"]],
      ["Bóng phụ đề", ["caption", "shadowPreset"]],
      ["Vị trí phụ đề", ["layout", "captionY"], (value) => value == null ? "trống" : `${value}px`],
    ].forEach(([label, path, formatter]) => pushPathDiff(diffs, "caption", label, templateConfig, projectConfig, path, formatter));
  }
  if (parts.character) {
    [
      ["Nhân vật: scale", ["character", "scale"]],
      ["Nhân vật: ngang", ["character", "x"]],
      ["Nhân vật: dọc", ["character", "y"]],
      ["Nhân vật: pack", ["character", "packId"]],
      ["Chỉ trái", ["character", "poses", "point-left"], assetName],
      ["Chỉ phải", ["character", "poses", "point-right"], assetName],
      ["Câu hỏi", ["character", "poses", "question"], assetName],
    ].forEach(([label, path, formatter]) => pushPathDiff(diffs, "character", label, templateConfig, projectConfig, path, formatter));
  }
  if (parts.audio) {
    [
      ["Provider âm thanh", ["audio", "provider"]],
      ["Giọng đọc", ["audio", "voiceId"]],
      ["Tốc độ đọc", ["audio", "speed"]],
      ["Cao độ giọng", ["audio", "pitch"]],
      ["Âm lượng giọng", ["audio", "voiceVolume"]],
      ["BGM", ["audio", "bgm"], assetName],
      ["Âm lượng BGM", ["audio", "bgmVolume"]],
      ["Sound đầu cảnh", ["audio", "sceneStartSfx"]],
      ["Sound theo pose", ["poseSfx"]],
    ].forEach(([label, path, formatter]) => pushPathDiff(diffs, "audio", label, templateConfig, projectConfig, path, formatter));
  }
  if (parts.layout) {
    [
      ["Bố cục video", ["template", "id"]],
      ["Cỡ ảnh So sánh 2 bên", ["layout", "dualCompareSize"], (value) => value == null ? "trống" : `${value}px`],
      ["Dịch ảnh So sánh 2 bên", ["layout", "dualCompareOffsetY"], (value) => value == null ? "trống" : `${value}px`],
      ["Cỡ ảnh A/B", ["layout", "photoCompareSize"], (value) => value == null ? "trống" : `${value}px`],
      ["Dịch ảnh A/B xuống", ["layout", "photoCompareOffsetY"], (value) => value == null ? "trống" : `${value}px`],
      ["Vị trí nội dung A/B", ["layout", "compareLabelPlacement"]],
      ["Viết hoa Nội dung A/B", ["layout", "compareLabelUppercase"]],
      ["Căn nội dung A/B", ["layout", "compareLabelAlign"]],
      ["Cỡ chữ nội dung A/B", ["layout", "compareLabelFontSize"], (value) => Number(value) > 0 ? `${value}px` : "tự động"],
      ["Chiều cao vùng A/B", ["layout", "compareLabelHeight"], (value) => value == null ? "trống" : `${value}px`],
      ["Màu chữ nội dung A/B", ["layout", "compareLabelColor"]],
      ["Màu nền nội dung A/B", ["layout", "compareLabelBackground"]],
      ["Độ trong nền nội dung A/B", ["layout", "compareLabelBackgroundOpacity"]],
      ["Viền nội dung A/B", ["layout", "compareLabelBorderWidth"], (value) => value == null ? "trống" : `${value}px`],
      ["Bo góc nội dung A/B", ["layout", "compareLabelRadius"], (value) => value == null ? "trống" : `${value}px`],
      ["Bóng nội dung A/B", ["layout", "compareLabelShadow"]],
      ["Màu nền VS", ["layout", "compareVsColor"]],
      ["Màu chữ VS", ["layout", "compareVsTextColor"]],
      ["Màu viền VS", ["layout", "compareVsBorderColor"]],
      ["Viền khung ảnh", ["layout", "photoFrameBorderColor"]],
      ["Bóng khung ảnh", ["layout", "photoFrameShadowColor"]],
      ["Màu chữ A/B", ["layout", "compareLabelColor"]],
      ["Ảnh đang trỏ phóng", ["layout", "focusScaleLarge"]],
      ["Ảnh còn lại thu nhỏ", ["layout", "focusScaleSmall"]],
      ["Độ mượt focus", ["layout", "focusMotionDuration"]],
      ["Độ mờ ảnh phụ", ["layout", "focusImageBlur"], (value) => value == null ? "trống" : `${value}px`],
      ["Độ tối ảnh phụ", ["layout", "focusImageDarkness"]],
      ["Vị trí nhân vật", ["layout", "characterY"], (value) => value == null ? "trống" : `${value}px`],
      ["Chiều cao nhân vật", ["layout", "characterHeight"], (value) => value == null ? "trống" : `${value}px`],
      ["Bắt đầu chỉ bên", ["poseStartSide"], (value) => value === "right" ? "Phải" : "Trái"],
      ["Nội dung A/B", ["compare"], compareSummary],
      ["Bộ so sánh SS1/SS2", ["compareSets"], compareSetsSummary],
    ].forEach(([label, path, formatter]) => pushPathDiff(diffs, "layout", label, templateConfig, projectConfig, path, formatter));
    compareLineFocus(diffs, templateConfig.lineFocus || [], projectConfig.lines || []);
  }
  if (parts.background) {
    [
      ["Ảnh nền", ["background", "src"], assetName],
      ["Kiểu xử lý nền", ["background", "treatment"]],
      ["Chi tiết nền", ["background", "detail"]],
      ["Độ phủ nền", ["background", "shade"]],
      ["Làm mờ nền", ["background", "blur"], (value) => value == null ? "trống" : `${value}px`],
      ["Logo", ["logo", "src"], assetName],
      ["Vị trí logo", ["logo", "anchor"]],
      ["Lớp logo", ["logo", "layer"]],
    ].forEach(([label, path, formatter]) => pushPathDiff(diffs, "background", label, templateConfig, projectConfig, path, formatter));
  }
  if (parts.content) {
    const before = contentSectionsFromLines(templateConfig.lines || []);
    const after = contentSectionsFromLines(projectConfig.lines || []);
    if (stableJson(before) !== stableJson(after)) {
      diffs.push({
        part: "content",
        label: "Content đã lưu",
        before: `${(templateConfig.lines || []).length} dòng`,
        after: `${(projectConfig.lines || []).length} dòng`,
      });
    }
  }
  return diffs;
}

function templateDiffText(diffs = [], limit = 18) {
  if (!diffs.length) return "Không có thay đổi.";
  const lines = diffs.slice(0, limit).map((diff, index) => `${index + 1}. ${diff.label}: ${diff.before} -> ${diff.after}`);
  if (diffs.length > limit) lines.push(`... và ${diffs.length - limit} thay đổi khác`);
  return lines.join("\n");
}

function contentFromLines(lines = []) {
  return lines.map((line) => line.text || line.caption || line.tts || "").join("\n");
}

function normalizeCompareSetId(value, fallback = "compare-1") {
  const id = String(value || "").trim();
  return COMPARE_SET_IDS.includes(id) ? id : fallback;
}

function normalizeContentSections(value = {}) {
  if (typeof value === "string") {
    return { "compare-1": normalizeScriptText(value), "compare-2": "" };
  }
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(COMPARE_SET_IDS.map((id) => [id, normalizeScriptText(source[id] || "")]));
}

function editableContentSections(value = {}) {
  if (typeof value === "string") {
    return { "compare-1": String(value).replace(/\r\n?/g, "\n"), "compare-2": "" };
  }
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(COMPARE_SET_IDS.map((id) => [
    id,
    String(source[id] ?? "").replace(/\r\n?/g, "\n"),
  ]));
}

function contentFromEditableSections(sections = {}) {
  const normalized = editableContentSections(sections);
  return COMPARE_SET_IDS
    .map((id) => normalized[id])
    .filter((value) => value.length > 0)
    .join("\n");
}

function contentFromSections(sections = {}) {
  const normalized = normalizeContentSections(sections);
  return COMPARE_SET_IDS
    .flatMap((id) => normalized[id] ? normalized[id].split("\n") : [])
    .join("\n");
}

function contentSectionsFromLines(lines = []) {
  const grouped = Object.fromEntries(COMPARE_SET_IDS.map((id) => [id, []]));
  for (const line of lines || []) {
    const id = normalizeCompareSetId(line?.compareSetId);
    const text = String(line?.text || line?.caption || line?.tts || "").trim();
    if (text) grouped[id].push(text);
  }
  return Object.fromEntries(COMPARE_SET_IDS.map((id) => [id, grouped[id].join("\n")]));
}

function compareSetLabel(id) {
  return id === "compare-2" ? "SS2" : "SS1";
}

function compareSetTitle(id) {
  return id === "compare-2" ? "So sánh 2" : "So sánh 1";
}

function hasOwnValue(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function labelFromDraft(value, fallback) {
  return value === undefined || value === null ? fallback : String(value);
}

function defaultCompareSet(id, fallback = {}) {
  return {
    id,
    leftLabel: labelFromDraft(hasOwnValue(fallback, "leftLabel") ? fallback.leftLabel : undefined, "Nội dung A"),
    rightLabel: labelFromDraft(hasOwnValue(fallback, "rightLabel") ? fallback.rightLabel : undefined, "Nội dung B"),
    leftImage: fallback.leftImage || "",
    rightImage: fallback.rightImage || "",
    leftZoom: finiteNumber(fallback.leftZoom, 1),
    rightZoom: finiteNumber(fallback.rightZoom, 1),
    leftCrop: fallback.leftCrop || { x: 0, y: 0, rotation: 0 },
    rightCrop: fallback.rightCrop || { x: 0, y: 0, rotation: 0 },
    aiImages: normalizeAiImages(fallback.aiImages),
  };
}

function normalizeAiImageSlot(slot = {}) {
  const variants = Array.isArray(slot?.variants) ? slot.variants.filter(Boolean) : [];
  return {
    state: slot?.state || "empty",
    provider: slot?.provider || "agy",
    style: slot?.style || "science",
    selectedVariant: Number.isFinite(Number(slot?.selectedVariant)) ? Number(slot.selectedVariant) : (variants.length ? 1 : 0),
    asset: slot?.asset || "",
    variants,
    prompt: slot?.prompt || "",
    error: slot?.error || "",
    updatedAt: slot?.updatedAt || "",
    jobId: slot?.jobId || "",
    history: Array.isArray(slot?.history) ? slot.history.filter(Boolean) : [],
  };
}

function normalizeAiImages(value = {}) {
  return {
    left: normalizeAiImageSlot(value?.left),
    right: normalizeAiImageSlot(value?.right),
  };
}

function getCompareSets(config = {}) {
  const primary = config.compare || {};
  const source = Array.isArray(config.compareSets) ? config.compareSets : [];
  const byId = Object.fromEntries(source.map((set) => [set?.id, set]));
  return COMPARE_SET_IDS.map((id) => defaultCompareSet(id, id === "compare-1" ? { ...primary, ...(byId[id] || {}) } : (byId[id] || primary)));
}

function projectSyncKey(video = {}) {
  const config = video?.config || {};
  const pipeline = video?.pipelineStatus || {};
  return JSON.stringify({
    assetRevision: config.assetRevision || "",
    compareSets: getCompareSets(config).map((set) => ({
      id: set.id,
      leftImage: set.leftImage || "",
      rightImage: set.rightImage || "",
      leftAi: set.aiImages?.left?.updatedAt || "",
      rightAi: set.aiImages?.right?.updatedAt || "",
    })),
    pipeline: {
      audio: pipeline.audio || "",
      snapshot: pipeline.snapshot || "",
      render: pipeline.render || "",
      errors: pipeline.errors || [],
      dirtyReasons: pipeline.dirtyReasons || [],
    },
    officialRender: video?.officialRender?.url || "",
  });
}

function previewAssetSyncKey(video = {}) {
  const config = video?.config || {};
  return JSON.stringify({
    assetRevision: config.assetRevision || "",
    compareSets: getCompareSets(config).map((set) => ({
      id: set.id,
      leftImage: set.leftImage || "",
      rightImage: set.rightImage || "",
    })),
    character: config.character?.poses || {},
    background: config.background?.src || "",
    logo: config.logo?.src || "",
    audio: {
      mainAudio: config.audio?.mainAudio || "",
      srt: config.audio?.srt || "",
      bgm: config.audio?.bgm || "",
    },
  });
}

function ensureCompareSets(draft) {
  draft.compareSets = getCompareSets(draft);
  draft.compare = { ...draft.compareSets[0] };
  draft.leftLabel = draft.compare.leftLabel;
  draft.rightLabel = draft.compare.rightLabel;
  return draft.compareSets;
}

function applyCompareSlotZoom(target, side, value, nextCrop) {
  if (!target) return;
  const zoomKey = `${side}Zoom`;
  const cropKey = `${side}Crop`;
  if (isRegionCrop(nextCrop)) {
    target[zoomKey] = 1;
    target[cropKey] = nextCrop;
    return;
  }
  target[zoomKey] = value;
}

function applyCompareSlotPosition(target, side, axis, value, nextCrop) {
  if (!target) return;
  const cropKey = `${side}Crop`;
  if (isRegionCrop(nextCrop)) {
    target[cropKey] = nextCrop;
    return;
  }
  target[cropKey] = { ...(target[cropKey] || {}), [axis]: value };
}

function normalizePastedScriptText(value = "") {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029]+/g, "\n")
    .replace(/\t+/g, " ")
    .replace(/([^\n])\s+([•▪▫◦‣⁃]\s+)/g, "$1\n$2")
    .replace(/([^\n])\s+(\d{1,2}[.)]\s+)/g, "$1\n$2");
}

function normalizeScriptLine(value = "") {
  return String(value || "")
    .replace(/^(?:[•▪▫◦‣⁃-]\s+|\d{1,2}[.)]\s+)/, "")
    .trim();
}

function normalizeScriptText(value = "") {
  return normalizePastedScriptText(value)
    .split(/\r?\n/)
    .map(normalizeScriptLine)
    .filter(Boolean)
    .join("\n");
}

function officialScriptText(config) {
  return contentFromSections(contentSectionsFromLines(config?.lines || []));
}

function draftScriptText(config) {
  if (Object.prototype.hasOwnProperty.call(config?.contentDraft || {}, "text")) {
    return config.contentDraft.text || "";
  }
  return officialScriptText(config);
}

function draftScriptSections(config) {
  if (Object.prototype.hasOwnProperty.call(config?.contentDraft || {}, "sections")) {
    return editableContentSections(config.contentDraft.sections);
  }
  if (Object.prototype.hasOwnProperty.call(config?.contentDraft || {}, "text")) {
    return editableContentSections(config.contentDraft.text || "");
  }
  return contentSectionsFromLines(config?.lines || []);
}

function draftLineCount(config) {
  const text = normalizeScriptText(draftScriptText(config));
  return text ? text.split("\n").length : 0;
}

function contentDraftDirty(config) {
  return JSON.stringify(draftScriptSections(config)) !== JSON.stringify(contentSectionsFromLines(config?.lines || []));
}

function videoUrl(slug, rel) {
  if (!slug || !rel) return "";
  if (/^(?:https?:)?\/\//i.test(rel) || String(rel).startsWith("/")) return String(rel);
  return `/videos-media/${encodeURIComponent(slug)}/${String(rel).split("/").map(encodeURIComponent).join("/")}`;
}

function withUrlVersion(url, version) {
  if (!url || !version) return url || "";
  const separator = String(url).includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

function versionedVideoUrl(slug, rel, version) {
  return withUrlVersion(videoUrl(slug, rel), version);
}

function characterPoseSource(config, pose) {
  return config?.character?.poseSources?.[pose] || {};
}

function characterDisplayRel(config, pose) {
  const source = characterPoseSource(config, pose);
  const configured = config?.character?.poses?.[pose] || "";
  if (source.state === "image-ready") return source.preview || configured;
  if (source.state === "ready") return source.preview || source.fallback || configured;
  if (source.state === "processing") return configured === source.preview ? source.preview : source.fallback || configured;
  if (source.state === "error") return source.fallback || configured;
  return configured;
}

function characterPoseStatus(config, pose) {
  const source = characterPoseSource(config, pose);
  const state = source.state || (characterDisplayRel(config, pose) ? "ready" : "empty");
  const progress = clampPercent(source.progress || (state === "ready" || state === "image-ready" ? 100 : 0));
  return {
    state,
    progress,
    error: source.error || "",
    rel: characterDisplayRel(config, pose),
    source,
  };
}

function characterStatusKey(config) {
  return Object.keys(POSE_LABELS)
    .map((pose) => {
      const status = characterPoseStatus(config, pose);
      return `${pose}:${status.state}:${status.progress}:${status.rel}:${status.error}`;
    })
    .join("|");
}

function hasCharacterProcessing(config) {
  return Object.keys(POSE_LABELS).some((pose) => characterPoseStatus(config, pose).state === "processing");
}

function characterRenderIssue(config) {
  const usedPoses = new Set((config?.lines || []).map((line) => Object.prototype.hasOwnProperty.call(POSE_LABELS, line?.pose) ? line.pose : "question"));
  for (const pose of usedPoses) {
    const status = characterPoseStatus(config, pose);
    const label = POSE_LABELS[pose] || pose;
    if (status.state === "processing") return `Pose ${label} đang chuẩn hóa ${status.progress}%. Chờ xong rồi chốt bản render/render.`;
    if (status.state === "error") return `Pose ${label} lỗi chuẩn hóa${status.error ? `: ${status.error}` : "."}`;
  }
  return "";
}

function liveProjectAssetUrl(config, rel) {
  return versionedVideoUrl(config?.slug, rel, config?.assetRevision);
}

function livePreviewAssetsFromConfig(assets = {}, config = {}) {
  const compareSets = getCompareSets(config);
  const nextCompareSets = { ...(assets.compareSets || {}) };
  for (const set of compareSets) {
    const backendSet = nextCompareSets[set.id] || {};
    nextCompareSets[set.id] = {
      ...backendSet,
      left: backendSet.left || liveProjectAssetUrl(config, set.leftImage) || "",
      right: backendSet.right || liveProjectAssetUrl(config, set.rightImage) || "",
    };
  }

  const characters = { ...(assets.characters || {}) };
  for (const pose of Object.keys(POSE_LABELS)) {
    const poseUrl = liveProjectAssetUrl(config, characterDisplayRel(config, pose));
    if (!characters[pose] && poseUrl) characters[pose] = poseUrl;
  }

  return {
    ...assets,
    background: assets.background || liveProjectAssetUrl(config, config.background?.src) || "",
    logo: assets.logo || liveProjectAssetUrl(config, config.logo?.src) || "",
    compareSets: nextCompareSets,
    compareLeft: nextCompareSets["compare-1"]?.left || assets.compareLeft || "",
    compareRight: nextCompareSets["compare-1"]?.right || assets.compareRight || "",
    characters,
  };
}

function compareUploadTarget(kind = "") {
  const normalized = String(kind || "");
  if (normalized === "compare-left") return { compareSetId: "compare-1", side: "left" };
  if (normalized === "compare-right") return { compareSetId: "compare-1", side: "right" };
  const match = normalized.match(/^(compare-[12])-(left|right)$/);
  return match ? { compareSetId: match[1], side: match[2] } : null;
}

function firstLineIndexForCompareSet(config, compareSetId) {
  return (config?.lines || []).findIndex((line) => normalizeCompareSetId(line?.compareSetId) === compareSetId);
}

function mediaUrlType(url) {
  if (/\.(?:mp4|webm|mov)(?:[?#].*)?$/i.test(String(url || ""))) return "video";
  if (/\.(?:mp3|wav|m4a|aac|ogg)(?:[?#].*)?$/i.test(String(url || ""))) return "audio";
  return "image";
}

function preloadUrl(url, cache) {
  if (!url || cache.has(url) || typeof document === "undefined") return;
  const type = mediaUrlType(url);
  let element;
  if (type === "video") {
    element = document.createElement("video");
    element.muted = true;
    element.loop = true;
    element.playsInline = true;
    element.preload = "auto";
    element.src = url;
    element.load();
  } else if (type === "audio") {
    element = document.createElement("audio");
    element.preload = "auto";
    element.src = url;
    element.load();
  } else {
    element = new Image();
    element.decoding = "async";
    element.src = url;
  }
  cache.set(url, element);
  while (cache.size > 80) {
    const [oldest] = cache.keys();
    cache.delete(oldest);
  }
}

function clipOverlapsWindow(clip, window) {
  const startMs = Math.max(0, Math.round(Number(clip?.startMs) || 0));
  const durationMs = Math.max(1, Math.round(Number(clip?.durationMs) || window.durationMs));
  return startMs < window.endMs && startMs + durationMs > window.startMs;
}

function previewLineWindow(line = {}) {
  const startMs = Math.max(0, Math.round(finiteNumber(
    line.startMs,
    finiteNumber(line.start, 0) * 1000,
  )));
  const durationMs = Math.max(300, Math.round(finiteNumber(
    line.durationMs,
    finiteNumber(line.duration, 2.2) * 1000,
  )));
  return { startMs, durationMs, endMs: startMs + durationMs };
}

function preloadPreviewAssets(props, currentIndex, cache) {
  if (!props?.assets || !cache) return;
  const assets = props.assets;
  for (const cached of cache.values()) {
    if (cached?.tagName === "VIDEO" || cached?.tagName === "AUDIO") {
      cached.removeAttribute("src");
      cached.load?.();
    }
  }
  cache.clear();
  const activePose = props.lines?.[currentIndex]?.pose || "question";
  [
    assets.background,
    assets.logo,
    ...Object.values(assets.compareSets || {}).flatMap((set) => [set.left, set.right]),
    assets.compareLeft,
    assets.compareRight,
    assets.characters?.[activePose] || assets.characters?.question,
  ].forEach((url) => preloadUrl(url, cache));

  const windows = [props.lines?.[currentIndex]].filter(Boolean).map(previewLineWindow);

  if (assets.audio) preloadUrl(assets.audio, cache);
  for (const clip of [...(assets.audioClips || []), ...(assets.sfxClips || [])]) {
    if (windows.some((window) => clipOverlapsWindow(clip, window))) {
      preloadUrl(clip.src, cache);
    }
  }
}

const LEGACY_SFX_RENAMES = {
  "pop-left.mp3": "mixkit-hard-pop-click.wav",
  "pop-right.mp3": "mixkit-hard-pop-click.wav",
  "question-pop.mp3": "mixkit-bubble-pop.wav",
  "click-light.mp3": "mixkit-hard-pop-click.wav",
  "click-confirm.mp3": "win-1.wav",
  "whoosh-short.mp3": "mixkit-explainer-pop-whoosh.wav",
  "question-rise.mp3": "mixkit-bubble-pop.wav",
  "chime-soft.mp3": "win-1.wav",
  "transition-pop.mp3": "popular-riser-metallic-sound-effect.wav",
};

function migrateSfxName(name) {
  if (!name || name === "__none__") return name || "";
  return LEGACY_SFX_RENAMES[name] || name;
}

function projectSfxUrl(name, sfx) {
  const resolvedName = migrateSfxName(name);
  return sfx.find((item) => item.name === resolvedName)?.url || "";
}

function ActionButton({ children, onClick, disabled, tone = "primary", type = "button", ...props }) {
  return <button type={type} className={`action ${tone}`} disabled={disabled} onClick={onClick} {...props}>{children}</button>;
}

function useEscapeToClose(onClose) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
}

function useDialogFocus(dialogRef, onClose) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const focusableSelector = [
      "button:not([disabled])",
      "[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex=\"-1\"])",
    ].join(",");

    document.body.style.overflow = "hidden";

    const focusInitial = () => {
      if (dialog.contains(document.activeElement) && document.activeElement !== document.body) return;
      const target = dialog.querySelector("[data-dialog-initial]") || dialog.querySelector(focusableSelector);
      target?.focus();
    };

    const frame = window.requestAnimationFrame(focusInitial);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusables = [...dialog.querySelectorAll(focusableSelector)].filter((node) => {
        const style = window.getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden";
      });
      if (!focusables.length) {
        event.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      dialog.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus && typeof previousFocus.focus === "function") {
        window.requestAnimationFrame(() => previousFocus.focus());
      }
    };
  }, [dialogRef]);
}

function latestRegexMatch(text, regex) {
  let match;
  let latest = null;
  while ((match = regex.exec(text))) latest = match;
  return latest;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatElapsedMs(value) {
  const seconds = Math.max(0, Math.floor(Number(value) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function jobElapsedMs(job) {
  const start = Date.parse(job?.createdAt || "");
  if (!Number.isFinite(start)) return 0;
  const end = job?.status === "running"
    ? Date.now()
    : Date.parse(job?.finishedAt || job?.updatedAt || "") || Date.now();
  return Math.max(0, end - start);
}

function finiteNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clampNumber(value, min, max, fallback = min) {
  const next = finiteNumber(value, fallback);
  return Math.max(min, Math.min(max, next));
}

function volumeToPercent(value, fallback = DEFAULT_POSE_SFX_VOLUME) {
  return Math.round(clampNumber(value, 0, 1.5, fallback) * 100);
}

function percentToVolume(value, fallback = DEFAULT_POSE_SFX_VOLUME) {
  return clampNumber(finiteNumber(value, volumeToPercent(fallback)) / 100, 0, 1.5, fallback);
}

function volumeDeltaLabel(value) {
  const percent = volumeToPercent(value);
  if (percent < 100) return `${percent}% - nhỏ hơn ${100 - percent}%`;
  if (percent > 100) return `${percent}% - lớn hơn ${percent - 100}%`;
  return "100% - âm lượng gốc";
}

function isRegionCrop(crop) {
  return crop?.mode === "region" && Number.isFinite(Number(crop.width)) && Number.isFinite(Number(crop.height));
}

function cropAspectForTemplate(templateId, square = false) {
  const spec = TEMPLATE_IMAGE_SPECS[templateId];
  if (spec?.width && spec?.height) return spec.width / spec.height;
  if (square || isPhotoLayoutTemplateId(templateId) || templateId === FOCUS_SCALE_TEMPLATE_ID) return 1;
  return 1;
}

function cropAspectLabel(aspect = 1) {
  if (Math.abs(aspect - 1) < 0.01) return "1:1";
  if (Math.abs(aspect - (5 / 7)) < 0.02) return "5:7";
  if (Math.abs(aspect - (16 / 9)) < 0.02) return "16:9";
  if (Math.abs(aspect - (9 / 16)) < 0.02) return "9:16";
  return `${Math.round(aspect * 100) / 100}:1`;
}

function imageAspectFromNatural(naturalSize) {
  const width = Number(naturalSize?.width);
  const height = Number(naturalSize?.height);
  return width > 0 && height > 0 ? width / height : 1;
}

function maxRegionForAspect(naturalSize, targetAspect = 1) {
  const imageAspect = imageAspectFromNatural(naturalSize);
  const aspect = Number(targetAspect) > 0 ? Number(targetAspect) : 1;
  if (imageAspect >= aspect) {
    return { width: clampNumber(aspect / imageAspect, 0.05, 1, 1), height: 1 };
  }
  return { width: 1, height: clampNumber(imageAspect / aspect, 0.05, 1, 1) };
}

function clampRegionToImage(region, naturalSize, targetAspect = 1) {
  const maxRegion = maxRegionForAspect(naturalSize, targetAspect);
  const imageAspect = imageAspectFromNatural(naturalSize);
  const aspect = Number(targetAspect) > 0 ? Number(targetAspect) : 1;
  const minWidth = Math.min(0.08, maxRegion.width);
  const rawWidth = clampNumber(region?.width, minWidth, maxRegion.width, maxRegion.width);
  const rawHeight = rawWidth * imageAspect / aspect;
  let width = rawWidth;
  let height = rawHeight;
  if (height > maxRegion.height) {
    height = maxRegion.height;
    width = height * aspect / imageAspect;
  }
  width = clampNumber(width, minWidth, maxRegion.width, maxRegion.width);
  height = clampNumber(height, Math.min(0.08, maxRegion.height), maxRegion.height, maxRegion.height);
  const x = clampNumber(region?.x, 0, 1 - width, 0);
  const y = clampNumber(region?.y, 0, 1 - height, 0);
  return {
    mode: "region",
    x: Number(x.toFixed(5)),
    y: Number(y.toFixed(5)),
    width: Number(width.toFixed(5)),
    height: Number(height.toFixed(5)),
    rotation: finiteNumber(region?.rotation, 0),
  };
}

function centeredRegion(region, naturalSize, targetAspect = 1) {
  const next = clampRegionToImage(region, naturalSize, targetAspect);
  return clampRegionToImage({
    ...next,
    x: (1 - next.width) / 2,
    y: (1 - next.height) / 2,
  }, naturalSize, targetAspect);
}

function defaultRegionCrop(naturalSize, targetAspect = 1) {
  return centeredRegion(maxRegionForAspect(naturalSize, targetAspect), naturalSize, targetAspect);
}

function legacyCropToRegion(zoom, crop = {}, naturalSize, targetAspect = 1) {
  const maxRegion = maxRegionForAspect(naturalSize, targetAspect);
  const zoomValue = clampNumber(zoom, 1, 5, 1);
  const width = maxRegion.width / zoomValue;
  const height = maxRegion.height / zoomValue;
  const xOffset = (finiteNumber(crop?.x, 0) / 100) * width;
  const yOffset = (finiteNumber(crop?.y, 0) / 100) * height;
  return clampRegionToImage({
    mode: "region",
    x: (1 - width) / 2 - xOffset,
    y: (1 - height) / 2 - yOffset,
    width,
    height,
    rotation: finiteNumber(crop?.rotation, 0),
  }, naturalSize, targetAspect);
}

function regionCropFrom(zoom, crop, naturalSize, targetAspect = 1) {
  if (isRegionCrop(crop)) {
    return clampRegionToImage(crop, naturalSize, targetAspect);
  }
  return legacyCropToRegion(zoom, crop, naturalSize, targetAspect);
}

function regionZoomValue(region, naturalSize, targetAspect = 1) {
  const maxRegion = maxRegionForAspect(naturalSize, targetAspect);
  const widthZoom = maxRegion.width / Math.max(0.001, Number(region?.width) || maxRegion.width);
  const heightZoom = maxRegion.height / Math.max(0.001, Number(region?.height) || maxRegion.height);
  return clampNumber(Math.max(widthZoom, heightZoom), 1, 5, 1);
}

function regionForZoom(region, zoom, naturalSize, targetAspect = 1) {
  const maxRegion = maxRegionForAspect(naturalSize, targetAspect);
  const zoomValue = clampNumber(zoom, 1, 5, 1);
  const current = clampRegionToImage(region, naturalSize, targetAspect);
  const centerX = current.x + current.width / 2;
  const centerY = current.y + current.height / 2;
  const width = maxRegion.width / zoomValue;
  const height = maxRegion.height / zoomValue;
  return clampRegionToImage({
    ...current,
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  }, naturalSize, targetAspect);
}

function clampRegionToUnit(crop) {
  const width = clampNumber(crop?.width, 0.02, 1, 1);
  const height = clampNumber(crop?.height, 0.02, 1, 1);
  const x = clampNumber(crop?.x, 0, 1 - width, 0);
  const y = clampNumber(crop?.y, 0, 1 - height, 0);
  return {
    mode: "region",
    x: Number(x.toFixed(5)),
    y: Number(y.toFixed(5)),
    width: Number(width.toFixed(5)),
    height: Number(height.toFixed(5)),
    rotation: finiteNumber(crop?.rotation, 0),
  };
}

function regionDisplayZoom(crop) {
  if (!isRegionCrop(crop)) return 1;
  const regionSize = Math.max(0.001, Number(crop.width) || 1, Number(crop.height) || 1);
  return clampNumber(1 / regionSize, 1, 5, 1);
}

function regionForDisplayZoom(crop, value) {
  if (!isRegionCrop(crop)) return crop;
  const current = clampRegionToUnit(crop);
  const zoomValue = clampNumber(value, 1, 5, regionDisplayZoom(current));
  const currentSize = Math.max(0.001, current.width, current.height);
  const nextSize = 1 / zoomValue;
  const scale = nextSize / currentSize;
  const width = current.width * scale;
  const height = current.height * scale;
  const centerX = current.x + current.width / 2;
  const centerY = current.y + current.height / 2;
  return clampRegionToUnit({
    ...current,
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  });
}

function regionAxisOffsetPercent(crop, axis) {
  if (!isRegionCrop(crop)) return 0;
  const current = clampRegionToUnit(crop);
  const size = axis === "y" ? current.height : current.width;
  const origin = axis === "y" ? current.y : current.x;
  const travel = 1 - size;
  if (travel <= 0.0001) return 0;
  return clampNumber((origin / travel) * 90 - 45, -45, 45, 0);
}

function regionForAxisOffset(crop, axis, value) {
  if (!isRegionCrop(crop)) return crop;
  const current = clampRegionToUnit(crop);
  const size = axis === "y" ? current.height : current.width;
  const travel = 1 - size;
  const nextOrigin = travel <= 0.0001
    ? 0
    : ((clampNumber(value, -45, 45, 0) + 45) / 90) * travel;
  return clampRegionToUnit({
    ...current,
    [axis]: nextOrigin,
  });
}

function cropImageStyle(zoom, crop) {
  if (isRegionCrop(crop)) {
    const width = clampNumber(crop.width, 0.01, 1, 1);
    const height = clampNumber(crop.height, 0.01, 1, 1);
    const x = clampNumber(crop.x, 0, 1 - width, 0);
    const y = clampNumber(crop.y, 0, 1 - height, 0);
    const rotation = finiteNumber(crop.rotation, 0);
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
  const zoomValue = clampNumber(zoom, 0.7, 1.7, 1);
  const cropX = clampNumber(crop?.x, -45, 45, 0);
  const cropY = clampNumber(crop?.y, -45, 45, 0);
  const cropRotation = finiteNumber(crop?.rotation, 0);
  return { transform: `translate(${cropX}%, ${cropY}%) scale(${zoomValue}) rotate(${cropRotation}deg)` };
}

function containedImageRect(stageRect, naturalSize) {
  const stageWidth = Number(stageRect?.width) || 0;
  const stageHeight = Number(stageRect?.height) || 0;
  if (stageWidth <= 0 || stageHeight <= 0) return { left: 0, top: 0, width: 0, height: 0 };
  const imageAspect = imageAspectFromNatural(naturalSize);
  const stageAspect = stageWidth / stageHeight;
  if (imageAspect >= stageAspect) {
    const width = stageWidth;
    const height = width / imageAspect;
    return { left: 0, top: (stageHeight - height) / 2, width, height };
  }
  const height = stageHeight;
  const width = height * imageAspect;
  return { left: (stageWidth - width) / 2, top: 0, width, height };
}

function resizeRegionFromCorner(startRegion, pointer, corner, naturalSize, targetAspect = 1) {
  const start = clampRegionToImage(startRegion, naturalSize, targetAspect);
  const imageAspect = imageAspectFromNatural(naturalSize);
  const aspect = Number(targetAspect) > 0 ? Number(targetAspect) : 1;
  const widthFromHeight = (height) => height * aspect / imageAspect;
  const heightFromWidth = (width) => width * imageAspect / aspect;
  const minWidth = Math.min(0.08, maxRegionForAspect(naturalSize, targetAspect).width);

  const anchors = {
    se: { x: start.x, y: start.y, sx: 1, sy: 1 },
    sw: { x: start.x + start.width, y: start.y, sx: -1, sy: 1 },
    ne: { x: start.x, y: start.y + start.height, sx: 1, sy: -1 },
    nw: { x: start.x + start.width, y: start.y + start.height, sx: -1, sy: -1 },
  };
  const anchor = anchors[corner] || anchors.se;
  const availableWidth = anchor.sx > 0 ? 1 - anchor.x : anchor.x;
  const availableHeight = anchor.sy > 0 ? 1 - anchor.y : anchor.y;
  const pointerWidth = clampNumber((pointer.x - anchor.x) * anchor.sx, minWidth, availableWidth, start.width);
  const pointerHeight = clampNumber((pointer.y - anchor.y) * anchor.sy, heightFromWidth(minWidth), availableHeight, start.height);
  let width = Math.min(pointerWidth, widthFromHeight(pointerHeight), availableWidth, widthFromHeight(availableHeight));
  width = Math.max(minWidth, width);
  const height = heightFromWidth(width);
  const x = anchor.sx > 0 ? anchor.x : anchor.x - width;
  const y = anchor.sy > 0 ? anchor.y : anchor.y - height;
  return clampRegionToImage({ ...start, x, y, width, height }, naturalSize, targetAspect);
}

function isRunningJob(job) {
  return job?.status === "running" || job?.status === "queued";
}

function findIllustrationJobForSlot(jobs = [], slug = "", compareSetId = "compare-1", target = "left", aiStatus = {}) {
  const activeJobs = (jobs || []).filter((job) => (
    job?.type === "illustration-generate"
    && (!slug || job.slug === slug)
    && isRunningJob(job)
  ));
  const jobId = String(aiStatus?.jobId || "").trim();
  if (jobId) {
    const direct = activeJobs.find((job) => job.id === jobId);
    if (direct) return direct;
  }
  const exact = activeJobs.find((job) => {
    const items = Array.isArray(job.result?.items) ? job.result.items : [];
    return items.some((item) => item?.compareSetId === compareSetId && item?.target === target);
  });
  if (exact) return exact;
  return activeJobs.length === 1 ? activeJobs[0] : null;
}

function isAudioJob(job) {
  return ["generate-vo", "generate-vo-sample", "trim-vo"].includes(job?.type);
}

function isRenderJob(job) {
  return ["remotion-render", "remotion-check"].includes(job?.type);
}

function newestJob(jobs, slug, predicate) {
  return [...(jobs || [])]
    .filter((job) => (!slug || job.slug === slug) && predicate(job))
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))[0] || null;
}

function jobProgressState({ job, logs = "", kind, lineCount = 0 }) {
  if (!job) return null;
  const failed = job.status === "failed";
  const completed = job.status === "completed";
  const cancelled = job.status === "cancelled";
  const interrupted = job.status === "interrupted";
  const queued = job.status === "queued";
  const fallbackTitle = kind === "audio" ? "Tạo âm thanh" : kind === "check" ? "Kiểm tra project" : "Render MP4";

  if (failed) {
    return { percent: 100, title: fallbackTitle, detail: job.error || "Tác vụ bị lỗi.", tone: "bad" };
  }
  if (interrupted) {
    return { percent: clampPercent(job.progress || 0), title: fallbackTitle, detail: job.error || job.message || "Backend restarted before this job finished.", tone: "bad" };
  }
  if (cancelled) {
    return { percent: 100, title: fallbackTitle, detail: job.error || "Tác vụ đã dừng.", tone: "cancelled" };
  }
  if (completed) {
    return { percent: 100, title: fallbackTitle, detail: `Hoàn tất trong ${formatElapsedMs(jobElapsedMs(job))}.`, tone: "done" };
  }

  if (queued) {
    return { percent: clampPercent(job.progress || 0), title: fallbackTitle, detail: job.message || "Đang chờ slot tài nguyên.", tone: "queued" };
  }
  if ((Number(job.progress) || 0) > 0 || job.message) {
    return { percent: clampPercent(job.progress || 0), title: fallbackTitle, detail: job.message || "Đang xử lý." };
  }

  if (kind === "audio") {
    if (job.type === "trim-vo") {
      const trimMatch = logs.match(/Trimmed\s+(\d+)\/(\d+)\s+VO line/i);
      const done = Number(trimMatch?.[1]) || 0;
      const total = Number(trimMatch?.[2]) || lineCount || 1;
      return {
        percent: clampPercent(12 + (Math.min(done, total) / total) * 82),
        title: "Cắt nghỉ VO",
        detail: done > 0 ? `Đang cắt nghỉ ${Math.min(done, total)}/${total} dòng.` : "Đang chuẩn bị file VO.",
      };
    }
    const totalMatch = logs.match(/Generating\s+(\d+)\s+AIMAX lines/i);
    const total = Number(totalMatch?.[1]) || lineCount || 1;
    const startedAt = Date.parse(job.createdAt || job.updatedAt || "");
    const elapsedSeconds = Number.isFinite(startedAt) ? Math.max(0, (Date.now() - startedAt) / 1000) : 0;
    const copiedMatches = [...logs.matchAll(/Copied sample audio for line-(\d+)/gi)];
    const copied = copiedMatches.length ? Math.max(...copiedMatches.map((match) => Number(match[1]) || 0)) : 0;
    if (copied > 0) {
      return {
        percent: clampPercent(12 + (Math.min(copied, total) / total) * 82),
        title: "Tạo âm thanh",
        detail: `Đang xử lý ${Math.min(copied, total)}/${total} dòng.`,
      };
    }
    if (/Done\./i.test(logs)) {
      return { percent: 99, title: "Tạo âm thanh", detail: "Đang lưu timing âm thanh." };
    }
    if (/Reusing completed AIMAX job/i.test(logs)) {
      return { percent: 72, title: "Tạo âm thanh", detail: "Đang lấy lại âm thanh đã tạo trùng nội dung." };
    }
    if (totalMatch) {
      return {
        percent: clampPercent(Math.min(86, 28 + elapsedSeconds * 1.15)),
        title: "Tạo âm thanh",
        detail: `Đã gửi ${total} dòng lên AIMAX, đang chờ trả âm thanh.`,
      };
    }
    return {
      percent: clampPercent(Math.min(22, 8 + elapsedSeconds * 1.8)),
      title: "Tạo âm thanh",
      detail: "Đang chuẩn bị nội dung và giọng đọc.",
    };
  }

  if (kind === "check") {
    return { percent: 55, title: "Kiểm tra project", detail: "Đang kiểm tra project trước khi render." };
  }

  const encoded = latestRegexMatch(logs, /Encoded\s+(\d+)\/(\d+)/g);
  if (encoded) {
    const done = Number(encoded[1]) || 0;
    const total = Number(encoded[2]) || 1;
    return {
      percent: clampPercent(88 + (done / total) * 11),
      title: "Render MP4",
      detail: `Đang đóng gói video ${done}/${total} frame.`,
    };
  }
  const rendered = latestRegexMatch(logs, /Rendered\s+(\d+)\/(\d+)/g);
  if (rendered) {
    const done = Number(rendered[1]) || 0;
    const total = Number(rendered[2]) || 1;
    return {
      percent: clampPercent(8 + (done / total) * 78),
      title: "Render MP4",
      detail: `Đang render ${done}/${total} frame.`,
    };
  }
  const bundling = latestRegexMatch(logs, /Bundling\s+(\d+)%/g);
  if (bundling) {
    return {
      percent: clampPercent(2 + ((Number(bundling[1]) || 0) / 100) * 6),
      title: "Render MP4",
      detail: "Đang chuẩn bị bundle Remotion.",
    };
  }
  return { percent: 4, title: "Render MP4", detail: "Đang chuẩn bị job render." };
}

function JobProgressCard({ job, logs, kind, lineCount }) {
  const state = jobProgressState({ job, logs, kind, lineCount });
  if (!state) return null;
  const percent = clampPercent(state.percent);
  const width = `${percent}%`;
  const elapsed = formatElapsedMs(jobElapsedMs(job));
  return (
    <section className={`job-progress-card ${state.tone || ""}`}>
      <div className="job-progress-head">
        <strong>{percent}%</strong>
        <span>{elapsed}</span>
      </div>
      <strong className="job-progress-title">{state.title}</strong>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={state.title}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={percent}
      >
        <div style={{ width }} />
      </div>
      <p>{state.detail}</p>
    </section>
  );
}

function JobLogDetails({ jobs, selectedJobId, setSelectedJobId, logs, label = "Xem log" }) {
  const [open, setOpen] = useState(false);
  if (!jobs?.length) return null;
  return (
    <div className="job-details">
      <button className="job-details-toggle" type="button" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />} {label}
      </button>
      {open ? (
        <div className="job-details-body">
          <label>Job<select value={selectedJobId} onChange={(event) => setSelectedJobId(event.target.value)}>
            <option value="">Chọn job</option>
            {jobs.map((job) => <option key={job.id} value={job.id}>{job.type} · {job.slug} · {job.status}</option>)}
          </select></label>
          <pre className="log-box">{logs || "Chưa có log."}</pre>
        </div>
      ) : null}
    </div>
  );
}

function useOpenSections(sectionIds) {
  const sectionKey = sectionIds.join("|");
  const [openSections, setOpenSections] = useState({});

  useEffect(() => {
    setOpenSections((current) => {
      const next = {};
      let changed = false;
      sectionIds.forEach((id) => {
        next[id] = current[id] ?? false;
        if (!Object.prototype.hasOwnProperty.call(current, id)) changed = true;
      });
      if (Object.keys(current).some((id) => !sectionIds.includes(id))) changed = true;
      return changed ? next : current;
    });
  }, [sectionKey]);

  const isOpen = (id) => openSections[id] !== false;
  const allOpen = sectionIds.length > 0 && sectionIds.every((id) => isOpen(id));
  const allClosed = sectionIds.length > 0 && sectionIds.every((id) => !isOpen(id));
  const setSectionOpen = (id, open) => setOpenSections((current) => ({ ...current, [id]: open }));
  const setAllOpen = (open) => setOpenSections(Object.fromEntries(sectionIds.map((id) => [id, open])));

  return { isOpen, allOpen, allClosed, setSectionOpen, setAllOpen };
}

function SectionCollapseControls({ allOpen, allClosed, onExpandAll, onCollapseAll }) {
  return (
    <div className="section-collapse-controls" aria-label="Điều khiển thu gọn nhóm">
      <button type="button" disabled={allOpen} onClick={onExpandAll}>
        <ChevronDown size={15} /> Mở tất cả
      </button>
      <button type="button" disabled={allClosed} onClick={onCollapseAll}>
        <ChevronUp size={15} /> Thu tất cả
      </button>
    </div>
  );
}

function CollapsibleGroup({ title, meta, actions, open, onToggle, compact = null, className = "", bodyClassName = "", children }) {
  return (
    <section className={`collapsible-group ${open ? "is-open" : "is-closed"} ${className}`}>
      <div className="collapsible-group-head">
        <button type="button" className="collapsible-group-toggle" aria-expanded={open} onClick={onToggle}>
          <span className="collapsible-group-copy">
            <strong>{title}</strong>
            {meta ? <small>{meta}</small> : null}
          </span>
          <span className="collapsible-group-icon" aria-hidden="true">
            {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </span>
        </button>
        {actions ? <div className="collapsible-group-actions">{actions}</div> : null}
      </div>
      {open ? <div className={`collapsible-group-body ${bodyClassName}`}>{children}</div> : compact ? <div className="collapsible-group-compact">{compact}</div> : null}
    </section>
  );
}

function WorkspaceViewControls({ previewCollapsed, scriptCollapsed, onTogglePreview, onToggleScript, onExpandFocus, onExpandAll }) {
  const focusMode = previewCollapsed && scriptCollapsed;
  return (
    <div className="workspace-view-controls" aria-label="Điều khiển vùng làm việc">
      <button
        type="button"
        className={previewCollapsed ? "active" : ""}
        aria-pressed={previewCollapsed}
        onClick={onTogglePreview}
        title={previewCollapsed ? "Mở lại preview bên trái" : "Thu gọn preview bên trái"}
      >
        {previewCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        <span>{previewCollapsed ? "Mở preview" : "Thu preview"}</span>
      </button>
      <button
        type="button"
        className={scriptCollapsed ? "active" : ""}
        aria-pressed={scriptCollapsed}
        onClick={onToggleScript}
        title={scriptCollapsed ? "Mở lại kịch bản bên phải" : "Thu gọn kịch bản bên phải"}
      >
        {scriptCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
        <span>{scriptCollapsed ? "Mở kịch bản" : "Thu kịch bản"}</span>
      </button>
      <button type="button" className={focusMode ? "active" : ""} aria-pressed={focusMode} onClick={focusMode ? onExpandAll : onExpandFocus}>
        <SlidersHorizontal size={16} />
        <span>{focusMode ? "Mở 2 bên" : "Rộng tab"}</span>
      </button>
    </div>
  );
}

function statusCheckMessage(status, assets) {
  const items = [
    ["AIMAX", status?.aimax?.ok, status?.aimax?.error],
    ["FFmpeg", status?.ffmpeg?.ok, status?.ffmpeg?.error],
    ["FFprobe", status?.ffprobe?.ok, status?.ffprobe?.error],
    ["Remotion", status?.remotion?.ok, status?.remotion?.error],
    ["Nhân vật", Boolean(assets?.poses?.["point-left"]?.ok && assets?.poses?.["point-right"]?.ok && assets?.poses?.question?.ok), ""],
  ];
  const bad = items.filter(([, ok]) => !ok);
  if (!bad.length) return "Check xong: AIMAX, FFmpeg, FFprobe, Remotion và nhân vật đều OK.";
  return `Check xong: cần xử lý ${bad.map(([label, , error]) => error ? `${label} (${error})` : label).join("; ")}.`;
}

function App() {
  const [status, setStatus] = useState(null);
  const [assets, setAssets] = useState(null);
  const [voices, setVoices] = useState([]);
  const [aimaxRuntimeApiKey, setAimaxRuntimeApiKey] = useState("");
  const [aimaxSettings, setAimaxSettings] = useState(null);
  const [aimaxVoiceLoading, setAimaxVoiceLoading] = useState(false);
  const [aimaxSettingsSaving, setAimaxSettingsSaving] = useState(false);
  const [sfx, setSfx] = useState([]);
  const [sfxSources, setSfxSources] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [templateStatus, setTemplateStatus] = useState(null);
  const [videos, setVideos] = useState([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [logs, setLogs] = useState("");
  const [screen, setScreen] = useState("library");
  const [activeTab, setActiveTab] = useState("content");
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [scriptCollapsed, setScriptCollapsed] = useState(false);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [templateModal, setTemplateModal] = useState(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [quickPreviewAutoplayToken, setQuickPreviewAutoplayToken] = useState(0);
  const [finalSnapshot, setFinalSnapshot] = useState(null);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [saving, setSaving] = useState("Đã lưu");
  const [draftSaving, setDraftSaving] = useState("Đã lưu nháp");
  const [aiImageProvider, setAiImageProvider] = useState("agy");
  const [aiImageStyle, setAiImageStyle] = useState("science");
  const [aiImageVariants, setAiImageVariants] = useState(2);
  const saveTimer = useRef(null);
  const pendingSaveConfig = useRef(null);
  const draftSaveTimer = useRef(null);
  const pendingDraftContent = useRef(null);
  const localDraftContent = useRef(null);
  const handledJobResults = useRef(new Set());
  const jobsPollInitialized = useRef(false);
  const remoteVideoSyncKeyRef = useRef("");
  const remotePreviewAssetSyncKeyRef = useRef("");

  useEffect(() => {
    if (screen !== "editor" || activeTab !== "audio") stopPreviewSound();
  }, [screen, activeTab, selectedSlug]);

  useEffect(() => () => stopPreviewSound(), []);

  useEffect(() => {
    setMoreActionsOpen(false);
  }, [screen, selectedSlug]);

  useEffect(() => {
    if (!moreActionsOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setMoreActionsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [moreActionsOpen]);

  function handleEditorTabKeyDown(event, index) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? EDITOR_TAB_IDS.length - 1
        : (index + offset + EDITOR_TAB_IDS.length) % EDITOR_TAB_IDS.length;
    const nextId = EDITOR_TAB_IDS[nextIndex];
    setActiveTab(nextId);
    window.requestAnimationFrame(() => document.getElementById(`editor-tab-${nextId}`)?.focus());
  }

  async function refresh() {
    const [nextStatus, nextAssets, nextVideos, nextJobs, nextVoices, nextAimaxSettings, nextSfx, nextTemplates] = await Promise.all([
      api("/api/status"),
      api("/api/assets/status"),
      api("/api/videos"),
      api("/api/jobs"),
      api("/api/voices"),
      api("/api/aimax/settings"),
      api("/api/sfx"),
      api("/api/templates"),
    ]);
    setStatus(nextStatus);
    setAssets(nextAssets);
    setVideos(nextVideos);
    setJobs(nextJobs);
    setVoices(nextVoices.voices || []);
    setAimaxSettings(nextAimaxSettings);
    setSfx(nextSfx.sounds || []);
    setSfxSources(nextSfx.sources || []);
    setTemplates(nextTemplates.templates || []);
    const selected = nextVideos.find((video) => video.slug === selectedSlug) || nextVideos[0] || null;
    if (!selectedSlug && selected) setSelectedSlug(selected.slug);
    if (selectedSlug && selected) setSelectedVideo(videoWithLocalDraft(selected));
    return { status: nextStatus, assets: nextAssets, videos: nextVideos, jobs: nextJobs, templates: nextTemplates.templates || [] };
  }

  async function testAimaxVoices(apiKey = aimaxRuntimeApiKey) {
    const key = String(apiKey || "").trim();
    const hasSavedKey = Boolean(aimaxSettings?.apiKeyConfigured || status?.aimax?.ok);
    if (!key && !hasSavedKey) {
      setNotice("Hãy dán AIMAX API key trước khi tải voice.");
      return null;
    }
    setAimaxVoiceLoading(true);
    try {
      const result = key
        ? await api("/api/voices/test", {
          method: "POST",
          body: JSON.stringify({ apiKey: key }),
        })
        : await api("/api/voices");
      setVoices(result.voices || []);
      setNotice(result.ok
        ? `Đã tải ${result.voices?.length || 0} voice AIMAX.`
        : `AIMAX không xác thực được key: ${result.error || "Unknown error."}`);
      return result;
    } catch (error) {
      setVoices([]);
      setNotice(error.message);
      return null;
    } finally {
      setAimaxVoiceLoading(false);
    }
  }

  async function saveAimaxApiKey(apiKey = aimaxRuntimeApiKey) {
    const key = String(apiKey || "").trim();
    if (!key) {
      setNotice("Hãy dán AIMAX API key trước khi lưu.");
      return null;
    }
    setAimaxSettingsSaving(true);
    try {
      const result = await api("/api/aimax/settings", {
        method: "PUT",
        body: JSON.stringify({ apiKey: key }),
      });
      setAimaxSettings(result);
      setAimaxRuntimeApiKey("");
      const nextStatus = await api("/api/status").catch(() => null);
      if (nextStatus) setStatus(nextStatus);
      setNotice("Đã lưu AIMAX API key. Lần sau mở app sẽ dùng lại key này.");
      return result;
    } catch (error) {
      setNotice(error.message);
      return null;
    } finally {
      setAimaxSettingsSaving(false);
    }
  }

  async function refreshTemplates() {
    const nextTemplates = await api("/api/templates");
    setTemplates(nextTemplates.templates || []);
    return nextTemplates.templates || [];
  }

  async function refreshTemplateStatus(slug = selectedSlug) {
    if (!slug) {
      setTemplateStatus(null);
      return null;
    }
    const nextStatus = await api(`/api/videos/${encodeURIComponent(slug)}/template-status`);
    setTemplateStatus(nextStatus);
    return nextStatus;
  }

  async function checkEnvironment() {
    setChecking(true);
    try {
      const next = await refresh();
      setNotice(statusCheckMessage(next.status, next.assets));
    } catch (error) {
      setNotice(error.message);
    } finally {
      setChecking(false);
    }
  }

  async function openVideo(slug) {
    clearTimeout(draftSaveTimer.current);
    pendingDraftContent.current = null;
    localDraftContent.current = null;
    const video = await api(`/api/videos/${encodeURIComponent(slug)}`);
    remoteVideoSyncKeyRef.current = projectSyncKey(video);
    remotePreviewAssetSyncKeyRef.current = previewAssetSyncKey(video);
    setSelectedSlug(slug);
    setSelectedVideo(video);
    setFinalSnapshot(null);
    setCurrentLineIndex(0);
    setDraftSaving("Đã lưu nháp");
    setPreviewRevision((value) => value + 1);
    setScreen("editor");
    refreshTemplateStatus(slug).catch(() => setTemplateStatus(null));
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  }

  async function openJob(job) {
    if (!job?.id) return;
    setSelectedJobId(job.id);
    setLogs("");
    if (job.slug && job.slug !== selectedSlug) {
      await openVideo(job.slug);
    }
  }

  useEffect(() => {
    refresh().catch((error) => setNotice(error.message));
    return () => {
      clearTimeout(saveTimer.current);
      clearTimeout(draftSaveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!selectedJobId) return;
    const timer = setInterval(() => {
      requestText(`/api/jobs/${selectedJobId}/logs`).then(setLogs).catch(() => {});
      api("/api/jobs").then(async (nextJobs) => {
        setJobs(nextJobs);
        const job = nextJobs.find((item) => item.id === selectedJobId);
        if (job?.status === "completed" && !handledJobResults.current.has(job.id)) {
          handledJobResults.current.add(job.id);
          if (job.type === "trim-vo") {
            await reloadSelectedVideo(job.slug || selectedSlug).catch(() => null);
            setFinalSnapshot((snapshot) => snapshot ? { ...snapshot, stale: true } : snapshot);
            setPreviewRevision((value) => value + 1);
            setNotice("Đã cắt nghỉ VO và cập nhật timing.");
          } else if (job.type === "generate-vo" || job.type === "generate-vo-sample") {
            await reloadSelectedVideo(job.slug || selectedSlug).catch(() => null);
            setFinalSnapshot((snapshot) => snapshot ? { ...snapshot, stale: true } : snapshot);
            setPreviewRevision((value) => value + 1);
            playCompletionSound();
            setNotice("Đã tạo âm thanh xong.");
          } else if (job.type === "remotion-render") {
            await reloadSelectedVideo(job.slug || selectedSlug).catch(() => null);
            playCompletionSound();
            setNotice("Render MP4 xong. Bản render cũ đã được xóa.");
          } else if (job.type === "remotion-check") {
            setNotice("Kiểm tra project xong.");
          } else if (job.type === "illustration-generate") {
            await reloadSelectedVideo(job.slug || selectedSlug).catch(() => null);
            setFinalSnapshot((snapshot) => snapshot ? { ...snapshot, stale: true } : snapshot);
            setPreviewRevision((value) => value + 1);
            const result = job.result || {};
            const successCount = Number(result.successCount) || 0;
            const failureCount = Number(result.failureCount) || 0;
            const skippedCount = Number(result.skippedCount) || 0;
            const parts = [`Đã tạo ${successCount} ảnh AI`];
            if (failureCount) parts.push(`${failureCount} lỗi`);
            if (skippedCount) parts.push(`${skippedCount} bỏ qua`);
            setNotice(`${parts.join(", ")}.`);
          }
          setSelectedJobId("");
          setLogs("");
        } else if (job?.status === "failed" && !handledJobResults.current.has(job.id)) {
          handledJobResults.current.add(job.id);
          setNotice(job.error || "Tác vụ bị lỗi.");
        } else if (job?.status === "cancelled" && !handledJobResults.current.has(job.id)) {
          handledJobResults.current.add(job.id);
          setNotice(job.error || "Tác vụ đã dừng.");
          setSelectedJobId("");
          setLogs("");
        }
      }).catch(() => {});
      if (selectedSlug) api(`/api/videos/${selectedSlug}`).then((video) => setSelectedVideo(videoWithLocalDraft(video))).catch(() => {});
    }, 1200);
    return () => clearInterval(timer);
  }, [selectedJobId, selectedSlug]);

  useEffect(() => {
    let stopped = false;
    async function pollJobs() {
      try {
        const nextJobs = await api("/api/jobs");
        if (stopped) return;
        setJobs(nextJobs);

        if (!jobsPollInitialized.current) {
          nextJobs.filter(isTerminalJob).forEach((job) => handledJobResults.current.add(job.id));
          jobsPollInitialized.current = true;
          return;
        }

        for (const job of nextJobs) {
          if (!isTerminalJob(job) || handledJobResults.current.has(job.id)) continue;
          handledJobResults.current.add(job.id);
          const sameProject = job.slug && job.slug === selectedSlug;
          if (sameProject) {
            await reloadSelectedVideo(job.slug).catch(() => null);
            if (["trim-vo", "generate-vo", "generate-vo-sample", "illustration-generate", "character-convert"].includes(job.type)) {
              setFinalSnapshot((snapshot) => snapshot ? { ...snapshot, stale: true } : snapshot);
              setPreviewRevision((value) => value + 1);
            }
          }
          if (job.status === "completed") {
            if (["generate-vo", "generate-vo-sample", "remotion-render", "illustration-generate", "character-convert"].includes(job.type)) playCompletionSound();
            setNotice(`${job.slug ? `${job.slug}: ` : ""}${job.type} completed.`);
          } else if (job.status === "failed" || job.status === "interrupted") {
            setNotice(`${job.slug ? `${job.slug}: ` : ""}${job.error || job.message || "Job failed."}`);
          } else if (job.status === "cancelled") {
            setNotice(`${job.slug ? `${job.slug}: ` : ""}${job.error || "Job cancelled."}`);
          }
          if (selectedJobId === job.id && job.status !== "failed" && job.status !== "interrupted") {
            setSelectedJobId("");
            setLogs("");
          }
        }

        if (selectedSlug && nextJobs.some((job) => job.slug === selectedSlug && isActiveJob(job))) {
          await api(`/api/videos/${selectedSlug}`).then((video) => setSelectedVideo(videoWithLocalDraft(video))).catch(() => {});
        }
      } catch {
        // Keep polling; a temporary API failure should not block editing.
      }
    }
    pollJobs();
    const timer = setInterval(pollJobs, 1200);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [selectedJobId, selectedSlug]);

  useEffect(() => {
    if (!selectedSlug) return;
    api(`/api/videos/${encodeURIComponent(selectedSlug)}/snapshot/final`)
      .then((snapshot) => setFinalSnapshot(snapshot.exists ? snapshot : null))
      .catch(() => {});
  }, [selectedSlug]);

  useEffect(() => {
    if (!selectedSlug || screen !== "editor") {
      setTemplateStatus(null);
      return undefined;
    }
    let stopped = false;
    const load = () => refreshTemplateStatus(selectedSlug).catch(() => {
      if (!stopped) setTemplateStatus(null);
    });
    load();
    const timer = setInterval(load, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [selectedSlug, screen]);

  useEffect(() => {
    if (!selectedSlug || screen !== "editor") {
      remoteVideoSyncKeyRef.current = "";
      remotePreviewAssetSyncKeyRef.current = "";
      return undefined;
    }
    let stopped = false;
    async function refreshOpenProject() {
      try {
        const nextVideo = await api(`/api/videos/${encodeURIComponent(selectedSlug)}`);
        if (stopped) return;
        const nextSyncKey = projectSyncKey(nextVideo);
        const nextPreviewKey = previewAssetSyncKey(nextVideo);
        const previousSyncKey = remoteVideoSyncKeyRef.current;
        const previousPreviewKey = remotePreviewAssetSyncKeyRef.current;
        remoteVideoSyncKeyRef.current = nextSyncKey;
        remotePreviewAssetSyncKeyRef.current = nextPreviewKey;
        if (nextSyncKey === previousSyncKey) return;

        setSelectedVideo(videoWithLocalDraft(nextVideo));
        setVideos((current) => {
          const list = Array.isArray(current) ? current : [];
          return list.some((video) => video.slug === nextVideo.slug)
            ? list.map((video) => video.slug === nextVideo.slug ? nextVideo : video)
            : [nextVideo, ...list];
        });
        if (previousPreviewKey && previousPreviewKey !== nextPreviewKey) {
          setPreviewRevision((value) => value + 1);
          setFinalSnapshot((snapshot) => snapshot ? { ...snapshot, stale: true } : snapshot);
        }
      } catch {
        // Keep the current editor state when a refresh is temporarily unavailable.
      }
    }
    refreshOpenProject();
    const timer = setInterval(refreshOpenProject, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [selectedSlug, screen]);

  const characterStatusDependency = characterStatusKey(selectedVideo?.config);
  useEffect(() => {
    if (!selectedSlug || !hasCharacterProcessing(selectedVideo?.config)) return;
    let stopped = false;
    async function pollCharacterStatus() {
      try {
        const status = await api(`/api/videos/${encodeURIComponent(selectedSlug)}/assets/character/status`);
        if (stopped) return;
        const values = Object.values(status || {});
        const stillProcessing = values.some((item) => item?.state === "processing");
        const firstError = values.find((item) => item?.state === "error");
        await reloadSelectedVideo(selectedSlug);
        if (stopped) return;
        setPreviewRevision((value) => value + 1);
        setFinalSnapshot((snapshot) => snapshot ? { ...snapshot, stale: true } : snapshot);
        if (!stillProcessing) {
          setNotice(firstError
            ? `Có pose lỗi chuẩn hóa${firstError.error ? `: ${firstError.error}` : "."}`
            : "Đã chuẩn hóa pose nhân vật.");
        }
      } catch {
        // Keep polling; temporary reload failures should not block editing.
      }
    }
    const timer = setInterval(pollCharacterStatus, 1500);
    pollCharacterStatus();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [selectedSlug, characterStatusDependency]);

  function updateConfig(mutator, { staleSnapshot = true } = {}) {
    if (!selectedVideo?.config) return;
    const nextConfig = clone(selectedVideo.config);
    mutator(nextConfig);
    setSelectedVideo({ ...selectedVideo, config: nextConfig });
    if (staleSnapshot) setFinalSnapshot((snapshot) => snapshot ? { ...snapshot, stale: true } : snapshot);
    scheduleSave(nextConfig);
  }

  function previewLine(index, { autoplay = false } = {}) {
    const lineCount = selectedVideo?.config?.lines?.length || 0;
    const nextIndex = Math.max(0, Math.min(lineCount - 1, Number(index) || 0));
    setCurrentLineIndex(nextIndex);
    setPreviewRevision((value) => value + 1);
    if (autoplay) setQuickPreviewAutoplayToken((value) => value + 1);
  }

  function videoWithLocalDraft(video) {
    if (!video?.config) return video;
    const hasPendingConfig = Boolean(pendingSaveConfig.current);
    const hasPendingDraftContent = localDraftContent.current !== null;
    if (!hasPendingConfig && !hasPendingDraftContent) return video;
    let config = hasPendingConfig
      ? { ...video.config, ...pendingSaveConfig.current }
      : video.config;
    if (hasPendingDraftContent) {
      const sections = editableContentSections(localDraftContent.current);
      config = {
        ...config,
        contentDraft: {
          ...(config.contentDraft || {}),
          text: contentFromEditableSections(sections),
          sections,
        },
      };
    }
    return {
      ...video,
      config,
    };
  }

  async function reloadSelectedVideo(slug = selectedSlug) {
    if (!slug) return null;
    const nextVideo = await api(`/api/videos/${encodeURIComponent(slug)}`);
    remoteVideoSyncKeyRef.current = projectSyncKey(nextVideo);
    remotePreviewAssetSyncKeyRef.current = previewAssetSyncKey(nextVideo);
    setSelectedVideo(videoWithLocalDraft(nextVideo));
    setVideos((current) => {
      const list = Array.isArray(current) ? current : [];
      const found = list.some((video) => video.slug === nextVideo.slug);
      return found
        ? list.map((video) => video.slug === nextVideo.slug ? nextVideo : video)
        : [nextVideo, ...list];
    });
    return nextVideo;
  }

  function scheduleSave(nextConfig) {
    clearTimeout(saveTimer.current);
    pendingSaveConfig.current = nextConfig;
    setSaving("Đang lưu");
    saveTimer.current = setTimeout(() => {
      flushSave().catch((error) => {
        setSaving("Lỗi lưu");
        setNotice(error.message);
      });
    }, 500);
  }

  async function flushSave() {
    if (!pendingSaveConfig.current || !selectedSlug) return selectedVideo;
    clearTimeout(saveTimer.current);
    const nextConfig = pendingSaveConfig.current;
    pendingSaveConfig.current = null;
    setSaving("Đang lưu");
    const saved = await api(`/api/videos/${encodeURIComponent(selectedSlug)}`, {
      method: "PUT",
      body: JSON.stringify(nextConfig),
    });
    setSelectedVideo(videoWithLocalDraft(saved));
    setPreviewRevision((value) => value + 1);
    setSaving("Đã lưu");
    return saved;
  }

  function updateContentDraft(content) {
    if (!selectedSlug) return;
    const sections = editableContentSections(content);
    localDraftContent.current = sections;
    setSelectedVideo((current) => {
      if (!current?.config) return current;
      const nextConfig = clone(current.config);
      nextConfig.contentDraft = {
        ...(nextConfig.contentDraft || {}),
        text: contentFromEditableSections(sections),
        sections,
        updatedAt: new Date().toISOString(),
      };
      return { ...current, config: nextConfig };
    });
    scheduleContentDraftSave(sections);
  }

  function scheduleContentDraftSave(content) {
    clearTimeout(draftSaveTimer.current);
    pendingDraftContent.current = content;
    setDraftSaving("Đang lưu nháp");
    draftSaveTimer.current = setTimeout(() => {
      flushContentDraft().catch((error) => {
        setDraftSaving("Lỗi lưu nháp");
        setNotice(error.message);
      });
    }, 500);
  }

  async function flushContentDraft() {
    if (!selectedSlug || pendingDraftContent.current === null) return selectedVideo;
    clearTimeout(draftSaveTimer.current);
    const content = pendingDraftContent.current;
    const sections = editableContentSections(content);
    setDraftSaving("Đang lưu nháp");
    const saved = await api(`/api/videos/${encodeURIComponent(selectedSlug)}/content/draft`, {
      method: "PUT",
      body: JSON.stringify({ contentByCompareSet: sections }),
    });
    if (pendingDraftContent.current === content) {
      pendingDraftContent.current = null;
      setSelectedVideo(videoWithLocalDraft(saved));
      setDraftSaving("Đã lưu nháp");
    }
    return saved;
  }

  async function commitContent(content) {
    if (!selectedSlug || !selectedVideo?.config) return;
    const sections = typeof content === "string" ? normalizeContentSections(content) : normalizeContentSections(content);
    setBusy(true);
    try {
      await flushSave();
      pendingDraftContent.current = sections;
      await flushContentDraft();
      const saved = await api(`/api/videos/${encodeURIComponent(selectedSlug)}/content/commit`, {
        method: "POST",
        body: JSON.stringify({
          contentByCompareSet: sections,
        }),
      });
      localDraftContent.current = null;
      pendingDraftContent.current = null;
      setSelectedVideo(saved);
      setCurrentLineIndex(0);
      setFinalSnapshot((snapshot) => snapshot ? { ...snapshot, stale: true } : snapshot);
      setPreviewRevision((value) => value + 1);
      setDraftSaving("Đã lưu nháp");
      setNotice(`Đã lưu content: ${saved.config?.contentOfficial?.lineCount || saved.config?.lines?.length || 0} dòng.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function createProject(form) {
    setBusy(true);
    try {
      const created = await api("/api/videos", { method: "POST", body: JSON.stringify(form) });
      await refresh();
      await openVideo(created.slug);
      setNotice("Đã tạo project mới.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject(slug) {
    if (!window.confirm("Xóa project này và toàn bộ file render của nó?")) return;
    setBusy(true);
    try {
      await api(`/api/videos/${encodeURIComponent(slug)}`, { method: "DELETE" });
      if (slug === selectedSlug) {
        setSelectedSlug("");
        setSelectedVideo(null);
        setScreen("library");
      }
      await refresh();
      setNotice("Đã xóa project.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAllProjects(slugs = [], scopeLabel = "tab hiện tại") {
    const scopedSlugs = Array.isArray(slugs) ? slugs.filter(Boolean) : videos.map((video) => video.slug);
    if (!scopedSlugs.length) {
      setNotice("Không có project để xóa trong tab này.");
      return;
    }
    if (!window.confirm(`Xóa ${scopedSlugs.length} project trong ${scopeLabel} và file render của chúng?`)) return;
    setBusy(true);
    try {
      await api("/api/videos", { method: "DELETE", body: JSON.stringify({ slugs: scopedSlugs }) });
      if (scopedSlugs.includes(selectedSlug)) {
        setSelectedSlug("");
        setSelectedVideo(null);
        setScreen("library");
      }
      await refresh();
      setNotice(`Đã xóa ${scopedSlugs.length} project trong ${scopeLabel}.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function normalizeLines() {
    if (!selectedSlug || !selectedVideo?.config) return;
    if (contentDraftDirty(selectedVideo.config)) {
      setNotice("Bản nháp chưa lưu content. Bấm Lưu content trước khi gán nhân vật.");
      return;
    }
    setBusy(true);
    try {
      await flushSave();
      const next = await api(`/api/videos/${selectedSlug}/normalize-lines`, {
        method: "POST",
        body: JSON.stringify({
          contentByCompareSet: contentSectionsFromLines(selectedVideo.config.lines),
          compare: selectedVideo.config.compare,
          compareSets: getCompareSets(selectedVideo.config),
          poseStartSide: selectedVideo.config.poseStartSide,
        }),
      });
      setSelectedVideo(next);
      setPreviewRevision((value) => value + 1);
      setFinalSnapshot((snapshot) => snapshot ? { ...snapshot, stale: true } : snapshot);
      setNotice("Đã tự gán lại pose theo A/B/câu hỏi.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadProjectAsset(kind, event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedSlug) return;
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file);
    setBusy(true);
    try {
      await flushSave();
      const uploaded = await uploadApi(`/api/videos/${encodeURIComponent(selectedSlug)}/assets/upload`, form);
      if (uploaded?.config) {
        const nextVideo = {
          ...(selectedVideo || {}),
          slug: uploaded.slug || selectedSlug,
          config: uploaded.config,
        };
        setSelectedVideo(videoWithLocalDraft(nextVideo));
        setFinalSnapshot((snapshot) => snapshot ? { ...snapshot, stale: true } : snapshot);
        const target = uploaded.compareSetId
          ? { compareSetId: normalizeCompareSetId(uploaded.compareSetId), side: uploaded.side }
          : compareUploadTarget(kind);
        if (target?.compareSetId) {
          setCurrentLineIndex((current) => {
            const lines = uploaded.config?.lines || [];
            if (!lines.length) return current;
            const safeCurrent = Math.max(0, Math.min(lines.length - 1, current));
            const currentSetId = normalizeCompareSetId(lines[safeCurrent]?.compareSetId);
            if (currentSetId === target.compareSetId) return safeCurrent;
            const firstIndex = firstLineIndexForCompareSet(uploaded.config, target.compareSetId);
            return firstIndex >= 0 ? firstIndex : safeCurrent;
          });
        }
      }
      setPreviewRevision((value) => value + 1);
      setNotice("Đã upload asset project.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadCharacter(pose, event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedSlug) return;
    const form = new FormData();
    form.append("kind", `character-${pose}`);
    form.append("file", file);
    setBusy(true);
    try {
      await flushSave();
      const uploaded = await uploadApi(`/api/videos/${encodeURIComponent(selectedSlug)}/assets/upload`, form);
      if (uploaded?.config) {
        const nextVideo = {
          ...(selectedVideo || {}),
          slug: uploaded.slug || selectedSlug,
          config: uploaded.config,
        };
        setSelectedVideo(videoWithLocalDraft(nextVideo));
        setFinalSnapshot((snapshot) => snapshot ? { ...snapshot, stale: true } : snapshot);
      }
      setPreviewRevision((value) => value + 1);
      const characterState = uploaded?.characterStatus?.state || "";
      const characterProgress = uploaded?.characterStatus?.progress || 0;
      setNotice(characterState === "processing"
        ? `Đã upload pose. Đang chuẩn hóa ${characterProgress}%.`
        : "Đã upload pose nhân vật.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteCharacter(pose) {
    if (!selectedSlug) return;
    const label = POSE_LABELS[pose] || pose;
    if (!window.confirm(`Xóa pose "${label}" khỏi project này?`)) return;
    setBusy(true);
    try {
      await flushSave();
      const result = await api(`/api/videos/${encodeURIComponent(selectedSlug)}/assets/character/${encodeURIComponent(pose)}`, { method: "DELETE" });
      const nextVideo = {
        ...(selectedVideo || {}),
        slug: result.slug || selectedSlug,
        config: result.config,
      };
      setSelectedVideo(videoWithLocalDraft(nextVideo));
      setFinalSnapshot((snapshot) => snapshot ? { ...snapshot, stale: true } : snapshot);
      setPreviewRevision((value) => value + 1);
      setNotice("Đã xóa pose khỏi project.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadSfx(input, metadata = {}) {
    const files = Array.isArray(input) ? input : Array.from(input?.target?.files || []);
    if (input?.target) input.target.value = "";
    if (!files.length) return;
    const form = new FormData();
    for (const file of files) form.append("files", file);
    Object.entries(metadata).forEach(([key, value]) => {
      if (value) form.append(key, String(value));
    });
    setBusy(true);
    try {
      const uploaded = await uploadApi("/api/sfx/upload", form);
      setSfx(uploaded.sounds || []);
      setSfxSources(uploaded.sources || sfxSources);
      setNotice("Đã upload sound.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function runJob(path, body = {}) {
    setBusy(true);
    try {
      if (String(path).includes("/generate-vo") && contentDraftDirty(selectedVideo?.config)) {
        setActiveTab("content");
        setNotice("Bản nháp chưa lưu content. Bấm Lưu content trước khi tạo âm thanh.");
        return;
      }
      await flushSave();
      const job = await api(path, { method: "POST", body: JSON.stringify(body) });
      setSelectedJobId(job.id);
      setLogs("");
      setNotice("Đã bắt đầu tác vụ. Tiến trình sẽ hiện ngay trong tab.");
      setJobs(await api("/api/jobs"));
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function generateIllustrations(compareSetId, targets = ["left", "right"], options = {}) {
    if (!selectedSlug) return;
    setBusy(true);
    try {
      await flushSave();
      const body = options.items ? {
        items: options.items,
        mode: options.mode || "parallel-slots",
        provider: aiImageProvider,
        style: aiImageStyle,
        variants: aiImageVariants,
      } : {
        compareSetId,
        targets,
        provider: aiImageProvider,
        style: aiImageStyle,
        variants: aiImageVariants,
      };
      const job = await api(`/api/videos/${encodeURIComponent(selectedSlug)}/illustrations/generate`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setSelectedJobId(job.id);
      setLogs("");
      setNotice("Đã bắt đầu tạo ảnh AI minh họa.");
      setJobs(await api("/api/jobs"));
      await reloadSelectedVideo(selectedSlug).catch(() => null);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function generateAllIllustrations() {
    const items = getCompareSets(selectedVideo?.config).flatMap((set) => [
      { compareSetId: set.id, target: "left" },
      { compareSetId: set.id, target: "right" },
    ]);
    await generateIllustrations("compare-1", ["left", "right"], {
      items,
      mode: "parallel-slots",
    });
  }

  async function selectIllustrationVariant(compareSetId, target, variant) {
    if (!selectedSlug) return;
    setBusy(true);
    try {
      await flushSave();
      const result = await api(`/api/videos/${encodeURIComponent(selectedSlug)}/illustrations/select`, {
        method: "POST",
        body: JSON.stringify({ compareSetId, target, variant }),
      });
      const nextVideo = {
        ...(selectedVideo || {}),
        slug: result.slug || selectedSlug,
        config: result.config,
      };
      setSelectedVideo(videoWithLocalDraft(nextVideo));
      setFinalSnapshot((snapshot) => snapshot ? { ...snapshot, stale: true } : snapshot);
      setPreviewRevision((value) => value + 1);
      setNotice("Đã chọn biến thể ảnh AI.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelIllustrationSlot(compareSetId, target, jobId = "") {
    if (!selectedSlug) return;
    setBusy(true);
    try {
      const result = await api(`/api/videos/${encodeURIComponent(selectedSlug)}/illustrations/cancel`, {
        method: "POST",
        body: JSON.stringify({ compareSetId, target, jobId }),
      });
      if (result?.config) {
        const nextVideo = {
          ...(selectedVideo || {}),
          slug: result.slug || selectedSlug,
          config: result.config,
        };
        setSelectedVideo(videoWithLocalDraft(nextVideo));
        setFinalSnapshot((snapshot) => snapshot ? { ...snapshot, stale: true } : snapshot);
        setPreviewRevision((value) => value + 1);
      } else {
        await reloadSelectedVideo(selectedSlug).catch(() => null);
      }
      setJobs(await api("/api/jobs"));
      setNotice("Đã dừng tạo ảnh AI.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelJob(jobId) {
    if (!jobId) return;
    try {
      const job = await api(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
      setJobs(await api("/api/jobs"));
      setSelectedJobId(job.id);
      setNotice("Đã gửi lệnh dừng tác vụ.");
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function createFinalPreview() {
    if (!selectedSlug) return null;
    setSnapshotBusy(true);
    try {
      await flushSave();
      const snapshot = await api(`/api/videos/${encodeURIComponent(selectedSlug)}/snapshot/final`, {
        method: "POST",
        body: JSON.stringify({ allowWarnings: true }),
      });
      setFinalSnapshot(snapshot);
      await reloadSelectedVideo(selectedSlug).catch(() => null);
      setActiveTab("render");
      playCompletionSound();
      setNotice("Đã chốt bản render. Render MP4 sẽ dùng đúng bản này.");
      return snapshot;
    } catch (error) {
      setNotice(error.message);
      return null;
    } finally {
      setSnapshotBusy(false);
    }
  }

  function openSaveTemplate(type, options = {}) {
    if (!selectedVideo?.config || !selectedSlug) {
      setNotice("Hãy mở một project trước khi lưu mẫu.");
      return;
    }
    if (type === "full" && selectedVideo.config.savedTemplateRef) {
      setNotice("Project này đã liên kết với một mẫu. Dùng Cập nhật mẫu để cập nhật đúng mẫu đó.");
      return;
    }
    setTemplateModal({
      mode: "save",
      type,
      title: options.title,
      parts: templatePartsForType(type, options.parts),
    });
  }

  function openTemplateLibrary(type = "all", purpose = "apply") {
    setTemplateModal({ mode: "library", typeFilter: type, purpose });
    refreshTemplates().catch((error) => setNotice(error.message));
  }

  function openAttachTemplate() {
    if (!selectedVideo?.config || !selectedSlug) {
      setNotice("Hãy mở một project trước khi liên kết mẫu.");
      return;
    }
    if (selectedVideo.config.savedTemplateRef) {
      setNotice("Project này đã liên kết với một mẫu. Chỉ có thể cập nhật đúng mẫu đang liên kết.");
      return;
    }
    openTemplateLibrary("full", "attach");
  }

  async function saveTemplate(payload) {
    if (!selectedSlug) return;
    setBusy(true);
    try {
      await flushSave();
      const saved = await api(`/api/templates/from-video/${encodeURIComponent(selectedSlug)}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await refresh();
      setTemplateModal(null);
      setNotice(`Đã lưu mẫu ${saved.name}.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function applyTemplate(payload) {
    if (!selectedSlug) {
      setNotice("Hãy mở một project trước khi áp dụng mẫu.");
      return;
    }
    if (payload.parts?.content && !window.confirm("Áp dụng phần Kịch bản sẽ thay nội dung chính thức của project hiện tại. Bạn muốn tiếp tục?")) return;
    setBusy(true);
    try {
      await flushSave();
      const result = await api(`/api/videos/${encodeURIComponent(selectedSlug)}/apply-template`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (result.appliedParts?.content) {
        clearTimeout(draftSaveTimer.current);
        pendingDraftContent.current = null;
        setDraftSaving("Đã lưu nháp");
      }
      setSelectedVideo(result.appliedParts?.content ? result.video : videoWithLocalDraft(result.video));
      setFinalSnapshot((snapshot) => snapshot ? { ...snapshot, stale: true } : snapshot);
      setPreviewRevision((value) => value + 1);
      if (result.appliedParts?.content) setCurrentLineIndex(0);
      const partText = templatePartNames(result.appliedParts);
      const audioNote = result.appliedParts?.audio ? " Nếu muốn đổi giọng của file âm thanh cũ, bấm Tạo âm thanh." : "";
      setNotice(`Đã áp dụng mẫu ${result.template?.name || payload.id}${partText ? `: ${partText}` : ""}.${audioNote}`);
      setTemplateModal(null);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function attachTemplate(template) {
    if (!selectedSlug || !selectedVideo?.config) {
      setNotice("Hãy mở một project trước khi liên kết mẫu.");
      return;
    }
    if (selectedVideo.config.savedTemplateRef) {
      setNotice("Project này đã liên kết với một mẫu. Chỉ có thể cập nhật đúng mẫu đang liên kết.");
      return;
    }
    setBusy(true);
    try {
      await flushSave();
      const saved = await api(`/api/videos/${encodeURIComponent(selectedSlug)}/template-ref`, {
        method: "POST",
        body: JSON.stringify({ type: template.type, id: template.id }),
      });
      setSelectedVideo(videoWithLocalDraft(saved));
      await refresh();
      setTemplateModal(null);
      setNotice(`Đã liên kết project với mẫu ${template.name}.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateLinkedTemplate() {
    const ref = selectedVideo?.config?.savedTemplateRef;
    if (!selectedSlug || !ref) {
      setNotice("Project này chưa thuộc mẫu nào.");
      return;
    }
    setBusy(true);
    try {
      await flushSave();
      const status = await refreshTemplateStatus(selectedSlug);
      const diffs = status?.updateDiffs || [];
      if (status?.blockedReasons?.length) {
        setNotice(status.blockedReasons.join(" "));
        return;
      }
      if (!diffs.length) {
        setNotice("Mẫu hiện tại chưa có thay đổi nào cần cập nhật.");
        return;
      }
      const latestVersion = Number(status.latestVersion || ref.version || 1);
      const force = latestVersion !== Number(ref.version || 1);
      if (force && !window.confirm(`Mẫu đã có phiên bản mới hơn.\n\nProject đang liên kết version ${ref.version}.\nMẫu hiện tại là version ${latestVersion}.\n\nBạn có muốn ghi đè mẫu bằng nội dung project này không?`)) {
        return;
      }
      if (!window.confirm(`Cập nhật mẫu "${ref.name}" với ${diffs.length} thay đổi sau?\n\n${templateDiffText(diffs)}\n\nSau khi xác nhận, những thay đổi này sẽ ghi lên mẫu đang liên kết.`)) {
        return;
      }
      const result = await api(`/api/templates/${encodeURIComponent(ref.type)}/${encodeURIComponent(ref.id)}/update-from-video/${encodeURIComponent(selectedSlug)}`, {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: ref.version,
          force,
          includeAssets: true,
        }),
      });
      setSelectedVideo(result.video);
      setFinalSnapshot((snapshot) => snapshot ? { ...snapshot, stale: true } : snapshot);
      setPreviewRevision((value) => value + 1);
      await refresh();
      setTemplateModal(null);
      setNotice(`Đã cập nhật mẫu ${result.template?.name || ref.name} lên version ${result.template?.version || ""}: ${diffs.map((diff) => diff.label).slice(0, 6).join(", ")}${diffs.length > 6 ? ` và ${diffs.length - 6} mục khác` : ""}.`);
      await refreshTemplateStatus(selectedSlug).catch(() => null);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function applyLatestTemplateUpdate() {
    if (!selectedSlug || !linkedTemplateRef) return;
    setBusy(true);
    try {
      await flushSave();
      const result = await api(`/api/videos/${encodeURIComponent(selectedSlug)}/apply-template-update`, { method: "POST" });
      setSelectedVideo(videoWithLocalDraft(result.video));
      setFinalSnapshot((snapshot) => snapshot ? { ...snapshot, stale: true } : snapshot);
      setPreviewRevision((value) => value + 1);
      await refreshTemplateStatus(selectedSlug).catch(() => null);
      setNotice(`Đã áp dụng mẫu ${result.template?.name || linkedTemplateRef.name} version ${result.template?.version || ""}. Nội dung, ảnh và timing project được giữ nguyên.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSavedTemplate(template) {
    if (!window.confirm(`Xóa mẫu "${template.name}"?`)) return;
    setBusy(true);
    try {
      await api(`/api/templates/${encodeURIComponent(template.type)}/${encodeURIComponent(template.id)}`, { method: "DELETE" });
      await refresh();
      setNotice("Đã xóa mẫu.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function renameSavedTemplate(template, body) {
    setBusy(true);
    try {
      await api(`/api/templates/${encodeURIComponent(template.type)}/${encodeURIComponent(template.id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await refresh();
      setNotice("Đã cập nhật mẫu.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function duplicateSavedTemplate(template) {
    setBusy(true);
    try {
      const duplicated = await api(`/api/templates/${encodeURIComponent(template.type)}/${encodeURIComponent(template.id)}/duplicate`, { method: "POST" });
      await refresh();
      setNotice(`Đã nhân bản mẫu ${duplicated.name}.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  const config = selectedVideo?.config;
  const currentLine = config?.lines?.[currentLineIndex] || null;
  const linkedTemplateRef = config?.savedTemplateRef || null;
  const linkedTemplate = linkedTemplateRef
    ? templates.find((template) => template.type === linkedTemplateRef.type && template.id === linkedTemplateRef.id)
    : null;
  const isLibraryScreen = screen === "library";
  const illustrationBusy = Boolean(newestJob(jobs, selectedSlug, (job) => job.type === "illustration-generate" && isRunningJob(job)));
  const characterBusy = Boolean(newestJob(jobs, selectedSlug, (job) => job.type === "character-convert" && isRunningJob(job)));
  const renderTemplateActions = () => linkedTemplateRef ? (
    <>
      <ActionButton
        tone="quiet"
        disabled={!selectedSlug || !selectedVideo?.config || busy || !templateStatus?.canUpdateTemplate}
        title={templateStatus?.blockedReasons?.join(" ") || (templateStatus?.canUpdateTemplate
          ? "Cập nhật mẫu bằng các thay đổi style hợp lệ của project hiện tại."
          : "Chỉ thay đổi style/he-thong trong whitelist mới bật nút này.")}
        onClick={updateLinkedTemplate}
      >
        <RefreshCcw size={16} /> Cập nhật mẫu
      </ActionButton>
      {templateStatus?.isBehind ? (
        <ActionButton
          tone="quiet"
          disabled={!selectedSlug || !selectedVideo?.config || busy}
          title="Kéo style/he-thống của version mới vào project, giữ nguyên content, ảnh, voice và timing."
          onClick={applyLatestTemplateUpdate}
        >
          <Download size={16} /> Áp dụng mẫu mới
        </ActionButton>
      ) : null}
    </>
  ) : (
    <>
      <ActionButton
        tone="quiet"
        disabled={!selectedSlug || !selectedVideo?.config || busy}
        title="Tạo một mẫu mới từ project hiện tại."
        onClick={() => openSaveTemplate("full")}
      >
        <Save size={16} /> Lưu thành mẫu
      </ActionButton>
      <ActionButton
        tone="quiet"
        disabled={!selectedSlug || !selectedVideo?.config || busy}
        title="Liên kết project này với một mẫu đã lưu."
        onClick={openAttachTemplate}
      >
        <Link2 size={16} /> Liên kết mẫu
      </ActionButton>
    </>
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><BrandLogo /></div>
          <div>
            <strong>Auto Compare Studio</strong>
            <span className="app-version">v{APP_VERSION}</span>
          </div>
        </div>
        <GlobalJobStrip jobs={jobs} selectedJobId={selectedJobId} onOpenJob={openJob} />
        <div className="top-actions">
          <div className="top-actions-primary">
            {isLibraryScreen ? (
              <ActionButton tone="quiet" disabled={checking} onClick={checkEnvironment}><CheckCircle2 size={16} /> Kiểm tra</ActionButton>
            ) : (
              <ActionButton tone="quiet" onClick={() => setScreen("library")}><FolderOpen size={16} /> Trang chủ</ActionButton>
            )}
            <ActionButton tone="quiet" onClick={() => openTemplateLibrary("all")}><FolderOpen size={16} /> Mẫu đã lưu</ActionButton>
          </div>
          {!isLibraryScreen ? (
            <div className="top-actions-secondary">
              <div className="top-actions-secondary-desktop">{renderTemplateActions()}</div>
              <button
                type="button"
                className="top-actions-more-toggle"
                aria-expanded={moreActionsOpen}
                aria-controls="top-actions-more-menu"
                onClick={() => setMoreActionsOpen((value) => !value)}
              >
                <MoreHorizontal size={16} /> <span>Thêm</span>
              </button>
              {moreActionsOpen ? (
                <div id="top-actions-more-menu" className="top-actions-more-menu" role="menu">
                  {renderTemplateActions()}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {notice ? <div className="notice" role="status" aria-live="polite">{notice}<button type="button" aria-label="Đóng thông báo" onClick={() => setNotice("")}>Đóng</button></div> : null}

      {screen === "library" ? (
        <LibraryScreen
          videos={videos}
          templates={templates}
          jobs={jobs}
          busy={busy}
          onCreate={createProject}
          onOpen={openVideo}
          onOpenJob={openJob}
          onDelete={deleteProject}
          onDeleteAll={deleteAllProjects}
        />
      ) : (
        <main className={`editor-grid ${previewCollapsed ? "preview-collapsed" : ""} ${scriptCollapsed ? "script-collapsed" : ""}`}>
          <PhonePreview
            slug={selectedSlug}
            config={config}
            sounds={sfx}
            currentIndex={currentLineIndex}
            onSelectLine={setCurrentLineIndex}
            refreshKey={previewRevision}
            autoplayToken={quickPreviewAutoplayToken}
          />

          <section className="work-panel">
            <div className="project-head">
              <div>
                <span className="eyebrow">Project đang chọn</span>
                <h1>{config?.title || "Chưa chọn project"}</h1>
              </div>
              <div className="project-status-stack">
                <span
                  className={`project-template-badge ${linkedTemplateRef ? "linked" : "free"}`}
                  title={linkedTemplateRef ? `Project đang liên kết với mẫu ${linkedTemplate?.name || linkedTemplateRef.name}` : "Project chưa liên kết mẫu"}
                >
                  {linkedTemplateRef
                    ? `Liên kết: ${linkedTemplate?.name || linkedTemplateRef.name} · v${linkedTemplateRef.version || 1}`
                    : "Tự do"}
                </span>
                {linkedTemplateRef && templateStatus?.isBehind ? <span className="project-template-badge update">Mẫu cơ bản mới</span> : null}
                <span className={`save-state ${saving === "Lỗi lưu" ? "bad" : ""}`}><Save size={14} /> {saving}</span>
              </div>
              <WorkspaceViewControls
                previewCollapsed={previewCollapsed}
                scriptCollapsed={scriptCollapsed}
                onTogglePreview={() => setPreviewCollapsed((value) => !value)}
                onToggleScript={() => setScriptCollapsed((value) => !value)}
                onExpandFocus={() => {
                  setPreviewCollapsed(true);
                  setScriptCollapsed(true);
                }}
                onExpandAll={() => {
                  setPreviewCollapsed(false);
                  setScriptCollapsed(false);
                }}
              />
            </div>

            <div className="tab-row" role="tablist" aria-label="Các bước chỉnh video" aria-orientation="horizontal">
              {[
                ["content", "Nội dung"],
                ["character", "Nhân vật"],
                ["audio", "Âm thanh"],
                ["caption", "Phụ đề"],
                ["render", "Render"],
              ].map(([id, label], index) => (
                <button
                  type="button"
                  key={id}
                  id={`editor-tab-${id}`}
                  role="tab"
                  aria-selected={activeTab === id}
                  aria-controls={`editor-panel-${id}`}
                  tabIndex={activeTab === id ? 0 : -1}
                  className={activeTab === id ? "active" : ""}
                  onKeyDown={(event) => handleEditorTabKeyDown(event, index)}
                  onClick={() => setActiveTab(id)}
                >
                  {`${index + 1}. ${label}`}
                </button>
              ))}
            </div>

            <div
              className="tab-panel-shell"
              id={`editor-panel-${activeTab}`}
              role="tabpanel"
              aria-labelledby={`editor-tab-${activeTab}`}
            >
              {activeTab === "content" && (
                <ContentTab
                  config={config}
                  busy={busy || illustrationBusy}
                  updateConfig={updateConfig}
                  uploadProjectAsset={uploadProjectAsset}
                  onSaveTemplate={openSaveTemplate}
                  onApplyTemplate={openTemplateLibrary}
                  aiImageProvider={aiImageProvider}
                  setAiImageProvider={setAiImageProvider}
                  aiImageStyle={aiImageStyle}
                  setAiImageStyle={setAiImageStyle}
                  aiImageVariants={aiImageVariants}
                  setAiImageVariants={setAiImageVariants}
                  generateIllustrations={generateIllustrations}
                  generateAllIllustrations={generateAllIllustrations}
                  selectIllustrationVariant={selectIllustrationVariant}
                  cancelIllustrationSlot={cancelIllustrationSlot}
                  jobs={jobs}
                />
              )}
              {activeTab === "character" && (
                <CharacterTab config={config} assets={assets} currentLine={currentLine} busy={busy || characterBusy} updateConfig={updateConfig} uploadCharacter={uploadCharacter} deleteCharacter={deleteCharacter} uploadProjectAsset={uploadProjectAsset} onSaveTemplate={openSaveTemplate} onApplyTemplate={openTemplateLibrary} />
              )}
              {activeTab === "audio" && (
                <AudioTab
                  config={config}
                  voices={voices}
                  sfx={sfx}
                  sfxSources={sfxSources}
                  busy={busy}
                  updateConfig={updateConfig}
                  uploadSfx={uploadSfx}
                  uploadProjectAsset={uploadProjectAsset}
                  runJob={runJob}
                  selectedSlug={selectedSlug}
                  jobs={jobs}
                  selectedJobId={selectedJobId}
                  setSelectedJobId={setSelectedJobId}
                  logs={logs}
                  onSaveTemplate={openSaveTemplate}
                  onApplyTemplate={openTemplateLibrary}
                  currentLineIndex={currentLineIndex}
                  previewLine={previewLine}
                  contentDraftIsDirty={contentDraftDirty(config)}
                  aimaxApiKey={aimaxRuntimeApiKey}
                  onAimaxApiKeyChange={setAimaxRuntimeApiKey}
                  aimaxApiSaved={Boolean(aimaxSettings?.apiKeyConfigured || status?.aimax?.ok)}
                  onSaveAimaxApiKey={saveAimaxApiKey}
                  aimaxApiSaving={aimaxSettingsSaving}
                  onTestAimaxVoices={testAimaxVoices}
                  aimaxVoiceLoading={aimaxVoiceLoading}
                />
              )}
              {activeTab === "caption" && (
                <CaptionTab config={config} updateConfig={updateConfig} busy={busy} onSaveTemplate={openSaveTemplate} onApplyTemplate={openTemplateLibrary} />
              )}
              {activeTab === "render" && (
                <RenderTab
                  status={status}
                  selectedSlug={selectedSlug}
                  selectedVideo={selectedVideo}
                  jobs={jobs}
                  selectedJobId={selectedJobId}
                  setSelectedJobId={setSelectedJobId}
                  logs={logs}
                  runJob={runJob}
                  cancelJob={cancelJob}
                  updateConfig={updateConfig}
                  busy={busy}
                  finalSnapshot={finalSnapshot}
                  snapshotBusy={snapshotBusy}
                  onCreateFinalPreview={createFinalPreview}
                  contentDraftIsDirty={contentDraftDirty(config)}
                  aimaxApiKey={aimaxRuntimeApiKey}
                />
              )}
            </div>
          </section>

          <OfficialScriptPanel
            config={config}
            currentIndex={currentLineIndex}
            setCurrentIndex={setCurrentLineIndex}
            updateContentDraft={updateContentDraft}
            commitContent={commitContent}
            updateConfig={updateConfig}
            normalizeLines={normalizeLines}
            draftSaving={draftSaving}
            busy={busy}
          />
        </main>
      )}
      {templateModal?.mode === "save" ? (
        <SaveTemplateModal
          type={templateModal.type}
          titleOverride={templateModal.title}
          defaultParts={templateModal.parts}
          config={config}
          busy={busy}
          onClose={() => setTemplateModal(null)}
          onSave={saveTemplate}
        />
      ) : null}
      {templateModal?.mode === "library" ? (
        <TemplateLibraryModal
          templates={templates}
          initialType={templateModal.typeFilter}
          purpose={templateModal.purpose}
          busy={busy}
          canApply={Boolean(selectedSlug)}
          canAttach={Boolean(selectedSlug && selectedVideo?.config && !selectedVideo.config.savedTemplateRef)}
          onClose={() => setTemplateModal(null)}
          onApply={applyTemplate}
          onAttach={attachTemplate}
          onDelete={deleteSavedTemplate}
          onRename={renameSavedTemplate}
          onDuplicate={duplicateSavedTemplate}
        />
      ) : null}
    </div>
  );
}

function TemplatePartActions({ type, label, items, parts, title, description, busy, onSave, onApply }) {
  const actionItems = (items?.length ? items : [{ type, label }]).map((item) => ({
    ...item,
    label: item.label || TEMPLATE_TYPE_LABELS[item.type] || item.type,
  }));
  const bundleParts = parts ? templatePartsForType(type, parts) : null;
  const isBundle = Boolean(bundleParts && TEMPLATE_PARTS.filter((part) => bundleParts[part]).length > 1);
  const isGrouped = !isBundle && actionItems.length > 1;
  const heading = title || `Mẫu ${label || actionItems[0]?.label || ""}`;
  const summary = description || "";
  return (
    <section className={`template-action-row ${isGrouped ? "grouped" : ""}`}>
      <div className="template-action-copy">
        <span className="eyebrow">{heading}</span>
        {summary ? <strong>{summary}</strong> : null}
      </div>
      <div className={`template-action-buttons ${isGrouped ? "grouped" : ""}`}>
        {isBundle ? (
          <div className="template-action-cluster">
            <button className="template-part-button" type="button" disabled={busy} title={`Lưu ${heading}`} onClick={() => onSave(type, { parts: bundleParts, title: heading })}><Save size={15} /> Lưu tất cả</button>
            <button className="template-part-button" type="button" disabled={busy} title={`Áp dụng ${heading}`} onClick={() => onApply(type)}><FolderOpen size={15} /> Áp dụng tất cả</button>
          </div>
        ) : actionItems.map((item) => (
          <div className="template-action-cluster" key={item.type}>
            {isGrouped ? <span>{item.label}</span> : null}
            <button className="template-part-button" type="button" disabled={busy} title={`Lưu mẫu ${item.label}`} onClick={() => onSave(item.type)}><Save size={15} /> {isGrouped ? "Lưu" : "Lưu mẫu"}</button>
            <button className="template-part-button" type="button" disabled={busy} title={`Áp dụng mẫu ${item.label}`} onClick={() => onApply(item.type)}><FolderOpen size={15} /> {isGrouped ? "Áp dụng" : "Áp dụng mẫu"}</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function SaveTemplateModal({ type, titleOverride, defaultParts, config, busy, onClose, onSave }) {
  const dialogRef = useRef(null);
  const [name, setName] = useState(() => titleOverride ? `${titleOverride} - ${config?.title || "project"}` : defaultTemplateName(type, config));
  const [description, setDescription] = useState("");
  const [parts, setParts] = useState(() => templatePartsForType(type, defaultParts));
  const activeParts = TEMPLATE_PARTS.filter((part) => parts[part]);
  const visibleParts = type === "full" ? TEMPLATE_PARTS : (activeParts.length ? activeParts : [type]);
  const selectedCount = visibleParts.filter((part) => parts[part]).length;
  const titleLabel = titleOverride?.replace(/^Mẫu\b/, "mẫu");
  const title = titleOverride ? `Lưu ${titleLabel}` : (type === "full" ? "Lưu mẫu toàn bộ" : `Lưu mẫu ${TEMPLATE_TYPE_LABELS[type] || type}`);
  useDialogFocus(dialogRef, onClose);

  function togglePart(part) {
    if (type !== "full") return;
    setParts((current) => ({ ...current, [part]: !current[part] }));
  }

  function submit(event) {
    event.preventDefault();
    if (!name.trim() || !selectedCount) return;
    onSave({
      type,
      name: name.trim(),
      description: description.trim(),
      parts,
      includeAssets: true,
    });
  }

  return (
    <div className="template-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form ref={dialogRef} className="template-modal" role="dialog" aria-modal="true" aria-labelledby="save-template-dialog-title" onSubmit={submit}>
        <div className="template-modal-head">
          <div>
            <h2 id="save-template-dialog-title">{title}</h2>
          </div>
          <button type="button" className="icon-close" data-dialog-initial title="Đóng" aria-label="Đóng hộp thoại" onClick={onClose}>×</button>
        </div>
        <div className="form-grid">
          <label>Tên mẫu<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: CapCut vàng - nhân vật mây" /></label>
          <label>Mô tả<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Tùy chọn" /></label>
        </div>
        <section className="template-part-checklist">
          <strong>Lưu các phần</strong>
          {visibleParts.map((part) => (
            <label key={part} className={parts[part] ? "checked" : ""}>
              <input type="checkbox" checked={Boolean(parts[part])} disabled={type !== "full"} onChange={() => togglePart(part)} />
              <span>{TEMPLATE_PART_LABELS[part]}</span>
            </label>
          ))}
        </section>
        <div className="template-modal-actions">
          <button type="button" onClick={onClose}>Hủy</button>
          <ActionButton disabled={busy || !name.trim() || !selectedCount} type="submit"><Save size={16} /> Lưu mẫu</ActionButton>
        </div>
      </form>
    </div>
  );
}

function TemplateLibraryModal({ templates, initialType = "all", purpose = "apply", busy, canApply, canAttach, onClose, onApply, onAttach, onDelete, onRename, onDuplicate }) {
  const dialogRef = useRef(null);
  const [filter, setFilter] = useState(initialType || "all");
  const [applyDraft, setApplyDraft] = useState(null);
  const [renameDraft, setRenameDraft] = useState(null);
  const attachMode = purpose === "attach";
  const filteredTemplates = templates.filter((template) => {
    if (attachMode) return template.type === "full";
    return filter === "all" || template.type === filter;
  });
  useDialogFocus(dialogRef, onClose);

  useEffect(() => {
    setFilter(attachMode ? "full" : (initialType || "all"));
    setApplyDraft(null);
    setRenameDraft(null);
  }, [attachMode, initialType]);

  function startApply(template) {
    setRenameDraft(null);
    if (attachMode) {
      onAttach(template);
      return;
    }
    const parts = templatePartsForType(template.type, template.parts);
    if (template.type !== "full") {
      onApply({ type: template.type, id: template.id, parts });
      return;
    }
    setApplyDraft({ template, parts });
  }

  function startRename(template) {
    setApplyDraft(null);
    setRenameDraft({
      template,
      name: template.name || "",
      description: template.description || "",
    });
  }

  function toggleApplyPart(part) {
    setApplyDraft((current) => current ? { ...current, parts: { ...current.parts, [part]: !current.parts[part] } } : current);
  }

  async function submitRename(event) {
    event.preventDefault();
    if (!renameDraft?.name.trim()) return;
    const { template, name, description } = renameDraft;
    await onRename(template, {
      name: name.trim(),
      description: description.trim(),
    });
    setRenameDraft(null);
  }

  return (
    <div className="template-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="template-library-modal" role="dialog" aria-modal="true" aria-labelledby="template-library-dialog-title">
        <div className="template-modal-head">
          <div>
            <h2 id="template-library-dialog-title">{attachMode ? "Liên kết mẫu" : "Mẫu đã lưu"}</h2>
          </div>
          <button type="button" className="icon-close" data-dialog-initial title="Đóng" aria-label={attachMode ? "Đóng liên kết mẫu" : "Đóng thư viện mẫu"} onClick={onClose}>×</button>
        </div>
        {!attachMode ? (
          <div className="template-library-tabs" role="tablist" aria-label="Lọc mẫu đã lưu">
            {TEMPLATE_TYPE_TABS.map((tab) => (
              <button
                type="button"
                key={tab.id}
                role="tab"
                aria-selected={filter === tab.id}
                className={filter === tab.id ? "active" : ""}
                onClick={() => { setFilter(tab.id); setApplyDraft(null); setRenameDraft(null); }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="template-card-grid">
          {filteredTemplates.length ? filteredTemplates.map((template) => (
            <article className="template-card" key={`${template.type}-${template.id}`}>
              <div>
                <span>{TEMPLATE_TYPE_LABELS[template.type] || template.type}</span>
                <strong>{template.name}</strong>
                {template.description ? <small>{template.description}</small> : null}
              </div>
              <p>{templatePartNames(template.parts) || "Chưa có part"} · {template.updatedAt ? new Date(template.updatedAt).toLocaleString("vi-VN") : "Chưa có ngày"}</p>
              <div className="template-card-actions">
                <button
                  type="button"
                  disabled={busy || (attachMode ? !canAttach : !canApply)}
                  title={attachMode ? "Liên kết project hiện tại với mẫu này." : undefined}
                  onClick={() => startApply(template)}
                >
                  {attachMode ? <Link2 size={14} /> : <Wand2 size={14} />} {attachMode ? "Liên kết" : "Áp dụng"}
                </button>
                <button type="button" disabled={busy} onClick={() => startRename(template)}>Đổi tên</button>
                <button type="button" disabled={busy} onClick={() => onDuplicate(template)}><Plus size={14} /> Nhân bản</button>
                <button type="button" disabled={busy} className="danger" onClick={() => onDelete(template)}><Trash2 size={14} /> Xóa</button>
              </div>
            </article>
          )) : <div className="empty">Chưa có mẫu</div>}
        </div>
        {renameDraft ? (
          <form className="template-rename-panel" onSubmit={submitRename}>
            <div>
              <strong>Đổi tên mẫu</strong>
              <span>{renameDraft.template.name}</span>
            </div>
            <div className="template-rename-fields">
              <label>Tên mẫu
                <input
                  autoFocus
                  value={renameDraft.name}
                  onChange={(event) => setRenameDraft((current) => current ? { ...current, name: event.target.value } : current)}
                />
              </label>
              <label>Mô tả
                <textarea
                  value={renameDraft.description}
                  onChange={(event) => setRenameDraft((current) => current ? { ...current, description: event.target.value } : current)}
                  placeholder="Tùy chọn"
                />
              </label>
            </div>
            <div className="template-modal-actions">
              <button type="button" onClick={() => setRenameDraft(null)}>Hủy</button>
              <ActionButton disabled={busy || !renameDraft.name.trim()} type="submit"><Save size={16} /> Lưu tên</ActionButton>
            </div>
          </form>
        ) : null}
        {!attachMode && applyDraft ? (
          <section className="template-apply-panel">
            <div>
              <strong>Áp dụng: {applyDraft.template.name}</strong>
            </div>
            <div className="template-part-checklist compact">
              {TEMPLATE_PARTS.filter((part) => applyDraft.template.parts?.[part]).map((part) => (
                <label key={part} className={applyDraft.parts[part] ? "checked" : ""}>
                  <input type="checkbox" checked={Boolean(applyDraft.parts[part])} onChange={() => toggleApplyPart(part)} />
                  <span>{TEMPLATE_PART_LABELS[part]}</span>
                </label>
              ))}
            </div>
            <div className="template-modal-actions">
              <button type="button" onClick={() => setApplyDraft(null)}>Hủy</button>
              <ActionButton disabled={busy || !TEMPLATE_PARTS.some((part) => applyDraft.parts[part])} onClick={() => onApply({ type: applyDraft.template.type, id: applyDraft.template.id, parts: applyDraft.parts })}><Wand2 size={16} /> Áp dụng mẫu</ActionButton>
            </div>
          </section>
        ) : null}
      </section>

    </div>
  );
}

function LibraryScreen({ videos, templates = [], jobs = [], busy, onCreate, onOpen, onOpenJob, onDelete, onDeleteAll }) {
  const [form, setForm] = useState({
    title: "",
    content: "",
    content2: "",
  });
  const [activeGroup, setActiveGroup] = useState("all");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySort, setLibrarySort] = useState("updated");
  const fullTemplates = useMemo(() => templates.filter((template) => template.type === "full"), [templates]);
  const groups = useMemo(() => [
    { id: "all", label: "Tất cả" },
    { id: "free", label: "Tự do" },
    ...fullTemplates.map((template) => ({
      id: `template:${template.type}:${template.id}`,
      label: template.name || "Mẫu đã lưu",
      template,
    })),
  ], [fullTemplates]);
  const activeTemplate = groups.find((group) => group.id === activeGroup)?.template || null;
  const activeGroupLabel = groups.find((group) => group.id === activeGroup)?.label || "tab hiện tại";
  const createContextText = activeTemplate
    ? `Project mới sẽ liên kết mẫu "${activeTemplate.name || activeTemplate.id}". Kịch bản bạn nhập được giữ lại khi mở editor.`
    : "Project mới tạo tự do. Không liên kết mẫu đã lưu nào.";
  const filteredVideos = useMemo(() => {
    const query = libraryQuery.trim().toLocaleLowerCase("vi-VN");
    const scoped = videos.filter((video) => {
      const ref = video.config?.savedTemplateRef || null;
      if (activeGroup === "all") return true;
      if (activeGroup === "free") return !ref;
      return Boolean(activeTemplate && ref?.type === activeTemplate.type && ref?.id === activeTemplate.id);
    }).filter((video) => {
      if (!query) return true;
      return [video.name, video.slug, video.config?.title]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("vi-VN").includes(query));
    });

    return [...scoped].sort((left, right) => {
      if (librarySort === "name") return String(left.name || left.slug).localeCompare(String(right.name || right.slug), "vi-VN");
      if (librarySort === "renders") return (right.renders?.length || 0) - (left.renders?.length || 0);
      const leftDate = Date.parse(left.updatedAt || left.createdAt || left.config?.updatedAt || "") || 0;
      const rightDate = Date.parse(right.updatedAt || right.createdAt || right.config?.updatedAt || "") || 0;
      return rightDate - leftDate;
    });
  }, [activeGroup, activeTemplate, libraryQuery, librarySort, videos]);

  useEffect(() => {
    if (groups.some((group) => group.id === activeGroup)) return;
    setActiveGroup("all");
  }, [activeGroup, groups]);

  function countForGroup(group) {
    if (group.id === "all") return videos.length;
    if (group.id === "free") return videos.filter((video) => !video.config?.savedTemplateRef).length;
    return videos.filter((video) => {
      const ref = video.config?.savedTemplateRef;
      return ref?.type === group.template?.type && ref?.id === group.template?.id;
    }).length;
  }

  function createFromCurrentGroup() {
    const contentByCompareSet = {
      "compare-1": form.content,
      "compare-2": form.content2,
    };
    const payload = activeTemplate
      ? { ...form, contentByCompareSet, templateRef: { type: activeTemplate.type, id: activeTemplate.id } }
      : { ...form, contentByCompareSet };
    onCreate(payload);
  }

  const hasAnyScript = Boolean(form.content.trim() || form.content2.trim());

  return (
    <main className="library-grid">
      <section className="panel create-panel">
        <span className="eyebrow">Tạo project</span>
        <h1>Tạo video so sánh</h1>
        <div className={`create-context ${activeTemplate ? "linked" : "free"}`}>
          {createContextText}
        </div>
        <div className="form-grid">
          <label>Tên project<input placeholder="Ví dụ: Ly thân và Ly hôn" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label>Kịch bản 1<textarea placeholder={'Đây là A.\nĐây là B.\nKhác nhau ở đâu?'} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} /></label>
          <label>Kịch bản 2<textarea placeholder={'Phần so sánh thứ hai nếu có.\nCó thể để trống.'} value={form.content2} onChange={(event) => setForm({ ...form, content2: event.target.value })} /></label>
        </div>
        <ActionButton disabled={busy || !form.title.trim() || !hasAnyScript} onClick={createFromCurrentGroup}><Plus size={17} /> Tạo và mở Editor</ActionButton>
      </section>

      <section className="panel">
        <div className="library-heading"><div><span className="eyebrow">Trang chủ</span><h1>Dự án của bạn</h1></div><ActionButton tone="quiet" disabled={busy || !filteredVideos.length} onClick={() => onDeleteAll(filteredVideos.map((video) => video.slug), activeGroupLabel)}><Trash2 size={16} /> {activeGroup === "all" ? "Xóa tất cả" : "Xóa tab này"}</ActionButton></div>
        <div className="project-library-tabs" role="tablist" aria-label="Lọc dự án theo mẫu">
          {groups.map((group) => (
            <button
              type="button"
              key={group.id}
              role="tab"
              aria-selected={activeGroup === group.id}
              className={activeGroup === group.id ? "active" : ""}
              onClick={() => setActiveGroup(group.id)}
              title={group.label}
            >
              <span>{group.label}</span>
              <b>{countForGroup(group)}</b>
            </button>
          ))}
        </div>
        <div className="library-filters" role="search" aria-label="Tìm và sắp xếp project">
          <label className="library-search-field">
            <span>Tìm project</span>
            <span className="library-search-control">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                placeholder="Tên hoặc slug project"
                aria-label="Tìm project theo tên hoặc slug"
              />
            </span>
          </label>
          <label className="library-sort-field">
            <span>Sắp xếp</span>
            <select value={librarySort} onChange={(event) => setLibrarySort(event.target.value)} aria-label="Sắp xếp project">
              <option value="updated">Mới cập nhật</option>
              <option value="name">Tên A–Z</option>
              <option value="renders">Nhiều render nhất</option>
            </select>
          </label>
          {(libraryQuery || librarySort !== "updated") ? (
            <button type="button" className="library-clear-filters" onClick={() => { setLibraryQuery(""); setLibrarySort("updated"); }}>
              <X size={16} /> Xóa lọc
            </button>
          ) : null}
        </div>
        <div className="video-list">
          {filteredVideos.length ? filteredVideos.map((video) => (
            <div className="video-row" key={video.slug}>
              <div>
                <strong title={video.name}>{video.name}</strong>
                <span>{video.slug} · {video.renders?.length || 0} render</span>
              </div>
              <div className="video-row-actions"><ActionButton tone="quiet" onClick={() => onOpen(video.slug)}><Play size={15} /> Mở</ActionButton><ActionButton tone="danger" onClick={() => onDelete(video.slug)}><Trash2 size={15} /> Xóa</ActionButton></div>
            </div>
          )) : <div className="empty">{videos.length ? (libraryQuery ? "Không tìm thấy project phù hợp." : "Không có project trong tab này.") : "Chưa có project"}</div>}
        </div>
      </section>
      <HomeJobsPanel jobs={jobs} onOpenJob={onOpenJob} onOpenProject={onOpen} />
    </main>
  );
}

function applyLiveConfigToPreview(props, config, sounds = []) {
  if (!props || !config) return props;
  const lines = (config.lines || []).map((line, index) => {
    const canonical = props.lines?.find((item) => item.id === line.id) || props.lines?.[index] || {};
    return {
      ...canonical,
      ...line,
      // Timing is always owned by the generated TTS/SRT timeline.
      startMs: canonical.startMs,
      durationMs: canonical.durationMs,
      endMs: canonical.endMs,
    };
  });
  const compareSets = getCompareSets(config);
  return applyLiveSoundToPreviewProps({
    ...props,
    assets: livePreviewAssetsFromConfig(props.assets, config),
    title: config.title,
    leftLabel: config.compare?.leftLabel,
    rightLabel: config.compare?.rightLabel,
    template: config.template,
    compare: config.compare,
    compareSets,
    background: config.background,
    logo: config.logo,
    caption: config.caption,
    character: config.character,
    layout: config.layout,
    audioConfig: config.audio,
    lines,
  }, config, sounds);
}

function PhonePreview({ slug, config, sounds, currentIndex, onSelectLine, refreshKey, autoplayToken }) {
  const playerRef = useRef(null);
  const preloadCacheRef = useRef(new Map());
  const autoplayFrameRef = useRef(null);
  const handledAutoplayTokenRef = useRef(0);
  const playbackIntentRef = useRef("paused");
  const previewSlugRef = useRef("");
  const previewRequestKeyRef = useRef("");
  const previewDataRef = useRef(null);
  const previewInFlightRef = useRef(false);
  const previewRetryDelayRef = useRef(2500);
  const [playing, setPlaying] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [previewStatus, setPreviewStatus] = useState("loading");
  const [previewRetryToken, setPreviewRetryToken] = useState(0);
  const requestedPreviewPose = ["point-left", "point-right", "question"].includes(config?.lines?.[currentIndex]?.pose)
    ? config.lines[currentIndex].pose
    : "point-left";

  useEffect(() => {
    const requestKey = slug ? `${slug}:${requestedPreviewPose}` : "";
    if (!requestKey) {
      previewRequestKeyRef.current = "";
      previewDataRef.current = null;
      setPreviewData(null);
      setPreviewError("");
      setPreviewStatus("empty");
      return undefined;
    }

    const isNewProject = previewSlugRef.current !== slug;
    const isNewRequest = previewRequestKeyRef.current !== requestKey;
    previewSlugRef.current = slug;
    previewRequestKeyRef.current = requestKey;
    if (isNewProject) {
      previewDataRef.current = null;
      setPreviewData(null);
    }
    if (isNewRequest) {
      setPreviewError("");
      previewRetryDelayRef.current = 2500;
      setPreviewStatus(previewDataRef.current ? "stale" : "loading");
    } else {
      setPreviewStatus(previewDataRef.current ? "stale" : "loading");
    }

    let cancelled = false;
    let timer = null;
    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    const schedule = (delay) => {
      clearTimer();
      if (!cancelled && document.visibilityState === "visible") {
        timer = window.setTimeout(load, delay);
      }
    };
    const load = async () => {
      if (cancelled || previewInFlightRef.current || document.visibilityState !== "visible") return;
      previewInFlightRef.current = true;
      if (!previewDataRef.current || previewDataRef.current.previewPose !== requestedPreviewPose) {
        setPreviewStatus("loading");
      } else {
        setPreviewStatus("stale");
      }
      try {
        const pose = encodeURIComponent(requestedPreviewPose);
        const data = await api(`/api/videos/${encodeURIComponent(slug)}/preview-props?pose=${pose}`);
        if (!cancelled) {
          previewDataRef.current = data;
          setPreviewData(data);
          setPreviewError("");
          setPreviewStatus("ready");
          previewRetryDelayRef.current = 2500;
          schedule(2500);
        }
      } catch (error) {
        if (!cancelled) {
          const statusMessage = error?.status >= 500
            ? "Máy chủ preview đang bận, hãy thử lại sau ít giây."
            : error?.message || "Không thể kết nối tới máy chủ preview.";
          setPreviewError(statusMessage);
          setPreviewStatus(previewDataRef.current ? "stale" : "error");
          const nextDelay = previewRetryDelayRef.current;
          previewRetryDelayRef.current = Math.min(nextDelay * 2, 10000);
          schedule(nextDelay);
        }
      } finally {
        if (!cancelled) previewInFlightRef.current = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearTimer();
        return;
      }
      load();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    load();
    return () => {
      cancelled = true;
      previewInFlightRef.current = false;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [slug, refreshKey, requestedPreviewPose, previewRetryToken]);

  const timelinePreviewProps = useMemo(() => (
    previewData ? applyLiveConfigToPreview(previewData.props, config, sounds) : null
  ), [previewData, config, sounds]);
  const previewProps = useMemo(() => buildLineScopedPreviewProps(timelinePreviewProps, currentIndex), [timelinePreviewProps, currentIndex]);
  const lineCount = config?.lines?.length || 0;
  const durationInFrames = Math.max(previewProps?.previewMode === "line" ? 12 : 90, Math.ceil(Number(previewProps?.durationInSeconds || 3) * 30));
  const previewPlayerKey = useMemo(() => {
    if (!previewProps) return "preview-empty";
    const activeCharacterSrc = previewProps.assets?.characters?.[requestedPreviewPose]
      || previewProps.assets?.characters?.question
      || "";
    const visualAssetKey = [
      previewProps.assets?.background || "",
      previewProps.assets?.logo || "",
      ...Object.values(previewProps.assets?.compareSets || {}).flatMap((set) => [set.left || "", set.right || ""]),
    ].join(":");
    const characterKey = [
      requestedPreviewPose,
      activeCharacterSrc,
      config?.character?.poses?.[requestedPreviewPose] || "",
      config?.character?.scale ?? "",
      config?.character?.x ?? "",
      config?.character?.y ?? "",
    ].join(":");
    const clips = [
      ...(previewProps.assets?.audioClips || []),
      ...(previewProps.assets?.sfxClips || []),
    ].map((clip) => [
      clip.lineId || "",
      clip.src || "",
      clip.startMs || 0,
      clip.durationMs || 0,
      clip.volume ?? "",
      clip.trimBeforeMs || 0,
      clip.sfxOffsetMs || 0,
      clip.sfxVolume ?? "",
    ].join(":"));
    return [previewProps.previewLineId || "timeline", previewProps.previewHash || previewData?.propsHash || "", refreshKey || 0, visualAssetKey, characterKey, ...clips].join("|");
  }, [previewProps, previewData?.propsHash, refreshKey, requestedPreviewPose, config?.character]);

  useEffect(() => {
    preloadPreviewAssets(timelinePreviewProps, currentIndex, preloadCacheRef.current);
  }, [timelinePreviewProps, currentIndex]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return undefined;
    const onPlay = () => {
      playbackIntentRef.current = "playing";
      setPlaying(true);
    };
    const onPause = () => {
      playbackIntentRef.current = "paused";
      setPlaying(false);
    };
    const onEnded = () => {
      playbackIntentRef.current = "paused";
      player.seekTo(0);
      setPlaying(false);
    };
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onEnded);
    return () => {
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onEnded);
    };
  }, [previewPlayerKey]);

  useEffect(() => {
    const player = playerRef.current;
    if (autoplayFrameRef.current !== null) {
      cancelAnimationFrame(autoplayFrameRef.current);
      autoplayFrameRef.current = null;
    }
    playbackIntentRef.current = "paused";
    setPlaying(false);
    if (!player || !previewProps) return;
    try {
      player.pause();
      player.seekTo(0);
    } catch {
      // The Remotion ref can briefly point at an unmounted player while React swaps preview keys.
    }
  }, [previewPlayerKey, previewProps?.previewLineId, previewData?.propsHash]);

  useEffect(() => {
    if (!autoplayToken || !previewProps || handledAutoplayTokenRef.current === autoplayToken) return undefined;
    const token = autoplayToken;
    const frame = requestAnimationFrame(() => {
      if (autoplayFrameRef.current === frame) autoplayFrameRef.current = null;
      if (handledAutoplayTokenRef.current === token) return;
      handledAutoplayTokenRef.current = token;
      const player = playerRef.current;
      if (!player) return;
      try {
        playbackIntentRef.current = "playing";
        player.pause();
        player.seekTo(0);
        player.play?.();
        if (playbackIntentRef.current === "playing") setPlaying(true);
      } catch {
        playbackIntentRef.current = "paused";
        setPlaying(false);
      }
    });
    autoplayFrameRef.current = frame;
    return () => {
      if (autoplayFrameRef.current === frame) {
        cancelAnimationFrame(frame);
        autoplayFrameRef.current = null;
      }
    };
  }, [autoplayToken, previewPlayerKey, previewProps]);

  useEffect(() => () => {
    if (autoplayFrameRef.current !== null) cancelAnimationFrame(autoplayFrameRef.current);
    try {
      playerRef.current?.pause();
    } catch {
      // The player may already be unmounted when the preview panel closes.
    }
  }, []);

  function cancelPendingAutoplay() {
    if (autoplayFrameRef.current !== null) {
      cancelAnimationFrame(autoplayFrameRef.current);
      autoplayFrameRef.current = null;
    }
    if (autoplayToken) handledAutoplayTokenRef.current = autoplayToken;
  }

  function togglePlayback() {
    const player = playerRef.current;
    if (!player || !previewProps) return;
    const isCurrentlyPlaying = typeof player.isPlaying === "function" ? player.isPlaying() : playing;
    try {
      if (isCurrentlyPlaying || playing) {
        cancelPendingAutoplay();
        playbackIntentRef.current = "paused";
        player.pause();
        setPlaying(false);
        return;
      }
      cancelPendingAutoplay();
      playbackIntentRef.current = "playing";
      player.seekTo(0);
      player.play?.();
      if (playbackIntentRef.current === "playing") setPlaying(true);
    } catch {
      playbackIntentRef.current = "paused";
      setPlaying(false);
    }
  }

  function selectRelative(offset) {
    onSelectLine(Math.max(0, Math.min(lineCount - 1, currentIndex + offset)));
  }

  const isFinal = previewData?.state === "final";
  const voiceIssueText = previewData?.voiceIssues?.[0] || "";
  const previewStatusText = previewStatus === "empty"
    ? "Chưa chọn project"
    : previewStatus === "loading"
      ? "Đang tải preview..."
      : previewStatus === "error"
        ? `Không tải được preview: ${previewError}`
        : previewStatus === "stale"
          ? `Preview đang dùng bản gần nhất${previewError ? ` · ${previewError}` : ""}`
          : isFinal
            ? `Final · ${lineCount ? currentIndex + 1 : 0}/${lineCount}`
            : "Bố cục nháp";
  const canRetryPreview = previewStatus === "error" || previewStatus === "stale";

  return (
    <aside className="preview-panel">
      <div className="preview-toolbar">
        <button type="button" title="Dòng trước" aria-label="Chọn dòng trước" onClick={() => selectRelative(-1)} disabled={currentIndex <= 0}><ChevronUp size={18} /></button>
        <strong>{lineCount ? currentIndex + 1 : 0}/{lineCount}</strong>
        {voiceIssueText && !isFinal ? <span className="preview-voice-warning" title={voiceIssueText}>VO</span> : null}
        <button type="button" className="preview-play" title={playing ? "Dừng preview thật" : "Phát preview thật"} aria-label={playing ? "Dừng preview" : "Phát preview"} onClick={togglePlayback} disabled={!previewProps}>
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button type="button" title="Dòng tiếp" aria-label="Chọn dòng tiếp" onClick={() => selectRelative(1)} disabled={currentIndex >= lineCount - 1}><ChevronDown size={18} /></button>
      </div>
      <div className="remotion-player-shell">
        {previewProps ? (
          <Suspense fallback={<div className="remotion-fallback">Đang tải preview...</div>}>
            <RemotionPlayerView
              key={previewPlayerKey}
              ref={playerRef}
              inputProps={previewProps}
              durationInFrames={durationInFrames}
              compositionWidth={1080}
              compositionHeight={1920}
              fps={30}
              numberOfSharedAudioTags={3}
              initialFrame={0}
              moveToBeginningWhenEnded
              className="remotion-preview"
              style={{ width: "100%", height: "100%" }}
            />
          </Suspense>
        ) : previewStatus === "error" || previewStatus === "stale" ? (
          <div className="preview-error-card" role="alert">
            <strong>Preview chưa sẵn sàng</strong>
            <span>{previewError || "Máy chủ chưa trả về dữ liệu preview."}</span>
            <button type="button" onClick={() => setPreviewRetryToken((value) => value + 1)}>
              <RefreshCcw size={16} /> Thử lại
            </button>
          </div>
        ) : <div className="preview-loading">{previewStatusText}</div>}
      </div>
      <div className={`preview-source-note preview-status-${previewStatus}`} role={previewStatus === "error" ? "alert" : "status"} aria-live="polite">
        <span>{previewStatusText}</span>
        {canRetryPreview ? (
          <button type="button" onClick={() => setPreviewRetryToken((value) => value + 1)} disabled={previewStatus === "loading"}>
            <RefreshCcw size={14} /> Thử lại
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function characterPreviewUrl({ slug, config, assets, pose }) {
  const rel = characterDisplayRel(config, pose);
  if (rel) {
    const url = versionedVideoUrl(slug, rel, config?.assetRevision);
    return { url, type: /\.(png|jpe?g|webp)$/i.test(rel) ? "image" : "video" };
  }
  return null;
}

function CompareCompactPreview({ set, leftSource, rightSource, imageAspect = 1, labelUppercase = true, labelPlacement = "below", labelAlign = "center", labelBoxEnabled = true, frameBorderColor = "", frameShadowColor = "", labelColor = "" }) {
  const renderAsset = (side, title, source, zoom, crop, label) => {
    const labelText = String(label || title || "").trim();
    const displayLabel = labelUppercase ? labelText.toLocaleUpperCase("vi-VN") : labelText;
    const styleVars = {
      "--compact-frame-color": frameBorderColor || (side === "right" ? "#0f766e" : "#f05b25"),
      "--compact-image-border-color": frameBorderColor || "#d7cbbb",
      ...(frameShadowColor ? { "--compact-frame-shadow": frameShadowColor } : {}),
      "--compact-label-color": labelColor || "#20160f",
      "--compact-image-aspect": Number(imageAspect) > 0 ? Number(imageAspect) : 1,
    };
    const labelNode = labelPlacement === "hidden"
      ? null
      : <strong className={`compare-compact-label ${labelPlacement} ${labelBoxEnabled ? "" : "no-box"}`} style={{ textAlign: labelAlign }}>{displayLabel || title}</strong>;
    return (
      <div className={`compare-compact-asset ${side}`} style={styleVars}>
        {labelPlacement === "above" ? labelNode : null}
        <div className="compare-compact-image">
          {source ? <img src={source} alt={title} style={cropImageStyle(zoom, crop)} /> : <div className="compare-compact-empty"><ImageIcon size={20} /><span>Chưa có ảnh</span></div>}
          {labelPlacement === "overlay" ? labelNode : null}
        </div>
        {labelPlacement === "below" ? labelNode : null}
      </div>
    );
  };

  return (
    <div className="compare-compact-preview-grid">
      {renderAsset("left", "Ảnh A", leftSource, set.leftZoom, set.leftCrop, set.leftLabel || "Nội dung A")}
      {renderAsset("right", "Ảnh B", rightSource, set.rightZoom, set.rightCrop, set.rightLabel || "Nội dung B")}
    </div>
  );
}

function ContentTab({
  config,
  busy,
  updateConfig,
  uploadProjectAsset,
  onSaveTemplate,
  onApplyTemplate,
  aiImageProvider,
  setAiImageProvider,
  aiImageStyle,
  setAiImageStyle,
  aiImageVariants,
  setAiImageVariants,
  generateIllustrations,
  generateAllIllustrations,
  selectIllustrationVariant,
  cancelIllustrationSlot,
  jobs = [],
}) {
  const [cropTarget, setCropTarget] = useState(null);
  const contentSections = useOpenSections([
    "layout-basics",
    "compare-label-style",
    "vs-colors",
    "image-sizing",
    "focus-motion",
    "ai-illustrations",
    ...COMPARE_SET_IDS.map((id) => `compare-${id}`),
  ]);
  if (!config) return <div className="empty">Chưa chọn project.</div>;
  const compareSets = getCompareSets(config);
  const allAiSlots = compareSets.flatMap((set) => [set.aiImages?.left, set.aiImages?.right]);
  const allAiSlotsBusy = allAiSlots.length > 0 && allAiSlots.every((slot) => slot?.state === "processing");
  const selectedTemplate = PROJECT_TEMPLATES.find((item) => item.id === config.template?.id) || PROJECT_TEMPLATES[0];
  const isPhotoTemplate = isPhotoLayoutTemplateId(selectedTemplate.id);
  const isDualTemplate = selectedTemplate.id === COMPARE_DUAL_TEMPLATE_ID;
  const isFramedPhotoTemplate = selectedTemplate.id === "photo-compare-v1";
  const isFocusScaleTemplate = isFocusScaleTemplateId(selectedTemplate.id);
  const isAdjustableCompareTemplate = isDualTemplate || isPhotoTemplate;
  const useVerticalCardPreview = isDualTemplate || isFocusScaleTemplate;
  const cropAspect = cropAspectForTemplate(selectedTemplate.id, isPhotoTemplate);
  const showVsControls = hasVsTemplateId(selectedTemplate.id);
  const compareLabelPlacement = COMPARE_LABEL_PLACEMENT_OPTIONS.some((option) => option.id === config.layout?.compareLabelPlacement)
    ? config.layout.compareLabelPlacement
    : LAYOUT.compareLabelPlacement;
  const compareLabelUppercase = config.layout?.compareLabelUppercase !== false;
  const compareLabelBoxEnabled = config.layout?.compareLabelBoxEnabled !== false;
  const compareLabelAlign = COMPARE_LABEL_ALIGN_OPTIONS.some((option) => option.id === config.layout?.compareLabelAlign)
    ? config.layout.compareLabelAlign
    : LAYOUT.compareLabelAlign;
  const compareLabelFontSize = clampNumber(config.layout?.compareLabelFontSize, 0, 96, 0);
  const compareLabelHeight = clampNumber(config.layout?.compareLabelHeight, 60, 220, 110);
  const compareLabelPaddingX = clampNumber(config.layout?.compareLabelPaddingX, 0, 60, 18);
  const compareLabelPaddingY = clampNumber(config.layout?.compareLabelPaddingY, 0, 36, 10);
  const compareLabelColor = config.layout?.compareLabelColor || LAYOUT.compareLabelColor;
  const compareLabelBackground = config.layout?.compareLabelBackground || LAYOUT.compareLabelBackground;
  const compareLabelBackgroundOpacity = clampNumber(config.layout?.compareLabelBackgroundOpacity, 0, 1, 0);
  const compareLabelBorderColor = config.layout?.compareLabelBorderColor || LAYOUT.compareLabelBorderColor;
  const compareLabelBorderWidth = clampNumber(config.layout?.compareLabelBorderWidth, 0, 10, 0);
  const compareLabelRadius = clampNumber(config.layout?.compareLabelRadius, 0, 32, 0);
  const compareLabelShadow = COMPARE_LABEL_SHADOW_OPTIONS.some((option) => option.id === config.layout?.compareLabelShadow)
    ? config.layout.compareLabelShadow
    : LAYOUT.compareLabelShadow;
  const dualCompareSize = clampNumber(config.layout?.dualCompareSize, 340, 500, LAYOUT.dualCompareSize);
  const dualCompareOffsetY = clampNumber(config.layout?.dualCompareOffsetY, -80, 220, LAYOUT.dualCompareOffsetY);
  const photoCompareSize = clampNumber(config.layout?.photoCompareSize, 340, 500, 390);
  const photoCompareOffsetY = clampNumber(config.layout?.photoCompareOffsetY, -80, 220, 0);
  const compareSizeControlValue = isDualTemplate ? dualCompareSize : photoCompareSize;
  const compareOffsetControlValue = isDualTemplate ? dualCompareOffsetY : photoCompareOffsetY;
  const compareFrameSizeValue = isFocusScaleTemplate ? (TEMPLATE_IMAGE_SPECS[FOCUS_SCALE_TEMPLATE_ID]?.width || 410) : compareSizeControlValue;
  const cropOutputSize = {
    width: Math.round(compareFrameSizeValue),
    height: Math.round(compareFrameSizeValue / Math.max(0.001, cropAspect)),
  };
  const compareSizeLayoutKey = isDualTemplate ? "dualCompareSize" : "photoCompareSize";
  const compareOffsetLayoutKey = isDualTemplate ? "dualCompareOffsetY" : "photoCompareOffsetY";
  const compareVsColor = config.layout?.compareVsColor || LAYOUT.compareVsColor;
  const compareVsTextColor = config.layout?.compareVsTextColor || LAYOUT.compareVsTextColor;
  const compareVsBorderColor = config.layout?.compareVsBorderColor || LAYOUT.compareVsBorderColor;
  const photoFrameBorderColor = config.layout?.photoFrameBorderColor || LAYOUT.photoFrameBorderColor;
  const photoFrameShadowColor = config.layout?.photoFrameShadowColor || LAYOUT.photoFrameShadowColor;
  const focusScaleLarge = clampNumber(config.layout?.focusScaleLarge, 1.05, 1.35, LAYOUT.focusScaleLarge);
  const focusScaleSmall = clampNumber(config.layout?.focusScaleSmall, 0.65, 0.98, LAYOUT.focusScaleSmall);
  const focusMotionDuration = clampNumber(config.layout?.focusMotionDuration, 0.25, 1, LAYOUT.focusMotionDuration);
  const focusImageBlur = clampNumber(config.layout?.focusImageBlur, 0, 8, LAYOUT.focusImageBlur);
  const focusImageDarkness = clampNumber(config.layout?.focusImageDarkness, 0, 0.7, LAYOUT.focusImageDarkness);
  const aiJobForSlot = (set, target) => findIllustrationJobForSlot(jobs, config.slug, set.id, target, set.aiImages?.[target]);
  const cancelAiSlot = (set, target) => {
    const job = aiJobForSlot(set, target);
    cancelIllustrationSlot?.(set.id, target, set.aiImages?.[target]?.jobId || job?.id || "");
  };
  return (
    <div className="tab-body compare-tab">
      <div className="template-action-stack">
        <TemplatePartActions
          title="Mẫu nội dung"
          description={null}
          type="content"
          parts={{ layout: true, content: true }}
          busy={busy}
          onSave={onSaveTemplate}
          onApply={onApplyTemplate}
        />
      </div>
      <SectionCollapseControls
        allOpen={contentSections.allOpen}
        allClosed={contentSections.allClosed}
        onExpandAll={() => contentSections.setAllOpen(true)}
        onCollapseAll={() => contentSections.setAllOpen(false)}
      />
      <CollapsibleGroup
        title="Bố cục video"
        meta={selectedTemplate.name}
        className="content-collapsible-panel"
        open={contentSections.isOpen("layout-basics")}
        onToggle={() => contentSections.setSectionOpen("layout-basics", !contentSections.isOpen("layout-basics"))}
      >
      <label className="template-select-field">Bố cục video
        <select value={selectedTemplate.id} onChange={(event) => updateConfig((draft) => {
          const template = PROJECT_TEMPLATES.find((item) => item.id === event.target.value) || PROJECT_TEMPLATES[0];
          draft.template = { id: template.id, name: template.name, version: 1 };
          draft.layout = {
            ...(draft.layout || {}),
            dualCompareSize: clampNumber(draft.layout?.dualCompareSize, 340, 500, LAYOUT.dualCompareSize),
            dualCompareOffsetY: clampNumber(draft.layout?.dualCompareOffsetY, -80, 220, LAYOUT.dualCompareOffsetY),
            photoCompareSize: clampNumber(draft.layout?.photoCompareSize, 340, 500, 390),
            photoCompareOffsetY: clampNumber(draft.layout?.photoCompareOffsetY, -80, 220, 0),
            compareLabelPlacement: COMPARE_LABEL_PLACEMENT_OPTIONS.some((option) => option.id === draft.layout?.compareLabelPlacement)
              ? draft.layout.compareLabelPlacement
              : LAYOUT.compareLabelPlacement,
            compareLabelUppercase: draft.layout?.compareLabelUppercase !== false,
            compareLabelBoxEnabled: draft.layout?.compareLabelBoxEnabled !== false,
            compareLabelAlign: COMPARE_LABEL_ALIGN_OPTIONS.some((option) => option.id === draft.layout?.compareLabelAlign)
              ? draft.layout.compareLabelAlign
              : LAYOUT.compareLabelAlign,
            compareLabelFontSize: clampNumber(draft.layout?.compareLabelFontSize, 0, 96, LAYOUT.compareLabelFontSize),
            compareLabelHeight: clampNumber(draft.layout?.compareLabelHeight, 60, 220, LAYOUT.compareLabelHeight),
            compareLabelPaddingX: clampNumber(draft.layout?.compareLabelPaddingX, 0, 60, LAYOUT.compareLabelPaddingX),
            compareLabelPaddingY: clampNumber(draft.layout?.compareLabelPaddingY, 0, 36, LAYOUT.compareLabelPaddingY),
            compareLabelColor: draft.layout?.compareLabelColor || LAYOUT.compareLabelColor,
            compareLabelBackground: draft.layout?.compareLabelBackground || LAYOUT.compareLabelBackground,
            compareLabelBackgroundOpacity: clampNumber(draft.layout?.compareLabelBackgroundOpacity, 0, 1, LAYOUT.compareLabelBackgroundOpacity),
            compareLabelBorderColor: draft.layout?.compareLabelBorderColor || LAYOUT.compareLabelBorderColor,
            compareLabelBorderWidth: clampNumber(draft.layout?.compareLabelBorderWidth, 0, 10, LAYOUT.compareLabelBorderWidth),
            compareLabelRadius: clampNumber(draft.layout?.compareLabelRadius, 0, 32, LAYOUT.compareLabelRadius),
            compareLabelShadow: COMPARE_LABEL_SHADOW_OPTIONS.some((option) => option.id === draft.layout?.compareLabelShadow)
              ? draft.layout.compareLabelShadow
              : LAYOUT.compareLabelShadow,
            compareVsColor: draft.layout?.compareVsColor || LAYOUT.compareVsColor,
            compareVsTextColor: draft.layout?.compareVsTextColor || LAYOUT.compareVsTextColor,
            compareVsBorderColor: draft.layout?.compareVsBorderColor || LAYOUT.compareVsBorderColor,
            photoFrameBorderColor: draft.layout?.photoFrameBorderColor || LAYOUT.photoFrameBorderColor,
            photoFrameShadowColor: draft.layout?.photoFrameShadowColor || LAYOUT.photoFrameShadowColor,
            photoLabelColor: draft.layout?.photoLabelColor || LAYOUT.photoLabelColor,
            focusScaleLarge: clampNumber(draft.layout?.focusScaleLarge, 1.05, 1.35, LAYOUT.focusScaleLarge),
            focusScaleSmall: clampNumber(draft.layout?.focusScaleSmall, 0.65, 0.98, LAYOUT.focusScaleSmall),
            focusMotionDuration: clampNumber(draft.layout?.focusMotionDuration, 0.25, 1, LAYOUT.focusMotionDuration),
            focusImageBlur: clampNumber(draft.layout?.focusImageBlur, 0, 8, LAYOUT.focusImageBlur),
            focusImageDarkness: clampNumber(draft.layout?.focusImageDarkness, 0, 0.7, LAYOUT.focusImageDarkness),
          };
        })}>
          {PROJECT_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
      </label>
      <label className="template-select-field">Viết hoa Nội dung A/B
        <select value={compareLabelUppercase ? "true" : "false"} onChange={(event) => updateConfig((draft) => {
          draft.layout = {
            ...(draft.layout || {}),
            compareLabelUppercase: event.target.value === "true",
          };
        })}>
          <option value="true">Bật</option>
          <option value="false">Tắt</option>
        </select>
      </label>
      </CollapsibleGroup>
      <CollapsibleGroup
        title="Nhãn A/B"
        meta={`${COMPARE_LABEL_PLACEMENT_OPTIONS.find((option) => option.id === compareLabelPlacement)?.label || "Theo template"} · ${compareLabelAlign === "center" ? "căn giữa" : `căn ${compareLabelAlign}`} `}
        className="compare-label-style-panel"
        open={contentSections.isOpen("compare-label-style")}
        onToggle={() => contentSections.setSectionOpen("compare-label-style", !contentSections.isOpen("compare-label-style"))}
      >
        <p className="compare-label-style-hint">Chỉnh chữ A/B và cách hiển thị trên ảnh. Tắt “Khung nhãn A/B” nếu muốn chữ không có hộp nền/viền.</p>
        <div className="compare-label-control-grid">
          <label>Vị trí
            <select value={compareLabelPlacement} onChange={(event) => updateConfig((draft) => {
              draft.layout = { ...(draft.layout || {}), compareLabelPlacement: event.target.value };
            })}>
              {COMPARE_LABEL_PLACEMENT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <label>Căn chữ
            <select value={compareLabelAlign} onChange={(event) => updateConfig((draft) => {
              draft.layout = { ...(draft.layout || {}), compareLabelAlign: event.target.value };
            })}>
              {COMPARE_LABEL_ALIGN_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <label>Khung nhãn A/B
            <select value={compareLabelBoxEnabled ? "true" : "false"} onChange={(event) => updateConfig((draft) => {
              draft.layout = { ...(draft.layout || {}), compareLabelBoxEnabled: event.target.value === "true" };
            })}>
              <option value="false">Tắt</option>
              <option value="true">Bật</option>
            </select>
          </label>
          <label>Màu chữ<input type="color" value={compareLabelColor} onChange={(event) => updateConfig((draft) => {
            draft.layout = {
              ...(draft.layout || {}),
              compareLabelColor: event.target.value,
              photoLabelColor: event.target.value,
            };
          })} /></label>
          <label className={!compareLabelBoxEnabled ? "is-disabled" : ""}>Màu nền
            <input type="color" disabled={!compareLabelBoxEnabled} value={compareLabelBackground} onChange={(event) => updateConfig((draft) => { draft.layout = { ...(draft.layout || {}), compareLabelBackground: event.target.value }; })} />
          </label>
          <label className={`compare-label-color-field ${!compareLabelBoxEnabled ? "is-disabled" : ""}`}>Màu viền
            <input type="color" disabled={!compareLabelBoxEnabled} value={compareLabelBorderColor} onChange={(event) => updateConfig((draft) => { draft.layout = { ...(draft.layout || {}), compareLabelBorderColor: event.target.value }; })} />
          </label>
          <label className={!compareLabelBoxEnabled ? "is-disabled" : ""}>Bóng
            <select disabled={!compareLabelBoxEnabled} value={compareLabelShadow} onChange={(event) => updateConfig((draft) => { draft.layout = { ...(draft.layout || {}), compareLabelShadow: event.target.value }; })}>
              {COMPARE_LABEL_SHADOW_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <div className="compare-label-range-grid">
          <label className="photo-size-field">
            <span>Cỡ chữ</span>
            <strong>{compareLabelFontSize > 0 ? `${Math.round(compareLabelFontSize)} px` : "Tự động"}</strong>
            <input type="range" min="0" max="72" step="1" value={compareLabelFontSize} onChange={(event) => updateConfig((draft) => { draft.layout = { ...(draft.layout || {}), compareLabelFontSize: clampNumber(event.target.value, 0, 96, 0) }; })} />
          </label>
          <label className="photo-size-field">
            <span>Chiều cao vùng chữ</span>
            <strong>{Math.round(compareLabelHeight)} px</strong>
            <input type="range" min="60" max="220" step="4" value={compareLabelHeight} onChange={(event) => updateConfig((draft) => { draft.layout = { ...(draft.layout || {}), compareLabelHeight: clampNumber(event.target.value, 60, 220, 110) }; })} />
          </label>
          <label className="photo-size-field">
            <span>Đệm ngang</span>
            <strong>{Math.round(compareLabelPaddingX)} px</strong>
            <input type="range" min="0" max="60" step="2" value={compareLabelPaddingX} onChange={(event) => updateConfig((draft) => { draft.layout = { ...(draft.layout || {}), compareLabelPaddingX: clampNumber(event.target.value, 0, 60, 18) }; })} />
          </label>
          <label className="photo-size-field">
            <span>Đệm dọc</span>
            <strong>{Math.round(compareLabelPaddingY)} px</strong>
            <input type="range" min="0" max="36" step="2" value={compareLabelPaddingY} onChange={(event) => updateConfig((draft) => { draft.layout = { ...(draft.layout || {}), compareLabelPaddingY: clampNumber(event.target.value, 0, 36, 10) }; })} />
          </label>
          <label className={`photo-size-field ${!compareLabelBoxEnabled ? "is-disabled" : ""}`}>
            <span>Độ trong màu nền</span>
            <strong>{Math.round(compareLabelBackgroundOpacity * 100)}%</strong>
            <input disabled={!compareLabelBoxEnabled} type="range" min="0" max="1" step="0.05" value={compareLabelBackgroundOpacity} onChange={(event) => updateConfig((draft) => { draft.layout = { ...(draft.layout || {}), compareLabelBackgroundOpacity: clampNumber(event.target.value, 0, 1, 0) }; })} />
          </label>
          <label className={`photo-size-field ${!compareLabelBoxEnabled ? "is-disabled" : ""}`}>
            <span>Độ dày viền</span>
            <strong>{Math.round(compareLabelBorderWidth)} px</strong>
            <input disabled={!compareLabelBoxEnabled} type="range" min="0" max="10" step="1" value={compareLabelBorderWidth} onChange={(event) => updateConfig((draft) => { draft.layout = { ...(draft.layout || {}), compareLabelBorderWidth: clampNumber(event.target.value, 0, 10, 0) }; })} />
          </label>
          <label className={`photo-size-field ${!compareLabelBoxEnabled ? "is-disabled" : ""}`}>
            <span>Bo góc</span>
            <strong>{Math.round(compareLabelRadius)} px</strong>
            <input disabled={!compareLabelBoxEnabled} type="range" min="0" max="32" step="2" value={compareLabelRadius} onChange={(event) => updateConfig((draft) => { draft.layout = { ...(draft.layout || {}), compareLabelRadius: clampNumber(event.target.value, 0, 32, 0) }; })} />
          </label>
        </div>
        {isFramedPhotoTemplate ? (
          <div className="compare-label-frame-colors">
            <div className="compare-label-frame-title">
              <strong>Màu khung ảnh</strong>
              <span>Áp dụng cho viền và bóng của ảnh A/B.</span>
            </div>
            <div className="layout-color-grid">
              <label>Viền khung<input type="color" value={photoFrameBorderColor} onChange={(event) => updateConfig((draft) => { draft.layout = { ...(draft.layout || {}), photoFrameBorderColor: event.target.value }; })} /></label>
              <label>Bóng khung<input type="color" value={photoFrameShadowColor} onChange={(event) => updateConfig((draft) => { draft.layout = { ...(draft.layout || {}), photoFrameShadowColor: event.target.value }; })} /></label>
            </div>
          </div>
        ) : null}
      </CollapsibleGroup>
      {showVsControls ? (
        <CollapsibleGroup
          title="Màu VS"
          meta="Áp dụng cho template đang có VS"
          className="layout-color-panel"
          open={contentSections.isOpen("vs-colors")}
          onToggle={() => contentSections.setSectionOpen("vs-colors", !contentSections.isOpen("vs-colors"))}
        >
          <div className="layout-color-grid">
            <label>Màu nền<input type="color" value={compareVsColor} onChange={(event) => updateConfig((draft) => { draft.layout = { ...(draft.layout || {}), compareVsColor: event.target.value }; })} /></label>
            <label>Màu chữ<input type="color" value={compareVsTextColor} onChange={(event) => updateConfig((draft) => { draft.layout = { ...(draft.layout || {}), compareVsTextColor: event.target.value }; })} /></label>
            <label>Màu viền<input type="color" value={compareVsBorderColor} onChange={(event) => updateConfig((draft) => { draft.layout = { ...(draft.layout || {}), compareVsBorderColor: event.target.value }; })} /></label>
          </div>
        </CollapsibleGroup>
      ) : null}
      {isAdjustableCompareTemplate ? (
        <CollapsibleGroup
          title="Cỡ và vị trí ảnh A/B"
          meta={`${Math.round(compareSizeControlValue)} px · ${compareOffsetControlValue > 0 ? "+" : ""}${Math.round(compareOffsetControlValue)} px`}
          className="content-collapsible-panel"
          open={contentSections.isOpen("image-sizing")}
          onToggle={() => contentSections.setSectionOpen("image-sizing", !contentSections.isOpen("image-sizing"))}
        >
        <label className="photo-size-field">
          <span>Cỡ ảnh A/B</span>
          <strong>{Math.round(compareSizeControlValue)} px</strong>
          <input
            type="range"
            min="340"
            max="500"
            step="10"
            value={compareSizeControlValue}
            onChange={(event) => updateConfig((draft) => {
              draft.layout = { ...(draft.layout || {}), [compareSizeLayoutKey]: clampNumber(event.target.value, 340, 500, compareSizeControlValue) };
            })}
          />
        </label>
        <label className="photo-size-field">
          <span>Dịch ảnh A/B xuống</span>
          <strong>{compareOffsetControlValue > 0 ? "+" : ""}{Math.round(compareOffsetControlValue)} px</strong>
          <input
            type="range"
            min="-80"
            max="220"
            step="10"
            value={compareOffsetControlValue}
            onChange={(event) => updateConfig((draft) => {
              draft.layout = { ...(draft.layout || {}), [compareOffsetLayoutKey]: clampNumber(event.target.value, -80, 220, compareOffsetControlValue) };
            })}
          />
        </label>
        </CollapsibleGroup>
      ) : null}
      {isFocusScaleTemplate ? (
        <CollapsibleGroup
          title="Focus ảnh"
          meta={`${Math.round(focusScaleLarge * 100)}% / ${Math.round(focusScaleSmall * 100)}%`}
          className="content-collapsible-panel"
          open={contentSections.isOpen("focus-motion")}
          onToggle={() => contentSections.setSectionOpen("focus-motion", !contentSections.isOpen("focus-motion"))}
        >
        <label className="photo-size-field">
          <span>Ảnh đang trỏ phóng</span>
          <strong>{Math.round(focusScaleLarge * 100)}%</strong>
          <input
            type="range"
            min="1.05"
            max="1.35"
            step="0.01"
            value={focusScaleLarge}
            onChange={(event) => updateConfig((draft) => {
              draft.layout = { ...(draft.layout || {}), focusScaleLarge: clampNumber(event.target.value, 1.05, 1.35, focusScaleLarge) };
            })}
          />
        </label>
        <label className="photo-size-field">
          <span>Ảnh còn lại thu nhỏ</span>
          <strong>{Math.round(focusScaleSmall * 100)}%</strong>
          <input
            type="range"
            min="0.65"
            max="0.98"
            step="0.01"
            value={focusScaleSmall}
            onChange={(event) => updateConfig((draft) => {
              draft.layout = { ...(draft.layout || {}), focusScaleSmall: clampNumber(event.target.value, 0.65, 0.98, focusScaleSmall) };
            })}
          />
        </label>
        <label className="photo-size-field">
          <span>Độ mượt chuyển cảnh</span>
          <strong>{focusMotionDuration.toFixed(2)}s</strong>
          <input
            type="range"
            min="0.25"
            max="1"
            step="0.05"
            value={focusMotionDuration}
            onChange={(event) => updateConfig((draft) => {
              draft.layout = { ...(draft.layout || {}), focusMotionDuration: clampNumber(event.target.value, 0.25, 1, focusMotionDuration) };
            })}
          />
        </label>
        <label className="photo-size-field">
          <span>Độ mờ ảnh phụ</span>
          <strong>{focusImageBlur.toFixed(1)} px</strong>
          <input
            type="range"
            min="0"
            max="8"
            step="0.5"
            value={focusImageBlur}
            onChange={(event) => updateConfig((draft) => {
              draft.layout = { ...(draft.layout || {}), focusImageBlur: clampNumber(event.target.value, 0, 8, focusImageBlur) };
            })}
          />
        </label>
        <label className="photo-size-field">
          <span>Độ tối ảnh phụ</span>
          <strong>{Math.round(focusImageDarkness * 100)}%</strong>
          <input
            type="range"
            min="0"
            max="0.7"
            step="0.05"
            value={focusImageDarkness}
            onChange={(event) => updateConfig((draft) => {
              draft.layout = { ...(draft.layout || {}), focusImageDarkness: clampNumber(event.target.value, 0, 0.7, focusImageDarkness) };
            })}
          />
        </label>
        </CollapsibleGroup>
      ) : null}
      <CollapsibleGroup
        title="AI tạo ảnh"
        meta="Minh họa từng ô Nội dung A/B"
        className="ai-illustration-panel"
        open={contentSections.isOpen("ai-illustrations")}
        onToggle={() => contentSections.setSectionOpen("ai-illustrations", !contentSections.isOpen("ai-illustrations"))}
      >
        <label>Provider
          <select value={aiImageProvider} onChange={(event) => setAiImageProvider(event.target.value)}>
            {AI_IMAGE_PROVIDER_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>Style
          <select value={aiImageStyle} onChange={(event) => setAiImageStyle(event.target.value)}>
            {AI_IMAGE_STYLE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>Biến thể
          <select value={aiImageVariants} onChange={(event) => setAiImageVariants(Number(event.target.value) || 1)}>
            {AI_IMAGE_VARIANT_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <button
          type="button"
          className="ai-generate-all"
          disabled={busy || allAiSlotsBusy || !generateAllIllustrations}
          onClick={() => generateAllIllustrations?.()}
        >
          <Wand2 size={15} /> AI tạo tất cả
        </button>
      </CollapsibleGroup>
      {false ? (
      <section className="comparison-editor">
        <h3>So sánh 1</h3>
        <div className="compare-label-grid">
          <label className="compare-label-field a">Nội dung A<input value={config.compare.leftLabel} onChange={(event) => updateConfig((draft) => { draft.compare.leftLabel = event.target.value; draft.leftLabel = event.target.value; })} /></label>
          <label className="compare-label-field b">Nội dung B<input value={config.compare.rightLabel} onChange={(event) => updateConfig((draft) => { draft.compare.rightLabel = event.target.value; draft.rightLabel = event.target.value; })} /></label>
        </div>
        <div className="compare-asset-grid">
          <ImageAssetSlot
            side="left"
            square={isPhotoTemplate}
            title="Ảnh bên trái"
            source={leftImage}
            zoom={config.compare.leftZoom}
            crop={config.compare.leftCrop}
            disabled={busy}
            onUpload={(event) => uploadProjectAsset("compare-left", event)}
            onZoom={(value, nextCrop) => updateConfig((draft) => { applyCompareSlotZoom(draft.compare, "left", value, nextCrop); })}
            onPosition={(axis, value, nextCrop) => updateConfig((draft) => { applyCompareSlotPosition(draft.compare, "left", axis, value, nextCrop); })}
            onCrop={() => setCropTarget({ side: "left", title: "Ảnh bên trái", source: leftImage, square: isPhotoTemplate })}
            onReset={() => updateConfig((draft) => { draft.compare.leftZoom = 1; draft.compare.leftCrop = { x: 0, y: 0, rotation: 0 }; })}
          />
          <ImageAssetSlot
            side="right"
            square={isPhotoTemplate}
            title="Ảnh bên phải"
            source={rightImage}
            zoom={config.compare.rightZoom}
            crop={config.compare.rightCrop}
            disabled={busy}
            onUpload={(event) => uploadProjectAsset("compare-right", event)}
            onZoom={(value, nextCrop) => updateConfig((draft) => { applyCompareSlotZoom(draft.compare, "right", value, nextCrop); })}
            onPosition={(axis, value, nextCrop) => updateConfig((draft) => { applyCompareSlotPosition(draft.compare, "right", axis, value, nextCrop); })}
            onCrop={() => setCropTarget({ side: "right", title: "Ảnh bên phải", source: rightImage, square: isPhotoTemplate })}
            onReset={() => updateConfig((draft) => { draft.compare.rightZoom = 1; draft.compare.rightCrop = { x: 0, y: 0, rotation: 0 }; })}
          />
        </div>
      </section>
      ) : null}
      {compareSets.map((set) => {
        const leftImageForSet = versionedVideoUrl(config.slug, set.leftImage, config.assetRevision);
        const rightImageForSet = versionedVideoUrl(config.slug, set.rightImage, config.assetRevision);
        const setAiBusy = set.aiImages?.left?.state === "processing" || set.aiImages?.right?.state === "processing";
        const updateSet = (draft, updater) => {
          const sets = ensureCompareSets(draft);
          const index = sets.findIndex((item) => item.id === set.id);
          const target = sets[index >= 0 ? index : 0];
          updater(target);
          if (target.id === "compare-1") {
            draft.compare = { ...target };
            draft.leftLabel = target.leftLabel;
            draft.rightLabel = target.rightLabel;
          }
        };
        return (
          <CollapsibleGroup
            key={set.id}
            title={compareSetTitle(set.id)}
            meta={`${set.leftLabel || "Nội dung A"} / ${set.rightLabel || "Nội dung B"}`}
             className="comparison-editor comparison-editor-collapsible"
             open={contentSections.isOpen(`compare-${set.id}`)}
             onToggle={() => contentSections.setSectionOpen(`compare-${set.id}`, !contentSections.isOpen(`compare-${set.id}`))}
             compact={
               <CompareCompactPreview
                 set={set}
                 leftSource={leftImageForSet}
                 rightSource={rightImageForSet}
                 imageAspect={cropAspect}
                  labelUppercase={compareLabelUppercase}
                  labelPlacement={resolveCompareLabelPlacement(compareLabelPlacement, selectedTemplate.id)}
                  labelAlign={compareLabelAlign}
                  labelBoxEnabled={compareLabelBoxEnabled}
                  frameBorderColor={isFramedPhotoTemplate ? photoFrameBorderColor : ""}
                 frameShadowColor={isFramedPhotoTemplate ? photoFrameShadowColor : ""}
                 labelColor={isFramedPhotoTemplate ? compareLabelColor : ""}
               />
             }
             actions={
              <div className="comparison-editor-actions">
                <button
                  type="button"
                  className="compare-label-clear"
                  disabled={busy || (!set.leftLabel && !set.rightLabel)}
                  onClick={() => updateConfig((draft) => updateSet(draft, (target) => {
                    target.leftLabel = "";
                    target.rightLabel = "";
                  }))}
                  title="Xóa nhãn A/B để nhập lại"
                >
                  <X size={15} /> Xóa A/B
                </button>
                <button
                  type="button"
                  className="ai-generate-pair"
                  disabled={busy || setAiBusy || !generateIllustrations}
                  onClick={() => generateIllustrations?.(set.id, ["left", "right"])}
                >
                  <Wand2 size={15} /> AI tạo ảnh A/B
                </button>
              </div>
            }
          >
            <div className="compare-label-grid">
              <label className="compare-label-field a">Nội dung A<input value={set.leftLabel} onChange={(event) => updateConfig((draft) => updateSet(draft, (target) => { target.leftLabel = event.target.value; }))} /></label>
              <label className="compare-label-field b">Nội dung B<input value={set.rightLabel} onChange={(event) => updateConfig((draft) => updateSet(draft, (target) => { target.rightLabel = event.target.value; }))} /></label>
            </div>
            <div className="compare-asset-grid">
              <ImageAssetSlot
                side="left"
                square={isPhotoTemplate}
                title={`Ảnh A ${compareSetLabel(set.id)}`}
                source={leftImageForSet}
                zoom={set.leftZoom}
                crop={set.leftCrop}
                imageAspect={cropAspect}
                verticalCard={useVerticalCardPreview}
                previewLabel={set.leftLabel}
                 labelUppercase={compareLabelUppercase}
                 frameBorderColor={isFramedPhotoTemplate ? photoFrameBorderColor : ""}
                 frameShadowColor={isFramedPhotoTemplate ? photoFrameShadowColor : ""}
                 labelColor={isFramedPhotoTemplate ? compareLabelColor : ""}
                slug={config.slug}
                assetRevision={config.assetRevision}
                aiStatus={set.aiImages?.left}
                disabled={busy}
                onUpload={(event) => uploadProjectAsset(`${set.id}-left`, event)}
                onAiGenerate={() => generateIllustrations?.(set.id, ["left"])}
                onAiCancel={() => cancelAiSlot(set, "left")}
                onSelectAiVariant={(variant) => selectIllustrationVariant?.(set.id, "left", variant)}
                onZoom={(value, nextCrop) => updateConfig((draft) => updateSet(draft, (target) => { applyCompareSlotZoom(target, "left", value, nextCrop); }))}
                onPosition={(axis, value, nextCrop) => updateConfig((draft) => updateSet(draft, (target) => { applyCompareSlotPosition(target, "left", axis, value, nextCrop); }))}
                onCrop={() => setCropTarget({ setId: set.id, side: "left", title: `Ảnh A ${compareSetLabel(set.id)}`, source: leftImageForSet, square: isPhotoTemplate, aspect: cropAspect, outputSize: cropOutputSize })}
                onReset={() => updateConfig((draft) => updateSet(draft, (target) => { target.leftZoom = 1; target.leftCrop = { x: 0, y: 0, rotation: 0 }; }))}
              />
              <ImageAssetSlot
                side="right"
                square={isPhotoTemplate}
                title={`Ảnh B ${compareSetLabel(set.id)}`}
                source={rightImageForSet}
                zoom={set.rightZoom}
                crop={set.rightCrop}
                imageAspect={cropAspect}
                verticalCard={useVerticalCardPreview}
                previewLabel={set.rightLabel}
                 labelUppercase={compareLabelUppercase}
                 frameBorderColor={isFramedPhotoTemplate ? photoFrameBorderColor : ""}
                 frameShadowColor={isFramedPhotoTemplate ? photoFrameShadowColor : ""}
                 labelColor={isFramedPhotoTemplate ? compareLabelColor : ""}
                slug={config.slug}
                assetRevision={config.assetRevision}
                aiStatus={set.aiImages?.right}
                disabled={busy}
                onUpload={(event) => uploadProjectAsset(`${set.id}-right`, event)}
                onAiGenerate={() => generateIllustrations?.(set.id, ["right"])}
                onAiCancel={() => cancelAiSlot(set, "right")}
                onSelectAiVariant={(variant) => selectIllustrationVariant?.(set.id, "right", variant)}
                onZoom={(value, nextCrop) => updateConfig((draft) => updateSet(draft, (target) => { applyCompareSlotZoom(target, "right", value, nextCrop); }))}
                onPosition={(axis, value, nextCrop) => updateConfig((draft) => updateSet(draft, (target) => { applyCompareSlotPosition(target, "right", axis, value, nextCrop); }))}
                onCrop={() => setCropTarget({ setId: set.id, side: "right", title: `Ảnh B ${compareSetLabel(set.id)}`, source: rightImageForSet, square: isPhotoTemplate, aspect: cropAspect, outputSize: cropOutputSize })}
                onReset={() => updateConfig((draft) => updateSet(draft, (target) => { target.rightZoom = 1; target.rightCrop = { x: 0, y: 0, rotation: 0 }; }))}
              />
            </div>
          </CollapsibleGroup>
        );
      })}
      {cropTarget ? (
        <CropModal
          title={cropTarget.title}
          source={cropTarget.source}
          square={cropTarget.square}
          aspect={cropTarget.aspect || cropAspect}
          outputSize={cropTarget.outputSize}
          zoom={(compareSets.find((set) => set.id === cropTarget.setId) || compareSets[0])?.[`${cropTarget.side}Zoom`]}
          crop={(compareSets.find((set) => set.id === cropTarget.setId) || compareSets[0])?.[`${cropTarget.side}Crop`]}
          onClose={() => setCropTarget(null)}
          onApply={({ zoom, crop }) => {
            updateConfig((draft) => {
              const sets = ensureCompareSets(draft);
              const index = sets.findIndex((set) => set.id === cropTarget.setId);
              const target = sets[index >= 0 ? index : 0];
              target[`${cropTarget.side}Zoom`] = zoom;
              target[`${cropTarget.side}Crop`] = crop;
              if (target.id === "compare-1") {
                draft.compare = { ...target };
                draft.leftLabel = target.leftLabel;
                draft.rightLabel = target.rightLabel;
              }
            });
            setCropTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ImageAssetSlot({
  side,
  title,
  source,
  zoom,
  crop,
  imageAspect = 1,
  square = false,
  verticalCard = false,
  previewLabel = "",
  labelUppercase = true,
  frameBorderColor = "",
  frameShadowColor = "",
  labelColor = "",
  slug = "",
  assetRevision,
  aiStatus,
  disabled,
  onUpload,
  onAiGenerate,
  onAiCancel,
  onSelectAiVariant,
  onZoom,
  onPosition,
  onCrop,
  onReset,
}) {
  const zoomValue = clampNumber(zoom, 0.7, 1.7, 1);
  const regionMode = isRegionCrop(crop);
  const slotZoomValue = regionMode ? regionDisplayZoom(crop) : zoomValue;
  const cropX = regionMode ? regionAxisOffsetPercent(crop, "x") : clampNumber(crop?.x, -45, 45, 0);
  const cropY = regionMode ? regionAxisOffsetPercent(crop, "y") : clampNumber(crop?.y, -45, 45, 0);
  const percentage = `${Math.round(slotZoomValue * 100)}%`;
  const imageStyle = cropImageStyle(zoomValue, crop);
  const labelText = String(previewLabel || title || "").trim();
  const displayLabel = labelUppercase ? labelText.toLocaleUpperCase("vi-VN") : labelText;
  const zoomMin = regionMode ? 1 : 0.7;
  const zoomMax = regionMode ? 5 : 1.7;
  const updateSlotZoom = (rawValue) => {
    const nextValue = clampNumber(rawValue, zoomMin, zoomMax, slotZoomValue);
    if (regionMode) {
      onZoom?.(1, regionForDisplayZoom(crop, nextValue));
      return;
    }
    onZoom?.(nextValue);
  };
  const updateSlotPosition = (axis, rawValue) => {
    const nextValue = clampNumber(rawValue, -45, 45, axis === "y" ? cropY : cropX);
    if (regionMode) {
      onPosition?.(axis, nextValue, regionForAxisOffset(crop, axis, nextValue));
      return;
    }
    onPosition?.(axis, nextValue);
  };
  const styleVars = {
    ...(frameBorderColor ? { "--slot-frame-color": frameBorderColor } : {}),
    ...(frameShadowColor ? { "--slot-shadow-color": frameShadowColor } : {}),
    ...(labelColor ? { "--slot-label-color": labelColor } : {}),
    "--slot-image-aspect": Number(imageAspect) > 0 ? Number(imageAspect) : 1,
  };
  const aiState = aiStatus?.state || "empty";
  const aiBusy = aiState === "processing";
  const aiVariants = Array.isArray(aiStatus?.variants) ? aiStatus.variants.filter(Boolean) : [];
  const selectedAiVariant = Number(aiStatus?.selectedVariant) || 0;
  const aiStateLabel = aiState === "processing"
    ? "Đang tạo"
    : aiState === "ready"
      ? "Sẵn sàng"
      : aiState === "error"
        ? "Lỗi"
        : aiState === "cancelled"
          ? "Đã dừng"
          : "Chưa tạo";
  return (
    <section className={`image-asset-slot ${side} ${square ? "square" : ""} ${verticalCard ? "vertical-card" : ""}`} style={styleVars}>
      <label className={`image-dropzone ${source ? "filled" : ""}`}>
        <input className="asset-slot-input" disabled={disabled} type="file" accept={IMAGE_FILE_ACCEPT} onChange={onUpload} />
        {source ? (
          verticalCard ? (
            <div className="asset-card-preview">
              <div className="asset-image-crop"><img src={source} alt={title} style={imageStyle} /></div>
              <strong className="asset-card-label">{displayLabel}</strong>
            </div>
          ) : (
            <div className="asset-image-crop"><img src={source} alt={title} style={imageStyle} /></div>
          )
        ) : (
          <div className="asset-empty"><span><Plus size={30} /></span><strong>{title}</strong></div>
        )}
      </label>
      <div className="zoom-control">
        <strong>{regionMode ? "Zoom vùng crop" : "Zoom"} <span>{percentage}</span></strong>
        <input aria-label={`Zoom ${title}`} type="range" min={zoomMin} max={zoomMax} step="0.01" value={slotZoomValue} onChange={(event) => updateSlotZoom(event.target.value)} />
      </div>
      <div className="image-position-controls">
        <label>Ngang <input aria-label={`Dịch ngang ${title}`} type="range" min="-45" max="45" step="1" value={cropX} onChange={(event) => updateSlotPosition("x", event.target.value)} /></label>
        <label>Dọc <input aria-label={`Dịch dọc ${title}`} type="range" min="-45" max="45" step="1" value={cropY} onChange={(event) => updateSlotPosition("y", event.target.value)} /></label>
      </div>
      <div className="asset-slot-actions">
        <label className="slot-upload"><UploadCloud size={15} /> {source ? "Thay ảnh" : "Chọn ảnh"}<input disabled={disabled} type="file" accept="image/*" onChange={onUpload} /></label>
        <button type="button" disabled={!source} onClick={onCrop}><Crop size={15} /> Crop / xoay</button>
        <button type="button" onClick={onReset}><RotateCcw size={15} /> Đặt lại</button>
      </div>
      <div className="ai-slot-tools">
        {aiBusy ? (
          <button type="button" className="cancel" disabled={!onAiCancel} onClick={onAiCancel}>
            <X size={15} /> Dừng AI
          </button>
        ) : (
          <button type="button" disabled={disabled || !onAiGenerate} onClick={onAiGenerate}>
            <Wand2 size={15} /> {source ? "Tạo lại AI" : "AI tạo ảnh"}
          </button>
        )}
        <span className={`ai-slot-status ${aiState}`}>{aiStateLabel}</span>
      </div>
      {!aiBusy && aiVariants.length ? (
        <div className="ai-variant-gallery">
          {aiVariants.map((rel, index) => {
            const variantNumber = index + 1;
            const variantUrl = slug ? versionedVideoUrl(slug, rel, assetRevision) : rel;
            return (
              <button
                type="button"
                key={`${rel}-${variantNumber}`}
                className={selectedAiVariant === variantNumber ? "active" : ""}
                disabled={disabled || aiBusy || !onSelectAiVariant}
                onClick={() => onSelectAiVariant?.(variantNumber)}
              >
                <img src={variantUrl} alt={`Variant ${variantNumber} ${title}`} />
                <span>V{variantNumber}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {aiStatus?.error ? <div className="ai-slot-error">{aiStatus.error}</div> : null}
    </section>
  );
}

function CropModal({ title, source, square = false, aspect = 1, outputSize, zoom, crop, onClose, onApply }) {
  const dialogRef = useRef(null);
  const stageRef = useRef(null);
  const activeDragRef = useRef(null);
  const targetAspect = Number(aspect) > 0 ? Number(aspect) : cropAspectForTemplate("", square);
  const aspectLabel = cropAspectLabel(targetAspect);
  const [naturalSize, setNaturalSize] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState(() => ({
    zoom: 1,
    crop: isRegionCrop(crop)
      ? crop
      : { x: 0, y: 0, rotation: finiteNumber(crop?.rotation, 0) },
  }));
  useDialogFocus(dialogRef, onClose);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return undefined;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setStageSize({ width: rect.width, height: rect.height });
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!naturalSize) return;
    const nextCrop = regionCropFrom(zoom, crop, naturalSize, targetAspect);
    setDraft({
      zoom: regionZoomValue(nextCrop, naturalSize, targetAspect),
      crop: nextCrop,
    });
  }, [source, naturalSize, targetAspect, zoom, crop]);

  const region = naturalSize
    ? regionCropFrom(draft.zoom, draft.crop, naturalSize, targetAspect)
    : null;
  const imageRect = containedImageRect(stageSize, naturalSize);
  const zoomValue = region ? regionZoomValue(region, naturalSize, targetAspect) : 1;
  const cropBoxStyle = region ? {
    left: imageRect.left + region.x * imageRect.width,
    top: imageRect.top + region.y * imageRect.height,
    width: region.width * imageRect.width,
    height: region.height * imageRect.height,
  } : {};
  const stageStyle = {
    "--crop-stage-aspect": naturalSize ? imageAspectFromNatural(naturalSize) : targetAspect,
  };
  const outputWidth = region && naturalSize ? Math.round(region.width * naturalSize.width) : 0;
  const outputHeight = region && naturalSize ? Math.round(region.height * naturalSize.height) : 0;
  const frameOutputWidth = Math.round(finiteNumber(outputSize?.width, 0));
  const frameOutputHeight = Math.round(finiteNumber(outputSize?.height, 0));
  const portraitModal = naturalSize ? imageAspectFromNatural(naturalSize) < 0.85 : false;
  const xTravel = region ? Math.max(0, 1 - region.width) : 0;
  const yTravel = region ? Math.max(0, 1 - region.height) : 0;
  const xPercent = region && xTravel > 0.0001 ? Math.round((region.x / xTravel) * 100) : 0;
  const yPercent = region && yTravel > 0.0001 ? Math.round((region.y / yTravel) * 100) : 0;

  const pointerToUnit = (event) => {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage || !naturalSize) return { x: 0, y: 0 };
    const rect = containedImageRect({ width: stage.width, height: stage.height }, naturalSize);
    return {
      x: clampNumber((event.clientX - stage.left - rect.left) / Math.max(1, rect.width), 0, 1, 0),
      y: clampNumber((event.clientY - stage.top - rect.top) / Math.max(1, rect.height), 0, 1, 0),
    };
  };

  const updateRegion = (nextRegion) => {
    const nextCrop = clampRegionToImage(nextRegion, naturalSize, targetAspect);
    setDraft({
      zoom: regionZoomValue(nextCrop, naturalSize, targetAspect),
      crop: nextCrop,
    });
  };

  const moveRegionToPointer = (event) => {
    if (!region || !naturalSize) return;
    const point = pointerToUnit(event);
    updateRegion({
      ...region,
      x: point.x - region.width / 2,
      y: point.y - region.height / 2,
    });
  };

  const startDrag = (event, action, corner = "se") => {
    if (!region || !naturalSize) return;
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent?.stopImmediatePropagation?.();
    const captureTarget = event.currentTarget;
    captureTarget?.setPointerCapture?.(event.pointerId);
    const startPoint = pointerToUnit(event);
    const startRegion = region;
    const move = (moveEvent) => {
      moveEvent.preventDefault();
      const point = pointerToUnit(moveEvent);
      if (action === "move") {
        updateRegion({
          ...startRegion,
          x: startRegion.x + point.x - startPoint.x,
          y: startRegion.y + point.y - startPoint.y,
        });
        return;
      }
      updateRegion(resizeRegionFromCorner(startRegion, point, corner, naturalSize, targetAspect));
    };
    const stop = () => {
      if (activeDragRef.current?.pointerId !== event.pointerId) return;
      activeDragRef.current = null;
      try {
        captureTarget?.releasePointerCapture?.(event.pointerId);
      } catch {
        // Pointer capture can already be released if the browser cancels the gesture.
      }
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", stop, true);
      window.removeEventListener("pointercancel", stop, true);
      captureTarget?.removeEventListener?.("lostpointercapture", stop);
    };
    activeDragRef.current = { pointerId: event.pointerId, stop };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", stop, true);
    window.addEventListener("pointercancel", stop, true);
    captureTarget?.addEventListener?.("lostpointercapture", stop, { once: true });
  };

  const setZoomValue = (value) => {
    if (!region || !naturalSize) return;
    const nextCrop = regionForZoom(region, value, naturalSize, targetAspect);
    setDraft({
      zoom: regionZoomValue(nextCrop, naturalSize, targetAspect),
      crop: nextCrop,
    });
  };

  const setAxisValue = (axis, value) => {
    if (!region || !naturalSize) return;
    const travel = axis === "y" ? yTravel : xTravel;
    const nextOrigin = travel <= 0.0001 ? 0 : (clampNumber(value, 0, 100, 0) / 100) * travel;
    updateRegion({
      ...region,
      [axis]: nextOrigin,
    });
  };

  const nudgeRegion = (event) => {
    if (!region || !naturalSize || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.05 : 0.01;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    updateRegion({
      ...region,
      x: region.x + dx,
      y: region.y + dy,
    });
  };

  const rotateBy = (delta) => {
    setDraft((current) => ({
      ...current,
      crop: { ...current.crop, rotation: (finiteNumber(current.crop?.rotation, 0) + delta + 360) % 360 },
    }));
  };

  const resetRegion = () => {
    if (!naturalSize) return;
    const nextCrop = defaultRegionCrop(naturalSize, targetAspect);
    setDraft({ zoom: 1, crop: nextCrop });
  };

  const centerCurrentRegion = () => {
    if (!region || !naturalSize) return;
    const nextCrop = centeredRegion(region, naturalSize, targetAspect);
    setDraft({
      zoom: regionZoomValue(nextCrop, naturalSize, targetAspect),
      crop: nextCrop,
    });
  };

  const applyRegion = () => {
    if (!region || !naturalSize) return;
    onApply({ zoom: 1, crop: clampRegionToImage(region, naturalSize, targetAspect) });
  };

  useEffect(() => () => {
    activeDragRef.current?.stop?.();
  }, []);

  return (
    <div className="crop-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className={`crop-modal region-crop-modal ${portraitModal ? "portrait-crop-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="crop-dialog-title">
        <div className="crop-modal-head">
          <div>
            <span className="eyebrow">Cắt / xoay ảnh</span>
            <h2 id="crop-dialog-title">Chọn vùng muốn giữ</h2>
            <p>{title} · Tỷ lệ khung {aspectLabel}</p>
          </div>
          <button type="button" className="icon-close" data-dialog-initial title="Đóng" aria-label="Đóng crop ảnh" onClick={onClose}>×</button>
        </div>

        <div
          className="crop-region-stage"
          ref={stageRef}
          style={stageStyle}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) moveRegionToPointer(event);
          }}
        >
          <img
            className="crop-region-image"
            src={source}
            alt={title}
            draggable="false"
            onLoad={(event) => {
              const img = event.currentTarget;
              setNaturalSize({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
            }}
          />
          {region && imageRect.width > 0 ? (
            <div
              className="crop-region-box"
              style={cropBoxStyle}
              role="slider"
              tabIndex={0}
              aria-label="Vung crop anh"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={xPercent}
              title="Keo de doi vung giu. Dung phim mui ten de dich vung."
              onPointerDown={(event) => startDrag(event, "move")}
              onKeyDown={nudgeRegion}
            >
              <div className="crop-region-grid" />
              {["nw", "ne", "sw", "se"].map((corner) => (
                <button
                  type="button"
                  key={corner}
                  className={`crop-region-handle ${corner}`}
                  aria-label={`Resize ${corner}`}
                  onPointerDown={(event) => startDrag(event, "resize", corner)}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="crop-controls region-crop-controls">
          <label>Zoom <strong>{Math.round(zoomValue * 100)}%</strong><input type="range" min="1" max="5" step="0.01" value={zoomValue} disabled={!region} onChange={(event) => setZoomValue(event.target.value)} /></label>
          <label>Ngang <strong>{xPercent}%</strong><input type="range" min="0" max="100" step="1" value={xPercent} disabled={!region || xTravel <= 0.0001} onChange={(event) => setAxisValue("x", event.target.value)} /></label>
          <label>Dọc <strong>{yPercent}%</strong><input type="range" min="0" max="100" step="1" value={yPercent} disabled={!region || yTravel <= 0.0001} onChange={(event) => setAxisValue("y", event.target.value)} /></label>
          <div className="crop-ratio-summary">
            <span>Tỷ lệ</span>
            <strong>{aspectLabel}</strong>
          </div>
          <div className="crop-ratio-summary">
            <span>Khung video</span>
            <strong>{frameOutputWidth && frameOutputHeight ? `${frameOutputWidth} x ${frameOutputHeight}px` : aspectLabel}</strong>
          </div>
          <div className="crop-ratio-summary">
            <span>Vùng ảnh gốc</span>
            <strong>{outputWidth && outputHeight ? `${outputWidth} x ${outputHeight}px` : "..."}</strong>
          </div>
        </div>

        <div className="crop-modal-actions region-crop-actions">
          <button type="button" onClick={() => rotateBy(270)}>Xoay trái</button>
          <button type="button" onClick={() => rotateBy(90)}>Xoay phải</button>
          <button type="button" className="ratio-lock" disabled>{aspectLabel}</button>
          <button type="button" onClick={centerCurrentRegion}>Canh giữa</button>
          <button type="button" onClick={resetRegion}><RotateCcw size={16} /> Đặt lại</button>
          <button className="action secondary" type="button" disabled={!region} onClick={applyRegion}>Dùng vùng crop/xoay</button>
        </div>
      </section>
    </div>
  );
}

function CharacterTab({ config, assets, currentLine, busy, updateConfig, uploadCharacter, deleteCharacter, uploadProjectAsset, onSaveTemplate, onApplyTemplate }) {
  const characterSections = useOpenSections(["character-controls", "background-controls", "logo-controls"]);
  if (!config) return <div className="empty">Chưa chọn project.</div>;
  const characterScale = clampNumber(config.character.scale, 0.4, 1.8, 1);
  const characterX = clampNumber(config.character.x, -260, 260, 0);
  const characterY = clampNumber(config.character.y, -220, 320, 0);
  const backgroundImage = versionedVideoUrl(config.slug, config.background?.src, config.assetRevision);
  const backgroundDetail = clampNumber(config.background?.detail, 0, 2, BACKGROUND_DEFAULTS.detail);
  const backgroundShade = clampNumber(config.background?.shade, 0, 0.24, BACKGROUND_DEFAULTS.shade);
  const backgroundBlur = clampNumber(config.background?.blur, 0, 18, BACKGROUND_DEFAULTS.blur);
  const logoImage = versionedVideoUrl(config.slug, config.logo?.src, config.assetRevision);
  const logoWidth = clampNumber(config.logo?.width, 60, 700, 110);
  const logoX = clampNumber(config.logo?.x, -540, 540, 32);
  const logoY = clampNumber(config.logo?.y, -960, 960, -72);
  const logoOpacity = clampNumber(config.logo?.opacity, 0, 1, 0.9);
  const logoAnchor = LOGO_ANCHOR_OPTIONS.some((option) => option.id === config.logo?.anchor) ? config.logo.anchor : "bottom-left";
  const logoLayer = LOGO_LAYER_OPTIONS.some((option) => option.id === config.logo?.layer) ? config.logo.layer : "above-character";
  const hasLogo = Boolean(config.logo?.src);
  const logoEnabled = Boolean(config.logo?.enabled && hasLogo);
  const currentFocusSide = normalizeFocusSide(currentLine?.focusSide, focusSideForPose(currentLine?.pose));
  const focusImageBlur = clampNumber(config.layout?.focusImageBlur, 0, 8, LAYOUT.focusImageBlur);
  const focusImageDarkness = clampNumber(config.layout?.focusImageDarkness, 0, 0.7, LAYOUT.focusImageDarkness);
  return (
    <div className="tab-body">
      <div className="template-action-stack">
        <TemplatePartActions
          title="Mẫu nhân vật"
          description={null}
          type="character"
          parts={{ character: true, background: true }}
          busy={busy}
          onSave={onSaveTemplate}
          onApply={onApplyTemplate}
        />
      </div>
      <div className="pose-row">
        {Object.entries(POSE_LABELS).map(([pose, label]) => (
          <PoseAssetCard
            key={pose}
            slug={config.slug}
            config={config}
            assets={assets}
            pose={pose}
            label={label}
            busy={busy}
            onChange={(event) => uploadCharacter(pose, event)}
            onDelete={() => deleteCharacter(pose)}
          />
        ))}
      </div>
      <SectionCollapseControls
        allOpen={characterSections.allOpen}
        allClosed={characterSections.allClosed}
        onExpandAll={() => characterSections.setAllOpen(true)}
        onCollapseAll={() => characterSections.setAllOpen(false)}
      />
      <CollapsibleGroup
        title="Điều khiển nhân vật"
        meta={currentLine ? `${POSE_LABELS[currentLine.pose] || currentLine.pose || "Đặt câu hỏi"} · ${currentFocusSide}` : "Chọn dòng để chỉnh"}
        className="detail-collapsible-panel"
        open={characterSections.isOpen("character-controls")}
        onToggle={() => characterSections.setSectionOpen("character-controls", !characterSections.isOpen("character-controls"))}
      >
      <div className="character-control-grid">
        <label>Hướng chỉ dòng hiện tại<select value={currentLine?.pose || "question"} onChange={(event) => updateConfig((draft) => {
          const line = draft.lines.find((item) => item.id === currentLine?.id);
          applyManualPose(line, event.target.value);
        })}>{Object.entries(POSE_LABELS).map(([pose, label]) => <option key={pose} value={pose}>{label}</option>)}</select></label>
        <div className="focus-side-field" role="radiogroup" aria-label="Focus ảnh dòng hiện tại">
          <span>Focus ảnh dòng hiện tại</span>
          <div className="focus-side-options">
            {FOCUS_SIDE_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.id}
                className={currentFocusSide === option.id ? "selected" : ""}
                aria-pressed={currentFocusSide === option.id}
                disabled={!currentLine}
                onClick={() => updateConfig((draft) => {
                  const line = draft.lines.find((item) => item.id === currentLine?.id);
                  applyManualFocusSide(line, option.id);
                })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <label className="character-range-field">
          <span>Độ mờ ảnh phụ</span>
          <strong>{focusImageBlur.toFixed(1)} px</strong>
          <input type="range" min="0" max="8" step="0.5" value={focusImageBlur} onChange={(event) => updateConfig((draft) => {
            draft.layout = { ...(draft.layout || {}), focusImageBlur: clampNumber(event.target.value, 0, 8, focusImageBlur) };
          })} />
        </label>
        <label className="character-range-field">
          <span>Độ tối ảnh phụ</span>
          <strong>{Math.round(focusImageDarkness * 100)}%</strong>
          <input type="range" min="0" max="0.7" step="0.05" value={focusImageDarkness} onChange={(event) => updateConfig((draft) => {
            draft.layout = { ...(draft.layout || {}), focusImageDarkness: clampNumber(event.target.value, 0, 0.7, focusImageDarkness) };
          })} />
        </label>
        <label className="character-range-field">
          <span>Scale nhân vật</span>
          <strong>{characterScale.toFixed(2)}x</strong>
          <input type="range" min="0.4" max="1.8" step="0.05" value={characterScale} onChange={(event) => updateConfig((draft) => { draft.character.scale = clampNumber(event.target.value, 0.4, 1.8, characterScale); })} />
        </label>
        <label className="character-range-field">
          <span>Dịch ngang</span>
          <strong>{characterX > 0 ? "+" : ""}{Math.round(characterX)} px</strong>
          <input type="range" min="-260" max="260" step="10" value={characterX} onChange={(event) => updateConfig((draft) => { draft.character.x = clampNumber(event.target.value, -260, 260, characterX); })} />
        </label>
        <label className="character-range-field">
          <span>Dịch xuống</span>
          <strong>{characterY > 0 ? "+" : ""}{Math.round(characterY)} px</strong>
          <input type="range" min="-220" max="320" step="10" value={characterY} onChange={(event) => updateConfig((draft) => { draft.character.y = clampNumber(event.target.value, -220, 320, characterY); })} />
        </label>
      </div>
      </CollapsibleGroup>
      <CollapsibleGroup
        title="Nền khung video"
        meta={backgroundImage ? "Đã có ảnh nền" : "Chưa có ảnh nền"}
        className="detail-collapsible-panel"
        open={characterSections.isOpen("background-controls")}
        onToggle={() => characterSections.setSectionOpen("background-controls", !characterSections.isOpen("background-controls"))}
      >
      <section className="background-control character-background-control">
        <div>
          <span className="eyebrow">Nền khung video</span>
          <strong>Nền nhân vật</strong>
        </div>
        <label className="background-thumb">
          <input disabled={busy} type="file" accept={IMAGE_FILE_ACCEPT} onChange={(event) => uploadProjectAsset("background", event)} />
          {backgroundImage ? <img src={backgroundImage} alt="Nền khung video" /> : <ImageIcon size={20} />}
          <span>Thay nền</span>
        </label>
      </section>
      <div className="character-control-grid background-adjust-grid">
        <label className="character-range-field background-range-field">
          <span>Làm rõ nền</span>
          <strong>{Math.round(backgroundDetail * 100)}%</strong>
          <input type="range" min="0" max="2" step="0.05" value={backgroundDetail} onChange={(event) => updateConfig((draft) => {
            draft.background = { ...(draft.background || {}), treatment: "enhanced", detail: clampNumber(event.target.value, 0, 2, backgroundDetail) };
          })} />
        </label>
        <label className="character-range-field background-range-field">
          <span>Giảm trắng nền</span>
          <strong>{Math.round(backgroundShade * 100)}%</strong>
          <input type="range" min="0" max="0.24" step="0.01" value={backgroundShade} onChange={(event) => updateConfig((draft) => {
            draft.background = { ...(draft.background || {}), treatment: "enhanced", shade: clampNumber(event.target.value, 0, 0.24, backgroundShade) };
          })} />
        </label>
        <label className="character-range-field background-range-field">
          <span>Độ mờ nền</span>
          <strong>{Math.round(backgroundBlur)} px</strong>
          <input type="range" min="0" max="18" step="1" value={backgroundBlur} onChange={(event) => updateConfig((draft) => {
            draft.background = { ...(draft.background || {}), blur: clampNumber(event.target.value, 0, 18, backgroundBlur) };
          })} />
        </label>
      </div>
      </CollapsibleGroup>
      <CollapsibleGroup
        title="Logo"
        meta={logoEnabled ? "Đang bật" : hasLogo ? "Đã chọn, đang tắt" : "Chưa có logo"}
        className="detail-collapsible-panel"
        open={characterSections.isOpen("logo-controls")}
        onToggle={() => characterSections.setSectionOpen("logo-controls", !characterSections.isOpen("logo-controls"))}
      >
      <section className="background-control character-background-control logo-control">
        <div>
          <span className="eyebrow">Logo</span>
          <strong>Logo overlay</strong>
        </div>
        <div className="logo-control-row">
          <label className="background-thumb logo-thumb">
            <input disabled={busy} type="file" accept={IMAGE_FILE_ACCEPT} onChange={(event) => uploadProjectAsset("logo", event)} />
            {logoImage ? <img src={logoImage} alt="Logo dự án" /> : <ImageIcon size={20} />}
            <span>{hasLogo ? "Thay logo" : "Chọn logo"}</span>
          </label>
          <ActionButton tone={logoEnabled ? "secondary" : "quiet"} disabled={busy || !hasLogo} onClick={() => updateConfig((draft) => {
            draft.logo = {
              ...(draft.logo || {}),
              enabled: !Boolean(draft.logo?.enabled && draft.logo?.src),
            };
          })}>
            {logoEnabled ? <X size={16} /> : <CheckCircle2 size={16} />}
            {logoEnabled ? "Tắt logo" : "Bật logo"}
          </ActionButton>
        </div>
      </section>
      <div className="character-control-grid logo-control-grid">
        <div className="logo-anchor-grid wide" role="radiogroup" aria-label="Chọn vị trí logo">
          {LOGO_ANCHOR_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.id}
              className={logoAnchor === option.id ? "selected" : ""}
              aria-pressed={logoAnchor === option.id}
              onClick={() => updateConfig((draft) => {
                draft.logo = { ...(draft.logo || {}), anchor: option.id };
              })}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="character-range-field logo-range-field">
          <span>Kích thước logo</span>
          <strong>{Math.round(logoWidth)} px</strong>
          <input type="range" min="60" max="700" step="5" value={logoWidth} onChange={(event) => updateConfig((draft) => {
            draft.logo = { ...(draft.logo || {}), width: clampNumber(event.target.value, 60, 700, logoWidth) };
          })} />
        </label>
        <label className="character-range-field logo-range-field">
          <span>Dịch ngang</span>
          <strong>{logoX > 0 ? "+" : ""}{Math.round(logoX)} px</strong>
          <input type="range" min="-540" max="540" step="10" value={logoX} onChange={(event) => updateConfig((draft) => {
            draft.logo = { ...(draft.logo || {}), x: clampNumber(event.target.value, -540, 540, logoX) };
          })} />
        </label>
        <label className="character-range-field logo-range-field">
          <span>Dịch dọc</span>
          <strong>{logoY > 0 ? "+" : ""}{Math.round(logoY)} px</strong>
          <input type="range" min="-960" max="960" step="10" value={logoY} onChange={(event) => updateConfig((draft) => {
            draft.logo = { ...(draft.logo || {}), y: clampNumber(event.target.value, -960, 960, logoY) };
          })} />
        </label>
        <label className="character-range-field logo-range-field">
          <span>Độ mờ</span>
          <strong>{Math.round(logoOpacity * 100)}%</strong>
          <input type="range" min="0" max="1" step="0.05" value={logoOpacity} onChange={(event) => updateConfig((draft) => {
            draft.logo = { ...(draft.logo || {}), opacity: clampNumber(event.target.value, 0, 1, logoOpacity) };
          })} />
        </label>
        <label className="logo-layer-field">
          <span>Lớp logo</span>
          <select value={logoLayer} onChange={(event) => updateConfig((draft) => {
            draft.logo = { ...(draft.logo || {}), layer: event.target.value };
          })}>
            {LOGO_LAYER_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
        <div className="logo-reset-row">
          <ActionButton tone="quiet" disabled={busy} onClick={() => updateConfig((draft) => {
            draft.logo = {
              ...(draft.logo || {}),
              width: 110,
              anchor: "bottom-left",
              x: 32,
              y: -72,
              opacity: 0.9,
              layer: "above-character",
            };
          })}>
            <RotateCcw size={16} /> Đặt lại logo
          </ActionButton>
        </div>
      </div>
      </CollapsibleGroup>
    </div>
  );
}

function PoseAssetCard({ slug, config, assets, pose, label, busy, onChange, onDelete }) {
  const preview = characterPreviewUrl({ slug, config, assets, pose });
  const status = characterPoseStatus(config, pose);
  const transparencyWarning = config.character?.poseWarnings?.[pose];
  const posePath = String(config.character?.poses?.[pose] || "").replace(/\\/g, "/");
  const projectPosePaths = [
    posePath,
    status.source.original,
    status.source.fallback,
    status.source.preview,
    status.source.render,
  ].map((value) => String(value || "").replace(/\\/g, "/"));
  const canDelete = projectPosePaths.some((value) => value.startsWith("assets/character/"));
  const statusLabel = status.state === "processing"
    ? `Đang chuẩn hóa ${status.progress}%`
    : status.state === "error"
      ? "Lỗi chuẩn hóa"
      : status.state === "image-ready"
        ? "Ảnh"
        : preview
          ? (preview.type === "image" ? "Ảnh" : "WebM")
          : "Thiếu pose";
  return (
    <section className="pose-card">
      <div className="pose-card-head"><strong>{label}</strong><span className={`pose-status-pill ${status.state}`}>{statusLabel}</span></div>
      <div className="pose-preview">
        {preview?.type === "image" ? <img src={preview.url} alt={label} /> : null}
        {preview?.type === "video" ? <video src={preview.url} muted autoPlay loop playsInline /> : null}
        {!preview ? <div>Chưa có pose</div> : null}
      </div>
      {status.state === "processing" ? <div className="pose-status-line processing">Đang chuẩn hóa video/GIF. Preview tạm dùng fallback PNG.</div> : null}
      {status.state === "error" ? <div className="pose-status-line error">Lỗi chuẩn hóa{status.error ? `: ${status.error}` : ""}</div> : null}
      <div className="pose-card-actions">
        <UploadButton label="Chọn video/GIF hoặc ảnh" accept={`.mov,.mp4,.webm,.gif,${IMAGE_FILE_ACCEPT}`} disabled={busy} onChange={onChange} />
        <ActionButton tone="quiet" disabled={busy || !canDelete} title={canDelete ? "Xóa pose khỏi project" : "Không có pose riêng trong project"} onClick={onDelete}>
          <Trash2 size={16} /> Xóa pose
        </ActionButton>
      </div>
      {transparencyWarning ? <div className="asset-warning">{transparencyWarning}</div> : null}
    </section>
  );
}

let currentPreviewAudio = null;
let currentPreviewAudioSource = "";
const previewSoundListeners = new Set();

function notifyPreviewSoundListeners() {
  previewSoundListeners.forEach((listener) => listener(currentPreviewAudioSource));
}

function stopPreviewSound() {
  const player = currentPreviewAudio;
  currentPreviewAudio = null;
  currentPreviewAudioSource = "";
  if (player) {
    player.pause();
    try {
      player.currentTime = 0;
    } catch {
      // The audio element can already be released after a playback error.
    }
  }
  notifyPreviewSoundListeners();
}

function playPreviewSound(source, volume = 1) {
  stopPreviewSound();
  const normalizedSource = String(source || "");
  if (!normalizedSource) return;
  const player = new Audio(normalizedSource);
  player.volume = Math.max(0, Math.min(1, Number(volume) || 1));
  currentPreviewAudio = player;
  currentPreviewAudioSource = normalizedSource;
  notifyPreviewSoundListeners();
  player.addEventListener("ended", () => {
    if (currentPreviewAudio === player) {
      currentPreviewAudio = null;
      currentPreviewAudioSource = "";
      notifyPreviewSoundListeners();
    }
  }, { once: true });
  player.play().catch(() => {
    if (currentPreviewAudio === player) {
      currentPreviewAudio = null;
      currentPreviewAudioSource = "";
      notifyPreviewSoundListeners();
    }
  });
}

function togglePreviewSound(source, volume = 1) {
  const normalizedSource = String(source || "");
  if (currentPreviewAudio && currentPreviewAudioSource === normalizedSource) {
    stopPreviewSound();
    return;
  }
  playPreviewSound(normalizedSource, volume);
}

function SoundPreviewButton({ source, volume = 1, label = "sound", className = "", title, ariaLabel, disabled = false, activeChildren = null, children }) {
  const normalizedSource = String(source || "");
  const [activeSource, setActiveSource] = useState(() => currentPreviewAudioSource);
  useEffect(() => {
    const listener = (nextSource) => setActiveSource(nextSource);
    previewSoundListeners.add(listener);
    return () => previewSoundListeners.delete(listener);
  }, []);
  const active = !disabled && Boolean(normalizedSource) && activeSource === normalizedSource;
  return (
    <button
      type="button"
      className={className}
      disabled={disabled || !normalizedSource}
      title={active ? `Dừng ${label}` : title}
      aria-label={active ? `Dừng ${label}` : ariaLabel}
      onClick={() => togglePreviewSound(normalizedSource, volume)}
    >
      {active ? (activeChildren || <Pause size={16} />) : (children || <Play size={16} />)}
    </button>
  );
}

function playCompletionSound(volume = 0.55) {
  const player = new Audio(COMPLETION_SOUND_URL);
  player.volume = Math.max(0, Math.min(1, Number(volume) || 0.55));
  player.play().catch(() => {});
}

function soundCategories(sounds) {
  const seen = new Set();
  return sounds.reduce((categories, item) => {
    const category = item.category || "Khác";
    if (!seen.has(category)) {
      seen.add(category);
      categories.push(category);
    }
    return categories;
  }, []);
}

function SoundOptions({ sounds }) {
  return soundCategories(sounds).map((category) => (
    <optgroup key={category} label={category}>
      {sounds.filter((item) => (item.category || "Khác") === category).map((item) => <option key={item.name} value={item.name}>{item.label || item.name}</option>)}
    </optgroup>
  ));
}

function soundLabel(name, sounds) {
  const resolvedName = migrateSfxName(name);
  if (!resolvedName || resolvedName === "__none__") return "không dùng";
  return sounds.find((item) => item.name === resolvedName)?.label || resolvedName;
}

const SOUND_CATEGORY_OPTIONS = [
  "Pose & cử chỉ",
  "Câu hỏi",
  "Pop / click nhẹ",
  "Tiếng Động - SFX edit nhiều",
  "Meme & nhấn mạnh",
  "Tự tải lên",
];

const FALLBACK_SFX_SOURCES = [
  { id: "custom", label: "Tự tải lên", category: "Tự tải lên", sourceUrl: "", license: "unverified", tags: ["custom", "upload"] },
  { id: "tiengdong", label: "Tiếng Động", category: "Tiếng Động - SFX edit nhiều", sourceUrl: "https://tiengdong.com/", license: "unverified", tags: ["tieng-dong", "edit", "sfx"] },
  { id: "kenney", label: "Kenney", category: "Pose & cử chỉ", sourceUrl: "https://kenney.nl/assets/category:Audio", license: "CC0", tags: ["kenney", "cc0", "click"] },
  { id: "mixkit", label: "Mixkit", category: "Pop / click nhẹ", sourceUrl: "https://mixkit.co/free-sound-effects/", license: "royalty-free", tags: ["mixkit", "pop", "whoosh"] },
  { id: "pixabay", label: "Pixabay", category: "Tiếng Động - SFX edit nhiều", sourceUrl: "https://pixabay.com/sound-effects/", license: "pixabay-content-license", tags: ["pixabay", "edit", "sfx"] },
  { id: "freesound-cc0", label: "Freesound CC0", category: "Tiếng Động - SFX edit nhiều", sourceUrl: "https://freesound.org/", license: "CC0", tags: ["freesound", "cc0", "edit"] },
  { id: "sonniss", label: "Sonniss GDC", category: "Tiếng Động - SFX edit nhiều", sourceUrl: "https://sonniss.com/gameaudiogdc/", license: "royalty-free", tags: ["sonniss", "game", "edit"] },
  { id: "adobe", label: "Adobe Audition SFX", category: "Tiếng Động - SFX edit nhiều", sourceUrl: "https://www.adobe.com/products/audition/offers/adobeauditiondlcsfx.html", license: "adobe-eula", tags: ["adobe", "sfx", "edit"] },
  { id: "opengameart-cc0", label: "OpenGameArt CC0", category: "Tiếng Động - SFX edit nhiều", sourceUrl: "https://opengameart.org/", license: "CC0", tags: ["opengameart", "cc0", "game"] },
];

function soundNameFromFile(fileName = "") {
  return String(fileName || "Sound")
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Sound";
}

function normalizeTagText(tags = []) {
  return (Array.isArray(tags) ? tags : String(tags || "").split(/[,;\n]+/))
    .map((tag) => String(tag || "").trim().replace(/^#+/, ""))
    .filter(Boolean)
    .join(", ");
}

const COMPACT_SOUND_GROUP_ORDER = [
  "FastScene cache",
  "Mixkit",
  "Kenney",
  "Tiếng Động",
  "CapCut cache",
  "Tự tải lên",
  "Khác",
];

function foldSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function compactSoundGroupLabel(item = {}) {
  if (item.sourceGroup) return item.sourceGroup;
  const folded = foldSearchText(`${item.name || ""} ${item.source || ""} ${item.category || ""} ${(item.tags || []).join(" ")}`);
  if (String(item.name || "").startsWith("capcut-cache/") || folded.includes("capcut")) return "CapCut cache";
  if (String(item.name || "").startsWith("kenney/") || folded.includes("kenney")) return "Kenney";
  if (String(item.name || "").startsWith("tiengdong/") || folded.includes("tiengdong") || folded.includes("tieng dong")) return "Tiếng Động";
  if (folded.includes("mixkit")) return "Mixkit";
  if (folded.includes("fastscene")) return "FastScene cache";
  if (folded.includes("local upload") || folded.includes("tu tai len") || folded.includes("custom")) return "Tự tải lên";
  return item.source || item.category || "Khác";
}

function compactSoundGroupRank(label) {
  const folded = foldSearchText(label);
  const index = COMPACT_SOUND_GROUP_ORDER.findIndex((item) => foldSearchText(item) === folded);
  return index === -1 ? COMPACT_SOUND_GROUP_ORDER.length : index;
}

function compactSoundSearchText(item = {}) {
  const group = compactSoundGroupLabel(item);
  const aliases = group === "CapCut cache" ? "capcut cap cut caput cache" : "";
  return foldSearchText([
    item.label,
    item.name,
    item.category,
    item.description,
    item.source,
    group,
    aliases,
    ...(item.tags || []),
  ].join(" "));
}

function groupCompactSounds(sounds = [], normalizedQuery = "") {
  const groups = new Map();
  sounds.forEach((item, index) => {
    if (normalizedQuery && !compactSoundSearchText(item).includes(normalizedQuery)) return;
    const label = compactSoundGroupLabel(item);
    if (!groups.has(label)) {
      groups.set(label, {
        label,
        items: [],
        firstIndex: index,
      });
    }
    groups.get(label).items.push(item);
  });
  return [...groups.values()].sort((a, b) => (
    compactSoundGroupRank(a.label) - compactSoundGroupRank(b.label)
    || a.firstIndex - b.firstIndex
    || a.label.localeCompare(b.label, "vi")
  ));
}

function CompactSoundPicker({ sounds, value, onChange, allowInherit = false, inheritedLabel = "Theo pose" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = foldSearchText(query.trim());
  const groups = useMemo(() => groupCompactSounds(sounds, normalizedQuery), [sounds, normalizedQuery]);
  const matchCount = groups.reduce((total, group) => total + group.items.length, 0);
  const label = value === ""
    ? (allowInherit ? inheritedLabel : "Không dùng")
    : soundLabel(value, sounds);

  function choose(nextValue) {
    stopPreviewSound();
    onChange(nextValue);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="compact-sound-picker">
      <button
        type="button"
        className="compact-sound-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Chọn sound hiện tại: ${label}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{label}</span><ChevronDown size={16} />
      </button>
      {open ? (
        <div className="compact-sound-popover" role="dialog" aria-label="Chọn sound" onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
          <div className="compact-sound-search">
            <Search size={15} />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm click, pop, hỏi, edit..." />
            <button type="button" title="Đóng" aria-label="Đóng chọn sound" onClick={() => setOpen(false)}><X size={15} /></button>
          </div>
          <div className="compact-sound-results">
            <div className="compact-sound-results-meta"><span>{matchCount}/{sounds.length} sound</span><span>{groups.length} nhóm</span></div>
            {allowInherit ? <button type="button" className={value === "" ? "compact-sound-option selected" : "compact-sound-option"} aria-pressed={value === ""} onClick={() => choose("")}><strong>Theo pose</strong><small>{inheritedLabel}</small></button> : null}
            <button type="button" className={value === "__none__" || (!allowInherit && value === "") ? "compact-sound-option selected" : "compact-sound-option"} aria-pressed={value === "__none__" || (!allowInherit && value === "")} onClick={() => choose(allowInherit ? "__none__" : "")}><strong>Không dùng sound</strong></button>
            {groups.map((group) => (
              <section className="compact-sound-section" key={group.label}>
                <div className="compact-sound-section-head"><span>{group.label}</span><b>{group.items.length}</b></div>
                {group.items.map((item) => (
                  <div className={`compact-sound-result-row ${value === item.name ? "selected" : ""}`} key={item.name}>
                    <button type="button" className="compact-sound-choice" aria-pressed={value === item.name} onClick={() => choose(item.name)}>
                      <span><strong>{item.label || item.name}</strong><small>{item.category} - {item.source}</small></span>
                    </button>
                    <SoundPreviewButton
                      className="compact-sound-preview"
                      source={item.url}
                      label={`sound ${item.label || item.name}`}
                      title={`Nghe thử ${item.label || item.name}`}
                      ariaLabel={`Nghe thử ${item.label || item.name}`}
                    >
                      <Play size={14} />
                    </SoundPreviewButton>
                  </div>
                ))}
              </section>
            ))}
            {!matchCount ? <span className="compact-sound-empty">Không có sound</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SoundImportModal({ draft, sources, busy, onClose, onSave }) {
  const dialogRef = useRef(null);
  const sourceOptions = sources?.length ? sources : FALLBACK_SFX_SOURCES;
  const [form, setForm] = useState(() => ({ ...draft }));
  const [previewUrl, setPreviewUrl] = useState("");
  const firstFile = form.files?.[0] || null;
  const selectedSource = sourceOptions.find((source) => source.id === form.sourceId) || sourceOptions[0];

  useDialogFocus(dialogRef, onClose);

  useEffect(() => {
    if (!firstFile) return undefined;
    const url = URL.createObjectURL(firstFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [firstFile]);

  function updateSource(sourceId) {
    const nextSource = sourceOptions.find((source) => source.id === sourceId) || sourceOptions[0];
    setForm((current) => ({
      ...current,
      sourceId: nextSource.id,
      source: nextSource.label,
      sourceUrl: nextSource.sourceUrl || "",
      license: nextSource.license || "unverified",
      category: nextSource.category || current.category,
      tags: normalizeTagText(nextSource.tags),
      description: nextSource.description || current.description || "",
    }));
  }

  function submit(event) {
    event.preventDefault();
    onSave(form);
  }

  return (
    <div className="template-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form ref={dialogRef} className="template-modal sound-import-modal" role="dialog" aria-modal="true" aria-labelledby="sound-import-dialog-title" onSubmit={submit}>
        <div className="template-modal-head">
          <div>
            <h2 id="sound-import-dialog-title">Nhập sound</h2>
          </div>
          <button type="button" className="icon-close" data-dialog-initial aria-label="Đóng" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="sound-import-file-list">
          {form.files.slice(0, 5).map((file) => <span key={`${file.name}-${file.size}`}>{file.name}</span>)}
          {form.files.length > 5 ? <span>+{form.files.length - 5} file</span> : null}
        </div>
        <div className="form-grid two">
          <label>Tên hiển thị<input value={form.label || ""} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} placeholder={form.files.length === 1 ? soundNameFromFile(firstFile?.name) : "Tên chung cho batch"} /></label>
          <label>Nguồn<select value={selectedSource.id} onChange={(event) => updateSource(event.target.value)}>
            {sourceOptions.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
          </select></label>
          <label>Nhóm<select value={form.category || "Tiếng Động - SFX edit nhiều"} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>
            {SOUND_CATEGORY_OPTIONS.map((category) => <option key={category} value={category}>{category}</option>)}
          </select></label>
          <label>License<input value={form.license || ""} onChange={(event) => setForm((current) => ({ ...current, license: event.target.value }))} /></label>
          <label className="wide">Tags<input value={form.tags || ""} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))} placeholder="click, pop, edit, camera" /></label>
          <label className="wide">Mô tả<input value={form.description || ""} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Tùy chọn" /></label>
        </div>
        <div className="template-modal-actions">
          <SoundPreviewButton
            source={previewUrl}
            label="file đầu"
            title="Nghe thử file đầu"
            ariaLabel="Nghe thử file đầu"
            activeChildren={<><Pause size={16} /> Dừng file đầu</>}
          >
            <><Play size={16} /> Nghe thử file đầu</>
          </SoundPreviewButton>
          <button type="button" onClick={onClose}>Hủy</button>
          <button type="submit" className="primary" disabled={busy}>Lưu vào picker</button>
        </div>
      </form>
    </div>
  );
}

function buildAimaxJobBody({ voiceId, speed, pitch, apiKey } = {}) {
  const body = { mode: "aimax", voiceId, speed, pitch };
  const key = String(apiKey || "").trim();
  if (key) body.apiKey = key;
  return body;
}

function AudioTab({ config, voices, sfx, sfxSources = [], busy, updateConfig, uploadSfx, uploadProjectAsset, runJob, selectedSlug, jobs, selectedJobId, setSelectedJobId, logs, onSaveTemplate, onApplyTemplate, currentLineIndex = 0, previewLine = () => {}, contentDraftIsDirty = false, aimaxApiKey = "", onAimaxApiKeyChange = () => {}, aimaxApiSaved = false, onSaveAimaxApiKey = async () => null, aimaxApiSaving = false, onTestAimaxVoices = async () => null, aimaxVoiceLoading = false }) {
  const [soundImportDraft, setSoundImportDraft] = useState(null);
  const audioSections = useOpenSections(["pose-sfx", "scene-sfx", "audio-status"]);
  if (!config) return <div className="empty">Chưa chọn project.</div>;
  const sourceOptions = sfxSources.length ? sfxSources : FALLBACK_SFX_SOURCES;
  const selectedJob = jobs.find((job) => job.id === selectedJobId) || null;
  const audioJob = isAudioJob(selectedJob) ? selectedJob : newestJob(jobs, selectedSlug, (job) => isAudioJob(job));
  const audioLogs = audioJob?.id === selectedJobId ? logs : "";
  const audioBusy = busy || isRunningJob(audioJob);
  const hasTypedAimaxKey = Boolean(String(aimaxApiKey || "").trim());
  const voiceLines = config.lines || [];
  const voiceDirty = voiceLines.some((line) => line.dirtyVoice);
  const alignmentProvider = config.audio?.alignmentProvider === "elevenlabs" ? "elevenlabs" : "none";
  const previewScene = (index) => previewLine(index, { autoplay: true });
  const sceneStartSfx = config.audio?.sceneStartSfx || {};
  const sceneStartVolume = clampNumber(sceneStartSfx.volume, 0, 1.5, DEFAULT_POSE_SFX_VOLUME);
  const sceneStartOffset = clampNumber(sceneStartSfx.offsetMs, 0, 3000, 0);
  const poseSfx = { ...DEFAULT_POSE_SFX, ...(config.poseSfx || {}) };
  const poseSfxVolumes = { ...DEFAULT_POSE_SFX_VOLUMES, ...(sceneStartSfx.poseVolumes || {}) };
  const poseSoundRows = Object.entries(POSE_LABELS).map(([pose, label]) => {
    const name = migrateSfxName(poseSfx[pose] || "");
    return {
      pose,
      label,
      name,
      volume: clampNumber(poseSfxVolumes[pose], 0, 1.5, sceneStartVolume),
      url: projectSfxUrl(name, sfx),
    };
  });
  const updatePoseSfx = (pose, value) => {
    updateConfig((draft) => {
      draft.poseSfx = {
        ...(draft.poseSfx || {}),
        [pose]: value || "__none__",
      };
    });
    previewScene(currentLineIndex);
  };
  const updatePoseSfxVolume = (pose, percentValue) => {
    const currentVolume = poseSoundRows.find((row) => row.pose === pose)?.volume ?? sceneStartVolume;
    const nextVolume = percentToVolume(percentValue, currentVolume);
    updateConfig((draft) => {
      draft.audio = {
        ...(draft.audio || {}),
        sceneStartSfx: {
          ...(draft.audio?.sceneStartSfx || {}),
          mode: "pose",
          poseVolumes: {
            ...(draft.audio?.sceneStartSfx?.poseVolumes || {}),
            [pose]: nextVolume,
          },
        },
      };
    });
    previewScene(currentLineIndex);
  };
  const updateSceneStartVolume = (percentValue) => {
    const nextVolume = percentToVolume(percentValue, sceneStartVolume);
    updateSceneStartSfx({
      volume: nextVolume,
      poseVolumes: Object.fromEntries(Object.keys(POSE_LABELS).map((pose) => [pose, nextVolume])),
    });
  };
  const updateSceneStartSfx = (patch) => {
    updateConfig((draft) => {
      draft.audio = {
        ...(draft.audio || {}),
        sceneStartSfx: {
          ...(draft.audio?.sceneStartSfx || {}),
          mode: "pose",
          ...patch,
        },
      };
    });
    previewScene(currentLineIndex);
  };
  const beginSoundImport = (event, defaults = {}) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    const source = sourceOptions.find((item) => item.id === defaults.sourceId)
      || sourceOptions.find((item) => item.label === defaults.source)
      || sourceOptions[0];
    setSoundImportDraft({
      files,
      label: files.length === 1 ? soundNameFromFile(files[0].name) : "",
      sourceId: source.id,
      source: source.label,
      sourceUrl: source.sourceUrl || defaults.sourceUrl || "",
      license: source.license || defaults.license || "unverified",
      category: defaults.category || source.category || "Tiếng Động - SFX edit nhiều",
      tags: normalizeTagText(defaults.tags || source.tags),
      description: source.description || defaults.description || "",
    });
  };
  const saveSoundImport = async (draft) => {
    await uploadSfx(draft.files, {
      sourceId: draft.sourceId,
      label: draft.label,
      category: draft.category,
      tags: draft.tags,
      source: draft.source,
      sourceUrl: draft.sourceUrl,
      license: draft.license,
      description: draft.description,
    });
    setSoundImportDraft(null);
  };
  return (
    <div className="tab-body audio-tab">
      <TemplatePartActions type="audio" label="âm thanh" busy={busy} onSave={onSaveTemplate} onApply={onApplyTemplate} />
      {contentDraftIsDirty ? <div className="warning action-required" role="status">Bản nháp chưa lưu content. Bấm Lưu content ở panel Kịch bản rồi quay lại tạo âm thanh.</div> : null}
      <section className="audio-control-panel">
        <div className="audio-section-head">
          <div>
            <strong>Giọng & nhạc</strong>
          </div>
        </div>
        <div className="aimax-runtime-row">
          <label>AIMAX API key
            <input
              type="password"
              autoComplete="off"
              spellCheck="false"
              aria-label="AIMAX API key"
              value={aimaxApiKey}
              onChange={(event) => onAimaxApiKeyChange(event.target.value)}
              placeholder={aimaxApiSaved && !hasTypedAimaxKey ? "••••••••••••••••" : "Dán API key AIMAX"}
            />
          </label>
          <ActionButton
            tone="quiet"
            disabled={busy || aimaxApiSaving || !String(aimaxApiKey || "").trim()}
            onClick={() => onSaveAimaxApiKey(aimaxApiKey)}
          >
            <Save size={16} /> {aimaxApiSaving ? "Đang lưu" : "Lưu API key"}
          </ActionButton>
          <ActionButton
            tone="quiet"
            disabled={busy || aimaxVoiceLoading || aimaxApiSaving || (!aimaxApiSaved && !String(aimaxApiKey || "").trim())}
            onClick={() => onTestAimaxVoices(aimaxApiKey)}
          >
            <RefreshCcw size={16} /> {aimaxVoiceLoading ? "Đang tải voice" : "Tải voice AIMAX"}
          </ActionButton>
        </div>
        <div className="hint aimax-runtime-hint">{aimaxApiSaved ? "API key đã được lưu trong .env và đang được ẩn. Dán key mới nếu muốn thay." : "API key chưa được lưu."}</div>
        <div className="form-grid two audio-settings-grid">
          <label>Chọn voice<select value={voices.some((voice) => voice.id === config.audio.voiceId) ? config.audio.voiceId : ""} onChange={(event) => updateConfig((draft) => { draft.audio.voiceId = event.target.value; markVoiceDirty(draft); })}>
            <option value="">Chọn voice từ AIMAX</option>
            {voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name || voice.id}</option>)}
          </select></label>
          <label>Tốc độ<input type="number" step="0.05" min="0.5" max="2" value={config.audio.speed} onChange={(event) => updateConfig((draft) => { draft.audio.speed = clampNumber(event.target.value, 0.5, 2, draft.audio.speed || 1); markVoiceDirty(draft); })} /></label>
          <label>Cao độ (pitch)<input type="number" step="1" min={AIMAX_PITCH_MIN} max={AIMAX_PITCH_MAX} value={config.audio.pitch ?? 0} onChange={(event) => updateConfig((draft) => { draft.audio.pitch = Math.round(clampNumber(event.target.value, AIMAX_PITCH_MIN, AIMAX_PITCH_MAX, draft.audio.pitch ?? 0)); markVoiceDirty(draft); })} /></label>
          <label>Volume voice<input type="number" step="0.05" min="0" max="2" value={config.audio.voiceVolume} onChange={(event) => updateConfig((draft) => { draft.audio.voiceVolume = clampNumber(event.target.value, 0, 2, draft.audio.voiceVolume ?? 1); })} /></label>
          <label>Volume BGM<input type="number" step="0.01" min="0" max="1" value={config.audio.bgmVolume} onChange={(event) => updateConfig((draft) => { draft.audio.bgmVolume = clampNumber(event.target.value, 0, 1, draft.audio.bgmVolume ?? 0.18); })} /></label>
          <label>Map sub từng từ<select value={alignmentProvider} onChange={(event) => updateConfig((draft) => {
            const provider = event.target.value === "elevenlabs" ? "elevenlabs" : "none";
            draft.audio = {
              ...(draft.audio || {}),
              alignmentProvider: provider,
            };
            if (provider === "elevenlabs") {
              markVoiceDirty(draft);
            } else {
              (draft.lines || []).forEach((line) => { delete line.words; });
            }
          })}>
            <option value="none">Tự ước lượng theo dòng</option>
            <option value="elevenlabs">ElevenLabs Forced Alignment</option>
          </select></label>
        </div>
        {alignmentProvider === "elevenlabs" ? (
          <div className="hint audio-alignment-hint">Khi bấm Tạo âm thanh, Studio sẽ gọi ElevenLabs Forced Alignment bằng ELEVENLABS_API_KEY để lấy timing từng từ. Nếu thiếu key hoặc API lỗi, render tự fallback về timing theo dòng.</div>
        ) : null}
        <div className="upload-grid audio-action-row">
          <ActionButton disabled={audioBusy || !selectedSlug || contentDraftIsDirty} onClick={() => runJob(`/api/videos/${selectedSlug}/generate-vo`, buildAimaxJobBody({ voiceId: config.audio.voiceId, speed: config.audio.speed, pitch: config.audio.pitch, apiKey: aimaxApiKey }))}><FileAudio size={16} /> Tạo âm thanh</ActionButton>
          <UploadButton disabled={audioBusy} label="Upload nhiều sound" multiple accept=".mp3,.wav,.m4a,.aac,.ogg" onChange={(event) => beginSoundImport(event, { sourceId: "custom" })} />
          <UploadButton disabled={audioBusy} label="Upload nhạc nền" accept=".mp3,.wav,.m4a,.aac,.ogg" onChange={(event) => uploadProjectAsset("bgm", event)} />
          {config.audio.bgm ? (
            <SoundPreviewButton
              className="sound-preview-button"
              source={videoUrl(config.slug, config.audio.bgm)}
              volume={config.audio.bgmVolume}
              label="nhạc nền"
              title="Nghe nhạc nền"
              ariaLabel="Nghe nhạc nền"
              activeChildren={<><Pause size={16} /> Dừng nhạc nền</>}
            >
              <><Volume2 size={16} /> Nghe nhạc nền</>
            </SoundPreviewButton>
          ) : null}
        </div>
      </section>
      <SectionCollapseControls
        allOpen={audioSections.allOpen}
        allClosed={audioSections.allClosed}
        onExpandAll={() => audioSections.setAllOpen(true)}
        onCollapseAll={() => audioSections.setAllOpen(false)}
      />
      <CollapsibleGroup
        title="Sound theo pose"
        meta={`${poseSoundRows.length} pose`}
        className="detail-collapsible-panel"
        open={audioSections.isOpen("pose-sfx")}
        onToggle={() => audioSections.setSectionOpen("pose-sfx", !audioSections.isOpen("pose-sfx"))}
      >
      <section className="pose-sfx-map-card">
        <div className="pose-sfx-map-head">
          <div>
            <strong>Sound theo pose</strong>
          </div>
        </div>
        <div className="pose-sfx-map-rows">
          {poseSoundRows.map((row) => (
            <div className="pose-sfx-map-row" key={row.pose}>
              <strong>{row.label}</strong>
              <CompactSoundPicker
                sounds={sfx}
                value={row.name}
                onChange={(value) => updatePoseSfx(row.pose, value)}
              />
              <label className="pose-sfx-volume-field">
                <span>Âm lượng</span>
                <div className="percent-input">
                  <input
                    type="number"
                    min="0"
                    max="150"
                    step="1"
                    value={volumeToPercent(row.volume)}
                    onChange={(event) => updatePoseSfxVolume(row.pose, event.target.value)}
                  />
                  <b>%</b>
                </div>
                <small>{volumeDeltaLabel(row.volume)}</small>
              </label>
              <SoundPreviewButton
                className="sound-preview-button icon-only"
                source={row.url}
                volume={row.volume}
                label={`sound ${row.label}`}
                disabled={!row.url}
                title={`Nghe thử ${row.label}`}
                ariaLabel={`Nghe thử sound ${row.label}`}
              >
                <Play size={16} />
              </SoundPreviewButton>
            </div>
          ))}
        </div>
       </section>
       </CollapsibleGroup>
      <CollapsibleGroup
        title="Sound đầu cảnh"
        meta={sceneStartSfx.enabled !== false ? "Đang bật" : "Đang tắt"}
        className="detail-collapsible-panel"
        open={audioSections.isOpen("scene-sfx")}
        onToggle={() => audioSections.setSectionOpen("scene-sfx", !audioSections.isOpen("scene-sfx"))}
      >
      <section className="scene-start-sfx-card compact">
        <div className="scene-start-sfx-head">
          <div className="scene-start-sfx-copy">
            <strong>Sound đầu cảnh</strong>
          </div>
        </div>
        <div className="scene-start-sfx-grid">
          <label className="scene-start-sfx-toggle">
            <input
              type="checkbox"
              checked={sceneStartSfx.enabled !== false}
              onChange={(event) => updateSceneStartSfx({ enabled: event.target.checked })}
            />
            <span>Bật</span>
          </label>
          <label className="scene-start-sfx-toggle">
            <input
              type="checkbox"
              checked={sceneStartSfx.skipFirst !== false}
              onChange={(event) => updateSceneStartSfx({ skipFirst: event.target.checked })}
            />
            <span>Bỏ cảnh đầu</span>
          </label>
          <label className="scene-start-sfx-field">
            <span>Âm lượng chung</span>
            <div className="percent-input">
              <input
                type="number"
                min="0"
                max="150"
                step="1"
                title="Đổi giá trị này sẽ đặt cả 3 pose về cùng phần trăm"
                value={volumeToPercent(sceneStartVolume)}
                onChange={(event) => updateSceneStartVolume(event.target.value)}
              />
              <b>%</b>
            </div>
            <small>{volumeDeltaLabel(sceneStartVolume)}</small>
          </label>
          <label className="scene-start-sfx-field">
            <span>Trễ ms</span>
            <input
              type="number"
              min="0"
              max="3000"
              step="10"
              value={sceneStartOffset}
              onChange={(event) => updateSceneStartSfx({ offsetMs: clampNumber(event.target.value, 0, 3000, sceneStartOffset) })}
            />
          </label>
        </div>
       </section>
       </CollapsibleGroup>
       <CollapsibleGroup
         title="Trạng thái tạo audio"
        meta={audioJob ? `${audioJob.status || "đang chờ"}${voiceDirty ? " · cần tạo lại" : ""}` : "Chưa có job"}
        className="detail-collapsible-panel"
        open={audioSections.isOpen("audio-status")}
        onToggle={() => audioSections.setSectionOpen("audio-status", !audioSections.isOpen("audio-status"))}
      >
        <JobProgressCard job={audioJob} logs={audioLogs} kind="audio" lineCount={(config.lines || []).length} />
      <JobLogDetails jobs={jobs} selectedJobId={selectedJobId} setSelectedJobId={setSelectedJobId} logs={logs} label="Xem log âm thanh" />
      </CollapsibleGroup>
      {soundImportDraft ? (
        <SoundImportModal
          draft={soundImportDraft}
          sources={sourceOptions}
          busy={audioBusy}
          onClose={() => setSoundImportDraft(null)}
          onSave={saveSoundImport}
        />
      ) : null}
    </div>
  );
}

function CaptionTab({ config, updateConfig, busy, onSaveTemplate, onApplyTemplate }) {
  const [captionPresetsOpen, setCaptionPresetsOpen] = useState(false);
  const captionSections = useOpenSections(["caption-motion", "caption-controls"]);
  if (!config) return <div className="empty">Chưa chọn project.</div>;
  const selectedStyle = CAPTION_STYLES.find((item) => item.id === config.caption.style) || CAPTION_STYLES[0];
  const captionIsCustom = config.caption.presetId === "custom";
  const matchedPreset = CAPTION_PRESETS.find((item) => item.id === config.caption.presetId)
    || CAPTION_PRESETS.find((item) => item.style === config.caption.style && item.animation === (config.caption.animation || "word-pop"))
    || CAPTION_PRESETS[0];
  const selectedPreset = captionIsCustom ? { id: "custom", name: "Tùy biến" } : matchedPreset;
  const collapsedCaptionPresets = (() => {
    const visible = CAPTION_PRESETS.slice(0, CAPTION_PRESET_COLLAPSED_COUNT);
    if (captionIsCustom || visible.some((preset) => preset.id === selectedPreset.id)) return visible;
    const activePreset = CAPTION_PRESETS.find((preset) => preset.id === selectedPreset.id);
    return activePreset ? [...visible.slice(0, CAPTION_PRESET_COLLAPSED_COUNT - 1), activePreset] : visible;
  })();
  const visibleCaptionPresets = captionPresetsOpen ? CAPTION_PRESETS : collapsedCaptionPresets;
  const hiddenCaptionPresetCount = Math.max(0, CAPTION_PRESETS.length - visibleCaptionPresets.length);
  const activeAnimationId = config.caption.animation || "word-pop";
  const selectedAnimation = CAPTION_ANIMATIONS.find((item) => item.id === activeAnimationId) || CAPTION_ANIMATIONS[0];
  const activeFontFamily = CAPTION_FONT_OPTIONS.some((font) => font.family === config.caption.fontFamily)
    ? config.caption.fontFamily
    : DEFAULT_CAPTION_FONT_FAMILY;
  const previewFontSize = clampNumber(config.caption.fontSize, 44, 108, 78);
  const previewCaptionY = clampNumber(config.layout?.captionY, 680, 1040, 810);
  const previewStrokeWidth = clampNumber(config.caption.strokeWidth, 4, 18, 10);
  const previewWordGap = clampNumber(config.caption.wordGap, 0, 32, 0);
  return (
    <div className="tab-body">
      <TemplatePartActions type="caption" label="phụ đề" busy={busy} onSave={onSaveTemplate} onApply={onApplyTemplate} />
      <div
        className={`caption-sample ${selectedStyle.id} ${selectedAnimation.id} ${config.caption.uppercase ? "uppercase" : ""}`}
        style={{ fontFamily: captionFontStack(activeFontFamily), "--caption-preview-stroke": `${previewStrokeWidth}px`, "--caption-preview-word-gap": `${previewWordGap}px` }}
      >
        <span style={{ color: config.caption.normalColor }}>đây</span>
        <span className="caption-sample-space"> </span>
        <span style={{ color: config.caption.normalColor }}>là</span>
        <span className="caption-sample-space"> </span>
        <span className="caption-sample-active" style={{ color: config.caption.hotColor }}>ly</span>
        <span className="caption-sample-space"> </span>
        <span className="caption-sample-active" style={{ color: config.caption.hotColor }}>hôn</span>
        <span style={{ color: config.caption.normalColor }}>.</span>
      </div>
      <div className="caption-preset-section">
        <button
          type="button"
          className="caption-preset-toggle"
          aria-expanded={captionPresetsOpen}
          aria-controls="caption-preset-grid"
          onClick={() => setCaptionPresetsOpen((open) => !open)}
        >
          <span>
            <strong>Mẫu phụ đề</strong>
            <small>{captionPresetsOpen ? `${CAPTION_PRESETS.length} mẫu` : `${visibleCaptionPresets.length}/${CAPTION_PRESETS.length} mẫu`}</small>
          </span>
          {captionPresetsOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
        <div id="caption-preset-grid" className={`caption-style-grid ${captionPresetsOpen ? "expanded" : "collapsed"}`}>
          {visibleCaptionPresets.map((preset) => (
            <button
              type="button"
              key={preset.id}
              className={selectedPreset.id === preset.id ? "selected" : ""}
              aria-pressed={selectedPreset.id === preset.id}
              onClick={() => updateConfig((draft) => {
                applyCaptionPreset(draft, preset);
              })}
            >
              <div className={`caption-style-preview ${preset.style}`}><b>đây là </b><em>từ khóa</em></div>
              <strong>{preset.name}</strong>
            </button>
          ))}
        </div>
        {hiddenCaptionPresetCount > 0 ? (
          <button type="button" className="caption-preset-more" onClick={() => setCaptionPresetsOpen(true)}>
            <ChevronDown size={16} /> Xem thêm {hiddenCaptionPresetCount} mẫu
          </button>
        ) : (
          <button type="button" className="caption-preset-more" onClick={() => setCaptionPresetsOpen(false)}>
            <ChevronUp size={16} /> Thu gọn
          </button>
        )}
      </div>
      <SectionCollapseControls
        allOpen={captionSections.allOpen}
        allClosed={captionSections.allClosed}
        onExpandAll={() => captionSections.setAllOpen(true)}
        onCollapseAll={() => captionSections.setAllOpen(false)}
      />
      <CollapsibleGroup
        title="Hiệu ứng đọc"
        meta={selectedAnimation.name}
        className="detail-collapsible-panel"
        open={captionSections.isOpen("caption-motion")}
        onToggle={() => captionSections.setSectionOpen("caption-motion", !captionSections.isOpen("caption-motion"))}
      >
      <div className="caption-motion-grid">
        {CAPTION_ANIMATIONS.map((animation) => (
          <button
            type="button"
            key={animation.id}
            className={activeAnimationId === animation.id ? "selected" : ""}
            aria-pressed={activeAnimationId === animation.id}
            onClick={() => updateConfig((draft) => {
              draft.caption.animation = animation.id;
              draft.caption.presetId = "custom";
            })}
          >
            <strong>{animation.name}</strong>
          </button>
        ))}
      </div>
      </CollapsibleGroup>
      <CollapsibleGroup
        title="Tùy chỉnh phụ đề"
        meta={`${Math.round(previewFontSize)} px · ${activeFontFamily}`}
        className="detail-collapsible-panel"
        open={captionSections.isOpen("caption-controls")}
        onToggle={() => captionSections.setSectionOpen("caption-controls", !captionSections.isOpen("caption-controls"))}
      >
      <div className="form-grid two caption-control-grid">
        <label className="caption-number-field">Cỡ chữ<input type="number" min="44" max="108" value={previewFontSize} onChange={(event) => updateConfig((draft) => { draft.caption.fontSize = clampNumber(event.target.value, 44, 108, draft.caption.fontSize || previewFontSize); draft.caption.presetId = "custom"; })} /></label>
        <label className="caption-color-field">Màu chữ thường<input type="color" value={config.caption.normalColor} onChange={(event) => updateConfig((draft) => { draft.caption.normalColor = event.target.value; draft.caption.presetId = "custom"; })} /></label>
        <label className="caption-color-field">Màu highlight<input type="color" value={config.caption.hotColor} onChange={(event) => updateConfig((draft) => { draft.caption.hotColor = event.target.value; draft.caption.presetId = "custom"; })} /></label>
        <label className="caption-color-field">Màu viền chữ<input type="color" value={config.caption.strokeColor} onChange={(event) => updateConfig((draft) => { draft.caption.strokeColor = event.target.value; draft.caption.presetId = "custom"; })} /></label>
        <label className="caption-range-field wide"><span>Vị trí phụ đề</span> <strong>{Math.round(previewCaptionY)} px</strong><input type="range" min="680" max="1040" step="10" value={previewCaptionY} onChange={(event) => updateConfig((draft) => { draft.layout.captionY = clampNumber(event.target.value, 680, 1040, previewCaptionY); draft.layout.captionYExplicit = true; draft.caption.presetId = "custom"; })} /></label>
        <label>Font chữ
          <select value={activeFontFamily} onChange={(event) => updateConfig((draft) => {
            draft.caption.fontFamily = event.target.value;
            draft.character = { ...(draft.character || {}), captionFontFamily: event.target.value };
            draft.caption.presetId = "custom";
          })}>
            {CAPTION_FONT_OPTIONS.map((font) => (
              <option key={font.id} value={font.family}>{font.label}</option>
            ))}
          </select>
        </label>
        <label>Độ dày viền
          <select value={previewStrokeWidth} onChange={(event) => updateConfig((draft) => { draft.caption.strokeWidth = clampNumber(event.target.value, 4, 18, previewStrokeWidth); draft.caption.presetId = "custom"; })}>
            {CAPTION_STROKE_WIDTH_OPTIONS.map((width) => (
              <option key={width} value={width}>{width}px</option>
            ))}
          </select>
        </label>
        <label>Viết hoa
          <select value={config.caption.uppercase ? "true" : "false"} onChange={(event) => updateConfig((draft) => { draft.caption.uppercase = event.target.value === "true"; draft.caption.presetId = "custom"; })}>
            <option value="true">Bật</option>
            <option value="false">Tắt</option>
          </select>
        </label>
        <label className="caption-range-field wide"><span>Khoảng cách từ</span> <strong>{Math.round(previewWordGap)} px</strong><input type="range" min="0" max="32" step="1" value={previewWordGap} onChange={(event) => updateConfig((draft) => { draft.caption.wordGap = clampNumber(event.target.value, 0, 32, previewWordGap); draft.caption.presetId = "custom"; })} /></label>
        <div className="caption-position-actions wide">
          <button type="button" onClick={() => updateConfig((draft) => { draft.layout.captionY = clampNumber(finiteNumber(draft.layout.captionY, 810) - 20, 620, 1100, previewCaptionY); draft.layout.captionYExplicit = true; draft.caption.presetId = "custom"; })}><ArrowUp size={16} /> Đẩy lên</button>
          <button type="button" onClick={() => updateConfig((draft) => { draft.layout.captionY = clampNumber(finiteNumber(draft.layout.captionY, 810) + 20, 620, 1100, previewCaptionY); draft.layout.captionYExplicit = true; draft.caption.presetId = "custom"; })}><ArrowDown size={16} /> Đẩy xuống</button>
        </div>
      </div>
      </CollapsibleGroup>
    </div>
  );
}

function FinalSnapshotPreview({ snapshot }) {
  const props = snapshot?.props;
  if (!props) return <div className="empty">Chưa có bản render để chốt.</div>;
  const durationInFrames = Math.max(30, Math.ceil(Number(props.durationInSeconds || 3) * 30));
  return (
    <section className={`final-preview-panel ${snapshot.stale ? "stale" : ""}`}>
      <div className="final-preview-head">
        <div>
          <span className="eyebrow">Chốt bản render</span>
          <strong>{snapshot.stale ? "Đã cũ so với chỉnh sửa mới" : "Bản này sẽ được render"}</strong>
        </div>
        <div className="snapshot-badges">
          <span>{snapshot.lineCount || props.lines?.length || 0} dòng</span>
          <span>{Number(snapshot.durationInSeconds || props.durationInSeconds || 0).toFixed(2)}s</span>
        </div>
      </div>
      <div className="final-player-shell">
        <Suspense fallback={<div className="remotion-fallback final">Đang tải bản render...</div>}>
          <RemotionPlayerView
            inputProps={props}
            durationInFrames={durationInFrames}
            compositionWidth={1080}
            compositionHeight={1920}
            fps={30}
            numberOfSharedAudioTags={5}
            controls
            className="final-remotion-preview"
            style={{ width: "100%", height: "100%" }}
          />
        </Suspense>
      </div>
    </section>
  );
}

function RenderTab({ selectedSlug, selectedVideo, jobs, selectedJobId, setSelectedJobId, logs, runJob, cancelJob, updateConfig, busy, finalSnapshot, snapshotBusy, onCreateFinalPreview, contentDraftIsDirty = false, aimaxApiKey = "" }) {
  const config = selectedVideo?.config;
  const preferredMode = config?.render?.preferredMode === "classic" ? "classic" : "gpu";
  const [renderMode, setRenderMode] = useState(preferredMode);
  const [renderView, setRenderView] = useState("preview");
  const renderSections = useOpenSections(["render-output"]);
  const renderModeOptions = [
    { id: "gpu", label: "GPU" },
    { id: "classic", label: "Thường" },
  ];
  const selectedRenderMode = renderModeOptions.find((option) => option.id === renderMode) || renderModeOptions[0];
  const latestRender = selectedVideo?.renders?.[0];
  const selectedJob = jobs.find((job) => job.id === selectedJobId) || null;
  const renderJob = isRenderJob(selectedJob) ? selectedJob : newestJob(jobs, selectedSlug, (job) => isRenderJob(job));
  const renderLogs = renderJob?.id === selectedJobId ? logs : "";
  const renderKind = renderJob?.type === "remotion-check" ? "check" : "render";
  const renderBusy = busy || isRunningJob(renderJob);
  const renderInProgress = renderJob?.type === "remotion-render" && isRunningJob(renderJob);
  const canCancelRenderJob = isRunningJob(renderJob);
  const cancelRenderLabel = renderJob?.type === "remotion-check" ? "Dừng kiểm tra" : "Dừng render";
  const voiceDirty = Boolean(config?.lines?.some((line) => line.dirtyVoice));
  const pipeline = selectedVideo?.pipelineStatus || {};
  const pipelineErrors = Array.isArray(pipeline.errors) ? pipeline.errors : [];
  const hasProjectErrors = pipelineErrors.length > 0;
  const audioState = pipeline.audio || (voiceDirty ? "dirty" : "ready");
  const snapshotState = finalSnapshot?.exists
    ? (finalSnapshot.stale || pipeline.snapshot === "dirty" ? "dirty" : "ready")
    : (pipeline.snapshot || "missing");
  const renderState = pipeline.render || (latestRender ? "official" : "missing");
  const audioReady = audioState === "ready";
  const renderIsCurrent = renderState === "official";
  const officialRender = selectedVideo?.officialRender || pipeline.officialRender || latestRender || null;
  const hasOfficialRender = Boolean(officialRender?.url);
  const snapshotReady = snapshotState === "ready" && Boolean(finalSnapshot?.exists && !finalSnapshot?.stale && finalSnapshot?.props);
  const latestRenderMode = officialRender?.renderMode === "gpu" || officialRender?.name?.includes("-remotion-gpu-") ? "GPU" : officialRender?.renderMode === "classic" || officialRender?.name?.includes("-remotion-classic-") ? "Thường" : "";
  const completedRenderMode = renderJob?.result?.renderMode === "gpu" ? "GPU" : renderJob?.result?.renderMode === "classic" ? "Thường" : "";
  const renderModeLabel = completedRenderMode || latestRenderMode;
  const visibleRenderSize = officialRender?.size ? `${(officialRender.size / (1024 * 1024)).toFixed(1)} MB` : "";
  const audioText = audioState === "ready" ? "OK" : audioState === "missing" ? "Thiếu audio" : "Tạo audio";
  const snapshotText = snapshotState === "ready" ? "OK" : snapshotState === "dirty" ? "Chốt lại" : "Chưa có";
  const renderText = renderInProgress ? "Đang render" : renderIsCurrent ? (renderModeLabel ? `OK ${renderModeLabel}` : "OK") : hasOfficialRender ? "Cũ" : renderState === "dirty" ? "Render lại" : "Chưa có";
  const audioNeedsWork = !audioReady || voiceDirty;
  const characterIssue = characterRenderIssue(config);
  const snapshotBlocked = contentDraftIsDirty || !audioReady || hasProjectErrors || Boolean(characterIssue);
  const renderBlocked = contentDraftIsDirty || !audioReady || hasProjectErrors || Boolean(characterIssue);
  const officialStatusText = renderIsCurrent ? "Đang khớp" : "Cũ so với chỉnh sửa mới";
  const activeRenderView = renderView === "finished" && hasOfficialRender ? "finished" : "preview";
  const hasPreviewSnapshot = Boolean(finalSnapshot?.props);
  const previewActionCreatesSnapshot = !hasPreviewSnapshot || (!renderInProgress && (finalSnapshot?.stale || snapshotState !== "ready"));
  const previewActionDisabled = snapshotBusy
    || !selectedSlug
    || (previewActionCreatesSnapshot && (renderBusy || snapshotBlocked));
  const previewActionTitle = renderInProgress && hasPreviewSnapshot
    ? "Xem bản render đã chốt trong khi Render MP4 vẫn chạy."
    : "Tạo hoặc cập nhật bản render sẽ dùng cho MP4.";

  useEffect(() => {
    if (!hasOfficialRender && renderView === "finished") setRenderView("preview");
  }, [hasOfficialRender, renderView]);

  useEffect(() => {
    setRenderMode(preferredMode);
  }, [preferredMode, selectedSlug]);

  useEffect(() => {
    if (renderJob?.type === "remotion-render" && renderJob.status === "completed" && hasOfficialRender) {
      setRenderView("finished");
    }
  }, [hasOfficialRender, renderJob?.id, renderJob?.status, renderJob?.type]);

  async function handleCreateFinalPreview() {
    setRenderView("preview");
    if (!previewActionCreatesSnapshot) return finalSnapshot || null;
    return onCreateFinalPreview();
  }

  async function handleRender() {
    setRenderView("preview");
    if (!snapshotReady) {
      const snapshot = await onCreateFinalPreview();
      if (!snapshot?.exists || snapshot.stale) return null;
    }
    if (hasOfficialRender) setRenderView("finished");
    return runJob(`/api/videos/${selectedSlug}/render`, { renderMode });
  }

  return (
    <div className="tab-body render-tab">
      <section className="snapshot-flow">
        <div className={audioState === "ready" ? "ready" : "warn"}>
          <span>1</span>
          <strong>Âm thanh</strong>
          <small>{audioText}</small>
        </div>
        <div className={snapshotReady ? "ready" : snapshotState === "dirty" ? "warn" : ""}>
          <span>2</span>
          <strong>Chốt bản render</strong>
          <small>{snapshotText}</small>
        </div>
        <div className={renderIsCurrent ? "ready" : renderInProgress || hasOfficialRender || renderState === "dirty" ? "warn" : ""}>
          <span>3</span>
          <strong>Render MP4</strong>
          <small>{renderText}</small>
        </div>
      </section>
      <section className="render-action-panel">
        {contentDraftIsDirty ? <div className="warning action-required" role="status">Bản nháp chưa dùng cho render. Bấm Lưu content ở panel Kịch bản để chốt trước khi render.</div> : null}
        {audioNeedsWork ? <div className="warning action-required" role="status">{audioState === "missing" ? "Chưa có âm thanh. Tạo âm thanh trước khi chốt bản render." : "Âm thanh đang cũ. Tạo lại âm thanh trước khi chốt bản render."}</div> : null}
        {snapshotState === "dirty" && !audioNeedsWork ? <div className="warning action-required" role="status">Bản render đã chốt đã cũ. Bấm Render MP4 sẽ tự chốt lại trước.</div> : null}
        {hasProjectErrors ? <div className="warning action-required" role="status">Project còn lỗi: {pipelineErrors[0]}</div> : null}
        {characterIssue ? <div className="warning action-required" role="status">{characterIssue}</div> : null}
        <div className="render-mode-panel">
          <div className="render-mode-copy">
            <span className="eyebrow">Chế độ render</span>
            <strong>{selectedRenderMode.label}</strong>
          </div>
          <div className="render-mode-selector" role="radiogroup" aria-label="Chọn chế độ render">
            {renderModeOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`render-mode-option ${renderMode === option.id ? "active" : ""}`}
                role="radio"
                aria-checked={renderMode === option.id}
                onClick={() => {
                  setRenderMode(option.id);
                  updateConfig?.((draft) => {
                    draft.render = { ...(draft.render || {}), preferredMode: option.id };
                  }, { staleSnapshot: false });
                }}
              >
                <strong>{option.label}</strong>
              </button>
            ))}
          </div>
        </div>
        <div className="button-line render-actions">
          <ActionButton disabled={previewActionDisabled} tone={snapshotReady ? "quiet" : "primary"} title={previewActionTitle} onClick={handleCreateFinalPreview}><Play size={16} /> Chốt bản render</ActionButton>
          {audioNeedsWork ? <ActionButton disabled={renderBusy || !selectedSlug || contentDraftIsDirty} tone="quiet" onClick={() => runJob(`/api/videos/${selectedSlug}/generate-vo`, buildAimaxJobBody({ voiceId: config?.audio?.voiceId, speed: config?.audio?.speed, pitch: config?.audio?.pitch, apiKey: aimaxApiKey }))}><FileAudio size={16} /> Tạo lại âm thanh</ActionButton> : null}
          <ActionButton disabled={renderBusy || !selectedSlug || renderBlocked} tone={snapshotReady ? "primary" : "quiet"} title={renderBlocked ? "Hãy hoàn tất content, audio và các kiểm tra project trước khi render." : "Render MP4 từ bản render đã chốt."} onClick={handleRender}><Clapperboard size={16} /> Render MP4</ActionButton>
          {canCancelRenderJob ? <ActionButton tone="danger" onClick={() => cancelJob?.(renderJob.id)}><X size={16} /> {cancelRenderLabel}</ActionButton> : null}
        </div>
        <JobProgressCard job={renderJob} logs={renderLogs} kind={renderKind} lineCount={selectedVideo?.config?.lines?.length || 0} />
      </section>
      <CollapsibleGroup
        title="Kết quả render"
        meta={activeRenderView === "finished" ? "Bản hoàn thiện" : "Chốt bản render"}
        className="detail-collapsible-panel render-output-collapsible"
        open={renderSections.isOpen("render-output")}
        onToggle={() => renderSections.setSectionOpen("render-output", !renderSections.isOpen("render-output"))}
      >
      <div className="render-output-tabs" role="tablist" aria-label="Chọn bản xem render">
        <button
          type="button"
          role="tab"
          aria-selected={activeRenderView === "preview"}
          className={activeRenderView === "preview" ? "active" : ""}
          onClick={() => setRenderView("preview")}
        >
          Chốt bản render
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeRenderView === "finished"}
          className={activeRenderView === "finished" ? "active" : ""}
          disabled={!hasOfficialRender}
          onClick={() => setRenderView("finished")}
        >
          Hoàn thiện
        </button>
      </div>
      {activeRenderView === "finished" ? (
        hasOfficialRender ? (
          <section className={`official-render-panel ${renderIsCurrent ? "" : "stale"}`}>
            <div className="official-render-head">
              <div>
                <span className="eyebrow">Hoàn thiện</span>
                <strong>{officialRender.name}</strong>
              </div>
              <div className="snapshot-badges">
                <span className={renderIsCurrent ? "official-current" : "official-stale"}>{officialStatusText}</span>
                {renderModeLabel ? <span>{renderModeLabel}</span> : null}
                {visibleRenderSize ? <span>{visibleRenderSize}</span> : null}
              </div>
            </div>
            <div className="official-render-actions">
              <span>{renderIsCurrent ? "MP4 khớp" : "Bản cũ"}</span>
              <a className="action quiet" href={officialRender.url} download={officialRender.name}><Download size={16} /> Tải MP4</a>
            </div>
            <video key={officialRender.url} className="output-video" src={officialRender.url} controls />
          </section>
        ) : (
          <div className="empty">Chưa có bản MP4 hoàn thiện.</div>
        )
      ) : renderInProgress ? (
        <div className="empty">Đang render bản chính thức mới.</div>
      ) : (
        <FinalSnapshotPreview snapshot={finalSnapshot} />
      )}
      <JobLogDetails jobs={jobs} selectedJobId={selectedJobId} setSelectedJobId={setSelectedJobId} logs={logs} label="Xem log render" />
      </CollapsibleGroup>
    </div>
  );
}

function ScriptPanel({ config, currentIndex, setCurrentIndex, updateConfig, normalizeLines, busy }) {
  if (!config) return <aside className="script-panel empty">Chưa chọn project.</aside>;
  const script = contentFromLines(config.lines);
  const lineCount = config.lines.length;
  const dirtyLineCount = config.lines.filter((line) => line.dirtyVoice).length;
  return (
    <aside className="script-panel">
      <div className="script-head">
        <ActionButton tone="quiet" disabled={busy} onClick={normalizeLines}><Wand2 size={15} /> Gán nhân vật</ActionButton>
      </div>
      <div className="script-meta">
        <span>{lineCount} dòng</span>
        {dirtyLineCount ? <span>{dirtyLineCount} cần audio</span> : <span>Audio khớp</span>}
      </div>
      {dirtyLineCount ? <div className="warning">Tạo lại âm thanh trước khi chốt bản render.</div> : null}
      <textarea className="script-textarea" aria-label="Kịch bản theo dòng" placeholder="Mỗi dòng là một cảnh." value={script} onChange={(event) => {
        const values = event.target.value.split(/\r?\n/);
        updateConfig((draft) => {
          draft.lines = values.map((text, index) => {
            const old = draft.lines[index] || {};
            const trimmed = text.trim();
            const changed = trimmed !== (old.text || "");
            return {
              ...old,
              id: old.id || `line-${index + 1}`,
              text: trimmed,
              dirtyVoice: old.dirtyVoice || (changed && Number.isFinite(Number(old.start))),
            };
          }).filter((line) => line.text);
        });
      }} />
      <div className="line-list" aria-label="Danh sách dòng thoại">
        {config.lines.map((line, index) => (
          <button type="button" key={line.id} className={`line-item ${index === currentIndex ? "active" : ""} ${line.role || "neutral"}`} aria-current={index === currentIndex ? "true" : undefined} aria-label={`Dòng ${index + 1}: ${line.text}`} onClick={() => setCurrentIndex(index)}>
            <span>{index + 1}</span>
            <strong>{line.text}</strong>
            <small><b className="compare-set-chip">{compareSetLabel(line.compareSetId)}</b> {line.role === "question" ? "Câu hỏi" : `Nội dung ${line.role || "?"}`} · {POSE_LABELS[line.pose] || line.pose}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}

function OfficialScriptPanel({ config, currentIndex, setCurrentIndex, updateContentDraft, commitContent, updateConfig, normalizeLines, draftSaving, busy }) {
  const [editingLineId, setEditingLineId] = useState("");
  const [editingText, setEditingText] = useState("");
  const inlineEditorRef = useRef(null);
  useEffect(() => {
    if (!editingLineId) return undefined;
    const frame = window.requestAnimationFrame(() => inlineEditorRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editingLineId]);
  useEffect(() => {
    if (!editingLineId || !config || config.lines.some((line) => line.id === editingLineId)) return;
    setEditingLineId("");
    setEditingText("");
  }, [config, editingLineId]);
  if (!config) return <aside className="script-panel empty">Chưa chọn project.</aside>;
  const sections = draftScriptSections(config);
  const script = contentFromSections(sections);
  const officialCount = Number(config.contentOfficial?.lineCount || config.lines.length);
  const draftCount = draftLineCount(config);
  const draftDirty = contentDraftDirty(config);
  const dirtyLineCount = config.lines.filter((line) => line.dirtyVoice).length;
  const poseStartSide = config.poseStartSide === "right" ? "right" : "left";
  const sectionCounts = Object.fromEntries(COMPARE_SET_IDS.map((id) => [
    id,
    normalizeScriptText(sections[id]).split("\n").filter(Boolean).length,
  ]));
  const canQuickEdit = !busy && !draftDirty;
  const startQuickEdit = (line, index) => {
    if (!canQuickEdit) return;
    setCurrentIndex(index);
    setEditingLineId(line.id);
    setEditingText(line.text || "");
  };
  const cancelQuickEdit = () => {
    setEditingLineId("");
    setEditingText("");
  };
  const saveQuickEdit = () => {
    const nextText = normalizeScriptLine(editingText);
    const targetIndex = config.lines.findIndex((line) => line.id === editingLineId);
    if (!nextText || targetIndex < 0) return;
    const target = config.lines[targetIndex];
    const targetSetId = normalizeCompareSetId(target.compareSetId);
    const nextSections = contentSectionsFromLines(config.lines);
    const targetLines = normalizeScriptText(nextSections[targetSetId]).split("\n").filter(Boolean);
    const targetLineIndex = config.lines
      .slice(0, targetIndex)
      .filter((line) => normalizeCompareSetId(line.compareSetId) === targetSetId)
      .length;
    if (targetLineIndex >= targetLines.length) return;
    targetLines[targetLineIndex] = nextText;
    updateContentDraft({ ...nextSections, [targetSetId]: targetLines.join("\n") });
    cancelQuickEdit();
  };
  const quickEditKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelQuickEdit();
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      saveQuickEdit();
    }
  };
  const displayLineText = (line, index) => {
    if (editingLineId === line.id) return editingText;
    if (!draftDirty) return line.text;
    const targetSetId = normalizeCompareSetId(line.compareSetId);
    const targetLineIndex = config.lines
      .slice(0, index)
      .filter((item) => normalizeCompareSetId(item.compareSetId) === targetSetId)
      .length;
    const draftLines = normalizeScriptText(sections[targetSetId]).split("\n").filter(Boolean);
    return draftLines[targetLineIndex] || line.text;
  };
  return (
    <aside className="script-panel">
      <div className="script-head">
        <div className="script-actions">
          <div className="pose-start-selector" role="radiogroup" aria-label="Bắt đầu chỉ bên">
            {[
              ["left", "Trái"],
              ["right", "Phải"],
            ].map(([side, label]) => (
              <button
                type="button"
                key={side}
                className={poseStartSide === side ? "selected" : ""}
                role="radio"
                aria-checked={poseStartSide === side}
                onClick={() => updateConfig((draft) => { draft.poseStartSide = side; })}
              >
                {label}
              </button>
            ))}
          </div>
          <ActionButton tone="quiet" disabled={busy || draftDirty} onClick={normalizeLines}><Wand2 size={15} /> Gán nhân vật</ActionButton>
          <ActionButton disabled={busy} onClick={() => commitContent(sections)}><Save size={15} /> Lưu content</ActionButton>
        </div>
      </div>
      <div className={`content-official-status ${draftDirty ? "dirty" : "saved"}`} role="status" aria-live="polite">
        <strong>{officialCount} dòng content</strong>
        <span>{draftDirty ? `Bản nháp ${draftCount} dòng chưa lưu content` : "Content đã lưu"}</span>
        <div className="content-official-pills">
          {draftSaving ? <small>{draftSaving}</small> : null}
          <small>{dirtyLineCount ? `${dirtyLineCount} cần audio` : "Audio khớp"}</small>
        </div>
      </div>
      <div className={`script-edit-hint ${draftDirty ? "draft" : "ready"}`} role="note">
        <Pencil size={14} />
        <span>{draftDirty ? "Bản nháp đang mở: sửa trong ô Kịch bản, rồi bấm Lưu content." : "Bấm Sửa cạnh từng dòng để chỉnh nhanh, sau đó bấm Lưu content để chốt."}</span>
      </div>
      {draftDirty ? <div className="warning action-required" role="status">Bản nháp chưa dùng cho preview/render. Bấm Lưu content để chốt.</div> : null}
      {dirtyLineCount && !draftDirty ? <div className="warning action-required" role="status">Tạo lại âm thanh trước khi chốt bản render.</div> : null}
      {false ? <textarea
        className="script-textarea"
        aria-label="Kịch bản theo dòng"
        placeholder="Mỗi dòng là một cảnh."
        value={script}
        disabled={busy}
        onChange={(event) => updateContentDraft(event.target.value)}
      /> : null}
      <div className="script-section-grid">
        {COMPARE_SET_IDS.map((id) => (
          <label className="script-section-field" key={id}>
            <span>{compareSetTitle(id)} <strong>{sectionCounts[id]} dòng</strong></span>
            <textarea
              className="script-textarea"
              aria-label={`Kịch bản ${compareSetTitle(id)}`}
              placeholder={`Mỗi dòng của ${compareSetLabel(id)} là một cảnh.`}
              value={sections[id] || ""}
              disabled={busy}
              onChange={(event) => updateContentDraft({ ...sections, [id]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="line-list" aria-label="Danh sách dòng thoại đã lưu content">
        {config.lines.map((line, index) => {
          const isEditing = editingLineId === line.id;
          const lineText = displayLineText(line, index);
          return (
            <div className={`line-item-shell ${isEditing ? "editing" : ""}`} key={line.id}>
              {isEditing ? (
                <div className={`line-item line-item-editor ${line.role || "neutral"}`}>
                  <span className="line-number">{index + 1}</span>
                  <div className="line-inline-editor">
                    <label className="line-inline-label">
                      <span>Nội dung dòng {index + 1}</span>
                      <input
                        ref={inlineEditorRef}
                        value={editingText}
                        aria-label={`Chỉnh nội dung dòng ${index + 1}`}
                        onChange={(event) => setEditingText(event.target.value)}
                        onKeyDown={quickEditKeyDown}
                        disabled={busy}
                      />
                    </label>
                    <div className="line-inline-actions">
                      <button type="button" className="line-inline-save" disabled={busy || !normalizeScriptLine(editingText)} onClick={saveQuickEdit}>Lưu dòng</button>
                      <button type="button" className="line-inline-cancel" disabled={busy} onClick={cancelQuickEdit}>Hủy</button>
                    </div>
                    <small className="line-inline-help">Enter để lưu · Esc để hủy</small>
                  </div>
                </div>
              ) : (
                <>
                  <button type="button" className={`line-item ${index === currentIndex ? "active" : ""} ${line.role || "neutral"}`} aria-current={index === currentIndex ? "true" : undefined} aria-label={`Dòng ${index + 1}: ${lineText}`} onClick={() => setCurrentIndex(index)}>
                    <span className="line-number">{index + 1}</span>
                    <strong>{lineText}</strong>
                    <small><b className="compare-set-chip">{compareSetLabel(line.compareSetId)}</b> {line.role === "question" ? "Câu hỏi" : `Nội dung ${line.role || "?"}`} - {POSE_LABELS[line.pose] || line.pose}</small>
                  </button>
                  <button
                    type="button"
                    className="line-item-edit"
                    disabled={!canQuickEdit}
                    title={draftDirty ? "Hãy lưu content trước khi sửa nhanh từng dòng" : "Sửa nhanh dòng này"}
                    aria-label={`Sửa nhanh dòng ${index + 1}`}
                    onClick={() => startQuickEdit(line, index)}
                  >
                    <Pencil size={14} /> <span>Sửa</span>
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function UploadButton({ label, accept, onChange, disabled, multiple = false }) {
  return (
    <label className={`upload-button ${disabled ? "disabled" : ""}`}>
      <UploadCloud size={16} /> {label}
      <input disabled={disabled} type="file" multiple={multiple} accept={accept} onChange={onChange} />
    </label>
  );
}

createRoot(document.getElementById("root")).render(<App />);
