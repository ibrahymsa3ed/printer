import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import type { Printer, PrinterCapabilities } from '@appname/shared';
import type { PrintAdapter, PrintFileArgs, PrintResult } from './PrintAdapter';
import { PrinterRegistry } from '../services/PrinterRegistry';
import { buildSumatraArgs } from './settingsToSumatra';

/**
 * Windows implementation. Uses SumatraPDF CLI as the print engine. SumatraPDF
 * feeds the Windows spooler under the hood, so we inherit driver compatibility
 * and queue stability.
 *
 * Limitations documented in docs/PLANNING.md §5.2:
 *   - no granular progress (done/failed only after spooler accepts)
 *   - no feedback on printer-side issues (jam / out of paper)
 *   - -print-settings is fragile (unknown tokens silently ignored)
 */
export class WindowsPrintAdapter implements PrintAdapter {
  private registry = new PrinterRegistry();

  async getInstalledPrinters(): Promise<Printer[]> {
    return this.registry.list(true);
  }

  async getPrinterCapabilities(printerId: string): Promise<PrinterCapabilities | null> {
    return this.registry.getCapabilities(printerId);
  }

  async printFile(args: PrintFileArgs): Promise<PrintResult> {
    if (args.printer.connection.type !== 'os') {
      throw new Error('WindowsPrintAdapter: only system printers are supported in MVP');
    }
    const exe = resolveSumatraPath();
    const queue = args.printer.connection.queueName;
    const argv = buildSumatraArgs(queue, args.filePath, args.settings);

    return new Promise((resolve, reject) => {
      const child = spawn(exe, argv, { windowsHide: true });
      args.onProgress?.(0.1); // best-effort: "dispatched"

      const onAbort = (): void => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      };
      args.signal.addEventListener('abort', onAbort);

      child.on('error', (err) => {
        args.signal.removeEventListener('abort', onAbort);
        reject(err);
      });

      child.on('exit', (code) => {
        args.signal.removeEventListener('abort', onAbort);
        args.onProgress?.(1);
        if (args.signal.aborted) {
          resolve({ pid: child.pid ?? -1, exitCode: code ?? -1 });
          return;
        }
        if (code === 0) {
          resolve({ pid: child.pid ?? -1, exitCode: 0 });
        } else {
          reject(new Error(`SumatraPDF exited with code ${code}`));
        }
      });
    });
  }
}

function resolveSumatraPath(): string {
  // Bundled location (packaged app) vs dev location.
  const bundled = path.join(
    process.resourcesPath || '',
    'SumatraPDF.exe',
  );
  if (fs.existsSync(bundled)) return bundled;

  const devPath = path.join(
    app?.getAppPath?.() ?? process.cwd(),
    'resources',
    'SumatraPDF.exe',
  );
  if (fs.existsSync(devPath)) return devPath;

  // Fall back to PATH lookup — user may have installed SumatraPDF system-wide.
  return 'SumatraPDF.exe';
}
