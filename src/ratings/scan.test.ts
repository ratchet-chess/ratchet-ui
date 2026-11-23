import { describe, expect, it } from 'vitest';
import { parseCollection } from '../games/pgn.ts';
import { engineName, scanHeaders } from './scan.ts';

const PGN = `[Event "t"]
[Round "1.1"]
[White "ratchet-0.3.14"]
[Black "ratchet-0.3.14 #2"]
[Result "1-0"]
[TimeControl "10+0.1"]

1. e4 e5 2. Nf3 {[%clk 0:00:09]
[%eval 0.3]} Nc6 1-0

[Event "t"]
[Round "1.2"]
[White "stash \\"9\\""]
[Black "ratchet-0.3.13"]
[Result "1-0"]
[Termination "rules infraction"]

1. d4 1-0

[Event "t"]
[White "a"]
[Black "b"]
[Result "*"]

1. c4 *

[Event "t"]
[White "a"]
[Black "b"]
[Result "1/2-1/2"]
[Termination "time forfeit"]

1/2-1/2
`;

describe('scanHeaders', () => {
  it('reads players, result, round, control and forfeits from the tags alone', () => {
    const { games, total } = scanHeaders(PGN);
    expect(total).toBe(4);
    expect(games).toEqual([
      {
        white: 'ratchet-0.3.14',
        black: 'ratchet-0.3.14',
        score: 1,
        forfeit: false,
        round: '1.1',
        control: '10+0.1',
      },
      {
        white: 'stash "9"',
        black: 'ratchet-0.3.13',
        score: 1,
        forfeit: true,
        round: '1.2',
        control: '',
      },
      // a draw is never a forfeit, whatever the tag says
      { white: 'a', black: 'b', score: 0.5, forfeit: false, round: '', control: '' },
    ]);
  });

  it('counts the games Games counts', () => {
    expect(scanHeaders(PGN).total).toBe(parseCollection(PGN).summaries.length);
  });

  it("strips a tournament's second entry mark from a name", () => {
    expect(engineName('ratchet-0.3.14 #2')).toBe('ratchet-0.3.14');
    expect(engineName('Engine #2b')).toBe('Engine #2b');
  });
});
