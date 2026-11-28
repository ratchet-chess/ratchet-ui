import { describe, expect, it } from 'vitest';
import { ANCHOR_NAME, ANCHOR_RATING } from '../ratings/list.ts';
import { settingsFileOf, unionOf } from './settings.ts';

describe('settingsFileOf', () => {
  it('reads a file with no anchor settings as the default', () => {
    const f = settingsFileOf({});
    expect(f.anchorName).toBe(ANCHOR_NAME);
    expect(f.anchorRating).toBe(ANCHOR_RATING);
  });

  it('keeps a cleared anchor rating or cleared anchor name as null', () => {
    expect(settingsFileOf({ anchorRating: null })).toMatchObject({
      anchorName: ANCHOR_NAME,
      anchorRating: null,
    });
    expect(settingsFileOf({ anchorName: null, anchorRating: null })).toMatchObject({
      anchorName: null,
      anchorRating: null,
    });
    expect(settingsFileOf({ anchorName: '   ' }).anchorName).toBeNull();
  });

  it('keeps a custom anchor engine and rating the user set', () => {
    expect(
      settingsFileOf({ anchorName: 'Stockfish 10 64 POPCNT', anchorRating: 2900 }),
    ).toMatchObject({
      anchorName: 'Stockfish 10 64 POPCNT',
      anchorRating: 2900,
    });
  });

  it('reads valid engineOptions and drops invalid limits or non-primitive values', () => {
    const f = settingsFileOf({
      engineOptions: {
        'stockfish-10': {
          options: { 'Skill Level': 8, UCI_LimitStrength: true, bad: { x: 1 } },
          limit: 'depth 8',
        },
        'ratchet-0.3.14': {
          options: { Hash: 32 },
          limit: 'not a control',
        },
        empty: { options: {}, limit: '' },
      },
    });
    expect(f.engineOptions).toEqual({
      'stockfish-10': { options: { 'Skill Level': 8, UCI_LimitStrength: true }, limit: 'depth 8' },
      'ratchet-0.3.14': { options: { Hash: 32 } },
    });
  });

  it('defaults backupBooks and backupEngines to true unless explicitly false', () => {
    expect(settingsFileOf({}).backupBooks).toBe(true);
    expect(settingsFileOf({}).backupEngines).toBe(true);
    expect(settingsFileOf({ backupBooks: false, backupEngines: false })).toMatchObject({
      backupBooks: false,
      backupEngines: false,
    });
  });

  it('merges engineOptions in unionOf, keeping local entries on conflict', () => {
    const here = settingsFileOf({
      engineOptions: { 'stockfish-10': { options: { 'Skill Level': 5 } } },
    });
    const there = settingsFileOf({
      engineOptions: {
        'stockfish-10': { options: { 'Skill Level': 12 } },
        'ratchet-0.3.14': { options: { Hash: 64 }, limit: 'depth 10' },
      },
    });
    expect(unionOf(here, there).engineOptions).toEqual({
      'stockfish-10': { options: { 'Skill Level': 5 } },
      'ratchet-0.3.14': { options: { Hash: 64 }, limit: 'depth 10' },
    });
  });
});
