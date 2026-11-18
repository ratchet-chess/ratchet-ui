import { describe, expect, it } from 'vitest';
import { Clock, TIME_CONTROLS, pgnTimeControl } from './clock.ts';

describe('Clock', () => {
  it('runs only the side to move, and adds the increment on a press', () => {
    let t = 0;
    const c = new Clock({ baseMs: 60_000, incMs: 1_000, now: () => t });
    c.start('white');
    t = 5_000;
    expect(c.remaining('white')).toBe(55_000);
    expect(c.remaining('black')).toBe(60_000);
    c.press();
    expect(c.remaining('white')).toBe(56_000);
    t = 8_000;
    expect(c.remaining('black')).toBe(57_000);
    c.stop();
    t = 20_000;
    expect(c.remaining('black')).toBe(57_000);
    expect(c.side).toBeNull();
    expect(c.movesToGo('white')).toBeUndefined();
  });

  it("adds the period's time after the period's last move", () => {
    let t = 0;
    const c = new Clock({ baseMs: 1_000, moves: 2, now: () => t });
    c.start('white');
    expect(c.movesToGo('white')).toBe(2);
    t = 100;
    c.press(); // white's first move
    t = 200;
    c.press(); // black's first move
    expect(c.movesToGo('white')).toBe(1);
    t = 300;
    c.press(); // white's second move ends its period
    expect(c.remaining('white')).toBe(800 + 1_000);
    expect(c.movesToGo('white')).toBe(2);
  });
});

describe('pgnTimeControl', () => {
  it('writes each kind as the TimeControl tag does', () => {
    expect(TIME_CONTROLS.map(pgnTimeControl)).toEqual([
      '10+0.1',
      '60+0.6',
      '120+1',
      '40/240',
      '40/900',
      '40/1200',
      '-',
    ]);
  });
});
