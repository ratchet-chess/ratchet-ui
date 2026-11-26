import { describe, expect, it } from 'vitest';
import { Game } from './game.ts';

const playAll = (g: Game, moves: string) => {
  for (const m of moves.split(' ')) expect(g.play(m), m).toBe(true);
};

describe('Game', () => {
  it('plays a mate and names it', () => {
    const g = new Game();
    playAll(g, 'f2f3 e7e5 g2g4 d8h4');
    expect(g.san).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
    expect(g.outcome).toEqual({ result: '0-1', reason: 'checkmate', termination: 'normal' });
    expect(g.play('a2a3')).toBe(false);
  });

  it('refuses an illegal move and leaves the game as it was', () => {
    const g = new Game();
    expect(g.play('e2e5')).toBe(false);
    expect(g.uci).toEqual([]);
  });

  it("writes castling as the king's move to its target square, from either form", () => {
    const g = new Game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    playAll(g, 'e1g1 e8a8');
    expect(g.uci).toEqual(['e1g1', 'e8c8']);
    expect(g.san).toEqual(['O-O', 'O-O-O']);
  });

  it('draws on the third occurrence of a position', () => {
    const g = new Game();
    playAll(g, 'g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1');
    expect(g.outcome).toBeNull();
    g.play('f6g8');
    expect(g.outcome?.reason).toBe('threefold repetition');
    expect(g.outcome?.result).toBe('1/2-1/2');
  });

  it('draws on stalemate', () => {
    const g = new Game('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
    playAll(g, 'f7f8');
    expect(g.outcome?.reason).toBe('checkmate');
    const s = new Game('7k/8/6K1/8/8/8/8/5Q2 w - - 0 1');
    playAll(s, 'f1f7');
    expect(s.outcome?.reason).toBe('stalemate');
    expect(s.outcome?.result).toBe('1/2-1/2');
  });

  it('draws a fallen flag when the other side cannot mate', () => {
    const g = new Game('8/8/8/4k3/8/8/8/4K2Q w - - 0 1');
    g.flag('black');
    expect(g.outcome?.result).toBe('1-0');
    const h = new Game('8/8/8/4k3/8/8/8/4K2Q w - - 0 1');
    h.flag('white');
    expect(h.outcome?.result).toBe('1/2-1/2');
  });

  it('knows a promotion', () => {
    const g = new Game('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    expect(g.isPromotion('a7', 'a8')).toBe(true);
    expect(g.play('a7a8q')).toBe(true);
    expect(g.san).toEqual(['a8=Q']);
  });

  it("writes an engine's line in SAN, up to its first illegal move", () => {
    const g = new Game();
    expect(g.lineSan(['e2e4', 'e7e5', 'g1f3', 'a1a8', 'b8c6'])).toEqual(['e4', 'e5', 'Nf3']);
    expect(g.uci).toEqual([]);
  });

  it("writes each move's comment after it", () => {
    const g = new Game();
    playAll(g, 'e2e4');
    g.annotate('+0.25/12 0.500s');
    playAll(g, 'e7e5');
    expect(g.pgn({}).split('\n').at(-2)).toBe('1. e4 {+0.25/12 0.500s} e5 *');
  });

  it('tracks fens per ply and undoes moves while restoring position and repetition counts', () => {
    const g = new Game();
    expect(g.fens).toHaveLength(1);
    playAll(g, 'g1f3 g8f6 f3g1 f6g8');
    expect(g.fens).toHaveLength(5);
    g.annotate('+0.10/10 0.050s');
    expect(g.undo(2)).toBe(2);
    expect(g.san).toEqual(['Nf3', 'Nf6']);
    expect(g.uci).toEqual(['g1f3', 'g8f6']);
    expect(g.comments).toEqual(['', '']);
    expect(g.fens).toHaveLength(3);
    expect(g.fen).toBe(g.fens.at(-1));
    expect(g.turn).toBe('white');
    // repetition counts were rebuilt: returning to start once more is only occurrence #2, not #3
    playAll(g, 'f3g1 f6g8');
    expect(g.outcome).toBeNull();
    // undoing past start clamps to available plies and clears an ended outcome
    playAll(g, 'g1f3 g8f6 f3g1 f6g8');
    expect(g.outcome?.reason).toBe('threefold repetition');
    expect(g.undo(1)).toBe(1);
    expect(g.outcome).toBeNull();
    expect(g.undo(50)).toBe(7);
    expect(g.san).toEqual([]);
    expect(g.fens).toHaveLength(1);
  });

  it('writes PGN with the tag roster and the result', () => {
    const g = new Game();
    playAll(g, 'f2f3 e7e5 g2g4 d8h4');
    expect(g.pgn({ White: 'You', Black: 'Ratchet 0.3.14' })).toBe(
      [
        '[Event "?"]',
        '[Site "?"]',
        '[Date "????.??.??"]',
        '[Round "?"]',
        '[White "You"]',
        '[Black "Ratchet 0.3.14"]',
        '[Result "0-1"]',
        '[Termination "normal"]',
        '',
        '1. f3 e5 2. g4 Qh4# {checkmate} 0-1',
        '',
      ].join('\n'),
    );
  });
});
