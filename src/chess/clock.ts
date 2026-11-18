import type { Color } from 'chessops/types';
import { opposite } from 'chessops/util';

/** How long each move may take. */
export type TimeControl =
  /** a base time and an increment per move, as `10+0.1` */
  | { kind: 'clock'; label: string; baseMs: number; incMs: number }
  /** a number of moves in a period, repeating: the period's time is added after each, as `40/15` */
  | { kind: 'moves'; label: string; moves: number; periodMs: number }
  /** a node budget for each move, with no clock */
  | { kind: 'nodes'; label: string; nodes: number }
  /** a fixed time for each move, with no clock, as `1s/move` */
  | { kind: 'movetime'; label: string; ms: number }
  /** a fixed search depth for each move, with no clock, as `depth 12` */
  | { kind: 'depth'; label: string; depth: number };

/** The controls of engine testing and rating lists. */
export const TIME_CONTROLS: TimeControl[] = [
  { kind: 'clock', label: '10+0.1', baseMs: 10_000, incMs: 100 },
  { kind: 'clock', label: '60+0.6', baseMs: 60_000, incMs: 600 },
  { kind: 'clock', label: '2m+1', baseMs: 120_000, incMs: 1_000 },
  { kind: 'moves', label: '40/4', moves: 40, periodMs: 240_000 },
  { kind: 'moves', label: '40/15', moves: 40, periodMs: 900_000 },
  { kind: 'moves', label: '40/20', moves: 40, periodMs: 1_200_000 },
  { kind: 'nodes', label: '200k nodes', nodes: 200_000 },
];

const SCALE: Record<string, number> = { '': 1, k: 1e3, m: 1e6 };

/**
 * A typed control: `10+0.1` (seconds, then seconds a move, as fishtest and cutechess write it;
 * `2m+1` for minutes), `40/15` (moves in minutes, repeating, as rating lists write it; `40/900s`
 * for seconds), `200k nodes`, `1s/move`, and `depth 12`. Its label is the text as typed, trimmed,
 * so a saved tournament reads back as it was set; null when the text is none of those.
 */
export function parseControl(text: string): TimeControl | null {
  const label = text.trim().replaceAll(/\s+/g, ' ');
  const t = label.toLowerCase();
  let m = /^(\d+(?:\.\d+)?)(m|s)? ?\+ ?(\d+(?:\.\d+)?)s?$/.exec(t);
  if (m) {
    const baseMs = Math.round(Number(m[1]) * (m[2] === 'm' ? 60_000 : 1000));
    return baseMs > 0
      ? { kind: 'clock', label, baseMs, incMs: Math.round(Number(m[3]) * 1000) }
      : null;
  }
  m = /^(\d+) ?\/ ?(\d+(?:\.\d+)?)(m|s)?$/.exec(t);
  if (m) {
    const moves = Number(m[1]);
    const periodMs = Math.round(Number(m[2]) * (m[3] === 's' ? 1000 : 60_000));
    return moves > 0 && periodMs > 0 ? { kind: 'moves', label, moves, periodMs } : null;
  }
  m = /^(\d+(?:\.\d+)?) ?([km]?) ?nodes$/.exec(t);
  if (m) {
    const nodes = Math.round(Number(m[1]) * (SCALE[m[2] ?? ''] ?? 1));
    return nodes > 0 ? { kind: 'nodes', label, nodes } : null;
  }
  m = /^(\d+(?:\.\d+)?) ?s ?\/ ?move$/.exec(t);
  if (m) {
    const ms = Math.round(Number(m[1]) * 1000);
    return ms > 0 ? { kind: 'movetime', label, ms } : null;
  }
  m = /^depth ?(\d+)$/.exec(t);
  if (m) {
    const depth = Number(m[1]);
    return depth > 0 ? { kind: 'depth', label, depth } : null;
  }
  return null;
}

/** labels saved before the built-ins said their units */
const LEGACY: Record<string, string> = { '2+1': '2m+1' };

/** a saved control: a built-in by its label, then one typed; null when neither reads */
export function resolveControl(label: string): TimeControl | null {
  const built = TIME_CONTROLS.find((t) => t.label === (LEGACY[label] ?? label));
  return built ?? parseControl(label);
}

const secs = (ms: number) => `${Number((ms / 1000).toFixed(3))} s`;

/** a control in words, to read a typed one back */
export function describeControl(tc: TimeControl): string {
  if (tc.kind === 'clock') return `${secs(tc.baseMs)}, then +${secs(tc.incMs)} a move`;
  if (tc.kind === 'moves')
    return `${tc.moves} moves in ${Number((tc.periodMs / 60_000).toFixed(3))} min, repeating`;
  if (tc.kind === 'nodes') return `${tc.nodes.toLocaleString('en-US')} nodes a move, no clock`;
  if (tc.kind === 'movetime') return `${secs(tc.ms)} a move, no clock`;
  return `depth ${tc.depth} a move, no clock`;
}

/** the control as PGN's TimeControl tag writes it; `-` for a control the tag cannot express */
export function pgnTimeControl(tc: TimeControl): string {
  if (tc.kind === 'clock') return `${tc.baseMs / 1000}+${tc.incMs / 1000}`;
  if (tc.kind === 'moves') return `${tc.moves}/${tc.periodMs / 1000}`;
  return '-';
}

export interface ClockOptions {
  baseMs: number;
  incMs?: number;
  /** moves in a period; 0 for no periods. The base time is added again after each period. */
  moves?: number;
  /** the time source, for tests; the page's own time by default */
  now?: () => number;
}

/**
 * A two-sided chess clock. The side to move runs; a press banks its time, adds its increment and,
 * at the end of a period, the period's time, then starts the other side.
 */
export class Clock {
  private readonly left: Record<Color, number>;
  private readonly made: Record<Color, number> = { white: 0, black: 0 };
  private running: Color | null = null;
  /** when the running side's time last started */
  private since = 0;
  private readonly baseMs: number;
  private readonly incMs: number;
  private readonly moves: number;
  private readonly now: () => number;

  constructor(o: ClockOptions) {
    this.baseMs = o.baseMs;
    this.incMs = o.incMs ?? 0;
    this.moves = o.moves ?? 0;
    this.now = o.now ?? (() => performance.now());
    this.left = { white: o.baseMs, black: o.baseMs };
  }

  /** milliseconds left to `color`, counting the running side's time up to now */
  remaining(color: Color): number {
    const used = this.running === color ? this.now() - this.since : 0;
    return this.left[color] - used;
  }

  /** moves `color` has left in its period, for UCI's movestogo; undefined without periods */
  movesToGo(color: Color): number | undefined {
    return this.moves > 0 ? this.moves - (this.made[color] % this.moves) : undefined;
  }

  /** the side whose time runs, if any */
  get side(): Color | null {
    return this.running;
  }

  start(color: Color): void {
    this.running = color;
    this.since = this.now();
  }

  press(): void {
    if (this.running === null) return;
    const color = this.running;
    this.made[color]++;
    const period = this.moves > 0 && this.made[color] % this.moves === 0 ? this.baseMs : 0;
    this.left[color] = this.remaining(color) + this.incMs + period;
    this.start(opposite(color));
  }

  stop(): void {
    if (this.running === null) return;
    this.left[this.running] = this.remaining(this.running);
    this.running = null;
  }
}
