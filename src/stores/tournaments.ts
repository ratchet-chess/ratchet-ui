import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import { TIME_CONTROLS } from '../chess/clock.ts';
import type { TournamentConfig } from '../match/format.ts';
import { configOf, gamesOf, pairsOf } from '../match/records.ts';
import { Run, stateOf, type Entrant, type RunState } from '../match/runner.ts';
import { appendText, folders, readText, removeFolder, writeText } from '../storage/opfs.ts';
import { useBooks } from './books.ts';
import { useEngines } from './engines.ts';
import { useGames } from './games.ts';

/** One tournament: its setup and its state, whether it runs in this tab or was saved before. */
export interface Item {
  config: TournamentConfig;
  state: RunState;
  /** how a run that is not in this tab ended: `done`, `stopped`, or null when the tab closed during it */
  ended: 'done' | 'stopped' | null;
}

const ROOT = ['tournaments'];

/** a uniform number in [0, 1) from a seed and a pair's number, so a pair's opening can be picked again */
function pick(seed: number, pair: number): number {
  let t = (seed ^ Math.imul(pair + 1, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

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

  async function load(): Promise<void> {
    try {
      await engines.load();
      const out: Item[] = [];
      for (const id of await folders(ROOT)) {
        const live = items.value.find((i) => i.config.id === id && runs.has(id));
        if (live) {
          out.push(live);
          continue;
        }
        const text = await readText([...ROOT, id], 'config.json');
        if (text === null) continue;
        const config = configOf(text);
        const end = await readText([...ROOT, id], 'end.json');
        const state = stateOf(
          config,
          pairsOf(await readText([...ROOT, id], 'pairs.jsonl')),
          gamesOf(await readText([...ROOT, id], 'games.jsonl')),
        );
        const ended = end === null ? null : end.includes('"done"') ? 'done' : 'stopped';
        state.status = ended === 'done' ? 'done' : 'stopped';
        out.push({ config, state: reactive(state), ended });
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

  function start(item: Item): void {
    const { config } = item;
    const control = TIME_CONTROLS.find((t) => t.label === config.control);
    if (!control) throw new Error(`the time control ${config.control} is not known`);
    const path = [...ROOT, config.id];
    const run = new Run(config, entrantsOf(config), control, item.state, {
      opening: async (pair) =>
        config.book ? books.openingAt(config.book, pick(config.seed, pair)) : undefined,
      savePair: (p) => appendText(path, 'pairs.jsonl', `${JSON.stringify(p)}\n`),
      saveGame: async (record, pgn) => {
        await appendText(path, 'games.jsonl', `${JSON.stringify(record)}\n`);
        await games.append(collectionOf(config.id), config.name, 'match', pgn);
      },
      saveEnd: async (status) => {
        await writeText(path, 'end.json', JSON.stringify({ status, at: new Date().toISOString() }));
        item.ended = status === 'done' ? 'done' : 'stopped';
        runs.delete(config.id);
      },
    });
    runs.set(config.id, run);
    item.ended = null;
    run.start();
  }

  /** saves a new tournament and starts it */
  async function create(config: TournamentConfig): Promise<void> {
    await writeText([...ROOT, config.id], 'config.json', JSON.stringify(config, null, 1));
    const item: Item = reactive({ config, state: stateOf(config, [], []), ended: null });
    items.value.unshift(item);
    start(item);
  }

  function stop(id: string, now: boolean): void {
    runs.get(id)?.stop(now);
  }

  const running = (id: string) => runs.has(id);

  /** deletes a tournament's records; its games stay in Games */
  async function remove(id: string): Promise<void> {
    runs.get(id)?.stop(true);
    runs.delete(id);
    await removeFolder(ROOT, id);
    items.value = items.value.filter((i) => i.config.id !== id);
  }

  return { items, error, load, create, stop, remove, running };
});
