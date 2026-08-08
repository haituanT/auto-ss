import { trimExistingVoiceoverForVideo } from "./voiceover-from-video-json.mjs";

const root = process.cwd();

trimExistingVoiceoverForVideo(root)
  .then((result) => {
    console.log(`Done. Trimmed ${result.trimmedCount}/${result.lineCount} VO line(s).`);
    console.log(`Voice duration: ${result.beforeDuration.toFixed(3)}s -> ${result.afterDuration.toFixed(3)}s; saved ${result.savedSeconds.toFixed(3)}s.`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
