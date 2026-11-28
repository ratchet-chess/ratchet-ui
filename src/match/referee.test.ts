import { describe, expect, it } from 'vitest';
import { parseControl, type TimeControl } from '../chess/clock.ts';
import { Game } from '../chess/game.ts';
import {
  clockFor,
  clockForSides,
  engineTurn,
  forfeitReason,
  goLimits,
  playOut,
  problemOf,
  silenceLimit,
  type MoveReport,
} from './referee.ts';
import type { Info } from '../engine/info.ts';

const control = (text: string): TimeControl => {
  const tc = parseControl(text);
  if (!tc) throw new Error(`${text} does not read`);
  return tc;
};

describe('the referee', () => {
  it('sends a fixed time a move as go movetime, with no clock, and waits 5 s past it', () => {
    const tc = control('1.5s/move');
    expect(clockFor(tc)).toBeNull();
    expect(goLimits(tc, null, 'white')).toBe('movetime 1500');
    expect(silenceLimit(tc, null, 'white')).toBe(6500);
  });

  it('sends a depth as go depth, with no clock', () => {
    const tc = control('depth 12');
    expect(clockFor(tc)).toBeNull();
    expect(goLimits(tc, null, 'black')).toBe('depth 12');
    expect(silenceLimit(tc, null, 'black')).toBe(60_000);
  });

  it('waits longer for a larger node budget or a deeper search', () => {
    expect(silenceLimit(control('5M nodes'), null, 'white')).toBe(250_000);
    expect(silenceLimit(control('depth 10'), null, 'white')).toBe(30_000);
    expect(silenceLimit(control('depth 20'), null, 'white')).toBe(960_000);
  });

  it('keeps a node budget and a clock as they were', () => {
    expect(goLimits(control('200k nodes'), null, 'white')).toBe('nodes 200000');
    const tc = control('10+0.1');
    const clock = clockFor(tc);
    expect(goLimits(tc, clock, 'white')).toBe('wtime 10000 btime 10000 winc 100 binc 100');
    expect(silenceLimit(tc, clock, 'white')).toBe(15_000);
  });

  it('supports per-side limits alongside a clocked opponent', () => {
    const whiteTc = control('2m+1');
    const blackTc = control('depth 8');
    const clock = clockForSides({ white: whiteTc, black: blackTc });
    expect(clock).not.toBeNull();
    expect(clock?.hasClock('white')).toBe(true);
    expect(clock?.hasClock('black')).toBe(false);
    expect(goLimits(blackTc, clock, 'black')).toBe('depth 8');
    expect(goLimits(whiteTc, clock, 'white')).toBe('wtime 120000 btime 120000 winc 1000 binc 1000');
  });

  it('reads back what ended a game abnormally from its reason', () => {
    const flagged = new Game();
    flagged.flag('white');
    expect(problemOf(flagged.outcome?.reason ?? '')).toBe('time');
    expect(problemOf(forfeitReason.illegal('ratchet', 'e2e5'))).toBe('illegal');
    expect(problemOf(forfeitReason.silent('ratchet', 30_000, 'nodes'))).toBe('no move');
    expect(problemOf(forfeitReason.silent('ratchet', 6500, 'clock'))).toBe('no move');
    expect(problemOf(forfeitReason.failed('ratchet', 'unreachable'))).toBe('failed');
    expect(problemOf(forfeitReason.start('the worker did not load'))).toBe('failed');
    for (const fine of [
      'checkmate',
      'stalemate',
      'draw by adjudication',
      'white lost by adjudication',
    ])
      expect(problemOf(fine)).toBeNull();
  });

  it('clamps deep-search silence timeouts so 32-bit setTimeout does not overflow to 1 ms', async () => {
    const tc = control('depth 50');
    expect(silenceLimit(tc, null, 'white')).toBeGreaterThan(2_147_483_647);
    const game = new Game();
    const fakeEngine = {
      go: async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 15);
        });
        return { move: 'e2e4', ponder: undefined };
      },
      stop: () => undefined,
    };
    await engineTurn({
      game,
      color: 'white',
      engine: fakeEngine,
      name: 'deep-engine',
      control: tc,
      clock: null,
      live: () => true,
    });
    expect(game.outcome).toBeNull();
    expect(game.uci).toEqual(['e2e4']);
  });

  it('reports live clock, search info, and per-move depth/nodes through playOut callbacks', async () => {
    // Fool's mate in 4 plies so playOut finishes cleanly via checkmate
    const moves = ['f2f3', 'e7e5', 'g2g4', 'd8h4'];
    let idx = 0;
    const makeFake = () => ({
      go: async (_pos: string, _limits: string, onInfo?: (info: Info) => void) => {
        const move = moves[idx++];
        if (!move) throw new Error('unexpected move');
        onInfo?.({ depth: 8 + idx, cp: 25 * idx, nodes: 1000 * idx, nps: 500_000, pv: [move] });
        return { move, ponder: undefined };
      },
      stop: () => undefined,
    });

    const game = new Game();
    const infos: { color: string; depth?: number }[] = [];
    const reports: MoveReport[] = [];
    let sawClock = false;

    await playOut({
      game,
      sides: {
        white: { engine: makeFake(), name: 'w' },
        black: { engine: makeFake(), name: 'b' },
      },
      control: control('10+0.1'),
      adjudication: null,
      live: () => true,
      onClock: (c) => {
        sawClock = c !== null;
      },
      onInfo: (color, info) => {
        infos.push({ color, ...(info.depth !== undefined ? { depth: info.depth } : {}) });
      },
      onMove: (r) => {
        reports.push(r);
      },
    });

    expect(sawClock).toBe(true);
    expect(game.outcome?.reason).toBe('checkmate');
    expect(infos).toHaveLength(4);
    expect(reports).toEqual([
      { color: 'white', depth: 9, nodes: 1000 },
      { color: 'black', depth: 10, nodes: 2000 },
      { color: 'white', depth: 11, nodes: 3000 },
      { color: 'black', depth: 12, nodes: 4000 },
    ]);
  });
});
