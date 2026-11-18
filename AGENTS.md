# Agent instructions

`README.md` has the goal and the commands. This file has the terms and the working rules.

## Terms

The rows for **release**, **own engine**, **WASI build** and **condition** quote Ratchet's `AGENTS.md` § Terms. Ratchet's list holds for every other word the two repos share.

| term             | meaning                                                                                                                                  | not                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **release**      | one program as it stood at one dated version or event; the unit of the inventory and of `engines/`                                       | exhibit, snapshot, edition, version |
| **own engine**   | Ratchet's own program, `engines/ratchet/`: Ratchet's code on the core, with no original                                                  | release, variant                    |
| **WASI build**   | a WASI preview-1 command module that speaks UCI on stdin and stdout, as UCI over WASI states; a release's is `build/wasi/<release>.wasm` |                                     |
| **job**          | the queue's unit of submitted work, as `tools/queue.ts status` lists it                                                                  |                                     |
| **condition**    | a host's one word in the queue's `status` (open, closed, allocated, retiring, drained, silent), with its reason                          | state                               |
| **package**      | one WASI build's distribution files from Ratchet's `tools/package.ts`: the WASI build, its browser Worker and `SHA256SUMS`               |                                     |
| **manifest**     | `public/engines.json`: the packages the app serves, with each file's sha256                                                              |                                     |
| **manager view** | the sections that read a ratchet-bench manager: Jobs, Hosts and Ratings                                                                  |                                     |

## Rules

- **Every section except the manager view works with no manager,** because the same build is also a static site.
- **The manager view only reads.** Control of the manager comes later, through an HTTP API with a token.
- **Engines come in as packages, pinned by sha256.** `bun run engines` copies them and checks each file.
- **Commit the manifest, never the engine files.** `public/engines/` is not committed.
- **Run every engine through its package's Worker.** The Worker and its WASI host are Ratchet's code, so fix them in Ratchet.
- **Keep games and books in OPFS or IndexedDB.** localStorage holds about 5 MB, so it keeps only settings.
- **Serve the app cross-origin isolated where the host allows it.** Without isolation, the Worker uses a slower input mode.
- **This repo is public.** Commit no machine path, host name, address or task reference, in files or in commit messages.
- **A commit passes the pre-commit hook:** format, typecheck, lint, knip and tests.
