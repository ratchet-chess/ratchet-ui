# The host of UCI over WASI

A copy of `host/wasi/browser.ts`, `host/wasi/wasi.ts`, `host/wasi/features.ts`, `host/wasi/check.ts`, `host/wasi/check-browser.ts`, `host/wasi/check-worker.ts` from uci-over-wasi, commit 25db098ce58a56a29b71ac24481afed74d5aa07e (2026-11-27).
The files are under the MIT License, in `LICENSE` beside them. `docs/uci-over-wasi.md` in uci-over-wasi states
what the host does.

Do not edit these files. Fix the host in uci-over-wasi, then run its `tools/vendor.ts` again:
`bun <uci-over-wasi>/tools/vendor.ts <this folder> browser.ts wasi.ts features.ts check.ts check-browser.ts check-worker.ts`.
