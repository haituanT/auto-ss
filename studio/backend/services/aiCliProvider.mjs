import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import sharp from "sharp";

const CLI_PROBE_TIMEOUT_MS = 15000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const AI_IMAGE_ASPECT_RATIO = "1:1";
export const AI_IMAGE_SIZE = 1536;
const PROVIDERS = new Set(["agy", "codex"]);
const resolvedCommands = new Map();
const availabilityCache = new Map();

function existingFile(filePath) {
  return Boolean(filePath && fs.existsSync(filePath));
}

function getWindowsWhereMatches(command) {
  if (process.platform !== "win32") return [];
  const result = spawnSync("where.exe", [command], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return [];
  return String(result.stdout || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function findWinGetPackageExe(packagePrefix, exeName) {
  if (process.platform !== "win32") return "";
  const localAppData = String(process.env.LOCALAPPDATA || "").trim();
  if (!localAppData) return "";
  const packagesDir = path.join(localAppData, "Microsoft", "WinGet", "Packages");
  try {
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(packagePrefix)) continue;
      const candidate = path.join(packagesDir, entry.name, exeName);
      if (existingFile(candidate)) return candidate;
    }
  } catch {
    // Optional Windows package cache.
  }
  return "";
}

function resolveCliCommand(command) {
  if (resolvedCommands.has(command)) return resolvedCommands.get(command);

  let resolved = null;
  if (process.platform === "win32") {
    const userProfile = String(process.env.USERPROFILE || process.env.HOME || "").trim();
    const localAppData = String(process.env.LOCALAPPDATA || "").trim();

    if (command === "agy") {
      const configuredPath = String(process.env.AUTO_COMPARE_AGY_CLI_PATH || "").trim();
      const candidates = [
        configuredPath,
        localAppData ? path.join(localAppData, "agy", "bin", "agy.exe") : "",
        findWinGetPackageExe("Google.AntigravityCLI_", "agy.exe"),
      ];
      const agyExe = candidates.find((item) => existingFile(item));
      if (agyExe) resolved = { command: agyExe, prefixArgs: [] };
    }

    if (command === "codex") {
      const configuredPath = String(process.env.AUTO_COMPARE_CODEX_CLI_PATH || process.env.DUBFLOW_CODEX_CLI_PATH || "").trim();
      const candidates = [
        configuredPath,
        userProfile ? path.join(userProfile, "AppData", "Roaming", "npm", "codex.cmd") : "",
        userProfile ? path.join(userProfile, ".codex", "packages", "standalone", "current", "bin", "codex.exe") : "",
        localAppData ? path.join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe") : "",
      ];
      const codexPath = candidates.find((item) => existingFile(item));
      if (codexPath) {
        resolved = /\.cmd$/i.test(codexPath)
          ? { command: "cmd.exe", prefixArgs: ["/d", "/s", "/c", "call", codexPath] }
          : { command: codexPath, prefixArgs: [] };
      }
    }

    if (!resolved) {
      const matches = getWindowsWhereMatches(command);
      const cmd = matches.find((item) => /\.cmd$/i.test(item) && existingFile(item));
      if (cmd) resolved = { command: "cmd.exe", prefixArgs: ["/d", "/s", "/c", "call", cmd] };
      const exe = matches.find((item) => /\.exe$/i.test(item) && existingFile(item));
      if (!resolved && exe) resolved = { command: exe, prefixArgs: [] };
    }
  }

  if (!resolved) resolved = { command, prefixArgs: [] };
  resolvedCommands.set(command, resolved);
  return resolved;
}

function providerCommand(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (normalized === "agy") return "agy";
  if (normalized === "codex") return "codex";
  throw new Error(`Unknown AI image provider: ${provider}`);
}

function aiCliPermissionsBypassEnabled() {
  const value = String(process.env.AUTO_COMPARE_AI_CLI_ALLOW_DANGEROUS_PERMISSIONS ?? "1").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(value);
}

function truncate(text, max = 700) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

const RASTER_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function expectedImagePaths(outputDir, images = []) {
  const root = path.resolve(outputDir);
  return images.map((image) => {
    const fileName = String(image?.fileName || "").trim();
    const target = path.resolve(root, fileName);
    if (!fileName || path.basename(fileName) !== fileName || !RASTER_EXTENSIONS.has(path.extname(fileName).toLowerCase()) || !isInside(root, target)) {
      throw new Error(`Invalid AI image output filename: ${fileName || "(empty)"}`);
    }
    return { fileName, target };
  });
}

function topLevelFiles(dir) {
  try {
    return new Set(fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name));
  } catch {
    return new Set();
  }
}

export async function validateGeneratedImageOutputs({ outputDir, images = [], previousFiles = [], rejectUnexpectedFiles = true } = {}) {
  const root = path.resolve(outputDir);
  const expected = expectedImagePaths(root, images);
  const expectedNames = new Set(expected.map((item) => item.fileName));
  const previous = previousFiles instanceof Set ? previousFiles : new Set(previousFiles);

  for (const item of expected) {
    if (!fs.existsSync(item.target) || !fs.statSync(item.target).isFile()) {
      throw new Error(`AI CLI did not create the requested image: ${item.fileName}`);
    }
    const metadata = await sharp(item.target).metadata();
    if (!metadata.width || !metadata.height || !RASTER_EXTENSIONS.has(`.${String(metadata.format || "").toLowerCase()}`)) {
      throw new Error(`AI CLI output is not a supported raster image: ${item.fileName}`);
    }
  }

  if (rejectUnexpectedFiles) {
    const unexpected = [...topLevelFiles(root)].filter((name) => !previous.has(name) && !expectedNames.has(name));
    if (unexpected.length) {
      throw new Error(`AI CLI created unexpected files: ${unexpected.join(", ")}`);
    }
  }

  return expected.map((item) => item.target);
}

function runProcess(commandSpec, args, {
  input = "",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cwd = process.cwd(),
  env = process.env,
  onOutput = () => {},
  onChild = () => {},
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandSpec.command, [...commandSpec.prefixArgs, ...args], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    onChild(child);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`AI CLI timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      onOutput(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      onOutput(text);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });

    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

async function probeCli(command) {
  if (availabilityCache.has(command)) return availabilityCache.get(command);
  const spec = resolveCliCommand(command);
  try {
    const result = await runProcess(spec, ["--version"], { timeoutMs: CLI_PROBE_TIMEOUT_MS });
    const available = result.code === 0;
    availabilityCache.set(command, available);
    return available;
  } catch {
    availabilityCache.set(command, false);
    return false;
  }
}

export async function getAiCliProviderStatus(provider) {
  const command = providerCommand(provider);
  const spec = resolveCliCommand(command);
  const available = await probeCli(command);
  let version = "";
  if (available) {
    try {
      const result = await runProcess(spec, ["--version"], { timeoutMs: CLI_PROBE_TIMEOUT_MS });
      version = truncate(result.stdout || result.stderr || "", 200);
    } catch {
      version = "";
    }
  }
  return {
    provider: command,
    commandPath: spec.prefixArgs.length ? spec.prefixArgs[spec.prefixArgs.length - 1] : spec.command,
    available,
    version,
  };
}

export function buildImageCliPrompt({ systemPrompt, stylePrompt, outputDir, images = [] } = {}) {
  expectedImagePaths(outputDir, images);
  const imageInstructions = images.map((item, index) => [
    `Image ${index + 1}:`,
    `- File: ${item.fileName}`,
    `- Absolute path: ${path.join(outputDir, item.fileName)}`,
    `- Slot: ${item.slotLabel}`,
    `- Content: ${item.content}`,
    `- Aspect ratio: ${AI_IMAGE_ASPECT_RATIO} (square)`,
    stylePrompt ? `- Style: ${stylePrompt}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");

  return [
    systemPrompt,
    stylePrompt ? `Style preset: ${stylePrompt}` : "",
    `Create exactly ${images.length} raster PNG image(s).`,
    `Every image must use a square ${AI_IMAGE_ASPECT_RATIO} canvas. Use ${AI_IMAGE_SIZE}x${AI_IMAGE_SIZE}px when an explicit size is required.`,
    "Save the files with the exact filenames and absolute paths below.",
    "Do not create HTML, SVG, markdown-only placeholders, or text-only answers.",
    "After saving, report the files created.",
    `Output directory: ${outputDir}`,
    imageInstructions,
  ].filter(Boolean).join("\n\n");
}

export async function generateImagesWithCli({
  provider = "agy",
  outputDir,
  images = [],
  systemPrompt = "",
  stylePrompt = "",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onOutput = () => {},
  onChild = () => {},
} = {}) {
  const command = providerCommand(provider);
  if (!PROVIDERS.has(command)) throw new Error(`Unknown AI image provider: ${provider}`);
  if (!outputDir) throw new Error("Missing AI image output directory.");
  if (!images.length) throw new Error("Missing AI image requests.");

  const expected = expectedImagePaths(outputDir, images);
  fs.mkdirSync(outputDir, { recursive: true });
  const previousFiles = topLevelFiles(outputDir);
  for (const item of expected) fs.rmSync(item.target, { force: true });
  if (!await probeCli(command)) throw new Error(`${command} CLI is not available on this machine.`);

  const prompt = buildImageCliPrompt({ systemPrompt, stylePrompt, outputDir, images });
  const spec = resolveCliCommand(command);
  const allowDangerousPermissions = aiCliPermissionsBypassEnabled();
  const args = command === "agy"
    ? [
      ...(allowDangerousPermissions ? ["--dangerously-skip-permissions"] : []),
      "--add-dir", outputDir,
      "--print-timeout", `${Math.ceil(timeoutMs / 60000)}m`,
      "--output-format", "text", "--print", prompt,
    ]
    : [
      "exec", "--skip-git-repo-check",
      ...(allowDangerousPermissions ? ["--dangerously-bypass-approvals-and-sandbox"] : []),
      "--add-dir", outputDir, "-",
    ];

  const result = await runProcess(spec, args, {
    input: command === "codex" ? prompt : "",
    timeoutMs,
    cwd: outputDir,
    env: {
      ...process.env,
      AGY_CLI_HIDE_ACCOUNT_INFO: process.env.AGY_CLI_HIDE_ACCOUNT_INFO || "true",
    },
    onOutput,
    onChild,
  });
  if (result.code !== 0) {
    throw new Error(`${command} CLI exited ${result.code}: ${truncate(result.stderr || result.stdout)}`);
  }
  await validateGeneratedImageOutputs({ outputDir, images, previousFiles, rejectUnexpectedFiles: false });
  return { provider: command, stdout: result.stdout, stderr: result.stderr };
}

export function normalizeAiProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return PROVIDERS.has(provider) ? provider : "agy";
}
