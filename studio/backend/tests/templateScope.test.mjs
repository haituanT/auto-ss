import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  TEMPLATE_SCOPE_VERSION,
  diffTemplateScope,
  pickTemplateScope,
} from "../../../shared/templateScope.mjs";
import { migrateTemplateFile } from "../../../scripts/migrate-template-scope.mjs";

test("full template scope strips project content and runtime fields", () => {
  const scope = pickTemplateScope({
    caption: { style: "capcut-karaoke", fontFamily: "Anton" },
    character: { packId: "default", scale: 1.2, poses: { "point-left": "assets/character/point-left.webm" } },
    audio: {
      provider: "aimax",
      voiceId: "voice-1",
      mainAudio: "assets/vo/full.mp3",
      srt: "assets/vo/full.srt",
      bgm: "assets/bgm.mp3",
    },
    poseSfx: { "point-left": "click.wav" },
    compare: {
      leftLabel: "Project label",
      rightLabel: "Project label B",
      leftImage: "assets/project-left.png",
      leftCrop: { x: 0.3, rotation: 5 },
    },
    compareSets: [{ id: "compare-1", leftLabel: "Content", leftImage: "left.png" }],
    lines: [{ id: "line-1", text: "Project content", start: 1.2, duration: 2 }],
    contentDraft: { text: "draft" },
    contentOfficial: { hash: "hash" },
    layout: {
      compareTop: 170,
      characterY: 1180,
      compareLabelPlacement: "below",
      compareLabelAlign: "right",
      compareLabelHeight: 124,
      compareLabelBackgroundOpacity: 0.8,
    },
    render: { width: 1080, height: 1920, fps: 30, preferredMode: "gpu" },
    pipeline: { dirty: { render: true } },
  }, { parts: { caption: true, character: true, audio: true, layout: true, background: false, render: true, content: false } });

  assert.equal(scope.caption.style, "capcut-karaoke");
  assert.equal(scope.audio.mainAudio, undefined);
  assert.equal(scope.audio.srt, undefined);
  assert.equal(scope.lines, undefined);
  assert.equal(scope.contentDraft, undefined);
  assert.equal(scope.compare, undefined);
  assert.equal(scope.compareSets, undefined);
  assert.equal(scope.pipeline, undefined);
  assert.equal(scope.layout.compareLabelPlacement, "below");
  assert.equal(scope.layout.compareLabelAlign, "right");
  assert.equal(scope.layout.compareLabelHeight, 124);
  assert.equal(scope.layout.compareLabelBackgroundOpacity, 0.8);
  assert.deepEqual(scope.render, { width: 1080, height: 1920, fps: 30, preferredMode: "gpu" });
});

test("scope diff ignores content, images, crops and timing", () => {
  const template = {
    caption: { style: "old-style" },
    layout: { compareTop: 170 },
    compare: { leftLabel: "A", leftImage: "template.png", leftCrop: { x: 0 } },
    lines: [{ text: "old" }],
  };
  const project = {
    ...template,
    caption: { style: "new-style" },
    compare: { leftLabel: "new content", leftImage: "project.png", leftCrop: { x: 0.8 } },
    lines: [{ text: "new content", start: 4 }],
  };
  const diffs = diffTemplateScope(project, template, {
    parts: { caption: true, layout: true, content: false },
  });
  assert.deepEqual(diffs.map((diff) => diff.key), ["caption.style"]);
});

test("template migration writes scope version and strips legacy full config", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "template-scope-test-"));
  const filePath = path.join(tempRoot, "template.json");
  fs.writeFileSync(filePath, `${JSON.stringify({
    version: 4,
    type: "full",
    id: "legacy-template",
    name: "Legacy",
    parts: { caption: true, character: true, audio: true, layout: true, background: true },
    config: {
      caption: { style: "old-style" },
      compare: { leftLabel: "bad", leftImage: "project.png" },
      compareSets: [{ id: "compare-1", leftLabel: "bad" }],
      lines: [{ text: "must be removed" }],
      audio: { voiceId: "voice", mainAudio: "assets/vo/full.mp3" },
    },
  }, null, 2)}\n`, "utf8");
  try {
    const report = migrateTemplateFile(filePath);
    const migrated = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(report.changed, true);
    assert.equal(migrated.scopeVersion, TEMPLATE_SCOPE_VERSION);
    assert.equal(migrated.parts.content, false);
    assert.equal(migrated.config.lines, undefined);
    assert.equal(migrated.config.compare, undefined);
    assert.equal(migrated.config.audio.mainAudio, undefined);
    assert.ok(Array.isArray(migrated.changelog));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
