import type { Sprt } from './format.ts';
import { bucket, elo, gameBucket, llr, nelo, type Ptnml, type Trinomial } from './stats.ts';
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
 * spaced in pairs, the last at every finished pair. The counts are taken in one pass, and the
 * statistics are worked out only at the points kept, so a long match costs little. `paired` false
 * is a match of one game per opening: each game is then a finished pair, counted as a trinomial.
 */
export function matchSeries(
  games: readonly GameRecord[],
  sprt: Sprt | null,
  samples = 200,
  paired = true,
): SeriesPoint[] {
  const first = new Map<number, GameRecord>();
  const order: number[] = [];
  const tested = (g: GameRecord) => pointsOf(g.result, g.white === 0);
  for (const g of games) {
    if (!paired) {
      order.push(gameBucket(tested(g)));
      continue;
    }
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
  const trinomial: Trinomial = [0, 0, 0];
  const tally = paired ? ptnml : trinomial;
  const out: SeriesPoint[] = [];
  for (let k = 0; k < n; k++) {
    const b = order[k] ?? 0;
    tally[b] = (tally[b] ?? 0) + 1;
    if (!kept.has(k + 1)) continue;
    const counts: Ptnml | Trinomial = paired ? [...ptnml] : [...trinomial];
    out.push({
      pairs: k + 1,
      llr: sprt ? llr(counts, sprt.elo0, sprt.elo1) : null,
      nelo: nelo(counts),
      elo: elo(counts),
    });
  }
  return out;
}
