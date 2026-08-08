import {
  appendLog,
  createJob,
  failJob,
  finishJob,
  findActiveJobByIdempotencyKey,
  isJobCancelled,
  markJobInterrupted,
  markJobRunning,
  publicJob,
} from "./jobStore.mjs";

export const JOB_FAMILY_LIMITS = {
  render: 2,
  audio: 2,
  illustration: 2,
  character: 3,
  workflow: 1,
};

const TYPE_TO_FAMILY = {
  "remotion-render": "render",
  "remotion-check": "render",
  "generate-vo": "audio",
  "generate-vo-sample": "audio",
  "trim-vo": "audio",
  "illustration-generate": "illustration",
  "character-convert": "character",
  "auto-create-video": "workflow",
};

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "interrupted"]);
const queuedTasks = [];
const tasksById = new Map();
let drainScheduled = false;
let shuttingDown = false;

function isTerminal(job) {
  return TERMINAL_STATUSES.has(job?.status);
}

export function jobFamilyForType(type = "") {
  return TYPE_TO_FAMILY[String(type || "")] || String(type || "job");
}

function lockKey(job) {
  const family = job.family || jobFamilyForType(job.type);
  if (family === "character") return `${family}:${job.slug || ""}:${job.resource || ""}`;
  return `${family}:${job.slug || ""}`;
}

function runningTasks() {
  return [...tasksById.values()].filter((task) => task.started && task.job.status === "running");
}

function canStart(task) {
  const family = task.job.family || jobFamilyForType(task.job.type);
  const limit = Number(task.limit || JOB_FAMILY_LIMITS[family] || 1);
  const running = runningTasks();
  if (running.filter((item) => (item.job.family || jobFamilyForType(item.job.type)) === family).length >= limit) {
    return false;
  }
  const key = lockKey(task.job);
  return !running.some((item) => lockKey(item.job) === key);
}

function removeQueuedTask(task) {
  const index = queuedTasks.indexOf(task);
  if (index >= 0) queuedTasks.splice(index, 1);
}

function scheduleDrain() {
  if (drainScheduled) return;
  drainScheduled = true;
  queueMicrotask(() => {
    drainScheduled = false;
    if (shuttingDown) return;
    drainQueue();
  });
}

function startTask(task) {
  removeQueuedTask(task);
  if (isTerminal(task.job) || isJobCancelled(task.job)) {
    tasksById.delete(task.job.id);
    return;
  }
  task.started = true;
  markJobRunning(task.job, task.startMessage || "Running.");
  appendLog(task.job, `Started ${task.job.type}${task.job.slug ? ` for ${task.job.slug}` : ""}.\n`);

  Promise.resolve()
    .then(() => task.runner(task.job))
    .then((result) => {
      if (isTerminal(task.job) || isJobCancelled(task.job)) return;
      finishJob(task.job, result || null);
    })
    .catch((error) => {
      if (isTerminal(task.job) || isJobCancelled(task.job)) return;
      appendLog(task.job, `\n${task.job.type} failed: ${error?.message || error}\n`);
      failJob(task.job, error);
    })
    .finally(() => {
      tasksById.delete(task.job.id);
      scheduleDrain();
    });
}

export function drainQueue() {
  if (shuttingDown) return false;
  let started = false;
  for (const task of [...queuedTasks]) {
    if (isTerminal(task.job) || isJobCancelled(task.job)) {
      removeQueuedTask(task);
      tasksById.delete(task.job.id);
      continue;
    }
    if (!canStart(task)) continue;
    startTask(task);
    started = true;
  }
  return started;
}

export function enqueueJob({
  type,
  slug = "",
  storageSlug = "",
  family = jobFamilyForType(type),
  resource = "",
  message = "Waiting for an available worker.",
  startMessage = "Running.",
  limit,
  idempotencyKey = "",
  runner,
} = {}) {
  if (typeof runner !== "function") throw new Error("Missing queued job runner.");
  if (shuttingDown) throw new Error("Backend is shutting down.");
  const existing = findActiveJobByIdempotencyKey(idempotencyKey);
  if (existing) return existing;
  const job = createJob(type, slug, {
    family,
    resource,
    storageSlug,
    idempotencyKey,
    status: "queued",
    progress: 0,
    message,
  });
  const task = {
    job,
    runner,
    limit,
    startMessage,
    started: false,
  };
  tasksById.set(job.id, task);
  queuedTasks.push(task);
  appendLog(job, `Queued ${type}${slug ? ` for ${slug}` : ""}.\n`);
  scheduleDrain();
  return publicJob(job);
}

export function resetJobQueueForTests() {
  queuedTasks.splice(0, queuedTasks.length);
  tasksById.clear();
  drainScheduled = false;
  shuttingDown = false;
}

export function queueStateForTests() {
  return {
    queued: queuedTasks.map((task) => publicJob(task.job)),
    running: runningTasks().map((task) => publicJob(task.job)),
  };
}

export function isJobQueueShuttingDown() {
  return shuttingDown;
}

export function shutdownJobQueue(reason = "Backend shutting down before this job finished.") {
  shuttingDown = true;
  for (const task of [...queuedTasks]) {
    removeQueuedTask(task);
    markJobInterrupted(task.job, reason);
    tasksById.delete(task.job.id);
  }
  for (const task of tasksById.values()) {
    if (task.started) markJobInterrupted(task.job, reason);
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      if (![...tasksById.values()].some((task) => task.started)) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= 5000) {
        resolve();
        return;
      }
      setTimeout(check, 25);
    };
    check();
  });
}
