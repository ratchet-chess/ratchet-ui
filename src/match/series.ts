import type { Sprt } from './format.ts';
import { bucket, elo, llr, nelo, type Ptnml } from './stats.ts';
import { pointsOf, type GameRecord } from './summary.ts';

/** A match's statistics after its first `pairs` finished pairs, in the order the pairs finished. */
export interface SeriesPoint {
  pairs: number;
  /** null without an SPRT */
  llr: number | null;
  nelo: { value: number; ci: number };
  elo: { value: number; ci: number };
}

/**
 * A match's LLR, nElo and Elo as its pairs finished, for a chart: at most `samples` points, evenly
 * spaced in pairs, the last at every finished pair. The pentanomial is counted in one pass, and the
 * statistics are worked out only at the points kept, so a long match costs little.
 */
export function matchSeries(
  games: readonly GameRecord[],
  sprt: Sprt | null,
  samples = 200,
): SeriesPoint[] {
  const first = new Map<number, GameRecord>();
  const order: number[] = [];
  const tested = (g: GameRecord) => pointsOf(g.result, g.white === 0);
  for (const g of games) {
    const other = first.get(g.pair);
    if (!other) {
      first.set(g.pair, g);
      continue;
    }
    const [x, y] = other.game === 0 ? [other, g] : [g, other];
    order.push(bucket(tested(x), tested(y)));
  }
  const n = order.length;
  const kept = new Set<number>();
  for (let i = 1; i <= Math.min(samples, n); i++)
    kept.add(Math.round((i * n) / Math.min(samples, n)));

  const ptnml: Ptnml = [0, 0, 0, 0, 0];
  const out: SeriesPoint[] = [];
  for (let k = 0; k < n; k++) {
    const b = order[k] ?? 0;
    ptnml[b] = (ptnml[b] ?? 0) + 1;
    if (!kept.has(k + 1)) continue;
    const counts: Ptnml = [...ptnml];
    out.push({
      pairs: k + 1,
      llr: sprt ? llr(counts, sprt.elo0, sprt.elo1) : null,
      nelo: nelo(counts),
      elo: elo(counts),
    });
  }
  return out;
}
