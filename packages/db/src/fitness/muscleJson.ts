import { MUSCLE_GROUPS } from "@nexus/core";
import type { MuscleGroup } from "@nexus/core";

/**
 * The muscle-group arrays that migration 060 stores as JSON — an exercise's
 * primary and secondary groups, and the snapshot a logged set carries of the
 * primaries it worked.
 *
 * SQLite cannot CHECK a JSON column, and migration 060 says so rather than
 * pretending otherwise, so the vocabulary is guarded here on both sides of the
 * boundary: on the way in against what a caller supplies, on the way out
 * against what the file actually holds.
 *
 * **A stored value that does not parse is corruption, not input to coerce.**
 * Reading it as `[]` would silently drop what an exercise trains, or which
 * weekly total a set belongs in, and the arithmetic downstream would carry on
 * looking correct — `FitFoodStore.parseStoredServings`'s posture, and the
 * reason it is worth restating: a total that is quietly wrong is worse than a
 * read that refuses.
 *
 * The parse answers `null` rather than throwing so each store raises its OWN
 * typed error naming its own row („Exercise …" / „Set …"). The RULE lives here
 * once; only the sentence belongs to the caller. It had been two copies, which
 * is how a rule starts drifting.
 */
export function parseMuscleList(text: string): MuscleGroup[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return isMuscleList(parsed) ? parsed : null;
}

/** Whether a value is an array of known muscle groups — the same question `parseMuscleList` asks, for callers holding an already-parsed value. */
export function isMuscleList(value: unknown): value is MuscleGroup[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) => typeof entry === "string" && (MUSCLE_GROUPS as readonly string[]).includes(entry),
    )
  );
}
