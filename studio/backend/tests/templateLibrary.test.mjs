import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { STUDIO_TEMPLATES_DIR, VIDEOS_DIR } from "../paths.mjs";
import { defaultProjectConfig, normalizeProjectConfig } from "../services/projectConfig.mjs";
import { attachVideoToTemplate } from "../services/videoManager.mjs";
import { createVideo } from "../services/videoCreator.mjs";
import { contentFromLines } from "../services/linePlanner.mjs";
import { buildPreviewProps } from "../services/remotionRenderer.mjs";
import {
  applyTemplateToVideo,
  deleteTemplate,
  listTemplates,
  saveTemplateFromVideo,
  updateTemplateFromVideo,
} from "../services/templateLibrary.mjs";

const FIXTURE_SLUG = "test-template-library-fixture";
const fixtureRoot = path.join(VIDEOS_DIR, FIXTURE_SLUG);

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function cleanupFixtureTemplates() {
  for (const template of listTemplates()) {
    if (template.sourceSlug === FIXTURE_SLUG || template.name?.includes("Template Fixture")) {
      deleteTemplate(template.type, template.id);
    }
  }
}

function withFixture(run) {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  cleanupFixtureTemplates();
  fs.mkdirSync(path.join(fixtureRoot, "assets", "character"), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, "assets", "backgrounds"), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, "assets", "logo"), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, "assets", "audio"), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, "assets", "character", "point-left.webm"), "left");
  fs.writeFileSync(path.join(fixtureRoot, "assets", "character", "point-right.webm"), "right");
  fs.writeFileSync(path.join(fixtureRoot, "assets", "character", "question.webm"), "question");
  fs.writeFileSync(path.join(fixtureRoot, "assets", "backgrounds", "paper.png"), "background");
  fs.writeFileSync(path.join(fixtureRoot, "assets", "logo", "logo.png"), "logo");
  fs.writeFileSync(path.join(fixtureRoot, "assets", "audio", "bgm.mp3"), "bgm");

  const config = normalizeProjectConfig({
    ...defaultProjectConfig({
      slug: FIXTURE_SLUG,
      title: "Template Fixture",
      leftLabel: "A",
      rightLabel: "B",
      content: "Original line\nSecond line",
    }),
    caption: {
      style: "capcut-karaoke",
      animation: "word-color",
      fontFamily: "Anton",
      fontSize: 74,
      normalColor: "#ffffff",
      hotColor: "#ffe600",
      strokeColor: "#000000",
      strokeWidth: 12,
      uppercase: true,
      shadowPreset: "capcut-heavy",
    },
    layout: {
      captionY: 900,
      captionYExplicit: true,
      photoCompareSize: 430,
      photoCompareOffsetY: 80,
    },
    character: {
      packId: "default",
      captionFontFamily: "Lexend",
      scale: 1.35,
      x: 40,
      y: -20,
      poses: {
        "point-left": "assets/character/point-left.webm",
        "point-right": "assets/character/point-right.webm",
        question: "assets/character/question.webm",
      },
    },
    background: {
      type: "image",
      src: "assets/backgrounds/paper.png",
      color: "#f7efe1",
    },
    logo: {
      enabled: true,
      src: "assets/logo/logo.png",
      width: 180,
      anchor: "top-left",
      x: 24,
      y: 36,
      opacity: 0.72,
      layer: "above-character",
    },
    audio: {
      provider: "aimax",
      voiceId: "voice-template",
      speed: 1.25,
      voiceVolume: 0.9,
      mainAudio: "assets/vo/full.mp3",
      srt: "assets/vo/audio.srt",
      bgm: "assets/audio/bgm.mp3",
      bgmVolume: 0.22,
      sceneStartSfx: {
        enabled: false,
        skipFirst: false,
        mode: "pose",
        name: "win-1.wav",
        volume: 0.6,
        offsetMs: 180,
      },
    },
    poseSfx: {
      "point-left": "mixkit-hard-pop-click.wav",
      "point-right": "wow.wav",
      question: "mixkit-bubble-pop.wav",
    },
  }, FIXTURE_SLUG);
  writeJson(path.join(fixtureRoot, "video.json"), config);

  let result;
  try {
    result = run(config);
  } catch (error) {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    cleanupFixtureTemplates();
    throw error;
  }
  if (result && typeof result.finally === "function") {
    return result.finally(() => {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
      cleanupFixtureTemplates();
    });
  }
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  cleanupFixtureTemplates();
  return result;
}

test("caption templates save only caption settings and caption position", () => {
  withFixture(() => {
    const template = saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "caption",
      name: "Template Fixture Caption",
      parts: { caption: true },
    });

    assert.equal(template.type, "caption");
    assert.equal(template.parts.caption, true);
    assert.equal(template.parts.character, false);
    assert.equal(template.config.caption.style, "capcut-karaoke");
    assert.equal(template.config.layout.captionY, 900);
    assert.equal(template.config.character, undefined);
  });
});

test("caption templates keep word timing and audio clips when applied", () => {
  withFixture((config) => {
    const template = saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "caption",
      name: "Template Fixture Caption Sync",
      parts: { caption: true },
    });
    const changed = normalizeProjectConfig({
      ...config,
      caption: {
        ...config.caption,
        style: "soft-box",
        animation: "line-pop",
        fontFamily: "Noto Sans",
      },
      layout: {
        ...config.layout,
        captionY: 820,
        captionYExplicit: true,
      },
      lines: config.lines.map((line, index) => index === 0
        ? {
          ...line,
          start: 0.55,
          duration: 1.7,
          words: [
            { text: "Original", startMs: 550, endMs: 980 },
            { text: "line", startMs: 980, endMs: 1700 },
          ],
        }
        : line),
      assets: {
        audioClips: [{ lineId: "line-1", src: "assets/vo/line-1.mp3", startMs: 550, durationMs: 1700 }],
        sfxClips: [{ lineId: "line-1", src: "assets/sfx/pop.wav", startMs: 520, durationMs: 260 }],
      },
    }, FIXTURE_SLUG);
    writeJson(path.join(fixtureRoot, "video.json"), changed);

    const beforeWords = changed.lines[0].words;
    const beforeTiming = { start: changed.lines[0].start, duration: changed.lines[0].duration };
    const beforeAssets = changed.assets;
    const result = applyTemplateToVideo(FIXTURE_SLUG, {
      type: template.type,
      id: template.id,
      parts: { caption: true },
    });

    assert.equal(result.video.config.caption.style, "capcut-karaoke");
    assert.deepEqual(result.video.config.lines[0].words, beforeWords);
    assert.deepEqual({
      start: result.video.config.lines[0].start,
      duration: result.video.config.lines[0].duration,
    }, beforeTiming);
    assert.deepEqual(result.video.config.assets, beforeAssets);
  });
});

test("character templates copy pose assets and apply them back to a project", () => {
  withFixture(() => {
    const template = saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "character",
      name: "Template Fixture Character",
      parts: { character: true },
    });
    const templatePose = path.join(STUDIO_TEMPLATES_DIR, template.type, template.id, template.config.character.poses["point-left"]);
    assert.equal(fs.existsSync(templatePose), true);
    assert.equal(template.config.character.captionFontFamily, "Lexend");

    fs.rmSync(path.join(fixtureRoot, "assets", "character"), { recursive: true, force: true });
    const result = applyTemplateToVideo(FIXTURE_SLUG, {
      type: template.type,
      id: template.id,
      parts: { character: true },
    });

    assert.equal(result.video.config.character.scale, 1.35);
    assert.equal(result.video.config.character.captionFontFamily, "Lexend");
    assert.equal(result.video.config.caption.fontFamily, "Lexend");
    assert.equal(fs.existsSync(path.join(fixtureRoot, result.video.config.character.poses["point-left"])), true);
    assert.equal(result.video.config.character.poseSources["point-left"].preview, result.video.config.character.poses["point-left"]);
    assert.equal(fs.existsSync(path.join(fixtureRoot, result.video.config.character.poseSources["point-left"].preview)), true);
  });
});

test("updating a linked template rejects a project that lost a required pose", () => {
  withFixture(() => {
    const template = saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "full",
      name: "Template Fixture Character Isolation",
      parts: { caption: false, character: true, audio: false, layout: false, background: false, content: false },
    });
    const originalTemplatePose = template.config.character.poses["point-left"];

    fs.rmSync(path.join(fixtureRoot, "assets", "character", "point-left.webm"), { force: true });
    const missingLocalPose = normalizeProjectConfig({
      ...JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")),
      character: {
        ...JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")).character,
        poses: {
          ...JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")).character.poses,
          "point-left": "",
        },
        poseSources: {},
      },
    }, FIXTURE_SLUG);
    writeJson(path.join(fixtureRoot, "video.json"), missingLocalPose);

    assert.throws(
      () => updateTemplateFromVideo(FIXTURE_SLUG, template.type, template.id, { expectedVersion: 1 }),
      /missing required asset/i,
    );
    const updatedTemplate = JSON.parse(fs.readFileSync(path.join(STUDIO_TEMPLATES_DIR, template.type, template.id, "template.json"), "utf8"));

    assert.equal(updatedTemplate.config.character.poses["point-left"], originalTemplatePose);
    assert.equal(updatedTemplate.version, template.version);
    assert.equal(fs.existsSync(path.join(STUDIO_TEMPLATES_DIR, template.type, template.id, originalTemplatePose)), true);
  });
});

test("background templates copy and apply logo assets with background", () => {
  withFixture(() => {
    const template = saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "background",
      name: "Template Fixture Background Logo",
      parts: { background: true },
    });
    const templateLogo = path.join(STUDIO_TEMPLATES_DIR, template.type, template.id, template.config.logo.src);
    assert.equal(fs.existsSync(templateLogo), true);
    assert.equal(template.config.logo.width, 180);
    assert.equal(template.config.logo.anchor, "top-left");

    fs.rmSync(path.join(fixtureRoot, "assets", "logo"), { recursive: true, force: true });
    const changed = normalizeProjectConfig({
      ...JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")),
      logo: { enabled: false, src: "", width: 220 },
    }, FIXTURE_SLUG);
    writeJson(path.join(fixtureRoot, "video.json"), changed);

    const result = applyTemplateToVideo(FIXTURE_SLUG, {
      type: template.type,
      id: template.id,
      parts: { background: true },
    });

    assert.equal(result.video.config.logo.enabled, true);
    assert.match(result.video.config.logo.src, new RegExp(`^assets/template/${template.id}/v1/logo/`));
    assert.equal(result.video.config.logo.opacity, 0.72);
    assert.equal(fs.existsSync(path.join(fixtureRoot, result.video.config.logo.src)), true);
  });
});

test("full templates can apply style parts without replacing project content", () => {
  withFixture(() => {
    const template = saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "full",
      name: "Template Fixture Full",
      parts: {
        caption: true,
        character: true,
        audio: true,
        layout: true,
        background: true,
        content: false,
      },
    });

    const changed = normalizeProjectConfig({
      ...JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")),
      savedTemplateRef: null,
      caption: { style: "clean-outline" },
      lines: [{ id: "line-1", text: "Keep this text", pose: "question", role: "question" }],
    }, FIXTURE_SLUG);
    writeJson(path.join(fixtureRoot, "video.json"), changed);

    const result = applyTemplateToVideo(FIXTURE_SLUG, {
      type: "full",
      id: template.id,
      parts: template.parts,
    });

    assert.equal(result.video.config.caption.style, "capcut-karaoke");
    assert.equal(result.video.config.savedTemplateRef.id, template.id);
    assert.equal(result.video.config.savedTemplateRef.type, "full");
    assert.equal(result.video.config.lines[0].text, "Keep this text");
    assert.equal(result.video.config.audio.voiceId, "voice-template");
    assert.equal(result.video.config.audio.mainAudio, "assets/vo/full.mp3");
    assert.deepEqual(template.config.audio.sceneStartSfx, {
      enabled: false,
      skipFirst: false,
      mode: "pose",
      name: "assets/audio/sfx/win-1.wav",
      volume: 0.6,
      poseVolumes: {
        "point-left": 0.6,
        "point-right": 0.6,
        question: 0.6,
      },
      offsetMs: 180,
    });
    assert.deepEqual(result.video.config.audio.sceneStartSfx, {
      enabled: false,
      skipFirst: false,
      mode: "pose",
      name: `assets/template/${template.id}/v1/audio/sfx/win-1.wav`,
      volume: 0.6,
      poseVolumes: {
        "point-left": 0.6,
        "point-right": 0.6,
        question: 0.6,
      },
      offsetMs: 180,
    });
    for (const pose of ["point-left", "point-right", "question"]) {
      assert.match(template.config.poseSfx[pose], new RegExp(`^assets/audio/sfx/`));
      assert.match(result.video.config.poseSfx[pose], new RegExp(`^assets/template/${template.id}/v1/audio/sfx/`));
    }
  });
});

test("content templates replace lines only when content is explicitly applied", () => {
  withFixture(() => {
    const template = saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "content",
      name: "Template Fixture Content",
      parts: { content: true },
    });
    const changed = normalizeProjectConfig({
      ...JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")),
      lines: [{ id: "line-1", text: "Different content", pose: "question", role: "question" }],
      audio: { mainAudio: "assets/vo/full.mp3", srt: "assets/vo/audio.srt" },
    }, FIXTURE_SLUG);
    writeJson(path.join(fixtureRoot, "video.json"), changed);

    const result = applyTemplateToVideo(FIXTURE_SLUG, {
      type: "content",
      id: template.id,
      parts: { content: true },
    });

    assert.equal(result.video.config.lines[0].text, "Original line");
    assert.equal(result.video.config.lines[0].dirtyVoice, true);
    assert.equal(result.video.config.audio.mainAudio, "");
    assert.equal(result.video.config.audio.srt, "");
  });
});

test("creating a project without a templateRef keeps it free", async () => {
  const slug = "test-template-library-create-free";
  const root = path.join(VIDEOS_DIR, slug);
  fs.rmSync(root, { recursive: true, force: true });

  try {
    const created = await createVideo({
      slug,
      title: "Template Fixture Create Free",
      content: "Free typed content",
    });

    assert.equal(created.slug, slug);
    assert.equal(created.config.savedTemplateRef, null);
    assert.equal(created.config.lines[0].text, "Free typed content");
    assert.deepEqual(created.config.character.poses, {});
    assert.equal(fs.existsSync(path.join(root, "assets", "character")), false);

    const preview = buildPreviewProps(slug);
    assert.deepEqual(preview.props.assets.characters, {});
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("creating a project from a full template links it and applies non-content parts", async () => {
  await withFixture(async () => {
    const source = normalizeProjectConfig({
      ...JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")),
      poseStartSide: "right",
    }, FIXTURE_SLUG);
    writeJson(path.join(fixtureRoot, "video.json"), source);

    const template = saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "full",
      name: "Template Fixture Create From Full",
      parts: {
        caption: true,
        character: true,
        audio: true,
        layout: true,
        background: true,
        content: true,
      },
    });
    assert.equal(template.config.poseStartSide, "right");
    assert.equal(template.config.lineFocus, undefined);

    const slug = "test-template-library-created-from-template";
    const root = path.join(VIDEOS_DIR, slug);
    fs.rmSync(root, { recursive: true, force: true });

    try {
      const created = await createVideo({
        slug,
        title: "Created From Template",
        content: "Typed content must stay",
        templateRef: { type: template.type, id: template.id },
      });

      assert.equal(created.config.savedTemplateRef.id, template.id);
      assert.equal(created.config.savedTemplateRef.type, "full");
      assert.equal(created.config.title, "Created From Template");
      assert.equal(created.config.caption.style, "capcut-karaoke");
      assert.equal(created.config.character.scale, 1.35);
      assert.equal(created.config.audio.voiceId, "voice-template");
      assert.match(created.config.background.src, new RegExp(`^assets/template/${template.id}/v1/background/`));
      assert.match(created.config.logo.src, new RegExp(`^assets/template/${template.id}/v1/logo/`));
      assert.equal(created.config.lines[0].text, "Typed content must stay");
      assert.equal(created.config.poseStartSide, "right");
      assert.equal(created.config.lines[0].pose, "point-right");
      assert.equal(created.config.lines[0].focusSide, "left");
      assert.equal(fs.existsSync(path.join(root, created.config.logo.src)), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

test("saving a full template from a free project links that project to the new template", () => {
  withFixture(() => {
    const template = saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "full",
      name: "Template Fixture Linked Full",
      parts: { caption: true, character: true, audio: true, layout: true, background: true, content: false },
    });
    const config = normalizeProjectConfig(JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")), FIXTURE_SLUG);

    assert.deepEqual(config.savedTemplateRef, {
      type: "full",
      id: template.id,
      name: template.name,
      version: 1,
      linkedAt: config.savedTemplateRef.linkedAt,
    });
    assert.ok(config.savedTemplateRef.linkedAt);
  });
});

test("applying a partial template keeps the current full template link", () => {
  withFixture(() => {
    const fullTemplate = saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "full",
      name: "Template Fixture Link Owner Full",
      parts: { caption: true, layout: true },
    });
    const captionTemplate = saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "caption",
      name: "Template Fixture Partial Apply",
      parts: { caption: true },
    });
    const before = normalizeProjectConfig(JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")), FIXTURE_SLUG);

    const result = applyTemplateToVideo(FIXTURE_SLUG, {
      type: captionTemplate.type,
      id: captionTemplate.id,
      parts: { caption: true },
    });

    assert.equal(result.video.config.caption.style, "capcut-karaoke");
    assert.equal(result.video.config.savedTemplateRef.id, fullTemplate.id);
    assert.equal(result.video.config.savedTemplateRef.linkedAt, before.savedTemplateRef.linkedAt);
  });
});

test("a project already linked to a full template cannot save another full template", () => {
  withFixture(() => {
    saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "full",
      name: "Template Fixture First Full",
      parts: { caption: true, layout: true },
    });

    assert.throws(() => saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "full",
      name: "Template Fixture Duplicate Full",
      parts: { caption: true, layout: true },
    }), /already belongs to a template/i);
  });
});

test("applying a different full template replaces the project template link", () => {
  withFixture(() => {
    const firstTemplate = saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "full",
      name: "Template Fixture Switch First Full",
      parts: { caption: true, character: false, audio: false, layout: false, background: false, content: false },
    });
    const firstRef = normalizeProjectConfig(JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")), FIXTURE_SLUG).savedTemplateRef;
    const freeChanged = normalizeProjectConfig({
      ...JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")),
      savedTemplateRef: null,
      caption: {
        style: "clean-outline",
        animation: "word-color",
        fontFamily: "Anton",
      },
    }, FIXTURE_SLUG);
    writeJson(path.join(fixtureRoot, "video.json"), freeChanged);
    const secondTemplate = saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "full",
      name: "Template Fixture Switch Second Full",
      parts: { caption: true, character: false, audio: false, layout: false, background: false, content: false },
    });
    const linkedToFirst = normalizeProjectConfig({
      ...JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")),
      savedTemplateRef: firstRef,
      caption: {
        style: "vietnam-bold-highlight",
        animation: "word-color",
        fontFamily: "Anton",
      },
    }, FIXTURE_SLUG);
    writeJson(path.join(fixtureRoot, "video.json"), linkedToFirst);

    const result = applyTemplateToVideo(FIXTURE_SLUG, {
      type: secondTemplate.type,
      id: secondTemplate.id,
      parts: { caption: true, character: false, audio: false, layout: false, background: false, content: false },
    });

    assert.equal(result.video.config.savedTemplateRef.id, secondTemplate.id);
    assert.notEqual(result.video.config.savedTemplateRef.id, firstTemplate.id);
    assert.equal(result.video.config.caption.style, "clean-outline");
  });
});

test("updating a linked template overwrites only the linked template and bumps its version", () => {
  withFixture(() => {
    const template = saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "full",
      name: "Template Fixture Updatable Full",
      parts: { caption: true, layout: true },
    });
    const changed = normalizeProjectConfig({
      ...JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")),
      caption: { style: "clean-outline" },
      poseStartSide: "right",
      layout: {
        ...JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")).layout,
        focusScaleLarge: 1.24,
        focusScaleSmall: 0.76,
        focusMotionDuration: 0.65,
        focusImageBlur: 4,
        focusImageDarkness: 0.5,
      },
    }, FIXTURE_SLUG);
    writeJson(path.join(fixtureRoot, "video.json"), changed);

    const result = updateTemplateFromVideo(FIXTURE_SLUG, template.type, template.id, { expectedVersion: 1 });
    const updatedTemplate = JSON.parse(fs.readFileSync(path.join(STUDIO_TEMPLATES_DIR, template.type, template.id, "template.json"), "utf8"));

    assert.equal(result.template.version, 2);
    assert.equal(result.video.config.savedTemplateRef.id, template.id);
    assert.equal(result.video.config.savedTemplateRef.version, 2);
    assert.equal(result.video.config.pipeline.dirty.audio, false);
    assert.equal(updatedTemplate.config.caption.style, "clean-outline");
    assert.equal(updatedTemplate.config.poseStartSide, "right");
    assert.equal(updatedTemplate.config.layout.focusScaleLarge, 1.24);
    assert.equal(updatedTemplate.config.layout.focusScaleSmall, 0.76);
    assert.equal(updatedTemplate.config.layout.focusMotionDuration, 0.65);
    assert.equal(updatedTemplate.config.layout.focusImageBlur, 4);
    assert.equal(updatedTemplate.config.layout.focusImageDarkness, 0.5);
  });
});

test("layout templates ignore per-project compare zoom and crop settings", () => {
  withFixture(() => {
    const source = normalizeProjectConfig(JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")), FIXTURE_SLUG);
    const changed = normalizeProjectConfig({
      ...source,
      compare: {
        ...source.compare,
        leftZoom: 1.37,
        rightZoom: 0.86,
        leftCrop: { x: 0.12, y: 0.18, rotation: 4 },
        rightCrop: { x: -0.08, y: 0.06, rotation: -3 },
      },
      compareSets: source.compareSets.map((set, index) => ({
        ...set,
        leftZoom: 1.2 + index / 10,
        rightZoom: 0.8 + index / 10,
        leftCrop: { x: 0.1 + index / 20, y: 0.2, rotation: 2 },
        rightCrop: { x: -0.1, y: 0.05 + index / 20, rotation: -2 },
      })),
    }, FIXTURE_SLUG);
    writeJson(path.join(fixtureRoot, "video.json"), changed);

    const template = saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "full",
      name: "Template Fixture Dynamic Image Position",
      parts: { caption: false, character: false, audio: false, layout: true, background: false, content: false },
    });

    assert.equal(template.config.compare, undefined);
    assert.equal(template.config.compareSets, undefined);

    const projectBeforeApply = normalizeProjectConfig({
      ...changed,
      compare: {
        ...changed.compare,
        leftZoom: 1.11,
        leftCrop: { x: 0.31, y: 0.22, rotation: 7 },
      },
      compareSets: changed.compareSets.map((set, index) => ({
        ...set,
        leftZoom: index === 0 ? 1.11 : set.leftZoom,
        leftCrop: index === 0 ? { x: 0.31, y: 0.22, rotation: 7 } : set.leftCrop,
        rightZoom: 0.93,
        rightCrop: { x: 0.27, y: 0.14, rotation: -5 },
      })),
    }, FIXTURE_SLUG);
    writeJson(path.join(fixtureRoot, "video.json"), projectBeforeApply);

    const applied = applyTemplateToVideo(FIXTURE_SLUG, {
      type: template.type,
      id: template.id,
      parts: { caption: false, character: false, audio: false, layout: true, background: false, content: false },
    });

    assert.equal(applied.video.config.compare.leftZoom, 1.11);
    assert.deepEqual(applied.video.config.compare.leftCrop, { x: 0.31, y: 0.22, rotation: 7 });
    assert.equal(applied.video.config.compareSets[0].rightZoom, 0.93);
    assert.deepEqual(applied.video.config.compareSets[0].rightCrop, { x: 0.27, y: 0.14, rotation: -5 });
  });
});

test("updating a linked template updates only the source project reference", () => {
  const linkedSlug = "test-template-library-linked-project";
  const linkedRoot = path.join(VIDEOS_DIR, linkedSlug);
  withFixture(() => {
    fs.rmSync(linkedRoot, { recursive: true, force: true });
    try {
      const template = saveTemplateFromVideo(FIXTURE_SLUG, {
        type: "full",
        name: "Template Fixture Propagation Full",
        parts: { caption: true, layout: true, character: false, audio: false, background: false, content: false },
      });
      const sourceConfig = normalizeProjectConfig(JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")), FIXTURE_SLUG);
      const linkedConfig = normalizeProjectConfig({
        ...defaultProjectConfig({ slug: linkedSlug, title: "Linked project", content: "Other content" }),
        savedTemplateRef: sourceConfig.savedTemplateRef,
        caption: { style: "clean-outline" },
      }, linkedSlug);
      writeJson(path.join(linkedRoot, "video.json"), linkedConfig);

      const changedSource = normalizeProjectConfig({
        ...sourceConfig,
        caption: { style: "vietnam-bold-highlight" },
      }, FIXTURE_SLUG);
      writeJson(path.join(fixtureRoot, "video.json"), changedSource);

      const result = updateTemplateFromVideo(FIXTURE_SLUG, template.type, template.id, { expectedVersion: 1 });
      const propagated = normalizeProjectConfig(JSON.parse(fs.readFileSync(path.join(linkedRoot, "video.json"), "utf8")), linkedSlug);

      assert.deepEqual(result.updatedProjects, [FIXTURE_SLUG]);
      assert.equal(result.video.config.savedTemplateRef.version, 2);
      assert.equal(propagated.caption.style, "clean-outline");
      assert.equal(propagated.contentOfficial.hash, linkedConfig.contentOfficial.hash);
      assert.equal(propagated.savedTemplateRef.version, 1);
    } finally {
      fs.rmSync(linkedRoot, { recursive: true, force: true });
    }
  });
});

test("layout template updates do not import per-line content focus settings", () => {
  withFixture(() => {
    const template = saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "full",
      name: "Template Fixture Focus Full",
      parts: { caption: false, character: false, audio: false, layout: true, background: false, content: false },
    });
    const changed = normalizeProjectConfig({
      ...JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")),
      lines: [
        { id: "line-1", text: "Original line", pose: "point-left", focusSide: "right", focusSideLocked: true },
        { id: "line-2", text: "Second line", pose: "point-right", focusSide: "center", focusSideLocked: true },
      ],
    }, FIXTURE_SLUG);
    writeJson(path.join(fixtureRoot, "video.json"), changed);

    const result = updateTemplateFromVideo(FIXTURE_SLUG, template.type, template.id, { expectedVersion: 1 });
    const updatedTemplate = JSON.parse(fs.readFileSync(path.join(STUDIO_TEMPLATES_DIR, template.type, template.id, "template.json"), "utf8"));

    assert.equal(result.updated, false);
    assert.equal(updatedTemplate.config.lineFocus, undefined);
    assert.equal(updatedTemplate.version, template.version);
  });
});

test("attaching a free project to a full template does not change project content", () => {
  withFixture(() => {
    const template = saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "full",
      name: "Template Fixture Attachable Full",
      parts: { caption: true, layout: true, content: true },
    });
    const freeConfig = normalizeProjectConfig({
      ...JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")),
      savedTemplateRef: null,
      lines: [{ id: "line-1", text: "Free project content", pose: "question", role: "question" }],
    }, FIXTURE_SLUG);
    writeJson(path.join(fixtureRoot, "video.json"), freeConfig);

    const beforeContent = contentFromLines(freeConfig.lines);
    const attached = attachVideoToTemplate(FIXTURE_SLUG, { type: template.type, id: template.id });

    assert.equal(attached.config.savedTemplateRef.id, template.id);
    assert.equal(contentFromLines(attached.config.lines), beforeContent);
  });
});

test("deleting a full template clears project links back to free", () => {
  withFixture(() => {
    const template = saveTemplateFromVideo(FIXTURE_SLUG, {
      type: "full",
      name: "Template Fixture Delete Clears Full",
      parts: { caption: true, layout: true },
    });

    const deleted = deleteTemplate(template.type, template.id);
    const config = normalizeProjectConfig(JSON.parse(fs.readFileSync(path.join(fixtureRoot, "video.json"), "utf8")), FIXTURE_SLUG);

    assert.equal(deleted.deleted, true);
    assert.deepEqual(deleted.clearedProjects, [FIXTURE_SLUG]);
    assert.equal(config.savedTemplateRef, null);
  });
});

test("template library rejects invalid type and id values", () => {
  withFixture(() => {
    assert.throws(() => listTemplates("bad-type"), /Invalid template type/);
    assert.throws(() => applyTemplateToVideo(FIXTURE_SLUG, { type: "caption", id: "../bad", parts: { caption: true } }), /Invalid template id/);
  });
});
