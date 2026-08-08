import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { FFMPEG_BIN, REPO_ROOT, SAMPLE_AUDIO_PATH, videoPath } from "../paths.mjs";
import {
  appendLog,
  isJobCancelled,
  killChildTree,
  setJobCanceller,
  updateJob,
} from "./jobStore.mjs";
import { enqueueJob } from "./jobQueue.mjs";
import { aimaxRuntimeEnv } from "./aimaxRuntimeOptions.mjs";

function pathKey(env) {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
}

function secretFingerprint(value) {
  const secret = String(value || "").trim();
  if (!secret) return "env";
  return createHash("sha256").update(secret).digest("hex").slice(0, 16);
}

function readLineCount(slug) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(videoPath(slug), "video.json"), "utf8"));
    return Array.isArray(config.lines) ? config.lines.length : 0;
  } catch {
    return 0;
  }
}

function latestRegexMatch(text, regex) {
  let match;
  let latest = null;
  while ((match = regex.exec(text))) latest = match;
  return latest;
}

function clampProgress(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(99, Math.round(value)));
}

function updateAudioProgressFromLogs(job, type, lineCount = 0) {
  const logs = (job.logs || []).join("");
  const batchMatch = logs.match(/Generating\s+(\d+)\s+AIMAX lines/i);
  const total = Number(batchMatch?.[1]) || lineCount || 1;

  if (type === "trim-vo") {
    const trimmed = latestRegexMatch(logs, /Trimmed\s+(\d+)\/(\d+)\s+VO line/gi);
    if (trimmed) {
      const done = Math.min(Number(trimmed[1]) || 0, Number(trimmed[2]) || total);
      const max = Number(trimmed[2]) || total;
      updateJob(job, {
        progress: clampProgress(12 + (done / Math.max(1, max)) * 82),
        message: `Trimming VO ${done}/${max} line(s).`,
      });
      return;
    }
    updateJob(job, { progress: 12, message: "Preparing VO trim." });
    return;
  }

  const copied = [...logs.matchAll(/Copied sample audio for line-(\d+)/gi)]
    .map((match) => Number(match[1]) || 0);
  if (copied.length) {
    const done = Math.min(Math.max(...copied), total);
    updateJob(job, {
      progress: clampProgress(12 + (done / Math.max(1, total)) * 82),
      message: `Processing audio ${done}/${total} line(s).`,
    });
    return;
  }
  if (/Done\./i.test(logs)) {
    updateJob(job, { progress: 96, message: "Writing audio timing." });
    return;
  }
  if (/Reusing completed AIMAX job/i.test(logs)) {
    updateJob(job, { progress: 72, message: "Reusing completed AIMAX audio." });
    return;
  }
  if (/retrying them one by one/i.test(logs)) {
    updateJob(job, { progress: 82, message: "Retrying short AIMAX line audio." });
    return;
  }
  if (/AIMAX lines in one batch request/i.test(logs)) {
    updateJob(job, {
      progress: 34,
      message: `Sent ${total} line(s) to AIMAX; waiting for audio.`,
    });
    return;
  }
  updateJob(job, { progress: 10, message: "Preparing narration audio." });
}

function runCommand({ type, slug, command, args, env = {}, idempotencyKey = "" }) {
  return enqueueJob({
    type,
    slug,
    family: "audio",
    message: "Waiting for audio worker.",
    startMessage: "Starting audio job.",
    idempotencyKey,
    runner: (job) => new Promise((resolve, reject) => {
      const cwd = videoPath(slug);
      const lineCount = readLineCount(slug);
      const fullEnv = { ...process.env, ...env };
      const key = pathKey(fullEnv);
      fullEnv[key] = `${FFMPEG_BIN}${path.delimiter}${fullEnv[key] || ""}`;

      appendLog(job, "Runner: Studio local (Node + npm), no Codex skill/agent.\n");
      updateJob(job, { progress: 4, message: "Launching audio process." });

      const child = spawn(command, args, {
        cwd,
        env: fullEnv,
        shell: false,
        windowsHide: true,
      });
      setJobCanceller(job, () => {
        appendLog(job, "\nStopping job process...\n");
        killChildTree(child);
      });

      const onChunk = (data) => {
        appendLog(job, data);
        updateAudioProgressFromLogs(job, type, lineCount);
      };
      child.stdout.on("data", onChunk);
      child.stderr.on("data", onChunk);
      child.on("error", (error) => {
        setJobCanceller(job, null);
        if (isJobCancelled(job)) resolve(null);
        else reject(error);
      });
      child.on("exit", (code) => {
        setJobCanceller(job, null);
        if (isJobCancelled(job)) {
          resolve(null);
          return;
        }
        if (code === 0) {
          updateJob(job, { progress: 99, message: "Finalizing audio output." });
          resolve({ code });
        } else {
          reject(new Error(`Process exited with code ${code}`));
        }
      });
    }),
  });
}

function npmCommand(args) {
  return process.platform === "win32"
    ? { command: "cmd.exe", args: ["/d", "/s", "/c", "npm.cmd", ...args] }
    : { command: "npm", args };
}

export function runNpm(slug, script) {
  const npm = npmCommand(["run", script]);
  return runCommand({
    type: script,
    slug,
    command: npm.command,
    args: npm.args,
  });
}

export function runGenerateVo(slug, mode = "aimax", options = {}) {
  const voiceId = String(options.voiceId || "");
  const speed = options.speed === undefined || options.speed === null ? "" : String(options.speed);
  const pitch = options.pitch === undefined || options.pitch === null ? "" : String(options.pitch);
  const keyFingerprint = secretFingerprint(options.apiKey);
  return runCommand({
    type: mode === "sample" ? "generate-vo-sample" : "generate-vo",
    slug,
    command: "node",
    args: ["scripts/generate-vo.mjs"],
    env: mode === "sample"
      ? { USE_SAMPLE_AUDIO: "1", SAMPLE_AUDIO_PATH }
      : { ...aimaxRuntimeEnv(options), AIMAX_TTS_TRIM_SILENCE: "1" },
    idempotencyKey: "generate-vo:" + slug + ":" + mode + ":" + voiceId + ":" + speed + ":" + pitch + ":" + keyFingerprint,
  });
}

export function runTrimVo(slug) {
  return runCommand({
    type: "trim-vo",
    slug,
    command: "node",
    args: [path.join(REPO_ROOT, "scripts", "trim-existing-vo.mjs")],
    idempotencyKey: "trim-vo:" + slug,
  });
}
