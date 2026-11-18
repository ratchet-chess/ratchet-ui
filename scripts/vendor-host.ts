/**
 * Copies Ratchet's browser host for WASI builds into vendor/ratchet-wasi-host/, and records the
 * commit it came from. The copy is a snapshot: fix the host in Ratchet, then run this again.
 *
 *   bun scripts/vendor-host.ts <ratchet checkout>
 *
 * It refuses a checkout whose host files have changes not committed, because the recorded
 * commit would then not describe the copy.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FILES = ['host/wasi/browser.ts', 'host/wasi/wasi.ts'];

const from = process.argv[2];
if (from === undefined) {
  console.error('usage: bun scripts/vendor-host.ts <ratchet checkout>');
  process.exit(2);
}
const git = (...args: string[]) =>
  execFileSync('git', ['-C', from, ...args], { encoding: 'utf8' }).trim();

if (git('status', '--porcelain', '--', ...FILES) !== '') {
  console.error(`${FILES.join(', ')} have changes not committed in ${from}`);
  process.exit(1);
}
const commit = git('rev-parse', 'HEAD');
const date = git('log', '-1', '--format=%cs', 'HEAD');

const out = resolve(import.meta.dir, '../vendor/ratchet-wasi-host');
mkdirSync(out, { recursive: true });
for (const f of FILES) copyFileSync(join(from, f), join(out, f.slice(f.lastIndexOf('/') + 1)));
writeFileSync(
  join(out, 'README.md'),
  `# Ratchet's browser host for WASI builds

A copy of \`${FILES.join('` and `')}\` from Ratchet, commit ${commit} (${date}). It is
GPL-3.0-or-later, as this repo is. \`docs/uci-over-wasi.md\` in Ratchet states what the host does.

Do not edit these files. Fix the host in Ratchet, then run \`bun scripts/vendor-host.ts <ratchet checkout>\`.
\`scripts/engines.ts\` bundles \`browser.ts\` into \`public/engines/wasi-host.js\`.
`,
);
console.log(`vendor/ratchet-wasi-host/ is Ratchet ${commit.slice(0, 7)}`);
