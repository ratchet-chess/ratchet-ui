/** Pure formatting and PV-arrow helpers for the Tourneys Live view. */
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import type { Color } from 'chessops/types';
import { makeSquare, parseUci } from 'chessops/util';
import { formatEval } from '../../games/eval.ts';
import type { LiveSnapshot, SideSearch } from '../../match/runner.ts';

function parseUciSquares(uci: string | undefined): [Key, Key] | null {
  if (!uci) return null;
  const move = parseUci(uci);
  if (!move || !('from' in move)) return null;
  return [makeSquare(move.from), makeSquare(move.to)];
}

/**
 * PV arrows for the focused live board: best move in green and predicted reply in yellow.
 * Returns no arrows while scrubbing past plies, once a game ends, or when the PV is from an
 * earlier position.
 */
export function pvShapes(
  snap: Pick<LiveSnapshot, 'turn' | 'plies' | 'search' | 'outcome'>,
  enabled: boolean,
  viewingLive: boolean,
): DrawShape[] {
  if (!enabled || !viewingLive || snap.outcome !== null) return [];
  const search = snap.search[snap.turn];
  if (!search || search.ply !== snap.plies || !search.pv || search.pv.length === 0) return [];
  const shapes: DrawShape[] = [];
  const first = parseUciSquares(search.pv[0]);
  if (first) shapes.push({ orig: first[0], dest: first[1], brush: 'green' });
  const second = parseUciSquares(search.pv[1]);
  if (second) shapes.push({ orig: second[0], dest: second[1], brush: 'yellow' });
  return shapes;
}

/** Converts a searching side's mover-POV score into White's point of view. */
export function whitePovScore(
  s: SideSearch | null,
  color: Color,
): { cp?: number; mate?: number } | null {
  if (!s) return null;
  const sign = color === 'white' ? 1 : -1;
  if (s.mate !== undefined) return { mate: s.mate * sign };
  if (s.cp !== undefined) return { cp: s.cp * sign + 0 };
  return null;
}

/** Formats a searching side's score from White's point of view (`+0.42`, `-M3`, or empty). */
export function formatSideScore(s: SideSearch | null, color: Color): string {
  const score = whitePovScore(s, color);
  return score ? formatEval(score) : '';
}

/** Tag tone class for a White-POV evaluation score. */
export function scoreTone(score: { cp?: number; mate?: number } | null): string {
  if (!score) return 'tone-dim';
  if (score.mate !== undefined) return score.mate > 0 ? 'tone-good' : 'tone-bad';
  if (score.cp !== undefined) {
    if (score.cp >= 50) return 'tone-good';
    if (score.cp <= -50) return 'tone-bad';
  }
  return 'tone-dim';
}

/** Remaining clock text for live boards: tenths/hundredths below 10 s, mm:ss or h:mm:ss above. */
export function liveClockText(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 10_000) return `${(clamped / 1000).toFixed(2)}s`;
  const totalSec = Math.floor(clamped / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Proportional remaining-time bar share in [0, 100]. */
export function timeShare(ms: number, baseMs: number): number {
  if (baseMs <= 0) return 0;
  return Math.max(0, Math.min(100, (ms / baseMs) * 100));
}

/** Whether a side's remaining clock is low enough to highlight in warning tone. */
export function isLowClock(ms: number, baseMs: number): boolean {
  if (baseMs <= 0) return false;
  return ms < Math.min(3000, baseMs * 0.15);
}

/** Picks the next active game key when auto-following after a focused game finishes. */
export function pickNextLiveKey(
  active: readonly { key: string }[],
  currentKey: string | null,
): string | null {
  if (active.length === 0) return null;
  const other = active.find((g) => g.key !== currentKey);
  return other?.key ?? active[0]?.key ?? null;
}

/** Last-move squares from a UCI move list at 1-based `ply` (undefined at ply 0). */
export function uciMoveAt(uci: readonly string[], ply: number): [Key, Key] | undefined {
  if (ply <= 0) return undefined;
  return parseUciSquares(uci[ply - 1]) ?? undefined;
}
