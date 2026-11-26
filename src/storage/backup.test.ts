import { describe, expect, it } from 'vitest';
import { STANDARD_ADJUDICATION } from '../match/adjudicate.ts';
import type { TournamentConfig } from '../match/format.ts';
import {
  choiceOf,
  contentsOf,
  inLayout,
  layoutOf,
  mergeOf,
  rowsOf,
  syncOf,
  type Choice,
  type Files,
  type Op,
} from './backup.ts';

const config = (id: string, name = 'Gauntlet'): TournamentConfig => ({
  id,
  name,
  created: '2026-11-18T00:00:00.000Z',
  format: { kind: 'match', pairs: 100, sprt: null },
  entrants: ['a', 'b'],
  control: '10+0.1',
  book: '',
  adjudication: STANDARD_ADJUDICATION,
  concurrency: 4,
  paired: true,
  seed: 7,
});

const blob = (s: string) => new Blob([s]);
const files = (o: Record<string, string>): Files =>
  new Map(Object.entries(o).map(([p, s]) => [p, blob(s)]));

/** a tournament's files, with `n` games played and its games' collection */
function tournament(id: string, n: number, end?: string): Record<string, string> {
  const game = (k: number) => `{"pair":${k}}\n`;
  return {
    [`tournaments/${id}/config.json`]: JSON.stringify(config(id)),
    [`tournaments/${id}/pairs.jsonl`]: Array.from({ length: n }, (_, k) => game(k)).join(''),
    [`tournaments/${id}/games.jsonl`]: Array.from({ length: n }, (_, k) => game(k)).join(''),
    ...(end ? { [`tournaments/${id}/end.json`]: end } : {}),
    [`games/t-${id}.pgn`]: '[Event "g"]\n\n1-0\n'.repeat(n),
  };
}

const index = (...ids: [string, string][]) =>
  JSON.stringify(
    ids.map(([id, name]) => ({
      id,
      name,
      source: id.startsWith('t-') ? 'match' : 'file',
      games: 1,
      bytes: 1,
      updated: '2026-11-18T00:00:00.000Z',
    })),
  );

const relations = async (here: Files, there: Files) =>
  Object.fromEntries(
    (await rowsOf(await contentsOf(here), await contentsOf(there))).map((r) => [r.key, r.relation]),
  );

describe('the layout', () => {
  it('takes only the app files, and a book only when books are kept', () => {
    expect(inLayout('settings.json', false)).toBe(true);
    expect(inLayout('games/index.json', false)).toBe(true);
    expect(inLayout('games/abc.pgn', false)).toBe(true);
    expect(inLayout('tournaments/x/games.jsonl', false)).toBe(true);
    expect(inLayout('tournaments/x/notes.txt', false)).toBe(false);
    expect(inLayout('tournaments/../games.jsonl', false)).toBe(false);
    expect(inLayout('books/8moves_v3.pgn', true)).toBe(false);
    expect(inLayout('user-books/mine.pgn', false)).toBe(false);
    expect(inLayout('user-books/mine.pgn', true)).toBe(true);
  });

  it('takes off the one folder a zipped folder puts around it', () => {
    const f = layoutOf(files({ 'backup/settings.json': '{}', 'backup/games/a.pgn': '' }));
    expect([...f.keys()]).toEqual(['settings.json', 'games/a.pgn']);
  });
});

describe('items', () => {
  it("joins a tournament's folder and its games, and reads each part", async () => {
    const c = await contentsOf(
      files({
        ...tournament('x', 3, '{"status":"done","at":"2026-11-18T01:00:00Z"}'),
        'games/index.json': index(['t-x', 'Gauntlet'], ['c1', 'Opened']),
        'games/c1.pgn': '[Event "a"]\n',
        'user-books/mine.pgn': '[Event "b"]\n',
        'user-books/stray.pgn': '',
        'user-books/list.json': JSON.stringify([
          { id: 'mine.pgn', format: 'pgn', positions: 1, bytes: 12, added: 0 },
        ]),
        'settings.json': '{"theme":"dark"}',
      }),
    );
    expect([...c.items.keys()].toSorted()).toEqual([
      'book:mine.pgn',
      'collection:c1',
      'settings:',
      'tournament:x',
    ]);
    const t = c.items.get('tournament:x');
    expect(t?.files.has('games/t-x.pgn')).toBe(true);
    expect(t?.collection?.id).toBe('t-x');
    expect(t?.facts).toBe('3 games · finished');
    expect(c.items.get('settings:')?.settings?.theme).toBe('dark');
    expect(c.skipped).toEqual(['user-books/stray.pgn: not in user-books/list.json']);
  });

  it('carries a queued tournament with its queue file, and reads it as queued', async () => {
    expect(inLayout('tournaments/q/queued.json', false)).toBe(true);
    const c = await contentsOf(
      files({
        'tournaments/q/config.json': JSON.stringify(config('q')),
        'tournaments/q/queued.json': '{"order":2}',
      }),
    );
    const t = c.items.get('tournament:q');
    expect(t?.files.has('tournaments/q/queued.json')).toBe(true);
    expect(t?.facts).toBe('0 games · queued');
  });

  it('skips a tournament whose config does not read', async () => {
    const c = await contentsOf(files({ 'tournaments/x/config.json': '{"id":"y"}' }));
    expect(c.items.size).toBe(0);
    expect(c.skipped).toHaveLength(1);
  });
});

describe('comparing', () => {
  it('finds a copy with more games ahead, and one with other games diverged', async () => {
    expect(await relations(files(tournament('x', 3)), files(tournament('x', 3)))).toEqual({
      'tournament:x': 'same',
    });
    expect(await relations(files(tournament('x', 5)), files(tournament('x', 3)))).toEqual({
      'tournament:x': 'ahead',
    });
    expect(await relations(files(tournament('x', 2)), files(tournament('x', 3)))).toEqual({
      'tournament:x': 'behind',
    });
    const other = tournament('x', 3);
    other['tournaments/x/games.jsonl'] = '{"pair":9}\n{"pair":8}\n{"pair":7}\n';
    expect(await relations(files(tournament('x', 3)), files(other))).toEqual({
      'tournament:x': 'diverged',
    });
  });

  it('puts the copy that stopped later ahead when the games are the same', async () => {
    const early = tournament('x', 3, '{"status":"stopped","at":"2026-11-18T01:00:00Z"}');
    const late = tournament('x', 3, '{"status":"stopped","at":"2026-11-18T02:00:00Z"}');
    expect(await relations(files(late), files(early))).toEqual({ 'tournament:x': 'ahead' });
  });

  it('names what is only on one side', async () => {
    expect(await relations(files(tournament('x', 1)), files(tournament('y', 1)))).toEqual({
      'tournament:x': 'only here',
      'tournament:y': 'new',
    });
  });

  it('never calls a changed book ahead, though it ends in .pgn', async () => {
    const list = JSON.stringify([{ id: 'b.pgn', format: 'pgn', positions: 1, bytes: 1, added: 0 }]);
    const a = files({ 'user-books/b.pgn': 'ab', 'user-books/list.json': list });
    const b = files({ 'user-books/b.pgn': 'a', 'user-books/list.json': list });
    expect(await relations(a, b)).toEqual({ 'book:b.pgn': 'diverged' });
  });
});

/** the merge's changes, as text */
async function merged(here: Files, there: Files, choose: Record<string, Choice> = {}) {
  const h = await contentsOf(here);
  const t = await contentsOf(there);
  const rows = await rowsOf(h, t);
  const choices = new Map<string, Choice>();
  for (const r of rows) {
    const c = choose[r.key] ?? choiceOf(r, false);
    if (c) choices.set(r.key, c);
  }
  let n = 0;
  const m = await mergeOf(rows, choices, h, t, () => `n${++n}`);
  return {
    rows: rows.map((r) => `${r.key} ${r.relation}`),
    ops: m.ops.map((o: Op) => ('write' in o ? `write ${o.write}` : `remove ${o.remove}`)),
    texts: new Map(
      await Promise.all(
        m.ops
          .flatMap((o) => ('write' in o ? [o] : []))
          .map(async (o) => [o.write, await o.data.text()] as const),
      ),
    ),
    collections: {
      put: m.collections.put.map((c) => `${c.id} ${c.name}`),
      drop: m.collections.drop,
    },
    books: { put: m.books.put.map((b) => b.id), drop: m.books.drop },
    settings: m.settings,
  };
}

describe('merging', () => {
  it('adds what is new, with its index entry, and loses nothing by default', async () => {
    const m = await merged(
      files({ ...tournament('x', 1), 'games/index.json': index(['t-x', 'Gauntlet']) }),
      files({
        ...tournament('x', 1),
        ...tournament('y', 2),
        'games/index.json': index(['t-x', 'Gauntlet'], ['t-y', 'Other']),
      }),
    );
    expect(m.ops).toEqual([
      'write tournaments/y/config.json',
      'write tournaments/y/pairs.jsonl',
      'write tournaments/y/games.jsonl',
      'write games/t-y.pgn',
    ]);
    expect(m.collections).toEqual({ put: ['t-y Other'], drop: [] });
  });

  it('replaces a copy that is behind, folder and games', async () => {
    const m = await merged(
      files({ ...tournament('x', 1), 'games/index.json': index(['t-x', 'Gauntlet']) }),
      files({ ...tournament('x', 2), 'games/index.json': index(['t-x', 'Gauntlet']) }),
    );
    expect(m.ops.slice(0, 2)).toEqual(['remove tournaments/x', 'remove games/t-x.pgn']);
    expect(m.ops).toContain('write tournaments/x/games.jsonl');
    expect(m.collections).toEqual({ put: ['t-x Gauntlet'], drop: ['t-x'] });
  });

  it('keeps both diverged copies, the other under a new id and name', async () => {
    const other = tournament('x', 2);
    other['tournaments/x/games.jsonl'] = '{"pair":9}\n{"pair":8}\n';
    const m = await merged(
      files({ ...tournament('x', 2), 'games/index.json': index(['t-x', 'Gauntlet']) }),
      files({ ...other, 'games/index.json': index(['t-x', 'Gauntlet']) }),
    );
    expect(m.ops).toContain('write tournaments/n1/config.json');
    expect(m.ops).toContain('write games/t-n1.pgn');
    expect(JSON.parse(m.texts.get('tournaments/n1/config.json') ?? '')).toMatchObject({
      id: 'n1',
      name: 'Gauntlet (2)',
    });
    expect(m.collections).toEqual({ put: ['t-n1 Gauntlet (2)'], drop: [] });
  });

  it('mints a readable timestamped id by default when keeping both copies', async () => {
    const other = tournament('x', 2);
    other['tournaments/x/games.jsonl'] = '{"pair":9}\n{"pair":8}\n';
    const h = await contentsOf(
      files({ ...tournament('x', 2), 'games/index.json': index(['t-x', 'Gauntlet']) }),
    );
    const t = await contentsOf(files({ ...other, 'games/index.json': index(['t-x', 'Gauntlet']) }));
    const rows = await rowsOf(h, t);
    const m = await mergeOf(rows, new Map([['tournament:x', 'both']]), h, t);
    const configOp = m.ops.find((o) => 'write' in o && o.write.endsWith('/config.json'));
    expect(configOp && 'write' in configOp ? configOp.write : '').toMatch(
      /^tournaments\/\d{8}-\d{6}-gauntlet-2-[0-9a-f]{4}\/config\.json$/,
    );
  });

  it("never writes a new tournament's games over a collection of the same file", async () => {
    // deleted here, its games kept in Games; the archive still holds the tournament
    const t = tournament('x', 3);
    const kept = {
      'games/t-x.pgn': t['games/t-x.pgn'] ?? '',
      'games/index.json': index(['t-x', 'Gauntlet']),
    };
    const m = await merged(
      files(kept),
      files({ ...t, 'games/index.json': index(['t-x', 'Gauntlet']) }),
    );
    expect(m.rows).toEqual(['tournament:x diverged']);
    expect(m.ops).not.toContain('write games/t-x.pgn');
    expect(m.ops).toContain('write games/t-n1.pgn');
  });

  it('keeps both books under free names', async () => {
    const list = (id: string) =>
      JSON.stringify([{ id, format: 'pgn', positions: 1, bytes: 1, added: 0 }]);
    const m = await merged(
      files({ 'user-books/b.pgn': 'x', 'user-books/list.json': list('b.pgn') }),
      files({ 'user-books/b.pgn': 'y', 'user-books/list.json': list('b.pgn') }),
    );
    expect(m.ops).toEqual(['write user-books/b (2).pgn']);
    expect(m.books).toEqual({ put: ['b (2).pgn'], drop: [] });
  });

  it('joins diverged settings: these values, both sets of templates and controls', async () => {
    const m = await merged(
      files({ 'settings.json': JSON.stringify({ theme: 'dark', controls: ['1+0.01'] }) }),
      files({ 'settings.json': JSON.stringify({ theme: 'light', controls: ['2+0.02'] }) }),
    );
    expect(m.ops).toEqual([]);
    expect(m.settings).toMatchObject({ theme: 'dark', controls: ['1+0.01', '2+0.02'] });
  });

  it('changes nothing for a backup of the same data', async () => {
    const all = files({ ...tournament('x', 2), 'games/index.json': index(['t-x', 'Gauntlet']) });
    const m = await merged(all, all);
    expect(m.ops).toEqual([]);
    expect(m.collections).toEqual({ put: [], drop: [] });
  });
});

describe('syncing', () => {
  it("writes what differs and deletes the rest of the layout, a tournament's folder whole", async () => {
    const ops = await syncOf(
      files({ ...tournament('x', 2), 'settings.json': '{}' }),
      files({
        ...tournament('x', 1),
        ...tournament('gone', 1),
        'settings.json': '{}',
        'notes.txt': 'not ours',
      }),
      true,
    );
    expect(ops.map((o) => ('write' in o ? `write ${o.write}` : `remove ${o.remove}`))).toEqual([
      'write tournaments/x/pairs.jsonl',
      'write tournaments/x/games.jsonl',
      'write games/t-x.pgn',
      'remove games/t-gone.pgn',
      'remove tournaments/gone',
    ]);
  });
});
