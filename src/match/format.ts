import type { Adjudication } from './adjudicate.ts';

/** An SPRT on normalized Elo, as fishtest and OpenBench run it. */
export interface Sprt {
  elo0: number;
  elo1: number;
  alpha: number;
  beta: number;
}

/**
 * How a tournament's engines meet. Two engines meet in pairs, two games on one opening with colors
 * swapped: one pair a match, except a knockout's, which plays pairs until one engine leads.
 */
export type Format =
  /** two engines; the first is tested against the second. Pairs, or an SPRT up to its pairs */
  | { kind: 'match'; pairs: number; sprt: Sprt | null }
  /** every engine plays every other, `cycles` times */
  | { kind: 'roundrobin'; cycles: number }
  /** the first `seeds` engines each play every other engine, `cycles` times; the others do not meet */
  | { kind: 'gauntlet'; seeds: number; cycles: number }
  /** `rounds` rounds of a pair each, between engines of about equal points, without a rematch where one can be avoided */
  | { kind: 'swiss'; rounds: number }
  /** a seeded bracket; each match plays `pairs` pairs, then one more pair at a time while tied */
  | { kind: 'knockout'; pairs: number };

/** the formats whose whole schedule is known before any game */
export type FixedFormat = Extract<Format, { kind: 'match' | 'roundrobin' | 'gauntlet' }>;

/** the opponent of a Swiss bye: the engine sits out the round and scores one point */
export const BYE = -1;

/**
 * One pair to issue, and who plays it: `a` has White in its first game and Black in its second.
 * With one game per opening, the pair is that game alone.
 */
export interface Pairing {
  a: number;
  /** BYE when `a` sits out a Swiss round */
  b: number;
  round: number;
}

/** A whole tournament's setup, as it is saved. */
export interface TournamentConfig {
  id: string;
  name: string;
  /** ISO time */
  created: string;
  format: Format;
  /** engine ids, in seeding order */
  entrants: string[];
  /** a time control as `parseControl` reads it, such as `10+0.1` or `200k nodes` */
  control: string;
  /** a pulled book's id; empty for the start position */
  book: string;
  adjudication: Adjudication | null;
  /** games played at once */
  concurrency: number;
  /** picks each pair's opening, so a replay of the setup picks the same ones */
  seed: number;
  /**
   * true: each opening is a pair, two games with colors swapped. false: one game per opening,
   * colors alternating, offered for a match, a round robin and a gauntlet; a Swiss and a knockout
   * always play pairs. A config saved without it played pairs.
   */
  paired: boolean;
}

/**
 * The rounds of a round robin by Berger tables: with an even field, every engine plays once a
 * round; an odd field adds a rest, the engine paired with it sits out. Colors of a round's first
 * games alternate so each engine has White about half the time.
 */
export function bergerRounds(n: number): [number, number][][] {
  const size = n % 2 === 0 ? n : n + 1;
  const turning = size - 1;
  const rounds: [number, number][][] = [];
  // the circle method: place `turning` stays, the others turn one place a round
  for (let r = 0; r < turning; r++) {
    const round: [number, number][] = [];
    for (let i = 0; i < size / 2; i++) {
      const x = (r + i) % turning;
      const y = i === 0 ? turning : (r - i + turning) % turning;
      // a rest pairs with the place that does not exist in an odd field
      if (x >= n || y >= n) continue;
      const flip = i === 0 ? r % 2 === 1 : i % 2 === 1;
      round.push(flip ? [y, x] : [x, y]);
    }
    rounds.push(round);
  }
  return rounds;
}

/**
 * The games a format plays for a field of `entrants`: all of them, the most for an SPRT, and the
 * fewest for a knockout, whose tied matches play more.
 */
export function plannedGames(format: Format, entrants: number, paired = true): number {
  const n = entrants;
  const per = gamesPerPair(format, paired);
  if (format.kind === 'match') return format.pairs * per;
  if (format.kind === 'roundrobin') return ((n * (n - 1)) / 2) * format.cycles * per;
  if (format.kind === 'swiss') return format.rounds * Math.floor(n / 2) * per;
  if (format.kind === 'knockout') return Math.max(0, n - 1) * format.pairs * per;
  const s = Math.min(format.seeds, n - 1);
  return s * (n - s) * format.cycles * per;
}

/** whether a format may play one game per opening: a Swiss and a knockout always play pairs */
export const mayUnpair = (format: Format): boolean =>
  format.kind === 'match' || format.kind === 'roundrobin' || format.kind === 'gauntlet';

/** the games of one pair record: 2, or 1 for one game per opening, which a Swiss and a knockout never play */
export const gamesPerPair = (format: Format, paired: boolean): 1 | 2 =>
  paired || !mayUnpair(format) ? 2 : 1;

/** a game's number in its tournament, from 1, as its PGN Round tag ends: by pair, then game */
export const gameNumber = (pair: number, game: number, per: 1 | 2): number => pair * per + game + 1;

/**
 * A format's whole schedule of pairs, for the formats that pair before any game is played. With
 * one game per opening, each pair is one game with `a` as White: a match then alternates the first
 * engine's color.
 */
export function schedule(format: FixedFormat, entrants: number, paired = true): Pairing[] {
  const out: Pairing[] = [];
  if (format.kind === 'match') {
    for (let i = 0; i < format.pairs; i++)
      out.push(paired || i % 2 === 0 ? { a: 0, b: 1, round: i } : { a: 1, b: 0, round: i });
    return out;
  }
  if (format.kind === 'roundrobin') {
    const rounds = bergerRounds(entrants);
    for (let c = 0; c < format.cycles; c++) {
      rounds.forEach((round, r) => {
        for (const [x, y] of round) {
          // a second cycle gives each first game's White to the other engine
          out.push(
            c % 2 === 0
              ? { a: x, b: y, round: c * rounds.length + r }
              : { a: y, b: x, round: c * rounds.length + r },
          );
        }
      });
    }
    return out;
  }
  const seeds = Math.min(format.seeds, entrants - 1);
  let round = 0;
  for (let c = 0; c < format.cycles; c++) {
    for (let o = seeds; o < entrants; o++) {
      for (let s = 0; s < seeds; s++)
        out.push({ a: (o + c) % 2 === 0 ? s : o, b: (o + c) % 2 === 0 ? o : s, round });
      round++;
    }
  }
  return out;
}
