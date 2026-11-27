/**
 * What the Tourneys overview shows of the tournaments in this browser: their groups by state, the
 * archive, the notices that want a look, what the queue waits for, each run's end by its pace, and
 * the threads the running ones ask for.
 */
import { bracket } from '../../match/director.ts';
import { analyzeDrift, driftLines, type DriftReport } from '../../match/drift.ts';
import { gamesPerPair } from '../../match/format.ts';
import { problemOf, type Problem } from '../../match/referee.ts';
import type { GameRecord } from '../../match/summary.ts';
import { inOrder, lacking } from '../../stores/queue.ts';
import type { Item } from '../../stores/tournaments.ts';
import { clockText, count, signed, spanText, whenText } from '../../ui/format.ts';
import { label, planned, roundName } from './show.ts';

export type Group = 'running' | 'queued' | 'stopped' | 'finished';

/**
 * running in a tab, this one or another; waiting in the queue; stopped, whether by a person or a
 * closed tab; finished
 */
export function groupOf(i: Item): Group {
  if (i.elsewhere || i.state.status === 'running' || i.state.status === 'stopping')
    return 'running';
  if (i.queued !== null) return 'queued';
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

/** the share of the storage quota past which a notice warns */
export const STORAGE_WARN = 0.9;

/** cached drift analysis per games array, invalidated whenever games are appended */
const driftCache = new WeakMap<
  readonly GameRecord[],
  { len: number; control: string; paired: boolean; report: DriftReport }
>();

function driftOf(i: Item): DriftReport {
  const games = i.state.games;
  const cached = driftCache.get(games);
  if (
    cached &&
    cached.len === games.length &&
    cached.control === i.config.control &&
    cached.paired === i.config.paired
  )
    return cached.report;
  const report = analyzeDrift(i.config.control, games, i.config.paired);
  driftCache.set(games, {
    len: games.length,
    control: i.config.control,
    paired: i.config.paired,
    report,
  });
  return report;
}

/**
 * The problems that want a look, for the tournaments running, queued or stopped: an error, a run
 * its tab left, games ended by a fault, an engine or book a start or a resume needs and no longer
 * has; and storage near its quota. A finished tournament's faults show on its row instead, so
 * notices clear. The queue passes over a queued tournament that cannot start.
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
    if (group === 'stopped' && i.ended === null) note('warn', 'Interrupted (tab closed)');
    if (group === 'stopped' || group === 'queued') {
      const verb = group === 'stopped' ? 'Cannot resume' : 'Cannot start';
      const { engines, book } = lacking(i.config, served);
      if (engines.length > 0)
        note(
          'bad',
          `${verb}: missing ${engines.length === 1 ? 'engine' : 'engines'} ${engines.join(', ')}`,
        );
      if (book) note('bad', `${verb}: missing book ${book}`);
    }
    for (const [p, n] of problemsOf(i.state.games))
      note(p === 'time' ? 'warn' : 'bad', problemText(p, n));
    for (const line of driftLines(driftOf(i), (idx) => label(i, idx))) note('warn', line);
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

/** what the Tourneys icon shows: the tournaments running in this browser, and whether a notice is bad */
export function badgeOf(items: readonly Item[], served: Served): { running: number; bad: boolean } {
  return {
    running: items.filter((i) => groupOf(i) === 'running').length,
    bad: noticesOf(items, served).some((n) => n.severity === 'bad'),
  };
}

// ── the queue ──────────────────────────────────────────────────────────────

/** what the queue waits for, in a few words; empty when nothing is queued */
export function queueNote(items: readonly Item[], paused: boolean): string {
  if (!items.some((i) => groupOf(i) === 'queued')) return '';
  const running = items.filter((i) => groupOf(i) === 'running').length;
  if (running > 0)
    return running === 1 ? 'starts when the run ends' : `starts when ${running} runs end`;
  return paused ? 'waiting · paused' : 'waiting · Start now';
}

/** a queued tournament's place, and when it starts, in a few words */
export function queuePlace(
  i: Item,
  items: readonly Item[],
  paused: boolean,
): { place: number; of: number; starts: string } {
  const queue = inOrder(items);
  const k = queue.indexOf(i);
  const running = items.filter((x) => groupOf(x) === 'running').length;
  const runs = running === 1 ? 'the run ends' : `${running} runs end`;
  const ahead = k > 0 ? `, then ${k} queued before it` : '';
  return {
    place: k + 1,
    of: queue.length,
    starts:
      running > 0
        ? `after ${runs}${ahead}`
        : paused
          ? 'waiting · paused'
          : k > 0
            ? `after ${k} queued before it`
            : 'waiting · Start now, or when a run ends done',
  };
}

// ── pace ───────────────────────────────────────────────────────────────────

export interface Eta {
  /** milliseconds still to play at the pace so far */
  ms: number;
  /** milliseconds of the run's time a game has taken, with its concurrent games */
  perGame: number;
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
  const perGame = Math.max(1000, now - i.since.at) / done;
  return {
    ms: left * perGame,
    perGame,
    bound: f.kind === 'match' && f.sprt ? 'at most' : f.kind === 'knockout' ? 'at least' : 'about',
  };
}

const BOUND_MARK: Record<Eta['bound'], string> = { about: '≈', 'at most': '≤', 'at least': '≥' };

export const etaText = (e: Eta): string => `${BOUND_MARK[e.bound]} ${spanText(e.ms)} left`;

/**
 * the pairs an SPRT still needs to reach the bound its LLR drifts toward, at the drift so far; null
 * before any drift shows. ratchet-bench's tools/pool.ts estimates a job's end the same way.
 */
export function pairsToBound(
  llr: number,
  pairs: number,
  b: { lower: number; upper: number },
): number | null {
  if (pairs === 0 || llr === 0 || !Number.isFinite(llr)) return null;
  return Math.max(0, (pairs * ((llr > 0 ? b.upper : b.lower) - llr)) / llr);
}

/**
 * when a run in this tab ends, as clock times: for an SPRT by the LLR's pace and at the latest, else
 * by the game pace; '' without an estimate
 */
export function endsText(i: Item, now: number): string {
  const eta = etaOf(i, now);
  if (!eta) return '';
  const at = clockText(now + eta.ms, now);
  const m = i.state.summary.match;
  if (eta.bound !== 'at most' || !m?.bounds || m.llr === null)
    return `${BOUND_MARK[eta.bound]} ${at}`;
  const left = pairsToBound(m.llr, i.state.summary.pairsDone, m.bounds);
  const per = gamesPerPair(i.config.format, i.config.paired);
  const byPace = left === null ? null : left * per * eta.perGame;
  if (byPace === null || byPace >= eta.ms) return `${at} at the latest`;
  return `≈ ${clockText(now + byPace, now)} by the LLR's pace · ${at} at the latest`;
}

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
