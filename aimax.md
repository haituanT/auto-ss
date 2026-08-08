# AIMAX Batch TTS

This repository owns its AIMAX integration. It does not import code, read
credentials, or use media binaries from another project.

## Configuration

Create a repo-root `.env` using `.env.example`. Runtime values from the shell
can override the file, but each video uses the same repo-local credentials.

```env
AIMAX_API_KEY=your_aimax_api_key
AIMAX_BASE_URL=https://aimaxstudio.com
AIMAX_TTS_PROVIDER=minimax
AIMAX_TTS_MODEL=speech-2.8-hd
AIMAX_TTS_SPEED=1.1
AIMAX_TTS_PITCH=0                 # -12 đến 12
AIMAX_VOICE_ID=your_cloned_voice_id
```

If `AIMAX_VOICE_ID` is blank, the script calls `GET /api/v1/voices/my` once
and uses the first voice returned by the account.

## One Request Per Video

`video.json` is the only narration source. `node scripts/generate-vo.mjs`
reads every `lines[]` item, joins the TTS text with newlines, and submits one
batch request:

```text
POST /api/v1/tts/generate
X-API-Key: <AIMAX_API_KEY>

enable_srt=true
split_by_line=true
match_srt_time=false
```

The script polls `GET /api/v1/tts/jobs/{job_id}` until AIMAX returns
`segments_url`. The downloaded ZIP must contain one numbered MP3 per input
line: `line_001.mp3`, `line_002.mp3`, and so on.

The repository validates that every expected file exists, then writes:

```text
assets/vo/line-1.mp3
assets/vo/line-2.mp3
...
assets/vo/durations.json
assets/vo/aimax-batch.json
```

The script fails instead of silently submitting separate requests for each line.
Existing audio is left untouched until the new batch has been downloaded and
validated successfully.

## Media Tools

The local default paths are `tools/ffmpeg/bin/ffmpeg` and
`tools/ffmpeg/bin/ffprobe`. Override the probe path with `FFPROBE_PATH` when
needed. No external project path is used.
