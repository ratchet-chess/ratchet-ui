import { describe, expect, it } from 'vitest';
import {
  dehydratePgnIndex,
  EMPTY_FILTER,
  filterPgnIndex,
  findLastByRound,
  hydratePgnIndex,
  indexPgnBlob,
  indexPgnText,
  rowAt,
  sliceGamesBlob,
} from './index.ts';

const SAMPLE = `[Event "SPRT Match"]
[Site "ratchet-ui"]
[Date "2026.11.24"]
[Round "1.1"]
[White "ratchet-0.3.16"]
[Black "stockfish-10"]
[Result "1-0"]
[ECO "B90"]
[Opening "Sicilian Defense: Najdorf Variation"]
[Termination "normal"]

1. e4 {+0.25/14 0.12s} c5 2. Nf3 d6 3. d4 cxd4 (3... Nf6 4. Nc3) 4. Nxd4 Nf6 1-0

[Event "SPRT Match"]
[Site "ratchet-ui"]
[Date "2026.11.25"]
[Round "1.2"]
[White "Grünfeld Player"]
[Black "ratchet-0.3.16"]
[Result "0-1"]
[ECO "D85"]
[Opening "Grünfeld Defense: Exchange"]
[Termination "time forfeit"]

1. d4 Nf6 2. c4 g6 3. Nc3 d5 0-1

[Event "SPRT Match"]
[Site "ratchet-ui"]
[Date "2026.11.25"]
[Round "1.2"]
[White "stockfish-10"]
[Black "ratchet-0.3.16"]
[Result "1/2-1/2"]
[PlyCount "42"]
[Termination "adjudication"]

1. c4 e5 1/2-1/2
`;

describe('PgnIndex', () => {
  it('indexes byte spans, headers, plies (skipping variations), and UTF-8 names identically for text and Blob', async () => {
    const blob = new Blob([SAMPLE]);
    const fromText = indexPgnText(SAMPLE);
    const fromBlob = await indexPgnBlob(blob);

    expect(fromBlob.count).toBe(3);
    expect(fromText.count).toBe(3);
    expect([...fromBlob.offsets]).toEqual([...fromText.offsets]);
    expect([...fromBlob.lengths]).toEqual([...fromText.lengths]);

    expect(rowAt(fromBlob, 0)).toMatchObject({
      white: 'ratchet-0.3.16',
      black: 'stockfish-10',
      result: '1-0',
      eco: 'B90',
      plies: 8,
      forfeit: false,
    });
    expect(rowAt(fromBlob, 1)).toMatchObject({
      white: 'Grünfeld Player',
      black: 'ratchet-0.3.16',
      result: '0-1',
      eco: 'D85',
      plies: 6,
      forfeit: true,
    });
    // PlyCount tag overrides movetext count when present
    expect(rowAt(fromBlob, 2).plies).toBe(42);

    // Byte offsets slice exact UTF-8 games from the Blob
    const g1 = await blob
      .slice(fromBlob.offsets[1], (fromBlob.offsets[1] ?? 0) + (fromBlob.lengths[1] ?? 0))
      .text();
    expect(g1).toContain('[White "Grünfeld Player"]');
    expect(g1).toContain('3. Nc3 d5 0-1');
  });

  it('finds the last game matching a Round tag', () => {
    const idx = indexPgnText(SAMPLE);
    expect(findLastByRound(idx, '1.2')).toBe(2);
    expect(findLastByRound(idx, '1.1')).toBe(0);
    expect(findLastByRound(idx, '9.9')).toBe(-1);
  });

  it('filters by query words, result, termination, opening/ECO range, and dates', () => {
    const idx = indexPgnText(SAMPLE);
    expect([...filterPgnIndex(idx, { ...EMPTY_FILTER, query: 'grünfeld' })]).toEqual([1]);
    expect([...filterPgnIndex(idx, { ...EMPTY_FILTER, result: '1/2-1/2' })]).toEqual([2]);
    expect([...filterPgnIndex(idx, { ...EMPTY_FILTER, termination: 'forfeit' })]).toEqual([1]);
    expect([...filterPgnIndex(idx, { ...EMPTY_FILTER, termination: 'adjudication' })]).toEqual([2]);
    expect([...filterPgnIndex(idx, { ...EMPTY_FILTER, opening: 'B20-B99' })]).toEqual([0]);
    expect([...filterPgnIndex(idx, { ...EMPTY_FILTER, opening: 'exchange grünfeld' })]).toEqual([
      1,
    ]);
    expect([...filterPgnIndex(idx, { ...EMPTY_FILTER, dateFrom: '2026-11-25' })]).toEqual([1, 2]);
    expect([...filterPgnIndex(idx, { ...EMPTY_FILTER, dateTo: '2026-11-24' })]).toEqual([0]);
  });

  it('slices filtered games without re-parsing and merges contiguous spans', async () => {
    const blob = new Blob([SAMPLE]);
    const idx = await indexPgnBlob(blob);
    const out = await sliceGamesBlob(blob, idx, [0, 2]).text();
    expect(out).toContain('[Round "1.1"]');
    expect(out).not.toContain('Grünfeld Player');
    expect(out).toContain('[PlyCount "42"]');
  });

  it('dehydrates and hydrates cleanly for IndexedDB persistence', () => {
    const idx = indexPgnText(SAMPLE);
    const stored = dehydratePgnIndex(idx, '2026-11-25T00:00:00Z', 500);
    const restored = hydratePgnIndex(stored, '2026-11-25T00:00:00Z', 500);
    expect(restored?.count).toBe(3);
    expect(restored?.lower[1]).toBe(idx.lower[1]);
    expect(hydratePgnIndex(stored, '2026-11-26T00:00:00Z', 500)).toBeNull();
  });
});
