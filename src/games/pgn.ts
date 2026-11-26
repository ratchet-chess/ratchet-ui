import { parsePgn, type Game as PgnGame, type PgnNodeData } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { Game } from '../chess/game.ts';

/** One game of a collection, as its list shows it. */
interface GameSummary {
  /** the game's place in its collection, from 0 */
  index: number;
  tags: Record<string, string>;
  /** half-moves in the main line */
  plies: number;
}

/** A collection's games, parsed once when it is opened. */
export interface Parsed {
  summaries: GameSummary[];
  games: PgnGame<PgnNodeData>[];
}

export function parseCollection(text: string): Parsed {
  const games = parsePgn(text);
  const summaries = games.map((g, index) => {
    let plies = 0;
    for (const _ of g.moves.mainline()) plies++;
    return { index, tags: Object.fromEntries(g.headers), plies };
  });
  return { summaries, games };
}

/** Parses one sliced PGN game, returning null when the text holds no game. */
export function parseSingleGame(text: string): PgnGame<PgnNodeData> | null {
  return parsePgn(text)[0] ?? null;
}

/** One position of a replay: the start, or the position after a move. */
interface Step {
  fen: string;
  /** the move that led here; empty at the start */
  san: string;
  lastMove: [string, string] | undefined;
  check: boolean;
  /** the comments after the move, such as an engine's evaluation and time */
  comments: string[];
}

/** A game's main line as positions, up to its first move that cannot be played. */
export interface Replay {
  steps: Step[];
  /** why the replay stopped early, if it did */
  error: string;
}

export function replay(game: PgnGame<PgnNodeData>): Replay {
  const variant = game.headers.get('Variant');
  if (variant !== undefined && !/^(standard|chess)$/i.test(variant)) {
    return { steps: [], error: `the variant ${variant} is not supported` };
  }
  let g: Game;
  try {
    g = new Game(game.headers.get('FEN'));
  } catch {
    return { steps: [], error: 'the FEN tag is not a legal position' };
  }
  const steps: Step[] = [
    {
      fen: g.fen,
      san: '',
      lastMove: undefined,
      check: g.pos.isCheck(),
      comments: game.comments ?? [],
    },
  ];
  for (const node of game.moves.mainline()) {
    const move = parseSan(g.pos, node.san);
    if (!move || !g.play(makeUci(move))) {
      return {
        steps,
        error: `move ${Math.ceil(steps.length / 2)}, ${node.san}, is not legal here`,
      };
    }
    steps.push({
      fen: g.fen,
      san: node.san,
      lastMove: g.lastMove(),
      check: g.pos.isCheck(),
      comments: node.comments ?? [],
    });
  }
  return { steps, error: '' };
}
