import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSfx, SFX_CATALOG_PATH, SFX_DIR, uploadSfx } from "../services/sfxLibrary.mjs";

test("the local SFX library exposes the curated FastScene-style sounds", () => {
  const sounds = listSfx();
  const names = sounds.map((sound) => sound.name);
  const categories = new Set(sounds.map((sound) => sound.category));
  const riser = sounds.find((sound) => sound.name === "popular-riser-metallic-sound-effect.wav");

  assert.ok(sounds.length >= 11);
  assert.deepEqual(names.slice(0, 3), [
    "mixkit-hard-pop-click.wav",
    "mixkit-explainer-pop-whoosh.wav",
    "mixkit-bubble-pop.wav",
  ]);
  assert.equal(names.includes("pop-left.mp3"), false);
  assert.ok(riser);
  assert.equal(riser.category, "Tiếng Động - SFX edit nhiều");
  assert.equal(riser.source, "Myinstants / QuickSounds");
  assert.equal(riser.url, "/shared-assets/sfx/popular-riser-metallic-sound-effect.wav");
  assert.equal(categories.has("Phản hồi nhanh"), false);
  assert.equal(categories.has("Chuyển cảnh & build-up"), false);
  assert.equal(categories.has("Tiếng Động - SFX edit nhiều"), true);
});

test("the bundled CC0 sound catalog keeps source metadata and nested asset URLs", () => {
  const sounds = listSfx();
  const kenney = sounds.find((sound) => sound.name === "kenney/question_001.ogg");

  assert.ok(kenney);
  assert.equal(kenney.license, "CC0");
  assert.equal(kenney.verified, true);
  assert.equal(kenney.source, "Kenney Interface Sounds");
  assert.equal(kenney.url, "/shared-assets/sfx/kenney/question_001.ogg");
});

test("the Tieng Dong SFX pack is grouped with source metadata", () => {
  const sounds = listSfx();
  const tiengDong = sounds.filter((sound) => sound.name.startsWith("tiengdong/"));
  const pop = sounds.find((sound) => sound.name === "tiengdong/tiengdong-pop.mp3");

  assert.equal(tiengDong.length, 8);
  assert.ok(pop);
  assert.equal(pop.category, "Tiếng Động - SFX edit nhiều");
  assert.equal(pop.source, "Tiếng Động");
  assert.equal(pop.license, "free-use-unverified");
  assert.equal(pop.verified, false);
  assert.equal(pop.url, "/shared-assets/sfx/tiengdong/tiengdong-pop.mp3");
});

test("CapCut cache imports are grouped separately from manual uploads", () => {
  const sounds = listSfx();
  const capcut = sounds.filter((sound) => sound.name.startsWith("capcut-cache/"));
  const first = sounds.find((sound) => sound.name === "capcut-cache/1.mp3");

  assert.ok(capcut.length >= 90);
  assert.ok(first);
  assert.equal(first.category, "CapCut cache");
  assert.equal(first.source, "CapCut cache");
  assert.equal(first.sourceGroup, "CapCut cache");
  assert.equal(first.url, "/shared-assets/sfx/capcut-cache/1.mp3");
});

test("uploaded SFX keeps label source category and tags for picker search", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfx-upload-test-"));
  const originalname = `picker-search-${Date.now()}.wav`;
  const tempPath = path.join(tempDir, originalname);
  fs.writeFileSync(tempPath, "wav");
  const beforeCatalog = fs.existsSync(SFX_CATALOG_PATH) ? JSON.parse(fs.readFileSync(SFX_CATALOG_PATH, "utf8")) : { version: 1, sounds: {} };
  let uploadedName = "";
  try {
    const result = uploadSfx([{ path: tempPath, originalname }], {
      sourceId: "tiengdong",
      label: "Camera click nhanh",
      category: "Tiếng Động - SFX edit nhiều",
      tags: "camera, click, edit",
      description: "Sound test cho picker.",
    });
    uploadedName = result.uploaded[0].name;
    const sound = result.sounds.find((item) => item.name === uploadedName);

    assert.ok(sound);
    assert.equal(sound.label, "Camera click nhanh");
    assert.equal(sound.category, "Tiếng Động - SFX edit nhiều");
    assert.equal(sound.source, "Tiếng Động");
    assert.deepEqual(sound.tags, ["tieng-dong", "edit", "sfx", "camera", "click"]);
  } finally {
    if (uploadedName) fs.rmSync(path.join(SFX_DIR, uploadedName), { force: true });
    fs.writeFileSync(SFX_CATALOG_PATH, `${JSON.stringify(beforeCatalog, null, 2)}\n`, "utf8");
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
