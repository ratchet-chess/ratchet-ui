/** How the manager view writes a host and a job for a reader: shared by Jobs, Hosts and the header. */
import type { Host, Job } from './api.ts';
import { count } from '../ui/format.ts';

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
 * Why a job's queued units wait, in one line: the reason its hosts share, or each host's own. A host says nothing
 * here when its units would start at its next claim, or when it already runs as many of them as it may.
 */
export function waitingText(j: Job): string {
  const rows = Object.entries(j.waiting ?? {}).filter(
    ([, why]) => why !== '' && !why.startsWith('starts at') && !why.startsWith('concurrency:'),
  );
  const first = rows[0];
  if (first === undefined) return '';
  if (rows.every(([, why]) => why === first[1])) return first[1];
  return rows.map(([host, why]) => `${host}: ${why}`).join(' · ');
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
