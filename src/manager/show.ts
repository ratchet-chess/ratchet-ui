/** How the manager view writes a host and a job for a reader: shared by Jobs, Hosts and the header. */
import type { Host, Job, Summary, TunedValue, Wait } from './api.ts';
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

/**
 * A host's wait in a few words, as a job's line groups the hosts by it: `behind 1087`, `full`. '' when nothing
 * but the job's own units holds it: its next unit starts at the host's next claim, or it runs all it may there.
 */
function waitWords(w: Wait): string {
  switch (w.by) {
    case 'host':
      return w.condition;
    case 'filter':
      return w.filter === 'concurrency' ? '' : w.reason;
    case 'ahead':
      return `behind ${w.job}`;
    case 'heads':
      return w.full === null ? 'busy' : 'full';
    case 'start':
      return '';
  }
}

/** a host's wait as the job page's host table shows it: its few words, and a full host's units against its cap */
export const waitCell = (w: Wait | undefined): string =>
  w === undefined
    ? ''
    : w.by === 'heads' && w.full !== null
      ? `full ${w.full.runs}/${w.full.cap}`
      : waitWords(w);

/** the hosts' waits for a job's queued units, one line per host in the manager's words, for a tooltip */
export const waitingDetail = (j: Job): string =>
  (j.units.queued ?? 0) === 0
    ? ''
    : Object.entries(j.waiting ?? {})
        .map(([host, w]) => `${host}: ${w.text}`)
        .join('\n');

/**
 * Why a job's queued units wait, in one line: each reason with how many hosts give it, `behind 1087 on 6 hosts`,
 * or the host's name when one does.
 */
export function waitingText(j: Job): string {
  // with no unit queued nothing waits, whatever each host says of the job
  if ((j.units.queued ?? 0) === 0) return '';
  const by = new Map<string, string[]>();
  for (const [host, w] of Object.entries(j.waiting ?? {})) {
    const words = waitWords(w);
    if (words !== '') by.set(words, [...(by.get(words) ?? []), host]);
  }
  return [...by]
    .map(
      ([words, hosts]) => `${words} on ${hosts.length === 1 ? hosts[0] : `${hosts.length} hosts`}`,
    )
    .join(' · ');
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

/** an SPRT's LLR as its verdict reads it: at the decision once there is one, so it stays past the bound it crossed */
export function verdictLlr(s: Summary): Summary['llr'] {
  return s.llr && s.decision ? { ...s.llr, value: s.decision.llr } : s.llr;
}

/**
 * The LLR card's line once units that ended after the decision added pairs: where the decision was, and the LLR over
 * every pair. `at 798 pairs · 2.70 over all`; '' when the final counts are the decision's.
 */
export function decisionText(s: Summary): string {
  if (!s.llr || !s.decision || s.games === null || s.games / 2 <= s.decision.pairs) return '';
  return `at ${count(s.decision.pairs)} pairs · ${s.llr.value.toFixed(2)} over all`;
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
 * That a running job is finishing, once every unit has started and only those in play are left; else ''. A job of
 * one unit says nothing of its last unit.
 */
export function finishingText(j: Job): string {
  const inPlay = j.units.running ?? 0;
  if (j.state === 'running' && (j.units.queued ?? 0) === 0 && inPlay > 0 && unitsPlanned(j) > 1)
    return inPlay === 1
      ? 'its last unit is in play'
      : `its last ${count(inPlay)} units are in play`;
  return '';
}

/** the line under a running job's units in a list: that it is finishing, else why its queued units wait */
export const unitsNote = (j: Job): string => finishingText(j) || waitingText(j);

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

/** where a number sits between two bounds, in percent, held to the track */
export const placeAt = (x: number, lo: number, hi: number): number =>
  hi > lo ? (100 * (Math.min(hi, Math.max(lo, x)) - lo)) / (hi - lo) : 50;

/** a tune's value as its table shows it: whole, or to a tenth while it sits between two */
export const tunedText = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(1));

/** how far a tune's value has moved from its start: `+170`, `-12.4` */
export function moveText(v: TunedValue): string {
  const d = Math.round((v.now - v.start) * 10) / 10;
  return signed(d, Number.isInteger(d) ? 0 : 1);
}

/**
 * The indexes of a tune's values in the order its table lists them: by how far each has moved as a share of its
 * range, or by the size of its effect, the largest first. A value without an effect goes last.
 */
export function tuneOrder(values: TunedValue[], by: 'move' | 'effect'): number[] {
  const key = (v: TunedValue) =>
    by === 'move'
      ? v.max > v.min
        ? Math.abs(v.now - v.start) / (v.max - v.min)
        : 0
      : v.effect === null
        ? -1
        : Math.abs(v.effect);
  const keys = values.map(key);
  return keys.map((_, i) => i).toSorted((a, b) => (keys[b] ?? 0) - (keys[a] ?? 0));
}
