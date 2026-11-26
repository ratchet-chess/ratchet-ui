import { BYE, gamesPerPair, type Format } from './format.ts';
import {
  bounds,
  bucket,
  elo,
  gameBucket,
  llr,
  los,
  nelo,
  type Ptnml,
  type Trinomial,
} from './stats.ts';

/** One pair as issued: who meets, in which round, and on which opening; with one game per opening, one game. */
export interface PairRecord {
  pair: number;
  /** White in the pair's first game */
  a: number;
  b: number;
  round: number;
  /** the opening as a reader sees it; empty for the start position */
  opening: string;
}

export type Result = '1-0' | '0-1' | '1/2-1/2';

/** One finished game of a pair. */
export interface GameRecord {
  pair: number;
  /** 0 for the pair's first game, with `a` as White, and for the one game of an opening played once; 1 for the second */
  game: 0 | 1;
  white: number;
  black: number;
  result: Result;
  reason: string;
  plies: number;
}

export interface Standing {
  entrant: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** points from games, plus a point for each Swiss bye */
  points: number;
  /** Swiss rounds sat out */
  byes: number;
  /** Sonneborn-Berger: for each opponent, the points scored against it times its points */
  sb: number;
  /** Buchholz: the opponents' points, once per game played against each */
  buchholz: number;
  /** the Elo difference to the field the game score implies; null at 0% or 100% */
  elo: number | null;
}

export interface MatchStats {
  /** pentanomial when each opening is a pair, trinomial when it is one game */
  model: 'pentanomial' | 'trinomial';
  /** the finished pairs' counts; all 0 under the trinomial model */
  ptnml: Ptnml;
  /** the tested engine's losses, draws and wins in the finished pairs' games */
  trinomial: Trinomial;
  /** the tested engine's wins, draws and losses */
  wdl: [number, number, number];
  nelo: { value: number; ci: number };
  elo: { value: number; ci: number };
  /** the likelihood that the tested engine is the stronger, from the same counts as nElo */
  los: number;
  /** null without an SPRT */
  llr: number | null;
  bounds: { lower: number; upper: number } | null;
  /** the SPRT's decision once the LLR has crossed a bound */
  verdict: 'H1' | 'H0' | null;
}

export interface Summary {
  /**
   * by points, then Buchholz in a Swiss, then Sonneborn-Berger; rows still tied by the points each
   * scored against the others tied, then by games won. fastchess-gui's order.
   */
  standings: Standing[];
  /** points[i][j]: i's points against j */
  points: number[][];
  /** games[i][j]: games between i and j */
  games: number[][];
  /** pairs with all their games finished: two, or one with one game per opening */
  pairsDone: number;
  match: MatchStats | null;
}

/** a side's points from a game's result */
export const pointsOf = (result: Result, white: boolean) =>
  result === '1/2-1/2' ? 0.5 : (result === '1-0') === white ? 1 : 0;

/**
 * The standings and statistics of a tournament's finished games; a Swiss bye in `pairs` scores a
 * point. `paired` is the config's: false plays one game per opening, so a match counts games.
 */
export function summarize(
  format: Format,
  entrants: number,
  games: readonly GameRecord[],
  pairs: readonly PairRecord[] = [],
  paired = true,
): Summary {
  const grid = () =>
    Array.from({ length: entrants }, () => Array.from({ length: entrants }, () => 0));
  const points = grid();
  const played = grid();
  const rows: Standing[] = Array.from({ length: entrants }, (_, entrant) => ({
    entrant,
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    points: 0,
    byes: 0,
    sb: 0,
    buchholz: 0,
    elo: null,
  }));
  const byPair = new Map<number, GameRecord[]>();
  for (const g of games) {
    for (const [me, them, white] of [
      [g.white, g.black, true],
      [g.black, g.white, false],
    ] as const) {
      const p = pointsOf(g.result, white);
      const row = rows[me];
      if (!row) continue;
      row.games++;
      row.points += p;
      if (p === 1) row.wins++;
      else if (p === 0.5) row.draws++;
      else row.losses++;
      const pr = points[me];
      const gr = played[me];
      if (pr && gr) {
        pr[them] = (pr[them] ?? 0) + p;
        gr[them] = (gr[them] ?? 0) + 1;
      }
    }
    byPair.set(g.pair, [...(byPair.get(g.pair) ?? []), g]);
  }
  for (const r of rows) {
    const s = r.games > 0 ? r.points / r.games : 0;
    r.elo = r.games > 0 && s > 0 && s < 1 ? -400 * Math.log10(1 / s - 1) : null;
  }
  for (const p of pairs) {
    const row = rows[p.a];
    if (p.b !== BYE || !row) continue;
    row.byes++;
    row.points += 1;
  }
  const per = gamesPerPair(format, paired);
  const done = [...byPair.values()].filter((gs) => gs.length === per);

  let match: MatchStats | null = null;
  if (format.kind === 'match') {
    const tested = (g: GameRecord) => pointsOf(g.result, g.white === 0);
    const ptnml: Ptnml = [0, 0, 0, 0, 0];
    const trinomial: Trinomial = [0, 0, 0];
    for (const gs of done) {
      for (const g of gs) trinomial[gameBucket(tested(g))]++;
      const [x, y] = gs;
      if (!x || !y) continue;
      ptnml[bucket(tested(x), tested(y))]++;
    }
    const counts = per === 2 ? ptnml : trinomial;
    const t = rows[0];
    const sprt = format.sprt;
    const value = sprt && done.length > 0 ? llr(counts, sprt.elo0, sprt.elo1) : null;
    const b = sprt ? bounds(sprt.alpha, sprt.beta) : null;
    match = {
      model: per === 2 ? 'pentanomial' : 'trinomial',
      ptnml,
      trinomial,
      wdl: [t?.wins ?? 0, t?.draws ?? 0, t?.losses ?? 0],
      nelo: nelo(counts),
      elo: elo(counts),
      los: los(counts),
      llr: value,
      bounds: b,
      verdict:
        value === null || !b ? null : value >= b.upper ? 'H1' : value <= b.lower ? 'H0' : null,
    };
  }
  // a bye has no opponent, so it adds to neither tiebreak
  for (const r of rows) {
    for (let j = 0; j < entrants; j++) {
      const total = rows[j]?.points ?? 0;
      r.sb += (points[r.entrant]?.[j] ?? 0) * total;
      r.buchholz += (played[r.entrant]?.[j] ?? 0) * total;
    }
  }
  const swiss = format.kind === 'swiss';
  const tied = (x: Standing, y: Standing) =>
    x.points === y.points && (!swiss || x.buchholz === y.buchholz) && x.sb === y.sb;
  /** the first of the differences that is not zero, as a sort's comparison */
  const first = (...ds: number[]) => ds.find((d) => d !== 0) ?? 0;
  const byKey = rows.toSorted((x, y) =>
    first(y.points - x.points, swiss ? y.buchholz - x.buchholz : 0, y.sb - x.sb),
  );
  // head to head is not transitive, so it orders only the rows still tied
  const standings: Standing[] = [];
  for (let start = 0; start < byKey.length;) {
    const head = byKey[start];
    let end = start + 1;
    for (let next = byKey[end]; head && next && tied(head, next); next = byKey[end]) end++;
    const group = byKey.slice(start, end);
    const among = (r: Standing) =>
      group.reduce((t, o) => t + (o === r ? 0 : (points[r.entrant]?.[o.entrant] ?? 0)), 0);
    standings.push(...group.toSorted((x, y) => first(among(y) - among(x), y.wins - x.wins)));
    start = end;
  }
  return { standings, points, games: played, pairsDone: done.length, match };
}
