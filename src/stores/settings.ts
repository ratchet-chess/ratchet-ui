import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { parseControl } from '../chess/clock.ts';
import type { EngineOptionPreset, OptionValue } from '../engine/options.ts';
import type { TournamentConfig } from '../match/format.ts';
import { configOf } from '../match/records.ts';
import { ANCHOR_RATING } from '../ratings/list.ts';

const MANAGER_KEY = 'ratchet-ui.manager';
const CONTROLS_KEY = 'ratchet-ui.controls';
const TEMPLATES_KEY = 'ratchet-ui.templates';
const START_KEY = 'ratchet-ui.template-start';
/** index.html reads this key too, to set the theme before the first paint */
const THEME_KEY = 'ratchet-ui.theme';
const BACKUP_BOOKS_KEY = 'ratchet-ui.backup-books';
const BACKUP_ENGINES_KEY = 'ratchet-ui.backup-engines';
const ANCHOR_KEY = 'ratchet-ui.anchor-rating';
const ENGINE_OPTIONS_KEY = 'ratchet-ui.engine-options';

/** light, dark, or as the system asks */
export type Theme = 'light' | 'dark' | 'system';
const isTheme = (x: unknown): x is Theme => x === 'light' || x === 'dark' || x === 'system';

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

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage quota or private-mode restrictions
  }
}

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore storage restrictions
  }
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(readStorage(key) ?? 'null');
  } catch {
    return null;
  }
}

function templatesOf(x: unknown): Template[] {
  if (!Array.isArray(x)) return [];
  const out: Template[] = [];
  for (const t of x as unknown[]) {
    if (typeof t !== 'object' || t === null || !('name' in t) || !('setup' in t)) continue;
    const setup = setupOf(t.setup);
    if (typeof t.name === 'string' && setup) out.push({ name: t.name, setup });
  }
  return out;
}

function controlsOf(x: unknown): string[] {
  return Array.isArray(x)
    ? x.filter((c): c is string => typeof c === 'string' && parseControl(c) !== null)
    : [];
}

const ratingOf = (x: unknown): number | null =>
  typeof x === 'number' && Number.isFinite(x) ? x : null;

function isOptionValue(x: unknown): x is OptionValue {
  return (
    typeof x === 'string' || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x))
  );
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

function engineOptionsOf(x: unknown): Record<string, EngineOptionPreset> {
  if (!isRecord(x)) return {};
  const out: Record<string, EngineOptionPreset> = {};
  for (const [id, raw] of Object.entries(x)) {
    if (!id || !isRecord(raw)) continue;
    const opts: Record<string, OptionValue> = {};
    if (isRecord(raw.options)) {
      for (const [k, v] of Object.entries(raw.options)) {
        if (k && isOptionValue(v)) opts[k] = v;
      }
    }
    const limit =
      typeof raw.limit === 'string' && raw.limit.trim() && parseControl(raw.limit) !== null
        ? raw.limit.trim()
        : undefined;
    if (Object.keys(opts).length > 0 || limit) {
      out[id] = limit ? { options: opts, limit } : { options: opts };
    }
  }
  return out;
}

/** the settings as a backup keeps them, in settings.json */
export interface SettingsFile {
  manager: string;
  controls: string[];
  templates: Template[];
  templateStart: string;
  theme: Theme;
  backupBooks: boolean;
  backupEngines: boolean;
  /** the rating Ratings holds its anchor at; null, a rating cleared, leaves the ratings averaging 0 */
  anchorRating: number | null;
  /** saved UCI option defaults and optional per-side limit, keyed by engine id */
  engineOptions: Record<string, EngineOptionPreset>;
}

/** a settings.json read back; what does not read takes its default */
export function settingsFileOf(x: unknown): SettingsFile {
  const r: Record<string, unknown> =
    typeof x === 'object' && x !== null ? Object.fromEntries(Object.entries(x)) : {};
  return {
    manager: typeof r.manager === 'string' ? r.manager : '',
    controls: controlsOf(r.controls),
    templates: templatesOf(r.templates),
    templateStart: typeof r.templateStart === 'string' ? r.templateStart : '',
    theme: isTheme(r.theme) ? r.theme : 'system',
    backupBooks: r.backupBooks !== false,
    backupEngines: r.backupEngines !== false,
    anchorRating: 'anchorRating' in r ? ratingOf(r.anchorRating) : ANCHOR_RATING,
    engineOptions: engineOptionsOf(r.engineOptions),
  };
}

/**
 * Both files' settings: this one's values, the other's time controls and templates added; a
 * template whose name is taken comes in with a number.
 */
export function unionOf(here: SettingsFile, there: SettingsFile): SettingsFile {
  const names = new Set(here.templates.map((t) => t.name));
  const added = there.templates
    .filter((t) => !here.templates.some((h) => JSON.stringify(h) === JSON.stringify(t)))
    .map((t) => {
      let name = t.name;
      for (let n = 2; names.has(name); n++) name = `${t.name} (${n})`;
      names.add(name);
      return { ...t, name };
    });
  return {
    ...here,
    controls: [...new Set([...here.controls, ...there.controls])],
    templates: [...here.templates, ...added].toSorted((a, b) => a.name.localeCompare(b.name)),
    engineOptions: { ...there.engineOptions, ...here.engineOptions },
  };
}

/**
 * The app's settings that outlive a reload: the manager's address, the user's own time controls,
 * the tournament templates, the theme and what a backup holds. They are small, so localStorage holds them; games and books are in
 * OPFS.
 */
export const useSettings = defineStore('settings', () => {
  /** the manager's address, such as http://host:port; empty when none is set */
  const managerUrl = ref(readStorage(MANAGER_KEY) ?? '');
  watch(managerUrl, (url) => {
    if (url) writeStorage(MANAGER_KEY, url);
    else removeStorage(MANAGER_KEY);
  });

  /** the user's own time controls, as typed, beside the built-in ones */
  const controls = ref<string[]>(controlsOf(readJson(CONTROLS_KEY)));
  watch(controls, (c) => writeStorage(CONTROLS_KEY, JSON.stringify(c)), { deep: true });

  const templates = ref<Template[]>(templatesOf(readJson(TEMPLATES_KEY)));
  watch(templates, (t) => writeStorage(TEMPLATES_KEY, JSON.stringify(t)), { deep: true });

  /** the template a New starts from; empty for the app's own defaults */
  const startTemplate = ref(readStorage(START_KEY) ?? '');
  watch(startTemplate, (name) => {
    if (name) writeStorage(START_KEY, name);
    else removeStorage(START_KEY);
  });

  const stored = readStorage(THEME_KEY);
  const theme = ref<Theme>(isTheme(stored) ? stored : 'system');
  watch(theme, (t) => {
    if (t === 'system') removeStorage(THEME_KEY);
    else writeStorage(THEME_KEY, t);
  });

  /** whether a backup, the export and the mirror folder, holds the user's books */
  const backupBooks = ref(readStorage(BACKUP_BOOKS_KEY) !== 'false');
  watch(backupBooks, (b) => {
    if (b) removeStorage(BACKUP_BOOKS_KEY);
    else writeStorage(BACKUP_BOOKS_KEY, 'false');
  });

  /** whether a backup, the export and the mirror folder, holds the user's in-browser engines */
  const backupEngines = ref(readStorage(BACKUP_ENGINES_KEY) !== 'false');
  watch(backupEngines, (b) => {
    if (b) removeStorage(BACKUP_ENGINES_KEY);
    else writeStorage(BACKUP_ENGINES_KEY, 'false');
  });

  /** the rating Ratings holds its anchor at */
  const anchorRating = ref<number | null>(
    readStorage(ANCHOR_KEY) === null ? ANCHOR_RATING : ratingOf(readJson(ANCHOR_KEY)),
  );
  // the default is not kept in browser storage, so a newer default reaches a user who never set one;
  // a cleared rating is kept as null
  watch(anchorRating, (r) => {
    if (r === ANCHOR_RATING) removeStorage(ANCHOR_KEY);
    else writeStorage(ANCHOR_KEY, JSON.stringify(r));
  });

  /** saved UCI option defaults and optional per-side limit, keyed by engine id */
  const engineOptions = ref<Record<string, EngineOptionPreset>>(
    engineOptionsOf(readJson(ENGINE_OPTIONS_KEY)),
  );
  watch(
    engineOptions,
    (m) => {
      if (Object.keys(m).length === 0) removeStorage(ENGINE_OPTIONS_KEY);
      else writeStorage(ENGINE_OPTIONS_KEY, JSON.stringify(m));
    },
    { deep: true },
  );

  /** the settings as a backup keeps them */
  function file(): SettingsFile {
    // a copy through JSON, which reactive proxies survive and structuredClone refuses
    return settingsFileOf(
      JSON.parse(
        JSON.stringify({
          manager: managerUrl.value,
          controls: controls.value,
          templates: templates.value,
          templateStart: startTemplate.value,
          theme: theme.value,
          backupBooks: backupBooks.value,
          backupEngines: backupEngines.value,
          anchorRating: anchorRating.value,
          engineOptions: engineOptions.value,
        }),
      ),
    );
  }

  /** takes a backup's settings; the watchers keep them */
  function restore(from: SettingsFile): void {
    const f = settingsFileOf(JSON.parse(JSON.stringify(from)));
    managerUrl.value = f.manager;
    controls.value = f.controls;
    templates.value = f.templates;
    startTemplate.value = f.templateStart;
    theme.value = f.theme;
    backupBooks.value = f.backupBooks;
    backupEngines.value = f.backupEngines;
    anchorRating.value = f.anchorRating;
    engineOptions.value = f.engineOptions;
  }

  /** keeps an engine's default options and optional search limit; clears the entry when empty */
  function saveEngineOptions(engineId: string, preset: EngineOptionPreset): void {
    const next = { ...engineOptions.value };
    const clean = engineOptionsOf({ [engineId]: preset })[engineId];
    if (clean) next[engineId] = clean;
    else delete next[engineId];
    engineOptions.value = next;
  }

  /** keeps a setup under a name, replacing a template of that name */
  function saveTemplate(name: string, setup: Setup): void {
    const clean = setupOf(JSON.parse(JSON.stringify(setup)));
    if (!clean) return;
    const rest = templates.value.filter((t) => t.name !== name);
    templates.value = [...rest, { name, setup: clean }].toSorted((a, b) =>
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
    theme,
    backupBooks,
    backupEngines,
    anchorRating,
    engineOptions,
    file,
    restore,
    saveEngineOptions,
    saveTemplate,
    removeTemplate,
  };
});
