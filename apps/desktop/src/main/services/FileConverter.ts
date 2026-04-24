import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import type { FileEntry } from '@appname/shared';
import type { TempManager } from './TempManager';

const execFileP = promisify(execFile);

export interface FileConverterOptions {
  libreOfficePath?: string | null;
}

/**
 * Phase 1 accepts PDF only — non-PDF inputs are rejected at add-time with
 * `conversionStatus='failed'` and error `NOT_IMPLEMENTED`.
 * Phase 2 lights up LibreOffice via the same surface.
 */
export class FileConverter {
  constructor(
    private temp: TempManager,
    private opts: FileConverterOptions = {},
  ) {}

  async ensurePdf(originalPath: string): Promise<FileEntry> {
    const ext = path.extname(originalPath).toLowerCase();
    const stat = await fs.stat(originalPath);
    const hash = await this.temp.hashSource(originalPath);

    const entry: FileEntry = {
      id: crypto.randomUUID(),
      originalPath,
      originalName: path.basename(originalPath),
      mimeType: guessMime(ext),
      sizeBytes: stat.size,
      addedAt: new Date().toISOString(),
      normalizedPdfPath: null,
      pageCount: null,
      conversionStatus: 'pending',
      conversionError: null,
      sourceHash: hash,
    };

    // Cache hit?
    const cached = await this.temp.findByHash(hash);
    if (cached) {
      entry.normalizedPdfPath = cached;
      entry.pageCount = await getPageCount(cached);
      entry.conversionStatus = 'ready';
      return entry;
    }

    if (ext === '.pdf') {
      // No conversion — just copy (or symlink fallback) into temp, keyed by hash.
      const target = this.temp.normalizedPdfPath(hash);
      await fs.copyFile(originalPath, target);
      await this.temp.writeMeta(hash, originalPath);
      entry.normalizedPdfPath = target;
      entry.pageCount = await getPageCount(target);
      entry.conversionStatus = 'ready';
      return entry;
    }

    // Non-PDF path — Phase 2.
    if (!this.opts.libreOfficePath) {
      entry.conversionStatus = 'failed';
      entry.conversionError = 'LIBREOFFICE_MISSING';
      return entry;
    }

    try {
      await runLibreOffice(
        this.opts.libreOfficePath,
        originalPath,
        this.temp.sessionDir(),
      );
      // LibreOffice names the output `<basename>.pdf`. Rename to hash form.
      const loOut = path.join(
        this.temp.sessionDir(),
        path.basename(originalPath, ext) + '.pdf',
      );
      const target = this.temp.normalizedPdfPath(hash);
      await fs.rename(loOut, target);
      await this.temp.writeMeta(hash, originalPath);
      entry.normalizedPdfPath = target;
      entry.pageCount = await getPageCount(target);
      entry.conversionStatus = 'ready';
    } catch (err) {
      entry.conversionStatus = 'failed';
      entry.conversionError = `CONVERSION_FAILED: ${(err as Error).message}`;
    }
    return entry;
  }
}

async function runLibreOffice(
  soffice: string,
  input: string,
  outDir: string,
): Promise<void> {
  await execFileP(
    soffice,
    [
      '--headless',
      '--norestore',
      '--nologo',
      '--nofirststartwizard',
      '--convert-to',
      'pdf:writer_pdf_Export',
      '--outdir',
      outDir,
      input,
    ],
    { timeout: 120_000, windowsHide: true },
  );
}

async function getPageCount(pdfPath: string): Promise<number> {
  const bytes = await fs.readFile(pdfPath);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}

function guessMime(ext: string): string {
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}
