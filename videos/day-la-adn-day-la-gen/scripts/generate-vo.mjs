import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateVoiceoverForVideo } from "../../../scripts/voiceover-from-video-json.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

generateVoiceoverForVideo(ROOT).catch((err) => {
  console.error(err);
  process.exit(1);
});
