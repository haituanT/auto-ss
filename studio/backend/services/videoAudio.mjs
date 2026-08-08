import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFPROBE_PATH, videoPath } from "../paths.mjs";
import { rebuildVideo } from "./videoCreator.mjs";
import { normalizeProjectConfig } from "./projectConfig.mjs";
import { focusSideForPose, inferLine, lineGapAfterSeconds, normalizeCompareSetId, normalizeFocusSide, normalizePose } from "./linePlanner.mjs";
import { clearDirty, markDirty } from "./projectPipeline.mjs";
import { syncProjectState } from "./projectState.mjs";
import { writeAudioManifest } from "./voiceTiming.mjs";
import { withProjectLock } from "./projectLocks.mjs";

const execFileAsync = promisify(execFile);

async function mediaDuration(filePath) {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath
  ], { windowsHide: true });
  const duration = Number.parseFloat(stdout);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Cannot read audio duration: ${filePath}`);
  }
  return duration;
}

function timestampToSeconds(value) {
  const match = String(value).trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) throw new Error(`Invalid SRT timestamp: ${value}`);
  const [, hours, minutes, seconds, milliseconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(milliseconds) / 1000;
}

export function parseSrt(content) {
  const blocks = String(content || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const cues = blocks.map((block) => {
    const lines = block.split("\n").map((line) => line.trim());
    if (/^\d+$/.test(lines[0])) lines.shift();
    const timingLine = lines.shift();
    const timing = timingLine?.match(/^(.*?)\s*-->\s*(.*?)$/);
    if (!timing) throw new Error(`Invalid SRT cue: ${block}`);

    const text = lines
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\{[^}]+\}/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const start = timestampToSeconds(timing[1]);
    const end = timestampToSeconds(timing[2]);
    if (!text || end <= start) throw new Error(`Invalid SRT cue timing or text: ${block}`);
    return { start, end, duration: Number((end - start).toFixed(3)), text };
  });

  if (!cues.length) throw new Error("SRT file has no usable subtitle cues.");
  return cues;
}

export function poseForSubtitle(existingLine, cue, index, compareSet = {}) {
  const selectedPose = normalizePose(existingLine?.pose, "");
  if (selectedPose) return selectedPose;

  if (index === 2) return "question";

  const inferred = inferLine({
    text: cue.text,
    leftLabel: compareSet.leftLabel,
    rightLabel: compareSet.rightLabel,
    index,
  });
  if (inferred.pose !== "question") return inferred.pose;

  return index === 0 || (index > 2 && (index - 3) % 2 === 0) ? "point-left" : "point-right";
}

export function focusSideForSubtitle(existingLine, pose) {
  if (existingLine?.focusSideLocked) {
    return normalizeFocusSide(existingLine.focusSide, focusSideForPose(pose));
  }
  if (existingLine?.focusSide) {
    return normalizeFocusSide(existingLine.focusSide, focusSideForPose(pose));
  }
  return focusSideForPose(pose);
}

async function uploadFullAudioUnlocked({ slug, file, subtitleFile }) {
  if (!file?.path) throw new Error("Missing uploaded audio file.");

  try {
    const root = videoPath(slug);
    const configPath = path.join(root, "video.json");
    if (!fs.existsSync(configPath)) throw new Error(`Missing video.json for ${slug}`);

    const config = normalizeProjectConfig(JSON.parse(fs.readFileSync(configPath, "utf8")), slug);
    const existingLines = Array.isArray(config.lines) ? config.lines : [];
    if (!existingLines.length && !subtitleFile?.path) {
      throw new Error("Provide a script or an SRT file for the subtitles.");
    }

    let subtitleCues = null;
    if (subtitleFile?.path) {
      subtitleCues = parseSrt(fs.readFileSync(subtitleFile.path, "utf8"));
      if (existingLines.length && subtitleCues.length !== existingLines.length) {
        throw new Error(`SRT has ${subtitleCues.length} cue(s), but the official script has ${existingLines.length} line(s). Keep the counts equal so SS1/SS2 mapping is preserved.`);
      }
    }

    // Validate the source before replacing the project's existing audio.
    const duration = await mediaDuration(file.path);

    const voDir = path.join(root, "assets", "vo");
    fs.mkdirSync(voDir, { recursive: true });
    const fullAudioPath = path.join(voDir, "full.mp3");
    fs.copyFileSync(file.path, fullAudioPath);

    let durations;
    let perLine = null;

    if (subtitleCues) {
      config.lines = subtitleCues.map((cue, index) => {
        const existingLine = existingLines[index] || {};
        const pose = poseForSubtitle(
          existingLines[index],
          cue,
          index,
          config.compareSets?.find((set) => set.id === normalizeCompareSetId(existingLines[index]?.compareSetId)) || config.compare,
        );
        return {
          id: existingLine.id || `line-${index + 1}`,
          compareSetId: normalizeCompareSetId(existingLine.compareSetId),
          text: cue.text,
          role: existingLine.role || "",
          highlight: existingLine.highlight || "",
          sfx: existingLine.sfx || "",
          pose,
          focusSide: focusSideForSubtitle(existingLine, pose),
          poseLocked: Boolean(existingLine.poseLocked),
          focusSideLocked: Boolean(existingLine.focusSideLocked),
          start: cue.start,
          duration: cue.duration,
          dirtyVoice: false,
        };
      });
      durations = Object.fromEntries(config.lines.map((line) => [line.id, line.duration]));
      config.subtitleSource = "srt";
    } else {
      const totalGap = existingLines.slice(0, -1).reduce((sum, _line, index) => sum + lineGapAfterSeconds(index), 0);
      perLine = Math.max(1.15, (duration - 2.05 - totalGap) / existingLines.length);
      durations = Object.fromEntries(existingLines.map((line) => [line.id, Number(perLine.toFixed(3))]));
      config.subtitleSource = "script";
    }

    config.audioDuration = Number(duration.toFixed(3));
    config.audio = {
      ...(config.audio || {}),
      provider: "uploaded",
      mainAudio: "assets/vo/full.mp3",
      srt: subtitleFile?.path ? "assets/vo/audio.srt" : config.audio?.srt || "",
    };
    if (subtitleFile?.path) {
      fs.copyFileSync(subtitleFile.path, path.join(voDir, "audio.srt"));
    }
    const normalizedConfig = clearDirty(markDirty(normalizeProjectConfig(config, slug), ["render"]), ["content", "audio"]);
    fs.writeFileSync(configPath, `${JSON.stringify(normalizedConfig, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(voDir, "durations.json"), `${JSON.stringify(durations, null, 2)}\n`, "utf8");
    const audioManifest = writeAudioManifest(root, normalizedConfig, {
      kind: "full-upload",
      provider: "uploaded",
      mainAudio: "assets/vo/full.mp3",
      srt: normalizedConfig.audio?.srt || "",
      durations,
      outputs: [],
      source: "upload-full-audio",
    });
    syncProjectState(root, normalizedConfig, { audioManifest });

    rebuildVideo(slug);
    return { slug, path: fullAudioPath, duration, perLine, subtitles: normalizedConfig.lines.length, config: normalizedConfig };
  } finally {
    fs.rmSync(file.path, { force: true });
    if (subtitleFile?.path) fs.rmSync(subtitleFile.path, { force: true });
  }
}

export async function uploadFullAudio(options = {}) {
  return withProjectLock(options.slug, "upload full audio", () => uploadFullAudioUnlocked(options));
}
