import { readChessArchive, type ChessArchive, type ChessStore } from "@nexus/db";

/**
 * CHESS' archive section (ADR-090 §imex): what one profile's chess content looks
 * like in `data/modules.ndjson`, and the only reader of it.
 *
 * **The payload IS the store's archive.** `ChessStore.exportData` already answers
 * a versioned, plain-JSON value (games, the game in progress, the ladder record),
 * and `importData` already writes one — so this file maps nothing and re-states
 * nothing, which is the point. A module that declared its own parallel shape
 * would be a second definition of „what a chess archive is", and the first time
 * a column moved, the two would disagree about it.
 *
 * **`parse` is the store's own reader, not a looser check beside it.** The kit
 * runs `parse` at the restore PREVIEW — where the user hears a refusal before
 * confirming a restore that replaces their profile — and again before any module
 * writes, and it must write nothing and must read everything. `readChessArchive`
 * is exactly that function: it validates every field of every row (including
 * re-parsing each PGN and replaying the saved move list) and throws on anything
 * it will not take. `importData` runs it again on apply, so nothing can be
 * accepted here and refused there.
 *
 * **`undefined` means empty, not unchanged.** A restore replaces a profile whole,
 * so an archive that says nothing about chess has to leave a profile holding no
 * games, no game in progress and no ladder record — which is what the store's own
 * import of an empty archive does, rather than a DELETE written here.
 */

/** The section one profile exports: the store's own value, unchanged. */
export function buildChessExport(store: ChessStore): ChessArchive {
  return store.exportData();
}

/** The pure reader the kit calls twice; the store's own, so the two can never disagree. */
export const parseChessExport = readChessArchive;

/** An archive that names no chess content: every table emptied, which is what „this profile has no chess" means. */
const EMPTY: ChessArchive = { version: 1, games: [], resume: null, levelStats: [] };

/** Writes one profile's chess content, or empties it when the archive carries none. */
export function applyChessExport(store: ChessStore, archive: ChessArchive | undefined): void {
  store.importData(archive ?? EMPTY);
}
