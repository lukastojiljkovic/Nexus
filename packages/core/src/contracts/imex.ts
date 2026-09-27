/**
 * A module's participation in import/export (PRD 14 IMEX). Only identity and
 * the schema version are modelled here.
 */
export interface ImexHandler {
  /** Stable id of the export/import section this module owns. */
  id: string;
  /** Semver of this module's export schema (ADR-009 semver-versioned manifest). */
  schemaVersion: string;
  // No serialize/deserialize signatures, and the reason changed. This used to
  // say they would be resolved when the IMEX container format landed. It
  // landed (ADR-009) without them: the archive is assembled in `@nexus/core`
  // from `ProfileData`, one interchange version for the whole profile, and no
  // module manifest fills this slot. Whether the plugin path (ADR-008) still
  // needs it is open in `docs/STATUS.md` §4.1.
}
