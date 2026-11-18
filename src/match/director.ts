import { BYE, schedule, type Format, type Pairing } from './format.ts';
import { pointsOf, type GameRecord, type PairRecord } from './summary.ts';

/** What a director answers when a game slot is free. */
export type Next =
  /** the next pair to issue */
  | Pairing
  /** no pair can be issued until a game in play finishes, as between a Swiss round's results */
  | 'wait'
  /** the format has issued every pair it will */
  | 'done';

/**
 * Decides a tournament's next pair from what is already issued and finished. It keeps no state of
 * its own, so a resumed tournament gets the same pairs from its saved records.
 */
export interface Director {
  next(pairs: readonly PairRecord[], games: readonly GameRecord[]): Next;
}

/**
 * The director of a format, for a field of `entrants` engines. `paired` is the config's; a Swiss
 * and a knockout play pairs whatever it says.
 */
export function directorOf(format: Format, entrants: number, paired = true): Director {
  if (format.kind === 'swiss') return swiss(format.rounds, entrants);
  if (format.kind === 'knockout') return knockout(format.pairs, entrants);
  const pairings = schedule(format, entrants, paired);
  return { next: (pairs) => pairings[pairs.length] ?? 'done' };
}

/** each pair's finished games, by pair number */
function gamesByPair(games: readonly GameRecord[]): Map<number, GameRecord[]> {
  const out = new Map<number, GameRecord[]>();
  for (const g of games) out.set(g.pair, [...(out.get(g.pair) ?? []), g]);
  return out;
}

const scoreOf = (gs: readonly GameRecord[], who: number) =>
  gs.reduce((t, g) => t + pointsOf(g.result, g.white === who), 0);

const met = (x: number, y: number) => (x < y ? `${x}-${y}` : `${y}-${x}`);

// ── Swiss ──────────────────────────────────────────────────────────────────

/** the most pairings tried before a Swiss round gives up avoiding rematches */
const SEARCH_BUDGET = 100_000;

/**
 * The pairs of the next Swiss round, from the rounds before it: engines ranked by points, then by
 * seed. An odd field's lowest ranked engine without a bye sits out. Each engine then meets the
 * nearest in points it has not met; among equal points the upper half meets the lower half, as the
 * Dutch system pairs. When no such pairing exists, rematches are allowed.
 */
export function swissRound(
  entrants: number,
  prior: readonly PairRecord[],
  games: readonly GameRecord[],
): Pairing[] {
  const played = gamesByPair(games);
  const points = Array.from({ length: entrants }, () => 0);
  const metBefore = new Set<string>();
  const byes = new Set<number>();
  const round = prior.reduce((r, p) => Math.max(r, p.round + 1), 0);
  for (const p of prior) {
    if (p.b === BYE) {
      byes.add(p.a);
      points[p.a] = (points[p.a] ?? 0) + 1;
      continue;
    }
    metBefore.add(met(p.a, p.b));
    const gs = played.get(p.pair) ?? [];
    points[p.a] = (points[p.a] ?? 0) + scoreOf(gs, p.a);
    points[p.b] = (points[p.b] ?? 0) + scoreOf(gs, p.b);
  }
  const pts = (i: number) => points[i] ?? 0;
  const ranked = Array.from({ length: entrants }, (_, i) => i).toSorted((x, y) =>
    pts(x) === pts(y) ? x - y : pts(y) - pts(x),
  );
  const out: Pairing[] = [];
  if (ranked.length % 2 === 1) {
    const bye = ranked.toReversed().find((i) => !byes.has(i)) ?? ranked.at(-1) ?? 0;
    ranked.splice(ranked.indexOf(bye), 1);
    out.push({ a: bye, b: BYE, round });
  }

  let budget = SEARCH_BUDGET;
  const pair = (left: number[], rematch: boolean): [number, number][] | null => {
    const [p, ...rest] = left;
    if (p === undefined) return [];
    if (--budget < 0) return null;
    const group = left.filter((q) => pts(q) === pts(p));
    const half = Math.floor(group.length / 2);
    const gap = (q: number) => Math.abs(pts(p) - pts(q));
    const place = (q: number) =>
      pts(q) === pts(p) ? Math.abs(group.indexOf(q) - half) : left.indexOf(q);
    const candidates = rest.toSorted((x, y) =>
      gap(x) === gap(y) ? place(x) - place(y) : gap(x) - gap(y),
    );
    for (const q of candidates) {
      if (!rematch && metBefore.has(met(p, q))) continue;
      const tail = pair(
        rest.filter((x) => x !== q),
        rematch,
      );
      if (tail) return [[p, q], ...tail];
      if (budget < 0) return null;
    }
    return null;
  };
  let pairs = pair(ranked, false);
  if (!pairs) {
    budget = SEARCH_BUDGET;
    pairs = pair(ranked, true) ?? [];
  }
  return [...pairs.map(([a, b]) => ({ a, b, round })), ...out];
}

function swiss(rounds: number, entrants: number): Director {
  return {
    next(pairs, games) {
      const played = gamesByPair(games);
      const finished = (p: PairRecord) => p.b === BYE || (played.get(p.pair)?.length ?? 0) === 2;
      const round = pairs.reduce((r, p) => Math.max(r, p.round), 0);
      if (pairs.length > 0) {
        const current = pairs.filter((p) => p.round === round);
        const pairing = swissRound(
          entrants,
          pairs.filter((p) => p.round < round),
          games,
        );
        const issue = pairing[current.length];
        if (issue) return issue;
        if (!current.every(finished)) return 'wait';
      }
      if (pairs.length > 0 && round + 1 >= rounds) return 'done';
      return swissRound(entrants, pairs, games)[0] ?? 'done';
    },
  };
}

// ── knockout ───────────────────────────────────────────────────────────────

/** the pairs a tied knockout match plays at most; after them the higher seed goes through */
export const TIEBREAK_PAIRS = 10;

/** One match of a knockout bracket. */
export interface KnockoutMatch {
  round: number;
  /** the higher seed, or null while the match before it is undecided */
  a: number | null;
  /** null for a bye in the first round, or while the match before it is undecided */
  b: number | null;
  /** issued pairs of this match */
  pairs: PairRecord[];
  /** points of `a` and of `b` over the finished pairs */
  points: [number, number];
  /** pairs with both games finished */
  done: number;
  /** null while the match is undecided */
  winner: number | null;
  /** how it was decided: on points, on seed after the tiebreak pairs, or by a bye */
  by: 'points' | 'seed' | 'bye' | null;
}

/** seeds in bracket order, so seed 1 meets seed 2 only in the final: 1 8 4 5 2 7 3 6 for 8 */
export function bracketOrder(size: number): number[] {
  let order = [0];
  while (order.length < size) {
    const m = order.length * 2;
    order = order.flatMap((s) => [s, m - 1 - s]);
  }
  return order;
}

/** a knockout's bracket as its records stand: each round's matches, with their pairs and points */
export function bracket(
  entrants: number,
  pairsPerMatch: number,
  pairs: readonly PairRecord[],
  games: readonly GameRecord[],
): KnockoutMatch[][] {
  const played = gamesByPair(games);
  let size = 2;
  while (size < entrants) size *= 2;
  const order = bracketOrder(size).map((s) => (s < entrants ? s : null));
  const limit = Math.max(pairsPerMatch, TIEBREAK_PAIRS);
  const rounds: KnockoutMatch[][] = [];
  let slots: (number | null)[] = order;
  for (let round = 0; slots.length >= 2; round++) {
    const matches: KnockoutMatch[] = [];
    for (let k = 0; k + 1 < slots.length; k += 2) {
      const x = slots[k] ?? null;
      const y = slots[k + 1] ?? null;
      const [a, b] = x !== null && y !== null && y < x ? [y, x] : [x, y];
      const match: KnockoutMatch = {
        round,
        a,
        b,
        pairs: [],
        points: [0, 0],
        done: 0,
        winner: null,
        by: null,
      };
      matches.push(match);
      if (a === null || b === null) {
        // a bye exists only in the first round; later a missing side is a match still to decide
        const only = a ?? b;
        if (round === 0 && only !== null) [match.winner, match.by] = [only, 'bye'];
        continue;
      }
      match.pairs = pairs.filter((p) => p.round === round && met(p.a, p.b) === met(a, b));
      for (const p of match.pairs) {
        const gs = played.get(p.pair) ?? [];
        if (gs.length < 2) continue;
        match.done++;
        match.points[0] += scoreOf(gs, a);
        match.points[1] += scoreOf(gs, b);
      }
      if (match.done < match.pairs.length || match.done < pairsPerMatch) continue;
      const [pa, pb] = match.points;
      if (pa !== pb) [match.winner, match.by] = [pa > pb ? a : b, 'points'];
      else if (match.done >= limit) [match.winner, match.by] = [a, 'seed'];
    }
    rounds.push(matches);
    slots = matches.map((t) => t.winner);
    if (matches.length === 1) break;
  }
  return rounds;
}

function knockout(pairsPerMatch: number, entrants: number): Director {
  return {
    next(pairs, games) {
      const rounds = bracket(entrants, pairsPerMatch, pairs, games);
      for (const matches of rounds) {
        for (const t of matches) {
          if (t.a === null || t.b === null || t.winner !== null) continue;
          const playing = t.done < t.pairs.length;
          // the first `pairsPerMatch` pairs may play at once; a tiebreak pair waits for the last
          if (t.pairs.length < pairsPerMatch || !playing) return { a: t.a, b: t.b, round: t.round };
        }
      }
      return rounds.at(-1)?.[0]?.winner == null ? 'wait' : 'done';
    },
  };
}
