import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { VIDEOS_DIR } from "../paths.mjs";
import { resolveVideoMediaPath } from "../services/videoMedia.mjs";

const slug = `media-guard-${Date.now()}`;
const root = path.join(VIDEOS_DIR, slug);

test.before(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, "assets", "preview"), { recursive: true });
  fs.mkdirSync(path.join(root, "jobs", "logs"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets", "preview", "frame.png"), "png");
  fs.writeFileSync(path.join(root, "assets", "preview", "clip.mp4"), "mp4");
  fs.writeFileSync(path.join(root, "video.json"), "secret");
  fs.writeFileSync(path.join(root, "jobs", "logs", "job.log"), "secret");
});

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("video media resolver allows images and video files", () => {
  assert.equal(resolveVideoMediaPath(slug, "assets/preview/frame.png"), path.join(root, "assets", "preview", "frame.png"));
  assert.equal(resolveVideoMediaPath(slug, "assets/preview/clip.mp4"), path.join(root, "assets", "preview", "clip.mp4"));
});

test("video media resolver hides project metadata and job logs", () => {
  assert.equal(resolveVideoMediaPath(slug, "video.json"), "");
  assert.equal(resolveVideoMediaPath(slug, "jobs/logs/job.log"), "");
});

test("video media resolver blocks traversal", () => {
  assert.equal(resolveVideoMediaPath(slug, "../video.json"), "");
  assert.equal(resolveVideoMediaPath("../outside", "assets/preview/frame.png"), "");
});
