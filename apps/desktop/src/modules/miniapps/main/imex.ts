import { parseMiniappsData, type MiniappsData } from "@nexus/db";

/**
 * MINI-APPS' archive payload (ADR-090 §imex): what this module puts in
 * `data/modules.ndjson`, and the only reader of it.
 *
 * **The store's document IS the section, and that is the whole design.** The
 * module keeps exactly what the user authored - the counters, the scoreboard,
 * the typing progress, the picked cities, the dice history and which tile was
 * open - and `MiniappsStore.read()` already answers that as one validated,
 * versioned value. So there is no second shape to describe here and nothing to
 * map: the archive carries the document, and `parseMiniappsData` (which the
 * store uses on every read and write too) is the one statement of what a
 * document is. A second validator in this file would be a second answer to a
 * question that already has one.
 *
 * **Why this file still exists.** The kit registers its section under a name and
 * a `parse`/`apply` pair, and both halves have a job even when they are thin:
 * `build` re-parses so the exporter hands out a fresh, plain copy rather than a
 * reference into the store's own read, and `parse` is the pure, total function
 * the host runs at the PREVIEW - where it must write nothing and must refuse
 * anything it would not take, before the user confirms a restore that replaces
 * their profile.
 *
 * **A document this build does not know is refused by name.** The version rides
 * inside the value, so a payload written by a later build of this module is
 * refused with the number that was found rather than half-read.
 */

/** The schema of the payload `exportData` writes - the store's own version, named here once so both halves cannot disagree. */
export type MiniappsExport = MiniappsData;

/**
 * The section as it is written: a validated, freshly built copy of the kept
 * document. Re-parsing rather than shallow-copying is deliberate - it is the
 * same function the reader uses, so an exporter can never emit something the
 * reader would refuse.
 */
export function buildMiniappsExport(data: MiniappsData): MiniappsExport {
  return parseMiniappsData(data);
}

/** Reads one payload off an archive, completely, before anything is written. */
export function parseMiniappsExport(value: unknown): MiniappsExport {
  return parseMiniappsData(value);
}
