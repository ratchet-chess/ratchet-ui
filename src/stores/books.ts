import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import listed from '../../books.json';
import { parseBooks, type BookEntry } from '../books/list.ts';
import { indexBook, openingAt, type Opening } from '../books/opening.ts';
import { unzipFirst } from '../books/zip.ts';

/** a pulled book, as this browser keeps it */
export interface Pulled {
  bytes: number;
  /** ms since the epoch */
  modified: number;
}

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The opening books: the committed list (books.json), and the books this browser has pulled into
 * its private file system (OPFS). A pull downloads the book's zip archive from its repo at the
 * pinned commit, checks its sha256, and unzips it into OPFS as it streams, so a large book is not
 * held in memory.
 */
export const useBooks = defineStore('books', () => {
  const list: BookEntry[] = parseBooks(listed);
  const pulled = ref(new Map<string, Pulled>());
  /** a pull's progress, by book: bytes downloaded of the archive's size */
  const progress = reactive(new Map<string, number>());
  const error = ref('');
  /** each book's index of opening starts, built on first use and kept for the session */
  const indexes = new Map<string, Promise<Uint32Array>>();
  let dir: FileSystemDirectoryHandle | undefined;

  async function folder(): Promise<FileSystemDirectoryHandle> {
    dir ??= await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle('books', { create: true });
    return dir;
  }

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
      error.value = '';
    } catch (e) {
      error.value = `This browser cannot keep books: ${e instanceof Error ? e.message : String(e)}`;
    }
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
      const handle = await (await folder()).getFileHandle(book.id, { create: true });
      await stream.pipeTo(await handle.createWritable());
      indexes.delete(book.id);
      void navigator.storage.persist();
      await load();
    } catch (e) {
      await (await folder()).removeEntry(book.id).catch(() => undefined);
      error.value = `${book.id} was not pulled: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      progress.delete(book.id);
    }
  }

  async function remove(book: BookEntry): Promise<void> {
    await (await folder()).removeEntry(book.id).catch(() => undefined);
    indexes.delete(book.id);
    await load();
  }

  /** a random opening from a pulled book; its index is built on first use */
  async function randomOpening(id: string): Promise<Opening> {
    const book = list.find((b) => b.id === id);
    if (!book) throw new Error(`no book ${id}`);
    const file = await (await (await folder()).getFileHandle(id)).getFile();
    let index = indexes.get(id);
    if (!index) {
      index = indexBook(file, book.format);
      indexes.set(id, index);
    }
    const starts = await index;
    if (starts.length === 0) throw new Error(`${id} holds no openings`);
    return openingAt(file, book.format, starts, Math.floor(Math.random() * starts.length));
  }

  return { list, pulled, progress, error, load, pull, remove, randomOpening };
});
