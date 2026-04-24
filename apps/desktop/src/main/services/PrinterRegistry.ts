import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import type { Printer, PrinterCapabilities } from '@appname/shared';

const execFileP = promisify(execFile);

/**
 * Enumerate system-installed printers on Windows via PowerShell.
 * (Manual printers are deferred to Phase 3 and not exposed here.)
 */
export class PrinterRegistry {
  private cache: Printer[] | null = null;

  async list(forceRefresh = false): Promise<Printer[]> {
    if (this.cache && !forceRefresh) return this.cache;

    if (process.platform !== 'win32') {
      this.cache = this.mockPrinters();
      return this.cache;
    }

    try {
      const script =
        'Get-Printer | Select-Object Name, PrinterStatus, DriverName | ConvertTo-Json -Compress';
      const { stdout } = await execFileP(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 10_000, windowsHide: true },
      );
      const raw = JSON.parse(stdout);
      const list = Array.isArray(raw) ? raw : [raw];
      this.cache = list.map((p: any) => this.buildPrinter(p.Name, p.PrinterStatus));
      return this.cache;
    } catch (err) {
      // On failure, return empty list and let the UI surface the error.
      console.error('PrinterRegistry.list failed', err);
      this.cache = [];
      return this.cache;
    }
  }

  async getCapabilities(printerId: string): Promise<PrinterCapabilities | null> {
    const printer = (this.cache ?? (await this.list())).find((p) => p.id === printerId);
    if (!printer) return null;
    if (process.platform !== 'win32') return this.mockCapabilities();

    try {
      const queue = printer.connection.type === 'os' ? printer.connection.queueName : '';
      const script = `
        $cfg = Get-PrintConfiguration -PrinterName '${queue.replace(/'/g, "''")}'
        $cap = Get-PrinterProperty -PrinterName '${queue.replace(/'/g, "''")}' -ErrorAction SilentlyContinue
        [PSCustomObject]@{
          Color = $cfg.Color
          DuplexingMode = $cfg.DuplexingMode
          PaperSize = $cfg.PaperSize
        } | ConvertTo-Json -Compress
      `;
      const { stdout } = await execFileP(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 10_000, windowsHide: true },
      );
      const cfg = JSON.parse(stdout);
      return {
        paperSizes: ['A4', 'A3', 'Letter', 'Legal'],
        supportsDuplex: cfg.DuplexingMode !== 'OneSided',
        duplexModes: ['long-edge', 'short-edge'],
        supportsColor: !!cfg.Color,
        maxCopies: 999,
        resolutions: [300, 600],
      };
    } catch {
      return null; // unknown → UI trusts the driver
    }
  }

  private buildPrinter(name: string, statusRaw: unknown): Printer {
    const id = crypto.createHash('sha1').update(`os:${name}`).digest('hex').slice(0, 16);
    const status = this.normalizeStatus(statusRaw);
    return {
      id,
      name,
      source: 'system',
      connection: { type: 'os', queueName: name },
      capabilities: null,
      status,
      lastSeenAt: new Date().toISOString(),
    };
  }

  private normalizeStatus(raw: unknown): Printer['status'] {
    const s = String(raw ?? '').toLowerCase();
    if (s.includes('normal') || s.includes('idle') || s === '0') return 'online';
    if (s.includes('offline') || s.includes('error')) return 'offline';
    return 'unknown';
  }

  private mockPrinters(): Printer[] {
    // Useful for non-Windows development so the UI has something to show.
    return [
      {
        id: 'mock-1',
        name: 'Mock HP LaserJet',
        source: 'system',
        connection: { type: 'os', queueName: 'Mock HP LaserJet' },
        capabilities: this.mockCapabilities(),
        status: 'online',
        lastSeenAt: new Date().toISOString(),
      },
      {
        id: 'mock-2',
        name: 'Mock Brother Duplex',
        source: 'system',
        connection: { type: 'os', queueName: 'Mock Brother Duplex' },
        capabilities: this.mockCapabilities(),
        status: 'online',
        lastSeenAt: new Date().toISOString(),
      },
    ];
  }

  private mockCapabilities(): PrinterCapabilities {
    return {
      paperSizes: ['A4', 'A3', 'Letter'],
      supportsDuplex: true,
      duplexModes: ['long-edge', 'short-edge'],
      supportsColor: true,
      maxCopies: 999,
      resolutions: [300, 600],
    };
  }
}
