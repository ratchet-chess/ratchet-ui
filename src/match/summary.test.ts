import { describe, expect, it } from 'vitest';
import { BYE } from './format.ts';
import { summarize, type GameRecord, type Result } from './summary.ts';

/** a pair's two games: `a` White first, then Black */
const pair = (n: number, a: number, b: number, first: Result, second: Result): GameRecord[] => [
  { pair: n, game: 0, white: a, black: b, result: first, reason: '', plies: 80 },
  { pair: n, game: 1, white: b, black: a, result: second, reason: '', plies: 80 },
];

describe('summarize', () => {
  it("counts a match's pairs from the tested engine's side", () => {
    const games = [
      ...pair(0, 0, 1, '1-0', '1/2-1/2'), // 1.5: bucket 3
      ...pair(1, 0, 1, '1-0', '1-0'), // 1: bucket 2
      ...pair(2, 0, 1, '0-1', '1/2-1/2'), // 0.5: bucket 1
      ...pair(3, 0, 1, '1/2-1/2', '0-1').slice(0, 1), // a pair still playing
    ];
    const s = summarize(
      { kind: 'match', pairs: 10, sprt: { elo0: 0, elo1: 10, alpha: 0.05, beta: 0.05 } },
      2,
      games,
    );
    expect(s.pairsDone).toBe(3);
    expect(s.match?.ptnml).toEqual([0, 1, 1, 1, 0]);
    expect(s.match?.wdl).toEqual([2, 3, 2]);
    expect(s.match?.llr).not.toBeNull();
    expect(s.match?.verdict).toBeNull();
  });

  it('ranks a round robin by points and fills its crosstable', () => {
    const games = [
      ...pair(0, 0, 1, '1-0', '0-1'),
      ...pair(1, 1, 2, '1/2-1/2', '1/2-1/2'),
      ...pair(2, 2, 0, '0-1', '1-0'),
    ];
    const s = summarize({ kind: 'roundrobin', cycles: 1 }, 3, games);
    expect(s.standings.map((r) => [r.entrant, r.points])).toEqual([
      [0, 4],
      [1, 1],
      [2, 1],
    ]);
    expect(s.points[0]?.[1]).toBe(2);
    expect(s.games[1]?.[2]).toBe(2);
    expect(s.match).toBeNull();
    expect(s.standings[0]?.elo).toBeNull();
  });

  it('scores a Swiss bye as a point', () => {
    const s = summarize({ kind: 'swiss', rounds: 1 }, 3, pair(0, 0, 1, '1-0', '0-1'), [
      { pair: 0, a: 0, b: 1, round: 0, opening: '' },
      { pair: 1, a: 2, b: BYE, round: 0, opening: '' },
    ]);
    expect(s.standings.map((r) => [r.entrant, r.points, r.games, r.byes, r.elo])).toEqual([
      [0, 2, 2, 0, null],
      [2, 1, 0, 1, null],
      [1, 0, 2, 0, null],
    ]);
  });
});
