const { app, BrowserWindow, shell } = require('electron');
const http = require('http');
const path = require('path');

app.setName('Sumo VideoEditor');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.sumo.videoeditor');
}

let mainWindow = null;
const PORT = process.env.PORT || 3000;
const APP_URL = `http://127.0.0.1:${PORT}`;
const ICON_PATH = path.join(__dirname, '..', 'public', 'sumo-icon.ico');

function waitForServer(url, timeout = 120000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http
        .get(url, (res) => {
          // Consume response data to free memory
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
        setTimeout(check, 250);
      }
    };

    check();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    title: 'Sumo VideoEditor',
    icon: ICON_PATH,
    backgroundColor: '#f4f1ea',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  try {
    await waitForServer(APP_URL);
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadURL(APP_URL);
      mainWindow.setTitle('Sumo VideoEditor');
      mainWindow.show();
      mainWindow.focus();
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
