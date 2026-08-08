import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../paths.mjs";

function authTokenFromEnvFile() {
  const envPath = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(envPath)) return "";
  try {
    const line = fs.readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .find((item) => /^\s*STUDIO_AUTH_TOKEN=/.test(item));
    if (!line) return "";
    return line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
  } catch {
    return "";
  }
}

export function configuredAuthToken() {
  return String(process.env.STUDIO_AUTH_TOKEN || authTokenFromEnvFile()).trim();
}

function timingSafeTokenMatch(expected, supplied) {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(supplied, "utf8");
  if (expectedBuffer.length !== suppliedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function suppliedToken(req) {
  const direct = String(req.get("x-studio-token") || "").trim();
  if (direct) return direct;
  const authorization = String(req.get("authorization") || "").trim();
  return authorization.replace(/^Bearer\s+/i, "").trim();
}

export function createLocalAuthMiddleware({ token = configuredAuthToken() } = {}) {
  const expected = String(token || "").trim();

  return (req, res, next) => {
    // The status endpoint is intentionally public so launchers can wait for readiness.
    if (!expected || req.path === "/status") {
      next();
      return;
    }

    const supplied = suppliedToken(req);
    if (!supplied) {
      res.status(401).json({ error: "Studio API token is required." });
      return;
    }
    if (!timingSafeTokenMatch(expected, supplied)) {
      res.status(403).json({ error: "Studio API token is invalid." });
      return;
    }
    next();
  };
}

export function authConfigured(token = configuredAuthToken()) {
  return Boolean(String(token || "").trim());
}
