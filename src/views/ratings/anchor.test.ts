import { describe, expect, it } from 'vitest';
import { ANCHOR_NAME, ANCHOR_RATING, type RatingList, type Row } from '../../ratings/list.ts';
import { ANCHOR_LIMIT, anchorOptions, pickAnchor } from './anchor.ts';

function row(name: string, overrides: Partial<Row> = {}): Row {
  return {
    name,
    elo: 0,
    error: 20,
    model: false,
    bound: null,
    games: 100,
    wins: 40,
    draws: 20,
    losses: 40,
    forfeits: 0,
    score: 0.5,
    opponents: 0,
    los: null,
    pool: 0,
    anchor: false,
    ...overrides,
  };
}

function listOf(rows: Row[], anchored: boolean): RatingList {
  return {
    rows,
    records: [],
    games: rows.reduce((t, r) => t + r.games, 0) / 2,
    pools: new Set(rows.map((r) => r.pool)).size,
    anchored,
  };
}

describe('anchorOptions', () => {
  it('lists None first, stockfish-10 next when present, then others by games played', () => {
    const rows = [
      row('beta', { games: 50 }),
      row('alpha', { games: 200 }),
      row(ANCHOR_NAME, { games: 10 }),
      row('gamma', { games: 200 }),
    ];
    const res = anchorOptions(rows, '', ANCHOR_NAME);
    expect(res.hits.map((o) => o.name)).toEqual([null, ANCHOR_NAME, 'alpha', 'gamma', 'beta']);
    expect(res.hits[1]?.isDefault).toBe(true);
    expect(res.truncated).toBe(false);
  });

  it('omits stockfish-10 when not in the filtered games', () => {
    const rows = [row('Komodo 14', { games: 400 }), row('Stockfish 10 64 POPCNT', { games: 800 })];
    const res = anchorOptions(rows, '', ANCHOR_NAME);
    expect(res.hits.map((o) => o.name)).toEqual([null, 'Stockfish 10 64 POPCNT', 'Komodo 14']);
  });

  it('filters by query, matching None on average or none', () => {
    const rows = [row('stockfish-10', { games: 100 }), row('stash-37.0', { games: 200 })];
    expect(anchorOptions(rows, 'stash', ANCHOR_NAME).hits.map((o) => o.name)).toEqual([
      'stash-37.0',
    ]);
    expect(anchorOptions(rows, 'average', ANCHOR_NAME).hits.map((o) => o.name)).toEqual([null]);
  });

  it('caps visible items for 100+ engines while keeping the selected engine visible', () => {
    const rows = Array.from({ length: 120 }, (_, i) => row(`eng-${i}`, { games: 120 - i }));
    const res = anchorOptions(rows, '', 'eng-119');
    expect(res.truncated).toBe(true);
    expect(res.matchedEngines).toBe(120);
    expect(res.hits).toHaveLength(ANCHOR_LIMIT);
    expect(res.hits[0]?.name).toBeNull();
    expect(res.hits.some((o) => o.name === 'eng-119')).toBe(true);
  });
});

describe('pickAnchor', () => {
  it('clears name and rating for None', () => {
    const list = listOf([row(ANCHOR_NAME, { elo: ANCHOR_RATING, anchor: true })], true);
    expect(pickAnchor(list, null)).toEqual({ name: null, rating: null, needsRating: false });
  });

  it('restores the default CCRL rating when switching back to stockfish-10', () => {
    const list = listOf(
      [row('stash-37.0', { elo: 3400, anchor: true }), row(ANCHOR_NAME, { elo: 3512 })],
      true,
    );
    expect(pickAnchor(list, ANCHOR_NAME)).toEqual({
      name: ANCHOR_NAME,
      rating: ANCHOR_RATING,
      needsRating: false,
    });
  });

  it('preserves the scale when switching within an anchored pool', () => {
    const list = listOf(
      [row(ANCHOR_NAME, { elo: ANCHOR_RATING, anchor: true }), row('stash-37.0', { elo: 3397.6 })],
      true,
    );
    expect(pickAnchor(list, 'stash-37.0')).toEqual({
      name: 'stash-37.0',
      rating: 3398,
      needsRating: false,
    });
  });

  it('starts at 0 and requests focus when picking an engine in an unanchored pool', () => {
    const list = listOf(
      [
        row(ANCHOR_NAME, { elo: ANCHOR_RATING, pool: 0, anchor: true }),
        row('Stockfish 10 64 POPCNT', { elo: 148, pool: 1 }),
      ],
      true,
    );
    expect(pickAnchor(list, 'Stockfish 10 64 POPCNT')).toEqual({
      name: 'Stockfish 10 64 POPCNT',
      rating: 0,
      needsRating: true,
    });

    const unanchored = listOf([row('Stockfish 10 64 POPCNT', { elo: 148, pool: 0 })], false);
    expect(pickAnchor(unanchored, 'Stockfish 10 64 POPCNT')).toEqual({
      name: 'Stockfish 10 64 POPCNT',
      rating: 0,
      needsRating: true,
    });
  });
});
