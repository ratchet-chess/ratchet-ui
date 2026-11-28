import { describe, expect, it } from 'vitest';
import type { ServedEngine } from '../../engine/manifest.ts';
import type { RatingList, Row } from '../../ratings/list.ts';
import { IN_BROWSER_SOURCE } from '../../stores/engines.ts';
import {
  familiesOf,
  familyOf,
  filterEngines,
  formatPickerElo,
  kindCountsOf,
  kindOf,
  ratingsByEngine,
  sortEngines,
  sortFieldIds,
  type PickerFilter,
} from './picker.ts';

function makeEngine(
  id: string,
  name: string,
  opts: { source?: string; metaKind?: 'own' | 'adapted' | 'release' } = {},
): ServedEngine {
  return {
    id,
    name,
    version: null,
    wasm: `${id}.wasm`,
    bytes: 1000,
    sha256: 'abc',
    source: opts.source ?? 'ratchet-chess/uci-over-wasi tag',
    license: 'MIT',
    ...(opts.metaKind
      ? {
          meta: {
            kind: opts.metaKind,
            buildBasis: 'adapted-from-code',
            date: '2026-01-01',
            year: 2026,
            originalAuthors: ['Author'],
            sources: [],
            blurb: 'blurb',
            features: [],
          },
        }
      : {}),
  };
}

function makeRow(name: string, elo: number, overrides: Partial<Row> = {}): Row {
  return {
    name,
    elo,
    error: 18,
    model: false,
    bound: null,
    games: 100,
    wins: 50,
    draws: 30,
    losses: 20,
    forfeits: 0,
    score: 0.65,
    opponents: 2800,
    los: null,
    pool: 0,
    anchor: false,
    ...overrides,
  };
}

const emptyFilter = (overrides: Partial<PickerFilter> = {}): PickerFilter => ({
  query: '',
  familiesAll: true,
  families: new Set(),
  kinds: new Set(),
  rated: 'any',
  eloMin: '',
  eloMax: '',
  ...overrides,
});

const SF10 = makeEngine('stockfish-10', 'Stockfish', { metaKind: 'adapted' });
const SF11 = makeEngine('stockfish-11', 'Stockfish', { metaKind: 'adapted' });
const STASH9 = makeEngine('stash-9.0.1', 'Stash', { metaKind: 'adapted' });
const STASH15 = makeEngine('stash-15.3', 'Stash', { metaKind: 'adapted' });
const RATCHET = makeEngine('ratchetHCE-0.4.0', 'RatchetHCE');
const CHESS46 = makeEngine('chess-4.6', 'Chess 4.x', { metaKind: 'release' });
const USER = makeEngine('my-engine-1.2', 'My Engine 1.2', { source: IN_BROWSER_SOURCE });

const ENGINES: ServedEngine[] = [SF10, SF11, STASH9, STASH15, RATCHET, CHESS46, USER];

const LIST: RatingList = {
  rows: [
    makeRow('stockfish-11', 3588, { error: 0, model: true, bound: 'floor' }),
    makeRow('stockfish-10', 3509, { error: 0, anchor: true }),
    makeRow('stash-15.3', 2630, { error: 24, model: true }),
    makeRow('ratchetHCE-0.4.0', 2645, { error: 14 }),
    makeRow('chess-4.6', 42, { error: 35, pool: 1 }),
  ],
  records: [],
  games: 200,
  pools: 2,
  anchored: true,
};

describe('familyOf and kindOf', () => {
  it('uses manifest name for served engines and stripped id for in-browser engines', () => {
    expect(familyOf(SF10)).toBe('Stockfish');
    expect(familyOf(USER)).toBe('my-engine');
    expect(familiesOf(ENGINES)).toEqual([
      ['Chess 4.x', 1],
      ['my-engine', 1],
      ['RatchetHCE', 1],
      ['Stash', 2],
      ['Stockfish', 2],
    ]);
  });

  it('infers own engine when ratchet build lacks meta, and browser for user builds', () => {
    expect(kindOf(SF10)).toBe('adapted');
    expect(kindOf(RATCHET)).toBe('own');
    expect(kindOf(CHESS46)).toBe('release');
    expect(kindOf(USER)).toBe('browser');
    expect(kindCountsOf(ENGINES)).toEqual({ own: 1, adapted: 4, release: 1, browser: 1 });
  });
});

describe('filterEngines', () => {
  const ratings = ratingsByEngine(LIST);

  it('filters by query matching id or family', () => {
    expect(
      filterEngines(ENGINES, ratings, emptyFilter({ query: 'stash' })).map((e) => e.id),
    ).toEqual(['stash-9.0.1', 'stash-15.3']);
    expect(filterEngines(ENGINES, ratings, emptyFilter({ query: '4.x' })).map((e) => e.id)).toEqual(
      ['chess-4.6'],
    );
  });

  it('filters by explicit family set including empty selection', () => {
    expect(
      filterEngines(
        ENGINES,
        ratings,
        emptyFilter({ familiesAll: false, families: new Set(['Stash', 'RatchetHCE']) }),
      ).map((e) => e.id),
    ).toEqual(['stash-9.0.1', 'stash-15.3', 'ratchetHCE-0.4.0']);

    expect(
      filterEngines(ENGINES, ratings, emptyFilter({ familiesAll: false, families: new Set() })),
    ).toEqual([]);
  });

  it('filters by kind and rated status', () => {
    expect(
      filterEngines(ENGINES, ratings, emptyFilter({ kinds: new Set(['own', 'browser']) })).map(
        (e) => e.id,
      ),
    ).toEqual(['ratchetHCE-0.4.0', 'my-engine-1.2']);

    expect(
      filterEngines(ENGINES, ratings, emptyFilter({ rated: 'unrated' })).map((e) => e.id),
    ).toEqual(['stash-9.0.1', 'my-engine-1.2']);

    expect(
      filterEngines(ENGINES, ratings, emptyFilter({ rated: 'rated' })).map((e) => e.id),
    ).toEqual(['stockfish-10', 'stockfish-11', 'stash-15.3', 'ratchetHCE-0.4.0', 'chess-4.6']);
  });

  it('hides unrated and secondary-pool engines when an Elo bound is set', () => {
    expect(
      filterEngines(ENGINES, ratings, emptyFilter({ eloMin: '2600', eloMax: '3550' })).map(
        (e) => e.id,
      ),
    ).toEqual(['stockfish-10', 'stash-15.3', 'ratchetHCE-0.4.0']);

    // Even a bound covering +42 excludes secondary pools
    expect(
      filterEngines(ENGINES, ratings, emptyFilter({ eloMin: '0', eloMax: '5000' })).map(
        (e) => e.id,
      ),
    ).not.toContain('chess-4.6');
  });
});

describe('sortEngines and sortFieldIds', () => {
  const ratings = ratingsByEngine(LIST);

  it('sorts names naturally ascending and descending', () => {
    const asc = sortEngines(ENGINES, ratings, { key: 'name', dir: 'asc' }).map((e) => e.id);
    expect(asc.indexOf('stash-9.0.1')).toBeLessThan(asc.indexOf('stash-15.3'));
    const desc = sortEngines(ENGINES, ratings, { key: 'name', dir: 'desc' }).map((e) => e.id);
    expect(desc.indexOf('stash-15.3')).toBeLessThan(desc.indexOf('stash-9.0.1'));
  });

  it('sorts Elo with pool 0 first, secondary pools next, and unrated at the bottom', () => {
    const highFirst = sortEngines(ENGINES, ratings, { key: 'elo', dir: 'desc' }).map((e) => e.id);
    expect(highFirst).toEqual([
      'stockfish-11',
      'stockfish-10',
      'ratchetHCE-0.4.0',
      'stash-15.3',
      'chess-4.6',
      'my-engine-1.2',
      'stash-9.0.1',
    ]);

    const lowFirst = sortFieldIds(
      ['stockfish-10', 'stash-9.0.1', 'chess-4.6', 'stash-15.3'],
      ratings,
      { key: 'elo', dir: 'asc' },
    );
    expect(lowFirst).toEqual(['stash-15.3', 'stockfish-10', 'chess-4.6', 'stash-9.0.1']);
  });
});

describe('formatPickerElo', () => {
  const ratings = ratingsByEngine(LIST);

  it('formats anchor, normal, model-interval, bounded, secondary pool, and unrated', () => {
    expect(formatPickerElo(ratings.get('stockfish-10'))).toMatchObject({
      text: '3,509',
      errorText: '',
      errorWarn: false,
      dimmed: false,
      unrated: false,
    });
    expect(formatPickerElo(ratings.get('ratchetHCE-0.4.0'))).toMatchObject({
      text: '2,645',
      errorText: '±14',
      errorWarn: false,
      dimmed: false,
    });
    expect(formatPickerElo(ratings.get('stash-15.3'))).toMatchObject({
      text: '2,630',
      errorText: '±24',
      errorWarn: true,
      dimmed: false,
    });
    expect(formatPickerElo(ratings.get('stockfish-11'))).toMatchObject({
      text: '>3,588',
      errorText: '',
      errorWarn: false,
      dimmed: false,
    });
    expect(formatPickerElo(ratings.get('chess-4.6'))).toMatchObject({
      text: '+42',
      errorText: '±35',
      dimmed: true,
      unrated: false,
    });
    expect(formatPickerElo(undefined)).toMatchObject({
      text: '—',
      errorText: '',
      unrated: true,
    });
  });
});
