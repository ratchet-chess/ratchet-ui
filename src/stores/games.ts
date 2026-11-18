import { defineStore } from 'pinia';
import { ref } from 'vue';
import { parseCollection } from '../games/pgn.ts';

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
const INDEX = 'index.json';

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
function isCollection(x: unknown): x is Collection {
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

/**
 * The PGN collections in this browser's private file system (OPFS): one file per collection, and
 * an index of them. localStorage would hold only about 5 MB; OPFS holds a share of the disk.
 */
export const useGames = defineStore('games', () => {
  const list = ref<Collection[]>([]);
  const error = ref('');
  let dir: FileSystemDirectoryHandle | undefined;

  async function folder(): Promise<FileSystemDirectoryHandle> {
    if (dir) return dir;
    const root = await navigator.storage.getDirectory();
    dir = await root.getDirectoryHandle('games', { create: true });
    return dir;
  }

  async function readText(name: string): Promise<string | null> {
    try {
      return await (await (await (await folder()).getFileHandle(name)).getFile()).text();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return null;
      throw e;
    }
  }

  async function writeText(name: string, text: string): Promise<void> {
    const w = await (await (await folder()).getFileHandle(name, { create: true })).createWritable();
    await w.write(text);
    await w.close();
  }

  async function saveIndex(): Promise<void> {
    await writeText(INDEX, JSON.stringify(list.value, null, 1));
  }

  /** reads the index; a failure, such as a browser without OPFS, is kept in `error` */
  async function load(): Promise<void> {
    try {
      const text = await readText(INDEX);
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

  /** the PGN text of a collection */
  async function read(id: string): Promise<string> {
    return (await readText(`${id}.pgn`)) ?? '';
  }

  /** keeps an opened PGN file as a new collection; returns its id */
  async function addFile(name: string, text: string): Promise<string> {
    await load();
    const id = crypto.randomUUID();
    await writeText(`${id}.pgn`, text);
    const games = parseCollection(text).summaries.length;
    upsert({
      id,
      name,
      source: 'file',
      games,
      bytes: new Blob([text]).size,
      updated: new Date().toISOString(),
    });
    await saveIndex();
    void navigator.storage.persist();
    return id;
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
      const handle = await (await folder()).getFileHandle(`${id}.pgn`, { create: true });
      const size = (await handle.getFile()).size;
      const w = await handle.createWritable({ keepExistingData: true });
      await w.seek(size);
      await w.write(size > 0 ? `\n${pgn}` : pgn);
      await w.close();
      const prev = list.value.find((c) => c.id === id);
      upsert({
        id,
        name,
        source,
        games: (prev?.games ?? 0) + 1,
        bytes: (await handle.getFile()).size,
        updated: new Date().toISOString(),
      });
      await saveIndex();
      void navigator.storage.persist();
    });
  }

  /** adds one game to the collection of games played on this app's board */
  function savePlayed(pgn: string): Promise<void> {
    return append(PLAYED, 'Played here', 'play', pgn);
  }

  async function remove(id: string): Promise<void> {
    await (await folder()).removeEntry(`${id}.pgn`).catch(() => undefined);
    list.value = list.value.filter((c) => c.id !== id);
    await saveIndex();
  }

  return { list, error, load, read, addFile, append, savePlayed, remove };
});
