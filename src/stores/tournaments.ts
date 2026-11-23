import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import { resolveControl } from '../chess/clock.ts';
import type { TournamentConfig } from '../match/format.ts';
import { configOf, gamesOf, pairsOf } from '../match/records.ts';
import { Run, stateOf, type Entrant, type RunState } from '../match/runner.ts';
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

/** the collection in Games that holds a tournament's games */
export const collectionOf = (id: string) => `t-${id}`;

/**
 * The tournaments in this browser. Each is a folder in OPFS: config.json, then one JSON line per
 * pair issued (pairs.jsonl) and per game finished (games.jsonl), and end.json once it ends. Its
 * games' PGN goes to a collection in Games.
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

  async function load(): Promise<void> {
    try {
      await engines.load();
      const held = new Set(((await navigator.locks.query()).held ?? []).map((l) => l.name));
      const out: Item[] = [];
      for (const id of await folders(TOURNAMENTS)) {
        const live = items.value.find((i) => i.config.id === id && runs.has(id));
        if (live) {
          out.push(live);
          continue;
        }
        const text = await readText([...TOURNAMENTS, id], 'config.json');
        if (text === null) continue;
        const config = configOf(text);
        const end = await readText([...TOURNAMENTS, id], 'end.json');
        const state = stateOf(
          config,
          pairsOf(await readText([...TOURNAMENTS, id], 'pairs.jsonl')),
          gamesOf(await readText([...TOURNAMENTS, id], 'games.jsonl')),
        );
        const { ended, at } = end === null ? { ended: null, at: null } : endOf(end);
        state.status = ended === 'done' ? 'done' : 'stopped';
        out.push({
          config,
          state: reactive(state),
          ended,
          elsewhere: held.has(lockOf(id)),
          endedAt: at,
          since: null,
        });
      }
      items.value = out.toSorted((a, b) => b.config.created.localeCompare(a.config.created));
      error.value = '';
    } catch (e) {
      error.value = `Tournaments could not be read: ${e instanceof Error ? e.message : String(e)}`;
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

  /** takes the tournament's Web Lock; false when another tab holds it */
  function lock(id: string): Promise<boolean> {
    return new Promise((resolve) => {
      void navigator.locks.request(lockOf(id), { ifAvailable: true }, (held) => {
        resolve(held !== null);
        if (held === null) return undefined;
        return new Promise<void>((release) => {
          releases.set(id, release);
        });
      });
    });
  }

  function unlock(id: string): void {
    releases.get(id)?.();
    releases.delete(id);
  }

  /** plays a tournament in this tab, from its saved records on */
  async function start(item: Item): Promise<void> {
    const { config } = item;
    const control = resolveControl(config.control);
    if (!control) throw new Error(`the time control ${config.control} is not known`);
    const players = entrantsOf(config);
    if (!(await lock(config.id))) {
      item.elsewhere = true;
      throw new Error('another tab plays this tournament');
    }
    const path = [...TOURNAMENTS, config.id];
    await removeFile(path, 'end.json');
    const run = new Run(config, players, control, item.state, {
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
        await writeText(path, 'end.json', JSON.stringify({ status, at }));
        item.ended = status === 'done' ? 'done' : 'stopped';
        item.endedAt = at;
        item.since = null;
        runs.delete(config.id);
        unlock(config.id);
      },
    });
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
    await writeText([...TOURNAMENTS, config.id], 'config.json', JSON.stringify(config, null, 1));
    const item: Item = reactive({
      config,
      state: stateOf(config, [], []),
      ended: null,
      elsewhere: false,
      endedAt: null,
      since: null,
    });
    items.value.unshift(item);
    await start(item);
  }

  /** plays a stopped or interrupted tournament on: the unfinished games of its pairs, then the rest */
  async function resume(id: string): Promise<void> {
    const item = items.value.find((i) => i.config.id === id);
    if (!item || runs.has(id) || item.ended === 'done') return;
    try {
      await start(item);
    } catch (e) {
      item.state.error = `It could not resume: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  function stop(id: string, now: boolean): void {
    runs.get(id)?.stop(now);
  }

  const running = (id: string) => runs.has(id);

  /** deletes a tournament's records, unless a tab plays it; its games stay in Games */
  async function remove(id: string): Promise<void> {
    if (runs.has(id)) throw new Error('stop the tournament before deleting it');
    if (!(await lock(id))) throw new Error('another tab plays this tournament');
    try {
      await removeFolder(TOURNAMENTS, id);
    } finally {
      unlock(id);
    }
    items.value = items.value.filter((i) => i.config.id !== id);
  }

  return { items, error, load, create, resume, stop, remove, running, lock, unlock, idOfLock };
});
