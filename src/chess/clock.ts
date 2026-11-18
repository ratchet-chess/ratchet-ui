import type { Color } from 'chessops/types';
import { opposite } from 'chessops/util';

/** How long each move may take: a clock with an increment, or a fixed time per move. */
export type TimeControl =
  | { kind: 'clock'; label: string; baseMs: number; incMs: number }
  | { kind: 'movetime'; label: string; ms: number };

export const TIME_CONTROLS: TimeControl[] = [
  { kind: 'clock', label: '1+1', baseMs: 60_000, incMs: 1_000 },
  { kind: 'clock', label: '3+2', baseMs: 180_000, incMs: 2_000 },
  { kind: 'clock', label: '5+3', baseMs: 300_000, incMs: 3_000 },
  { kind: 'clock', label: '10+5', baseMs: 600_000, incMs: 5_000 },
  { kind: 'clock', label: '15+10', baseMs: 900_000, incMs: 10_000 },
  { kind: 'movetime', label: '1 s a move', ms: 1_000 },
  { kind: 'movetime', label: '3 s a move', ms: 3_000 },
];

/**
 * A two-sided chess clock on the page's own time. The side to move runs; a press adds its
 * increment and starts the other side.
 */
export class Clock {
  private readonly left: Record<Color, number>;
  private running: Color | null = null;
  /** when the running side's time last started */
  private since = 0;

  private readonly incMs: number;
  private readonly now: () => number;

  constructor(baseMs: number, incMs: number, now: () => number = () => performance.now()) {
    this.left = { white: baseMs, black: baseMs };
    this.incMs = incMs;
    this.now = now;
  }

  /** milliseconds left to `color`, counting the running side's time up to now */
  remaining(color: Color): number {
    const used = this.running === color ? this.now() - this.since : 0;
    return this.left[color] - used;
  }

  /** the side whose time runs, if any */
  get side(): Color | null {
    return this.running;
  }

  start(color: Color): void {
    this.running = color;
    this.since = this.now();
  }

  /** ends the running side's move: banks its time and increment, and starts the other side */
  press(): void {
    if (this.running === null) return;
    const color = this.running;
    this.left[color] = this.remaining(color) + this.incMs;
    this.start(opposite(color));
  }

  stop(): void {
    if (this.running === null) return;
    this.left[this.running] = this.remaining(this.running);
    this.running = null;
  }
}
