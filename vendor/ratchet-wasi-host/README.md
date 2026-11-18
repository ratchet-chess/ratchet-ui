# Ratchet's browser host for WASI builds

A copy of `host/wasi/browser.ts` and `host/wasi/wasi.ts` from Ratchet, commit 1391b244f54f9c62644fb3f17cad33456bd0884e (2026-11-17). It is
GPL-3.0-or-later, as this repo is. `docs/uci-over-wasi.md` in Ratchet states what the host does.

Do not edit these files. Fix the host in Ratchet, then run `bun scripts/vendor-host.ts <ratchet checkout>`.
`scripts/engines.ts` bundles `browser.ts` into `public/engines/wasi-host.js`.
