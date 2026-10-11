import { readCardGameArchive } from "@nexus/db";
import type { CardGameData, CardGameStore } from "@nexus/db";

/**
 * CARDS' archive section (ADR-090 §imex): what this module puts in an archive and
 * the only reader of it.
 *
 * **Why this file is a pair of one-liners, and why that is the right size.** Timers'
 * payload is AUTHORED data — a preset is a name and a duration — so its module file
 * owns the shape and the version. A card game is not like that: its rows ARE the
 * content (a deal number, the log that produced the position, and the record), and
 * all of them are already `CardGameStore`'s own shapes with the STORE's own
 * guarantees — `importData` replays every log through the game's engine before it
 * writes anything. A second payload shape here would be a second place for those
 * invariants to be stated, and the two would drift.
 *
 * So the section IS the store's value: `exportData` reads it, `importData` writes
 * it, and the kit's pure `parse` half is `readCardGameArchive` — the reader
 * `importData` runs first, exported for exactly this. That is what makes „parse
 * writes nothing" true by construction rather than by review.
 */

/** What `exportData` answers for one profile: the store's own versioned value. */
export function buildCardsExport(store: CardGameStore): CardGameData {
  return store.exportData();
}

/**
 * Reads one payload off an archive, completely, before anything is written.
 *
 * Throwing is the contract (see `ModuleImport`): the host runs this at the preview
 * and again before any module writes, and it must write nothing itself. It refuses
 * an unknown version, a seed outside the game's own range, a move list its engine
 * will not fold and two rows naming the same slot — each by name, all of them from
 * the store's own readers rather than restated here.
 */
export function parseCardsExport(value: unknown): CardGameData {
  return readCardGameArchive(value);
}
