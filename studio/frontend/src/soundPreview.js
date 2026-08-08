const LEGACY_SFX_RENAMES = {
  "pop-left.mp3": "mixkit-hard-pop-click.wav",
  "pop-right.mp3": "mixkit-hard-pop-click.wav",
  "question-pop.mp3": "mixkit-bubble-pop.wav",
  "click-light.mp3": "mixkit-hard-pop-click.wav",
  "click-confirm.mp3": "win-1.wav",
  "whoosh-short.mp3": "mixkit-explainer-pop-whoosh.wav",
  "question-rise.mp3": "mixkit-bubble-pop.wav",
  "chime-soft.mp3": "win-1.wav",
  "transition-pop.mp3": "popular-riser-metallic-sound-effect.wav",
};

function migrateSfxName(name) {
  if (!name || name === "__none__") return name || "";
  return LEGACY_SFX_RENAMES[name] || name;
}

function finiteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const POSES = ["point-left", "point-right", "question"];

function resolvePoseVolumeMap(value = {}, fallbackVolume = 0.82) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(POSES.map((pose) => [
    pose,
    clamp(finiteNumber(source[pose], fallbackVolume), 0, 1.5),
  ]));
}

function lineTiming(line = {}) {
  const startMs = Math.max(0, Math.round(finiteNumber(
    line.startMs,
    finiteNumber(line.start, 0) * 1000,
  )));
  const durationMs = Math.max(300, Math.round(finiteNumber(
    line.durationMs,
    finiteNumber(line.duration, 2.2) * 1000,
  )));
  return { startMs, durationMs, endMs: startMs + durationMs };
}

function existingClipForLine(existingClips, lineId, name) {
  return existingClips.find((clip) => clip?.lineId === lineId && migrateSfxName(clip?.name) === name)
    || existingClips.find((clip) => clip?.lineId === lineId);
}

function existingClipForSound(existingClips, name) {
  return existingClips.find((clip) => migrateSfxName(clip?.name) === name) || null;
}

export function resolveLineSound(line = {}, poseSfx = {}, sounds = [], existingClips = []) {
  const rawName = poseSfx?.[line.pose] || "";
  const name = migrateSfxName(rawName);
  if (!name || name === "__none__") return null;

  const sound = sounds.find((item) => item?.name === name);
  const existing = existingClipForLine(existingClips, line.id, name);
  const directUrl = /^(?:https?:)?\/\//i.test(name) || String(name).startsWith("/") || String(name).startsWith("data:")
    ? name
    : "";
  const src = sound?.url || existing?.src || directUrl;
  if (!src) return null;

  return {
    name,
    src,
    label: sound?.label || name,
  };
}

function resolveSceneStartSettings(sceneStartSfx = {}) {
  const source = typeof sceneStartSfx === "string" ? { name: sceneStartSfx } : (sceneStartSfx || {});
  if (source.enabled === false) return null;
  const volume = clamp(finiteNumber(source.volume, 0.82), 0, 1.5);
  return {
    enabled: source.enabled !== false,
    skipFirst: source.skipFirst !== false,
    offsetMs: clamp(Math.round(finiteNumber(source.offsetMs, 0)), 0, 3000),
    volume,
    poseVolumes: resolvePoseVolumeMap(source.poseVolumes, volume),
  };
}

function resolvePoseSceneStartSfx(line = {}, poseSfx = {}, sounds = [], existingClips = []) {
  const name = migrateSfxName(poseSfx?.[line.pose] || "");
  if (!name || name === "__none__") return null;

  const sound = sounds.find((item) => item?.name === name);
  const existing = existingClipForLine(existingClips, line.id, name) || existingClipForSound(existingClips, name);
  const directUrl = /^(?:https?:)?\/\//i.test(name) || String(name).startsWith("/") || String(name).startsWith("data:")
    ? name
    : "";
  const src = sound?.url || existing?.src || directUrl;
  if (!src) return null;

  return {
    name,
    src,
  };
}

export function buildSceneStartSfxClips(props = {}, config = {}, sounds = []) {
  const canonicalLines = Array.isArray(props.lines) ? props.lines : [];
  const existingClips = Array.isArray(props.assets?.sfxClips) ? props.assets.sfxClips : [];
  const sceneStartSettings = resolveSceneStartSettings(config?.audio?.sceneStartSfx);
  if (!sceneStartSettings || !canonicalLines.length) return [];

  return canonicalLines.flatMap((line, index) => {
    if (sceneStartSettings.skipFirst && index === 0) return [];
    const poseSound = resolvePoseSceneStartSfx(line, config?.poseSfx || {}, sounds, existingClips);
    if (!poseSound) return [];
    const timing = lineTiming(line);
    const offsetMs = clamp(
      Math.round(sceneStartSettings.offsetMs),
      0,
      Math.max(0, timing.durationMs - 80),
    );
    const durationMs = Math.min(1400, Math.max(80, timing.durationMs - offsetMs));
    const volume = sceneStartSettings.poseVolumes?.[line.pose] ?? sceneStartSettings.volume;

    return [{
      lineId: line.id || `line-${index + 1}`,
      name: poseSound.name,
      src: poseSound.src,
      startMs: timing.startMs + offsetMs,
      durationMs,
      volume,
      sfxOffsetMs: offsetMs,
      sfxVolume: volume,
    }];
  });
}

export function buildLiveSfxClips(props = {}, config = {}, sounds = []) {
  return buildSceneStartSfxClips(props, config, sounds);
}

export function applyLiveSoundToPreviewProps(props = {}, config = {}, sounds = []) {
  if (!props || !config) return props;
  return {
    ...props,
    assets: {
      ...(props.assets || {}),
      sfxClips: buildSceneStartSfxClips(props, config, sounds),
    },
  };
}

function estimatedDraftDurationMs(line = {}) {
  const text = String(line?.text || line?.caption || line?.tts || "").trim();
  const letters = [...text.replace(/[^\p{L}\p{N}]+/gu, "")].length;
  const words = text.split(/\s+/).filter(Boolean).length;
  const byLetters = letters * 78;
  const byWords = words * 280;
  return Math.max(1500, Math.min(14000, Math.round(Math.max(byLetters, byWords) + 450)));
}

function clipOverlappingLine(clip, lineWindow) {
  const startMs = Math.max(0, Math.round(Number(clip?.startMs) || 0));
  const durationMs = Math.max(1, Math.round(Number(clip?.durationMs) || lineWindow.durationMs));
  const endMs = startMs + durationMs;
  const overlapStart = Math.max(startMs, lineWindow.startMs);
  const overlapEnd = Math.min(endMs, lineWindow.endMs);
  if (overlapEnd <= overlapStart) return null;

  return {
    ...clip,
    startMs: Math.max(0, overlapStart - lineWindow.startMs),
    durationMs: Math.max(1, overlapEnd - overlapStart),
    trimBeforeMs: Math.max(0, Math.round(Number(clip?.trimBeforeMs) || 0) + overlapStart - startMs),
  };
}

export function buildLineScopedPreviewProps(props = {}, currentIndex = 0, { prerollMs = 120 } = {}) {
  if (!props?.lines?.length) return props;
  const voiceReady = props.voiceReady !== false;
  const index = Math.max(0, Math.min(currentIndex, props.lines.length - 1));
  const sourceLine = props.lines[index];
  const lineWindow = lineTiming(sourceLine);
  const durationMs = Math.max(700, voiceReady ? lineWindow.durationMs : estimatedDraftDurationMs(sourceLine));
  const previewLine = {
    ...sourceLine,
    startMs: 0,
    durationMs: prerollMs + durationMs,
    endMs: prerollMs + durationMs,
  };
  const assets = props.assets || {};
  const withPreviewPreroll = (clip) => ({
    ...clip,
    startMs: Math.max(0, Math.round(Number(clip?.startMs) || 0)) + prerollMs,
  });
  const audioClips = !voiceReady
    ? []
    : assets.audio
    ? [{
      src: assets.audio,
      startMs: prerollMs,
      durationMs,
      volume: props.audioConfig?.voiceVolume,
      trimBeforeMs: lineWindow.startMs,
    }]
    : (assets.audioClips || []).map((clip) => clipOverlappingLine(clip, lineWindow)).filter(Boolean).map(withPreviewPreroll);

  return {
    ...props,
    previewMode: "line",
    previewLineId: previewLine.id,
    durationInSeconds: Number(((prerollMs + durationMs + 180) / 1000).toFixed(3)),
    srt: "",
    lines: [previewLine],
    assets: {
      ...assets,
      audio: "",
      audioClips,
      sfxClips: (assets.sfxClips || []).map((clip) => clipOverlappingLine(clip, lineWindow)).filter(Boolean).map(withPreviewPreroll),
      bgm: "",
    },
  };
}
