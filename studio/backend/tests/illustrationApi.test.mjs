import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import sharp from "sharp";
import { videoPath } from "../paths.mjs";
import { defaultProjectConfig, normalizeProjectConfig } from "../services/projectConfig.mjs";

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

async function waitForServer(port, child) {
  const url = `http://127.0.0.1:${port}/api/status`;
  for (let index = 0; index < 40; index += 1) {
    if (child.exitCode !== null) throw new Error(`Backend exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for backend on ${port}`);
}

async function writeVariantImage(target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const width = 640;
  const height = 480;
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      data[offset] = (x * 3) % 256;
      data[offset + 1] = (y * 5) % 256;
      data[offset + 2] = (x + y) % 256;
    }
  }
  await sharp(data, { raw: { width, height, channels } }).png().toFile(target);
}

test("illustration API returns status and selects a local variant", async () => {
  const slug = `illustration-api-${Date.now()}`;
  const root = videoPath(slug);
  const port = 36000 + Math.floor(Math.random() * 2000);
  cleanupRoot(root);
  fs.mkdirSync(root, { recursive: true });
  const variantRel = "assets/illustrations/compare-1-left-v1.png";
  await writeVariantImage(path.join(root, variantRel));
  const config = normalizeProjectConfig(defaultProjectConfig({
    slug,
    title: "Illustration API fixture",
    leftLabel: "ADN",
    rightLabel: "Gen",
    content: "ADN\nGen\nKhac nhau o dau?",
  }), slug);
  config.compareSets[0].aiImages.left = {
    state: "ready",
    provider: "agy",
    style: "science",
    selectedVariant: 1,
    asset: "",
    variants: [variantRel],
    prompt: "ADN",
    error: "",
    updatedAt: new Date().toISOString(),
    history: [],
  };
  writeJson(path.join(root, "video.json"), config);

  const child = spawn(process.execPath, ["studio/backend/server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, STUDIO_PORT: String(port) },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});

  try {
    await waitForServer(port, child);
    const statusResponse = await fetch(`http://127.0.0.1:${port}/api/videos/${slug}/illustrations/status`);
    const status = await statusResponse.json();
    assert.equal(statusResponse.ok, true);
    assert.equal(status["compare-1"].left.state, "ready");

    const selectResponse = await fetch(`http://127.0.0.1:${port}/api/videos/${slug}/illustrations/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ compareSetId: "compare-1", target: "left", variant: 1 }),
    });
    const selected = await selectResponse.json();
    assert.equal(selectResponse.ok, true);
    assert.equal(selected.config.compareSets[0].leftImage, "assets/illustrations/compare-1-left.png");
    assert.equal(selected.config.compareSets[0].aiImages.left.selectedVariant, 1);
    assert.equal(fs.existsSync(path.join(root, "assets", "illustrations", "compare-1-left.png")), true);
  } finally {
    child.kill();
    cleanupRoot(root);
  }
});
