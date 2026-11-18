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

  /** games between a and b, each scoring `pa` points for a, `count` of them, colors alternating */
  const games = (rows: [a: number, b: number, pa: number, count: number][]): GameRecord[] => {
    const out: GameRecord[] = [];
    for (const [a, b, pa, count] of rows) {
      for (let k = 0; k < count; k++) {
        const white = k % 2 === 0 ? a : b;
        const aWins: Result = white === a ? '1-0' : '0-1';
        const bWins: Result = white === a ? '0-1' : '1-0';
        const result = pa === 1 ? aWins : pa === 0 ? bWins : '1/2-1/2';
        out.push({
          pair: out.length >> 1,
          game: out.length % 2 === 0 ? 0 : 1,
          white,
          black: white === a ? b : a,
          result,
          reason: '',
          plies: 60,
        });
      }
    }
    return out;
  };

  it("breaks ties by Sonneborn-Berger, as fastchess-gui's table test", () => {
    // A beats B and C, draws D; B beats C, loses to D; C beats D: two games each
    const s = summarize(
      { kind: 'roundrobin', cycles: 1 },
      4,
      games([
        [0, 1, 1, 2],
        [0, 2, 1, 2],
        [0, 3, 0.5, 2],
        [1, 2, 1, 2],
        [1, 3, 0, 2],
        [2, 3, 1, 2],
      ]),
    );
    expect(s.standings.map((r) => [r.entrant, r.points, r.sb])).toEqual([
      [0, 5, 2 * 2 + 2 * 2 + 1 * 3],
      [3, 3, 1 * 5 + 2 * 2],
      [2, 2, 2 * 3],
      [1, 2, 2 * 2],
    ]);
  });

  it('orders a remaining tie by head to head', () => {
    // B and D tie on points and Sonneborn-Berger, with a win each; D beat B
    const s = summarize(
      { kind: 'roundrobin', cycles: 1 },
      4,
      games([
        [1, 0, 1, 1],
        [2, 0, 1, 1],
        [0, 3, 0.5, 1],
        [1, 2, 0.5, 1],
        [3, 1, 1, 1],
        [2, 3, 1, 1],
      ]),
    );
    expect(s.standings.map((r) => r.entrant)).toEqual([2, 3, 1, 0]);
  });

  it('ranks a Swiss by Buchholz before Sonneborn-Berger; a bye adds to neither', () => {
    const s = summarize(
      { kind: 'swiss', rounds: 2 },
      3,
      [...pair(0, 0, 1, '1-0', '0-1'), ...pair(1, 2, 0, '1-0', '1/2-1/2')],
      [
        { pair: 0, a: 0, b: 1, round: 0, opening: '' },
        { pair: 1, a: 2, b: BYE, round: 0, opening: '' },
        { pair: 2, a: 2, b: 0, round: 1, opening: '' },
        { pair: 3, a: 1, b: BYE, round: 1, opening: '' },
      ],
    );
    const byEntrant = new Map(s.standings.map((r) => [r.entrant, r]));
    // 0: 2 + 0.5 = 2.5 from games; 1: a bye's point; 2: 1.5 + a bye's point = 2.5
    expect(byEntrant.get(0)?.buchholz).toBe(2 * 1 + 2 * 2.5);
    expect(byEntrant.get(1)?.buchholz).toBe(2 * 2.5);
    expect(byEntrant.get(2)?.buchholz).toBe(2 * 2.5);
    // 0 and 2 tie on points; 0 met the stronger field
    expect(s.standings.map((r) => r.entrant)).toEqual([0, 2, 1]);
  });
});
