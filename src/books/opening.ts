import { emptyHeaders, parsePgn, type Game as PgnGame, type PgnNodeData } from 'chessops/pgn';
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
const BOM = [0xef, 0xbb, 0xbf];

/** a book's format from its file name, `.epd` or `.pgn` in any case; undefined for any other name */
export function bookFormat(name: string): 'epd' | 'pgn' | undefined {
  const ext = /\.(epd|pgn)$/i.exec(name)?.[1]?.toLowerCase();
  return ext === 'epd' || ext === 'pgn' ? ext : undefined;
}

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
    // a UTF-8 byte order mark before the first opening is not part of it
    const first = offset === 0 && BOM.every((b, k) => value[k] === b) ? BOM.length : 0;
    for (let i = first; i < value.length; i++) {
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
  return readOpening(await book.slice(from, starts[i + 1] ?? book.size).text(), format, i);
}

/** a short quote of an opening's text, for a message */
const quote = (text: string) => {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
};

/** the games in PGN text that hold a tag or a move; comments and stray words make neither */
const gamesIn = (text: string): PgnGame<PgnNodeData>[] =>
  parsePgn(text, emptyHeaders).filter((g) => g.headers.size > 0 || g.moves.children.length > 0);

/** the opening that `text` holds, the `i`-th of its book; throws, naming it, when it does not read */
function readOpening(text: string, format: 'epd' | 'pgn', i: number): Opening {
  if (format === 'epd') {
    // EPD has no move counters; its operations after the fourth field are not needed here
    const fields = text.trim().split(/\s+/).slice(0, 4);
    const fen = `${fields.join(' ')} 0 1`;
    let g: Game;
    try {
      g = new Game(fen);
    } catch {
      throw new Error(`opening ${i + 1} is not a legal position: ${quote(text)}`);
    }
    return { fen: g.fen, moves: [], label: fields.join(' ') };
  }
  const games = gamesIn(text);
  const game = games[0];
  if (!game) throw new Error(`opening ${i + 1} of the book is not a PGN game`);
  // the index splits a book only at `[Event `, so a game without that tag would be lost here
  if (games.length > 1)
    throw new Error(`opening ${i + 1} runs into a game that does not start with an [Event tag`);
  const fen = game.headers.get('FEN');
  let g: Game;
  try {
    g = new Game(fen);
  } catch {
    throw new Error(`opening ${i + 1}: its FEN tag is not a legal position: ${fen ?? ''}`);
  }
  for (const node of game.moves.mainline()) {
    const move = parseSan(g.pos, node.san);
    if (!move || !g.play(makeUci(move)))
      throw new Error(`opening ${i + 1}: ${node.san} is not legal`);
  }
  return { fen, moves: g.uci, label: g.san.join(' ') };
}

/** how much of a book `checkBook` reads at once, in bytes */
const CHECK_READ = 1 << 20;
/** how long `checkBook` works before it lets the page draw, in ms */
const CHECK_SLICE = 40;

/**
 * Reads every opening of a book as `openingAt` does, so a book that passes plays each of its
 * openings. Throws at the first that does not read, naming it. `progress` hears how many openings
 * are checked, each time the page gets to draw.
 */
export async function checkBook(
  book: Blob,
  format: 'epd' | 'pgn',
  starts: Uint32Array,
  progress?: (checked: number) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  const end = (k: number) => starts[k + 1] ?? book.size;
  const first = starts[0] ?? book.size;
  if (format === 'pgn' && first > 0 && gamesIn(await book.slice(0, first).text()).length > 0)
    throw new Error('a game before the first [Event tag does not start with one');
  let sliceStart = performance.now();
  let i = 0;
  while (i < starts.length) {
    const from = starts[i] ?? 0;
    // the openings that start within one read
    let j = i + 1;
    while (j < starts.length && (starts[j] ?? 0) - from < CHECK_READ) j++;
    const bytes = new Uint8Array(await book.slice(from, end(j - 1)).arrayBuffer());
    for (let k = i; k < j; k++) {
      const text = decoder.decode(bytes.subarray((starts[k] ?? 0) - from, end(k) - from));
      readOpening(text, format, k);
      if (performance.now() - sliceStart > CHECK_SLICE) {
        progress?.(k + 1);
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
        sliceStart = performance.now();
      }
    }
    i = j;
  }
  progress?.(starts.length);
}
