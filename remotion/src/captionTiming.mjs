function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export const TIMING_EDGE_EPSILON_MS = 16;

export function speechWeightForToken(value) {
  const text = String(value || "");
  const letterCount = [...text.replace(/[^\p{L}\p{N}]+/gu, "")].length;
  const pauseWeight = /[.!?\u2026]+$/u.test(text) ? 0.9 : /[,;:]+$/u.test(text) ? 0.45 : 0;
  return Math.max(0.75, letterCount * 0.36 + pauseWeight);
}

export function normalizedCaptionWord(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizedTimedWords(words = []) {
  return (Array.isArray(words) ? words : [])
    .map((word) => {
      const text = String(word?.text || "").trim();
      const startMs = Number(word?.startMs);
      const endMs = Number(word?.endMs);
      const normalized = normalizedCaptionWord(text);
      return text && normalized && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
        ? { text, normalized, startMs, endMs }
        : null;
    })
    .filter(Boolean);
}

function timingCenter(words, startIndex, count) {
  const first = words[startIndex];
  const last = words[startIndex + count - 1] || first;
  if (!first || !last) return 0;
  return (first.startMs + last.endMs) / 2;
}

function cueTimingCenter(cue) {
  const startMs = Number(cue?.captionChunkStartMs);
  const endMs = Number(cue?.captionChunkEndMs);
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
    return (startMs + endMs) / 2;
  }
  const cueStartMs = Number(cue?.startMs) || 0;
  const cueEndMs = Math.max(cueStartMs + 1, Number(cue?.endMs) || cueStartMs + 1);
  const chunkCount = Math.max(1, Number(cue?.captionChunkCount) || 1);
  if (chunkCount <= 1) return (cueStartMs + cueEndMs) / 2;
  const chunkIndex = Math.max(0, Math.min(chunkCount - 1, Number(cue?.captionChunkIndex) || 0));
  const chunkDuration = (cueEndMs - cueStartMs) / chunkCount;
  return cueStartMs + chunkDuration * (chunkIndex + 0.5);
}

function chooseAlignedWordStart(candidates, timedWords, visibleCount, cue) {
  if (!candidates.length) return -1;
  if (candidates.length === 1) return candidates[0];
  const targetCenter = cueTimingCenter(cue);
  return candidates.reduce((best, candidate) => {
    const bestDistance = Math.abs(timingCenter(timedWords, best, visibleCount) - targetCenter);
    const distance = Math.abs(timingCenter(timedWords, candidate, visibleCount) - targetCenter);
    return distance < bestDistance ? candidate : best;
  }, candidates[0]);
}

function candidateStartsByScore(timedWords, visibleWords) {
  const maxStart = Math.max(0, timedWords.length - visibleWords.length);
  const candidates = [];
  let bestScore = 0;
  for (let start = 0; start <= maxStart; start += 1) {
    let score = 0;
    for (let offset = 0; offset < visibleWords.length; offset += 1) {
      if (timedWords[start + offset]?.normalized === visibleWords[offset]) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      candidates.length = 0;
      candidates.push(start);
    } else if (score === bestScore && score > 0) {
      candidates.push(start);
    }
  }
  return candidates;
}

export function alignTimedWordsToTokens(tokens = [], cue = {}) {
  const tokenEntries = (Array.isArray(tokens) ? tokens : [])
    .map((token, tokenIndex) => ({
      tokenIndex,
      normalized: token?.space ? "" : normalizedCaptionWord(token?.text),
    }))
    .filter((entry) => entry.normalized);
  const timedWords = normalizedTimedWords(cue?.words || []);
  if (!tokenEntries.length || !timedWords.length) return [];

  const visibleWords = tokenEntries.map((entry) => entry.normalized);
  const exactCandidates = [];
  const maxStart = Math.max(0, timedWords.length - visibleWords.length);
  for (let start = 0; start <= maxStart; start += 1) {
    if (visibleWords.every((word, offset) => timedWords[start + offset]?.normalized === word)) {
      exactCandidates.push(start);
    }
  }

  const candidates = exactCandidates.length ? exactCandidates : candidateStartsByScore(timedWords, visibleWords);
  const start = chooseAlignedWordStart(candidates, timedWords, visibleWords.length, cue);
  if (start < 0) return [];

  const aligned = Array.isArray(tokens) ? Array(tokens.length).fill(null) : [];
  tokenEntries.forEach((entry, offset) => {
    aligned[entry.tokenIndex] = timedWords[Math.min(start + offset, timedWords.length - 1)] || null;
  });

  for (let index = 0; index < aligned.length; index += 1) {
    if (aligned[index] || tokens[index]?.space) continue;
    const previous = [...aligned.slice(0, index)].reverse().find(Boolean);
    const next = aligned.slice(index + 1).find(Boolean);
    aligned[index] = previous || next || null;
  }
  return aligned;
}

function speechWeightForChunk(value) {
  const tokens = String(value || "").split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;
  return tokens.reduce((sum, token) => sum + speechWeightForToken(token), 0);
}

export function captionTimingWindow(cue) {
  const startMs = Number(cue?.startMs) || 0;
  const endMs = Math.max(startMs + 300, Number(cue?.endMs) || startMs + 2200);
  const chunkStartMs = Number(cue?.captionChunkStartMs);
  const chunkEndMs = Number(cue?.captionChunkEndMs);
  if (Number.isFinite(chunkStartMs) && Number.isFinite(chunkEndMs) && chunkEndMs > chunkStartMs) {
    return { startMs: chunkStartMs, endMs: chunkEndMs };
  }

  const chunkCount = Math.max(1, Number(cue?.captionChunkCount) || 1);
  if (chunkCount <= 1) return { startMs, endMs };

  const chunkIndex = Math.max(0, Math.min(chunkCount - 1, Number(cue?.captionChunkIndex) || 0));
  const chunkDuration = (endMs - startMs) / chunkCount;
  return {
    startMs: startMs + chunkDuration * chunkIndex,
    endMs: chunkIndex === chunkCount - 1 ? endMs : startMs + chunkDuration * (chunkIndex + 1),
  };
}

export function captionChunkLimit(baseSize, style = "", wordGap = 0) {
  const size = Math.max(34, Math.min(Number(baseSize || 72), 108));
  const gap = clamp(Number(wordGap) || 0, 0, 32);
  if (style === "capcut-karaoke") {
    return Math.max(8, Math.min(18, Math.floor(760 / (size * 0.72 + gap * 0.55))));
  }
  return Math.max(10, Math.min(22, Math.floor(850 / (size * 0.62 + gap * 0.45))));
}

export function splitCaptionChunks(text, maxCharacters = 19) {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = "";

  for (const word of words) {
    const trimmedCurrent = current.trim();
    const shouldBreakAfterSentence = /[.,;:!?\u2026]$/u.test(trimmedCurrent)
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

export function captionChunkWindows(cue, chunks = []) {
  const startMs = Number(cue?.startMs) || 0;
  const endMs = Math.max(startMs + 300, Number(cue?.endMs) || startMs + 2200);
  const duration = Math.max(1, endMs - startMs);
  const safeChunks = chunks.length ? chunks : [String(cue?.text || "")];
  const weights = safeChunks.map(speechWeightForChunk);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let cursor = startMs;

  return safeChunks.map((chunk, index) => {
    const chunkStartMs = cursor;
    const chunkEndMs = index === safeChunks.length - 1
      ? endMs
      : cursor + duration * (weights[index] / totalWeight);
    cursor = chunkEndMs;
    return {
      text: chunk,
      startMs: chunkStartMs,
      endMs: Math.max(chunkStartMs + 1, chunkEndMs),
      weight: weights[index],
    };
  });
}

export function captionCueForFrame(cue, currentMs, caption) {
  if (!cue) return null;
  const text = String(cue.text || "").trim();
  const maxCharacters = captionChunkLimit(caption.fontSize, caption.style, caption.wordGap);
  if ([...text].length <= maxCharacters) return cue;

  const chunks = splitCaptionChunks(text, maxCharacters);
  if (chunks.length <= 1) return cue;

  const windows = captionChunkWindows(cue, chunks);
  const edgeMs = currentMs + TIMING_EDGE_EPSILON_MS;
  let resolvedIndex = windows.findIndex((window) => edgeMs >= window.startMs && edgeMs < window.endMs);
  if (resolvedIndex < 0) {
    resolvedIndex = edgeMs < windows[0].startMs ? 0 : windows.length - 1;
  }
  const window = windows[resolvedIndex] || windows[0];
  return {
    ...cue,
    text: window.text,
    captionChunkIndex: resolvedIndex,
    captionChunkCount: chunks.length,
    captionChunkStartMs: window.startMs,
    captionChunkEndMs: window.endMs,
  };
}
