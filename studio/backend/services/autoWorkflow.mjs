import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { FFMPEG_BIN, SAMPLE_AUDIO_PATH, videoPath } from "../paths.mjs";
import {
  JobCancelledError,
  appendLog,
  isJobCancelled,
  killChildTree,
  setJobSlug,
  setJobCanceller,
} from "./jobStore.mjs";
import { enqueueJob } from "./jobQueue.mjs";
import { withProjectLock } from "./projectLocks.mjs";
import { aimaxRuntimeEnv } from "./aimaxRuntimeOptions.mjs";
import { applyCompareImages } from "./compareAssets.mjs";
import { createVideo } from "./videoCreator.mjs";
import { uploadFullAudio } from "./videoAudio.mjs";
import { createFinalSnapshot, renderVideoWithRemotion } from "./remotionRenderer.mjs";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  if (typeof value.path === "string" && (value.originalname || value.mimetype || value.size !== undefined)) {
    return {
      originalname: String(value.originalname || ""),
      size: Number(value.size) || 0,
      mimetype: String(value.mimetype || ""),
    };
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function autoCreateIdempotencyKey(body = {}) {
  const slug = String(body.slug || "").trim();
  if (slug) return "auto-create-video:" + slug;
  const payload = stableValue(body);
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return "auto-create-video:" + digest;
}

function pathKey(env) {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
}

function runStep(job, { label, slug, command, args, env = {} }) {
  return new Promise((resolve, reject) => {
    appendLog(job, `\n\n=== ${label} ===\n`);
    const fullEnv = { ...process.env, ...env };
    const key = pathKey(fullEnv);
    fullEnv[key] = `${FFMPEG_BIN}${path.delimiter}${fullEnv[key] || ""}`;

    const child = spawn(command, args, {
      cwd: videoPath(slug),
      env: fullEnv,
      shell: false,
      windowsHide: true,
    });
    setJobCanceller(job, () => {
      appendLog(job, `\nStopping ${label}...\n`);
      killChildTree(child);
    });

    child.stdout.on("data", (data) => appendLog(job, data));
    child.stderr.on("data", (data) => appendLog(job, data));
    child.on("error", (error) => {
      setJobCanceller(job, null);
      if (isJobCancelled(job)) reject(new JobCancelledError(`${label} cancelled`));
      else reject(error);
    });
    child.on("exit", (code) => {
      setJobCanceller(job, null);
      if (isJobCancelled(job)) {
        reject(new JobCancelledError(`${label} cancelled`));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with code ${code}`));
    });
  });
}

async function runAutoJob(job, body) {
  appendLog(job, "Auto workflow started.\n");
  appendLog(job, "Runner: Studio local (Node + Remotion), không gọi Codex skill/agent.\n");
  appendLog(job, "1) Tạo data video từ content và tài nguyên chung...\n");
  const left = body.leftLabel || body.left || "video";
  const right = body.rightLabel || body.right || "compare";
  const createBody = {
    ...body,
    slug: body.slug || `${left}-vs-${right}-${Date.now()}`,
    includeCharacters: body.includeCharacters !== false,
  };
  const created = await createVideo(createBody);
  if (isJobCancelled(job)) throw new JobCancelledError("Auto workflow cancelled");
  setJobSlug(job, created.slug);
  appendLog(job, `Created video: ${created.slug}\n`);
  appendLog(job, `Lines: ${created.config.lines.length}\n`);

  if (body.uploadedCompareLeft || body.uploadedCompareRight) {
    appendLog(job, "1) Applying comparison images...\n");
    await applyCompareImages({
      slug: created.slug,
      leftFile: body.uploadedCompareLeft,
      rightFile: body.uploadedCompareRight,
    });
    if (isJobCancelled(job)) throw new JobCancelledError("Auto workflow cancelled");
  }

  const audioMode = body.audioMode || "aimax";
  if (audioMode === "uploaded") {
    appendLog(job, "2) Attach uploaded audio to project...\n");
    await uploadFullAudio({ slug: created.slug, file: body.uploadedAudio, subtitleFile: body.uploadedSrt });
    if (isJobCancelled(job)) throw new JobCancelledError("Auto workflow cancelled");
  } else if (audioMode === "sample") {
    await withProjectLock(created.slug, "generate workflow audio", () => runStep(job, {
      label: "2) Tạo VO bằng MP3 mẫu",
      slug: created.slug,
      command: "node",
      args: ["scripts/generate-vo.mjs"],
      env: { USE_SAMPLE_AUDIO: "1", SAMPLE_AUDIO_PATH },
    }));
    if (isJobCancelled(job)) throw new JobCancelledError("Auto workflow cancelled");
  } else if (audioMode === "aimax") {
    await withProjectLock(created.slug, "generate workflow audio", () => runStep(job, {
      label: "2) Content -> AIMAX TTS",
      slug: created.slug,
      command: "node",
      args: ["scripts/generate-vo.mjs"],
      env: aimaxRuntimeEnv(body),
    }));
    if (isJobCancelled(job)) throw new JobCancelledError("Auto workflow cancelled");
  } else {
    appendLog(job, "2) Bỏ qua VO theo lựa chọn audioMode.\n");
  }

  if (body.render !== false) {
    appendLog(job, "3) Create Preview final snapshot...\n");
    await withProjectLock(created.slug, "create workflow final snapshot", () => createFinalSnapshot(created.slug, {
      allowWarnings: true,
    }));
    if (isJobCancelled(job)) throw new JobCancelledError("Auto workflow cancelled");

    appendLog(job, "4) Render MP4 bang Remotion...\n");
    await renderVideoWithRemotion(created.slug, (chunk) => appendLog(job, chunk), { job });
  } else {
    appendLog(job, "3) Bo qua render theo lua chon render=false.\n");
  }

  return { slug: created.slug, rendered: body.render !== false };
}

export function runAutoCreateVideo(body = {}) {
  return enqueueJob({
    type: "auto-create-video",
    slug: String(body.slug || "").trim(),
    storageSlug: "_global",
    family: "workflow",
    idempotencyKey: autoCreateIdempotencyKey(body),
    message: "Waiting for workflow worker.",
    startMessage: "Starting auto-create workflow.",
    runner: (job) => runAutoJob(job, body),
  });
}
