import { Chess, castlingSide, normalizeMove } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { INITIAL_FEN, makeBoardFen, makeFen, parseFen } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import type { Color, Move, SquareName } from 'chessops/types';
import { kingCastlesTo, makeSquare, makeUci, opposite, parseUci } from 'chessops/util';

/** How a game ended. */
export interface Outcome {
  result: '1-0' | '0-1' | '1/2-1/2';
  /** in words, such as "checkmate" or "threefold repetition" */
  reason: string;
  /** PGN's Termination value */
  termination: 'normal' | 'time forfeit' | 'rules infraction' | 'adjudication';
}

const win = (color: Color): Outcome['result'] => (color === 'white' ? '1-0' : '0-1');

/**
 * One game of standard chess from a start position: its moves, as UCI and as SAN, and its outcome.
 * chessops judges legality; this adds the draws a position alone cannot see, and the outcomes
 * that come from outside the board (time, resignation, an engine's illegal move).
 */
export class Game {
  readonly startFen: string;
  pos: Chess;
  /** the moves in UCI as engines write them: castling is the king's move to its target square */
  readonly uci: string[] = [];
  readonly san: string[] = [];
  /** each move's PGN comment, such as an engine's score, depth and time; empty for none */
  readonly comments: string[] = [];
  outcome: Outcome | null = null;
  /** how often each position has occurred, keyed as the repetition rule compares positions */
  private readonly seen = new Map<string, number>();

  constructor(fen: string = INITIAL_FEN) {
    this.startFen = fen;
    this.pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    this.count();
  }

  get turn(): Color {
    return this.pos.turn;
  }

  get fen(): string {
    return makeFen(this.pos.toSetup());
  }

  /** the legal moves, as chessground takes them; empty once the game is over */
  dests(): Map<SquareName, SquareName[]> {
    return this.outcome ? new Map<SquareName, SquareName[]>() : chessgroundDests(this.pos);
  }

  /** the last move's squares, for chessground's highlight */
  lastMove(): [SquareName, SquareName] | undefined {
    const last = this.uci.at(-1);
    const move = last === undefined ? undefined : parseUci(last);
    return move && 'from' in move ? [makeSquare(move.from), makeSquare(move.to)] : undefined;
  }

  /** board snapshot after `ply` half-moves (0 is `startFen`), for stepping through played moves */
  positionAt(ply: number): {
    fen: string;
    turn: Color;
    lastMove: [SquareName, SquareName] | undefined;
    check: boolean;
  } {
    const target = Math.max(0, Math.min(ply, this.uci.length));
    if (target === this.uci.length) {
      return {
        fen: this.fen,
        turn: this.turn,
        lastMove: this.lastMove(),
        check: this.pos.isCheck(),
      };
    }
    const pos = Chess.fromSetup(parseFen(this.startFen).unwrap()).unwrap();
    let last: [SquareName, SquareName] | undefined;
    for (let i = 0; i < target; i++) {
      const u = this.uci[i];
      const parsed = u === undefined ? undefined : parseUci(u);
      if (!parsed) break;
      const move = normalizeMove(pos, parsed);
      pos.play(move);
      last = 'from' in move ? [makeSquare(move.from), makeSquare(move.to)] : undefined;
    }
    return {
      fen: makeFen(pos.toSetup()),
      turn: pos.turn,
      lastMove: last,
      check: pos.isCheck(),
    };
  }

  /** whether a move from `orig` to `dest` is a pawn reaching the last rank, so it needs a piece */
  isPromotion(orig: string, dest: string): boolean {
    const move = parseUci(orig + dest);
    if (!move || !('from' in move)) return false;
    const piece = this.pos.board.get(move.from);
    return piece?.role === 'pawn' && (dest[1] === '8' || dest[1] === '1');
  }

  /**
   * Plays a move given in UCI, from a person or an engine, and settles the outcome it brings.
   * @returns false, with nothing played, when the move is not legal here or the game is over
   */
  play(uci: string): boolean {
    if (this.outcome) return false;
    const parsed = parseUci(uci);
    if (!parsed) return false;
    const move = normalizeMove(this.pos, parsed);
    if (!this.pos.isLegal(move)) return false;
    const standard = this.standardUci(move);
    this.san.push(makeSanAndPlay(this.pos, move));
    this.uci.push(standard);
    this.comments.push('');
    this.settle();
    return true;
  }

  /** ends the game on the engines' scores: a draw, or a win for `winner` */
  adjudicate(winner: Color | 'draw', reason: string): void {
    if (this.outcome) return;
    const result = winner === 'draw' ? '1/2-1/2' : win(winner);
    this.outcome = { result, reason, termination: 'adjudication' };
  }

  /** sets the last move's PGN comment */
  annotate(text: string): void {
    if (this.comments.length > 0) this.comments[this.comments.length - 1] = text;
  }

  /** ends the game against `color`, for a fallen flag; a draw if the other side cannot mate */
  flag(color: Color): void {
    if (this.outcome) return;
    this.outcome = this.pos.hasInsufficientMaterial(opposite(color))
      ? {
          result: '1/2-1/2',
          reason: `${color} ran out of time, and ${opposite(color)} cannot mate`,
          termination: 'time forfeit',
        }
      : {
          result: win(opposite(color)),
          reason: `${color} ran out of time`,
          termination: 'time forfeit',
        };
  }

  /** ends the game against `color`, for a resignation or a fault such as an illegal move */
  forfeit(color: Color, reason: string, termination: Outcome['termination'] = 'normal'): void {
    if (this.outcome) return;
    this.outcome = { result: win(opposite(color)), reason, termination };
  }

  /** an engine's line from the current position, in SAN, up to its first move that is not legal */
  lineSan(uci: string[], limit = 10): string[] {
    const pos = this.pos.clone();
    const out: string[] = [];
    for (const u of uci.slice(0, limit)) {
      const parsed = parseUci(u);
      if (!parsed) break;
      const move = normalizeMove(pos, parsed);
      if (!pos.isLegal(move)) break;
      out.push(makeSanAndPlay(pos, move));
    }
    return out;
  }

  /** the game in PGN, with the seven tag roster and any extra tags */
  pgn(tags: Record<string, string>): string {
    const result = this.outcome?.result ?? '*';
    const all: Record<string, string> = {
      Event: '?',
      Site: '?',
      Date: '????.??.??',
      Round: '?',
      White: '?',
      Black: '?',
      ...tags,
      Result: result,
    };
    if (this.startFen !== INITIAL_FEN) {
      all.SetUp = '1';
      all.FEN = this.startFen;
    }
    if (this.outcome) all.Termination = this.outcome.termination;
    const head = Object.entries(all).map(
      ([k, v]) => `[${k} "${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"]`,
    );

    const start = Chess.fromSetup(parseFen(this.startFen).unwrap()).unwrap();
    let n = start.fullmoves;
    let white = start.turn === 'white';
    const words: string[] = [];
    this.san.forEach((san, i) => {
      if (white) words.push(`${n}.`);
      else if (i === 0) words.push(`${n}...`);
      words.push(san);
      const comment = this.comments[i] ?? '';
      if (comment) words.push(`{${comment}}`);
      if (!white) n++;
      white = !white;
    });
    if (this.outcome) words.push(`{${this.outcome.reason}}`);
    words.push(result);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      if (line.length + w.length + 1 > 79) {
        lines.push(line);
        line = w;
      } else line = line ? `${line} ${w}` : w;
    }
    lines.push(line);
    return `${head.join('\n')}\n\n${lines.join('\n')}\n`;
  }

  /** a move's UCI as an engine writes it in standard chess: castling as the king's move to its target */
  private standardUci(move: Move): string {
    const side = castlingSide(this.pos, move);
    if (side && 'from' in move)
      return makeSquare(move.from) + makeSquare(kingCastlesTo(this.pos.turn, side));
    return makeUci(move);
  }

  /**
   * The repetition key: placement, side to move, castling rights and a capture en passant only
   * when one is legal, as FIDE's rule 9.2 compares positions.
   */
  private key(): string {
    const ep = this.pos.epSquare;
    const epLegal =
      ep !== undefined &&
      [...this.pos.allDests()].some(
        ([from, to]) => to.has(ep) && this.pos.board.get(from)?.role === 'pawn',
      );
    const setup = this.pos.toSetup();
    return `${makeBoardFen(setup.board)} ${this.pos.turn} ${[...setup.castlingRights].join(',')} ${epLegal ? ep : '-'}`;
  }

  private count(): number {
    const k = this.key();
    const n = (this.seen.get(k) ?? 0) + 1;
    this.seen.set(k, n);
    return n;
  }

  private settle(): void {
    const repeats = this.count();
    if (this.pos.isCheckmate())
      this.outcome = {
        result: win(opposite(this.pos.turn)),
        reason: 'checkmate',
        termination: 'normal',
      };
    else if (this.pos.isStalemate())
      this.outcome = { result: '1/2-1/2', reason: 'stalemate', termination: 'normal' };
    else if (this.pos.isInsufficientMaterial())
      this.outcome = { result: '1/2-1/2', reason: 'insufficient material', termination: 'normal' };
    else if (repeats >= 3)
      this.outcome = { result: '1/2-1/2', reason: 'threefold repetition', termination: 'normal' };
    else if (this.pos.halfmoves >= 100)
      this.outcome = { result: '1/2-1/2', reason: 'fifty-move rule', termination: 'normal' };
  }
}
