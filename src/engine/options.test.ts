import { describe, expect, it } from 'vitest';
import {
  formatSetOption,
  groupPlayOptions,
  isDefaultOptionValue,
  isHiddenPlayOption,
  optionBounds,
  parseOption,
  sortOptions,
  summarizeOverrides,
} from './options.ts';

function mustParse(line: string) {
  const opt = parseOption(line);
  if (!opt) throw new Error(`failed to parse: ${line}`);
  return opt;
}

describe('UCI option parser', () => {
  it('parses spin, check, string, combo, and button options with structured bounds', () => {
    expect(parseOption('option name Hash type spin default 16 min 1 max 1024')).toEqual({
      name: 'Hash',
      type: 'spin',
      defaultValue: '16',
      range: '1..1024',
      min: 1,
      max: 1024,
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
      vars: ['Solid', 'Risky'],
    });
    expect(parseOption('option name SyzygyPath type string default <empty>')).toEqual({
      name: 'SyzygyPath',
      type: 'string',
      defaultValue: '<empty>',
      range: '',
    });
  });

  it('derives bounds from range for older cached options lacking min/max/vars', () => {
    expect(
      optionBounds({ name: 'Skill Level', type: 'spin', defaultValue: '20', range: '0..20' }),
    ).toEqual({ min: 0, max: 20, vars: [] });
    expect(
      optionBounds({ name: 'Style', type: 'combo', defaultValue: 'Solid', range: 'Solid, Risky' }),
    ).toEqual({ min: undefined, max: undefined, vars: ['Solid', 'Risky'] });
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

  it('groups Play options into strength, resources, and other while hiding button and path options', () => {
    const clearHash = mustParse('option name Clear Hash type button');
    const syzygy = mustParse('option name SyzygyPath type string default <empty>');
    const debugLog = mustParse('option name Debug Log File type string default');
    const opts = [
      clearHash,
      syzygy,
      debugLog,
      mustParse('option name Skill Level type spin default 20 min 0 max 20'),
      mustParse('option name UCI_Elo type spin default 1350 min 1350 max 2850'),
      mustParse('option name UCI_LimitStrength type check default false'),
      mustParse('option name Threads type spin default 1 min 1 max 8'),
      mustParse('option name Hash type spin default 16 min 1 max 1024'),
      mustParse('option name Contempt type spin default 24 min -100 max 100'),
    ];
    expect(isHiddenPlayOption(clearHash)).toBe(true);
    expect(isHiddenPlayOption(syzygy)).toBe(true);
    expect(isHiddenPlayOption(debugLog)).toBe(true);
    const grouped = groupPlayOptions(opts);
    expect(grouped.strength.map((o) => o.name)).toEqual([
      'UCI_LimitStrength',
      'UCI_Elo',
      'Skill Level',
    ]);
    expect(grouped.core.map((o) => o.name)).toEqual(['Hash', 'Threads']);
    expect(grouped.other.map((o) => o.name)).toEqual(['Contempt']);
  });

  it('detects defaults, formats setoption safely, and summarizes overrides', () => {
    const skill = mustParse('option name Skill Level type spin default 20 min 0 max 20');
    const hash = mustParse('option name Hash type spin default 16 min 1 max 1024');
    const limit = mustParse('option name UCI_LimitStrength type check default false');
    expect(isDefaultOptionValue(skill, 20)).toBe(true);
    expect(isDefaultOptionValue(skill, 8)).toBe(false);
    expect(formatSetOption('Skill Level', 8)).toBe('setoption name Skill Level value 8');
    expect(formatSetOption('Note', 'a\nb\rc')).toBe('setoption name Note value a b c');
    expect(
      summarizeOverrides(
        [skill, hash, limit],
        { 'Skill Level': 8, Hash: 32, UCI_LimitStrength: true },
        'depth 8',
      ),
    ).toEqual(['depth 8', 'UCI_LimitStrength', 'Skill Level 8', 'Hash 32']);
  });
});
