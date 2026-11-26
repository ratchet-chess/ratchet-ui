import { describe, expect, it } from 'vitest';
import { Game } from '../chess/game.ts';
import { parseOptionsList } from '../engine/options.ts';
import { buildSetOptions, resolveSideControl } from './usePlay.ts';

describe('buildSetOptions', () => {
  const declared = parseOptionsList([
    'option name Hash type spin default 16 min 1 max 1024',
    'option name Threads type spin default 1 min 1 max 8',
    'option name Skill Level type spin default 20 min 0 max 20',
    'option name UCI_LimitStrength type check default false',
    'option name UCI_Elo type spin default 1350 min 1350 max 2850',
    'option name Clear Hash type button',
    'option name SyzygyPath type string default <empty>',
  ]);

  it('emits only declared, non-hidden, non-default options and clamps Threads to threadsCap', () => {
    expect(
      buildSetOptions(
        declared,
        {
          Hash: 32,
          Threads: 6,
          'Skill Level': 20, // default -> skipped
          UCI_LimitStrength: true,
          UCI_Elo: 1600,
          'Clear Hash': true, // button -> skipped
          SyzygyPath: '/tmp', // hidden -> skipped
          UnknownOption: 5, // undeclared -> skipped
        },
        4,
      ),
    ).toEqual([
      'setoption name Hash value 32',
      'setoption name Threads value 4',
      'setoption name UCI_Elo value 1600',
      'setoption name UCI_LimitStrength value true',
    ]);
  });

  it('locks Threads to default 1 when browser threads are unavailable (cap 1)', () => {
    expect(buildSetOptions(declared, { Threads: 4 }, 1)).toEqual([]);
  });
});

describe('resolveSideControl', () => {
  it('prefers per-side limit over game control, and falls back to 1s/move for unclocked engines', () => {
    expect(resolveSideControl({ kind: 'engine', id: 'sf' }, 'depth 8', '2m+1')).toMatchObject({
      kind: 'depth',
      depth: 8,
    });
    expect(resolveSideControl({ kind: 'engine', id: 'sf' }, '', '2m+1')).toMatchObject({
      kind: 'clock',
      label: '2m+1',
    });
    expect(resolveSideControl({ kind: 'engine', id: 'sf' }, '', '')).toMatchObject({
      kind: 'movetime',
      ms: 1000,
    });
    expect(resolveSideControl({ kind: 'person' }, '', '')).toBeNull();
  });
});

describe('Game.positionAt', () => {
  it('replays any ply without mutating live position', () => {
    const g = new Game();
    g.play('e2e4');
    g.play('e7e5');
    g.play('g1f3');
    const start = g.positionAt(0);
    expect(start.turn).toBe('white');
    expect(start.lastMove).toBeUndefined();
    const after1 = g.positionAt(1);
    expect(after1.turn).toBe('black');
    expect(after1.lastMove).toEqual(['e2', 'e4']);
    const live = g.positionAt(3);
    expect(live.fen).toBe(g.fen);
    expect(live.lastMove).toEqual(['g1', 'f3']);
  });
});
