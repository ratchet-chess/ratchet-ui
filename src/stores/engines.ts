import { defineStore } from 'pinia';
import { ref } from 'vue';
import { parseServed, type ServedEngine } from '../engine/manifest.ts';

/** where the app serves the engines' files, below its base path */
const enginesBase = `${import.meta.env.BASE_URL}engines/`;

/** The engines this app serves, from public/engines.json. */
export const useEngines = defineStore('engines', () => {
  const list = ref<ServedEngine[]>([]);
  /** the host's Worker script, below enginesBase */
  const host = ref('');
  const error = ref('');
  const loaded = ref(false);

  async function load(): Promise<void> {
    if (loaded.value) return;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}engines.json`);
      if (!res.ok) throw new Error(`engines.json: ${res.status} ${res.statusText}`);
      const served = parseServed(await res.text());
      host.value = served.host;
      list.value = served.engines;
      loaded.value = true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  /** the Worker URL that runs `engine` in the host */
  const workerUrl = (engine: ServedEngine) => `${enginesBase}${host.value}#${engine.wasm}`;

  return { list, host, error, loaded, load, workerUrl };
});
