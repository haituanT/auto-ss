import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { videoPath } from "../paths.mjs";
import { normalizeProjectConfig } from "./projectConfig.mjs";
import { markDirty } from "./projectPipeline.mjs";
import { syncProjectState } from "./projectState.mjs";
import { withProjectLock } from "./projectLocks.mjs";

async function storeImage(file, targetPath) {
  if (!file?.path) return false;
  try {
    await sharp(file.path)
      .rotate()
      .resize(1080, 1080, { fit: "cover", position: "centre" })
      .png()
      .toFile(targetPath);
    return true;
  } finally {
    fs.rmSync(file.path, { force: true });
  }
}

async function applyCompareImagesUnlocked({ slug, leftFile, rightFile }) {
  const root = videoPath(slug);
  const assetsDir = path.join(root, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  const [left, right] = await Promise.all([
    storeImage(leftFile, path.join(assetsDir, "compare-left.png")),
    storeImage(rightFile, path.join(assetsDir, "compare-right.png")),
  ]);

  const configPath = path.join(root, "video.json");
  if (!fs.existsSync(configPath)) throw new Error(`Missing video.json for ${slug}`);
  const config = normalizeProjectConfig(JSON.parse(fs.readFileSync(configPath, "utf8")), slug);
  const compareSets = config.compareSets.map((set) => set.id === "compare-1"
    ? {
      ...set,
      leftImage: left ? "assets/compare-left.png" : set.leftImage,
      rightImage: right ? "assets/compare-right.png" : set.rightImage,
    }
    : set);
  const next = {
    ...config,
    compareSets,
    assetRevision: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`,
  };
  const normalized = normalizeProjectConfig(markDirty(next, ["assets", "render"]), slug);
  fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  syncProjectState(root, normalized);

  return { slug, left, right, config: normalized };
}

export async function applyCompareImages(options = {}) {
  return withProjectLock(options.slug, "apply comparison images", () => applyCompareImagesUnlocked(options));
}
