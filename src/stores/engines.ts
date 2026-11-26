import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import {
  loadEngineCache,
  persistEngineInspection,
  type EngineInspection,
} from '../engine/cache.ts';
import { parseServed, type ServedEngine } from '../engine/manifest.ts';
import { parseOptionsList } from '../engine/options.ts';
import { UciEngine } from '../engine/uci.ts';

/** where the app serves the engines' files, below its base path */
const enginesBase = `${import.meta.env.BASE_URL}engines/`;

/** The engines this app serves, from public/engines.json, plus shared UCI inspections. */
export const useEngines = defineStore('engines', () => {
  const list = ref<ServedEngine[]>([]);
  /** the host's Worker script, below enginesBase */
  const host = ref('');
  const error = ref('');
  const loaded = ref(false);

  /** shared UCI handshake cache across Engines and Play, keyed by engine id */
  const inspections = reactive(new Map<string, EngineInspection>());
  const liveInspect = new Map<string, UciEngine>();

  /** the Worker URL that runs `engine` in the host */
  const workerUrl = (engine: ServedEngine) => `${enginesBase}${host.value}#${engine.wasm}`;
  /** the direct URL of `engine`'s .wasm module */
  const wasmUrl = (engine: ServedEngine) => `${enginesBase}${engine.wasm}`;

  function hydrateInspections(served: readonly ServedEngine[]): void {
    const saved = loadEngineCache();
    for (const e of served) {
      const entry = saved[e.id];
      if (!entry || entry.sha256 !== e.sha256) continue;
      if (entry.inspection && !inspections.has(e.id)) {
        inspections.set(e.id, reactive(structuredClone(entry.inspection)));
      }
    }
  }

  async function load(): Promise<void> {
    if (loaded.value) return;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}engines.json`);
      if (!res.ok) throw new Error(`engines.json: ${res.status} ${res.statusText}`);
      const served = parseServed(await res.text());
      host.value = served.host;
      list.value = served.engines;
      loaded.value = true;
      hydrateInspections(served.engines);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  /** Records a completed UCI inspection (e.g. from a speed probe) and persists it. */
  function recordInspection(e: ServedEngine, insp: EngineInspection): void {
    const state = reactive({ ...insp });
    inspections.set(e.id, state);
    persistEngineInspection(e.id, e.sha256, state);
  }

  /**
   * Starts `e` once to read its UCI identity and option list, caching the result by sha256.
   * Reuses an existing completed or in-flight inspection unless `force` is true.
   */
  async function inspect(e: ServedEngine, force = false): Promise<EngineInspection> {
    const existing = inspections.get(e.id);
    if (!force && existing && (existing.state === 'done' || existing.state === 'loading')) {
      return existing;
    }
    liveInspect.get(e.id)?.terminate();
    const state: EngineInspection = reactive({
      state: 'loading',
      idName: '',
      idAuthor: '',
      startMs: null,
      options: [],
      error: '',
    });
    inspections.set(e.id, state);
    const t0 = performance.now();
    const engine = new UciEngine(workerUrl(e));
    liveInspect.set(e.id, engine);
    try {
      const id = await engine.identify();
      await engine.ready();
      state.idName = id.name;
      state.idAuthor = id.author;
      state.startMs = performance.now() - t0;
      state.options = parseOptionsList(id.options);
      state.state = 'done';
      persistEngineInspection(e.id, e.sha256, state);
    } catch (err) {
      if (inspections.get(e.id) === state) {
        state.error = err instanceof Error ? err.message : String(err);
        state.state = 'failed';
      }
    } finally {
      engine.terminate();
      if (liveInspect.get(e.id) === engine) liveInspect.delete(e.id);
    }
    return state;
  }

  return {
    list,
    host,
    error,
    loaded,
    inspections,
    load,
    inspect,
    recordInspection,
    workerUrl,
    wasmUrl,
  };
});
