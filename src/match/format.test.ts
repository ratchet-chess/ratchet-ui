import { describe, expect, it } from 'vitest';
import { bergerRounds, schedule, gamesPerPair, plannedGames } from './format.ts';

/** each unordered match, as "x-y" with x < y */
const key = (x: number, y: number) => (x < y ? `${x}-${y}` : `${y}-${x}`);

describe('bergerRounds', () => {
  for (const n of [2, 3, 4, 5, 8]) {
    it(`meets every pair of ${n} engines once, and each engine at most once a round`, () => {
      const rounds = bergerRounds(n);
      const met = new Map<string, number>();
      for (const round of rounds) {
        const seen = new Set<number>();
        for (const [x, y] of round) {
          expect(seen.has(x) || seen.has(y)).toBe(false);
          seen.add(x);
          seen.add(y);
          met.set(key(x, y), (met.get(key(x, y)) ?? 0) + 1);
        }
      }
      expect(met.size).toBe((n * (n - 1)) / 2);
      expect([...met.values()].every((v) => v === 1)).toBe(true);
    });
  }

  it('gives each engine of an even field the first White in about half its rounds', () => {
    const whites = Array.from({ length: 6 }, () => 0);
    for (const round of bergerRounds(6)) for (const [x] of round) whites[x] = (whites[x] ?? 0) + 1;
    for (const w of whites) expect(Math.abs(w - 2.5)).toBeLessThanOrEqual(1.5);
  });
});

describe('schedule', () => {
  it('plays a match as pairs of the first engine against the second', () => {
    expect(schedule({ kind: 'match', pairs: 3, sprt: null }, 2)).toEqual([
      { a: 0, b: 1, round: 0 },
      { a: 0, b: 1, round: 1 },
      { a: 0, b: 1, round: 2 },
    ]);
  });

  it('plays a round robin cycle by cycle, swapping the first White', () => {
    const s = schedule({ kind: 'roundrobin', cycles: 2 }, 4);
    expect(s).toHaveLength(12);
    const first = s.slice(0, 6).map((m) => `${m.a}-${m.b}`);
    const second = s.slice(6).map((m) => `${m.b}-${m.a}`);
    expect(second).toEqual(first);
  });

  it('pairs a gauntlet seed with every other engine, and no others', () => {
    const s = schedule({ kind: 'gauntlet', seeds: 1, cycles: 1 }, 4);
    expect(s.map((m) => key(m.a, m.b)).toSorted()).toEqual(['0-1', '0-2', '0-3']);
  });
});

describe('one game per opening', () => {
  it('alternates the colors of a match, the first engine White first', () => {
    expect(schedule({ kind: 'match', pairs: 4, sprt: null }, 2, false)).toEqual([
      { a: 0, b: 1, round: 0 },
      { a: 1, b: 0, round: 1 },
      { a: 0, b: 1, round: 2 },
      { a: 1, b: 0, round: 3 },
    ]);
  });

  it('keeps the schedule of a round robin and a gauntlet, each pair now one game', () => {
    for (const f of [
      { kind: 'roundrobin', cycles: 2 },
      { kind: 'gauntlet', seeds: 2, cycles: 1 },
    ] as const)
      expect(schedule(f, 5, false)).toEqual(schedule(f, 5));
  });

  it('plans one game a pair, but a Swiss and a knockout still play pairs', () => {
    expect(plannedGames({ kind: 'match', pairs: 50, sprt: null }, 2, false)).toBe(50);
    expect(plannedGames({ kind: 'roundrobin', cycles: 2 }, 4, false)).toBe(12);
    expect(plannedGames({ kind: 'roundrobin', cycles: 2 }, 4)).toBe(24);
    expect(plannedGames({ kind: 'gauntlet', seeds: 1, cycles: 1 }, 4, false)).toBe(3);
    expect(plannedGames({ kind: 'swiss', rounds: 3 }, 4, false)).toBe(12);
    expect(plannedGames({ kind: 'knockout', pairs: 2 }, 4, false)).toBe(12);
    expect(gamesPerPair({ kind: 'swiss', rounds: 3 }, false)).toBe(2);
    expect(gamesPerPair({ kind: 'knockout', pairs: 1 }, false)).toBe(2);
    expect(gamesPerPair({ kind: 'match', pairs: 1, sprt: null }, false)).toBe(1);
  });
});
