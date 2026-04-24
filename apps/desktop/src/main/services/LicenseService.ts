import fs from 'node:fs/promises';
import fssync from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LicenseFile, LicensePayload, LicenseStatus } from '@appname/shared';
import { licenseFilePath, machineIdCachePath } from './paths';

const execFileP = promisify(execFile);

/**
 * High-level license service. Ed25519 signature, machine-bound, offline.
 *
 * The public key is embedded at build time (here a placeholder). The private
 * key is held by the software vendor / license issuer and is never shipped.
 */

// Placeholder — replace at build time with the real vendor public key.
// Must be a base64-encoded Ed25519 public key (32 bytes).
const EMBEDDED_PUBLIC_KEY_BASE64 = '';

const GRACE_PERIOD_DAYS = 7;

export class LicenseService {
  private cachedMachineId: string | null = null;

  async getStatus(): Promise<LicenseStatus> {
    const machineId = await this.getMachineId();
    const licenseRaw = await this.readLicenseFile();
    if (!licenseRaw) {
      return {
        state: 'not-activated',
        payload: null,
        machineId,
        daysUntilExpiry: null,
        message: null,
      };
    }

    // Verify signature.
    if (!this.verifySignature(licenseRaw)) {
      return {
        state: 'invalid',
        payload: null,
        machineId,
        daysUntilExpiry: null,
        message: 'signature verification failed',
      };
    }

    const payload = licenseRaw.payload;
    if (payload.machineId !== machineId) {
      return {
        state: 'invalid',
        payload,
        machineId,
        daysUntilExpiry: null,
        message: 'license not bound to this machine',
      };
    }

    // Expiry / grace.
    if (payload.expiresAt) {
      const expiry = new Date(payload.expiresAt).getTime();
      const now = Date.now();
      const daysUntil = Math.floor((expiry - now) / (24 * 3600 * 1000));
      if (daysUntil < -GRACE_PERIOD_DAYS) {
        return { state: 'expired', payload, machineId, daysUntilExpiry: daysUntil, message: null };
      }
      if (daysUntil < 0) {
        return {
          state: 'expiring',
          payload,
          machineId,
          daysUntilExpiry: daysUntil,
          message: `grace period: ${GRACE_PERIOD_DAYS + daysUntil} days left`,
        };
      }
      if (daysUntil < 14) {
        return { state: 'expiring', payload, machineId, daysUntilExpiry: daysUntil, message: null };
      }
    }
    return {
      state: 'active',
      payload,
      machineId,
      daysUntilExpiry: payload.expiresAt
        ? Math.floor((new Date(payload.expiresAt).getTime() - Date.now()) / (24 * 3600 * 1000))
        : null,
      message: null,
    };
  }

  async activateFromText(text: string): Promise<LicenseStatus> {
    const parsed = JSON.parse(text) as LicenseFile;
    await fs.writeFile(licenseFilePath(), JSON.stringify(parsed, null, 2), 'utf8');
    return this.getStatus();
  }

  async getMachineId(): Promise<string> {
    if (this.cachedMachineId) return this.cachedMachineId;
    const cachePath = machineIdCachePath();
    try {
      const cached = await fs.readFile(cachePath, 'utf8');
      this.cachedMachineId = cached.trim();
      return this.cachedMachineId;
    } catch {
      // compute fresh
    }
    const id = await this.computeMachineId();
    await fs.writeFile(cachePath, id, 'utf8');
    this.cachedMachineId = id;
    return id;
  }

  // --- internals ---

  private async computeMachineId(): Promise<string> {
    const parts: string[] = [];
    if (process.platform === 'win32') {
      parts.push(await this.wmiCpuId());
      parts.push(await this.wmiProductId());
    } else {
      parts.push(os.hostname());
      parts.push(os.arch());
    }
    parts.push(this.primaryMacAddress());
    return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
  }

  private async wmiCpuId(): Promise<string> {
    try {
      const { stdout } = await execFileP(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '(Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId',
        ],
        { timeout: 5_000, windowsHide: true },
      );
      return stdout.trim();
    } catch {
      return '';
    }
  }

  private async wmiProductId(): Promise<string> {
    try {
      const { stdout } = await execFileP(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '(Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion").ProductId',
        ],
        { timeout: 5_000, windowsHide: true },
      );
      return stdout.trim();
    } catch {
      return '';
    }
  }

  private primaryMacAddress(): string {
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
      if (!list) continue;
      for (const iface of list) {
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
          return iface.mac;
        }
      }
    }
    return '';
  }

  private async readLicenseFile(): Promise<LicenseFile | null> {
    try {
      const raw = await fs.readFile(licenseFilePath(), 'utf8');
      return JSON.parse(raw) as LicenseFile;
    } catch {
      return null;
    }
  }

  private verifySignature(license: LicenseFile): boolean {
    if (!EMBEDDED_PUBLIC_KEY_BASE64) {
      // No key embedded yet (pre-release dev build). Treat all signatures as
      // invalid so we never falsely report "active" until a real key is shipped.
      return false;
    }
    try {
      const pub = crypto.createPublicKey({
        key: Buffer.from(EMBEDDED_PUBLIC_KEY_BASE64, 'base64'),
        format: 'der',
        type: 'spki',
      });
      const payloadBytes = Buffer.from(canonicalJson(license.payload), 'utf8');
      const sig = Buffer.from(license.signature, 'base64');
      return crypto.verify(null, payloadBytes, pub, sig);
    } catch {
      return false;
    }
  }
}

function canonicalJson(payload: LicensePayload): string {
  // Sort keys for a stable string; signing must use the same canonicalization.
  const ordered: Record<string, unknown> = {};
  for (const k of Object.keys(payload).sort()) {
    ordered[k] = (payload as unknown as Record<string, unknown>)[k];
  }
  return JSON.stringify(ordered);
}
