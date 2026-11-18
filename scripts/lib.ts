/**
 * Helpers the scripts share: stopping with a message, reading parsed JSON without assertions,
 * keeping a list file sorted, and GitHub's API and downloads.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const AGENT = { 'user-agent': 'ratchet-ui-scripts' };

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null;

/** the value at `path` inside parsed JSON, or undefined */
export function at(x: unknown, ...path: string[]): unknown {
  let v = x;
  for (const k of path) v = isRecord(v) ? v[k] : undefined;
  return v;
}

/** the text at `path` inside parsed JSON; anything else stops the script */
export function text(x: unknown, what: string, ...path: string[]): string {
  const v = at(x, ...path);
  if (typeof v !== 'string') fail(`${what}: ${path.join('.')} is not text`);
  return v;
}

/** the number at `path` inside parsed JSON; anything else stops the script */
export function num(x: unknown, what: string, ...path: string[]): number {
  const v = at(x, ...path);
  if (typeof v !== 'number') fail(`${what}: ${path.join('.')} is not a number`);
  return v;
}

/** writes `{ [key]: entries }`, sorted by `id`, as a list file */
export function writeList(path: string, key: string, entries: { id: string }[]): void {
  entries.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  writeFileSync(path, `${JSON.stringify({ [key]: entries }, null, 2)}\n`);
}

export function upsert<T extends { id: string }>(list: T[], entry: T): void {
  const i = list.findIndex((e) => e.id === entry.id);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
}

/** GitHub's REST API, without a token: 60 requests an hour, which adding an entry stays far below */
export async function github(path: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { accept: 'application/vnd.github+json', ...AGENT },
  });
  if (!res.ok) fail(`GitHub ${path}: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: AGENT });
  if (!res.ok) fail(`${url}: ${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** a repo's license as GitHub names it, or undefined when GitHub cannot name one */
export async function repoLicense(repo: string): Promise<string | undefined> {
  const spdx = at(await github(`/repos/${repo}`), 'license', 'spdx_id');
  return typeof spdx === 'string' && spdx !== 'NOASSERTION' ? spdx : undefined;
}
