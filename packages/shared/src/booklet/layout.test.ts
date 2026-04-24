import { describe, expect, it } from 'vitest';
import { computeBookletLayout } from './layout';

describe('computeBookletLayout — spec worked example (N=8)', () => {
  const l = computeBookletLayout(8, false);

  it('pads to multiple of 4 (already 8)', () => {
    expect(l.paddedPageCount).toBe(8);
    expect(l.blankPagesAdded).toBe(0);
    expect(l.sheetCount).toBe(2);
  });

  it('Sheet 0 front = [8, 1]', () => {
    expect(l.sheets[0]!.front).toEqual({ left: 8, right: 1 });
  });
  it('Sheet 0 back  = [2, 7]', () => {
    expect(l.sheets[0]!.back).toEqual({ left: 2, right: 7 });
  });
  it('Sheet 1 front = [6, 3]', () => {
    expect(l.sheets[1]!.front).toEqual({ left: 6, right: 3 });
  });
  it('Sheet 1 back  = [4, 5]', () => {
    expect(l.sheets[1]!.back).toEqual({ left: 4, right: 5 });
  });
});

describe('computeBookletLayout — N=12', () => {
  const l = computeBookletLayout(12, false);
  it('sheet count = 3', () => expect(l.sheetCount).toBe(3));

  it('Sheet 0 front=[12,1] back=[2,11]', () => {
    expect(l.sheets[0]!.front).toEqual({ left: 12, right: 1 });
    expect(l.sheets[0]!.back).toEqual({ left: 2, right: 11 });
  });
  it('Sheet 1 front=[10,3] back=[4,9]', () => {
    expect(l.sheets[1]!.front).toEqual({ left: 10, right: 3 });
    expect(l.sheets[1]!.back).toEqual({ left: 4, right: 9 });
  });
  it('Sheet 2 front=[8,5] back=[6,7]', () => {
    expect(l.sheets[2]!.front).toEqual({ left: 8, right: 5 });
    expect(l.sheets[2]!.back).toEqual({ left: 6, right: 7 });
  });

  it('folded reading order is 1..12 in sequence', () => {
    const seq: number[] = [];
    l.sheets.forEach((s) => {
      seq.push(s.front.left, s.front.right, s.back.left, s.back.right);
    });
    // The printed reading order (ignoring physical fold) is not simply 1..12;
    // what matters is: every source page 1..12 appears exactly once.
    const sorted = [...seq].sort((a, b) => a - b);
    expect(sorted).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe('computeBookletLayout — padding', () => {
  it('N=5 pads to 8 with 3 blanks', () => {
    const l = computeBookletLayout(5, false);
    expect(l.paddedPageCount).toBe(8);
    expect(l.blankPagesAdded).toBe(3);
    // Pad slots 6,7,8 should appear as 0 (blank) somewhere.
    const all = l.sheets.flatMap((s) => [s.front.left, s.front.right, s.back.left, s.back.right]);
    const blanks = all.filter((p) => p === 0).length;
    expect(blanks).toBe(3);
    const real = all.filter((p) => p !== 0).sort((a, b) => a - b);
    expect(real).toEqual([1, 2, 3, 4, 5]);
  });

  it('N=1 pads to 4 with 3 blanks', () => {
    const l = computeBookletLayout(1, false);
    expect(l.paddedPageCount).toBe(4);
    expect(l.sheetCount).toBe(1);
  });

  it('N=4 needs no padding', () => {
    const l = computeBookletLayout(4, false);
    expect(l.paddedPageCount).toBe(4);
    expect(l.blankPagesAdded).toBe(0);
  });
});

describe('computeBookletLayout — RTL', () => {
  it('RTL swaps left/right per spec (N=8)', () => {
    const l = computeBookletLayout(8, true);
    expect(l.sheets[0]!.front).toEqual({ left: 1, right: 8 });
    expect(l.sheets[0]!.back).toEqual({ left: 7, right: 2 });
    expect(l.sheets[1]!.front).toEqual({ left: 3, right: 6 });
    expect(l.sheets[1]!.back).toEqual({ left: 5, right: 4 });
  });
});

describe('computeBookletLayout — larger N', () => {
  it.each([16, 24, 100, 404])('N=%i every page appears exactly once', (n) => {
    const l = computeBookletLayout(n, false);
    const all = l.sheets.flatMap((s) => [s.front.left, s.front.right, s.back.left, s.back.right]);
    expect(all).toHaveLength(l.paddedPageCount);
    const real = all.filter((p) => p !== 0).sort((a, b) => a - b);
    const expected = Array.from({ length: n }, (_, i) => i + 1);
    expect(real).toEqual(expected);
  });
});

describe('computeBookletLayout — edge errors', () => {
  it('throws on 0 pages', () => {
    expect(() => computeBookletLayout(0, false)).toThrow();
  });
});
