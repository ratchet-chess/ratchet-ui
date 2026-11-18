import { describe, expect, it } from 'vitest';
import { bounds, bucket, elo, llr, nelo, sprtGames, type Ptnml } from './stats.ts';

// Each row is what Ratchet's tools/llr.ts and tools/pool.ts print for the same counts.
const ORACLE: { counts: Ptnml; llr: number; nelo: [number, number]; elo: [number, number] }[] = [
  {
    counts: [47, 140, 191, 138, 36],
    llr: -1.386671,
    nelo: [-10.169693, 20.494901],
    elo: [-7.554138, 15.238369],
  },
  {
    counts: [61, 402, 902, 425, 56],
    llr: -0.896683,
    nelo: [2.0657, 11.207262],
    elo: [1.22337, 6.63814],
  },
  {
    counts: [10, 50, 100, 60, 20],
    llr: 1.054664,
    nelo: [31.628649, 31.082057],
    elo: [21.743065, 21.450678],
  },
  {
    counts: [0, 3, 10, 2, 0],
    llr: -0.082788,
    nelo: [-28.559029, 124.328228],
    elo: [-11.585478, 50.834226],
  },
];

describe('the statistics match Ratchet’s', () => {
  for (const o of ORACLE) {
    it(`for ${o.counts.join(' ')}`, () => {
      expect(llr(o.counts, 0, 10)).toBeCloseTo(o.llr, 5);
      expect(nelo(o.counts).value).toBeCloseTo(o.nelo[0], 5);
      expect(nelo(o.counts).ci).toBeCloseTo(o.nelo[1], 5);
      expect(elo(o.counts).value).toBeCloseTo(o.elo[0], 5);
      expect(elo(o.counts).ci).toBeCloseTo(o.elo[1], 5);
    });
  }

  it('every pair in one bucket gives the limit, not a number', () => {
    expect(nelo([0, 0, 0, 0, 9])).toEqual({ value: Infinity, ci: Infinity });
    expect(nelo([9, 0, 0, 0, 0])).toEqual({ value: -Infinity, ci: Infinity });
    expect(nelo([0, 0, 0, 9, 0])).toEqual({ value: Infinity, ci: Infinity });
    expect(nelo([0, 0, 9, 0, 0])).toEqual({ value: 0, ci: Infinity });
    expect(elo([0, 0, 0, 0, 9])).toEqual({ value: Infinity, ci: Infinity });
    expect(elo([9, 0, 0, 0, 0])).toEqual({ value: -Infinity, ci: Infinity });
    expect(elo([0, 0, 0, 9, 0]).ci).toBe(Infinity);
  });

  // 100 simulated SPRTs at nElo 5 and at nElo 0 took a mean of 12043 and 12326 pairs
  it('an SPRT on [0, 5] takes about 25.6k games at a bound', () => {
    expect(sprtGames(0, 5)).toBe(25590);
    expect(sprtGames(-5, 0)).toBe(25590);
  });

  it('bounds at alpha = beta = 0.05 are ±2.94', () => {
    const b = bounds();
    expect(b.lower).toBeCloseTo(-2.944439, 5);
    expect(b.upper).toBeCloseTo(2.944439, 5);
  });

  it('a pair falls in the bucket of its points', () => {
    expect([
      bucket(0, 0),
      bucket(0.5, 0),
      bucket(1, 0),
      bucket(0.5, 0.5),
      bucket(1, 0.5),
      bucket(1, 1),
    ]).toEqual([0, 1, 2, 2, 3, 4]);
  });
});
