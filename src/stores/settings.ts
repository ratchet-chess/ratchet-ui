import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { parseControl } from '../chess/clock.ts';
import type { TournamentConfig } from '../match/format.ts';
import { configOf } from '../match/records.ts';

const MANAGER_KEY = 'ratchet-ui.manager';
const CONTROLS_KEY = 'ratchet-ui.controls';
const TEMPLATES_KEY = 'ratchet-ui.templates';
const START_KEY = 'ratchet-ui.template-start';

/** a tournament's setup without what makes one run: its id, date, name and seed */
export type Setup = Omit<TournamentConfig, 'id' | 'created' | 'name' | 'seed'>;

/** A setup saved under a name, to start a tournament from. */
export interface Template {
  name: string;
  setup: Setup;
}

/** a setup as it would be saved, read back by the tournaments' own reader; null when it does not read */
export function setupOf(x: unknown): Setup | null {
  if (typeof x !== 'object' || x === null) return null;
  try {
    const { id, created, name, seed, ...setup } = configOf(
      JSON.stringify({ ...x, id: '', created: '', name: '', seed: 0 }),
    );
    void [id, created, name, seed];
    return setup;
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function readTemplates(): Template[] {
  const x = readJson(TEMPLATES_KEY);
  if (!Array.isArray(x)) return [];
  const out: Template[] = [];
  for (const t of x as unknown[]) {
    if (typeof t !== 'object' || t === null || !('name' in t) || !('setup' in t)) continue;
    const setup = setupOf(t.setup);
    if (typeof t.name === 'string' && setup) out.push({ name: t.name, setup });
  }
  return out;
}

function readControls(): string[] {
  const x = readJson(CONTROLS_KEY);
  return Array.isArray(x)
    ? x.filter((c): c is string => typeof c === 'string' && parseControl(c) !== null)
    : [];
}

/**
 * The app's settings that outlive a reload: the manager's address, the user's own time controls
 * and the tournament templates. They are small, so localStorage holds them; games and books are in
 * OPFS.
 */
export const useSettings = defineStore('settings', () => {
  /** the manager's address, such as http://host:port; empty when none is set */
  const managerUrl = ref(localStorage.getItem(MANAGER_KEY) ?? '');
  watch(managerUrl, (url) => {
    if (url) localStorage.setItem(MANAGER_KEY, url);
    else localStorage.removeItem(MANAGER_KEY);
  });

  /** the user's own time controls, as typed, beside the built-in ones */
  const controls = ref<string[]>(readControls());
  watch(controls, (c) => localStorage.setItem(CONTROLS_KEY, JSON.stringify(c)), { deep: true });

  const templates = ref<Template[]>(readTemplates());
  watch(templates, (t) => localStorage.setItem(TEMPLATES_KEY, JSON.stringify(t)), { deep: true });

  /** the template a New starts from; empty for the app's own defaults */
  const startTemplate = ref(localStorage.getItem(START_KEY) ?? '');
  watch(startTemplate, (name) => {
    if (name) localStorage.setItem(START_KEY, name);
    else localStorage.removeItem(START_KEY);
  });

  /** keeps a setup under a name, replacing a template of that name */
  function saveTemplate(name: string, setup: Setup): void {
    const rest = templates.value.filter((t) => t.name !== name);
    templates.value = [...rest, { name, setup: structuredClone(setup) }].toSorted((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  function removeTemplate(name: string): void {
    templates.value = templates.value.filter((t) => t.name !== name);
    if (startTemplate.value === name) startTemplate.value = '';
  }

  return {
    managerUrl,
    controls,
    templates,
    startTemplate,
    saveTemplate,
    removeTemplate,
  };
});
