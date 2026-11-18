import { describe, expect, it } from 'vitest';
import type { Format } from './format.ts';
import { matchSeries } from './series.ts';
import { summarize, type GameRecord, type Result } from './summary.ts';

const RESULTS: Result[] = ['1-0', '1/2-1/2', '0-1'];

/** `n` pairs of a match, their games finishing out of order as concurrent games do */
function games(n: number): GameRecord[] {
  const out: GameRecord[] = [];
  let seed = 7;
  const next = () => (seed = (seed * 48271) % 2147483647);
  for (let p = 0; p < n; p++) {
    for (const game of [0, 1] as const) {
      out.push({
        pair: p,
        game,
        white: game === 0 ? 0 : 1,
        black: game === 0 ? 1 : 0,
        result: RESULTS[next() % 3] ?? '1/2-1/2',
        reason: '',
        plies: 50,
      });
    }
  }
  // swap neighbors, so a pair's second game may finish before its first
  return out
    .map((_, i) => out[i % 3 === 0 && i + 1 < out.length ? i + 1 : i % 3 === 1 ? i - 1 : i])
    .filter((g) => g !== undefined);
}

describe('matchSeries', () => {
  const sprt = { elo0: 0, elo1: 5, alpha: 0.05, beta: 0.05 };
  const format: Format = { kind: 'match', pairs: 1000, sprt };

  it("ends at the match's own statistics", () => {
    const g = games(500);
    const series = matchSeries(g, sprt);
    const last = series.at(-1);
    const match = summarize(format, 2, g).match;
    expect(last?.pairs).toBe(500);
    expect(last?.llr).toBeCloseTo(match?.llr ?? NaN, 12);
    expect(last?.nelo.value).toBeCloseTo(match?.nelo.value ?? NaN, 12);
    expect(last?.elo.ci).toBeCloseTo(match?.elo.ci ?? NaN, 12);
  });

  it('keeps at most the samples asked for, evenly spaced', () => {
    const series = matchSeries(games(1000), sprt, 100);
    expect(series).toHaveLength(100);
    expect(series[0]?.pairs).toBe(10);
    expect(series[49]?.pairs).toBe(500);
  });

  it('has a point per pair when there are few, and none before a pair finishes', () => {
    expect(matchSeries(games(3), null).map((p) => p.pairs)).toEqual([1, 2, 3]);
    expect(matchSeries(games(3), null)[0]?.llr).toBeNull();
    expect(matchSeries(games(1).slice(0, 1), sprt)).toEqual([]);
  });
});

describe('matchSeries of one game per opening', () => {
  const sprt = { elo0: 0, elo1: 5, alpha: 0.05, beta: 0.05 };
  const format: Format = { kind: 'match', pairs: 1000, sprt };

  it("ends at the match's own trinomial statistics, a point a game", () => {
    const g = games(300).filter((x) => x.game === 0);
    const series = matchSeries(g, sprt, 200, false);
    const last = series.at(-1);
    const match = summarize(format, 2, g, [], false).match;
    expect(match?.model).toBe('trinomial');
    expect(last?.pairs).toBe(300);
    expect(last?.llr).toBeCloseTo(match?.llr ?? NaN, 12);
    expect(last?.nelo.value).toBeCloseTo(match?.nelo.value ?? NaN, 12);
    expect(last?.elo.ci).toBeCloseTo(match?.elo.ci ?? NaN, 12);
    expect(matchSeries(g.slice(0, 3), null, 200, false).map((p) => p.pairs)).toEqual([1, 2, 3]);
  });
});
