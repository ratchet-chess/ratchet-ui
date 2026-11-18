import { describe, expect, it } from 'vitest';
import {
  bracket,
  bracketOrder,
  directorOf,
  knockoutGamesLeft,
  swissRound,
  TIEBREAK_PAIRS,
} from './director.ts';
import { BYE, type Format } from './format.ts';
import type { GameRecord, PairRecord, Result } from './summary.ts';

/** a pair's two games, `a` White first */
const gamesOf = (p: PairRecord, first: Result, second: Result): GameRecord[] => [
  { pair: p.pair, game: 0, white: p.a, black: p.b, result: first, reason: '', plies: 60 },
  { pair: p.pair, game: 1, white: p.b, black: p.a, result: second, reason: '', plies: 60 },
];

/** a deterministic stream of results */
function results(seed: number): () => Result {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    const r = x % 3;
    return r === 0 ? '1-0' : r === 1 ? '0-1' : '1/2-1/2';
  };
}

/** plays a format to its end, each pair finished before the next is asked for */
function playOut(format: Format, n: number, result: (p: PairRecord) => [Result, Result]) {
  const director = directorOf(format, n);
  const pairs: PairRecord[] = [];
  const games: GameRecord[] = [];
  for (let guard = 0; guard < 10_000; guard++) {
    const next = director.next(pairs, games);
    if (next === 'done') return { pairs, games };
    if (next === 'wait') throw new Error('a director waited with nothing in play');
    const p: PairRecord = { pair: pairs.length, ...next, opening: '' };
    pairs.push(p);
    if (p.b !== BYE) games.push(...gamesOf(p, ...result(p)));
  }
  throw new Error('the format never ended');
}

const met = (p: PairRecord) => (p.a < p.b ? `${p.a}-${p.b}` : `${p.b}-${p.a}`);

describe('a fixed schedule', () => {
  it('issues its pairs in order, then is done', () => {
    const { pairs } = playOut({ kind: 'match', pairs: 3, sprt: null }, 2, () => ['1-0', '1-0']);
    expect(pairs.map((p) => [p.a, p.b, p.round])).toEqual([
      [0, 1, 0],
      [0, 1, 1],
      [0, 1, 2],
    ]);
  });
});

describe('Swiss', () => {
  it('pairs the first round top half against bottom half, by seed', () => {
    expect(swissRound(6, [], []).map((m) => [m.a, m.b])).toEqual([
      [0, 3],
      [1, 4],
      [2, 5],
    ]);
  });

  it('gives an odd field’s bye to the lowest ranked engine', () => {
    expect(swissRound(5, [], []).map((m) => [m.a, m.b])).toEqual([
      [0, 2],
      [1, 3],
      [4, BYE],
    ]);
  });

  it('rematches only in a round where every pairing needs one', () => {
    /** whether `left` can be paired with no two that have met */
    const fresh = (left: number[], seen: Set<string>): boolean => {
      const [p, ...rest] = left;
      if (p === undefined) return true;
      return rest.some(
        (q) =>
          !seen.has(p < q ? `${p}-${q}` : `${q}-${p}`) &&
          fresh(
            rest.filter((x) => x !== q),
            seen,
          ),
      );
    };
    /** each round with a rematch, and whether a fresh pairing existed for it */
    const forced: boolean[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const next = results(seed);
      const { pairs } = playOut({ kind: 'swiss', rounds: 7 }, 8, () => [next(), next()]);
      expect(pairs.length).toBe(28);
      for (let r = 0; r < 7; r++) {
        const before = new Set(pairs.filter((p) => p.round < r).map(met));
        const round = pairs.filter((p) => p.round === r);
        if (round.some((p) => before.has(met(p))))
          forced.push(!fresh([0, 1, 2, 3, 4, 5, 6, 7], before));
      }
    }
    // these seeds reach a rematch, so the check runs
    expect(forced.length).toBeGreaterThan(0);
    expect(forced.every(Boolean)).toBe(true);
  });

  it('gives each engine of an odd field one bye before any has two', () => {
    const next = results(9);
    const { pairs } = playOut({ kind: 'swiss', rounds: 5 }, 5, () => [next(), next()]);
    const byes = pairs.filter((p) => p.b === BYE).map((p) => p.a);
    expect(byes.toSorted((x, y) => x - y)).toEqual([0, 1, 2, 3, 4]);
  });

  it('pairs a round from the rounds before it, so engines on equal points meet', () => {
    const r0 = swissRound(4, [], []).map((m, i) => ({ pair: i, ...m, opening: '' }));
    // 0 and 1 win their pairs
    const games = r0.flatMap((p) => gamesOf(p, '1-0', '0-1'));
    expect(swissRound(4, r0, games).map((m) => [m.a, m.b, m.round])).toEqual([
      [0, 1, 1],
      [2, 3, 1],
    ]);
  });

  it('waits for a round to finish before pairing the next', () => {
    const director = directorOf({ kind: 'swiss', rounds: 2 }, 4);
    const pairs: PairRecord[] = [];
    for (const m of swissRound(4, [], [])) pairs.push({ pair: pairs.length, ...m, opening: '' });
    const [first] = pairs;
    if (!first) throw new Error('no pair');
    expect(director.next(pairs, gamesOf(first, '1-0', '1-0'))).toBe('wait');
  });
});

describe('a resumed tournament', () => {
  it('gets the rest of a Swiss round it had partly issued, as first paired', () => {
    const director = directorOf({ kind: 'swiss', rounds: 3 }, 6);
    const next = results(4);
    const pairs: PairRecord[] = [];
    const games: GameRecord[] = [];
    // round 1 played out, then round 2 issued as far as its first pair, which finished
    for (const m of swissRound(6, [], [])) {
      const p = { pair: pairs.length, ...m, opening: '' };
      pairs.push(p);
      games.push(...gamesOf(p, next(), next()));
    }
    const second = swissRound(6, pairs, games);
    const [first] = second;
    if (!first) throw new Error('no pair');
    const p = { pair: pairs.length, ...first, opening: '' };
    pairs.push(p);
    games.push(...gamesOf(p, '1-0', '1-0'));
    expect(director.next(pairs, games)).toEqual(second[1]);
  });

  it('plays a knockout tiebreak on from where it stopped', () => {
    const director = directorOf({ kind: 'knockout', pairs: 1 }, 2);
    const pairs: PairRecord[] = [];
    const games: GameRecord[] = [];
    for (let i = 0; i < 4; i++) {
      const p: PairRecord = { pair: i, a: 0, b: 1, round: 0, opening: '' };
      pairs.push(p);
      games.push(...gamesOf(p, '1-0', '1-0'));
    }
    expect(director.next(pairs, games)).toEqual({ a: 0, b: 1, round: 0 });
    const t = bracket(2, 1, pairs, games)[0]?.[0];
    expect(t).toMatchObject({ done: 4, winner: null });
  });
});

describe('knockout', () => {
  it('counts the fewest games still to play: a tied match one pair more, a pair in play less', () => {
    // 4 engines, 1 pair a match: 3 matches, 6 games at the fewest
    expect(knockoutGamesLeft(4, 1, [], [])).toBe(6);
    const p0: PairRecord = { pair: 0, a: 0, b: 3, round: 0, opening: '' };
    const p1: PairRecord = { pair: 1, a: 1, b: 2, round: 0, opening: '' };
    const pairs = [p0, p1];
    // 0 beats 3; 1 and 2 split their pair, so play one more; the final waits
    const games = [...gamesOf(p0, '1-0', '0-1'), ...gamesOf(p1, '1-0', '1-0')];
    expect(knockoutGamesLeft(4, 1, pairs, games)).toBe(2 + 2);
    // one game of the tiebreak pair in play
    const p2: PairRecord = { pair: 2, a: 1, b: 2, round: 0, opening: '' };
    expect(
      knockoutGamesLeft(4, 1, [...pairs, p2], [...games, ...gamesOf(p2, '1-0', '1-0').slice(0, 1)]),
    ).toBe(1 + 2);
  });

  it('seeds a bracket so the top two meet only in the final', () => {
    expect(bracketOrder(8)).toEqual([0, 7, 3, 4, 1, 6, 2, 5]);
  });

  it('gives the top seeds the byes of a field short of a power of two', () => {
    const first = bracket(5, 1, [], [])[0] ?? [];
    expect(first.map((t) => [t.a, t.b, t.by])).toEqual([
      [0, null, 'bye'],
      [3, 4, null],
      [1, null, 'bye'],
      [2, null, 'bye'],
    ]);
    expect(directorOf({ kind: 'knockout', pairs: 1 }, 5).next([], [])).toEqual({
      a: 3,
      b: 4,
      round: 0,
    });
  });

  it('plays a tied match on, one pair at a time, then sends the higher seed through', () => {
    const { pairs } = playOut({ kind: 'knockout', pairs: 2 }, 2, () => ['1-0', '1-0']);
    expect(pairs.length).toBe(TIEBREAK_PAIRS);
    const final = bracket(
      2,
      2,
      pairs,
      pairs.flatMap((p) => gamesOf(p, '1-0', '1-0')),
    );
    expect(final[0]?.[0]).toMatchObject({ winner: 0, by: 'seed', done: TIEBREAK_PAIRS });
  });

  it('plays a field down to one winner', () => {
    const next = results(3);
    const { pairs, games } = playOut({ kind: 'knockout', pairs: 1 }, 6, () => [next(), next()]);
    const rounds = bracket(6, 1, pairs, games);
    expect(rounds.length).toBe(3);
    expect(rounds.at(-1)?.[0]?.winner).not.toBeNull();
    // each engine but the winner goes out once
    const out = rounds.flat().filter((t) => t.by !== 'bye').length;
    expect(out).toBe(5);
  });

  it('issues a match’s planned pairs at once, but a tiebreak pair only after the last', () => {
    const director = directorOf({ kind: 'knockout', pairs: 2 }, 2);
    const p0: PairRecord = { pair: 0, a: 0, b: 1, round: 0, opening: '' };
    expect(director.next([p0], [])).toEqual({ a: 0, b: 1, round: 0 });
    const p1: PairRecord = { ...p0, pair: 1 };
    // both pairs drawn, the second still playing
    const games = gamesOf(p0, '1/2-1/2', '1/2-1/2');
    expect(director.next([p0, p1], games)).toBe('wait');
  });
});

describe('a fixed schedule of one game per opening', () => {
  it('alternates a match’s colors, and a Swiss still pairs as with pairs', () => {
    const match = directorOf({ kind: 'match', pairs: 3, sprt: null }, 2, false);
    const issued: PairRecord[] = [];
    for (let next = match.next(issued, []); next !== 'done'; next = match.next(issued, [])) {
      if (next === 'wait') throw new Error('a fixed schedule waited');
      issued.push({ pair: issued.length, ...next, opening: '' });
    }
    expect(issued.map((p) => [p.a, p.b])).toEqual([
      [0, 1],
      [1, 0],
      [0, 1],
    ]);
    const first: PairRecord = { pair: 0, a: 0, b: 1, round: 0, opening: '' };
    const swiss = directorOf({ kind: 'swiss', rounds: 2 }, 2, false);
    // one game of the round's pair is not the pair finished
    expect(swiss.next([first], gamesOf(first, '1-0', '1-0').slice(0, 1))).toBe('wait');
  });
});
