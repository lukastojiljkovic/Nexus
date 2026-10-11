/**
 * The HABIT module: what today asks for, and ticking one off.
 *
 * **„Done" is `@nexus/core`'s rule, not one of ours.** Whether a tick counts is
 * `countsAsDone(target, value)` — the single definition the renderer's today
 * list, its history grid and the reminder filter all read, and calling it here
 * is what keeps the assistant from inventing a fourth opinion about a measured
 * habit.
 *
 * **„Is it expected today" is restated, and this is the one place that happens.**
 * The renderer's `habitDone.ts` answers it in `habitsExpectedToday`, and main
 * cannot import the renderer — the same wall that moved `countsAsDone` into
 * `@nexus/core` when the reminder filter needed it. The rule is three lines
 * (a `days` habit expects its own weekdays; a `quota` one expects every day),
 * it is exercised by this folder's tests, and the honest long-term fix is for
 * the pair to move to core together rather than for one of them to live here.
 *
 * **No streaks, and the reason is a dependency rather than a choice.** A quota
 * habit's streak is counted in WEEKS, and which day a week opens on is a device
 * preference the renderer owns; main has no idea what it is (this is exactly why
 * `computeHabitStreak` takes `weekStart` as a parameter). A streak figure the
 * assistant made up from a guessed week start would be wrong twice a week, so
 * this tool answers with the day's ticks and leaves the streaks to the page.
 */

import { HabitStore, MAX_HABIT_COUNT } from "@nexus/db";
import type { Habit } from "@nexus/db";
import { countsAsDone } from "@nexus/core";
import { MAX_ID_LENGTH } from "@nexus/core";
import type { AssistantLocale, Tool } from "@nexus/core";
import { asArgs, asDay, asIdentifier, asOptionalCount } from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  formatDay,
  formatDayInSentence,
  guard,
  localDay,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface HabitToolDeps {
  readonly profileDb: ProfileDb;
  readonly now: () => number;
}

const TODAY_HEADING: AssistantPhrase<[done: number, total: number]> = {
  sr: (done, total) => `Navike za danas: ${done} od ${total} završeno.`,
  en: (done, total) => `Habits for today: ${done} of ${total} done.`,
};

const NO_HABITS: { sr: string; en: string } = {
  sr: "Ovaj profil nema nijednu aktivnu naviku.",
  en: "This profile has no active habits.",
};

const NOT_SCHEDULED_TODAY: { sr: string; en: string } = {
  sr: "nije danas na rasporedu",
  en: "not scheduled today",
};

const HABIT_NOT_FOUND: AssistantPhrase<[id: string]> = {
  sr: (id) => `Nepoznata navika „${id}“ u ovom profilu.`,
  en: (id) => `No habit with the id “${id}” in this profile.`,
};

const FUTURE_DAY: AssistantPhrase<[day: string]> = {
  sr: (day) => `Dan ${day} je u budućnosti — navika se ne može zabeležiti unapred.`,
  en: (day) => `${day} is in the future — a habit cannot be recorded ahead of time.`,
};

const BEFORE_HABIT: AssistantPhrase<[day: string]> = {
  sr: (day) => `Dan ${day} je pre nego što je navika napravljena.`,
  en: (day) => `${day} is before the habit was created.`,
};

const CHECKIN_SUMMARY: AssistantPhrase<[name: string, day: string, value: number]> = {
  sr: (name, day, value) =>
    value === 1
      ? `Zabeleži naviku „${name}“ za ${day}`
      : `Zabeleži naviku „${name}“ za ${day} — ${value}`,
  en: (name, day, value) =>
    value === 1
      ? `Check in on the habit “${name}” for ${day}`
      : `Check in on the habit “${name}” for ${day} — ${value}`,
};

/** What a check-in answers with: the habit, the day, and — for a counted one — how far into its target the day now is. */
const RECORDED: AssistantPhrase<[name: string, day: string, reading: string]> = {
  sr: (name, day, reading) => `Zabeležena navika „${name}“ za ${day}${reading}.`,
  en: (name, day, reading) => `Recorded “${name}” for ${day}${reading}.`,
};

export function habitTools(deps: HabitToolDeps): readonly Tool[] {
  function habitStore(profileId: string): HabitStore {
    return deps.profileDb(profileId, (db, id) => new HabitStore(db, id));
  }

  const today: Tool = {
    name: "habits.today",
    description: {
      sr: "Prikazuje današnje stanje navika: koje su završene, koje još nisu i koje danas nisu na rasporedu. Koristi ga kada korisnik pita kako stoji sa navikama ili šta mu je ostalo za danas.",
      en: "Shows today's habit state: which are done, which are not, and which are not scheduled for today. Use it when the user asks how their habits are going or what is left today.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const store = habitStore(context.profileId);
        const active = store.listActive();
        if (active.length === 0) {
          return okResult(text(context.locale, NO_HABITS));
        }
        const day = localDay(deps.now());
        const values = new Map<string, number>();
        for (const entry of store.listAllEntries({ from: day, to: day })) {
          values.set(entry.habitId, entry.value);
        }
        const rows = active.map((habit) =>
          habitRow(context.locale, habit, values.get(habit.id) ?? 0, day),
        );
        const done = active.filter((habit) =>
          countsAsDone(habit.target, values.get(habit.id) ?? 0),
        ).length;
        return okResult(
          [phrase(context.locale, TODAY_HEADING, done, active.length), ...rows].join("\n"),
        );
      }),
  };

  const checkin: Tool = {
    name: "habits.checkin",
    description: {
      sr: "Beleži naviku za danas (ili za neki dan koji nije prošao). Za naviku koja se meri pošalji i `value`. Koristi ga kada korisnik kaže da je nešto uradio, npr. „popio sam vodu“.",
      en: "Records a habit for today (or for a past day). Send `value` for a habit that is counted. Use it when the user says they did something, e.g. \"I drank the water\".",
    },
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "The habit id, as habits.today reports it.",
        },
        value: {
          type: "integer",
          minimum: 1,
          maximum: MAX_HABIT_COUNT,
          description: "Whole units done that day; 1 for a habit that is simply done. Defaults to 1.",
        },
        day: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "The day to record, as YYYY-MM-DD. Defaults to today; the future is refused.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const id = asIdentifier(args.id, "id");
        const value = asOptionalCount(args.value, "value", 1, MAX_HABIT_COUNT) ?? 1;
        const store = habitStore(context.profileId);
        const habit = store.listActive().find((row) => row.id === id);
        if (habit === undefined) throw new Error(phrase(context.locale, HABIT_NOT_FOUND, id));

        const todayDay = localDay(deps.now());
        const day = args.day === undefined ? todayDay : asDay(args.day, "day");
        // Both bounds the IPC channel applies (`asHabitEntryDay` and
        // `assertHabitExisted`): the future is not a fact about a habit, and a
        // habit has no history before it existed.
        if (day > todayDay) throw new Error(phrase(context.locale, FUTURE_DAY, day));
        if (day < habit.createdAt.slice(0, 10)) {
          throw new Error(phrase(context.locale, BEFORE_HABIT, day));
        }

        const declined = await confirmOrDecline(
          context,
          "habits.checkin",
          "write",
          phrase(context.locale, CHECKIN_SUMMARY, habit.name, formatDay(context.locale, day), value),
        );
        if (declined !== null) return declined;

        const entry = store.setEntry(id, day, value, new Date(deps.now()).toISOString());
        const reading =
          habit.target === null
            ? ""
            : ` ${entry.value}/${habit.target}${habit.unit === null ? "" : ` ${habit.unit}`}`;
        return okResult(
          phrase(
            context.locale,
            RECORDED,
            habit.name,
            formatDayInSentence(context.locale, day),
            reading,
          ),
        );
      }),
  };

  return [today, checkin];
}

/**
 * One habit's line: the tick, its name, and — for a counted one — how far into
 * its target the day is. A habit the schedule does not ask for today says so
 * instead of reading as a miss, which is the same distinction the page's own
 * history grid draws.
 */
function habitRow(locale: AssistantLocale, habit: Habit, value: number, day: string): string {
  const done = countsAsDone(habit.target, value);
  const parts: string[] = [];
  if (habit.target !== null) {
    parts.push(`${value}/${habit.target}${habit.unit === null ? "" : ` ${habit.unit}`}`);
  } else if (!done && !expectsDay(habit, day)) {
    parts.push(text(locale, NOT_SCHEDULED_TODAY));
  }
  const tail = parts.length === 0 ? "" : ` (${parts.join(", ")})`;
  return `- [${done ? "x" : " "}] ${habit.id} ${habit.name}${tail}`;
}

/**
 * Whether a habit's schedule asks for this particular day.
 *
 * A `quota` habit is expected EVERY day — any day counts towards the week — and
 * a `days` one only on its own ISO weekdays (1 = Monday … 7 = Sunday, which is
 * `HabitSchedule`'s numbering, not `RecurrenceWeekday`'s 0-based one). A
 * soft-deleted habit never reaches this function: `listActive` has already
 * dropped it.
 */
function expectsDay(habit: Habit, day: string): boolean {
  if (habit.schedule.kind === "quota") return true;
  return habit.schedule.weekdays.includes(isoWeekday(day));
}

/** ISO weekday of a bare day: 1 = Monday … 7 = Sunday, at UTC midnight so a bare date never shifts. */
function isoWeekday(day: string): number {
  const at = Date.UTC(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
  );
  return ((new Date(at).getUTCDay() + 6) % 7) + 1;
}
