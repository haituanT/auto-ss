export const CAPTION_STYLE_IDS = [
  "vietnam-bold-highlight",
  "karaoke-pill",
  "clean-outline",
  "impact-pop",
  "soft-box",
  "neon-glow",
  "capcut-karaoke",
];

export const CAPTION_ANIMATION_IDS = [
  "word-pop",
  "line-pop",
  "word-color",
];

export const CAPTION_FONT_OPTIONS = [
  { id: "anton", label: "Anton", family: "Anton", file: "Anton-Regular.ttf", weight: 900 },
  { id: "archivo-black", label: "Archivo Black", family: "Archivo Black", file: "ArchivoBlack-Regular.ttf", weight: 900 },
  { id: "montserrat-black", label: "Montserrat ExtraBold", family: "Montserrat", file: "Montserrat-Black.ttf", weight: 900 },
  { id: "barlow-condensed-black", label: "Barlow Condensed Black", family: "Barlow Condensed", file: "BarlowCondensed-Black.ttf", weight: 900 },
  { id: "roboto-condensed-black", label: "Roboto Condensed Black", family: "Roboto Condensed", file: "RobotoCondensed-Black.ttf", weight: 900 },
  { id: "oswald-bold", label: "Oswald Bold", family: "Oswald", file: "Oswald-Bold.ttf", weight: 700 },
  { id: "be-vietnam-pro", label: "Be Vietnam Pro", family: "Be Vietnam Pro", file: "BeVietnamPro-Black.ttf", weight: 900 },
  { id: "manrope", label: "Manrope", family: "Manrope", file: "Manrope-Variable.ttf", weight: 900 },
  { id: "literata", label: "Literata", family: "Literata", file: "Literata-Variable.ttf", weight: 900 },
  { id: "nunito", label: "Nunito", family: "Nunito", file: "Nunito-Variable.ttf", weight: 900 },
  { id: "playfair-display", label: "Playfair Display", family: "Playfair Display", file: "PlayfairDisplay-Variable.ttf", weight: 900 },
  { id: "lexend", label: "Lexend", family: "Lexend", file: "Lexend-Variable.ttf", weight: 900 },
  { id: "quicksand", label: "Quicksand", family: "Quicksand", file: "Quicksand-Variable.ttf", weight: 900 },
  { id: "saira", label: "Saira", family: "Saira", file: "Saira-Variable.ttf", weight: 900 },
  { id: "roboto", label: "Roboto", family: "Roboto", file: "Roboto-Variable.ttf", weight: 900 },
  { id: "nata-sans-black", label: "Nata Sans Black", family: "Nata Sans", file: "NataSans-Black.ttf", weight: 900 },
  { id: "public-sans-black", label: "Public Sans Black", family: "Public Sans", file: "PublicSans-Black.ttf", weight: 900 },
  { id: "noto-sans-black", label: "Noto Sans Black", family: "Noto Sans", file: "NotoSans-Black.ttf", weight: 900 },
  { id: "baloo-2-extrabold", label: "Baloo 2 ExtraBold", family: "Baloo 2", file: "Baloo2-ExtraBold.ttf", weight: 800 },
  { id: "chakra-petch-bold", label: "Chakra Petch Bold", family: "Chakra Petch", file: "ChakraPetch-Bold.ttf", weight: 700 },
  { id: "bungee", label: "Bungee", family: "Bungee", file: "Bungee-Regular.ttf", weight: 900 },
  { id: "freeman", label: "Freeman", family: "Freeman", file: "Freeman-Regular.ttf", weight: 900 },
  { id: "bricolage-grotesque-extrabold", label: "Bricolage Grotesque ExtraBold", family: "Bricolage Grotesque", file: "BricolageGrotesque-ExtraBold.ttf", weight: 800 },
];

export const DEFAULT_CAPTION_FONT_FAMILY = "Be Vietnam Pro";
export const CAPCUT_DEFAULT_FONT_FAMILY = "Anton";

export function normalizeCaptionFontFamily(value) {
  const text = String(value || "").trim();
  const match = CAPTION_FONT_OPTIONS.find((font) => font.family === text || font.id === text || font.label === text);
  return match?.family || DEFAULT_CAPTION_FONT_FAMILY;
}

export function captionFontStack(value) {
  const family = normalizeCaptionFontFamily(value);
  return `"${family}", "Be Vietnam Pro", Arial, Helvetica, sans-serif`;
}
