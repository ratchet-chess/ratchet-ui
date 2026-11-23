# Agent instructions

`README.md` has the goal and the commands. This file has the terms and the working rules.

## Terms

The rows for **release**, **own engine**, **WASI build** and **condition** quote the `AGENTS.md` of the repo that owns the thing: ratchet-historical, ratchet and ratchet-bench. Those lists hold for every other word this repo shares with them.

| term             | meaning                                                                                                                                                        | not                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **release**      | one program as it stood at one dated version or event; the unit of the inventory and of `engines/`                                                             | exhibit, snapshot, edition, version |
| **own engine**   | Ratchet's own program, `engines/ratchet/`: Ratchet's code on the core, with no original                                                                        | release, variant                    |
| **WASI build**   | a WASI preview-1 command module that speaks UCI on stdin and stdout, as UCI over WASI states; a release's is `build/wasi/<release>.wasm`                       |                                     |
| **job**          | the queue's unit of submitted work, as `tools/queue.ts status` lists it                                                                                        |                                     |
| **condition**    | a host's one word in the queue's `status` (open, closed, allocated, retiring, drained, silent), with its reason                                                | state                               |
| **package**      | one WASI build's distribution files from Ratchet's `tools/package.ts`: the WASI build, its browser Worker and `SHA256SUMS`                                     |                                     |
| **manifest**     | `engines.json`: the maintained list of engines, each a WASI build from a GitHub release, pinned by sha256                                                      |                                     |
| **manager view** | the sections that read a ratchet-bench manager: Jobs and Hosts                                                                                                 |                                     |
| **match**        | two engines' games against each other: on its own, a fixed number of pairs or an SPRT; in a tournament, one pair, or a knockout's pairs until one engine leads | meeting, bout, tie                  |
| **tournament**   | the games of more than two engines in a format: round robin, gauntlet, Swiss or knockout                                                                       |                                     |
| **pair**         | two games on one opening, colors swapped; a match's statistics count pairs. A match, a round robin or a gauntlet may play one game an opening instead          |                                     |
| **bye**          | a Swiss round an engine sits out; it scores one point                                                                                                          |                                     |
| **template**     | a setup saved under a name in this browser; a New may start from one                                                                                           |                                     |
| **pool**         | engines rated on one scale: every two are linked through a chain of games. A rating compares only within its pool, and the anchor fixes its own pool's scale   | group, component                    |

### UI wording and casing

- **Verbosity:** On-page text (rows, panel notes, inline labels) is terse, flexible by context and density. Tooltips, notices, and `?` help notes use plain technical prose.
- **Casing:** Sentence case (uppercase first letter) on labels, buttons, and segmented options. Lowercase on table headers, keeping proper nouns and standard chess abbreviations (`W`, `D`, `L`, `Elo`, `White`, `Black`).
- **Standard words:**

| Concept                | Use                                       | Avoid                                  |
| ---------------------- | ----------------------------------------- | -------------------------------------- |
| Browser storage        | `in browser`, `browser storage`           | `here`, `kept in this browser`         |
| User-uploaded books    | `local books`                             | `Yours`, `a book of yours`             |
| Parallel games / slots | `concurrent`                              | `at once`                              |
| Loading / polling      | `Loading…`, `Retry`, `Refresh`, `Updated` | `Reading…`, `Read again`, `read HH:MM` |
| Saving / validation    | `Saving…`, `Invalid …`                    | `Keeping…`, `does not read`            |

## Rules

- **Every section except the manager view works with no manager,** because the same build is also a static site.
- **The manager view only reads.** Control of the manager comes later, through an HTTP API with a token.
- **The app runs only WASI builds that speak UCI.** No engine brings its own JavaScript.
- **Add an engine to the manifest with `bun run engines add`.** It checks the file against GitHub's published sha256.
- **A build on this machine goes in `engines.local.json`,** which is not committed. `bun run engines add-local` adds a package.
- **Never commit engine files.** `bun run engines` downloads or copies them into `public/engines/` and checks each pin.
- **Every engine runs in one host, `vendor/uci-over-wasi/`.** It is a copy of uci-over-wasi's host, so fix it in uci-over-wasi.
- **After a fix in uci-over-wasi, refresh the copy** with the command that the copy's `README.md` states.
- **Add a book to `books.json` with `bun run books add`.** It checks the book against its repo's own record where one exists.
- **The browser pulls each book from its repo at the pinned commit.** The app serves no copy of a book.
- **Keep games and books in OPFS or IndexedDB.** localStorage holds about 5 MB, so it keeps only settings.
- **Serve the app cross-origin isolated where the host allows it.** Without isolation, the Worker uses a slower input mode.
- **A tournament's pairs come from its saved records alone.** `directorOf` keeps no state, so a resumed tournament pairs as the first run would.
- **A Swiss round is paired from the rounds before it,** so the director waits until a round's games finish.
- **A pair's opening comes from the tournament's seed and the pair's number,** so a resumed pair gets it again.
- **A stopped run writes nothing more.** A late write would make a deleted tournament's folder again.
- **Text that a page always shows is a number or a few words.** These pages are dense and technical.
- **Add a help note only where a reader needs a rule or a definition.** In a form, it is right-aligned in the label's column.
- **Check a page by eye in Chrome before you call it done.** Use about 800 px and full width, with realistic and extreme data.
- **A layout choice gets an HTML mock with its variants first.**
- **Design a list for more than a hundred engines,** user-defined options and saved templates, not for a fixed list.
- **This repo is public.** Commit no machine path, host name, address or task reference, in files or in commit messages.
- **A commit passes the pre-commit hook:** format, typecheck, lint, knip and tests.
