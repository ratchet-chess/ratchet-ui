import { parsePgn } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { Game } from '../chess/game.ts';

/** An opening drawn from a book: a start position and the moves played from it. */
export interface Opening {
  /** the start position; undefined for chess's own */
  fen: string | undefined;
  /** UCI moves from the start position */
  moves: string[];
  /** the opening as a reader sees it: its moves in SAN, or its FEN */
  label: string;
}

const NL = 0x0a;
const EVENT = new TextEncoder().encode('[Event ');

/**
 * Where each opening of a book starts, in bytes: each line of an EPD book that holds text, and each
 * `[Event ` tag that starts a line of a PGN book. One pass, a chunk at a time, so a book of
 * hundreds of megabytes is never held whole.
 */
export async function indexBook(book: Blob, format: 'epd' | 'pgn'): Promise<Uint32Array> {
  let starts = new Uint32Array(1024);
  let n = 0;
  const push = (at: number) => {
    if (n === starts.length) {
      const grown = new Uint32Array(starts.length * 2);
      grown.set(starts);
      starts = grown;
    }
    starts[n++] = at;
  };
  // the byte before the current one is a line end, as at the start of the book
  let lineStart = true;
  /** how far into `[Event ` the current line has matched, while it still could */
  let matched = -1;
  let offset = 0;
  const reader = book.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (let i = 0; i < value.length; i++) {
      const b = value[i] ?? 0;
      if (lineStart) {
        if (format === 'epd') {
          if (b !== NL && b !== 0x0d) push(offset + i);
        } else matched = 0;
      }
      if (matched >= 0) {
        if (b === EVENT[matched]) {
          matched++;
          if (matched === EVENT.length) {
            push(offset + i - EVENT.length + 1);
            matched = -1;
          }
        } else matched = -1;
      }
      lineStart = b === NL;
    }
    offset += value.length;
  }
  return starts.slice(0, n);
}

/** the `i`-th opening of a book that `starts` indexes */
export async function openingAt(
  book: Blob,
  format: 'epd' | 'pgn',
  starts: Uint32Array,
  i: number,
): Promise<Opening> {
  const from = starts[i] ?? 0;
  const text = await book.slice(from, starts[i + 1] ?? book.size).text();
  if (format === 'epd') {
    // EPD has no move counters; its operations after the fourth field are not needed here
    const fields = text.trim().split(/\s+/).slice(0, 4);
    const fen = `${fields.join(' ')} 0 1`;
    const g = new Game(fen);
    return { fen: g.fen, moves: [], label: fields.join(' ') };
  }
  const game = parsePgn(text)[0];
  if (!game) throw new Error(`opening ${i + 1} of the book is not a PGN game`);
  const fen = game.headers.get('FEN');
  const g = new Game(fen);
  for (const node of game.moves.mainline()) {
    const move = parseSan(g.pos, node.san);
    if (!move || !g.play(makeUci(move)))
      throw new Error(`opening ${i + 1}: ${node.san} is not legal`);
  }
  return { fen, moves: g.uci, label: g.san.join(' ') };
}
