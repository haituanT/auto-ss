# Auto Compare Video Studio — project instructions

This repository is a local React/Remotion video studio. The active application, preview, checks, and MP4 renderer are implemented with Remotion.

## Runtime layout

- `app/` — Electron desktop launcher.
- `studio/` — local Studio backend and frontend.
- `remotion/` — Remotion composition and player entry points.
- `videos/<slug>/` — one project per video; each project stores `video.json`, `project-state.json`, media assets, and its own small scripts.
- `shared/` and `shared-assets/` — reusable runtime helpers, fonts, sound effects, and processed character assets.

## Common commands

From the repository root on Windows:

```powershell
setup.bat
start-studio.bat
npm.cmd run studio
npm.cmd test
```

From a video project directory:

```powershell
npm.cmd run check
npm.cmd run render
```

The video project scripts call `scripts/remotion-render-video.mjs`, which uses the Remotion renderer and the bundled Remotion media tools.

## Safety rules

- Never commit `.env`, API keys, `node_modules/`, generated jobs, renders, snapshots, temporary files, or local uploads.
- Keep API credentials in the local root `.env`; use `.env.example` only as a blank template.
- Keep the committed demo small and reproducible. New local video projects remain ignored unless explicitly selected for sharing.
- Preserve the existing project state and assets unless the user explicitly requests a content change.

## Verification

After changing the renderer or project state, run the relevant project `npm.cmd run check`. For a production-style validation, run `npm.cmd run render` and verify the generated MP4 has video and audio streams.
