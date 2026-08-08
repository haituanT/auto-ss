import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { FFMPEG_PATH, FFPROBE_PATH, videoPath } from "../paths.mjs";
import { defaultProjectConfig } from "../services/projectConfig.mjs";
import { checkProjectData } from "../services/projectChecker.mjs";
import { deleteCharacterAsset, getCharacterAssetStatus, uploadVideoAsset } from "../services/videoAssets.mjs";

const execFileAsync = promisify(execFile);

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function cleanupRoot(root) {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 120 });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPoseStatus(slug, pose, predicate, timeoutMs = 20000) {
  const started = Date.now();
  let latest = null;
  while (Date.now() - started < timeoutMs) {
    latest = getCharacterAssetStatus(slug)[pose];
    if (predicate(latest)) return latest;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${pose} status. Last status: ${JSON.stringify(latest)}`);
}

async function writeTinyQtrleMov(target, seed = 0) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const x = 12 + (Number(seed) % 20);
  await execFileAsync(FFMPEG_PATH, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi",
    "-i", "color=c=black@0.0:s=64x64:d=0.2:r=5,format=argb",
    "-vf", `drawbox=x=${x}:y=18:w=28:h=28:color=green@1:t=fill`,
    "-c:v", "qtrle",
    "-metadata", `comment=seed-${seed}`,
    target,
  ], { windowsHide: true });
}

async function ffprobeVideoCodec(target) {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name",
    "-of", "default=nokey=1:noprint_wrappers=1",
    target,
  ], { windowsHide: true });
  return stdout.trim();
}

test("logo uploads convert to project logo PNG and enable logo config", async () => {
  const slug = `logo-upload-${Date.now()}`;
  const root = videoPath(slug);
  cleanupRoot(root);
  fs.mkdirSync(root, { recursive: true });
  writeJson(path.join(root, "video.json"), defaultProjectConfig({ slug }));

  const uploadPath = path.join(root, "upload-logo.webp");
  try {
    await sharp({
      create: {
        width: 24,
        height: 16,
        channels: 4,
        background: { r: 20, g: 130, b: 90, alpha: 0.45 },
      },
    }).webp().toFile(uploadPath);

    const result = await uploadVideoAsset({
      slug,
      kind: "logo",
      file: {
        path: uploadPath,
        originalname: "brand-logo.webp",
      },
    });
    const logoPath = path.join(root, "assets", "logo", "logo.png");
    const signature = fs.readFileSync(logoPath).subarray(0, 8);

    assert.equal(result.assetPath, "assets/logo/logo.png");
    assert.equal(result.config.logo.enabled, true);
    assert.equal(result.config.logo.src, "assets/logo/logo.png");
    assert.equal(result.config.logo.width, 110);
    assert.equal(result.config.logo.backdrop, false);
    assert.equal(Boolean(result.assetRevision), true);
    assert.equal(result.config.pipeline.dirty.assets, true);
    assert.equal(result.config.pipeline.dirty.render, true);
    assert.equal(result.config.pipeline.dirty.audio, false);
    assert.equal(fs.existsSync(logoPath), true);
    assert.deepEqual([...signature], [137, 80, 78, 71, 13, 10, 26, 10]);
  } finally {
    sharp.cache(false);
    cleanupRoot(root);
  }
});

test("logo uploads trim transparent canvas around the mark", async () => {
  const slug = `logo-trim-${Date.now()}`;
  const root = videoPath(slug);
  cleanupRoot(root);
  fs.mkdirSync(root, { recursive: true });
  writeJson(path.join(root, "video.json"), defaultProjectConfig({ slug }));

  const uploadPath = path.join(root, "upload-logo-wide.png");
  try {
    const mark = await sharp({
      create: {
        width: 28,
        height: 14,
        channels: 4,
        background: { r: 40, g: 40, b: 40, alpha: 1 },
      },
    }).png().toBuffer();
    await sharp({
      create: {
        width: 180,
        height: 120,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([{ input: mark, left: 6, top: 88 }]).png().toFile(uploadPath);

    const result = await uploadVideoAsset({
      slug,
      kind: "logo",
      file: {
        path: uploadPath,
        originalname: "wide-logo.png",
      },
    });
    const logoPath = path.join(root, result.assetPath);
    const metadata = await sharp(logoPath).metadata();

    assert.equal(result.config.logo.backdrop, false);
    assert.equal(metadata.hasAlpha, true);
    assert.ok(metadata.width < 60, `expected trimmed logo width, got ${metadata.width}`);
    assert.ok(metadata.height < 40, `expected trimmed logo height, got ${metadata.height}`);
  } finally {
    sharp.cache(false);
    cleanupRoot(root);
  }
});

test("BGM uploads update project audio, asset revision and render dirty state", async () => {
  const slug = `bgm-upload-${Date.now()}`;
  const root = videoPath(slug);
  cleanupRoot(root);
  fs.mkdirSync(root, { recursive: true });
  writeJson(path.join(root, "video.json"), defaultProjectConfig({ slug }));

  const uploadPath = path.join(root, "upload-bgm.mp3");
  fs.writeFileSync(uploadPath, "fake mp3", "utf8");

  try {
    const result = await uploadVideoAsset({
      slug,
      kind: "bgm",
      file: {
        path: uploadPath,
        originalname: "music.mp3",
      },
    });
    const bgmPath = path.join(root, "assets", "audio", "bgm.mp3");

    assert.equal(result.assetPath, "assets/audio/bgm.mp3");
    assert.equal(result.config.audio.bgm, "assets/audio/bgm.mp3");
    assert.equal(Boolean(result.assetRevision), true);
    assert.equal(result.config.assetRevision, result.assetRevision);
    assert.equal(result.config.pipeline.dirty.assets, true);
    assert.equal(result.config.pipeline.dirty.render, true);
    assert.equal(result.config.pipeline.dirty.audio, false);
    assert.equal(fs.existsSync(bgmPath), true);
    assert.equal(fs.existsSync(uploadPath), false);
  } finally {
    cleanupRoot(root);
  }
});

test("character pose uploads can be deleted from the project safely", async () => {
  const slug = `pose-delete-${Date.now()}`;
  const root = videoPath(slug);
  cleanupRoot(root);
  fs.mkdirSync(root, { recursive: true });
  writeJson(path.join(root, "video.json"), defaultProjectConfig({ slug, content: "Day la A." }));

  const uploadPath = path.join(root, "upload-pose.png");
  try {
    await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0.6 },
      },
    }).png().toFile(uploadPath);

    const uploaded = await uploadVideoAsset({
      slug,
      kind: "character-point-left",
      file: {
        path: uploadPath,
        originalname: "point-left.png",
      },
    });
    const posePath = path.join(root, uploaded.assetPath);
    assert.equal(fs.existsSync(posePath), true);

    const deleted = deleteCharacterAsset({ slug, pose: "point-left" });
    assert.equal(fs.existsSync(posePath), false);
    assert.equal(deleted.config.character.poses["point-left"], "");
    assert.equal(deleted.config.character.poseWarnings?.["point-left"], undefined);
    assert.equal(deleted.config.character.poseSources?.["point-left"], undefined);
    assert.equal(deleted.config.pipeline.dirty.assets, true);
    assert.equal(deleted.config.pipeline.dirty.render, true);

    const check = checkProjectData(slug);
    assert.match(check.errors.join("\n"), /pose.*point-left/i);
  } finally {
    sharp.cache(false);
    cleanupRoot(root);
  }
});

test("character image uploads trim transparent padding around the pose", async () => {
  const slug = `pose-trim-${Date.now()}`;
  const root = videoPath(slug);
  cleanupRoot(root);
  fs.mkdirSync(root, { recursive: true });
  writeJson(path.join(root, "video.json"), defaultProjectConfig({ slug, content: "Day la A." }));

  const uploadPath = path.join(root, "upload-padded-pose.png");
  try {
    const poseBuffer = await sharp({
      create: {
        width: 70,
        height: 120,
        channels: 4,
        background: { r: 0, g: 180, b: 70, alpha: 1 },
      },
    }).png().toBuffer();
    await sharp({
      create: {
        width: 400,
        height: 600,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: poseBuffer, left: 170, top: 360 }])
      .png()
      .toFile(uploadPath);

    const uploaded = await uploadVideoAsset({
      slug,
      kind: "character-point-left",
      file: {
        path: uploadPath,
        originalname: "point-left.png",
      },
    });
    const metadata = await sharp(path.join(root, uploaded.assetPath)).metadata();

    assert.equal(uploaded.assetPath, "assets/character/point-left.png");
    assert.equal(uploaded.characterStatus.state, "image-ready");
    assert.equal(uploaded.config.character.poseSources["point-left"].preview, "assets/character/point-left.png");
    assert.equal(uploaded.config.character.poseSources["point-left"].render, "assets/character/point-left.png");
    assert.equal(metadata.width, 134);
    assert.equal(metadata.height, 184);
  } finally {
    sharp.cache(false);
    cleanupRoot(root);
  }
});

test("video character pose uploads normalize raw MOV to fallback and WebM derivatives", async () => {
  const slug = `pose-video-upload-${Date.now()}`;
  const root = videoPath(slug);
  const cacheSlug = `pose-video-cache-${Date.now()}`;
  const cacheRoot = videoPath(cacheSlug);
  cleanupRoot(root);
  cleanupRoot(cacheRoot);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(cacheRoot, { recursive: true });
  writeJson(path.join(root, "video.json"), defaultProjectConfig({ slug, content: "Day la A." }));
  writeJson(path.join(cacheRoot, "video.json"), defaultProjectConfig({ slug: cacheSlug, content: "Day la A." }));

  const uploadPath = path.join(root, "upload-pose.mov");
  await writeTinyQtrleMov(uploadPath, Date.now());

  try {
    const uploaded = await uploadVideoAsset({
      slug,
      kind: "character-question",
      file: {
        path: uploadPath,
        originalname: "question.mov",
      },
    });
    const originalRel = uploaded.config.character.poseSources.question.original;
    const originalPath = path.join(root, originalRel);
    const topLevelRawMov = path.join(root, "assets", "character", "question.mov");

    assert.notEqual(uploaded.assetPath, "assets/character/question.mov");
    assert.notEqual(uploaded.config.character.poses.question, "assets/character/question.mov");
    assert.match(originalRel, /^assets\/character\/originals\/question-[a-f0-9]{12}\.mov$/);
    assert.equal(fs.existsSync(originalPath), true);
    assert.equal(fs.existsSync(topLevelRawMov), false);
    assert.equal(fs.existsSync(uploadPath), false);

    const ready = await waitForPoseStatus(slug, "question", (status) => status.state === "ready" || status.state === "error");
    assert.equal(ready.state, "ready", ready.error);
    assert.equal(ready.preview, "assets/character/preview/question.webm");
    assert.equal(ready.render, "assets/character/render/question.webm");
    assert.equal(fs.statSync(path.join(root, ready.fallback)).size > 0, true);
    assert.equal(fs.statSync(path.join(root, ready.preview)).size > 0, true);
    assert.equal(fs.statSync(path.join(root, ready.render)).size > 0, true);
    assert.equal(await ffprobeVideoCodec(path.join(root, ready.preview)), "vp9");
    assert.equal(await ffprobeVideoCodec(path.join(root, ready.render)), "vp9");

    const finalConfig = JSON.parse(fs.readFileSync(path.join(root, "video.json"), "utf8"));
    assert.equal(finalConfig.character.poses.question, "assets/character/preview/question.webm");
    assert.doesNotMatch(finalConfig.character.poses.question, /\.mov$/i);

    const cachedUploadPath = path.join(cacheRoot, "upload-pose.mov");
    fs.copyFileSync(originalPath, cachedUploadPath);
    const cached = await uploadVideoAsset({
      slug: cacheSlug,
      kind: "character-question",
      file: {
        path: cachedUploadPath,
        originalname: "question.mov",
      },
    });
    assert.equal(cached.characterStatus.state, "ready");
    assert.equal(cached.config.character.poses.question, "assets/character/preview/question.webm");
    assert.equal(fs.statSync(path.join(cacheRoot, "assets", "character", "preview", "question.webm")).size > 0, true);
    assert.equal(fs.statSync(path.join(cacheRoot, "assets", "character", "render", "question.webm")).size > 0, true);
  } finally {
    cleanupRoot(root);
    cleanupRoot(cacheRoot);
  }
});

test("invalid character videos mark the pose error instead of exposing raw MOV", async () => {
  const slug = `pose-video-error-${Date.now()}`;
  const root = videoPath(slug);
  cleanupRoot(root);
  fs.mkdirSync(root, { recursive: true });
  const config = defaultProjectConfig({ slug, content: "Day la A." });
  config.lines = config.lines.map((line) => ({ ...line, pose: "question", role: "question" }));
  writeJson(path.join(root, "video.json"), config);

  const uploadPath = path.join(root, "upload-bad.mov");
  fs.writeFileSync(uploadPath, "fake mov", "utf8");

  try {
    const uploaded = await uploadVideoAsset({
      slug,
      kind: "character-question",
      file: {
        path: uploadPath,
        originalname: "question.mov",
      },
    });

    assert.notEqual(uploaded.assetPath, "assets/character/question.mov");
    assert.equal(fs.existsSync(path.join(root, "assets", "character", "question.mov")), false);
    assert.match(uploaded.config.character.poseSources.question.original, /^assets\/character\/originals\/question-[a-f0-9]{12}\.mov$/);
    assert.equal(fs.existsSync(path.join(root, uploaded.config.character.poseSources.question.original)), true);
    assert.equal(fs.existsSync(uploadPath), false);

    const status = await waitForPoseStatus(slug, "question", (item) => item.state === "error");
    assert.equal(status.state, "error");
    const config = JSON.parse(fs.readFileSync(path.join(root, "video.json"), "utf8"));
    assert.doesNotMatch(config.character.poses.question || "", /\.mov$/i);
    const check = checkProjectData(slug);
    assert.match(check.errors.join("\n"), /loi chuan hoa|lỗi chuẩn hóa|error/i);
  } finally {
    cleanupRoot(root);
  }
});

test("image upload supersedes an in-flight character video conversion", async () => {
  const slug = `pose-video-to-image-${Date.now()}`;
  const root = videoPath(slug);
  cleanupRoot(root);
  fs.mkdirSync(root, { recursive: true });
  writeJson(path.join(root, "video.json"), defaultProjectConfig({ slug, content: "Day la A." }));

  const videoUploadPath = path.join(root, "upload-pose.mov");
  const imageUploadPath = path.join(root, "upload-pose.png");

  try {
    await writeTinyQtrleMov(videoUploadPath, Date.now());
    const videoUploaded = await uploadVideoAsset({
      slug,
      kind: "character-point-left",
      file: {
        path: videoUploadPath,
        originalname: "point-left.mov",
      },
    });
    assert.equal(videoUploaded.characterStatus.state, "processing");

    await sharp({
      create: {
        width: 48,
        height: 64,
        channels: 4,
        background: { r: 40, g: 120, b: 220, alpha: 0.8 },
      },
    }).png().toFile(imageUploadPath);

    const imageUploaded = await uploadVideoAsset({
      slug,
      kind: "character-point-left",
      file: {
        path: imageUploadPath,
        originalname: "point-left.png",
      },
    });
    assert.equal(imageUploaded.assetPath, "assets/character/point-left.png");
    assert.equal(imageUploaded.characterStatus.state, "image-ready");
    assert.equal(imageUploaded.config.character.poses["point-left"], "assets/character/point-left.png");

    await sleep(1200);
    const config = JSON.parse(fs.readFileSync(path.join(root, "video.json"), "utf8"));
    assert.equal(config.character.poses["point-left"], "assets/character/point-left.png");
    assert.equal(config.character.poseSources["point-left"].state, "image-ready");
    assert.equal(getCharacterAssetStatus(slug)["point-left"].state, "image-ready");
  } finally {
    sharp.cache(false);
    cleanupRoot(root);
  }
});

test("deleting a project pose does not remove a shared-only character asset", () => {
  const slug = `pose-delete-shared-${Date.now()}`;
  const root = videoPath(slug);
  const sharedPath = path.join(root, "..", `${slug}-shared-question.webm`);
  cleanupRoot(root);
  fs.rmSync(sharedPath, { force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(sharedPath, "shared", "utf8");
  writeJson(path.join(root, "video.json"), {
    ...defaultProjectConfig({ slug, content: "Khac nhau o dau?" }),
    character: {
      poses: {
        question: sharedPath,
      },
    },
  });

  try {
    deleteCharacterAsset({ slug, pose: "question" });
    assert.equal(fs.existsSync(sharedPath), true);
  } finally {
    cleanupRoot(root);
    fs.rmSync(sharedPath, { force: true });
  }
});
