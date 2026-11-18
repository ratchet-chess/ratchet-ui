import type { Color } from 'chessops/types';
import { opposite } from 'chessops/util';

/** How long each move may take. */
export type TimeControl =
  /** a base time and an increment per move, as `10+0.1` */
  | { kind: 'clock'; label: string; baseMs: number; incMs: number }
  /** a number of moves in a period, repeating: the period's time is added after each, as `40/15` */
  | { kind: 'moves'; label: string; moves: number; periodMs: number }
  /** a node budget for each move, with no clock */
  | { kind: 'nodes'; label: string; nodes: number };

/** The controls of engine testing and rating lists. */
export const TIME_CONTROLS: TimeControl[] = [
  { kind: 'clock', label: '10+0.1', baseMs: 10_000, incMs: 100 },
  { kind: 'clock', label: '60+0.6', baseMs: 60_000, incMs: 600 },
  { kind: 'clock', label: '2+1', baseMs: 120_000, incMs: 1_000 },
  { kind: 'moves', label: '40/4', moves: 40, periodMs: 240_000 },
  { kind: 'moves', label: '40/15', moves: 40, periodMs: 900_000 },
  { kind: 'moves', label: '40/20', moves: 40, periodMs: 1_200_000 },
  { kind: 'nodes', label: '200k nodes', nodes: 200_000 },
];

/** the control as PGN's TimeControl tag writes it; `-` for a node budget, which the tag cannot express */
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
