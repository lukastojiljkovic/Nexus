# ADR-094 — Tool packs: a GPL program, as a separate process in a signed folder

**Status:** accepted (2026-10-10) · **Owner:** founder · Amends
[ADR-091](091-content-packs.md) §2 and §9

## 1. The finding

Two things Nexus wants are free programs rather than free content: a strong chess
engine, and a DWG reader. Both of the good ones are GPL — Stockfish is
GPL-3.0-or-later, GNU LibreDWG the same — and Nexus is Apache-2.0 (`ADR-087`).
Apache-2.0 and GPLv3 are compatible in one direction only: Apache-2.0 code may go
into a GPLv3 work, and GPLv3 code may not go into an Apache-2.0 work. So a program
cannot be a dependency, cannot be a library, and cannot be a WASM module loaded in
process — all three are one combined program, and the combined program would be
GPLv3.

A separate program is a different thing. GPLv3 §5 says a compilation that holds a
covered work beside separate, independent works is an **aggregate**, and the
licence does not reach the other parts. Two processes talking over a documented
protocol, one of them started by the other, are the classic aggregate; the
research in `research/chess/report.md` §2.8 and `research/dwg/report.md` §2.2
works the licence through and reaches the same answer from both directions.

What was missing was not the licence reasoning but the machinery: a way to get a
program onto the machine inside something this app already trusts, and a way to
run it that does not turn the app into a launcher for whatever is on disk.

## 2. The decision

**The pack format gains one kind, `tool`** (ADR-091's five become six). It is the
one kind whose pack is executed, and ADR-091's "a pack carries no code and is
never executed" is amended for it and for nothing else. A `tool` pack carries a
`tool` record beside the manifest fields ADR-091 defines:

```json
{
  "kind": "tool",
  "tool": { "entry": "engine/stockfish-windows-x86-64-universal.exe", "protocol": "uci" },
  "files": [{ "path": "engine/stockfish-…exe", "size": 103046300, "sha256": "…" }]
}
```

- **`entry` is one of `files`, exactly.** It is the program, it is covered by the
  release key's signature like every other byte of the pack, and the installed
  folder is walked against the manifest before anything is copied (`ADR-091` §4),
  so an entry that names nothing installs nothing.
- **`protocol` is `"uci"` or `"stdio"`** — how the program is spoken to, and
  nothing more. A tool pack is not a plugin system: it is one executable and one
  of two ways to talk to it.
- **`args` is optional**, a short list of fixed arguments. It exists because an
  invocation is a decision (a converter's `-y`, an engine's `--threads`) and a
  decision that is signed is a decision a user can read. A caller may append its
  own arguments — main does, and nothing a renderer sends ever reaches argv.
- **The record is refused on every other kind, and required on this one.** A
  `content` pack carrying a `tool` record is a pack whose author expected it to be
  run, and reading past the field would install a pack that does nothing the
  author meant; a `tool` pack without one names no program. Both are
  `tool-invalid`, one code for the whole record, for `path-invalid`'s reason: the
  rules are many and the one thing a user can act on is that this pack is not a
  tool pack this build will run.

`scripts/pack-sign.mjs` gains the same key, optional, refused on any other kind,
and refuses a `tool` pack whose `entry` is not one of the files it just measured
— **before it reads the private key**, because the moment to find that out is
before the key is used rather than after.

## 3. Running one

`apps/desktop/src/main/tools/run.ts` is the only place this application starts a
process that somebody else wrote, and it is written as the security boundary it
is:

1. **The program is the manifest's entry, and nothing else.** argv is the
   manifest's fixed `args` plus what main appends; `shell: false`, so argv
   elements reach the program as a list and are never re-read as a command line
   by `cmd.exe`.
2. **Its bytes are the bytes the release key signed.** Before the FIRST spawn of
   a session the entry file is hashed and compared with the manifest that
   `openPackSource` or `readInstalled` already verified a signature over. A pack
   whose entry was replaced after install does not run. The check is per session,
   not per spawn: a session is one board, one conversion, one conversation.
3. **It runs in an empty directory of its own, under a name this app chose.** The
   working directory is a fresh folder under `%TEMP%`, and an input file is
   staged into it (`stageInput`) under a random name: the program is never told
   where the user's file lives, and what it writes is something `close()` deletes.
4. **It inherits nothing this app holds.** `toolEnvironment` builds the child's
   environment from nothing rather than filtering `process.env`, and `PATH` is the
   entry's own directory. (Measured: Node itself adds a fixed handful on
   Windows — the user name, the profile path, the system drive — and the module's
   comment names them, because a claim like "inherits nothing" is worth being
   exactly true about.)
5. **It cannot run forever and cannot talk forever.** A time limit and an output
   cap, both enforced by killing the process, and `killAllToolSessions()` for the
   app-quit handler: a process that outlives the window that started it has no
   owner and no cancel.

**What this is not** is a sandbox, and the module says so in its own header: no
memory cap, no job object, no file-system confinement, and no way to take the
network away from a child. What it gives is a bounded, killable, hash-checked
process with a clean directory and a clean environment — the part an in-process
API can actually guarantee. A tool pack is untrusted code from a publisher this
app chose to trust, not a program this app has contained, and the DWG research is
the reason that sentence is in the ADR rather than in a commit message: the
decoder is C, and its own `NEWS` is a list of heap overflows.

## 4. The two clients

- **`tools/uci.ts`** speaks UCI: handshake (`uci` → `uciok`), `id` and `option`
  lines, `setoption` + `isready`, `ucinewgame`, `position`, `go` with depth,
  nodes, mate or movetime limits, `info` parsing, `bestmove`, `stop`, `quit`. It
  is sequential by construction — one request at a time — because the protocol
  carries no correlation id and guessing which answer belongs to which question
  is the bug that shape makes impossible. A search with no limit is refused
  before it is sent: tokens left out mean `go infinite`.
- **`tools/dwg.ts`** runs `dwg2dxf`: copy the input into the session, `-y -o
  <out>.dxf <in>.dwg`, a sixty-second deadline, an output cap on the drawing it
  produces, and the DXF bytes or an error that carries the converter's own last
  words. Nexus renders DXF natively; this exists because DWG is proprietary and
  the one published specification for it grants no right to implement
  (`research/dwg/report.md` §2.1).

Neither is wired to a page. The chess page and the CAD viewer come later and plug
into these; nothing here adds an IPC channel, and no renderer ever learns a
program's name.

## 5. The builders

`scripts/packs/stockfish/` and `scripts/packs/libredwg/` build the two packs the
way ADR-091's signing tool expects: download the publisher's own Windows x64
release into `%TEMP%\nexus-pack-cache\<id>\`, verify it against the publisher's
checksum, write the pack folder and the metadata file into
`%TEMP%\nexus-packs\`, and print what it fetched, each file's size and the time
it took. They use Node alone; `scripts/packs/zip.mjs` is the one small reader they
share, and it runs only on an archive whose digest has already been checked.

Each pack carries: **the binaries unmodified**, **`COPYING` (the GPL-3.0 text)**,
**the matching source archive of the exact release**, and a `SOURCE.txt` the
builder writes naming the release, the URLs and the digests. `licence.spdx` is
`GPL-3.0-or-later`, which is what each project states and what `sources.json`
quotes verbatim, sentence by sentence, with the URL it came from.

Two findings from the research shaped what the builders do, and both are worth
keeping because they are the difference between a pack that looks compliant and
one that is:

- **Stockfish 19 has no per-CPU variants.** The release publishes one universal
  binary per platform that detects the CPU at start-up, so "ship the variant for
  older CPUs" is answered by shipping the universal build rather than by four
  archives. The pack ships the whole release archive as well as the executable,
  because that archive holds `Copying.txt`, `AUTHORS` and the complete `src/`
  tree — it *is* the Corresponding Source.
- **LibreDWG's Windows archive carries no `COPYING`.** The pack supplies the
  project's own licence text, fetched from the source tree at the shipped
  version and recorded with its digest. And the pack pins 0.14.8601 (2026-10-03),
  the newest published Windows build, rather than the 0.14 tag: the project's
  `NEWS` records that the DWG-import heap overflows and a use-after-free were
  fixed in 0.14.1, and a decoder whose input is somebody else's file is the last
  place to ship a parser with known memory-safety bugs.

## 6. Consequences

- **`check:runner` gains one exemption**, in `run.ts`, for the `child-process`
  rule only: a third spawn site, with its reason written in the gate beside the
  other two. The rules that are exempted for nobody — `shell`, the exec family,
  and a literal program name — hold for this file too, which is what keeps "the
  program is the signed entry" checkable rather than remembered.
- **ADR-091's other guarantees are untouched.** A tool pack is still signed,
  still installed by copying under `<userData>/packs/<id>/<version>/`, still
  verified file by file while copying, still outside the database and the
  backups, and still never read by the renderer. `check:egress` is unaffected:
  nothing in `main/tools/` constructs a request, and the builders are `scripts/`,
  which that gate does not walk.
- **The card needs no new field.** `InstalledPackView.kind` gains a sixth
  member, and the refusal vocabulary gains one code with a sentence in each
  language; nothing about a tool crosses the bridge, because a renderer never
  starts a process and never needs to name one.
- **A pack that is a program is a pack somebody must be able to replace.** The
  install path does not stop a user from deleting a tool pack and putting another
  one in its place, and the manifest's `entry` is checked against the signed file
  list rather than against a path on disk. GPLv3 §10 requires exactly that, and
  the DRM-looking alternative — a pack the app refuses to run unless it came from
  Nexus — was rejected on that ground.

## 7. Alternatives rejected

- **Linking the libraries.** The shortest path and the one that ends the app's
  licence: `libredwg-0.dll` loaded in process, or Stockfish's sources compiled
  in, makes the combined program GPLv3.
- **A WASM build inside the renderer or in main** (`@mlightcad/libredwg-web`,
  GPL-3.0). Still GPL, still one program: WASM runs in this process, so the
  aggregate argument does not apply.
- **Driving a converter the user installed** (the ODA File Converter pattern).
  It avoids redistribution, and it was rejected because the app then depends on
  a path, a version and a licence nobody can check, and because ODA's own terms
  prohibit distributing their converter as part of a commercial application
  (`research/dwg/report.md` §2.3). The pack is a program this app chose, with a
  digest this app checked.
- **Patching the upstream builds** (dropping the CLI tools, renaming the engine,
  trimming the archive). GPLv3 §5(a) then requires prominent notices and the
  modified source, and ADR-091's whole advantage — a pack whose bytes are the
  publisher's bytes — is traded for a few megabytes.
- **Shipping a program inside the installer for the platforms that can take it**,
  which would have been simpler and would have put a GPL binary inside an
  Apache-2.0 artefact's own provenance story. The pack keeps the installer's
  notice set clean, and a pack can be replaced without a release.
- **An AGPL engine** (Reckless, Viridithas and others in the CCRL top ten are
  AGPL-3.0). §13 reaches a program offered over a network, and this app may one
  day serve a board on a LAN; not shipping one removes the question.
- **A permissive engine instead of Stockfish** (Hobbes, Caissa: MIT, ~17–19 Elo
  behind). Their neural networks come from side repositories with no licence
  file at all, so distributing their prebuilt binaries is not safely covered by
  the engine's MIT until the authors state a net licence
  (`research/chess/report.md` §2.4).
