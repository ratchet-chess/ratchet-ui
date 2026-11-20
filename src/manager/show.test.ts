import { describe, expect, it } from 'vitest';
import { parseHosts, parseJobs, managerBase, type Host, type Job } from './api.ts';
import {
  endText,
  headline,
  notices,
  runningText,
  unitParts,
  unitsText,
  unreachableText,
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

  it('takes an http address and drops a slash at its end', () => {
    expect(managerBase(' http://host:7420/ ')).toBe('http://host:7420');
    expect(managerBase('host:7420')).toBe('');
  });
});
