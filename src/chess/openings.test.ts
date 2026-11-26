import { describe, expect, it } from 'vitest';
import { Game } from './game.ts';
import { findOpening, lookupOpening, openingMatches } from './openings.ts';

function fensOf(uciMoves: string[]): string[] {
  const g = new Game();
  const fens = [g.fen];
  for (const m of uciMoves) {
    expect(g.play(m)).toBe(true);
    fens.push(g.fen);
  }
  return fens;
}

describe('openings', () => {
  it('recognizes common openings including pseudo-en-passant positions', () => {
    const sicilian = fensOf(['e2e4', 'c7c5']);
    expect(findOpening(sicilian)).toEqual({ eco: 'B20', name: 'Sicilian Defense', ply: 2 });

    const najdorf = fensOf([
      'e2e4',
      'c7c5',
      'g1f3',
      'd7d6',
      'd2d4',
      'c5d4',
      'f3d4',
      'g8f6',
      'b1c3',
      'a7a6',
    ]);
    const hit = findOpening(najdorf);
    expect(hit?.eco).toBe('B90');
    expect(hit?.name).toContain('Sicilian Defense: Najdorf Variation');
    expect(hit?.ply).toBe(10);
  });

  it('returns the deepest matching opening even after leaving book', () => {
    const fens = fensOf(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'a6a5']);
    const hit = findOpening(fens);
    expect(hit?.eco).toBe('C70');
    expect(hit?.name).toContain('Ruy Lopez');
    expect(hit?.ply).toBe(6);
  });

  it('returns null for an unrecognized custom position', () => {
    expect(lookupOpening('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1')).toBeNull();
  });

  it('matches ECO ranges, prefixes, and multi-word names', () => {
    expect(openingMatches('B90', 'Sicilian Defense: Najdorf Variation', 'B20-B99')).toBe(true);
    expect(openingMatches('C70', 'Ruy Lopez', 'B20-B99')).toBe(false);
    expect(openingMatches('B90', 'Sicilian Defense: Najdorf Variation', 'b9')).toBe(true);
    expect(openingMatches('B90', 'Sicilian Defense: Najdorf Variation', 'najdorf sicilian')).toBe(
      true,
    );
    expect(openingMatches('B90', 'Sicilian Defense: Najdorf Variation', 'french')).toBe(false);
    expect(openingMatches('', '', '')).toBe(true);
  });
});
