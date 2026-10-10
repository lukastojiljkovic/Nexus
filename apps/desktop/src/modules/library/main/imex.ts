import {
  LIBRARY_EXPORT_VERSION,
  libraryExportVersion,
  validateLibraryExport,
  type LibraryExportV1,
} from "@nexus/core";
import type { LibraryStore } from "@nexus/db";

/**
 * BIBLIOTEKA's archive section (ADR-090 §imex): what this module puts in
 * `data/modules.ndjson`, and the only reader of it.
 *
 * **The payload IS the store's own versioned value, and that is the whole
 * design.** Stage 1 built `LibraryStore.exportData`/`importData` with a
 * versioned shape and a validator strict enough to refuse a hand-edited file
 * whole (`validateLibraryExport`: row shapes, bounds, progress against kind,
 * and every reference between the six tables). A second payload shape here
 * would be a second thing to keep in step with those six tables, so this file
 * is two thin functions around the pair that already exists - and the round trip
 * is the store's own test's subject, not a promise made here.
 *
 * **Why the version is named and not merely checked.** `ProfileData.modules`
 * holds `payload: unknown`, and core says out loud that the shape belongs to the
 * module. Reading the number before the value is what lets a refusal say "written
 * by another version of this module" rather than "not valid", which is the
 * difference between sending a reader to a newer build and telling them their
 * own file is corrupt (Tajmeri's rule, one module over).
 *
 * **What the payload carries, and the one thing it cannot.** A work, its passes,
 * its thoughts, its collections and their order all ride. Its COVER rides as an
 * index row - name, MIME, size, hash - and the BYTES do not, because the
 * archive's `blobs/` union is built in `@nexus/core` from the compiled-in
 * modules' own fields, and a kit module's payload is deliberately opaque to that
 * builder. Nothing in this build creates a cover row either (the module's
 * screens do not upload images), so the gap is unreachable today and is recorded
 * here rather than papered over: the day a cover becomes reachable, the blob
 * carrier is the piece to add - not a field on this payload.
 *
 * **Live content only.** A soft-deleted work is not in the value, and neither
 * are its passes and its thoughts; that is `export.ts`'s own rule, and it is why
 * an import REPLACES the profile's library rather than merging into it (a merge
 * could not express the deletion).
 */

/** What `exportData` is handed: the module's store, already open for the profile being written. */
export function buildLibraryExport(library: LibraryStore): LibraryExportV1 {
  return library.exportData();
}

/**
 * Reads one payload off an archive, completely, before anything is written.
 *
 * **Throwing is the contract.** This is a `ModuleImport.parse`: the host runs it
 * at the preview - so a refusal reaches the user before they confirm a restore
 * that replaces their profile - and again before any module writes, and it must
 * write nothing itself. A half-validated payload that failed on its fortieth row
 * would leave a profile holding a fragment of an archive, so this function has
 * no early return and no partial result: it answers a fully validated value or
 * it throws, and the message names which of the two things is wrong.
 */
export function parseLibraryExport(value: unknown): LibraryExportV1 {
  const version = libraryExportVersion(value);
  if (version !== LIBRARY_EXPORT_VERSION) {
    throw new Error(
      `Library data was written by another version of this module (found ${String(version ?? "?")}, expected ${LIBRARY_EXPORT_VERSION}).`,
    );
  }
  const parsed = validateLibraryExport(value);
  if (parsed === null) {
    throw new Error("Library data is not a valid library export value.");
  }
  return parsed;
}
