import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { videoPath } from "../paths.mjs";
import { defaultProjectConfig } from "../services/projectConfig.mjs";
import {
  buildPipelineStatus,
  clearOfficialRenderDirty,
  markDirty,
  readOfficialRender,
  writeOfficialRender,
} from "../services/projectPipeline.mjs";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function cleanup(slug) {
  fs.rmSync(videoPath(slug), { recursive: true, force: true });
}

test("official render metadata points at one verified MP4", () => {
  const slug = `pipeline-render-${Date.now()}`;
  const root = videoPath(slug);
  try {
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(path.join(root, "renders"), { recursive: true });
    writeJson(path.join(root, "video.json"), markDirty(defaultProjectConfig({ slug }), ["render"]));
    const outputPath = path.join(root, "renders", "current.mp4");
    fs.writeFileSync(outputPath, "mp4", "utf8");

    const official = writeOfficialRender(root, {
      outputPath,
      propsHash: "props-hash",
      assetManifestHash: "asset-hash",
      renderMode: "gpu",
      verification: {
        verificationPath: path.join(root, "renders", "current.verification.json"),
        frames: [{ path: path.join(root, "renders", "current-frame-1.jpg") }],
        renderedAt: "2026-07-31T00:00:00.000Z",
      },
    });

    assert.equal(official.name, "current.mp4");
    assert.equal(official.propsHash, "props-hash");
    assert.equal(official.assetManifestHash, "asset-hash");
    assert.equal(official.renderMode, "gpu");
    assert.equal(official.framePaths.length, 1);
    assert.match(official.url, /\/videos-media\/pipeline-render-/);
    assert.equal(readOfficialRender(root).name, "current.mp4");

    clearOfficialRenderDirty(root);
    const saved = JSON.parse(fs.readFileSync(path.join(root, "video.json"), "utf8"));
    assert.equal(saved.pipeline.dirty.render, false);
    assert.deepEqual(saved.pipeline.dirtyReasons, []);
  } finally {
    cleanup(slug);
  }
});

test("official render metadata is ignored when the MP4 is gone", () => {
  const slug = `pipeline-render-missing-${Date.now()}`;
  const root = videoPath(slug);
  try {
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(path.join(root, "renders"), { recursive: true });
    writeJson(path.join(root, "renders", "official-render.json"), { fileName: "missing.mp4" });

    assert.equal(readOfficialRender(root), null);
  } finally {
    cleanup(slug);
  }
});

test("pipeline status reports stale official render without dropping metadata", () => {
  const slug = `pipeline-render-stale-${Date.now()}`;
  const root = videoPath(slug);
  try {
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(path.join(root, "renders"), { recursive: true });
    writeJson(path.join(root, "video.json"), markDirty(defaultProjectConfig({ slug }), ["style", "render"]));
    const outputPath = path.join(root, "renders", "stale.mp4");
    fs.writeFileSync(outputPath, "mp4", "utf8");

    writeOfficialRender(root, {
      outputPath,
      propsHash: "props-old",
      assetManifestHash: "asset-old",
      renderMode: "gpu",
    });

    const status = buildPipelineStatus(slug);

    assert.equal(status.render, "dirty");
    assert.equal(status.officialRender.name, "stale.mp4");
  } finally {
    cleanup(slug);
  }
});
