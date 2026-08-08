import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { VIDEOS_DIR } from "../paths.mjs";
import { cancelJob, createJob, resetJobStoreForTests } from "../services/jobStore.mjs";
import { commitVideoContent, deleteVideo, deleteVideosBySlug, getVideo, listVideos, normalizeVideoLines, saveVideo } from "../services/videoManager.mjs";

const FIXTURE_SLUG = "test-video-manager-fixture";
const fixtureRoot = path.join(VIDEOS_DIR, FIXTURE_SLUG);

function withFixture(run) {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, "video.json"), `${JSON.stringify({
    version: 2,
    slug: FIXTURE_SLUG,
    title: "Sấm vs Chớp",
    compare: { leftLabel: "Sấm", rightLabel: "Chớp" },
    lines: [{ id: "line-1", text: "Đây là sấm." }],
  }, null, 2)}\n`);

  try {
    return run();
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

test("video manager lists projects from the current videos folder", () => {
  withFixture(() => {
    const videos = listVideos();
    assert.ok(videos.some((video) => video.slug === FIXTURE_SLUG));
  });
});

test("video manager deletes only requested projects", () => {
  const slugs = ["test-video-manager-delete-a", "test-video-manager-delete-b"];
  const roots = slugs.map((slug) => path.join(VIDEOS_DIR, slug));
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "video.json"), `${JSON.stringify({
      version: 2,
      slug: path.basename(root),
      title: path.basename(root),
      compare: { leftLabel: "A", rightLabel: "B" },
      lines: [{ id: "line-1", text: "Test." }],
    }, null, 2)}\n`);
  }

  try {
    const result = deleteVideosBySlug([slugs[0]]);

    assert.deepEqual(result.deleted, [slugs[0]]);
    assert.equal(fs.existsSync(roots[0]), false);
    assert.equal(fs.existsSync(roots[1]), true);
  } finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  }
});

test("video manager blocks deleting a project with an active job", () => {
  const slug = "test-video-manager-busy-" + Date.now();
  const root = path.join(VIDEOS_DIR, slug);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "video.json"), "{}\n");
  resetJobStoreForTests();
  try {
    const job = createJob("remotion-render", slug, { family: "render", status: "queued" });
    assert.throws(() => deleteVideo(slug), (error) => error.code === "PROJECT_BUSY" && error.status === 409);
    cancelJob(job.id, "cleanup");
    assert.equal(deleteVideo(slug).deleted, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    resetJobStoreForTests();
  }
});

test("bulk delete reports busy projects without deleting them", () => {
  const slugs = ["test-video-manager-bulk-busy-" + Date.now(), "test-video-manager-bulk-free-" + Date.now()];
  const roots = slugs.map((slug) => path.join(VIDEOS_DIR, slug));
  resetJobStoreForTests();
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "video.json"), "{}\n");
  }
  try {
    const job = createJob("generate-vo", slugs[0], { family: "audio", status: "queued" });
    const result = deleteVideosBySlug(slugs);
    assert.deepEqual(result.deleted, [slugs[1]]);
    assert.equal(result.blocked.length, 1);
    assert.equal(result.blocked[0].slug, slugs[0]);
    assert.equal(fs.existsSync(roots[0]), true);
    assert.equal(fs.existsSync(roots[1]), false);
    cancelJob(job.id, "cleanup");
  } finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    resetJobStoreForTests();
  }
});

test("video manager lists only renders folder MP4 files as official renders", () => {
  withFixture(() => {
    const rendersDir = path.join(fixtureRoot, "renders");
    fs.mkdirSync(rendersDir, { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, "old-root-render.mp4"), "old");
    fs.writeFileSync(path.join(rendersDir, "official-render.mp4"), "new");

    const video = getVideo(FIXTURE_SLUG);

    assert.deepEqual(video.renders.map((render) => render.name), ["official-render.mp4"]);
    assert.equal(video.renders[0].location, "renders");
  });
});

test("video manager reads official-render.json before fallback MP4 files", () => {
  withFixture(() => {
    const rendersDir = path.join(fixtureRoot, "renders");
    fs.mkdirSync(rendersDir, { recursive: true });
    fs.writeFileSync(path.join(rendersDir, "old-latest.mp4"), "old");
    fs.writeFileSync(path.join(rendersDir, "official-current.mp4"), "official");
    fs.writeFileSync(path.join(rendersDir, "official-render.json"), `${JSON.stringify({
      fileName: "official-current.mp4",
      propsHash: "props-ok",
      assetManifestHash: "assets-ok",
      renderMode: "gpu",
      verifiedAt: "2026-07-31T00:00:00.000Z",
    }, null, 2)}\n`, "utf8");

    const video = getVideo(FIXTURE_SLUG);

    assert.deepEqual(video.renders.map((render) => render.name), ["official-current.mp4"]);
    assert.equal(video.officialRender.name, "official-current.mp4");
    assert.equal(video.officialRender.propsHash, "props-ok");
    assert.equal(video.pipelineStatus.officialRender.name, "official-current.mp4");
  });
});

test("video manager keeps official render metadata when render is dirty", () => {
  withFixture(() => {
    const rendersDir = path.join(fixtureRoot, "renders");
    fs.mkdirSync(rendersDir, { recursive: true });
    fs.writeFileSync(path.join(rendersDir, "official-stale.mp4"), "official");
    fs.writeFileSync(path.join(rendersDir, "official-render.json"), `${JSON.stringify({
      fileName: "official-stale.mp4",
      propsHash: "props-old",
      assetManifestHash: "assets-old",
      renderMode: "gpu",
      verifiedAt: "2026-07-31T00:00:00.000Z",
    }, null, 2)}\n`, "utf8");
    const configPath = path.join(fixtureRoot, "video.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.pipeline = {
      dirty: { content: false, audio: false, assets: false, style: true, layout: false, render: true },
      dirtyReasons: ["style", "render"],
      officialSnapshot: { propsHash: "props-old", assetManifestHash: "assets-old", createdAt: "2026-07-31T00:00:00.000Z" },
    };
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const video = getVideo(FIXTURE_SLUG);

    assert.equal(video.pipelineStatus.render, "dirty");
    assert.equal(video.officialRender.name, "official-stale.mp4");
    assert.deepEqual(video.renders.map((render) => render.name), ["official-stale.mp4"]);
  });
});

test("video manager normalizes a video.json v2 project", () => {
  withFixture(() => {
    const video = getVideo(FIXTURE_SLUG);
    assert.equal(video.hasVideoJson, true);
    assert.equal(video.config.compare.leftLabel, "Sấm");
    assert.equal(video.config.character.packId, "default");
    assert.ok(video.config.character.poses["point-left"]);
  });
});

test("gán nhân vật honors the selected starting side for every pointing line", () => {
  withFixture(() => {
    const video = normalizeVideoLines(FIXTURE_SLUG, {
      compare: { leftLabel: "A", rightLabel: "B" },
      compareSets: [
        { id: "compare-1", leftLabel: "A", rightLabel: "B" },
        { id: "compare-2", leftLabel: "C", rightLabel: "D" },
      ],
      contentByCompareSet: {
        "compare-1": "A\nB\nQuestion?\nMore A\nMore B",
        "compare-2": "C\nD",
      },
      poseStartSide: "right",
    });

    assert.deepEqual(video.config.lines.map((line) => line.pose), [
      "point-right",
      "point-left",
      "question",
      "point-right",
      "point-left",
      "point-right",
      "point-left",
    ]);
    assert.deepEqual(video.config.lines.map((line) => line.focusSide), [
      "left",
      "right",
      "center",
      "left",
      "right",
      "left",
      "right",
    ]);
  });
});

test("gán nhân vật without content changes does not dirty audio", () => {
  withFixture(() => {
    const current = getVideo(FIXTURE_SLUG).config;
    const video = normalizeVideoLines(FIXTURE_SLUG, {
      contentByCompareSet: {
        "compare-1": current.lines.map((line) => line.text).join("\n"),
        "compare-2": "",
      },
      compare: current.compare,
      compareSets: current.compareSets,
      poseStartSide: "right",
    });

    assert.equal(video.config.pipeline.dirty.audio, false);
    assert.equal(video.config.pipeline.dirty.content, false);
    assert.equal(video.config.pipeline.dirty.style, true);
    assert.equal(video.config.pipeline.dirty.render, true);
    assert.equal(video.config.lines[0].pose, "point-right");
    assert.equal(video.config.lines[0].focusSide, "left");
  });
});

test("committing changed official content marks content, audio and render dirty", () => {
  withFixture(() => {
    const saved = commitVideoContent(FIXTURE_SLUG, {
      content: "New line one\nNew line two",
      compare: { leftLabel: "Sáº¥m", rightLabel: "Chá»›p" },
    });
    const dirty = saved.config.pipeline.dirty;

    assert.equal(dirty.content, true);
    assert.equal(dirty.audio, true);
    assert.equal(dirty.render, true);
    assert.equal(dirty.assets, false);
    assert.deepEqual(saved.config.pipeline.dirtyReasons.sort(), ["audio", "content", "render"]);
    assert.equal(saved.pipelineStatus.audio, "dirty");
    assert.equal(saved.pipelineStatus.render, "dirty");
  });
});

test("saving caption and layout marks only style, layout and render dirty", () => {
  withFixture(() => {
    const saved = saveVideo(FIXTURE_SLUG, {
      caption: { fontSize: 82 },
      layout: { captionY: 760, captionYExplicit: true },
    });
    const dirty = saved.config.pipeline.dirty;

    assert.equal(dirty.content, false);
    assert.equal(dirty.audio, false);
    assert.equal(dirty.assets, false);
    assert.equal(dirty.style, true);
    assert.equal(dirty.layout, true);
    assert.equal(dirty.render, true);
    assert.deepEqual(saved.config.pipeline.dirtyReasons.sort(), ["layout", "render", "style"]);
  });
});

test("saving render preference persists without dirtying the render pipeline", () => {
  withFixture(() => {
    const saved = saveVideo(FIXTURE_SLUG, {
      render: { preferredMode: "classic" },
    });
    const dirty = saved.config.pipeline.dirty;

    assert.equal(saved.config.render.preferredMode, "classic");
    assert.equal(dirty.content, false);
    assert.equal(dirty.audio, false);
    assert.equal(dirty.assets, false);
    assert.equal(dirty.style, false);
    assert.equal(dirty.layout, false);
    assert.equal(dirty.render, false);
    assert.deepEqual(saved.config.pipeline.dirtyReasons, []);
  });
});

test("saving voice and BGM volume only marks render dirty", () => {
  withFixture(() => {
    const saved = saveVideo(FIXTURE_SLUG, {
      audio: { voiceVolume: 0.8, bgmVolume: 0.24 },
    });
    const dirty = saved.config.pipeline.dirty;

    assert.equal(saved.config.audio.voiceVolume, 0.8);
    assert.equal(saved.config.audio.bgmVolume, 0.24);
    assert.equal(dirty.content, false);
    assert.equal(dirty.audio, false);
    assert.equal(dirty.assets, false);
    assert.equal(dirty.render, true);
    assert.equal(saved.config.lines.some((line) => line.dirtyVoice), false);
  });
});
