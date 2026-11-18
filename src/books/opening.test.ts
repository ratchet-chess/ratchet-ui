import { describe, expect, it } from 'vitest';
import { indexBook, openingAt } from './opening.ts';

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
