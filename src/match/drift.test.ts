import { describe, expect, it } from 'vitest';
import { analyzeDrift, driftLines, hasDrift } from './drift.ts';
import type { GameRecord } from './summary.ts';

const game = (
  pair: number,
  g: 0 | 1,
  wnps: number,
  bnps: number,
  white = g === 0 ? 0 : 1,
  black = g === 0 ? 1 : 0,
): GameRecord => ({
  pair,
  game: g,
  white,
  black,
  result: '1/2-1/2',
  reason: 'draw',
  plies: 60,
  wnps,
  bnps,
});

describe('passive speed drift', () => {
  it('ignores node-budget and depth controls', () => {
    const games = Array.from({ length: 10 }, (_, i) =>
      game(i, 0, i < 4 ? 1_000_000 : 400_000, 1_000_000, 0, 1),
    );
    expect(hasDrift(analyzeDrift('200k nodes', games, false))).toBe(false);
    expect(hasDrift(analyzeDrift('depth 12', games, false))).toBe(false);
  });

  it('stays quiet under normal game-to-game variance', () => {
    const games: GameRecord[] = [];
    const speeds = [820_000, 790_000, 850_000, 770_000, 800_000, 760_000, 830_000, 780_000];
    for (const [i, nps] of speeds.entries()) {
      games.push(game(i, 0, nps, nps * 0.5));
      games.push(game(i, 1, nps * 0.5, nps));
    }
    const report = analyzeDrift('10+0.1', games, true);
    expect(report.measuredGames).toBe(16);
    expect(hasDrift(report)).toBe(false);
  });

  it('flags sustained NPS drops of 25% or more over a 4-game window', () => {
    const games: GameRecord[] = [
      game(0, 0, 1_000_000, 500_000, 0, 1),
      game(1, 0, 980_000, 510_000, 0, 1),
      game(2, 0, 1_020_000, 490_000, 0, 1),
      game(3, 0, 990_000, 505_000, 0, 1),
      game(4, 0, 680_000, 495_000, 0, 1),
      game(5, 0, 660_000, 500_000, 0, 1),
      game(6, 0, 650_000, 490_000, 0, 1),
      game(7, 0, 670_000, 505_000, 0, 1),
    ];
    const report = analyzeDrift('60+0.6', games, false);
    expect(report.drops.length).toBe(1);
    expect(report.drops[0]?.entrant).toBe(0);
    expect(report.drops[0]?.drop).toBeGreaterThan(0.3);
    expect(driftLines(report, (i) => (i === 0 ? 'ratchet' : 'sf10'))).toEqual([
      'Speed drift: ratchet down 33% (995 k → 665 k nps)',
    ]);
  });

  it('flags color-swapped pairs with asymmetric relative speeds', () => {
    const games: GameRecord[] = [
      // Normal pair: engine 0 is 2x faster than engine 1 in both games
      game(0, 0, 1_000_000, 500_000),
      game(0, 1, 500_000, 1_000_000),
      // Asymmetric pair: engine 0 stalled in game 1 (dropped to 0.5x of engine 1 -> 4x swing)
      game(1, 0, 1_000_000, 500_000),
      game(1, 1, 500_000, 250_000),
    ];
    const report = analyzeDrift('10+0.1', games, true);
    expect(report.drops).toEqual([]);
    expect(report.asymmetricPairs).toEqual([{ pair: 1, ratio: 4 }]);
    expect(driftLines(report, () => 'e')).toEqual(['Speed drift: 1 asymmetric pair']);
  });
});
