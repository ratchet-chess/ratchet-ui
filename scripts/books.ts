/**
 * Adds an opening book to books.json, the committed list of books the app can pull. A book is a
 * zip archive in a public repo, pinned to one commit by its address and its sha256.
 *
 *   bun scripts/books.ts add <book> [--repo <owner/repo>] [--ref <ref>]
 *   bun scripts/books.ts add 8moves_v3.pgn            from official-stockfish/books at master
 *
 * The archive is <book>.zip at the repo's root. When the repo publishes a books.json of its own,
 * as official-stockfish/books does, the unzipped book must match its sha384 and its count of
 * positions, or the script stops.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseBooks, type BookEntry } from '../src/books/list.ts';
import { unzipFirst } from '../src/storage/zip.ts';
import {
  at,
  download,
  fail,
  github,
  num,
  repoLicense,
  sha256,
  text,
  upsert,
  writeList,
} from './lib.ts';

const root = resolve(import.meta.dir, '..');
const listPath = join(root, 'books.json');

const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const [command, book] = args.filter(
  (a, i) => !a.startsWith('--') && !(args[i - 1]?.startsWith('--') ?? false),
);
if (command !== 'add' || book === undefined)
  fail('usage: bun scripts/books.ts add <book> [--repo <owner/repo>] [--ref <ref>]');
const format = book.endsWith('.epd')
  ? 'epd'
  : book.endsWith('.pgn')
    ? 'pgn'
    : fail(`${book}: a book is an .epd or a .pgn file`);
const repo = opt('--repo') ?? 'official-stockfish/books';
const ref = opt('--ref') ?? 'master';

const commit = text(
  await github(`/repos/${repo}/commits/${encodeURIComponent(ref)}`),
  `${repo} ${ref}`,
  'sha',
);
const raw = `https://raw.githubusercontent.com/${repo}/${commit}`;
const zip = await download(`${raw}/${book}.zip`);
const { name, stream } = await unzipFirst(new Blob([zip]));
if (name !== book) fail(`${book}.zip holds ${name}, not ${book}`);
const content = new Uint8Array(await new Response(stream).arrayBuffer());

const lines = new TextDecoder().decode(content).split('\n');
const counted =
  format === 'epd'
    ? lines.filter((l) => l.trim() !== '').length
    : lines.filter((l) => l.startsWith('[Event ')).length;

// the repo's own record of its books, where it keeps one
const res = await fetch(`${raw}/books.json`);
const upstream: unknown = res.ok ? await res.json() : null;
const record = at(upstream, book);
if (record !== undefined) {
  // the repo hashes a book with its line ends made LF (update_json.py in official-stockfish/books)
  const lf = new TextEncoder().encode(
    new TextDecoder().decode(content).replaceAll('\r\n', '\n').replaceAll('\r', '\n'),
  );
  const sri = createHash('sha384').update(lf).digest('base64');
  if (text(record, book, 'sri') !== sri)
    fail(
      `${book}: its sha384 is ${sri}, and ${repo}'s books.json says ${text(record, book, 'sri')}`,
    );
  const total = num(record, book, 'total');
  if (total !== counted)
    fail(`${book}: it holds ${counted} openings, and ${repo}'s books.json says ${total}`);
}

const entry: BookEntry = {
  id: book,
  format,
  positions: counted,
  bytes: content.length,
  url: `${raw}/${book}.zip`,
  zipBytes: zip.length,
  sha256: sha256(zip),
  repo,
  commit,
  license: (await repoLicense(repo)) ?? fail(`${repo} states no license GitHub can name`),
};
const list = existsSync(listPath)
  ? parseBooks(JSON.parse(readFileSync(listPath, 'utf8')) as unknown)
  : [];
upsert(list, entry);
writeList(listPath, 'books', list);
console.log(
  `books.json: ${book}, ${counted} openings, ${repo} at ${commit.slice(0, 7)} (${entry.license})${record === undefined ? '' : `, matches ${repo}'s books.json`}`,
);
