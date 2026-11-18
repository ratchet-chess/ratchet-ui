# Ratchet's browser host for WASI builds

A copy of `host/wasi/browser.ts` and `host/wasi/wasi.ts` from Ratchet, commit d05121863715e8d2909bf94b67fcffac5b97c2ed (2026-11-18). It is
GPL-3.0-or-later, as this repo is. `docs/uci-over-wasi.md` in Ratchet states what the host does.

Do not edit these files. Fix the host in Ratchet, then run `bun scripts/vendor-host.ts <ratchet checkout>`.
`scripts/engines.ts` bundles `browser.ts` into `public/engines/wasi-host.js`.
