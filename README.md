# ratchet-ui

A web app for the Ratchet chess engine. It holds play, games, books, engines and tournaments in the browser. It also
shows a ratchet-bench manager's jobs, hosts and ratings.

Engines run in the browser, each in its own Worker. An engine is a WASI build that speaks UCI, from a package that
Ratchet's `tools/package.ts` writes. The same build serves two uses. It is a local app connected to a manager on
the network, and a static site where the manager view stays empty.

## Commands

```sh
bun install
bun run engines ratchet-<version>   # add a package from ../dist to the manifest, and copy its files
bun run engines                     # copy every package the manifest lists, and check each file's sha256
bun run dev                         # the app, cross-origin isolated, on Vite's dev server
bun run build                       # the static site, in dist/
```

`bun run engines --dist <dir>` reads packages from another folder.

Checks, which the pre-commit hook runs: `bun run typecheck`, `bun run lint`, `bun run knip`, `bun run test` and
`bun run format:check`.

## License

GPL-3.0-or-later. See `LICENSE`.
