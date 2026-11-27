/**
 * Files in the browser's private file system (OPFS), by a path of folder names. Every write and
 * delete of the app's data goes through here: the first asks the browser to keep the storage, and
 * each is reported to the watchers, which the mirror folder follows. Text writes go through one
 * queue, so two writes to one file never interleave.
 */

function storageApi(): StorageManager | undefined {
  return typeof navigator !== 'undefined' ? (navigator as Partial<Navigator>).storage : undefined;
}

async function folder(path: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  const storage = storageApi();
  if (!storage || typeof storage.getDirectory !== 'function')
    throw new Error('OPFS storage requires a secure context (HTTPS or localhost)');
  let d = await storage.getDirectory();
  for (const name of path) d = await d.getDirectoryHandle(name, { create });
  return d;
}

let queue: Promise<unknown> = Promise.resolve();
/**
 * runs a job after every text write queued before it, and before any queued after it; a reader
 * that needs several files as they stood at one moment reads them in one job
 */
export function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

type Watcher = (path: string) => void;
const watchers = new Set<Watcher>();
let asked = false;

/** calls `fn` with each written or deleted file or folder, as a path such as `games/index.json` */
export function watch(fn: Watcher): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

function changed(path: string[], name: string): void {
  if (!asked) {
    asked = true;
    // the browser may still clear storage it was not asked to keep, under pressure
    const storage = storageApi();
    if (storage && typeof storage.persist === 'function') void storage.persist().catch(() => false);
  }
  const at = [...path, name].join('/');
  for (const fn of watchers) fn(at);
}

/** a file handle's `File` (a `Blob` readable by byte slice), or null when missing */
export async function readFile(path: string[], file: string): Promise<File | null> {
  try {
    return await (await (await folder(path, false)).getFileHandle(file)).getFile();
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError'))
      return null;
    throw e;
  }
}

/** a file's text, or null when the file or a folder on its path does not exist */
export async function readText(path: string[], file: string): Promise<string | null> {
  const f = await readFile(path, file);
  return f ? f.text() : null;
}

export function writeText(path: string[], file: string, text: string): Promise<void> {
  return exclusive(async () => {
    const w = await (
      await (await folder(path, true)).getFileHandle(file, { create: true })
    ).createWritable();
    try {
      await w.write(text);
      await w.close();
    } catch (e) {
      await w.abort().catch(() => undefined);
      throw e;
    }
    changed(path, file);
  });
}

/**
 * writes text after the file's end, making the file if it is new; `text` may depend on the
 * file's size before it. Returns the size after.
 */
export function appendText(
  path: string[],
  file: string,
  text: string | ((size: number) => string),
): Promise<number> {
  return exclusive(async () => {
    const handle = await (await folder(path, true)).getFileHandle(file, { create: true });
    const size = (await handle.getFile()).size;
    const w = await handle.createWritable({ keepExistingData: true });
    try {
      await w.seek(size);
      await w.write(typeof text === 'string' ? text : text(size));
      await w.close();
    } catch (e) {
      await w.abort().catch(() => undefined);
      throw e;
    }
    changed(path, file);
    return (await handle.getFile()).size;
  });
}

/**
 * Writes a stream to a file, replacing it. Outside the text queue, since a book may take a while;
 * the file is new or the app's alone while it is written.
 */
export async function writeStream(
  path: string[],
  file: string,
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  const handle = await (await folder(path, true)).getFileHandle(file, { create: true });
  await stream.pipeTo(await handle.createWritable());
  changed(path, file);
}

/** the names of the folders in a folder; none when it does not exist */
export async function folders(path: string[]): Promise<string[]> {
  let d: FileSystemDirectoryHandle;
  try {
    d = await folder(path, false);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotFoundError') return [];
    throw e;
  }
  const out: string[] = [];
  for await (const [name, handle] of d.entries()) if (handle.kind === 'directory') out.push(name);
  return out;
}

/** deletes a file; a file that does not exist is already deleted */
export function removeFile(path: string[], file: string): Promise<void> {
  return exclusive(async () => {
    try {
      await (await folder(path, false)).removeEntry(file);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
    }
    changed(path, file);
  });
}

export function removeFolder(path: string[], name: string): Promise<void> {
  return exclusive(async () => {
    try {
      await (await folder(path, false)).removeEntry(name, { recursive: true });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
    }
    changed(path, name);
  });
}
