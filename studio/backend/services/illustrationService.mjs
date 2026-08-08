import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { videoPath } from "../paths.mjs";
import { normalizeProjectConfig } from "./projectConfig.mjs";
import { markDirty } from "./projectPipeline.mjs";
import { syncProjectState } from "./projectState.mjs";
import {
  appendLog,
  cancelJob,
  setJobCanceller,
  killChildTree,
  isJobCancelled,
  updateJob,
} from "./jobStore.mjs";
import { enqueueJob } from "./jobQueue.mjs";
import { withProjectLock } from "./projectLocks.mjs";
import {
  AI_IMAGE_ASPECT_RATIO,
  AI_IMAGE_SIZE,
  generateImagesWithCli,
  normalizeAiProvider,
} from "./aiCliProvider.mjs";

const VALID_TARGETS = new Set(["left", "right"]);
const VALID_STYLES = new Set(["realistic", "science", "cartoon", "3d"]);
const projectWriteQueues = new Map();
const PLACEHOLDER_LABELS = new Set([
  "",
  "noi dung a",
  "noi dung b",
  "content a",
  "content b",
  "anh a",
  "anh b",
  "a",
  "b",
]);

export const DEFAULT_ILLUSTRATION_SYSTEM_PROMPT = [
  "Tao 1 anh minh hoa ro rang cho noi dung duoc cung cap.",
  "Anh dung cho video giao duc dang so sanh A/B.",
  "Khong co chu, khong logo, khong watermark.",
  "Chi minh hoa dung 1 noi dung hien tai.",
  "Bo cuc don gian, chu the ro, de hieu.",
  `Ty le vuong ${AI_IMAGE_ASPECT_RATIO}, khung ${AI_IMAGE_SIZE}x${AI_IMAGE_SIZE}.`,
].join("\n");

const STYLE_PROMPTS = {
  realistic: `phong cach anh thuc te, anh sang sach, ro chu the, bo cuc vuong ${AI_IMAGE_ASPECT_RATIO}`,
  science: `phong cach minh hoa giao duc/khoa hoc, de hieu, bo cuc vuong ${AI_IMAGE_ASPECT_RATIO}`,
  cartoon: `phong cach hoat hinh don gian, than thien, bo cuc vuong ${AI_IMAGE_ASPECT_RATIO}`,
  "3d": `phong cach 3D render sach, mau ro, chu the noi bat, bo cuc vuong ${AI_IMAGE_ASPECT_RATIO}`,
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function logJob(job, chunk) {
  if (job) appendLog(job, chunk);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function nextAssetRevision() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

function withAssetRevision(config) {
  return { ...config, assetRevision: nextAssetRevision() };
}

function nowIso() {
  return new Date().toISOString();
}

function timestampForFile() {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function relativeAssetPath(root, target) {
  return path.relative(root, target).replace(/\\/g, "/");
}

function fileReady(filePath, minBytes = 1) {
  try {
    return fs.statSync(filePath).size >= minBytes;
  } catch {
    return false;
  }
}

function projectConfigPath(root) {
  return path.join(root, "video.json");
}

function readProjectConfig(root, slug) {
  const configPath = projectConfigPath(root);
  if (!fs.existsSync(configPath)) throw new Error(`Missing video.json for ${slug}`);
  return normalizeProjectConfig(readJson(configPath), slug);
}

function writeProjectConfig(root, config, slug) {
  const next = normalizeProjectConfig(config, slug);
  writeJson(projectConfigPath(root), next);
  syncProjectState(root, next);
  return next;
}

function normalizeCompareSetId(value) {
  const id = String(value || "compare-1").trim();
  return /^compare-[12]$/.test(id) ? id : "compare-1";
}

export function normalizeIllustrationTarget(value) {
  const target = String(value || "").trim().toLowerCase();
  if (target === "contenta" || target === "content-a") return "left";
  if (target === "contentb" || target === "content-b") return "right";
  return VALID_TARGETS.has(target) ? target : "";
}

function normalizeTargets(value = []) {
  const source = Array.isArray(value) ? value : [value];
  const targets = [...new Set(source.map(normalizeIllustrationTarget).filter(Boolean))];
  if (!targets.length) throw new Error("Missing illustration target.");
  return targets;
}

function normalizeStyle(value) {
  const style = String(value || "").trim().toLowerCase();
  return VALID_STYLES.has(style) ? style : "science";
}

function normalizeVariants(value) {
  const number = Math.floor(Number(value) || 1);
  return Math.max(1, Math.min(3, number));
}

function foldText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function validateIllustrationContent(content, target = "left") {
  const raw = String(content || "").trim();
  const folded = foldText(raw);
  if (!raw || PLACEHOLDER_LABELS.has(folded)) {
    const label = target === "right" ? "Noi dung B" : "Noi dung A";
    throw new Error(`Khong tao duoc anh cho ${label}. Vui long nhap noi dung that, vi du: ADN, Gen, Hong cau.`);
  }
  return raw;
}

function targetLabel(target) {
  return target === "right" ? "Noi dung B" : "Noi dung A";
}

function targetImageKey(target) {
  return target === "right" ? "rightImage" : "leftImage";
}

function findCompareSet(config, compareSetId) {
  const set = (config.compareSets || []).find((item) => item.id === compareSetId);
  if (!set) throw new Error(`Missing compare set: ${compareSetId}`);
  return set;
}

function targetContent(set, target) {
  return target === "right" ? set.rightLabel : set.leftLabel;
}

function outputPaths(root, compareSetId, target, variants) {
  const dir = path.join(root, "assets", "illustrations");
  return {
    dir,
    main: path.join(dir, `${compareSetId}-${target}.png`),
    variants: Array.from({ length: variants }, (_item, index) => path.join(dir, `${compareSetId}-${target}-v${index + 1}.png`)),
  };
}

function backupCurrentAsset(root, rel, compareSetId, target) {
  const source = rel ? path.join(root, rel.replace(/\//g, path.sep)) : "";
  if (!source || !fileReady(source)) return "";
  const historyDir = path.join(root, "assets", "illustrations", "history");
  ensureDir(historyDir);
  const ext = path.extname(source) || ".png";
  const history = path.join(historyDir, `${compareSetId}-${target}-${timestampForFile()}${ext}`);
  fs.copyFileSync(source, history);
  return relativeAssetPath(root, history);
}

async function validateImageFile(filePath) {
  if (!fileReady(filePath, 10 * 1024)) {
    throw new Error(`AI image is missing or too small: ${path.basename(filePath)}`);
  }
  const metadata = await sharp(filePath).metadata();
  if (!["png", "jpeg", "jpg", "webp"].includes(String(metadata.format || "").toLowerCase())) {
    throw new Error(`AI image has unsupported format: ${path.basename(filePath)}`);
  }
  if (!metadata.width || !metadata.height || metadata.width < 256 || metadata.height < 256) {
    throw new Error(`AI image has invalid dimensions: ${path.basename(filePath)}`);
  }
  return metadata;
}

async function normalizeGeneratedImage(source, target) {
  ensureDir(path.dirname(target));
  const tempTarget = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp.png`,
  );
  try {
    await sharp(source)
      .resize({
        width: AI_IMAGE_SIZE,
        height: AI_IMAGE_SIZE,
        fit: "cover",
        position: "center",
      })
      .png()
      .toFile(tempTarget);
    fs.rmSync(target, { force: true });
    fs.renameSync(tempTarget, target);
  } finally {
    fs.rmSync(tempTarget, { force: true });
  }
  await validateImageFile(target);
}

function setAiSlotState(config, compareSetId, target, patch = {}) {
  const compareSets = (config.compareSets || []).map((set) => ({ ...set, aiImages: { ...(set.aiImages || {}) } }));
  const index = compareSets.findIndex((set) => set.id === compareSetId);
  if (index < 0) throw new Error(`Missing compare set: ${compareSetId}`);
  const set = compareSets[index];
  set.aiImages[target] = {
    ...(set.aiImages?.[target] || {}),
    ...patch,
  };
  compareSets[index] = set;
  return {
    ...config,
    compareSets,
    compare: compareSetId === "compare-1" ? { ...set } : config.compare,
  };
}

function setCompareImage(config, compareSetId, target, assetPath) {
  const compareSets = (config.compareSets || []).map((set) => ({ ...set, aiImages: { ...(set.aiImages || {}) } }));
  const index = compareSets.findIndex((set) => set.id === compareSetId);
  if (index < 0) throw new Error(`Missing compare set: ${compareSetId}`);
  const set = compareSets[index];
  set[targetImageKey(target)] = assetPath;
  compareSets[index] = set;
  return {
    ...config,
    compareSets,
    compare: compareSetId === "compare-1" ? { ...set } : config.compare,
    ...(compareSetId === "compare-1" && target === "left" ? { leftImage: assetPath } : {}),
    ...(compareSetId === "compare-1" && target === "right" ? { rightImage: assetPath } : {}),
  };
}

function markIllustrationDirty(config) {
  return withAssetRevision(markDirty(normalizeProjectConfig(config, config.slug), ["assets", "render"]));
}

async function withProjectWriteLock(root, updater) {
  const key = path.resolve(root);
  const previous = projectWriteQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(updater);
  const stored = current.finally(() => {
    if (projectWriteQueues.get(key) === stored) projectWriteQueues.delete(key);
  });
  projectWriteQueues.set(key, stored);
  return current;
}

async function updateSlots(root, slug, updates, { dirty = true } = {}) {
  return withProjectWriteLock(root, () => {
    let config = readProjectConfig(root, slug);
    for (const update of updates) {
      config = setAiSlotState(config, update.compareSetId, update.target, update.patch);
      if (update.assetPath) {
        config = setCompareImage(config, update.compareSetId, update.target, update.assetPath);
      }
    }
    const next = dirty ? markIllustrationDirty(config) : normalizeProjectConfig(config, slug);
    return writeProjectConfig(root, next, slug);
  });
}

async function clearProcessingSlots(root, slug, requests, {
  jobId = "",
  state = "cancelled",
  error = "Đã dừng tạo ảnh AI.",
} = {}) {
  return withProjectWriteLock(root, () => {
    let config = readProjectConfig(root, slug);
    let changed = false;
    for (const request of requests) {
      let set;
      try {
        set = findCompareSet(config, request.compareSetId);
      } catch {
        continue;
      }
      const slot = set.aiImages?.[request.target] || {};
      if (slot.state !== "processing") continue;
      if (jobId && slot.jobId && slot.jobId !== jobId) continue;
      config = setAiSlotState(config, request.compareSetId, request.target, {
        state,
        jobId: "",
        error,
        updatedAt: nowIso(),
      });
      changed = true;
    }
    const next = changed ? normalizeProjectConfig(config, slug) : config;
    return writeProjectConfig(root, next, slug);
  });
}

function slotKey(item) {
  return `${item.compareSetId}:${item.target}`;
}

function normalizeIllustrationItems({ items, compareSetId, targets } = {}) {
  const normalized = [];
  if (Array.isArray(items) && items.length) {
    for (const item of items) {
      const target = normalizeIllustrationTarget(item?.target || item?.side);
      if (!target) continue;
      normalized.push({
        compareSetId: normalizeCompareSetId(item?.compareSetId || item?.setId || compareSetId),
        target,
      });
    }
  } else {
    const id = normalizeCompareSetId(compareSetId);
    normalized.push(...normalizeTargets(targets).map((target) => ({ compareSetId: id, target })));
  }

  const seen = new Set();
  const unique = [];
  for (const item of normalized) {
    const key = slotKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  if (!unique.length) throw new Error("Missing illustration target.");
  return unique;
}

function buildSlotRequests({
  root,
  config,
  compareSetId,
  targets,
  items,
  variants,
  provider,
  style,
  skipInvalid = false,
}) {
  const slots = normalizeIllustrationItems({ items, compareSetId, targets });
  const requests = [];
  const skipped = [];
  for (const slot of slots) {
    try {
      const set = findCompareSet(config, slot.compareSetId);
      const currentState = set.aiImages?.[slot.target]?.state || "empty";
      if (currentState === "processing") {
        throw new Error(`${slot.compareSetId} ${targetLabel(slot.target)} is already processing.`);
      }
      const content = validateIllustrationContent(targetContent(set, slot.target), slot.target);
      const paths = outputPaths(root, slot.compareSetId, slot.target, variants);
      const variantRels = paths.variants.map((item) => relativeAssetPath(root, item));
      const images = paths.variants.map((variantPath) => ({
        compareSetId: slot.compareSetId,
        target: slot.target,
        content,
        slotLabel: `${slot.compareSetId} ${targetLabel(slot.target)}`,
        provider,
        style,
        fileName: path.basename(variantPath),
        outputPath: variantPath,
      }));
      requests.push({
        ...slot,
        content,
        paths,
        variantRels,
        images,
      });
    } catch (error) {
      if (!skipInvalid) throw error;
      skipped.push({
        compareSetId: slot.compareSetId,
        target: slot.target,
        error: error.message || String(error),
      });
    }
  }
  if (!requests.length) {
    throw new Error(skipped.length
      ? `No valid illustration slots. Skipped ${skipped.length} slot(s).`
      : "Missing illustration target.");
  }
  return { requests, skipped };
}

function updatesForProcessing({ requests, provider, style, job }) {
  return requests.map((request) => ({
    compareSetId: request.compareSetId,
    target: request.target,
    patch: {
      state: "processing",
      jobId: job?.id || "",
      provider,
      style,
      selectedVariant: 0,
      variants: request.variantRels,
      prompt: request.content,
      error: "",
      updatedAt: nowIso(),
    },
  }));
}

function publicStatusFromConfig(config = {}) {
  return Object.fromEntries((config.compareSets || []).map((set) => [
    set.id,
    {
      left: set.aiImages?.left || {},
      right: set.aiImages?.right || {},
    },
  ]));
}

export function getIllustrationStatus(slug) {
  const root = videoPath(slug);
  return publicStatusFromConfig(readProjectConfig(root, slug));
}

function setCancelForChildren(job, children) {
  if (!job) return;
  setJobCanceller(job, () => {
    for (const child of children) killChildTree(child);
  });
}

async function generateOneSlot({
  root,
  slug,
  request,
  provider,
  style,
  variants,
  outputDir,
  providerRunner,
  job,
  children,
  totalSlots = 1,
}) {
  logJob(job, `AI slot started: ${request.compareSetId} ${request.target} (${request.content}).\n`);
  if (job) {
    updateJob(job, {
      progress: Math.max(Number(job.progress) || 0, 18),
      message: `Generating AI image for ${request.compareSetId} ${request.target}.`,
    });
  }
  await providerRunner({
    provider,
    outputDir,
    images: request.images,
    systemPrompt: DEFAULT_ILLUSTRATION_SYSTEM_PROMPT,
    stylePrompt: STYLE_PROMPTS[style],
    timeoutMs: provider === "codex" ? 12 * 60 * 1000 : 8 * 60 * 1000,
    onOutput: (chunk) => logJob(job, chunk),
    onChild: (child) => {
      if (!child) return;
      children.add(child);
      child.once?.("close", () => children.delete(child));
      setCancelForChildren(job, children);
    },
  });
  if (isJobCancelled(job)) throw new Error("AI illustration job cancelled.");
  if (job) {
    updateJob(job, {
      progress: Math.max(Number(job.progress) || 0, 70),
      message: `Validating AI image for ${request.compareSetId} ${request.target}.`,
    });
  }

  const variantRels = [];
  for (const variantPath of request.paths.variants) {
    await normalizeGeneratedImage(variantPath, variantPath);
    variantRels.push(relativeAssetPath(root, variantPath));
  }
  const currentConfig = readProjectConfig(root, slug);
  const currentSet = findCompareSet(currentConfig, request.compareSetId);
  const oldAsset = currentSet[targetImageKey(request.target)];
  const historyPath = backupCurrentAsset(root, oldAsset, request.compareSetId, request.target);
  await normalizeGeneratedImage(request.paths.variants[0], request.paths.main);
  const mainRel = relativeAssetPath(root, request.paths.main);
  const nextConfig = await updateSlots(root, slug, [{
    compareSetId: request.compareSetId,
    target: request.target,
    assetPath: mainRel,
    patch: {
      state: "ready",
      jobId: "",
      provider,
      style,
      selectedVariant: 1,
      asset: mainRel,
      variants: variantRels,
      prompt: validateIllustrationContent(targetContent(currentSet, request.target), request.target),
      error: "",
      updatedAt: nowIso(),
      history: historyPath ? [historyPath, ...((currentSet.aiImages?.[request.target]?.history || []).slice(0, 10))] : (currentSet.aiImages?.[request.target]?.history || []),
    },
  }], { dirty: true });
  logJob(job, `AI slot completed: ${request.compareSetId} ${request.target}.\n`);
  if (job) {
    job._illustrationCompleted = (Number(job._illustrationCompleted) || 0) + 1;
    updateJob(job, {
      progress: Math.min(98, Math.round(72 + (job._illustrationCompleted / Math.max(1, totalSlots)) * 24)),
      message: `AI image ready ${job._illustrationCompleted}/${Math.max(1, totalSlots)} slot(s).`,
    });
  }
  return {
    compareSetId: request.compareSetId,
    target: request.target,
    assetPath: mainRel,
    variants,
    status: publicStatusFromConfig(nextConfig)?.[request.compareSetId]?.[request.target],
  };
}

export async function runIllustrationGeneration({
  slug,
  compareSetId = "compare-1",
  targets = ["left", "right"],
  items,
  mode = "parallel-slots",
  provider = "agy",
  style = "science",
  variants = 1,
  skipInvalid,
  job = null,
  providerRunner = generateImagesWithCli,
} = {}) {
  const root = videoPath(slug);
  const normalizedCompareSetId = normalizeCompareSetId(compareSetId);
  const normalizedProvider = normalizeAiProvider(provider);
  const normalizedStyle = normalizeStyle(style);
  const normalizedVariants = normalizeVariants(variants);
  const shouldSkipInvalid = typeof skipInvalid === "boolean" ? skipInvalid : Array.isArray(items);
  let config = readProjectConfig(root, slug);
  const { requests, skipped } = buildSlotRequests({
    root,
    config,
    compareSetId: normalizedCompareSetId,
    targets,
    items,
    variants: normalizedVariants,
    provider: normalizedProvider,
    style: normalizedStyle,
    skipInvalid: shouldSkipInvalid,
  });

  logJob(job, `AI illustration started: ${normalizedProvider}, ${normalizedStyle}, ${normalizedVariants} variant(s), ${requests.length} slot(s), mode=${mode}.\n`);
  if (skipped.length) logJob(job, `Skipped ${skipped.length} invalid/locked slot(s).\n`);
  if (job) {
    updateJob(job, {
      progress: 8,
      message: `Preparing ${requests.length} AI image slot(s).`,
    });
  }
  config = await updateSlots(root, slug, updatesForProcessing({
    requests,
    provider: normalizedProvider,
    style: normalizedStyle,
    job,
  }), { dirty: false });
  if (job) updateJob(job, { progress: 14, message: "Marked AI image slots as processing." });

  const outputDir = path.join(root, "assets", "illustrations");
  const children = new Set();
  const settled = await Promise.allSettled(requests.map(async (request) => {
    try {
      return await generateOneSlot({
        root,
        slug,
        request,
        provider: normalizedProvider,
        style: normalizedStyle,
        variants: normalizedVariants,
        outputDir,
        providerRunner,
        job,
        children,
        totalSlots: requests.length,
      });
    } catch (error) {
      if (!isJobCancelled(job)) {
        await updateSlots(root, slug, [{
          compareSetId: request.compareSetId,
          target: request.target,
          patch: {
            state: "error",
            jobId: "",
            provider: normalizedProvider,
            style: normalizedStyle,
            error: error.message || String(error),
            updatedAt: nowIso(),
          },
        }], { dirty: false });
      }
      throw error;
    }
  }));
  if (job) setJobCanceller(job, null);
  if (isJobCancelled(job)) {
    await clearProcessingSlots(root, slug, requests, {
      jobId: job?.id || "",
      state: "cancelled",
      error: "Đã dừng tạo ảnh AI.",
    });
    throw new Error("AI illustration job cancelled.");
  }

  const successes = [];
  const failures = [];
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const request = requests[index];
    if (result.status === "fulfilled") {
      successes.push(result.value);
      continue;
    }
    const error = result.reason?.message || String(result.reason);
    failures.push({ compareSetId: request.compareSetId, target: request.target, error });
  }

  const nextConfig = readProjectConfig(root, slug);
  logJob(job, "AI illustration completed.\n");
  if (job) updateJob(job, { progress: 98, message: "AI illustration generation completed." });
  const compareSetIds = [...new Set(requests.map((request) => request.compareSetId))];
  return {
    slug,
    compareSetId: compareSetIds[0] || normalizedCompareSetId,
    compareSetIds,
    items: requests.map((request) => ({ compareSetId: request.compareSetId, target: request.target })),
    targets: requests.map((request) => request.target),
    provider: normalizedProvider,
    style: normalizedStyle,
    variants: normalizedVariants,
    mode,
    successes,
    failures,
    skipped,
    successCount: successes.length,
    failureCount: failures.length,
    skippedCount: skipped.length,
    partialErrors: failures,
    config: nextConfig,
    status: publicStatusFromConfig(nextConfig),
  };
}

export function startIllustrationGeneration(options = {}) {
  const slug = String(options.slug || "").trim();
  if (!slug) throw new Error("Missing video slug.");
  const root = videoPath(slug);
  const config = readProjectConfig(root, slug);
  const compareSetId = normalizeCompareSetId(options.compareSetId);
  const targets = options.targets || ["left", "right"];
  const items = options.items;
  const provider = normalizeAiProvider(options.provider || "agy");
  const style = normalizeStyle(options.style || "science");
  const variants = normalizeVariants(options.variants || 1);
  const skipInvalid = Array.isArray(items);
  const prepared = buildSlotRequests({ root, config, compareSetId, targets, items, variants, provider, style, skipInvalid });

  return enqueueJob({
    type: "illustration-generate",
    slug,
    family: "illustration",
    resource: compareSetId,
    message: "Waiting for AI image worker.",
    startMessage: "Starting AI image generation.",
    runner: async (job) => {
      try {
        const result = await runIllustrationGeneration({ slug, compareSetId, targets, items, provider, style, variants, mode: options.mode || "parallel-slots", skipInvalid, job });
        const jobResult = {
          slug,
          compareSetId: result.compareSetId,
          compareSetIds: result.compareSetIds,
          items: result.items,
          provider,
          style,
          variants,
          mode: result.mode,
          successCount: result.successCount,
          failureCount: result.failureCount,
          skippedCount: result.skippedCount,
          failures: result.failures,
          skipped: result.skipped,
          status: result.status,
        };
        if (!result.successCount && result.failureCount) {
          throw new Error(result.failures.map((failure) => failure.error).join("; ") || "AI illustration failed.");
        }
        return jobResult;
      } catch (error) {
        if (isJobCancelled(job)) {
          appendLog(job, "\nAI illustration stopped by user.\n");
          try {
            await clearProcessingSlots(root, slug, prepared.requests, {
              jobId: job?.id || "",
              state: "cancelled",
              error: "Đã dừng tạo ảnh AI.",
            });
          } catch {
            // Preserve the cancellation result if config cleanup also fails.
          }
        } else {
          appendLog(job, `\nAI illustration failed: ${error.message || error}\n`);
          const updates = prepared.requests.map((request) => ({
            compareSetId: request.compareSetId,
            target: request.target,
            patch: {
              state: "error",
              jobId: "",
              provider,
              style,
              error: error.message || String(error),
              updatedAt: nowIso(),
            },
          }));
          try {
            await updateSlots(root, slug, updates, { dirty: false });
          } catch {
            // Preserve the job error if config update also fails.
          }
        }
        throw error;
      }
    },
  });
}

export async function cancelIllustrationSlot({
  slug,
  compareSetId = "compare-1",
  target = "left",
  jobId = "",
} = {}) {
  const normalizedSlug = String(slug || "").trim();
  if (!normalizedSlug) throw new Error("Missing video slug.");
  const root = videoPath(normalizedSlug);
  const normalizedCompareSetId = normalizeCompareSetId(compareSetId);
  const normalizedTarget = normalizeIllustrationTarget(target);
  if (!normalizedTarget) throw new Error("Missing illustration target.");
  const normalizedJobId = String(jobId || "").trim();
  if (normalizedJobId) {
    cancelJob(normalizedJobId, "Đã dừng tạo ảnh AI.");
  }
  const config = await clearProcessingSlots(root, normalizedSlug, [{
    compareSetId: normalizedCompareSetId,
    target: normalizedTarget,
  }], {
    jobId: normalizedJobId,
    state: "cancelled",
    error: "Đã dừng tạo ảnh AI.",
  });
  return {
    slug: normalizedSlug,
    compareSetId: normalizedCompareSetId,
    target: normalizedTarget,
    config,
    status: publicStatusFromConfig(config),
  };
}

async function selectIllustrationVariantUnlocked({
  slug,
  compareSetId = "compare-1",
  target = "left",
  variant = 1,
} = {}) {
  const root = videoPath(slug);
  const normalizedCompareSetId = normalizeCompareSetId(compareSetId);
  const normalizedTarget = normalizeIllustrationTarget(target);
  if (!normalizedTarget) throw new Error("Missing illustration target.");
  const variantIndex = Math.max(1, Math.min(12, Math.floor(Number(variant) || 1))) - 1;
  let config = readProjectConfig(root, slug);
  const set = findCompareSet(config, normalizedCompareSetId);
  const aiSlot = set.aiImages?.[normalizedTarget] || {};
  const variantRel = aiSlot.variants?.[variantIndex];
  if (!variantRel) throw new Error("Selected illustration variant is not available.");
  const variantPath = path.join(root, variantRel.replace(/\//g, path.sep));
  await validateImageFile(variantPath);
  await normalizeGeneratedImage(variantPath, variantPath);
  const paths = outputPaths(root, normalizedCompareSetId, normalizedTarget, 1);
  const historyPath = backupCurrentAsset(root, set[targetImageKey(normalizedTarget)], normalizedCompareSetId, normalizedTarget);
  await normalizeGeneratedImage(variantPath, paths.main);
  const mainRel = relativeAssetPath(root, paths.main);
  config = setAiSlotState(config, normalizedCompareSetId, normalizedTarget, {
    ...aiSlot,
    state: "ready",
    selectedVariant: variantIndex + 1,
    asset: mainRel,
    error: "",
    updatedAt: nowIso(),
    history: historyPath ? [historyPath, ...((aiSlot.history || []).slice(0, 10))] : (aiSlot.history || []),
  });
  config = setCompareImage(config, normalizedCompareSetId, normalizedTarget, mainRel);
  const next = writeProjectConfig(root, markIllustrationDirty(config), slug);
  return {
    slug,
    compareSetId: normalizedCompareSetId,
    target: normalizedTarget,
    assetPath: mainRel,
    config: next,
    status: publicStatusFromConfig(next),
  };
}

export async function selectIllustrationVariant(options = {}) {
  return withProjectLock(options.slug, "select illustration variant", () => selectIllustrationVariantUnlocked(options));
}
