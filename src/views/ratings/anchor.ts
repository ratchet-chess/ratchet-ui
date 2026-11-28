import { ANCHOR_NAME, ANCHOR_RATING, type RatingList, type Row } from '../../ratings/list.ts';

/**
 * Ordering and rating transitions for the Ratings anchor picker: None first, the default engine
 * next when present, then the remaining engines by games played.
 */

export interface AnchorOption {
  /** engine name, or null for None (average 0) */
  name: string | null;
  label: string;
  games: number | null;
  /** true for the default anchor engine (stockfish-10) */
  isDefault: boolean;
  /** pool index from the current list; null for None */
  pool: number | null;
}

export interface AnchorOptions {
  hits: AnchorOption[];
  /** total matching engine options (excluding None) */
  matchedEngines: number;
  truncated: boolean;
}

/** maximum options shown at once; typing narrows a long list */
export const ANCHOR_LIMIT = 80;

/**
 * Builds the filtered, ordered option list for the anchor picker.
 *
 * @param rows - rows of the current filtered rating list
 * @param query - user's search text
 * @param selected - currently selected anchor engine name, or null for None
 * @returns visible options, total matching engine count, and truncation flag
 */
export function anchorOptions(
  rows: readonly Row[],
  query: string,
  selected: string | null,
): AnchorOptions {
  const q = query.trim().toLowerCase();
  const none: AnchorOption = {
    name: null,
    label: 'None (average 0)',
    games: null,
    isDefault: false,
    pool: null,
  };
  const showNone = !q || none.label.toLowerCase().includes(q);

  const defRow = rows.find((r) => r.name === ANCHOR_NAME);
  const rest = rows
    .filter((r) => r.name !== ANCHOR_NAME)
    .toSorted((a, b) => (b.games !== a.games ? b.games - a.games : a.name.localeCompare(b.name)));
  const ordered = defRow ? [defRow, ...rest] : rest;
  const matched = q ? ordered.filter((r) => r.name.toLowerCase().includes(q)) : ordered;

  const engineBudget = showNone ? ANCHOR_LIMIT - 1 : ANCHOR_LIMIT;
  let visible = matched.slice(0, engineBudget);
  if (!q && selected !== null && selected !== ANCHOR_NAME) {
    const selRow = matched.find((r) => r.name === selected);
    if (selRow && !visible.includes(selRow)) {
      visible = [...visible.slice(0, Math.max(0, engineBudget - 1)), selRow];
    }
  }

  const hits: AnchorOption[] = [];
  if (showNone) hits.push(none);
  for (const r of visible) {
    hits.push({
      name: r.name,
      label: r.name,
      games: r.games,
      isDefault: r.name === ANCHOR_NAME,
      pool: r.pool,
    });
  }
  return {
    hits,
    matchedEngines: matched.length,
    truncated: matched.length > visible.length,
  };
}

export interface PickedAnchor {
  name: string | null;
  rating: number | null;
  /** true when anchoring an engine that had no anchored scale yet, so the UI can focus the rating box */
  needsRating: boolean;
}

/**
 * Resolves the next anchor name and rating when the user picks an engine (or None):
 * - None clears both name and rating (average 0).
 * - The default engine restores its default CCRL rating.
 * - An engine already rated in an anchored pool keeps its rounded rating, preserving the scale.
 * - An engine in an unanchored pool starts at 0 and asks the UI to focus the rating input.
 *
 * @param list - current rating list before the switch
 * @param nextName - chosen engine name, or null for None
 * @returns next anchor name, rating, and whether the rating box should be focused
 */
export function pickAnchor(list: RatingList, nextName: string | null): PickedAnchor {
  if (nextName === null) return { name: null, rating: null, needsRating: false };
  if (nextName === ANCHOR_NAME) {
    return { name: ANCHOR_NAME, rating: ANCHOR_RATING, needsRating: false };
  }
  const row = list.rows.find((r) => r.name === nextName);
  if (list.anchored && row?.pool === 0) {
    return { name: nextName, rating: Math.round(row.elo), needsRating: false };
  }
  return { name: nextName, rating: 0, needsRating: true };
}
