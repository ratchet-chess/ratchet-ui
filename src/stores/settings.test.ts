import { describe, expect, it } from 'vitest';
import { ANCHOR_RATING } from '../ratings/list.ts';
import { settingsFileOf } from './settings.ts';

describe('settingsFileOf', () => {
  it('reads a file with no anchor rating as the default', () => {
    expect(settingsFileOf({}).anchorRating).toBe(ANCHOR_RATING);
  });

  it('keeps a cleared anchor rating cleared', () => {
    expect(settingsFileOf({ anchorRating: null }).anchorRating).toBeNull();
  });

  it('keeps a rating the user set', () => {
    expect(settingsFileOf({ anchorRating: 2900 }).anchorRating).toBe(2900);
  });
});
