/** How the manager view writes a host and a job for a reader: shared by Jobs, Hosts and the header. */
import type { Host, Job, Summary } from './api.ts';
import { count, signed } from '../ui/format.ts';

const DAY = 86_400_000;

type Tone = 'accent' | 'live' | 'bad' | 'good' | 'warn';

/** a job's units, less the cancelled ones, which no host will play */
export const unitsPlanned = (j: Job): number =>
  (j.units.queued ?? 0) + (j.units.running ?? 0) + (j.units.done ?? 0) + (j.units.failed ?? 0);

/** a job's bar: units done, failed and in play, as shares of its planned units */
export function unitParts(j: Job): { share: number; tone: Tone }[] {
  const all = unitsPlanned(j);
  if (all === 0) return [];
  const share = (n: number | undefined) => (100 * (n ?? 0)) / all;
  return [
    { share: share(j.units.done), tone: 'accent' as const },
    { share: share(j.units.failed), tone: 'bad' as const },
    { share: share(j.units.running), tone: 'live' as const },
  ].filter((p) => p.share > 0);
}

/** `923 of 6,252 units` */
export const unitsText = (j: Job): string =>
  `${count(j.units.done ?? 0)} of ${count(unitsPlanned(j))} unit${unitsPlanned(j) === 1 ? '' : 's'}`;

/** a clock time, with its day when that is not today: `10:05`, `tomorrow 02:10`, `Nov 22 09:00` */
export function clockText(ms: number, now: number): string {
  const t = new Date(ms);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(t) - day(new Date(now))) / DAY);
  const clock = t.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  if (days === 0) return clock;
  if (days === 1) return `tomorrow ${clock}`;
  if (days === -1) return `yesterday ${clock}`;
  return `${t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${clock}`;
}

/** when a running job should end: `≈ 10:05`, or `by 10:05` when its unit count is a ceiling; '' with no estimate */
export const endText = (j: Job, now: number): string =>
  j.endsAt === null ? '' : `${j.atMost ? 'by' : '≈'} ${clockText(j.endsAt, now)}`;

/** the name of the manager's check that refused a unit, which begins its reason: `hours: outside its hours` */
const FILTER_NAME = /^(hosts|requires|taints|hours|units|concurrency|kinds): /;

/**
 * Why a job's queued units wait, in one line: the reason all its hosts share, or each host's own. A host says nothing
 * here when its units would start at its next claim, or when it already runs as many of them as it may. A reason
 * is shown without the name of the check that gave it.
 */
export function waitingText(j: Job): string {
  // with no unit queued nothing waits, whatever each host says of the job
  if ((j.units.queued ?? 0) === 0) return '';
  const all = Object.entries(j.waiting ?? {});
  const rows = all
    .filter(
      ([, why]) =>
        why !== '' &&
        !why.startsWith('starts at') &&
        !why.startsWith('concurrency:') &&
        // the job's queued units are for other hosts, so this host holds none back
        !why.startsWith('units: no unit'),
    )
    .map(([host, why]): [string, string] => [host, why.replace(FILTER_NAME, '')]);
  const first = rows[0];
  if (first === undefined) return '';
  // a reason stands without a host's name only when every host waits for it
  if (rows.length === all.length && rows.every(([, why]) => why === first[1])) return first[1];
  return rows.map(([host, why]) => `${host}: ${why}`).join(' · ');
}

/** what a job plays, as its producer names the two sides: `candidate vs base`; any other job keeps its name */
export const jobTitle = (j: Job): string =>
  j.summary !== null && j.summary.candidate !== '' && j.summary.base !== ''
    ? `${j.summary.candidate} vs ${j.summary.base}`
    : j.name;

/** a job's test and clock in its producer's words: `nElo [0, 10] · 6+0.06`; '' when it names neither */
export const testText = (j: Job): string =>
  [j.summary?.test ?? '', j.summary?.tc ?? ''].filter((t) => t !== '').join(' · ');

/** where a job's run stands: its producer's own line, or `nElo +3.1 ± 4.2 · 3,692 games`; '' before its first game */
export function outcomeText(j: Job): string {
  const s = j.summary;
  if (s === null) return '';
  if (s.line !== '') return s.line;
  if (s.games === null || s.games === 0) return '';
  const games = `${count(s.games)} game${s.games === 1 ? '' : 's'}`;
  return s.nelo === null
    ? games
    : `nElo ${signed(s.nelo.value)} ± ${s.nelo.ci.toFixed(1)} · ${games}`;
}

/** an ended run's verdict in its producer's word, with its tag's tone; null while it runs, and with no summary */
export function verdictTag(j: Job): { text: string; tone: string } | null {
  const v = j.summary?.verdict ?? '';
  if (v === '' || v === 'running') return null;
  const tone =
    v === 'H1' || v.startsWith('admitted')
      ? 'tone-good'
      : v === 'H0' || v.startsWith('rejected')
        ? 'tone-bad'
        : v === 'interrupted'
          ? 'tone-warn'
          : 'tone-dim';
  return { text: v, tone };
}

/** a job's one word for a tag: its run's verdict, or else its state, with `stopped` for a job whose queued units were dropped */
export function statusTag(j: Job): { text: string; tone: string } {
  return (
    verdictTag(j) ?? {
      text: j.state === 'cancelled' ? 'stopped' : j.state,
      tone: j.state === 'running' ? 'tone-accent' : 'tone-dim',
    }
  );
}

/** a run's setup in one line, from what its producer names: `nElo [0, 10] · 6+0.06 · Hash 2 · 8moves_v3.pgn · SPEED 0.998` */
export const setupText = (s: Summary): string =>
  [
    s.test,
    s.tc,
    s.hash === '' ? '' : `Hash ${s.hash}`,
    s.book,
    s.speed === null ? '' : `SPEED ${s.speed}`,
  ]
    .filter((t) => t !== '')
    .join(' · ');

/**
 * When a running job should end, for its page: by its SPRT's pace when its producer gives one, and by its units.
 * `≈ 10:05 at the LLR's pace · by 13:40 at the latest`
 */
export function endsText(j: Job, now: number): string {
  const pace = j.summary?.pace ?? null;
  const byUnits = j.endsAt === null ? '' : endText(j, now);
  if (j.state !== 'running') return byUnits;
  const byPace = pace === null ? '' : `≈ ${clockText(pace.at, now)} at the LLR's pace`;
  return [byPace, byUnits === '' || !j.atMost ? byUnits : `${byUnits} at the latest`]
    .filter((t) => t !== '')
    .join(' · ');
}

/** a unit's mean time on a host: `1 min 50 s`, `45 s`; a dash before the host has played one */
export function unitTimeText(ms: number | null): string {
  if (ms === null) return '—';
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  return s % 60 === 0 ? `${s / 60} min` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/**
 * The line under a running job's units: that it is finishing, once every unit has started and only those in play
 * are left; before that, why its queued units wait. A job of one unit says nothing of its last unit.
 */
export function unitsNote(j: Job): string {
  const inPlay = j.units.running ?? 0;
  if (j.state === 'running' && (j.units.queued ?? 0) === 0 && inPlay > 0 && unitsPlanned(j) > 1)
    return inPlay === 1
      ? 'its last unit is in play'
      : `its last ${count(inPlay)} units are in play`;
  return waitingText(j);
}

/** a host's units in play, by job: `931×12 924×18` */
export const runningText = (h: Host): string =>
  h.running.map((r) => `${r.job}×${r.units}`).join(' ');

/** how many units a host runs now */
export const runningUnits = (h: Host): number => h.running.reduce((n, r) => n + r.units, 0);

export interface Notice {
  severity: 'bad' | 'warn';
  where: string;
  to?: string;
  text: string;
}

/** what wants a look: a host that takes no work and says why, and a job's failed units */
export function notices(hosts: readonly Host[], jobs: readonly Job[]): Notice[] {
  const out: Notice[] = [];
  for (const j of jobs) {
    const failed = j.units.failed ?? 0;
    if (failed > 0 && j.state !== 'done' && j.state !== 'cancelled')
      out.push({
        severity: 'bad',
        where: `job ${j.id}`,
        to: `/jobs/${j.id}`,
        text: `${count(failed)} unit${failed === 1 ? '' : 's'} failed`,
      });
  }
  for (const h of hosts) {
    if (h.condition === 'silent')
      out.push({ severity: 'bad', where: h.name, to: '/hosts', text: `silent: ${h.reason}` });
    // a host closed by its own hours is on schedule, so it is no notice
    else if (
      h.condition !== 'open' &&
      h.condition !== 'allocated' &&
      !h.reason.startsWith('outside its hours')
    )
      out.push({
        severity: 'warn',
        where: h.name,
        to: '/hosts',
        text: `${h.condition}: ${h.reason}`,
      });
  }
  return out;
}

/** the header's line: `6 of 7 hosts open · 3 jobs running` */
export function headline(hosts: readonly Host[], jobs: readonly Job[]): string {
  const open = hosts.filter((h) => h.condition === 'open').length;
  const running = jobs.filter((j) => j.state === 'running' && !j.allocation).length;
  return `${open} of ${hosts.length} hosts open · ${running} job${running === 1 ? '' : 's'} running`;
}

/**
 * Why a read failed, for a reader. A page served over HTTPS cannot read an http address: the browser blocks it
 * before the request leaves, so the app says that and not "no answer".
 */
export function unreachableText(url: string, pageProtocol: string, error: string): string {
  if (pageProtocol === 'https:' && url.startsWith('http://'))
    return 'This page is served over HTTPS, and a browser lets such a page read no http address. Open the app from this network over http.';
  return error.startsWith('the manager') ? error : `no answer from ${url}`;
}
