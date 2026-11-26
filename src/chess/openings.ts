import openingsRaw from './openings.tsv?raw';

/** An opening recognized from a game's positions. */
export interface OpeningInfo {
  eco: string;
  name: string;
  /** half-move index (0-based into the positions array) where the opening matched */
  ply: number;
}

interface Entry {
  eco: string;
  name: string;
}

let table: Map<string, Entry> | null = null;

/** lazily parses the CC0 lichess-org/chess-openings EPD table once on first use */
function openingsMap(): Map<string, Entry> {
  if (table) return table;
  const map = new Map<string, Entry>();
  for (const line of openingsRaw.split('\n')) {
    if (!line) continue;
    const t1 = line.indexOf('\t');
    const t2 = line.indexOf('\t', t1 + 1);
    if (t1 <= 0 || t2 <= t1) continue;
    map.set(line.slice(0, t1), { eco: line.slice(t1 + 1, t2), name: line.slice(t2 + 1) });
  }
  table = map;
  return map;
}

/**
 * Looks up one position FEN in the opening table.
 * Checks the exact 4-field EPD first, then with `-` for en passant because chessops records
 * pseudo-en-passant squares while lichess-org/chess-openings keeps only legal en-passant squares.
 */
export function lookupOpening(fen: string): Entry | null {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return null;
  const map = openingsMap();
  const base = `${parts[0]} ${parts[1]} ${parts[2]}`;
  const exact = map.get(`${base} ${parts[3]}`);
  if (exact) return exact;
  if (parts[3] !== '-') return map.get(`${base} -`) ?? null;
  return null;
}

/**
 * Deepest recognized opening along a game's sequence of FENs (ply 0 = start position).
 * Scans backward from at most ply 50 (no ECO entry is deeper) so lookup costs microseconds.
 */
export function findOpening(fens: readonly string[]): OpeningInfo | null {
  const limit = Math.min(fens.length - 1, 50);
  for (let ply = limit; ply >= 0; ply--) {
    const fen = fens[ply];
    if (!fen) continue;
    const hit = lookupOpening(fen);
    if (hit) return { eco: hit.eco, name: hit.name, ply };
  }
  return null;
}

const isEcoCode = (s: string): boolean => /^[A-E]\d\d$/.test(s);

/**
 * Whether an opening's ECO code and name match a user filter, following fastchess-gui:
 * - an ECO range such as `B20-B99`
 * - an ECO code or prefix such as `B`, `B2`, `B90`
 * - otherwise, every space-separated word in any order against the opening name (case-insensitive)
 */
export function openingMatches(eco: string, name: string, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  const compact = trimmed.replaceAll(/\s+/g, '').toUpperCase();
  const code = eco.trim().toUpperCase();

  const dash = compact.indexOf('-');
  if (dash > 0) {
    const from = compact.slice(0, dash);
    const to = compact.slice(dash + 1);
    if (isEcoCode(from) && isEcoCode(to)) return isEcoCode(code) && code >= from && code <= to;
  }
  if (/^[A-E]\d{0,2}$/.test(compact)) return code.startsWith(compact);

  const haystack = `${code} ${name}`.toUpperCase();
  const words = trimmed.toUpperCase().split(/\s+/);
  return words.every((w) => haystack.includes(w));
}
