import {execFileSync} from "node:child_process";
import {cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync} from "node:fs";
import {basename, dirname, join, resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {parseSrt} from "@remotion/captions";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const capcutRoot = "D:/CapCut/User Data/Projects/com.lveditor.draft";
const templateName = "24-7-2";
const projectBaseName = "MatTroi-MatTrang-CapCut";
const ffmpeg = resolve(repoRoot, "tools/ffmpeg/bin/ffmpeg.exe");
const ffprobe = resolve(repoRoot, "tools/ffmpeg/bin/ffprobe.exe");

const input = {
  srt: "C:/Users/adminMoi/Downloads/MặtTrờit_20260726061244_/audio.srt",
  audio: "C:/Users/adminMoi/Downloads/MặtTrờit_20260726061244_/audio.mp3",
  backgroundComposite: resolve(repoRoot, "videos/mat-troi-vs-mat-trang-test/assets/capcut-bg-mat-troi-mat-trang.png"),
  poseLeft: "C:/Users/adminMoi/Downloads/tài nguyên/trái.mov",
  poseRight: "C:/Users/adminMoi/Downloads/tài nguyên/phải.mov",
  poseQuestion: "C:/Users/adminMoi/Downloads/tài nguyên/hỏi.mov",
};

const templateDir = join(capcutRoot, templateName);
if (!existsSync(templateDir)) {
  throw new Error(`Missing CapCut template project: ${templateDir}`);
}

for (const [key, value] of Object.entries(input)) {
  if (!existsSync(value)) throw new Error(`Missing input ${key}: ${value}`);
}

const newName = uniqueProjectName(capcutRoot, projectBaseName);
const targetDir = join(capcutRoot, newName);
cpSync(templateDir, targetDir, {
  recursive: true,
  force: false,
  filter: (source) => !source.includes("_cdc_backups"),
});

const now = microNow();
const newDraftId = id();
const newTimelineId = id();
const audioInfo = mediaInfo(input.audio);
const bgInfo = mediaInfo(input.backgroundComposite);
const leftInfo = mediaInfo(input.poseLeft);
const rightInfo = mediaInfo(input.poseRight);
const questionInfo = mediaInfo(input.poseQuestion);
const captions = parseCaptions(input.srt, Math.round(audioInfo.duration * 1_000_000));
const durationUs = Math.max(Math.round(audioInfo.duration * 1_000_000), captions.at(-1)?.endUs ?? 0);

const draftPath = join(targetDir, "draft_content.json");
const draft = JSON.parse(readFileSync(draftPath, "utf8"));
draft.id = newTimelineId;
draft.name = newName;
draft.duration = durationUs;
draft.create_time = now;
draft.update_time = now;
draft.path = norm(targetDir);
draft.canvas_config = {ratio: "original", width: 1080, height: 1920, background: null};

rewriteTimeline(draft);
writeDraftCopies(targetDir, draft);
rewriteMetadata(targetDir, newName, newDraftId, durationUs, now);
rewriteRootMeta(capcutRoot, templateName, targetDir, newName, newDraftId, durationUs, now);
writeCover(targetDir);

console.log(JSON.stringify({
  project: newName,
  folder: targetDir,
  durationUs,
  captions: captions.length,
  poseMap: captions.map((caption) => `${caption.index}:${caption.pose}`).join(" "),
}, null, 2));

function rewriteTimeline(draft) {
  const materials = draft.materials ?? {};
  draft.materials = materials;
  const originalTextTemplates = materials.text_templates ?? [];
  const subtitleTemplate = clone(originalTextTemplates[0]);
  if (!subtitleTemplate) throw new Error("Template project has no subtitle text_template material.");
  const subtitleInnerTextIds = new Set(
    originalTextTemplates.flatMap((tpl) => (tpl.text_info_resources ?? []).map((item) => item.text_material_id).filter(Boolean)),
  );

  const textTemplateSegment = clone(draft.tracks.find((track) => track.type === "text" && (track.segments ?? []).some((seg) => originalTextTemplates.some((tpl) => tpl.id === seg.material_id)))?.segments?.[0]);
  if (!textTemplateSegment) throw new Error("Template project has no subtitle segment.");
  const subtitleInnerTemplate = clone((materials.texts ?? []).find((text) => subtitleInnerTextIds.has(text.id)));
  if (!subtitleInnerTemplate) throw new Error("Template project has no subtitle inner text material.");

  const backgroundMat = makeVideoMaterial((materials.videos ?? [])[0], input.backgroundComposite, bgInfo, "photo", durationUs);
  const poseMaterials = {
    left: makeVideoMaterial((materials.videos ?? [])[3] ?? (materials.videos ?? [])[0], input.poseLeft, leftInfo, "video", Math.round(leftInfo.duration * 1_000_000)),
    right: makeVideoMaterial((materials.videos ?? [])[4] ?? (materials.videos ?? [])[0], input.poseRight, rightInfo, "video", Math.round(rightInfo.duration * 1_000_000)),
    question: makeVideoMaterial((materials.videos ?? [])[5] ?? (materials.videos ?? [])[0], input.poseQuestion, questionInfo, "video", Math.round(questionInfo.duration * 1_000_000)),
  };

  materials.videos = [backgroundMat, poseMaterials.left, poseMaterials.right, poseMaterials.question];
  materials.canvases = [];
  materials.speeds = [];
  materials.sound_channel_mappings = [];
  materials.vocal_separations = [];
  materials.material_colors = [];
  materials.placeholder_infos = [];
  materials.material_animations = [];
  materials.video_effects = [];
  materials.transitions = [];

  const audioMat = makeAudioMaterial((materials.audios ?? [])[0] ?? {}, input.audio, audioInfo, durationUs);
  materials.audios = [audioMat];
  materials.beats = [];
  materials.audio_fades = [];
  materials.loudnesses = [];

  materials.text_templates = [];
  materials.texts = (materials.texts ?? []).filter((text) => !subtitleInnerTextIds.has(text.id));

  const newSubtitleTrack = makeSubtitleTrack(draft, textTemplateSegment, subtitleTemplate, subtitleInnerTemplate, materials);
  const newTracks = [];
  newTracks.push(makeBackgroundTrack(draft, backgroundMat));
  newTracks.push(makePoseTrack(draft, poseMaterials));
  newTracks.push(newSubtitleTrack);

  const leftTitle = cloneTitleTrack(draft.tracks[3], "MẶT TRỜI", durationUs);
  const rightTitle = cloneTitleTrack(draft.tracks[4], "MẶT TRĂNG", durationUs);
  const watermark = cloneTitleTrack(draft.tracks[5], "MÂYDEE", durationUs);
  newTracks.push(leftTitle, rightTitle, watermark);
  newTracks.push(makeAudioTrack(draft, audioMat));
  draft.tracks = newTracks;
}

function makeBackgroundTrack(draft, material) {
  const source = draft.tracks[0];
  const segment = clone(source.segments[0]);
  segment.id = id();
  segment.material_id = material.id;
  segment.source_timerange = {start: 0, duration: durationUs};
  segment.target_timerange = {start: 0, duration: durationUs};
  segment.render_timerange = {start: 0, duration: 0};
  segment.extra_material_refs = [];
  segment.keyframe_refs = [];
  segment.common_keyframes = [];
  segment.render_index = 0;
  segment.track_render_index = 0;
  segment.clip = {...(segment.clip ?? {}), scale: {x: 1, y: 1}, transform: {x: 0, y: 0}, alpha: 1};
  return {...clone(source), id: id(), type: "video", segments: [segment], flag: 0, attribute: 0};
}

function makePoseTrack(draft, poseMaterials) {
  const source = draft.tracks[1];
  const template = clone(source.segments[0]);
  const segments = captions.map((caption, index) => {
    const mat = poseMaterials[caption.pose];
    const endUs = index === captions.length - 1 ? durationUs : caption.endUs;
    const segment = clone(template);
    segment.id = id();
    segment.material_id = mat.id;
    segment.source_timerange = {start: 0, duration: Math.max(100_000, endUs - caption.startUs)};
    segment.target_timerange = {start: caption.startUs, duration: Math.max(100_000, endUs - caption.startUs)};
    segment.render_timerange = {start: 0, duration: 0};
    segment.extra_material_refs = [];
    segment.keyframe_refs = [];
    segment.common_keyframes = [];
    segment.render_index = index + 1;
    segment.track_render_index = 1;
    segment.clip = {...(segment.clip ?? {}), scale: {x: 1, y: 1}, transform: {x: 0, y: 0}, alpha: 1};
    return segment;
  });
  return {...clone(source), id: id(), type: "video", segments, flag: 0, attribute: 0};
}

function makeSubtitleTrack(draft, segmentTemplate, templateMaterial, textMaterialTemplate, materials) {
  const segments = captions.map((caption, index) => {
    const innerText = clone(textMaterialTemplate);
    innerText.id = id();
    setText(innerText, caption.text, 12, caption.durationUs);
    innerText.recognize_text = caption.text;
    innerText.name = id();
    materials.texts.push(innerText);

    const tpl = clone(templateMaterial);
    tpl.id = id();
    tpl.origin_word_info = {text: caption.text, start_time: 0, end_time: Math.round(caption.durationUs / 1000), words: [], keyword_ranges: []};
    tpl.current_word_info = clone(tpl.origin_word_info);
    tpl.preview_time = 0.1;
    tpl.text_info_resources = [{
      ...(tpl.text_info_resources?.[0] ?? {}),
      id: id(),
      attach_info: {
        ...(tpl.text_info_resources?.[0]?.attach_info ?? {}),
        start_time: 0,
        duration: caption.durationUs,
        original_size_width: Math.min(760, Math.max(420, caption.text.length * 20)),
        original_size_height: caption.text.length > 28 ? 125 : 72,
      },
      text_material_id: innerText.id,
      extra_material_refs: [],
      lyric_keyframes: [],
      word_index: [],
    }];
    materials.text_templates.push(tpl);

    const segment = clone(segmentTemplate);
    segment.id = id();
    segment.material_id = tpl.id;
    segment.target_timerange = {start: caption.startUs, duration: caption.durationUs};
    segment.source_timerange = null;
    segment.extra_material_refs = [];
    segment.keyframe_refs = [];
    segment.common_keyframes = [];
    segment.render_index = 14000 + index;
    segment.track_render_index = 2;
    segment.clip = {...(segment.clip ?? {}), scale: {x: 0.78, y: 0.78}, transform: {x: 0, y: 0.10776710684273716}, alpha: 1};
    segment.uniform_scale = {on: true, value: 1};
    return segment;
  });
  return {id: id(), type: "text", name: "", flag: 0, attribute: 0, is_default_name: true, segments};
}

function cloneTitleTrack(track, text, duration) {
  const newTrack = clone(track);
  newTrack.id = id();
  const first = clone(track.segments[0]);
  first.id = id();
  first.target_timerange = {start: 0, duration};
  first.source_timerange = null;
  first.render_index = first.render_index ?? 14019;
  newTrack.segments = [first];
  const material = findTextMaterial(first.material_id);
  if (material) setText(material, text, material.font_size ?? 12, duration);
  return newTrack;
}

function makeAudioTrack(draft, material) {
  const source = draft.tracks.find((track) => track.type === "audio");
  const segment = clone(source.segments[0]);
  segment.id = id();
  segment.material_id = material.id;
  segment.source_timerange = {start: 0, duration: durationUs};
  segment.target_timerange = {start: 0, duration: durationUs};
  segment.render_timerange = {start: 0, duration: 0};
  segment.extra_material_refs = [];
  segment.keyframe_refs = [];
  segment.common_keyframes = [];
  segment.volume = 1;
  segment.last_nonzero_volume = 1;
  segment.track_render_index = 6;
  return {...clone(source), id: id(), type: "audio", segments: [segment], flag: 0, attribute: 0};
}

function findTextMaterial(materialId) {
  return draft.materials.texts.find((text) => text.id === materialId);
}

function makeVideoMaterial(template, path, info, type, duration) {
  const mat = clone(template ?? {});
  mat.id = id();
  mat.type = type;
  mat.path = norm(path);
  mat.duration = duration;
  mat.width = info.width || 1080;
  mat.height = info.height || 1920;
  mat.name = basename(path, /\.[^.]+$/.exec(path)?.[0] ?? "");
  mat.material_name = basename(path);
  mat.check_flag = mat.check_flag ?? 1;
  return mat;
}

function makeAudioMaterial(template, path, info, duration) {
  const mat = clone(template ?? {});
  mat.id = id();
  mat.type = mat.type || "extract_music";
  mat.path = norm(path);
  mat.duration = duration;
  mat.name = basename(path, /\.[^.]+$/.exec(path)?.[0] ?? "");
  mat.material_name = basename(path);
  mat.wave_points = [];
  return mat;
}

function setText(material, text, fontSize, durationUsForWords) {
  material.type = "text";
  material.recognize_text = text;
  material.font_path = "C:/Users/adminMoi/AppData/Local/Microsoft/Windows/Fonts/NVN-Cocogoose-Vintage.ttf";
  material.font_size = fontSize;
  material.text_size = Math.max(material.text_size ?? 30, Math.round(fontSize * 2.5));
  material.text_color = material.text_color || "#ffef00ff";
  const words = makeWords(text, durationUsForWords);
  material.words = words;
  material.current_words = {start_time: [], end_time: [], text: []};
  const content = safeJson(material.content, {text: "", styles: []});
  content.text = text;
  const baseStyle = content.styles?.[0] ?? {};
  baseStyle.font = {path: material.font_path, id: ""};
  baseStyle.size = fontSize;
  baseStyle.range = [0, text.length];
  content.styles = [baseStyle];
  material.content = JSON.stringify(content);
}

function makeWords(text, durationUsForWords) {
  const tokens = text.match(/\S+|\s+/g) ?? [text];
  let elapsed = 0;
  const totalMs = Math.max(1, Math.round(durationUsForWords / 1000));
  const weightTotal = tokens.reduce((sum, token) => sum + Math.max(1, token.trim().length || 1), 0);
  const start_time = [];
  const end_time = [];
  const outText = [];
  for (const token of tokens) {
    const weight = Math.max(1, token.trim().length || 1);
    const dur = Math.max(1, Math.round((totalMs * weight) / weightTotal));
    start_time.push(elapsed);
    elapsed = Math.min(totalMs, elapsed + dur);
    end_time.push(elapsed);
    outText.push(token);
  }
  if (end_time.length) end_time[end_time.length - 1] = totalMs;
  return {start_time, end_time, text: outText};
}

function parseCaptions(srtPath, audioDurationUs) {
  let previousSubjectPose = "question";
  const parsed = parseSrt({input: readFileSync(srtPath, "utf8")}).captions.map((caption, index) => {
    const raw = caption.text.replace(/\s+/g, " ").trim();
    const tag = raw.match(/^\[(L|R|Q)\]\s*/i)?.[1]?.toUpperCase() ?? null;
    const text = raw.replace(/^\[(L|R|Q)\]\s*/i, "").trim();
    const pose = tag ? tagToPose(tag) : inferPose(text, index, previousSubjectPose);
    if (pose === "left" || pose === "right") previousSubjectPose = pose;
    const startUs = Math.round(caption.startMs * 1000);
    const endUs = Math.round(caption.endMs * 1000);
    return {index: index + 1, startUs, endUs, durationUs: Math.max(100_000, endUs - startUs), text, pose};
  });
  if (parsed.length && parsed.at(-1).endUs < audioDurationUs) {
    parsed.at(-1).endUs = audioDurationUs;
    parsed.at(-1).durationUs = audioDurationUs - parsed.at(-1).startUs;
  }
  return parsed;
}

function tagToPose(tag) {
  if (tag === "L") return "left";
  if (tag === "R") return "right";
  return "question";
}

function inferPose(text, index, previousPose) {
  const lower = stripVietnamese(text).toLowerCase();
  const isQuestion = lower.includes("?") || lower.includes("tai sao") || index >= 9;
  if (isQuestion) return "question";
  if (lower.includes("mat trang") || lower.includes("trang")) return "right";
  if (lower.includes("mat troi") || lower.includes("troi")) return "left";
  return previousPose === "left" || previousPose === "right" ? previousPose : "question";
}

function stripVietnamese(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

function writeDraftCopies(target, data) {
  const names = ["draft_content.json", "template-2.tmp"];
  for (const name of names) writeFileSync(join(target, name), JSON.stringify(data), "utf8");
  const timelines = join(target, "Timelines");
  if (!existsSync(timelines)) return;
  for (const dir of readdirSync(timelines)) {
    const full = join(timelines, dir);
    if (!statSync(full).isDirectory()) continue;
    for (const name of names) {
      const path = join(full, name);
      if (existsSync(path)) writeFileSync(path, JSON.stringify(data), "utf8");
    }
  }
  const projectJsonPath = join(timelines, "project.json");
  if (existsSync(projectJsonPath)) {
    const project = JSON.parse(readFileSync(projectJsonPath, "utf8"));
    project.id = id();
    project.main_timeline_id = data.id;
    project.create_time = microNow();
    project.update_time = project.create_time;
    project.timelines = [{create_time: project.create_time, id: data.id, is_marked_delete: false, name: "Dòng thời gian 01", update_time: project.create_time}];
    writeFileSync(projectJsonPath, JSON.stringify(project), "utf8");
  }
}

function rewriteMetadata(target, name, draftId, duration, time) {
  const metaPath = join(target, "draft_meta_info.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  meta.draft_name = name;
  meta.draft_id = draftId;
  meta.draft_fold_path = norm(target);
  meta.draft_root_path = norm(capcutRoot);
  meta.draft_cover = "draft_cover.jpg";
  meta.tm_duration = duration;
  meta.tm_draft_create = time;
  meta.tm_draft_modified = time;
  meta.tm_draft_removed = 0;
  meta.draft_timeline_materials_size_ = materialSize();
  meta.draft_materials = [{
    type: 0,
    value: [
      materialMeta(input.audio, audioInfo, "music"),
      materialMeta(input.backgroundComposite, bgInfo, "photo"),
      materialMeta(input.poseLeft, leftInfo, "video"),
      materialMeta(input.poseRight, rightInfo, "video"),
      materialMeta(input.poseQuestion, questionInfo, "video"),
    ],
  }];
  writeFileSync(metaPath, JSON.stringify(meta), "utf8");
}

function rewriteRootMeta(rootPath, template, target, name, draftId, duration, time) {
  const rootMetaPath = join(rootPath, "root_meta_info.json");
  if (!existsSync(rootMetaPath)) return;
  const root = JSON.parse(readFileSync(rootMetaPath, "utf8"));
  const source = (root.all_draft_store ?? []).find((item) => (item.draft_fold_path ?? "").replace(/\\/g, "/").endsWith(`/${template}`)) ?? {};
  root.all_draft_store = (root.all_draft_store ?? []).filter((item) => item.draft_fold_path !== norm(target) && item.draft_name !== name);
  root.all_draft_store.unshift({
    ...source,
    draft_name: name,
    draft_id: draftId,
    draft_fold_path: norm(target),
    draft_json_file: norm(join(target, "draft_content.json")),
    draft_root_path: norm(rootPath),
    draft_cover: norm(join(target, "draft_cover.jpg")),
    tm_duration: duration,
    tm_draft_create: time,
    tm_draft_modified: time,
    tm_draft_removed: 0,
    draft_timeline_materials_size: materialSize(),
    streaming_edit_draft_ready: true,
  });
  root.draft_ids = root.all_draft_store.length;
  root.root_path = norm(rootPath);
  writeFileSync(rootMetaPath, JSON.stringify(root), "utf8");
}

function writeCover(target) {
  try {
    execFileSync(ffmpeg, ["-y", "-i", input.backgroundComposite, "-frames:v", "1", join(target, "draft_cover.jpg")], {stdio: "ignore"});
  } catch {
    cpSync(join(templateDir, "draft_cover.jpg"), join(target, "draft_cover.jpg"), {force: true});
  }
}

function mediaInfo(path) {
  const raw = execFileSync(ffprobe, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height:format=duration",
    "-of", "json",
    path,
  ], {encoding: "utf8"});
  const parsed = JSON.parse(raw);
  return {
    width: parsed.streams?.[0]?.width ?? 0,
    height: parsed.streams?.[0]?.height ?? 0,
    duration: Number(parsed.format?.duration || 0),
  };
}

function materialMeta(path, info, metetype) {
  return {
    ai_group_type: "",
    create_time: Math.floor(Date.now() / 1000),
    duration: Math.round((info.duration || 5) * 1_000_000),
    enter_from: 0,
    extra_info: basename(path),
    file_Path: norm(path),
    height: info.height || 0,
    id: randomUUID(),
    import_time: Math.floor(Date.now() / 1000),
    import_time_ms: microNow(),
    item_source: 1,
    material_color_tag: "",
    md5: "",
    metetype,
    roughcut_time_range: {duration: Math.round((info.duration || 5) * 1_000_000), start: 0},
    sub_time_range: {duration: -1, start: -1},
    type: 0,
    width: info.width || 0,
  };
}

function materialSize() {
  return Object.values(input).reduce((sum, path) => {
    try { return sum + statSync(path).size; } catch { return sum; }
  }, 0);
}

function uniqueProjectName(root, base) {
  let name = base;
  let index = 1;
  while (existsSync(join(root, name))) {
    index += 1;
    name = `${base}-${index}`;
  }
  return name;
}

function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return clone(fallback); }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function id() {
  return randomUUID().toUpperCase();
}

function microNow() {
  return Date.now() * 1000;
}

function norm(path) {
  return path.replace(/\\/g, "/");
}
