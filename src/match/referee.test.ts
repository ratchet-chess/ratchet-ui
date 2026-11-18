import { describe, expect, it } from 'vitest';
import { parseControl, type TimeControl } from '../chess/clock.ts';
import { Game } from '../chess/game.ts';
import { clockFor, forfeitReason, goLimits, problemOf, silenceLimit } from './referee.ts';

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
});
