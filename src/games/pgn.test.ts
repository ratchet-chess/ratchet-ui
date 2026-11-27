import { describe, expect, it } from 'vitest';
import { parseCollection, replay } from './pgn.ts';

/** the n-th game of a PGN text, which the test knows is there */
function nth(text: string, n: number) {
  const g = parseCollection(text).games[n];
  if (!g) throw new Error(`no game ${n}`);
  return g;
}

const TWO = `[Event "test"]
[White "A"]
[Black "B"]
[Result "0-1"]

1. f3 {+0.10/5 0.2s} e5 2. g4 Qh4# 0-1

[Event "test"]
[White "C"]
[Black "D"]
[Result "1-0"]
[SetUp "1"]
[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]

1. O-O O-O-O 1-0
`;

describe('parseCollection', () => {
  it("lists each game's tags and main-line length", () => {
    const { summaries } = parseCollection(TWO);
    expect(summaries.map((s) => [s.tags.White, s.tags.Result, s.plies])).toEqual([
      ['A', '0-1', 4],
      ['C', '1-0', 2],
    ]);
  });
});

describe('replay', () => {
  it('gives each position, its move and its comments', () => {
    const r = replay(nth(TWO, 0));
    expect(r.error).toBe('');
    expect(r.steps.map((s) => s.san)).toEqual(['', 'f3', 'e5', 'g4', 'Qh4#']);
    expect(r.steps[1]?.comments).toEqual(['+0.10/5 0.2s']);
    expect(r.steps.at(-1)?.check).toBe(true);
  });

  it("starts from the FEN tag, and marks castling with the king's squares", () => {
    const r = replay(nth(TWO, 1));
    expect(r.steps[1]?.lastMove).toEqual(['e1', 'g1']);
    expect(r.steps[2]?.lastMove).toEqual(['e8', 'c8']);
  });

  it('stops at a move that is not legal, and says where', () => {
    const r = replay(nth('1. e4 e5 2. Ke3 *\n', 0));
    expect(r.steps).toHaveLength(3);
    expect(r.error).toBe('move 2, Ke3, is not legal here');

    const custom = replay(
      nth('[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4K3/8 w - - 0 25"]\n\n25. Ke5 *\n', 0),
    );
    expect(custom.error).toBe('move 25, Ke5, is not legal here');
  });
});
