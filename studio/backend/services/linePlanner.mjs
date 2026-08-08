const POSES = new Set(["point-left", "point-right", "question"]);
const FOCUS_SIDES = new Set(["left", "right", "center"]);
const POSE_START_SIDES = new Set(["left", "right"]);
export const COMPARE_SET_IDS = ["compare-1", "compare-2"];
export const TIMELINE_START_SECONDS = 0.55;
export const LINE_GAP_SECONDS = 0;

export const SFX_RENAMES = {
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

export function migrateSfxName(name) {
  if (!name || name === "__none__") return name || "";
  return SFX_RENAMES[name] || name;
}

export const DEFAULT_CAPTION = {
  style: "vietnam-bold-highlight",
  animation: "word-pop",
  fontFamily: "Be Vietnam Pro",
  fontSize: 72,
  normalColor: "#20160f",
  hotColor: "#ff4f2f",
  strokeColor: "#fffaf0",
  strokeWidth: 10,
  wordGap: 0,
  uppercase: false,
  shadowPreset: "default",
};

export const DEFAULT_RENDER = {
  engine: "remotion",
  width: 1080,
  height: 1920,
  fps: 30,
  preferredMode: "gpu",
};

export const DEFAULT_LAYOUT = {
  width: 1080,
  height: 1920,
  compareTop: 170,
  compareHeight: 520,
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
  // Keep captions above the character by default. The editor can still move it.
  captionY: 810,
  captionYExplicit: false,
  characterY: 1180,
  characterHeight: 650,
};

export function normalizeVietnamese(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(value) {
  return normalizeVietnamese(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function splitManualTag(text) {
  const raw = String(text || "").trim();
  const match = raw.match(/^\[(point-left|point-right|question|left|right|l|r|q|\?)\]\s*/i);
  if (!match) return { text: raw, pose: "" };
  const tag = match[1].toLowerCase();
  let pose = "question";
  if (tag === "point-left" || tag === "left" || tag === "l") pose = "point-left";
  if (tag === "point-right" || tag === "right" || tag === "r") pose = "point-right";
  return { text: raw.slice(match[0].length).trim(), pose };
}

export function roleForPose(pose) {
  if (pose === "point-left") return "A";
  if (pose === "point-right") return "B";
  return "question";
}

export function focusSideForPose(pose) {
  if (pose === "point-left") return "right";
  if (pose === "point-right") return "left";
  return "center";
}

export function sfxForPose(pose) {
  if (pose === "point-left") return "mixkit-hard-pop-click.wav";
  if (pose === "point-right") return "mixkit-hard-pop-click.wav";
  return "mixkit-bubble-pop.wav";
}

function highlightForRole(role, leftLabel, rightLabel) {
  if (role === "A") return leftLabel;
  if (role === "B") return rightLabel;
  return "";
}

function subjectFromOpeningLine(text) {
  const raw = splitManualTag(text).text
    .replace(/[.,;:!?…]+$/u, "")
    .trim();
  const match = raw.match(/^(?:đây|day)\s+là\s+(.+)$/iu);
  return match ? match[1].trim() : "";
}

function termsFor(label, aliases = []) {
  const seen = new Set();
  return [label, ...aliases]
    .map((value) => String(value || "").trim())
    .map((value) => ({ value, normalized: normalizeVietnamese(value) }))
    .filter((term) => term.normalized.length > 1)
    .filter((term) => {
      if (seen.has(term.normalized)) return false;
      seen.add(term.normalized);
      return true;
    });
}

function matchingTerm(clean, terms) {
  return terms.find((term) => clean.includes(term.normalized));
}

function looksLikeQuestion(text, clean) {
  return /[?？]/.test(text)
    || /\b(khac nhau o dau|diem khac biet|su khac biet|tai sao|vi sao|the nao)\b/.test(clean);
}

export function lineGapAfterSeconds() {
  return LINE_GAP_SECONDS;
}

function fallbackPoseForIndex(index, poseStartSide = "left") {
  const firstSide = normalizePoseStartSide(poseStartSide);
  const firstPose = firstSide === "right" ? "point-right" : "point-left";
  const secondPose = firstPose === "point-left" ? "point-right" : "point-left";
  if (index === 0) return firstPose;
  if (index === 1) return secondPose;
  if (index === 2) return "question";
  return (index - 3) % 2 === 0 ? firstPose : secondPose;
}

export function normalizePoseStartSide(value, fallback = "left") {
  const side = String(value || "").trim().toLowerCase();
  if (POSE_START_SIDES.has(side)) return side;
  return POSE_START_SIDES.has(fallback) ? fallback : "left";
}

function pointingPoseForIndex(index, startSide = "left") {
  const firstSide = normalizePoseStartSide(startSide);
  const isLeft = index % 2 === 0 ? firstSide === "left" : firstSide === "right";
  return isLeft ? "point-left" : "point-right";
}

function applyPointingPose(inferred, pose, leftLabel, rightLabel) {
  if (inferred.pose === "question" || pose === inferred.pose) return inferred;
  const role = roleForPose(pose);
  return {
    ...inferred,
    role,
    pose,
    focusSide: focusSideForPose(pose),
    highlight: highlightForRole(role, leftLabel, rightLabel),
    sfx: sfxForPose(pose),
  };
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

export function normalizeCompareSetId(value, fallback = "compare-1") {
  const id = String(value || "").trim();
  return COMPARE_SET_IDS.includes(id) ? id : fallback;
}

export function normalizeFocusSide(value, fallback = "center") {
  const focusSide = String(value || "").trim();
  return FOCUS_SIDES.has(focusSide) ? focusSide : (FOCUS_SIDES.has(fallback) ? fallback : "center");
}

export function inferLine({ text, leftLabel, rightLabel, leftAliases = [], rightAliases = [], index = 0, poseStartSide = "left" } = {}) {
  const tagged = splitManualTag(text);
  if (POSES.has(tagged.pose)) {
    const role = roleForPose(tagged.pose);
    return {
      text: tagged.text,
      role,
      pose: tagged.pose,
      focusSide: focusSideForPose(tagged.pose),
      highlight: highlightForRole(role, leftLabel, rightLabel),
      sfx: sfxForPose(tagged.pose),
    };
  }

  const clean = normalizeVietnamese(tagged.text);
  const leftTerms = termsFor(leftLabel, leftAliases);
  const rightTerms = termsFor(rightLabel, rightAliases);

  if (index === 2 && looksLikeQuestion(tagged.text, clean)) {
    return {
      text: tagged.text,
      role: "question",
      pose: "question",
      focusSide: "center",
      highlight: "",
      sfx: "mixkit-bubble-pop.wav",
    };
  }

  const leftMatch = matchingTerm(clean, leftTerms);
  if (leftMatch) {
    const pose = "point-left";
    return {
      text: tagged.text,
      role: "A",
      pose,
      focusSide: focusSideForPose(pose),
      highlight: leftMatch.value || leftLabel,
      sfx: "mixkit-hard-pop-click.wav",
    };
  }

  const rightMatch = matchingTerm(clean, rightTerms);
  if (rightMatch) {
    const pose = "point-right";
    return {
      text: tagged.text,
      role: "B",
      pose,
      focusSide: focusSideForPose(pose),
      highlight: rightMatch.value || rightLabel,
      sfx: "mixkit-hard-pop-click.wav",
    };
  }

  const fallbackPose = fallbackPoseForIndex(index, poseStartSide);
  return {
    text: tagged.text,
    role: "neutral",
    pose: fallbackPose,
    focusSide: focusSideForPose(fallbackPose),
    highlight: "",
    sfx: sfxForPose(fallbackPose),
  };
}

function normalizePastedLineBreaks(content) {
  return String(content || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029]+/g, "\n")
    .replace(/\t+/g, " ")
    .replace(/([^\n])\s+([•▪▫◦‣⁃]\s+)/g, "$1\n$2")
    .replace(/([^\n])\s+(\d{1,2}[.)]\s+)/g, "$1\n$2");
}

function stripListMarker(line) {
  return String(line || "")
    .replace(/^(?:[•▪▫◦‣⁃-]\s+|\d{1,2}[.)]\s+)/, "")
    .trim();
}

export function splitContentLines(content) {
  return normalizePastedLineBreaks(content)
    .split(/\r?\n/)
    .map(stripListMarker)
    .filter(Boolean);
}

export function normalizeContentByCompareSet(value = {}) {
  if (typeof value === "string") {
    return {
      "compare-1": splitContentLines(value).join("\n"),
      "compare-2": "",
    };
  }

  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(COMPARE_SET_IDS.map((id) => [
    id,
    splitContentLines(source[id] ?? source[id.replace("compare-", "ss")] ?? "").join("\n"),
  ]));
}

export function editableContentText(value = "") {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029]+/g, "\n");
}

export function editableContentByCompareSet(value = {}) {
  if (typeof value === "string") {
    return {
      "compare-1": editableContentText(value),
      "compare-2": "",
    };
  }

  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(COMPARE_SET_IDS.map((id) => [
    id,
    editableContentText(source[id] ?? source[id.replace("compare-", "ss")] ?? ""),
  ]));
}

export function editableContentFromSections(sections = {}) {
  const editable = editableContentByCompareSet(sections);
  return COMPARE_SET_IDS
    .map((id) => editable[id])
    .filter((value) => value.length > 0)
    .join("\n");
}

export function contentFromSections(sections = {}) {
  const normalized = normalizeContentByCompareSet(sections);
  return COMPARE_SET_IDS
    .flatMap((id) => splitContentLines(normalized[id]))
    .join("\n");
}

export function contentByCompareSetFromLines(lines = []) {
  const sections = Object.fromEntries(COMPARE_SET_IDS.map((id) => [id, []]));
  for (const line of Array.isArray(lines) ? lines : []) {
    const id = normalizeCompareSetId(line?.compareSetId);
    const text = String(line?.text || line?.caption || line?.tts || "").trim();
    if (text) sections[id].push(text);
  }
  return Object.fromEntries(COMPARE_SET_IDS.map((id) => [id, sections[id].join("\n")]));
}

export function hasTiming(line) {
  return Number.isFinite(Number(line?.start)) && Number.isFinite(Number(line?.duration));
}

function fallbackLines(leftLabel, rightLabel) {
  return [
    `Đây là ${leftLabel || "A"}.`,
    `Đây là ${rightLabel || "B"}.`,
    "Khác nhau ở đâu?",
  ];
}

function compareSetById(compareSets = [], id = "compare-1", fallback = {}) {
  const found = (Array.isArray(compareSets) ? compareSets : []).find((set) => set?.id === id);
  return found || { id, ...fallback };
}

export function planGroupedLines({ contentByCompareSet, compareSets = [], previousLines = [], preserveExisting = true, forceAlternatingPoses = false, poseStartSide = "left", allowEmptyContent = false } = {}) {
  const sections = normalizeContentByCompareSet(contentByCompareSet || {});
  const hasAnyContent = COMPARE_SET_IDS.some((id) => splitContentLines(sections[id]).length);
  const planned = [];
  let pointingIndex = 0;

  for (const compareSetId of COMPARE_SET_IDS) {
    const set = compareSetById(compareSets, compareSetId);
    const rawValues = splitContentLines(sections[compareSetId]);
    const values = rawValues.length || hasAnyContent || allowEmptyContent
      ? rawValues
      : (compareSetId === "compare-1" ? fallbackLines(set.leftLabel, set.rightLabel) : []);
    const leftAliases = [subjectFromOpeningLine(values[0])].filter(Boolean);
    const rightAliases = [subjectFromOpeningLine(values[1])].filter(Boolean);

    values.forEach((value, localIndex) => {
      const index = planned.length;
      const existing = previousLines[index] || {};
      const rawInferred = inferLine({
        text: value,
        leftLabel: set.leftLabel,
        rightLabel: set.rightLabel,
        leftAliases,
        rightAliases,
        index: localIndex,
        poseStartSide,
      });
      const inferred = forceAlternatingPoses && rawInferred.pose !== "question"
        ? applyPointingPose(rawInferred, pointingPoseForIndex(pointingIndex, poseStartSide), set.leftLabel, set.rightLabel)
        : rawInferred;
      if (inferred.pose === "point-left" || inferred.pose === "point-right") pointingIndex += 1;
      const existingText = String(existing.text || existing.caption || existing.tts || "").trim();
      const textChanged = Boolean(existingText) && existingText !== inferred.text;
      const setChanged = Boolean(existingText) && normalizeCompareSetId(existing.compareSetId) !== compareSetId;
      const dirtyVoice = Boolean(existing.dirtyVoice || ((textChanged || setChanged) && hasTiming(existing)));
      const dirtyVoiceReason = dirtyVoice
        ? (existing.dirtyVoiceReason || ((textChanged || setChanged) ? "content" : ""))
        : "";
      const keepExisting = preserveExisting && !textChanged && !setChanged;
      const keepTiming = !textChanged && !setChanged && hasTiming(existing);
      const keepLockedPose = preserveExisting && Boolean(existing.poseLocked) && POSES.has(existing.pose);
      const pose = keepLockedPose || (existing.pose && keepExisting) ? existing.pose : inferred.pose;
      const inferredFocusSide = pose !== inferred.pose ? focusSideForPose(pose) : (inferred.focusSide || focusSideForPose(pose));
      const keepLockedFocusSide = preserveExisting && Boolean(existing.focusSideLocked) && FOCUS_SIDES.has(existing.focusSide);
      const focusSide = keepLockedFocusSide
        ? normalizeFocusSide(existing.focusSide, inferredFocusSide)
        : inferredFocusSide;
      const role = keepLockedPose
        ? roleForPose(pose)
        : (existing.role && keepExisting ? existing.role : inferred.role);
      const sfx = keepLockedPose
        ? (hasOwn(existing, "sfx") ? migrateSfxName(existing.sfx) : sfxForPose(pose))
        : (keepExisting && hasOwn(existing, "sfx") ? migrateSfxName(existing.sfx) : inferred.sfx);
      const sfxOffsetMs = keepExisting && Number.isFinite(Number(existing.sfxOffsetMs)) ? Number(existing.sfxOffsetMs) : undefined;
      const sfxVolume = keepExisting && Number.isFinite(Number(existing.sfxVolume)) ? Number(existing.sfxVolume) : undefined;

      planned.push({
        id: existing.id || `line-${index + 1}`,
        compareSetId,
        text: inferred.text,
        role,
        pose,
        focusSide,
        highlight: existing.highlight && keepExisting ? existing.highlight : inferred.highlight,
        sfx,
        ...(keepExisting && Array.isArray(existing.words) && existing.words.length ? { words: existing.words } : {}),
        ...(sfxOffsetMs === undefined ? {} : { sfxOffsetMs }),
        ...(sfxVolume === undefined ? {} : { sfxVolume }),
        start: keepTiming ? Number(existing.start) : null,
        duration: keepTiming ? Number(existing.duration) : null,
        poseLocked: keepLockedPose || (keepExisting && Boolean(existing.poseLocked)),
        focusSideLocked: keepLockedFocusSide || (keepExisting && Boolean(existing.focusSideLocked)),
        dirtyVoice,
        ...(dirtyVoiceReason ? { dirtyVoiceReason } : {}),
      });
    });
  }

  return planned;
}

export function planLines({ content, leftLabel, rightLabel, previousLines = [], preserveExisting = true, forceAlternatingPoses = false, poseStartSide = "left" } = {}) {
  const rawLines = splitContentLines(content);
  const values = rawLines.length ? rawLines : fallbackLines(leftLabel, rightLabel);
  const leftAliases = [subjectFromOpeningLine(values[0])].filter(Boolean);
  const rightAliases = [subjectFromOpeningLine(values[1])].filter(Boolean);
  let pointingIndex = 0;

  return values.map((value, index) => {
    const existing = previousLines[index] || {};
    const rawInferred = inferLine({ text: value, leftLabel, rightLabel, leftAliases, rightAliases, index, poseStartSide });
    const inferred = forceAlternatingPoses && rawInferred.pose !== "question"
      ? applyPointingPose(rawInferred, pointingPoseForIndex(pointingIndex, poseStartSide), leftLabel, rightLabel)
      : rawInferred;
    if (inferred.pose === "point-left" || inferred.pose === "point-right") pointingIndex += 1;
    const existingText = String(existing.text || existing.caption || existing.tts || "").trim();
    const textChanged = Boolean(existingText) && existingText !== inferred.text;
    const dirtyVoice = Boolean(existing.dirtyVoice || (textChanged && hasTiming(existing)));
    const dirtyVoiceReason = dirtyVoice
      ? (existing.dirtyVoiceReason || (textChanged ? "content" : ""))
      : "";
    const keepExisting = preserveExisting && !textChanged;
    const keepTiming = !textChanged && hasTiming(existing);
    const keepLockedPose = preserveExisting && Boolean(existing.poseLocked) && POSES.has(existing.pose);
    const pose = keepLockedPose || (existing.pose && keepExisting) ? existing.pose : inferred.pose;
    const inferredFocusSide = pose !== inferred.pose ? focusSideForPose(pose) : (inferred.focusSide || focusSideForPose(pose));
    const keepLockedFocusSide = preserveExisting && Boolean(existing.focusSideLocked) && FOCUS_SIDES.has(existing.focusSide);
    const focusSide = keepLockedFocusSide
      ? normalizeFocusSide(existing.focusSide, inferredFocusSide)
      : inferredFocusSide;
    const role = keepLockedPose
      ? roleForPose(pose)
      : (existing.role && keepExisting ? existing.role : inferred.role);
    const sfx = keepLockedPose
      ? (hasOwn(existing, "sfx") ? migrateSfxName(existing.sfx) : sfxForPose(pose))
      : (keepExisting && hasOwn(existing, "sfx") ? migrateSfxName(existing.sfx) : inferred.sfx);
    const sfxOffsetMs = keepExisting && Number.isFinite(Number(existing.sfxOffsetMs)) ? Number(existing.sfxOffsetMs) : undefined;
    const sfxVolume = keepExisting && Number.isFinite(Number(existing.sfxVolume)) ? Number(existing.sfxVolume) : undefined;

    return {
      id: existing.id || `line-${index + 1}`,
      compareSetId: normalizeCompareSetId(existing.compareSetId),
      text: inferred.text,
      role,
      pose,
      focusSide,
      highlight: existing.highlight && keepExisting ? existing.highlight : inferred.highlight,
      sfx,
      ...(keepExisting && Array.isArray(existing.words) && existing.words.length ? { words: existing.words } : {}),
      ...(sfxOffsetMs === undefined ? {} : { sfxOffsetMs }),
      ...(sfxVolume === undefined ? {} : { sfxVolume }),
      start: keepTiming ? Number(existing.start) : null,
      duration: keepTiming ? Number(existing.duration) : null,
      poseLocked: keepLockedPose || (keepExisting && Boolean(existing.poseLocked)),
      focusSideLocked: keepLockedFocusSide || (keepExisting && Boolean(existing.focusSideLocked)),
      dirtyVoice,
      ...(dirtyVoiceReason ? { dirtyVoiceReason } : {}),
    };
  });
}

export function contentFromLines(lines = []) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => String(line.text || line.caption || line.tts || "").trim())
    .filter(Boolean)
    .join("\n");
}

export function normalizePose(value, fallback = "question") {
  const pose = String(value || "").trim();
  return POSES.has(pose) ? pose : fallback;
}
