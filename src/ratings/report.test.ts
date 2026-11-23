import { describe, expect, it } from 'vitest';
import type { RatingList, Row } from './list.ts';
import { escapeMarkdown, losText, POOL_NOTE, ratingMarkdown, ratingText } from './report.ts';

const row = (name: string, elo: number, pool: number, extra: Partial<Row> = {}): Row => ({
  name,
  elo,
  error: 21.4,
  model: false,
  games: 100,
  wins: 40,
  draws: 30,
  losses: 30,
  forfeits: 0,
  score: 0.55,
  opponents: elo - 30,
  los: 0.873,
  pool,
  anchor: false,
  bound: null,
  ...extra,
});
const list: RatingList = {
  rows: [
    row('stockfish-10', 2900, 0, { anchor: true, error: 0 }),
    row('ratchet-0.3.14', 2612.4, 0, { los: null }),
    row('a|b', 12.2, 1, { los: 0.99996 }),
    row('c', -12.2, 1, { los: null }),
  ],
  records: [],
  games: 300,
  pools: 2,
  anchored: true,
};

describe('ratingText', () => {
  it('aligns the table, numbers each pool from 1 and marks where a pool starts', () => {
    const text = ratingText(list, ['Ratings']);
    const lines = text.split('\n');
    expect(lines[0]).toBe('Ratings');
    expect(lines[2]).toMatch(/^#\s+engine\s+Elo\s+±\s+games/);
    expect(lines[3]).toMatch(/^1\s+stockfish-10\s+2900\s+-\s+100/);
    expect(lines[4]).toMatch(/^2\s+ratchet-0\.3\.14\s+2612\s+21/);
    expect(lines[5]).toBe(`-- ${POOL_NOTE} --`);
    // a pool without the anchor is signed about its average
    expect(lines[6]).toMatch(/^1\s+a\|b\s+\+12\s/);
    expect(lines[6]).toMatch(/100$/);
  });
});

describe('a bound', () => {
  it('reads as Ordo marks it, with no interval', () => {
    const one: RatingList = {
      ...list,
      rows: [row('sweeper', 3120.4, 0, { bound: 'floor', error: 0, los: null })],
    };
    expect(ratingText(one, []).split('\n')[2]).toMatch(/^1\s+sweeper\s+>3120\s+-\s/);
  });
});

describe('ratingMarkdown', () => {
  it('escapes names and keeps the pool note in the table', () => {
    const md = ratingMarkdown(list, ['Ratings: 4 engines']).split('\n');
    expect(md[0]).toBe('- Ratings: 4 engines');
    // the engine column reads left; every number right
    expect(md[3]).toBe(`| --: | :-- | ${Array.from({ length: 10 }, () => '--:').join(' | ')} |`);
    expect(md.some((l) => l.includes('a\\|b'))).toBe(true);
    expect(md.some((l) => l.includes(`*${POOL_NOTE}*`))).toBe(true);
  });

  it('escapes what Markdown would read', () => {
    expect(escapeMarkdown('a_b *c* [d]\ne')).toBe('a\\_b \\*c\\* \\[d\\] e');
  });
});

describe('losText', () => {
  it('reads in percent, 100 above 99.95, blank with none', () => {
    expect(losText(0.873)).toBe('87.3');
    expect(losText(0.99951)).toBe('100');
    expect(losText(null)).toBe('');
  });
});
