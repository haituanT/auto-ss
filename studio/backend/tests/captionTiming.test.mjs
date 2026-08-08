import assert from "node:assert/strict";
import test from "node:test";
import {
  alignTimedWordsToTokens,
  captionChunkLimit,
  captionChunkWindows,
  captionCueForFrame,
  splitCaptionChunks,
  TIMING_EDGE_EPSILON_MS,
} from "../../../remotion/src/captionTiming.mjs";

const CAPCUT_CAPTION = {
  style: "capcut-karaoke",
  animation: "word-color",
  fontSize: 46,
  wordGap: 12,
};

test("weighted caption chunk timing gives short final chunks less time than long chunks", () => {
  const text = "Con tien su thuong duoc hieu la da tung bi xu ly hanh chinh hoac ky luat vi vi pham phap luat, nhung chua den muc bi ket an hinh su. Vi du: tung bi phat hanh chinh vi mot hanh vi vi pham, va chua duoc coi la da het thoi han de xoa dau vet xu ly do.";
  const cue = { text, startMs: 36876, endMs: 50052 };
  const chunks = splitCaptionChunks(text, captionChunkLimit(CAPCUT_CAPTION.fontSize, CAPCUT_CAPTION.style, CAPCUT_CAPTION.wordGap));
  const windows = captionChunkWindows(cue, chunks);
  const equalChunkDuration = (cue.endMs - cue.startMs) / chunks.length;
  const lastWindow = windows.at(-1);
  const longestWindow = windows.reduce((longest, window) => (
    (window.endMs - window.startMs) > (longest.endMs - longest.startMs) ? window : longest
  ), windows[0]);

  assert.ok(chunks.length > 1);
  assert.ok((lastWindow.endMs - lastWindow.startMs) < equalChunkDuration);
  assert.ok((lastWindow.endMs - lastWindow.startMs) < (longestWindow.endMs - longestWindow.startMs));
});

test("captionCueForFrame returns the weighted chunk window for word-color captions", () => {
  const text = "Mot cum dai co dau phay, roi tiep tuc doc cham hon. Ly do.";
  const cue = { text, startMs: 1000, endMs: 7000 };
  const chunks = splitCaptionChunks(text, captionChunkLimit(CAPCUT_CAPTION.fontSize, CAPCUT_CAPTION.style, CAPCUT_CAPTION.wordGap));
  const windows = captionChunkWindows(cue, chunks);
  const lastWindow = windows.at(-1);
  const displayCue = captionCueForFrame(cue, lastWindow.startMs + 1, CAPCUT_CAPTION);

  assert.equal(displayCue.text, chunks.at(-1));
  assert.equal(displayCue.captionChunkIndex, chunks.length - 1);
  assert.equal(displayCue.captionChunkStartMs, lastWindow.startMs);
  assert.equal(displayCue.captionChunkEndMs, lastWindow.endMs);
});

test("captionCueForFrame uses epsilon near chunk starts", () => {
  const text = "Mot doan dau kha dai de tach chunk. Doan sau cung can hien som on dinh.";
  const cue = { text, startMs: 1000, endMs: 7000 };
  const chunks = splitCaptionChunks(text, captionChunkLimit(CAPCUT_CAPTION.fontSize, CAPCUT_CAPTION.style, CAPCUT_CAPTION.wordGap));
  const windows = captionChunkWindows(cue, chunks);
  const secondWindow = windows[1];
  const displayCue = captionCueForFrame(cue, secondWindow.startMs - TIMING_EDGE_EPSILON_MS + 1, CAPCUT_CAPTION);

  assert.ok(chunks.length > 1);
  assert.equal(displayCue.captionChunkIndex, 1);
  assert.equal(displayCue.text, chunks[1]);
});

test("captionCueForFrame resolves exactly one chunk at a boundary", () => {
  const text = "Mot doan dau kha dai de tach chunk. Doan sau cung can hien dung mot lan.";
  const cue = { text, startMs: 1000, endMs: 7000 };
  const chunks = splitCaptionChunks(text, captionChunkLimit(CAPCUT_CAPTION.fontSize, CAPCUT_CAPTION.style, CAPCUT_CAPTION.wordGap));
  const windows = captionChunkWindows(cue, chunks);
  const boundary = windows[0].endMs;
  const displayCue = captionCueForFrame(cue, boundary, CAPCUT_CAPTION);

  assert.ok(chunks.length > 1);
  assert.equal(displayCue.captionChunkIndex, 1);
  assert.notEqual(displayCue.text, chunks[0]);
});

test("alignTimedWordsToTokens uses the active chunk window for repeated words", () => {
  const tokens = [
    { text: "xin" },
    { text: " ", space: true },
    { text: "chao" },
  ];
  const cue = {
    text: "xin chao",
    startMs: 1000,
    endMs: 5000,
    captionChunkStartMs: 3000,
    captionChunkEndMs: 5000,
    words: [
      { text: "xin", startMs: 1000, endMs: 1400 },
      { text: "chao", startMs: 1400, endMs: 1900 },
      { text: "xin", startMs: 3100, endMs: 3500 },
      { text: "chao", startMs: 3500, endMs: 3900 },
    ],
  };

  const aligned = alignTimedWordsToTokens(tokens, cue);

  assert.equal(aligned[0].startMs, 3100);
  assert.equal(aligned[2].startMs, 3500);
});

test("alignTimedWordsToTokens normalizes Vietnamese accents and punctuation", () => {
  const tokens = [
    { text: "Đây" },
    { text: " ", space: true },
    { text: "là" },
    { text: " ", space: true },
    { text: "mộng" },
    { text: " ", space: true },
    { text: "tinh." },
  ];
  const cue = {
    text: "Đây là mộng tinh.",
    startMs: 500,
    endMs: 2100,
    words: [
      { text: "Day", startMs: 500, endMs: 760 },
      { text: "la", startMs: 760, endMs: 940 },
      { text: "mong", startMs: 940, endMs: 1260 },
      { text: "tinh", startMs: 1260, endMs: 1700 },
    ],
  };

  const aligned = alignTimedWordsToTokens(tokens, cue);

  assert.deepEqual(aligned.filter(Boolean).map((word) => word.startMs), [500, 760, 940, 1260]);
});
