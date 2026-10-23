const { app, BrowserWindow, Menu, shell, dialog, nativeImage, screen } = require('electron');
const http = require('http');
const https = require('https');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');

const APP_USER_MODEL_ID = 'com.sumo.videoeditor';

app.setName('Sumo VideoEditor');
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

let mainWindow = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
let internalServerProc = null;
const PORT = process.env.PORT || 3000;
const APP_URL = `http://127.0.0.1:${PORT}`;
const ROOT_DIR = path.join(__dirname, '..');
const ICON_PATH = path.join(ROOT_DIR, 'public', 'sumo-icon.ico');
const GITHUB_REPO = 'Honeybee5151/Sumo-RPG-VideoEditing';
const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

function ensureWindowsTaskbarIconRegistration() {
  if (process.platform !== 'win32' || !fs.existsSync(ICON_PATH)) return;
  try {
    const sumoExe = path.join(path.dirname(process.execPath), 'Sumo VideoEditor.exe');
    const targetExe = fs.existsSync(sumoExe) ? sumoExe : process.execPath;
    const shortcutDetails = {
      target: targetExe,
      args: '',
      cwd: ROOT_DIR,
      description: 'Sumo VideoEditor',
      icon: ICON_PATH,
      iconIndex: 0,
      appUserModelId: APP_USER_MODEL_ID,
    };

    const startMenuShortcut = path.join(
      app.getPath('appData'),
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Sumo VideoEditor.lnk'
    );
    if (!fs.existsSync(startMenuShortcut)) {
      shell.writeShortcutLink(startMenuShortcut, 'create', shortcutDetails);
    }

    const desktopShortcut = path.join(app.getPath('desktop'), 'Sumo VideoEditor.lnk');
    if (!fs.existsSync(desktopShortcut)) {
      shell.writeShortcutLink(desktopShortcut, 'create', shortcutDetails);
    }

    const rootShortcut = path.join(ROOT_DIR, 'Sumo VideoEditor.lnk');
    if (!fs.existsSync(rootShortcut)) {
      shell.writeShortcutLink(rootShortcut, 'create', shortcutDetails);
    }
  } catch {
    // Ignore shortcut registration errors on restricted filesystems
  }
}

function getLocalVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version || '0.0.1';
  } catch {
    return '0.0.1';
  }
}

function normalizeVersion(v) {
  return String(v || '')
    .replace(/^v/i, '')
    .trim()
    .split(/[.-]/)
    .map((n) => parseInt(n, 10) || 0);
}

function isNewerVersion(remoteVer, localVer) {
  const r = normalizeVersion(remoteVer);
  const l = normalizeVersion(localVer);
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

function fetchLatestGitHubRelease() {
  return new Promise((resolve) => {
    const req = https.get(
      GITHUB_RELEASES_API,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Sumo-VideoEditor-AutoUpdater',
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

let lastNotifiedVersion = null;

async function checkForReleaseUpdates() {
  // 1. If running as a packaged installer with electron-updater installed, trigger native autoUpdater
  if (app.isPackaged) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    } catch {
      // Fall back to GitHub Releases API check below
    }
  }

  // 2. Check GitHub Releases API (https://api.github.com/repos/Honeybee5151/Sumo-RPG-VideoEditing/releases/latest)
  const release = await fetchLatestGitHubRelease();
  if (!release || !release.tag_name) return;

  const localVersion = getLocalVersion();
  const latestVersion = String(release.tag_name).replace(/^v/i, '');
  if (!isNewerVersion(latestVersion, localVersion)) return;
  if (lastNotifiedVersion === latestVersion) return;
  lastNotifiedVersion = latestVersion;

  const repoRoot = path.join(__dirname, '..');
  const hasGitDir = fs.existsSync(path.join(repoRoot, '.git'));

  if (hasGitDir) {
    // Automatically sync to the new release in the background and reload when ready
    exec(
      'git fetch origin --tags && git pull --ff-only origin main',
      { cwd: repoRoot },
      (err) => {
        if (!err && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.reloadIgnoringCache();
        }
      }
    );
    return;
  }

  // If not a git checkout, offer 1-click download of the release installer asset or release page
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const winAsset = assets.find((a) => /\.(exe|msi|zip)$/i.test(a.name || ''));
  const targetUrl =
    (winAsset && winAsset.browser_download_url) ||
    release.html_url ||
    `https://github.com/${GITHUB_REPO}/releases/latest`;

  if (mainWindow && !mainWindow.isDestroyed()) {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Sumo VideoEditor Update Available',
      message: `A new release (v${latestVersion}) of Sumo VideoEditor is available.`,
      detail: release.name || `Current version: v${localVersion}`,
      buttons: ['Update Now', 'Later'],
      defaultId: 0,
    });
    if (result.response === 0) {
      shell.openExternal(targetUrl);
    }
  }
}

function isPortOpenFast(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(120);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(Number(port), host);
  });
}

async function ensureLocalServerRunning() {
  const alreadyUp = await isPortOpenFast(PORT);
  if (alreadyUp || internalServerProc) return;

  const nextBin = path.join(ROOT_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!fs.existsSync(nextBin)) return;

  const hasProdBuild = fs.existsSync(path.join(ROOT_DIR, '.next', 'BUILD_ID'));
  const subcommand = hasProdBuild ? 'start' : 'dev';
  const nodeExe = fs.existsSync('C:\\Program Files\\nodejs\\node.exe')
    ? 'C:\\Program Files\\nodejs\\node.exe'
    : 'node';

  internalServerProc = spawn(
    nodeExe,
    [nextBin, subcommand, '-p', String(PORT)],
    {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        NODE_ENV: hasProdBuild ? 'production' : 'development',
      },
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }
  );
  internalServerProc.unref();

  internalServerProc.on('exit', () => {
    internalServerProc = null;
  });
}

// Start warming the local server immediately before Chromium finishes initializing
if (gotSingleInstanceLock) {
  ensureLocalServerRunning().catch(() => {});
}

function waitForServer(url, timeout = 120000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http
        .get(url, (res) => {
          res.resume();
          if (res.statusCode >= 200 && res.statusCode < 400) {
            resolve();
          } else {
            retry();
          }
        })
        .on('error', retry);
    };

    const retry = () => {
      if (Date.now() - start > timeout) {
        reject(new Error('Timed out waiting for local server'));
      } else {
        setTimeout(check, 50);
      }
    };

    check();
  });
}

async function createWindow() {
  ensureWindowsTaskbarIconRegistration();
  Menu.setApplicationMenu(null);

  const appIcon = fs.existsSync(ICON_PATH)
    ? nativeImage.createFromPath(ICON_PATH)
    : ICON_PATH;

  const workArea = screen.getPrimaryDisplay().workArea;

  mainWindow = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    opacity: 0,
    title: 'Sumo VideoEditor',
    icon: ICON_PATH,
    backgroundColor: '#f4f1ea',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (appIcon && typeof appIcon !== 'string' && !appIcon.isEmpty()) {
    mainWindow.setIcon(appIcon);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents
      .insertCSS(
        'nextjs-portal, [data-nextjs-toast], [data-nextjs-dev-tools-button], [data-nextjs-dialog-overlay] { display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; }'
      )
      .catch(() => {});
  });

  try {
    await ensureLocalServerRunning();
    await waitForServer(APP_URL);
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadURL(APP_URL);
      mainWindow.setTitle('Sumo VideoEditor');
      // Maximize while opacity is 0 so Win32 never shows a resize/restore-to-maximize transition
      mainWindow.maximize();
      await mainWindow.webContents
        .executeJavaScript(
          'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'
        )
        .catch(() => {});
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.setOpacity(1);
        mainWindow.focus();
      }
      // Automatically check GitHub Releases on launch and every 15 minutes
      setTimeout(() => checkForReleaseUpdates().catch(() => {}), 3000);
      setInterval(() => checkForReleaseUpdates().catch(() => {}), 15 * 60 * 1000);
    }
  } catch (err) {
    console.error('Failed to connect to local Next.js server:', err);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
