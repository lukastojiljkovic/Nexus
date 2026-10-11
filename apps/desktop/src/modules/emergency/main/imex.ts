import { EMERGENCY_EXPORT_VERSION, parseEmergencyCardExport } from "@nexus/db";
import type { EmergencyCardExport, EmergencyCardStore } from "@nexus/db";

/**
 * The emergency card's section of the profile archive (ADR-090 §imex): what this
 * module puts in `data/modules.ndjson`, and the only reader of it.
 *
 * **Why this is four lines and a paragraph.** Every module built on the kit owns
 * one versioned JSON value, and the card's was designed as one from the start:
 * `EmergencyCardStore.exportData` writes it and `importData` reads it, both
 * already strict about the version, the keys and every field. So this file does
 * not restate the shape - it hands the STORE's own pair to the kit, in the two
 * halves the kit runs at two different moments (`ModuleImport`).
 *
 * **Why `parse` delegates to `@nexus/db` rather than re-validating.** A parser
 * written here would be a second, weaker copy of `parseEmergencyCardExport`,
 * and the two would agree exactly until one of them moved. Delegating is also
 * what keeps the promise `parse` has to make: the kit calls it at the PREVIEW
 * (so a refusal reaches the user before they confirm a restore that replaces
 * their profile) and again before any module writes, and it must write nothing.
 * `parseEmergencyCardExport` is pure - stage 1's own header says so.
 *
 * **Why this lives in `main/` rather than in `shared/`.** It imports `@nexus/db`,
 * which no file under `shared/` may reach: that package is SQLite and therefore
 * Node-only, and the renderer shares that folder.
 */

/**
 * What an archive says about a profile that has no card.
 *
 * A restore that does not name this module must EMPTY it, not leave it alone
 * (ADR-090 §5), and "empty" for this module is the shape `exportData` answers
 * for a profile with no card - so the one value is written once, here, in the
 * module's own vocabulary, and handed to `importData` through the same door a
 * real archive would use.
 */
const EMPTY_EXPORT: EmergencyCardExport = {
  version: EMERGENCY_EXPORT_VERSION,
  card: null,
  contacts: [],
  documents: [],
};

/** This profile's card as the archive carries it. A profile with no card still exports the empty shape, so an archive always names the module. */
export function buildEmergencyExport(store: EmergencyCardStore): EmergencyCardExport {
  return store.exportData();
}

/**
 * Reads one payload out of an archive COMPLETELY, before anything is written.
 *
 * Throwing is the contract: it either answers with the whole validated payload or
 * it throws, and every message names the field that is wrong (the store's own
 * sentences, which is why this does not wrap them).
 */
export function parseEmergencyExport(value: unknown): EmergencyCardExport {
  return parseEmergencyCardExport(value);
}

/**
 * Writes one profile's card section. `undefined` is an archive that says nothing
 * about this module, which for a restore that replaces a profile whole means
 * empty - so it is handed the empty shape through the store's own reader rather
 * than a special "delete" path that could drift from it.
 */
export function applyEmergencyExport(
  store: EmergencyCardStore,
  parsed: EmergencyCardExport | undefined,
): void {
  store.importData(parsed ?? EMPTY_EXPORT);
}
