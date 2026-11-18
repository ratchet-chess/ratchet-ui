/** How Tourneys writes a tournament for a reader: shared by the list, the setup and a tournament's page. */
import { plannedGames, type Format } from '../../match/format.ts';
import type { Item } from '../../stores/tournaments.ts';

/** an entrant's name; an engine entered twice gets #1, #2 in field order */
export const label = (i: Item, n: number): string => {
  const id = i.config.entrants[n] ?? '?';
  return i.config.entrants.filter((x) => x === id).length > 1
    ? `${id} #${i.config.entrants.slice(0, n + 1).filter((x) => x === id).length}`
    : id;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** the format in full, as a tournament's page heads it */
export function formatText(f: Format): string {
  if (f.kind === 'match') {
    return f.sprt
      ? `SPRT nElo [${f.sprt.elo0}, ${f.sprt.elo1}], up to ${f.pairs * 2} games`
      : `match of ${f.pairs * 2} games`;
  }
  if (f.kind === 'roundrobin') return `round robin, ${plural(f.cycles, 'cycle')}`;
  if (f.kind === 'swiss') return `Swiss, ${plural(f.rounds, 'round')}`;
  if (f.kind === 'knockout') return `knockout, ${plural(f.pairs, 'pair')} a match, more while tied`;
  return `gauntlet, ${plural(f.seeds, 'seed')}, ${plural(f.cycles, 'cycle')}`;
}

/** the format in a few words, for a line of the list */
export function formatShort(f: Format): string {
  if (f.kind === 'match') return f.sprt ? `SPRT [${f.sprt.elo0}, ${f.sprt.elo1}]` : 'match';
  if (f.kind === 'roundrobin') return f.cycles > 1 ? `round robin ×${f.cycles}` : 'round robin';
  if (f.kind === 'swiss') return `Swiss, ${plural(f.rounds, 'round')}`;
  if (f.kind === 'knockout') return 'knockout';
  return f.seeds > 1 ? `gauntlet, ${f.seeds} seeds` : 'gauntlet';
}

export const planned = (i: Item): number => plannedGames(i.config.format, i.config.entrants.length);

/** games played over games planned; a knockout plays at least its planned games */
export const progress = (i: Item): string =>
  i.config.format.kind === 'knockout'
    ? `${i.state.games.length} of ${planned(i)} or more`
    : `${i.state.games.length}/${planned(i)}`;

/** `progress` in the list's few characters */
export const progressShort = (i: Item): string =>
  i.config.format.kind === 'knockout'
    ? `${i.state.games.length}/${planned(i)}+`
    : `${i.state.games.length}/${planned(i)}`;

export const pct = (i: Item): number =>
  Math.min(100, (100 * i.state.games.length) / Math.max(1, planned(i)));

export function statusText(i: Item): string {
  if (i.elsewhere) return 'in another tab';
  if (i.state.status === 'running') return 'running';
  if (i.state.status === 'stopping') return 'stopping';
  if (i.ended === 'done') return i.state.summary.match?.verdict ?? 'done';
  return i.ended === 'stopped' ? 'stopped' : 'interrupted';
}

export const statusClass = (s: string): string =>
  s === 'H1'
    ? 'text-good border-[#2c6b4d]'
    : s === 'H0'
      ? 'text-bad border-[#7a3a30]'
      : s === 'running' || s === 'in another tab'
        ? 'text-accent border-[#2c4a66]'
        : s === 'interrupted'
          ? 'text-warn border-[#7a5d24]'
          : 'text-dim border-line';

/** a signed value; an unbounded one, as an all-or-nothing score gives, shows as ±∞ */
export const fmt = (v: number, d = 1): string =>
  Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(d)}` : v > 0 ? '+∞' : '−∞';

export const th = 'border-b border-line px-2 py-1 font-medium whitespace-nowrap';
export const inputClass =
  'num rounded border border-line bg-panel2 px-1.5 py-0.5 text-[12.5px] text-text';
export const buttonClass =
  'rounded border border-line bg-panel2 px-2.5 py-1 text-xs disabled:text-faint';
