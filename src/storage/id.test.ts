import { describe, expect, it } from 'vitest';
import { inLayout } from './backup.ts';
import { makeId, slugOf } from './id.ts';

describe('slugOf', () => {
  it('keeps engine version dots and collapses spaces and punctuation to hyphens', () => {
    expect(slugOf('ratchet-0.3.14 vs ratchet-0.3.13')).toBe('ratchet-0.3.14-vs-ratchet-0.3.13');
    expect(slugOf('Stockfish 10 vs ratchet-0.3.14')).toBe('stockfish-10-vs-ratchet-0.3.14');
    expect(slugOf('Gauntlet of 12 (2)')).toBe('gauntlet-of-12-2');
  });

  it('strips diacritics, path separators, dot runs, and leading or trailing punctuation', () => {
    expect(slugOf('Café... / .. \\ test!')).toBe('cafe-test');
    expect(slugOf('foo .-. bar')).toBe('foo-bar');
    expect(slugOf('v1..2---..3')).toBe('v1.2-3');
    expect(slugOf('...---...')).toBe('');
  });

  it('truncates long names without leaving trailing hyphens or dots', () => {
    const slug = slugOf(`${'a'.repeat(47)}.bbb`);
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug).toBe('a'.repeat(47));
  });
});

describe('makeId', () => {
  it('formats a UTC timestamp, readable slug, and 4-hex suffix', () => {
    const at = new Date('2026-11-26T07:50:14.123Z');
    const id = makeId('ratchet-0.3.14 vs Stockfish 10', at, 'a3f9');
    expect(id).toBe('20261126-075014-ratchet-0.3.14-vs-stockfish-10-a3f9');
    expect(inLayout(`tournaments/${id}/config.json`, false)).toBe(true);
    expect(inLayout(`games/t-${id}.pgn`, false)).toBe(true);
    expect(inLayout(`games/${id}.pgn`, false)).toBe(true);
  });

  it('omits the slug segment when the name has no ASCII alphanumeric characters', () => {
    const at = new Date('2026-11-26T07:50:14.000Z');
    expect(makeId('   ', at, '0f1e')).toBe('20261126-075014-0f1e');
    expect(makeId('!!!', at, '0f1e')).toBe('20261126-075014-0f1e');
  });

  it('sorts chronologically by lexical order', () => {
    const earlier = makeId('z-match', new Date('2026-11-26T07:50:14Z'), 'ffff');
    const later = makeId('a-match', new Date('2026-11-26T07:50:15Z'), '0000');
    expect([later, earlier].toSorted()).toEqual([earlier, later]);
  });

  it('generates a random 4-hex suffix by default', () => {
    const id = makeId('Test Match', new Date('2026-11-26T07:50:14Z'));
    expect(id).toMatch(/^20261126-075014-test-match-[0-9a-f]{4}$/);
  });
});
