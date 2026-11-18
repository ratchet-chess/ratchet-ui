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
bun run books add <book>         # add a book from official-stockfish/books to books.json, pinned to a commit
bun run dev                      # the app, cross-origin isolated, on Vite's dev server
bun run build                    # the static site, in dist/
```

`books.json` lists the opening books the app can pull. The browser pulls a book from its repo at the pinned commit,
checks the archive's sha256, and keeps the book in its private file system. A user can also add a book from a file of
their own: a `.pgn` or `.epd` file, or a zip archive that holds one. The browser copies it into the same file system and
keeps it only once every opening in it reads. The file's name names the book, so it must not match another book's.

Tourneys plays matches and tournaments between served engines in the browser. The formats are:

- a match of fixed pairs, or an SPRT;
- a round robin, a gauntlet, a Swiss or a knockout.

Each tournament is a folder in the browser's private file system:

- `config.json`, its setup;
- `pairs.jsonl` and `games.jsonl`, one JSON line per pair issued and per game finished;
- `end.json`, once it ends.

Its games' PGN goes to a collection in Games, which stays when the tournament is deleted. Stop now ends
the games in play, and they do not count. Resume plays the unfinished games of the issued pairs, then continues. One
tab at a time plays a tournament.

Every engine runs in `vendor/ratchet-wasi-host/`, a copy of Ratchet's browser host for WASI builds. Its `README.md`
names the commit it came from.

Checks, which the pre-commit hook runs: `bun run typecheck`, `bun run lint`, `bun run knip`, `bun run test` and
`bun run format:check`.

## License

GPL-3.0-or-later. See `LICENSE`.
