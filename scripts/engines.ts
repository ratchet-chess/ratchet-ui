/**
 * Copies engines into the app from Ratchet's packages (`tools/package.ts`), and pins each file by
 * its sha256 in `public/engines.json`. The app serves the files from `public/engines/`, which is
 * not committed; the manifest is.
 *
 *   bun scripts/engines.ts                          copies every engine the manifest lists, and checks it
 *   bun scripts/engines.ts ratchet-0.3.14 ...       adds or replaces these packages in the manifest
 *   bun scripts/engines.ts --dist <dir> ...         reads packages from <dir>, default ../dist
 *
 * A package is a folder `<name>/` with `<name>.js` (the browser Worker), `<name>.wasm` (the WASI
 * build) and `SHA256SUMS`. A file whose hash differs from its package's SHA256SUMS, or from the
 * manifest, stops the script before anything is written.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseManifest, type EngineEntry, type Manifest } from '../src/engine/manifest.ts';

const root = resolve(import.meta.dir, '..');
const manifestPath = join(root, 'public/engines.json');
const outDir = join(root, 'public/engines');

const args = process.argv.slice(2);
const at = args.indexOf('--dist');
const dist = resolve(root, at >= 0 ? (args[at + 1] ?? '') : '../dist');
const names = args.filter((_, i) => at < 0 || (i !== at && i !== at + 1));

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** the hashes a package's SHA256SUMS states, by file name */
function sums(dir: string): Map<string, string> {
  const file = join(dir, 'SHA256SUMS');
  if (!existsSync(file)) fail(`no SHA256SUMS in ${dir}`);
  const out = new Map<string, string>();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim());
    if (m?.[1] !== undefined && m[2] !== undefined) out.set(m[2], m[1]);
  }
  return out;
}

/** a package's entry, with its files checked against its SHA256SUMS */
function entryOf(name: string): EngineEntry {
  const dir = join(dist, name);
  const stated = sums(dir);
  const files = [`${name}.js`, `${name}.wasm`];
  const sha: Record<string, string> = {};
  for (const f of files) {
    const want = stated.get(f) ?? fail(`${name}: SHA256SUMS does not list ${f}`);
    const got = sha256(join(dir, f));
    if (got !== want) fail(`${name}: ${f} hashes to ${got}, and SHA256SUMS says ${want}`);
    sha[f] = got;
  }
  // Ratchet's own packages are ratchet-<semver>; a release's package name is its own
  const own = /^ratchet-(\d+\.\d+\.\d+)$/.exec(name);
  return {
    id: name,
    name: own ? 'Ratchet' : name,
    version: own?.[1] ?? null,
    kind: own ? 'own engine' : 'release',
    worker: `${name}.js`,
    wasm: `${name}.wasm`,
    sha256: sha,
  };
}

const manifest: Manifest = existsSync(manifestPath)
  ? parseManifest(readFileSync(manifestPath, 'utf8'))
  : { engines: [] };

for (const name of names) {
  const entry = entryOf(name);
  const i = manifest.engines.findIndex((e) => e.id === name);
  if (i >= 0) manifest.engines[i] = entry;
  else manifest.engines.push(entry);
}

// every listed file must be in the package folder with the manifest's hash before any is copied
for (const e of manifest.engines) {
  for (const [f, want] of Object.entries(e.sha256)) {
    const src = join(dist, e.id, f);
    if (!existsSync(src)) fail(`${e.id}: ${src} is missing`);
    const got = sha256(src);
    if (got !== want) fail(`${e.id}: ${f} hashes to ${got}, and the manifest says ${want}`);
  }
}

mkdirSync(outDir, { recursive: true });
for (const e of manifest.engines) {
  for (const f of Object.keys(e.sha256)) copyFileSync(join(dist, e.id, f), join(outDir, f));
}
manifest.engines.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `${manifest.engines.length} engines in public/engines/: ${manifest.engines.map((e) => e.id).join(', ')}`,
);
