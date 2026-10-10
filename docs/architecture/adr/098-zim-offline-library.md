# ADR-098 — An offline library, through our own ZIM reader

**Status:** accepted (2026-10-10) · **Owner:** this run · **Amends** ADR-092
(`DOWNLOAD_HOSTS` gains the three Kiwix hosts) · **Builds on** ADR-090 (the
module kit), ADR-093 (the `knowledge` group), ADR-091 (a pack is a folder)

## 1. The finding

Nexus promises an offline-first library and had no way to hold one. The content
exists and is free: the Kiwix project publishes Wikipedia, Wiktionary, Wikibooks,
iFixit's repair guides, Project Gutenberg and the Stack Exchange sites as ZIM
files — an 80-byte header, a table of directory entries, and clusters of
compressed blobs, in one file that can be 100+ GB. The research run this ADR
builds on (`research/zim/`, `research/editions/`) measured the catalogue, the
format, the compressors and the licences.

Two findings decided the architecture:

1. **Every existing reader is copyleft.** libzim is GPLv2+, kiwix-js GPLv3,
   `openzim/javascript-libzim` GPLv3, `@openzim/libzim` GPL-3.0, Kiwix Desktop
   GPLv3, and the search engine behind the full-text index — Xapian — is GPLv2+.
   Linking any of them would make Nexus GPL, and Nexus is Apache-2.0 (ADR-087).
   The FORMAT is documented and permissive re-implementations already exist (a
   Rust `zim` crate under MIT/Apache-2.0), so a clean-room reader written from
   the specification stays Apache-2.0.
2. **Compression is a solved problem with permissive parts.** Every current pack
   is Zstandard, and Zstandard is built into the Node that Electron 44 ships
   (Node 24.19.0 in this worktree, where `zlib.zstdDecompressSync` was verified
   present). Legacy format-5 files use LZMA2/XZ, and the research measured that
   only a minority of the catalogue still does.

## 2. The reader

**`apps/desktop/src/main/zim/`** is a clean-room implementation of the openZIM
**file format**, written from <https://wiki.openzim.org/wiki/ZIM_file_format>
(read 2026-10-10). The version implemented is **format 6**, and **format 5** for
everything except its LZMA clusters — the two the research measured in the live
catalogue (`0x05` on the Serbian and English Wikipedia packs, `0x01` on
Gutenberg's payloads, `0x11` on a 118 GB pack's full-text index cluster, `0x04`
on the 2019 format-5 pack). The wiki's PROSE is CC BY-SA 3.0 and is not copied:
the header, the two pointer lists, the two directory-entry layouts and the
cluster table were re-derived from the field tables and validated against real
files, which is exactly what the fixture below is for.

| File | What it holds |
| --- | --- |
| `header.ts` | The 80-byte header and the terminated MIME list, both checked against the FILE SIZE |
| `dirent.ts` | Content and redirect entries, and the byte-wise key both pointer lists are sorted by |
| `cluster.ts` | The info byte, the offset table (4- and 8-byte forms), one blob's range, and the LZMA refusal |
| `lru.ts` | The decompressed-cluster cache, capped in BYTES |
| `reader.ts` | The reader: positioned reads, binary search by path and by title, blobs, the MD5 trailer, the caps |
| `paths.ts` | What a ZIM path may be, and the one percent-encoding between it and a URL |
| `fixtures/` | openZIM's `wikibooks_be_all_nopic_2017-02.zim` (152 865 bytes, CC BY-SA 4.0 + GFDL) |

**Everything is a positioned read.** A Wikipedia pack is 100+ GB and the English
one's index cluster alone is 9.5 GB, so the header is 80 bytes, a directory entry
is at most `direntChunkBytes` (8 KiB), a pointer-list probe is 8 bytes, and an
uncompressed cluster is read as its TABLE and then as the blob's own range —
which is what makes a 9.5 GB cluster cost four small reads rather than one
enormous one. The only place a whole cluster is read is a compressed one, and
that read is capped (`clusterReadBytes`, 64 MiB) as the decompressed result is
(`maxOutputLength`, 256 MiB).

**Every number in a ZIM is an offset, so every one of them is checked.** A
pointer list that would not fit before the checksum, an entry index past
`entryCount`, a blob offset table that runs backwards or names a blob past its
payload, a redirect chain that loops, a cluster whose compression this build does
not implement — each is a `ZimError` with a code rather than a `RangeError` from
`Buffer.readUInt32LE` or a read of the wrong bytes. `fuzz.test.ts` walks corrupted
headers, corrupted pointer lists, twelve truncation lengths and 200 single-byte
flips through every entry point and asserts that each one answers or refuses
cleanly.

**LZMA/XZ clusters are refused by name.** `zlib` has no LZMA, the healthy JS
decoders are WASM (`xz-decompress`, MIT) and the only one this project would
otherwise reach for is bundled inside kiwix-js. A refusal with a sentence — „this
ZIM stores its content as LZMA/XZ (ZIM format 5)" — is the honest answer for the
minority of old files, and it is what the shipped fixture exercises: openZIM's
Wikibooks pack is format 5.0, so its content cluster refuses and its uncompressed
cluster reads.

**There is no full-text search, and the ADR says so out loud.** The index inside
a pack (`X/fulltext/xapian`) is a Xapian Glass database, which „has to be opened
using the xapian library" — GPLv2+. Nexus does not link it, so full-text search
over a pack is not available; the page says so where the search box is. What IS
available is the **title search the format puts in every file**: the title
pointer list is sorted by title, so `titlesFrom(prefix)` is a binary search plus
a bounded walk — `log2(entryCount) + limit` directory-entry reads, never a scan.
The comparison is on the file's own byte order, which is why the Serbian
Wikipedia's `…/Урок 1` list is followed by `…/Урок 10` and only then by `…/Урок 2`
(asserted in the register test).

**A ZIM the user already has, and a ZIM as a pack.** The reader takes a path to a
file, and this module offers both: a downloaded edition (which this app fetched
and checked) and a plain `.zim` the user points at with a native file dialog
(ADR-091's `kind: "zim"` covers the pack side; the dialog covers the file side).
Nothing about a ZIM is written: both paths are read-only.

## 3. What the user gets, and where it is stored

**The libraries are DEVICE-level.** A ZIM is one file on one disk — 2.0 GB for
the Serbian Wikipedia mini and 118.7 GB for the English maxi, both measured in
the research — and two profiles on that machine look at the same file. So the
index is `<userData>/zim/libraries.json`, on ADR-091's `installed.json` terms: a
small record per library (id, title, path, bytes, integrity, checksum, source,
language, when it arrived), written whole through a temporary file and a rename,
validated record by record on the way in, and answered as „the file is not where
it was" rather than dropped when a file goes away.

**What a person DID with a library is profile-level**, and that is migration 88:
`wiki_history` (a visit log, one row per place, newest first, trimmed to 200) and
`wiki_bookmarks` (what the user kept, UNIQUE per place, capped at 500). The
archive carries the bookmarks and NOT the history, for `main/imex.ts`'s reason: a
mark is authored, and a reading log restored onto another machine would be a
trail that machine never walked.

**The page** (`modules/wiki/`) is a kit module in ADR-093's `knowledge` group:
the libraries, the main page, search as you type, history and bookmarks, plus the
catalogue.

## 4. Serving a page: the `nx-zim://` scheme

**`nx-zim://<library id>/<path>`**, registered `standard`, `secure`,
`supportFetchAPI` and `stream` — one entry at the END of the
`registerSchemesAsPrivileged` array in `main/index.ts`, with the handler in
`main/zim/zimElectron.ts` and its rules in `main/zim/protocol.ts`.

Three fences, and each catches what the others cannot:

1. **The path rules.** The host must be a library id this build would accept
   (lower-case kebab-case), and the path must be a ZIM path: one namespace
   character, a non-empty path, no control characters, no backslash, no dot
   segment, at most 512 characters. Decoding happens ONCE, before the rules,
   because a rule applied to the encoded string is what `%2e%2e` defeats.
2. **A CSP of the document's own.** The served HTML carries
   `default-src 'none'; script-src 'none'; connect-src 'none'; form-action
   'none'; frame-src 'none'; object-src 'none'; base-uri 'none'` and admits
   subresources only from `nx-zim:` (plus `data:` for images). A pack's own CSS
   and images load; a pack's JavaScript — Zimit packs are whole websites — cannot
   run; nothing can make a request.
3. **`sandbox` with no allowances.** The page renders the document in an
   `<iframe sandbox="">`, which is every restriction the platform has: an opaque
   origin, no script, no popups, no top navigation, no storage.

**External links go through one rule** (`main/zim/external.ts`, pure and tested):
a link to another `nx-zim:` entry stays in the frame; an `http(s)` link is
cancelled and handed to the user's own browser with `shell.openExternal`; every
other scheme — `file:`, `mailto:`, `data:`, `javascript:` — is cancelled and
handed to nobody. The app had no external-link rule before this (the shell's
window-open handler refuses everything and says a „vetted `shell.openExternal`
wrapper lands with the first one"), so this IS that rule, and it is scoped to
frames that are on `nx-zim:`: the shell's own window keeps its existing lock.

## 5. Downloads, and what „integrity" means here

**The user picks an edition; the app fetches it.** The catalogue is the Kiwix
OPDS 1.2 feed, and this build offers a CURATED list rather than 3 631 packs:
Wikipedia in Serbian and English in the flavours that exist, Wiktionary and
Wikibooks in both languages, iFixit, Project Gutenberg (Serbian, and one English
LCC slice) and eleven Stack Exchange sites. Whether an edition exists is decided
from the live feed at the moment the page is opened, not from a table.

**Three hosts, appended to `DOWNLOAD_HOSTS`** (ADR-092), each checked with a real
request on 2026-10-10 — `opds.library.kiwix.org` (the feed),
`lb.download.kiwix.org` (a pack's `.zim.meta4`) and `mirror.download.kiwix.org`
(the Kiwix project's own mirror; `content-length: 2029773550`, `accept-ranges:
bytes` for the Serbian mini pack). The catalogue's other mirrors are not stable
names — a real `.meta4` ranked `mirror.accum.se`, `ftp.nluug.nl` and
`mirror.download.kiwix.org`, and the research measured the same pack's redirect
chain ending on two different hosts in one week — so `pickMirror` walks the
file's own priority order and takes the first host the allowlist admits. A
download that cannot reach one fails with a sentence instead of following a
redirect out of the allowlist. (`curl.exe` cannot complete a TLS handshake in
this sandbox — `SEC_E_NO_CREDENTIALS`, the same defect the research run recorded
— so the checks and the fixtures were fetched with Node's own `fetch`; every URL
and every measured number above is real.)

**Kiwiх forbids bots, so nothing is automated.** `download.kiwix.org` and
`opds.library.kiwix.org` both serve `robots.txt: User-agent: * / Disallow: /`
(measured by the research), and `browse.library.kiwix.org` gates crawlers behind
a confirmation page. So: a download starts only when the user presses a button,
one file at a time, from a list this build compiled in. The feed is fetched when
the user opens the catalogue and held in memory for a day; nothing polls.

**The size is shown before anything is asked for, and the free space is checked.**
The pack's own `.zim.meta4` (Metalink 4, RFC 5854) gives the size, the MD5, the
SHA-256 and the mirrors; the page shows the size and the date before the button,
and main refuses a download the volume cannot hold (`size + 64 MiB` of headroom
for the staging copy the download service writes).

**Two checks, and neither is a signature.**

* The DOWNLOAD service (ADR-092 §3, rule 3) compares the transfer's SHA-256 with
  the value in the Metalink while it writes. That is what says the bytes are the
  bytes Kiwix published.
* Then the ZIM's OWN trailer — the 16 bytes at `checksumPos`, which are the MD5 of
  the file without them — is recomputed and compared. That is what says the file
  on disk is internally the file it describes: no truncation, no lost tail.

Both are integrity checks and neither is a signature, which is stated here rather
than implied: a ZIM is not signed by anyone, the Metalink is not signed either,
and this app's answer to „is this file trustworthy" is „it is the file Kiwix
published, bit for bit, so far as a hash can say" — and the library list says
which of the two states a file is in (`checked` for a download this app made,
`unverified` for a file the user pointed at).

## 6. What this ADR does NOT do

* **No full-text search.** Xapian is GPLv2+ (§2). Title search only.
* **No LZMA/XZ decoder.** Format-5 content clusters are refused by name (§2).
* **No content host beyond the three** (§5), and no crawler: the edition list is
  compiled in, and a pack appears on the page only when the live feed has it.
* **No re-hosted content.** Nexus never redistributes a pack; the content
  licences (CC BY-SA 4.0 + GFDL for Wikimedia, CC BY-NC-SA 3.0 with a no-AI
  clause for iFixit, the Project Gutenberg trademark conditions, CC BY-SA 4.0 for
  Stack Exchange) are the user's to honour, and the page shows each collection's
  licence and what it requires before a download starts.
* **No `zimaa` split archives.** The catalogue carries none (the research
  measured zero), so there is nothing to reassemble.

## 7. Consequences

* `main/index.ts` gains one scheme entry, one startup call, one `will-frame-navigate`
  registration and two shutdown lines; the logic is in `main/zim/`.
* `net/offline.ts` gains `nx-zim:` in the renderer's allowlist (or the scheme
  could not load at all) and three hosts in `DOWNLOAD_HOSTS`.
* `main/shellStrings.ts` gains the file dialog's title and filter name, in both
  languages.
* `check:egress` needed NO exemption: the small fetches and the downloads all go
  through the dedicated session's `ses.fetch`, which the gate already allows, and
  nothing in this module reaches for the global.
* A new module is a folder (ADR-090): `modules/wiki/` carries its manifest, its
  contract, its handlers, its page, its copy and its tests, and the shell
  discovers it.
