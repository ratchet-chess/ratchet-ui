/**
 * Puts the app's engines in public/engines/. An engine is a WASI build that speaks UCI, and every
 * one runs in the app's own host, vendor/uci-over-wasi/. The builds come from two lists:
 *
 * - engines.json, committed: GitHub release assets, each pinned by its tag's commit and its sha256;
 * - engines.local.json, not committed: builds on this machine, for development.
 *
 *   bun scripts/engines.ts                          downloads or copies every listed build, checks each
 *                                                   sha256, bundles the host, and writes public/engines.json
 *   bun scripts/engines.ts add <owner/repo> <tag> <asset> [--name <name>] [--version <v>] [--license <spdx>]
 *                                                   adds a GitHub release asset to engines.json
 *   bun scripts/engines.ts add-local <package dir>  adds a Ratchet package's WASI build to engines.local.json
 *
 * `add` checks the downloaded file against the sha256 digest GitHub publishes for the asset, so the
 * pin matches the release as published. A build whose sha256 differs from its pin stops the script
 * before anything is written.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { ServedEngine } from '../src/engine/manifest.ts';
import {
  at,
  download,
  fail,
  github,
  isRecord,
  repoLicense,
  sha256,
  text,
  upsert,
  writeList,
} from './lib.ts';

/** a GitHub release asset in engines.json */
interface ReleaseEntry {
  id: string;
  name: string;
  version: string | null;
  repo: string;
  tag: string;
  /** the commit the tag named when the entry was added; a moved tag no longer matches it */
  commit: string;
  asset: string;
  url: string;
  sha256: string;
  /** SPDX identifier; it must permit serving a copy */
  license: string;
}

/** a build on this machine in engines.local.json */
interface LocalEntry {
  id: string;
  name: string;
  version: string | null;
  /** the build's path, absolute or from the repo's root */
  path: string;
  sha256: string;
}

const root = resolve(import.meta.dir, '..');
const listPath = join(root, 'engines.json');
const localPath = join(root, 'engines.local.json');
const outDir = join(root, 'public/engines');
const servedPath = join(root, 'public/engines.json');
const HOST = 'wasi-host.js';

const textOrNull = (x: unknown, what: string, key: string) =>
  at(x, key) === null ? null : text(x, what, key);

/** a list file's entries, as records */
function readList(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  const engines = at(JSON.parse(readFileSync(path, 'utf8')) as unknown, 'engines');
  if (!Array.isArray(engines) || !engines.every(isRecord)) fail(`${path} has no list of engines`);
  return engines;
}

function readReleases(): ReleaseEntry[] {
  return readList(listPath).map((e) => {
    const t = (k: string) => text(e, listPath, k);
    return {
      id: t('id'),
      name: t('name'),
      version: textOrNull(e, listPath, 'version'),
      repo: t('repo'),
      tag: t('tag'),
      commit: t('commit'),
      asset: t('asset'),
      url: t('url'),
      sha256: t('sha256'),
      license: t('license'),
    };
  });
}

function readLocals(): LocalEntry[] {
  return readList(localPath).map((e) => {
    const t = (k: string) => text(e, localPath, k);
    return {
      id: t('id'),
      name: t('name'),
      version: textOrNull(e, localPath, 'version'),
      path: t('path'),
      sha256: t('sha256'),
    };
  });
}

/** an engine's name and version, from Ratchet's package naming, ratchet-<semver> */
function nameOf(id: string): { name: string; version: string | null } {
  const own = /^ratchet-(\d+\.\d+\.\d+)$/.exec(id);
  return own ? { name: 'Ratchet', version: own[1] ?? null } : { name: id, version: null };
}

async function add(args: string[]): Promise<void> {
  const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  const [repo, tag, asset] = args.filter(
    (a, i) => !a.startsWith('--') && !(args[i - 1]?.startsWith('--') ?? false),
  );
  if (repo === undefined || tag === undefined || asset === undefined) {
    fail(
      'usage: bun scripts/engines.ts add <owner/repo> <tag> <asset> [--name] [--version] [--license]',
    );
  }
  if (!asset.endsWith('.wasm'))
    fail(`${asset}: the app runs only WASI builds, so an asset is a .wasm file`);
  const what = `${repo} ${tag}`;
  const assets = at(
    await github(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`),
    'assets',
  );
  if (!Array.isArray(assets)) fail(`${what}: the release lists no assets`);
  const a: unknown = assets.find((x: unknown) => at(x, 'name') === asset);
  if (a === undefined) fail(`${what} has no asset ${asset}`);
  const digest = at(a, 'digest');
  if (typeof digest !== 'string' || !digest.startsWith('sha256:')) {
    fail(`${what} publishes no sha256 digest for ${asset}, so the pin cannot be checked`);
  }
  const url = text(a, what, 'browser_download_url');
  const bytes = await download(url);
  // every WebAssembly module starts with \0asm
  if (bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    fail(`${asset} is not a WebAssembly module`);
  }
  const got = sha256(bytes);
  if (`sha256:${got}` !== digest) fail(`${asset} hashes to ${got}, and GitHub publishes ${digest}`);

  // a lightweight tag names the commit; an annotated tag names a tag object that names it
  let ref = await github(`/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`);
  while (at(ref, 'object', 'type') === 'tag') {
    ref = await github(`/repos/${repo}/git/tags/${text(ref, what, 'object', 'sha')}`);
  }
  const commit = text(ref, what, 'object', 'sha');

  const license =
    opt('--license') ??
    (await repoLicense(repo)) ??
    fail(`${repo} states no license GitHub can name; give one with --license`);

  const id = asset.replace(/\.wasm$/, '');
  const guess = nameOf(id);
  const list = readReleases();
  upsert(list, {
    id,
    name: opt('--name') ?? guess.name,
    version: opt('--version') ?? guess.version,
    repo,
    tag,
    commit,
    asset,
    url,
    sha256: got,
    license,
  });
  writeList(listPath, 'engines', list);
  console.log(`engines.json: ${id} from ${repo} ${tag} (${license}), sha256 ${got.slice(0, 12)}…`);
}

function addLocal(dir: string | undefined): void {
  if (dir === undefined) fail('usage: bun scripts/engines.ts add-local <package dir>');
  const id = basename(resolve(dir));
  const sums = readFileSync(join(dir, 'SHA256SUMS'), 'utf8');
  const want = new RegExp(`^([0-9a-f]{64}) [ *]${id}\\.wasm$`, 'm').exec(sums)?.[1];
  if (want === undefined) fail(`${dir}/SHA256SUMS does not list ${id}.wasm`);
  const path = join(dir, `${id}.wasm`);
  const got = sha256(readFileSync(path));
  if (got !== want) fail(`${path} hashes to ${got}, and SHA256SUMS says ${want}`);
  const list = readLocals();
  upsert(list, { id, ...nameOf(id), path, sha256: got });
  writeList(localPath, 'engines', list);
  console.log(`engines.local.json: ${id}`);
}

async function sync(): Promise<void> {
  const served: ServedEngine[] = [];
  const files = new Map<string, Uint8Array>();

  // every build must match its pin before any file is written
  for (const e of readReleases()) {
    const bytes = await download(e.url);
    const got = sha256(bytes);
    if (got !== e.sha256)
      fail(`${e.id}: ${e.url} hashes to ${got}, and engines.json pins ${e.sha256}`);
    files.set(`${e.id}.wasm`, bytes);
    const { id, name, version, sha256: pin, license } = e;
    served.push({
      id,
      name,
      version,
      wasm: `${id}.wasm`,
      bytes: bytes.length,
      sha256: pin,
      source: `${e.repo} ${e.tag}`,
      license,
    });
  }
  for (const e of readLocals()) {
    if (files.has(`${e.id}.wasm`)) fail(`${e.id} is in both engines.json and engines.local.json`);
    const bytes = new Uint8Array(readFileSync(resolve(root, e.path)));
    const got = sha256(bytes);
    if (got !== e.sha256)
      fail(`${e.id}: ${e.path} hashes to ${got}, and engines.local.json pins ${e.sha256}`);
    files.set(`${e.id}.wasm`, bytes);
    const { id, name, version, sha256: pin } = e;
    served.push({
      id,
      name,
      version,
      wasm: `${id}.wasm`,
      bytes: bytes.length,
      sha256: pin,
      source: 'local',
      license: null,
    });
  }

  mkdirSync(outDir, { recursive: true });
  for (const [name, bytes] of files) writeFileSync(join(outDir, name), bytes);
  const bundle = ['build', 'vendor/uci-over-wasi/browser.ts', '--outfile', join(outDir, HOST)];
  execFileSync('bun', [...bundle, '--format', 'iife', '--target', 'browser'], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  served.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  writeFileSync(servedPath, `${JSON.stringify({ host: HOST, engines: served }, null, 2)}\n`);
  console.log(`public/engines/: ${HOST}, ${served.map((e) => e.id).join(', ') || 'no engines'}`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'add') await add(rest);
else if (command === 'add-local') addLocal(rest[0]);
else if (command === undefined) await sync();
else fail(`unknown command ${command}; see the header of scripts/engines.ts`);
