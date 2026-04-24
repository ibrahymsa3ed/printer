export const IPC = {
  FILES_ADD: 'files:add',
  FILES_REMOVE: 'files:remove',
  PRINTERS_LIST: 'printers:list',
  JOBS_CREATE: 'jobs:create',
  JOBS_START: 'jobs:start',
  JOBS_CANCEL: 'jobs:cancel',
  JOBS_RETRY_CHILD: 'jobs:retryChild',
  JOBS_EVENT: 'jobs:event',
  LICENSE_STATUS: 'license:status',
  LICENSE_ACTIVATE: 'license:activate',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
