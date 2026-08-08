/**
 * A search indexer a module DECLARES so its entities appear in global search
 * (PRD 08 SRCH). Only identity is modelled here, and deliberately so.
 *
 * This carries no document-extraction or query signature because there is
 * nothing for one to do: the SRCH pipeline landed as migration 017, and it is
 * SQL all the way down — one `search_source_<kind>` view per indexed kind
 * defines that kind's projection, and insert/update/delete triggers on the
 * source tables keep `search_entries`/`search_fts` current. That was chosen
 * precisely so no application code can forget to index a write, which means an
 * `extract(entity): Document` hook here would be a second, weaker definition of
 * the same projection.
 *
 * What is left is identity — the id a module registers under and the key its
 * results are labelled with — and a real declaration is what a module manifest
 * carries (`ModuleManifest.searchIndexers`). Adding a kind is a migration, not
 * an interface change.
 */
export interface SearchIndexer {
  /** Stable indexer id, unique within its module. */
  id: string;
  /** i18n key for the entity kind this indexer surfaces (e.g. a task, a note). */
  kindKey: string;
}
