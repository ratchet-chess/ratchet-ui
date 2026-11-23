/**
 * Ratings of many engines from their games against each other: logistic maximum likelihood, a draw
 * half a win, as fastchess-gui's rating list and ratchet-bench's tools/fit-rating.ts fit them.
 *
 * - A wide prior (sigma 1000 Elo, fastchess-gui's) keeps an engine that won or lost every game
 *   finite. It acts in a frame centered on 0, and the anchor is applied by a shift after the fit.
 * - The interval is fit-rating.ts's: the spread of the score residuals over color-swapped pairs,
 *   so draws and the correlation inside a pair count. The model's own e(1-e) reads wider than the
 *   games do at high draw rates. An engine whose results show no spread (it won or lost every
 *   game, played a single pair, or drew every game against its equals) falls back to the model's
 *   interval, as fit-rating.ts's `fit` does; so does every engine of a pool whose anchor is such.
 *   Below `FEW_PAIRS` pairs the wider of the two intervals stands.
 * - Engines that never met, through any chain of opponents, are in separate pools. Each pool is
 *   fitted alone, and a rating compares only within its pool. The anchor fixes its own pool's scale;
 *   every other pool averages 0.
 */

/** one game: engines by index, White's points, and the pair it belongs to (a game alone is a pair of one) */
export interface FitGame {
  white: number;
  black: number;
  score: number;
  pair: number;
}

export interface Rated {
  /** on the anchor's scale in the anchor's pool; elsewhere relative to its pool's average, 0 */
  elo: number;
  /** half the 95% interval; 0 for the anchor */
  error: number;
  /**
   * true when `error` is the model's: the engine's results have no spread, or it played too few
   * pairs for their spread to read and the model's interval is the wider
   */
  model: boolean;
  /** the pool it was rated in; pools are numbered by games, most first */
  pool: number;
}

export interface Fit {
  /** by engine index; null for an engine with no game */
  rated: (Rated | null)[];
  /** the anchor's pool, or -1 when the anchor played no game */
  anchorPool: number;
  /**
   * half the 95% interval of `elo[a] - elo[b]`; NaN for two pools, or when either interval is the
   * model's
   */
  differenceError(a: number, b: number): number;
}

const K = Math.LN10 / 400;
const PRIOR = 1000;
const Z95 = 1.959963984540054;
/**
 * Below this many pairs the pair interval reads narrow: two equal engines at 50% draws miss their
 * 95% interval 22% of the time at 3 pairs, 13% at 5, 7% at 10 (4,000 trials each). There the
 * wider of the pair and the model interval stands.
 */
const FEW_PAIRS = 10;

const at = (xs: ArrayLike<number>, i: number) => xs[i] ?? 0;
/** the expected score of a rating difference, on the logistic Elo curve */
const expected = (difference: number) => 1 / (1 + 10 ** (-difference / 400));

/** the probability that a rating difference known within `error` (95% half-interval) is above 0 */
export function likelihoodOfSuperiority(difference: number, error: number): number {
  if (!(error > 0)) return difference > 0 ? 1 : difference < 0 ? 0 : 0.5;
  return 0.5 * (1 + erf(difference / (error / Z95) / Math.SQRT2));
}

/** Numerical Recipes' erfc coefficients, lowest power first */
const ERFC = [
  -1.26551223, 1.00002368, 0.37409196, 0.09678418, -0.18628806, 0.27886807, -1.13520398, 1.48851587,
  -0.82215223, 0.17087277,
];
/** the error function, to 1.2e-7 */
function erf(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const c = t * Math.exp(-z * z + ERFC.reduceRight((sum, k) => k + t * sum, 0));
  return x >= 0 ? 1 - c : c - 1;
}

/** a square matrix, row-major */
class Square {
  readonly n: number;
  readonly a: Float64Array;
  constructor(n: number) {
    this.n = n;
    this.a = new Float64Array(n * n);
  }
  get(i: number, j: number): number {
    return at(this.a, i * this.n + j);
  }
  set(i: number, j: number, v: number): void {
    this.a[i * this.n + j] = v;
  }
  add(i: number, j: number, v: number): void {
    this.a[i * this.n + j] = this.get(i, j) + v;
  }
  /** this · b */
  times(b: Square): Square {
    const n = this.n;
    const out = new Square(n);
    const o = out.a;
    // the hot loop of the fit: rows of b added straight into rows of the product
    for (let i = 0; i < n; i++)
      for (let k = 0; k < n; k++) {
        const x = this.get(i, k);
        if (x === 0) continue;
        for (let j = 0, r = i * n, s = k * n; j < n; j++)
          o[r + j] = at(o, r + j) + x * at(b.a, s + j);
      }
    return out;
  }
  /** the variance of x_i - x_j, this being a covariance */
  differenceVariance(i: number, j: number): number {
    return this.get(i, i) + this.get(j, j) - 2 * this.get(i, j);
  }
}

/** the lower Cholesky factor of a symmetric positive definite matrix */
function cholesky(m: Square): Square {
  const n = m.n;
  const l = new Square(n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = m.get(i, j);
      for (let k = 0; k < j; k++) s -= l.get(i, k) * l.get(j, k);
      l.set(i, j, i === j ? Math.sqrt(Math.max(s, 1e-300)) : s / l.get(j, j));
    }
  return l;
}

/** x with l lᵀ x = b */
function solve(l: Square, b: ArrayLike<number>): Float64Array {
  const n = l.n;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = at(b, i);
    for (let k = 0; k < i; k++) s -= l.get(i, k) * at(y, k);
    y[i] = s / l.get(i, i);
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = at(y, i);
    for (let k = i + 1; k < n; k++) s -= l.get(k, i) * at(x, k);
    x[i] = s / l.get(i, i);
  }
  return x;
}

/** engines by pool: the connected parts of the graph of games, most games first */
function poolsOf(n: number, games: readonly FitGame[]): number[][] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] ?? r;
    return r;
  };
  const played = new Float64Array(n);
  for (const g of games) {
    parent[find(g.white)] = find(g.black);
    played[g.white] = at(played, g.white) + 1;
    played[g.black] = at(played, g.black) + 1;
  }
  const by = new Map<number, { members: number[]; games: number }>();
  for (let i = 0; i < n; i++) {
    if (at(played, i) === 0) continue;
    const root = find(i);
    const p = by.get(root) ?? { members: [], games: 0 };
    p.members.push(i);
    p.games += at(played, i);
    by.set(root, p);
  }
  return [...by.values()].toSorted((a, b) => b.games - a.games).map((p) => p.members);
}

interface PoolFit {
  /** ratings in the pool's own frame, by local index */
  r: Float64Array;
  /** the model's covariance, the inverse of the information */
  model: Square;
  /** the covariance from the spread over pairs */
  sandwich: Square;
  /** per local index: the engine's results have no spread */
  flat: boolean[];
  /** per local index: the pairs the engine played */
  pairs: Float64Array;
}

function fitPool(members: readonly number[], games: readonly FitGame[]): PoolFit {
  const n = members.length;
  const local = new Map(members.map((e, i) => [e, i]));
  // the games of each two engines, once: a < b, local; what a scored
  const met = new Map<number, { a: number; b: number; games: number; points: number }>();
  const points = new Float64Array(n);
  const played = new Float64Array(n);
  const mine: { w: number; b: number; score: number; pair: number }[] = [];
  for (const g of games) {
    const w = local.get(g.white);
    const b = local.get(g.black);
    if (w === undefined || b === undefined || w === b) continue;
    mine.push({ w, b, score: g.score, pair: g.pair });
    const [lo, hi, s] = w < b ? [w, b, g.score] : [b, w, 1 - g.score];
    const rec = met.get(lo * n + hi) ?? { a: lo, b: hi, games: 0, points: 0 };
    rec.games++;
    rec.points += s;
    met.set(lo * n + hi, rec);
    points[w] = at(points, w) + g.score;
    points[b] = at(points, b) + 1 - g.score;
    played[w] = at(played, w) + 1;
    played[b] = at(played, b) + 1;
  }
  const pairs = [...met.values()];

  const r = new Float64Array(n);
  const information = (): Square => {
    const h = new Square(n);
    for (let i = 0; i < n; i++) h.set(i, i, 1 / PRIOR ** 2);
    for (const p of pairs) {
      const e = expected(at(r, p.a) - at(r, p.b));
      const w = K * K * p.games * e * (1 - e);
      h.add(p.a, p.a, w);
      h.add(p.b, p.b, w);
      h.add(p.a, p.b, -w);
      h.add(p.b, p.a, -w);
    }
    return h;
  };
  for (let iter = 0; iter < 200; iter++) {
    const g = new Float64Array(n);
    for (let i = 0; i < n; i++) g[i] = -at(r, i) / PRIOR ** 2;
    for (const p of pairs) {
      const d = K * (p.points - p.games * expected(at(r, p.a) - at(r, p.b)));
      g[p.a] = at(g, p.a) + d;
      g[p.b] = at(g, p.b) - d;
    }
    const step = solve(cholesky(information()), g);
    let largest = 0;
    for (let i = 0; i < n; i++) {
      // damped far from the optimum, as both references do
      r[i] = at(r, i) + Math.max(-400, Math.min(400, at(step, i)));
      largest = Math.max(largest, Math.abs(at(step, i)));
    }
    if (largest < 1e-9) break;
  }

  const info = information();
  const l = cholesky(info);
  const model = new Square(n);
  for (let j = 0; j < n; j++) {
    const unit = new Float64Array(n);
    unit[j] = 1;
    const col = solve(l, unit);
    for (let i = 0; i < n; i++) model.set(i, j, at(col, i));
  }

  // each pair's score vector, and the sum of their outer products: the spread the games show
  const byPair = new Map<number, Map<number, number>>();
  for (const g of mine) {
    const u = K * (g.score - expected(at(r, g.w) - at(r, g.b)));
    const v = byPair.get(g.pair) ?? new Map<number, number>();
    v.set(g.w, (v.get(g.w) ?? 0) + u);
    v.set(g.b, (v.get(g.b) ?? 0) - u);
    byPair.set(g.pair, v);
  }
  const spread = new Square(n);
  const pairsOf = new Float64Array(n);
  for (const v of byPair.values())
    for (const [i, x] of v) {
      pairsOf[i] = at(pairsOf, i) + 1;
      for (const [j, y] of v) spread.add(i, j, x * y);
    }

  // results with no spread to read: a sweep, a single pair (the fit cancels its residuals), or
  // draws against equals. The last cut sits far below a real spread, about half the information.
  const flat = members.map(
    (_, i) =>
      at(points, i) === 0 ||
      at(points, i) === at(played, i) ||
      at(pairsOf, i) < 2 ||
      spread.get(i, i) < 1e-6 * info.get(i, i),
  );
  return { r, model, sandwich: model.times(spread).times(model), flat, pairs: pairsOf };
}

/**
 * Rates `n` engines from `games`. With an anchor, the anchor's pool is on its scale; every other
 * pool, and every pool without one, averages 0.
 */
export function fitRatings(
  n: number,
  games: readonly FitGame[],
  anchor: { index: number; rating: number } | null = null,
): Fit {
  const rated: (Rated | null)[] = Array.from({ length: n }, () => null);
  let anchorPool = -1;
  const where = new Map<number, { pool: number; local: number }>();
  const fits: PoolFit[] = [];
  poolsOf(n, games).forEach((members, pool) => {
    const f = fitPool(members, games);
    fits.push(f);
    const k = members.length;
    const a = anchor ? members.indexOf(anchor.index) : -1;
    if (a >= 0) anchorPool = pool;
    let mean = 0;
    for (let i = 0; i < k; i++) mean += at(f.r, i);
    mean /= k;
    // each covariance's row sums and total, for the variance of r_i minus the pool's mean
    const sums = new Map<Square, { rows: Float64Array; all: number }>();
    for (const c of [f.model, f.sandwich]) {
      const rows = new Float64Array(k);
      let all = 0;
      for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) rows[i] = at(rows, i) + c.get(i, j);
        all += at(rows, i);
      }
      sums.set(c, { rows, all });
    }
    members.forEach((e, i) => {
      where.set(e, { pool, local: i });
      const held = anchor !== null && a >= 0;
      const varianceBy = (c: Square) => {
        if (held) return i === a ? 0 : c.differenceVariance(i, a);
        const s = sums.get(c);
        return c.get(i, i) - (2 * at(s?.rows ?? [], i)) / k + (s?.all ?? 0) / (k * k);
      };
      const byModel = varianceBy(f.model);
      const byPairs = varianceBy(f.sandwich);
      // a flat anchor's place is the prior's, so every interval against it is the model's
      const flat = f.flat[i] === true || (held && f.flat[a] === true);
      const few = at(f.pairs, i) < FEW_PAIRS || (held && at(f.pairs, a) < FEW_PAIRS);
      const model = flat || (few && byModel > byPairs);
      const variance = model ? byModel : byPairs;
      const elo = held ? anchor.rating + at(f.r, i) - at(f.r, a) : at(f.r, i) - mean;
      rated[e] = { elo, error: Z95 * Math.sqrt(Math.max(0, variance)), model, pool };
    });
  });
  return {
    rated,
    anchorPool,
    differenceError(a, b) {
      const x = where.get(a);
      const y = where.get(b);
      const f = x && fits[x.pool];
      if (!x || !y || !f || x.pool !== y.pool) return NaN;
      if (f.flat[x.local] === true || f.flat[y.local] === true) return NaN;
      let v = f.sandwich.differenceVariance(x.local, y.local);
      if (at(f.pairs, x.local) < FEW_PAIRS || at(f.pairs, y.local) < FEW_PAIRS)
        v = Math.max(v, f.model.differenceVariance(x.local, y.local));
      return Z95 * Math.sqrt(Math.max(0, v));
    },
  };
}
