/**
 * Zip archives: reads their files, stored or deflated, and writes them stored. Enough for opening
 * books and the app's backups: files under 4 GB, with no zip64 records. Bun and browsers both run
 * it, because both have DecompressionStream.
 */

/** an archive's file: its name, expected checksum/size, and bytes as stored */
interface Entry {
  name: string;
  method: number;
  crc: number;
  uncompressed: number;
  data: Blob;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** the general-purpose flag that marks a name as UTF-8 */
const UTF8 = 0x0800;

/**
 * the archive's files that `accept` takes, through its central directory, which holds sizes a
 * local header may leave out; `first` stops at the first
 */
async function findEntries(
  zip: Blob,
  accept: (name: string) => boolean,
  first: boolean,
): Promise<Entry[]> {
  // the end record is in the last 22 bytes, or before a comment of at most 65535 bytes
  const tailStart = Math.max(0, zip.size - 22 - 65_535);
  const tail = new DataView(await zip.slice(tailStart).arrayBuffer());
  let end = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (
      tail.getUint32(i, true) === EOCD &&
      tail.getUint16(i + 20, true) === tail.byteLength - i - 22
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip archive: no end of central directory');
  const count = tail.getUint16(end + 10, true);
  const centralSize = tail.getUint32(end + 12, true);
  const centralAt = tail.getUint32(end + 16, true);
  if (count === 0xffff || centralSize === 0xffffffff || centralAt === 0xffffffff)
    throw new Error('ZIP64 archives are not supported');
  if (centralAt + centralSize > zip.size)
    throw new Error('not a zip archive: truncated central directory');

  const central = new DataView(await zip.slice(centralAt, centralAt + centralSize).arrayBuffer());
  const out: Entry[] = [];
  let at = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > central.byteLength || central.getUint32(at, true) !== CENTRAL)
      throw new Error('not a zip archive: no central directory');
    const method = central.getUint16(at + 10, true);
    const crc = central.getUint32(at + 16, true);
    const compressed = central.getUint32(at + 20, true);
    const uncompressed = central.getUint32(at + 24, true);
    const nameLength = central.getUint16(at + 28, true);
    const extraLength = central.getUint16(at + 30, true);
    const commentLength = central.getUint16(at + 32, true);
    const localAt = central.getUint32(at + 42, true);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff || localAt === 0xffffffff)
      throw new Error('ZIP64 archives are not supported');
    if (at + 46 + nameLength + extraLength + commentLength > central.byteLength)
      throw new Error('not a zip archive: truncated central directory entry');
    const name = new TextDecoder().decode(new Uint8Array(central.buffer, at + 46, nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (!accept(name)) continue;

    if (localAt + 30 > zip.size) throw new Error('not a zip archive: truncated local header');
    const local = new DataView(await zip.slice(localAt, localAt + 30).arrayBuffer());
    if (local.getUint32(0, true) !== LOCAL) throw new Error('not a zip archive: no local header');
    const dataAt = localAt + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    if (dataAt + compressed > zip.size) throw new Error(`${name} is truncated in the archive`);
    out.push({ name, method, crc, uncompressed, data: zip.slice(dataAt, dataAt + compressed) });
    if (first) break;
  }
  return out;
}

/** checks uncompressed byte count and CRC-32 as bytes stream through */
function verifyStream(e: Entry): TransformStream<Uint8Array, Uint8Array> {
  let c = 0xffffffff;
  let size = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.length;
      for (let i = 0; i < chunk.length; i++)
        c = (CRC_TABLE[(c ^ (chunk[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
      controller.enqueue(chunk);
    },
    flush(controller) {
      const actual = (c ^ 0xffffffff) >>> 0;
      if (size !== e.uncompressed || actual !== e.crc) {
        controller.error(new Error(`${e.name} is corrupt (checksum or size mismatch)`));
      }
    },
  });
}

function unpacked(e: Entry): ReadableStream<Uint8Array> {
  if (e.method === 0) return e.data.stream().pipeThrough(verifyStream(e));
  if (e.method === 8)
    return e.data
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))
      .pipeThrough(verifyStream(e));
  throw new Error(`${e.name} is compressed by method ${e.method}, which this reader does not know`);
}

/**
 * The first file of a zip archive that `accept` takes, by its name: the name, and a stream of its
 * bytes as they were before zipping. With no `accept`, the archive's first file.
 */
export async function unzipFirst(
  zip: Blob,
  accept: (name: string) => boolean = () => true,
): Promise<{ name: string; stream: ReadableStream<Uint8Array> }> {
  const [e] = await findEntries(zip, accept, true);
  if (!e) {
    const count = (await findEntries(zip, () => true, false)).length;
    throw new Error(count === 0 ? 'the archive is empty' : 'the archive holds no file it can use');
  }
  return { name: e.name, stream: unpacked(e) };
}

/**
 * Every file of a zip archive that `accept` takes, by name, as it was before zipping. A stored
 * file is verified and returned as a slice of the archive; a deflated one is inflated and verified.
 */
export async function unzipAll(
  zip: Blob,
  accept: (name: string) => boolean = () => true,
): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  for (const e of await findEntries(zip, (n) => !n.endsWith('/') && accept(n), false)) {
    if (e.method === 0) {
      if (e.data.size !== e.uncompressed || (await crc32(e.data)) !== e.crc)
        throw new Error(`${e.name} is corrupt (checksum or size mismatch)`);
      out.set(e.name, e.data);
    } else {
      out.set(e.name, await new Response(unpacked(e)).blob());
    }
  }
  return out;
}

// ── writing ─────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** the CRC-32 a zip archive records of a file, read as a stream */
export async function crc32(data: Blob): Promise<number> {
  let c = 0xffffffff;
  const reader = data.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // an indexed loop, several times faster than for-of over the bytes
    for (let i = 0; i < value.length; i++)
      c = (CRC_TABLE[(c ^ (value[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** a time as MS-DOS writes it, in local time, as zip archives keep it */
function dosTime(ms: number): { time: number; date: number } {
  const d = new Date(ms);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** a file to put in an archive; `modified` is ms since the epoch */
export interface ZipFile {
  name: string;
  data: Blob;
  modified: number;
}

/**
 * A zip archive of the files, stored without compression, as a Blob made of their own Blobs, so
 * a large file is not copied into memory. Throws when the archive would need zip64: a file or the
 * whole over 4 GB, or more than 65,535 files.
 */
export async function zipStored(files: readonly ZipFile[]): Promise<Blob> {
  if (files.length > 0xffff) throw new Error(`${files.length} files are more than a zip holds`);
  const parts: (Blob | DataView<ArrayBuffer> | Uint8Array<ArrayBuffer>)[] = [];
  const centrals: (DataView<ArrayBuffer> | Uint8Array<ArrayBuffer>)[] = [];
  let at = 0;
  let centralSize = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name);
    const size = f.data.size;
    if (at + 30 + name.length + size > 0xffffffff)
      throw new Error('the archive would be over 4 GB, which is more than a zip holds');
    const crc = await crc32(f.data);
    const { time, date } = dosTime(f.modified);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOCAL, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, UTF8, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, CENTRAL, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, UTF8, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);
    central.setUint32(24, size, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, at, true);

    parts.push(local, name, f.data);
    centrals.push(central, name);
    at += 30 + name.length + size;
    centralSize += 46 + name.length;
  }
  if (at + centralSize > 0xffffffff)
    throw new Error('the archive would be over 4 GB, which is more than a zip holds');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, EOCD, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, at, true);
  return new Blob([...parts, ...centrals, end], { type: 'application/zip' });
}
