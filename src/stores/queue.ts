/**
 * The queue's rules apart from storage: how a queued tournament's file reads, the queue's order,
 * which tournament it starts next, and the keys a reorder writes.
 */
import type { TournamentConfig } from '../match/format.ts';

/** the file in a tournament's folder that marks it queued; it is removed when the tournament starts */
export const QUEUED = 'queued.json';

/** queued.json's order key; null for a file that does not read */
export function orderOf(text: string | null): number | null {
  if (text === null) return null;
  try {
    const x: unknown = JSON.parse(text);
    if (typeof x === 'object' && x !== null && 'order' in x && typeof x.order === 'number')
      return x.order;
  } catch {
    // a torn write
  }
  return null;
}

export const queuedText = (order: number): string => JSON.stringify({ order });

/** one queued tournament as the queue sees it */
export interface Queued {
  config: TournamentConfig;
  queued: number | null;
}

/** the queued tournaments in the queue's order; equal keys by creation */
export const inOrder = <T extends Queued>(items: readonly T[]): T[] =>
  items
    .filter((i) => i.queued !== null)
    .toSorted((a, b) =>
      a.queued === b.queued
        ? a.config.created.localeCompare(b.config.created)
        : (a.queued ?? 0) - (b.queued ?? 0),
    );

/** what this browser has that a tournament needs */
export interface Have {
  engines: ReadonlySet<string>;
  books: ReadonlySet<string>;
}

/** the engines and the book a tournament needs that are not here */
export function lacking(config: TournamentConfig, have: Have): { engines: string[]; book: string } {
  return {
    engines: [...new Set(config.entrants)].filter((e) => !have.engines.has(e)),
    book: config.book && !have.books.has(config.book) ? config.book : '',
  };
}

export const ready = (config: TournamentConfig, have: Have): boolean => {
  const l = lacking(config, have);
  return l.engines.length === 0 && l.book === '';
};

/**
 * The order keys after a reorder: the queue renumbered from 1, so a tournament queued later, keyed
 * by its time, goes after them all. Only the keys that change are returned.
 */
export function reordered<T extends Queued>(
  queue: readonly T[],
  from: number,
  to: number,
): Map<T, number> {
  const out = new Map<T, number>();
  if (to < 0 || to >= queue.length || from === to) return out;
  const next = [...queue];
  const [x] = next.splice(from, 1);
  if (x === undefined) return out;
  next.splice(to, 0, x);
  next.forEach((t, k) => {
    if (t.queued !== k + 1) out.set(t, k + 1);
  });
  return out;
}
