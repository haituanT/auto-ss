import fs from "node:fs";
import path from "node:path";
import { BACKGROUND_PATH, CHARACTER_DIR, videoPath } from "../paths.mjs";
import { normalizeProjectConfig } from "./projectConfig.mjs";
import { voiceSyncIssues } from "./voiceTiming.mjs";
import { SFX_DIR } from "./sfxLibrary.mjs";

const POSES = ["point-left", "point-right", "question"];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveProjectPath(root, value) {
  if (!value) return "";
  if (path.isAbsolute(value)) return value;
  return path.join(root, String(value).replace(/\//g, path.sep));
}

function existsAny(candidates) {
  return candidates.some((candidate) => candidate && fs.existsSync(candidate));
}

function sharedSfxPath(name) {
  if (!name || name === "__none__") return "";
  const parts = String(name).replace(/\\/g, "/").split("/").filter((part) => part && part !== "." && part !== "..");
  return path.join(SFX_DIR, ...parts);
}

function poseSfxCandidates(root, name) {
  if (!name || name === "__none__") return [];
  const normalized = String(name).replace(/\\/g, "/");
  const basename = normalized.split("/").filter(Boolean).pop() || "";
  return [
    resolveProjectPath(root, normalized),
    basename ? path.join(root, "assets", "sfx", basename) : "",
    sharedSfxPath(normalized),
  ];
}

function sharedPoseCandidates(pose) {
  return [
    path.join(CHARACTER_DIR, "processed", `${pose}.webm`),
    path.join(CHARACTER_DIR, "processed", `${pose}.mp4`),
    path.join(CHARACTER_DIR, "originals", `${pose}.png`),
    path.join(CHARACTER_DIR, "originals", `${pose}.webp`),
    path.join(CHARACTER_DIR, "originals", `${pose}.mov`),
    path.join(CHARACTER_DIR, "originals", `${pose}.mp4`),
    path.join(CHARACTER_DIR, "originals", `${pose}.webm`),
    path.join(CHARACTER_DIR, `${pose}.png`),
    path.join(CHARACTER_DIR, `${pose}.webp`),
    path.join(CHARACTER_DIR, `${pose}.mp4`),
  ];
}

function hasAudio(root, config) {
  const audio = config.audio || {};
  if (audio.mainAudio && fs.existsSync(resolveProjectPath(root, audio.mainAudio))) return true;
  if (audio.srt && fs.existsSync(resolveProjectPath(root, audio.srt))) return true;
  return config.lines.some((line) => existsAny([
    path.join(root, "assets", "vo", `${line.id}.mp3`),
    path.join(root, "assets", "vo", `${line.id}.wav`),
    path.join(root, "assets", "vo", `${line.id}.m4a`),
  ]));
}

export function checkProjectData(slug) {
  const root = videoPath(slug);
  const configPath = path.join(root, "video.json");
  if (!fs.existsSync(configPath)) {
    return { ok: false, errors: [`Missing video.json for ${slug}`], warnings: [], config: null };
  }

  const config = normalizeProjectConfig(readJson(configPath), slug);
  const errors = [];
  const warnings = [];

  for (const set of (config.compareSets || []).filter((item) => item?.id !== "compare-1")) {
    const hasLines = config.lines.some((line) => (line.compareSetId || "compare-1") === set.id);
    if (!hasLines) continue;
    const label = set.id === "compare-2" ? "SS2" : set.id;
    if (!existsAny([resolveProjectPath(root, set.leftImage)])) errors.push(`Thiếu ảnh A cho ${label}.`);
    if (!existsAny([resolveProjectPath(root, set.rightImage)])) errors.push(`Thiếu ảnh B cho ${label}.`);
  }

  if (!existsAny([resolveProjectPath(root, config.compare.leftImage)])) errors.push("Thiếu ảnh A.");
  if (!existsAny([resolveProjectPath(root, config.compare.rightImage)])) errors.push("Thiếu ảnh B.");
  if (!existsAny([resolveProjectPath(root, config.background?.src), BACKGROUND_PATH])) errors.push("Thiếu nền video.");

  if (config.logo?.enabled && !existsAny([resolveProjectPath(root, config.logo?.src)])) errors.push("Thiáº¿u file logo Ä‘Ã£ báº­t.");
  if (config.audio?.bgm && !existsAny([resolveProjectPath(root, config.audio.bgm)])) errors.push("Thiếu file BGM đã chọn.");
  if (config.audio?.sceneStartSfx?.enabled) {
    for (const pose of POSES) {
      const sound = config.poseSfx?.[pose];
      if (!sound || sound === "__none__") continue;
      if (!existsAny(poseSfxCandidates(root, sound))) errors.push(`Thiếu sound đầu cảnh cho pose ${pose}: ${sound}.`);
    }
  }
  const usedPoses = new Set((config.lines || []).map((line) => POSES.includes(line.pose) ? line.pose : "question"));
  for (const pose of POSES) {
    const configuredPose = String(config.character?.poses?.[pose] || "");
    const sourceInfo = config.character?.poseSources?.[pose] || {};
    const projectPose = resolveProjectPath(root, configuredPose);
    if ((!configuredPose && usedPoses.has(pose)) || (configuredPose && !existsAny([projectPose, ...sharedPoseCandidates(pose)]))) {
      errors.push(`Thiếu pose nhân vật ${pose}.`);
    }
    if (usedPoses.has(pose) && sourceInfo.state === "processing") {
      errors.push(`Pose nhan vat ${pose} dang chuan hoa. Cho xu ly xong truoc khi preview final/render.`);
    }
    if (usedPoses.has(pose) && sourceInfo.state === "error") {
      errors.push(`Pose nhan vat ${pose} loi chuan hoa${sourceInfo.error ? `: ${sourceInfo.error}` : "."}`);
    }
    if (usedPoses.has(pose) && sourceInfo.state === "ready" && sourceInfo.render) {
      const renderPose = resolveProjectPath(root, sourceInfo.render);
      if (!existsAny([renderPose])) errors.push(`Pose nhan vat ${pose} thieu WebM render da chuan hoa.`);
    }
    if (config.character?.poseWarnings?.[pose]) warnings.push(`${POSES.indexOf(pose) + 1}. ${config.character.poseWarnings[pose]}`);
  }

  if (!Array.isArray(config.lines) || !config.lines.length) errors.push("Chưa có kịch bản.");
  if (!hasAudio(root, config)) errors.push("Chưa có audio AIMAX hoặc audio upload.");
  errors.push(...voiceSyncIssues(root, config));
  if (config.lines.some((line) => !Number.isFinite(Number(line.start)) || !Number.isFinite(Number(line.duration)))) {
    warnings.push("Một số dòng chưa có timing. Render sẽ dùng timing dự phòng theo duration audio từng dòng.");
  }

  return { ok: errors.length === 0, errors, warnings, config };
}

export function assertProjectReady(slug) {
  const result = checkProjectData(slug);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result;
}
