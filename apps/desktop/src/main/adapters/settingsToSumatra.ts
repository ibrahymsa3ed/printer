import type { PrintSettings } from '@appname/shared';

/**
 * Convert PrintSettings → SumatraPDF `-print-settings` string.
 *
 * The string syntax is fragile — unknown tokens are silently ignored by
 * SumatraPDF. Funnel ALL construction through this single function so bugs
 * show up once, in tests, not spread across the codebase.
 *
 * Tokens reference: https://www.sumatrapdfreader.org/docs/Command-line-arguments
 */
export function settingsToSumatra(settings: PrintSettings): string {
  const tokens: string[] = [];
  tokens.push(`${settings.copies}x`);

  tokens.push(`paper=${mapPaper(settings.paperSize)}`);

  tokens.push(settings.colorMode === 'color' ? 'color' : 'monochrome');

  tokens.push(settings.orientation);

  switch (settings.duplex) {
    case 'long-edge':
      tokens.push('duplex');
      break;
    case 'short-edge':
      tokens.push('duplexshort');
      break;
    case 'none':
      tokens.push('simplex');
      break;
  }

  tokens.push(settings.fitToPage ? 'fit' : 'noscale');

  if (settings.pageRange !== 'all') {
    // SumatraPDF uses -print-settings for options; page range is passed via
    // the `odd`/`even` tokens or the separate `-print-settings "N-M"` form.
    // The cleanest approach is to emit a range token here; the adapter
    // appends it via a separate CLI flag if needed.
  }

  return tokens.join(',');
}

function mapPaper(size: string): string {
  const s = size.toLowerCase();
  if (s === 'a4') return 'A4';
  if (s === 'a3') return 'A3';
  if (s === 'letter') return 'letter';
  if (s === 'legal') return 'legal';
  return size; // pass through
}

/**
 * Build the full argv list for SumatraPDF including page range (if any).
 */
export function buildSumatraArgs(
  printerQueueName: string,
  pdfPath: string,
  settings: PrintSettings,
): string[] {
  const args = [
    '-silent',
    '-print-to',
    printerQueueName,
    '-print-settings',
    settingsToSumatra(settings),
  ];
  if (settings.pageRange !== 'all') {
    args.push(
      '-print-settings',
      `${settings.pageRange.from}-${settings.pageRange.to}`,
    );
  }
  args.push(pdfPath);
  return args;
}
