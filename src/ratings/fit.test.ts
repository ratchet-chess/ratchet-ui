import { describe, expect, it } from 'vitest';
import { fitRatings, likelihoodOfSuperiority, type Fit, type FitGame, type Rated } from './fit.ts';
import { pairUp } from './list.ts';
import { scanHeaders } from './scan.ts';
import fixture from './joint.fixture.pgn?raw';

/** the fixture's games as the fit takes them, paired as fit-rating.ts pairs a PGN */
function fixtureGames(): { names: string[]; games: FitGame[] } {
  const scanned = pairUp([
    { id: 'f', games: scanHeaders(fixture).games, per: null, control: null },
  ]);
  const names = [...new Set(scanned.flatMap((g) => [g.white, g.black]))];
  const games = scanned.map((g) => ({
    white: names.indexOf(g.white),
    black: names.indexOf(g.black),
    score: g.score,
    pair: g.pair,
  }));
  return { names, games };
}

/** an engine's rating, which the test expects to exist */
function rated(fit: Fit, i: number): Rated {
  const r = fit.rated[i];
  if (!r) throw new Error(`engine ${i} is not rated`);
  return r;
}

describe('fitRatings', () => {
  // ratchet-bench `bun tools/fit-rating.ts --joint src/ratings/joint.fixture.pgn`, printed to three
  // decimals: stockfish-11 is the one anchor, held at 3563. The prior, which the reference has not,
  // moves these games' ratings by about a tenth of an Elo.
  it('matches fit-rating.ts --joint with one anchor', () => {
    const { names, games } = fixtureGames();
    const i = (n: string) => names.indexOf(n);
    const fit = fitRatings(names.length, games, { index: i('stockfish-11'), rating: 3563 });
    const near = (x: number, want: number, within: number) =>
      expect(Math.abs(x - want)).toBeLessThanOrEqual(within);
    near(rated(fit, i('gamma')).elo, 3386.485, 0.2);
    near(rated(fit, i('beta')).elo, 3428.007, 0.2);
    near(rated(fit, i('alpha')).elo, 3488.675, 0.2);
    near(rated(fit, i('gamma')).error, 45.565, 0.05);
    near(rated(fit, i('beta')).error, 37.9, 0.05);
    near(rated(fit, i('alpha')).error, 38.629, 0.05);
    near(fit.differenceError(i('beta'), i('gamma')), 44.354, 0.05);
    near(fit.differenceError(i('alpha'), i('beta')), 39.175, 0.05);
    expect(rated(fit, i('stockfish-11')).error).toBe(0);
  });

  it('rates the same differences with no anchor, averaging 0', () => {
    const { names, games } = fixtureGames();
    const held = fitRatings(names.length, games, { index: 0, rating: 3000 });
    const free = fitRatings(names.length, games);
    const sum = free.rated.reduce((s, r) => s + (r?.elo ?? 0), 0);
    expect(Math.abs(sum)).toBeLessThan(1e-6);
    for (let a = 0; a < names.length; a++)
      for (let b = 0; b < names.length; b++) {
        const d = (f: typeof held) => rated(f, a).elo - rated(f, b).elo;
        expect(d(free)).toBeCloseTo(d(held), 6);
        const e = (f: typeof held) => (a === b ? 0 : f.differenceError(a, b));
        expect(e(free)).toBeCloseTo(e(held), 6);
      }
  });

  it("keeps an engine that won every game finite, with the model's interval", () => {
    const games: FitGame[] = [];
    for (let p = 0; p < 10; p++) {
      games.push({ white: 0, black: 1, score: 1, pair: p });
      games.push({ white: 1, black: 0, score: 0, pair: p });
      games.push({ white: 1, black: 2, score: p % 2 === 1 ? 1 : 0.5, pair: 100 + p });
      games.push({ white: 2, black: 1, score: 0.5, pair: 100 + p });
    }
    const fit = fitRatings(3, games);
    const top = rated(fit, 0);
    expect(Number.isFinite(top.elo)).toBe(true);
    expect(top.model).toBe(true);
    expect(top.error).toBeGreaterThan(200);
    expect(fit.differenceError(0, 1)).toBeNaN();
    expect(rated(fit, 1).model).toBe(false);
  });

  it("falls back to the model's interval where the pairs show no spread", () => {
    // one pair: the fit makes each engine's residuals sum to 0
    const one = fitRatings(2, [
      { white: 0, black: 1, score: 1, pair: 0 },
      { white: 1, black: 0, score: 0.5, pair: 0 },
    ]);
    expect(rated(one, 0).model).toBe(true);
    expect(rated(one, 0).error).toBeGreaterThan(100);
    expect(one.differenceError(0, 1)).toBeNaN();
    // every game drawn between equals
    const drawn: FitGame[] = [];
    for (let p = 0; p < 20; p++) {
      drawn.push({ white: p % 3, black: (p + 1) % 3, score: 0.5, pair: 2 * p });
      drawn.push({ white: (p + 1) % 3, black: p % 3, score: 0.5, pair: 2 * p });
    }
    expect(rated(fitRatings(3, drawn), 0).model).toBe(true);
  });

  it('takes the wider interval below ten pairs', () => {
    const games = (pairs: number): FitGame[] =>
      Array.from({ length: pairs }, (_, p) => [
        { white: 0, black: 1, score: p % 3 === 0 ? 1 : 0.5, pair: p },
        { white: 1, black: 0, score: p % 4 === 0 ? 0 : 0.5, pair: p },
      ]).flat();
    // mostly draws: the model's interval is the wider, and stands below ten pairs only
    const few = fitRatings(2, games(5));
    const many = fitRatings(2, games(40));
    expect(rated(few, 0).model).toBe(true);
    expect(rated(many, 0).model).toBe(false);
    expect(few.differenceError(0, 1)).toBeCloseTo(2 * rated(few, 0).error, 6);
  });

  it("gives every engine the model's interval when the anchor won every game", () => {
    const games: FitGame[] = [];
    for (let p = 0; p < 20; p++) {
      games.push({ white: 0, black: 1 + (p % 2), score: 1, pair: 2 * p });
      games.push({ white: 1 + (p % 2), black: 0, score: 0, pair: 2 * p });
      games.push({ white: 1, black: 2, score: p % 3 === 0 ? 1 : 0.5, pair: 2 * p + 1 });
      games.push({ white: 2, black: 1, score: p % 4 === 0 ? 1 : 0.5, pair: 2 * p + 1 });
    }
    const fit = fitRatings(3, games, { index: 0, rating: 3000 });
    expect(rated(fit, 1).model).toBe(true);
    expect(rated(fit, 1).error).toBeGreaterThan(100);
    // the two that drew among themselves still compare by their pairs
    expect(fit.differenceError(1, 2)).toBeLessThan(100);
  });

  it('rates engines that never met in separate pools', () => {
    const games: FitGame[] = [
      { white: 0, black: 1, score: 1, pair: 0 },
      { white: 1, black: 0, score: 0.5, pair: 0 },
      { white: 2, black: 3, score: 0.5, pair: 1 },
      { white: 3, black: 2, score: 0, pair: 1 },
    ];
    const fit = fitRatings(5, games, { index: 2, rating: 1000 });
    expect(rated(fit, 0).pool).not.toBe(rated(fit, 2).pool);
    expect(fit.anchorPool).toBe(rated(fit, 2).pool);
    expect(rated(fit, 2).elo).toBe(1000);
    expect(rated(fit, 0).elo + rated(fit, 1).elo).toBeCloseTo(0, 6);
    expect(fit.rated[4]).toBeNull();
    expect(fit.differenceError(0, 2)).toBeNaN();
  });
});

describe('likelihoodOfSuperiority', () => {
  it('is a half at no difference and follows the normal law', () => {
    expect(likelihoodOfSuperiority(0, 20)).toBeCloseTo(0.5, 7);
    // a difference of one standard error (the 95% half-interval over 1.96) is 84.13%
    expect(likelihoodOfSuperiority(10, 19.59963984540054)).toBeCloseTo(0.841345, 5);
    expect(likelihoodOfSuperiority(5, 0)).toBe(1);
  });
});
