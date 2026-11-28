import { describe, expect, it } from 'vitest';
import {
  evalSeries,
  extractGameEval,
  formatClock,
  formatEval,
  formatMoveTime,
  parseMoveComment,
  winChance,
} from './eval.ts';

describe('parseMoveComment', () => {
  it('normalizes fastchess mover-POV scores and mates to White POV', () => {
    expect(parseMoveComment(['+0.35/14 0.120s'], 'white', 1)).toEqual({
      ply: 1,
      mover: 'white',
      cp: 35,
      depth: 14,
      timeSec: 0.12,
      note: '',
    });
    expect(parseMoveComment(['+0.40/16 0.250s'], 'black', 2)).toEqual({
      ply: 2,
      mover: 'black',
      cp: -40,
      depth: 16,
      timeSec: 0.25,
      note: '',
    });
    expect(parseMoveComment(['+M3/12 0.05s'], 'black', 40)).toMatchObject({
      mate: -3,
      depth: 12,
      timeSec: 0.05,
    });
    expect(parseMoveComment(['-M2/10 0.01s'], 'black', 40)).toMatchObject({
      mate: 2,
    });
  });

  it('keeps Lichess [%eval] in White POV and extracts [%clk] and notes', () => {
    expect(parseMoveComment(['[%eval -0.45] [%clk 0:04:40]'], 'black', 20)).toEqual({
      ply: 20,
      mover: 'black',
      cp: -45,
      clockSec: 280,
      note: '',
    });
    expect(parseMoveComment(['[%eval #-3] blunder'], 'white', 31)).toMatchObject({
      mate: -3,
      note: 'blunder',
    });
  });

  it('marks book moves and preserves outcome comments', () => {
    expect(parseMoveComment(['book'], 'white', 1).book).toBe(true);
    expect(parseMoveComment(['+1.50/18 0.300s', 'checkmate'], 'white', 55)).toMatchObject({
      cp: 150,
      note: 'checkmate',
    });
    const zeroBlack = parseMoveComment(['0.00/12 0.10s, White wins by adjudication'], 'black', 10);
    expect(Object.is(zeroBlack.cp, 0)).toBe(true);
    expect(zeroBlack.note).toBe('White wins by adjudication');
  });
});

describe('extractGameEval', () => {
  it('derives move times from consecutive [%clk] values with increment', () => {
    const steps = [
      { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', comments: [] },
      {
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
        comments: ['[%eval 0.20] [%clk 0:05:00]'],
      },
      {
        fen: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
        comments: ['[%eval 0.25] [%clk 0:05:00]'],
      },
      {
        fen: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
        comments: ['[%eval 0.21] [%clk 0:04:55]'],
      },
    ];
    const ge = extractGameEval(steps, '300+2');
    expect(ge.hasEval).toBe(true);
    expect(ge.hasTime).toBe(true);
    expect(ge.points[0]?.timeSec).toBeUndefined();
    expect(ge.points[2]?.timeSec).toBe(7);
    expect(ge.maxTimeSec).toBe(7);
  });
});

describe('formatting and winChance', () => {
  it('maps centipawns and mates onto [-1, 1]', () => {
    expect(winChance({ cp: 0 })).toBeCloseTo(0, 6);
    expect(winChance({ cp: 100 })).toBeCloseTo(0.1974, 3);
    expect(winChance({ mate: 3 })).toBe(1);
    expect(winChance({ mate: -2 })).toBe(-1);
  });

  it('formats eval, move time, and clock cleanly', () => {
    expect(formatEval({ cp: 35 })).toBe('+0.35');
    expect(formatEval({ cp: -120 })).toBe('-1.20');
    expect(formatEval({ cp: 0 })).toBe('0.00');
    expect(formatEval({ mate: 3 })).toBe('+M3');
    expect(formatEval({ mate: -2 })).toBe('-M2');
    expect(formatMoveTime(0.12)).toBe('0.12s');
    expect(formatMoveTime(14.5)).toBe('14.5s');
    expect(formatMoveTime(59.96)).toBe('1m 00s');
    expect(formatMoveTime(72)).toBe('1m 12s');
    expect(formatMoveTime(119.7)).toBe('2m 00s');
    expect(formatClock(280)).toBe('4:40');
    expect(formatClock(3880)).toBe('1:04:40');
  });
});

describe('evalSeries', () => {
  it('separates White and Black engine evaluations and skips book or unevaluated moves', () => {
    const points = [
      parseMoveComment(['book'], 'white', 1),
      parseMoveComment(['book'], 'black', 2),
      parseMoveComment(['+1.50/14 0.10s'], 'white', 3),
      parseMoveComment(['-0.20/14 0.12s'], 'black', 4),
      parseMoveComment(['+2.00/15 0.15s'], 'white', 5),
      parseMoveComment(['+M3/16 0.20s'], 'black', 6),
    ];
    const series = evalSeries(points);
    expect(series.white).toEqual([
      { ply: 3, win: winChance({ cp: 150 }) },
      { ply: 5, win: winChance({ cp: 200 }) },
    ]);
    expect(series.black).toEqual([
      { ply: 4, win: winChance({ cp: 20 }) },
      { ply: 6, win: -1 },
    ]);
  });

  it('leaves the human side empty in a person-vs-engine game', () => {
    const points = [
      parseMoveComment([], 'white', 1),
      parseMoveComment(['+0.50/12 0.10s'], 'black', 2),
      parseMoveComment([], 'white', 3),
      parseMoveComment(['+0.80/12 0.10s'], 'black', 4),
    ];
    const series = evalSeries(points);
    expect(series.white).toEqual([]);
    expect(series.black.map((s) => s.ply)).toEqual([2, 4]);
  });

  it('respects mover color when a FEN starts with Black to move', () => {
    const points = [
      parseMoveComment(['-0.40/10 0.05s'], 'black', 1),
      parseMoveComment(['+0.60/10 0.05s'], 'white', 2),
    ];
    const series = evalSeries(points);
    expect(series.black).toEqual([{ ply: 1, win: winChance({ cp: 40 }) }]);
    expect(series.white).toEqual([{ ply: 2, win: winChance({ cp: 60 }) }]);
  });
});
