const lockQueues = new Map();

function lockKey(slug) {
  const value = String(slug || "").trim();
  if (!value) throw new Error("Project lock requires a project id.");
  return value.toLowerCase();
}

export function withProjectLock(slug, action, fn) {
  if (typeof action === "function" && fn === undefined) {
    fn = action;
    action = "project write";
  }
  if (typeof fn !== "function") throw new Error("Project lock requires a callback.");

  const key = lockKey(slug);
  const previous = lockQueues.get(key) || Promise.resolve();
  let current;
  current = previous
    .catch(() => {})
    .then(async () => fn())
    .finally(() => {
      if (lockQueues.get(key) === current) lockQueues.delete(key);
    });
  lockQueues.set(key, current);
  return current;
}

export function projectLockStateForTests() {
  return [...lockQueues.keys()];
}

export function resetProjectLocksForTests() {
  lockQueues.clear();
}
