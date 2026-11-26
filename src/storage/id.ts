/**
 * Chronological, filesystem-safe, human-readable IDs for tournaments and game collections:
 * `<YYYYMMDD-HHMMSS>-<slug>-<4hex>` in UTC (or `<YYYYMMDD-HHMMSS>-<4hex>` when the name has no
 * ASCII alphanumeric characters). OPFS, the zip export and the mirror folder share one layout, so
 * readable IDs make all three intelligible and sorted with no translation layer.
 */

const MAX_SLUG = 48;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** UTC timestamp formatted as `YYYYMMDD-HHMMSS` for lexical chronological sorting */
function stampOf(at: Date): string {
  return (
    `${at.getUTCFullYear()}${pad2(at.getUTCMonth() + 1)}${pad2(at.getUTCDate())}` +
    `-${pad2(at.getUTCHours())}${pad2(at.getUTCMinutes())}${pad2(at.getUTCSeconds())}`
  );
}

/**
 * Turns a display name into a lowercase ASCII filename slug, keeping internal dots for version
 * numbers (such as `ratchet-0.3.14`) and collapsing separators to single hyphens.
 */
export function slugOf(name: string): string {
  return name
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9.]+/g, '-')
    .replaceAll(/\.{2,}/g, '.')
    .replaceAll(/[.-]*-[.-]*/g, '-')
    .replaceAll(/^[.-]+|[.-]+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/[.-]+$/, '');
}

/** four lowercase hex characters from Web Crypto to prevent same-second collisions */
function randomHex(): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates an immutable, chronologically sortable item ID: `<YYYYMMDD-HHMMSS>-<slug>-<4hex>`.
 *
 * @param name Display title or file stem used for the readable slug.
 * @param at Creation time in UTC; defaults to now.
 * @param suffix Optional 4-char suffix override for deterministic tests.
 * @returns A filename-safe, URL-safe ID, e.g. `20261126-075014-ratchet-0.3.14-vs-sf10-a3f9`.
 */
export function makeId(name: string, at: Date = new Date(), suffix: string = randomHex()): string {
  const stamp = stampOf(at);
  const slug = slugOf(name);
  return slug ? `${stamp}-${slug}-${suffix}` : `${stamp}-${suffix}`;
}
