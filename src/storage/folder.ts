/**
 * The layout's files in a folder: OPFS's own, or a real one the user picked. Reads them, and
 * carries out changes on a real one; OPFS changes go through opfs.ts.
 */
import { inLayout, type Files, type Op } from './backup.ts';

async function* walk(
  d: FileSystemDirectoryHandle,
  at: string,
  depth: number,
): AsyncGenerator<[string, File]> {
  for await (const [name, h] of d.entries()) {
    const path = at ? `${at}/${name}` : name;
    if (h.kind === 'file') yield [path, await h.getFile()];
    else if (depth > 1) yield* walk(h, path, depth - 1);
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
  for await (const [p, f] of walk(root, '', 3)) if (inLayout(p, books, engines)) out.set(p, f);
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
      await w.write(op.data);
      await w.close();
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
