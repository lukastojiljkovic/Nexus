# The `libredwg` tool pack

GNU LibreDWG 0.14.8601 for Windows x86-64, as a `tool` pack (ADR-094). The pack
carries the project's own published build — `dwg2dxf.exe`, `dwgread.exe` and the
DLLs they load — plus the licence text, which the published Windows archive does
not contain, and the source archive of the same version. Nexus runs the converter
as a child process and reads the DXF it writes; nothing of LibreDWG is linked
into the app, which is what keeps an Apache-2.0 application out of a GPLv3
combined work (`research/dwg/report.md` §2.2, §2.5).

## What it contains

| Path | Bytes | Where it comes from |
| --- | ---: | --- |
| `bin/dwg2dxf.exe` | 335,290 | the published Windows archive, unmodified |
| `bin/dwgread.exe` | 311,651 | the published Windows archive, unmodified |
| `bin/libredwg-0.dll` | 31,178,612 | the published Windows archive, unmodified |
| `bin/libiconv-2.dll` | 1,136,529 | the published Windows archive, unmodified |
| `bin/libpcre2-8-0.dll` | 717,955 | the published Windows archive, unmodified |
| `bin/libpcre2-16-0.dll` | 653,924 | the published Windows archive, unmodified |
| `README.txt` | 9,791 | the published Windows archive's own readme |
| `COPYING` | 35,147 | the project's `COPYING` from the source tree at 0.14.8601 |
| `source/libredwg-0.14.8601.tar.xz` | 10,605,020 | the release's matching source archive |
| `SOURCE.txt` | ~1.4 KB | written by the builder: what this is, where it came from, its digests |

The entry is `bin/dwg2dxf.exe` and the protocol is `stdio`: the converter is a
plain command-line program, not a protocol engine. `tools/dwg.ts` appends
`-y -o <out>.dxf <in>.dwg` to the pack's fixed arguments (`-y` is the tool's own
"overwrite", and `-o` is documented as "only valid with one single DWGFILE").

## Which version, and why not the tagged release

The newest *tagged* release is 0.14. The project's `NEWS` records the fixes that
came after it:

> LibreDWG version 0.14.1 - 2026-07-25 - beta: … Security fixes:
> `* Fixed CVE-2026-63474 (GHSA-qg2f-8389-w95j, Moderate): heap-buffer-overflow
> WRITE in decompress_R2004_section, bypassing an earlier fix.`

(quoted in full, with the advisory list around it, in `sources.json` — the URL is
`https://github.com/LibreDWG/libredwg/blob/0.14.8601/NEWS`). The nightlies are
built from the branch that carries those fixes, so this pack pins the newest
published Windows build, 0.14.8601 (2026-10-03), and ships the source archive of
that same version. A DWG decoder is C reading a file somebody else chose; the one
place not to ship is a build whose parser has known memory-safety bugs.

## Sources and licence

Three sources, each with its URL, its date, its digest and the evidence for its
licence in `scripts/packs/libredwg/sources.json`:

* `libredwg-0.14.8601-win64.zip` — 12,100,542 bytes, SHA-256
  `439cd08d888f3bc2f643cabade0374dfd8670f18d2098cd039cbe64d12a57b19`, the digest
  GitHub publishes for the asset.
* `libredwg-0.14.8601.tar.xz` — 10,605,020 bytes, SHA-256
  `f1140a219d6edb291e55fad740be6c5e49c046fee558860575aeef110caa4ef9`, which is
  the value in the release's **own** `dist.sha256` file, quoted in
  `sources.json`; the same digest is the asset's on GitHub.
* `COPYING` — 35,147 bytes, SHA-256
  `8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903`, fetched
  from the source tree at the shipped version. The Windows archive carries no
  `COPYING` file at all, which is why the pack has to supply one; the version at
  `https://www.gnu.org/licenses/gpl-3.0.txt` as this run fetched it is 35,149
  bytes and a different hash, so the pack ships the project's own copy rather
  than a substituted one.

Licence: **GPL-3.0-or-later**, quoted verbatim in `sources.json` from two places
in the project:

* `README` at 0.14.8601: *"This library is free software, licensed under the terms
  of the GNU General Public License as published by the Free Software Foundation,
  either version 3 of the License, or (at your option) any later version."*
* `include/dwg.h` at 0.14.8601, the header the library is used through, carries
  the same sentence.

## How to rebuild it

```
node scripts/packs/libredwg/build.mjs
node scripts/pack-sign.mjs --dir %TEMP%\nexus-packs\libredwg \
  --meta %TEMP%\nexus-packs\libredwg.meta.json --key <private key>
```

As with Stockfish: the builder caches under `%TEMP%\nexus-pack-cache\libredwg\`,
verifies every digest before unpacking, writes the folder and its metadata file
under `%TEMP%\nexus-packs\`, and prints each file's size and the elapsed time.
It adds no dependency: `scripts/packs/zip.mjs` reads the archive, and the `.tar.xz`
is carried verbatim rather than unpacked (Node reads neither xz nor tar, and
nothing in the pack needs it to).

## Measured size

Unpacked, the pack is **44,983,919 bytes plus `SOURCE.txt`** (42.9 MiB). The
figures in the table are the archive entries' own uncompressed sizes as the
published zip's central directory states them; the download the builder makes is
12,100,542 bytes for the binaries plus 10,605,020 for the source archive plus
35,147 for the licence text (≈21.7 MiB).

## How it is run

`apps/desktop/src/main/tools/dwg.ts` copies the user's drawing into the session's
own temporary directory under a name this app chose, runs the converter there
with a sixty-second deadline and an output cap, and reads the DXF back. Nothing
of that is a sandbox — the research's own recommendation is to treat the
converter's input as hostile, and `run.ts`'s header says plainly what it does and
does not guarantee.
