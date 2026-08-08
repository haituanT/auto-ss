import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { VIDEOS_DIR } from "../paths.mjs";
import { defaultProjectConfig, normalizeProjectConfig } from "../services/projectConfig.mjs";
import { checkProjectData } from "../services/projectChecker.mjs";
import { applyCompareImages } from "../services/compareAssets.mjs";
import { uploadVideoAsset } from "../services/videoAssets.mjs";
import { uploadFullAudio } from "../services/videoAudio.mjs";
import { planGroupedLines } from "../services/linePlanner.mjs";
import { buildPreviewProps } from "../services/remotionRenderer.mjs";

const SLUG = "test-compare-sets-fixture";
const root = path.join(VIDEOS_DIR, SLUG);
const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function resetRoot() {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writePng(relativePath) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, pngBytes);
  return target;
}

function writeUploadImage(relativePath) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), "studio", "frontend", "public", "auto-compare-logo-v2.png"), target);
  return target;
}

function writeReadyProject(config) {
  const normalized = normalizeProjectConfig(config, SLUG);
  writeJson(path.join(root, "video.json"), normalized);
  fs.mkdirSync(path.join(root, "assets", "vo"), { recursive: true });
  const durations = {};
  for (const line of normalized.lines) {
    fs.writeFileSync(path.join(root, "assets", "vo", `${line.id}.mp3`), "audio");
    durations[line.id] = 2.4;
  }
  writeJson(path.join(root, "assets", "vo", "durations.json"), durations);
  return normalized;
}

test("grouped line planner keeps global ids and local question mapping per compare set", () => {
  const lines = planGroupedLines({
    compareSets: [
      { id: "compare-1", leftLabel: "A1", rightLabel: "B1" },
      { id: "compare-2", leftLabel: "A2", rightLabel: "B2" },
    ],
    contentByCompareSet: {
      "compare-1": "Day la A1.\nDay la B1.\nKhac nhau o dau?",
      "compare-2": "Day la A2.\nDay la B2.\nKhac nhau o dau?",
    },
  });

  assert.deepEqual(lines.map((line) => line.id), ["line-1", "line-2", "line-3", "line-4", "line-5", "line-6"]);
  assert.deepEqual(lines.map((line) => line.compareSetId), ["compare-1", "compare-1", "compare-1", "compare-2", "compare-2", "compare-2"]);
  assert.deepEqual(lines.map((line) => line.pose), ["point-left", "point-right", "question", "point-left", "point-right", "question"]);
});

test("compare set upload writes SS2 images without replacing SS1 paths", async () => {
  resetRoot();
  const config = defaultProjectConfig({
    slug: SLUG,
    leftLabel: "A",
    rightLabel: "B",
    content: "Day la A.\nDay la B.\nKhac nhau o dau?",
  });
  config.lines = config.lines.map((line) => ({ ...line, dirtyVoice: false }));
  writeJson(path.join(root, "video.json"), config);
  const first = writeUploadImage("tmp/first.png");
  const second = writeUploadImage("tmp/second.png");
  const third = writeUploadImage("tmp/third.png");

  const uploaded1 = await uploadVideoAsset({ slug: SLUG, kind: "compare-1-left", file: { path: first, originalname: "first.png" } });
  const uploaded2 = await uploadVideoAsset({ slug: SLUG, kind: "compare-2-left", file: { path: second, originalname: "second.png" } });
  const uploaded3 = await uploadVideoAsset({ slug: SLUG, kind: "compare-2-right", file: { path: third, originalname: "third.png" } });
  const sets = uploaded3.config.compareSets;

  assert.equal(sets.find((set) => set.id === "compare-1").leftImage, "assets/compare/compare-1-left.png");
  assert.equal(uploaded1.config.background.src, "");
  assert.equal(uploaded1.config.background.color, "#ffffff");
  assert.equal(uploaded3.config.background.src, "");
  assert.equal(sets.find((set) => set.id === "compare-2").leftImage, "assets/compare/compare-2-left.png");
  assert.equal(sets.find((set) => set.id === "compare-2").rightImage, "assets/compare/compare-2-right.png");
  assert.notEqual(sets.find((set) => set.id === "compare-1").leftImage, sets.find((set) => set.id === "compare-2").leftImage);
  assert.equal(fs.existsSync(path.join(root, uploaded1.config.compareSets[0].leftImage)), true);
  assert.equal(fs.existsSync(path.join(root, "assets", "compare", "compare-2-left.png")), true);
  assert.equal(fs.existsSync(path.join(root, "assets", "compare", "compare-2-right.png")), true);
  assert.equal(uploaded2.compareSetId, "compare-2");
  assert.equal(uploaded2.side, "left");
  assert.equal(uploaded2.assetPath, "assets/compare/compare-2-left.png");
  assert.ok(uploaded2.assetRevision);
  assert.ok(uploaded3.assetRevision);
  assert.notEqual(uploaded2.assetRevision, uploaded3.assetRevision);
  assert.equal(uploaded3.config.lines.every((line) => line.dirtyVoice === false), true);

  const preview = buildPreviewProps(SLUG);
  assert.match(preview.props.assets.compareSets["compare-2"].left, /compare-2-left\.png\?v=/);
  assert.match(preview.props.assets.compareSets["compare-2"].right, /compare-2-right\.png\?v=/);
});

test("compare set upload accepts JFIF images", async () => {
  resetRoot();
  writeJson(path.join(root, "video.json"), defaultProjectConfig({
    slug: SLUG,
    content: "Day la A.\nDay la B.\nKhac nhau o dau?",
  }));
  const uploadPath = path.join(root, "tmp", "compare-a.jfif");
  fs.mkdirSync(path.dirname(uploadPath), { recursive: true });

  try {
    await sharp({
      create: {
        width: 18,
        height: 12,
        channels: 3,
        background: { r: 40, g: 120, b: 220 },
      },
    }).jpeg().toFile(uploadPath);

    const uploaded = await uploadVideoAsset({
      slug: SLUG,
      kind: "compare-1-left",
      file: { path: uploadPath, originalname: "compare-a.jfif" },
    });
    const target = path.join(root, "assets", "compare", "compare-1-left.png");
    const metadata = await sharp(target).metadata();

    assert.equal(uploaded.assetPath, "assets/compare/compare-1-left.png");
    assert.equal(uploaded.config.compareSets[0].leftImage, "assets/compare/compare-1-left.png");
    assert.equal(fs.existsSync(target), true);
    assert.equal(metadata.format, "png");
  } finally {
    sharp.cache(false);
  }
});

test("manual compare upload clears the selected AI asset but keeps available variants", async () => {
  resetRoot();
  const config = defaultProjectConfig({ slug: SLUG, content: "Day la A.\nDay la B.\nKhac nhau o dau?" });
  config.compareSets[1].aiImages.left = {
    ...config.compareSets[1].aiImages.left,
    state: "ready",
    selectedVariant: 2,
    asset: "assets/illustrations/compare-2-left.png",
    variants: [
      "assets/illustrations/compare-2-left-v1.png",
      "assets/illustrations/compare-2-left-v2.png",
    ],
    prompt: "Hoa mat",
  };
  writeJson(path.join(root, "video.json"), config);
  const upload = writeUploadImage("tmp/manual-compare.png");

  const result = await uploadVideoAsset({
    slug: SLUG,
    kind: "compare-2-left",
    file: { path: upload, originalname: "manual-compare.png" },
  });

  const slot = result.config.compareSets[1].aiImages.left;
  assert.equal(slot.state, "ready");
  assert.equal(slot.selectedVariant, 0);
  assert.equal(slot.asset, "");
  assert.deepEqual(slot.variants, [
    "assets/illustrations/compare-2-left-v1.png",
    "assets/illustrations/compare-2-left-v2.png",
  ]);
});

test("auto-create comparison images update the SS1 project slots", async () => {
  resetRoot();
  writeJson(path.join(root, "video.json"), defaultProjectConfig({
    slug: SLUG,
    content: "Day la A.\nDay la B.\nKhac nhau o dau?",
  }));
  const left = writeUploadImage("tmp/auto-left.png");
  const right = writeUploadImage("tmp/auto-right.png");

  const applied = await applyCompareImages({
    slug: SLUG,
    leftFile: { path: left, originalname: "auto-left.png" },
    rightFile: { path: right, originalname: "auto-right.png" },
  });

  assert.equal(applied.left, true);
  assert.equal(applied.right, true);
  assert.equal(applied.config.compareSets[0].leftImage, "assets/compare-left.png");
  assert.equal(applied.config.compareSets[0].rightImage, "assets/compare-right.png");
  assert.equal(fs.existsSync(path.join(root, "assets", "compare-left.png")), true);
  assert.equal(fs.existsSync(path.join(root, "assets", "compare-right.png")), true);
  const check = checkProjectData(SLUG);
  assert.equal(check.errors.some((error) => error === "Thiếu ảnh A."), false);
  assert.equal(check.errors.some((error) => error === "Thiếu ảnh B."), false);
});

test("compare A upload does not replace a custom project background", async () => {
  resetRoot();
  writeJson(path.join(root, "video.json"), defaultProjectConfig({ slug: SLUG }));
  const background = writeUploadImage("tmp/custom-background.png");
  const compareA = writeUploadImage("tmp/compare-a.png");

  const custom = await uploadVideoAsset({
    slug: SLUG,
    kind: "background",
    file: { path: background, originalname: "custom-background.png" },
  });
  const uploaded = await uploadVideoAsset({
    slug: SLUG,
    kind: "compare-1-left",
    file: { path: compareA, originalname: "compare-a.png" },
  });

  assert.equal(custom.config.background.src, "assets/backgrounds/paper.png");
  assert.equal(custom.config.background.custom, true);
  assert.equal(custom.config.background.treatment, "raw");
  assert.equal(custom.config.background.detail, 0);
  assert.equal(custom.config.background.shade, 0);
  assert.equal(custom.config.background.blur, 0);
  assert.equal(uploaded.config.background.src, "assets/backgrounds/paper.png");
  assert.equal(uploaded.config.background.custom, true);
  assert.equal(uploaded.config.background.treatment, "raw");
  assert.equal(uploaded.config.compareSets[0].leftImage, "assets/compare/compare-1-left.png");
});

test("project checker allows empty SS2 and blocks SS2 with missing images", () => {
  resetRoot();
  const config = defaultProjectConfig({ slug: SLUG, content: "Day la A.\nDay la B.\nKhac nhau o dau?" });
  config.compareSets[0].leftImage = "assets/compare/compare-1-left.png";
  config.compareSets[0].rightImage = "assets/compare/compare-1-right.png";
  config.compare = { ...config.compareSets[0] };
  writePng("assets/compare/compare-1-left.png");
  writePng("assets/compare/compare-1-right.png");
  writeReadyProject(config);

  assert.equal(checkProjectData(SLUG).errors.some((error) => /SS2/.test(error)), false);

  const withSecond = normalizeProjectConfig({
    ...config,
    lines: [
      ...config.lines,
      { id: "line-4", compareSetId: "compare-2", text: "Day la A2.", pose: "point-left", dirtyVoice: false },
    ],
  }, SLUG);
  writeReadyProject(withSecond);
  assert.equal(checkProjectData(SLUG).errors.some((error) => /SS2/.test(error)), true);
});

test("SRT upload rejects a cue count mismatch to preserve compare set mapping", async () => {
  resetRoot();
  writeReadyProject(defaultProjectConfig({ slug: SLUG, content: "Day la A.\nDay la B.\nKhac nhau o dau?" }));
  const audioPath = path.join(root, "tmp", "full.mp3");
  const srtPath = path.join(root, "tmp", "audio.srt");
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), "shared-assets", "sample-voice.mp3"), audioPath);
  fs.writeFileSync(srtPath, "1\n00:00:00,000 --> 00:00:01,000\nA\n\n2\n00:00:01,000 --> 00:00:02,000\nB\n", "utf8");

  await assert.rejects(
    () => uploadFullAudio({
      slug: SLUG,
      file: { path: audioPath, originalname: "full.mp3" },
      subtitleFile: { path: srtPath, originalname: "audio.srt" },
    }),
    /SRT has 2 cue\(s\), but the official script has 3 line\(s\)/,
  );
});
