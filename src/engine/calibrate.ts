import { parseControl, type TimeControl } from '../chess/clock.ts';

/** Stockfish 10 64-bit single-thread reference speed on CCRL's Intel i7-4770K baseline (~1.28 Mn/s). */
export const CCRL_REF_NPS = 1_280_000;

/** Warm-up depth run before timing so WASM JIT compilation does not skew calibration. */
export const CALIBRATION_WARMUP_DEPTH = 10;

/** Fixed depth over the 3-position probe suite, matching Stockfish 10's bench depth. */
export const CALIBRATION_DEPTH = 13;

/** One saved device calibration reading for a specific concurrency level. */
export interface CalibrationSample {
  /** Concurrent anchor workers measured (1 = idle). */
  concurrency: number;
  /** Median nodes per second per worker across the calibration suite. */
  nps: number;
  /** Speed relative to CCRL's Intel i7-4770K baseline (`nps / CCRL_REF_NPS`). */
  ratio: number;
  /** Median total nodes searched per worker across the measured suite. */
  nodes: number;
  /** Median elapsed milliseconds per worker across the measured suite. */
  elapsedMs: number;
  /** Anchor engine build sha256 when measured, used to detect stale calibrations. */
  sha256: string;
  /** ISO timestamp when measured. */
  measuredAt: string;
  /** Browser Worker input mode when measured. */
  inputMode: string;
  /** Hardware thread count reported by the browser when measured. */
  threads: number;
}

/** Browser-local device speed profile: idle (1 worker) plus any measured concurrency levels. */
export interface DeviceCalibration {
  idle: CalibrationSample | null;
  concurrent: Record<number, CalibrationSample>;
}

/** A CCRL reference time control that scales to the user's calibrated device speed. */
export interface ReferenceControl {
  id: string;
  name: string;
  base: string;
  tc: Extract<TimeControl, { kind: 'clock' | 'moves' }>;
}

/** CCRL reference time controls defined on the Intel i7-4770K baseline. */
export const CCRL_PRESETS: readonly ReferenceControl[] = [
  {
    id: 'ccrl-blitz',
    name: 'CCRL Blitz',
    base: '2m+1',
    tc: { kind: 'clock', label: '2m+1', baseMs: 120_000, incMs: 1_000 },
  },
  {
    id: 'ccrl-40-4',
    name: 'CCRL 40/4',
    base: '40/4',
    tc: { kind: 'moves', label: '40/4', moves: 40, periodMs: 240_000 },
  },
  {
    id: 'ccrl-40-15',
    name: 'CCRL 40/15',
    base: '40/15',
    tc: { kind: 'moves', label: '40/15', moves: 40, periodMs: 900_000 },
  },
];

/** One reference control resolved to a concrete time control string for this device. */
export interface ScaledPreset {
  id: string;
  name: string;
  base: string;
  control: string;
}

/** Median of a non-empty numeric series, averaging the two center values for even lengths. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].toSorted((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Scales a CCRL reference time control by `ratio` (`device_nps / CCRL_REF_NPS`), returning a
 * compact control string that round-trips through `parseControl`.
 */
export function scaleControlLabel(
  tc: Extract<TimeControl, { kind: 'clock' | 'moves' }>,
  ratio: number,
): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return tc.label;
  if (tc.kind === 'clock') {
    const rawBase = tc.baseMs / 1000 / ratio;
    const rawInc = tc.incMs / 1000 / ratio;
    const base = rawBase >= 10 ? Math.round(rawBase) : Math.max(1, Number(rawBase.toFixed(1)));
    const inc =
      tc.incMs === 0
        ? 0
        : rawInc >= 10
          ? Math.round(rawInc)
          : Math.max(0.01, Number(rawInc.toFixed(2)));
    return `${base}+${inc}`;
  }
  const rawSec = tc.periodMs / 1000 / ratio;
  if (rawSec < 60) return `${tc.moves}/${Math.max(1, Math.round(rawSec))}s`;
  const rawMin = rawSec / 60;
  const mins = rawMin >= 20 ? Math.round(rawMin) : Number(rawMin.toFixed(1));
  return `${tc.moves}/${mins}`;
}

/** Resolves all CCRL presets for a given device speed ratio. */
export function scaledPresets(ratio: number): ScaledPreset[] {
  return CCRL_PRESETS.map((p) => {
    const control = scaleControlLabel(p.tc, ratio);
    // Guarantee every generated preset parses cleanly
    return {
      id: p.id,
      name: p.name,
      base: p.base,
      control: parseControl(control) ? control : p.base,
    };
  });
}

/**
 * Selects the best saved calibration sample for `concurrency`: an exact concurrent match first,
 * falling back to idle when `concurrency > 1`.
 */
export function pickCalibration(
  cal: DeviceCalibration,
  concurrency: number,
): { sample: CalibrationSample; exact: boolean } | null {
  const c = Math.max(1, Math.round(concurrency));
  if (c === 1) return cal.idle ? { sample: cal.idle, exact: true } : null;
  const matched = cal.concurrent[c];
  if (matched) return { sample: matched, exact: true };
  if (cal.idle) return { sample: cal.idle, exact: false };
  return null;
}

/** Default tournament concurrency for clocked games: half the hardware threads less one. */
export function defaultClockConcurrency(hardwareThreads: number): number {
  return Math.max(1, Math.floor(hardwareThreads / 2) - 1);
}

/** Formats a relative speed multiplier, as `0.85×` or `2.25×`. */
export function ratioText(ratio: number): string {
  return `${ratio.toFixed(2)}×`;
}

// ── localStorage persistence ────────────────────────────────────────────────

const CALIBRATION_KEY = 'ratchet-ui.device-speed';

const isRec = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isPos = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;

function sampleOf(x: unknown): CalibrationSample | null {
  if (!isRec(x)) return null;
  if (
    !isPos(x.concurrency) ||
    !isPos(x.nps) ||
    !isPos(x.ratio) ||
    !isPos(x.nodes) ||
    !isPos(x.elapsedMs) ||
    typeof x.sha256 !== 'string' ||
    typeof x.measuredAt !== 'string' ||
    typeof x.inputMode !== 'string' ||
    !isPos(x.threads)
  ) {
    return null;
  }
  return {
    concurrency: Math.round(x.concurrency),
    nps: Math.round(x.nps),
    ratio: x.ratio,
    nodes: Math.round(x.nodes),
    elapsedMs: x.elapsedMs,
    sha256: x.sha256,
    measuredAt: x.measuredAt,
    inputMode: x.inputMode,
    threads: Math.round(x.threads),
  };
}

/** Parses a stored device calibration object, dropping malformed entries. */
export function parseCalibration(raw: unknown): DeviceCalibration {
  const empty: DeviceCalibration = { idle: null, concurrent: {} };
  if (!isRec(raw)) return empty;
  const idle = sampleOf(raw.idle);
  const concurrent: Record<number, CalibrationSample> = {};
  if (isRec(raw.concurrent)) {
    for (const [k, v] of Object.entries(raw.concurrent)) {
      const s = sampleOf(v);
      const n = Number(k);
      if (s && Number.isInteger(n) && n >= 2 && s.concurrency === n) concurrent[n] = s;
    }
  }
  return { idle: idle?.concurrency === 1 ? idle : null, concurrent };
}

/** Reads the saved device calibration from localStorage. */
export function loadCalibration(): DeviceCalibration {
  try {
    const text = localStorage.getItem(CALIBRATION_KEY);
    return text ? parseCalibration(JSON.parse(text)) : { idle: null, concurrent: {} };
  } catch {
    return { idle: null, concurrent: {} };
  }
}

/** Writes the device calibration to localStorage; ignores quota or privacy errors. */
export function saveCalibration(cal: DeviceCalibration): void {
  try {
    if (!cal.idle && Object.keys(cal.concurrent).length === 0) {
      localStorage.removeItem(CALIBRATION_KEY);
    } else {
      localStorage.setItem(CALIBRATION_KEY, JSON.stringify(cal));
    }
  } catch {
    // storage unavailable
  }
}
