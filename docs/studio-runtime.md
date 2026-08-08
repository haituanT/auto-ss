# Studio runtime notes

## Start

On Windows PowerShell, use `npm.cmd` when the PowerShell execution policy blocks `npm`:

```text
npm.cmd run studio
```

The backend listens on `127.0.0.1:3101` by default. The Vite development frontend listens on `localhost:5173`.

## Local API protection

The readiness endpoint `GET /api/status` stays public so launchers can detect that the backend is ready. Other API routes accept `X-Studio-Token` when `STUDIO_AUTH_TOKEN` is configured.

Set `STUDIO_AUTH_TOKEN` and `VITE_STUDIO_AUTH_TOKEN` to the same value for a manual Vite session. The production build also reads the values from the root `.env` file.

Keep `STUDIO_HOST=127.0.0.1` unless the Studio is intentionally placed behind a trusted network boundary.

## Files exposed to the browser

`/videos-media/<slug>/...` only serves known media extensions. Project JSON, job logs, scripts, and other metadata are not public media files.

Generated build output and local work files are ignored by Git: `studio/frontend/dist`, `tmp`, `temp`, project job folders, renders, and snapshots.

## AI image CLI

The provider validates every requested output with Sharp and rejects missing images or unexpected files. The local app defaults to unattended AI CLI execution and passes the permission bypass flag so headless image generation can save the requested PNG files. Set `AUTO_COMPARE_AI_CLI_ALLOW_DANGEROUS_PERMISSIONS=0` to disable that bypass.

## Verification

```text
npm.cmd test
npm.cmd run build:studio
```

For the full UI smoke test, start the Studio first and then run `npm.cmd run qa:studio-ui`.
