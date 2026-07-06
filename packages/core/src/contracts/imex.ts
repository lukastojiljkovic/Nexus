/**
 * A module's participation in import/export (PRD 14 IMEX). Only identity and
 * the schema version are modelled here.
 */
export interface ImexHandler {
  /** Stable id of the export/import section this module owns. */
  id: string;
  /** Semver of this module's export schema (ADR-009 semver-versioned manifest). */
  schemaVersion: string;
  // The serialize/deserialize signatures (NDJSON rows, Markdown mirrors, blobs)
  // are resolved when the IMEX container format lands (ADR-009, PRD 14 IMEX).
}
