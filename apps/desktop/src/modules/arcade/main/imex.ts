import {
  ARCADE_EXPORT_VERSION,
  parseArcadeExport,
  type ArcadeExport,
  type ArcadeScoreStore,
} from "@nexus/db";

/**
 * ARCADE's archive section (ADR-090, the imex slot): what the module puts in
 * `data/modules.ndjson`, and the only reader of it.
 *
 * **The payload is the STORE's, and that is a decision rather than an economy.**
 * `ArcadeScoreStore` already owns both halves of this door - a versioned
 * `exportData` and an `importData` that validates the whole value before it
 * writes a row - so this file adds no second shape to keep in step. A payload
 * written by hand here would be a third description of the same rows, and the
 * one that drifts.
 *
 * **The pure half is `parseArcadeExport`, which `@nexus/db` exports for this
 * caller.** The kit runs `parse` at the PREVIEW, before anybody confirms a
 * restore that replaces their profile, and that call has to read everything and
 * write nothing; `importData` then revalidates through the same function, so a
 * payload the preview accepted cannot be refused later by a rule that lives
 * somewhere else.
 *
 * **Why an empty profile still exports a payload.** A profile with no finished
 * games writes `{ version: 1, scores: [] }` rather than nothing: "this profile
 * has played nothing" is a fact the archive can carry, and a module that
 * answered `undefined` would be indistinguishable from one that did not exist
 * yet in an archive written by an older build.
 */

/** What `exportData` reads out of a profile. */
export function buildArcadeExport(store: ArcadeScoreStore): ArcadeExport {
  return store.exportData();
}

/**
 * An archive that says nothing about Arcade, as the value `apply` writes.
 *
 * A restore replaces a profile whole, so the section's absence is not "leave it
 * alone" but "this profile's scores going back to empty" - and the store's
 * `importData` is the one method that expresses that, without a second spelling
 * of the shape here.
 */
export function emptyArcadeExport(): ArcadeExport {
  return { version: ARCADE_EXPORT_VERSION, scores: [] };
}

/**
 * The reader the kit is handed: pure, total, and it writes nothing.
 *
 * It answers the archive's OWN shape rather than the store's row list, because
 * that is what `apply` hands back to `importData` - one value crossing the seam
 * instead of two spellings of it. The version is written back rather than
 * echoed, for the reason `parseArcadeExport` checks it: only one version is read,
 * so only one can come out.
 */
export function parseArcadeSection(value: unknown): ArcadeExport {
  return { version: ARCADE_EXPORT_VERSION, scores: parseArcadeExport(value) };
}
