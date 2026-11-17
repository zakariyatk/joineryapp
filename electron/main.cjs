// Electron main process: owns the window, the data file on disk and file exports.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

function dataFile() {
  return path.join(app.getPath('userData'), 'joinery-data.json');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'JoineryApp',
    backgroundColor: '#F4F2EE',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Never open new Electron windows from the renderer; send web links to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (DEV_URL && url.startsWith(DEV_URL)) return;
    event.preventDefault();
  });
}

// ---- Data persistence -------------------------------------------------------

ipcMain.handle('data:load', async () => {
  try {
    return await fs.readFile(dataFile(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
});

ipcMain.handle('data:save', async (_event, json) => {
  if (typeof json !== 'string') throw new Error('data:save expects a string');
  const file = dataFile();
  const tmp = `${file}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, json, 'utf8');
  // Keep the previous good copy as a backup before replacing it.
  await fs.copyFile(file, `${file}.bak`).catch(() => {});
  await fs.rename(tmp, file);
  return true;
});

ipcMain.handle('data:location', () => dataFile());

// ---- Exports ----------------------------------------------------------------

ipcMain.handle('file:saveText', async (event, { defaultName, filters, content }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), String(defaultName || 'export.txt')),
    filters: Array.isArray(filters) ? filters : undefined,
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, String(content), 'utf8');
  return filePath;
});

ipcMain.handle('file:savePdf', async (event, { defaultName, html, landscape }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), String(defaultName || 'document.pdf')),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return null;

  // Render the HTML in an offscreen window with scripts disabled, then print it.
  const pdfWin = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false, contextIsolation: true },
  });
  try {
    await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(String(html)));
    const pdf = await pdfWin.webContents.printToPDF({
      printBackground: true,
      landscape: Boolean(landscape),
      pageSize: 'A4',
      margins: { marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    });
    await fs.writeFile(filePath, pdf);
  } finally {
    pdfWin.destroy();
  }
  return filePath;
});

ipcMain.handle('file:reveal', (_event, filePath) => {
  if (typeof filePath === 'string') shell.showItemInFolder(filePath);
});

// ---- App lifecycle ----------------------------------------------------------

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
