import { describe, expect, it } from 'vitest';
import {
  Clock,
  TIME_CONTROLS,
  describeControl,
  parseControl,
  pgnTimeControl,
  resolveControl,
} from './clock.ts';

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

  it('supports one-sided clocks where the unclocked side never ticks', () => {
    let t = 0;
    const c = new Clock({
      sides: { white: { baseMs: 60_000, incMs: 1_000 }, black: null },
      now: () => t,
    });
    expect(c.hasClock('white')).toBe(true);
    expect(c.hasClock('black')).toBe(false);
    c.start('white');
    expect(c.side).toBe('white');
    t = 5_000;
    c.press();
    expect(c.remaining('white')).toBe(56_000);
    expect(c.side).toBeNull();
    t = 25_000;
    expect(c.remaining('white')).toBe(56_000);
    expect(c.remaining('black')).toBe(0);
    c.press(); // black finishes unclocked move
    expect(c.side).toBe('white');
    t = 30_000;
    expect(c.remaining('white')).toBe(51_000);
  });

  it('supports asymmetric per-side clocks with distinct increments', () => {
    let t = 0;
    const c = new Clock({
      sides: {
        white: { baseMs: 300_000, incMs: 2_000 },
        black: { baseMs: 60_000, incMs: 0 },
      },
      now: () => t,
    });
    expect(c.increment('white')).toBe(2_000);
    expect(c.increment('black')).toBe(0);
    c.start('white');
    t = 10_000;
    c.press();
    expect(c.remaining('white')).toBe(292_000);
    t = 15_000;
    c.press();
    expect(c.remaining('black')).toBe(55_000);
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

describe('parseControl', () => {
  it('reads every built-in label back as the same control', () => {
    for (const tc of TIME_CONTROLS) expect(parseControl(tc.label)).toEqual(tc);
  });

  it('reads the typed forms, keeping the text as the label', () => {
    expect(parseControl(' 5 + 0.05 ')).toEqual({
      kind: 'clock',
      label: '5 + 0.05',
      baseMs: 5000,
      incMs: 50,
    });
    expect(parseControl('40/2.5')).toMatchObject({ kind: 'moves', moves: 40, periodMs: 150_000 });
    expect(parseControl('40/900s')).toMatchObject({ kind: 'moves', periodMs: 900_000 });
    expect(parseControl('2m+1')).toMatchObject({ kind: 'clock', baseMs: 120_000, incMs: 1000 });
    expect(parseControl('3+2')).toMatchObject({ kind: 'clock', baseMs: 3000, incMs: 2000 });
    expect(parseControl('1.5M nodes')).toMatchObject({ kind: 'nodes', nodes: 1_500_000 });
    expect(parseControl('0.5s/move')).toMatchObject({ kind: 'movetime', ms: 500 });
    expect(parseControl('Depth 12')).toMatchObject({ kind: 'depth', depth: 12 });
  });

  it('refuses what is not a control, or is empty', () => {
    for (const t of ['', '10', '0+1', '40/0', 'nodes', '0s/move', 'depth 0', '5+0.05x'])
      expect(parseControl(t)).toBeNull();
  });
});

describe('describeControl', () => {
  it('reads a control back in words', () => {
    const say = (t: string) => {
      const tc = parseControl(t);
      return tc ? describeControl(tc) : null;
    };
    expect(say('10+0.1')).toBe('10 s, then +0.1 s a move');
    expect(say('40/15')).toBe('40 moves in 15 min, repeating');
    expect(say('200k nodes')).toBe('200,000 nodes a move, no clock');
    expect(say('1s/move')).toBe('1 s a move, no clock');
    expect(say('depth 12')).toBe('depth 12 a move, no clock');
  });
});

describe('resolveControl', () => {
  it('reads a label saved before the built-ins said their units', () => {
    expect(resolveControl('2+1')).toMatchObject({ label: '2m+1', baseMs: 120_000 });
    expect(resolveControl('5+0.05')).toMatchObject({ baseMs: 5000, incMs: 50 });
    expect(resolveControl('soon')).toBeNull();
  });
});
