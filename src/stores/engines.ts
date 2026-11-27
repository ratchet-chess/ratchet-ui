import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import {
  cloneWasiReport,
  loadEngineCache,
  persistEngineInspection,
  persistEngineWasi,
  removeEngineCache,
  type EngineInspection,
  type WasiCheckReport,
} from '../engine/cache.ts';
import { parseServed, type ServedEngine } from '../engine/manifest.ts';
import { parseOptionsList } from '../engine/options.ts';
import { UciEngine } from '../engine/uci.ts';
import { readFile, readText, removeFile, writeStream, writeText } from '../storage/opfs.ts';

/** where the app serves the engines' files, below its base path */
const enginesBase = `${import.meta.env.BASE_URL}engines/`;

/** the OPFS folder of visitor-added WASI engines and their index */
export const USER_ENGINES = 'user-engines';
export const USER_ENGINES_LIST = 'list.json';
/** `ServedEngine.source` for a visitor's build stored in browser OPFS (distinct from `local`) */
export const IN_BROWSER_SOURCE = 'in browser';

/** A visitor's checked WASI build kept in OPFS so it can play in Play and Tourneys. */
export interface UserEngine {
  /** engine id (unique across served and in-browser engines), used in Play and Tourneys */
  id: string;
  /** display name (UCI `id name` when reported, else `id`) */
  name: string;
  /** file name under `user-engines/`, `<id>.wasm` */
  wasm: string;
  bytes: number;
  sha256: string;
  /** ms since the epoch */
  added: number;
}

/** Browser storage estimate for the origin, in bytes. */
export interface EngineStorage {
  usage: number;
  quota: number;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

const hasControlChar = (s: string) => {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 0x20) return true;
  return false;
};

/** Whether `id` is a safe, non-empty engine identifier and OPFS file stem. */
export function isValidEngineId(id: string): boolean {
  if (!id || id !== id.trim() || id === '.' || id === '..') return false;
  if (/[/\\#?]/.test(id) || hasControlChar(id)) return false;
  return !/\.wasm$/i.test(id);
}

/** Derives a clean default engine id from an uploaded `.wasm` filename. */
export function defaultEngineId(fileName: string): string {
  const base = fileName
    .split(/[/\\]/)
    .at(-1)
    ?.replace(/\.wasm$/i, '')
    .trim();
  const printable = Array.from(base ?? '', (ch) => (ch.charCodeAt(0) < 0x20 ? '-' : ch)).join('');
  const cleaned = printable
    .replaceAll(/[\s/\\#?]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^[.-]+|[.-]+$/g, '');
  return cleaned && isValidEngineId(cleaned) ? cleaned : 'engine';
}

export function isUserEngine(x: unknown): x is UserEngine {
  return (
    isRecord(x) &&
    typeof x.id === 'string' &&
    isValidEngineId(x.id) &&
    typeof x.name === 'string' &&
    typeof x.wasm === 'string' &&
    x.wasm.endsWith('.wasm') &&
    !/[/\\]/.test(x.wasm) &&
    typeof x.bytes === 'number' &&
    Number.isFinite(x.bytes) &&
    x.bytes > 0 &&
    typeof x.sha256 === 'string' &&
    x.sha256.length > 0 &&
    typeof x.added === 'number'
  );
}

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

const message = (e: unknown) =>
  e instanceof DOMException && e.name === 'QuotaExceededError'
    ? "the browser's storage quota is full"
    : e instanceof Error
      ? e.message
      : String(e);

function toServedEngine(u: UserEngine): ServedEngine {
  return {
    id: u.id,
    name: u.name,
    version: null,
    wasm: u.wasm,
    bytes: u.bytes,
    sha256: u.sha256,
    source: IN_BROWSER_SOURCE,
    license: null,
  };
}

/**
 * The engines available in this app: served builds from `public/engines.json` (`engines.json` and
 * `engines.local.json`), visitor-added WASI builds stored in OPFS `user-engines/`, and shared UCI
 * inspections.
 */
export const useEngines = defineStore('engines', () => {
  const served = ref<ServedEngine[]>([]);
  const user = ref<UserEngine[]>([]);
  /** the host's Worker script, below enginesBase */
  const host = ref('');
  const error = ref('');
  const loaded = ref(false);
  const storage = ref<EngineStorage | null>(null);

  const servedIds = computed(() => new Set(served.value.map((e) => e.id)));
  const list = computed<ServedEngine[]>(() => [
    ...served.value,
    ...user.value.filter((u) => !servedIds.value.has(u.id)).map(toServedEngine),
  ]);

  /** shared UCI handshake cache across Engines and Play, keyed by engine id */
  const inspections = reactive(new Map<string, EngineInspection>());
  const liveInspect = new Map<string, UciEngine>();
  /** OPFS-backed `blob:` URLs for visitor engines, keyed by engine id */
  const blobUrls = new Map<string, { sha256: string; url: string }>();

  let servedLoaded = false;
  let loading: Promise<void> | null = null;

  /** the direct URL of `engine`'s .wasm module (served path or OPFS-backed blob URL) */
  const wasmUrl = (engine: ServedEngine) =>
    engine.source === IN_BROWSER_SOURCE
      ? (blobUrls.get(engine.id)?.url ?? '')
      : `${enginesBase}${engine.wasm}`;

  /** the Worker URL that runs `engine` in the host */
  const workerUrl = (engine: ServedEngine) =>
    engine.source === IN_BROWSER_SOURCE
      ? `${enginesBase}${host.value}#${blobUrls.get(engine.id)?.url ?? ''}`
      : `${enginesBase}${host.value}#${engine.wasm}`;

  async function estimate(): Promise<void> {
    const e = await navigator.storage.estimate().catch(() => undefined);
    storage.value =
      e?.usage !== undefined && e.quota !== undefined ? { usage: e.usage, quota: e.quota } : null;
  }

  function setBlobUrl(id: string, sha256: string, file: Blob): void {
    const prev = blobUrls.get(id);
    if (prev?.sha256 === sha256) return;
    if (prev) URL.revokeObjectURL(prev.url);
    blobUrls.set(id, { sha256, url: URL.createObjectURL(file) });
  }

  function revokeBlobUrl(id: string): void {
    const prev = blobUrls.get(id);
    if (!prev) return;
    URL.revokeObjectURL(prev.url);
    blobUrls.delete(id);
  }

  function hydrateInspections(entries: readonly ServedEngine[]): void {
    const saved = loadEngineCache();
    for (const e of entries) {
      const entry = saved[e.id];
      if (!entry || entry.sha256 !== e.sha256) continue;
      if (entry.inspection && !inspections.has(e.id)) {
        inspections.set(e.id, reactive(structuredClone(entry.inspection)));
      }
    }
  }

  /** Reads visitor-added WASI engines from OPFS and binds their `blob:` URLs. */
  async function loadUser(): Promise<void> {
    try {
      const raw = await readText([USER_ENGINES], USER_ENGINES_LIST);
      const parsed: unknown = JSON.parse(raw ?? '[]');
      const kept: UserEngine[] = [];
      const seen = new Set<string>();
      for (const u of Array.isArray(parsed) ? parsed.filter(isUserEngine) : []) {
        if (seen.has(u.id)) continue;
        const file = await readFile([USER_ENGINES], u.wasm);
        if (!file || file.size !== u.bytes) continue;
        seen.add(u.id);
        setBlobUrl(u.id, u.sha256, file);
        kept.push(u);
      }
      for (const id of blobUrls.keys()) {
        if (!seen.has(id)) revokeBlobUrl(id);
      }
      user.value = kept.toSorted((a, b) => a.id.localeCompare(b.id));
    } catch {
      // OPFS unavailable in restricted contexts; keep served engines usable
    }
  }

  async function load(): Promise<void> {
    if (loading) {
      await loading;
      return;
    }
    loading = (async () => {
      if (!servedLoaded) {
        try {
          const res = await fetch(`${import.meta.env.BASE_URL}engines.json`);
          if (!res.ok) throw new Error(`engines.json: ${res.status} ${res.statusText}`);
          const parsed = parseServed(await res.text());
          host.value = parsed.host;
          served.value = parsed.engines;
          servedLoaded = true;
          error.value = '';
        } catch (e) {
          error.value = e instanceof Error ? e.message : String(e);
        }
      }
      await loadUser();
      loaded.value = servedLoaded || user.value.length > 0;
      hydrateInspections(list.value);
      await estimate();
    })();
    try {
      await loading;
    } finally {
      loading = null;
    }
  }

  /**
   * Saves a checked visitor WASI build into OPFS `user-engines/` so it joins Play, Tourneys,
   * and Engines. Throws on invalid ID, served-ID collision, or duplicate ID without `replace`.
   */
  async function addUser(input: {
    id: string;
    name: string;
    bytes: Uint8Array;
    wasi?: WasiCheckReport;
    replace?: boolean;
  }): Promise<ServedEngine> {
    const id = input.id.trim();
    if (!isValidEngineId(id)) throw new Error('Invalid engine ID');
    if (servedIds.value.has(id)) {
      throw new Error(`${id} is already a served engine; choose another ID`);
    }
    const existing = user.value.find((u) => u.id === id);
    if (existing && !input.replace) {
      throw new Error(`${id} is already in browser; choose Replace or another ID`);
    }

    const wasm = `${id}.wasm`;
    const copy = new Uint8Array(input.bytes);
    const sha256 = hex(await crypto.subtle.digest('SHA-256', copy));
    const entry: UserEngine = {
      id,
      name: input.name.trim() || id,
      wasm,
      bytes: copy.byteLength,
      sha256,
      added: Date.now(),
    };

    try {
      const blob = new Blob([copy], { type: 'application/wasm' });
      await writeStream([USER_ENGINES], wasm, blob.stream());
      const file = await readFile([USER_ENGINES], wasm);
      if (!file || file.size !== copy.byteLength) {
        throw new Error('the saved .wasm file could not be read back');
      }
      const next = [...user.value.filter((u) => u.id !== id), entry].toSorted((a, b) =>
        a.id.localeCompare(b.id),
      );
      await writeText([USER_ENGINES], USER_ENGINES_LIST, JSON.stringify(next));
      if (existing && existing.wasm !== wasm) {
        await removeFile([USER_ENGINES], existing.wasm).catch(() => undefined);
      }
      setBlobUrl(id, sha256, file);
      if (existing && existing.sha256 !== sha256) {
        liveInspect.get(id)?.terminate();
        liveInspect.delete(id);
        inspections.delete(id);
        removeEngineCache(id);
      }
      if (input.wasi?.state === 'pass') {
        persistEngineWasi(id, sha256, {
          ...cloneWasiReport(input.wasi),
          fileName: wasm,
          size: copy.byteLength,
        });
      }
      user.value = next;
      await estimate();
      return toServedEngine(entry);
    } catch (e) {
      if (!existing) await removeFile([USER_ENGINES], wasm).catch(() => undefined);
      throw new Error(`${id} was not added: ${message(e)}`, { cause: e });
    }
  }

  /** Removes a visitor-added engine from OPFS, revoking its blob URL and dropping its cache. */
  async function removeUser(id: string): Promise<void> {
    const existing = user.value.find((u) => u.id === id);
    if (!existing) return;
    const next = user.value.filter((u) => u.id !== id);
    await writeText([USER_ENGINES], USER_ENGINES_LIST, JSON.stringify(next));
    await removeFile([USER_ENGINES], existing.wasm).catch(() => undefined);
    liveInspect.get(id)?.terminate();
    liveInspect.delete(id);
    inspections.delete(id);
    removeEngineCache(id);
    revokeBlobUrl(id);
    user.value = next;
    await estimate();
  }

  /** Drops then adds entries of the visitor engines list, as a backup merge asks. */
  async function mergeList(drop: readonly string[], put: readonly UserEngine[]): Promise<void> {
    const raw = await readText([USER_ENGINES], USER_ENGINES_LIST);
    const saved: unknown = JSON.parse(raw ?? '[]');
    const kept = (Array.isArray(saved) ? saved.filter(isUserEngine) : []).filter(
      (e) => !drop.includes(e.id) && !put.some((p) => p.id === e.id),
    );
    for (const id of [...drop, ...put.map((p) => p.id)]) {
      inspections.delete(id);
      removeEngineCache(id);
      revokeBlobUrl(id);
    }
    await writeText(
      [USER_ENGINES],
      USER_ENGINES_LIST,
      JSON.stringify([...kept, ...put].toSorted((a, b) => a.id.localeCompare(b.id))),
    );
    await loadUser();
    hydrateInspections(list.value);
    await estimate();
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
    served,
    user,
    list,
    host,
    error,
    loaded,
    storage,
    inspections,
    load,
    addUser,
    removeUser,
    mergeList,
    inspect,
    recordInspection,
    workerUrl,
    wasmUrl,
  };
});
