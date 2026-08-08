import test from "node:test";
import assert from "node:assert/strict";
import { isImageAsset, stripAssetUrlSuffix } from "../../../shared/assetTypes.mjs";

test("image asset detection ignores cache-busting query strings", () => {
  assert.equal(isImageAsset("/videos-media/demo/assets/character/question.png?v=abc123"), true);
  assert.equal(isImageAsset("assets/character/point-left.webp#hash"), true);
  assert.equal(isImageAsset("assets/compare/compare-1-left.jfif?v=abc123"), true);
  assert.equal(isImageAsset("assets/character/preview/point-left.webm?v=abc123"), false);
  assert.equal(stripAssetUrlSuffix("assets/character/question.png?v=abc#ignored"), "assets/character/question.png");
});
