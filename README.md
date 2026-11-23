# ratchet-ui

A web app for the Ratchet chess engine. It holds play, games, books, engines, tournaments and ratings in the browser. It
also shows a ratchet-bench manager's jobs and hosts.

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

A match, a round robin or a gauntlet may play each opening once, colors alternating, instead of as a pair; a match's
statistics then count games (trinomial) instead of pairs (pentanomial). A time control is a built-in one or one typed
in: `10+0.1` (seconds; `2m+1` for minutes), `40/15` (moves in minutes), `200k nodes`, `1s/move` or `depth 12`. Typed
controls and templates, setups saved under a name, stay in this browser's settings. Clone starts a new setup from a
tournament's.

Each tournament is a folder in the browser's private file system:

- `config.json`, its setup;
- `pairs.jsonl` and `games.jsonl`, one JSON line per pair issued and per game finished;
- `end.json`, once it ends.

Its games' PGN goes to a collection in Games, which stays when the tournament is deleted. Stop now ends
the games in play, and they do not count. Resume plays the unfinished games of the issued pairs, then continues. One
tab at a time plays a tournament.

With none selected, Tourneys shows an overview: tournaments running, stopped and finished, and notices of what wants
a look. A notice is about a run its tab left, games that ended abnormally (a time loss, an illegal move, no move given or an
engine failure), an engine or book a resume needs, or storage near its quota. Finished tournaments move into a monthly
archive 30 days after their end. A run's time left is timed by its pace in this tab.

A tournament's standings rank by points, then by Buchholz in a Swiss, then by Sonneborn-Berger, then by head to head
among the engines still tied, as fastchess-gui does. A bye adds to neither tiebreak. A match's page charts its LLR
and Elo over the pairs. Copy puts a match's statistics, in OpenBench's stat block, or a tournament's standings on
the clipboard as text. PGN downloads the games played so far. A game in Last games opens in Games, found by its
PGN `Round` tag.

Ratings rates every engine from the games in Games, a tournament's or a PGN file's, and needs no manager. It reads
only each game's tags. The fit is logistic maximum likelihood with a draw as half a win, as fastchess-gui's rating
list and ratchet-bench's `tools/fit-rating.ts` fit it, and a test pins it to the latter. The interval comes from the
spread of results over color-swapped pairs, so it counts draws and each pair's correlation. Below ten pairs, where that
spread reads narrow, the wider of it and the model's interval stands. A tournament's game
numbers give its pairs; in any other collection, two adjacent games with colors swapped are a pair. An engine is known
by its PGN name. An engine that won or lost every game has no finite rating; as Ordo does, it is
fitted out and shown at the floor (`>`) or ceiling (`<`) one draw would give. Engines that never met, through any chain of opponents, form separate pools, and a rating compares
only within its pool. Stockfish 10, at a rating typed in, fixes its pool's scale; every other pool averages 0. Played
games are a person's, so they are left out until chosen. A forfeit counts as a loss unless a filter leaves it out. An engine's ± is against the anchor, or its pool's average;
LOS and Head to head read the gap between two engines, from the whole fit.

The browser may delete its private file system: clearing site data or losing the profile loses it. The first write
asks the browser to keep it, and Settings shows whether it agreed. Settings also backs the data up, in the file
system's own layout plus a `settings.json`:

- Export downloads one zip archive, stored without compression; Import merges one back.
- In Chrome and Edge, a mirror folder the user picks receives a copy of each change.

Both hold the tournaments, the collections of games, the settings and, unless Settings leaves them out, the user's
books. Pulled books are left out, because a pull fetches them again. A merge adds what is new, and takes the copy
with more games when one copy is the other with games added. It asks about every other difference: keep this
browser's copy, replace it, or keep both. At startup, a mirror folder that holds nothing this browser lacks
receives this browser's changes. Any other folder waits for the user to review it. After a reload the browser asks
again for leave to write the folder.

Settings sets the theme: light, dark, or as the system asks. The style page, `#/style`, shows the colors, the type
scale and the shared pieces every page is drawn from. `src/style.css` holds them, and a test fails on a raw color or
font size in a view.

Every engine runs in `vendor/uci-over-wasi/`, a copy of uci-over-wasi's browser host for WASI builds. Its `README.md`
names the commit it came from. `scripts/engines.ts` bundles its `browser.ts` into `public/engines/wasi-host.js`.

Checks, which the pre-commit hook runs: `bun run typecheck`, `bun run lint`, `bun run knip`, `bun run test` and
`bun run format:check`. CI runs the same checks and the build.

## License

GPL-3.0-or-later. See `LICENSE`.
