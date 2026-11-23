import type { Format } from '../match/format.ts';
import { summarize } from '../match/summary.ts';
import type { Item } from '../stores/tournaments.ts';

/** One parsed UCI `option` declaration. */
export interface UciOption {
  name: string;
  type: string;
  defaultValue: string;
  range: string;
}

const KEYWORDS = new Set(['name', 'type', 'default', 'min', 'max', 'var']);

/**
 * Parses one UCI `option name ... type ...` line.
 * Returns null if the line lacks a name or type.
 */
export function parseOption(line: string): UciOption | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== 'option') return null;

  let section = '';
  const name: string[] = [];
  let type = '';
  const def: string[] = [];
  let min = '';
  let max = '';
  const vars: string[] = [];
  let currentVar: string[] = [];

  const flushVar = () => {
    if (currentVar.length > 0) {
      vars.push(currentVar.join(' '));
      currentVar = [];
    }
  };

  for (const tok of tokens.slice(1)) {
    if (KEYWORDS.has(tok) && !(section === 'default' && tok === 'name')) {
      if (section === 'var') flushVar();
      section = tok;
      continue;
    }
    if (section === 'name') name.push(tok);
    else if (section === 'type' && !type) type = tok;
    else if (section === 'default') def.push(tok);
    else if (section === 'min' && !min) min = tok;
    else if (section === 'max' && !max) max = tok;
    else if (section === 'var') currentVar.push(tok);
  }
  if (section === 'var') flushVar();

  if (name.length === 0 || !type) return null;
  let range = '';
  if (min !== '' || max !== '') range = `${min}..${max}`;
  else if (vars.length > 0) range = vars.join(', ');

  return {
    name: name.join(' '),
    type,
    defaultValue: def.join(' '),
    range,
  };
}

/** Sorts UCI options with Hash and Threads first, then alphabetically. */
export function sortOptions(options: readonly UciOption[]): UciOption[] {
  const rank = (name: string) => {
    const lo = name.toLowerCase();
    if (lo === 'hash') return 0;
    if (lo === 'threads') return 1;
    return 2;
  };
  return [...options].toSorted((a, b) => {
    const d = rank(a.name) - rank(b.name);
    return d !== 0 ? d : a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  });
}

/** One position in a speed probe suite. */
export interface ProbePosition {
  label: string;
  /** text after `position`, e.g. `startpos` or `fen ...` */
  position: string;
}

export type ProbeSuite = 'startpos' | 'three';

/** Fixed speed-probe suites: single startpos, or opening + middlegame + endgame. */
export const PROBE_SUITES: Record<ProbeSuite, readonly ProbePosition[]> = {
  startpos: [{ label: 'Startpos', position: 'startpos' }],
  three: [
    { label: 'Startpos', position: 'startpos' },
    {
      label: 'Middlegame',
      position: 'fen r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    },
    {
      label: 'Endgame',
      position: 'fen 8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    },
  ],
};

/** One tournament row for an engine's local results summary. */
export interface EngineTournamentRow {
  id: string;
  name: string;
  format: Format;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  scorePct: number | null;
}

/** Aggregate and per-tournament local results for one engine id. */
export interface EngineResults {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  scorePct: number | null;
  tournaments: EngineTournamentRow[];
}

/** Computes an engine's local W/D/L record across stored tournaments. */
export function engineResults(engineId: string, items: readonly Item[]): EngineResults {
  let games = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  const tournaments: EngineTournamentRow[] = [];

  for (const item of items) {
    const idx = item.config.entrants.indexOf(engineId);
    if (idx < 0) continue;
    const summary = summarize(
      item.config.format,
      item.config.entrants.length,
      item.state.games,
      item.state.pairs,
      item.config.paired,
    );
    const standing = summary.standings.find((s) => s.entrant === idx);
    if (!standing) continue;
    games += standing.games;
    wins += standing.wins;
    draws += standing.draws;
    losses += standing.losses;
    const scorePct =
      standing.games > 0 ? ((standing.wins + 0.5 * standing.draws) / standing.games) * 100 : null;
    tournaments.push({
      id: item.config.id,
      name: item.config.name,
      format: item.config.format,
      games: standing.games,
      wins: standing.wins,
      draws: standing.draws,
      losses: standing.losses,
      scorePct,
    });
  }

  const scorePct = games > 0 ? ((wins + 0.5 * draws) / games) * 100 : null;
  return { games, wins, draws, losses, scorePct, tournaments };
}
