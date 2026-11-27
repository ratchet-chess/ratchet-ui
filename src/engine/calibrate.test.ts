import { describe, expect, it } from 'vitest';
import { parseControl } from '../chess/clock.ts';
import {
  CCRL_PRESETS,
  CCRL_REF_NPS,
  defaultClockConcurrency,
  median,
  parseCalibration,
  pickCalibration,
  scaleControlLabel,
  scaledPresets,
  type CalibrationSample,
} from './calibrate.ts';

const sample = (concurrency: number, nps: number): CalibrationSample => ({
  concurrency,
  nps,
  ratio: nps / CCRL_REF_NPS,
  nodes: 1_500_000,
  elapsedMs: (1_500_000 * 1000) / nps,
  sha256: 'abc123',
  measuredAt: '2026-11-26T12:00:00.000Z',
  inputMode: 'shared memory',
  threads: 16,
});

describe('device speed calibration', () => {
  it('computes medians for odd and even series', () => {
    expect(median([300, 100, 200])).toBe(200);
    expect(median([400, 100, 200, 300])).toBe(250);
    expect(median([])).toBe(0);
  });

  it('scales CCRL Blitz 2m+1 to 53+0.44 at 2.25x and scales slower devices up', () => {
    const blitz = CCRL_PRESETS[0]?.tc;
    if (!blitz) throw new Error('missing CCRL Blitz preset');
    expect(scaleControlLabel(blitz, 2.25)).toBe('53+0.44');
    expect(scaleControlLabel(blitz, 1)).toBe('120+1');
    expect(scaleControlLabel(blitz, 0.5)).toBe('240+2');
  });

  it('scales repeating move controls cleanly in minutes or seconds', () => {
    const fast = CCRL_PRESETS[1]?.tc; // 40/4
    const main = CCRL_PRESETS[2]?.tc; // 40/15
    if (!fast || !main) throw new Error('missing CCRL repeating presets');
    expect(scaleControlLabel(main, 2.25)).toBe('40/6.7');
    expect(scaleControlLabel(main, 0.5)).toBe('40/30');
    expect(scaleControlLabel(fast, 5)).toBe('40/48s');
  });

  it('generates scaled presets that all parse back cleanly across extreme speeds', () => {
    for (const ratio of [0.1, 0.45, 1, 2.25, 10]) {
      const presets = scaledPresets(ratio);
      expect(presets.length).toBe(CCRL_PRESETS.length);
      for (const p of presets) {
        expect(parseControl(p.control)).not.toBeNull();
      }
    }
  });

  it('picks an exact concurrent calibration first, falling back to idle', () => {
    const idle = sample(1, 1_280_000);
    const c4 = sample(4, 960_000);
    const cal = { idle, concurrent: { 4: c4 } };
    expect(pickCalibration(cal, 1)).toEqual({ sample: idle, exact: true });
    expect(pickCalibration(cal, 4)).toEqual({ sample: c4, exact: true });
    expect(pickCalibration(cal, 6)).toEqual({ sample: idle, exact: false });
    expect(pickCalibration({ idle: null, concurrent: { 4: c4 } }, 6)).toBeNull();
  });

  it('drops invalid entries when parsing stored calibration', () => {
    const valid = sample(1, 1_000_000);
    const valid4 = sample(4, 800_000);
    const parsed = parseCalibration({
      idle: valid,
      concurrent: {
        1: valid,
        4: valid4,
        6: { concurrency: 4, nps: 100 },
        bad: null,
      },
    });
    expect(parsed.idle).toEqual(valid);
    expect(parsed.concurrent).toEqual({ 4: valid4 });
  });

  it('guards defaultClockConcurrency against missing or non-positive thread counts', () => {
    expect(defaultClockConcurrency(Number.NaN)).toBe(1);
    expect(defaultClockConcurrency(0)).toBe(1);
    expect(defaultClockConcurrency(-4)).toBe(1);
    expect(defaultClockConcurrency(2)).toBe(1);
    expect(defaultClockConcurrency(16)).toBe(7);
  });
});
