import { describe, expect, it } from 'vitest';
import { STANDARD_ADJUDICATION } from './adjudicate.ts';
import type { TournamentConfig } from './format.ts';
import { configOf, gamesOf, pairsOf } from './records.ts';

describe('records', () => {
  it('reads back a config as it was saved', () => {
    const c: TournamentConfig = {
      id: 'x',
      name: 'test',
      created: '2026-11-18T00:00:00.000Z',
      format: { kind: 'match', pairs: 100, sprt: { elo0: 0, elo1: 5, alpha: 0.05, beta: 0.05 } },
      entrants: ['ratchet-0.3.14', 'ratchet-0.3.14'],
      control: '10+0.1',
      book: '8moves_v3.pgn',
      adjudication: STANDARD_ADJUDICATION,
      concurrency: 4,
      seed: 7,
    };
    expect(configOf(JSON.stringify(c))).toEqual(c);
  });

  it('reads back a Swiss and a knockout', () => {
    const c: TournamentConfig = {
      id: 'y',
      name: 'test',
      created: '2026-11-18T00:00:00.000Z',
      format: { kind: 'swiss', rounds: 5 },
      entrants: ['a', 'b', 'c'],
      control: '10+0.1',
      book: '',
      adjudication: null,
      concurrency: 2,
      seed: 1,
    };
    expect(configOf(JSON.stringify(c))).toEqual(c);
    const k = { ...c, format: { kind: 'knockout', pairs: 2 } } as const;
    expect(configOf(JSON.stringify(k))).toEqual(k);
  });

  it('skips a line cut short, and keeps the rest', () => {
    const text = `{"pair":0,"a":0,"b":1,"round":0,"opening":"e4 e5"}\n{"pair":1,"a":0,"b":1,"rou`;
    expect(pairsOf(text)).toEqual([{ pair: 0, a: 0, b: 1, round: 0, opening: 'e4 e5' }]);
  });

  it('refuses a game whose result is not one', () => {
    const text = `{"pair":0,"game":0,"white":0,"black":1,"result":"*","reason":"","plies":3}\n`;
    expect(gamesOf(text)).toEqual([]);
  });
});
