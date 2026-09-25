# ADR-052 — Anki .apkg import (STUDY-011): basic + cloze, honestly

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Implements:** STUDY-011 (S),
the „Anki" half of IMEX-007's direct importers. **Corrects** ADR-042's "faithful
target shape" consequence — it is only half true (see §3) — and records
**DEV-004** (media not inline-importable) in `docs/deviations.md`.

## 1. Container

Legacy `.apkg` (`collection.anki2`/`.anki21` + JSON `media` manifest) AND the
modern `collection.anki21b` (zstd — free via `node:zlib` in Electron 42's Node
24, verified). The modern media manifest is protobuf; its `MediaEntries`
message is a trivial repeated `{name, size, sha1}` — hand-rolled
varint/length-delimited walk, no dependency. Refusing the modern container
would reject most 2026-era exports; said out loud. Zip plumbing reuses
`createFileByteSource`/`ByteSourceRandomAccessReader`/the `ArchiveLimits`
discipline via a small sibling `apkgReader.ts` — the NXA1 allowlist and the
blob-hash contract are deliberately NOT loosened.

## 2. Scope

Basic notetypes (including reversed — one Nexus card per Anki `cards.ord`) and
cloze. Named, counted skips (closed codes + Serbian copy, compile-error-until-
copy-exists): image-occlusion notetypes (STUDY-012's business), audio
(`[sound:…]`), notetypes whose templates we do not understand, field-count
mismatches, over-long fields (never silently truncated).

## 3. Cloze mapping — correcting ADR-042

Anki's identity is the NUMBER (`ord = cN−1`); Nexus's is the POSITION of the
`{{…}}` run. They agree only for ascending, gap-free, once-each c-numbers. The
importer therefore **canonicalizes**: deletions are renumbered by first
appearance so Nexus positional ordinals reproduce Anki's card set; a note where
that is impossible — the same `cN` appearing twice (one card, several blanks:
inexpressible in Nexus) or nested deletions — is REFUSED by name. `::hint` is
dropped with a count (Nexus has no hint slot). Basic fields containing literal
`{{ }}` are untouched — the cloze grammar never runs on basic cards. Creation
goes through `createCloze`'s own atomic sibling derivation. ADR-042's
consequence line is corrected by this ADR rather than inherited.

## 4. Scheduling state: imported as NEW, history dropped and named

SM-2 carries no stability/difficulty; inventing them writes fiction into the
scheduler's core. Every imported card is a fresh FSRS card; `revlog` is not
imported; suspension/burial is scheduler state that drops with the rest. One
honest report line carries the count. (The rejected alternative — `S≈ivl`, `D`
from ease — and the narrow `cards.data` FSRS-state exception are recorded here
for a future revisit, not built.)

## 5. Deck → subject/deck

A deck needs a subject: the preview requires choosing an existing subject or
naming a new one. One Nexus deck per Anki deck, `Parent::Child` flattened to
the full name (Nexus decks are flat); decks with zero importable notes are
skipped with a count; `Default` is a deck like any other.

## 6. Media: DEV-004

Cards have no attachment table and MathText renders no HTML — `<img>` has
nowhere to land. v1 strips media references with per-kind named counts
(„N slika, M zvučnih zapisa nije uvezeno"). PRD 15's acceptance line ("cards
with media") is thereby unsatisfiable in v1 → recorded as **DEV-004** in
`docs/deviations.md` awaiting founder sign-off; research OQ#4 is answered
(media deferred). The "media as subject materials" opt-in is deliberately not
v1 (a filing cabinet is not inline media).

## 7. HTML → text

A pure, adversarially-tested core function: tags stripped, block tags →
newlines, standard entities decoded, whitespace collapsed; `$…$` kept for
MathText; MathJax `\(…\)`/`<anki-mathjax>` rewritten to `$…$`; output capped
at the card store's 10000 with over-long fields skipped by name.

## 8. Security posture (knowing SEC-FILE-01 tension — founder batch)

Parsed IN MAIN on the archiveReader precedent, with the full mitigation set
committed here: collection bytes go zip-stream → Buffer →
`new Database(buf, {readonly:true})` (SQLite deserialize — no temp file, no
journal, nothing on disk), `PRAGMA query_only=1`, `trusted_schema=OFF`,
`cell_size_check=ON`, `quick_check` before reading, no
`loadExtension`/`unsafeMode`, only fixed parameterized SQL with LIMITs and row
caps (better-sqlite3 is synchronous — our caps are the only bound), NEVER
ATTACHed to the live database, handle closed in `finally`. SEC-FILE-01 asks
for an out-of-process parser; `archiveReader.ts` already established the
in-main-with-discipline precedent, and a utilityProcess sandbox would drag the
ABI-pinned native binding with it — recorded as the tension it is.

## 9. Caps, write path, wire

Named, injectable caps (file bytes; uncompressed collection bytes ~256 MB
resident; entries; notes; cards; media entries; per-field bytes) — every cap a
named refusal. Write path: translate → `ProfileData` → `planForeignImport` →
`insertPlanned`, inheriting minted ids, the counted/named report, and the
ONE-SLOT UNDO IMEX-006 requires; the chosen existing subject rides as a
pre-seeded id mapping (a new subject as a translated row). Channels
`imex:import-apkg-pick/preview/apply/cancel` (share machinery, never a
channel); a Settings card beside „Uvoz iz arhive"; settings-search entry; no
STUDY deep link in v1. Deferred, recorded: Anki tags (cards have no tags —
dropped, named), deck presets, filtered decks, styling, export round-trip.
