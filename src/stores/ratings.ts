import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import { gamesPerPair } from '../match/format.ts';
import { configOf } from '../match/records.ts';
import type { Source } from '../ratings/list.ts';
import { scanHeaders, type ScannedGame } from '../ratings/scan.ts';
import { readText } from '../storage/opfs.ts';
import { useGames, type Collection } from './games.ts';
import { collectionOf, TOURNAMENTS } from './tournaments.ts';

/** One collection as the Ratings page lists it, with the games it counts. */
export interface RatedCollection extends Source {
  collection: Collection;
}

/**
 * The Games library as Ratings reads it. Each collection's games are scanned once, by their tags
 * alone, and kept until the collection changes.
 */
export const useRatings = defineStore('ratings', () => {
  const games = useGames();
  const collections = shallowRef<RatedCollection[]>([]);
  const loading = ref(false);
  const error = ref('');
  const scans = new Map<string, { updated: string; bytes: number; games: ScannedGame[] }>();
  let loadToken = 0;

  /** the filters, kept while the app is open: a collection's choice where it differs from its default */
  const chosen = ref(new Map<string, boolean>());
  /** a control's key; null for every control */
  const control = ref<string | null>(null);
  const forfeits = ref(true);
  const minGames = ref(0);
  const search = ref('');
  /** Play's games are a person's, so they are left out until chosen */
  const counted = (c: RatedCollection) => chosen.value.get(c.id) ?? c.collection.source !== 'play';
  function choose(ids: readonly string[], on: boolean): void {
    const next = new Map(chosen.value);
    for (const id of ids) next.set(id, on);
    chosen.value = next;
  }

  /** a tournament's games per opening and control, read from its config; null when it is gone */
  async function tournamentOf(c: Collection): Promise<Pick<Source, 'per' | 'control'> | null> {
    const id = c.id.slice(collectionOf('').length);
    if (c.source !== 'match' || collectionOf(id) !== c.id) return null;
    const text = await readText([...TOURNAMENTS, id], 'config.json');
    try {
      const config = text === null ? null : configOf(text);
      return config && { per: gamesPerPair(config.format, config.paired), control: config.control };
    } catch {
      // a config this version cannot read: its games pair as a file's do
      return null;
    }
  }

  async function load(): Promise<void> {
    const mine = ++loadToken;
    loading.value = true;
    try {
      await games.load();
      if (mine !== loadToken) return;
      const out: RatedCollection[] = [];
      for (const c of games.list) {
        let scan = scans.get(c.id);
        if (scan?.updated !== c.updated || scan.bytes !== c.bytes) {
          scan = {
            updated: c.updated,
            bytes: c.bytes,
            games: scanHeaders(await games.read(c.id)).games,
          };
          if (mine !== loadToken) return;
          scans.set(c.id, scan);
        }
        const t = await tournamentOf(c);
        if (mine !== loadToken) return;
        out.push({
          id: c.id,
          collection: c,
          games: scan.games,
          per: t?.per ?? null,
          control: t?.control ?? null,
        });
      }
      for (const id of scans.keys()) if (!games.list.some((c) => c.id === id)) scans.delete(id);
      collections.value = out;
      error.value = games.error;
    } catch (e) {
      if (mine !== loadToken) return;
      error.value = `Games could not be read: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      if (mine === loadToken) loading.value = false;
    }
  }

  return {
    collections,
    loading,
    error,
    load,
    control,
    forfeits,
    minGames,
    search,
    counted,
    choose,
  };
});
