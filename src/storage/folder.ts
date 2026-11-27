/**
 * The layout's files in a folder: OPFS's own, or a real one the user picked. Reads them, and
 * carries out changes on a real one; OPFS changes go through opfs.ts.
 */
import { inLayout, TOURNAMENTS, type Files, type Op } from './backup.ts';
import { USER } from '../stores/books.ts';
import { USER_ENGINES } from '../stores/engines.ts';
import { GAMES } from '../stores/games.ts';

function layoutFolder(path: string, books: boolean, engines: boolean): boolean {
  const parts = path.split('/');
  if (parts.length === 1) {
    return (
      parts[0] === GAMES ||
      parts[0] === TOURNAMENTS ||
      (books && parts[0] === USER) ||
      (engines && parts[0] === USER_ENGINES)
    );
  }
  return parts.length === 2 && parts[0] === TOURNAMENTS;
}

async function* walk(
  d: FileSystemDirectoryHandle,
  at: string,
  depth: number,
  books: boolean,
  engines: boolean,
): AsyncGenerator<[string, File]> {
  for await (const [name, h] of d.entries()) {
    const path = at ? `${at}/${name}` : name;
    if (h.kind === 'file') {
      if (inLayout(path, books, engines)) yield [path, await h.getFile()];
    } else if (depth > 1 && layoutFolder(path, books, engines)) {
      yield* walk(h, path, depth - 1, books, engines);
    }
  }
}

/** the layout's files in a folder, as Files that read from it */
export async function filesIn(
  root: FileSystemDirectoryHandle,
  books: boolean,
  engines = false,
): Promise<Files> {
  const out: Files = new Map();
  // the layout is at most three deep: tournaments/<id>/<file>
  for await (const [p, f] of walk(root, '', 3, books, engines)) out.set(p, f);
  return out;
}

async function parentOf(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<[FileSystemDirectoryHandle, string]> {
  const parts = path.split('/');
  const name = parts.pop() ?? '';
  let d = root;
  for (const p of parts) d = await d.getDirectoryHandle(p, { create });
  return [d, name];
}

/** carries out changes on a folder, in order */
export async function applyTo(root: FileSystemDirectoryHandle, ops: readonly Op[]): Promise<void> {
  for (const op of ops) {
    if ('write' in op) {
      const [d, name] = await parentOf(root, op.write, true);
      const w = await (await d.getFileHandle(name, { create: true })).createWritable();
      try {
        await w.write(op.data);
        await w.close();
      } catch (e) {
        await w.abort().catch(() => undefined);
        throw e;
      }
    } else {
      try {
        const [d, name] = await parentOf(root, op.remove, false);
        await d.removeEntry(name, { recursive: true });
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
      }
    }
  }
}
