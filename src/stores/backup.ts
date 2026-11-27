import { defineStore } from 'pinia';
import { computed, reactive, ref, watch } from 'vue';
import {
  choiceOf,
  choicesOf,
  contentsOf,
  inLayout,
  keyOf,
  layoutOf,
  mergeOf,
  rowsOf,
  SETTINGS,
  syncOf,
  TOURNAMENTS,
  type Choice,
  type Contents,
  type Files,
  type Op,
  type Row,
} from '../storage/backup.ts';
import { applyTo, filesIn } from '../storage/folder.ts';
import { deleteValue, getValue, setValue } from '../storage/idb.ts';
import {
  exclusive,
  removeFile,
  removeFolder,
  watch as watchOpfs,
  writeStream,
} from '../storage/opfs.ts';
import { unzipAll, zipStored } from '../storage/zip.ts';
import { useBooks, USER, USER_LIST } from './books.ts';
import { useEngines, USER_ENGINES, USER_ENGINES_LIST } from './engines.ts';
import { useGames } from './games.ts';
import { settingsFileOf, useSettings } from './settings.ts';
import { useTournaments } from './tournaments.ts';

/**
 * The mirror folder's state:
 * - `none`: no folder is picked; `unsupported`: the browser cannot write to one;
 * - `allow`: the browser asks the user's leave again, after a reload;
 * - `checking`: it is compared with this browser's data, or copied to;
 * - `review`: it differs in a way only the user can settle;
 * - `on`: each change is copied to it; `failed`: a copy failed.
 */
export type MirrorState =
  | 'none'
  | 'unsupported'
  | 'allow'
  | 'checking'
  | 'review'
  | 'on'
  | 'failed';

export interface Mirror {
  state: MirrorState;
  /** the folder's name, as the browser shows it */
  folder: string;
  /** ms since the epoch of the last copy to it */
  at: number | null;
  /** why the last copy failed */
  error: string;
}

/** a merge waiting on the user: an archive's or the mirror folder's items beside this browser's */
export interface Review {
  source: 'archive' | 'folder';
  /** the archive's file name, or the folder's */
  name: string;
  /** the items that differ, each with its choices */
  rows: Row[];
  choices: Map<string, Choice>;
  /** tournaments that run in a tab, which a merge may not replace */
  busy: Set<string>;
  here: Contents;
  there: Contents;
  /** what the archive held that the app cannot use */
  skipped: string[];
  /** how many items are the same, have more here, or are only here */
  settled: number;
}

const HANDLE_KEY = 'mirror-folder';
const EXPORTED_KEY = 'exported';
/** the Web Lock a tab holds while it writes the mirror folder */
const MIRROR_LOCK = 'ratchet-ui:mirror';
/** how long changes gather before they are copied to the mirror folder */
const FLUSH_MS = 3000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The app's data kept safe beyond this browser: the browser asked to keep its storage, an export
 * to one zip archive and an import from one, and a mirror folder that follows each change. The
 * export and the folder hold OPFS's own layout, so one merge reads both back.
 */
export const useBackup = defineStore('backup', () => {
  const settings = useSettings();
  const games = useGames();
  const books = useBooks();
  const engines = useEngines();
  const tournaments = useTournaments();

  // ── persistent storage ────────────────────────────────────────────────────

  const storageApi = (): StorageManager | undefined => (navigator as Partial<Navigator>).storage;
  const locksApi = (): LockManager | undefined => (navigator as Partial<Navigator>).locks;
  const withMirrorLock = <T>(job: () => Promise<T>): Promise<T> => {
    const lm = locksApi();
    return lm ? lm.request(MIRROR_LOCK, job) : job();
  };

  /** whether the browser keeps this site's storage under pressure; null before it is known */
  const persisted = ref<boolean | null>(null);
  const usage = ref<{ used: number; quota: number } | null>(null);

  async function readStorage(): Promise<void> {
    const api = storageApi();
    if (!api) {
      usage.value = null;
      persisted.value = null;
      return;
    }
    const est = await api.estimate().catch(() => undefined);
    usage.value =
      est?.usage !== undefined && est.quota !== undefined
        ? { used: est.usage, quota: est.quota }
        : null;
    persisted.value = await api.persisted().catch(() => null);
  }

  async function askPersist(): Promise<void> {
    const api = storageApi();
    if (!api) return;
    persisted.value = await api.persist().catch(() => persisted.value);
  }

  // ── this browser's files ──────────────────────────────────────────────────

  const isStreamedPath = (p: string): boolean =>
    (p.startsWith(`${USER}/`) && p !== `${USER}/${USER_LIST}`) ||
    (p.startsWith(`${USER_ENGINES}/`) && p !== `${USER_ENGINES}/${USER_ENGINES_LIST}`);

  /**
   * This browser's data as a backup holds it, as it stood at one moment: the files are read in
   * one job of the write queue, into memory, so a later write cannot change them. A user's book or
   * engine binary is never appended, so it is streamed from OPFS when it is used.
   */
  async function hereFiles(withBooks: boolean, withEngines: boolean): Promise<Files> {
    const api = storageApi();
    if (!api || typeof api.getDirectory !== 'function')
      throw new Error('OPFS storage requires a secure context (HTTPS or localhost)');
    const root = await api.getDirectory();
    const out = await exclusive(async () => {
      const files = await filesIn(root, withBooks, withEngines);
      for (const [p, f] of files) {
        if (!isStreamedPath(p)) files.set(p, new Blob([await f.arrayBuffer()]));
      }
      return files;
    });
    out.set(SETTINGS, new Blob([JSON.stringify(settings.file(), null, 1)]));
    return out;
  }

  /** carries out changes on this browser's files, through the write queue that the mirror follows */
  async function applyHere(ops: readonly Op[]): Promise<void> {
    for (const op of ops) {
      if ('write' in op) {
        const parts = op.write.split('/');
        const name = parts.pop() ?? '';
        await writeStream(parts, name, op.data.stream());
      } else {
        const parts = op.remove.split('/');
        const name = parts.pop() ?? '';
        if (parts.length === 1 && parts[0] === TOURNAMENTS) await removeFolder(parts, name);
        else await removeFile(parts, name);
      }
    }
  }

  // ── export and import ─────────────────────────────────────────────────────

  /** ms since the epoch of the last export, from this browser; null when none was made */
  const exportedAt = ref<number | null>(null);
  /** what the backup is doing, such as writing an archive; empty when idle */
  const busy = ref('');
  /** the last export's, import's or mirror's outcome, or its failure */
  const note = ref('');
  const failed = ref(false);
  const review = ref<Review | null>(null);

  const done = (text: string) => {
    note.value = text;
    failed.value = false;
  };
  const fail = (text: string) => {
    note.value = text;
    failed.value = true;
  };

  /** downloads this browser's data as one zip archive */
  async function exportAll(): Promise<void> {
    if (busy.value) return;
    busy.value = 'Writing archive…';
    try {
      const files = await hereFiles(settings.backupBooks, settings.backupEngines);
      const now = Date.now();
      const zip = await zipStored(
        [...files].map(([name, data]) => ({
          name,
          data,
          modified: data instanceof File ? data.lastModified : now,
        })),
      );
      const url = URL.createObjectURL(zip);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ratchet-ui-${new Date(now).toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      exportedAt.value = now;
      await setValue(EXPORTED_KEY, now);
      done(`Exported ${files.size} files.`);
    } catch (e) {
      fail(`Export failed: ${message(e)}`);
    } finally {
      busy.value = '';
    }
  }

  /** the tournaments a tab of this browser plays, by their Web Locks */
  async function playing(): Promise<Set<string>> {
    const lm = locksApi();
    if (!lm) return new Set();
    const held = (await lm.query()).held ?? [];
    return new Set(held.flatMap((l) => (l.name ? (tournaments.idOfLock(l.name) ?? []) : [])));
  }

  /** compares a backup's files with this browser's; a review when they differ in what matters */
  async function reviewOf(
    source: Review['source'],
    name: string,
    there: Contents,
    before?: Review,
  ): Promise<Review> {
    const here = await contentsOf(await hereFiles(true, true));
    const all = await rowsOf(here, there);
    const busySet = await playing();
    // a copy here with more games loses nothing by staying, so it asks nothing
    const rows = all.filter((r) => r.relation !== 'ahead' && choicesOf(r, false).length > 0);
    const choices = new Map<string, Choice>();
    // settings never changed here, or in a browser that holds nothing else, are restored whole
    const untouched =
      [...here.items.values()].every((i) => i.kind === 'settings') ||
      JSON.stringify(here.items.get(keyOf('settings', ''))?.settings) ===
        JSON.stringify(settingsFileOf({}));
    for (const r of rows) {
      const kept = before?.rows.find((b) => b.key === r.key && b.relation === r.relation);
      const c = kept
        ? (before?.choices.get(r.key) ?? null)
        : r.kind === 'settings' && untouched
          ? 'replace'
          : choiceOf(r, r.here?.kind === 'tournament' && busySet.has(r.here.id));
      if (c) choices.set(r.key, c);
    }
    return {
      source,
      name,
      rows,
      choices,
      busy: busySet,
      here,
      there,
      skipped: there.skipped,
      settled: all.length - rows.length,
    };
  }

  /** reads an archive and lays its items beside this browser's, for the user to choose */
  async function importArchive(file: File): Promise<void> {
    if (busy.value) return;
    busy.value = 'Reading archive…';
    review.value = null;
    note.value = '';
    try {
      const files = layoutOf(await unzipAll(file));
      if (files.size === 0) throw new Error('archive contains no app files');
      const r = await reviewOf('archive', file.name, await contentsOf(files));
      if (r.rows.length === 0)
        done(
          `Nothing new in ${file.name}: already up to date${r.skipped.length > 0 ? ` (${r.skipped.length} unsupported files skipped)` : ''}.`,
        );
      else review.value = r;
    } catch (e) {
      fail(`Could not read ${file.name}: ${message(e)}`);
    } finally {
      busy.value = '';
    }
  }

  /** whether two reviews ask the same: the same items, their copies standing the same */
  const sameAsk = (a: Review, b: Review) =>
    a.rows.length === b.rows.length &&
    a.rows.every((r) => b.rows.some((x) => x.key === r.key && x.relation === r.relation));

  /**
   * Carries out the review's choices, then reloads what the pages show. This browser is read
   * again first: when what the review asks has changed since, it asks again instead.
   */
  async function applyReview(): Promise<void> {
    const shown = review.value;
    if (!shown || busy.value) return;
    busy.value = 'Merging…';
    merging = true;
    clearTimeout(timer);
    timer = undefined;
    const held: string[] = [];
    let shouldSync = false;
    try {
      const r = await reviewOf(shown.source, shown.name, shown.there, shown);
      if (!sameAsk(r, shown)) {
        if (r.rows.length === 0) {
          review.value = null;
          if (r.source === 'folder') pending = null;
          done('Browser storage is already up to date.');
          shouldSync = r.source === 'folder' || mirror.state === 'on';
          return;
        }
        review.value = r;
        fail('Browser storage changed while review was open; check choices again.');
        return;
      }
      for (const row of r.rows) {
        if (row.here?.kind !== 'tournament' || r.choices.get(row.key) !== 'replace') continue;
        if (!(await tournaments.lock(row.here.id)))
          throw new Error(`${row.name} is running in another tab`);
        held.push(row.here.id);
      }
      const m = await mergeOf(r.rows, r.choices, r.here, r.there);
      await applyHere(m.ops);
      if (m.collections.put.length + m.collections.drop.length > 0)
        await games.mergeIndex(m.collections.drop, m.collections.put);
      if (m.books.put.length + m.books.drop.length > 0)
        await books.mergeList(m.books.drop, m.books.put);
      if (m.engines.put.length + m.engines.drop.length > 0)
        await engines.mergeList(m.engines.drop, m.engines.put);
      if (m.settings) settings.restore(m.settings);
      const taken = [...r.choices.values()].filter((c) => c !== 'keep' && c !== 'skip').length;
      review.value = null;
      if (r.source === 'folder') pending = null;
      done(`Merged ${r.name}: ${taken} of ${r.rows.length} items applied.`);
      shouldSync = r.source === 'folder' || mirror.state === 'on';
    } catch (e) {
      fail(`Merge failed: ${message(e)}`);
    } finally {
      merging = false;
      await Promise.all(held.map((id) => tournaments.unlock(id)));
      await Promise.all([games.load(), books.load(), engines.load(), tournaments.load()]).catch(
        () => undefined,
      );
      busy.value = '';
    }
    if (shouldSync) await sync();
  }

  function cancelReview(): void {
    if (review.value?.source === 'folder') mirror.state = 'review';
    review.value = null;
  }

  // ── the mirror folder ─────────────────────────────────────────────────────

  const mirror = reactive<Mirror>({ state: 'none', folder: '', at: null, error: '' });
  let handle: FileSystemDirectoryHandle | null = null;
  /** monotonic generation incremented whenever the mirror folder stops or changes */
  let mirrorGen = 0;
  /** suppresses incremental mirror flushes while applyReview writes a batch */
  let merging = false;
  /** the files and folders changed since the last copy, by path */
  const dirty = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** the folder review that waits on the user, kept while the user looks elsewhere */
  let pending: Review | null = null;

  const supported = () => typeof window.showDirectoryPicker === 'function';
  /** tells this browser's other tabs that the folder was picked or stopped */
  const tabs = typeof BroadcastChannel === 'function' ? new BroadcastChannel(MIRROR_LOCK) : null;

  const isCurrentMirror = (gen: number, h: FileSystemDirectoryHandle) =>
    gen === mirrorGen && handle === h;

  function failMirror(e: unknown): void {
    if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError'))
      mirror.state = 'allow';
    else {
      mirror.state = 'failed';
      mirror.error = message(e);
    }
  }

  /** reads the mirror folder, compares it, then copies to it or asks the user */
  async function check(): Promise<void> {
    const h = handle;
    if (!h) return;
    const gen = mirrorGen;
    mirror.state = 'checking';
    mirror.error = '';
    try {
      await withMirrorLock(async () => {
        if (!isCurrentMirror(gen, h)) return;
        const r = await reviewOf(
          'folder',
          h.name,
          await contentsOf(await filesIn(h, settings.backupBooks, settings.backupEngines)),
        );
        if (!isCurrentMirror(gen, h)) return;
        // the folder holds nothing this browser lacks: it only needs this browser's changes
        if (r.rows.length === 0) await push(h, gen);
        else {
          pending = r;
          mirror.state = 'review';
        }
      });
    } catch (e) {
      if (isCurrentMirror(gen, h)) failMirror(e);
    }
  }

  /** makes the folder hold just this browser's data; under the mirror's lock */
  async function push(h: FileSystemDirectoryHandle, gen: number): Promise<void> {
    if (!isCurrentMirror(gen, h)) return;
    dirty.clear();
    const withBooks = settings.backupBooks;
    const withEngines = settings.backupEngines;
    const ops = await syncOf(
      await hereFiles(withBooks, withEngines),
      await filesIn(h, withBooks, withEngines),
      withBooks,
      withEngines,
    );
    if (!isCurrentMirror(gen, h)) return;
    await applyTo(h, ops);
    if (!isCurrentMirror(gen, h)) return;
    mirror.state = 'on';
    mirror.at = Date.now();
    // changes made while it was copied
    if (dirty.size > 0 && !merging) timer ??= setTimeout(() => void flush(), FLUSH_MS);
  }

  /** copies this browser's data to the folder after a merge from it */
  async function sync(): Promise<void> {
    const h = handle;
    if (!h) return;
    const gen = mirrorGen;
    mirror.state = 'checking';
    try {
      await withMirrorLock(() => push(h, gen));
    } catch (e) {
      if (isCurrentMirror(gen, h)) failMirror(e);
    }
  }

  /** shows the folder's review, which waits since startup */
  function openFolderReview(): void {
    if (pending) review.value = pending;
  }

  /** copies the changed files to the folder; a file gone from OPFS goes from the folder too */
  async function flush(): Promise<void> {
    timer = undefined;
    const h = handle;
    if (!h || merging || mirror.state !== 'on' || dirty.size === 0) return;
    const gen = mirrorGen;
    const paths = [...dirty];
    dirty.clear();
    try {
      await withMirrorLock(async () => {
        if (!isCurrentMirror(gen, h)) return;
        const api = storageApi();
        if (!api || typeof api.getDirectory !== 'function') return;
        const root = await api.getDirectory();
        const ops = await exclusive(async () => {
          const out: Op[] = [];
          for (const p of paths) {
            if (p === SETTINGS) {
              out.push({ write: p, data: new Blob([JSON.stringify(settings.file(), null, 1)]) });
              continue;
            }
            const parts = p.split('/');
            const name = parts.pop() ?? '';
            let d = root;
            try {
              for (const x of parts) d = await d.getDirectoryHandle(x);
              if (inLayout(p, settings.backupBooks, settings.backupEngines)) {
                const f = await (await d.getFileHandle(name)).getFile();
                // a user's book or engine binary may be large: it is read as it is copied
                out.push({
                  write: p,
                  data: isStreamedPath(p) ? f : new Blob([await f.arrayBuffer()]),
                });
              } else await d.getDirectoryHandle(name);
            } catch (e) {
              if (e instanceof DOMException && e.name === 'NotFoundError') out.push({ remove: p });
              else throw e;
            }
          }
          return out;
        });
        if (!isCurrentMirror(gen, h)) return;
        await applyTo(h, ops);
      });
      if (isCurrentMirror(gen, h)) mirror.at = Date.now();
    } catch (e) {
      if (!isCurrentMirror(gen, h)) return;
      for (const p of paths) dirty.add(p);
      failMirror(e);
    }
  }

  function changed(path: string): void {
    const parts = path.split('/');
    const followed =
      inLayout(path, settings.backupBooks, settings.backupEngines) ||
      (parts.length === 2 && parts[0] === TOURNAMENTS) ||
      path === SETTINGS;
    if (!followed) return;
    dirty.add(path);
    if (mirror.state === 'on' && !merging) timer ??= setTimeout(() => void flush(), FLUSH_MS);
  }

  /** lets the user pick the mirror folder, then compares it with this browser's data */
  async function chooseFolder(): Promise<void> {
    const pick = window.showDirectoryPicker;
    if (!pick) return;
    try {
      const h = await pick({ id: 'ratchet-ui-mirror', mode: 'readwrite' });
      mirrorGen++;
      clearTimeout(timer);
      timer = undefined;
      dirty.clear();
      pending = null;
      handle = h;
      mirror.folder = h.name;
      await setValue(HANDLE_KEY, h);
      tabs?.postMessage('folder');
      await check();
    } catch (e) {
      // the user closed the picker
      if (!(e instanceof DOMException && e.name === 'AbortError')) failMirror(e);
    }
  }

  /** asks the browser for the folder again; a click must call it */
  async function allowFolder(): Promise<void> {
    const h = handle;
    if (!h) return;
    const gen = mirrorGen;
    try {
      if (
        (await h.requestPermission({ mode: 'readwrite' })) === 'granted' &&
        isCurrentMirror(gen, h)
      )
        await check();
    } catch (e) {
      if (isCurrentMirror(gen, h)) failMirror(e);
    }
  }

  async function stopMirror(): Promise<void> {
    mirrorGen++;
    handle = null;
    pending = null;
    if (review.value?.source === 'folder') review.value = null;
    clearTimeout(timer);
    timer = undefined;
    dirty.clear();
    mirror.state = 'none';
    mirror.folder = '';
    mirror.at = null;
    mirror.error = '';
    await deleteValue(HANDLE_KEY);
    tabs?.postMessage('folder');
  }

  /** takes up the folder kept between visits, or none, as another tab just set it */
  async function connect(): Promise<void> {
    const gen = ++mirrorGen;
    const h = await getValue(HANDLE_KEY).catch(() => undefined);
    if (gen !== mirrorGen) return;
    pending = null;
    if (review.value?.source === 'folder') review.value = null;
    if (!(h instanceof FileSystemDirectoryHandle)) {
      handle = null;
      Object.assign(mirror, { state: 'none', folder: '', at: null, error: '' });
      return;
    }
    handle = h;
    mirror.folder = h.name;
    if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') {
      if (isCurrentMirror(gen, h)) await check();
    } else if (isCurrentMirror(gen, h)) {
      mirror.state = 'allow';
    }
  }

  /** a change to the books or engines backup setting changes what the folder holds */
  watch(
    () => [settings.backupBooks, settings.backupEngines] as const,
    ([b, e], [pb, pe]) => {
      if (mirror.state !== 'on') return;
      // Turning either on may expose unseen files in the mirror folder; review before pushing
      if ((b && !pb) || (e && !pe)) void check();
      else void sync();
    },
  );
  watch(
    () => JSON.stringify(settings.file()),
    () => changed(SETTINGS),
  );

  /** reads what the app kept between visits, and starts the mirror where the browser allows it */
  async function start(): Promise<void> {
    watchOpfs(changed);
    // the first write asks the browser to keep the storage; its answer shows after
    const unwatch = watchOpfs(() => {
      unwatch();
      setTimeout(() => void readStorage(), 1000);
    });
    addEventListener('pagehide', () => void flush());
    await readStorage();
    const at = await getValue(EXPORTED_KEY).catch(() => undefined);
    exportedAt.value = typeof at === 'number' ? at : null;
    if (!supported()) {
      mirror.state = 'unsupported';
      return;
    }
    if (tabs) tabs.onmessage = () => void connect();
    await connect();
  }

  /** whether the mirror needs the user: leave to write, a review, or a failure */
  const attention = computed(
    () => mirror.state === 'allow' || mirror.state === 'review' || mirror.state === 'failed',
  );

  return {
    persisted,
    usage,
    readStorage,
    askPersist,
    exportedAt,
    busy,
    note,
    failed,
    review,
    exportAll,
    importArchive,
    applyReview,
    cancelReview,
    mirror,
    attention,
    supported,
    chooseFolder,
    allowFolder,
    stopMirror,
    openFolderReview,
    check,
    start,
  };
});
