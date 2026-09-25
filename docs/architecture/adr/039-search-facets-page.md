# ADR-039 — The full search page with facets

**Status:** accepted · 2026-07-30
**Drives:** the "full search page with facets" item of the SRCH remainder
(STATUS §4; PRD 08 §3 "Full search page for browsing beyond top hits with
per-module facets", SRCH-007's second half). ADR-021 built the palette,
ADR-030 the operator grammar; this is the browse surface both of them
deliberately deferred to — the answer to ADR-030's recorded 200-candidate
bound. **No schema change, no migration, no interchange change.**

## Decision

### 1. A shell surface, not a module

`SearchPage.tsx` renders when `activeId === "search"` — special-cased in the
shell next to the registry check, exactly **not** a `ModuleManifest`: search
is a system surface like the palette, it must never appear in the Settings
module gallery or grow a flag, and the registry's rule stays "hub pages
only". The sidebar's existing standalone *Pretraga* item **navigates to the
page** (it used to open the palette); its Ctrl+K badge stays, as the hint for
the palette, which remains the fast overlay on the shortcut. The page states
the hint again in its header.

### 2. One source of truth: the query string

The page owns exactly one piece of search state — the raw query string.
Every facet **edits the query**, never a parallel filter model:

- **Kind facets** toggle the shortest-alias prefix token (`z:`, `b:`, …)
  spliced into the text — the palette's existing `KIND_QUERY_PREFIX`
  mechanism, shared (exported), not duplicated. Active state is read back
  from `parseSearchQuery(query).kinds`.
- **Tag facets** append/remove a `#token`. Active state from `parsed.tags`.
- **No due-facet chips.** `rok:` is last-wins in the grammar; a chip row
  writing the same token would fight the typed query. The footer hint names
  the grammar, as in the palette. Recorded as deliberate.

Typing and clicking therefore compose freely, the palette and the page mean
identical things by identical queries, and a query carried between the two
surfaces (see §5) needs no translation.

### 3. One new channel: `search:page`

Request `{ profileId, query }` (query capped by `SEARCH_QUERY_MAX_BYTES`,
per-field validated, SEC-EL). Response:

```ts
interface SearchPageResult {
  hits: SearchResult[];          // ranked, capped at SEARCH_PAGE_MAX_RESULTS
  total: number;                 // hits before the response cap
  truncated: boolean;            // candidate sourcing hit its bound
  kindCounts: Array<{ kind: SearchKind; count: number }>;
  tagFacets: Array<{ name: string; token: string; count: number }>;
}
```

Main's `runSearchPage` composes the **existing** pipeline pieces
(`parseSearchQuery`, `searchOperatorFilters`, `applySearchOperators`
unchanged — ADR-030's consequence note, `rankSearchResults`):

1. Parse; resolve operators (main's clock, main's tag stores — unchanged).
2. Candidates over **all** kinds: FTS when terms exist, else the `recent`
   path — both at `MAX_SEARCH_BROWSE_LIMIT`.
3. `applySearchOperators` (tags/due) → this **pre-kind set** is what
   `kindCounts` and `tagFacets` are computed over — a facet answers "what
   would this narrowing give you", so it must be counted before the
   narrowing is applied.
4. Narrow by `parsed.kinds`, rank (`rankSearchResults`; the recent path
   keeps recency order — that method's contract, never re-ranked), cap.

Facet counting itself is a pure core helper (`searchFacets.ts`): kind counts
from hits alone; tag facets from hits plus tag/link data main hands in as
plain lists (the `buildTagMatches` sourcing, reused) — folded with
`foldSearchTag`, deduped by token across both modules, top 8 by count.

### 4. Bounds, recorded honestly

`MAX_SEARCH_BROWSE_LIMIT = 500` (searchStore; the store's clamp ceiling
rises to it) and `SEARCH_PAGE_MAX_RESULTS = 500` (ipc.ts). The palette's own
sourcing is untouched: `MAX_SEARCH_LIMIT = 200` remains its candidate bound
exactly as ADR-030 recorded. When `truncated`, the page says so quietly
("Prikazano je prvih 500…") and count displays read "500+" — never a made-up
exact number. The renderer renders hits incrementally (chunks of 50,
"Prikaži još") — no virtualization dependency for a bounded list.

### 5. Surfaces and flow

- Empty query = **browse mode**: recent entries across kinds, still counted
  and faceted — the page is useful before a single keystroke.
- Results grouped by kind in `SEARCH_KINDS` order with group headers (the
  palette's `groupByKind`), flat when narrowed to exactly one kind; existing
  highlight ranges, context-date and updated-at formatting reused. A hit
  opens through the shell's existing `openSearchResult` reveal intents —
  lifted so palette and page share it.
- The palette gains one bottom row, "Prikaži sve rezultate" (hidden in
  command mode and on an empty query): closes the palette, opens the page
  seeded with the current query (shell-held seed state, consumed on mount).
  Commands stay palette-only — an action list is a jump surface, not a
  browse surface.
- Live search on the palette's `SEARCH_DEBOUNCE_MS`; input autofocused.

## Consequences

- The page inherits every operator and every future operator for free; any
  divergence between palette and page semantics is now structurally
  impossible (one parser, one filter, one splice table).
- Facet counts are exact up to `truncated`; beyond it they are honest lower
  bounds. A personal corpus that regularly exceeds 500 live candidates is
  the recorded trigger to revisit (same reasoning as the index's own
  no-cap decision, STATUS §4).
- `rok:`-style due chips stay out until a real need shows; typing covers it.
