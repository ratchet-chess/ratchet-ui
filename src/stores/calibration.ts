import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import {
  CALIBRATION_DEPTH,
  CALIBRATION_WARMUP_DEPTH,
  CCRL_REF_NPS,
  loadCalibration,
  median,
  pickCalibration,
  saveCalibration,
  type CalibrationSample,
  type DeviceCalibration,
} from '../engine/calibrate.ts';
import type { ServedEngine } from '../engine/manifest.ts';
import { PROBE_SUITES } from '../engine/options.ts';
import { inputMode, UciEngine } from '../engine/uci.ts';
import { ANCHOR_NAME } from '../ratings/list.ts';
import { useEngines } from './engines.ts';

/** Live progress of an in-flight device speed calibration. */
export interface CalibrationProgress {
  concurrency: number;
  phase: 'starting' | 'warmup' | 'measuring';
  done: number;
  total: number;
}

/**
 * Browser-local device speed calibration using Stockfish 10 over the 3-position probe suite.
 * Persists idle and per-concurrency readings in localStorage (excluded from portable backups).
 */
export const useCalibration = defineStore('calibration', () => {
  const engines = useEngines();
  const data = reactive<DeviceCalibration>(loadCalibration());
  const progress = ref<CalibrationProgress | null>(null);
  const error = ref('');

  const liveWorkers = new Set<UciEngine>();
  let runId = 0;
  /** read through a call, since stop() or a newer run() can advance `runId` across awaits */
  const isStaleRun = (mine: number) => mine !== runId;

  /** The Stockfish 10 anchor engine used for CCRL-baseline calibration, when served. */
  const anchor = computed<ServedEngine | undefined>(() =>
    engines.list.find((e) => e.id === ANCHOR_NAME),
  );

  /** True when `sample` was measured on a different anchor build than the one currently served. */
  function isStale(sample: CalibrationSample): boolean {
    const a = anchor.value;
    return a !== undefined && sample.sha256 !== a.sha256;
  }

  /** Selects the best calibration for `concurrency` (exact concurrent match, else idle). */
  function forConcurrency(concurrency: number) {
    return pickCalibration(data, concurrency);
  }

  /** Stops any running calibration immediately and discards partial results. */
  function stop(): void {
    runId++;
    for (const w of liveWorkers) w.terminate();
    liveWorkers.clear();
    progress.value = null;
  }

  /**
   * Calibrates device speed using `concurrency` parallel Stockfish 10 workers (1 = idle).
   * Runs a warm-up search before measuring the 3-position suite at depth 13.
   */
  async function run(concurrency: number): Promise<void> {
    stop();
    const mine = ++runId;
    error.value = '';
    const engine = anchor.value;
    if (!engine) {
      error.value = `Calibration requires ${ANCHOR_NAME} to be served in Engines.`;
      return;
    }

    const hc = navigator.hardwareConcurrency;
    const hw = Number.isFinite(hc) && hc > 0 ? Math.floor(hc) : 1;
    const requested = Number.isFinite(concurrency) ? Math.round(concurrency) : 1;
    const copies = Math.max(1, Math.min(requested, hw));
    const positions = PROBE_SUITES.three;
    const prog = reactive<CalibrationProgress>({
      concurrency: copies,
      phase: 'starting',
      done: 0,
      total: copies * positions.length,
    });
    progress.value = prog;

    const workers: UciEngine[] = [];
    try {
      const url = engines.workerUrl(engine);
      for (let i = 0; i < copies; i++) {
        const w = new UciEngine(url);
        workers.push(w);
        liveWorkers.add(w);
      }

      // Initialize every worker with CCRL bench defaults (Hash 16 MB, Threads 1)
      await Promise.all(
        workers.map(async (w) => {
          await w.identify();
          w.send('setoption name Hash value 16');
          w.send('setoption name Threads value 1');
          await w.ready();
        }),
      );
      if (isStaleRun(mine)) return;

      // Warm up WASM/JIT on all workers in parallel before timing
      prog.phase = 'warmup';
      await Promise.all(
        workers.map(async (w) => {
          await w.go('startpos', `depth ${CALIBRATION_WARMUP_DEPTH}`);
          w.send('ucinewgame');
          await w.ready();
        }),
      );
      if (isStaleRun(mine)) return;

      // Measured pass: all workers search the 3-position suite concurrently
      prog.phase = 'measuring';
      const reads = await Promise.all(
        workers.map(async (w) => {
          let totalNodes = 0;
          let totalMs = 0;
          for (const pos of positions) {
            if (isStaleRun(mine)) return { nps: 0, nodes: 0, ms: 0 };
            w.send('ucinewgame');
            await w.ready();
            let lastNodes = 0;
            const t0 = performance.now();
            await w.go(pos.position, `depth ${CALIBRATION_DEPTH}`, (info) => {
              if (info.nodes !== undefined) lastNodes = info.nodes;
            });
            const ms = Math.max(1, performance.now() - t0);
            totalNodes += lastNodes;
            totalMs += ms;
            prog.done++;
          }
          return {
            nps: totalMs > 0 ? (totalNodes * 1000) / totalMs : 0,
            nodes: totalNodes,
            ms: totalMs,
          };
        }),
      );
      if (isStaleRun(mine)) return;

      const valid = reads.filter((r) => r.nps > 0 && r.nodes > 0 && r.ms > 0);
      if (valid.length === 0) throw new Error('Anchor reported no node counts during calibration.');

      const medNps = Math.round(median(valid.map((r) => r.nps)));
      const sample: CalibrationSample = {
        concurrency: copies,
        nps: medNps,
        ratio: medNps / CCRL_REF_NPS,
        nodes: Math.round(median(valid.map((r) => r.nodes))),
        elapsedMs: Math.round(median(valid.map((r) => r.ms))),
        sha256: engine.sha256,
        measuredAt: new Date().toISOString(),
        inputMode: inputMode(),
        threads: hw,
      };

      if (copies === 1) data.idle = sample;
      else data.concurrent[copies] = sample;
      saveCalibration(data);
    } catch (e) {
      if (!isStaleRun(mine)) {
        error.value = e instanceof Error ? e.message : String(e);
      }
    } finally {
      for (const w of workers) {
        w.terminate();
        liveWorkers.delete(w);
      }
      if (!isStaleRun(mine)) progress.value = null;
    }
  }

  /** Removes one saved concurrent calibration entry. */
  function removeConcurrent(concurrency: number): void {
    delete data.concurrent[concurrency];
    saveCalibration(data);
  }

  /** Clears all saved device calibrations. */
  function clear(): void {
    data.idle = null;
    for (const k of Object.keys(data.concurrent)) delete data.concurrent[Number(k)];
    error.value = '';
    saveCalibration(data);
  }

  return {
    data,
    progress,
    error,
    anchor,
    isStale,
    forConcurrency,
    run,
    stop,
    removeConcurrent,
    clear,
  };
});
