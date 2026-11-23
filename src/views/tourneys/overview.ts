/**
 * What the Tourneys overview shows of the tournaments in this browser: their groups by state, the
 * archive, the notices that want a look, each run's end by its pace, and the threads the running
 * ones ask for.
 */
import { bracket } from '../../match/director.ts';
import { problemOf, type Problem } from '../../match/referee.ts';
import type { GameRecord } from '../../match/summary.ts';
import type { Item } from '../../stores/tournaments.ts';
import { count, signed, spanText, whenText } from '../../ui/format.ts';
import { label, planned, roundName } from './show.ts';

export type Group = 'running' | 'stopped' | 'finished';

/** running in a tab, this one or another; stopped, whether by a person or a closed tab; finished */
export function groupOf(i: Item): Group {
  if (i.elsewhere || i.state.status === 'running' || i.state.status === 'stopping')
    return 'running';
  return i.ended === 'done' ? 'finished' : 'stopped';
}

// ── the archive ────────────────────────────────────────────────────────────

/** a finished tournament this long past its end goes into the archive */
export const ARCHIVE_DAYS = 30;
const DAY = 86_400_000;

/** when a tournament ended, or was made when no end is known */
const endOf = (i: Item): string => i.endedAt ?? i.config.created;

export const archived = (i: Item, now: number): boolean =>
  groupOf(i) === 'finished' && now - Date.parse(endOf(i)) > ARCHIVE_DAYS * DAY;

/** the archive's month of a tournament in local time, as `2026-10` */
export function monthOf(i: Item): string {
  const d = new Date(endOf(i));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const monthName = (key: string): string =>
  new Date(`${key}-15T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** the archived tournaments by month, newest month first, newest first within one */
export function archiveMonths(items: readonly Item[], now: number): [string, Item[]][] {
  const months = new Map<string, Item[]>();
  for (const i of items.filter((x) => archived(x, now)))
    months.set(monthOf(i), [...(months.get(monthOf(i)) ?? []), i]);
  return [...months]
    .toSorted((a, b) => b[0].localeCompare(a[0]))
    .map(([m, list]) => [m, list.toSorted((a, b) => endOf(b).localeCompare(endOf(a)))]);
}

export const endedText = (i: Item, now: number): string => whenText(endOf(i), now);

// ── abnormal endings ───────────────────────────────────────────────────────

/** the counts so far, kept per games array, which a run only appends to */
const tallies = new WeakMap<
  readonly GameRecord[],
  { seen: number; counts: Map<Problem, number> }
>();

/** a tournament's games that ended abnormally, by what ended them */
export function problemsOf(games: readonly GameRecord[]): Map<Problem, number> {
  let t = tallies.get(games);
  if (!t || t.seen > games.length) {
    t = { seen: 0, counts: new Map() };
    tallies.set(games, t);
  }
  for (; t.seen < games.length; t.seen++) {
    const p = problemOf(games[t.seen]?.reason ?? '');
    if (p) t.counts.set(p, (t.counts.get(p) ?? 0) + 1);
  }
  return t.counts;
}

const PROBLEM_WORDS: Record<Problem, [string, string]> = {
  time: ['time loss', 'time losses'],
  illegal: ['illegal move', 'illegal moves'],
  'no move': ['no-move forfeit', 'no-move forfeits'],
  failed: ['engine failure', 'engine failures'],
};

export const problemText = (p: Problem, n: number): string =>
  `${count(n)} ${PROBLEM_WORDS[p][n === 1 ? 0 : 1]}`;

/** a tournament's abnormal endings in a line, as `2 time losses, 1 illegal move` */
export const problemsLine = (games: readonly GameRecord[]): string =>
  [...problemsOf(games)].map(([p, n]) => problemText(p, n)).join(', ');

export const problemTotal = (games: readonly GameRecord[]): number =>
  [...problemsOf(games).values()].reduce((a, b) => a + b, 0);

// ── results in a line ──────────────────────────────────────────────────────

const half = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/**
 * where a tournament stands, in a line: a match's nElo, a knockout's round or winner, the leader's
 * points of those it could have had; empty before its first game
 */
export function standingText(i: Item): string {
  const s = i.state.summary;
  if (i.state.games.length === 0) return '';
  if (s.match) {
    const { value, ci } = s.match.nelo;
    return `nElo ${signed(value)} ± ${Number.isFinite(ci) ? ci.toFixed(1) : '—'}`;
  }
  const f = i.config.format;
  if (f.kind === 'knockout') {
    const rounds = bracket(i.config.entrants.length, f.pairs, i.state.pairs, i.state.games);
    const winner = rounds.at(-1)?.[0]?.winner ?? null;
    if (winner !== null) return `winner ${label(i, winner)}`;
    const r = rounds.findIndex((m) => m.some((t) => t.winner === null));
    if (r < 0) return '';
    const name = roundName(r, rounds.length);
    return name.startsWith('round') ? `playing ${name}` : `playing the ${name}`;
  }
  if (f.kind === 'gauntlet') {
    // a seed plays every game, so its points top the standings whatever its score
    return s.standings
      .filter((r) => r.entrant < f.seeds && r.games > 0)
      .toSorted((a, b) => a.entrant - b.entrant)
      .map((r) => `${label(i, r.entrant)} ${((100 * r.points) / r.games).toFixed(1)}%`)
      .join(' · ');
  }
  const top = s.standings[0];
  if (!top) return '';
  const words = i.ended === 'done' ? 'winner' : 'leader';
  return `${words} ${label(i, top.entrant)} · ${half(top.points)}/${top.games + top.byes}`;
}

// ── notices ────────────────────────────────────────────────────────────────

export interface Notice {
  /** bad stops a run or loses games to a fault; warn wants a look */
  severity: 'bad' | 'warn';
  /** the tournament it is about; empty for one about the browser */
  id: string;
  where: string;
  text: string;
}

/** what the notices check a tournament against */
export interface Served {
  engines: ReadonlySet<string>;
  books: ReadonlySet<string>;
  storage: { usage: number; quota: number } | null;
}

/** the engines and the book a resume needs that are no longer here */
export function lacking(i: Item, served: Served): { engines: string[]; book: string } {
  return {
    engines: [...new Set(i.config.entrants)].filter((e) => !served.engines.has(e)),
    book: i.config.book && !served.books.has(i.config.book) ? i.config.book : '',
  };
}

/** the share of the storage quota past which a notice warns */
export const STORAGE_WARN = 0.9;

/**
 * The problems that want a look, for the tournaments running or stopped: an error, a run its tab
 * left, games ended by a fault, an engine or book a resume needs and no longer has; and storage
 * near its quota. A finished tournament's faults show on its row instead, so notices clear.
 */
export function noticesOf(items: readonly Item[], served: Served): Notice[] {
  const out: Notice[] = [];
  for (const i of items) {
    const group = groupOf(i);
    if (group === 'finished') continue;
    const { id, name } = i.config;
    const note = (severity: Notice['severity'], text: string) =>
      out.push({ severity, id, where: name, text });
    if (i.state.error) note('bad', i.state.error);
    if (group === 'stopped') {
      if (i.ended === null) note('warn', 'Interrupted (tab closed)');
      const { engines, book } = lacking(i, served);
      if (engines.length > 0)
        note(
          'bad',
          `Cannot resume: missing ${engines.length === 1 ? 'engine' : 'engines'} ${engines.join(', ')}`,
        );
      if (book) note('bad', `Cannot resume: missing book ${book}`);
    }
    for (const [p, n] of problemsOf(i.state.games))
      note(p === 'time' ? 'warn' : 'bad', problemText(p, n));
  }
  const s = served.storage;
  if (s && s.quota > 0 && s.usage / s.quota > STORAGE_WARN)
    out.push({
      severity: 'warn',
      id: '',
      where: 'storage',
      text: `Storage ${Math.round((100 * s.usage) / s.quota)}% full`,
    });
  return out.toSorted((a, b) => (a.severity === b.severity ? 0 : a.severity === 'bad' ? -1 : 1));
}

// ── pace ───────────────────────────────────────────────────────────────────

export interface Eta {
  /** milliseconds still to play at the pace so far */
  ms: number;
  /** an SPRT may stop sooner, a knockout's tied matches play on */
  bound: 'about' | 'at most' | 'at least';
}

/**
 * the time a run in this tab still needs at its pace since it started; null until enough games of
 * this run have finished to time, or for a run in another tab
 */
export function etaOf(i: Item, now: number): Eta | null {
  if (!i.since || i.state.status !== 'running' || i.elsewhere) return null;
  const done = i.state.games.length - i.since.games;
  if (done < Math.max(2, Math.min(i.config.concurrency, 8))) return null;
  const left = Math.max(0, planned(i) - i.state.games.length);
  const f = i.config.format;
  return {
    ms: (left * Math.max(1000, now - i.since.at)) / done,
    bound: f.kind === 'match' && f.sprt ? 'at most' : f.kind === 'knockout' ? 'at least' : 'about',
  };
}

const BOUND_MARK: Record<Eta['bound'], string> = { about: '≈', 'at most': '≤', 'at least': '≥' };

export const etaText = (e: Eta): string => `${BOUND_MARK[e.bound]} ${spanText(e.ms)} left`;

// ── threads ────────────────────────────────────────────────────────────────

/** the games the running tournaments play at once, in every tab, against the machine's threads */
export function threadBudget(
  items: readonly Item[],
  hardware: number,
): { games: number; hardware: number } {
  return {
    games: items
      .filter((i) => groupOf(i) === 'running')
      .reduce((n, i) => n + i.config.concurrency, 0),
    hardware,
  };
}
