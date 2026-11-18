import type { Format } from './format.ts';
import { bounds, bucket, elo, llr, nelo, type Ptnml } from './stats.ts';

/** One pair as issued: who meets, in which round, and on which opening. */
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
  /** 0 for the pair's first game, with `a` as White; 1 for the second */
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
  points: number;
  /** the Elo difference to the field the score implies; null at 0% or 100% */
  elo: number | null;
}

export interface MatchStats {
  ptnml: Ptnml;
  /** the tested engine's wins, draws and losses */
  wdl: [number, number, number];
  nelo: { value: number; ci: number };
  elo: { value: number; ci: number };
  /** null without an SPRT */
  llr: number | null;
  bounds: { lower: number; upper: number } | null;
  /** the SPRT's decision once the LLR has crossed a bound */
  verdict: 'H1' | 'H0' | null;
}

export interface Summary {
  /** by points, then by games won */
  standings: Standing[];
  /** points[i][j]: i's points against j */
  points: number[][];
  /** games[i][j]: games between i and j */
  games: number[][];
  /** pairs with both games finished */
  pairsDone: number;
  match: MatchStats | null;
}

const pointsOf = (result: Result, white: boolean) =>
  result === '1/2-1/2' ? 0.5 : (result === '1-0') === white ? 1 : 0;

export function summarize(format: Format, entrants: number, games: GameRecord[]): Summary {
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
  const done = [...byPair.values()].filter((gs) => gs.length === 2);

  let match: MatchStats | null = null;
  if (format.kind === 'match') {
    const ptnml: Ptnml = [0, 0, 0, 0, 0];
    for (const gs of done) {
      const [x, y] = gs;
      if (!x || !y) continue;
      const tested = (g: GameRecord) => pointsOf(g.result, g.white === 0);
      ptnml[bucket(tested(x), tested(y))]++;
    }
    const t = rows[0];
    const sprt = format.sprt;
    const value = sprt && done.length > 0 ? llr(ptnml, sprt.elo0, sprt.elo1) : null;
    const b = sprt ? bounds(sprt.alpha, sprt.beta) : null;
    match = {
      ptnml,
      wdl: [t?.wins ?? 0, t?.draws ?? 0, t?.losses ?? 0],
      nelo: nelo(ptnml),
      elo: elo(ptnml),
      llr: value,
      bounds: b,
      verdict:
        value === null || !b ? null : value >= b.upper ? 'H1' : value <= b.lower ? 'H0' : null,
    };
  }
  const standings = rows.toSorted((x, y) =>
    y.points !== x.points ? y.points - x.points : y.wins - x.wins,
  );
  return { standings, points, games: played, pairsDone: done.length, match };
}
