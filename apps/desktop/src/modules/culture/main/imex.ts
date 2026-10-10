import { CULTURE_EXPORT_VERSION, parseCultureExportPayload, type CultureExport } from "@nexus/db";

/**
 * CULTURE's section of the profile archive (ADR-090 §5): what one module puts
 * in `data/modules.ndjson`, and the only reader of it.
 *
 * **The store already owns the shape**, so this file owns the two things the
 * store cannot know: which value a restore applies when the archive says
 * nothing about CULTURE, and the statement that the section carries ROWS rather
 * than bytes.
 *
 * **Why the section carries no blobs, and why that is not a hole.** A visit's
 * ticket and a track's audio live content-addressed in the blob store, and the
 * archive's `blobs/` union is assembled by `@nexus/core` from `ProfileData` -
 * which core carries WITHOUT reading (ADR-090 §5 says a module's payload is
 * opaque to it, and this one is). So the section restores every row exactly as
 * it was, hashes and names included, and the bytes stay in the local store
 * where `blobRefCount` protects them from collection. What that means for a
 * restore onto ANOTHER machine is stated rather than hidden: the rows arrive
 * and the files do not, which is the same shape a missing attachment has in
 * every other module, and the page draws a file it cannot find as a missing
 * one. Carrying kit-module bytes would be a change to core's archive union, and
 * this run does not own it.
 *
 * **Why an absent section means the SHIPPED default, not "empty".** A restore
 * replaces a profile whole, so a profile restored from an archive written
 * before CULTURE existed must come back into the state a profile that never
 * used CULTURE is in - which includes the module's own default preference
 * (asking about past plans is ON, `culture_settings` has no row, and the store
 * answers the default for a profile with no row).
 */

/** What a restore applies when the archive names no CULTURE section: no rows, and the module's shipped preference. */
export function emptyCultureSection(): CultureExport {
  return {
    version: CULTURE_EXPORT_VERSION,
    venues: [],
    visits: [],
    plans: [],
    tracks: [],
    entries: [],
    playlists: [],
    settings: { promptPastPlans: true },
  };
}

/**
 * The pure half the kit runs twice (at the preview and again before any write):
 * it reads the WHOLE payload - the version first - and throws on anything it
 * will not take, so a refused archive never reaches a write. Delegated to the
 * store's own reader, which is the one definition of what a CULTURE export is.
 */
export function parseCultureSection(value: unknown): CultureExport {
  return parseCultureExportPayload(value);
}

/** The payload to apply: what the section carried, or the shipped default for a section that named none. */
export function cultureSectionOrDefault(payload: CultureExport | undefined): CultureExport {
  return payload ?? emptyCultureSection();
}
