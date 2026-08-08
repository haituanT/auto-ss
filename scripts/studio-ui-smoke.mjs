import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "tmp", "ui-ux-final");
const FRONTEND_URL = process.env.STUDIO_UI_URL || "http://localhost:5173";
const BACKEND_URL = process.env.STUDIO_API_URL || "http://localhost:3101";
const NPM_CMD = process.platform === "win32" ? "npm.cmd" : "npm";
const startedChildren = [];
const failures = [];
const metrics = [];

const viewports = [
  [1920, 1080],
  [1440, 900],
  [1320, 820],
  [1024, 768],
  [768, 1024],
  [390, 844],
  [375, 812],
  [844, 390],
];

const tabs = [
  ["content", /Nội dung/],
  ["character", /Nhân vật/],
  ["audio", /Âm thanh/],
  ["caption", /Phụ đề/],
  ["render", /Render/],
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertCheck(name, pass, detail = "") {
  if (!pass) failures.push(detail ? `${name}: ${detail}` : name);
}

function urlPort(urlString) {
  const url = new URL(urlString);
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

function urlHost(urlString) {
  const url = new URL(urlString);
  return url.hostname || "127.0.0.1";
}

function isPortListening(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(800);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitForHttp(url, timeoutMs = 60000) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return response;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message;
    }
    await delay(600);
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? ` (${lastError})` : ""}`);
}

function startNpmProcess(label, args) {
  const logPath = path.join(OUT_DIR, `${label}.log`);
  const logFd = fs.openSync(logPath, "a");
  const command = process.platform === "win32" ? "cmd.exe" : NPM_CMD;
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", NPM_CMD, ...args] : args;
  const child = spawn(command, commandArgs, {
    cwd: ROOT,
    env: { ...process.env },
    shell: false,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  startedChildren.push({ label, child, logFd });
  return child;
}

function stopStartedProcesses() {
  for (const { child, logFd } of startedChildren.reverse()) {
    if (child?.pid && !child.killed) {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
    }
    try {
      fs.closeSync(logFd);
    } catch {
      // The fd may already be closed if the process exited early.
    }
  }
}

async function ensureServers() {
  await fsp.mkdir(OUT_DIR, { recursive: true });

  const backendHost = urlHost(BACKEND_URL);
  const backendPort = urlPort(BACKEND_URL);
  if (!(await isPortListening(backendHost, backendPort))) {
    startNpmProcess("backend", ["run", "studio:backend"]);
  }
  await waitForHttp(`${BACKEND_URL}/api/status`, 90000);

  const frontendHost = urlHost(FRONTEND_URL);
  const frontendPort = urlPort(FRONTEND_URL);
  if (!(await isPortListening(frontendHost, frontendPort))) {
    startNpmProcess("frontend", ["run", "studio:frontend"]);
  }
  await waitForHttp(FRONTEND_URL, 90000);
}

async function launchBrowser() {
  const chromeCandidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter((candidate) => fs.existsSync(candidate));

  const attempts = [
    () => chromium.launch({ channel: "chrome", headless: true }),
    ...chromeCandidates.map((executablePath) => () => chromium.launch({ executablePath, headless: true })),
    () => chromium.launch({ headless: true }),
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function openFirstProject(page) {
  await page.goto(FRONTEND_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(900);

  if (await page.locator(".editor-grid").count()) return;

  const openButton = page.locator(".video-row-actions .action").filter({ hasText: "Mở" }).first();
  await openButton.waitFor({ state: "visible", timeout: 30000 });
  await openButton.click();
  await page.locator(".editor-grid").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(1200);
}

async function screenshot(page, name, fullPage = true) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage });
}

async function collectLayoutMetrics(page, label) {
  const item = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const maxScrollWidth = Math.max(root.scrollWidth, body.scrollWidth);
    const scriptPanel = document.querySelector(".script-panel");
    const editorGrid = document.querySelector(".editor-grid");
    const saveButton = [...document.querySelectorAll(".script-actions button")]
      .find((button) => /Lưu content|Lưu chính thức/i.test(button.textContent || ""));
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(node).display !== "none";
    };
    const topButtons = [...document.querySelectorAll(".top-actions button")].filter(visible);
    const touchTargets = [...document.querySelectorAll([
      ".top-actions button",
      ".preview-toolbar button",
      ".template-card-actions button",
      ".home-job-actions button",
      ".tab-row button",
      ".library-clear-filters",
    ].join(","))].filter(visible).map((button) => {
      const rect = button.getBoundingClientRect();
      return { text: (button.textContent || "").trim().slice(0, 50), width: rect.width, height: rect.height };
    });
    const iconOnlyMissing = [...document.querySelectorAll("button")]
      .filter((button) => {
        const text = (button.textContent || "").trim();
        const hasIcon = Boolean(button.querySelector("svg,img"));
        const label = button.getAttribute("aria-label") || button.getAttribute("title");
        return hasIcon && !text && !label;
      })
      .map((button) => button.outerHTML.slice(0, 160));
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusStyle = activeElement ? getComputedStyle(activeElement) : null;
    const saveRect = saveButton?.getBoundingClientRect();
    const scriptRect = scriptPanel?.getBoundingClientRect();
    const gridRect = editorGrid?.getBoundingClientRect();
    return {
      label: "",
      width: window.innerWidth,
      height: window.innerHeight,
      overflowX: Math.max(0, maxScrollWidth - root.clientWidth),
      gridWidth: gridRect?.width || 0,
      scriptWidth: scriptRect?.width || 0,
      saveOfficialHeight: saveRect?.height || 0,
      saveOfficialNoWrap: Boolean(saveButton)
        && getComputedStyle(saveButton).whiteSpace === "nowrap"
        && saveButton.scrollWidth <= saveButton.clientWidth + 2
        && (saveRect?.height || 999) <= 54,
      tabCount: document.querySelectorAll(".tab-row [role='tab']").length,
      selectedTabCount: document.querySelectorAll(".tab-row [role='tab'][aria-selected='true']").length,
      activeLineCount: document.querySelectorAll(".script-panel .line-item[aria-current='true']").length,
      iconOnlyMissing,
      minTouchTarget: touchTargets.length ? Math.min(...touchTargets.map((item) => Math.min(item.width, item.height))) : 0,
      undersizedTouchTargets: touchTargets.filter((item) => item.width < 44 || item.height < 44),
      minTopButtonHeight: topButtons.length
        ? Math.min(...topButtons.map((button) => button.getBoundingClientRect().height))
        : 0,
      focusVisible: Boolean(activeElement)
        && activeElement !== document.body
        && Boolean(focusStyle)
        && (focusStyle.outlineStyle !== "none" || focusStyle.boxShadow !== "none"),
    };
  });
  item.label = label;
  metrics.push(item);
  return item;
}

async function assertCurrentViewport(page, label) {
  await page.keyboard.press("Tab");
  await page.waitForTimeout(80);
  const item = await collectLayoutMetrics(page, label);
  assertCheck(`${label} no horizontal overflow`, item.overflowX <= 1, `overflowX=${item.overflowX}`);
  assertCheck(`${label} editor tabs semantic`, item.tabCount === 5 && item.selectedTabCount === 1, `tabs=${item.tabCount}, selected=${item.selectedTabCount}`);
  assertCheck(`${label} active line semantic`, item.activeLineCount === 1, `activeLineCount=${item.activeLineCount}`);
  assertCheck(`${label} icon-only buttons labelled`, item.iconOnlyMissing.length === 0, item.iconOnlyMissing.join(" | "));
  assertCheck(`${label} topbar touch target`, item.minTopButtonHeight >= 44, `minTopButtonHeight=${item.minTopButtonHeight}`);
  assertCheck(`${label} primary touch targets`, item.minTouchTarget >= 44, JSON.stringify(item.undersizedTouchTargets));
  assertCheck(`${label} focus style visible`, item.focusVisible, "focused top button has no outline/box-shadow");
  if (item.width >= 1320) {
    assertCheck(`${label} script panel width`, item.scriptWidth >= 400, `scriptWidth=${item.scriptWidth}`);
    assertCheck(`${label} save official no wrap`, item.saveOfficialNoWrap, `buttonHeight=${item.saveOfficialHeight}`);
  }
}

async function clickEditorTab(page, id, namePattern) {
  await page.getByRole("tab", { name: namePattern }).click();
  await page.locator(`#editor-panel-${id}`).waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(500);
}

async function checkFontAssets() {
  const fontFiles = [
    "Anton-Regular.ttf",
    "ArchivoBlack-Regular.ttf",
    "BarlowCondensed-Black.ttf",
    "BeVietnamPro-Black.ttf",
    "Lexend-Variable.ttf",
    "Literata-Variable.ttf",
    "Manrope-Variable.ttf",
    "Montserrat-Black.ttf",
    "Nunito-Variable.ttf",
    "Oswald-Bold.ttf",
    "PlayfairDisplay-Variable.ttf",
    "Quicksand-Variable.ttf",
    "RobotoCondensed-Black.ttf",
    "Roboto-Variable.ttf",
    "Saira-Variable.ttf",
  ];
  const fontResults = [];
  for (const file of fontFiles) {
    try {
      const response = await fetch(`${BACKEND_URL}/shared-assets/fonts/${file}`, { cache: "no-store" });
      const size = response.ok ? (await response.arrayBuffer()).byteLength : 0;
      const ok = response.ok && size > 1000;
      fontResults.push({ file, status: response.status, size, ok });
      assertCheck(`font runtime ${file}`, ok, `status=${response.status}, size=${size}`);
    } catch (error) {
      fontResults.push({ file, status: 0, size: 0, ok: false, error: error.message });
      assertCheck(`font runtime ${file}`, false, error.message);
    }
  }
  return fontResults;
}

async function testLineSelection(page) {
  const lineItems = page.locator(".script-panel .line-item");
  const count = await lineItems.count();
  if (count < 2) return;
  await lineItems.nth(1).click();
  await page.waitForTimeout(300);
  const active = await lineItems.nth(1).getAttribute("aria-current");
  assertCheck("line selection updates aria-current", active === "true", `aria-current=${active}`);
}

async function testScriptActionsDesktop(page) {
  const viewport = await page.evaluate(() => ({ width: window.innerWidth }));
  if (viewport.width < 1321) return;
  const state = await page.locator(".script-actions").evaluate((node) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== "none";
    };
    const children = [...node.children].filter(visible).map((element) => {
      const rect = element.getBoundingClientRect();
      return { text: (element.textContent || "").trim().slice(0, 40), top: Math.round(rect.top), height: Math.round(rect.height) };
    });
    return { children, rows: [...new Set(children.map((item) => item.top))] };
  });
  assertCheck("desktop script actions stay on one row", state.children.length === 3 && state.rows.length === 1, JSON.stringify(state));
  const poseLabels = (await page.locator(".pose-start-selector button").allTextContents()).map((text) => text.trim());
  assertCheck("pose selector uses compact left/right labels", poseLabels.length === 2 && poseLabels[0] === "Trái" && poseLabels[1] === "Phải" && !(await page.locator(".pose-start-label").count()), poseLabels.join(" | "));
}

async function testScriptHeaderRemoved(page) {
  const state = await page.locator(".script-panel").first().evaluate((panel) => {
    const head = panel.querySelector(".script-head");
    const status = panel.querySelector(".content-official-status, .script-meta");
    return {
      titleCount: panel.querySelectorAll(".script-title-line, .script-head h2, .script-head .eyebrow").length,
      headHeight: head ? Math.round(head.getBoundingClientRect().height) : 0,
      statusGap: head && status ? Math.round(status.getBoundingClientRect().top - head.getBoundingClientRect().bottom) : null,
    };
  });
  assertCheck(
    "script panel visible title is removed and content moves up",
    state.titleCount === 0 && state.headHeight > 0 && state.statusGap !== null && state.statusGap <= 12,
    JSON.stringify(state),
  );
}

async function testVietnameseTypography(page) {
  await page.evaluate(() => document.fonts.ready);
  const state = await page.evaluate(() => ({
    family: getComputedStyle(document.body).fontFamily,
    studioSansLoaded: document.fonts.check('16px "Studio Sans"', "Không có job nền"),
    bodyText: document.body.innerText,
  }));
  assertCheck("Vietnamese UI font family configured", /Studio Sans/i.test(state.family), state.family);
  assertCheck("Vietnamese UI font is available", state.studioSansLoaded, state.family);
  assertCheck("global job empty state keeps Vietnamese marks", /Không có job nền|Đang xử lý|Job nền/.test(state.bodyText), "Vietnamese status text missing");
  assertCheck("known corrupted project labels are absent", !/U L\?nh T\?nh|U \?c T\?nh|S\?a Thanh Tr\?ng|S\?a Ti\?t Tr\?ng/.test(state.bodyText), "Corrupted label still visible");
}

async function testEditorTabKeyboard(page) {
  const tabs = page.locator(".tab-row [role='tab']");
  const count = await tabs.count();
  if (count !== 5) return;

  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  assertCheck("editor tabs ArrowRight", await tabs.nth(1).getAttribute("aria-selected") === "true");

  await page.keyboard.press("End");
  assertCheck("editor tabs End", await tabs.nth(4).getAttribute("aria-selected") === "true");

  await page.keyboard.press("Home");
  assertCheck("editor tabs Home", await tabs.first().getAttribute("aria-selected") === "true");

  const tabIndexes = await tabs.evaluateAll((nodes) => nodes.map((node) => node.tabIndex));
  assertCheck("editor tabs roving tabindex", tabIndexes.filter((value) => value === 0).length === 1 && tabIndexes.filter((value) => value === -1).length === 4, JSON.stringify(tabIndexes));
}

async function testRenderOutputTabs(page) {
  let outputTabs = page.locator(".render-output-tabs button");
  if (await outputTabs.count() === 0) {
    const toggle = page.locator(".render-output-collapsible .collapsible-group-toggle").first();
    if (await toggle.count()) {
      await toggle.click();
      await page.waitForTimeout(250);
    }
    outputTabs = page.locator(".render-output-tabs button");
  }
  const count = await outputTabs.count();
  assertCheck("render output tabs exist", count === 2, `count=${count}`);
  if (count >= 2) {
    const labels = (await outputTabs.allTextContents()).map((text) => text.trim());
    assertCheck("render output tabs labels", (labels[0] === "Preview final" || labels[0] === "Chốt bản render") && labels[1] === "Hoàn thiện", labels.join(" | "));
  }
}

async function testLogoControls(page) {
  let grid = page.locator(".logo-control-grid");
  if (await grid.count() === 0) {
    const toggle = page.locator(".collapsible-group").filter({ hasText: /Logo/ }).locator(".collapsible-group-toggle").first();
    if (await toggle.count()) {
      await toggle.click();
      await page.waitForTimeout(250);
    }
    grid = page.locator(".logo-control-grid");
  }
  assertCheck("logo control grid exists", await grid.count() > 0);
  const maxAnchorHeight = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll(".logo-anchor-grid button")];
    return buttons.length ? Math.max(...buttons.map((button) => button.getBoundingClientRect().height)) : 0;
  });
  assertCheck("logo anchor controls touch-friendly", maxAnchorHeight >= 44, `height=${maxAnchorHeight}`);
  const labels = await page.locator(".logo-range-field span").allTextContents();
  assertCheck("logo labels have Vietnamese marks", labels.includes("Kích thước logo") && labels.includes("Dịch ngang") && labels.includes("Dịch dọc") && labels.includes("Độ mờ"), labels.join(" | "));
}

async function testModalClose(page, openModal, modalSelector, screenshotName, trigger = null) {
  if (trigger) await trigger.focus();
  const before = await page.evaluate(() => {
    const element = document.activeElement;
    return {
      label: element?.getAttribute("aria-label") || "",
      text: (element?.textContent || "").trim().slice(0, 80),
    };
  });
  await openModal();
  const modal = page.locator(modalSelector).first();
  await modal.waitFor({ state: "visible", timeout: 10000 });
  await screenshot(page, screenshotName);
  const dialogCount = await page.locator("[role='dialog']").count();
  assertCheck(`${screenshotName} dialog role`, dialogCount > 0, `dialogCount=${dialogCount}`);
  const missingCloseLabels = await page.evaluate(() => [...document.querySelectorAll("[role='dialog'] .icon-close")]
    .filter((button) => !button.getAttribute("aria-label")).length);
  assertCheck(`${screenshotName} close aria-label`, missingCloseLabels === 0, `missing=${missingCloseLabels}`);
  const modalFocusState = await page.evaluate(() => ({
    bodyOverflow: document.body.style.overflow,
    focusInside: Boolean(document.querySelector("[role='dialog']")?.contains(document.activeElement)),
  }));
  assertCheck(`${screenshotName} locks page scroll`, modalFocusState.bodyOverflow === "hidden", `overflow=${modalFocusState.bodyOverflow}`);
  assertCheck(`${screenshotName} focus starts inside dialog`, modalFocusState.focusInside);
  await page.keyboard.press("Tab");
  assertCheck(`${screenshotName} focus trap`, await page.evaluate(() => Boolean(document.querySelector("[role='dialog']")?.contains(document.activeElement))));
  await page.keyboard.press("Escape");
  await modal.waitFor({ state: "hidden", timeout: 5000 });
  await page.waitForTimeout(80);
  const after = await page.evaluate(() => {
    const element = document.activeElement;
    return {
      label: element?.getAttribute("aria-label") || "",
      text: (element?.textContent || "").trim().slice(0, 80),
      bodyOverflow: document.body.style.overflow,
    };
  });
  assertCheck(`${screenshotName} restores page scroll`, after.bodyOverflow !== "hidden", `overflow=${after.bodyOverflow}`);
  if (trigger) {
    assertCheck(`${screenshotName} restores trigger focus`, after.label === before.label && after.text === before.text, JSON.stringify({ before, after }));
  }
}

async function testPreviewRecovery(page) {
  await page.locator(".preview-source-note").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(1000);
  const pattern = "**/api/videos/*/preview-props*";
  let intercepted = 0;
  const failPreview = async (route) => {
    intercepted += 1;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Preview tạm thời không khả dụng" }),
    });
  };
  await page.route(pattern, failPreview);

  const lineItems = page.locator(".script-panel .line-item");
  const count = await lineItems.count();
  for (let index = 1; index < count && !intercepted; index += 1) {
    await lineItems.nth(index).click();
    await page.waitForTimeout(280);
  }
  if (!intercepted) await page.waitForTimeout(2800);

  assertCheck("preview failure request intercepted", intercepted > 0, `requests=${intercepted}`);
  if (intercepted) {
    await page.locator(".preview-status-stale, .preview-status-error").first().waitFor({ state: "visible", timeout: 10000 });
    const playerStillVisible = await page.locator(".remotion-player-shell .remotion-preview").count();
    assertCheck("preview keeps last successful player", playerStillVisible > 0, `players=${playerStillVisible}`);
    assertCheck("preview exposes retry action", await page.locator(".preview-source-note button").count() > 0);
    await screenshot(page, "final-preview-error");

    await page.unroute(pattern, failPreview);
    await page.locator(".preview-source-note button").first().click();
    await page.locator(".preview-status-ready").waitFor({ state: "visible", timeout: 15000 });
    assertCheck("preview recovers after retry", await page.locator(".remotion-player-shell .remotion-preview").count() > 0);
  } else {
    await page.unroute(pattern, failPreview);
  }
}

async function testGlobalJobsHome(page) {
  await page.goto(FRONTEND_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("domcontentloaded");
  await page.locator(".topbar").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(900);
  const stripCount = await page.locator(".global-job-strip").count();
  const panelCount = await page.locator(".home-jobs-panel").count();
  assertCheck("global job strip exists", stripCount === 1, `count=${stripCount}`);
  assertCheck("home jobs panel exists", panelCount === 1, `count=${panelCount}`);
  if (panelCount) {
    const text = await page.locator(".home-jobs-panel").first().textContent();
    assertCheck("home jobs panel has active section", /Đang xử lý|Job nền|Không có job/.test(text || ""), text || "");
  }
}

async function runBrowserQa() {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const diagnostics = [];
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (!["error", "warning"].includes(message.type())) return;
    const text = message.text();
    const expectedPreviewFallback = /Failed to decode downloaded font|OTS parsing error|\/fonts\/|503 \(Service Unavailable\)/i.test(text);
    if (!expectedPreviewFallback) {
      const location = message.location();
      diagnostics.push(`${message.type()}: ${text}${location?.url ? ` @ ${location.url}` : ""}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() === 404 && !/\/fonts\//i.test(response.url())) {
      diagnostics.push(`response 404: ${response.url()}`);
    }
  });
  try {
    await testGlobalJobsHome(page);
    await openFirstProject(page);
    await testScriptActionsDesktop(page);
    await testScriptHeaderRemoved(page);
    await testVietnameseTypography(page);
    await assertCurrentViewport(page, "1440x900-initial");
    await screenshot(page, "phase3-1440-content");

    for (const [id, namePattern] of tabs) {
      await clickEditorTab(page, id, namePattern);
      if (id === "character") await testLogoControls(page);
      if (id === "render") await testRenderOutputTabs(page);
      await assertCurrentViewport(page, `1440-${id}`);
      await screenshot(page, `phase3-1440-${id}`);
    }

    await testLineSelection(page);

    await clickEditorTab(page, "content", /Nội dung/);
    await testEditorTabKeyboard(page);
    await testPreviewRecovery(page);
    await testModalClose(
      page,
      () => page.getByRole("button", { name: /Lưu tất cả/ }).click(),
      ".template-modal",
      "phase3-save-template-modal",
      page.getByRole("button", { name: /Lưu tất cả/ }).first(),
    );
    await testModalClose(
      page,
      () => page.getByRole("button", { name: /Mẫu đã lưu/ }).click(),
      ".template-library-modal",
      "phase3-template-library-modal",
      page.getByRole("button", { name: /Mẫu đã lưu/ }).first(),
    );

    const cropButton = page.getByRole("button", { name: /Crop|crop/i }).first();
    if (await cropButton.count()) {
      const disabled = await cropButton.isDisabled().catch(() => true);
      if (!disabled) {
        await testModalClose(page, () => cropButton.click(), ".crop-modal", "phase3-crop-modal", cropButton);
      }
    }

    await clickEditorTab(page, "audio", /Âm thanh/);
    const galleryCount = await page.locator(".sound-gallery-details").count();
    assertCheck("sound gallery details removed", galleryCount === 0, `count=${galleryCount}`);
    const sourceStripCount = await page.locator(".sound-source-strip").count();
    assertCheck("sound source strip removed", sourceStripCount === 0, `count=${sourceStripCount}`);
    const tiengDongImport = page.getByText("Nhập file từ Tiếng Động").first();
    assertCheck("tieng dong import hidden from main audio actions", await tiengDongImport.count() === 0);
    const mockSoundPath = path.join(OUT_DIR, "mock-custom-sound.wav");
    await fsp.writeFile(mockSoundPath, "mock wav");
    const customSoundInput = page.locator('label.upload-button:has-text("Upload nhiều sound") input').first();
    if (await customSoundInput.count()) {
      await customSoundInput.setInputFiles(mockSoundPath);
      const modal = page.locator(".sound-import-modal").first();
      await modal.waitFor({ state: "visible", timeout: 10000 });
      const modalText = await modal.textContent();
      assertCheck("sound import modal opens for custom sound", /Nguồn|Nguá»“n|Tên hiển thị|TÃªn hiá»ƒn thá»‹/.test(modalText || ""), modalText || "");
      await page.keyboard.press("Escape").catch(() => {});
      const soundClose = page.locator(".sound-import-modal .icon-close");
      if (await soundClose.isVisible().catch(() => false)) await soundClose.click();
      await modal.waitFor({ state: "hidden", timeout: 5000 });
    }
    const soundTrigger = page.locator(".compact-sound-trigger").first();
    if (await soundTrigger.count()) {
      await soundTrigger.click();
      await page.locator(".compact-sound-popover").first().waitFor({ state: "visible", timeout: 10000 });
      const resultCount = await page.locator(".compact-sound-result-row").count();
      assertCheck("sound picker shows expanded results", resultCount > 12, `count=${resultCount}`);
      await screenshot(page, "phase3-sound-picker");
      await page.keyboard.press("Escape");
      await page.locator(".compact-sound-popover").first().waitFor({ state: "hidden", timeout: 5000 });
    }

    await clickEditorTab(page, "content", /Nội dung/);
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(650);
      const label = `${width}x${height}`;
      await assertCurrentViewport(page, label);
      await screenshot(page, `phase3-${label}-content`);
      if (width === 390) {
        const moreButton = page.locator(".top-actions-more-toggle");
        assertCheck("mobile secondary actions toggle visible", await moreButton.isVisible().catch(() => false));
        if (await moreButton.isVisible().catch(() => false)) {
          await moreButton.click();
          assertCheck("mobile secondary actions menu opens", await page.locator("#top-actions-more-menu").isVisible());
          await page.keyboard.press("Escape");
          await page.waitForTimeout(80);
          assertCheck("mobile secondary actions menu closes with Escape", await page.locator("#top-actions-more-menu").count() === 0);
        }
      }
    }
    assertCheck("browser console and page diagnostics clean", diagnostics.length === 0, diagnostics.join(" | "));
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  process.on("SIGINT", () => {
    stopStartedProcesses();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    stopStartedProcesses();
    process.exit(143);
  });

  try {
    await ensureServers();
    const fontResults = await checkFontAssets();
    await runBrowserQa();
    await fsp.writeFile(
      path.join(OUT_DIR, "metrics.json"),
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        frontendUrl: FRONTEND_URL,
        backendUrl: BACKEND_URL,
        fontResults,
        metrics,
        failures,
      }, null, 2),
    );

    if (failures.length) {
      console.error("Studio UI smoke failed:");
      for (const failure of failures) console.error(`- ${failure}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Studio UI smoke passed. Screenshots: ${OUT_DIR}`);
  } finally {
    stopStartedProcesses();
  }
}

main().catch(async (error) => {
  failures.push(error.stack || error.message);
  await fsp.mkdir(OUT_DIR, { recursive: true }).catch(() => {});
  await fsp.writeFile(
    path.join(OUT_DIR, "metrics.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), failures, metrics }, null, 2),
  ).catch(() => {});
  console.error(error.stack || error.message);
  stopStartedProcesses();
  process.exit(1);
});
