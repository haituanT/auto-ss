const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const APP_URL = process.env.AUTO_COMPARE_APP_URL || 'http://127.0.0.1:3101';
const USER_DATA_DIR = process.env.AUTO_COMPARE_USER_DATA_DIR
  || (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'AutoCompareStudio', 'electron-profile')
    : path.join(app.getPath('home'), '.config', 'AutoCompareStudio', 'electron-profile'));
const PRELOAD_PATH = path.join(__dirname, 'preload.cjs');
const APP_ICON_PATH = path.join(__dirname, '..', '..', 'studio', 'frontend', 'public', 'auto-compare-logo-v2.png');

app.setName('Auto Compare Studio');
app.setPath('userData', USER_DATA_DIR);
if (process.env.AUTO_COMPARE_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
} else {
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
}

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
  return;
}

function focusMainWindow() {
  const [mainWindow] = BrowserWindow.getAllWindows();
  if (!mainWindow) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return true;
}

async function waitForStyledPage(window) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          const root = document.querySelector('#root');
          const appTitle = document.body ? document.body.innerText.includes('Auto Compare') : false;
          const hasBuiltCss = Array.from(document.styleSheets || []).some((sheet) => {
            try {
              return sheet.href && sheet.href.includes('/assets/') && sheet.cssRules.length > 20;
            } catch {
              return false;
            }
          });
          const bodyBg = getComputedStyle(document.body).backgroundColor;
          resolve(Boolean(root && appTitle && hasBuiltCss && bodyBg !== 'rgba(0, 0, 0, 0)'));
        });
      });
    `).catch(() => false);

    if (ready) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
}

function showWindow(window) {
  if (window.isDestroyed() || window.isVisible()) return;
  window.setTitle('Auto Compare Studio');
  window.show();
  window.focus();
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#f7f0e5',
    show: false,
    title: 'Auto Compare Studio',
    icon: APP_ICON_PATH,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: PRELOAD_PATH,
    },
  });

  mainWindow.once('ready-to-show', () => {
    showWindow(mainWindow);
  });

  mainWindow.webContents.on('did-finish-load', async () => {
    setTimeout(() => showWindow(mainWindow), 300);
    if (mainWindow.isVisible()) return;
    mainWindow.webContents.setZoomFactor(1);
    const styled = await waitForStyledPage(mainWindow);
    if (styled) showWindow(mainWindow);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`Auto Compare app load failed: ${errorCode} ${errorDescription}`);
    setTimeout(() => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.loadURL(APP_URL);
      }
    }, 1000);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Auto Compare renderer stopped: ${details.reason}`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(APP_URL);
  setTimeout(() => showWindow(mainWindow), 5000);
}

app.on('second-instance', () => {
  if (!focusMainWindow()) {
    createWindow();
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
