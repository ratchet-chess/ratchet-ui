/**
 * A ratchet-bench manager's read API, as this app reads it: `GET /hosts` and `GET /jobs`, plain JSON with no
 * token. The manager picks the fields; the app shows them and computes no outcome.
 */

/** a host's one word in the queue's status */
export type Condition = 'open' | 'closed' | 'allocated' | 'retiring' | 'drained' | 'silent';

export interface Host {
  name: string;
  condition: Condition;
  /** why the host has that condition; empty when it is open */
  reason: string;
  taints: string[];
  attrs: string[];
  /** the host's hardware threads, as its agent reported them */
  threads: number | null;
  /** when its agent last spoke, in ms */
  lastSeen: number | null;
  /** the units it runs now, by job */
  running: { job: number; units: number }[];
}

/** a job in a list: queued until its first unit starts, then running, then as the queue ended it */
export type JobState = 'queued' | 'running' | 'done' | 'cancelled';

export interface Job {
  id: number;
  name: string;
  label: string | null;
  kind: string;
  priority: number;
  /** an allocation keeps a host free and plays nothing itself */
  allocation: boolean;
  state: JobState;
  hosts: string[];
  /** unit counts by state: queued, running, done, failed, cancelled */
  units: Record<string, number>;
  created: number;
  ended: number | null;
  /** for a job with queued units: why they do not start, by host */
  waiting: Record<string, string> | null;
  /** when the job should end if nothing interrupts it, in ms */
  endsAt: number | null;
  /** the unit count is a ceiling, so the job may end sooner */
  atMost: boolean;
}

export interface Snapshot {
  /** the manager's clock at the read, in ms */
  at: number;
  hosts: Host[];
  jobs: Job[];
}

const CONDITIONS: ReadonlySet<string> = new Set([
  'open',
  'closed',
  'allocated',
  'retiring',
  'drained',
  'silent',
]);
const STATES: ReadonlySet<string> = new Set(['queued', 'running', 'done', 'cancelled']);
const isCondition = (v: unknown): v is Condition => typeof v === 'string' && CONDITIONS.has(v);
const isJobState = (v: unknown): v is JobState => typeof v === 'string' && STATES.has(v);

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const number = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const texts = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];

function fail(what: string): never {
  throw new Error(`the manager's answer has ${what}`);
}

/** the hosts of a `GET /hosts` answer; a row that is not a host fails the read, so a wrong address reads as one */
export function parseHosts(body: unknown): { at: number; hosts: Host[] } {
  if (!isObject(body) || !Array.isArray(body.hosts)) fail('no hosts');
  return {
    at: number(body.at) ?? Date.now(),
    hosts: body.hosts.map((h: unknown): Host => {
      if (!isObject(h) || !text(h.name) || !isCondition(h.condition)) fail('a row that is no host');
      return {
        name: text(h.name),
        condition: h.condition,
        reason: text(h.reason),
        taints: texts(h.taints),
        attrs: texts(h.attrs),
        threads: number(h.threads),
        lastSeen: number(h.lastSeen),
        running: (Array.isArray(h.running) ? h.running : []).flatMap((r: unknown) => {
          const job = isObject(r) ? number(r.job) : null;
          const units = isObject(r) ? number(r.units) : null;
          return job === null || units === null ? [] : [{ job, units }];
        }),
      };
    }),
  };
}

/** the jobs of a `GET /jobs` answer */
export function parseJobs(body: unknown): { at: number; jobs: Job[] } {
  if (!isObject(body) || !Array.isArray(body.jobs)) fail('no jobs');
  return {
    at: number(body.at) ?? Date.now(),
    jobs: body.jobs.map((j: unknown): Job => {
      const id = isObject(j) ? number(j.id) : null;
      if (!isObject(j) || id === null || !isJobState(j.state)) fail('a row that is no job');
      const units: Record<string, number> = {};
      if (isObject(j.units))
        for (const [k, v] of Object.entries(j.units)) units[k] = number(v) ?? 0;
      const waiting: Record<string, string> = {};
      if (isObject(j.waiting)) for (const [k, v] of Object.entries(j.waiting)) waiting[k] = text(v);
      return {
        id,
        name: text(j.name),
        label: text(j.label) || null,
        kind: text(j.kind),
        priority: number(j.priority) ?? 0,
        allocation: j.allocation === true,
        state: j.state,
        hosts: texts(j.hosts),
        units,
        created: number(j.created) ?? 0,
        ended: number(j.ended),
        waiting: isObject(j.waiting) ? waiting : null,
        endsAt: number(j.endsAt),
        atMost: j.atMost === true,
      };
    }),
  };
}

/** `url` with no slash at its end, or '' when it is no http address */
export function managerBase(url: string): string {
  const u = url.trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/\s]+/.test(u) ? u : '';
}

/** one read of the manager: its hosts and its jobs; it throws when either fails */
export async function readManager(url: string, signal?: AbortSignal): Promise<Snapshot> {
  const get = async (path: string): Promise<unknown> => {
    const r = await fetch(`${url}${path}`, { signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`the manager answered ${r.status} for ${path}`);
    return r.json() as Promise<unknown>;
  };
  const [h, j] = await Promise.all([get('/hosts'), get('/jobs')]);
  const hosts = parseHosts(h);
  return { at: hosts.at, hosts: hosts.hosts, jobs: parseJobs(j).jobs };
}
