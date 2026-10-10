# The `stockfish` tool pack

Stockfish 19 for Windows x86-64, as a `tool` pack (ADR-094). The pack is the
official release, unmodified, plus the licence text and the Corresponding Source
the GPL asks for. Nexus never links it: the app starts the executable and speaks
UCI to it over a pipe, which is why a GPL program can sit beside an Apache-2.0
application as an aggregate (`research/chess/report.md` §2.8).

## What it contains

| Path | Bytes | Where it comes from |
| --- | ---: | --- |
| `engine/stockfish-windows-x86-64-universal.exe` | 103,046,300 | the release archive's `stockfish/stockfish-windows-x86-64-universal.exe` |
| `COPYING` | 35,149 | the release archive's `stockfish/Copying.txt` — the GNU GPL version 3 text |
| `AUTHORS` | 6,922 | the release archive's `stockfish/AUTHORS` |
| `README.md` | 7,772 | the release archive's `stockfish/README.md` |
| `source/stockfish-windows-x86-64-universal.zip` | 81,431,614 | the release archive itself, verbatim |
| `SOURCE.txt` | ~1.5 KB | written by the builder: what this is, where it came from, its digest |

`pack.json` does not list itself or `pack.json.sig`; those two are added by
`scripts/pack-sign.mjs` and are not content.

The entry is `engine/stockfish-windows-x86-64-universal.exe`, the protocol is
`uci`, and there are no fixed arguments: everything the engine is told is told
over the protocol.

**Why the whole archive ships as well as the executable.** The release archive
holds the complete `src/` tree (76 files, 951,317 bytes by the archive's own
central directory) and the Makefile it is built with, so the archive *is* the
Corresponding Source GPLv3 §6 asks to offer from the same place as the binary.
Shipping it verbatim means the licence text, the notices and the source travel
with the binary and nothing here has to be maintained by hand. An extracted tree
would be a second thing that can be wrong; the archive is a file with a digest.

## Sources and licence

One source: `stockfish-windows-x86-64-universal.zip`, 81,431,614 bytes, SHA-256
`3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7`, fetched
2026-10-10 from
`https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip`.
That digest is GitHub's own for the asset, and it is the value the builder checks
before a byte of the archive is parsed. `scripts/packs/stockfish/sources.json`
carries the URL, the date, the digest, the licence and the evidence for it.

Licence: **GPL-3.0-or-later**. Two sentences from the project state it, both
quoted verbatim in `sources.json`:

* `src/benchmark.cpp` at tag `sf_19`: *"Stockfish is free software: you can
  redistribute it and/or modify it under the terms of the GNU General Public
  License as published by the Free Software Foundation, either version 3 of the
  License, or (at your option) any later version."*
* `README.md` at tag `sf_19`: *"you MUST always include the license and the full
  source code (or a pointer to …)"*.

The licence text the pack ships as `COPYING` is the archive's own `Copying.txt`;
the repository's copy of the same file at the same tag hashes to
`3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`, which is
also the hash of `https://www.gnu.org/licenses/gpl-3.0.txt` as this run fetched
it — the archive carries the GNU text itself, not a paraphrase.

## How to rebuild it

```
node scripts/packs/stockfish/build.mjs
node scripts/pack-sign.mjs --dir %TEMP%\nexus-packs\stockfish \
  --meta %TEMP%\nexus-packs\stockfish.meta.json --key <private key>
```

The builder downloads into `%TEMP%\nexus-pack-cache\stockfish\` (and reuses what
is there), verifies the digest, writes the pack folder to
`%TEMP%\nexus-packs\stockfish\` and the metadata file `pack-sign.mjs` takes to
`%TEMP%\nexus-packs\stockfish.meta.json`, and prints what it fetched, each file's
size and the time it took. It never signs anything; the key is the maintainer's.

The builder uses Node alone — no dependency is added for it. `scripts/packs/zip.mjs`
reads the archive's central directory, which is all a verified release archive
needs.

## Measured size

Unpacked, the pack is **184,527,757 bytes plus `SOURCE.txt`** (175.9 MiB): the
figures in the table above are the archive entries' own uncompressed sizes, read
from the release archive's central directory, and the archive itself is the
largest single item in it. The download the builder makes is 81,431,614 bytes
(77.7 MiB).

## What is deliberately not in this pack

* **Other platforms.** The release publishes universal builds for Linux x86-64,
  Linux arm64, Windows arm64, macOS and Android. This pack is Windows x86-64,
  which is what the desktop app ships on; a different platform is a different
  pack with a different digest, and the builder would need its own entry for it.
* **Per-CPU binaries.** They used to exist (SSE2/AVX2/BMI2/AVX-512) and do not in
  Stockfish 19: the release publishes one universal binary per platform and
  architecture that detects the CPU's features at start-up, so the build that
  runs on an older CPU is the same file as the build that runs on a new one.
* **The neural network as a separate file.** It is embedded in the binary
  (CC0-published nets, `official-stockfish/networks`), so nothing extra has to be
  downloaded or shipped.
* **Syzygy tablebases, opening books and `chess.js`.** Separate decisions with
  separate licences (`research/chess/report.md` §2.6–2.7); the tablebase *data*
  in particular has no licence statement at its distribution root, so it is not
  shipped here.
