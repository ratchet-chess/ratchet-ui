/**
 * A backup of the app's data, in OPFS's own layout: the files an export zips and the mirror
 * folder holds, read back into items a person knows (a tournament, a collection of games, a book
 * of theirs, the settings), compared with this browser's, and merged by the user's choices.
 * Pulled books are left out: a pull makes them again.
 */
import { configOf } from '../match/records.ts';
import { isUserBook, USER, USER_LIST, type UserBook } from '../stores/books.ts';
import {
  isUserEngine,
  USER_ENGINES,
  USER_ENGINES_LIST,
  type UserEngine,
} from '../stores/engines.ts';
import { QUEUED } from '../stores/queue.ts';
import { GAMES, GAMES_INDEX, isCollection, type Collection } from '../stores/games.ts';
import { settingsFileOf, unionOf, type SettingsFile } from '../stores/settings.ts';
import { bytes, count } from '../ui/format.ts';
import { makeId } from './id.ts';

/** a backup's files, by their path in the layout, such as `tournaments/<id>/config.json` */
export type Files = Map<string, Blob>;

export const SETTINGS = 'settings.json';
export const TOURNAMENTS = 'tournaments';
const TOURNAMENT_FILES = new Set(['config.json', 'pairs.jsonl', 'games.jsonl', 'end.json', QUEUED]);
/** a collection's id for a tournament's games, as the tournaments store names it */
const T_PREFIX = 't-';

/** a file or folder name the app made, and OPFS takes */
const isName = (s: string | undefined): s is string =>
  s !== undefined && s !== '' && s !== '.' && s !== '..' && !/[/\\]/.test(s);

/** whether a path is one of the layout's files; user books and engines only when enabled */
export function inLayout(path: string, books: boolean, engines = false): boolean {
  const p = path.split('/');
  if (p.length === 1) return p[0] === SETTINGS;
  if (p.length === 2 && p[0] === GAMES)
    return p[1] === GAMES_INDEX || /^[^/\\]+\.pgn$/.test(p[1] ?? '');
  if (p.length === 2 && p[0] === USER) return books && isName(p[1]);
  if (p.length === 2 && p[0] === USER_ENGINES) return engines && isName(p[1]);
  if (p.length === 3 && p[0] === TOURNAMENTS)
    return isName(p[1]) && TOURNAMENT_FILES.has(p[2] ?? '');
  return false;
}

/**
 * An archive's files in the layout. A folder zipped whole puts the layout under one folder of its
 * own; that folder is taken off.
 */
export function layoutOf(files: Files): Files {
  let out = new Map([...files].filter(([p]) => inLayout(p, true, true)));
  if (out.size === 0) {
    const visible = [...files].filter(
      ([p]) => !p.startsWith('__MACOSX/') && !p.split('/').some((seg) => seg.startsWith('.')),
    );
    const heads = new Set(visible.map(([p]) => p.split('/')[0]));
    if (heads.size === 1)
      out = new Map(
        visible
          .map(([p, b]): [string, Blob] => [p.slice(p.indexOf('/') + 1), b])
          .filter(([p]) => inLayout(p, true, true)),
      );
  }
  return out;
}

// ── items ───────────────────────────────────────────────────────────────────

export type Kind = 'tournament' | 'collection' | 'book' | 'engine' | 'settings';

/** one thing a person knows by name, with the files that make it */
export interface Item {
  kind: Kind;
  /** its id in its kind: a tournament's or collection's id, a book's file name, or an engine's id */
  id: string;
  name: string;
  files: Files;
  /** its entry in games/index.json: a collection's own, or a tournament's games */
  collection?: Collection;
  book?: UserBook;
  engine?: UserEngine;
  settings?: SettingsFile;
  /** what tells two copies apart, such as the games played */
  facts: string;
}

export const keyOf = (kind: Kind, id: string) => `${kind}:${id}`;

/** a backup read as items, with the index entries it holds and the files it could not use */
export interface Contents {
  items: Map<string, Item>;
  collections: Collection[];
  books: UserBook[];
  engines: UserEngine[];
  /** a file that is not part of any item, and why */
  skipped: string[];
}

async function json(b: Blob | undefined): Promise<unknown> {
  if (!b) return undefined;
  try {
    return JSON.parse(await b.text());
  } catch {
    return undefined;
  }
}

/** a count and its noun, such as "1 game" or "3 games" */
const counted = (n: number, noun: string) => `${count(n)} ${noun}${n === 1 ? '' : 's'}`;

const linesIn = (text: string) => text.split('\n').filter((l) => l.trim() !== '').length;
const gamesIn = (text: string) => (text.match(/^\[Event /gm) ?? []).length;

/** reads a backup's files into the items they make */
export async function contentsOf(files: Files): Promise<Contents> {
  const items = new Map<string, Item>();
  const skipped: string[] = [];
  const index = await json(files.get(`${GAMES}/${GAMES_INDEX}`));
  const collections = Array.isArray(index) ? index.filter(isCollection) : [];
  const list = await json(files.get(`${USER}/${USER_LIST}`));
  const books = Array.isArray(list) ? list.filter(isUserBook) : [];
  const eList = await json(files.get(`${USER_ENGINES}/${USER_ENGINES_LIST}`));
  const engines = Array.isArray(eList) ? eList.filter(isUserEngine) : [];
  const claimed = new Set<string>();

  const settings = files.get(SETTINGS);
  if (settings) {
    const parsed = await json(settings);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      skipped.push(`${SETTINGS}: invalid JSON`);
    } else {
      const s = settingsFileOf(parsed);
      items.set(keyOf('settings', ''), {
        kind: 'settings',
        id: '',
        name: 'Settings',
        files: new Map([[SETTINGS, settings]]),
        settings: s,
        facts: `${counted(s.templates.length, 'template')} · ${counted(s.controls.length, 'control')}`,
      });
    }
  }

  const tournaments = new Map<string, Files>();
  for (const [p, b] of files) {
    const [head, id, file] = p.split('/');
    if (head !== TOURNAMENTS || !id || !file) continue;
    const t = tournaments.get(id) ?? new Map<string, Blob>();
    t.set(p, b);
    tournaments.set(id, t);
  }
  for (const [id, t] of tournaments) {
    const config = t.get(`${TOURNAMENTS}/${id}/config.json`);
    let name = id;
    try {
      const c = configOf(config ? await config.text() : '');
      if (c.id !== id) throw new Error(`its config names it ${c.id}`);
      name = c.name;
    } catch (e) {
      skipped.push(`${TOURNAMENTS}/${id}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const pgn = `${GAMES}/${T_PREFIX}${id}.pgn`;
    const own = files.get(pgn);
    if (own) {
      t.set(pgn, own);
      claimed.add(pgn);
    }
    const collection: Collection | undefined =
      collections.find((c) => c.id === `${T_PREFIX}${id}`) ??
      (own
        ? {
            id: `${T_PREFIX}${id}`,
            name,
            source: 'match',
            games: gamesIn(await own.text()),
            bytes: own.size,
            updated: new Date(own instanceof File ? own.lastModified : Date.now()).toISOString(),
          }
        : undefined);
    const games = linesIn((await t.get(`${TOURNAMENTS}/${id}/games.jsonl`)?.text()) ?? '');
    const end = await json(t.get(`${TOURNAMENTS}/${id}/end.json`));
    const status =
      typeof end === 'object' && end !== null && 'status' in end
        ? end.status === 'done'
          ? 'finished'
          : 'stopped'
        : t.has(`${TOURNAMENTS}/${id}/${QUEUED}`)
          ? 'queued'
          : 'interrupted';
    items.set(keyOf('tournament', id), {
      kind: 'tournament',
      id,
      name,
      files: t,
      collection,
      facts: `${counted(games, 'game')} · ${status}`,
    });
  }

  for (const [p, b] of files) {
    const [head, file] = p.split('/');
    if (head !== GAMES || !file?.endsWith('.pgn') || claimed.has(p)) continue;
    const id = file.slice(0, -'.pgn'.length);
    const entry: Collection = collections.find((c) => c.id === id) ?? {
      id,
      name: id,
      source: 'file',
      games: gamesIn(await b.text()),
      bytes: b.size,
      updated: new Date(b instanceof File ? b.lastModified : Date.now()).toISOString(),
    };
    items.set(keyOf('collection', id), {
      kind: 'collection',
      id,
      name: entry.name,
      files: new Map([[p, b]]),
      collection: entry,
      facts: `${counted(entry.games, 'game')} · ${bytes(b.size)}`,
    });
  }

  for (const [p, b] of files) {
    const [head, file] = p.split('/');
    if (head !== USER || !file || file === USER_LIST) continue;
    const book = books.find((x) => x.id === file);
    if (!book) {
      skipped.push(`${p}: not in ${USER}/${USER_LIST}`);
      continue;
    }
    items.set(keyOf('book', file), {
      kind: 'book',
      id: file,
      name: file,
      files: new Map([[p, b]]),
      book: { ...book, bytes: b.size },
      facts: `${counted(book.positions, 'opening')} · ${bytes(b.size)}`,
    });
  }

  for (const [p, b] of files) {
    const [head, file] = p.split('/');
    if (head !== USER_ENGINES || !file || file === USER_ENGINES_LIST) continue;
    const engine = engines.find((x) => x.wasm === file);
    if (!engine) {
      skipped.push(`${p}: not in ${USER_ENGINES}/${USER_ENGINES_LIST}`);
      continue;
    }
    items.set(keyOf('engine', engine.id), {
      kind: 'engine',
      id: engine.id,
      name: engine.name,
      files: new Map([[p, b]]),
      engine: { ...engine, bytes: b.size },
      facts: `${engine.sha256.slice(0, 8)} · ${bytes(b.size)}`,
    });
  }
  return { items, collections, books, engines, skipped };
}

// ── comparing ───────────────────────────────────────────────────────────────

/**
 * How this browser's copy of an item stands to the other's: the same, ahead or behind (one is
 * the other with more games added), or diverged. The other is new when this browser has none.
 */
export type Relation = 'new' | 'only here' | 'same' | 'ahead' | 'behind' | 'diverged';
type Order = 'same' | 'ahead' | 'behind' | 'diverged';

const CHUNK = 1 << 22;

/** whether two files hold the same bytes over their first `length` */
async function sameStart(a: Blob, b: Blob, length: number): Promise<boolean> {
  for (let at = 0; at < length; at += CHUNK) {
    const end = Math.min(length, at + CHUNK);
    const [x, y] = await Promise.all([
      a.slice(at, end).arrayBuffer(),
      b.slice(at, end).arrayBuffer(),
    ]);
    const u = new Uint8Array(x);
    const v = new Uint8Array(y);
    for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return false;
  }
  return true;
}

/** whether two files hold the same bytes */
export const sameFile = async (a: Blob, b: Blob) =>
  a.size === b.size && (await sameStart(a, b, a.size));

const EMPTY = new Blob([]);

/** two copies of a file; one that grows by appends may be the other with more after it */
async function orderOf(
  here: Blob | undefined,
  there: Blob | undefined,
  appended: boolean,
): Promise<Order> {
  if (!appended && (!here || !there)) return here === there ? 'same' : 'diverged';
  const h = here ?? EMPTY;
  const t = there ?? EMPTY;
  if (h.size === t.size) return (await sameStart(h, t, h.size)) ? 'same' : 'diverged';
  if (!appended) return 'diverged';
  const shorter = Math.min(h.size, t.size);
  if (!(await sameStart(h, t, shorter))) return 'diverged';
  return h.size > t.size ? 'ahead' : 'behind';
}

function combined(orders: Order[]): Order {
  if (orders.includes('diverged')) return 'diverged';
  const ahead = orders.includes('ahead');
  const behind = orders.includes('behind');
  return ahead && behind ? 'diverged' : ahead ? 'ahead' : behind ? 'behind' : 'same';
}

const endAt = async (b: Blob | undefined) => {
  const x = await json(b);
  return typeof x === 'object' && x !== null && 'at' in x && typeof x.at === 'string' ? x.at : '';
};

async function relationOf(here: Item, there: Item): Promise<Order> {
  if (here.kind === 'settings')
    return JSON.stringify(here.settings) === JSON.stringify(there.settings) ? 'same' : 'diverged';
  const paths = new Set([...here.files.keys(), ...there.files.keys()]);
  const orders: Order[] = [];
  let end: string | undefined;
  let queuedPath: string | undefined;
  for (const p of paths) {
    if (p.endsWith('/end.json')) {
      end = p;
      continue;
    }
    if (p.endsWith(`/${QUEUED}`)) {
      queuedPath = p;
      continue;
    }
    const appended = here.kind !== 'book' && here.kind !== 'engine' && /\.(jsonl|pgn)$/.test(p);
    orders.push(await orderOf(here.files.get(p), there.files.get(p), appended));
  }
  const order = combined(orders);
  if (queuedPath !== undefined) {
    const hq = here.files.get(queuedPath);
    const tq = there.files.get(queuedPath);
    if (hq && tq) {
      if (order === 'same' && !(await sameFile(hq, tq))) return 'diverged';
    } else if (hq && !tq) {
      // here is still queued while there started playing (or ended)
      if (order === 'behind' || (order === 'same' && end !== undefined && there.files.has(end)))
        return 'behind';
      return 'diverged';
    } else if (!hq && tq) {
      // there is still queued while here started playing (or ended)
      if (order === 'ahead' || (order === 'same' && end !== undefined && here.files.has(end)))
        return 'ahead';
      return 'diverged';
    }
  }
  if (order !== 'same' || end === undefined) return order;
  // the same games: the copy that stopped later is ahead
  const [h, t] = [here.files.get(end), there.files.get(end)];
  if (h && t && (await sameFile(h, t))) return 'same';
  const [ha, ta] = [await endAt(h), await endAt(t)];
  return ha && ta && ha !== ta ? (ha > ta ? 'ahead' : 'behind') : 'diverged';
}

/** one item of either side, how the two copies stand, and what the user may do with it */
export interface Row {
  key: string;
  kind: Kind;
  name: string;
  here?: Item;
  there?: Item;
  relation: Relation;
}

/** each item of either side, and how its two copies stand */
export async function rowsOf(here: Contents, there: Contents): Promise<Row[]> {
  // an item new to one side may hold a file that another item holds on this side: a deleted
  // tournament's games stay as a collection, under the tournament's file name. The two are one
  // row, so that taking one never writes over the other unasked.
  const owner = new Map<string, string>();
  for (const [k, i] of here.items) for (const p of i.files.keys()) owner.set(p, k);
  const paired = new Map<string, string>();
  for (const [k, t] of there.items) {
    if (here.items.has(k)) continue;
    const o = [...t.files.keys()].map((p) => owner.get(p)).find((x) => x !== undefined);
    if (o !== undefined && !there.items.has(o)) paired.set(k, o);
  }
  const taken = new Set(paired.values());

  const out: Row[] = [];
  for (const key of new Set([...here.items.keys(), ...there.items.keys()])) {
    if (taken.has(key)) continue;
    const pair = paired.get(key);
    const h = here.items.get(pair ?? key);
    const t = there.items.get(key);
    const any = t ?? h;
    if (!any) continue;
    const relation: Relation = !h ? 'new' : !t ? 'only here' : await relationOf(h, t);
    out.push({ key, kind: any.kind, name: any.name, here: h, there: t, relation });
  }
  const order: Kind[] = ['settings', 'tournament', 'collection', 'book', 'engine'];
  return out.toSorted((a, b) =>
    a.kind === b.kind
      ? a.name.localeCompare(b.name)
      : order.indexOf(a.kind) - order.indexOf(b.kind),
  );
}

// ── merging ─────────────────────────────────────────────────────────────────

/**
 * What to do with the other side's copy: add a new item or skip it; keep this browser's, replace
 * it, or keep both, the other's under a new id. Both settings are one set, this one's values
 * with the other's time controls and templates added.
 */
export type Choice = 'add' | 'skip' | 'keep' | 'replace' | 'both';

/** the choices a row offers; `busy` when its tournament runs, so it cannot be replaced */
export function choicesOf(row: Row, busy: boolean): Choice[] {
  if (row.relation === 'new') return ['add', 'skip'];
  if (row.relation === 'same' || row.relation === 'only here') return [];
  return busy ? ['keep', 'both'] : ['keep', 'replace', 'both'];
}

/** the choice that loses nothing: the longer copy, or both when they diverged */
export function choiceOf(row: Row, busy: boolean): Choice | null {
  switch (row.relation) {
    case 'new':
      return 'add';
    case 'ahead':
      return 'keep';
    case 'behind':
      return busy ? 'keep' : 'replace';
    case 'diverged':
      return 'both';
    case 'same':
    case 'only here':
      return null;
  }
}

/** a change to a store of the layout: a file written, or a file or folder deleted */
export type Op = { write: string; data: Blob } | { remove: string };

/** a name not yet taken: the name, then with (2), (3) and on (before its extension for files) */
function freeName(name: string, taken: (n: string) => boolean, hasExtension = false): string {
  const dot = hasExtension ? name.lastIndexOf('.') : -1;
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  let out = name;
  for (let n = 2; taken(out); n++) out = `${stem} (${n})${ext}`;
  return out;
}

/** the other's copy of an item under a new id, so both are kept */
async function renamed(
  item: Item,
  usedNames: Set<string>,
  usedBooks: Set<string>,
  usedEngines: Set<string>,
  fresh: (name: string) => string,
): Promise<Item> {
  const name = freeName(item.name, (n) => usedNames.has(n), false);
  usedNames.add(name);
  if (item.kind === 'tournament') {
    const id = fresh(name);
    const files: Files = new Map();
    for (const [p, b] of item.files) {
      if (p.endsWith('/config.json')) {
        const config: unknown = JSON.parse(await b.text());
        files.set(
          `${TOURNAMENTS}/${id}/config.json`,
          new Blob([JSON.stringify(Object.assign({}, config, { id, name }), null, 1)]),
        );
      } else if (p.startsWith(`${GAMES}/`)) files.set(`${GAMES}/${T_PREFIX}${id}.pgn`, b);
      else files.set(`${TOURNAMENTS}/${id}/${p.split('/')[2] ?? ''}`, b);
    }
    const collection = item.collection && { ...item.collection, id: `${T_PREFIX}${id}`, name };
    return { ...item, id, name, files, collection };
  }
  if (item.kind === 'collection') {
    const id = fresh(name);
    const [[, b] = ['', EMPTY]] = item.files;
    const collection = item.collection && { ...item.collection, id, name };
    return { ...item, id, name, files: new Map([[`${GAMES}/${id}.pgn`, b]]), collection };
  }
  if (item.kind === 'book') {
    const id = freeName(item.id, (n) => usedBooks.has(n), true);
    usedBooks.add(id);
    const [[, b] = ['', EMPTY]] = item.files;
    const book = item.book && { ...item.book, id };
    return { ...item, id, name: id, files: new Map([[`${USER}/${id}`, b]]), book };
  }
  if (item.kind === 'engine') {
    const id = freeName(item.id, (n) => usedEngines.has(n), false);
    usedEngines.add(id);
    const wasm = `${id}.wasm`;
    const [[, b] = ['', EMPTY]] = item.files;
    const engine = item.engine && { ...item.engine, id, wasm };
    return {
      ...item,
      id,
      name: engine?.name ?? id,
      files: new Map([[`${USER_ENGINES}/${wasm}`, b]]),
      engine,
    };
  }
  return item;
}

/** the folder or files that hold an item, to delete before its replacement is written */
const removalsOf = (item: Item): Op[] =>
  item.kind === 'tournament'
    ? [
        { remove: `${TOURNAMENTS}/${item.id}` },
        ...[...item.files.keys()]
          .filter((p) => p.startsWith(`${GAMES}/`))
          .map((p) => ({ remove: p })),
      ]
    : [...item.files.keys()].map((p) => ({ remove: p }));

/** index entries to add or replace, by id, and ids to drop */
export interface IndexChange<T> {
  put: T[];
  drop: string[];
}

/** what a merge does to this browser: files, the indexes' entries, and settings to take */
export interface Merge {
  /** files deleted, then written */
  ops: Op[];
  collections: IndexChange<Collection>;
  books: IndexChange<UserBook>;
  engines: IndexChange<UserEngine>;
  settings: SettingsFile | null;
}

/** the changes that carry out the choices on this browser's store */
export async function mergeOf(
  rows: readonly Row[],
  choices: ReadonlyMap<string, Choice>,
  here: Contents,
  there: Contents,
  fresh: (name: string) => string = (name) => makeId(name),
): Promise<Merge> {
  // Additive writes run first so a quota error on a new item never deletes an existing one;
  // each replacement deletes its own old files right before writing its new ones.
  const additions: Op[] = [];
  const replacements: Op[] = [];
  const usedNames = new Set([...here.items.values(), ...there.items.values()].map((i) => i.name));
  const usedBooks = new Set([...here.books, ...there.books].map((b) => b.id));
  const usedEngines = new Set([...here.engines, ...there.engines].map((e) => e.id));
  const out: Merge = {
    ops: [],
    collections: { put: [], drop: [] },
    books: { put: [], drop: [] },
    engines: { put: [], drop: [] },
    settings: null,
  };
  const take = (item: Item, target: Op[]) => {
    for (const [p, data] of item.files) target.push({ write: p, data });
    if (item.collection) out.collections.put.push(item.collection);
    if (item.book) out.books.put.push(item.book);
    if (item.engine) out.engines.put.push(item.engine);
  };
  for (const row of rows) {
    const choice = choices.get(row.key);
    const { here: h, there: t } = row;
    if (!t || !choice || choice === 'keep' || choice === 'skip') continue;
    if (t.kind === 'settings') {
      if (choice === 'add' || choice === 'replace') out.settings = t.settings ?? null;
      else if (h?.settings && t.settings) out.settings = unionOf(h.settings, t.settings);
      continue;
    }
    if (choice === 'both')
      take(await renamed(t, usedNames, usedBooks, usedEngines, fresh), additions);
    else if (h) {
      replacements.push(...removalsOf(h));
      if (h.collection) out.collections.drop.push(h.collection.id);
      if (h.book) out.books.drop.push(h.book.id);
      if (h.engine) out.engines.drop.push(h.engine.id);
      take(t, replacements);
    } else {
      take(t, additions);
    }
  }
  out.ops = [...additions, ...replacements];
  return out;
}

/**
 * The changes that make a copy of the layout hold just what `from` holds: each file it lacks or
 * holds otherwise written, each it holds that `from` does not deleted, a tournament's folder
 * whole. `books` and `engines` say whether the user's books and in-browser engines are part of it.
 */
export async function syncOf(
  from: Files,
  to: Files,
  books: boolean,
  engines = false,
): Promise<Op[]> {
  const ops: Op[] = [];
  for (const [p, b] of from) {
    if (!inLayout(p, books, engines)) continue;
    const there = to.get(p);
    if (!there || !(await sameFile(b, there))) ops.push({ write: p, data: b });
  }
  const kept = new Set([...from.keys()].map((p) => p.split('/').slice(0, 2).join('/')));
  const gone = new Set<string>();
  for (const p of to.keys()) {
    if (!inLayout(p, books, engines) || from.has(p)) continue;
    const parts = p.split('/');
    const folder = parts.slice(0, 2).join('/');
    if (parts[0] === TOURNAMENTS && !kept.has(folder)) gone.add(folder);
    else ops.push({ remove: p });
  }
  return [...ops, ...[...gone].map((remove) => ({ remove }))];
}
