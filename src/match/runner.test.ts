import { describe, expect, it } from 'vitest';
import { parseControl } from '../chess/clock.ts';
import { BYE, type TournamentConfig } from './format.ts';
import { Run, stateOf, unfinished } from './runner.ts';
import type { GameRecord, PairRecord } from './summary.ts';

const pair = (n: number, b = 1): PairRecord => ({ pair: n, a: 0, b, round: n, opening: '' });
const game = (n: number, g: 0 | 1): GameRecord => ({
  pair: n,
  game: g,
  white: 0,
  black: 1,
  result: '1-0',
  reason: '',
  plies: 40,
});

describe('a resumed run', () => {
  const pairs = [pair(0), pair(1), pair(2, BYE), pair(3)];

  it('replays every game of a pair that has no result, but not a bye', () => {
    const left = unfinished(pairs, [game(0, 0), game(0, 1), game(1, 1)], 2);
    expect(left.map((w) => [w.pair.pair, w.game])).toEqual([
      [1, 0],
      [3, 0],
      [3, 1],
    ]);
  });

  it('replays one game a pair with one game per opening', () => {
    const left = unfinished(pairs, [game(0, 0)], 1);
    expect(left.map((w) => [w.pair.pair, w.game])).toEqual([
      [1, 0],
      [3, 0],
    ]);
  });
});

describe('Run stop and error invariants', () => {
  const baseConfig: TournamentConfig = {
    id: 'test-run',
    name: 'Test',
    created: '2026-01-01T00:00:00.000Z',
    format: { kind: 'match', pairs: 4, sprt: null },
    entrants: ['a', 'b'],
    control: '10+0.1',
    book: 'book.epd',
    adjudication: null,
    concurrency: 1,
    paired: true,
    seed: 1,
  };

  it('writes no new pair when stop(false) is called while opening() is pending', async () => {
    let releaseOpening: (() => void) | undefined;
    const savedPairs: PairRecord[] = [];
    const savedEnds: string[] = [];
    const state = stateOf(baseConfig, [], []);
    const tc = parseControl('10+0.1');
    if (!tc) throw new Error('control');
    const run = new Run(
      baseConfig,
      [
        { id: 'a', name: 'a', workerUrl: 'about:blank' },
        { id: 'b', name: 'b', workerUrl: 'about:blank' },
      ],
      tc,
      state,
      {
        opening: () =>
          new Promise((resolve) => {
            releaseOpening = () => resolve({ fen: undefined, moves: ['e2e4'], label: 'e4' });
          }),
        savePair: async (p) => {
          savedPairs.push(p);
        },
        saveGame: async () => undefined,
        saveEnd: async (status) => {
          savedEnds.push(status);
        },
      },
    );

    run.start();
    // stop gracefully while fill() is awaiting opening()
    run.stop(false);
    releaseOpening?.();
    await new Promise<void>((r) => {
      setTimeout(r, 10);
    });

    expect(savedPairs).toEqual([]);
    expect(state.pairs).toEqual([]);
    expect(state.live).toEqual([]);
    expect(savedEnds).toEqual(['stopped']);
  });

  it('stops, counting no game, when a game cannot be saved', async () => {
    const savedEnds: string[] = [];
    const state = stateOf(baseConfig, [], []);
    const tc = parseControl('10+0.1');
    if (!tc) throw new Error('control');
    // with no Worker in Node, each game ends at its start as a forfeit, which is then saved
    const run = new Run(
      baseConfig,
      [
        { id: 'a', name: 'a', workerUrl: 'about:blank' },
        { id: 'b', name: 'b', workerUrl: 'about:blank' },
      ],
      tc,
      state,
      {
        opening: async () => undefined,
        savePair: async () => undefined,
        saveGame: async () => {
          throw new Error('quota exceeded');
        },
        saveEnd: async (status) => {
          savedEnds.push(status);
        },
      },
    );

    run.start();
    await new Promise<void>((r) => {
      setTimeout(r, 20);
    });

    expect(state.status).toBe('stopped');
    expect(state.error).toBe('quota exceeded');
    expect(savedEnds).toEqual(['stopped']);
    expect(state.games).toEqual([]);
  });
});
