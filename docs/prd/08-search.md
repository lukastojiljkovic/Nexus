# PRD 08 — Global Search (SRCH)

**Status:** draft 2026-07-05. Inputs: module PRDs' indexing hooks, SEC-ZK-06
(private notes excluded), design-system research (Linear ⌘K pattern,
local-first speed).

## 1. Purpose

One instant search across everything the user has enabled — notes, tasks,
events, subjects, cards, foods, files, settings — plus a command palette for
actions. Local-first makes truly instant search a differentiator (Linear's
⌘K lesson).

## 2. User stories

- As a user, I want one shortcut that finds anything I've written, so that I
  never remember *where* something lives.
- As a keyboard user, I want the same surface to run commands ("new task",
  "toggle dark mode"), so that the palette is the app's fastest interface.
- As a privacy user, I want certainty that private notes never appear in
  global search while locked.

## 3. User experience & flows

Global hotkey (Ctrl/Cmd+K) opens the palette: type → mixed results grouped
by type (top hits first), with type filters (`t:` tasks, `n:` notes, `#tag`,
`u ` prefix for commands), keyboard navigation, enter to open, modifier-enter
for secondary action (e.g. complete task). Recent items and suggested
commands on empty query. Full search page for browsing beyond top hits with
per-module facets.

## 4. Functional requirements

- **SRCH-001 (M)** Global palette with hotkey; results across all enabled
  modules via a shared indexing contract (each module registers entity
  types, fields, and deep links).
- **SRCH-002 (M)** Full-text index, local, incremental (updates within 1 s
  of an edit), with prefix/fuzzy matching and Serbian/English analyzers
  (folding š/č/ć/đ/ž ↔ s/c/c/dj/z so both spellings match).
- **SRCH-003 (M)** Command mode: registered actions (new X, go to X, toggle
  setting) searchable in the same palette; actions declare context
  availability.
- **SRCH-004 (M)** Private notes: excluded from the global index entirely
  (SEC-ZK-06); in-section encrypted search only (PRIV-006). Locked = zero
  trace, unlocked = still excluded from *global* results (explicit design).
- **SRCH-005 (M)** Profile separation: results only from the active profile
  (calendar overlay events from the other profile appear only as their
  visual-distinct calendar entries, not in search).
- **SRCH-006 (M)** Result ranking: recency + type priors + exact-match
  boost; recent items on empty query.
- **SRCH-007 (S)** Filters/operators: type prefixes, `#tag`, date ranges
  (`due:`), module facets on the full search page.
- **SRCH-008 (S)** File-content search for indexed attachments (text-based
  formats + PDF text layer via DOC pipeline) — size-capped.
- **SRCH-009 (C)** Search history (local, clearable).

## 5. Options & settings

Hotkey remap (SET-013); modules included in index; attachment content
indexing on/off; clear index/history.

## 6. Integrations

Every module (indexing + command registration contracts — part of this PRD);
DOC (text extraction); PRIV (exclusion contract); SET (settings are
searchable via the settings contract).

## 7. Edge cases & error states

- Index corruption → transparent rebuild in background with progress note.
- Huge accounts (100k items) → index size caps per module with LRU for
  attachment text; palette p95 < 50 ms for top hits (budget).
- Diacritics folding must not produce false "identical" titles in dedup
  contexts (fold only for matching, never storage).
- Disabling a module purges its entries from the index (visibility rule),
  re-enabling re-indexes.
- Renames/moves update deep links (stable entity IDs, not paths).

## 8. Acceptance criteria (key)

- "resenje" finds a note titled "Rešenje zadatka"; `t: faks` finds only
  tasks; `u tamna` toggles dark theme.
- Private note titled "Test tajna" is unfindable globally in both locked and
  unlocked states; findable inside PRIV search when unlocked.
- New task appears in results within 1 s.
- Business-profile items never surface while personal profile is active.

## 9. Open questions

1. ~~Attachment-content indexing default.~~ **Decided (founder 2026-07-05):
   off by default, toggle in settings.**
2. Web app hotkey conflicts (browser owns Ctrl+K in some contexts) —
   fallback hotkey decision for web.

## 10. Future extensions

Semantic search (AI module, local embeddings); saved searches as smart
lists; cross-profile opt-in search.
