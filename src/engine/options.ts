import type { Format } from '../match/format.ts';
import { summarize } from '../match/summary.ts';
import type { Item } from '../stores/tournaments.ts';

/** One parsed UCI `option` declaration. */
export interface UciOption {
  name: string;
  type: string;
  defaultValue: string;
  range: string;
  /** lower bound for a `spin` option */
  min?: number;
  /** upper bound for a `spin` option */
  max?: number;
  /** choices for a `combo` option */
  vars?: string[];
}

/** One user-configured UCI option value. */
export type OptionValue = string | number | boolean;

/** Per-engine map of UCI option name to configured value. */
export type OptionValues = Record<string, OptionValue>;

/** Saved defaults for one engine: UCI option values and an optional per-side control label. */
export interface EngineOptionPreset {
  options: OptionValues;
  limit?: string;
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

  const opt: UciOption = {
    name: name.join(' '),
    type,
    defaultValue: def.join(' '),
    range,
  };
  const minNum = min !== '' ? Number(min) : Number.NaN;
  const maxNum = max !== '' ? Number(max) : Number.NaN;
  if (Number.isFinite(minNum)) opt.min = minNum;
  if (Number.isFinite(maxNum)) opt.max = maxNum;
  if (vars.length > 0) opt.vars = vars;
  return opt;
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

/** Parses and sorts a list of raw UCI `option` lines. */
export function parseOptionsList(raw: readonly string[]): UciOption[] {
  const out: UciOption[] = [];
  for (const line of raw) {
    const parsed = parseOption(line);
    if (parsed) out.push(parsed);
  }
  return sortOptions(out);
}

/** Reads structured bounds for an option, falling back to `range` for older cached entries. */
export function optionBounds(opt: UciOption): {
  min: number | undefined;
  max: number | undefined;
  vars: string[];
} {
  let min = opt.min;
  let max = opt.max;
  if (opt.type === 'spin' && min === undefined && max === undefined && opt.range.includes('..')) {
    const [a, b] = opt.range.split('..');
    const na = a ? Number(a) : Number.NaN;
    const nb = b ? Number(b) : Number.NaN;
    if (Number.isFinite(na)) min = na;
    if (Number.isFinite(nb)) max = nb;
  }
  const vars =
    opt.vars ??
    (opt.type === 'combo' && opt.range
      ? opt.range
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []);
  return { min, max, vars };
}

/** Typed default value for one UCI option. */
export function optionDefaultValue(opt: UciOption): OptionValue {
  if (opt.type === 'check') return opt.defaultValue.toLowerCase() === 'true';
  if (opt.type === 'spin') {
    const n = Number(opt.defaultValue);
    return Number.isFinite(n) ? n : (optionBounds(opt).min ?? 0);
  }
  return opt.defaultValue === '<empty>' ? '' : opt.defaultValue;
}

/** True when `value` is absent or matches the option's declared default. */
export function isDefaultOptionValue(opt: UciOption, value: OptionValue | undefined): boolean {
  if (value === undefined) return true;
  return value === optionDefaultValue(opt);
}

const HIDDEN_PLAY_OPTIONS = new Set(['syzygypath', 'debug log file']);

/** True for UCI options that have no browser-editable value in Play (buttons and file paths). */
export function isHiddenPlayOption(opt: UciOption): boolean {
  return opt.type === 'button' || HIDDEN_PLAY_OPTIONS.has(opt.name.toLowerCase());
}

const STRENGTH_ORDER = ['uci_limitstrength', 'uci_elo', 'skill level'];
const CORE_ORDER = ['hash', 'threads'];

/** Groups editable UCI options for Play's Edit panel: strength, resources, then everything else. */
export function groupPlayOptions(options: readonly UciOption[]): {
  strength: UciOption[];
  core: UciOption[];
  other: UciOption[];
} {
  const strength: UciOption[] = [];
  const core: UciOption[] = [];
  const other: UciOption[] = [];
  for (const opt of options) {
    if (isHiddenPlayOption(opt)) continue;
    const lo = opt.name.toLowerCase();
    if (STRENGTH_ORDER.includes(lo)) strength.push(opt);
    else if (CORE_ORDER.includes(lo)) core.push(opt);
    else other.push(opt);
  }
  strength.sort(
    (a, b) =>
      STRENGTH_ORDER.indexOf(a.name.toLowerCase()) - STRENGTH_ORDER.indexOf(b.name.toLowerCase()),
  );
  core.sort(
    (a, b) => CORE_ORDER.indexOf(a.name.toLowerCase()) - CORE_ORDER.indexOf(b.name.toLowerCase()),
  );
  other.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  return { strength, core, other };
}

/** Formats one UCI `setoption` line, stripping line breaks from string values. */
export function formatSetOption(name: string, value: OptionValue): string {
  const safeName = name.replaceAll(/[\r\n]+/g, ' ').trim();
  const safeVal = typeof value === 'string' ? value.replaceAll(/[\r\n]+/g, ' ') : String(value);
  return `setoption name ${safeName} value ${safeVal}`;
}

/** Terse labels for active overrides on one side, ordered limit → strength → resources → other. */
export function summarizeOverrides(
  options: readonly UciOption[],
  values: OptionValues,
  limit: string,
): string[] {
  const out: string[] = [];
  if (limit.trim()) out.push(limit.trim());
  const byName = new Map(options.map((o) => [o.name, o]));
  const grouped = groupPlayOptions(options);
  const ordered = [...grouped.strength, ...grouped.core, ...grouped.other];
  const seen = new Set<string>();
  for (const opt of ordered) {
    seen.add(opt.name);
    const val = values[opt.name];
    if (isDefaultOptionValue(opt, val)) continue;
    if (opt.type === 'check') out.push(val === true ? opt.name : `${opt.name} off`);
    else out.push(`${opt.name} ${String(val)}`);
  }
  // Include saved overrides even before UCI inspection finishes
  for (const [name, val] of Object.entries(values)) {
    if (seen.has(name) || byName.has(name)) continue;
    if (typeof val === 'boolean') out.push(val ? name : `${name} off`);
    else out.push(`${name} ${String(val)}`);
  }
  return out;
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
