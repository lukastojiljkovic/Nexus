import {
  CALCULATOR_EXPORT_VERSION,
  DEFAULT_CALCULATOR_SETTINGS,
  MAX_CALC_HISTORY_IMPORT_ENTRIES,
  MAX_CALC_HISTORY_RESULT_LENGTH,
} from "@nexus/db";
import type { CalcHistoryExportEntry, CalculatorExport } from "@nexus/db";
import {
  CALCULATOR_ANGLE_MODES,
  CALCULATOR_PRECISIONS,
  MAX_CALCULATOR_VALUE_LENGTH,
  MAX_EXPRESSION_LENGTH,
  emptyCalculatorSession,
  isLibraryTimestamp,
  parseCalculatorSession,
} from "@nexus/core";
import type { CalculatorAngleMode, CalculatorPrecision } from "@nexus/core";

/**
 * CALCULATOR's archive payload (ADR-090 §imex): what the module puts in
 * `data/modules.ndjson`, and the only reader of it.
 *
 * **This lives in `main/` because the bounds it enforces are the STORE's.**
 * `MAX_EXPRESSION_LENGTH`, `MAX_CALC_HISTORY_RESULT_LENGTH` and
 * `MAX_CALCULATOR_VALUE_LENGTH` come from `@nexus/db` and `@nexus/core`, which
 * no file under `shared/` may reach (`@nexus/db` is SQLite and therefore
 * Node-only, and the renderer shares that folder). A second copy of 1 000, 4 096
 * and 32 768 up there would be numbers that agree until one moves.
 *
 * **Why `version` is checked rather than assumed.** `ProfileData.modules` holds
 * `payload: unknown`, and core says out loud that the shape belongs to the
 * module. The field is what makes that safe: a payload written by a later build
 * of THIS module is refused by name instead of being half-read.
 *
 * **The timestamps are checked with core's own predicate.** A history row's two
 * instants travel as text, and `isLibraryTimestamp` is the one exported
 * predicate for that shape - core's comment beside it says it exists so a
 * store's gate and an archive reader cannot disagree about what a stored
 * timestamp is. This file is the archive reader; the store runs the same rule
 * again on the way in.
 */

/** One history row as the archive carries it, validated field by field. */
function parseEntry(value: unknown): CalcHistoryExportEntry {
  const record = asRecord(value, "history[]");
  if (typeof record["pinned"] !== "boolean") {
    throw new Error('Calculator data: "history[].pinned" must be a boolean.');
  }
  return {
    expression: asExpression(record["expression"]),
    result: asResult(record["result"]),
    value: asValue(record["value"]),
    pinned: record["pinned"],
    createdAt: asTimestamp(record["createdAt"], "createdAt"),
    updatedAt: asTimestamp(record["updatedAt"], "updatedAt"),
  };
}

/**
 * The module's own rows, normalised into the payload.
 *
 * The copy is field by field rather than a spread on purpose: a column renamed
 * in a migration is a compile error here rather than an extra key in an archive,
 * and the payload's shape is therefore stated in this file - the module's own
 * archive section - rather than inherited from the store's return type.
 */
export function buildCalculatorExport(exported: CalculatorExport): CalculatorExport {
  return {
    version: CALCULATOR_EXPORT_VERSION,
    history: exported.history.map((entry) => ({
      expression: entry.expression,
      result: entry.result,
      value: entry.value,
      pinned: entry.pinned,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    })),
    session: exported.session,
    settings: {
      angleMode: exported.settings.angleMode,
      precision: exported.settings.precision,
    },
  };
}

/** A payload with nothing in it - what an archive that says nothing about the calculator restores to. */
export function emptyCalculatorExport(): CalculatorExport {
  return {
    version: CALCULATOR_EXPORT_VERSION,
    history: [],
    // Core's own empty session rather than a literal: a restore that says
    // nothing about the calculator must leave the profile in exactly the state a
    // profile that never saved one has, and that state is `session.ts`'s to state.
    session: emptyCalculatorSession(),
    // And the engine's own defaults, for the same reason: an archive that says
    // nothing about the calculator must leave the profile in exactly the state a
    // profile that never opened the page has. The store owns that answer, so it
    // is read from there rather than restated.
    settings: DEFAULT_CALCULATOR_SETTINGS,
  };
}

/**
 * Reads one payload off an archive, completely, before anything is written.
 *
 * **Throwing is the contract.** This is a `ModuleImport.parse`: the host runs it
 * when the section is read - at the preview, so the user hears the refusal
 * before confirming a restore that replaces their profile - and again before
 * any module writes, and it must write nothing itself. A half-validated payload
 * that failed on its fortieth row would leave a profile holding a fragment of an
 * archive, so every message names the field that is wrong and there is no early
 * return.
 */
export function parseCalculatorExport(value: unknown): CalculatorExport {
  const record = asRecord(value, "payload");
  if (record["version"] !== CALCULATOR_EXPORT_VERSION) {
    throw new Error(
      `Calculator data was written by another version of this module (found ${String(record["version"])}, expected ${CALCULATOR_EXPORT_VERSION}).`,
    );
  }
  const rawHistory = record["history"];
  if (!Array.isArray(rawHistory)) throw new Error('Calculator data: "history" must be an array.');
  if (rawHistory.length > MAX_CALC_HISTORY_IMPORT_ENTRIES) {
    throw new Error(
      `Calculator data: at most ${MAX_CALC_HISTORY_IMPORT_ENTRIES} history entries may be restored.`,
    );
  }
  const session = parseCalculatorSession(record["session"]);
  if (session === null) {
    throw new Error(
      'Calculator data: "session" must be a version-1 object of text values and named functions.',
    );
  }
  return {
    version: CALCULATOR_EXPORT_VERSION,
    history: rawHistory.map(parseEntry),
    session,
    settings: parseSettings(record["settings"]),
  };
}

/**
 * The two preferences, each narrowed to the set the ENGINE names.
 *
 * The unions are core's own (`CalculatorAngleMode`/`CalculatorPrecision`), and
 * the values are checked against core's own tuples - the store runs the same
 * validation again inside the transaction, so what this refuses is refused before
 * a row is touched rather than after.
 */
function parseSettings(value: unknown): {
  angleMode: CalculatorAngleMode;
  precision: CalculatorPrecision;
} {
  const record = asRecord(value, "settings");
  const angleMode = record["angleMode"];
  if (!isAngleMode(angleMode)) {
    throw new Error(
      `Calculator data: "settings.angleMode" must be one of ${CALCULATOR_ANGLE_MODES.join(", ")}.`,
    );
  }
  const precision = record["precision"];
  if (!isPrecision(precision)) {
    throw new Error(
      `Calculator data: "settings.precision" must be one of ${CALCULATOR_PRECISIONS.join(", ")}.`,
    );
  }
  return { angleMode, precision };
}

/** Both guards narrow a `{ sr, en }`-free value to core's own union, so the return above needs no cast. */
function isAngleMode(value: unknown): value is CalculatorAngleMode {
  return typeof value === "string" && (CALCULATOR_ANGLE_MODES as readonly string[]).includes(value);
}

function isPrecision(value: unknown): value is CalculatorPrecision {
  return typeof value === "string" && (CALCULATOR_PRECISIONS as readonly string[]).includes(value);
}

/** The archive's own structural rule: an object, never an array or a primitive. */
function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Calculator data: "${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new Error(`Calculator data: "${field}" must be a string.`);
  const text = value.trim();
  if (text.length === 0 || text.length > max) {
    throw new Error(`Calculator data: "${field}" must be 1..${max} characters.`);
  }
  return text;
}

/** An expression, held to the bound the engine parses within. */
function asExpression(value: unknown): string {
  return asText(value, "history[].expression", MAX_EXPRESSION_LENGTH);
}

/** The display string, held to the store's own result cap. */
function asResult(value: unknown): string {
  return asText(value, "history[].result", MAX_CALC_HISTORY_RESULT_LENGTH);
}

/** The lexical value, held to the engine's own value cap. */
function asValue(value: unknown): string {
  return asText(value, "history[].value", MAX_CALCULATOR_VALUE_LENGTH);
}

function asTimestamp(value: unknown, field: string): string {
  if (!isLibraryTimestamp(value)) {
    throw new Error(`Calculator data: "${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}
