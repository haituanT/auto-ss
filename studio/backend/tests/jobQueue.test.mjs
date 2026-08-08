import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { videoPath } from "../paths.mjs";
import { listJobs, resetJobStoreForTests, setJobCanceller } from "../services/jobStore.mjs";
import { enqueueJob, queueStateForTests, resetJobQueueForTests, shutdownJobQueue } from "../services/jobQueue.mjs";

function cleanup(slugs = []) {
  for (const slug of slugs) {
    fs.rmSync(videoPath(slug), { recursive: true, force: true, maxRetries: 10, retryDelay: 80 });
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message = "condition", timeoutMs = 1500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for ${message}`);
}

async function settleAll(gates) {
  gates.forEach((gate) => gate.resolve());
  await waitFor(() => queueStateForTests().running.length === 0 && queueStateForTests().queued.length === 0, "queue settle", 2500);
}

function reset() {
  resetJobQueueForTests();
  resetJobStoreForTests();
}

test("allows two render jobs from different projects and queues the third", async () => {
  const slugs = [`queue-render-a-${Date.now()}`, `queue-render-b-${Date.now()}`, `queue-render-c-${Date.now()}`];
  const gates = slugs.map(() => deferred());
  reset();
  cleanup(slugs);
  try {
    slugs.forEach((slug, index) => enqueueJob({
      type: "remotion-render",
      slug,
      family: "render",
      runner: async () => {
        await gates[index].promise;
        return { slug };
      },
    }));

    await waitFor(() => queueStateForTests().running.length === 2, "two render jobs running");
    assert.equal(queueStateForTests().queued.length, 1);
    assert.deepEqual(queueStateForTests().running.map((job) => job.slug).sort(), slugs.slice(0, 2).sort());

    gates[0].resolve();
    await waitFor(() => queueStateForTests().running.some((job) => job.slug === slugs[2]), "third render starts");
    gates[1].resolve();
    gates[2].resolve();
    await settleAll(gates);
  } finally {
    cleanup(slugs);
    reset();
  }
});

test("queues two render jobs from the same project behind the project render lock", async () => {
  const slug = `queue-render-lock-${Date.now()}`;
  const gates = [deferred(), deferred()];
  reset();
  cleanup([slug]);
  try {
    enqueueJob({ type: "remotion-render", slug, family: "render", runner: async () => { await gates[0].promise; return { index: 0 }; } });
    enqueueJob({ type: "remotion-check", slug, family: "render", runner: async () => { await gates[1].promise; return { index: 1 }; } });

    await waitFor(() => queueStateForTests().running.length === 1 && queueStateForTests().queued.length === 1, "same project render lock");
    gates[0].resolve();
    await waitFor(() => queueStateForTests().running.length === 1 && queueStateForTests().running[0].type === "remotion-check", "second render starts");
    gates[1].resolve();
    await settleAll(gates);
  } finally {
    cleanup([slug]);
    reset();
  }
});

test("audio project A and render project B run at the same time", async () => {
  const audioSlug = `queue-audio-${Date.now()}`;
  const renderSlug = `queue-render-${Date.now()}`;
  const gates = [deferred(), deferred()];
  reset();
  cleanup([audioSlug, renderSlug]);
  try {
    enqueueJob({ type: "generate-vo", slug: audioSlug, family: "audio", runner: async () => { await gates[0].promise; return { audioSlug }; } });
    enqueueJob({ type: "remotion-render", slug: renderSlug, family: "render", runner: async () => { await gates[1].promise; return { renderSlug }; } });

    await waitFor(() => queueStateForTests().running.length === 2, "audio and render running");
    assert.deepEqual(queueStateForTests().running.map((job) => job.family).sort(), ["audio", "render"]);
    await settleAll(gates);
  } finally {
    cleanup([audioSlug, renderSlug]);
    reset();
  }
});

test("illustration jobs from different projects run without sharing project output", async () => {
  const slugs = [`queue-illus-a-${Date.now()}`, `queue-illus-b-${Date.now()}`];
  const gates = [deferred(), deferred()];
  reset();
  cleanup(slugs);
  try {
    slugs.forEach((slug, index) => enqueueJob({
      type: "illustration-generate",
      slug,
      family: "illustration",
      runner: async () => {
        await gates[index].promise;
        return { outputPath: `videos/${slug}/assets/illustrations/compare-1-left.png` };
      },
    }));

    await waitFor(() => queueStateForTests().running.length === 2, "two illustration jobs running");
    await settleAll(gates);
    for (const slug of slugs) {
      const job = listJobs({ slug }).find((item) => item.type === "illustration-generate");
      assert.equal(job.status, "completed");
      assert.match(job.outputPath, new RegExp(slug));
    }
  } finally {
    cleanup(slugs);
    reset();
  }
});

test("character conversion lock is scoped by project and pose", async () => {
  const slug = `queue-char-${Date.now()}`;
  const gates = [deferred(), deferred(), deferred()];
  reset();
  cleanup([slug]);
  try {
    enqueueJob({ type: "character-convert", slug, family: "character", resource: "point-left", runner: async () => { await gates[0].promise; return { pose: "point-left-1" }; } });
    enqueueJob({ type: "character-convert", slug, family: "character", resource: "point-left", runner: async () => { await gates[1].promise; return { pose: "point-left-2" }; } });
    enqueueJob({ type: "character-convert", slug, family: "character", resource: "question", runner: async () => { await gates[2].promise; return { pose: "question" }; } });

    await waitFor(() => queueStateForTests().running.length === 2 && queueStateForTests().queued.length === 1, "character pose lock");
    assert.deepEqual(queueStateForTests().running.map((job) => job.resource).sort(), ["point-left", "question"]);
    gates[0].resolve();
    await waitFor(() => queueStateForTests().running.some((job) => job.resource === "point-left" && job.status === "running") && queueStateForTests().queued.length === 0, "second same-pose conversion starts");
    gates[1].resolve();
    gates[2].resolve();
    await settleAll(gates);
  } finally {
    cleanup([slug]);
    reset();
  }
});

test("active jobs with the same idempotency key reuse the existing job", async () => {
  const slug = "queue-idempotent-" + Date.now();
  const gate = deferred();
  reset();
  cleanup([slug]);
  try {
    const first = enqueueJob({
      type: "remotion-render",
      slug,
      idempotencyKey: "remotion-render:" + slug + ":gpu",
      runner: async () => {
        await gate.promise;
        return { ok: true };
      },
    });
    const duplicate = enqueueJob({
      type: "remotion-render",
      slug,
      idempotencyKey: "remotion-render:" + slug + ":gpu",
      runner: async () => ({ duplicate: true }),
    });

    assert.equal(duplicate.id, first.id);
    await waitFor(() => queueStateForTests().running.length === 1, "idempotent job running");
    gate.resolve();
    await settleAll([gate]);
  } finally {
    cleanup([slug]);
    reset();
  }
});

test("terminal jobs do not block a new request with the same idempotency key", async () => {
  const slug = "queue-idempotent-terminal-" + Date.now();
  reset();
  cleanup([slug]);
  try {
    const first = enqueueJob({
      type: "remotion-check",
      slug,
      idempotencyKey: "remotion-check:" + slug,
      runner: async () => ({ ok: true }),
    });
    await waitFor(() => queueStateForTests().running.length === 0 && queueStateForTests().queued.length === 0, "first job completed");
    const second = enqueueJob({
      type: "remotion-check",
      slug,
      idempotencyKey: "remotion-check:" + slug,
      runner: async () => ({ ok: true }),
    });
    assert.notEqual(second.id, first.id);
    await waitFor(() => queueStateForTests().running.length === 0 && queueStateForTests().queued.length === 0, "second job completed");
  } finally {
    cleanup([slug]);
    reset();
  }
});

test("workflow family runs only one job at a time", async () => {
  const slugs = ["queue-workflow-a-", "queue-workflow-b-", "queue-workflow-c-"].map((prefix) => prefix + Date.now());
  const gates = slugs.map(() => deferred());
  reset();
  cleanup(slugs);
  try {
    slugs.forEach((slug, index) => enqueueJob({
      type: "auto-create-video",
      slug,
      family: "workflow",
      idempotencyKey: "workflow-test:" + slug,
      runner: async () => {
        await gates[index].promise;
        return { slug };
      },
    }));

    await waitFor(() => queueStateForTests().running.length === 1 && queueStateForTests().queued.length === 2, "workflow limit");
    gates[0].resolve();
    await waitFor(() => queueStateForTests().running.length === 1 && queueStateForTests().queued.length === 1, "next workflow starts");
    gates[1].resolve();
    gates[2].resolve();
    await settleAll(gates);
  } finally {
    cleanup(slugs);
    reset();
  }
});

test("queue shutdown interrupts queued and running jobs", async () => {
  const slug = "queue-shutdown-" + Date.now();
  reset();
  cleanup([slug]);
  try {
    const running = enqueueJob({
      type: "remotion-render",
      slug,
      runner: (job) => new Promise((resolve) => {
        setJobCanceller(job, resolve);
      }),
    });
    const queued = enqueueJob({
      type: "remotion-check",
      slug,
      runner: async () => ({ ok: true }),
    });
    await waitFor(() => queueStateForTests().running.length === 1 && queueStateForTests().queued.length === 1, "shutdown setup");
    await shutdownJobQueue();
    assert.equal(listJobs({ slug }).find((job) => job.id === running.id).status, "interrupted");
    assert.equal(listJobs({ slug }).find((job) => job.id === queued.id).status, "interrupted");
  } finally {
    cleanup([slug]);
    reset();
  }
});
