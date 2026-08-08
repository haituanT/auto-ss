import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, SHARED_ASSETS_DIR, VIDEOS_DIR } from "./paths.mjs";
import { getAssetStatus } from "./services/assetStatus.mjs";
import { getStatus, listAimaxVoices, testAimaxVoices } from "./services/envStatus.mjs";
import { getAimaxSettings, saveAimaxSettings } from "./services/aimaxSettings.mjs";
import { cancelJob, getJob, getJobLogs, interruptActiveJobs, listJobs, publicJob } from "./services/jobStore.mjs";
import { shutdownJobQueue } from "./services/jobQueue.mjs";
import { startPreview, stopPreview, previewStatus } from "./services/previewManager.mjs";
import { runGenerateVo, runTrimVo } from "./services/scriptRunner.mjs";
import { attachVideoToTemplate, commitVideoContent, deleteVideo, getVideo, listVideos, normalizeVideoLines, saveContentDraft, saveVideo } from "./services/videoManager.mjs";
import { applySharedAssetsToVideo, createVideo, rebuildVideo } from "./services/videoCreator.mjs";
import { generateCompareImages } from "./services/imageGenerator.mjs";
import { uploadAsset, uploadTempDir } from "./services/assetUpload.mjs";
import { deleteCharacterAsset, getCharacterAssetStatus, uploadVideoAsset } from "./services/videoAssets.mjs";
import { cancelIllustrationSlot, getIllustrationStatus, selectIllustrationVariant, startIllustrationGeneration } from "./services/illustrationService.mjs";
import { uploadFullAudio } from "./services/videoAudio.mjs";
import { runAutoCreateVideo } from "./services/autoWorkflow.mjs";
import { buildPreviewProps, createFinalSnapshot, getFinalSnapshot, runRemotionCheckJob, runRemotionRenderJob } from "./services/remotionRenderer.mjs";
import { listSfx, listSfxSources, uploadSfx } from "./services/sfxLibrary.mjs";
import { createLocalAuthMiddleware } from "./services/localAuth.mjs";
import { serveVideoMedia } from "./services/videoMedia.mjs";
import { errorPayload, notFound } from "./services/httpErrors.mjs";
import { assertArray, assertBodyObject, assertSlug } from "./services/validation.mjs";
import { withProjectLock } from "./services/projectLocks.mjs";
import {
  applyTemplateToVideo,
  applyLatestTemplateUpdate,
  deleteTemplate,
  duplicateTemplate,
  getTemplate,
  getTemplateStatus,
  listTemplates,
  renameTemplate,
  saveTemplateFromVideo,
  updateTemplateFromVideo,
} from "./services/templateLibrary.mjs";

const app = express();
const port = Number(process.env.STUDIO_PORT || 3101);
const host = String(process.env.STUDIO_HOST || "127.0.0.1").trim() || "127.0.0.1";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(__dirname, "..", "frontend", "dist");
const uploadDir = uploadTempDir();
const upload = multer({ dest: uploadDir, limits: { fileSize: 500 * 1024 * 1024 } });
const audioUpload = multer({ dest: uploadDir, limits: { fileSize: 250 * 1024 * 1024 } });
const sfxUpload = multer({ dest: uploadDir, limits: { fileSize: 50 * 1024 * 1024 } });

app.use(express.json({ limit: "4mb" }));
app.use("/shared-assets", express.static(SHARED_ASSETS_DIR));
app.use("/videos-media", serveVideoMedia);
app.use("/api", createLocalAuthMiddleware());
app.param("slug", (req, _res, next, value) => {
  try {
    req.params.slug = assertSlug(value);
    next();
  } catch (error) {
    next(error);
  }
});

app.get("/api/status", async (_req, res) => {
  res.json(await getStatus());
});

app.get("/api/voices", async (_req, res) => {
  res.json(await listAimaxVoices());
});

app.post("/api/voices/test", async (req, res, next) => {
  try {
    const body = assertBodyObject(req.body || {});
    res.json(await testAimaxVoices({
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      voiceId: body.voiceId,
    }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/aimax/settings", (_req, res) => {
  res.json(getAimaxSettings());
});

app.put("/api/aimax/settings", (req, res, next) => {
  try {
    res.json(saveAimaxSettings(req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.get("/api/assets/status", async (_req, res) => {
  res.json(await getAssetStatus());
});

app.post("/api/assets/upload", upload.single("file"), async (req, res, next) => {
  try {
    res.json(await uploadAsset({
      kind: req.body.kind,
      pose: req.body.pose,
      file: req.file,
    }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/sfx", (_req, res) => {
  res.json({ sounds: listSfx(), sources: listSfxSources() });
});

app.post("/api/sfx/upload", sfxUpload.array("files", 50), (req, res, next) => {
  try {
    res.json(uploadSfx(req.files || [], {
      sourceId: req.body?.sourceId,
      label: req.body?.label,
      category: req.body?.category,
      tags: req.body?.tags,
      source: req.body?.source,
      sourceUrl: req.body?.sourceUrl,
      license: req.body?.license,
      description: req.body?.description,
    }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/templates", (req, res, next) => {
  try {
    res.json({ templates: listTemplates(req.query.type || "") });
  } catch (error) {
    next(error);
  }
});

app.get("/api/templates/:type/:id", (req, res, next) => {
  try {
    res.json(getTemplate(req.params.type, req.params.id));
  } catch (error) {
    next(error);
  }
});

app.post("/api/templates/from-video/:slug", (req, res, next) => {
  try {
    res.json(saveTemplateFromVideo(req.params.slug, req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.post("/api/templates/:type/:id/update-from-video/:slug", (req, res, next) => {
  try {
    res.json(updateTemplateFromVideo(req.params.slug, req.params.type, req.params.id, req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/templates/:type/:id", (req, res, next) => {
  try {
    res.json(renameTemplate(req.params.type, req.params.id, req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/templates/:type/:id", (req, res, next) => {
  try {
    res.json(deleteTemplate(req.params.type, req.params.id));
  } catch (error) {
    next(error);
  }
});

app.post("/api/templates/:type/:id/duplicate", (req, res, next) => {
  try {
    res.json(duplicateTemplate(req.params.type, req.params.id));
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos", (_req, res) => {
  res.json(listVideos());
});

app.post("/api/videos", async (req, res, next) => {
  try {
    res.json(await createVideo(assertBodyObject(req.body || {})));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/videos", async (req, res, next) => {
  try {
    const body = assertBodyObject(req.body || {});
    const slugs = assertArray(body.slugs, "Project list");
    const uniqueSlugs = [...new Set(slugs.map((slug) => assertSlug(slug)))];
    if (!uniqueSlugs.length) {
      res.json({ deleted: [], blocked: [] });
      return;
    }
    const deleted = [];
    const blocked = [];
    for (const slug of uniqueSlugs) {
      try {
        await withProjectLock(slug, "delete project", () => deleteVideo(slug));
        deleted.push(slug);
      } catch (error) {
        if (error?.code === "PROJECT_BUSY") {
          blocked.push({ slug, reason: error.message });
          continue;
        }
        throw error;
      }
    }
    res.json({ deleted, blocked });
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/auto-create", (req, res, next) => {
  try {
    res.json(runAutoCreateVideo(assertBodyObject(req.body || {})));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/auto-create-with-audio", upload.fields([
  { name: "audio", maxCount: 1 },
  { name: "subtitles", maxCount: 1 },
  { name: "compareLeft", maxCount: 1 },
  { name: "compareRight", maxCount: 1 },
]), (req, res, next) => {
  try {
    res.json(runAutoCreateVideo({
      ...req.body,
      uploadedAudio: req.files?.audio?.[0],
      uploadedSrt: req.files?.subtitles?.[0],
      uploadedCompareLeft: req.files?.compareLeft?.[0],
      uploadedCompareRight: req.files?.compareRight?.[0],
      audioMode: "uploaded",
      render: req.body?.render !== "false",
    }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:slug", (req, res, next) => {
  try {
    res.json(getVideo(req.params.slug));
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:slug/preview-props", (req, res, next) => {
  try {
    res.json(buildPreviewProps(req.params.slug, { previewPose: req.query.pose }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:slug/snapshot/final", (req, res, next) => {
  try {
    res.json(getFinalSnapshot(req.params.slug));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/snapshot/final", async (req, res, next) => {
  try {
    res.json(await withProjectLock(req.params.slug, "create final snapshot", () => createFinalSnapshot(req.params.slug, {
      allowWarnings: req.body?.allowWarnings !== false,
    })));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/videos/:slug", async (req, res, next) => {
  try {
    res.json(await withProjectLock(req.params.slug, "delete project", () => deleteVideo(req.params.slug)));
  } catch (error) {
    next(error);
  }
});

app.put("/api/videos/:slug", async (req, res, next) => {
  try {
    res.json(await withProjectLock(req.params.slug, "save video", () => saveVideo(req.params.slug, req.body || {})));
  } catch (error) {
    next(error);
  }
});

app.put("/api/videos/:slug/content/draft", async (req, res, next) => {
  try {
    res.json(await withProjectLock(req.params.slug, "save content draft", () => saveContentDraft(req.params.slug, req.body || {})));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/content/commit", async (req, res, next) => {
  try {
    res.json(await withProjectLock(req.params.slug, "commit content", () => commitVideoContent(req.params.slug, req.body || {})));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/normalize-lines", async (req, res, next) => {
  try {
    res.json(await withProjectLock(req.params.slug, "normalize video lines", () => normalizeVideoLines(req.params.slug, req.body || {})));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/template-ref", async (req, res, next) => {
  try {
    res.json(await withProjectLock(req.params.slug, "attach template", () => attachVideoToTemplate(req.params.slug, req.body || {})));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/apply-template", async (req, res, next) => {
  try {
    res.json(await withProjectLock(req.params.slug, "apply template", () => applyTemplateToVideo(req.params.slug, req.body || {})));
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:slug/template-status", (req, res, next) => {
  try {
    res.json(getTemplateStatus(req.params.slug));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/apply-template-update", async (req, res, next) => {
  try {
    res.json(await withProjectLock(req.params.slug, "apply latest template update", () => applyLatestTemplateUpdate(req.params.slug)));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/assets/upload", upload.single("file"), async (req, res, next) => {
  try {
    res.json(await uploadVideoAsset({
      slug: req.params.slug,
      kind: req.body.kind,
      file: req.file,
    }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/illustrations/generate", (req, res, next) => {
  try {
    res.json(startIllustrationGeneration({
      slug: req.params.slug,
      compareSetId: req.body?.compareSetId,
      targets: req.body?.targets,
      items: req.body?.items,
      mode: req.body?.mode,
      provider: req.body?.provider,
      style: req.body?.style,
      variants: req.body?.variants,
    }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:slug/illustrations/status", (req, res, next) => {
  try {
    res.json(getIllustrationStatus(req.params.slug));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/illustrations/cancel", async (req, res, next) => {
  try {
    res.json(await cancelIllustrationSlot({
      slug: req.params.slug,
      compareSetId: req.body?.compareSetId,
      target: req.body?.target,
      jobId: req.body?.jobId,
    }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/illustrations/select", async (req, res, next) => {
  try {
    res.json(await selectIllustrationVariant({
      slug: req.params.slug,
      compareSetId: req.body?.compareSetId,
      target: req.body?.target,
      variant: req.body?.variant,
    }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:slug/assets/character/status", (req, res, next) => {
  try {
    res.json(getCharacterAssetStatus(req.params.slug));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/videos/:slug/assets/character/:pose", async (req, res, next) => {
  try {
    res.json(await withProjectLock(req.params.slug, "delete character asset", () => deleteCharacterAsset({
      slug: req.params.slug,
      pose: req.params.pose,
    })));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/generate-vo", (req, res, next) => {
  try {
    res.json(runGenerateVo(req.params.slug, req.body?.mode || "aimax", {
      voiceId: req.body?.voiceId,
      speed: req.body?.speed,
      pitch: req.body?.pitch,
      lineId: req.body?.lineId,
      apiKey: req.body?.apiKey,
      baseUrl: req.body?.baseUrl,
    }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/trim-vo", (req, res, next) => {
  try {
    res.json(runTrimVo(req.params.slug));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/audio/upload", audioUpload.single("file"), async (req, res, next) => {
  try {
    res.json(await uploadFullAudio({ slug: req.params.slug, file: req.file }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/build", (req, res, next) => {
  try {
    res.json(rebuildVideo(req.params.slug));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/apply-assets", (req, res, next) => {
  try {
    res.json(applySharedAssetsToVideo(req.params.slug));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/generate-images", async (req, res, next) => {
  try {
    res.json(await generateCompareImages(req.params.slug));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/check", (req, res, next) => {
  try {
    res.json(runRemotionCheckJob(req.params.slug));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/render", (req, res, next) => {
  try {
    res.json(runRemotionRenderJob(req.params.slug, { renderMode: req.body?.renderMode }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/preview/start", async (req, res, next) => {
  try {
    res.json(await startPreview(req.params.slug));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:slug/preview/stop", (req, res, next) => {
  try {
    res.json(stopPreview(req.params.slug));
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:slug/preview/status", async (req, res, next) => {
  try {
    res.json(await previewStatus(req.params.slug));
  } catch (error) {
    next(error);
  }
});

app.get("/api/jobs", (req, res) => {
  res.json(listJobs({
    active: req.query?.active,
    slug: req.query?.slug,
  }));
});

app.get("/api/videos/:slug/jobs", (req, res) => {
  res.json(listJobs({ slug: req.params.slug }));
});

app.post("/api/jobs/:id/cancel", (req, res, next) => {
  const job = cancelJob(req.params.id, "Đã dừng theo yêu cầu.");
  if (!job) return next(notFound("Job not found."));
  return res.json(job);
});

app.get("/api/jobs/:id", (req, res, next) => {
  const job = getJob(req.params.id);
  if (!job) return next(notFound("Job not found."));
  return res.json(publicJob(job));
});

app.get("/api/jobs/:id/logs", (req, res, next) => {
  const logs = getJobLogs(req.params.id);
  if (logs === null) return next(notFound("Job not found."));
  return res.type("text/plain").send(logs);
});

app.get("/api/paths", (_req, res) => {
  res.json({ repoRoot: REPO_ROOT, videosDir: VIDEOS_DIR, sharedAssetsDir: SHARED_ASSETS_DIR });
});

app.use(express.static(frontendDist));
app.use((_req, res, next) => {
  const indexPath = path.join(frontendDist, "index.html");
  res.sendFile(indexPath, (error) => {
    if (error) next();
  });
});

app.use((error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    res.status(status).json({
      error: error.code === "LIMIT_FILE_SIZE" ? "Uploaded file is too large." : error.message,
      code: error.code === "LIMIT_FILE_SIZE" ? "UPLOAD_TOO_LARGE" : "BAD_REQUEST",
    });
    return;
  }
  if (error?.type === "entity.too.large") {
    res.status(413).json({ error: "Request body is too large.", code: "UPLOAD_TOO_LARGE" });
    return;
  }
  const { apiError, payload } = errorPayload(error);
  res.status(apiError.status).json(payload);
});

const server = app.listen(port, host, () => {
  console.log(`Auto Compare Video Studio API running at http://${host}:${port}`);
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(resolve, 5000);
  });
  try {
    const reason = "Backend shutting down before this job finished.";
    await Promise.race([
      shutdownJobQueue(reason),
      timeout,
    ]);
    interruptActiveJobs(reason);
  } finally {
    clearTimeout(timeoutId);
    process.exit(0);
  }
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
