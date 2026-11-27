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
 * - An engine that won or lost every game has no finite rating. As Ordo does, it leaves the fit,
 *   again while leaving makes another such, and comes back at the rating one draw would give: a
 *   floor for a winner, a ceiling for a loser. Where none of a pool would stay, or the anchor is
 *   such, the prior keeps the pool's ratings finite instead.
 * - Engines that never met, through any chain of opponents, are in separate pools. Each pool is
 *   fitted alone, and a rating compares only within its pool. The anchor fixes its own pool's scale;
 *   every other pool averages 0.
 */
import { Z95 } from '../match/stats.ts';

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
  /**
   * set for an engine that won (`floor`) or lost (`ceiling`) every game: its rating is the one a
   * single draw would give, a bound on the true one, and `error` is 0
   */
  bound: 'floor' | 'ceiling' | null;
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
/**
 * Below this many pairs the pair interval reads narrow: two equal engines at 50% draws miss their
 * 95% interval 22% of the time at 3 pairs, 13% at 5, 7% at 10 (4,000 trials each). There the
 * wider of the pair and the model interval stands.
 */
const FEW_PAIRS = 10;

const at = (xs: ArrayLike<number>, i: number) => xs[i] ?? 0;
/** the expected score of a rating difference, on the logistic Elo curve */
const expected = (difference: number) => 1 / (1 + 10 ** (-difference / 400));

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

/** where an engine was fitted, for the interval of a difference */
interface Placed {
  pool: number;
  local: number;
}

/** fits each pool of `games`, numbering pools from `first`, into `rated` and `where` */
function ratePools(
  n: number,
  games: readonly FitGame[],
  anchor: { index: number; rating: number } | null,
  rated: (Rated | null)[],
  where: Map<number, Placed>,
  fits: PoolFit[],
): number {
  let anchorPool = -1;
  for (const members of poolsOf(n, games)) {
    const pool = fits.length;
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
      rated[e] = { elo, error: Z95 * Math.sqrt(Math.max(0, variance)), model, pool, bound: null };
    });
  }
  return anchorPool;
}

/**
 * The engines that won or lost every game, by the round they left in: each round drops every
 * such engine, which can leave another. The anchor never leaves.
 */
function sweepsOf(
  n: number,
  games: readonly FitGame[],
  anchor: number | null,
): Map<number, { round: number; bound: 'floor' | 'ceiling' }> {
  const out = new Map<number, { round: number; bound: 'floor' | 'ceiling' }>();
  for (let round = 0; ; round++) {
    const points = new Float64Array(n);
    const played = new Float64Array(n);
    for (const g of games) {
      if (out.has(g.white) || out.has(g.black) || g.white === g.black) continue;
      points[g.white] = at(points, g.white) + g.score;
      points[g.black] = at(points, g.black) + 1 - g.score;
      played[g.white] = at(played, g.white) + 1;
      played[g.black] = at(played, g.black) + 1;
    }
    let left = 0;
    for (let i = 0; i < n; i++) {
      const p = at(played, i);
      if (p === 0 || i === anchor) continue;
      const won = at(points, i);
      if (won === p || won === 0) {
        out.set(i, { round, bound: won === p ? 'floor' : 'ceiling' });
        left++;
      }
    }
    if (left === 0) return out;
  }
}

/** the rating at which games against `opponents` score `target` points */
function ratingFor(opponents: readonly number[], target: number, start: number): number {
  let r = start;
  for (let iter = 0; iter < 100; iter++) {
    let f = -target;
    let slope = 0;
    for (const o of opponents) {
      const e = expected(r - o);
      f += e;
      slope += K * e * (1 - e);
    }
    if (!(slope > 0)) break;
    const step = Math.max(-400, Math.min(400, -f / slope));
    r += step;
    if (Math.abs(step) < 1e-9) break;
  }
  return r;
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
  const where = new Map<number, Placed>();
  const fits: PoolFit[] = [];
  const swept = sweepsOf(n, games, anchor?.index ?? null);
  const kept = games.filter((g) => !swept.has(g.white) && !swept.has(g.black));
  let anchorPool = ratePools(n, kept, anchor, rated, where, fits);

  // back in, the last to leave first, each against the opponents already rated in one pool
  for (const [e, s] of [...swept].toSorted((x, y) => y[1].round - x[1].round)) {
    const byPool = new Map<number, number[]>();
    for (const g of games) {
      const o = g.white === e ? g.black : g.black === e ? g.white : -1;
      const r = o >= 0 && o !== e ? rated[o] : null;
      if (!r) continue;
      byPool.set(r.pool, [...(byPool.get(r.pool) ?? []), r.elo]);
    }
    const [pool, opponents] = [...byPool].toSorted((x, y) => y[1].length - x[1].length)[0] ?? [];
    if (pool === undefined || !opponents) continue;
    const target = s.bound === 'floor' ? opponents.length - 0.5 : 0.5;
    const mean = opponents.reduce((t, o) => t + o, 0) / opponents.length;
    const elo = ratingFor(opponents, target, mean + (s.bound === 'floor' ? 400 : -400));
    rated[e] = { elo, error: 0, model: false, pool, bound: s.bound };
  }
  // engines that still have no rating (swept only against each other, or left isolated when every
  // opponent was swept — including an anchor whose only opponents swept): the prior keeps them finite
  const left = new Set<number>();
  for (let i = 0; i < n; i++) if (rated[i] === null) left.add(i);
  if (left.size > 0) {
    const among = games.filter((g) => left.has(g.white) && left.has(g.black));
    if (among.length > 0) {
      const pool = ratePools(n, among, anchor, rated, where, fits);
      if (anchorPool < 0) anchorPool = pool;
    }
  }
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
