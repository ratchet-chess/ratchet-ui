import { resolveControl } from '../chess/clock.ts';
import { median } from '../engine/calibrate.ts';
import { count, thousands } from '../ui/format.ts';
import type { GameRecord } from './summary.ts';

/** Minimum measured games per entrant before checking for sustained speed drops. */
const MIN_GAMES_FOR_DROP = 6;
/** Sliding median window size used to smooth normal game-to-game NPS variance. */
const WINDOW = 4;
/** Relative drop below an entrant's initial baseline median that triggers a drift warning. */
const DROP_THRESHOLD = 0.25;
/** Relative White/Black speed swing inside a color-swapped pair that triggers an asymmetry warning. */
const PAIR_ASYMMETRY_RATIO = 1.5;

/** One entrant whose sustained search speed dropped sharply during a clocked tournament. */
export interface EntrantDrift {
  entrant: number;
  games: number;
  baselineNps: number;
  lowNps: number;
  recentNps: number;
  /** Fractional drop from baseline to low (e.g. 0.32 for 32%). */
  drop: number;
}

/** One color-swapped pair whose relative White/Black speed swung sharply between games. */
export interface PairAsymmetry {
  pair: number;
  ratio: number;
}

/** Passive speed-drift analysis for one tournament's finished games. */
export interface DriftReport {
  drops: EntrantDrift[];
  asymmetricPairs: PairAsymmetry[];
  measuredGames: number;
}

const EMPTY: DriftReport = { drops: [], asymmetricPairs: [], measuredGames: 0 };

/** True for controls where wall-clock search speed affects engine move quality. */
export function isTimedControl(control: string): boolean {
  const tc = resolveControl(control);
  return tc !== null && tc.kind !== 'nodes' && tc.kind !== 'depth';
}

/**
 * Analyzes passive UCI `info.nps` telemetry recorded on `games` to flag sustained thermal/load
 * slowdowns and asymmetric color-swapped pairs in clocked tournaments.
 */
export function analyzeDrift(
  control: string,
  games: readonly GameRecord[],
  paired: boolean,
): DriftReport {
  if (!isTimedControl(control)) return EMPTY;

  const byEntrant = new Map<number, number[]>();
  const byPair = new Map<number, GameRecord[]>();
  let measuredGames = 0;

  for (const g of games) {
    const wnps = g.wnps !== undefined && g.wnps > 0 ? g.wnps : null;
    const bnps = g.bnps !== undefined && g.bnps > 0 ? g.bnps : null;
    if (wnps !== null || bnps !== null) measuredGames++;
    if (wnps !== null) {
      const list = byEntrant.get(g.white) ?? [];
      list.push(wnps);
      byEntrant.set(g.white, list);
    }
    if (bnps !== null) {
      const list = byEntrant.get(g.black) ?? [];
      list.push(bnps);
      byEntrant.set(g.black, list);
    }
    if (paired) {
      const pairList = byPair.get(g.pair) ?? [];
      pairList.push(g);
      byPair.set(g.pair, pairList);
    }
  }

  if (measuredGames === 0) return EMPTY;

  const drops: EntrantDrift[] = [];
  for (const [entrant, series] of byEntrant) {
    if (series.length < MIN_GAMES_FOR_DROP) continue;
    const baselineNps = Math.round(median(series.slice(0, WINDOW)));
    if (baselineNps <= 0) continue;
    let lowNps = baselineNps;
    for (let i = 1; i <= series.length - WINDOW; i++) {
      const w = Math.round(median(series.slice(i, i + WINDOW)));
      if (w < lowNps) lowNps = w;
    }
    const recentNps = Math.round(median(series.slice(-WINDOW)));
    const drop = (baselineNps - lowNps) / baselineNps;
    if (drop >= DROP_THRESHOLD) {
      drops.push({ entrant, games: series.length, baselineNps, lowNps, recentNps, drop });
    }
  }
  drops.sort((a, b) => b.drop - a.drop);

  const asymmetricPairs: PairAsymmetry[] = [];
  if (paired) {
    for (const [pair, gs] of byPair) {
      const g0 = gs.find((g) => g.game === 0);
      const g1 = gs.find((g) => g.game === 1);
      if (!g0 || !g1) continue;
      if (g0.white !== g1.black || g0.black !== g1.white) continue;
      const w0 = g0.wnps ?? 0;
      const b0 = g0.bnps ?? 0;
      const w1 = g1.wnps ?? 0;
      const b1 = g1.bnps ?? 0;
      if (w0 <= 0 || b0 <= 0 || w1 <= 0 || b1 <= 0) continue;
      // Compare engine A / engine B speed ratio across both games of the pair
      const r0 = w0 / b0;
      const r1 = b1 / w1;
      const ratio = Math.max(r0 / r1, r1 / r0);
      if (ratio >= PAIR_ASYMMETRY_RATIO) {
        asymmetricPairs.push({ pair, ratio });
      }
    }
    asymmetricPairs.sort((a, b) => b.pair - a.pair);
  }

  return { drops, asymmetricPairs, measuredGames };
}

/** True when a drift report contains any sustained drop or asymmetric pair warning. */
export function hasDrift(report: DriftReport): boolean {
  return report.drops.length > 0 || report.asymmetricPairs.length > 0;
}

/** Formats concise drift warning lines for Notices and the Health panel. */
export function driftLines(report: DriftReport, nameOf: (entrant: number) => string): string[] {
  const out: string[] = [];
  for (const d of report.drops) {
    out.push(
      `Speed drift: ${nameOf(d.entrant)} down ${Math.round(d.drop * 100)}% (${thousands(d.baselineNps)} → ${thousands(d.lowNps)} nps)`,
    );
  }
  const n = report.asymmetricPairs.length;
  if (n > 0) {
    out.push(`Speed drift: ${count(n)} asymmetric ${n === 1 ? 'pair' : 'pairs'}`);
  }
  return out;
}
