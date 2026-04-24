import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { computeBookletLayout } from '@appname/shared';
import { bookletsDir } from './paths';

export interface ImposeInput {
  sessionId: string;
  jobId: string;
  inputPdfPaths: string[];
  rtl: boolean;
}

export interface ImposeResult {
  outputPath: string;
  sheetCount: number;
  sourcePages: number;
  blankPagesAdded: number;
}

/**
 * Saddle-stitched booklet imposition. Produces one output PDF where each page
 * is a two-up layout of the source pages, arranged per `computeBookletLayout`.
 *
 * NOTE: Assumes uniform source page size across inputs. Mixed sizes will be
 * placed onto an output sheet sized to the first input's first page and
 * centered; the JobManager warns the user before calling us if sizes differ.
 */
export async function imposeBooklet(input: ImposeInput): Promise<ImposeResult> {
  // 1. Merge all inputs into one logical page list.
  const merged = await PDFDocument.create();
  for (const p of input.inputPdfPaths) {
    const bytes = await fs.readFile(p);
    const src = await PDFDocument.load(bytes);
    const copied = await merged.copyPages(src, src.getPageIndices());
    copied.forEach((pg) => merged.addPage(pg));
  }

  const sourcePages = merged.getPageCount();
  if (sourcePages < 1) throw new Error('imposeBooklet: no pages');

  const layout = computeBookletLayout(sourcePages, input.rtl);

  // Determine output sheet size from first input page.
  const firstPage = merged.getPage(0);
  const srcWidth = firstPage.getWidth();
  const srcHeight = firstPage.getHeight();
  // Output is two-up landscape of the source.
  const outWidth = srcWidth * 2;
  const outHeight = srcHeight;

  const output = await PDFDocument.create();

  // 2. For each sheet, emit front then back as two output pages.
  for (const sheet of layout.sheets) {
    for (const side of [sheet.front, sheet.back] as const) {
      const page = output.addPage([outWidth, outHeight]);
      await placeSourcePage(output, merged, side.left, page, 0, 0, srcWidth, srcHeight);
      await placeSourcePage(output, merged, side.right, page, srcWidth, 0, srcWidth, srcHeight);
    }
  }

  const outDir = bookletsDir(input.sessionId);
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${input.jobId}.pdf`);
  const bytes = await output.save();
  await fs.writeFile(outPath, bytes);

  return {
    outputPath: outPath,
    sheetCount: layout.sheetCount,
    sourcePages,
    blankPagesAdded: layout.blankPagesAdded,
  };
}

async function placeSourcePage(
  outDoc: PDFDocument,
  srcDoc: PDFDocument,
  pageNumber: number, // 1-based, or 0 for blank
  destPage: import('pdf-lib').PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<void> {
  if (pageNumber === 0) return; // blank slot
  const srcIndex = pageNumber - 1;
  if (srcIndex < 0 || srcIndex >= srcDoc.getPageCount()) return;
  const [embedded] = await outDoc.embedPages([srcDoc.getPage(srcIndex)]);
  if (!embedded) return;
  destPage.drawPage(embedded, { x, y, width, height });
}
