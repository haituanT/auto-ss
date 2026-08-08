import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { videoPath } from "../paths.mjs";
import { runGenerateVo } from "../services/scriptRunner.mjs";
import { cancelJob, resetJobStoreForTests } from "../services/jobStore.mjs";
import { resetJobQueueForTests } from "../services/jobQueue.mjs";

test("temporary AIMAX keys are hashed in job metadata and omitted from public jobs", () => {
  const slug = `temporary-key-${Date.now()}`;
  const secret = "temporary-secret-value";
  resetJobQueueForTests();
  resetJobStoreForTests();
  let job;
  try {
    job = runGenerateVo(slug, "aimax", { apiKey: secret, voiceId: "voice-a", speed: 1.1 });
    assert.equal(job.id.includes(secret), false);
    assert.equal(JSON.stringify(job).includes(secret), false);

    const activePath = path.join(videoPath(slug), "jobs", "active", `${job.id}.json`);
    const persisted = JSON.parse(fs.readFileSync(activePath, "utf8"));
    assert.equal(persisted.idempotencyKey.includes(secret), false);
    assert.match(persisted.idempotencyKey, /^generate-vo:/);
    cancelJob(job.id, "Stopped in test.");
  } finally {
    resetJobQueueForTests();
    resetJobStoreForTests();
    fs.rmSync(videoPath(slug), { recursive: true, force: true });
  }
});
