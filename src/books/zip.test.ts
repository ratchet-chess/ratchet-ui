import { describe, expect, it } from 'vitest';
import { unzipFirst } from './zip.ts';

/** a one-file zip archive, built as zip(1) lays it out, with a data descriptor's zero sizes in the local header */
async function zip(name: string, text: string, method: 0 | 8): Promise<Blob> {
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
  central.setUint32(42, 0, true);
  const centralAt = 30 + nameBytes.length + data.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, 46 + nameBytes.length, true);
  end.setUint32(16, centralAt, true);
  return new Blob([local, nameBytes, data, central, nameBytes, end]);
}

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

  it('refuses what is not a zip archive', async () => {
    await expect(unzipFirst(new Blob(['not a zip']))).rejects.toThrow('not a zip archive');
  });
});
