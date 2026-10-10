import { MAX_TIMER_DURATION_SECONDS, MAX_TIMER_NAME_LENGTH } from "@nexus/db";

/**
 * TIMERS' archive payload (ADR-090 §imex): what one module puts in
 * `data/modules.ndjson`, and the only reader of it.
 *
 * **Why this lives in `main/` rather than in `shared/`.** The bounds it enforces
 * are the STORE's - `MAX_TIMER_NAME_LENGTH` and `MAX_TIMER_DURATION_SECONDS`
 * come from `@nexus/db`, which no file under `shared/` may import (it is SQLite
 * and therefore Node-only, and the renderer shares that folder). A second copy
 * of 60 and 86 400 up there would be two numbers that agree until one moves.
 *
 * **Why the payload carries no countdowns.** A countdown is a clock that is
 * running RIGHT NOW: its whole state is an instant, and the instant belongs to
 * the machine that armed it. An archive that carried one would restore a timer
 * that ends at a moment the user never chose, or one whose end has already
 * passed - so the archive carries what the user AUTHORED (the named presets and
 * the module's one preference) and leaves live clocks to the profile they run
 * in. A restore therefore says nothing about countdowns, which is also the
 * honest reading of "this archive does not mention them".
 *
 * **Why `version` is checked rather than assumed.** `ProfileData.modules` holds
 * `payload: unknown`, and core says out loud that the shape belongs to the
 * module. The field is what makes that safe: a payload written by a later build
 * of THIS module is refused by name instead of being half-read.
 */

/** The schema of the payload `exportData` writes. A new shape is a new number, never a quiet reinterpretation. */
export const TIMERS_EXPORT_VERSION = 1;

/**
 * How many presets one archive may carry.
 *
 * A bound on untrusted input rather than a limit anybody meets: the count is an
 * array length read out of a file, and every entry costs a row. 500 named
 * countdowns is far past any real profile and far below anything that would make
 * a restore unpleasant.
 */
const MAX_PRESETS = 500;

/** One saved countdown, as the archive carries it: what the user typed, and nothing about the row that held it. */
export interface TimersPresetExport {
  name: string;
  durationSeconds: number;
}

/** The whole payload. `version` first, so a reader sees the number before the data. */
export interface TimersExport {
  version: number;
  presets: TimersPresetExport[];
  settings: { soundOnEnd: boolean };
}

/** What `exportData` is handed: the module's own rows, already read from the store. */
export function buildTimersExport(
  presets: readonly { name: string; durationSeconds: number }[],
  settings: { soundOnEnd: boolean },
): TimersExport {
  return {
    version: TIMERS_EXPORT_VERSION,
    presets: presets.map((preset) => ({
      name: preset.name,
      durationSeconds: preset.durationSeconds,
    })),
    settings: { soundOnEnd: settings.soundOnEnd },
  };
}

/**
 * Reads one payload off an archive, completely, before anything is written.
 *
 * **Throwing is the contract.** This is a `ModuleImport.parse`: the host runs it
 * when the section is read (at the preview, so the user hears the refusal before
 * confirming a restore) and again before any module writes, and it must write
 * nothing itself. A half-validated payload that failed on its fortieth row would
 * leave a profile holding a fragment of an archive. So this function has no
 * early return and no partial result: it either answers with a fully validated,
 * normalised payload or it throws, and every message names the field that is
 * wrong.
 *
 * Names are trimmed here rather than in the store, and duplicates are refused
 * here rather than by the UNIQUE index, for the same reason: the store's refusal
 * would arrive after its own first insert, and this one arrives before the
 * transaction opens.
 */
export function parseTimersExport(value: unknown): TimersExport {
  const record = asRecord(value, "payload");
  if (record.version !== TIMERS_EXPORT_VERSION) {
    throw new Error(
      `Timers data was written by another version of this module (found ${String(record.version)}, expected ${TIMERS_EXPORT_VERSION}).`,
    );
  }
  const rawPresets = record.presets;
  if (!Array.isArray(rawPresets)) throw new Error('Timers data: "presets" must be an array.');
  if (rawPresets.length > MAX_PRESETS) {
    throw new Error(`Timers data: at most ${MAX_PRESETS} presets may be restored.`);
  }
  const presets: TimersPresetExport[] = [];
  const seen = new Set<string>();
  for (const entry of rawPresets) {
    const preset = asRecord(entry, "presets[]");
    const name = asName(preset.name);
    if (seen.has(name)) throw new Error(`Timers data: two presets are named "${name}".`);
    seen.add(name);
    presets.push({ name, durationSeconds: asDuration(preset.durationSeconds) });
  }

  const settings = asRecord(record.settings, "settings");
  if (typeof settings.soundOnEnd !== "boolean") {
    throw new Error('Timers data: "settings.soundOnEnd" must be a boolean.');
  }
  return { version: TIMERS_EXPORT_VERSION, presets, settings: { soundOnEnd: settings.soundOnEnd } };
}

/** The archive's own structural rule: an object, never an array or a primitive. */
function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Timers data: "${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** A preset's name: the store's own bound, applied before the store ever sees it. */
function asName(value: unknown): string {
  if (typeof value !== "string") throw new Error('Timers data: "presets[].name" must be a string.');
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_TIMER_NAME_LENGTH) {
    throw new Error(
      `Timers data: a preset name must be 1..${MAX_TIMER_NAME_LENGTH} characters.`,
    );
  }
  return name;
}

/** A duration: whole seconds in the store's own range, because the store's CHECK is what it has to satisfy. */
function asDuration(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error('Timers data: "presets[].durationSeconds" must be a whole number.');
  }
  if (value < 1 || value > MAX_TIMER_DURATION_SECONDS) {
    throw new Error(
      `Timers data: a duration must be 1..${MAX_TIMER_DURATION_SECONDS} seconds.`,
    );
  }
  return value;
}
