import fs from "node:fs";
import path from "node:path";
import { VIDEOS_DIR } from "../studio/backend/paths.mjs";
import { focusSideForPose, normalizeFocusSide } from "../studio/backend/services/linePlanner.mjs";
import { normalizeProjectConfig } from "../studio/backend/services/projectConfig.mjs";
import { markDirty } from "../studio/backend/services/projectPipeline.mjs";
import { syncProjectState } from "../studio/backend/services/projectState.mjs";

const DEFAULT_WHITE_BACKGROUND = {
  type: "color",
  src: "",
  color: "#ffffff",
  treatment: "raw",
  detail: 0,
  shade: 0,
  blur: 0,
  autoFromCompare: "",
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isPaperDefaultBackground(background = {}) {
  const src = String(background?.src || "").replace(/\\/g, "/");
  return !background?.custom && (!src || src === "assets/backgrounds/paper.png" || background.autoFromCompare);
}

function shouldUseWhiteDefault(config = {}) {
  return !config.savedTemplateRef && isPaperDefaultBackground(config.background);
}

function migrateLines(lines = []) {
  let changed = false;
  const nextLines = (Array.isArray(lines) ? lines : []).map((line) => {
    const expected = focusSideForPose(line?.pose);
    const current = normalizeFocusSide(line?.focusSide, expected);
    const oldSameSide = line?.pose === "point-left"
      ? current === "left"
      : line?.pose === "point-right"
        ? current === "right"
        : false;
    const missing = !line?.focusSide;
    const shouldUpdate = expected !== "center"
      ? (oldSameSide || missing)
      : (missing || (!line?.focusSideLocked && current !== "center"));
    if (!shouldUpdate || current === expected) return line;
    changed = true;
    return {
      ...line,
      focusSide: expected,
    };
  });
  return { lines: nextLines, changed };
}

function migrateProject(root) {
  const configPath = path.join(root, "video.json");
  if (!fs.existsSync(configPath)) return null;
  const slug = path.basename(root);
  const current = normalizeProjectConfig(readJson(configPath), slug);
  const { lines, changed: linesChanged } = migrateLines(current.lines);
  const backgroundChanged = shouldUseWhiteDefault(current);
  if (!linesChanged && !backgroundChanged) return null;

  let next = normalizeProjectConfig({
    ...current,
    lines,
    background: backgroundChanged ? DEFAULT_WHITE_BACKGROUND : current.background,
  }, slug);
  next = markDirty(next, ["layout", "render"]);
  writeJson(configPath, next);
  syncProjectState(root, next);
  return { slug, linesChanged, backgroundChanged };
}

const results = [];
if (fs.existsSync(VIDEOS_DIR)) {
  for (const entry of fs.readdirSync(VIDEOS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const result = migrateProject(path.join(VIDEOS_DIR, entry.name));
    if (result) results.push(result);
  }
}

const focusCount = results.filter((item) => item.linesChanged).length;
const backgroundCount = results.filter((item) => item.backgroundChanged).length;
console.log(JSON.stringify({
  scannedDir: VIDEOS_DIR,
  updatedProjects: results.length,
  focusProjects: focusCount,
  backgroundProjects: backgroundCount,
  slugs: results.map((item) => item.slug),
}, null, 2));
