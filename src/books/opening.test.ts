import { describe, expect, it } from 'vitest';
import { bookFormat, checkBook, indexBook, openingAt } from './opening.ts';

const EPD = [
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - hmvc 0; fmvn 1;',
  '',
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -\r',
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -',
].join('\n');

const PGN = `[Event "?"]
[Result "*"]

1. e4 e5 2. Nf3 *

[Event "?"]
[Result "*"]

1. d4 d5 *
`;

describe('indexBook', () => {
  it('finds each EPD line that holds text, across chunks', async () => {
    const starts = await indexBook(new Blob([EPD]), 'epd');
    expect(starts).toHaveLength(3);
  });

  it('finds each PGN game by its Event tag', async () => {
    expect(await indexBook(new Blob([PGN]), 'pgn')).toHaveLength(2);
  });

  it('skips a byte order mark before the first opening', async () => {
    const book = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), PGN]);
    const starts = await indexBook(book, 'pgn');
    expect(starts).toHaveLength(2);
    expect((await openingAt(book, 'pgn', starts, 0)).label).toBe('e4 e5 Nf3');
    const epd = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), EPD]);
    await expect(checkBook(epd, 'epd', await indexBook(epd, 'epd'))).resolves.toBeUndefined();
  });
});

describe('bookFormat', () => {
  it('reads the format from the extension, in any case', () => {
    expect(bookFormat('book.EPD')).toBe('epd');
    expect(bookFormat('lines.pgn')).toBe('pgn');
    expect(bookFormat('book.pgn.zip')).toBeUndefined();
    expect(bookFormat('notes.txt')).toBeUndefined();
  });
});

describe('checkBook', () => {
  const check = async (text: string, format: 'epd' | 'pgn') => {
    const book = new Blob([text]);
    const seen: number[] = [];
    await checkBook(book, format, await indexBook(book, format), (n) => seen.push(n));
    return seen;
  };

  it('passes a book whose every opening reads, and reports them all checked', async () => {
    expect((await check(EPD, 'epd')).at(-1)).toBe(3);
    expect((await check(PGN, 'pgn')).at(-1)).toBe(2);
  });

  it('names the first EPD line that is not a legal position', async () => {
    const bad = `${EPD}\nrnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w KQkq -\n`;
    await expect(check(bad, 'epd')).rejects.toThrow(/^opening 4 is not a legal position/);
    await expect(check('hello world\n', 'epd')).rejects.toThrow('opening 1');
  });

  it('names the first PGN move that is not legal', async () => {
    const bad = `${PGN}\n[Event "?"]\n\n1. e4 e5 2. Ke3 *\n`;
    await expect(check(bad, 'pgn')).rejects.toThrow('opening 3: Ke3 is not legal');
  });

  it('refuses a PGN game that does not start with an Event tag, which the index would lose', async () => {
    const tagged = `${PGN}\n[White "x"]\n\n1. c4 *\n`;
    await expect(check(tagged, 'pgn')).rejects.toThrow('opening 2 runs into a game');
    await expect(check(`${PGN}\n1. c4 *\n`, 'pgn')).rejects.toThrow('opening 2 runs into a game');
    await expect(check(`1. c4 *\n\n${PGN}`, 'pgn')).rejects.toThrow('before the first [Event tag');
  });

  it('passes comments and stray text between PGN games', async () => {
    const book = `; my book\n{ lines }\n\n${PGN}\nsome words\n`;
    expect((await check(book, 'pgn')).at(-1)).toBe(2);
  });

  it('names a PGN game whose FEN tag is not a legal position', async () => {
    const bad = `[Event "?"]\n[FEN "8/8/8/8/8/8/8/8 w - - 0 1"]\n\n*\n`;
    await expect(check(bad, 'pgn')).rejects.toThrow('opening 1: its FEN tag');
  });
});

describe('openingAt', () => {
  it('reads an EPD line as a start position', async () => {
    const book = new Blob([EPD]);
    const o = await openingAt(book, 'epd', await indexBook(book, 'epd'), 1);
    expect(o.fen).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1');
    expect(o.moves).toEqual([]);
  });

  it('reads a PGN game as moves from the start', async () => {
    const book = new Blob([PGN]);
    const o = await openingAt(book, 'pgn', await indexBook(book, 'pgn'), 0);
    expect(o).toEqual({ fen: undefined, moves: ['e2e4', 'e7e5', 'g1f3'], label: 'e4 e5 Nf3' });
  });
});
