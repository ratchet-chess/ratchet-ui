/**
 * Reads one file out of a zip archive, as a stream of its bytes. Enough for the opening books'
 * archives: one file each, stored or deflated, under 4 GB. Bun and browsers both run it, because
 * both have DecompressionStream.
 */

/** the archive's first entry: its name, and its bytes as they are stored */
interface Entry {
  name: string;
  method: number;
  data: Blob;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** finds the archive's first file through its central directory, which holds sizes a local header may leave out */
async function firstEntry(zip: Blob): Promise<Entry> {
  // the end record is in the last 22 bytes, or before a comment of at most 65535 bytes
  const tailStart = Math.max(0, zip.size - 22 - 65_535);
  const tail = new DataView(await zip.slice(tailStart).arrayBuffer());
  let end = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip archive: no end of central directory');
  const centralAt = tail.getUint32(end + 16, true);

  const central = new DataView(await zip.slice(centralAt, centralAt + 46 + 65_535).arrayBuffer());
  if (central.getUint32(0, true) !== CENTRAL)
    throw new Error('not a zip archive: no central directory');
  const method = central.getUint16(10, true);
  const compressed = central.getUint32(20, true);
  const nameLength = central.getUint16(28, true);
  const localAt = central.getUint32(42, true);
  const name = new TextDecoder().decode(new Uint8Array(central.buffer, 46, nameLength));

  const local = new DataView(await zip.slice(localAt, localAt + 30).arrayBuffer());
  if (local.getUint32(0, true) !== LOCAL) throw new Error('not a zip archive: no local header');
  const dataAt = localAt + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  return { name, method, data: zip.slice(dataAt, dataAt + compressed) };
}

/** the first file of a zip archive: its name, and a stream of its bytes as they were before zipping */
export async function unzipFirst(
  zip: Blob,
): Promise<{ name: string; stream: ReadableStream<Uint8Array> }> {
  const e = await firstEntry(zip);
  if (e.method === 0) return { name: e.name, stream: e.data.stream() };
  if (e.method === 8) {
    return {
      name: e.name,
      stream: e.data.stream().pipeThrough(new DecompressionStream('deflate-raw')),
    };
  }
  throw new Error(`${e.name} is compressed by method ${e.method}, which this reader does not know`);
}
