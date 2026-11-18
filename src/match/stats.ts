/**
 * A match's statistics from its pairs of games, or from its games when it plays one game per
 * opening: the pentanomial or trinomial counts, normalized Elo and Elo with their intervals, and the
 * SPRT's log-likelihood ratio.
 *
 * Ported from Ratchet's tools/llr.ts and tools/pool.ts (same author, GPL-3.0-or-later). The LLR
 * there is a port of fastchess's SPRT::getLLR(penta) and getLLR_normalized
 * (app/src/matchmaking/sprt/sprt.cpp), so a match here reports the LLR fastchess would. The
 * trinomial path ports SPRT::getLLR(win, draw, loss) for the normalized model, and EloWDL
 * (app/src/matchmaking/elo/elo_wdl.cpp) for nElo and Elo.
 */

/** Pair counts in fastchess's `Ptnml(0-2)` order: LL, LD, WL+DD, WD, WW. */
export type Ptnml = [number, number, number, number, number];

/** Game counts from one side's view, in fastchess's probability order: losses, draws, wins. */
export type Trinomial = [number, number, number];

const PAIR_SCORES = [0, 0.25, 0.5, 0.75, 1] as const;
const GAME_SCORES = [0, 0.5, 1] as const;
/** the score of each bucket: a pair's mean over its two games, or a game's */
const scoresOf = (counts: Ptnml | Trinomial): readonly number[] =>
  counts.length === 5 ? PAIR_SCORES : GAME_SCORES;
const NELO_SCALE = 800 / Math.log(10);

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const at = (xs: readonly number[], i: number) => xs[i] ?? 0;

/** the SPRT's stopping bounds on the LLR for error rates alpha and beta */
export function bounds(alpha = 0.05, beta = 0.05): { lower: number; upper: number } {
  return { lower: Math.log(beta / (1 - alpha)), upper: Math.log((1 - beta) / alpha) };
}

/**
 * The LLR of H1 (nElo = elo1) over H0 (nElo = elo0), for summed pair counts, or for game counts
 * when each opening is one game. A pair's t is √2 times a game's, as fastchess scales it.
 */
export function llr(counts: Ptnml | Trinomial, elo0: number, elo1: number): number {
  const scores = scoresOf(counts);
  const n = scores.length;
  const reg = counts.map((c) => (c === 0 ? 1e-3 : c));
  const total = sum(reg);
  const probs = reg.map((c) => c / total);
  const k = n === 5 ? Math.SQRT2 : 1;
  const t0 = (k * elo0) / NELO_SCALE;
  const t1 = (k * elo1) / NELO_SCALE;
  const p0 = mle(scores, probs, 0.5, t0);
  const p1 = mle(scores, probs, 0.5, t1);
  let s = 0;
  for (let i = 0; i < n; i++) s += at(probs, i) * (Math.log(at(p1, i)) - Math.log(at(p0, i)));
  return total * s;
}

// The distribution closest to the empirical one whose t = (mu - muRef) / sigma
// is tStar: section 4.1 of van den Bergh, "Comments on normalized Elo".
function mle(scores: readonly number[], probs: number[], muRef: number, tStar: number): number[] {
  const n = scores.length;
  const p = scores.map(() => 1 / n);
  for (let iter = 0; iter < 10; iter++) {
    let mu = 0;
    for (let i = 0; i < n; i++) mu += at(scores, i) * at(p, i);
    let variance = 0;
    for (let i = 0; i < n; i++) variance += at(p, i) * (at(scores, i) - mu) ** 2;
    const sigma = Math.sqrt(variance);
    const phi = scores.map((a) => a - muRef - 0.5 * tStar * sigma * (1 + ((a - mu) / sigma) ** 2));
    const f = (x: number) => {
      let r = 0;
      for (let i = 0; i < n; i++) r += (at(probs, i) * at(phi, i)) / (1 + x * at(phi, i));
      return r;
    };
    const theta = itp(f, -1 / Math.max(...phi), -1 / Math.min(...phi), Infinity, -Infinity);
    let maxDiff = 0;
    for (let i = 0; i < n; i++) {
      const next = at(probs, i) / (1 + theta * at(phi, i));
      maxDiff = Math.max(maxDiff, Math.abs(next - at(p, i)));
      p[i] = next;
    }
    if (maxDiff < 1e-4) break;
  }
  return p;
}

// ITP root finding (Oliveira and Takahashi 2020), with fastchess's constants.
function itp(f: (x: number) => number, a0: number, b0: number, fa0: number, fb0: number): number {
  const [k1, k2, n0, eps] = [0.1, 2, 0.99, 1e-7];
  let [a, b, fa, fb] = fa0 > 0 ? [b0, a0, fb0, fa0] : [a0, b0, fa0, fb0];
  const nMax = Math.ceil(Math.log2(Math.abs(b - a) / (2 * eps))) + n0;
  for (let i = 0; Math.abs(b - a) > 2 * eps; i++) {
    const xHalf = (a + b) / 2;
    const r = eps * 2 ** (nMax - i) - (b - a) / 2;
    const delta = k1 * (b - a) ** k2;
    const xf = (fb * a - fa * b) / (fb - fa);
    const sigma = (xHalf - xf) / Math.abs(xHalf - xf);
    const xt = delta <= Math.abs(xHalf - xf) ? xf + sigma * delta : xHalf;
    const x = Math.abs(xt - xHalf) <= r ? xt : xHalf - sigma * r;
    const fx = f(x);
    if (fx === 0) {
      a = x;
      b = x;
    } else if (fx < 0) {
      a = x;
      fa = fx;
    } else {
      b = x;
      fb = fx;
    }
  }
  return (a + b) / 2;
}

/**
 * About how many games an SPRT takes when the true nElo is on one of its bounds: Wald's average
 * sample number, with an LLR drift of (t1 - t0)² / 2 a pair. It takes longer between the bounds
 * and fewer games far outside them. Normalized Elo makes the count the same for one game per opening: a
 * game's t is a pair's over √2, so its drift is half a pair's.
 */
export function sprtGames(elo0: number, elo1: number, alpha = 0.05, beta = 0.05): number {
  const { lower, upper } = bounds(alpha, beta);
  const drift = ((Math.SQRT2 * (elo1 - elo0)) / NELO_SCALE) ** 2 / 2;
  const h1 = ((1 - beta) * upper + beta * lower) / drift;
  const h0 = -((1 - alpha) * lower + alpha * upper) / drift;
  return 2 * Math.round(Math.max(h0, h1));
}

/** the mean score and its spread over the samples: pairs, or games when the counts are a trinomial */
function moments(counts: Ptnml | Trinomial): { pairs: number; mean: number; sd: number } {
  const scores = scoresOf(counts);
  const pairs = sum(counts);
  if (pairs === 0) return { pairs, mean: 0.5, sd: 0 };
  const mean = counts.reduce((t, n, i) => t + n * at(scores, i), 0) / pairs;
  const sd = Math.sqrt(counts.reduce((t, n, i) => t + n * (at(scores, i) - mean) ** 2, 0) / pairs);
  return { pairs, mean, sd };
}

/**
 * normalized Elo and its 95% half-interval: fastchess's normalized estimate, EloPentanomial's for
 * pairs and EloWDL's for games. With every sample in one bucket the spread is 0: a score off one
 * half is then infinitely many standard deviations off, and no interval is known.
 */
export function nelo(counts: Ptnml | Trinomial): { value: number; ci: number } {
  const { pairs, mean, sd } = moments(counts);
  if (pairs === 0) return { value: 0, ci: Infinity };
  // a pair's score is the mean of two games, so its variance is about half a game's
  const scale = counts.length === 5 ? NELO_SCALE / Math.SQRT2 : NELO_SCALE;
  if (sd === 0) return { value: mean === 0.5 ? 0 : Math.sign(mean - 0.5) * Infinity, ci: Infinity };
  return { value: ((mean - 0.5) / sd) * scale, ci: (1.96 * scale) / Math.sqrt(pairs) };
}

/** Elo and its 95% half-interval: the logistic of the mean score, the unit other engines report */
export function elo(counts: Ptnml | Trinomial): { value: number; ci: number } {
  const { pairs, mean, sd } = moments(counts);
  if (pairs === 0) return { value: 0, ci: Infinity };
  const logistic = (x: number) => -400 * Math.log10(1 / Math.min(1, Math.max(0, x)) - 1);
  const half = (1.96 * sd) / Math.sqrt(pairs);
  const value = logistic(mean);
  // with every pair in one bucket the spread is 0, so no interval is known
  if (sd === 0) return { value, ci: Infinity };
  return { value, ci: (logistic(mean + half) - logistic(mean - half)) / 2 };
}

/**
 * The bucket of a pair from one side's view: its points over the two games, 0 to 2 in halves.
 * @param first that side's points in the pair's first game: 1, 0.5 or 0
 * @param second its points in the second
 */
export function bucket(first: number, second: number): 0 | 1 | 2 | 3 | 4 {
  const b = Math.round((first + second) * 2);
  return b <= 0 ? 0 : b === 1 ? 1 : b === 2 ? 2 : b === 3 ? 3 : 4;
}

/** The bucket of one game from one side's view, in `Trinomial` order: 0 lost, 1 drawn, 2 won. */
export const gameBucket = (points: number): 0 | 1 | 2 => (points >= 1 ? 2 : points > 0 ? 1 : 0);
