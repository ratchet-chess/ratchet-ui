/** One opening book the app can pull: a zip archive at a pinned commit of a public repo. */
export interface BookEntry {
  /** the book's file name inside the archive, such as 8moves_v3.pgn */
  id: string;
  /** EPD holds one position a line; PGN holds one opening line a game */
  format: 'epd' | 'pgn';
  /** openings in the book */
  positions: number;
  /** the book's size once unzipped */
  bytes: number;
  /** the archive's address, at the pinned commit */
  url: string;
  /** the archive's size, which a pull downloads */
  zipBytes: number;
  /** the archive's sha256, which a pull checks before it keeps the book */
  sha256: string;
  repo: string;
  commit: string;
  /** SPDX identifier */
  license: string;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isText = (x: unknown): x is string => typeof x === 'string';
const isNumber = (x: unknown): x is number => typeof x === 'number';

function isBook(x: unknown): x is BookEntry {
  if (!isRecord(x)) return false;
  const { id, format, positions, bytes, url, zipBytes, sha256, repo, commit, license } = x;
  return (
    isText(id) &&
    (format === 'epd' || format === 'pgn') &&
    isNumber(positions) &&
    isNumber(bytes) &&
    isText(url) &&
    isNumber(zipBytes) &&
    isText(sha256) &&
    isText(repo) &&
    isText(commit) &&
    isText(license)
  );
}

/** Reads books.json's parsed content; throws when it is not a list of books. */
export function parseBooks(x: unknown): BookEntry[] {
  const books = isRecord(x) ? x.books : undefined;
  if (!Array.isArray(books) || !books.every(isBook))
    throw new Error('books.json is not a list of books');
  return books;
}
