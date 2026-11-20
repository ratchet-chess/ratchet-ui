import { describe, expect, it } from 'vitest';
import {
  parseHosts,
  parseJobs,
  parseSummary,
  managerBase,
  type Host,
  type Job,
  type Summary,
} from './api.ts';
import {
  endText,
  headline,
  jobTitle,
  notices,
  outcomeText,
  runningText,
  testText,
  unitParts,
  unitsText,
  unreachableText,
  verdictTag,
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
  llr: { value: 1.37, lower: -2.94, upper: 2.94 },
  verdict: 'running',
  line: '',
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

  it('a wait is one reason when the hosts share it, and a host that starts next says nothing', () => {
    expect(waitingText(job({ waiting: { alpha: 'behind job 926', beta: 'behind job 926' } }))).toBe(
      'behind job 926',
    );
    expect(
      waitingText(
        job({
          waiting: {
            alpha: 'behind job 926',
            beta: "starts at the host's next claim",
            local: 'closed',
          },
        }),
      ),
    ).toBe('alpha: behind job 926 · local: closed');
    expect(waitingText(job({ waiting: null }))).toBe('');
    expect(
      waitingText(
        job({
          waiting: {
            alpha: 'outside its hours',
            beta: 'concurrency: its 5 running here fill its concurrency of 5',
          },
        }),
      ),
    ).toBe('alpha: outside its hours');
    expect(
      waitingText(
        job({ waiting: { alpha: 'concurrency: its 5 running here fill its concurrency of 5' } }),
      ),
    ).toBe('');
  });

  it('a notice names a silent host, a refusing host and a live job with failed units', () => {
    const hosts = [
      host({
        name: 'local',
        condition: 'closed',
        reason: 'outside its hours 22:00-10:00; an allocation still starts',
      }),
      host({
        name: 'delta',
        condition: 'closed',
        reason: 'its agent claims nothing: its own check failed',
      }),
      host({ name: 'beta', condition: 'silent', reason: 'no word from its agent' }),
      host({ name: 'gamma', condition: 'allocated', reason: 'allocation 7' }),
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
          waiting: { w: 'closed' },
        },
      ],
    });
    expect(j.jobs[0]).toMatchObject({
      id: 7,
      state: 'queued',
      units: { queued: 3 },
      waiting: { w: 'closed' },
      endsAt: null,
      atMost: false,
    });
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
