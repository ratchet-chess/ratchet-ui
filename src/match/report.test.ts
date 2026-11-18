import { describe, expect, it } from 'vitest';
import { matchText, standingsText, tiebreaks } from './report.ts';
import { summarize, type GameRecord, type Result } from './summary.ts';

const pair = (n: number, a: number, b: number, first: Result, second: Result): GameRecord[] => [
  { pair: n, game: 0, white: a, black: b, result: first, reason: '', plies: 80 },
  { pair: n, game: 1, white: b, black: a, result: second, reason: '', plies: 80 },
];

describe('tiebreaks', () => {
  it('ranks a Swiss by Buchholz first, other fields by SB, a match and a knockout by none', () => {
    expect(tiebreaks({ kind: 'swiss', rounds: 3 })).toEqual(['buchholz', 'sb']);
    expect(tiebreaks({ kind: 'roundrobin', cycles: 1 })).toEqual(['sb']);
    expect(tiebreaks({ kind: 'knockout', pairs: 1 })).toEqual([]);
    expect(tiebreaks({ kind: 'match', pairs: 1, sprt: null })).toEqual([]);
  });
});

describe('matchText', () => {
  it("writes OpenBench's stat block, with the LLR when there is an SPRT", () => {
    const sprt = { elo0: 0, elo1: 5, alpha: 0.05, beta: 0.05 };
    const m = summarize({ kind: 'match', pairs: 10, sprt }, 2, [
      ...pair(0, 0, 1, '1-0', '1/2-1/2'),
      ...pair(1, 0, 1, '1/2-1/2', '1/2-1/2'),
      ...pair(2, 0, 1, '0-1', '0-1'),
    ]).match;
    if (!m) throw new Error('no match statistics');
    const text = matchText('a vs b', '10+0.1 · start position', m).split('\n');
    expect(text[0]).toBe('a vs b');
    expect(text[1]).toMatch(/^Elo {3}\| [+-]\d+\.\d\d \+- \d+\.\d \(95%\)$/);
    expect(text[3]).toBe('Setup | 10+0.1 · start position');
    expect(text[4]).toMatch(/^LLR {3}\| -?\d\.\d\d \(-2\.94, 2\.94\)$/);
    expect(text.slice(5)).toEqual(['Games | N: 6 W: 2 D: 3 L: 1', 'Penta | [0, 0, 2, 1, 0]']);
  });
});

describe('standingsText', () => {
  it('lines the columns up, with the format’s tiebreaks', () => {
    const format = { kind: 'roundrobin', cycles: 1 } as const;
    const s = summarize(format, 3, [
      ...pair(0, 0, 1, '1-0', '0-1'),
      ...pair(1, 1, 2, '1/2-1/2', '1/2-1/2'),
      ...pair(2, 2, 0, '0-1', '1-0'),
    ]);
    const text = standingsText('RR', format, s.standings, ['alpha', 'b', 'c'], '6 of 6 games');
    expect(text).toBe(
      [
        'RR',
        '',
        '#  engine  games  W  D  L  points   score    SB   Elo',
        '1  alpha       4  4  0  0     4.0  100.0%  4.00     -',
        '2  b           4  0  2  2     1.0   25.0%  1.00  -191',
        '3  c           4  0  2  2     1.0   25.0%  1.00  -191',
        '',
        '6 of 6 games',
      ].join('\n'),
    );
  });
});

describe('matchText of one game per opening', () => {
  it('writes no pentanomial: the games line holds the wins, draws and losses', () => {
    const one = (n: number, result: Result): GameRecord => ({
      pair: n,
      game: 0,
      white: n % 2,
      black: 1 - (n % 2),
      result,
      reason: '',
      plies: 80,
    });
    const m = summarize(
      { kind: 'match', pairs: 10, sprt: null },
      2,
      [one(0, '1-0'), one(1, '0-1'), one(2, '1/2-1/2')],
      [],
      false,
    ).match;
    if (!m) throw new Error('no match statistics');
    const text = matchText('a vs b', '1s/move · start position', m).split('\n');
    expect(text.slice(4)).toEqual(['Games | N: 3 W: 2 D: 1 L: 0']);
  });
});
