import test from "node:test";
import assert from "node:assert/strict";
import { getAssetStatus } from "../services/assetStatus.mjs";

test("asset status validates fixed character poses and paper background", async () => {
  const status = await getAssetStatus();
  assert.equal(status.poses["point-left"].ok, true);
  assert.equal(status.poses["point-right"].ok, true);
  assert.equal(status.poses.question.ok, true);
  assert.equal(status.background.ok, true);
  assert.equal(status.sampleAudio.ok, true);
});
