import type { Adjudication } from './adjudicate.ts';

/** An SPRT on normalized Elo, as fishtest and OpenBench run it. */
export interface Sprt {
  elo0: number;
  elo1: number;
  alpha: number;
  beta: number;
}

/** How a tournament's engines meet. Every meeting is a pair: two games on one opening, colors swapped. */
export type Format =
  /** two engines; the first is tested against the second. Pairs, or an SPRT up to its pairs */
  | { kind: 'match'; pairs: number; sprt: Sprt | null }
  /** every engine plays every other, `cycles` times */
  | { kind: 'roundrobin'; cycles: number }
  /** the first `seeds` engines each play every other engine, `cycles` times; the others do not meet */
  | { kind: 'gauntlet'; seeds: number; cycles: number };

/** One pair of a schedule: `a` has White in its first game and Black in its second. */
export interface Meeting {
  a: number;
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
  /** a time control's label, from TIME_CONTROLS */
  control: string;
  /** a pulled book's id; empty for the start position */
  book: string;
  adjudication: Adjudication | null;
  /** games played at once */
  concurrency: number;
  /** picks each pair's opening, so a replay of the setup picks the same ones */
  seed: number;
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

/** a format's whole schedule of pairs, for the formats that pair before any game is played */
export function schedule(format: Format, entrants: number): Meeting[] {
  const out: Meeting[] = [];
  if (format.kind === 'match') {
    for (let i = 0; i < format.pairs; i++) out.push({ a: 0, b: 1, round: i });
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
