import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

/**
 * All filesystem paths flow through here so the <AppName> placeholder is
 * defined in exactly one place. Replace APP_FOLDER when the final name is
 * chosen — nothing else should need changing.
 */
export const APP_FOLDER = '<AppName>';

export function appDataDir(): string {
  // electron app.getPath('appData') = %APPDATA% on Windows
  const root = app.getPath('appData');
  const dir = path.join(root, APP_FOLDER);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function tempRoot(): string {
  const dir = path.join(appDataDir(), 'temp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sessionTempDir(sessionId: string): string {
  const dir = path.join(tempRoot(), sessionId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function bookletsDir(sessionId: string): string {
  const dir = path.join(sessionTempDir(sessionId), 'booklets');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function storeDbPath(): string {
  return path.join(appDataDir(), 'store.db');
}

export function licenseFilePath(): string {
  return path.join(appDataDir(), 'license.lic');
}

export function machineIdCachePath(): string {
  return path.join(appDataDir(), 'machine.id');
}

export function settingsJsonPath(): string {
  return path.join(appDataDir(), 'settings.json');
}

export function printersSeenPath(): string {
  return path.join(appDataDir(), 'printers_seen.json');
}
