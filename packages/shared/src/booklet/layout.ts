export interface SheetLayout {
  sheetIndex: number;
  front: { left: number; right: number };
  back: { left: number; right: number };
}

export interface BookletLayout {
  paddedPageCount: number;
  blankPagesAdded: number;
  sheetCount: number;
  sheets: SheetLayout[];
  rtl: boolean;
}

/**
 * Compute the imposition layout for a saddle-stitched booklet.
 *
 * Algorithm (from spec, verified in tests):
 *   N = smallest multiple of 4 ≥ sourcePageCount (pad with blanks)
 *   sheets = N / 4
 *   for each sheet i (0-based):
 *     front: left = N - 2i,    right = 2i + 1
 *     back:  left = 2i + 2,    right = N - (2i + 1)
 *   if rtl: swap left/right on both sides
 *
 * Page numbers are 1-based. Blank pages are represented as 0 (no such input
 * page exists — the renderer draws a blank).
 */
export function computeBookletLayout(
  sourcePageCount: number,
  rtl: boolean,
): BookletLayout {
  if (sourcePageCount < 1) {
    throw new Error('computeBookletLayout: sourcePageCount < 1');
  }

  const padded = Math.ceil(sourcePageCount / 4) * 4;
  const blanks = padded - sourcePageCount;
  const sheetCount = padded / 4;

  const sheets: SheetLayout[] = [];
  for (let i = 0; i < sheetCount; i++) {
    const frontLeft = padded - 2 * i;
    const frontRight = 2 * i + 1;
    const backLeft = 2 * i + 2;
    const backRight = padded - (2 * i + 1);

    // Convert "pad slot" numbers > sourcePageCount to 0 (blank marker).
    const toOutput = (p: number) => (p > sourcePageCount ? 0 : p);

    const frontL = toOutput(frontLeft);
    const frontR = toOutput(frontRight);
    const backL = toOutput(backLeft);
    const backR = toOutput(backRight);

    sheets.push({
      sheetIndex: i,
      front: rtl
        ? { left: frontR, right: frontL }
        : { left: frontL, right: frontR },
      back: rtl
        ? { left: backR, right: backL }
        : { left: backL, right: backR },
    });
  }

  return {
    paddedPageCount: padded,
    blankPagesAdded: blanks,
    sheetCount,
    sheets,
    rtl,
  };
}
