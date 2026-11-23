import { signed } from '../ui/format.ts';
import type { RatingList, Row } from './list.ts';

/** Ratings' list as text to paste: an aligned table, or Markdown that forums and GitHub render. */

/** `>` before a floor, `<` before a ceiling, as Ordo marks an engine that won or lost every game */
export const boundMark = (r: Row): string =>
  r.bound === 'floor' ? '>' : r.bound === 'ceiling' ? '<' : '';

/** a row's Elo: on the anchor's scale in its pool, else signed about the pool's average */
export const eloText = (list: RatingList, r: Row): string =>
  boundMark(r) + (list.anchored && r.pool === 0 ? String(Math.round(r.elo)) : signed(r.elo, 0));

/** a likelihood of superiority in percent; above 99.95 it reads 100 */
export const losText = (los: number | null): string =>
  los === null ? '' : los >= 0.9995 ? '100' : (100 * los).toFixed(1);

/** what sets a pool apart from the one above it */
export const POOL_NOTE = 'never met the engines above; ratings average 0';

const HEAD = ['#', 'engine', 'Elo', '±', 'games', 'score %', 'W', 'D', 'L', 'draw %', 'opp', 'LOS'];

function cells(list: RatingList): (string[] | null)[] {
  const out: (string[] | null)[] = [];
  let n = 0;
  list.rows.forEach((r, k) => {
    if (k > 0 && r.pool !== list.rows[k - 1]?.pool) {
      out.push(null);
      n = 0;
    }
    n++;
    out.push([
      String(n),
      r.name,
      eloText(list, r),
      r.anchor || r.bound ? '-' : String(Math.round(r.error)),
      String(r.games),
      (100 * r.score).toFixed(1),
      String(r.wins),
      String(r.draws),
      String(r.losses),
      ((100 * r.draws) / r.games).toFixed(1),
      list.anchored && r.pool === 0 ? String(Math.round(r.opponents)) : signed(r.opponents, 0),
      losText(r.los),
    ]);
  });
  return out;
}

/** the list as an aligned text table, under `heading` lines */
export function ratingText(list: RatingList, heading: readonly string[]): string {
  const body = cells(list);
  const rows = body.filter((r): r is string[] => r !== null);
  const widths = HEAD.map((h, c) => Math.max(h.length, ...rows.map((row) => row[c]?.length ?? 0)));
  const line = (row: string[]) =>
    row
      .map((x, c) => (c === 1 ? x.padEnd(widths[c] ?? 0) : x.padStart(widths[c] ?? 0)))
      .join('  ')
      .trimEnd();
  return [
    ...heading,
    '',
    line(HEAD),
    ...body.map((row) => (row ? line(row) : `-- ${POOL_NOTE} --`)),
  ].join('\n');
}

/** `s` as plain text in Markdown: its special characters escaped, a line break as a space */
export const escapeMarkdown = (s: string): string =>
  s.replaceAll(/[\\|<>*_`[\]]/g, (c) => `\\${c}`).replaceAll(/\s*\n\s*/g, ' ');

/** the list as a Markdown table, under `heading` lines as a list */
export function ratingMarkdown(list: RatingList, heading: readonly string[]): string {
  const row = (xs: string[]) => `| ${xs.join(' | ')} |`;
  const body = cells(list).map((r) =>
    r
      ? row(r.map((x, c) => (c === 1 ? escapeMarkdown(x) : x)))
      : row(['', `*${POOL_NOTE}*`, ...HEAD.slice(2).map(() => '')]),
  );
  return [
    ...heading.map((h) => `- ${escapeMarkdown(h)}`),
    '',
    row(HEAD),
    row(HEAD.map((_, c) => (c === 1 ? ':--' : '--:'))),
    ...body,
  ].join('\n');
}
