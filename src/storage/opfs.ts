/**
 * Text files in the browser's private file system (OPFS), by a path of folder names. Writes go
 * through one queue, so two writes to one file never interleave.
 */

async function folder(path: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let d = await navigator.storage.getDirectory();
  for (const name of path) d = await d.getDirectoryHandle(name, { create });
  return d;
}

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

/** a file's text, or null when the file or a folder on its path does not exist */
export async function readText(path: string[], file: string): Promise<string | null> {
  try {
    return await (
      await (await folder(path, false)).getFileHandle(file)
    )
      .getFile()
      .then((f) => f.text());
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError'))
      return null;
    throw e;
  }
}

export function writeText(path: string[], file: string, text: string): Promise<void> {
  return serial(async () => {
    const w = await (
      await (await folder(path, true)).getFileHandle(file, { create: true })
    ).createWritable();
    await w.write(text);
    await w.close();
  });
}

/** writes `text` after the file's end, making the file if it is new */
export function appendText(path: string[], file: string, text: string): Promise<void> {
  return serial(async () => {
    const handle = await (await folder(path, true)).getFileHandle(file, { create: true });
    const size = (await handle.getFile()).size;
    const w = await handle.createWritable({ keepExistingData: true });
    await w.seek(size);
    await w.write(text);
    await w.close();
  });
}

/** the names of the folders in a folder; none when it does not exist */
export async function folders(path: string[]): Promise<string[]> {
  const d = await folder(path, true);
  const out: string[] = [];
  for await (const [name, handle] of d.entries()) if (handle.kind === 'directory') out.push(name);
  return out;
}

export function removeFolder(path: string[], name: string): Promise<void> {
  return serial(async () => {
    await (await folder(path, true)).removeEntry(name, { recursive: true });
  });
}
