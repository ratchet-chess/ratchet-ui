/**
 * Parses engine evaluation and move-time annotations from PGN move comments (both fastchess/cutechess
 * mover-POV comments and Lichess/ChessBase White-POV `[%eval]` / `[%clk]` tags), normalized to
 * White's point of view for the shared EvalGraph and move readouts.
 */
import type { Color } from 'chessops/types';

/** Evaluation, timing, and remaining human text extracted from one move's PGN comments. */
export interface MoveEval {
  /** 1-based half-move index (ply 1 is the first move) */
  ply: number;
  mover: Color;
  /** centipawns from White's point of view; omitted when `mate` is set or no score exists */
  cp?: number;
  /** moves to mate from White's point of view (> 0 White mates, < 0 Black mates) */
  mate?: number;
  /** search depth reported with the score */
  depth?: number;
  /** true when the move was played from an opening book (`{book}`) */
  book?: boolean;
  /** move thinking time in seconds (directly from comment or derived from `[%clk]`) */
  timeSec?: number;
  /** remaining clock in seconds after the move (`[%clk]`) */
  clockSec?: number;
  /** remaining non-eval, non-clock comment text (such as `checkmate` or prose) */
  note: string;
}

/** Evaluation and move-time summary across a whole game. */
export interface GameEval {
  /** one entry per half-move (ply 1..N) */
  points: MoveEval[];
  hasEval: boolean;
  hasTime: boolean;
  /** maximum single-move thinking time in seconds, for scaling the time strip */
  maxTimeSec: number;
}

/** One evaluated ply along a side's evaluation series. */
export interface EvalSample {
  /** 1-based half-move index */
  ply: number;
  /** White-POV win chance in `[-1, 1]` */
  win: number;
}

const EVAL_TAG = /\[%eval\s+([+-]?(?:#[+-]?\d+|\d+(?:\.\d+)?))\]/i;
const CLK_TAG = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/i;
const ANY_CMD_TAG = /\[%[a-zA-Z]+\s+[^\]]*\]/g;
/** fastchess / cutechess comment: `+0.35/14 0.120s`, `-M3/12 0.05s`, `0.00/10 0.01s`, optional `, ...` */
const FASTCHESS = /^([+-]?(?:M\d+|\d+(?:\.\d+)?))\/(\d+)(?:\s+(\d+(?:\.\d+)?)s)?(?:,\s*(.*))?$/i;

function parseClockSeconds(h: string, m: string, s: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/** Parses one move's PGN comments and normalizes scores to White's point of view. */
export function parseMoveComment(comments: readonly string[], mover: Color, ply: number): MoveEval {
  const out: MoveEval = { ply, mover, note: '' };
  const notes: string[] = [];
  const sign = mover === 'white' ? 1 : -1;

  for (const raw of comments) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (/^book\b/i.test(trimmed)) {
      out.book = true;
      continue;
    }

    // 1. Lichess / ChessBase `[%eval ...]` (already White's POV) and `[%clk ...]`
    let handledTag = false;
    const ev = EVAL_TAG.exec(trimmed);
    if (ev?.[1]) {
      handledTag = true;
      const v = ev[1];
      if (v.includes('#')) {
        const n = Number(v.replace('#', ''));
        if (Number.isFinite(n) && n !== 0) out.mate = n;
      } else {
        const pawns = Number(v);
        if (Number.isFinite(pawns)) out.cp = Math.round(pawns * 100);
      }
    }
    const clk = CLK_TAG.exec(trimmed);
    if (clk?.[1] && clk[2] && clk[3]) {
      handledTag = true;
      const sec = parseClockSeconds(clk[1], clk[2], clk[3]);
      if (Number.isFinite(sec)) out.clockSec = sec;
    }
    if (handledTag) {
      const rest = trimmed.replaceAll(ANY_CMD_TAG, '').trim();
      if (rest) notes.push(rest);
      continue;
    }

    // 2. fastchess / cutechess `<score>/<depth> <time>s` (mover's POV)
    const fc = FASTCHESS.exec(trimmed);
    if (fc?.[1] && fc[2]) {
      const score = fc[1];
      const depth = Number(fc[2]);
      if (Number.isFinite(depth) && depth > 0) out.depth = depth;
      if (score.includes('M') || score.includes('m')) {
        const neg = score.startsWith('-');
        const mag = Number(score.replace(/^[+-]?[Mm]/, ''));
        if (Number.isFinite(mag) && mag > 0) out.mate = (neg ? -1 : 1) * sign * mag;
      } else {
        const pawns = Number(score);
        if (Number.isFinite(pawns)) out.cp = Math.round(sign * pawns * 100) + 0;
      }
      if (fc[3]) {
        const sec = Number(fc[3]);
        if (Number.isFinite(sec) && sec >= 0) out.timeSec = sec;
      }
      if (fc[4]) {
        const tail = fc[4].replaceAll(ANY_CMD_TAG, '').trim();
        if (tail) notes.push(tail);
      }
      continue;
    }

    // Strip any other `[%...]` machine tags (such as `[%cal]` / `[%csl]`) from display notes
    const cleaned = trimmed.replaceAll(ANY_CMD_TAG, '').trim();
    if (cleaned) notes.push(cleaned);
  }

  out.note = notes.join(' · ');
  return out;
}

/** Increment in seconds from a PGN TimeControl tag such as `300+3` or `10+0.1`. */
function incrementFromTag(tc: string | undefined): number {
  if (!tc) return 0;
  const m = /^\d+(?:\.\d+)?\+(\d+(?:\.\d+)?)$/.exec(tc.trim());
  if (!m?.[1]) return 0;
  const inc = Number(m[1]);
  return Number.isFinite(inc) && inc >= 0 ? inc : 0;
}

/**
 * Extracts per-move evaluations and move times for every half-move in a replay.
 * `steps[0]` is the start position; `steps[1..N]` are the positions after each half-move.
 */
export function extractGameEval(
  steps: readonly { fen: string; comments: string[] }[],
  timeControl?: string,
): GameEval {
  const points: MoveEval[] = [];
  let hasEval = false;
  let hasTime = false;
  let maxTimeSec = 0;
  const inc = incrementFromTag(timeControl);
  const prevClock: Record<Color, number | undefined> = { white: undefined, black: undefined };

  for (let ply = 1; ply < steps.length; ply++) {
    const step = steps[ply];
    const prev = steps[ply - 1];
    if (!step || !prev) continue;
    const mover: Color = prev.fen.split(' ')[1] === 'b' ? 'black' : 'white';
    const point = parseMoveComment(step.comments, mover, ply);

    if (point.timeSec === undefined && point.clockSec !== undefined) {
      const earlier = prevClock[mover];
      if (earlier !== undefined) {
        const spent = Math.max(0, earlier - point.clockSec + inc);
        point.timeSec = Math.round(spent * 100) / 100;
      }
    }
    if (point.clockSec !== undefined) prevClock[mover] = point.clockSec;

    if (point.cp !== undefined || point.mate !== undefined) hasEval = true;
    if (point.timeSec !== undefined && point.timeSec > 0) {
      hasTime = true;
      if (point.timeSec > maxTimeSec) maxTimeSec = point.timeSec;
    }
    points.push(point);
  }

  return { points, hasEval, hasTime, maxTimeSec };
}

/**
 * Maps a White-POV evaluation to `[-1, 1]` using Lichess / En Croissant's win-chance sigmoid
 * `2 / (1 + exp(-0.004 * cp)) - 1`, with mates pinned to `+1` / `-1`.
 */
export function winChance(point: { cp?: number; mate?: number }): number {
  if (point.mate !== undefined) return point.mate > 0 ? 1 : -1;
  if (point.cp === undefined) return 0;
  return 2 / (1 + Math.exp(-0.004 * point.cp)) - 1;
}

/**
 * Splits evaluated plies into separate White and Black series so two engines' scores never
 * interleave into a sawtooth line.
 */
export function evalSeries(points: readonly MoveEval[]): Record<Color, EvalSample[]> {
  const white: EvalSample[] = [];
  const black: EvalSample[] = [];
  for (const p of points) {
    if (p.cp === undefined && p.mate === undefined) continue;
    const sample: EvalSample = { ply: p.ply, win: winChance(p) };
    if (p.mover === 'white') white.push(sample);
    else black.push(sample);
  }
  return { white, black };
}

/** Formats a White-POV score such as `+0.35`, `-1.20`, `0.00`, `+M3`, or `-M2`. */
export function formatEval(point: { cp?: number; mate?: number }): string {
  if (point.mate !== undefined) return `${point.mate > 0 ? '+' : '-'}M${Math.abs(point.mate)}`;
  if (point.cp === undefined) return '';
  if (point.cp === 0) return '0.00';
  const v = point.cp / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

/** Formats a move thinking time in seconds compactly (`0.12s`, `3.4s`, `1m 12s`). */
export function formatMoveTime(sec: number): string {
  if (sec < 10) return `${sec.toFixed(2)}s`;
  if (sec < 59.95) return `${sec.toFixed(1)}s`;
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Formats a remaining clock value in seconds (`4:40` or `1:04:40`). */
export function formatClock(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
