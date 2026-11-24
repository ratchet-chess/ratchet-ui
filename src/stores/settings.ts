import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { parseControl } from '../chess/clock.ts';
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
const ANCHOR_KEY = 'ratchet-ui.anchor-rating';

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

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
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

/** the settings as a backup keeps them, in settings.json */
export interface SettingsFile {
  manager: string;
  controls: string[];
  templates: Template[];
  templateStart: string;
  theme: Theme;
  backupBooks: boolean;
  /** the rating Ratings holds its anchor at; null, a rating cleared, leaves the ratings averaging 0 */
  anchorRating: number | null;
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
    anchorRating: 'anchorRating' in r ? ratingOf(r.anchorRating) : ANCHOR_RATING,
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
  };
}

/**
 * The app's settings that outlive a reload: the manager's address, the user's own time controls,
 * the tournament templates, the theme and what a backup holds. They are small, so localStorage holds them; games and books are in
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
  const controls = ref<string[]>(controlsOf(readJson(CONTROLS_KEY)));
  watch(controls, (c) => localStorage.setItem(CONTROLS_KEY, JSON.stringify(c)), { deep: true });

  const templates = ref<Template[]>(templatesOf(readJson(TEMPLATES_KEY)));
  watch(templates, (t) => localStorage.setItem(TEMPLATES_KEY, JSON.stringify(t)), { deep: true });

  /** the template a New starts from; empty for the app's own defaults */
  const startTemplate = ref(localStorage.getItem(START_KEY) ?? '');
  watch(startTemplate, (name) => {
    if (name) localStorage.setItem(START_KEY, name);
    else localStorage.removeItem(START_KEY);
  });

  const stored = localStorage.getItem(THEME_KEY);
  const theme = ref<Theme>(isTheme(stored) ? stored : 'system');
  watch(theme, (t) => {
    if (t === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  });

  /** whether a backup, the export and the mirror folder, holds the user's books */
  const backupBooks = ref(localStorage.getItem(BACKUP_BOOKS_KEY) !== 'false');
  watch(backupBooks, (b) => {
    if (b) localStorage.removeItem(BACKUP_BOOKS_KEY);
    else localStorage.setItem(BACKUP_BOOKS_KEY, 'false');
  });

  /** the rating Ratings holds its anchor at */
  const anchorRating = ref<number | null>(
    localStorage.getItem(ANCHOR_KEY) === null ? ANCHOR_RATING : ratingOf(readJson(ANCHOR_KEY)),
  );
  // the default is not kept in browser storage, so a newer default reaches a user who never set one;
  // a cleared rating is kept as null
  watch(anchorRating, (r) => {
    if (r === ANCHOR_RATING) localStorage.removeItem(ANCHOR_KEY);
    else localStorage.setItem(ANCHOR_KEY, JSON.stringify(r));
  });

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
          anchorRating: anchorRating.value,
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
    anchorRating.value = f.anchorRating;
  }

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
    theme,
    backupBooks,
    anchorRating,
    file,
    restore,
    saveTemplate,
    removeTemplate,
  };
});
