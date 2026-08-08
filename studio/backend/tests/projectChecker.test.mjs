import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { videoPath } from "../paths.mjs";
import { defaultProjectConfig, normalizeProjectConfig } from "../services/projectConfig.mjs";
import { checkProjectData } from "../services/projectChecker.mjs";

const POSES = ["point-left", "point-right", "question"];

function writeFile(filePath, content = "") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeReadyProject(slug, overrides = {}) {
  const root = videoPath(slug);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  writeFile(path.join(root, "assets", "compare-left.png"), "left");
  writeFile(path.join(root, "assets", "compare-right.png"), "right");
  writeFile(path.join(root, "assets", "backgrounds", "paper.png"), "bg");
  writeFile(path.join(root, "assets", "vo", "full.mp3"), "voice");
  for (const pose of POSES) writeFile(path.join(root, "assets", "character", `${pose}.webm`), pose);

  const base = defaultProjectConfig({
    slug,
    leftLabel: "A",
    rightLabel: "B",
    content: "Line one\nLine two\nQuestion?",
  });
  const compareSets = base.compareSets.map((set) => set.id === "compare-1"
    ? { ...set, leftImage: "assets/compare-left.png", rightImage: "assets/compare-right.png" }
    : set);
  const config = normalizeProjectConfig({
    ...base,
    ...overrides,
    compare: compareSets[0],
    compareSets,
    background: { type: "image", src: "assets/backgrounds/paper.png", color: "#f7efe1" },
    character: {
      ...base.character,
      poses: Object.fromEntries(POSES.map((pose) => [pose, `assets/character/${pose}.webm`])),
    },
    audio: {
      ...base.audio,
      provider: "uploaded",
      mainAudio: "assets/vo/full.mp3",
      ...(overrides.audio || {}),
    },
    logo: {
      ...base.logo,
      ...(overrides.logo || {}),
    },
    poseSfx: {
      ...base.poseSfx,
      ...(overrides.poseSfx || {}),
    },
  }, slug);
  writeJson(path.join(root, "video.json"), config);
  return root;
}

function cleanup(slug) {
  fs.rmSync(videoPath(slug), { recursive: true, force: true });
}

test("project checker reports a selected BGM file that is missing", () => {
  const slug = `checker-bgm-${Date.now()}`;
  try {
    makeReadyProject(slug, { audio: { bgm: "assets/audio/missing.mp3" } });

    const result = checkProjectData(slug);

    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => /BGM/i.test(error)), true);
  } finally {
    cleanup(slug);
  }
});

test("project checker reports a missing pose SFX when scene-start sound is enabled", () => {
  const slug = `checker-sfx-${Date.now()}`;
  try {
    makeReadyProject(slug, { poseSfx: { "point-right": "missing-sfx.wav" } });

    const result = checkProjectData(slug);

    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => /point-right.*missing-sfx\.wav/i.test(error)), true);
  } finally {
    cleanup(slug);
  }
});

test("project checker accepts pose SFX stored inside the project", () => {
  const slug = `checker-project-sfx-${Date.now()}`;
  try {
    const root = makeReadyProject(slug, {
      poseSfx: {
        "point-left": "assets/audio/sfx/75.mp3",
        "point-right": "assets/audio/sfx/75.mp3",
        question: "assets/audio/sfx/45.mp3",
      },
    });
    writeFile(path.join(root, "assets", "audio", "sfx", "75.mp3"), "left-right-sfx");
    writeFile(path.join(root, "assets", "audio", "sfx", "45.mp3"), "question-sfx");

    const result = checkProjectData(slug);

    assert.equal(result.ok, true);
  } finally {
    cleanup(slug);
  }
});

test("project checker allows pose SFX mapped to no sound", () => {
  const slug = `checker-sfx-none-${Date.now()}`;
  try {
    makeReadyProject(slug, {
      poseSfx: {
        "point-left": "__none__",
        "point-right": "__none__",
        question: "__none__",
      },
    });

    const result = checkProjectData(slug);

    assert.equal(result.errors.some((error) => /sound đầu cảnh/i.test(error)), false);
  } finally {
    cleanup(slug);
  }
});

test("project checker reports enabled logo with a missing file", () => {
  const slug = `checker-logo-${Date.now()}`;
  try {
    makeReadyProject(slug, { logo: { enabled: true, src: "assets/logo/missing.png" } });

    const result = checkProjectData(slug);

    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => /logo/i.test(error)), true);
  } finally {
    cleanup(slug);
  }
});

test("project checker reports missing SS2 images when SS2 has lines", () => {
  const slug = `checker-ss2-${Date.now()}`;
  try {
    const root = makeReadyProject(slug);
    const configPath = path.join(root, "video.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.lines[1].compareSetId = "compare-2";
    writeJson(configPath, config);

    const result = checkProjectData(slug);

    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => /SS2/.test(error)), true);
  } finally {
    cleanup(slug);
  }
});
