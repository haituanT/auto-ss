import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { VIDEOS_DIR, videoPath } from "../paths.mjs";

const jobs = new Map();
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "interrupted"]);
const ACTIVE_DIR = "active";
const HISTORY_DIR = "history";
const LOGS_DIR = "logs";
const GLOBAL_JOB_SLUG = "_global";
const RECENT_HISTORY_LIMIT = 50;

export class JobCancelledError extends Error {
  constructor(message = "Job cancelled") {
    super(message);
    this.name = "JobCancelledError";
  }
}

function nowIso() {
  return new Date().toISOString();
}

function isTerminal(job) {
  return TERMINAL_STATUSES.has(job?.status);
}

export function redactSecrets(value) {
  let text = String(value ?? "");
  text = text.replace(/(Authorization\s*:\s*Bearer\s+)[^\s"']+/gi, "$1[redacted]");
  text = text.replace(/\bBearer\s+[^\s"']+/gi, "Bearer [redacted]");
  text = text.replace(/\b([A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|AUTH)[A-Z0-9_]*)\s*=\s*([^\s"';&]+)/gi, "$1=[redacted]");
  text = text.replace(/(["']?(?:api[_-]?key|token|secret|authorization|auth|password)["']?\s*:\s*["'])([^"']*)(["'])/gi, "$1[redacted]$3");
  text = text.replace(/(["']?(?:api[_-]?key|token|secret|authorization|auth|password)["']?\s*=\s*)([^\s"';&]+)/gi, "$1[redacted]");
  return text;
}

function safeStorageSlug(slug = "") {
  const value = String(slug || "").trim();
  if (!value) return GLOBAL_JOB_SLUG;
  return value.replace(/[^a-zA-Z0-9._-]/g, "") || GLOBAL_JOB_SLUG;
}

function rootForStorageSlug(slug = "") {
  const safe = safeStorageSlug(slug);
  if (safe === GLOBAL_JOB_SLUG) return path.join(VIDEOS_DIR, GLOBAL_JOB_SLUG);
  return videoPath(safe);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function jobDirs(slug = "") {
  const root = rootForStorageSlug(slug);
  const jobsRoot = path.join(root, "jobs");
  return {
    root,
    jobsRoot,
    activeDir: path.join(jobsRoot, ACTIVE_DIR),
    historyDir: path.join(jobsRoot, HISTORY_DIR),
    logsDir: path.join(jobsRoot, LOGS_DIR),
  };
}

function jobPaths(job) {
  const dirs = jobDirs(job.storageSlug || job.slug);
  return {
    ...dirs,
    activePath: path.join(dirs.activeDir, `${job.id}.json`),
    historyPath: path.join(dirs.historyDir, `${job.id}.json`),
    logPath: path.join(dirs.logsDir, `${job.id}.log`),
  };
}

function serializableJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    type: job.type,
    family: job.family || familyForType(job.type),
    resource: job.resource || "",
    idempotencyKey: job.idempotencyKey || "",
    slug: job.slug || "",
    storageSlug: job.storageSlug || safeStorageSlug(job.slug),
    status: job.status,
    progress: Math.max(0, Math.min(100, Math.round(Number(job.progress) || 0))),
    message: job.message || "",
    createdAt: job.createdAt || job.startedAt || "",
    startedAt: job.startedAt || job.createdAt || "",
    updatedAt: job.updatedAt || "",
    finishedAt: job.finishedAt || "",
    outputPath: job.outputPath || job.result?.outputPath || "",
    result: job.result || null,
    error: job.error || "",
    logPath: job.logPath || "",
  };
}

function persistJob(job) {
  if (!job?.id) return;
  const paths = jobPaths(job);
  job.storageSlug = job.storageSlug || safeStorageSlug(job.slug);
  job.logPath = job.logPath || paths.logPath;
  job.activePath = paths.activePath;
  job.historyPath = paths.historyPath;
  const data = serializableJob(job);
  data.logPath = path.relative(paths.root, job.logPath).replace(/\\/g, "/");
  try {
    if (isTerminal(job)) {
      writeJson(paths.historyPath, data);
      try {
        fs.rmSync(paths.activePath, { force: true, maxRetries: 10, retryDelay: 120 });
      } catch {
        // Windows can briefly keep the active record open while a job finishes.
        // The history record is already durable, so do not fail the job response.
      }
    } else {
      writeJson(paths.activePath, data);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function hydrateJob(data, sourcePath = "") {
  if (!data?.id) return null;
  const storageSlug = safeStorageSlug(data.storageSlug || data.slug);
  const paths = jobPaths({ id: data.id, slug: data.slug || "", storageSlug });
  const logPath = data.logPath && path.isAbsolute(data.logPath)
    ? data.logPath
    : path.join(paths.root, String(data.logPath || path.join("jobs", LOGS_DIR, `${data.id}.log`)).replace(/\//g, path.sep));
  return {
    id: String(data.id),
    type: String(data.type || "job"),
    family: String(data.family || familyForType(data.type)),
    resource: String(data.resource || ""),
    idempotencyKey: String(data.idempotencyKey || ""),
    slug: String(data.slug || ""),
    storageSlug,
    status: String(data.status || "running"),
    progress: Number(data.progress) || 0,
    message: String(data.message || ""),
    createdAt: String(data.createdAt || data.startedAt || nowIso()),
    startedAt: String(data.startedAt || data.createdAt || nowIso()),
    updatedAt: String(data.updatedAt || data.startedAt || data.createdAt || nowIso()),
    finishedAt: String(data.finishedAt || ""),
    outputPath: String(data.outputPath || data.result?.outputPath || ""),
    result: data.result || null,
    error: String(data.error || ""),
    logs: [],
    logPath,
    activePath: sourcePath || paths.activePath,
    historyPath: paths.historyPath,
    cancel: null,
  };
}

function compareNewest(left, right) {
  return String(right.updatedAt || right.finishedAt || right.startedAt || right.createdAt || "")
    .localeCompare(String(left.updatedAt || left.finishedAt || left.startedAt || left.createdAt || ""));
}

function familyForType(type = "") {
  const value = String(type || "");
  if (["remotion-render", "remotion-check"].includes(value)) return "render";
  if (["generate-vo", "generate-vo-sample", "trim-vo"].includes(value)) return "audio";
  if (value === "illustration-generate") return "illustration";
  if (value === "character-convert") return "character";
  if (value === "auto-create-video") return "workflow";
  return value || "job";
}

function scanJobFiles(kind) {
  if (!fs.existsSync(VIDEOS_DIR)) return [];
  const rows = [];
  for (const entry of fs.readdirSync(VIDEOS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(VIDEOS_DIR, entry.name, "jobs", kind);
    if (!fs.existsSync(dir)) continue;
    let files;
    try {
      files = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // Another test or cleanup task may remove a project between existsSync
      // and readdirSync. Treat that directory as empty.
      continue;
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      const filePath = path.join(dir, file.name);
      const data = readJson(filePath, null);
      if (!data?.id) continue;
      rows.push({ data, filePath });
    }
  }
  return rows;
}

function interruptActiveJobsOnBoot() {
  for (const { data, filePath } of scanJobFiles(ACTIVE_DIR)) {
    const job = hydrateJob(data, filePath);
    if (!job) continue;
    const now = nowIso();
    job.status = "interrupted";
    job.error = "Backend restarted while this job was not finished.";
    job.message = "Interrupted by backend restart.";
    job.progress = Math.max(0, Math.min(99, Number(job.progress) || 0));
    job.updatedAt = now;
    job.finishedAt = now;
    appendLog(job, "\nBackend restarted before this job finished.\n");
    persistJob(job);
  }
}

interruptActiveJobsOnBoot();

export function killChildTree(child) {
  if (!child?.pid || child.killed) return;
  try {
    if (process.platform === "win32") {
      const result = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      if (result.status === 0) return;
    }
    child.kill("SIGTERM");
  } catch {
    child.kill?.();
  }
}

export function createJob(type, slug = "", options = {}) {
  const now = nowIso();
  const job = {
    id: options.id || randomUUID(),
    type,
    family: options.family || familyForType(type),
    resource: options.resource || "",
    idempotencyKey: String(options.idempotencyKey || ""),
    slug,
    storageSlug: safeStorageSlug(options.storageSlug || slug),
    status: options.status || "running",
    progress: Number(options.progress) || (options.status === "queued" ? 0 : 1),
    message: options.message || (options.status === "queued" ? "Waiting for an available worker." : "Starting job."),
    createdAt: now,
    startedAt: options.status === "queued" ? "" : now,
    updatedAt: now,
    finishedAt: "",
    outputPath: "",
    logs: [],
    result: null,
    error: "",
    cancel: null,
  };
  const paths = jobPaths(job);
  job.logPath = paths.logPath;
  job.activePath = paths.activePath;
  job.historyPath = paths.historyPath;
  ensureDir(paths.logsDir);
  persistJob(job);
  jobs.set(job.id, job);
  return job;
}

export function appendLog(job, chunk) {
  if (!job || !chunk) return;
  const text = redactSecrets(chunk);
  job.logs = job.logs || [];
  job.logs.push(text);
  job.updatedAt = nowIso();
  const paths = jobPaths(job);
  job.logPath = job.logPath || paths.logPath;
  try {
    ensureDir(path.dirname(job.logPath));
    fs.appendFileSync(job.logPath, text, "utf8");
  } catch (error) {
    // A stale active record can be discovered while its project is being removed.
    // Keep the in-memory log and let the job state transition finish.
    if (error?.code !== "ENOENT") throw error;
  }
}

export function updateJob(job, patch = {}) {
  if (!job || isTerminal(job)) return publicJob(job);
  if (Object.prototype.hasOwnProperty.call(patch, "progress")) {
    job.progress = Math.max(0, Math.min(100, Math.round(Number(patch.progress) || 0)));
  }
  if (Object.prototype.hasOwnProperty.call(patch, "message")) job.message = String(patch.message || "");
  if (Object.prototype.hasOwnProperty.call(patch, "outputPath")) job.outputPath = String(patch.outputPath || "");
  if (Object.prototype.hasOwnProperty.call(patch, "result")) job.result = patch.result;
  job.updatedAt = nowIso();
  persistJob(job);
  return publicJob(job);
}

export function markJobRunning(job, message = "Running.") {
  if (!job || isTerminal(job)) return publicJob(job);
  const now = nowIso();
  job.status = "running";
  job.startedAt = job.startedAt || now;
  job.updatedAt = now;
  job.progress = Math.max(Number(job.progress) || 0, 1);
  job.message = message || job.message || "Running.";
  persistJob(job);
  return publicJob(job);
}

export function setJobCanceller(job, cancel) {
  if (!job || isTerminal(job)) return;
  job.cancel = typeof cancel === "function" ? cancel : null;
}

export function isJobCancelled(job) {
  return job?.status === "cancelled" || job?.status === "interrupted";
}

export function setJobSlug(job, slug) {
  if (!job || isTerminal(job)) return publicJob(job);
  job.slug = String(slug || "").trim();
  job.updatedAt = nowIso();
  persistJob(job);
  return publicJob(job);
}

export function cancelJob(id, reason = "Stopped by user.") {
  const job = getJob(id);
  if (!job) return null;
  if (isTerminal(job)) return publicJob(job);

  const now = nowIso();
  const cancel = job.cancel;
  job.status = "cancelled";
  job.error = reason;
  job.message = reason;
  job.cancel = null;
  job.updatedAt = now;
  job.finishedAt = now;
  job.progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
  appendLog(job, `\n${reason}\n`);

  try {
    cancel?.();
  } catch (error) {
    appendLog(job, `Cancel cleanup failed: ${error?.message || error}\n`);
  }
  persistJob(job);
  return publicJob(job);
}

export function finishJob(job, result = null) {
  if (!job || isTerminal(job)) return publicJob(job);
  const now = nowIso();
  job.status = "completed";
  job.result = result;
  job.outputPath = result?.outputPath || result?.officialRender?.path || job.outputPath || "";
  job.progress = 100;
  job.message = "Completed.";
  job.cancel = null;
  job.updatedAt = now;
  job.finishedAt = now;
  persistJob(job);
  return publicJob(job);
}

export function failJob(job, error) {
  if (!job || isTerminal(job)) return publicJob(job);
  const now = nowIso();
  job.status = "failed";
  job.error = error?.message || String(error);
  job.message = job.error;
  job.cancel = null;
  job.updatedAt = now;
  job.finishedAt = now;
  persistJob(job);
  return publicJob(job);
}

export function markJobInterrupted(jobOrId, reason = "Backend shutting down before this job finished.") {
  const job = typeof jobOrId === "string" ? getJob(jobOrId) : jobOrId;
  if (!job || isTerminal(job)) return job ? publicJob(job) : null;

  const cancel = job.cancel;
  const now = nowIso();
  job.status = "interrupted";
  job.error = reason;
  job.message = "Interrupted by backend shutdown.";
  job.cancel = null;
  job.updatedAt = now;
  job.finishedAt = now;
  job.progress = Math.max(0, Math.min(99, Number(job.progress) || 0));
  appendLog(job, "\n" + reason + "\n");
  try {
    cancel?.();
  } catch (error) {
    appendLog(job, "Shutdown cleanup failed: " + (error?.message || error) + "\n");
  }
  persistJob(job);
  return publicJob(job);
}

export function interruptActiveJobs(reason = "Backend shutting down before this job finished.") {
  const seen = new Set();
  const active = [
    ...jobs.values(),
    ...listJobs({ active: true }).map((job) => getJob(job.id)).filter(Boolean),
  ];
  for (const job of active) {
    if (seen.has(job.id) || isTerminal(job)) continue;
    seen.add(job.id);
    markJobInterrupted(job, reason);
  }
  return [...seen];
}

export function activeJobsForSlug(slug) {
  const normalized = String(slug || "").trim();
  if (!normalized) return [];
  return listJobs({ slug: normalized, active: true });
}

export function findActiveJobByIdempotencyKey(idempotencyKey) {
  const key = String(idempotencyKey || "").trim();
  if (!key) return null;
  for (const job of jobs.values()) {
    if (!isTerminal(job) && job.idempotencyKey === key) return publicJob(job);
  }
  for (const { data, filePath } of scanJobFiles(ACTIVE_DIR)) {
    if (String(data.idempotencyKey || "") !== key) continue;
    const job = hydrateJob(data, filePath);
    if (job && !isTerminal(job)) return publicJob(job);
  }
  return null;
}

export function listJobs(options = {}) {
  const opts = typeof options === "object" && options !== null ? options : {};
  const slugFilter = String(opts.slug || "").trim();
  const activeOnly = opts.active === true || opts.active === "true";
  const byId = new Map();

  for (const job of jobs.values()) byId.set(job.id, publicJob(job));
  for (const { data, filePath } of scanJobFiles(ACTIVE_DIR)) {
    const job = hydrateJob(data, filePath);
    if (job) byId.set(job.id, publicJob(job));
  }
  if (!activeOnly) {
    for (const { data, filePath } of scanJobFiles(HISTORY_DIR)) {
      const job = hydrateJob(data, filePath);
      if (job) byId.set(job.id, publicJob(job));
    }
  }

  let items = [...byId.values()];
  if (slugFilter) items = items.filter((job) => job.slug === slugFilter);
  if (activeOnly) items = items.filter((job) => !TERMINAL_STATUSES.has(job.status));
  items.sort(compareNewest);
  if (!activeOnly) {
    const active = items.filter((job) => !TERMINAL_STATUSES.has(job.status));
    const history = items.filter((job) => TERMINAL_STATUSES.has(job.status)).slice(0, Number(opts.limit) || RECENT_HISTORY_LIMIT);
    return [...active, ...history].sort(compareNewest);
  }
  return items;
}

export function getJob(id) {
  const key = String(id || "");
  if (jobs.has(key)) return jobs.get(key);
  for (const kind of [ACTIVE_DIR, HISTORY_DIR]) {
    for (const { data, filePath } of scanJobFiles(kind)) {
      if (String(data.id) !== key) continue;
      const job = hydrateJob(data, filePath);
      if (!job) return null;
      if (!isTerminal(job)) jobs.set(job.id, job);
      return job;
    }
  }
  return null;
}

export function getJobLogs(id) {
  const job = getJob(id);
  if (!job) return null;
  const logPath = job.logPath || jobPaths(job).logPath;
  try {
    return fs.readFileSync(logPath, "utf8");
  } catch {
    return (job.logs || []).join("");
  }
}

export function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    type: job.type,
    family: job.family || familyForType(job.type),
    resource: job.resource || "",
    slug: job.slug,
    status: job.status,
    progress: Math.max(0, Math.min(100, Math.round(Number(job.progress) || 0))),
    message: job.message || "",
    createdAt: job.createdAt,
    startedAt: job.startedAt || job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    outputPath: job.outputPath || job.result?.outputPath || job.result?.officialRender?.path || "",
    result: job.result,
    error: job.error,
  };
}

export function resetJobStoreForTests({ interrupt = false } = {}) {
  jobs.clear();
  if (interrupt) interruptActiveJobsOnBoot();
}
