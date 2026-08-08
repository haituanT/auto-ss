import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { videoPath } from "../paths.mjs";
import {
  appendLog,
  cancelJob,
  createJob,
  finishJob,
  getJobLogs,
  interruptActiveJobs,
  listJobs,
  resetJobStoreForTests,
  setJobCanceller,
  updateJob,
} from "../services/jobStore.mjs";

function cleanup(slug) {
  fs.rmSync(videoPath(slug), { recursive: true, force: true, maxRetries: 10, retryDelay: 80 });
}

function jobPaths(slug, id) {
  const root = videoPath(slug);
  return {
    active: path.join(root, "jobs", "active", `${id}.json`),
    history: path.join(root, "jobs", "history", `${id}.json`),
    log: path.join(root, "jobs", "logs", `${id}.log`),
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("project scoped jobs persist metadata and logs, then move active to history", () => {
  const slug = `job-store-${Date.now()}`;
  resetJobStoreForTests();
  cleanup(slug);
  try {
    const job = createJob("remotion-render", slug, { family: "render", resource: "gpu" });
    const paths = jobPaths(slug, job.id);
    appendLog(job, "Bundling 10%\n");
    updateJob(job, { progress: 42, message: "Rendering frame 42/100.", outputPath: "renders/out.mp4" });

    assert.equal(fs.existsSync(paths.active), true);
    assert.equal(fs.existsSync(paths.log), true);
    assert.match(fs.readFileSync(paths.log, "utf8"), /Bundling 10%/);
    const active = readJson(paths.active);
    assert.equal(active.slug, slug);
    assert.equal(active.family, "render");
    assert.equal(active.resource, "gpu");
    assert.equal(active.status, "running");
    assert.equal(active.progress, 42);
    assert.equal(active.message, "Rendering frame 42/100.");

    finishJob(job, { outputPath: "renders/out.mp4" });
    assert.equal(fs.existsSync(paths.active), false);
    assert.equal(fs.existsSync(paths.history), true);
    const history = readJson(paths.history);
    assert.equal(history.status, "completed");
    assert.equal(history.outputPath, "renders/out.mp4");
    assert.equal(getJobLogs(job.id).includes("Bundling 10%"), true);
  } finally {
    cleanup(slug);
    resetJobStoreForTests();
  }
});

test("listJobs returns active and recent history newest first", () => {
  const slug = `job-list-${Date.now()}`;
  resetJobStoreForTests();
  cleanup(slug);
  try {
    const first = createJob("generate-vo", slug, { family: "audio" });
    finishJob(first, { code: 0 });
    const second = createJob("remotion-render", slug, { family: "render" });

    const active = listJobs({ slug, active: true });
    assert.deepEqual(active.map((job) => job.id), [second.id]);
    const all = listJobs({ slug });
    assert.equal(all.some((job) => job.id === first.id && job.status === "completed"), true);
    assert.equal(all.some((job) => job.id === second.id && job.status === "running"), true);
  } finally {
    cleanup(slug);
    resetJobStoreForTests();
  }
});

test("cancel queued job persists cancelled status and log", () => {
  const slug = `job-cancel-${Date.now()}`;
  resetJobStoreForTests();
  cleanup(slug);
  try {
    const job = createJob("remotion-render", slug, { family: "render", status: "queued" });
    const cancelled = cancelJob(job.id, "Stopped in test.");
    const paths = jobPaths(slug, job.id);

    assert.equal(cancelled.status, "cancelled");
    assert.equal(fs.existsSync(paths.active), false);
    assert.equal(fs.existsSync(paths.history), true);
    assert.equal(readJson(paths.history).status, "cancelled");
    assert.match(fs.readFileSync(paths.log, "utf8"), /Stopped in test/);
  } finally {
    cleanup(slug);
    resetJobStoreForTests();
  }
});

test("backend restore marks active queued or running jobs as interrupted", async () => {
  const slug = `job-interrupt-${Date.now()}`;
  resetJobStoreForTests();
  cleanup(slug);
  try {
    const job = createJob("remotion-render", slug, { family: "render", status: "running", progress: 48 });
    const paths = jobPaths(slug, job.id);
    assert.equal(fs.existsSync(paths.active), true);

    const restarted = await import(`../services/jobStore.mjs?restart=${Date.now()}`);
    const items = restarted.listJobs({ slug });
    const interrupted = items.find((item) => item.id === job.id);
    assert.equal(interrupted.status, "interrupted");
    assert.equal(interrupted.progress, 48);
    assert.equal(fs.existsSync(paths.active), false);
    assert.equal(fs.existsSync(paths.history), true);
    assert.match(restarted.getJobLogs(job.id), /Backend restarted/);
  } finally {
    cleanup(slug);
    resetJobStoreForTests();
  }
});

test("appendLog redacts bearer tokens and API secrets", () => {
  const slug = "job-redact-" + Date.now();
  resetJobStoreForTests();
  cleanup(slug);
  try {
    const job = createJob("remotion-render", slug);
    appendLog(job, 'Authorization: Bearer bearer-secret AIMAX_API_KEY=aimax-secret {"apiKey":"json-secret"}\n');
    const logs = getJobLogs(job.id);
    assert.equal(logs.includes("bearer-secret"), false);
    assert.equal(logs.includes("aimax-secret"), false);
    assert.equal(logs.includes("json-secret"), false);
    assert.equal((logs.match(/\[redacted\]/g) || []).length >= 3, true);
  } finally {
    cleanup(slug);
    resetJobStoreForTests();
  }
});

test("interruptActiveJobs marks queued and running jobs as interrupted", () => {
  const slug = "job-shutdown-" + Date.now();
  resetJobStoreForTests();
  cleanup(slug);
  try {
    const queued = createJob("remotion-render", slug, { status: "queued" });
    const running = createJob("generate-vo", slug, { status: "running" });
    let cancelled = 0;
    setJobCanceller(running, () => { cancelled += 1; });

    const interrupted = interruptActiveJobs();
    assert.equal(interrupted.includes(queued.id), true);
    assert.equal(interrupted.includes(running.id), true);
    assert.equal(listJobs({ slug, active: true }).length, 0);
    assert.equal(listJobs({ slug }).filter((job) => job.status === "interrupted").length, 2);
    assert.equal(cancelled, 1);
  } finally {
    cleanup(slug);
    resetJobStoreForTests();
  }
});
