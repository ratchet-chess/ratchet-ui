/**
 * Single-pass byte-offset and interned-header PGN index (modeled on fastchess-gui's PgnIndex).
 * Scans a 50,000-game collection in one UTF-8 byte pass with no move ASTs, stores ~50 bytes per
 * game in typed arrays suitable for IndexedDB structured clone, filters in milliseconds, and reads
 * or exports individual games by byte span via `Blob.slice`.
 */
import { openingMatches } from '../chess/openings.ts';

// ── types and forfeits ──────────────────────────────────────────────────────

export const PGN_INDEX_VERSION = 1;

/** Compact columnar index of every game in a PGN collection. */
export interface PgnIndex {
  /** number of games indexed */
  count: number;
  /** UTF-8 byte offset where each game starts in the PGN file */
  offsets: Uint32Array;
  /** UTF-8 byte length of each game */
  lengths: Uint32Array;
  /** string-table IDs for standard searchable headers (0 = empty) */
  white: Uint32Array;
  black: Uint32Array;
  event: Uint32Array;
  site: Uint32Array;
  date: Uint32Array;
  round: Uint32Array;
  result: Uint32Array;
  eco: Uint32Array;
  opening: Uint32Array;
  termination: Uint32Array;
  /** mainline half-move count (from PlyCount tag when present, else counted from movetext) */
  plies: Uint16Array;
  /** interned unique tag values; index 0 is always '' */
  strings: string[];
  /** lowercase mirror of `strings`, rebuilt on load for instant search */
  lower: string[];
}

/** Serializable payload persisted to IndexedDB outside OPFS backup layout. */
export interface StoredPgnIndex extends Omit<PgnIndex, 'lower'> {
  v: number;
  updated: string;
  bytes: number;
}

/** One row displayed in the Games table or narrow game rail. */
export interface IndexedGameRow {
  index: number;
  white: string;
  black: string;
  event: string;
  site: string;
  date: string;
  round: string;
  result: string;
  eco: string;
  opening: string;
  termination: string;
  plies: number;
  forfeit: boolean;
}

export interface GameFilter {
  /** space-separated words matching players, event, site, date, round, opening, ECO, or result */
  query: string;
  result: '' | '1-0' | '1/2-1/2' | '0-1' | '*';
  termination: '' | 'normal' | 'adjudication' | 'forfeit';
  /** ECO code, prefix, range (`B20-B99`), or opening name words */
  opening: string;
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_FILTER: GameFilter = {
  query: '',
  result: '',
  termination: '',
  opening: '',
  dateFrom: '',
  dateTo: '',
};

/** PGN Termination values that mean a game ended by forfeit */
const FORFEITS = new Set([
  'time forfeit',
  'rules infraction',
  'abandoned',
  'illegal move',
  'stalled connection',
]);

export const isForfeitTermination = (termination: string): boolean =>
  FORFEITS.has(termination.trim().toLowerCase());

/** Hydrates a `StoredPgnIndex` loaded from IndexedDB into a live `PgnIndex`. */
export function hydratePgnIndex(stored: unknown, updated: string, bytes: number): PgnIndex | null {
  if (typeof stored !== 'object' || stored === null) return null;
  const s = stored as Partial<StoredPgnIndex>;
  if (
    s.v !== PGN_INDEX_VERSION ||
    s.updated !== updated ||
    s.bytes !== bytes ||
    typeof s.count !== 'number' ||
    !(s.offsets instanceof Uint32Array) ||
    !(s.lengths instanceof Uint32Array) ||
    !(s.white instanceof Uint32Array) ||
    !(s.black instanceof Uint32Array) ||
    !(s.event instanceof Uint32Array) ||
    !(s.site instanceof Uint32Array) ||
    !(s.date instanceof Uint32Array) ||
    !(s.round instanceof Uint32Array) ||
    !(s.result instanceof Uint32Array) ||
    !(s.eco instanceof Uint32Array) ||
    !(s.opening instanceof Uint32Array) ||
    !(s.termination instanceof Uint32Array) ||
    !(s.plies instanceof Uint16Array) ||
    !Array.isArray(s.strings)
  ) {
    return null;
  }
  return {
    count: s.count,
    offsets: s.offsets,
    lengths: s.lengths,
    white: s.white,
    black: s.black,
    event: s.event,
    site: s.site,
    date: s.date,
    round: s.round,
    result: s.result,
    eco: s.eco,
    opening: s.opening,
    termination: s.termination,
    plies: s.plies,
    strings: s.strings,
    lower: s.strings.map((x) => x.toLowerCase()),
  };
}

/** Strips derived `lower` strings and attaches cache metadata for IndexedDB storage. */
export function dehydratePgnIndex(index: PgnIndex, updated: string, bytes: number): StoredPgnIndex {
  return {
    v: PGN_INDEX_VERSION,
    updated,
    bytes,
    count: index.count,
    offsets: index.offsets,
    lengths: index.lengths,
    white: index.white,
    black: index.black,
    event: index.event,
    site: index.site,
    date: index.date,
    round: index.round,
    result: index.result,
    eco: index.eco,
    opening: index.opening,
    termination: index.termination,
    plies: index.plies,
    strings: index.strings,
  };
}

// ── the byte scanner ────────────────────────────────────────────────────────

const NL = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const TAB = 0x09;
const LBRACKET = 0x5b; // [
const RBRACKET = 0x5d; // ]
const PERCENT = 0x25; // %
const LBRACE = 0x7b; // {
const RBRACE = 0x7d; // }
const LPAREN = 0x28; // (
const RPAREN = 0x29; // )
const SEMI = 0x3b; // ;
const DOT = 0x2e; // .

const TAG_RE = /^\[([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\]$/;
const decoder = new TextDecoder();

/** Whether a byte can start a SAN move token (`a-h`, `K`, `Q`, `R`, `B`, `N`, `O`). */
function isSanStart(b: number): boolean {
  return (
    (b >= 0x61 && b <= 0x68) || // a-h
    b === 0x4b || // K
    b === 0x51 || // Q
    b === 0x52 || // R
    b === 0x42 || // B
    b === 0x4e || // N
    b === 0x4f // O (castling)
  );
}

/** Growable columnar builder so 50,000+ games allocate no per-game JS objects during indexing. */
class IndexBuilder {
  cap = 256;
  count = 0;
  offsets = new Uint32Array(this.cap);
  lengths = new Uint32Array(this.cap);
  white = new Uint32Array(this.cap);
  black = new Uint32Array(this.cap);
  event = new Uint32Array(this.cap);
  site = new Uint32Array(this.cap);
  date = new Uint32Array(this.cap);
  round = new Uint32Array(this.cap);
  result = new Uint32Array(this.cap);
  eco = new Uint32Array(this.cap);
  opening = new Uint32Array(this.cap);
  termination = new Uint32Array(this.cap);
  plies = new Uint16Array(this.cap);
  strings: string[] = [''];
  private readonly ids = new Map<string, number>([['', 0]]);

  // current open game
  open = false;
  inHeader = false;
  inComment = false;
  varDepth = 0;
  curStart = 0;
  curWhite = 0;
  curBlack = 0;
  curEvent = 0;
  curSite = 0;
  curDate = 0;
  curRound = 0;
  curResult = 0;
  curEco = 0;
  curOpening = 0;
  curTermination = 0;
  curPlyTag = -1;
  curPlies = 0;

  private intern(value: string): number {
    const existing = this.ids.get(value);
    if (existing !== undefined) return existing;
    const id = this.strings.length;
    this.strings.push(value);
    this.ids.set(value, id);
    return id;
  }

  private grow(): void {
    const next = this.cap * 2;
    const resize32 = (a: Uint32Array) => {
      const b = new Uint32Array(next);
      b.set(a);
      return b;
    };
    const resize16 = (a: Uint16Array) => {
      const b = new Uint16Array(next);
      b.set(a);
      return b;
    };
    this.offsets = resize32(this.offsets);
    this.lengths = resize32(this.lengths);
    this.white = resize32(this.white);
    this.black = resize32(this.black);
    this.event = resize32(this.event);
    this.site = resize32(this.site);
    this.date = resize32(this.date);
    this.round = resize32(this.round);
    this.result = resize32(this.result);
    this.eco = resize32(this.eco);
    this.opening = resize32(this.opening);
    this.termination = resize32(this.termination);
    this.plies = resize16(this.plies);
    this.cap = next;
  }

  close(endOffset: number): void {
    if (!this.open) return;
    if (this.count === this.cap) this.grow();
    const i = this.count++;
    this.offsets[i] = this.curStart;
    this.lengths[i] = Math.max(0, endOffset - this.curStart);
    this.white[i] = this.curWhite;
    this.black[i] = this.curBlack;
    this.event[i] = this.curEvent;
    this.site[i] = this.curSite;
    this.date[i] = this.curDate;
    this.round[i] = this.curRound;
    this.result[i] = this.curResult;
    this.eco[i] = this.curEco;
    this.opening[i] = this.curOpening;
    this.termination[i] = this.curTermination;
    const plies = this.curPlyTag >= 0 ? this.curPlyTag : this.curPlies;
    this.plies[i] = Math.min(65_535, Math.max(0, plies));

    this.open = false;
    this.inComment = false;
    this.varDepth = 0;
    this.curWhite = 0;
    this.curBlack = 0;
    this.curEvent = 0;
    this.curSite = 0;
    this.curDate = 0;
    this.curRound = 0;
    this.curResult = 0;
    this.curEco = 0;
    this.curOpening = 0;
    this.curTermination = 0;
    this.curPlyTag = -1;
    this.curPlies = 0;
  }

  /** Processes one line slice `buf[from..to)` (excluding `\n`) starting at file byte `lineOffset`. */
  feedLine(buf: Uint8Array, from: number, to: number, lineOffset: number): void {
    let s = from;
    let e = to;
    while (e > s && (buf[e - 1] === CR || buf[e - 1] === SPACE || buf[e - 1] === TAB)) e--;
    while (s < e && (buf[s] === SPACE || buf[s] === TAB)) s++;

    if (s === e) {
      this.inHeader = false;
      return;
    }
    if (buf[s] === PERCENT && !this.inComment) return;

    // Header tag line: `[Name "value"]` (only when outside a multi-line comment)
    if (!this.inComment && this.varDepth === 0 && buf[s] === LBRACKET && buf[e - 1] === RBRACKET) {
      const line = decoder.decode(buf.subarray(s, e));
      const m = TAG_RE.exec(line);
      if (m?.[1] && m[2] !== undefined) {
        if (!this.inHeader) {
          this.close(lineOffset);
          this.open = true;
          this.curStart = lineOffset;
        }
        this.inHeader = true;
        const name = m[1];
        const raw = m[2];
        const value = raw.includes('\\') ? raw.replaceAll(/\\(.)/g, '$1') : raw;
        switch (name) {
          case 'White':
            this.curWhite = this.intern(value);
            break;
          case 'Black':
            this.curBlack = this.intern(value);
            break;
          case 'Event':
            this.curEvent = this.intern(value);
            break;
          case 'Site':
            this.curSite = this.intern(value);
            break;
          case 'Date':
            this.curDate = this.intern(value);
            break;
          case 'Round':
            this.curRound = this.intern(value);
            break;
          case 'Result':
            this.curResult = this.intern(value);
            break;
          case 'ECO':
            this.curEco = this.intern(value);
            break;
          case 'Opening':
            this.curOpening = this.intern(value);
            break;
          case 'Termination':
            this.curTermination = this.intern(value);
            break;
          case 'PlyCount': {
            const n = Number.parseInt(value, 10);
            if (Number.isFinite(n) && n >= 0) this.curPlyTag = n;
            break;
          }
          default:
            break;
        }
        return;
      }
    }

    // Movetext line
    this.inHeader = false;
    if (!this.open) {
      this.open = true;
      this.curStart = lineOffset;
    }

    // Count mainline SAN tokens directly on bytes (zero allocations)
    let i = s;
    while (i < e) {
      const b = buf[i] ?? 0;
      if (this.inComment) {
        if (b === RBRACE) this.inComment = false;
        i++;
        continue;
      }
      if (b === LBRACE) {
        this.inComment = true;
        i++;
        continue;
      }
      if (b === SEMI) break; // rest of line is a `;` comment
      if (b === LPAREN) {
        this.varDepth++;
        i++;
        continue;
      }
      if (b === RPAREN) {
        if (this.varDepth > 0) this.varDepth--;
        i++;
        continue;
      }
      if (b === SPACE || b === TAB) {
        i++;
        continue;
      }

      // Scan one token up to whitespace or delimiter
      const tokStart = i;
      while (i < e) {
        const c = buf[i] ?? 0;
        if (
          c === SPACE ||
          c === TAB ||
          c === LBRACE ||
          c === RBRACE ||
          c === LPAREN ||
          c === RPAREN ||
          c === SEMI
        ) {
          break;
        }
        i++;
      }
      if (this.varDepth === 0 && this.curPlyTag < 0) {
        let p = tokStart;
        // Skip optional move number prefix (`1.` or `12...`) attached directly to SAN
        let sawDigit = false;
        while (p < i && (buf[p] ?? 0) >= 0x30 && (buf[p] ?? 0) <= 0x39) {
          sawDigit = true;
          p++;
        }
        if (sawDigit) {
          if (p < i && buf[p] === DOT) {
            while (p < i && buf[p] === DOT) p++;
          } else {
            // Token started with digit and had no dot (e.g. `1-0`, `0-1`, `1/2-1/2`)
            continue;
          }
        }
        if (p < i && isSanStart(buf[p] ?? 0)) this.curPlies++;
      }
    }
  }

  finish(totalBytes: number): PgnIndex {
    this.close(totalBytes);
    const n = this.count;
    return {
      count: n,
      offsets: this.offsets.slice(0, n),
      lengths: this.lengths.slice(0, n),
      white: this.white.slice(0, n),
      black: this.black.slice(0, n),
      event: this.event.slice(0, n),
      site: this.site.slice(0, n),
      date: this.date.slice(0, n),
      round: this.round.slice(0, n),
      result: this.result.slice(0, n),
      eco: this.eco.slice(0, n),
      opening: this.opening.slice(0, n),
      termination: this.termination.slice(0, n),
      plies: this.plies.slice(0, n),
      strings: this.strings,
      lower: this.strings.map((x) => x.toLowerCase()),
    };
  }
}

/** Indexes a PGN byte buffer in one synchronous pass. */
export function indexPgnBytes(bytes: Uint8Array): PgnIndex {
  const b = new IndexBuilder();
  const bom =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  let lineStart = bom;
  for (let i = bom; i < bytes.length; i++) {
    if (bytes[i] === NL) {
      b.feedLine(bytes, lineStart, i, lineStart);
      lineStart = i + 1;
    }
  }
  if (lineStart < bytes.length) b.feedLine(bytes, lineStart, bytes.length, lineStart);
  return b.finish(bytes.length);
}

/** Indexes a PGN string (encodes to UTF-8 so byte offsets match `Blob.slice`). */
export function indexPgnText(text: string): PgnIndex {
  return indexPgnBytes(new TextEncoder().encode(text));
}

/** Streams a PGN `Blob` in chunks so large files never require a contiguous full-file copy. */
export async function indexPgnBlob(blob: Blob): Promise<PgnIndex> {
  const b = new IndexBuilder();
  const reader = blob.stream().getReader();
  let carry = new Uint8Array(0);
  let carryOffset = 0;
  let totalRead = 0;
  let firstChunk = true;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let chunk = value;
    let chunkStart = totalRead;
    totalRead += chunk.length;

    if (firstChunk) {
      firstChunk = false;
      if (chunk.length >= 3 && chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf) {
        chunk = chunk.subarray(3);
        chunkStart = 3;
        carryOffset = 3;
      }
    }

    let pos = 0;
    if (carry.length > 0) {
      const nl = chunk.indexOf(NL);
      if (nl < 0) {
        const merged = new Uint8Array(carry.length + chunk.length);
        merged.set(carry);
        merged.set(chunk, carry.length);
        carry = merged;
        continue;
      }
      const line = new Uint8Array(carry.length + nl);
      line.set(carry);
      line.set(chunk.subarray(0, nl), carry.length);
      b.feedLine(line, 0, line.length, carryOffset);
      carry = new Uint8Array(0);
      pos = nl + 1;
    }

    while (pos < chunk.length) {
      const nl = chunk.indexOf(NL, pos);
      if (nl < 0) {
        carry = chunk.slice(pos);
        carryOffset = chunkStart + pos;
        break;
      }
      b.feedLine(chunk, pos, nl, chunkStart + pos);
      pos = nl + 1;
    }
  }

  if (carry.length > 0) b.feedLine(carry, 0, carry.length, carryOffset);
  return b.finish(totalRead);
}

// ── rows, filters and export ────────────────────────────────────────────────

/** Materializes one display row from an index. */
export function rowAt(index: PgnIndex, i: number): IndexedGameRow {
  const s = index.strings;
  const term = s[index.termination[i] ?? 0] ?? '';
  const result = s[index.result[i] ?? 0] || '*';
  return {
    index: i,
    white: s[index.white[i] ?? 0] || '?',
    black: s[index.black[i] ?? 0] || '?',
    event: s[index.event[i] ?? 0] ?? '',
    site: s[index.site[i] ?? 0] ?? '',
    date: s[index.date[i] ?? 0] ?? '',
    round: s[index.round[i] ?? 0] ?? '',
    result,
    eco: s[index.eco[i] ?? 0] ?? '',
    opening: s[index.opening[i] ?? 0] ?? '',
    termination: term,
    plies: index.plies[i] ?? 0,
    forfeit: result !== '1/2-1/2' && isForfeitTermination(term),
  };
}

/** Finds the last game whose `Round` tag equals `round` (for Tourneys links), or -1. */
export function findLastByRound(index: PgnIndex, round: string): number {
  const targetId = index.strings.indexOf(round);
  if (targetId <= 0) return -1;
  for (let i = index.count - 1; i >= 0; i--) {
    if (index.round[i] === targetId) return i;
  }
  return -1;
}

/** Normalizes `YYYY-MM-DD` or `YYYY.MM.DD` into `YYYY.MM.DD` for lexicographic range compares. */
const normDate = (d: string): string => d.trim().replaceAll('-', '.');

/** Whether a filter has any active constraint. */
export function isFiltered(f: GameFilter): boolean {
  return (
    f.query.trim() !== '' ||
    f.result !== '' ||
    f.termination !== '' ||
    f.opening.trim() !== '' ||
    f.dateFrom.trim() !== '' ||
    f.dateTo.trim() !== ''
  );
}

/**
 * Filters a `PgnIndex` and returns matching 0-based game indices.
 * Precomputes string-table match masks per filter word so 50,000 games filter in a few ms.
 */
export function filterPgnIndex(index: PgnIndex, filter: GameFilter): Int32Array {
  const n = index.count;
  if (!isFiltered(filter)) {
    const all = new Int32Array(n);
    for (let i = 0; i < n; i++) all[i] = i;
    return all;
  }

  const sCount = index.strings.length;
  const words = filter.query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  // One Uint8Array per query word, marked 1 for each interned string containing that word
  const wordMasks = words.map((w) => {
    const m = new Uint8Array(sCount);
    for (let id = 1; id < sCount; id++) {
      if (index.lower[id]?.includes(w)) m[id] = 1;
    }
    return m;
  });

  const wantResultId = filter.result ? index.strings.indexOf(filter.result) : -1;
  const allowEmptyResult = filter.result === '*';
  if (filter.result && wantResultId < 0 && !allowEmptyResult) return new Int32Array(0);
  const drawResultId = index.strings.indexOf('1/2-1/2');

  let termMask: Uint8Array | null = null;
  if (filter.termination) {
    termMask = new Uint8Array(sCount);
    for (let id = 0; id < sCount; id++) {
      const t = (index.lower[id] ?? '').trim();
      const ok =
        filter.termination === 'forfeit'
          ? FORFEITS.has(t)
          : filter.termination === 'adjudication'
            ? t === 'adjudication'
            : t === 'normal' || t === '';
      if (ok) termMask[id] = 1;
    }
  }

  const openingQ = filter.opening.trim();
  const openingCache = openingQ ? new Map<number, boolean>() : null;
  const fromDate = normDate(filter.dateFrom);
  const toDate = normDate(filter.dateTo);
  let dateMask: Uint8Array | null = null;
  if (fromDate || toDate) {
    dateMask = new Uint8Array(sCount);
    for (let id = 1; id < sCount; id++) {
      const d = normDate(index.strings[id] ?? '');
      if (!d || d.startsWith('?')) continue;
      if (fromDate && d < fromDate) continue;
      if (toDate && d > toDate) continue;
      dateMask[id] = 1;
    }
  }

  const out = new Int32Array(n);
  let matched = 0;
  const { white, black, event, site, date, round, result, eco, opening, termination } = index;

  outer: for (let i = 0; i < n; i++) {
    if (filter.result) {
      const rId = result[i] ?? 0;
      if (rId !== wantResultId && !(allowEmptyResult && rId === 0)) continue;
    }
    if (termMask) {
      if (termMask[termination[i] ?? 0] !== 1) continue;
      if (filter.termination === 'forfeit' && drawResultId >= 0 && result[i] === drawResultId)
        continue;
    }
    if (dateMask && dateMask[date[i] ?? 0] !== 1) continue;

    if (openingCache) {
      const eId = eco[i] ?? 0;
      const oId = opening[i] ?? 0;
      const key = eId * sCount + oId;
      let hit = openingCache.get(key);
      if (hit === undefined) {
        hit = openingMatches(index.strings[eId] ?? '', index.strings[oId] ?? '', openingQ);
        openingCache.set(key, hit);
      }
      if (!hit) continue;
    }

    for (let w = 0; w < wordMasks.length; w++) {
      const m = wordMasks[w];
      if (!m) continue;
      if (
        m[white[i] ?? 0] === 0 &&
        m[black[i] ?? 0] === 0 &&
        m[event[i] ?? 0] === 0 &&
        m[site[i] ?? 0] === 0 &&
        m[date[i] ?? 0] === 0 &&
        m[round[i] ?? 0] === 0 &&
        m[eco[i] ?? 0] === 0 &&
        m[opening[i] ?? 0] === 0 &&
        m[result[i] ?? 0] === 0
      ) {
        continue outer;
      }
    }
    out[matched++] = i;
  }

  return out.subarray(0, matched);
}

/**
 * Builds a PGN `Blob` of the chosen games directly from byte spans, merging adjacent spans so
 * exporting thousands of games copies no text and parses no moves.
 */
export function sliceGamesBlob(
  source: Blob,
  index: PgnIndex,
  indices: readonly number[] | Int32Array,
): Blob {
  const parts: (Blob | string)[] = [];
  let runStart = -1;
  let runEnd = -1;
  const flush = () => {
    if (runStart >= 0 && runEnd > runStart) {
      if (parts.length > 0) parts.push('\n');
      parts.push(source.slice(runStart, runEnd));
    }
    runStart = -1;
    runEnd = -1;
  };
  for (let k = 0; k < indices.length; k++) {
    const idx = indices[k] ?? -1;
    if (idx < 0 || idx >= index.count) continue;
    const start = index.offsets[idx] ?? 0;
    const len = index.lengths[idx] ?? 0;
    const end = start + len;
    if (start === runEnd) {
      runEnd = end;
    } else {
      flush();
      runStart = start;
      runEnd = end;
    }
  }
  flush();
  return new Blob(parts, { type: 'application/x-chess-pgn' });
}
