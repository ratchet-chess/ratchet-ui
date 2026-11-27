/** One UCI `info` line, as far as the app reads it. */
export interface Info {
  depth?: number;
  seldepth?: number;
  multipv?: number;
  /** centipawns from the side to move; absent when the line gives a mate */
  cp?: number;
  /** moves to mate from the side to move, negative when it is mated */
  mate?: number;
  /** set when the score is only a bound */
  bound?: 'lower' | 'upper';
  nodes?: number;
  nps?: number;
  /** milliseconds */
  time?: number;
  /** per mille of the hash table in use */
  hashfull?: number;
  pv?: string[];
  /** the free text after `info string` */
  string?: string;
}

const NUMERIC = ['depth', 'seldepth', 'multipv', 'nodes', 'nps', 'time', 'hashfull'] as const;
type NumericKey = (typeof NUMERIC)[number];
const isNumeric = (key: string): key is NumericKey => (NUMERIC as readonly string[]).includes(key);

/** Reads an `info` line; returns null for any other line. Tokens it does not know are skipped. */
export function parseInfo(line: string): Info | null {
  const t = line.trim().split(/\s+/);
  if (t[0] !== 'info') return null;
  const info: Info = {};
  for (let i = 1; i < t.length; i++) {
    const key = t[i] ?? '';
    if (key === 'string') {
      info.string = t.slice(i + 1).join(' ');
      break;
    }
    if (key === 'pv') {
      info.pv = t.slice(i + 1);
      break;
    }
    if (key === 'score') {
      const kind = t[i + 1];
      if (kind === 'cp' || kind === 'mate') {
        const value = Number(t[i + 2]);
        if (Number.isFinite(value)) info[kind] = value;
        i += 2;
        const next = t[i + 1];
        if (next === 'lowerbound' || next === 'upperbound') {
          info.bound = next === 'lowerbound' ? 'lower' : 'upper';
          i++;
        }
      }
      continue;
    }
    if (isNumeric(key)) {
      const value = Number(t[i + 1]);
      if (Number.isFinite(value)) info[key] = value;
      i++;
    }
  }
  return info;
}
