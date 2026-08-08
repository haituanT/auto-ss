import test from "node:test";
import assert from "node:assert/strict";
import { getStatus } from "../services/envStatus.mjs";

test("environment status resolves AIMAX and FFmpeg/FFprobe locations", async () => {
  const status = await getStatus();
  assert.equal(status.node.ok, true);
  assert.equal(status.aimax.ok, true);
  assert.equal(status.ffmpeg.ok, true);
  assert.equal(status.ffprobe.ok, true);
});
