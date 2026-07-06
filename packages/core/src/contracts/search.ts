/**
 * A search indexer a module registers so its entities appear in global search
 * (PRD 08 SRCH). Only identity is modelled here.
 */
export interface SearchIndexer {
  /** Stable indexer id, unique within its module. */
  id: string;
  /** i18n key for the entity kind this indexer surfaces (e.g. a task, a note). */
  kindKey: string;
  // The document-extraction and query signatures are resolved when the SRCH
  // indexing pipeline lands (PRD 08 SRCH, ADR-001 typed query interface).
}
