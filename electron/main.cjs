const { app, BrowserWindow, shell } = require('electron');
const http = require('http');

let mainWindow = null;
const PORT = process.env.PORT || 3000;
const APP_URL = `http://127.0.0.1:${PORT}`;

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
        setTimeout(check, 500);
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

  // Show an immediate Washi splash screen so the window is never blank while Next.js warms up
  const splashHtml = `data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
      <body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#ece5d3;color:#1d1a16;font-family:sans-serif;">
        <div style="padding:24px 36px;border:3px solid #1d1a16;background:#f5f2e8;box-shadow:6px 6px 0px #1d1a16;text-align:center;">
          <div style="display:inline-block;padding:4px 10px;background:#b82d23;color:#f5f2e8;font-weight:bold;border:2px solid #1d1a16;margin-bottom:12px;">彩</div>
          <h2 style="margin:0 0 8px 0;font-size:20px;">ChromaCut AI Studio</h2>
          <p style="margin:0;font-size:13px;color:#544b43;">Connecting to local studio server on port 3000...</p>
        </div>
      </body>
    </html>
  `)}`;
  mainWindow.loadURL(splashHtml);

  try {
    await waitForServer(APP_URL);
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadURL(APP_URL);
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
