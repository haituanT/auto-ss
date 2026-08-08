import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { buildImageCliPrompt, normalizeAiProvider, validateGeneratedImageOutputs } from "../services/aiCliProvider.mjs";

test("AI CLI provider normalization defaults to agy", () => {
  assert.equal(normalizeAiProvider("agy"), "agy");
  assert.equal(normalizeAiProvider("codex"), "codex");
  assert.equal(normalizeAiProvider("unknown"), "agy");
  assert.equal(normalizeAiProvider(""), "agy");
});

test("AI CLI prompt includes exact output files and one content per request", () => {
  const outputDir = path.join("D:", "ai soure", "content ss", "auto-compare-video", "videos", "demo", "assets", "illustrations");
  const prompt = buildImageCliPrompt({
    systemPrompt: "System prompt",
    stylePrompt: "science style",
    outputDir,
    images: [
      { fileName: "compare-1-left-v1.png", slotLabel: "Noi dung A", content: "ADN" },
      { fileName: "compare-1-right-v1.png", slotLabel: "Noi dung B", content: "Gen" },
    ],
  });

  assert.match(prompt, /Create exactly 2 raster PNG image\(s\)/);
  assert.match(prompt, /Aspect ratio: 1:1/);
  assert.match(prompt, /square 1:1 canvas/);
  assert.match(prompt, /compare-1-left-v1\.png/);
  assert.match(prompt, /compare-1-right-v1\.png/);
  assert.match(prompt, /Slot: Noi dung A/);
  assert.match(prompt, /Content: ADN/);
  assert.match(prompt, /Slot: Noi dung B/);
  assert.match(prompt, /Content: Gen/);
  assert.match(prompt, /Do not create HTML, SVG, markdown-only placeholders/);
});

test("AI CLI output guard accepts the requested raster image", async () => {
  const root = path.join(process.cwd(), "tmp", `ai-output-${Date.now()}`);
  fs.mkdirSync(root, { recursive: true });
  try {
    await sharp({ create: { width: 320, height: 240, channels: 3, background: "#123456" } })
      .png()
      .toFile(path.join(root, "image.png"));
    const outputs = await validateGeneratedImageOutputs({
      outputDir: root,
      images: [{ fileName: "image.png" }],
    });
    assert.deepEqual(outputs, [path.join(root, "image.png")]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AI CLI output guard rejects unexpected files", async () => {
  const root = path.join(process.cwd(), "tmp", `ai-output-extra-${Date.now()}`);
  fs.mkdirSync(root, { recursive: true });
  try {
    await sharp({ create: { width: 320, height: 240, channels: 3, background: "#123456" } })
      .png()
      .toFile(path.join(root, "image.png"));
    fs.writeFileSync(path.join(root, "notes.md"), "unexpected");
    await assert.rejects(
      () => validateGeneratedImageOutputs({ outputDir: root, images: [{ fileName: "image.png" }] }),
      /unexpected files/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
