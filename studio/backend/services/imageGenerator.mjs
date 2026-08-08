import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { videoPath } from "../paths.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapText(value, max = 20) {
  const words = String(value || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > max && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function svgCard({ label, angle, side }) {
  const main = wrapText(label, 16);
  const sub = wrapText(angle, 26);
  const accent = side === "left" ? "#e8458f" : "#20c7a8";
  const badge = side === "left" ? "A" : "B";
  const mainText = main
    .map((line, index) => `<tspan x="540" dy="${index === 0 ? 0 : 86}">${escapeHtml(line)}</tspan>`)
    .join("");
  const subText = sub
    .map((line, index) => `<tspan x="540" dy="${index === 0 ? 0 : 40}">${escapeHtml(line)}</tspan>`)
    .join("");

  return `
<svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff8ea"/>
      <stop offset="0.55" stop-color="#f3efe5"/>
      <stop offset="1" stop-color="#e9e0cf"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#3a2b1f" flood-opacity="0.20"/>
    </filter>
  </defs>
  <rect width="1080" height="1080" fill="url(#bg)"/>
  <circle cx="176" cy="182" r="112" fill="${accent}" opacity="0.13"/>
  <circle cx="894" cy="896" r="180" fill="${accent}" opacity="0.10"/>
  <rect x="110" y="168" width="860" height="744" rx="44" fill="#ffffff" filter="url(#shadow)"/>
  <rect x="110" y="168" width="860" height="744" rx="44" fill="none" stroke="${accent}" stroke-width="10"/>
  <circle cx="540" cy="346" r="108" fill="${accent}"/>
  <text x="540" y="386" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="116" font-weight="800" fill="#ffffff">${badge}</text>
  <text x="540" y="610" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="76" font-weight="800" fill="#191919">${mainText}</text>
  <text x="540" y="780" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="600" fill="#686055">${subText}</text>
</svg>`;
}

async function writeCard(filePath, options) {
  await sharp(Buffer.from(svgCard(options)))
    .png()
    .toFile(filePath);
}

export async function generateCompareImages(slug) {
  const root = videoPath(slug);
  const configPath = path.join(root, "video.json");
  if (!fs.existsSync(configPath)) throw new Error(`Missing video.json for ${slug}`);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const assetsDir = path.join(root, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  await Promise.all([
    writeCard(path.join(assetsDir, "compare-left.png"), {
      label: config.leftLabel || "A",
      angle: config.angle || config.title || "",
      side: "left"
    }),
    writeCard(path.join(assetsDir, "compare-right.png"), {
      label: config.rightLabel || "B",
      angle: config.angle || config.title || "",
      side: "right"
    })
  ]);

  return {
    left: path.join(assetsDir, "compare-left.png"),
    right: path.join(assetsDir, "compare-right.png")
  };
}
