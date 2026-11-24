import { TIME_CONTROLS, resolveControl, type TimeControl } from '../chess/clock.ts';
import { fitRatings, likelihoodOfSuperiority, type FitGame } from './fit.ts';
import type { ScannedGame } from './scan.ts';

/**
 * Ratings' list from the games of several collections: which games count, which games form a
 * pair, and each engine's row. The fit itself is in fit.ts.
 */

/** one collection's games, as Ratings reads them */
export interface Source {
  id: string;
  games: ScannedGame[];
  /**
   * a tournament's games per opening, when the collection is a tournament's; its Round tags then
   * number games across the whole tournament. null for any other collection.
   */
  per: 1 | 2 | null;
  /** a tournament's control as its setup saved it; null to read each game's TimeControl tag */
  control: string | null;
}

/** what the list counts */
export interface Filter {
  /** the collections counted, by id */
  collections: ReadonlySet<string>;
  /** a control's key, as `controlKey` gives it; null for every control */
  control: string | null;
  /** false leaves out the games lost by a forfeit */
  forfeits: boolean;
}

/** the one engine Ratings can hold fixed; the user sets its rating in the filter bar */
export const ANCHOR_NAME = 'stockfish-10';

/** the anchor's rating until the user sets one: Stockfish 10 64-bit on CCRL Blitz, list of 2026-10-31 */
export const ANCHOR_RATING = 3509;

export interface Anchor {
  name: string;
  rating: number;
}

export interface Row {
  name: string;
  elo: number;
  /** half the 95% interval; 0 for the anchor */
  error: number;
  /** the interval is the model's: the engine won or lost every game */
  model: boolean;
  /** won (`floor`) or lost (`ceiling`) every game: `elo` is the rating one draw would give */
  bound: 'floor' | 'ceiling' | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** games lost by a forfeit; counted in `losses` unless the filter leaves them out */
  forfeits: number;
  /** points over games */
  score: number;
  /** the average rating of its opponents, each weighed by the games against it */
  opponents: number;
  /** the likelihood that it is stronger than the next row of its pool; null for the last, or no interval */
  los: number | null;
  pool: number;
  anchor: boolean;
}

/** two engines that met, from the first's side; the first is the higher rated */
export interface HeadToHead {
  a: string;
  b: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** a's rating minus b's */
  gap: number;
  /** `>` when `gap` is a floor (a won every game, or b lost every game), `<` when a ceiling */
  mark: '' | '>' | '<';
  /** half the 95% interval of `gap`, from the whole fit; NaN where none reads */
  error: number;
  /** the likelihood that a is the stronger, from the whole fit; null where no interval reads */
  los: number | null;
}

export interface RatingList {
  /** by pool, then by rating, highest first */
  rows: Row[];
  records: HeadToHead[];
  games: number;
  /** the pools; the anchor's, or the one with most games, is 0 */
  pools: number;
  /** the anchor played in the games counted */
  anchored: boolean;
}

/** a control the same whichever way it was written: `2m+1` and PGN's `120+1` are one control */
export function controlKey(tc: TimeControl): string {
  const s = (ms: number) => String(Number((ms / 1000).toFixed(3)));
  if (tc.kind === 'clock') return `${s(tc.baseMs)}+${s(tc.incMs)}`;
  if (tc.kind === 'moves') return `${tc.moves}/${s(tc.periodMs)}`;
  if (tc.kind === 'nodes') return `${tc.nodes} nodes`;
  if (tc.kind === 'movetime') return `${s(tc.ms)}s/move`;
  return `depth ${tc.depth}`;
}

/** a control's key as the app names it: a built-in's label where one matches */
export function controlLabel(key: string): string {
  const built = TIME_CONTROLS.find((t) => controlKey(t) === key);
  if (built) return built.label;
  const m = /^(\d+) nodes$/.exec(key);
  if (m) {
    const n = Number(m[1]);
    return n % 1000 === 0 ? `${n / 1000}k nodes` : key;
  }
  return key;
}

/** PGN's TimeControl tag as a key: seconds, `base+inc` or `moves/period`; '' for any other form */
function pgnControlKey(tag: string): string {
  const s = (x: string | undefined) => String(Number(x));
  let m = /^(\d+(?:\.\d+)?)\+(\d+(?:\.\d+)?)$/.exec(tag);
  if (m) return `${s(m[1])}+${s(m[2])}`;
  m = /^(\d+)\/(\d+(?:\.\d+)?)$/.exec(tag);
  if (m) return `${m[1]}/${s(m[2])}`;
  m = /^(\d+(?:\.\d+)?)$/.exec(tag);
  if (m) return `${s(m[1])}+0`;
  return '';
}

/** a collection's games, each with its control's key and a pair number unique across sources */
interface Counted extends ScannedGame {
  key: string;
  pair: number;
}

/**
 * Splits each source's games into pairs. A tournament's game numbers say its pair; a replayed game
 * is in the collection twice, and the later one counts. Any other collection pairs two adjacent
 * games of the same engines with colors swapped, as fit-rating.ts reads a PGN.
 */
export function pairUp(sources: readonly Source[]): Counted[] {
  const out: Counted[] = [];
  let next = 0;
  for (const src of sources) {
    const tournamentKey = src.control === null ? null : controlKeyOf(src.control);
    const keyOf = (g: ScannedGame) => tournamentKey ?? pgnControlKey(g.control);
    const per = src.per;
    if (per !== null) {
      const last = new Map<string, ScannedGame>();
      const loose: ScannedGame[] = [];
      for (const g of src.games) {
        if (/^\d+\.\d+$/.test(g.round)) last.set(g.round, g);
        else loose.push(g);
      }
      const base = next;
      let top = 0;
      for (const [round, g] of last) {
        const n = Number(round.split('.')[1]);
        const pair = Math.floor((n - 1) / per);
        top = Math.max(top, pair + 1);
        out.push({ ...g, key: keyOf(g), pair: base + pair });
      }
      next = base + top;
      for (const g of loose) out.push({ ...g, key: keyOf(g), pair: next++ });
      continue;
    }
    let second = false;
    let prev: ScannedGame | undefined;
    for (const g of src.games) {
      second = !second && prev !== undefined && prev.white === g.black && prev.black === g.white;
      out.push({ ...g, key: keyOf(g), pair: second ? next - 1 : next++ });
      prev = g;
    }
  }
  return out;
}

function controlKeyOf(label: string): string {
  const tc = resolveControl(label);
  return tc ? controlKey(tc) : label;
}

/** every control met in the sources, by key, with its games */
export function controlsOf(sources: readonly Source[]): Map<string, number> {
  const by = new Map<string, number>();
  for (const g of pairUp(sources)) if (g.white !== g.black) by.set(g.key, (by.get(g.key) ?? 0) + 1);
  return by;
}

/** Ratings' list: the games the filter accepts, fitted, one row per engine. */
export function rate(
  sources: readonly Source[],
  filter: Filter,
  anchor: Anchor | null,
): RatingList {
  const games = pairUp(sources.filter((s) => filter.collections.has(s.id))).filter(
    (g) => (filter.control === null || g.key === filter.control) && (filter.forfeits || !g.forfeit),
  );
  const names: string[] = [];
  const index = new Map<string, number>();
  const at = (name: string) => {
    let i = index.get(name);
    if (i === undefined) {
      i = names.push(name) - 1;
      index.set(name, i);
    }
    return i;
  };
  const fitGames: FitGame[] = [];
  const tally = new Map<
    number,
    { wins: number; draws: number; losses: number; forfeits: number }
  >();
  const between = new Map<
    string,
    { a: number; b: number; wins: number; draws: number; losses: number }
  >();
  const add = (i: number, points: number, forfeited: boolean) => {
    const t = tally.get(i) ?? { wins: 0, draws: 0, losses: 0, forfeits: 0 };
    if (points === 1) t.wins++;
    else if (points === 0) t.losses++;
    else t.draws++;
    if (forfeited) t.forfeits++;
    tally.set(i, t);
  };
  for (const g of games) {
    const w = at(g.white);
    const b = at(g.black);
    if (w === b) continue;
    fitGames.push({ white: w, black: b, score: g.score, pair: g.pair });
    add(w, g.score, g.forfeit && g.score === 0);
    add(b, 1 - g.score, g.forfeit && g.score === 1);
    const [a, c, s] = w < b ? [w, b, g.score] : [b, w, 1 - g.score];
    const key = `${a} ${c}`;
    const m = between.get(key) ?? { a, b: c, wins: 0, draws: 0, losses: 0 };
    if (s === 1) m.wins++;
    else if (s === 0) m.losses++;
    else m.draws++;
    between.set(key, m);
  }
  const anchorIndex = anchor ? index.get(anchor.name) : undefined;
  const fit = fitRatings(
    names.length,
    fitGames,
    anchor && anchorIndex !== undefined ? { index: anchorIndex, rating: anchor.rating } : null,
  );
  // the anchor's pool comes first, so a list with an anchor opens on the scale it fixes
  const order = (pool: number) =>
    fit.anchorPool < 0
      ? pool
      : pool === fit.anchorPool
        ? 0
        : pool < fit.anchorPool
          ? pool + 1
          : pool;
  const eloOf = (i: number) => fit.rated[i]?.elo ?? 0;
  // the opponents' ratings, each weighed by its games, and the games
  const opponents = names.map(() => ({ sum: 0, games: 0 }));
  for (const m of between.values()) {
    const n = m.wins + m.draws + m.losses;
    const [a, b] = [opponents[m.a], opponents[m.b]];
    if (a) a.sum += n * eloOf(m.b);
    if (b) b.sum += n * eloOf(m.a);
    if (a) a.games += n;
    if (b) b.games += n;
  }
  const rows = names
    .map((name, i): Row & { i: number } => {
      const r = fit.rated[i] ?? { elo: 0, error: 0, model: true, pool: 0, bound: null };
      const t = tally.get(i) ?? { wins: 0, draws: 0, losses: 0, forfeits: 0 };
      const n = t.wins + t.draws + t.losses;
      const o = opponents[i] ?? { sum: 0, games: 0 };
      return {
        i,
        name,
        elo: r.elo,
        error: r.error,
        model: r.model,
        bound: r.bound,
        games: n,
        wins: t.wins,
        draws: t.draws,
        losses: t.losses,
        forfeits: t.forfeits,
        score: (t.wins + t.draws / 2) / n,
        opponents: o.games > 0 ? o.sum / o.games : 0,
        los: null,
        pool: order(r.pool),
        anchor: i === anchorIndex,
      };
    })
    .toSorted((x, y) => (x.pool !== y.pool ? x.pool - y.pool : y.elo - x.elo));
  rows.forEach((row, k) => {
    const next = rows[k + 1];
    if (!next || next.pool !== row.pool) return;
    const error = fit.differenceError(row.i, next.i);
    row.los = Number.isNaN(error) ? null : likelihoodOfSuperiority(row.elo - next.elo, error);
  });
  const nameOf = (i: number) => names[i] ?? '?';
  const records = [...between.values()].map((m): HeadToHead => {
    const error = fit.differenceError(m.a, m.b);
    const boundOf = (i: number) => fit.rated[i]?.bound ?? null;
    /** the mark of hi's gap over lo: a floor above or a ceiling below makes it a floor */
    const markOf = (hi: number, lo: number): HeadToHead['mark'] => {
      const up = boundOf(hi) === 'floor' || boundOf(lo) === 'ceiling';
      const down = boundOf(hi) === 'ceiling' || boundOf(lo) === 'floor';
      return up === down ? '' : up ? '>' : '<';
    };
    const ea = eloOf(m.a);
    const eb = eloOf(m.b);
    const played = m.wins + m.draws + m.losses;
    return ea >= eb
      ? {
          a: nameOf(m.a),
          b: nameOf(m.b),
          games: played,
          wins: m.wins,
          draws: m.draws,
          losses: m.losses,
          gap: ea - eb,
          mark: markOf(m.a, m.b),
          error,
          los: Number.isNaN(error) ? null : likelihoodOfSuperiority(ea - eb, error),
        }
      : {
          a: nameOf(m.b),
          b: nameOf(m.a),
          games: played,
          wins: m.losses,
          draws: m.draws,
          losses: m.wins,
          gap: eb - ea,
          mark: markOf(m.b, m.a),
          error,
          los: Number.isNaN(error) ? null : likelihoodOfSuperiority(eb - ea, error),
        };
  });
  const byGames = records.toSorted((x, y) => y.games - x.games);
  const pools = new Set(rows.map((r) => r.pool)).size;
  return {
    rows: rows.map(({ i: _, ...row }) => row),
    records: byGames,
    games: fitGames.length,
    pools,
    anchored: fit.anchorPool >= 0,
  };
}
