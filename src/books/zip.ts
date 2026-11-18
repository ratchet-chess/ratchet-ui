/**
 * Reads one file out of a zip archive, as a stream of its bytes. Enough for opening books: a file
 * stored or deflated, under 4 GB, with no zip64 records. Bun and browsers both run it, because
 * both have DecompressionStream.
 */

/** an archive's file: its name, and its bytes as they are stored */
interface Entry {
  name: string;
  method: number;
  data: Blob;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * finds the archive's first file that `accept` takes, through its central directory, which holds
 * sizes a local header may leave out
 */
async function findEntry(zip: Blob, accept: (name: string) => boolean): Promise<Entry> {
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
  const count = tail.getUint16(end + 10, true);
  const centralSize = tail.getUint32(end + 12, true);
  const centralAt = tail.getUint32(end + 16, true);

  const central = new DataView(await zip.slice(centralAt, centralAt + centralSize).arrayBuffer());
  let at = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > central.byteLength || central.getUint32(at, true) !== CENTRAL)
      throw new Error('not a zip archive: no central directory');
    const method = central.getUint16(at + 10, true);
    const compressed = central.getUint32(at + 20, true);
    const nameLength = central.getUint16(at + 28, true);
    const extraLength = central.getUint16(at + 30, true);
    const commentLength = central.getUint16(at + 32, true);
    const localAt = central.getUint32(at + 42, true);
    const name = new TextDecoder().decode(
      new Uint8Array(central.buffer, at + 46, Math.min(nameLength, central.byteLength - at - 46)),
    );
    at += 46 + nameLength + extraLength + commentLength;
    if (!accept(name)) continue;

    const local = new DataView(await zip.slice(localAt, localAt + 30).arrayBuffer());
    if (local.getUint32(0, true) !== LOCAL) throw new Error('not a zip archive: no local header');
    const dataAt = localAt + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    return { name, method, data: zip.slice(dataAt, dataAt + compressed) };
  }
  throw new Error(count === 0 ? 'the archive is empty' : 'the archive holds no file it can use');
}

/**
 * The first file of a zip archive that `accept` takes, by its name: the name, and a stream of its
 * bytes as they were before zipping. With no `accept`, the archive's first file.
 */
export async function unzipFirst(
  zip: Blob,
  accept: (name: string) => boolean = () => true,
): Promise<{ name: string; stream: ReadableStream<Uint8Array> }> {
  const e = await findEntry(zip, accept);
  if (e.method === 0) return { name: e.name, stream: e.data.stream() };
  if (e.method === 8) {
    return {
      name: e.name,
      stream: e.data.stream().pipeThrough(new DecompressionStream('deflate-raw')),
    };
  }
  throw new Error(`${e.name} is compressed by method ${e.method}, which this reader does not know`);
}
