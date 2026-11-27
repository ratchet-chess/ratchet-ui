import { describe, expect, it } from 'vitest';
import { parseInfo } from './info.ts';

describe('parseInfo', () => {
  it('reads a full search line', () => {
    expect(
      parseInfo(
        'info depth 12 seldepth 18 score cp 23 nodes 1902341 nps 412003 hashfull 87 time 4617 pv e2e4 e7e5 g1f3',
      ),
    ).toEqual({
      depth: 12,
      seldepth: 18,
      cp: 23,
      nodes: 1902341,
      nps: 412003,
      hashfull: 87,
      time: 4617,
      pv: ['e2e4', 'e7e5', 'g1f3'],
    });
  });

  it('reads a mate score and its bound', () => {
    expect(parseInfo('info depth 9 score mate -3 upperbound nodes 10')).toEqual({
      depth: 9,
      mate: -3,
      bound: 'upper',
      nodes: 10,
    });
  });

  it('keeps the free text of info string', () => {
    expect(parseInfo('info string hash 16 MB, depth 3')).toEqual({ string: 'hash 16 MB, depth 3' });
  });

  it('skips tokens it does not know', () => {
    expect(parseInfo('info depth 5 currmove e2e4 currmovenumber 1 nodes 99')).toEqual({
      depth: 5,
      nodes: 99,
    });
  });

  it('returns null for other lines', () => {
    expect(parseInfo('bestmove e2e4 ponder e7e5')).toBeNull();
  });

  it('ignores malformed or truncated score tokens without recording NaN', () => {
    expect(parseInfo('info depth 4 score cp')).toEqual({ depth: 4 });
    expect(parseInfo('info depth 4 score cp abc nodes 12')).toEqual({ depth: 4, nodes: 12 });
    expect(parseInfo('info depth 4 score mate xyz lowerbound nodes 5')).toEqual({
      depth: 4,
      bound: 'lower',
      nodes: 5,
    });
    expect(parseInfo('info score unknown nodes 42')).toEqual({ nodes: 42 });
  });
});
