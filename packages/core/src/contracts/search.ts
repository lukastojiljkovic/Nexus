import type { SearchKind } from "../search/searchQuery.js";

/**
 * One indexed kind a module OWNS in global search (PRD 08 SRCH) — the module
 * whose page a hit of that kind opens, and whose flag gates it: a profile that
 * switches the module off stops seeing its rows (ADR-058 §5). ADR-008 has
 * „SRCH's indexer wiring" generated from the manifest, and this is what makes
 * that true: the main process asks `ModuleRegistry.searchKindOwner` and keeps no
 * map of its own.
 *
 * Only ownership is modelled here, and deliberately so. There is no
 * document-extraction or query signature because there is nothing for one to
 * do: the SRCH pipeline landed as migration 017, and it is SQL all the way down
 * — one `search_source_<kind>` view per indexed kind defines that kind's
 * projection, and insert/update/delete triggers on the source tables keep
 * `search_entries`/`search_fts` current. That was chosen precisely so no
 * application code can forget to index a write, which means an
 * `extract(entity): Document` hook here would be a second, weaker definition of
 * the same projection. Adding a kind is a migration (017, 070), not an
 * interface change.
 *
 * **Until 2026-09-26 this slot was declared and nothing filled it.** It carried
 * an `id` and a `kindKey` that no code read — the kind labels are the
 * renderer's strings, keyed by `SearchKind` — while the one fact it exists to
 * state was written out a second time as a hand-kept map in the main process.
 * The slot now carries exactly that fact, and the map is gone.
 */
export interface SearchIndexer {
  /** The indexed kind. One module owns each; `ModuleRegistry.register` refuses a second claim. */
  readonly kind: SearchKind;
}
