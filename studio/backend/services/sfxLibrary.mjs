import fs from "node:fs";
import path from "node:path";
import { SHARED_ASSETS_DIR } from "../paths.mjs";

export const SFX_DIR = path.join(SHARED_ASSETS_DIR, "sfx");
export const SFX_CATALOG_PATH = path.join(SFX_DIR, "catalog.json");

const EDIT_SFX_CATEGORY = "Tiếng Động - SFX edit nhiều";
const CAPCUT_CACHE_CATEGORY = "CapCut cache";

const CATEGORY_ORDER = [
  "Pose & cử chỉ",
  "Câu hỏi",
  "Pop / click nhẹ",
  EDIT_SFX_CATEGORY,
  CAPCUT_CACHE_CATEGORY,
  "Meme & nhấn mạnh",
  "Tự tải lên",
];

const SFX_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg"]);

export const SFX_SOURCE_PRESETS = [
  {
    id: "custom",
    label: "Tự tải lên",
    category: "Tự tải lên",
    sourceUrl: "",
    license: "unverified",
    tags: ["custom", "upload"],
    description: "Sound tự nhập vào thư viện cục bộ.",
  },
  {
    id: "capcut-cache",
    label: CAPCUT_CACHE_CATEGORY,
    category: CAPCUT_CACHE_CATEGORY,
    sourceUrl: "",
    license: "unverified",
    tags: ["capcut", "cache", "imported"],
    description: "Sound đã nhập từ cache CapCut.",
  },
  {
    id: "tiengdong",
    label: "Tiếng Động",
    category: EDIT_SFX_CATEGORY,
    sourceUrl: "https://tiengdong.com/",
    license: "unverified",
    tags: ["tieng-dong", "edit", "sfx"],
    description: "Sound tải từ Tiếng Động và nhập vào app.",
  },
  {
    id: "kenney",
    label: "Kenney",
    category: "Pose & cử chỉ",
    sourceUrl: "https://kenney.nl/assets/category:Audio",
    license: "CC0",
    tags: ["kenney", "cc0", "click", "ui"],
    description: "Pack audio Kenney, hợp click và cue ngắn.",
  },
  {
    id: "mixkit",
    label: "Mixkit",
    category: "Pop / click nhẹ",
    sourceUrl: "https://mixkit.co/free-sound-effects/",
    license: "royalty-free",
    tags: ["mixkit", "pop", "whoosh"],
    description: "Sound effect Mixkit, hợp pop/whoosh ngắn.",
  },
  {
    id: "pixabay",
    label: "Pixabay",
    category: EDIT_SFX_CATEGORY,
    sourceUrl: "https://pixabay.com/sound-effects/",
    license: "pixabay-content-license",
    tags: ["pixabay", "edit", "sfx"],
    description: "Sound tải từ Pixabay rồi nhập thủ công.",
  },
  {
    id: "freesound-cc0",
    label: "Freesound CC0",
    category: EDIT_SFX_CATEGORY,
    sourceUrl: "https://freesound.org/",
    license: "CC0",
    tags: ["freesound", "cc0", "edit"],
    description: "Chỉ dùng các sound Freesound có license CC0.",
  },
  {
    id: "sonniss",
    label: "Sonniss GDC",
    category: EDIT_SFX_CATEGORY,
    sourceUrl: "https://sonniss.com/gameaudiogdc/",
    license: "royalty-free",
    tags: ["sonniss", "game", "edit"],
    description: "Pack GDC tải về rồi nhập thủ công.",
  },
  {
    id: "adobe",
    label: "Adobe Audition SFX",
    category: EDIT_SFX_CATEGORY,
    sourceUrl: "https://www.adobe.com/products/audition/offers/adobeauditiondlcsfx.html",
    license: "adobe-eula",
    tags: ["adobe", "sfx", "edit"],
    description: "Pack Adobe Audition SFX tải về rồi nhập thủ công.",
  },
  {
    id: "opengameart-cc0",
    label: "OpenGameArt CC0",
    category: EDIT_SFX_CATEGORY,
    sourceUrl: "https://opengameart.org/",
    license: "CC0",
    tags: ["opengameart", "cc0", "game"],
    description: "Chỉ nhập sound OpenGameArt có license CC0.",
  },
];

const BUILT_IN_SOUNDS = {
  "mixkit-hard-pop-click.wav": {
    label: "Pose · Pop click gọn",
    category: "Pose & cử chỉ",
    description: "Nhấn gọn cho chỉ trái/phải.",
    source: "Mixkit Pop",
    order: 10,
  },
  "mixkit-explainer-pop-whoosh.wav": {
    label: "Pose · Pop whoosh giải thích",
    category: "Pose & cử chỉ",
    description: "Đẩy nhẹ vào câu giải thích hoặc chuyển ý.",
    source: "Mixkit Pop/Whoosh",
    order: 20,
  },
  "mixkit-bubble-pop.wav": {
    label: "Pose · Bubble pop mềm",
    category: "Pose & cử chỉ",
    description: "Pop mềm cho câu ngắn hoặc câu hỏi nhẹ.",
    source: "Mixkit Pop",
    order: 30,
  },
  "chi-tay.wav": {
    label: "Chỉ tay (trái / phải)",
    category: "Pose & cử chỉ",
    description: "Nhấn mạnh động tác chỉ tay.",
    source: "FastScene cache",
    order: 40,
  },
  "mo-hai-tay.wav": {
    label: "Mở hai tay",
    category: "Pose & cử chỉ",
    description: "Mở ý hoặc kết luận ngắn.",
    source: "FastScene cache",
    order: 50,
  },
  "wrong-answer.wav": {
    label: "Wrong Answer",
    category: EDIT_SFX_CATEGORY,
    description: "Sai, đính chính hoặc câu hỏi gây chú ý.",
    source: "FastScene cache",
    order: 10,
  },
  "win-1.wav": {
    label: "Win / đúng",
    category: EDIT_SFX_CATEGORY,
    description: "Đúng, chốt ý hoặc điểm cộng.",
    source: "FastScene cache",
    order: 20,
  },
  "tieng-beep.wav": {
    label: "Alert sound",
    category: EDIT_SFX_CATEGORY,
    description: "Bíp cảnh báo hoặc che từ nhạy cảm.",
    source: "TiengDong / JVevermind",
    order: 30,
  },
  "popular-riser-metallic-sound-effect.wav": {
    label: "Build Up · Riser metallic",
    category: EDIT_SFX_CATEGORY,
    description: "Riser kim loại cho reveal hoặc đoạn cao trào.",
    source: "Myinstants / QuickSounds",
    order: 10,
  },
  "audio-glitch.wav": {
    label: "Audio Glitch",
    category: EDIT_SFX_CATEGORY,
    description: "Glitch ngắn cho lỗi, cắt cảnh hoặc chủ đề tech.",
    source: "FastScene cache",
    order: 20,
  },
  "wow.wav": {
    label: "Anime Wow Sound Effect",
    category: "Meme & nhấn mạnh",
    description: "Wow/ngạc nhiên, dùng tiết chế cho câu punchline.",
    source: "FastScene cache",
    order: 10,
  },
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readCatalog() {
  try {
    const value = JSON.parse(fs.readFileSync(SFX_CATALOG_PATH, "utf8").replace(/^\uFEFF/, ""));
    return { version: 1, sounds: {}, ...(value || {}), sounds: value?.sounds || {} };
  } catch {
    return { version: 1, sounds: {} };
  }
}

function writeCatalog(catalog) {
  ensureDir(SFX_DIR);
  fs.writeFileSync(SFX_CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

function safeName(value) {
  const parsed = path.parse(String(value || "sound.mp3"));
  const base = parsed.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || `sound-${Date.now()}`;
  const ext = [".mp3", ".wav", ".m4a", ".aac", ".ogg"].includes(parsed.ext.toLowerCase())
    ? parsed.ext.toLowerCase()
    : ".mp3";
  return `${base}${ext}`;
}

function uniqueSoundName(name) {
  const parsed = path.parse(name);
  let candidate = name;
  let index = 2;
  while (fs.existsSync(path.join(SFX_DIR, candidate))) {
    candidate = `${parsed.name}-${index}${parsed.ext}`;
    index += 1;
  }
  return candidate;
}

function displayNameFromFile(value) {
  return path.parse(String(value || "sound")).name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || "Sound";
}

function publicUrl(name) {
  return `/shared-assets/sfx/${String(name).split("/").map(encodeURIComponent).join("/")}`;
}

function normalizeCategory(category) {
  const value = String(category || "").trim();
  if (value === "Phản hồi nhanh" || value === "Chuyển cảnh & build-up" || value === "Tiếng Động - SFX edit") {
    return EDIT_SFX_CATEGORY;
  }
  return value || "Tự tải lên";
}

function categoryRank(category) {
  const index = CATEGORY_ORDER.indexOf(normalizeCategory(category));
  return index === -1 ? CATEGORY_ORDER.length : index;
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function parseTags(value) {
  if (Array.isArray(value)) return unique(value);
  return unique(String(value || "")
    .split(/[,;\n]+/)
    .map((tag) => tag.trim().replace(/^#+/, "")));
}

function foldText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function soundSourceGroup(name, meta = {}) {
  const folded = foldText(`${name} ${meta.source || ""} ${meta.category || ""} ${parseTags(meta.tags).join(" ")}`);
  if (String(name || "").startsWith("capcut-cache/") || folded.includes("capcut")) return CAPCUT_CACHE_CATEGORY;
  if (String(name || "").startsWith("kenney/") || folded.includes("kenney")) return "Kenney";
  if (String(name || "").startsWith("tiengdong/") || folded.includes("tiengdong") || folded.includes("tieng dong")) return "Tiếng Động";
  if (folded.includes("mixkit")) return "Mixkit";
  if (folded.includes("fastscene")) return "FastScene cache";
  if (folded.includes("local upload") || folded.includes("tu tai len") || folded.includes("custom")) return "Tự tải lên";
  return String(meta.source || meta.category || "Khác").trim() || "Khác";
}

function soundDetails(name, catalog) {
  const meta = { ...(BUILT_IN_SOUNDS[name] || {}), ...(catalog.sounds?.[name] || {}) };
  const sourceGroup = soundSourceGroup(name, meta);
  return {
    label: meta.label || path.parse(name).name.replace(/[-_]+/g, " "),
    category: normalizeCategory(sourceGroup === CAPCUT_CACHE_CATEGORY ? CAPCUT_CACHE_CATEGORY : (meta.category || "Tự tải lên")),
    description: meta.description || "Sound upload riêng của project.",
    source: meta.source || "Local upload",
    sourceGroup,
    sourceUrl: meta.sourceUrl || "",
    license: meta.license || "unverified",
    verified: meta.license === "CC0" || meta.license === "original",
    tags: parseTags(meta.tags),
    order: Number.isFinite(Number(meta.order)) ? Number(meta.order) : 999,
  };
}

function listSoundFiles(dir = SFX_DIR, prefix = "") {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSoundFiles(target, relative);
    return [relative];
  });
}

export function listSfx() {
  ensureDir(SFX_DIR);
  const catalog = readCatalog();
  return listSoundFiles()
    .filter((name) => [".mp3", ".wav", ".m4a", ".aac", ".ogg"].includes(path.extname(name).toLowerCase()))
    .map((name) => {
      const filePath = path.join(SFX_DIR, name);
      const stat = fs.statSync(filePath);
      return {
        name,
        path: filePath,
        url: publicUrl(name),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ...soundDetails(name, catalog),
      };
    })
    .sort((a, b) => (
      categoryRank(a.category) - categoryRank(b.category)
      || (a.order ?? 999) - (b.order ?? 999)
      || (a.label || a.name).localeCompare(b.label || b.name, "vi")
      || a.name.localeCompare(b.name)
    ));
}

export function listSfxSources() {
  return SFX_SOURCE_PRESETS.map((source) => ({
    ...source,
    category: normalizeCategory(source.category),
    tags: parseTags(source.tags),
  }));
}

export function uploadSfx(files = [], metadata = {}) {
  ensureDir(SFX_DIR);
  const catalog = readCatalog();
  const uploaded = [];
  const sourcePreset = SFX_SOURCE_PRESETS.find((source) => source.id === metadata.sourceId)
    || SFX_SOURCE_PRESETS.find((source) => source.label === metadata.source)
    || null;
  const category = normalizeCategory(metadata.category || sourcePreset?.category || "Tự tải lên");
  const source = String(metadata.source || sourcePreset?.label || "Local upload").trim();
  const sourceUrl = String(metadata.sourceUrl || sourcePreset?.sourceUrl || "").trim();
  const license = String(metadata.license || sourcePreset?.license || "unverified").trim();
  const requestedLabel = String(metadata.label || "").trim();
  const tags = unique([
    ...parseTags(sourcePreset?.tags),
    ...parseTags(metadata.tags),
  ]);
  const fileCount = files.filter((file) => file?.path).length;
  for (const file of files) {
    if (!file?.path) continue;
    const extension = path.extname(String(file.originalname || "")).toLowerCase();
    if (!SFX_EXTENSIONS.has(extension)) {
      throw new Error("SFX upload must be MP3, WAV, M4A, AAC or OGG.");
    }
    const name = uniqueSoundName(safeName(file.originalname));
    const target = path.join(SFX_DIR, name);
    const fileLabel = displayNameFromFile(file.originalname);
    const label = requestedLabel
      ? (fileCount === 1 ? requestedLabel : `${requestedLabel} - ${fileLabel}`)
      : fileLabel;
    fs.copyFileSync(file.path, target);
    fs.rmSync(file.path, { force: true });
    catalog.sounds[name] = {
      ...(catalog.sounds[name] || {}),
      label,
      category,
      description: metadata.description || sourcePreset?.description || "Sound nhập vào thư viện cục bộ.",
      source,
      sourceUrl,
      license,
      tags,
      order: 999,
    };
    uploaded.push({ name, path: target, url: publicUrl(name), label });
  }
  writeCatalog(catalog);
  return { uploaded, sounds: listSfx(), sources: listSfxSources() };
}
