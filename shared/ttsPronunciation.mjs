const ACRONYM_PRONUNCIATIONS = new Map([
  ["ADN", "a đê en"],
  ["DNA", "đi en ây"],
  ["AI", "ây ai"],
  ["CPU", "xê piu"],
  ["GPU", "gi piu"],
  ["USB", "u ét bê"],
  ["MP4", "em pi bốn"],
  ["VO", "vi ô"],
]);

const LETTER_PRONUNCIATIONS = {
  A: "a",
  B: "bê",
  C: "xê",
  D: "đê",
  E: "e",
  F: "ép",
  G: "giê",
  H: "hát",
  I: "i",
  J: "gi",
  K: "ca",
  L: "en lờ",
  M: "em mờ",
  N: "en",
  O: "ô",
  P: "pê",
  Q: "quy",
  R: "a rờ",
  S: "ét",
  T: "tê",
  U: "u",
  V: "vê",
  W: "đáp liu",
  X: "ích",
  Y: "i dài",
  Z: "dét",
};

export function normalizeVoiceWhitespace(value = "") {
  return String(value || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function spellAcronym(value = "") {
  const token = String(value || "").toUpperCase();
  if (ACRONYM_PRONUNCIATIONS.has(token)) return ACRONYM_PRONUNCIATIONS.get(token);
  return [...token].map((letter) => LETTER_PRONUNCIATIONS[letter] || letter.toLowerCase()).join(" ");
}

export function pronounceAcronymsForTts(text = "") {
  const normalized = normalizeVoiceWhitespace(text);
  return normalizeVoiceWhitespace(normalized.replace(
    /(^|[^\p{L}\p{N}])([A-Z]{2,6})(?=$|[^\p{L}\p{N}])/gu,
    (_match, prefix, token) => `${prefix}${spellAcronym(token)}`,
  ));
}

export function displayTextForLine(line = {}) {
  return normalizeVoiceWhitespace(line?.text || line?.caption || line?.tts || "");
}

export function explicitTtsForLine(line = {}) {
  return normalizeVoiceWhitespace(line?.tts || "");
}

export function voiceTextForLine(line = {}) {
  const explicit = explicitTtsForLine(line);
  if (explicit) return explicit;
  return pronounceAcronymsForTts(displayTextForLine(line));
}

export function hasPronunciationExpansion(text = "", voiceText = "") {
  const display = normalizeVoiceWhitespace(text);
  const spoken = normalizeVoiceWhitespace(voiceText || pronounceAcronymsForTts(display));
  return Boolean(display && spoken && display !== spoken);
}

export function minimumReadableDuration(text = "", options = {}) {
  const display = normalizeVoiceWhitespace(text);
  const spoken = normalizeVoiceWhitespace(options.voiceText || pronounceAcronymsForTts(display));
  const displayLetters = [...display.replace(/[^\p{L}\p{N}]+/gu, "")].length;
  const displayWords = display.split(/\s+/).filter(Boolean).length;
  const spokenLetters = [...spoken.replace(/[^\p{L}\p{N}]+/gu, "")].length;
  const spokenWords = spoken.split(/\s+/).filter(Boolean).length;
  let minimum = Math.max(0.45, displayLetters / 32, displayWords / 5.5, spokenLetters / 32, spokenWords / 5.5);
  if (options.hasPronunciationExpansion ?? hasPronunciationExpansion(display, spoken)) {
    minimum = Math.max(minimum, 1.1);
  }
  return minimum;
}
