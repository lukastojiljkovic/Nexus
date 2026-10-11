import { readBoardsArchive } from "@nexus/db";
import type { BoardsArchive, BoardsStore } from "@nexus/db";

/**
 * BOARDS' archive section (ADR-090 §imex): what this module puts in an archive
 * and the only reader of it.
 *
 * **Why this file is a pair of one-liners, and why that is the right size.**
 * Timers' payload is AUTHORED data — a preset is a name and a duration, and the
 * archive carries what the user typed while the rows are re-minted on import —
 * so its module file owns the shape and the version. A board game is not like
 * that: its rows ARE the content (a position the engines wrote, the log that
 * produced it, the seed the dice came from, and the record against the computer),
 * and all of them are already `BoardsStore`'s own shapes with `BoardsStore`'s own
 * guarantees. A second payload shape here would be a second place for a saved
 * game's invariants to be stated, and the two would drift.
 *
 * So the section IS the store's value: `exportData` reads it, `importData` writes
 * it, and the kit's pure `parse` half is `readBoardsArchive` — the SAME reader
 * `importData` runs, exported for exactly this. That is what makes "parse writes
 * nothing" true by construction rather than by review: there is one function that
 * reads an archive and it has always been the one that never wrote anything.
 */

/** What `exportData` answers for one profile: the store's own versioned value. */
export function buildBoardsExport(store: BoardsStore): BoardsArchive {
  return store.exportData();
}

/**
 * Reads one payload off an archive, completely, before anything is written.
 *
 * Throwing is the contract (see `ModuleImport`): the host runs this at the preview
 * and again before any module writes, and it must write nothing itself. It refuses
 * an unknown version, a save whose position and log disagree, a record whose
 * arithmetic does not add up and a preference outside the three levels, each by
 * name — the refusals are `BoardsValidationError`'s, raised by the store's own
 * reader rather than restated here.
 */
export function parseBoardsExport(value: unknown): BoardsArchive {
  return readBoardsArchive(value);
}
