import { describe, expect, it } from 'vitest';
import { Adjudicator, STANDARD_ADJUDICATION } from './adjudicate.ts';

describe('Adjudicator', () => {
  it('draws after 8 moves of each side within 10 cp, from move 40', () => {
    const a = new Adjudicator(STANDARD_ADJUDICATION);
    let out: ReturnType<Adjudicator['move']> = null;
    for (let n = 33; n <= 40 && out === null; n++) {
      out = a.move('white', n, 5) ?? a.move('black', n, -3);
    }
    expect(out).toBe('draw');
  });

  it('does not draw before move 40, nor when one score leaves the bound', () => {
    const early = new Adjudicator(STANDARD_ADJUDICATION);
    for (let n = 1; n <= 20; n++) {
      expect(early.move('white', n, 0)).toBeNull();
      expect(early.move('black', n, 0)).toBeNull();
    }
    const broken = new Adjudicator(STANDARD_ADJUDICATION);
    for (let n = 40; n < 47; n++) {
      broken.move('white', n, 0);
      broken.move('black', n, 0);
    }
    expect(broken.move('white', 47, 40)).toBeNull();
    expect(broken.move('black', 47, 0)).toBeNull();
  });

  it('gives the game against a side after its 3 moves at -600 cp or worse', () => {
    const a = new Adjudicator(STANDARD_ADJUDICATION);
    expect(a.move('black', 20, -700)).toBeNull();
    expect(a.move('white', 21, 650)).toBeNull();
    expect(a.move('black', 21, -650)).toBeNull();
    expect(a.move('black', 22, -900, -5)).toBe('white');
  });

  it('breaks every run on a move with no score', () => {
    const a = new Adjudicator(STANDARD_ADJUDICATION);
    a.move('black', 20, -700);
    a.move('black', 21, -700);
    a.move('black', 22, null);
    expect(a.move('black', 23, -700)).toBeNull();
  });
});
