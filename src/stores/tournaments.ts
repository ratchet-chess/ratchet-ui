import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { resolveControl } from '../chess/clock.ts';
import type { TournamentConfig } from '../match/format.ts';
import { configOf, gamesOf, pairsOf } from '../match/records.ts';
import { Run, stateOf, type Entrant, type LiveSnapshots, type RunState } from '../match/runner.ts';
import {
  appendText,
  folders,
  readText,
  removeFile,
  removeFolder,
  writeText,
} from '../storage/opfs.ts';
import { useBooks } from './books.ts';
import { useEngines } from './engines.ts';
import { useGames } from './games.ts';
import { inOrder, orderOf, QUEUED, queuedText, ready, reordered, type Have } from './queue.ts';

/** One tournament: its setup and its state, whether it runs in this tab or was saved before. */
export interface Item {
  config: TournamentConfig;
  state: RunState;
  /** how a run that is not in this tab ended: `done`, `stopped`, or null when the tab closed during it */
  ended: 'done' | 'stopped' | null;
  /** true while another tab of this browser plays it, as its Web Lock shows */
  elsewhere: boolean;
  /** ISO time its run last ended, from end.json; null while it runs or when the tab closed during it */
  endedAt: string | null;
  /** when this tab started its run, and the games then finished, to time the run's pace by */
  since: { at: number; games: number } | null;
  /** its key in the queue's order while it waits there; null once it starts, or if never queued */
  queued: number | null;
}

/** end.json's status and time; a file it cannot read counts as stopped, at no known time */
function endOf(text: string): { ended: 'done' | 'stopped'; at: string | null } {
  try {
    const x: unknown = JSON.parse(text);
    if (typeof x === 'object' && x !== null) {
      const status = 'status' in x ? x.status : undefined;
      const at = 'at' in x && typeof x.at === 'string' ? x.at : null;
      return { ended: status === 'done' ? 'done' : 'stopped', at };
    }
  } catch {
    // a torn write
  }
  return { ended: 'stopped', at: null };
}

/** the OPFS folder of the tournaments, one folder each */
export const TOURNAMENTS = ['tournaments'];

/** a uniform number in [0, 1) from a seed and a pair's number, so a pair's opening can be picked again */
function pick(seed: number, pair: number): number {
  let t = (seed ^ Math.imul(pair + 1, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** the Web Lock a tab holds while it plays a tournament, so no other tab plays or deletes it */
const LOCK_PREFIX = 'ratchet-ui:tournament:';
const lockOf = (id: string) => `${LOCK_PREFIX}${id}`;
/** the tournament a Web Lock is held for; null for another lock */
const idOfLock = (name: string) =>
  name.startsWith(LOCK_PREFIX) ? name.slice(LOCK_PREFIX.length) : null;
/** the Web Lock around a change to the queue, so two tabs never start one tournament */
const QUEUE_LOCK = 'ratchet-ui:queue';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** the collection in Games that holds a tournament's games */
export const collectionOf = (id: string) => `t-${id}`;

/**
 * The tournaments in this browser. Each is a folder in OPFS: config.json, then one JSON line per
 * pair issued (pairs.jsonl) and per game finished (games.jsonl), and end.json once it ends. Its
 * games' PGN goes to a collection in Games. A queued one has queued.json until it starts.
 *
 * The queue starts its first tournament that can start when a run ends done and no tournament runs
 * in any tab of this browser; never after a stop or an error, and never by itself on a load.
 */
export const useTournaments = defineStore('tournaments', () => {
  const engines = useEngines();
  const books = useBooks();
  const games = useGames();
  const items = ref<Item[]>([]);
  const error = ref('');
  const runs = new Map<string, Run>();
  /** releases each held Web Lock, by tournament */
  const releases = new Map<string, () => void>();
  /** ids deleted while a `readAll` is in flight, so the finishing read cannot resurrect them */
  const deletedDuringLoad = new Set<string>();

  /** the tournaments' Web Locks held by any tab of this browser, by tournament */
  async function heldIds(): Promise<Set<string>> {
    const held = (await navigator.locks.query()).held ?? [];
    return new Set(held.flatMap((l) => (l.name ? (idOfLock(l.name) ?? []) : [])));
  }

  /** one tournament as its folder holds it; null for a folder with no config */
  async function readItem(id: string, held: ReadonlySet<string>): Promise<Item | null> {
    const path = [...TOURNAMENTS, id];
    const text = await readText(path, 'config.json');
    if (text === null) return null;
    const config = configOf(text);
    const end = await readText(path, 'end.json');
    const state = stateOf(
      config,
      pairsOf(await readText(path, 'pairs.jsonl')),
      gamesOf(await readText(path, 'games.jsonl')),
    );
    const { ended, at } = end === null ? { ended: null, at: null } : endOf(end);
    state.status = ended === 'done' ? 'done' : 'stopped';
    return {
      config,
      state: reactive(state),
      ended,
      elsewhere: held.has(id),
      endedAt: at,
      since: null,
      queued: end === null && !held.has(id) ? orderOf(await readText(path, QUEUED)) : null,
    };
  }

  /** the read in flight; a second load meanwhile, as at a start on Tourneys, waits for it */
  let loading: Promise<void> | null = null;
  function load(): Promise<void> {
    loading ??= readAll().finally(() => (loading = null));
    return loading;
  }

  async function readAll(): Promise<void> {
    deletedDuringLoad.clear();
    const before = new Set(items.value.map((i) => i.config.id));
    try {
      await engines.load();
      const held = await heldIds();
      const out = new Map<string, Item>();
      const broken: string[] = [];
      for (const id of await folders(TOURNAMENTS)) {
        const live = items.value.find((i) => i.config.id === id && runs.has(id));
        if (live) {
          out.set(id, live);
          continue;
        }
        try {
          const item = await readItem(id, held);
          if (item) out.set(id, item);
        } catch {
          broken.push(id);
        }
      }
      // preserve tournaments created or started while this read was awaiting OPFS
      for (const existing of items.value) {
        const id = existing.config.id;
        if (runs.has(id) || (!before.has(id) && !out.has(id))) out.set(id, existing);
      }
      for (const id of deletedDuringLoad) out.delete(id);
      items.value = [...out.values()].toSorted((a, b) =>
        b.config.created.localeCompare(a.config.created),
      );
      error.value =
        broken.length > 0 ? `Some tournaments could not be read: ${broken.join(', ')}` : '';
    } catch (e) {
      error.value = `Tournaments could not be read: ${message(e)}`;
    }
  }

  /** the field's engines, a name each: an engine entered twice gets a number */
  function entrantsOf(config: TournamentConfig): Entrant[] {
    const seen = new Map<string, number>();
    return config.entrants.map((id) => {
      const n = (seen.get(id) ?? 0) + 1;
      seen.set(id, n);
      const twice = config.entrants.filter((x) => x === id).length > 1;
      const entry = engines.list.find((e) => e.id === id);
      if (!entry) throw new Error(`the engine ${id} is not served`);
      return { id, name: twice ? `${id} #${n}` : id, workerUrl: engines.workerUrl(entry) };
    });
  }

  /** settles once a held Web Lock is let go, by tournament */
  const freed = new Map<string, Promise<unknown>>();

  /** takes the tournament's Web Lock; false when another tab holds it */
  function lock(id: string): Promise<boolean> {
    return new Promise((resolve) => {
      // the browser calls back in a later task, so `settled` is set by then
      const settled: Promise<unknown> = navigator.locks.request(
        lockOf(id),
        { ifAvailable: true },
        (held) => {
          if (held === null) {
            resolve(false);
            return undefined;
          }
          freed.set(id, settled);
          resolve(true);
          return new Promise<void>((release) => {
            releases.set(id, release);
          });
        },
      );
    });
  }

  /** lets the tournament's Web Lock go; settles once another tab's query no longer sees it */
  function unlock(id: string): Promise<unknown> {
    releases.get(id)?.();
    releases.delete(id);
    const settled = freed.get(id) ?? Promise.resolve();
    freed.delete(id);
    return settled;
  }

  /** plays a tournament in this tab, from its saved records on */
  async function start(item: Item): Promise<void> {
    const { config } = item;
    const control = resolveControl(config.control);
    if (!control) throw new Error(`the time control ${config.control} is not known`);
    if (config.book && !books.loaded) await books.load();
    const players = entrantsOf(config);
    if (!(await lock(config.id))) {
      item.elsewhere = true;
      throw new Error('another tab plays this tournament');
    }
    const path = [...TOURNAMENTS, config.id];
    let run: Run;
    try {
      await removeFile(path, 'end.json');
      run = new Run(config, players, control, item.state, {
        opening: async (pair) =>
          config.book ? books.openingAt(config.book, pick(config.seed, pair)) : undefined,
        savePair: async (p) => {
          await appendText(path, 'pairs.jsonl', `${JSON.stringify(p)}\n`);
        },
        saveGame: async (record, pgn) => {
          await appendText(path, 'games.jsonl', `${JSON.stringify(record)}\n`);
          await games.append(collectionOf(config.id), config.name, 'match', pgn);
        },
        saveEnd: async (status) => {
          const at = new Date().toISOString();
          let writeFailed = false;
          try {
            await writeText(path, 'end.json', JSON.stringify({ status, at }));
          } catch (e) {
            writeFailed = true;
            item.state.error = `End state could not be saved: ${message(e)}`;
          } finally {
            item.ended = status === 'done' && !writeFailed ? 'done' : 'stopped';
            item.endedAt = writeFailed ? null : at;
            item.since = null;
            runs.delete(config.id);
            await unlock(config.id);
          }
          if (status === 'done' && !writeFailed) void advance();
        },
      });
    } catch (e) {
      await unlock(config.id);
      throw e;
    }
    runs.set(config.id, run);
    item.ended = null;
    item.endedAt = null;
    item.since = { at: Date.now(), games: item.state.games.length };
    item.elsewhere = false;
    item.state.error = '';
    run.start();
  }

  /** saves a new tournament and starts it */
  async function create(config: TournamentConfig): Promise<void> {
    if (!resolveControl(config.control))
      throw new Error(`the time control ${config.control} is not known`);
    entrantsOf(config);
    await writeText([...TOURNAMENTS, config.id], 'config.json', JSON.stringify(config, null, 1));
    const item: Item = reactive({
      config,
      state: stateOf(config, [], []),
      ended: null,
      elsewhere: false,
      endedAt: null,
      since: null,
      queued: null,
    });
    items.value.unshift(item);
    await start(item);
  }

  // ── the queue ────────────────────────────────────────────────────────────

  /** the queued tournaments in this tab's view, in the queue's order */
  const queue = computed(() => inOrder(items.value));
  /** the runs Pause all stopped, which Resume all resumes; this tab's only, and lost on a reload */
  const paused = ref<string[]>([]);

  const withQueue = <T>(job: () => Promise<T>): Promise<T> =>
    navigator.locks.request(QUEUE_LOCK, job);

  const have = (): Have => ({
    engines: new Set(engines.list.map((e) => e.id)),
    books: new Set(books.usable.map((b) => b.id)),
  });

  /** whether a tournament is still queued in OPFS, which another tab may have changed */
  const stillQueued = async (id: string) =>
    orderOf(await readText([...TOURNAMENTS, id], QUEUED)) !== null;

  /** the queue as OPFS holds it now, since another tab may have queued or started some */
  async function queueOnDisk(): Promise<Item[]> {
    const held = await heldIds();
    const out: Item[] = [];
    for (const id of await folders(TOURNAMENTS)) {
      const order = orderOf(await readText([...TOURNAMENTS, id], QUEUED));
      const known = items.value.find((i) => i.config.id === id);
      if (order === null) {
        if (known && known.queued !== null) known.queued = null;
        continue;
      }
      if (known) {
        known.queued = order;
        out.push(known);
        continue;
      }
      try {
        const read = await readItem(id, held);
        if (read) {
          const item = reactive(read);
          items.value.unshift(item);
          out.push(item);
        }
      } catch {
        // skip corrupt tournament folder so the rest of the queue can advance
      }
    }
    return inOrder(out);
  }

  /** takes a tournament off the queue and plays it; the queue's lock is held */
  async function startQueued(item: Item): Promise<void> {
    await removeFile([...TOURNAMENTS, item.config.id], QUEUED);
    item.queued = null;
    try {
      await start(item);
    } catch (e) {
      item.state.error = `It could not start: ${message(e)}`;
    }
  }

  /** starts the queue's first tournament that can start, when no tournament runs in any tab */
  async function advance(): Promise<void> {
    try {
      await withQueue(async () => {
        if (runs.size > 0 || (await heldIds()).size > 0) return;
        await books.load();
        const h = have();
        const next = (await queueOnDisk()).find((i) => ready(i.config, h));
        if (next) await startQueued(next);
      });
    } catch (e) {
      error.value = `The queue could not start: ${message(e)}`;
    }
  }

  /**
   * saves a new tournament at the queue's end; it starts at once when no tournament runs in any
   * tab and Pause all holds none in this one
   */
  async function enqueue(config: TournamentConfig): Promise<void> {
    const path = [...TOURNAMENTS, config.id];
    await withQueue(async () => {
      const existing = await queueOnDisk();
      const tail = existing.at(-1)?.queued ?? 0;
      const order = Math.max(Date.now(), tail + 1);
      await writeText(path, 'config.json', JSON.stringify(config, null, 1));
      await writeText(path, QUEUED, queuedText(order));
      const item: Item = reactive({
        config,
        state: stateOf(config, [], []),
        ended: null,
        elsewhere: false,
        endedAt: null,
        since: null,
        queued: order,
      });
      items.value.unshift(item);
      if (runs.size > 0 || paused.value.length > 0 || (await heldIds()).size > 0) return;
      try {
        await books.load();
        if (ready(config, have())) await startQueued(item);
      } catch (e) {
        item.state.error = `It could not start: ${message(e)}`;
      }
    });
  }

  /** plays a queued tournament now, beside what runs */
  async function startNow(id: string): Promise<void> {
    const item = items.value.find((i) => i.config.id === id);
    if (!item || item.queued === null) return;
    try {
      await withQueue(async () => {
        if (!(await stillQueued(id))) {
          item.queued = null;
          throw new Error('another tab started it');
        }
        await startQueued(item);
      });
    } catch (e) {
      item.state.error = `It could not start: ${message(e)}`;
    }
  }

  /** moves a queued tournament to another place in the queue */
  async function move(id: string, to: number): Promise<void> {
    try {
      await withQueue(async () => {
        const from = queue.value.findIndex((i) => i.config.id === id);
        for (const [item, key] of reordered(queue.value, from, to)) {
          // a key written for a tournament another tab started would queue it again
          if (!(await stillQueued(item.config.id))) {
            item.queued = null;
            continue;
          }
          await writeText([...TOURNAMENTS, item.config.id], QUEUED, queuedText(key));
          item.queued = key;
        }
      });
    } catch (e) {
      error.value = `The queue could not be reordered: ${message(e)}`;
    }
  }

  /** stops every run in this tab, its games in play finishing; the queue waits, as after any stop */
  function pauseAll(): void {
    paused.value = items.value
      .filter((i) => runs.has(i.config.id) && i.state.status === 'running')
      .map((i) => i.config.id);
    for (const id of paused.value) stop(id, false);
  }

  /** resumes the runs Pause all stopped; starts the queue when none of them can resume */
  async function resumeAll(): Promise<void> {
    const ids = paused.value;
    const stillStopping: string[] = [];
    let resumed = false;
    for (const id of ids) {
      const item = items.value.find((i) => i.config.id === id);
      if (!item || item.ended === 'done' || item.elsewhere) continue;
      if (runs.has(id)) {
        stillStopping.push(id);
        continue;
      }
      await resume(id);
      resumed = true;
    }
    paused.value = stillStopping;
    if (!resumed && stillStopping.length === 0) await advance();
  }

  /** plays a stopped or interrupted tournament on: the unfinished games of its pairs, then the rest */
  async function resume(id: string): Promise<void> {
    const item = items.value.find((i) => i.config.id === id);
    if (!item || runs.has(id) || item.ended === 'done' || item.queued !== null) return;
    try {
      await start(item);
    } catch (e) {
      item.state.error = `It could not resume: ${message(e)}`;
    }
  }

  function stop(id: string, now: boolean): void {
    runs.get(id)?.stop(now);
  }

  const running = (id: string) => runs.has(id);

  /** reads live game snapshots for a running tournament on demand; zero cost when unused */
  function liveSnapshots(id: string, focusKey?: string | null): LiveSnapshots {
    return runs.get(id)?.snapshots(focusKey) ?? { active: [], focused: null };
  }

  /**
   * deletes a tournament's records, unless a tab plays it; its games stay in Games. The queue's lock
   * keeps a reorder from writing into the folder as it goes.
   */
  async function remove(id: string): Promise<void> {
    if (runs.has(id)) throw new Error('stop the tournament before deleting it');
    await withQueue(async () => {
      if (!(await lock(id))) throw new Error('another tab plays this tournament');
      try {
        await removeFolder(TOURNAMENTS, id);
      } finally {
        await unlock(id);
      }
    });
    deletedDuringLoad.add(id);
    items.value = items.value.filter((i) => i.config.id !== id);
  }

  return {
    items,
    error,
    load,
    create,
    resume,
    stop,
    remove,
    running,
    liveSnapshots,
    lock,
    unlock,
    idOfLock,
    queue,
    paused,
    enqueue,
    startNow,
    move,
    pauseAll,
    resumeAll,
  };
});
