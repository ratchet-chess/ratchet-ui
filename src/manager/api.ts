/**
 * A ratchet-bench manager's read API, as this app reads it: `GET /hosts`, `GET /jobs` and `GET /jobs/<id>`, plain
 * JSON with no token. The manager picks the fields; the app shows them and computes no outcome.
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

/** a number with its 95% half-interval */
export interface Estimate {
  value: number;
  ci: number;
}

/**
 * A producer's summary of its job's run. The manager stores it as its producer posted it and reads nothing in
 * it, so every part may be absent: a text is then empty and a number null.
 */
export interface Summary {
  base: string;
  candidate: string;
  /** the test in its producer's words: an SPRT's bounds, or a number of games */
  test: string;
  tc: string;
  games: number | null;
  /** pair counts, from two losses to two wins */
  ptnml: number[] | null;
  nelo: Estimate | null;
  elo: Estimate | null;
  /** an SPRT's LLR and the two bounds that end it */
  llr: { value: number; lower: number; upper: number } | null;
  /** the pairs and LLR an SPRT's verdict rests on; the final counts may hold a few more pairs */
  decision: { pairs: number; llr: number } | null;
  /** `running`, then the run's verdict */
  verdict: string;
  /** the outcome in one line, for a run whose outcome is not one match's counts */
  line: string;
  /** the candidate's search speed over the base's, which scales its clock */
  speed: number | null;
  hash: string;
  book: string;
  /** games that ended by a fault, in the tool's words */
  forfeits: string;
  /** an SPRT's pace: the games left until the LLR reaches the bound its drift points at, and the time then */
  pace: { games: number; at: number } | null;
  /** an SPSA tune's values, in its tunables' order; null for any other run */
  values: TunedValue[] | null;
  /** a tune's resolution: the 95% half-interval in nElo of a head-to-head over all its games */
  resolution: number | null;
}

/** one value of an SPSA tune */
export interface TunedValue {
  name: string;
  start: number;
  now: number;
  min: number;
  max: number;
  /** the side moved up against the side moved down so far, in nElo: a slope along the path, not a gain */
  effect: number | null;
}

/** a tune's values after its first `pairs` pairs, in the order of its summary's values */
export interface PathPoint {
  pairs: number;
  values: number[];
}

/** a run's statistics after its first `pairs` finished pairs, one point of its charts */
export interface SeriesPoint {
  pairs: number;
  /** null without an SPRT */
  llr: number | null;
  nelo: Estimate;
  elo: Estimate;
}

/** one host's part of a job */
export interface HostUnits {
  host: string;
  done: number;
  running: number;
  failed: number;
  /** units of the job the host runs at once */
  concurrency: number | null;
  /** the host's mean time for one of the job's units, in ms */
  unitMs: number | null;
}

/** a unit that failed on its last try */
export interface FailedUnit {
  seq: string;
  host: string | null;
  exit: number | null;
}

/**
 * Why a job's queued units do not start on a host, as the manager's next claim there would decide it. `text` is
 * the manager's sentence; the rest is the same in parts.
 */
export type Wait = { text: string } &
  /** the host takes no unit of any job: silent, drained, or closed by its agent */
  (
    | { by: 'host'; condition: string }
    /** a check of the manager passes the job by on this host, such as its hours */
    | { by: 'filter'; filter: string; reason: string }
    /** a job ahead takes the host first; `waits` when that job itself waits for the host */
    | { by: 'ahead'; job: number; waits: boolean }
    /** the job is first in line here and waits for room; `full` when the host runs as many units as it may */
    | { by: 'heads'; full: { runs: number; cap: number } | null }
    /** its next unit starts at the host's next claim */
    | { by: 'start' }
  );

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
  waiting: Record<string, Wait> | null;
  /** when the job should end if nothing interrupts it, in ms */
  endsAt: number | null;
  /** the unit count is a ceiling, so the job may end sooner */
  atMost: boolean;
  /** its producer's latest summary; null for a job whose producer posts none */
  summary: Summary | null;
}

/** one job as its own page shows it: its row, and what only that page reads */
export interface JobDetail extends Job {
  /** when its producer last posted the summary, in ms */
  summaryAt: number | null;
  byHost: HostUnits[];
  failed: FailedUnit[];
  series: SeriesPoint[];
  /** a tune's values over its run, thinned by its producer */
  path: PathPoint[];
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

const estimate = (e: unknown): Estimate | null => {
  const value = isObject(e) ? number(e.value) : null;
  const ci = isObject(e) ? number(e.ci) : null;
  return value === null || ci === null ? null : { value, ci };
};

/** a job's summary as the manager returned it; a part of the wrong type reads as absent */
export function parseSummary(v: unknown): Summary | null {
  if (!isObject(v)) return null;
  const paceGames = isObject(v.pace) ? number(v.pace.games) : null;
  const paceAt = isObject(v.pace) ? number(v.pace.at) : null;
  const counts = Array.isArray(v.ptnml) ? v.ptnml.map(number) : [];
  const ptnml = counts.filter((n) => n !== null);
  const llr = isObject(v.llr)
    ? { value: number(v.llr.value), lower: number(v.llr.lower), upper: number(v.llr.upper) }
    : null;
  const decided = isObject(v.decision)
    ? { pairs: number(v.decision.pairs), llr: number(v.decision.llr) }
    : null;
  return {
    base: text(v.base),
    candidate: text(v.candidate),
    test: text(v.test),
    tc: text(v.tc),
    games: number(v.games),
    ptnml: ptnml.length === 5 && counts.length === 5 ? ptnml : null,
    nelo: estimate(v.nelo),
    elo: estimate(v.elo),
    llr:
      llr !== null && llr.value !== null && llr.lower !== null && llr.upper !== null
        ? { value: llr.value, lower: llr.lower, upper: llr.upper }
        : null,
    decision:
      decided !== null && decided.pairs !== null && decided.llr !== null
        ? { pairs: decided.pairs, llr: decided.llr }
        : null,
    verdict: text(v.verdict),
    line: text(v.line),
    speed: number(v.speed),
    hash: text(v.hash),
    book: text(v.book),
    forfeits: text(v.forfeits),
    pace: paceGames === null || paceAt === null ? null : { games: paceGames, at: paceAt },
    values: Array.isArray(v.values) ? v.values.flatMap(tunedValue) : null,
    resolution: number(v.resolution),
  };
}

/** a tune's value, or none for an entry of the wrong shape */
function tunedValue(v: unknown): TunedValue[] {
  if (!isObject(v)) return [];
  const [start, now, min, max] = [number(v.start), number(v.now), number(v.min), number(v.max)];
  if (text(v.name) === '' || start === null || now === null || min === null || max === null)
    return [];
  return [{ name: text(v.name), start, now, min, max, effect: number(v.effect) }];
}

/** a host's wait; null for a value of no known shape */
function parseWait(v: unknown): Wait | null {
  if (!isObject(v)) return null;
  const t = text(v.text);
  switch (v.by) {
    case 'host':
      return { by: 'host', condition: text(v.condition), text: t };
    case 'filter':
      return { by: 'filter', filter: text(v.filter), reason: text(v.reason), text: t };
    case 'ahead': {
      const job = number(v.job);
      return job === null ? null : { by: 'ahead', job, waits: v.waits === true, text: t };
    }
    case 'heads': {
      const f = isObject(v.full) ? v.full : null;
      const runs = number(f?.runs);
      const cap = number(f?.cap);
      return { by: 'heads', full: runs === null || cap === null ? null : { runs, cap }, text: t };
    }
    case 'start':
      return { by: 'start', text: t };
    default:
      return null;
  }
}

/** a job's row; a value that is no job fails the read */
function parseJob(j: unknown): Job {
  const id = isObject(j) ? number(j.id) : null;
  if (!isObject(j) || id === null || !isJobState(j.state)) fail('a row that is no job');
  const units: Record<string, number> = {};
  if (isObject(j.units)) for (const [k, v] of Object.entries(j.units)) units[k] = number(v) ?? 0;
  const waiting: Record<string, Wait> = {};
  if (isObject(j.waiting))
    for (const [k, v] of Object.entries(j.waiting)) {
      const w = parseWait(v);
      if (w !== null) waiting[k] = w;
    }
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
    summary: parseSummary(j.summary),
  };
}

/** the jobs of a `GET /jobs` answer */
export function parseJobs(body: unknown): { at: number; jobs: Job[] } {
  if (!isObject(body) || !Array.isArray(body.jobs)) fail('no jobs');
  return { at: number(body.at) ?? Date.now(), jobs: body.jobs.map(parseJob) };
}

/** the job of a `GET /jobs/<id>` answer; a row or a point of the wrong shape is left out */
export function parseJobDetail(body: unknown): JobDetail {
  if (!isObject(body) || !isObject(body.job)) fail('no job');
  const j = body.job;
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  return {
    ...parseJob(j),
    summaryAt: number(j.summaryAt),
    byHost: list(j.byHost).flatMap((h): HostUnits[] =>
      isObject(h) && text(h.host) !== ''
        ? [
            {
              host: text(h.host),
              done: number(h.done) ?? 0,
              running: number(h.running) ?? 0,
              failed: number(h.failed) ?? 0,
              concurrency: number(h.concurrency),
              unitMs: number(h.unitMs),
            },
          ]
        : [],
    ),
    failed: list(j.failed).flatMap((f): FailedUnit[] =>
      isObject(f) ? [{ seq: text(f.seq), host: text(f.host) || null, exit: number(f.exit) }] : [],
    ),
    series: list(j.series).flatMap((p): SeriesPoint[] => {
      const pairs = isObject(p) ? number(p.pairs) : null;
      const nelo = isObject(p) ? estimate(p.nelo) : null;
      const elo = isObject(p) ? estimate(p.elo) : null;
      if (!isObject(p) || pairs === null || nelo === null || elo === null) return [];
      return [{ pairs, llr: number(p.llr), nelo, elo }];
    }),
    path: list(j.series).flatMap((p): PathPoint[] => {
      const pairs = isObject(p) ? number(p.pairs) : null;
      const values = isObject(p) && Array.isArray(p.values) ? p.values.map(number) : [];
      if (pairs === null || values.length === 0 || values.some((x) => x === null)) return [];
      return [{ pairs, values: values.filter((x) => x !== null) }];
    }),
  };
}

/** `url` with no slash at its end, or '' when it is no valid http(s) base address */
export function managerBase(url: string): string {
  const u = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u) || /\s/.test(u)) return '';
  try {
    const parsed = new URL(u);
    if (parsed.search || parsed.hash) return '';
    return parsed.href.replace(/\/+$/, '');
  } catch {
    return '';
  }
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

/** one read of one job; null when the manager has no such job */
export async function readJob(
  url: string,
  id: number,
  signal?: AbortSignal,
): Promise<JobDetail | null> {
  const r = await fetch(`${url}/jobs/${id}`, { signal, cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`the manager answered ${r.status} for job ${id}`);
  return parseJobDetail(await (r.json() as Promise<unknown>));
}
