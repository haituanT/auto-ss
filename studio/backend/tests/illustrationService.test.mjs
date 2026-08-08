import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { videoPath } from "../paths.mjs";
import { defaultProjectConfig, normalizeProjectConfig } from "../services/projectConfig.mjs";
import {
  runIllustrationGeneration,
  selectIllustrationVariant,
  validateIllustrationContent,
} from "../services/illustrationService.mjs";
import { cancelJob, createJob } from "../services/jobStore.mjs";

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

function setupProject({ slug, leftLabel = "ADN", rightLabel = "Gen" } = {}) {
  const root = videoPath(slug);
  cleanupRoot(root);
  fs.mkdirSync(root, { recursive: true });
  const config = normalizeProjectConfig(defaultProjectConfig({
    slug,
    title: "Illustration fixture",
    leftLabel,
    rightLabel,
    content: `${leftLabel}\n${rightLabel}\nKhac nhau o dau?`,
  }), slug);
  writeJson(path.join(root, "video.json"), config);
  return { root, config };
}

function seedFrom(value) {
  return String(value || "")
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

async function writeGeneratedImage(target, seedText) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const width = 640;
  const height = 480;
  const channels = 3;
  const seed = seedFrom(seedText);
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      data[offset] = (x + seed) % 256;
      data[offset + 1] = (y * 2 + seed * 3) % 256;
      data[offset + 2] = (x + y + seed * 7) % 256;
    }
  }
  await sharp(data, { raw: { width, height, channels } }).png().toFile(target);
}

function fakeProviderRecorder(calls = []) {
  return async function fakeProvider({ provider, outputDir, images, systemPrompt, stylePrompt }) {
    calls.push({ provider, outputDir, images, systemPrompt, stylePrompt });
    for (const image of images) {
      await writeGeneratedImage(image.outputPath, `${image.target}-${image.content}-${image.fileName}`);
    }
  };
}

function parallelProviderRecorder(calls = []) {
  let active = 0;
  let maxActive = 0;
  const runner = async function fakeProvider({ provider, outputDir, images, systemPrompt, stylePrompt }) {
    active += 1;
    maxActive = Math.max(maxActive, active);
    calls.push({ provider, outputDir, images, systemPrompt, stylePrompt });
    try {
      await sleep(40);
      for (const image of images) {
        await writeGeneratedImage(image.outputPath, `${image.target}-${image.content}-${image.fileName}`);
      }
    } finally {
      active -= 1;
    }
  };
  runner.maxActive = () => maxActive;
  return runner;
}

function fileHash(filePath) {
  return crypto.createHash("sha1").update(fs.readFileSync(filePath)).digest("hex");
}

test.after(() => {
  sharp.cache(false);
});

test("illustration content validation blocks placeholders", () => {
  assert.throws(() => validateIllustrationContent("A", "left"), /Khong tao duoc anh cho Noi dung A/);
  assert.throws(() => validateIllustrationContent("Nội dung B", "right"), /Khong tao duoc anh cho Noi dung B/);
  assert.equal(validateIllustrationContent("ADN", "left"), "ADN");
});

test("AI illustration generation creates A/B variants and maps them to the correct slots", async () => {
  const slug = `illustration-ab-${Date.now()}`;
  const { root } = setupProject({ slug, leftLabel: "ADN", rightLabel: "Gen" });
  const calls = [];
  try {
    const result = await runIllustrationGeneration({
      slug,
      compareSetId: "compare-1",
      targets: ["left", "right"],
      provider: "agy",
      style: "science",
      variants: 2,
      providerRunner: fakeProviderRecorder(calls),
    });
    const set = result.config.compareSets[0];

    assert.equal(calls.length, 2);
    assert.match(calls[0].systemPrompt, /1:1/);
    assert.match(calls[0].stylePrompt, /1:1/);
    assert.deepEqual(calls.map((call) => call.images.map((item) => item.target)), [["left", "left"], ["right", "right"]]);
    assert.equal(result.successCount, 2);
    assert.equal(result.failureCount, 0);
    assert.equal(set.leftImage, "assets/illustrations/compare-1-left.png");
    assert.equal(set.rightImage, "assets/illustrations/compare-1-right.png");
    assert.equal(set.aiImages.left.state, "ready");
    assert.equal(set.aiImages.right.state, "ready");
    assert.equal(set.aiImages.left.prompt, "ADN");
    assert.equal(set.aiImages.right.prompt, "Gen");
    assert.equal(set.aiImages.left.variants.length, 2);
    assert.equal(set.aiImages.right.variants.length, 2);
    assert.equal(set.aiImages.left.selectedVariant, 1);
    assert.equal(set.aiImages.right.selectedVariant, 1);
    assert.ok(fs.statSync(path.join(root, set.leftImage)).size > 10 * 1024);
    assert.ok(fs.statSync(path.join(root, set.rightImage)).size > 10 * 1024);
    const leftVariant = await sharp(path.join(root, set.aiImages.left.variants[0])).metadata();
    const rightVariant = await sharp(path.join(root, set.aiImages.right.variants[0])).metadata();
    assert.equal(leftVariant.width, leftVariant.height);
    assert.equal(rightVariant.width, rightVariant.height);
  } finally {
    cleanupRoot(root);
  }
});

test("AI illustration cancellation clears processing slots", async () => {
  const slug = `illustration-cancel-${Date.now()}`;
  const { root } = setupProject({ slug, leftLabel: "ADN", rightLabel: "Gen" });
  const job = createJob("illustration-generate", slug, { family: "illustration" });
  try {
    await assert.rejects(
      runIllustrationGeneration({
        slug,
        compareSetId: "compare-1",
        targets: ["left"],
        variants: 1,
        job,
        providerRunner: async () => {
          cancelJob(job.id, "Stopped in test.");
        },
      }),
      /cancelled/i,
    );

    const config = JSON.parse(fs.readFileSync(path.join(root, "video.json"), "utf8"));
    const slot = config.compareSets[0].aiImages.left;
    assert.equal(slot.state, "cancelled");
    assert.equal(slot.jobId, "");
    assert.match(slot.error, /AI/i);
  } finally {
    cleanupRoot(root);
  }
});

test("AI illustration generation can run SS1 and SS2 slots in parallel", async () => {
  const slug = `illustration-all-${Date.now()}`;
  const { root, config } = setupProject({ slug, leftLabel: "ADN", rightLabel: "Gen" });
  config.compareSets[1].leftLabel = "Hong cau";
  config.compareSets[1].rightLabel = "Bach cau";
  writeJson(path.join(root, "video.json"), config);
  const calls = [];
  const runner = parallelProviderRecorder(calls);
  try {
    const result = await runIllustrationGeneration({
      slug,
      items: [
        { compareSetId: "compare-1", target: "left" },
        { compareSetId: "compare-1", target: "right" },
        { compareSetId: "compare-2", target: "left" },
        { compareSetId: "compare-2", target: "right" },
      ],
      variants: 2,
      providerRunner: runner,
    });

    assert.equal(calls.length, 4);
    assert.equal(runner.maxActive() > 1, true);
    assert.equal(result.successCount, 4);
    assert.deepEqual(result.compareSetIds, ["compare-1", "compare-2"]);
    assert.equal(result.config.compareSets[0].leftImage, "assets/illustrations/compare-1-left.png");
    assert.equal(result.config.compareSets[0].rightImage, "assets/illustrations/compare-1-right.png");
    assert.equal(result.config.compareSets[1].leftImage, "assets/illustrations/compare-2-left.png");
    assert.equal(result.config.compareSets[1].rightImage, "assets/illustrations/compare-2-right.png");
    assert.equal(result.config.compareSets[1].aiImages.left.prompt, "Hong cau");
    assert.equal(result.config.compareSets[1].aiImages.right.prompt, "Bach cau");
  } finally {
    cleanupRoot(root);
  }
});

test("AI illustration generation keeps successful slots when another slot fails", async () => {
  const slug = `illustration-partial-${Date.now()}`;
  const { root } = setupProject({ slug, leftLabel: "ADN", rightLabel: "Gen" });
  try {
    const result = await runIllustrationGeneration({
      slug,
      compareSetId: "compare-1",
      targets: ["left", "right"],
      variants: 1,
      providerRunner: async ({ images }) => {
        if (images[0]?.target === "right") throw new Error("right failed");
        for (const image of images) {
          await writeGeneratedImage(image.outputPath, `${image.target}-${image.content}-${image.fileName}`);
        }
      },
    });
    const set = result.config.compareSets[0];

    assert.equal(result.successCount, 1);
    assert.equal(result.failureCount, 1);
    assert.equal(set.aiImages.left.state, "ready");
    assert.equal(set.aiImages.right.state, "error");
    assert.equal(set.leftImage, "assets/illustrations/compare-1-left.png");
    assert.equal(set.rightImage, "");
    assert.match(set.aiImages.right.error, /right failed/);
  } finally {
    cleanupRoot(root);
  }
});

test("AI illustration bulk generation skips invalid slots and runs valid ones", async () => {
  const slug = `illustration-skip-${Date.now()}`;
  const { root, config } = setupProject({ slug, leftLabel: "ADN", rightLabel: "Gen" });
  config.compareSets[1].leftLabel = "Nội dung A";
  config.compareSets[1].rightLabel = "B";
  writeJson(path.join(root, "video.json"), config);
  const calls = [];
  try {
    const result = await runIllustrationGeneration({
      slug,
      items: [
        { compareSetId: "compare-1", target: "left" },
        { compareSetId: "compare-1", target: "right" },
        { compareSetId: "compare-2", target: "left" },
        { compareSetId: "compare-2", target: "right" },
      ],
      variants: 1,
      providerRunner: fakeProviderRecorder(calls),
    });

    assert.equal(calls.length, 2);
    assert.equal(result.successCount, 2);
    assert.equal(result.skippedCount, 2);
    assert.equal(result.config.compareSets[0].aiImages.left.state, "ready");
    assert.equal(result.config.compareSets[1].aiImages.left.state, "empty");
    assert.equal(result.config.compareSets[1].aiImages.right.state, "empty");
  } finally {
    cleanupRoot(root);
  }
});

test("regenerating one side keeps the other side and stores history for the replaced image", async () => {
  const slug = `illustration-one-side-${Date.now()}`;
  const { root } = setupProject({ slug, leftLabel: "Hong cau", rightLabel: "Bach cau" });
  try {
    const first = await runIllustrationGeneration({
      slug,
      compareSetId: "compare-1",
      targets: ["left", "right"],
      variants: 1,
      providerRunner: fakeProviderRecorder(),
    });
    const originalLeft = first.config.compareSets[0].leftImage;
    const originalRight = first.config.compareSets[0].rightImage;

    const second = await runIllustrationGeneration({
      slug,
      compareSetId: "compare-1",
      targets: ["right"],
      variants: 1,
      providerRunner: fakeProviderRecorder(),
    });
    const set = second.config.compareSets[0];

    assert.equal(set.leftImage, originalLeft);
    assert.equal(set.rightImage, originalRight);
    assert.equal(set.aiImages.left.history.length, 0);
    assert.equal(set.aiImages.right.history.length, 1);
    assert.equal(fs.existsSync(path.join(root, set.aiImages.right.history[0])), true);
  } finally {
    cleanupRoot(root);
  }
});

test("selecting an AI variant updates only the requested slot", async () => {
  const slug = `illustration-select-${Date.now()}`;
  const { root } = setupProject({ slug, leftLabel: "ADN", rightLabel: "Gen" });
  try {
    const first = await runIllustrationGeneration({
      slug,
      compareSetId: "compare-1",
      targets: ["left", "right"],
      variants: 2,
      providerRunner: fakeProviderRecorder(),
    });
    const beforeLeftHash = fileHash(path.join(root, first.config.compareSets[0].leftImage));
    const beforeRightHash = fileHash(path.join(root, first.config.compareSets[0].rightImage));

    const selected = await selectIllustrationVariant({
      slug,
      compareSetId: "compare-1",
      target: "right",
      variant: 2,
    });
    const set = selected.config.compareSets[0];
    const afterLeftHash = fileHash(path.join(root, set.leftImage));
    const afterRightHash = fileHash(path.join(root, set.rightImage));

    assert.equal(set.aiImages.right.selectedVariant, 2);
    assert.equal(set.aiImages.left.selectedVariant, 1);
    assert.equal(afterLeftHash, beforeLeftHash);
    assert.notEqual(afterRightHash, beforeRightHash);
    assert.equal(set.aiImages.right.history.length, 1);
  } finally {
    cleanupRoot(root);
  }
});
