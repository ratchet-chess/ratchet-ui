import { describe, expect, it } from 'vitest';
import { Game } from '../../chess/game.ts';
import type { TournamentConfig } from '../../match/format.ts';
import { forfeitReason } from '../../match/referee.ts';
import { stateOf } from '../../match/runner.ts';
import type { GameRecord } from '../../match/summary.ts';
import type { Item } from '../../stores/tournaments.ts';
import {
  archiveMonths,
  etaOf,
  groupOf,
  noticesOf,
  problemsOf,
  standingText,
  threadBudget,
  type Served,
} from './overview.ts';

const NOW = Date.parse('2026-11-18T12:00:00Z');

function item(
  over: Partial<Omit<Item, 'config'>> & { config?: Partial<TournamentConfig> } = {},
): Item {
  const config: TournamentConfig = {
    id: 'a',
    name: 'A',
    created: '2026-11-18T08:00:00Z',
    format: { kind: 'match', pairs: 50, sprt: null },
    entrants: ['x-1', 'y-2'],
    control: '10+0.1',
    book: '',
    adjudication: null,
    concurrency: 4,
    seed: 1,
    paired: true,
    ...over.config,
  };
  return {
    state: stateOf(config, [], []),
    ended: 'stopped',
    elsewhere: false,
    endedAt: '2026-11-18T09:00:00Z',
    since: null,
    ...over,
    config,
  };
}

const game = (pair: number, reason: string): GameRecord => ({
  pair,
  game: 0,
  white: 0,
  black: 1,
  result: '1-0',
  reason,
  plies: 40,
});

const served: Served = { engines: new Set(['x-1', 'y-2']), books: new Set(), storage: null };

describe('the overview', () => {
  it('puts each tournament in one group: a run in any tab, stopped or interrupted, finished', () => {
    const running = item();
    running.state.status = 'running';
    expect(groupOf(running)).toBe('running');
    expect(groupOf(item({ elsewhere: true, ended: null }))).toBe('running');
    expect(groupOf(item({ ended: null }))).toBe('stopped');
    expect(groupOf(item({ ended: 'stopped' }))).toBe('stopped');
    expect(groupOf(item({ ended: 'done' }))).toBe('finished');
  });

  it('archives finished tournaments a month past their end, by month, newest first', () => {
    const items = [
      item({ ended: 'done', endedAt: '2026-11-01T00:00:00Z', config: { id: 'recent' } }),
      item({ ended: 'done', endedAt: '2026-10-02T00:00:00Z', config: { id: 'oct-2' } }),
      item({ ended: 'done', endedAt: '2026-10-09T00:00:00Z', config: { id: 'oct-9' } }),
      item({ ended: 'done', endedAt: '2026-08-30T00:00:00Z', config: { id: 'aug' } }),
      item({ ended: 'stopped', endedAt: '2026-01-01T00:00:00Z', config: { id: 'old-stopped' } }),
    ];
    expect(archiveMonths(items, NOW).map(([m, l]) => [m, l.map((i) => i.config.id)])).toEqual([
      ['2026-10', ['oct-9', 'oct-2']],
      ['2026-08', ['aug']],
    ]);
  });

  it("gives a gauntlet the seeds' scores, and a knockout its round", () => {
    const g = item({
      ended: 'done',
      config: {
        format: { kind: 'gauntlet', seeds: 1, cycles: 1 },
        entrants: ['s-1', 'a-1', 'b-1'],
      },
    });
    const pairs = [
      { pair: 0, a: 0, b: 1, round: 0, opening: '' },
      { pair: 1, a: 0, b: 2, round: 0, opening: '' },
    ];
    const games: GameRecord[] = [
      { ...game(0, 'checkmate'), white: 0, black: 1, result: '1-0' },
      { ...game(0, 'checkmate'), game: 1, white: 1, black: 0, result: '1/2-1/2' },
      { ...game(1, 'checkmate'), white: 0, black: 2, result: '0-1' },
      { ...game(1, 'checkmate'), game: 1, white: 2, black: 0, result: '1/2-1/2' },
    ];
    g.state = stateOf(g.config, pairs, games);
    // 2 of 4 points, though its points top the standings
    expect(standingText(g)).toBe('s-1 50.0%');

    const k = item({
      ended: 'stopped',
      config: { format: { kind: 'knockout', pairs: 1 }, entrants: ['p-1', 'q-1', 'r-1', 's-1'] },
    });
    const first = [
      { pair: 0, a: 0, b: 3, round: 0, opening: '' },
      { pair: 1, a: 1, b: 2, round: 0, opening: '' },
    ];
    const won: GameRecord[] = first.flatMap((p) => [
      { ...game(p.pair, 'checkmate'), white: p.a, black: p.b, result: '1-0' },
      { ...game(p.pair, 'checkmate'), game: 1, white: p.b, black: p.a, result: '0-1' },
    ]);
    k.state = stateOf(k.config, first, won);
    expect(standingText(k)).toBe('playing the final');
  });

  it('counts abnormal endings as games are added to the same array', () => {
    const flagged = new Game();
    flagged.flag('black');
    const games = [game(0, 'checkmate'), game(1, flagged.outcome?.reason ?? '')];
    expect([...problemsOf(games)]).toEqual([['time', 1]]);
    games.push(
      game(2, forfeitReason.illegal('x-1', 'e2e5')),
      game(3, flagged.outcome?.reason ?? ''),
    );
    expect([...problemsOf(games)]).toEqual([
      ['time', 2],
      ['illegal', 1],
    ]);
  });

  it('notices what a resume lacks and what went wrong, not a finished tournament', () => {
    const stopped = item({
      ended: null,
      config: { id: 's', name: 'S', entrants: ['x-1', 'gone-1'], book: 'b' },
    });
    stopped.state.games.push(game(0, forfeitReason.failed('x-1', 'trap')));
    const done = item({ ended: 'done', config: { id: 'd' } });
    done.state.games.push(game(0, forfeitReason.failed('x-1', 'trap')));
    const notices = noticesOf([stopped, done], {
      ...served,
      storage: { usage: 95, quota: 100 },
    });
    expect(notices.map((n) => [n.severity, n.id, n.text])).toEqual([
      ['bad', 's', 'cannot resume: gone-1 is not served'],
      ['bad', 's', 'cannot resume: the book b is not in Books'],
      ['bad', 's', '1 engine failure'],
      ['warn', 's', 'interrupted: its tab closed during the run'],
      ['warn', '', "95% of the browser's quota used"],
    ]);
  });

  it('times a run by its pace once enough games finished, bounded for an SPRT', () => {
    const run = item({
      ended: null,
      since: { at: NOW - 60_000, games: 10 },
      config: {
        format: { kind: 'match', pairs: 50, sprt: { elo0: 0, elo1: 5, alpha: 0.05, beta: 0.05 } },
      },
    });
    run.state.status = 'running';
    for (let k = 0; k < 13; k++) run.state.games.push(game(k, 'checkmate'));
    // 3 games since the start: fewer than the 4 at once
    expect(etaOf(run, NOW)).toBeNull();
    for (let k = 13; k < 20; k++) run.state.games.push(game(k, 'checkmate'));
    // 10 games a minute; 80 of 100 games left
    expect(etaOf(run, NOW)).toEqual({ ms: 8 * 60_000, bound: 'at most' });
  });

  it('adds up the games at once of every running tournament, in this tab or another', () => {
    const a = item({ config: { concurrency: 3 } });
    a.state.status = 'running';
    const b = item({ elsewhere: true, config: { concurrency: 2 } });
    expect(threadBudget([a, b, item()], 8)).toEqual({ games: 5, hardware: 8 });
  });
});
