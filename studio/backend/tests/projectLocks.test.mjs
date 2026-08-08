import assert from "node:assert/strict";
import test from "node:test";
import { resetProjectLocksForTests, withProjectLock } from "../services/projectLocks.mjs";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("project lock runs callbacks for the same slug in FIFO order", async () => {
  resetProjectLocksForTests();
  const events = [];
  const first = withProjectLock("lock-same", "first", async () => {
    events.push("first-start");
    await sleep(25);
    events.push("first-end");
    return 1;
  });
  const second = withProjectLock("lock-same", "second", async () => {
    events.push("second-start");
    return 2;
  });

  assert.equal(await first, 1);
  assert.equal(await second, 2);
  assert.deepEqual(events, ["first-start", "first-end", "second-start"]);
  resetProjectLocksForTests();
});

test("different projects can hold locks concurrently", async () => {
  resetProjectLocksForTests();
  let active = 0;
  let peak = 0;
  const run = (slug) => withProjectLock(slug, "parallel", async () => {
    active += 1;
    peak = Math.max(peak, active);
    await sleep(25);
    active -= 1;
  });

  await Promise.all([run("lock-a"), run("lock-b")]);
  assert.equal(peak, 2);
  resetProjectLocksForTests();
});

test("project lock releases after a callback error", async () => {
  resetProjectLocksForTests();
  await assert.rejects(
    withProjectLock("lock-error", "failing", async () => {
      throw new Error("expected lock failure");
    }),
    /expected lock failure/,
  );
  await assert.doesNotReject(withProjectLock("lock-error", "after-error", async () => "ok"));
  resetProjectLocksForTests();
});
