import { describe, expect, it } from 'vitest';
import { resolveControl, type TimeControl } from '../chess/clock.ts';
import { controlKey, controlLabel, controlsOf, pairUp, rate, type Source } from './list.ts';
import type { ScannedGame } from './scan.ts';

const game = (
  white: string,
  black: string,
  score: number,
  round = '',
  extra: Partial<ScannedGame> = {},
): ScannedGame => ({
  white,
  black,
  score,
  forfeit: false,
  round,
  control: '',
  ...extra,
});

describe('pairUp', () => {
  it("pairs a tournament's games by their number, keeping a replayed game's later copy", () => {
    const src: Source = {
      id: 't-1',
      per: 2,
      control: '10+0.1',
      games: [
        game('a', 'b', 1, '1.1'),
        game('b', 'a', 0, '1.2'),
        game('c', 'd', 1, '2.4'),
        game('d', 'c', 1, '2.3'),
        game('a', 'b', 0, '1.1'),
      ],
    };
    const out = pairUp([src]);
    expect(out.map((g) => [g.round, g.score, g.pair])).toEqual([
      ['1.1', 0, 0],
      ['1.2', 0, 0],
      ['2.4', 1, 1],
      ['2.3', 1, 1],
    ]);
  });

  it('gives each game its own pair with one game per opening', () => {
    const out = pairUp([
      {
        id: 't',
        per: 1,
        control: null,
        games: [game('a', 'b', 1, '1.1'), game('b', 'a', 1, '1.2')],
      },
    ]);
    expect(new Set(out.map((g) => g.pair)).size).toBe(2);
  });

  it('pairs two adjacent games of a file with colors swapped, and numbers pairs across sources', () => {
    const file: Source = {
      id: 'f',
      per: null,
      control: null,
      games: [game('a', 'b', 1), game('b', 'a', 0), game('b', 'a', 1), game('c', 'a', 1)],
    };
    const out = pairUp([file, file]);
    expect(out.map((g) => g.pair)).toEqual([0, 0, 1, 2, 3, 3, 4, 5]);
  });
});

/** a control that must read */
function control(text: string): TimeControl {
  const tc = resolveControl(text);
  if (!tc) throw new Error(`${text} does not read`);
  return tc;
}

describe('controls', () => {
  it('is one control whichever way it was written', () => {
    expect(controlKey(control('2m+1'))).toBe('120+1');
    expect(controlLabel('120+1')).toBe('2m+1');
    expect(controlLabel(controlKey(control('200k nodes')))).toBe('200k nodes');
    const sources: Source[] = [
      { id: 't', per: 2, control: '2m+1', games: [game('a', 'b', 1, '1.1')] },
      {
        id: 'f',
        per: null,
        control: null,
        games: [
          game('a', 'b', 1, '', { control: '120+1' }),
          game('a', 'b', 1, '', { control: '-' }),
        ],
      },
    ];
    expect([...controlsOf(sources)]).toEqual([
      ['120+1', 2],
      ['', 1],
    ]);
  });
});

describe('rate', () => {
  const sources: Source[] = [
    {
      id: 'f',
      per: null,
      control: null,
      games: [
        game('a', 'b', 1),
        game('b', 'a', 0.5),
        game('a', 'b', 0.5),
        game('b', 'a', 0, '', { forfeit: true }),
        game('b', 'c', 1),
        game('c', 'b', 0.5),
        game('b', 'c', 0.5),
        game('c', 'b', 0.5),
        game('x', 'y', 1),
        game('y', 'x', 0.5),
      ],
    },
  ];
  const all = { collections: new Set(['f']), control: null, forfeits: true };

  it('counts forfeits unless the filter leaves them out', () => {
    const counted = rate(sources, all, null);
    const left = rate(sources, { ...all, forfeits: false }, null);
    const b = (l: typeof counted) => l.rows.find((r) => r.name === 'b');
    expect(b(counted)?.losses).toBe(2);
    expect(b(counted)?.forfeits).toBe(1);
    expect(b(left)?.losses).toBe(1);
    expect(left.games).toBe(counted.games - 1);
  });

  it("lists the anchor's pool first, ranked, with LOS only within a pool", () => {
    const list = rate(sources, all, { name: 'x', rating: 2000 });
    expect(list.anchored).toBe(true);
    expect(list.pools).toBe(2);
    expect(list.rows.map((r) => [r.name, r.pool])).toEqual([
      ['x', 0],
      ['y', 0],
      ['a', 1],
      ['b', 1],
      ['c', 1],
    ]);
    expect(list.rows[0]?.elo).toBe(2000);
    expect(list.rows[1]?.los).toBeNull();
    expect(list.rows[4]?.los).toBeNull();
    // x and y met in one pair, which shows no spread: the model's interval
    expect(list.rows[0]?.model).toBe(true);
    expect(list.rows[2]?.los).not.toBeNull();
  });

  it('lists each two engines that met once, the higher rated first, most games first', () => {
    const list = rate(sources, all, null);
    expect(list.records.map((m) => [m.a, m.b, m.games])).toEqual([
      ['a', 'b', 4],
      ['b', 'c', 4],
      ['x', 'y', 2],
    ]);
    expect(list.records[0]?.wins).toBe(2);
    // a and b met over two pairs, so the model's interval stands, read from the whole fit
    expect(list.records[0]?.error).toBeGreaterThan(0);
    expect(list.records[0]?.los).toBeGreaterThan(0.5);
    expect(list.records[0]?.mark).toBe('');
    expect(list.records[0]?.losses).toBe(0);
  });
});
