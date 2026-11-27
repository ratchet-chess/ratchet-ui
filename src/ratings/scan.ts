/**
 * Reads a PGN collection's games for Ratings from their tags alone: the players, the result, the
 * Round and the time control. Moves are never parsed, so a collection of 50,000 games reads in one
 * pass over its text.
 */

import { isForfeitTermination } from '../games/index.ts';

/** one game as Ratings counts it */
export interface ScannedGame {
  white: string;
  black: string;
  /** White's points: 1, 0.5 or 0 */
  score: number;
  /** true when the loser lost by a forfeit: time, an illegal move, a crash or a silent engine */
  forfeit: boolean;
  /** the Round tag, or '' */
  round: string;
  /** the TimeControl tag, or '' */
  control: string;
}

/** a collection's finished games; games without a result or players are counted but not kept */
export interface Scan {
  games: ScannedGame[];
  /** games in the text, finished or not, as Games counts them */
  total: number;
}

const TAG = /^\[([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/;
const SCORES: Record<string, number> = { '1-0': 1, '0-1': 0, '1/2-1/2': 0.5 };

/**
 * An engine's name as Ratings knows it: the PGN name without the ` #2` that a tournament adds
 * when an engine is entered twice, so its games against itself drop out of the fit.
 */
export const engineName = (pgnName: string): string => pgnName.replace(/ #\d+$/, '');

export function scanHeaders(text: string): Scan {
  const clean = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const games: ScannedGame[] = [];
  let total = 0;
  let tags: Record<string, string> | null = null;
  const close = () => {
    if (!tags) return;
    total++;
    const score = SCORES[tags.Result ?? ''];
    const white = tags.White;
    const black = tags.Black;
    if (score !== undefined && white && black) {
      games.push({
        white: engineName(white),
        black: engineName(black),
        score,
        forfeit: score !== 0.5 && isForfeitTermination(tags.Termination ?? ''),
        round: tags.Round ?? '',
        control: tags.TimeControl ?? '',
      });
    }
    tags = null;
  };
  let inTags = false;
  for (const rawLine of clean.split('\n')) {
    const line = rawLine.trimStart();
    const m = line.startsWith('[') ? TAG.exec(line) : null;
    if (m) {
      // a tag after movetext starts the next game
      if (!inTags) close();
      inTags = true;
      (tags ??= {})[m[1] ?? ''] = (m[2] ?? '').replaceAll(/\\(.)/g, '$1');
    } else if (inTags && line.trim() !== '') {
      inTags = false;
    }
  }
  close();
  return { games, total };
}
