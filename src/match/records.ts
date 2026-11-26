import type { Adjudication } from './adjudicate.ts';
import type { Format, Sprt, TournamentConfig } from './format.ts';
import type { GameRecord, PairRecord, Result } from './summary.ts';

/**
 * Reads a tournament's saved files back: its config, and one JSON line per pair issued and per game
 * finished. Each reader checks every field and throws on a record it does not know.
 */

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null;

function rec(x: unknown, what: string): Rec {
  if (!isRec(x)) throw new Error(`${what} is not a record`);
  return x;
}
function str(r: Rec, k: string): string {
  const v = r[k];
  if (typeof v !== 'string') throw new Error(`${k} is not text`);
  return v;
}
function int(r: Rec, k: string): number {
  const v = r[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${k} is not a number`);
  return v;
}

function sprtOf(x: unknown): Sprt | null {
  if (x === null) return null;
  const r = rec(x, 'sprt');
  return {
    elo0: int(r, 'elo0'),
    elo1: int(r, 'elo1'),
    alpha: int(r, 'alpha'),
    beta: int(r, 'beta'),
  };
}

function formatOf(x: unknown): Format {
  const r = rec(x, 'format');
  const kind = str(r, 'kind');
  if (kind === 'match') return { kind, pairs: int(r, 'pairs'), sprt: sprtOf(r.sprt) };
  if (kind === 'roundrobin') return { kind, cycles: int(r, 'cycles') };
  if (kind === 'gauntlet') return { kind, seeds: int(r, 'seeds'), cycles: int(r, 'cycles') };
  if (kind === 'swiss') return { kind, rounds: int(r, 'rounds') };
  if (kind === 'knockout') return { kind, pairs: int(r, 'pairs') };
  throw new Error(`the format ${kind} is not known`);
}

function adjudicationOf(x: unknown): Adjudication | null {
  if (x === null) return null;
  const r = rec(x, 'adjudication');
  const d = r.draw === null ? null : rec(r.draw, 'draw');
  const s = r.resign === null ? null : rec(r.resign, 'resign');
  return {
    draw: d && {
      moveNumber: int(d, 'moveNumber'),
      moveCount: int(d, 'moveCount'),
      score: int(d, 'score'),
    },
    resign: s && { moveCount: int(s, 'moveCount'), score: int(s, 'score') },
  };
}

export function configOf(text: string): TournamentConfig {
  const r = rec(JSON.parse(text), 'config');
  const entrants = r.entrants;
  if (!Array.isArray(entrants) || !entrants.every((e) => typeof e === 'string')) {
    throw new Error('entrants is not a list of engine ids');
  }
  return {
    id: str(r, 'id'),
    name: str(r, 'name'),
    created: str(r, 'created'),
    format: formatOf(r.format),
    entrants,
    control: str(r, 'control'),
    book: str(r, 'book'),
    adjudication: adjudicationOf(r.adjudication),
    concurrency: int(r, 'concurrency'),
    seed: int(r, 'seed'),
    // a config saved before one game per opening was offered played pairs
    paired: r.paired === undefined ? true : r.paired === true,
  };
}

const RESULTS: ReadonlySet<string> = new Set(['1-0', '0-1', '1/2-1/2']);
const isResult = (x: string): x is Result => RESULTS.has(x);

/** the records of a JSON-lines file; a line cut short by a closed tab is skipped */
function lines<T>(text: string | null, read: (r: Rec) => T): T[] {
  const out: T[] = [];
  for (const line of (text ?? '').split('\n')) {
    if (line.trim() === '') continue;
    try {
      out.push(read(rec(JSON.parse(line), 'line')));
    } catch {
      // a partial last line is what a tab closed mid-write leaves
    }
  }
  return out;
}

export function pairsOf(text: string | null): PairRecord[] {
  return lines(text, (r) => ({
    pair: int(r, 'pair'),
    a: int(r, 'a'),
    b: int(r, 'b'),
    round: int(r, 'round'),
    opening: str(r, 'opening'),
  }));
}

function optPos(r: Rec, k: string): number | undefined {
  const v = r[k];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;
}

export function gamesOf(text: string | null): GameRecord[] {
  return lines(text, (r) => {
    const result = str(r, 'result');
    if (!isResult(result)) throw new Error(`result ${result}`);
    const game = int(r, 'game');
    const wnps = optPos(r, 'wnps');
    const bnps = optPos(r, 'bnps');
    return {
      pair: int(r, 'pair'),
      game: game === 0 ? 0 : 1,
      white: int(r, 'white'),
      black: int(r, 'black'),
      result,
      reason: str(r, 'reason'),
      plies: int(r, 'plies'),
      ...(wnps !== undefined ? { wnps } : {}),
      ...(bnps !== undefined ? { bnps } : {}),
    };
  });
}
