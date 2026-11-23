import type { Info } from './info.ts';
import type { ProbeSuite, UciOption } from './options.ts';
import {
  inspectModule,
  runChecks,
  type CheckDriver,
  type CheckResult,
  type Inspection,
} from '../../vendor/uci-over-wasi/check.ts';
import {
  browserDriver,
  canRunBrowserChecks,
  canSpawnBrowserThreads,
} from '../../vendor/uci-over-wasi/check-browser.ts';
import type { Feature, Profile } from '../../vendor/uci-over-wasi/wasi.ts';

/** Cached UCI handshake result for one served engine. */
export interface EngineInspection {
  state: 'loading' | 'done' | 'failed';
  idName: string;
  idAuthor: string;
  startMs: number | null;
  options: UciOption[];
  error: string;
}

/** One position's row inside a speed probe run. */
export interface ProbeRow {
  label: string;
  state: 'pending' | 'running' | 'done';
  last: Info | null;
  nodes: number | null;
  elapsedMs: number | null;
  best: string;
}

/** Cached speed probe state for one served engine. */
export interface EngineProbe {
  state: 'starting' | 'running' | 'done' | 'stopped' | 'failed';
  suite: ProbeSuite;
  depth: number;
  startMs: number | null;
  rows: ProbeRow[];
  error: string;
}

/** Serializable summary of static WASM inspection. */
export interface WasiStaticInfo {
  profile: Profile;
  requires: Feature[];
  threadSpawn: boolean;
  sharedMemory: boolean;
  atomics: boolean;
  exceptionHandling: boolean;
  relaxed: [string, number][];
}

export type WasiCheckStatus = 'running' | 'pass' | 'fail' | 'invalid' | 'static' | 'cancelled';

/** Live or persisted UCI over WASI check report. */
export interface WasiCheckReport {
  fileName: string;
  size: number;
  state: WasiCheckStatus;
  info: WasiStaticInfo | null;
  identity: { name: string; author: string } | null;
  results: CheckResult[];
  fatalError: string;
  staticNote: string;
}

/** Per-engine persisted entries in localStorage, invalidated when sha256 changes. */
export interface PersistedEngineData {
  sha256: string;
  inspection?: EngineInspection;
  probe?: EngineProbe;
  wasi?: WasiCheckReport;
}

const CACHE_KEY = 'ratchet-ui.engine-cache';

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isString = (x: unknown): x is string => typeof x === 'string';
const isNumOrNull = (x: unknown): x is number | null => x === null || typeof x === 'number';

function isInspection(x: unknown): x is EngineInspection {
  return (
    isRecord(x) &&
    x.state === 'done' &&
    isString(x.idName) &&
    isString(x.idAuthor) &&
    isNumOrNull(x.startMs) &&
    Array.isArray(x.options)
  );
}

function isProbe(x: unknown): x is EngineProbe {
  return (
    isRecord(x) &&
    x.state === 'done' &&
    (x.suite === 'startpos' || x.suite === 'three') &&
    typeof x.depth === 'number' &&
    isNumOrNull(x.startMs) &&
    Array.isArray(x.rows)
  );
}

function isWasiReport(x: unknown): x is WasiCheckReport {
  return (
    isRecord(x) &&
    isString(x.fileName) &&
    typeof x.size === 'number' &&
    (x.state === 'pass' || x.state === 'fail' || x.state === 'invalid' || x.state === 'static') &&
    Array.isArray(x.results) &&
    isString(x.fatalError) &&
    isString(x.staticNote)
  );
}

/** Reads persisted engine inspection, speed probe, and WASI check data from localStorage. */
export function loadEngineCache(): Record<string, PersistedEngineData> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const out: Record<string, PersistedEngineData> = {};
    for (const [id, entry] of Object.entries(parsed)) {
      if (!isRecord(entry) || !isString(entry.sha256)) continue;
      const item: PersistedEngineData = { sha256: entry.sha256 };
      if (isInspection(entry.inspection)) item.inspection = entry.inspection;
      if (isProbe(entry.probe)) item.probe = entry.probe;
      if (isWasiReport(entry.wasi)) item.wasi = entry.wasi;
      out[id] = item;
    }
    return out;
  } catch {
    return {};
  }
}

/** Saves persisted engine data to localStorage; ignores quota or privacy errors. */
export function saveEngineCache(data: Record<string, PersistedEngineData>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // storage full or unavailable
  }
}

/** Converts an Inspection into a JSON-serializable WasiStaticInfo. */
export function staticInfoOf(insp: Inspection): WasiStaticInfo {
  return {
    profile: insp.declaration.profile,
    requires: [...insp.declaration.requires],
    threadSpawn: insp.features.threadSpawn,
    sharedMemory: insp.features.sharedMemory,
    atomics: insp.features.atomics,
    exceptionHandling: insp.features.exceptionHandling,
    relaxed: [...insp.features.relaxed.entries()],
  };
}

const noLiveDriver: CheckDriver = () => {
  throw new Error('live checks are not available in this browser');
};

function createCheckWorker(): Worker {
  return new Worker(new URL('../../vendor/uci-over-wasi/check-worker.ts', import.meta.url), {
    type: 'module',
  });
}

/**
 * Runs static inspection and (when supported) live UCI over WASI checks on `wasm`,
 * mutating `report` reactively as rows stream in.
 */
export async function executeWasiCheck(
  wasm: Uint8Array,
  report: WasiCheckReport,
  signal: AbortSignal,
): Promise<void> {
  report.state = 'running';
  report.info = null;
  report.identity = null;
  report.results = [];
  report.fatalError = '';
  report.staticNote = '';

  const isWasmHeader =
    wasm.length >= 8 && wasm[0] === 0 && wasm[1] === 0x61 && wasm[2] === 0x73 && wasm[3] === 0x6d;
  if (!isWasmHeader || !WebAssembly.validate(wasm.slice().buffer)) {
    report.fatalError = 'Invalid WebAssembly module.';
    report.state = 'invalid';
    return;
  }

  let insp: Inspection;
  try {
    insp = inspectModule(wasm, canSpawnBrowserThreads());
  } catch (err) {
    report.fatalError = err instanceof Error ? err.message : String(err);
    report.state = 'invalid';
    return;
  }
  report.info = staticInfoOf(insp);

  const liveBlocked = insp.refusal
    ? insp.refusal
    : !canRunBrowserChecks()
      ? 'Live checks require cross-origin isolation or JavaScript Promise Integration (JSPI).'
      : '';

  if (liveBlocked) {
    report.staticNote = liveBlocked;
    await runChecks(wasm, noLiveDriver, { only: 'declaration', signal }, (r) => {
      if (!signal.aborted) report.results.push(r);
    });
    if (signal.aborted) {
      report.state = 'cancelled';
      return;
    }
    report.state = report.results.some((r) => r.status === 'fail') ? 'fail' : 'static';
    return;
  }

  try {
    await runChecks(
      wasm,
      browserDriver(wasm, report.fileName, createCheckWorker),
      {
        signal,
        onIdentity: (id) => {
          if (!signal.aborted) report.identity = id;
        },
      },
      (r) => {
        if (!signal.aborted) report.results.push(r);
      },
    );
  } catch (err) {
    if (signal.aborted) {
      report.state = 'cancelled';
      return;
    }
    report.fatalError = err instanceof Error ? err.message : String(err);
    report.state = 'fail';
    return;
  }

  if (signal.aborted) {
    report.state = 'cancelled';
  } else {
    report.state = report.results.some((r) => r.status === 'fail') ? 'fail' : 'pass';
  }
}
