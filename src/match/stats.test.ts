import { describe, expect, it } from 'vitest';
import {
  bounds,
  bucket,
  elo,
  gameBucket,
  likelihoodOfSuperiority,
  llr,
  los,
  nelo,
  sprtGames,
  Z95,
  type Ptnml,
  type Trinomial,
} from './stats.ts';

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

/** within fastchess's own tolerance: its tests give 2 decimals at 1% */
const off = (x: number, expected: number) => Math.abs(x - expected) / Math.abs(expected);

describe('the trinomial statistics match fastchess’s tests', () => {
  // fastchess's Stats(wins, losses, draws), here as losses, draws, wins
  it('nElo and Elo as EloWDL gives them', () => {
    const one: Trinomial = [89, 123, 76];
    expect(off(nelo(one).value, -20.76)).toBeLessThan(0.01);
    expect(off(nelo(one).ci, 40.13)).toBeLessThan(0.01);
    const two: Trinomial = [96, 111, 136];
    expect(off(nelo(two).value, 49.77)).toBeLessThan(0.01);
    expect(off(nelo(two).ci, 36.77)).toBeLessThan(0.01);
    expect(off(elo(two).value, 40.7)).toBeLessThan(0.01);
    expect(off(elo(two).ci, 30.43)).toBeLessThan(0.01);
    const three: Trinomial = [356, 0, 34];
    expect(off(nelo(three).value, -508.44)).toBeLessThan(0.01);
    expect(off(nelo(three).ci, 34.48)).toBeLessThan(0.01);
  });

  it('the normalized LLR as SPRT::getLLR(win, draw, loss) gives it', () => {
    expect(off(llr([36027, 68692, 36433], 0, 2), 0.92)).toBeLessThan(0.01);
    expect(off(llr([10650, 20431, 10871], -1.75, 0.25), 2.3)).toBeLessThan(0.01);
    expect(off(llr([0, 0, 4250], 0, 10), 120.56)).toBeLessThan(0.01);
  });

  it('a game falls in the bucket of its points', () => {
    expect([gameBucket(0), gameBucket(0.5), gameBucket(1)]).toEqual([0, 1, 2]);
  });
});

describe('likelihoodOfSuperiority', () => {
  it('is a half at no difference and follows the normal law', () => {
    expect(likelihoodOfSuperiority(0, 20)).toBeCloseTo(0.5, 7);
    // a difference of one standard error (the 95% half-interval over 1.96) is 84.13%
    expect(likelihoodOfSuperiority(10, 19.59963984540054)).toBeCloseTo(0.841345, 5);
    expect(likelihoodOfSuperiority(5, 0)).toBe(1);
  });
});

describe('los', () => {
  it('reads the same z as nElo, mirrors, and settles a one-bucket match', () => {
    const counts: Ptnml = [3, 20, 50, 25, 2];
    const n = nelo(counts);
    expect(los(counts)).toBeCloseTo(likelihoodOfSuperiority(n.value, (n.ci * Z95) / 1.96), 9);
    expect(los(counts) + los([2, 25, 50, 20, 3])).toBeCloseTo(1, 12);
    expect(los([0, 0, 0, 0, 7])).toBe(1);
    expect(los([7, 0, 0, 0, 0])).toBe(0);
    expect(los([0, 0, 7, 0, 0])).toBe(0.5);
    expect(los([0, 0, 0, 0, 0])).toBe(0.5);
    expect(los([10, 30, 40] as Trinomial)).toBeGreaterThan(0.5);
  });
});

// values from this port, held so a change to the fit cannot move them unseen
describe('the LLR on a drawish match', () => {
  it('reads a drawish match at ordinary bounds toward H0', () => {
    expect(llr([0, 0, 5000, 3, 0], 0, 10)).toBeCloseTo(-1.029, 2);
    expect(llr([0, 0, 3000, 1, 0], 0, 10)).toBeCloseTo(-1.972, 2);
  });
});
