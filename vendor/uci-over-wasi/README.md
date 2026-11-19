# The host of UCI over WASI

A copy of `host/wasi/browser.ts`, `host/wasi/wasi.ts` from uci-over-wasi, commit 0e678cdc3f98db5434ba9cbfcfb27b47b4b1f7d1 (2026-11-19).
The files are under the MIT License, in `LICENSE` beside them. `docs/uci-over-wasi.md` in uci-over-wasi states
what the host does.

Do not edit these files. Fix the host in uci-over-wasi, then run its `tools/vendor.ts` again:
`bun <uci-over-wasi>/tools/vendor.ts <this folder> browser.ts wasi.ts`.
