/** How Tourneys writes a tournament for a reader: shared by the list, the setup and a tournament's page. */
import { knockoutGamesLeft } from '../../match/director.ts';
import { gamesPerPair, plannedGames, type Format } from '../../match/format.ts';
import type { Item } from '../../stores/tournaments.ts';
import { count } from '../../ui/format.ts';

/** an entrant's name; an engine entered twice gets #1, #2 in field order */
export const label = (i: Item, n: number): string => {
  const id = i.config.entrants[n] ?? '?';
  return i.config.entrants.filter((x) => x === id).length > 1
    ? `${id} #${i.config.entrants.slice(0, n + 1).filter((x) => x === id).length}`
    : id;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** the format in full, as a tournament's page heads it */
export function formatText(f: Format, paired = true): string {
  if (f.kind === 'match') {
    const games = f.pairs * gamesPerPair(f, paired);
    return f.sprt
      ? `SPRT nElo [${f.sprt.elo0}, ${f.sprt.elo1}], up to ${games} games`
      : `match of ${games} games`;
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

/** a knockout round's name, from the last: final, semifinals, then by number */
export const roundName = (r: number, total: number): string =>
  r === total - 1 ? 'final' : r === total - 2 ? 'semifinals' : `round ${r + 1}`;

/**
 * the games a tournament plays: all of them, the most for an SPRT; for a knockout, the games played
 * and the fewest still to come, which grows as tied matches play on
 */
export function planned(i: Item): number {
  const f = i.config.format;
  if (f.kind !== 'knockout') return plannedGames(f, i.config.entrants.length, i.config.paired);
  const { pairs, games } = i.state;
  return games.length + knockoutGamesLeft(i.config.entrants.length, f.pairs, pairs, games);
}

/**
 * games played over games planned; a knockout plays at least its planned games, and a finished
 * tournament shows the games it played, as an SPRT ends before its most
 */
export function progress(i: Item): string {
  const n = count(i.state.games.length);
  if (i.ended === 'done') return n;
  return i.config.format.kind === 'knockout'
    ? `${n} of ${count(planned(i))} or more`
    : `${n}/${count(planned(i))}`;
}

/** `progress` in the list's few characters */
export function progressShort(i: Item): string {
  const n = count(i.state.games.length);
  if (i.ended === 'done') return n;
  return i.config.format.kind === 'knockout'
    ? `${n}/${count(planned(i))}+`
    : `${n}/${count(planned(i))}`;
}

export const pct = (i: Item): number =>
  i.ended === 'done' ? 100 : Math.min(100, (100 * i.state.games.length) / Math.max(1, planned(i)));

export function statusText(i: Item): string {
  if (i.elsewhere) return 'in another tab';
  if (i.state.status === 'running') return 'running';
  if (i.state.status === 'stopping') return 'stopping';
  if (i.ended === 'done') return i.state.summary.match?.verdict ?? 'done';
  return i.ended === 'stopped' ? 'stopped' : 'interrupted';
}

/** the tone of a status's tag: a verdict's color, running in the accent, interrupted as a warning */
export const statusClass = (s: string): string =>
  s === 'H1'
    ? 'tone-good'
    : s === 'H0'
      ? 'tone-bad'
      : s === 'running' || s === 'in another tab'
        ? 'tone-accent'
        : s === 'interrupted'
          ? 'tone-warn'
          : 'tone-dim';

/**
 * a clone's name: its source's with the next free number, `X (2)`, `X (3)`; a clone of `X (2)`
 * counts from `X` too
 */
export function cloneName(source: string, taken: readonly string[]): string {
  const base = source.replace(/ \(\d+\)$/, '');
  let n = 1;
  for (const t of taken) {
    if (t === base) n = Math.max(n, 1);
    const m = t.startsWith(`${base} (`) ? /^ \((\d+)\)$/.exec(t.slice(base.length)) : null;
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `${base} (${n + 1})`;
}
