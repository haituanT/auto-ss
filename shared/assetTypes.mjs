export function stripAssetUrlSuffix(value = "") {
  return String(value || "").split(/[?#]/, 1)[0];
}

export function isImageAsset(value = "") {
  return /\.(png|jpe?g|jpe|jfif|webp)$/i.test(stripAssetUrlSuffix(value));
}
