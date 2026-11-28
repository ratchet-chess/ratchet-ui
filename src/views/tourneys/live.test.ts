import { describe, expect, it } from 'vitest';
import {
  formatSideScore,
  isLowClock,
  liveClockText,
  pickNextLiveKey,
  pvShapes,
  scoreTone,
  timeShare,
  uciMoveAt,
  whitePovScore,
} from './live.ts';

describe('live view helpers', () => {
  it('builds green bestmove and yellow reply PV arrows only for the active position', () => {
    const base = {
      turn: 'white' as const,
      plies: 10,
      outcome: null,
      search: {
        white: { ply: 10, pv: ['e2e4', 'e7e5', 'g1f3'] },
        black: { ply: 9, pv: ['c7c5'] },
      },
    };
    expect(pvShapes(base, true, true)).toEqual([
      { orig: 'e2', dest: 'e4', brush: 'green' },
      { orig: 'e7', dest: 'e5', brush: 'yellow' },
    ]);
    // hidden when disabled, scrubbed off live, finished, or stale ply
    expect(pvShapes(base, false, true)).toEqual([]);
    expect(pvShapes(base, true, false)).toEqual([]);
    expect(
      pvShapes(
        { ...base, outcome: { result: '1-0', reason: 'checkmate', termination: 'normal' } },
        true,
        true,
      ),
    ).toEqual([]);
    expect(
      pvShapes({ ...base, search: { white: { ply: 8, pv: ['e2e4'] }, black: null } }, true, true),
    ).toEqual([]);
  });

  it('normalizes mover-POV scores into White POV and tones', () => {
    expect(whitePovScore({ ply: 1, cp: 42 }, 'white')).toEqual({ cp: 42 });
    expect(whitePovScore({ ply: 2, cp: 42 }, 'black')).toEqual({ cp: -42 });
    expect(whitePovScore({ ply: 2, mate: 3 }, 'black')).toEqual({ mate: -3 });
    expect(formatSideScore({ ply: 2, cp: 120 }, 'black')).toBe('-1.20');
    expect(formatSideScore({ ply: 1, mate: 2 }, 'white')).toBe('+M2');
    expect(scoreTone({ cp: 60 })).toBe('tone-good');
    expect(scoreTone({ cp: -80 })).toBe('tone-bad');
    expect(scoreTone({ cp: 10 })).toBe('tone-dim');
  });

  it('formats live clocks and proportional shares', () => {
    expect(liveClockText(5810)).toBe('5.81s');
    expect(liveClockText(0)).toBe('0.00s');
    expect(liveClockText(12_400)).toBe('0:12');
    expect(liveClockText(125_000)).toBe('2:05');
    expect(liveClockText(3_665_000)).toBe('1:01:05');
    expect(timeShare(5000, 10_000)).toBe(50);
    expect(timeShare(15_000, 10_000)).toBe(100);
    expect(isLowClock(1000, 10_000)).toBe(true);
    expect(isLowClock(5000, 10_000)).toBe(false);
  });

  it('picks the next active game and parses historical UCI moves', () => {
    expect(pickNextLiveKey([{ key: '1.0' }, { key: '1.1' }], '1.0')).toBe('1.1');
    expect(pickNextLiveKey([{ key: '1.0' }], '1.0')).toBe('1.0');
    expect(pickNextLiveKey([], '1.0')).toBeNull();
    expect(uciMoveAt(['e2e4', 'e7e5'], 0)).toBeUndefined();
    expect(uciMoveAt(['e2e4', 'e7e5'], 2)).toEqual(['e7', 'e5']);
  });
});
