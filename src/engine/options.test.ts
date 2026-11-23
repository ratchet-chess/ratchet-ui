import { describe, expect, it } from 'vitest';
import { parseOption, sortOptions } from './options.ts';

describe('UCI option parser', () => {
  it('parses spin, check, string, combo, and button options', () => {
    expect(parseOption('option name Hash type spin default 16 min 1 max 1024')).toEqual({
      name: 'Hash',
      type: 'spin',
      defaultValue: '16',
      range: '1..1024',
    });
    expect(parseOption('option name UCI_Chess960 type check default false')).toEqual({
      name: 'UCI_Chess960',
      type: 'check',
      defaultValue: 'false',
      range: '',
    });
    expect(parseOption('option name Clear Hash type button')).toEqual({
      name: 'Clear Hash',
      type: 'button',
      defaultValue: '',
      range: '',
    });
    expect(parseOption('option name Style type combo default Solid var Solid var Risky')).toEqual({
      name: 'Style',
      type: 'combo',
      defaultValue: 'Solid',
      range: 'Solid, Risky',
    });
    expect(parseOption('option name SyzygyPath type string default <empty>')).toEqual({
      name: 'SyzygyPath',
      type: 'string',
      defaultValue: '<empty>',
      range: '',
    });
  });

  it('sorts Hash and Threads first, then alphabetically', () => {
    const sorted = sortOptions([
      { name: 'UCI_Chess960', type: 'check', defaultValue: 'false', range: '' },
      { name: 'Threads', type: 'spin', defaultValue: '1', range: '1..1' },
      { name: 'Contempt', type: 'spin', defaultValue: '0', range: '-100..100' },
      { name: 'Hash', type: 'spin', defaultValue: '16', range: '1..1024' },
    ]);
    expect(sorted.map((o) => o.name)).toEqual(['Hash', 'Threads', 'Contempt', 'UCI_Chess960']);
  });
});
