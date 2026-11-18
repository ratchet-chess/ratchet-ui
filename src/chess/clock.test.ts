import { describe, expect, it } from 'vitest';
import { Clock } from './clock.ts';

describe('Clock', () => {
  it('runs only the side to move, and adds the increment on a press', () => {
    let t = 0;
    const c = new Clock(60_000, 1_000, () => t);
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
  });
});
