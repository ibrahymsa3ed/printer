import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  FileEntry,
  Job,
  JobDraft,
  JobEvent,
  LicenseStatus,
  Printer,
} from '@appname/shared';
import { IPC } from '../main/ipc/channels';

const api = {
  files: {
    add: (paths: string[]) => ipcRenderer.invoke(IPC.FILES_ADD, { paths }) as Promise<FileEntry[]>,
    remove: (id: string) => ipcRenderer.invoke(IPC.FILES_REMOVE, { id }),
  },
  printers: {
    list: () => ipcRenderer.invoke(IPC.PRINTERS_LIST) as Promise<Printer[]>,
  },
  jobs: {
    create: (draft: JobDraft) => ipcRenderer.invoke(IPC.JOBS_CREATE, draft) as Promise<Job>,
    start: (id: string) => ipcRenderer.invoke(IPC.JOBS_START, { id }),
    cancel: (id: string) => ipcRenderer.invoke(IPC.JOBS_CANCEL, { id }),
    retryChild: (childJobId: string) =>
      ipcRenderer.invoke(IPC.JOBS_RETRY_CHILD, { childJobId }),
    onEvent: (cb: (evt: JobEvent) => void) => {
      const handler = (_: IpcRendererEvent, evt: JobEvent): void => cb(evt);
      ipcRenderer.on(IPC.JOBS_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC.JOBS_EVENT, handler);
    },
  },
  license: {
    status: () => ipcRenderer.invoke(IPC.LICENSE_STATUS) as Promise<LicenseStatus>,
    activate: (licenseText: string) =>
      ipcRenderer.invoke(IPC.LICENSE_ACTIVATE, { licenseText }) as Promise<LicenseStatus>,
  },
};

export type Api = typeof api;

contextBridge.exposeInMainWorld('api', api);
