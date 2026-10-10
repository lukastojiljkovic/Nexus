import {
  readSaveExport,
  readSettings,
  readStatsExport,
  type PuzzleSaveExport,
  type PuzzlesSettings,
  type PuzzlesStatsExport,
} from "@nexus/db";

/**
 * PUZZLES' archive payload (ADR-090 §imex): what one module puts in
 * `data/modules.ndjson`, and the only reader of it.
 *
 * **Why this lives in `main/` rather than in `shared/`.** The bounds it enforces
 * are the STORE's — `readSaveExport`, `readStatsExport` and `readSettings` come
 * from `@nexus/db`, which no file under `shared/` may import (it is SQLite and
 * therefore Node-only, and the renderer shares that folder). A second copy of
 * those rules up there would be two definitions of what a saved mahjong board
 * is, agreeing until one moves.
 *
 * **Why the payload carries the whole module.** A puzzle somebody is in the
 * middle of is content the user made — the digits entered, the marks crossed,
 * the tiles taken — and the product's own promise is that a game resumes exactly.
 * A restore therefore carries the games in progress, the record, and the one
 * preference, on the CHESS store's terms (`ChessArchive` carries its resume slot
 * for the same reason) and unlike TIMERS' archive, which deliberately leaves live
 * clocks behind because a clock belongs to the machine that armed it. A puzzle has
 * no such instant: it is a position, and a position travels.
 *
 * **Why `version` is checked rather than assumed.** `ProfileData.modules` holds
 * `payload: unknown`, and core says out loud that the shape belongs to the
 * module. The field is what makes that safe: a payload written by a later build
 * of THIS module is refused by name instead of being half-read.
 */

/** The schema of the payload `exportData` writes. A new shape is a new number, never a quiet reinterpretation. */
export const PUZZLES_EXPORT_VERSION = 1;

/**
 * How many rows one archive may carry.
 *
 * A bound on untrusted input rather than a limit anybody meets: the module has
 * four puzzles with at most four grades each, so a full archive is sixteen saves
 * and sixteen rows of statistics. 64 is four times that, which leaves room for a
 * vocabulary that grows and still bounds a file whose array lengths are not
 * anybody's promise.
 */
const MAX_ARCHIVE_ROWS = 64;

/** The whole payload. `version` first, so a reader sees the number before the data. */
export interface PuzzlesExport {
  version: number;
  saves: PuzzleSaveExport[];
  stats: PuzzlesStatsExport[];
  /** `null` for an archive that carried no preference — which is what a restore should answer with the store's own default. */
  settings: PuzzlesSettings | null;
}

/** What `exportData` is handed: the module's own rows, already read from the store. */
export function buildPuzzlesExport(data: {
  saves: readonly PuzzleSaveExport[];
  stats: readonly PuzzlesStatsExport[];
  settings: PuzzlesSettings;
}): PuzzlesExport {
  return {
    version: PUZZLES_EXPORT_VERSION,
    saves: data.saves.map((save) => ({ ...save, state: save.state })),
    stats: data.stats.map((row) => ({ ...row })),
    settings: { ...data.settings },
  };
}

/**
 * Reads one payload off an archive, completely, before anything is written.
 *
 * **Throwing is the contract.** This is a `ModuleImport.parse`: the host runs it
 * when the section is read (at the preview, so the user hears the refusal before
 * confirming a restore) and again before any module writes, and it must write
 * nothing itself. So there is no early return and no partial result: it either
 * answers with a fully validated payload or it throws, and every message names
 * the field that is wrong.
 */
export function parsePuzzlesExport(value: unknown): PuzzlesExport {
  const record = asRecord(value, "payload");
  if (record.version !== PUZZLES_EXPORT_VERSION) {
    throw new Error(
      `Puzzles data was written by another version of this module (found ${String(record.version)}, expected ${PUZZLES_EXPORT_VERSION}).`,
    );
  }
  const rawSaves = record.saves;
  if (!Array.isArray(rawSaves)) throw new Error('Puzzles data: "saves" must be an array.');
  if (rawSaves.length > MAX_ARCHIVE_ROWS) {
    throw new Error(`Puzzles data: at most ${MAX_ARCHIVE_ROWS} saved games may be restored.`);
  }
  const saves = rawSaves.map((entry) => readSaveExport(entry));

  const rawStats = record.stats;
  if (!Array.isArray(rawStats)) throw new Error('Puzzles data: "stats" must be an array.');
  if (rawStats.length > MAX_ARCHIVE_ROWS) {
    throw new Error(`Puzzles data: at most ${MAX_ARCHIVE_ROWS} statistics rows may be restored.`);
  }
  const stats = rawStats.map((entry) => readStatsExport(entry));

  const rawSettings = record.settings;
  const settings =
    rawSettings === null || rawSettings === undefined ? null : readSettings(rawSettings);

  return { version: PUZZLES_EXPORT_VERSION, saves, stats, settings };
}

/** The archive's own structural rule: an object, never an array or a primitive. */
function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Puzzles data: "${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}
