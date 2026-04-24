import { describe, expect, it } from 'vitest';
import { pruneZeroCopies, splitCopies } from './splitCopies';

describe('splitCopies', () => {
  it('matches spec: 10 copies, 2 printers → [5,5]', () => {
    expect(splitCopies(10, ['a', 'b'])).toEqual({ a: 5, b: 5 });
  });

  it('matches spec: 10 copies, 3 printers → [4,3,3]', () => {
    expect(splitCopies(10, ['a', 'b', 'c'])).toEqual({ a: 4, b: 3, c: 3 });
  });

  it('matches spec: 5 copies, 2 printers → [3,2]', () => {
    expect(splitCopies(5, ['a', 'b'])).toEqual({ a: 3, b: 2 });
  });

  it('single printer takes everything', () => {
    expect(splitCopies(7, ['a'])).toEqual({ a: 7 });
  });

  it('fewer copies than printers → front printers get 1, rest get 0', () => {
    expect(splitCopies(2, ['a', 'b', 'c', 'd'])).toEqual({ a: 1, b: 1, c: 0, d: 0 });
  });

  it('equal split is exact', () => {
    expect(splitCopies(12, ['a', 'b', 'c', 'd'])).toEqual({ a: 3, b: 3, c: 3, d: 3 });
  });

  it('throws on zero printers', () => {
    expect(() => splitCopies(5, [])).toThrow();
  });

  it('throws on copies < 1', () => {
    expect(() => splitCopies(0, ['a'])).toThrow();
    expect(() => splitCopies(-1, ['a'])).toThrow();
  });

  it('throws on non-integer copies', () => {
    expect(() => splitCopies(1.5, ['a'])).toThrow();
  });

  it('sum of distribution equals totalCopies', () => {
    const d = splitCopies(17, ['a', 'b', 'c', 'd', 'e']);
    const sum = Object.values(d).reduce((a, b) => a + b, 0);
    expect(sum).toBe(17);
  });
});

describe('pruneZeroCopies', () => {
  it('removes zero-copy entries', () => {
    expect(pruneZeroCopies({ a: 1, b: 0, c: 2, d: 0 })).toEqual({ a: 1, c: 2 });
  });
  it('leaves non-zero untouched', () => {
    expect(pruneZeroCopies({ a: 3, b: 4 })).toEqual({ a: 3, b: 4 });
  });
  it('handles empty', () => {
    expect(pruneZeroCopies({})).toEqual({});
  });
});
