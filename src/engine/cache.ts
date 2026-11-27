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

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isString = (x: unknown): x is string => typeof x === 'string';
const isNumOrNull = (x: unknown): x is number | null => x === null || typeof x === 'number';

function isUciOption(x: unknown): x is UciOption {
  return (
    isRecord(x) &&
    isString(x.name) &&
    isString(x.type) &&
    isString(x.defaultValue) &&
    isString(x.range)
  );
}

function isProbeRow(x: unknown): x is ProbeRow {
  return (
    isRecord(x) &&
    isString(x.label) &&
    (x.state === 'pending' || x.state === 'running' || x.state === 'done') &&
    isNumOrNull(x.nodes) &&
    isNumOrNull(x.elapsedMs) &&
    isString(x.best)
  );
}

function isCheckResult(x: unknown): x is CheckResult {
  return (
    isRecord(x) &&
    isString(x.name) &&
    (x.status === 'pass' || x.status === 'fail' || x.status === 'skip') &&
    isString(x.detail)
  );
}

function isWasiStaticInfo(x: unknown): x is WasiStaticInfo {
  return (
    isRecord(x) &&
    (x.profile === 'polls' || x.profile === 'deaf') &&
    Array.isArray(x.requires) &&
    x.requires.every(isString) &&
    typeof x.threadSpawn === 'boolean' &&
    typeof x.sharedMemory === 'boolean' &&
    typeof x.atomics === 'boolean' &&
    typeof x.exceptionHandling === 'boolean' &&
    Array.isArray(x.relaxed) &&
    x.relaxed.every(
      (r) => Array.isArray(r) && r.length === 2 && isString(r[0]) && typeof r[1] === 'number',
    )
  );
}

function isWasiIdentity(x: unknown): x is { name: string; author: string } {
  return isRecord(x) && isString(x.name) && isString(x.author);
}

function isInspection(x: unknown): x is EngineInspection {
  return (
    isRecord(x) &&
    x.state === 'done' &&
    isString(x.idName) &&
    isString(x.idAuthor) &&
    isNumOrNull(x.startMs) &&
    Array.isArray(x.options) &&
    x.options.every(isUciOption) &&
    isString(x.error)
  );
}

function isProbe(x: unknown): x is EngineProbe {
  return (
    isRecord(x) &&
    x.state === 'done' &&
    (x.suite === 'startpos' || x.suite === 'three') &&
    typeof x.depth === 'number' &&
    isNumOrNull(x.startMs) &&
    Array.isArray(x.rows) &&
    x.rows.every(isProbeRow) &&
    isString(x.error)
  );
}

function isWasiReport(x: unknown): x is WasiCheckReport {
  return (
    isRecord(x) &&
    isString(x.fileName) &&
    typeof x.size === 'number' &&
    (x.state === 'pass' || x.state === 'fail' || x.state === 'invalid' || x.state === 'static') &&
    (x.info === null || isWasiStaticInfo(x.info)) &&
    (x.identity === null || isWasiIdentity(x.identity)) &&
    Array.isArray(x.results) &&
    x.results.every(isCheckResult) &&
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
function saveEngineCache(data: Record<string, PersistedEngineData>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // storage full or unavailable
  }
}

/** sets part of one engine's persisted entry, keeping the rest while its sha256 is the same */
function persist(id: string, sha256: string, part: Omit<PersistedEngineData, 'sha256'>): void {
  const saved = loadEngineCache();
  const prev = saved[id];
  saved[id] = { ...(prev?.sha256 === sha256 ? prev : undefined), sha256, ...part };
  saveEngineCache(saved);
}

/** Merges one engine's completed UCI inspection into the persisted cache. */
export function persistEngineInspection(
  id: string,
  sha256: string,
  inspection: EngineInspection,
): void {
  if (inspection.state === 'done') persist(id, sha256, { inspection });
}

/** Merges one engine's completed speed probe into the persisted cache. */
export function persistEngineProbe(id: string, sha256: string, probe: EngineProbe): void {
  if (probe.state === 'done') persist(id, sha256, { probe });
}

/** Produces a plain deep copy of a WASI report safe to persist or pass out of reactive proxies. */
export function cloneWasiReport(r: WasiCheckReport): WasiCheckReport {
  return {
    fileName: r.fileName,
    size: r.size,
    state: r.state,
    info: r.info
      ? {
          profile: r.info.profile,
          requires: [...r.info.requires],
          threadSpawn: r.info.threadSpawn,
          sharedMemory: r.info.sharedMemory,
          atomics: r.info.atomics,
          exceptionHandling: r.info.exceptionHandling,
          relaxed: r.info.relaxed.map(([op, n]): [string, number] => [op, n]),
        }
      : null,
    identity: r.identity ? { name: r.identity.name, author: r.identity.author } : null,
    results: r.results.map((x) => ({ name: x.name, status: x.status, detail: x.detail })),
    fatalError: r.fatalError,
    staticNote: r.staticNote,
  };
}

/** Merges one engine's completed WASI check report into the persisted cache. */
export function persistEngineWasi(id: string, sha256: string, wasi: WasiCheckReport): void {
  if (wasi.state !== 'running' && wasi.state !== 'cancelled') persist(id, sha256, { wasi });
}

/** Removes one engine's persisted inspection, probe, and WASI cache entry. */
export function removeEngineCache(id: string): void {
  const saved = loadEngineCache();
  if (!(id in saved)) return;
  delete saved[id];
  saveEngineCache(saved);
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
    try {
      await runChecks(wasm, noLiveDriver, { only: 'declaration', signal }, (r) => {
        if (!signal.aborted) report.results.push(r);
      });
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
