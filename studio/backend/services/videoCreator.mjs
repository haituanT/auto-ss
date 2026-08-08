import fs from "node:fs";
import path from "node:path";
import { BACKGROUND_PATH, CHARACTER_DIR, videoPath } from "../paths.mjs";
import { buildCompositionHtml } from "./compositionBuilder.mjs";
import { defaultProjectConfig, normalizeProjectConfig } from "./projectConfig.mjs";
import { syncProjectState } from "./projectState.mjs";
import { slugify } from "./linePlanner.mjs";
import { getProjectTemplate, savedTemplateRefFromTemplate } from "./templateRefs.mjs";
import { applyTemplateConfigParts } from "./templateLibrary.mjs";
import { projectExists } from "./httpErrors.mjs";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function copyIfExists(source, dest) {
  if (fs.existsSync(source)) {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(source, dest);
  }
}

function copyCharacterAsset(name, root) {
  const candidates = [
    path.join(CHARACTER_DIR, "processed", `${name}.webm`),
    path.join(CHARACTER_DIR, "processed", `${name}.mp4`),
    path.join(CHARACTER_DIR, "originals", `${name}.png`),
    path.join(CHARACTER_DIR, "originals", `${name}.webp`),
    path.join(CHARACTER_DIR, "originals", `${name}.mov`),
    path.join(CHARACTER_DIR, "originals", `${name}.mp4`),
    path.join(CHARACTER_DIR, "originals", `${name}.webm`),
    path.join(CHARACTER_DIR, `${name}.png`),
    path.join(CHARACTER_DIR, `${name}.webp`),
    path.join(CHARACTER_DIR, `${name}.mp4`),
  ];
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source) return "";
  const dest = path.join(root, "assets", "character", `${name}${path.extname(source).toLowerCase()}`);
  copyIfExists(source, dest);
  return path.relative(root, dest).replace(/\\/g, "/");
}

function copySharedAssetsToVideoRoot(root, config, { includeCharacters = true } = {}) {
  ensureDir(path.join(root, "assets", "vo"));
  ensureDir(path.join(root, "assets", "sfx"));
  ensureDir(path.join(root, "assets", "backgrounds"));

  if (includeCharacters) {
    ensureDir(path.join(root, "assets", "character"));
    const poses = {
      "point-left": copyCharacterAsset("point-left", root),
      "point-right": copyCharacterAsset("point-right", root),
      question: copyCharacterAsset("question", root),
    };
    for (const [pose, rel] of Object.entries(poses)) {
      if (rel) config.character.poses[pose] = rel;
    }
  }

  copyIfExists(BACKGROUND_PATH, path.join(root, "assets", "backgrounds", "paper.png"));
}

export async function createVideo(body = {}) {
  const title = String(body.title || body.name || "Video so sánh").trim() || "Video so sánh";
  body = {
    ...body,
    title,
    slug: body.slug || title,
    leftLabel: body.leftLabel || body.left || "Nội dung A",
    rightLabel: body.rightLabel || body.right || "Nội dung B",
  };
  const leftLabel = String(body.leftLabel || body.left || "Sấm").trim();
  const rightLabel = String(body.rightLabel || body.right || "Chớp").trim();
  const slug = slugify(body.slug || `${leftLabel}-vs-${rightLabel}`) || `video-${Date.now()}`;
  const root = videoPath(slug);
  if (fs.existsSync(root)) {
    throw projectExists(slug);
  }

  ensureDir(root);
  ensureDir(path.join(root, "scripts"));

  const requestedTemplateRef = body.savedTemplateRef || body.templateRef || null;
  const projectTemplate = requestedTemplateRef?.id
    ? getProjectTemplate(requestedTemplateRef.type, requestedTemplateRef.id)
    : null;
  const savedTemplateRef = projectTemplate ? savedTemplateRefFromTemplate(projectTemplate) : null;
  const templatePoseStartSide = projectTemplate?.config?.poseStartSide === "right" ? "right" : "left";
  let config = defaultProjectConfig({
    slug,
    title: body.title || `${leftLabel} vs ${rightLabel}`,
    leftLabel,
    rightLabel,
    content: body.content,
    contentByCompareSet: body.contentByCompareSet || body.sections || null,
    templateId: body.templateId,
    savedTemplateRef,
    poseStartSide: templatePoseStartSide,
  });
  config.character = {
    ...(config.character || {}),
    poses: {},
  };
  if (!projectTemplate) {
    copySharedAssetsToVideoRoot(root, config, { includeCharacters: body.includeCharacters === true });
  } else {
    // A project created from a full template gets its style assets only from
    // applyTemplateConfigParts(), which copies them to the versioned project
    // folder. Keep runtime upload folders, but do not seed shared/template
    // asset paths as a fallback.
    ensureDir(path.join(root, "assets", "vo"));
    ensureDir(path.join(root, "assets", "sfx"));
  }
  if (projectTemplate) {
    const createParts = {
      ...(projectTemplate.parts || {}),
      content: false,
    };
    const applied = applyTemplateConfigParts(config, projectTemplate, {
      slug,
      projectRoot: root,
      parts: createParts,
    });
    config = normalizeProjectConfig({
      ...applied.config,
      savedTemplateRef,
      title: config.title,
      slug,
    }, slug);
  }

  writeJson(path.join(root, "video.json"), config);
  writeJson(path.join(root, "meta.json"), { id: slug, name: config.title });
  writeJson(path.join(root, "package.json"), {
    name: slug,
    private: true,
    type: "module",
    scripts: {
      "generate-vo": "node scripts/generate-vo.mjs",
      "sync-channel": "node scripts/sync-channel.mjs",
      "check": "node ../../scripts/remotion-render-video.mjs --check",
      "render": "node ../../scripts/remotion-render-video.mjs",
    },
  });

  fs.writeFileSync(path.join(root, "scripts", "generate-vo.mjs"), `import path from "node:path";\nimport { fileURLToPath } from "node:url";\nimport { generateVoiceoverForVideo } from "../../../scripts/voiceover-from-video-json.mjs";\n\nconst __dirname = path.dirname(fileURLToPath(import.meta.url));\nconst ROOT = path.resolve(__dirname, "..");\n\ngenerateVoiceoverForVideo(ROOT).catch((err) => {\n  console.error(err);\n  process.exit(1);\n});\n`, "utf8");
  fs.writeFileSync(path.join(root, "scripts", "sync-channel.mjs"), `console.log("Channel sync skipped for Remotion studio video.");\n`, "utf8");

  const normalized = normalizeProjectConfig(JSON.parse(fs.readFileSync(path.join(root, "video.json"), "utf8")), slug);
  writeJson(path.join(root, "video.json"), normalized);
  syncProjectState(root, normalized);
  fs.writeFileSync(path.join(root, "index.html"), buildCompositionHtml(normalized, root), "utf8");

  return { slug, root, config: normalized };
}

export function rebuildVideo(slug) {
  const root = videoPath(slug);
  const configPath = path.join(root, "video.json");
  if (!fs.existsSync(configPath)) throw new Error(`Missing video.json for ${slug}`);
  const config = normalizeProjectConfig(JSON.parse(fs.readFileSync(configPath, "utf8")), slug);
  writeJson(configPath, config);
  syncProjectState(root, config);
  fs.writeFileSync(path.join(root, "index.html"), buildCompositionHtml(config, root), "utf8");
  return { slug, root, config };
}

export function applySharedAssetsToVideo(slug) {
  const root = videoPath(slug);
  const configPath = path.join(root, "video.json");
  if (!fs.existsSync(configPath)) throw new Error(`Missing video.json for ${slug}`);
  const config = normalizeProjectConfig(JSON.parse(fs.readFileSync(configPath, "utf8")), slug);
  copySharedAssetsToVideoRoot(root, config);
  writeJson(configPath, config);
  syncProjectState(root, config);
  return rebuildVideo(slug);
}
