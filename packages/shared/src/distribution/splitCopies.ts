export function splitCopies(
  totalCopies: number,
  printerIds: string[],
): Record<string, number> {
  if (printerIds.length === 0) throw new Error('splitCopies: no printers');
  if (totalCopies < 1) throw new Error('splitCopies: copies < 1');
  if (!Number.isInteger(totalCopies)) throw new Error('splitCopies: non-integer copies');

  const base = Math.floor(totalCopies / printerIds.length);
  const remainder = totalCopies % printerIds.length;

  const out: Record<string, number> = {};
  printerIds.forEach((id, i) => {
    out[id] = base + (i < remainder ? 1 : 0);
  });
  return out;
}

export function pruneZeroCopies(
  distribution: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(distribution)) {
    if (v > 0) out[k] = v;
  }
  return out;
}
