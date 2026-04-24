import { BrowserWindow, app } from 'electron';
import path from 'node:path';
import { Store } from './services/Store';
import { TempManager } from './services/TempManager';
import { PrinterRegistry } from './services/PrinterRegistry';
import { JobManager } from './services/JobManager';
import { LicenseService } from './services/LicenseService';
import { FileConverter } from './services/FileConverter';
import { WindowsPrintAdapter } from './adapters/WindowsPrintAdapter';
import { registerIpc } from './ipc/register';
import type { PrintAdapter } from './adapters/PrintAdapter';

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  if (process.env['ELECTRON_RENDERER_URL']) {
    await mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  const store = new Store();
  const temp = new TempManager();
  temp.ensureSessionDir();
  await temp.cleanupOrphans(7);

  const registry = new PrinterRegistry();
  const adapter: PrintAdapter = new WindowsPrintAdapter();
  const license = new LicenseService();
  const converter = new FileConverter(temp, { libreOfficePath: null });
  const jobs = new JobManager(adapter, registry, store, temp);

  // Mark any jobs left mid-flight by the previous run.
  const interrupted = await jobs.recoverInterrupted();
  if (interrupted.length > 0) {
    console.log(`${interrupted.length} interrupted job(s) found on startup`);
  }

  registerIpc({
    jobs,
    registry,
    license,
    temp,
    converter,
    getWindow: () => mainWindow,
  });

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
