import { describe, expect, it } from 'vitest';
import { BYE } from './format.ts';
import { unfinished } from './runner.ts';
import type { GameRecord, PairRecord } from './summary.ts';

const pair = (n: number, b = 1): PairRecord => ({ pair: n, a: 0, b, round: n, opening: '' });
const game = (n: number, g: 0 | 1): GameRecord => ({
  pair: n,
  game: g,
  white: 0,
  black: 1,
  result: '1-0',
  reason: '',
  plies: 40,
});

describe('a resumed run', () => {
  const pairs = [pair(0), pair(1), pair(2, BYE), pair(3)];

  it('replays every game of a pair that has no result, but not a bye', () => {
    const left = unfinished(pairs, [game(0, 0), game(0, 1), game(1, 1)], 2);
    expect(left.map((w) => [w.pair.pair, w.game])).toEqual([
      [1, 0],
      [3, 0],
      [3, 1],
    ]);
  });

  it('replays one game a pair with one game per opening', () => {
    const left = unfinished(pairs, [game(0, 0)], 1);
    expect(left.map((w) => [w.pair.pair, w.game])).toEqual([
      [1, 0],
      [3, 0],
    ]);
  });
});
