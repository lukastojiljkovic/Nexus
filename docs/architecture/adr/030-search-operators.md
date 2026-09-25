# ADR-030 — Search operators: `#tag` and `rok:`/`due:`

**Status:** accepted · 2026-07-30
**Drives:** the "richer operators" item of the SRCH remainder (STATUS §4): `#tag`
and due/date filtering in the Ctrl+K palette. ADR-021 fixed the index and the
palette; this adds a closed operator grammar on top. It is deliberately **no new
storage**: no schema change, no trigger change, no reindex, and **no IPC change**
(the raw query string already crosses to main, which parses and ranks).
**Supersedes nothing.**

## Decision

### 1. Grammar (pure, clock-free, in `parseSearchQuery`)

- **`#x`** — a tag filter token. Multiple `#` tokens AND together. Matching is
  over **folded, space-stripped** tag names (`foldSearchText(name)` with spaces
  removed — tag names may contain spaces, the token grammar cannot), by
  **prefix**: `#moj` matches `moj posao` and `mojstari`. A bare `#` is dropped.
  Tag tokens do not count toward `MAX_SEARCH_TERMS` and never reach the FTS
  expression.
- **`rok:v` / `due:v`** — a date filter. Closed value set, sr + en:
  `danas|today`, `sutra|tomorrow`, `nedelja|week` (today through today+6), or a
  bare real `YYYY-MM-DD` (leap-aware validation). An unknown or unreal value
  makes the whole token **plain search text** (the quick-add rule: never guess),
  exactly like an unknown `kind:` prefix. Multiple date filters: **last wins**
  (the quick-add precedent). The parser emits structure only — presets are not
  resolved to dates here, because the parser stays clock-free.
- Command mode (`>`) parses uniformly; commands simply ignore operators.

`ParsedSearchQuery` gains `tags: readonly string[]` (folded, deduped, in typed
order) and `due: SearchDueFilter | null` where `SearchDueFilter =
{ kind: "preset"; preset: "today" | "tomorrow" | "week" } |
{ kind: "date"; date: string }`.

### 2. Resolution where the clock lives

Main resolves the filter with its own local today through a pure core helper
`resolveDueRange(filter, today) → { from, to }` (inclusive bare-date bounds).
A hit's day comes from a pure core helper: a bare `YYYY-MM-DD` `context_date`
passes through; a full ISO instant reduces to its **local** calendar day (the
`localTodayKey` idiom — an event at 23:30Z is filtered by the day the user sees
it on, not the UTC day).

### 3. Filtering = a pure core post-filter over candidates

`applySearchOperators(hits, { tagMatches, dueRange })` in `packages/core`:

- **Tags:** only `task` and `note` hits can pass a tag filter (the two tagged
  modules); each `#` token contributes a set of matching entity ids per kind,
  and a hit must be in every token's set (AND). Any other kind is excluded
  outright while a `#` token is present.
- **Due:** a hit passes if `context_date` is non-null and its day falls inside
  the range. Kinds without a context date (note, subject, deck, attachment)
  fall out naturally — no allowlist to maintain.

Candidate sourcing in main:

- text + operators → FTS as today, but the candidate ask is raised to
  `MAX_SEARCH_LIMIT` when any operator is present, so post-filtering has
  headroom; ranking stays `rankSearchResults`.
- operators only (no text terms) → `SearchStore.recent` over the eligible
  kinds at `MAX_SEARCH_LIMIT`, kept in recency order (recent's contract:
  never re-ranked).

The **200-candidate bound is deliberate and recorded**: an operator query
considers the profile's 200 freshest eligible entries. The later faceted
search page is the browse-everything surface; it will reuse the same core
filter.

### 4. Tag sets assembled in main

Per query with `#` tokens, main loads the profile's note tags and task tags
plus links through the two existing stores, folds/space-strips names once, and
builds the per-token id sets. Query-time joining means a tag rename is live
immediately with no reindex. No new channels: the renderer's tag lists for
suggestions already have channels (`NoteOrgStore` / `TaskTagStore` surfaces).

### 5. Palette UI (SearchPalette.tsx)

- While the **active (last) token** starts with `#`, a **tag-suggestion group**
  renders at the top of the list: both modules' tags merged, deduped by folded
  name, prefix-matched, capped at 6; picking one completes the token with the
  space-stripped folded name. Existing list styling; no new popup, no glow.
- A quiet footer hint names the operators ("#oznaka · rok:danas / sutra /
  nedelja / 2026-08-15"). Serbian copy in `strings.ts`.

## Consequences

- A recurring event series surfaces by its **master row's** start date only —
  the index carries the master, not expanded occurrences. Recorded here and in
  STATUS; expanding series into search is its own decision if ever wanted.
- Operator-only queries are bounded at 200 fresh candidates (see §3).
- The facets page (STATUS §4) inherits `applySearchOperators` unchanged.
