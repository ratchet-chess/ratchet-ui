# ratchet-ui

A web app for the Ratchet chess engine. It holds play, games, books, engines and tournaments in the browser. It also
shows a ratchet-bench manager's jobs, hosts and ratings.

Engines run in the browser, each in its own Worker. An engine is a WASI build that speaks UCI. `engines.json` lists
the engines the app serves, each a GitHub release asset pinned by its sha256. The same build serves two uses. It is a local app connected to a manager on
the network, and a static site where the manager view stays empty.

## Commands

```sh
bun install
bun run engines                  # download every listed build, check its sha256, and bundle the host
bun run engines add <owner/repo> <tag> <asset.wasm>
                                 # add a GitHub release asset to engines.json, checked against GitHub's digest
bun run engines add-local <package dir>
                                 # add a build on this machine to engines.local.json, which is not committed
bun run dev                      # the app, cross-origin isolated, on Vite's dev server
bun run build                    # the static site, in dist/
```

Every engine runs in `vendor/ratchet-wasi-host/`, a copy of Ratchet's browser host for WASI builds. Its `README.md`
names the commit it came from.

Checks, which the pre-commit hook runs: `bun run typecheck`, `bun run lint`, `bun run knip`, `bun run test` and
`bun run format:check`.

## License

GPL-3.0-or-later. See `LICENSE`.
