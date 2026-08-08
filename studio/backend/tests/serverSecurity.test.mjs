import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { videoPath } from "../paths.mjs";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(port, child) {
  for (let index = 0; index < 50; index += 1) {
    if (child.exitCode !== null) throw new Error(`Backend exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/status`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for backend on ${port}`);
}

test("server binds locally, protects API routes, and hides project metadata", async () => {
  const port = 38000 + Math.floor(Math.random() * 1000);
  const slug = `server-security-${Date.now()}`;
  const root = videoPath(slug);
  const duplicateSlug = `server-duplicate-${Date.now()}`;
  const differentSlug = `server-different-${Date.now()}`;
  const duplicateRoot = videoPath(duplicateSlug);
  const differentRoot = videoPath(differentSlug);
  const aimaxMock = createServer((request, response) => {
    if (request.url !== "/api/v1/voices/my") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ voices: [{ voice_id: "mock-voice", name: "Mock voice" }] }));
  });
  await new Promise((resolve) => aimaxMock.listen(0, "127.0.0.1", resolve));
  const aimaxPort = aimaxMock.address().port;
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets", "frame.png"), "image");
  fs.writeFileSync(path.join(root, "video.json"), "secret");

  const child = spawn(process.execPath, ["studio/backend/server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, STUDIO_PORT: String(port), STUDIO_AUTH_TOKEN: "test-token" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});

  try {
    await waitForServer(port, child);

    const publicStatus = await fetch(`http://127.0.0.1:${port}/api/status`);
    assert.equal(publicStatus.ok, true);

    const missingToken = await fetch(`http://127.0.0.1:${port}/api/videos`);
    assert.equal(missingToken.status, 401);

    const authorized = await fetch(`http://127.0.0.1:${port}/api/videos`, {
      headers: { "x-studio-token": "test-token" },
    });
    assert.equal(authorized.ok, true);

    const created = await fetch(`http://127.0.0.1:${port}/api/videos`, {
      method: "POST",
      headers: { "x-studio-token": "test-token", "content-type": "application/json" },
      body: JSON.stringify({ title: duplicateSlug, content: "A\nB\nKhac nhau" }),
    });
    assert.equal(created.status, 200);
    const duplicate = await fetch(`http://127.0.0.1:${port}/api/videos`, {
      method: "POST",
      headers: { "x-studio-token": "test-token", "content-type": "application/json" },
      body: JSON.stringify({ title: duplicateSlug, content: "A\nB\nKhac nhau" }),
    });
    assert.equal(duplicate.status, 409);
    const duplicatePayload = await duplicate.json();
    assert.equal(duplicatePayload.code, "PROJECT_EXISTS");
    assert.match(duplicatePayload.error, new RegExp(duplicateSlug));

    const different = await fetch(`http://127.0.0.1:${port}/api/videos`, {
      method: "POST",
      headers: { "x-studio-token": "test-token", "content-type": "application/json" },
      body: JSON.stringify({ title: differentSlug, content: "A\nB\nKhac nhau" }),
    });
    assert.equal(different.status, 200);

    const voices = await fetch(`http://127.0.0.1:${port}/api/voices/test`, {
      method: "POST",
      headers: { "x-studio-token": "test-token", "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "temporary-key", baseUrl: `http://127.0.0.1:${aimaxPort}` }),
    });
    assert.equal(voices.status, 200);
    assert.deepEqual(await voices.json(), {
      ok: true,
      defaultVoice: "mock-voice",
      voices: [{ id: "mock-voice", name: "Mock voice", provider: "" }],
    });

    const missingVoiceKey = await fetch(`http://127.0.0.1:${port}/api/voices/test`, {
      method: "POST",
      headers: { "x-studio-token": "test-token", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(missingVoiceKey.status, 400);
    assert.equal((await missingVoiceKey.json()).code, "BAD_REQUEST");

    const invalidSlug = await fetch(`http://127.0.0.1:${port}/api/videos/not_valid!`, {
      headers: { "x-studio-token": "test-token" },
    });
    assert.equal(invalidSlug.status, 400);
    assert.equal((await invalidSlug.json()).code, "BAD_REQUEST");

    const missingProject = await fetch(`http://127.0.0.1:${port}/api/videos/server-security-missing-${Date.now()}`, {
      headers: { "x-studio-token": "test-token" },
    });
    assert.equal(missingProject.status, 404);
    assert.equal((await missingProject.json()).code, "NOT_FOUND");

    const media = await fetch(`http://127.0.0.1:${port}/videos-media/${slug}/assets/frame.png`);
    assert.equal(media.status, 200);
    const metadata = await fetch(`http://127.0.0.1:${port}/videos-media/${slug}/video.json`);
    assert.equal(metadata.status, 404);
  } finally {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(duplicateRoot, { recursive: true, force: true });
    fs.rmSync(differentRoot, { recursive: true, force: true });
    await new Promise((resolve) => aimaxMock.close(resolve));
  }
});
