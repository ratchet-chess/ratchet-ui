import { describe, expect, it } from 'vitest';
import type { TournamentConfig } from '../match/format.ts';
import { inOrder, lacking, orderOf, queuedText, ready, reordered, type Queued } from './queue.ts';

function q(id: string, queued: number | null, over: Partial<TournamentConfig> = {}): Queued {
  return {
    queued,
    config: {
      id,
      name: id,
      created: `2026-11-23T10:00:0${id.length}Z`,
      format: { kind: 'match', pairs: 10, sprt: null },
      entrants: ['x-1', 'y-2'],
      control: '10+0.1',
      book: '',
      adjudication: null,
      concurrency: 4,
      seed: 1,
      paired: true,
      ...over,
    },
  };
}

describe('the queue', () => {
  it('reads its file back, and a torn or foreign one as not queued', () => {
    expect(orderOf(queuedText(1732000000000))).toBe(1732000000000);
    expect(orderOf('{"order":')).toBeNull();
    expect(orderOf('{"at":3}')).toBeNull();
    expect(orderOf(null)).toBeNull();
  });

  it('orders by key, then by creation, leaving out what is not queued', () => {
    const items = [q('c', 5), q('a', null), q('b', 2), q('dd', 2)];
    expect(inOrder(items).map((i) => i.config.id)).toEqual(['b', 'dd', 'c']);
  });

  it('names the engines and the book a tournament lacks', () => {
    const have = { engines: new Set(['x-1']), books: new Set(['8moves']) };
    expect(lacking(q('a', 1, { entrants: ['x-1', 'y-2', 'y-2'] }).config, have)).toEqual({
      engines: ['y-2'],
      book: '',
    });
    expect(lacking(q('a', 1, { entrants: ['x-1'], book: 'gone' }).config, have).book).toBe('gone');
    expect(ready(q('a', 1, { entrants: ['x-1'], book: '8moves' }).config, have)).toBe(true);
  });

  it('renumbers from 1 on a move, writing only the keys that change', () => {
    const queue = [q('a', 1), q('b', 2), q('c', 1732000000000)];
    const moved = reordered(queue, 2, 0);
    expect([...moved].map(([t, k]) => [t.config.id, k])).toEqual([
      ['c', 1],
      ['a', 2],
      ['b', 3],
    ]);
    expect(reordered(queue, 0, 0).size).toBe(0);
    expect(reordered(queue, 0, 3).size).toBe(0);
    expect([...reordered(queue, 0, 1)].map(([t, k]) => [t.config.id, k])).toEqual([
      ['b', 1],
      ['a', 2],
      ['c', 3],
    ]);
  });
});
