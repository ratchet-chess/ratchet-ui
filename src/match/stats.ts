/**
 * A match's statistics from its pairs of games: the pentanomial counts, normalized Elo and Elo
 * with their intervals, and the SPRT's log-likelihood ratio.
 *
 * Ported from Ratchet's tools/llr.ts and tools/pool.ts (same author, GPL-3.0-or-later). The LLR
 * there is a port of fastchess's SPRT::getLLR(penta) and getLLR_normalized
 * (app/src/matchmaking/sprt/sprt.cpp), so a match here reports the LLR fastchess would.
 */

/** Pair counts in fastchess's `Ptnml(0-2)` order: LL, LD, WL+DD, WD, WW. */
export type Ptnml = [number, number, number, number, number];

const SCORES = [0, 0.25, 0.5, 0.75, 1] as const;
const NELO_SCALE = 800 / Math.log(10);

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const at = (xs: readonly number[], i: number) => xs[i] ?? 0;

/** the SPRT's stopping bounds on the LLR for error rates alpha and beta */
export function bounds(alpha = 0.05, beta = 0.05): { lower: number; upper: number } {
  return { lower: Math.log(beta / (1 - alpha)), upper: Math.log((1 - beta) / alpha) };
}

/** The LLR of H1 (nElo = elo1) over H0 (nElo = elo0), for summed pair counts. */
export function llr(counts: Ptnml, elo0: number, elo1: number): number {
  const reg = counts.map((c) => (c === 0 ? 1e-3 : c));
  const total = sum(reg);
  const probs = reg.map((c) => c / total);
  const t0 = (Math.SQRT2 * elo0) / NELO_SCALE;
  const t1 = (Math.SQRT2 * elo1) / NELO_SCALE;
  const p0 = mle(probs, 0.5, t0);
  const p1 = mle(probs, 0.5, t1);
  let s = 0;
  for (let i = 0; i < 5; i++) s += at(probs, i) * (Math.log(at(p1, i)) - Math.log(at(p0, i)));
  return total * s;
}

// The distribution closest to the empirical one whose t = (mu - muRef) / sigma
// is tStar: section 4.1 of van den Bergh, "Comments on normalized Elo".
function mle(probs: number[], muRef: number, tStar: number): number[] {
  const p = [0.2, 0.2, 0.2, 0.2, 0.2];
  for (let iter = 0; iter < 10; iter++) {
    let mu = 0;
    for (let i = 0; i < 5; i++) mu += at(SCORES, i) * at(p, i);
    let variance = 0;
    for (let i = 0; i < 5; i++) variance += at(p, i) * (at(SCORES, i) - mu) ** 2;
    const sigma = Math.sqrt(variance);
    const phi = SCORES.map((a) => a - muRef - 0.5 * tStar * sigma * (1 + ((a - mu) / sigma) ** 2));
    const f = (x: number) => {
      let r = 0;
      for (let i = 0; i < 5; i++) r += (at(probs, i) * at(phi, i)) / (1 + x * at(phi, i));
      return r;
    };
    const theta = itp(f, -1 / Math.max(...phi), -1 / Math.min(...phi), Infinity, -Infinity);
    let maxDiff = 0;
    for (let i = 0; i < 5; i++) {
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

function moments(counts: Ptnml): { pairs: number; mean: number; sd: number } {
  const pairs = sum(counts);
  if (pairs === 0) return { pairs, mean: 0.5, sd: 0 };
  const mean = counts.reduce((t, n, i) => t + n * at(SCORES, i), 0) / pairs;
  const sd = Math.sqrt(counts.reduce((t, n, i) => t + n * (at(SCORES, i) - mean) ** 2, 0) / pairs);
  return { pairs, mean, sd };
}

/**
 * normalized Elo and its 95% half-interval: fastchess's normalized estimate. With every pair in
 * one bucket the spread is 0: a score off one half is then infinitely many standard deviations
 * off, and no interval is known.
 */
export function nelo(counts: Ptnml): { value: number; ci: number } {
  const { pairs, mean, sd } = moments(counts);
  if (pairs === 0) return { value: 0, ci: Infinity };
  const scale = NELO_SCALE / Math.SQRT2;
  if (sd === 0) return { value: mean === 0.5 ? 0 : Math.sign(mean - 0.5) * Infinity, ci: Infinity };
  return { value: ((mean - 0.5) / sd) * scale, ci: (1.96 * scale) / Math.sqrt(pairs) };
}

/** Elo and its 95% half-interval: the logistic of the mean score, the unit other engines report */
export function elo(counts: Ptnml): { value: number; ci: number } {
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
