import type { Color } from 'chessops/types';

/**
 * When the referee ends a game on the engines' own scores, as fastchess's `-draw` and `-resign`
 * do. fastchess-gui's standard preset is the default: a draw from move 40 after 8 moves of each
 * side within 10 cp, and a loss for a side whose last 3 moves scored -600 cp or worse.
 */
export interface Adjudication {
  draw: { moveNumber: number; moveCount: number; score: number } | null;
  resign: { moveCount: number; score: number } | null;
}

export const STANDARD_ADJUDICATION: Adjudication = {
  draw: { moveNumber: 40, moveCount: 8, score: 10 },
  resign: { moveCount: 3, score: 600 },
};

/** a score past any centipawn bound, for a mate */
const MATE_CP = 100_000;

/**
 * Follows a game's engine scores and says when to adjudicate. Feed it every move; a move with no
 * engine score, such as a person's, breaks every run.
 */
export class Adjudicator {
  private readonly rules: Adjudication;
  /** consecutive half-moves with both sides' scores inside the draw bound */
  private quiet = 0;
  /** each side's consecutive moves at or below the resign bound */
  private readonly lost: Record<Color, number> = { white: 0, black: 0 };

  constructor(rules: Adjudication) {
    this.rules = rules;
  }

  /**
   * @param mover the side that moved
   * @param fullmove the number of the move just played
   * @param score the mover's score in centipawns, from its own side; null for none
   * @param mate the mover's mate distance, if its score is a mate
   * @returns the adjudicated outcome, or null to play on
   */
  move(mover: Color, fullmove: number, score: number | null, mate?: number): 'draw' | Color | null {
    const cp = mate !== undefined ? Math.sign(mate) * MATE_CP : score;
    const { draw, resign } = this.rules;
    if (cp === null) {
      this.quiet = 0;
      this.lost[mover] = 0;
      return null;
    }
    if (draw) {
      this.quiet = Math.abs(cp) <= draw.score ? this.quiet + 1 : 0;
      if (fullmove >= draw.moveNumber && this.quiet >= 2 * draw.moveCount) return 'draw';
    }
    if (resign) {
      this.lost[mover] = cp <= -resign.score ? this.lost[mover] + 1 : 0;
      if (this.lost[mover] >= resign.moveCount) return mover === 'white' ? 'black' : 'white';
    }
    return null;
  }
}
