import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { STUDIO_TEMPLATES_DIR, VIDEOS_DIR } from "../paths.mjs";
import { defaultProjectConfig, normalizeProjectConfig } from "../services/projectConfig.mjs";
import { createVideo } from "../services/videoCreator.mjs";
import {
  applyLatestTemplateUpdate,
  deleteTemplate,
  getTemplateStatus,
  saveTemplateFromVideo,
  updateTemplateFromVideo,
} from "../services/templateLibrary.mjs";

const SOURCE_SLUG = "test-template-isolation-source";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createSourceProject() {
  const root = path.join(VIDEOS_DIR, SOURCE_SLUG);
  fs.rmSync(root, { recursive: true, force: true });
  for (const pose of ["point-left", "point-right", "question"]) {
    const filePath = path.join(root, "assets", "character", `${pose}.webm`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, pose, "utf8");
  }
  const config = normalizeProjectConfig({
    ...defaultProjectConfig({ slug: SOURCE_SLUG, title: "Isolation source", content: "Source content" }),
    character: {
      packId: "default",
      scale: 1,
      x: 0,
      y: 0,
      poses: {
        "point-left": "assets/character/point-left.webm",
        "point-right": "assets/character/point-right.webm",
        question: "assets/character/question.webm",
      },
    },
  }, SOURCE_SLUG);
  writeJson(path.join(root, "video.json"), config);
  return root;
}

test("full template projects receive isolated versioned assets", async () => {
  const sourceRoot = createSourceProject();
  let template;
  const projectRoots = [];
  try {
    template = saveTemplateFromVideo(SOURCE_SLUG, {
      type: "full",
      name: "Isolation test template",
      parts: { caption: false, character: true, audio: false, layout: false, background: false, render: false },
    });
    const a = await createVideo({ slug: "test-template-isolation-a", title: "A", templateRef: { type: "full", id: template.id } });
    const b = await createVideo({ slug: "test-template-isolation-b", title: "B", templateRef: { type: "full", id: template.id } });
    projectRoots.push(a.root, b.root);

    const poseA = a.config.character.poses["point-left"];
    const poseB = b.config.character.poses["point-left"];
    assert.match(poseA, new RegExp(`^assets/template/${template.id}/v1/`));
    assert.match(poseB, new RegExp(`^assets/template/${template.id}/v1/`));
    assert.doesNotMatch(JSON.stringify(a.config), /studio-templates/i);
    assert.notEqual(path.resolve(a.root, poseA), path.resolve(b.root, poseB));
    assert.equal(fs.existsSync(path.join(a.root, poseA)), true);
    assert.equal(fs.existsSync(path.join(b.root, poseB)), true);

    fs.rmSync(path.join(a.root, poseA), { force: true });
    assert.equal(fs.existsSync(path.join(b.root, poseB)), true);
    assert.equal(fs.existsSync(path.join(STUDIO_TEMPLATES_DIR, "full", template.id, template.config.character.poses["point-left"])), true);

    const status = getTemplateStatus(a.slug);
    assert.equal(status.canUpdateTemplate, false);
    assert.ok(status.blockedReasons.some((reason) => /point-left/i.test(reason)));
    assert.throws(() => updateTemplateFromVideo(a.slug, "full", template.id, { expectedVersion: 1 }), /missing required asset/i);
    const unchanged = JSON.parse(fs.readFileSync(path.join(STUDIO_TEMPLATES_DIR, "full", template.id, "template.json"), "utf8"));
    assert.equal(unchanged.version, 1);
  } finally {
    for (const root of projectRoots) fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    if (template) {
      try { deleteTemplate("full", template.id); } catch { /* already removed */ }
    }
  }
});

test("applying a newer template keeps project content, images and timing", async () => {
  const sourceRoot = createSourceProject();
  const projectRoot = path.join(VIDEOS_DIR, "test-template-isolation-apply");
  fs.rmSync(projectRoot, { recursive: true, force: true });
  let template;
  try {
    template = saveTemplateFromVideo(SOURCE_SLUG, {
      type: "full",
      name: "Isolation apply template",
      parts: { caption: true, character: true, audio: false, layout: true, background: false, render: true },
    });
    const created = await createVideo({ slug: "test-template-isolation-apply", title: "Apply target", content: "Project content", templateRef: { type: "full", id: template.id } });
    const before = normalizeProjectConfig({
      ...created.config,
      caption: { ...created.config.caption, style: "vietnam-bold-highlight" },
      lines: [{ ...created.config.lines[0], text: "Keep this line", start: 4.2, duration: 3.1 }],
      compare: { ...created.config.compare, leftImage: "assets/project-left.png", leftCrop: { x: 0.2, y: 0.1, rotation: 3 } },
      compareSets: created.config.compareSets.map((set, index) => index === 0
        ? { ...set, leftImage: "assets/project-left.png", leftCrop: { x: 0.2, y: 0.1, rotation: 3 } }
        : set),
      audio: { ...created.config.audio, mainAudio: "assets/vo/project.mp3", srt: "assets/vo/project.srt" },
    }, created.slug);
    writeJson(path.join(projectRoot, "video.json"), before);

    const source = normalizeProjectConfig(JSON.parse(fs.readFileSync(path.join(sourceRoot, "video.json"), "utf8")), SOURCE_SLUG);
    writeJson(path.join(sourceRoot, "video.json"), normalizeProjectConfig({
      ...source,
      caption: { ...source.caption, style: "clean-outline" },
    }, SOURCE_SLUG));
    const updated = updateTemplateFromVideo(SOURCE_SLUG, "full", template.id, { expectedVersion: 1 });
    assert.equal(updated.template.version, 2);

    const status = getTemplateStatus(created.slug);
    assert.equal(status.isBehind, true);
    assert.equal(status.canUpdateTemplate, true);
    const result = applyLatestTemplateUpdate(created.slug);
    assert.equal(result.video.config.caption.style, "clean-outline");
    assert.equal(result.video.config.lines[0].text, "Keep this line");
    assert.equal(result.video.config.lines[0].start, 4.2);
    assert.equal(result.video.config.compare.leftImage, "assets/project-left.png");
    assert.deepEqual(result.video.config.compare.leftCrop, { x: 0.2, y: 0.1, rotation: 3 });
    assert.equal(result.video.config.audio.mainAudio, "assets/vo/project.mp3");
    assert.equal(result.video.config.audio.srt, "assets/vo/project.srt");
    assert.equal(result.video.config.savedTemplateRef.version, 2);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    if (template) {
      try { deleteTemplate("full", template.id); } catch { /* already removed */ }
    }
  }
});
