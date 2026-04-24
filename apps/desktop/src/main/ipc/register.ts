import { BrowserWindow, ipcMain } from 'electron';
import type { JobDraft, JobEvent } from '@appname/shared';
import { IPC } from './channels';
import { FileConverter } from '../services/FileConverter';
import type { JobManager } from '../services/JobManager';
import type { PrinterRegistry } from '../services/PrinterRegistry';
import type { LicenseService } from '../services/LicenseService';
import type { TempManager } from '../services/TempManager';

export interface IpcContext {
  jobs: JobManager;
  registry: PrinterRegistry;
  license: LicenseService;
  temp: TempManager;
  converter: FileConverter;
  getWindow: () => BrowserWindow | null;
}

export function registerIpc(ctx: IpcContext): void {
  ipcMain.handle(IPC.FILES_ADD, async (_, payload: { paths: string[] }) => {
    const results = [];
    for (const p of payload.paths) {
      const entry = await ctx.converter.ensurePdf(p);
      ctx.jobs.registerFile(entry);
      results.push(entry);
    }
    return results;
  });

  ipcMain.handle(IPC.FILES_REMOVE, async (_, payload: { id: string }) => {
    // Kept simple: file entries are job-scoped; clearing is a future action.
    return { ok: true, id: payload.id };
  });

  ipcMain.handle(IPC.PRINTERS_LIST, async () => {
    return ctx.registry.list(true);
  });

  ipcMain.handle(IPC.JOBS_CREATE, async (_, draft: JobDraft) => {
    return ctx.jobs.create(draft);
  });

  ipcMain.handle(IPC.JOBS_START, async (_, payload: { id: string }) => {
    // Fire-and-forget: events stream via JOBS_EVENT.
    void ctx.jobs.start(payload.id);
    return { ok: true };
  });

  ipcMain.handle(IPC.JOBS_CANCEL, async (_, payload: { id: string }) => {
    ctx.jobs.cancel(payload.id);
    return { ok: true };
  });

  ipcMain.handle(IPC.JOBS_RETRY_CHILD, async (_, payload: { childJobId: string }) => {
    void ctx.jobs.retryChild(payload.childJobId);
    return { ok: true };
  });

  ipcMain.handle(IPC.LICENSE_STATUS, async () => ctx.license.getStatus());

  ipcMain.handle(IPC.LICENSE_ACTIVATE, async (_, payload: { licenseText: string }) => {
    return ctx.license.activateFromText(payload.licenseText);
  });

  // Forward job events to the renderer.
  ctx.jobs.on('event', (evt: JobEvent) => {
    const win = ctx.getWindow();
    win?.webContents.send(IPC.JOBS_EVENT, evt);
  });
}
