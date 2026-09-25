# ADR-021 — Global search (index, analyzer, palette)

**Status:** accepted · 2026-07-26.
**Drives:** SRCH-001 … SRCH-007 from [PRD 08](../../prd/08-search.md) — one
palette that finds anything, a local incremental full-text index, Serbian
folding, command mode, profile separation, ranking, and type filters. Fills in
the indexing half of `packages/core/src/contracts/search.ts`, which until now
modelled identity only.

## Context

Nexus now holds tasks, events, notes (with attachments), tracked documents,
subjects, exams, decks and flashcards. Every one of those modules has its own
list, its own filters and its own sort order — and none of them can answer the
only question a user actually asks after six months of use: *where did I write
that?* Today the sole way to find something is to remember which module it lives
in and browse. That is the failure PRD 08 §2 names in one line: "I never
remember *where* something lives."

Three facts shape the design.

**The corpus is small, local and encrypted.** A heavy account is tens of
thousands of rows, not millions, and it already lives in one SQLite file that is
encrypted at rest ([ADR-018](018-local-account-passcode.md),
[ADR-019](019-encrypted-blob-store.md)). An index kept *inside* that file
inherits its encryption for free; any index outside it — a sidecar file, a
Lucene-style directory — would re-open the SEC-DAR hole ADR-019 just closed.

**Serbian is not a Latin-1 language and SQLite does not know that.** Probed
against the shipped binary (SQLite 3.53.2, FTS5 compiled in): the standard
`unicode61 remove_diacritics 2` tokenizer folds `č ć š ž` to `c c s z`, but
leaves **`đ` untouched** — it is `U+0111 LATIN SMALL LETTER D WITH STROKE`, a
letter in its own right, not a base plus a combining mark. So out of the box
"djordje" does not find "Đorđe", and neither does "dordje". Cyrillic is not
folded to Latin at all, and Serbian is digraphic: the same user writes some
notes in one script and some in the other. PRD 08 SRCH-002 already asks for
`š/č/ć/đ/ž ↔ s/c/c/dj/z`; the tokenizer cannot deliver it.

**A search index is only as good as its worst write path.** An index maintained
by hand from the stores is one forgotten call away from lying, and the callers
are about to multiply: IMEX import will insert thousands of rows in bulk, NOTE's
`syncFromNote` already rewrites flashcards behind the user's back, and every
future module adds three more write sites.

## Decision

### The index lives in the database, maintained by triggers

Two tables, added by migration 017:

- **`search_entries`** — an ordinary table, one row per indexed entity, holding
  `profile_id`, `kind`, `entity_id`, the **original** `title`/`body` for
  display, the **folded** `title_folded`/`body_folded` for matching, a
  `parent_id` for deep links (a card's deck, an attachment's note), a
  `context_date` (due / start / expiry / exam date) and `updated_at` for
  ranking. `UNIQUE (profile_id, kind, entity_id)`, `profile_id` an FK with
  `ON DELETE CASCADE`.
- **`search_fts`** — an FTS5 virtual table over `(title, body)` declared
  `content=''`, `contentless_delete=1`, `tokenize='unicode61 remove_diacritics 2'`.
  It stores no text of its own; it is a pure inverted index keyed by
  `search_entries.id`, kept in step by three triggers on that table
  (insert / delete / update). Contentless FTS5 cannot UPDATE a row, so the
  update trigger deletes and re-inserts — the documented pattern.

`search_entries` itself is filled by **triggers on the source tables** — one
`AFTER INSERT`, one `AFTER UPDATE`, one `AFTER DELETE` per indexed table, all
with the same shape, all honouring `deleted_at IS NULL` so a soft delete removes
the entry and an undelete restores it. Nine kinds ship in v1: `task`, `event`,
`note`, `document`, `subject`, `exam`, `deck`, `card`, `attachment`.

The consequence that justifies the SQL: **no application code can forget to
index.** Bulk imports, background syncs, future migrations and code that has not
been written yet all maintain the index for free, because they cannot write to
the database without going through the triggers.

Folding inside a trigger needs the analyzer in SQL, so `openDatabase` registers
a deterministic user function **`nx_fold(text)`** on the connection before
migrations run. It is the exact same fold as `@nexus/core`'s `foldSearchText` —
one implementation, called from TypeScript at query time and from SQL at write
time. There is exactly one place a connection is opened, so there is exactly one
place the function can be missing.

### The analyzer is ours, and it folds both scripts

`foldSearchText` (core, pure) lower-cases, strips the diacritics SQLite would
strip anyway, maps **`đ → dj`**, and transliterates Cyrillic to Latin by the
standard Serbian mapping (`ђ → dj`, `љ → lj`, `њ → nj`, `џ → dz`, `ћ → c`,
`ж → z`, `ш → s`, `ч → c`, …). Both the indexed text and the typed query pass
through it, so all four spellings of the same word — `Đorđe`, `djordje`,
`dordje`, `Ђорђе` — meet in the middle. The tokenizer's own
`remove_diacritics 2` stays on as a second layer that costs nothing.

Folding is **for matching only, never for storage** (PRD 08 §7): the original
text is what the palette displays. Because `đ → dj` changes length, the fold has
a sibling `foldWithOffsets` returning a per-character map back into the original
string, which is what lets the palette highlight a match inside text it did not
fold.

### Query text is parsed, never passed through

Everything the user types is FTS5 *syntax* until proven otherwise: a stray `"`,
a bare `*`, the word `AND`, a `-` — each one either throws or silently means
something else. `parseSearchQuery` (core, pure) splits the raw input into kind
filters and terms; `toFtsMatchExpression` quotes every term, joins them with
implicit AND, and appends `*` to the last term only, so the index behaves like
type-ahead while the earlier words stay exact. A query that reduces to nothing
returns no expression at all and the caller shows the recent list instead.

Kind filters are Serbian prefixes (`z:` zadatak, `d:` događaj, `b:` beleška,
`dok:` dokument, `p:` predmet, `i:` ispit, `s:` špil, `k:` kartica, `pr:`
prilog), matched **after folding**, so `beleška:` and `beleska:` are the same
prefix. They are an accelerator, not the interface: the palette also shows kind
chips, the same affordance the calendar uses for its four sources.

### Ranking is explicit, not bm25 alone

bm25 ranks *within* one corpus; ours mixes nine kinds where a note body of 8 000
characters competes with a task title of four words. The store returns bm25 and
`rankSearchResults` (core, pure) turns it into the final order: bm25 weight
(title weighted an order of magnitude above body), plus an exponential recency
decay, plus a small per-kind prior, plus a prefix-match boost when the title
itself starts with what was typed. Every constant is named and tested; a
ranking nobody can explain is a ranking nobody can fix.

On an empty query the palette shows **recent items** — `search_entries` ordered
by `updated_at` — which makes the shortcut useful before a single key is typed.

### Commands share the palette, behind `>`

Registered actions (go to a module, new task / event / note, switch theme, lock
now) match by the same fold and appear as their own group. PRD 08 §3 proposed a
`u`-plus-space command prefix; a bare letter followed by a space is
indistinguishable from a real search ("u sredu"), so the explicit prefix is
**`>`**, which cannot
collide with Serbian text, and commands also surface inline whenever they match.
Recorded here as a deliberate deviation from the PRD's draft wording.

### Note bodies get a freshness fix

A note's searchable text is `note_snapshots.plaintext`, which
[ADR-012](012-note-editor-and-substrate.md)'s compaction writes only every 32 Yjs updates.
Titles are always current, bodies could lag a whole session — against
SRCH-002's "within 1 s of an edit". Main therefore compacts a note **on idle**
(a short debounce after the last append) in addition to the count threshold. The
version-history capture keeps its own 10-minute gate, so cadence changes and
policy does not.

### What is excluded, by construction

Private notes (PRIV, SEC-ZK-06) and note **templates** are not indexed, and
cannot be indexed by accident: a table joins the index only when someone writes
it a trigger. `search_entries` is derived state — IMEX exports none of it, and a
restored archive rebuilds it as the rows land.

### Slices

- **021-a** `@nexus/core/search` — fold, offsets, parse, FTS expression,
  ranking, snippet. Pure, TDD.
- **021-b1** migration 017 — both tables, the entry triggers, nine source
  trigger sets, the backfill, `nx_fold` on the connection.
- **021-b2** `SearchStore` — `search`, `recent`, `rebuild`, `stats`.
- **021-c** main — `search:query` / `search:recent` / `search:rebuild`
  channels with validators and the preload bridge; idle compaction.
- **021-d** renderer — the Ctrl+K palette: results, kind chips, commands,
  keyboard navigation.
- **021-e** renderer — reveal: a result opens the exact task, event, note,
  document, subject, exam, deck or card it names.

## Alternatives rejected

**One FTS table per module (PRD 08's phrasing).** Nine indices mean nine
queries, nine bm25 scales that cannot be compared, and nine migrations every
time the analyzer changes. One index with a `kind` column gives a single ranked
list for free, and the per-module facets the PRD wants are a `WHERE` clause.

**Index maintenance from the stores.** Readable TypeScript, and wrong: 9 stores
× 3 write paths is 27 call sites that must each remember, plus every bulk path
(IMEX import, `syncFromNote`) and every future module. The trigger set is more
SQL in one file, reviewed once, and unforgettable.

**`external content` FTS5 instead of contentless.** External content would make
`search_entries` the content source and drop the duplicate storage — but it
requires the FTS column names to *be* the content table's columns, which
collides with storing the original text for display and the folded text for
matching side by side. Contentless plus an explicit display column is the
honest version of the same thing.

**Store only folded text and un-fold for display.** Not possible: folding is
lossy by design (`č` and `ć` both become `c`). PRD 08 §7 says it outright —
fold for matching, never for storage.

**Trigram tokenizer for substring matching.** Available in this build, and
tempting for "find anywhere in the word". It also multiplies index size by
roughly the token length, matches across word boundaries in ways that read as
noise, and cannot be combined with prefix ranking. Prefix matching on the last
term covers type-ahead, which is what the palette is for.

**A JS user function is a coupling.** It is: a connection without `nx_fold`
cannot write to any indexed table. It is also the only way to fold inside a
trigger, there is exactly one `openDatabase`, and the failure mode is loud and
immediate rather than a silently empty index.

## Deliberately not in this work

- **SRCH-008 attachment *content* search** — needs DOC's text extraction, which
  does not exist; the founder already decided it is off by default. File *names*
  are indexed.
- **`#tag` and `due:` operators** (SRCH-007's second half) and the full search
  page with facets — the palette carries v1; both are additive over the same
  index.
- **SRCH-009 search history** — the recent-items list covers the empty state.
- **Fuzzy / typo tolerance.** Folding plus prefix matching absorbs most Serbian
  spelling variance; edit-distance ranking is a separate design.
- **Index-size caps and LRU** (PRD 08 §7). Bodies are capped per entry; a
  global cap needs a real corpus to calibrate against.
