import path from "node:path";
import { checkVideoWithRemotion, renderVideoWithRemotion } from "../studio/backend/services/remotionRenderer.mjs";

const args = process.argv.slice(2);
const slug = args.find((value) => value !== "--check") || path.basename(path.resolve(process.cwd()));
const checkOnly = process.argv.includes("--check");

if (!slug) {
  console.error("Usage: npm.cmd run remotion:render-video -- <slug>");
  process.exit(1);
}

const runner = checkOnly ? checkVideoWithRemotion : renderVideoWithRemotion;
runner(slug, (chunk) => process.stdout.write(String(chunk))).catch((error) => {
  console.error(error);
  process.exit(1);
});
