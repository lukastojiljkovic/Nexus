/**
 * HABIT's own schedule vocabulary — and, first, why it is not ADR-024's.
 *
 * **A habit deliberately does NOT carry a recurrence rule.** Tasks, events and
 * subscriptions all do, and the temptation to make this the fourth table with a
 * `recurrence` column is strong enough that the reasoning belongs here rather
 * than in a commit message. The rule engine answers „when does this next occur";
 * a habit needs „was this period satisfied" — a different question, and one the
 * engine has no way to be asked. Worse, the rule language can express schedules
 * over which a streak is simply undefinable: `until` and `count` end a series
 * (what is the streak of a habit that stopped being expected?), and „every 3rd
 * Tuesday" or a 5-week interval put the expected days so far apart that the run
 * between them stops meaning anything a person would recognise as a streak. „Ne
 * prekidaj niz" over „every 3rd Tuesday until March" is not a promise anybody
 * can defend, so the language that could ask for it is not offered.
 *
 * There are exactly TWO kinds here and there will not be a third, because
 * neither expresses the other. „Teretana ponedeljak/sreda/petak" is not „teretana
 * 3× nedeljno": the second forgives a Tuesday the first counts as a miss, and
 * that difference IS why somebody picks one. A tracker offering only fixed days
 * makes half its users tick a day they did not mean; one offering only a quota
 * makes the other half lose the point of a fixed schedule. Two kinds, both
 * complete, no third.
 */

/**
 * ISO-8601 weekday numbers: 1 = Monday … 7 = Sunday.
 *
 * Deliberately NOT `RecurrenceWeekday`'s 0-based Monday-first index. The two
 * modules share no schedule vocabulary by design (see the file header), and a
 * number that looked interchangeable while counting differently is precisely the
 * bug that decision exists to prevent — so the numbering is the ISO one a reader
 * can check against the standard rather than against another module's file.
 */
export const HABIT_MIN_WEEKDAY = 1;
export const HABIT_MAX_WEEKDAY = 7;

/** The most times a week a quota may ask for — seven, because an eighth day does not exist. */
export const HABIT_MAX_PER_WEEK = 7;

/**
 * When a habit is expected. Two kinds, and no third — see the file header.
 *
 * `days` — the listed ISO weekdays, sorted, unique and non-empty. Daily is all
 * seven, spelled out rather than given a `kind` of its own: „svaki dan" is
 * genuinely the seven-day case, and a third kind meaning it would be a second
 * way to say the same thing.
 *
 * `quota` — any `perWeek` days inside a week, whichever ones. The week's
 * boundaries are the DEVICE's first-day-of-week preference, which is why nothing
 * that computes over this type ever guesses them (see `computeHabitStreak`).
 */
export type HabitSchedule =
  | { kind: "days"; weekdays: number[] }
  | { kind: "quota"; perWeek: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Exactly these own keys, no more and no fewer — `recurrence.ts`'s rule: an unknown key means the value was not produced by this module. */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

/** The canonical `days` form: ascending, duplicate-free. The ONE definition of what sorted-and-unique means here, so the validator and the serializer cannot drift. */
function canonicalWeekdays(weekdays: readonly number[]): number[] {
  return [...new Set(weekdays)].sort((a, b) => a - b);
}

/**
 * Structural validation of an untrusted value into a CANONICAL schedule, or
 * null — `validateRecurrenceRule`'s contract, restated for this vocabulary, so
 * every caller that already knows one knows the other. Never returns any part of
 * the input: the `days` array is rebuilt sorted and deduplicated, which is what
 * makes „ponedeljak, ponedeljak, sreda" and „sreda, ponedeljak" the same stored
 * value rather than two rows that look different and mean the same thing.
 */
export function validateHabitSchedule(value: unknown): HabitSchedule | null {
  if (!isRecord(value)) return null;
  switch (value["kind"]) {
    case "days": {
      if (!hasExactKeys(value, ["kind", "weekdays"])) return null;
      const weekdays = value["weekdays"];
      if (!Array.isArray(weekdays) || weekdays.length === 0) return null;
      for (const day of weekdays as readonly unknown[]) {
        if (
          typeof day !== "number" ||
          !Number.isInteger(day) ||
          day < HABIT_MIN_WEEKDAY ||
          day > HABIT_MAX_WEEKDAY
        ) {
          return null;
        }
      }
      return { kind: "days", weekdays: canonicalWeekdays(weekdays as readonly number[]) };
    }
    case "quota": {
      if (!hasExactKeys(value, ["kind", "perWeek"])) return null;
      const perWeek = value["perWeek"];
      if (
        typeof perWeek !== "number" ||
        !Number.isInteger(perWeek) ||
        perWeek < 1 ||
        perWeek > HABIT_MAX_PER_WEEK
      ) {
        return null;
      }
      return { kind: "quota", perWeek };
    }
    default:
      return null;
  }
}

/**
 * The stored/interchange text of a schedule, in fixed member order — the single
 * authority on what „canonical" means for this type, exactly as
 * `serializeRecurrenceRule` is for a rule. `validateHabitSchedule` produces the
 * same shape, so a value that came back from the validator and one that came
 * back from this function are byte-identical.
 */
export function serializeHabitSchedule(schedule: HabitSchedule): string {
  return JSON.stringify(
    schedule.kind === "days"
      ? { kind: "days", weekdays: canonicalWeekdays(schedule.weekdays) }
      : { kind: "quota", perWeek: schedule.perWeek },
  );
}
