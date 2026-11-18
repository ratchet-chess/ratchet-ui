import { describe, expect, it } from 'vitest';
import { spanText, whenText } from './format.ts';

const NOW = Date.parse('2026-11-18T12:00:00Z');

describe('format', () => {
  it('places an end by today, yesterday or a date', () => {
    const at = (h: number, m: number, back = 0) => {
      const d = new Date(NOW);
      d.setDate(d.getDate() - back);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    const today = new Date(NOW);
    today.setHours(23, 59, 0, 0);
    expect(whenText(at(0, 5), today.getTime())).toBe('00:05');
    expect(whenText(at(13, 40), today.getTime())).toBe('13:40');
    expect(whenText(at(23, 0, 1), today.getTime())).toBe('yesterday');
    expect(whenText('2026-11-02T12:00:00', today.getTime())).toBe('Nov 2');
    expect(whenText('2025-11-02T12:00:00', today.getTime())).toBe('Nov 2, 2025');
  });

  it('gives a span to come as precisely as it is worth', () => {
    expect(spanText(8 * 60_000)).toBe('8 min');
    expect(spanText(190 * 60_000)).toBe('3 h 10 min');
    expect(spanText(14.2 * 3_600_000)).toBe('14 h');
    expect(spanText(110 * 3_600_000)).toBe('4 d 14 h');
  });
});
