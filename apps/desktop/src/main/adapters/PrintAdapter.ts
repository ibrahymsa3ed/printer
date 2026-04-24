import type { Printer, PrinterCapabilities, PrintSettings } from '@appname/shared';

export interface PrintFileArgs {
  filePath: string;
  printer: Printer;
  settings: PrintSettings;
  onProgress?: (p: number) => void;
  signal: AbortSignal;
}

export interface PrintResult {
  pid: number;
  exitCode: number;
}

/**
 * Platform-agnostic print surface. The MVP ships WindowsPrintAdapter only;
 * MacPrintAdapter (lpr/CUPS) would slot in here without changes above the
 * adapter.
 */
export interface PrintAdapter {
  getInstalledPrinters(): Promise<Printer[]>;
  getPrinterCapabilities(printerId: string): Promise<PrinterCapabilities | null>;
  printFile(args: PrintFileArgs): Promise<PrintResult>;
}
