import { spawn } from "node:child_process";
import process from "node:process";

const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";

function run(name, args) {
  const command = isWindows ? "cmd.exe" : npmCmd;
  const commandArgs = isWindows ? ["/d", "/s", "/c", npmCmd, ...args] : args;
  const child = spawn(command, commandArgs, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  child.on("exit", (code) => {
    if (code && !shuttingDown) {
      console.error(`${name} stopped with code ${code}`);
      stopAll();
    }
  });
  return child;
}

let shuttingDown = false;
const children = [
  run("backend", ["run", "studio:backend"]),
  run("frontend", ["run", "studio:frontend"]),
];

function stopAll() {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(0);
}

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
