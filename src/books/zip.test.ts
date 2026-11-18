import { describe, expect, it } from 'vitest';
import { unzipFirst } from './zip.ts';

/** a zip archive, built as zip(1) lays it out, with a data descriptor's zero sizes in each local header */
async function zipOf(files: [name: string, text: string][], method: 0 | 8): Promise<Blob> {
  const parts: BlobPart[] = [];
  const centrals: BlobPart[] = [];
  let at = 0;
  let centralSize = 0;
  for (const [name, text] of files) {
    const raw = new TextEncoder().encode(text);
    const data =
      method === 8
        ? new Uint8Array(
            await new Response(
              new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw')),
            ).arrayBuffer(),
          )
        : raw;
    const nameBytes = new TextEncoder().encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(6, 0x08, true); // sizes follow the data, so the local header holds zeros
    local.setUint16(8, method, true);
    local.setUint16(26, nameBytes.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(10, method, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, raw.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, at, true);
    parts.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    at += 30 + nameBytes.length + data.length;
    centralSize += 46 + nameBytes.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, at, true);
  return new Blob([...parts, ...centrals, end]);
}

const zip = (name: string, text: string, method: 0 | 8) => zipOf([[name, text]], method);

const read = async (s: ReadableStream<Uint8Array>) => new Response(s).text();

describe('unzipFirst', () => {
  const text = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -\n'.repeat(50);

  it('inflates a deflated entry, with its sizes only in the central directory', async () => {
    const out = await unzipFirst(await zip('book.epd', text, 8));
    expect(out.name).toBe('book.epd');
    expect(await read(out.stream)).toBe(text);
  });

  it('reads a stored entry', async () => {
    expect(await read((await unzipFirst(await zip('b.pgn', 'x', 0))).stream)).toBe('x');
  });

  it('takes the first file that its test accepts', async () => {
    const archive = await zipOf(
      [
        ['books/', ''],
        ['__MACOSX/books/._b.pgn', 'junk'],
        ['books/b.pgn', 'the book'],
        ['books/c.pgn', 'another'],
      ],
      8,
    );
    const out = await unzipFirst(archive, (n) => n.endsWith('.pgn') && !n.startsWith('__MACOSX/'));
    expect(out.name).toBe('books/b.pgn');
    expect(await read(out.stream)).toBe('the book');
    await expect(unzipFirst(archive, () => false)).rejects.toThrow('no file it can use');
  });

  it('refuses what is not a zip archive', async () => {
    await expect(unzipFirst(new Blob(['not a zip']))).rejects.toThrow('not a zip archive');
  });
});
