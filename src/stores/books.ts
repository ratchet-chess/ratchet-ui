import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import listed from '../../books.json';
import { parseBooks, type BookEntry } from '../books/list.ts';
import {
  bookFormat,
  checkBook,
  indexBook,
  openingAt as openingAt_,
  type Opening,
} from '../books/opening.ts';
import { readText, removeFile, writeStream, writeText } from '../storage/opfs.ts';
import { unzipFirst } from '../storage/zip.ts';

/** a pulled book, as this browser keeps it */
export interface Pulled {
  bytes: number;
  /** ms since the epoch */
  modified: number;
}

/** a book the user added from a file of theirs; this browser's copy is all the app keeps */
export interface UserBook {
  /** the book's file name, which names it in Play and Tourneys */
  id: string;
  format: 'epd' | 'pgn';
  positions: number;
  bytes: number;
  /** ms since the epoch */
  added: number;
}

/** a book that Play and Tourneys can draw openings from */
export interface UsableBook {
  id: string;
  positions: number;
}

/** an add in progress: the file, and the openings checked of those found */
export interface Adding {
  name: string;
  checked: number;
  /** 0 while the file is copied in */
  total: number;
}

/** the browser's storage: what this site uses of what it may use, in bytes */
export interface Storage {
  usage: number;
  quota: number;
}

/** the OPFS folder of pulled books, which a pull makes again, so no backup holds them */
const PULLED = 'books';
/** the OPFS folder of the user's books; it also holds their list */
export const USER = 'user-books';
export const USER_LIST = 'list.json';
/** an index of a book holds 32-bit offsets */
const MAX_BYTES = 2 ** 32;

const message = (e: unknown) =>
  e instanceof DOMException && e.name === 'QuotaExceededError'
    ? "the browser's storage quota is full"
    : e instanceof Error
      ? e.message
      : String(e);

export function isUserBook(b: unknown): b is UserBook {
  return (
    typeof b === 'object' &&
    b !== null &&
    'id' in b &&
    'format' in b &&
    'positions' in b &&
    'bytes' in b &&
    'added' in b &&
    typeof b.id === 'string' &&
    (b.format === 'epd' || b.format === 'pgn') &&
    typeof b.positions === 'number' &&
    typeof b.bytes === 'number' &&
    typeof b.added === 'number'
  );
}

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The opening books: the committed list (books.json), the books this browser has pulled into its
 * private file system (OPFS), and the user's books. A pull downloads the book's zip archive from
 * its repo at the pinned commit, checks its sha256, and unzips it into OPFS as it streams, so a
 * large book is not held in memory. A user's book is copied into OPFS from a file of theirs, and
 * kept only once every opening in it reads.
 */
export const useBooks = defineStore('books', () => {
  const list: BookEntry[] = parseBooks(listed);
  const pulled = ref(new Map<string, Pulled>());
  /** a pull's progress, by book: bytes downloaded of the archive's size */
  const progress = reactive(new Map<string, number>());
  const user = ref<UserBook[]>([]);
  const adding = ref<Adding | null>(null);
  const storage = ref<Storage | null>(null);
  const error = ref('');
  const loaded = ref(false);
  /** each book's index of opening starts, built on first use and kept for the session */
  const indexes = new Map<string, Promise<Uint32Array>>();
  let dir: FileSystemDirectoryHandle | undefined;
  let userDir: FileSystemDirectoryHandle | undefined;

  async function folder(): Promise<FileSystemDirectoryHandle> {
    dir ??= await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle(PULLED, { create: true });
    return dir;
  }

  async function userFolder(): Promise<FileSystemDirectoryHandle> {
    userDir ??= await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle(USER, { create: true });
    return userDir;
  }

  const usable = computed<UsableBook[]>(() => [
    ...list.filter((b) => pulled.value.has(b.id)),
    ...user.value,
  ]);

  async function estimate(): Promise<void> {
    const e = await navigator.storage.estimate().catch(() => undefined);
    storage.value =
      e?.usage !== undefined && e.quota !== undefined ? { usage: e.usage, quota: e.quota } : null;
  }

  /** the size of a file in a folder, or null when it is not there */
  const sizeIn = (d: FileSystemDirectoryHandle, name: string) =>
    d
      .getFileHandle(name)
      .then((h) => h.getFile())
      .then((f) => f.size)
      .catch(() => null);

  /** reads which books are in OPFS */
  async function load(): Promise<void> {
    try {
      const found = new Map<string, Pulled>();
      const d = await folder();
      for (const b of list) {
        const file = await d
          .getFileHandle(b.id)
          .then((h) => h.getFile())
          .catch(() => null);
        if (file && file.size === b.bytes)
          found.set(b.id, { bytes: file.size, modified: file.lastModified });
      }
      pulled.value = found;

      const saved: unknown = JSON.parse((await readText([USER], USER_LIST)) ?? '[]');
      const u = await userFolder();
      const kept: UserBook[] = [];
      for (const b of Array.isArray(saved) ? saved.filter(isUserBook) : [])
        if ((await sizeIn(u, b.id)) === b.bytes) kept.push(b);
      user.value = kept;
      error.value = '';
    } catch (e) {
      error.value = `This browser cannot keep books: ${message(e)}`;
    }
    loaded.value = true;
    await estimate();
  }

  async function pull(book: BookEntry): Promise<void> {
    if (progress.has(book.id)) return;
    progress.set(book.id, 0);
    error.value = '';
    try {
      const res = await fetch(book.url);
      if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
      const zip = new Uint8Array(book.zipBytes);
      let got = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (got + value.length > zip.length) throw new Error('the archive is larger than its pin');
        zip.set(value, got);
        got += value.length;
        progress.set(book.id, got);
      }
      if (got !== zip.length) throw new Error('the archive is smaller than its pin');
      const sha = hex(await crypto.subtle.digest('SHA-256', zip));
      if (sha !== book.sha256) throw new Error(`the archive hashes to ${sha}, not to its pin`);

      const { stream } = await unzipFirst(new Blob([zip]));
      await writeStream([PULLED], book.id, stream);
      indexes.delete(book.id);
      await load();
    } catch (e) {
      await removeFile([PULLED], book.id).catch(() => undefined);
      error.value = `${book.id} was not pulled: ${message(e)}`;
    } finally {
      progress.delete(book.id);
      await estimate();
    }
  }

  async function remove(book: BookEntry): Promise<void> {
    await removeFile([PULLED], book.id).catch(() => undefined);
    indexes.delete(book.id);
    await load();
  }

  /**
   * Adds a book from a file of the user's: a .pgn or .epd file, or a zip archive that holds one.
   * The book is copied into OPFS as it streams, then every opening in it is read; a book with one
   * that does not read is refused, with that opening named.
   */
  async function add(file: File): Promise<void> {
    if (adding.value) return;
    adding.value = { name: file.name, checked: 0, total: 0 };
    error.value = '';
    let id = file.name;
    let written = false;
    try {
      let source: ReadableStream<Uint8Array>;
      if (/\.zip$/i.test(file.name)) {
        const inner = await unzipFirst(
          file,
          (n) => !n.startsWith('__MACOSX/') && bookFormat(n) !== undefined,
        ).catch((e: unknown) => {
          throw new Error(
            message(e) === 'the archive holds no file it can use'
              ? 'the archive holds no .pgn or .epd file'
              : message(e),
          );
        });
        id = inner.name.split(/[/\\]/).at(-1) ?? inner.name;
        source = inner.stream;
      } else {
        if (file.size >= MAX_BYTES) throw new Error('a book must be under 4 GB');
        source = file.stream();
      }
      const format = bookFormat(id);
      if (!format)
        throw new Error('a book is a .pgn or .epd file, or a zip archive that holds one');
      if (list.some((b) => b.id === id) || user.value.some((b) => b.id === id))
        throw new Error(`a book named ${id} is already here; rename the file to add it`);

      written = true;
      await writeStream([USER], id, source);
      const book = await (await (await userFolder()).getFileHandle(id)).getFile();
      if (book.size >= MAX_BYTES) throw new Error('a book must be under 4 GB');
      const starts = await indexBook(book, format);
      if (starts.length === 0) {
        throw new Error(
          format === 'pgn'
            ? 'it holds no games: each game starts with an [Event tag at the start of a line'
            : 'it holds no positions',
        );
      }
      adding.value.total = starts.length;
      await checkBook(book, format, starts, (n) => {
        if (adding.value) adding.value.checked = n;
      });
      const entry: UserBook = {
        id,
        format,
        positions: starts.length,
        bytes: book.size,
        added: Date.now(),
      };
      const next = [...user.value, entry].toSorted((a, b) => a.id.localeCompare(b.id));
      await writeText([USER], USER_LIST, JSON.stringify(next));
      user.value = next;
      indexes.set(id, Promise.resolve(starts));
    } catch (e) {
      if (written) await removeFile([USER], id).catch(() => undefined);
      error.value = `${id} was not added: ${message(e)}`;
    } finally {
      adding.value = null;
      await estimate();
    }
  }

  /** drops then adds entries of the user's books' list, as a merge from a backup asks */
  async function mergeList(drop: readonly string[], put: readonly UserBook[]): Promise<void> {
    const saved: unknown = JSON.parse((await readText([USER], USER_LIST)) ?? '[]');
    const kept = (Array.isArray(saved) ? saved.filter(isUserBook) : []).filter(
      (b) => !drop.includes(b.id) && !put.some((p) => p.id === b.id),
    );
    for (const b of put) indexes.delete(b.id);
    await writeText(
      [USER],
      USER_LIST,
      JSON.stringify([...kept, ...put].toSorted((a, b) => a.id.localeCompare(b.id))),
    );
    await load();
  }

  /** deletes this browser's copy of a user's book; the user's own file is untouched */
  async function removeUser(id: string): Promise<void> {
    const next = user.value.filter((b) => b.id !== id);
    await writeText([USER], USER_LIST, JSON.stringify(next));
    user.value = next;
    await removeFile([USER], id).catch(() => undefined);
    indexes.delete(id);
    await estimate();
  }

  /**
   * An opening of a pulled book, chosen by `u` in [0, 1): the same `u` gives the same opening, so
   * a pair's two games share one. The book's index is built on first use.
   */
  async function openingAt(id: string, u: number): Promise<Opening> {
    const listedBook = list.find((b) => b.id === id);
    const book = listedBook ?? user.value.find((b) => b.id === id);
    if (!book) throw new Error(`no book ${id} in this browser`);
    const file = await (
      await (listedBook ? folder() : userFolder()).then((d) => d.getFileHandle(id))
    ).getFile();
    let index = indexes.get(id);
    if (!index) {
      index = indexBook(file, book.format);
      indexes.set(id, index);
    }
    const starts = await index;
    if (starts.length === 0) throw new Error(`${id} holds no openings`);
    return openingAt_(
      file,
      book.format,
      starts,
      Math.min(starts.length - 1, Math.floor(u * starts.length)),
    );
  }

  /** a random opening from a pulled book */
  function randomOpening(id: string): Promise<Opening> {
    return openingAt(id, Math.random());
  }

  return {
    list,
    pulled,
    user,
    usable,
    adding,
    storage,
    progress,
    error,
    loaded,
    load,
    pull,
    remove,
    add,
    removeUser,
    mergeList,
    openingAt,
    randomOpening,
  };
});
