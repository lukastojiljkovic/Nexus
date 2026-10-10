import { RECORDER_EXPORT_VERSION, parseRecorderExport } from "@nexus/db";
import type { RecorderExport, RecorderStore } from "@nexus/db";

/**
 * RECORDER's archive section (ADR-090 §imex): what one module puts in
 * `data/modules.ndjson`, and the only reader of it.
 *
 * **Why the payload is the store's own value, versioned by the store.** `@nexus/db`
 * already writes and reads this module's archive half — `RecorderStore.exportData`
 * produces `{ version, recordings, markers }` and `parseRecorderExport` reads a
 * whole value back without touching a database — so this file is the thin seam the
 * kit registers, and not a second definition of what a recording is. The two
 * bounds an archive needs (`MAX_RECORDING_BYTES`, the four mimes) live with the
 * store that CHECKs them, and no file under `shared/` may import `@nexus/db` to
 * restate them.
 *
 * **Why the bytes are not here, and what that costs.** The payload is the INDEX:
 * each recording carries the `sha256` naming its bytes and the mime to serve
 * them as, exactly as `note_attachments`' rows are the index half of a note's
 * files. The blob store holds the bytes, `main/index.ts`'s `blobRefCount` counts
 * this module's rows among their references, and the `nx-blob:` protocol plays
 * them back. What the archive therefore does NOT carry is the media itself:
 * ADR-090 §5 gives a kit module's section a JSON value and no way to declare a
 * `blobs/<sha256>` entry, so a restore onto another machine writes rows whose
 * bytes its blob store does not have (a restore over the same install is whole —
 * the bytes are still on disk). `RecorderStore.exportData` records the same
 * limit beside the payload it produces, and closing it is a change to the
 * interchange and to `main/restore.ts`, not to this module.
 *
 * **Why `version` is checked rather than assumed.** `ProfileData.modules` holds
 * `payload: unknown`, and core says out loud that the shape belongs to the module.
 * The field is what makes that safe: a payload written by a later build of THIS
 * module is refused by name instead of being half-read.
 */

/**
 * What `apply` writes when the archive says nothing about the recorder: a restore
 * replaces a profile whole, so „no section" is „no recordings", not „leave what
 * is there". A restore of a pre-1.42 archive therefore empties this module's two
 * tables, which is exactly what that archive means.
 */
export const EMPTY_RECORDER_EXPORT: RecorderExport = {
  version: RECORDER_EXPORT_VERSION,
  recordings: [],
  markers: [],
  settings: { countdown: false },
};

/**
 * The section for one profile, or `undefined` for a profile with nothing
 * recorded — `ModuleContext.exportData`'s own contract, and what keeps an
 * archive's shape from changing the day this module is added (`ModuleHost`
 * omits a module that answers `undefined` rather than writing an empty one).
 *
 * The rows are read through the store, so a recording's `sha256`, `sizeBytes` and
 * `durationMs` — the three numbers that make its bytes findable and its cost
 * visible — travel exactly as the store holds them.
 */
export function buildRecorderExport(store: RecorderStore): RecorderExport | undefined {
  const value = store.exportData();
  const saysNothing =
    value.recordings.length === 0 && value.markers.length === 0 && !value.settings.countdown;
  return saysNothing ? undefined : value;
}

/**
 * Reads one payload off an archive, completely, before anything is written.
 *
 * **Throwing is the contract.** This is a `ModuleImport.parse`: the host runs it
 * when the section is read (at the preview, so the user hears a refusal before
 * confirming a restore that replaces their profile) and again before any module
 * writes, and it must write nothing itself. A half-validated payload that failed
 * on its fortieth row would leave a profile holding a fragment of an archive, so
 * there is no early return here and no partial result — the store's own whole-value
 * validator is the one `importData` uses, which is what keeps the preview and the
 * write from ever disagreeing about what an archive may contain.
 */
export function parseRecorderArchive(value: unknown): RecorderExport {
  return parseRecorderExport(value);
}
