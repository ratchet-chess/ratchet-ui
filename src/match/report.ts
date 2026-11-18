import type { Format } from './format.ts';
import type { MatchStats, Standing } from './summary.ts';

/** The standings' tiebreak columns a format shows, in the order its standings rank by them. */
export type Tiebreak = 'buchholz' | 'sb';

export function tiebreaks(format: Format): Tiebreak[] {
  if (format.kind === 'swiss') return ['buchholz', 'sb'];
  if (format.kind === 'roundrobin' || format.kind === 'gauntlet') return ['sb'];
  return [];
}

export const TIEBREAK_NAMES: Record<Tiebreak, string> = { buchholz: 'Buchholz', sb: 'SB' };

/** a standing's score: points from games over games, so a bye does not raise it */
export const score = (r: Standing): number | null =>
  r.games > 0 ? (r.points - r.byes) / r.games : null;

const signed = (v: number, d = 1) =>
  Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(d)}` : v > 0 ? '+inf' : '-inf';
const pm = (ci: number) => (Number.isFinite(ci) ? ci.toFixed(1) : 'inf');

/**
 * A match's statistics as text to paste, in OpenBench's stat block: Elo and nElo with their 95%
 * intervals, the LLR and its bounds, the games and the pentanomial.
 */
export function matchText(heading: string, setup: string, m: MatchStats): string {
  const [w, d, l] = m.wdl;
  const lines = [
    heading,
    `Elo   | ${signed(m.elo.value, 2)} +- ${pm(m.elo.ci)} (95%)`,
    `nElo  | ${signed(m.nelo.value, 2)} +- ${pm(m.nelo.ci)} (95%)`,
    `Setup | ${setup}`,
  ];
  if (m.llr !== null && m.bounds) {
    const verdict = m.verdict ? ` ${m.verdict} accepted` : '';
    lines.push(
      `LLR   | ${m.llr.toFixed(2)} (${m.bounds.lower.toFixed(2)}, ${m.bounds.upper.toFixed(2)})${verdict}`,
    );
  }
  lines.push(`Games | N: ${w + d + l} W: ${w} D: ${d} L: ${l}`, `Penta | [${m.ptnml.join(', ')}]`);
  return lines.join('\n');
}

/** standings as an aligned text table to paste, under a heading and over a line of games played */
export function standingsText(
  heading: string,
  format: Format,
  rows: readonly Standing[],
  names: readonly string[],
  footer: string,
): string {
  const breaks = tiebreaks(format);
  const byes = format.kind === 'swiss';
  const head = [
    '#',
    'engine',
    'games',
    'W',
    'D',
    'L',
    'points',
    'score',
    ...(byes ? ['byes'] : []),
    ...breaks.map((t) => TIEBREAK_NAMES[t]),
    'Elo',
  ];
  const body = rows.map((r, n) => {
    const s = score(r);
    return [
      String(n + 1),
      names[r.entrant] ?? '?',
      String(r.games),
      String(r.wins),
      String(r.draws),
      String(r.losses),
      r.points.toFixed(1),
      s === null ? '-' : `${(100 * s).toFixed(1)}%`,
      ...(byes ? [String(r.byes)] : []),
      ...breaks.map((t) => r[t].toFixed(2)),
      r.elo === null ? '-' : signed(r.elo, 0),
    ];
  });
  const widths = head.map((h, c) => Math.max(h.length, ...body.map((row) => row[c]?.length ?? 0)));
  // the engine's name reads left to right; the numbers line up on the right
  const line = (cells: string[]) =>
    cells
      .map((x, c) => (c === 1 ? x.padEnd(widths[c] ?? 0) : x.padStart(widths[c] ?? 0)))
      .join('  ')
      .trimEnd();
  return [heading, '', line(head), ...body.map(line), '', footer].join('\n');
}
