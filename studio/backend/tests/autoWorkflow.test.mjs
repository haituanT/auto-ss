import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { videoPath } from "../paths.mjs";
import { cancelJob, resetJobStoreForTests } from "../services/jobStore.mjs";
import { queueStateForTests, resetJobQueueForTests } from "../services/jobQueue.mjs";
import { runAutoCreateVideo } from "../services/autoWorkflow.mjs";

function cleanupJob(id) {
  const root = videoPath("_global");
  for (const dir of ["active", "history", "logs"]) {
    fs.rmSync(path.join(root, "jobs", dir, id + (dir === "logs" ? ".log" : ".json")), { force: true });
  }
}

async function waitForQueueToSettle() {
  for (let index = 0; index < 100; index += 1) {
    if (!queueStateForTests().queued.length && !queueStateForTests().running.length) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Auto workflow queue did not settle.");
}

test("auto-create uses the shared queue and deduplicates active requests", async () => {
  const slug = "auto-workflow-queue-" + Date.now();
  const jobIds = [];
  resetJobQueueForTests();
  resetJobStoreForTests();
  try {
    const first = runAutoCreateVideo({
      slug,
      leftLabel: "A",
      rightLabel: "B",
      audioMode: "none",
      render: false,
    });
    jobIds.push(first.id);
    assert.equal(fs.existsSync(videoPath(slug)), false);
    const duplicate = runAutoCreateVideo({
      slug,
      leftLabel: "A",
      rightLabel: "B",
      audioMode: "none",
      render: false,
    });

    assert.equal(first.type, "auto-create-video");
    assert.equal(first.family, "workflow");
    assert.equal(duplicate.id, first.id);
    cancelJob(first.id, "Stopped in test.");
    await waitForQueueToSettle();

    const afterTerminal = runAutoCreateVideo({ slug, audioMode: "none", render: false });
    jobIds.push(afterTerminal.id);
    assert.notEqual(afterTerminal.id, first.id);
    cancelJob(afterTerminal.id, "Stopped in test.");
    await waitForQueueToSettle();
  } finally {
    fs.rmSync(videoPath(slug), { recursive: true, force: true });
    for (const id of jobIds) cleanupJob(id);
    resetJobQueueForTests();
    resetJobStoreForTests();
  }
});
