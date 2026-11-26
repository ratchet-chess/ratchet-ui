import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  dehydratePgnIndex,
  hydratePgnIndex,
  indexPgnBlob,
  sliceGamesBlob,
  type PgnIndex,
} from '../games/index.ts';
import { deleteValue, getValue, setValue } from '../storage/idb.ts';
import { makeId } from '../storage/id.ts';
import {
  appendText,
  readFile,
  readText,
  removeFile,
  writeStream,
  writeText,
} from '../storage/opfs.ts';
import { unzipAll } from '../storage/zip.ts';

/** One PGN collection kept in this browser. */
export interface Collection {
  id: string;
  name: string;
  /** `play` for the games played on this app's board; `file` for an opened PGN file; `match` for a match's games */
  source: 'play' | 'file' | 'match';
  games: number;
  bytes: number;
  /** ISO time of the last change */
  updated: string;
}

/** the collection Play saves its games to */
export const PLAYED = 'played';
/** the OPFS folder of the collections; it also holds their index */
export const GAMES = 'games';
export const GAMES_INDEX = 'index.json';
const DIR = [GAMES];
const IDB_PREFIX = 'pgn-index:';
/** collections at or above 2 MB index in a Web Worker to keep the UI responsive */
const WORKER_THRESHOLD = 2 * 1024 * 1024;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
export function isCollection(x: unknown): x is Collection {
  if (!isRecord(x)) return false;
  const { id, name, source, games, bytes, updated } = x;
  return (
    typeof id === 'string' &&
    typeof name === 'string' &&
    (source === 'play' || source === 'file' || source === 'match') &&
    typeof games === 'number' &&
    typeof bytes === 'number' &&
    typeof updated === 'string'
  );
}

/** Runs `indexPgnBlob` in a module Worker when available for large blobs. */
async function buildIndex(blob: Blob): Promise<PgnIndex> {
  if (blob.size < WORKER_THRESHOLD || typeof Worker === 'undefined') return indexPgnBlob(blob);
  return new Promise<PgnIndex>((resolve, reject) => {
    const worker = new Worker(new URL('../games/index.worker.ts', import.meta.url), {
      type: 'module',
    });
    const done = () => worker.terminate();
    worker.onmessage = (e: MessageEvent<{ index?: PgnIndex; error?: string }>) => {
      done();
      if (e.data.error) reject(new Error(e.data.error));
      else if (e.data.index) resolve(e.data.index);
      else reject(new Error('PGN indexer returned no result'));
    };
    worker.onerror = (e: ErrorEvent) => {
      done();
      reject(new Error(e.message || 'PGN indexer worker failed'));
    };
    worker.postMessage({ id: 1, blob });
  });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The PGN collections in this browser's private file system (OPFS): one file per collection, and
 * an index of them. localStorage would hold only about 5 MB; OPFS holds a share of the disk.
 * Per-collection byte-offset indexes are cached in memory and persisted in IndexedDB outside
 * OPFS's backup layout so reopening a 50,000-game collection across reloads is instant.
 */
export const useGames = defineStore('games', () => {
  const list = ref<Collection[]>([]);
  const error = ref('');
  const memIndex = new Map<string, { updated: string; bytes: number; index: PgnIndex }>();

  async function saveIndex(): Promise<void> {
    await writeText(DIR, GAMES_INDEX, JSON.stringify(list.value, null, 1));
  }

  /** reads the index; a failure, such as a browser without OPFS, is kept in `error` */
  async function load(): Promise<void> {
    try {
      const text = await readText(DIR, GAMES_INDEX);
      const x: unknown = text === null ? [] : JSON.parse(text);
      list.value = Array.isArray(x) ? x.filter(isCollection) : [];
      error.value = '';
    } catch (e) {
      error.value = `This browser cannot keep games: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  function upsert(c: Collection): void {
    const i = list.value.findIndex((x) => x.id === c.id);
    if (i >= 0) list.value[i] = c;
    else list.value.push(c);
  }

  /** the OPFS File handle (readable by byte slice) for a collection, or null */
  async function readBlob(id: string): Promise<File | null> {
    return readFile(DIR, `${id}.pgn`);
  }

  /** the PGN text of a collection */
  async function read(id: string): Promise<string> {
    return (await readText(DIR, `${id}.pgn`)) ?? '';
  }

  /**
   * Returns the compact `PgnIndex` for a collection, checking memory cache, then IndexedDB cache
   * (keyed by `updated` and `bytes`), and finally streaming/indexing the PGN file.
   */
  async function getIndex(c: Collection): Promise<PgnIndex> {
    const mem = memIndex.get(c.id);
    if (mem && mem.updated === c.updated && mem.bytes === c.bytes) return mem.index;

    try {
      const cached = await getValue(`${IDB_PREFIX}${c.id}`);
      const hydrated = hydratePgnIndex(cached, c.updated, c.bytes);
      if (hydrated) {
        memIndex.set(c.id, { updated: c.updated, bytes: c.bytes, index: hydrated });
        return hydrated;
      }
    } catch {
      // IndexedDB unavailable (e.g. private mode); fall back to indexing directly
    }

    const blob = await readBlob(c.id);
    const index = blob ? await buildIndex(blob) : await indexPgnBlob(new Blob([]));
    memIndex.set(c.id, { updated: c.updated, bytes: c.bytes, index });
    try {
      await setValue(`${IDB_PREFIX}${c.id}`, dehydratePgnIndex(index, c.updated, c.bytes));
    } catch {
      // Ignore IDB quota/storage errors; memory cache still holds the index
    }
    return index;
  }

  /** Reads one game's raw PGN text by its byte span without reading the rest of the file. */
  async function readGameText(id: string, index: PgnIndex, gameIndex: number): Promise<string> {
    const start = index.offsets[gameIndex];
    const len = index.lengths[gameIndex];
    if (start === undefined || len === undefined) return '';
    const file = await readBlob(id);
    if (!file) return '';
    return file.slice(start, start + len).text();
  }

  /** keeps an opened PGN file or Blob as a new collection; returns its id */
  async function addFile(name: string, data: string | Blob): Promise<string> {
    await load();
    const clean = name.trim() || 'Untitled';
    const now = new Date();
    const id = makeId(clean, now);
    const blob =
      typeof data === 'string' ? new Blob([data], { type: 'application/x-chess-pgn' }) : data;
    await writeStream(DIR, `${id}.pgn`, blob.stream());
    const index = await buildIndex(blob);
    const updated = now.toISOString();
    const col: Collection = {
      id,
      name: clean,
      source: 'file',
      games: index.count,
      bytes: blob.size,
      updated,
    };
    upsert(col);
    await saveIndex();
    memIndex.set(id, { updated, bytes: blob.size, index });
    try {
      await setValue(`${IDB_PREFIX}${id}`, dehydratePgnIndex(index, updated, blob.size));
    } catch {
      // ignore IDB errors
    }
    return id;
  }

  /**
   * Imports a `.pgn` file or a `.zip` archive containing one or more `.pgn` files (skipping
   * `__MACOSX/` and hidden entries). Returns the IDs of all created collections.
   */
  async function addUpload(file: File): Promise<string[]> {
    if (/\.zip$/i.test(file.name)) {
      const entries = await unzipAll(
        file,
        (n) => !n.startsWith('__MACOSX/') && !/(^|\/)\./.test(n) && /\.pgn$/i.test(n),
      );
      if (entries.size === 0) throw new Error(`${file.name} holds no .pgn file`);
      const ids: string[] = [];
      for (const [entryName, blob] of entries) {
        const base = entryName.split('/').at(-1) ?? entryName;
        ids.push(await addFile(base.replace(/\.pgn$/i, ''), blob));
      }
      return ids;
    }
    return [await addFile(file.name.replace(/\.pgn$/i, ''), file)];
  }

  /** the collection writes, one at a time, so two games that end together never interleave */
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Appends one game to a collection, and makes the collection if it is new. The game is written
   * after the file's end, so a save costs the game's size, not the collection's.
   */
  function append(
    id: string,
    name: string,
    source: Collection['source'],
    pgn: string,
  ): Promise<void> {
    return serial(async () => {
      await load();
      const bytes = await appendText(DIR, `${id}.pgn`, (size) => (size > 0 ? `\n${pgn}` : pgn));
      const prev = list.value.find((c) => c.id === id);
      upsert({
        id,
        name,
        source,
        games: (prev?.games ?? 0) + 1,
        bytes,
        updated: new Date().toISOString(),
      });
      memIndex.delete(id);
      await saveIndex();
    });
  }

  /** Renames a collection in `games/index.json` without rewriting its PGN file or index cache. */
  function rename(id: string, name: string): Promise<void> {
    const clean = name.trim();
    if (!clean) return Promise.resolve();
    return serial(async () => {
      await load();
      const prev = list.value.find((c) => c.id === id);
      if (!prev || prev.name === clean) return;
      upsert({ ...prev, name: clean });
      await saveIndex();
    });
  }

  /** drops then adds index entries, in the write queue, as a merge from a backup asks */
  function mergeIndex(drop: readonly string[], put: readonly Collection[]): Promise<void> {
    return serial(async () => {
      await load();
      list.value = list.value.filter((c) => !drop.includes(c.id));
      for (const id of drop) {
        memIndex.delete(id);
        void deleteValue(`${IDB_PREFIX}${id}`).catch(() => undefined);
      }
      for (const c of put) {
        memIndex.delete(c.id);
        upsert(c);
      }
      await saveIndex();
    });
  }

  /** adds one game to the collection of games played on this app's board */
  function savePlayed(pgn: string): Promise<void> {
    return append(PLAYED, 'Played here', 'play', pgn);
  }

  /** saves a collection as a .pgn file, through the browser's download */
  async function download(id: string, name: string): Promise<void> {
    const file = await readBlob(id);
    if (!file) return;
    triggerDownload(file, `${name}.pgn`);
  }

  /** Downloads a filtered subset of games using zero-parse byte-span slicing. */
  async function downloadFiltered(
    id: string,
    name: string,
    index: PgnIndex,
    indices: readonly number[] | Int32Array,
  ): Promise<void> {
    const file = await readBlob(id);
    if (!file || indices.length === 0) return;
    triggerDownload(sliceGamesBlob(file, index, indices), `${name}-filtered.pgn`);
  }

  async function remove(id: string): Promise<void> {
    await removeFile(DIR, `${id}.pgn`);
    list.value = list.value.filter((c) => c.id !== id);
    memIndex.delete(id);
    void deleteValue(`${IDB_PREFIX}${id}`).catch(() => undefined);
    await saveIndex();
  }

  return {
    list,
    error,
    load,
    read,
    readBlob,
    getIndex,
    readGameText,
    addFile,
    addUpload,
    append,
    rename,
    mergeIndex,
    savePlayed,
    download,
    downloadFiltered,
    remove,
  };
});
