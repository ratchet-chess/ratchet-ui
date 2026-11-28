import type { ServedEngine } from '../../engine/manifest.ts';
import type { RatingList, Row } from '../../ratings/list.ts';
import { boundMark } from '../../ratings/report.ts';
import { IN_BROWSER_SOURCE } from '../../stores/engines.ts';
import { count, signed } from '../../ui/format.ts';

/**
 * Filtering, sorting, and Elo formatting for the tournament field picker.
 */

export type EngineKindFilter = 'own' | 'adapted' | 'release' | 'browser';
export type RatedFilter = 'any' | 'rated' | 'unrated';
export type PickerSortKey = 'name' | 'elo';

export interface PickerSort {
  key: PickerSortKey;
  dir: 'asc' | 'desc';
}

export interface PickerFilter {
  query: string;
  /** true selects every family; false filters to `families` */
  familiesAll: boolean;
  families: ReadonlySet<string>;
  /** empty selects every kind */
  kinds: ReadonlySet<EngineKindFilter>;
  rated: RatedFilter;
  eloMin: string;
  eloMax: string;
}

export interface PickerRating {
  row: Row;
  anchored: boolean;
}

export interface FormattedPickerElo {
  text: string;
  errorText: string;
  errorWarn: boolean;
  dimmed: boolean;
  unrated: boolean;
  title: string;
}

export const KIND_FILTERS: readonly { key: EngineKindFilter; label: string }[] = [
  { key: 'own', label: 'Own engine' },
  { key: 'adapted', label: 'Adapted' },
  { key: 'release', label: 'Historical release' },
  { key: 'browser', label: 'In browser' },
];

/** fallback family from an engine id without its trailing version, as `ratchet` for `ratchet-0.3.14` */
const programOf = (id: string) => id.replace(/[-_ ]v?\d[\w.]*$/, '') || id;

/** an engine's family name for grouping: manifest `name` for served builds, else stripped id */
export function familyOf(engine: ServedEngine): string {
  const name = engine.name.trim();
  return engine.source !== IN_BROWSER_SOURCE && name ? name : programOf(engine.id);
}

/** an engine's kind bucket for filtering */
export function kindOf(engine: ServedEngine): EngineKindFilter {
  if (engine.source === IN_BROWSER_SOURCE) return 'browser';
  if (engine.meta?.kind) return engine.meta.kind;
  return /^ratchet(?:HCE)?-/i.test(engine.id) ? 'own' : 'adapted';
}

/** every family represented in `engines`, sorted alphabetically with its count */
export function familiesOf(engines: readonly ServedEngine[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const e of engines) {
    const f = familyOf(e);
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts].toSorted((a, b) => a[0].localeCompare(b[0]));
}

/** engine count per kind bucket */
export function kindCountsOf(engines: readonly ServedEngine[]): Record<EngineKindFilter, number> {
  const counts: Record<EngineKindFilter, number> = { own: 0, adapted: 0, release: 0, browser: 0 };
  for (const e of engines) counts[kindOf(e)]++;
  return counts;
}

/** indexes a RatingList by engine PGN name for picker lookups */
export function ratingsByEngine(list: RatingList): Map<string, PickerRating> {
  const map = new Map<string, PickerRating>();
  for (const row of list.rows) map.set(row.name, { row, anchored: list.anchored });
  return map;
}

function parseBound(raw: string | number): number | null {
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** filters `engines` by name, family, kind, rated status, and Elo range */
export function filterEngines(
  engines: readonly ServedEngine[],
  ratings: ReadonlyMap<string, PickerRating>,
  filter: PickerFilter,
): ServedEngine[] {
  const q = filter.query.trim().toLowerCase();
  const min = parseBound(filter.eloMin);
  const max = parseBound(filter.eloMax);
  const hasEloBound = min !== null || max !== null;

  return engines.filter((e) => {
    if (q && !e.id.toLowerCase().includes(q) && !familyOf(e).toLowerCase().includes(q))
      return false;
    if (!filter.familiesAll && !filter.families.has(familyOf(e))) return false;
    if (filter.kinds.size > 0 && !filter.kinds.has(kindOf(e))) return false;
    const rating = ratings.get(e.id);
    if (filter.rated === 'rated' && !rating) return false;
    if (filter.rated === 'unrated' && rating) return false;
    if (hasEloBound) {
      // an Elo bound hides unrated engines and secondary pools whose scale averages 0
      if (rating?.row.pool !== 0) return false;
      if (min !== null && rating.row.elo < min) return false;
      if (max !== null && rating.row.elo > max) return false;
    }
    return true;
  });
}

function compareName(a: string, b: string, dir: PickerSort['dir']): number {
  const d = a.localeCompare(b, 'en', { numeric: true });
  return dir === 'asc' ? d : -d;
}

/** compares two engine ids by name or Elo (pool 0 first, secondary pools next, unrated last) */
export function compareEngineIds(
  a: string,
  b: string,
  ratings: ReadonlyMap<string, PickerRating>,
  sort: PickerSort,
): number {
  if (sort.key === 'name') return compareName(a, b, sort.dir);
  const ra = ratings.get(a);
  const rb = ratings.get(b);
  if (Boolean(ra) !== Boolean(rb)) return ra ? -1 : 1;
  if (!ra || !rb) return compareName(a, b, 'asc');
  if (ra.row.pool !== rb.row.pool) return ra.row.pool - rb.row.pool;
  const d = sort.dir === 'desc' ? rb.row.elo - ra.row.elo : ra.row.elo - rb.row.elo;
  return d !== 0 ? d : compareName(a, b, 'asc');
}

/** returns `engines` sorted by `sort` */
export function sortEngines(
  engines: readonly ServedEngine[],
  ratings: ReadonlyMap<string, PickerRating>,
  sort: PickerSort,
): ServedEngine[] {
  return engines.toSorted((a, b) => compareEngineIds(a.id, b.id, ratings, sort));
}

/** returns field engine ids sorted once by `sort` */
export function sortFieldIds(
  ids: readonly string[],
  ratings: ReadonlyMap<string, PickerRating>,
  sort: PickerSort,
): string[] {
  return ids.toSorted((a, b) => compareEngineIds(a, b, ratings, sort));
}

/** formats an engine's rating for the picker, matching RatingTable without game counts */
export function formatPickerElo(rating: PickerRating | undefined): FormattedPickerElo {
  if (!rating) {
    return {
      text: '—',
      errorText: '',
      errorWarn: false,
      dimmed: false,
      unrated: true,
      title: 'No rated games',
    };
  }
  const { row, anchored } = rating;
  const mark = boundMark(row);
  const num = anchored && row.pool === 0 ? count(Math.round(row.elo)) : signed(row.elo, 0);
  const text = `${mark}${num}`;
  const errorText = row.anchor || row.bound ? '' : `±${count(Math.round(row.error))}`;
  const errorWarn = row.model && !row.anchor && !row.bound;
  const dimmed = row.pool > 0;

  let title: string;
  if (dimmed) {
    title = `Separate pool (averages 0; not comparable with main pool) · ${text}${errorText ? ` ${errorText}` : ''}`;
  } else if (row.anchor) {
    title = `Anchor · ${text}`;
  } else if (row.bound) {
    title = `${row.bound === 'floor' ? 'Won' : 'Lost'} every game: no finite rating. Shown is the ${row.bound === 'floor' ? 'floor' : 'ceiling'} one draw would give`;
  } else if (row.model) {
    title = `Elo ${text} ${errorText} (too few pairs, or no spread in them: the interval is the model's)`;
  } else {
    title = `Elo ${text} ${errorText}`;
  }
  return { text, errorText, errorWarn, dimmed, unrated: false, title };
}
