import { schedule, type Format, type Meeting } from './format.ts';
import type { GameRecord, PairRecord } from './summary.ts';

/** What a director answers when a game slot is free. */
export type Next =
  /** the next pair to issue */
  | Meeting
  /** no pair can be issued until a game in play finishes, as between a Swiss round's results */
  | 'wait'
  /** the format has issued every pair it will */
  | 'done';

/**
 * Decides a tournament's next pair from what is already issued and finished. It keeps no state of
 * its own, so a resumed tournament gets the same pairs from its saved records.
 */
export interface Director {
  next(pairs: readonly PairRecord[], games: readonly GameRecord[]): Next;
}

/** the director of a format, for a field of `entrants` engines */
export function directorOf(format: Format, entrants: number): Director {
  const meetings = schedule(format, entrants);
  return { next: (pairs) => meetings[pairs.length] ?? 'done' };
}
