export interface FileEntry {
  id: string;
  originalPath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  addedAt: string;
  normalizedPdfPath: string | null;
  pageCount: number | null;
  conversionStatus: 'pending' | 'converting' | 'ready' | 'failed';
  conversionError: string | null;
  sourceHash: string;
}

export interface PrinterCapabilities {
  paperSizes: string[];
  supportsDuplex: boolean;
  duplexModes: Array<'long-edge' | 'short-edge'>;
  supportsColor: boolean;
  maxCopies: number;
  resolutions: number[];
}

export type PrinterConnection =
  | { type: 'os'; queueName: string }
  | { type: 'ipp'; host: string; port: number; path: string }
  | { type: 'raw'; host: string; port: number };

export interface Printer {
  id: string;
  name: string;
  source: 'system' | 'manual';
  connection: PrinterConnection;
  capabilities: PrinterCapabilities | null;
  status: 'online' | 'offline' | 'unknown';
  lastSeenAt: string;
}

export interface PrintSettings {
  copies: number;
  pageRange: { from: number; to: number } | 'all';
  colorMode: 'color' | 'mono';
  orientation: 'portrait' | 'landscape';
  paperSize: string;
  duplex: 'none' | 'long-edge' | 'short-edge';
  collate: boolean;
  fitToPage: boolean;
}

export type JobStatus =
  | 'queued'
  | 'preparing'
  | 'ready'
  | 'printing'
  | 'done'
  | 'partial'
  | 'error'
  | 'cancelled'
  | 'interrupted';

export type ChildJobStatus =
  | 'queued'
  | 'printing'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface ChildJob {
  id: string;
  parentJobId: string;
  printerId: string;
  copies: number;
  status: ChildJobStatus;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  enginePid: number | null;
}

export interface JobFileRef {
  fileId: string;
  normalizedPdfPath: string;
  pageCount: number;
}

export interface Job {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  files: JobFileRef[];
  bookletEnabled: boolean;
  bookletPdfPath: string | null;
  totalCopies: number;
  settingsSnapshot: PrintSettings;
  selectedPrinterIds: string[];
  distribution: Record<string, number>;
  children: ChildJob[];
  progress: number;
  error: string | null;
}

export interface JobDraft {
  fileIds: string[];
  bookletEnabled: boolean;
  totalCopies: number;
  settings: PrintSettings;
  selectedPrinterIds: string[];
}

export type JobEvent =
  | { type: 'status'; jobId: string; status: JobStatus }
  | { type: 'childStatus'; jobId: string; childId: string; status: ChildJobStatus; error?: string | null }
  | { type: 'progress'; jobId: string; progress: number }
  | { type: 'error'; jobId: string; error: string };

export interface LicensePayload {
  machineId: string;
  type: 'perpetual' | 'subscription';
  issuedAt: string;
  expiresAt: string | null;
  features: string[];
  licenseeName: string;
}

export interface LicenseFile {
  payload: LicensePayload;
  signature: string;
}

export interface LicenseStatus {
  state: 'active' | 'expiring' | 'expired' | 'not-activated' | 'invalid';
  payload: LicensePayload | null;
  machineId: string;
  daysUntilExpiry: number | null;
  message: string | null;
}
