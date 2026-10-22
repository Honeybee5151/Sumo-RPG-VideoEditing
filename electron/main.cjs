const { app, BrowserWindow, shell } = require('electron');
const http = require('http');

let mainWindow = null;
const PORT = process.env.PORT || 3000;
const APP_URL = `http://localhost:${PORT}`;

function waitForServer(url, timeout = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http
        .get(url, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 500) {
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
        setTimeout(check, 400);
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
    title: 'ChromaCut AI — Video Editor',
    backgroundColor: '#ece5d3',
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
    if (mainWindow) {
      mainWindow.loadURL(APP_URL);
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
