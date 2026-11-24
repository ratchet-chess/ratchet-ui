import { describe, expect, it } from 'vitest';
import {
  parseHosts,
  parseJobDetail,
  parseJobs,
  parseSummary,
  managerBase,
  type Host,
  type Job,
  type Summary,
  type TunedValue,
  type Wait,
} from './api.ts';
import {
  decisionText,
  endText,
  endsText,
  headline,
  jobTitle,
  notices,
  outcomeText,
  runningText,
  setupText,
  statusTag,
  testText,
  unitParts,
  unitsNote,
  unitsText,
  unitTimeText,
  unreachableText,
  verdictLlr,
  verdictTag,
  moveText,
  tunedText,
  tuneOrder,
  waitCell,
  waitingText,
} from './show.ts';

const job = (over: Partial<Job>): Job => ({
  id: 931,
  name: 'pool-nodeclock-a-vs-b',
  label: 'sprt',
  kind: 'nodeclock',
  priority: 0,
  allocation: false,
  state: 'running',
  hosts: ['alpha', 'beta'],
  units: {},
  created: 0,
  ended: null,
  waiting: null,
  endsAt: null,
  atMost: false,
  summary: null,
  ...over,
});
const summary = (over: Partial<Summary>): Summary => ({
  base: 'b.engine',
  candidate: 'a.engine',
  test: 'nElo [0, 10]',
  tc: '6+0.06',
  games: 3692,
  ptnml: [61, 402, 902, 425, 56],
  nelo: { value: 3.1, ci: 4.2 },
  elo: { value: 2.3, ci: 3.1 },
  llr: { value: 1.37, lower: -2.94, upper: 2.94 },
  verdict: 'running',
  line: '',
  speed: 0.998,
  hash: '2',
  book: '8moves_v3.pgn 5835239f',
  forfeits: '0',
  pace: null,
  decision: null,
  values: null,
  resolution: null,
  ...over,
});
const host = (over: Partial<Host>): Host => ({
  name: 'alpha',
  condition: 'open',
  reason: '',
  taints: [],
  attrs: [],
  threads: 6,
  lastSeen: 1,
  running: [],
  ...over,
});

describe('the manager view, written for a reader', () => {
  it('a job bar is done, failed and in play over the planned units, without the cancelled', () => {
    const j = job({ units: { done: 50, running: 25, queued: 20, failed: 5, cancelled: 900 } });
    expect(unitParts(j)).toEqual([
      { share: 50, tone: 'accent' },
      { share: 5, tone: 'bad' },
      { share: 25, tone: 'live' },
    ]);
    expect(unitsText(j)).toBe('50 of 100 units');
    expect(unitParts(job({ units: {} }))).toEqual([]);
  });

  it('an end is a clock time, and a ceiling reads as a latest time', () => {
    const now = new Date(2026, 10, 20, 9, 0).getTime();
    const at = new Date(2026, 10, 20, 10, 5).getTime();
    expect(endText(job({ endsAt: at }), now)).toBe('≈ 10:05');
    expect(endText(job({ endsAt: at, atMost: true }), now)).toBe('by 10:05');
    expect(endText(job({ endsAt: at + 86_400_000 }), now)).toBe('≈ tomorrow 10:05');
    expect(endText(job({}), now)).toBe('');
  });

  const ahead = (id: number, waits: boolean): Wait => ({
    by: 'ahead',
    job: id,
    waits,
    text: `behind job ${id}`,
  });
  const hours: Wait = { by: 'filter', filter: 'hours', reason: 'outside hours', text: 'hours' };
  const own: Wait = {
    by: 'filter',
    filter: 'concurrency',
    reason: 'at concurrency (5/5)',
    text: 'concurrency',
  };
  const full = (runs: number, cap: number): Wait => ({
    by: 'heads',
    full: { runs, cap },
    text: 'kinds',
  });

  it("a job's wait counts the hosts by reason, and names a host that gives a reason alone", () => {
    expect(
      waitingText(
        job({
          units: { queued: 10 },
          waiting: { a: ahead(926, true), b: ahead(926, false), c: ahead(926, true), d: own },
        }),
      ),
    ).toBe('behind 926 on 3 hosts');
    expect(
      waitingText(
        job({
          units: { queued: 10 },
          waiting: {
            alpha: ahead(926, true),
            beta: { by: 'start', text: 'starts' },
            local: { by: 'host', condition: 'closed', text: 'closed' },
          },
        }),
      ),
    ).toBe('behind 926 on alpha · closed on local');
    expect(
      waitingText(
        job({ units: { queued: 10 }, waiting: { a: full(30, 30), b: full(5, 5), c: hours } }),
      ),
    ).toBe('full on 2 hosts · outside hours on c');
    expect(waitingText(job({ units: { queued: 10 }, waiting: null }))).toBe('');
    expect(waitingText(job({ units: { queued: 10 }, waiting: { alpha: own } }))).toBe('');
    expect(waitingText(job({ units: { running: 10 }, waiting: { alpha: hours } }))).toBe('');
  });

  it("a host's cell is its few words, and a full host's units against its cap", () => {
    expect(waitCell(full(30, 30))).toBe('full 30/30');
    expect(waitCell({ by: 'heads', full: null, text: 'kinds' })).toBe('busy');
    expect(waitCell(ahead(1087, false))).toBe('behind 1087');
    expect(waitCell(own)).toBe('');
    expect(waitCell(undefined)).toBe('');
  });

  it('a finishing job says so in one line, in place of what each host says', () => {
    const waiting = { alpha: hours };
    const finishing = job({ units: { done: 85, running: 40 }, waiting });
    expect(waitingText(finishing)).toBe('');
    expect(unitsNote(finishing)).toBe('finishing · 40 units left');
    expect(unitsNote(job({ units: { done: 124, running: 1 }, waiting }))).toBe(
      'finishing · 1 unit left',
    );
    // a job of one unit has no last unit to speak of
    expect(unitsNote(job({ units: { running: 1 }, waiting }))).toBe('');
    expect(unitsNote(job({ units: { queued: 5, running: 40 }, waiting }))).toBe(
      'outside hours on alpha',
    );
  });

  it('a notice names a silent host, a refusing host and a live job with failed units', () => {
    const hosts = [
      host({
        name: 'local',
        condition: 'closed',
        reason: 'outside hours 22:00-10:00',
      }),
      host({
        name: 'delta',
        condition: 'closed',
        reason: 'agent: its own check failed',
      }),
      host({ name: 'beta', condition: 'silent', reason: 'heartbeat expired' }),
      host({ name: 'gamma', condition: 'allocated', reason: 'job 7, exclusive' }),
    ];
    const jobs = [
      job({ units: { failed: 2, running: 1 } }),
      job({ id: 5, state: 'done', units: { failed: 1 } }),
    ];
    expect(notices(hosts, jobs).map((n) => `${n.severity} ${n.where}`)).toEqual([
      'bad job 931',
      'warn delta',
      'bad beta',
    ]);
    expect(headline(hosts, jobs)).toBe('0 of 4 hosts open · 1 job running');
    expect(
      runningText(
        host({
          running: [
            { job: 931, units: 12 },
            { job: 924, units: 18 },
          ],
        }),
      ),
    ).toBe('931×12 924×18');
  });

  it('a page over HTTPS says why it cannot read an http manager', () => {
    expect(unreachableText('http://host:7420', 'https:', 'Failed to fetch')).toContain('HTTPS');
    expect(unreachableText('http://host:7420', 'http:', 'Failed to fetch')).toBe(
      'no answer from http://host:7420',
    );
    expect(
      unreachableText('http://host:7420', 'http:', 'the manager answered 404 for /hosts'),
    ).toBe('the manager answered 404 for /hosts');
  });
});

describe("the manager's answers", () => {
  it('reads a host and a job, and drops what is not in the shape', () => {
    const h = parseHosts({
      at: 5,
      hosts: [
        {
          name: 'w',
          condition: 'open',
          reason: '',
          taints: ['unpinned', 3],
          threads: 6,
          lastSeen: 2,
          running: [{ job: 1, units: 2 }, { job: 'x' }],
        },
      ],
    });
    expect(h.hosts[0]).toMatchObject({
      name: 'w',
      taints: ['unpinned'],
      running: [{ job: 1, units: 2 }],
    });
    const j = parseJobs({
      jobs: [
        {
          id: 7,
          name: 'n',
          kind: 'batch',
          state: 'queued',
          hosts: ['w'],
          units: { queued: 3 },
          waiting: {
            w: { by: 'host', condition: 'closed', text: 'the host is closed' },
            x: { by: 'heads', full: { runs: 5, cap: 5 }, text: 'kinds' },
            y: 'a sentence from an older manager',
          },
        },
      ],
    });
    expect(j.jobs[0]).toMatchObject({
      id: 7,
      state: 'queued',
      units: { queued: 3 },
      waiting: {
        w: { by: 'host', condition: 'closed', text: 'the host is closed' },
        x: { by: 'heads', full: { runs: 5, cap: 5 }, text: 'kinds' },
      },
      endsAt: null,
      atMost: false,
    });
    // a wait of no known shape is left out
    expect(Object.keys(j.jobs[0]?.waiting ?? {})).toEqual(['w', 'x']);
  });

  it('refuses an answer that is no manager', () => {
    expect(() => parseHosts({ error: 'no route' })).toThrow('no hosts');
    expect(() => parseHosts({ hosts: [{ name: 'w', condition: 'asleep' }] })).toThrow('no host');
    expect(() => parseJobs({ jobs: [{ id: 'x', state: 'done' }] })).toThrow('no job');
  });

  it('reads a summary, and a part of the wrong type as absent', () => {
    const s = parseSummary({
      base: 'b',
      candidate: 'a',
      games: 8,
      ptnml: [0, 1, 2, 1, 0],
      nelo: { value: 1.5, ci: 90 },
      llr: { value: 0.1, lower: -2.94 },
      verdict: 'running',
    });
    expect(s).toMatchObject({
      base: 'b',
      games: 8,
      ptnml: [0, 1, 2, 1, 0],
      nelo: { value: 1.5, ci: 90 },
      llr: null,
      test: '',
      line: '',
    });
    expect(parseSummary({ ptnml: [1, 2, 'x', 4, 5], nelo: { value: 1 } })).toMatchObject({
      ptnml: null,
      nelo: null,
      games: null,
    });
    expect(parseSummary({ decision: { pairs: 797, llr: 3.31 } })?.decision).toEqual({
      pairs: 797,
      llr: 3.31,
    });
    expect(parseSummary({ decision: { pairs: 797 } })?.decision).toBeNull();
    expect(parseSummary(null)).toBeNull();
    expect(parseJobs({ jobs: [{ id: 7, state: 'done', summary: 'text' }] }).jobs[0]?.summary).toBe(
      null,
    );
  });

  it('takes an http address and drops a slash at its end', () => {
    expect(managerBase(' http://host:7420/ ')).toBe('http://host:7420');
    expect(managerBase('host:7420')).toBe('');
  });
});

describe("a job's outcome", () => {
  it('names a match by its two sides, and any other job by its name', () => {
    expect(jobTitle(job({ summary: summary({}) }))).toBe('a.engine vs b.engine');
    expect(jobTitle(job({ summary: summary({ candidate: '' }) }))).toBe('pool-nodeclock-a-vs-b');
    expect(jobTitle(job({}))).toBe('pool-nodeclock-a-vs-b');
  });

  it("words the test, and the standing from the producer's numbers", () => {
    const j = job({ summary: summary({}) });
    expect(testText(j)).toBe('nElo [0, 10] · 6+0.06');
    expect(outcomeText(j)).toBe('nElo +3.1 ± 4.2 · 3,692 games');
    expect(testText(job({}))).toBe('');
    expect(outcomeText(job({}))).toBe('');
  });

  it("says nothing before the first game, and shows a producer's own line as it is", () => {
    expect(outcomeText(job({ summary: summary({ games: 0, nelo: null }) }))).toBe('');
    expect(outcomeText(job({ summary: summary({ line: 'x 80g 1.0+/-9.0' }) }))).toBe(
      'x 80g 1.0+/-9.0',
    );
  });

  it('tags an ended run with its verdict, and a running one with none', () => {
    expect(verdictTag(job({ summary: summary({}) }))).toBeNull();
    expect(verdictTag(job({}))).toBeNull();
    expect(verdictTag(job({ summary: summary({ verdict: 'H1' }) }))).toEqual({
      text: 'H1',
      tone: 'tone-good',
    });
    expect(verdictTag(job({ summary: summary({ verdict: 'rejected by loss' }) }))?.tone).toBe(
      'tone-bad',
    );
    expect(verdictTag(job({ summary: summary({ verdict: 'interrupted' }) }))?.tone).toBe(
      'tone-warn',
    );
    expect(verdictTag(job({ summary: summary({ verdict: 'fixed' }) }))?.tone).toBe('tone-dim');
  });
});

describe("a job's page", () => {
  it('reads one job, and leaves out a row or a point of the wrong shape', () => {
    const j = parseJobDetail({
      job: {
        id: 7,
        state: 'running',
        summaryAt: 5,
        byHost: [
          { host: 'alpha', done: 3, running: 1, failed: 0, concurrency: 5, unitMs: 90500 },
          4,
        ],
        failed: [{ seq: '12', host: 'alpha', exit: 137 }],
        series: [
          { pairs: 8, llr: 0.1, nelo: { value: 1, ci: 90 }, elo: { value: 1, ci: 40 } },
          { pairs: 16, nelo: { value: 2, ci: 60 }, elo: { value: 1, ci: 30 } },
          { pairs: 24, nelo: { value: 2 } },
        ],
      },
    });
    expect(j.id).toBe(7);
    expect(j.summaryAt).toBe(5);
    expect(j.byHost).toEqual([
      { host: 'alpha', done: 3, running: 1, failed: 0, concurrency: 5, unitMs: 90500 },
    ]);
    expect(j.failed).toEqual([{ seq: '12', host: 'alpha', exit: 137 }]);
    expect(j.series.map((p) => [p.pairs, p.llr])).toEqual([
      [8, 0.1],
      [16, null],
    ]);
    expect(() => parseJobDetail({ error: 'no route' })).toThrow('no job');
  });

  it('words the setup from what the producer names', () => {
    expect(setupText(summary({}))).toBe(
      'nElo [0, 10] · 6+0.06 · Hash 2 · 8moves_v3.pgn 5835239f · SPEED 0.998',
    );
    expect(setupText(summary({ hash: '', book: '', speed: null }))).toBe('nElo [0, 10] · 6+0.06');
  });

  it("says when a running job should end, by its SPRT's pace and by its units", () => {
    const now = new Date(2026, 10, 20, 9, 0).getTime();
    const at = (h: number, m: number) => new Date(2026, 10, 20, h, m).getTime();
    const j = job({
      endsAt: at(13, 40),
      atMost: true,
      summary: summary({ pace: { games: 4250, at: at(10, 5) } }),
    });
    expect(endsText(j, now)).toBe('≈ 10:05 (LLR pace) · max 13:40');
    expect(endsText(job({ endsAt: at(9, 20), summary: summary({}) }), now)).toBe('≈ 09:20');
    expect(endsText(job({ summary: null }), now)).toBe('');
  });

  it("writes a unit's mean time, and a dash before a host has played one", () => {
    expect(unitTimeText(null)).toBe('—');
    expect(unitTimeText(45_200)).toBe('45 s');
    expect(unitTimeText(110_000)).toBe('1 min 50 s');
    expect(unitTimeText(120_000)).toBe('2 min');
  });

  it("tags a job with its run's verdict, or else with its state", () => {
    expect(statusTag(job({ summary: summary({ verdict: 'H0' }) }))).toEqual({
      text: 'H0',
      tone: 'tone-bad',
    });
    expect(statusTag(job({}))).toEqual({ text: 'running', tone: 'tone-accent' });
    expect(statusTag(job({ state: 'cancelled' }))).toEqual({ text: 'stopped', tone: 'tone-dim' });
  });
});

describe("a tune's page", () => {
  const value = (over: Partial<TunedValue>): TunedValue => ({
    name: 'V',
    start: 100,
    now: 100,
    min: 0,
    max: 200,
    effect: null,
    ...over,
  });

  it("reads a tune's values and path, and leaves out a value or a point of the wrong shape", () => {
    const j = parseJobDetail({
      job: {
        id: 1,
        state: 'running',
        summary: {
          verdict: 'running',
          values: [
            { name: 'A', start: 10, now: 12.5, min: 0, max: 20, effect: 1.5 },
            { name: 'B', start: 5, now: 5, min: 0, max: 10, effect: null },
            { name: 'C', start: 'x' },
          ],
          resolution: 2.5,
        },
        series: [
          { pairs: 0, values: [10, 5] },
          { pairs: 8, values: [11, null] },
          { pairs: 16, nelo: { value: 1, ci: 2 }, elo: { value: 1, ci: 2 } },
        ],
      },
    });
    expect(j.summary?.values).toEqual([
      { name: 'A', start: 10, now: 12.5, min: 0, max: 20, effect: 1.5 },
      { name: 'B', start: 5, now: 5, min: 0, max: 10, effect: null },
    ]);
    expect(j.summary?.resolution).toBe(2.5);
    expect(j.path).toEqual([{ pairs: 0, values: [10, 5] }]);
    expect(j.series.map((p) => p.pairs)).toEqual([16]);
  });

  it('orders the values by their move in their range, or by the size of their effect', () => {
    const values = [
      value({ name: 'small', now: 110, effect: -3 }),
      value({ name: 'wide', now: 150, max: 2000, effect: 1 }),
      value({ name: 'far', now: 160, effect: null }),
    ];
    expect(tuneOrder(values, 'move')).toEqual([2, 0, 1]);
    expect(tuneOrder(values, 'effect')).toEqual([0, 1, 2]);
    expect(moveText(value({ now: 270 }))).toBe('+170');
    expect(moveText(value({ now: 87.6 }))).toBe('-12.4');
    expect(tunedText(1114.3)).toBe('1114.3');
    expect(tunedText(61)).toBe('61');
  });
});

describe('the LLR at the decision', () => {
  const ended = summary({
    verdict: 'H1',
    games: 2136,
    llr: { value: 2.7, lower: -2.94, upper: 2.94 },
    decision: { pairs: 797, llr: 3.31 },
  });

  it('reads the verdict from the decision, which stays past its bound', () => {
    expect(verdictLlr(ended)).toEqual({ value: 3.31, lower: -2.94, upper: 2.94 });
    expect(verdictLlr(summary({}))).toEqual({ value: 1.37, lower: -2.94, upper: 2.94 });
    expect(verdictLlr(summary({ llr: null, decision: { pairs: 5, llr: 1 } }))).toBeNull();
  });

  it('says where the decision was only when later units added pairs', () => {
    expect(decisionText(ended)).toBe('at 797 pairs · 2.70 over all');
    expect(decisionText(summary({ games: 1594, decision: { pairs: 797, llr: 3.31 } }))).toBe('');
    expect(decisionText(summary({}))).toBe('');
  });
});
