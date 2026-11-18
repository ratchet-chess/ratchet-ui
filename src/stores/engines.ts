import { defineStore } from 'pinia';
import { ref } from 'vue';
import { parseManifest, type EngineEntry } from '../engine/manifest.ts';

/** where the app serves the engines' files, below its base path */
export const enginesBase = `${import.meta.env.BASE_URL}engines/`;

/** The engines this app can run, from public/engines.json. */
export const useEngines = defineStore('engines', () => {
  const list = ref<EngineEntry[]>([]);
  const error = ref('');
  const loaded = ref(false);

  async function load(): Promise<void> {
    if (loaded.value) return;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}engines.json`);
      if (!res.ok) throw new Error(`engines.json: ${res.status} ${res.statusText}`);
      list.value = parseManifest(await res.text()).engines;
      loaded.value = true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  return { list, error, loaded, load };
});
