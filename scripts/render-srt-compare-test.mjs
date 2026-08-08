import {execFileSync} from "node:child_process";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {parseSrt} from "@remotion/captions";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ffmpeg = resolve(repoRoot, "tools/ffmpeg/bin/ffmpeg.exe");
const ffprobe = resolve(repoRoot, "tools/ffmpeg/bin/ffprobe.exe");

const outDir = resolve(repoRoot, "videos/mat-troi-vs-mat-trang-test");
const assetDir = resolve(outDir, "assets");
const buildDir = resolve(outDir, "build");
mkdirSync(buildDir, {recursive: true});

const input = {
  srt: "C:/Users/adminMoi/Downloads/MặtTrờit_20260726061244_/audio.srt",
  audio: "C:/Users/adminMoi/Downloads/MặtTrờit_20260726061244_/audio.mp3",
  background: "C:/Users/adminMoi/Downloads/tài nguyên/Thiết kế chưa có tên (3).png",
  poseLeft: "C:/Users/adminMoi/Downloads/tài nguyên/trái.mov",
  poseRight: "C:/Users/adminMoi/Downloads/tài nguyên/phải.mov",
  poseQuestion: "C:/Users/adminMoi/Downloads/tài nguyên/hỏi.mov",
  compareLeft: resolve(assetDir, "compare-left.png"),
  compareRight: resolve(assetDir, "compare-right.png"),
};

const output = resolve(outDir, "mat-troi-vs-mat-trang-test.mp4");
const snapshot = resolve(outDir, "snapshot-10s.png");
const assPath = resolve(buildDir, "captions.ass");
const poseMapPath = resolve(buildDir, "pose-map.json");

const srt = readFileSync(input.srt, "utf8");
let previousSubjectPose = "question";
const parsed = parseSrt({input: srt}).captions.map((caption, index) => {
  const raw = caption.text.replace(/\s+/g, " ").trim();
  const tag = raw.match(/^\[(L|R|Q)\]\s*/i)?.[1]?.toUpperCase() ?? null;
  const cleanText = raw.replace(/^\[(L|R|Q)\]\s*/i, "").trim();
  const pose = tag ? tagToPose(tag) : inferPose(cleanText, index, previousSubjectPose);
  if (pose === "left" || pose === "right") {
    previousSubjectPose = pose;
  }
  return {
    index: index + 1,
    start: caption.startMs / 1000,
    end: caption.endMs / 1000,
    text: cleanText,
    pose,
  };
});

const audioDuration = Number(execFileSync(ffprobe, [
  "-v", "error",
  "-show_entries", "format=duration",
  "-of", "default=nw=1:nk=1",
  input.audio,
], {encoding: "utf8"}).trim());

const duration = Math.max(audioDuration, parsed.at(-1)?.end ?? 0) + 0.15;
writeFileSync(poseMapPath, JSON.stringify({duration, captions: parsed}, null, 2), "utf8");
writeFileSync(assPath, makeAss(parsed), "utf8");

const leftEnable = enableExpression(parsed.filter((item) => item.pose === "left"));
const rightEnable = enableExpression(parsed.filter((item) => item.pose === "right"));
const questionEnable = enableExpression(parsed.filter((item) => item.pose === "question"));
const font = "C\\:/Windows/Fonts/arialbd.ttf";
const ass = ffmpegFilterPath(assPath);

const filter = [
  "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=rgba," +
    "drawbox=x=120:y=70:w=400:h=680:color=0x17122C@1:t=fill," +
    "drawbox=x=120:y=70:w=400:h=680:color=0x2B2350@1:t=6," +
    "drawbox=x=560:y=70:w=400:h=680:color=0x17122C@1:t=fill," +
    "drawbox=x=560:y=70:w=400:h=680:color=0x2B2350@1:t=6[base]",
  "[1:v]scale=400:560:force_original_aspect_ratio=increase,crop=400:560,format=rgba[leftimg]",
  "[2:v]scale=400:560:force_original_aspect_ratio=increase,crop=400:560,format=rgba[rightimg]",
  "[base][leftimg]overlay=120:70[tmp1]",
  "[tmp1][rightimg]overlay=560:70[tmp2]",
  `[tmp2]drawbox=x=485:y=350:w=110:h=80:color=0xFF4FA3@1:t=fill,` +
    `drawbox=x=485:y=350:w=110:h=80:color=0x2B2350@1:t=5,` +
    `drawtext=fontfile='${font}':text='VS':x=512:y=367:fontsize=42:fontcolor=0x111827:box=0,` +
    `drawtext=fontfile='${font}':text='MẶT TRỜI':x=120+(400-text_w)/2:y=655:fontsize=42:fontcolor=0x37E6C4,` +
    `drawtext=fontfile='${font}':text='MẶT TRĂNG':x=560+(400-text_w)/2:y=655:fontsize=42:fontcolor=0x37E6C4[cards]`,
  "[3:v]format=rgba[leftpose]",
  "[4:v]format=rgba[rightpose]",
  "[5:v]format=rgba[qpose]",
  `[cards][leftpose]overlay=0:150:eof_action=pass:enable='${leftEnable}'[vleft]`,
  `[vleft][rightpose]overlay=0:150:eof_action=pass:enable='${rightEnable}'[vright]`,
  `[vright][qpose]overlay=0:150:eof_action=pass:enable='${questionEnable}'[vpose]`,
  `[vpose]subtitles='${ass}':fontsdir='C\\:/Windows/Fonts'[vout]`,
].join(";");

execFileSync(ffmpeg, [
  "-y",
  "-loop", "1", "-t", String(duration), "-i", input.background,
  "-i", input.compareLeft,
  "-i", input.compareRight,
  "-stream_loop", "-1", "-i", input.poseLeft,
  "-stream_loop", "-1", "-i", input.poseRight,
  "-stream_loop", "-1", "-i", input.poseQuestion,
  "-i", input.audio,
  "-filter_complex", filter,
  "-map", "[vout]",
  "-map", "6:a:0",
  "-t", String(duration),
  "-r", "30",
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  "-preset", "veryfast",
  "-crf", "18",
  "-c:a", "aac",
  "-b:a", "192k",
  "-movflags", "+faststart",
  output,
], {stdio: "inherit"});

execFileSync(ffmpeg, [
  "-y",
  "-ss", "10",
  "-i", output,
  "-frames:v", "1",
  snapshot,
], {stdio: "inherit"});

console.log(JSON.stringify({output, snapshot, assPath, poseMapPath, duration}, null, 2));

function tagToPose(tag) {
  if (tag === "L") return "left";
  if (tag === "R") return "right";
  return "question";
}

function inferPose(text, index, previousPose) {
  const lower = text.toLowerCase();
  const isQuestion = lower.includes("?") || lower.includes("tại sao") || index >= 9;
  if (isQuestion) return "question";
  if (lower.includes("mặt trăng") || lower.includes("trăng")) return "right";
  if (lower.includes("mặt trời") || lower.includes("trời")) return "left";
  if (lower.startsWith("nó ") || lower.startsWith("bề mặt") || lower.startsWith("không có")) {
    return previousPose === "left" || previousPose === "right" ? previousPose : "question";
  }
  return previousPose === "left" || previousPose === "right" ? previousPose : "question";
}

function enableExpression(items) {
  if (items.length === 0) return "0";
  return items.map((item) => `between(t,${item.start.toFixed(3)},${item.end.toFixed(3)})`).join("+");
}

function ffmpegFilterPath(path) {
  return path.replace(/\\/g, "/").replace(":", "\\:").replace(/'/g, "\\'");
}

function makeAss(items) {
  const events = items.map((item) => {
    const text = wrapCaption(item.text).replace(/\n/g, "\\N").replace(/{/g, "\\{").replace(/}/g, "\\}");
    return `Dialogue: 0,${assTime(item.start)},${assTime(item.end)},Caption,,0,0,0,,{\\pos(540,900)\\fad(90,90)}${text}`;
  }).join("\n");

  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,54,&H00201835,&H000000FF,&H00FFFDF7,&H7AFFFDF7,-1,0,0,0,100,100,0,0,1,5,0,5,90,90,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`;
}

function assTime(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

function wrapCaption(text) {
  const max = 24;
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4).join("\n");
}
