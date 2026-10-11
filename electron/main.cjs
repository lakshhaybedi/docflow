// DocFlow desktop shell. The app itself is the web build in /dist, served from a private app:// origin.
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, net, protocol, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const DEV_URL = process.env.DOCFLOW_DEV_URL; // e.g. http://localhost:5180 while developing
const DIST = path.join(__dirname, '..', 'dist');
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:", // OCR engine and fonts ship with the app
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob: https:",
  "media-src 'self' blob: mediastream:",
].join('; ');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let win = null;
const pendingFiles = []; // PDFs opened from Finder before the window was ready

async function sendFile(filePath) {
  try {
    const data = await fs.readFile(filePath);
    if (win && !win.webContents.isLoading()) win.webContents.send('open-file', { name: path.basename(filePath), data });
    else pendingFiles.push(filePath);
  } catch (e) {
    dialog.showErrorBox('Could not open file', `${path.basename(filePath)}: ${e.message}`);
  }
}

app.on('open-file', (e, filePath) => {
  e.preventDefault();
  if (app.isReady() && win) sendFile(filePath);
  else pendingFiles.push(filePath);
});

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 21 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => pendingFiles.splice(0).forEach(sendFile));

  // External links open in the user's browser; nothing else may open new windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://') && !(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });

  // Exports: always ask where to save, like a native app.
  win.webContents.session.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ title: 'Export', defaultPath: path.join(app.getPath('documents'), item.getFilename()) });
  });

  win.loadURL(DEV_URL ?? 'app://docflow/index.html');
}

const send = (cmd) => win?.webContents.send('menu', cmd);

function buildMenu() {
  const isDev = !!DEV_URL;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => send('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Blank PDF', accelerator: 'Cmd+N', click: () => send('new') },
        { label: 'Open…', accelerator: 'Cmd+O', click: openDialog },
        { type: 'separator' },
        { label: 'Export…', accelerator: 'Cmd+E', click: () => send('export') },
        { type: 'separator' },
        { label: 'Back to Files', accelerator: 'Cmd+Shift+H', click: () => send('home') },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        // Undo/redo go to the app (document history) unless a text field is focused; see desktop.ts.
        { label: 'Undo', accelerator: 'Cmd+Z', click: () => send('undo') },
        { label: 'Redo', accelerator: 'Cmd+Shift+Z', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'Cmd+F', click: () => send('find') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'Cmd+=', click: () => send('zoom-in') },
        { label: 'Zoom Out', accelerator: 'Cmd+-', click: () => send('zoom-out') },
        { label: 'Fit to Width', accelerator: 'Cmd+0', click: () => send('zoom-fit') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Show Tour', click: () => send('tour') },
        { label: 'Show Welcome', click: () => send('welcome') },
      ],
    },
  ]));
}

async function openDialog() {
  if (!win) return;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open PDF', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
  });
  if (!canceled) filePaths.forEach(sendFile);
}

ipcMain.handle('open-dialog', openDialog);
ipcMain.on('set-theme', (_e, theme) => {
  nativeTheme.themeSource = theme === 'dark' || theme === 'light' ? theme : 'system';
});

app.whenReady().then(() => {
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 }); // no escaping the bundle
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    if (file.endsWith('.html')) headers.set('Content-Security-Policy', CSP);
    if (file.endsWith('.mjs') || file.endsWith('.js')) headers.set('Content-Type', 'text/javascript');
    return new Response(res.body, { status: res.status, headers });
  });
  buildMenu();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
