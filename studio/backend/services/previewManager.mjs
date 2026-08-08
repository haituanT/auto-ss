import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { FFMPEG_BIN, videoPath } from "../paths.mjs";

const previews = new Map();

function pathKey(env) {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
}

function previewPort(url) {
  try {
    const parsed = new URL(url);
    return Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  } catch {
    return 0;
  }
}

function isPreviewReachable(url) {
  const port = previewPort(url);
  if (!port) return Promise.resolve(false);

  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (reachable) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(750, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function resolvePreviewUrl(state) {
  if (!state.candidateUrl) return "";
  if (await isPreviewReachable(state.candidateUrl)) {
    state.url = state.candidateUrl;
    return state.url;
  }
  state.url = "";
  return "";
}

export async function previewStatus(slug) {
  const preview = previews.get(slug);
  if (!preview) return { running: false, url: "", pid: null, logs: [] };
  const url = await resolvePreviewUrl(preview);
  const running = Boolean(url)
    && preview.process.exitCode == null
    && preview.process.signalCode == null
    && !preview.process.killed;
  return {
    running,
    url,
    pid: preview.process.pid,
    logs: preview.logs.slice(-200),
  };
}

export async function startPreview(slug) {
  const current = previews.get(slug);
  if (current) {
    const status = await previewStatus(slug);
    if (status.running) return status;
    previews.delete(slug);
  }

  const env = { ...process.env };
  const key = pathKey(env);
  env[key] = `${FFMPEG_BIN}${path.delimiter}${env[key] || ""}`;
  const isWindows = process.platform === "win32";
  const command = isWindows ? "cmd.exe" : "npm";
  const args = isWindows
    ? ["/d", "/s", "/c", "npm.cmd", "run", "dev", "--", "--force-new"]
    : ["run", "dev", "--", "--force-new"];
  const child = spawn(command, args, {
    cwd: videoPath(slug),
    env,
    shell: false,
    windowsHide: true,
  });
  const state = { process: child, url: "", candidateUrl: "", logs: [] };
  previews.set(slug, state);

  const onData = (data) => {
    const text = String(data);
    state.logs.push(text);
    const match = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/?/);
    if (match) state.candidateUrl = match[0];
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("error", (error) => {
    state.logs.push(`Preview failed: ${error.message}`);
  });
  child.on("exit", () => {
    state.logs.push("Preview process stopped.");
  });

  return previewStatus(slug);
}

export function stopPreview(slug) {
  const state = previews.get(slug);
  if (state && !state.process.killed) {
    state.process.kill();
  }
  previews.delete(slug);
  return { running: false, url: "", pid: null, logs: [] };
}
