/**
 * The HABIT module: what today asks for, ticking one off, keeping the list
 * (create, edit, archive, delete) and reading the history over a window.
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
 * **Archived habits leave today, and nothing else.** `HabitStore.listActive`
 * returns archived habits too, because the stats want them; today's list is the
 * one caller that drops them, and the history still counts them.
 *
 * **No streaks, and the reason is a dependency rather than a choice.** A quota
 * habit's streak is counted in WEEKS, and which day a week opens on is a device
 * preference the renderer owns; main has no idea what it is (this is exactly why
 * `computeHabitStreak` takes `weekStart` as a parameter). A streak figure the
 * assistant made up from a guessed week start would be wrong twice a week, so
 * the history answers with the day's ticks and leaves the streaks to the page.
 *
 * **Restore and unarchive are the page's.** A deleted habit is not in `listActive`
 * at all, so there is no name the assistant could be given for it; an archived
 * one is listed, and un-archiving it is one click on the page.
 */

import { HabitStore, MAX_HABIT_COUNT, MAX_HABIT_NAME_LENGTH, MAX_HABIT_UNIT_LENGTH } from "@nexus/db";
import type { Habit, UpdateHabitFields } from "@nexus/db";
import {
  HABIT_MAX_PER_WEEK,
  HABIT_MAX_WEEKDAY,
  HABIT_MIN_WEEKDAY,
  countsAsDone,
  foldSearchText,
  type AssistantLocale,
  type HabitSchedule,
  type Tool,
} from "@nexus/core";
import { MAX_ID_LENGTH } from "@nexus/core";
import { asArgs, asCount, asDay, asEnum, asOptionalCount, asText } from "./args.js";
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

/** The longest window a history answer covers: a year, which keeps the answer short enough to read. */
const MAX_HISTORY_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

const SCHEDULE_KINDS = ["days", "quota"] as const;
const UPDATABLE_FIELDS: Record<"name" | "schedule" | "target" | "unit" | "reminderTime", { sr: string; en: string }> = {
  name: { sr: "naziv", en: "name" },
  schedule: { sr: "raspored", en: "schedule" },
  target: { sr: "cilj", en: "target" },
  unit: { sr: "jedinica", en: "unit" },
  reminderTime: { sr: "podsetnik", en: "reminder" },
};

/** Serbian and English weekday names, indexed by ISO weekday (1 = Monday). */
const WEEKDAY_NAMES: Record<"sr" | "en", readonly string[]> = {
  sr: ["", "pon", "uto", "sre", "čet", "pet", "sub", "ned"],
  en: ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};

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

const HABIT_LOOKUP = {
  missing: {
    sr: (name: string, known: string): string =>
      `Nema navike „${name}“. Navike u ovom profilu: ${known}.`,
    en: (name: string, known: string): string =>
      `No habit named “${name}”. This profile's habits: ${known}.`,
  },
  ambiguous: {
    sr: (name: string, candidates: string): string =>
      `Ima više navika zvanih „${name}“: ${candidates}. Navedi id.`,
    en: (name: string, candidates: string): string =>
      `More than one habit is called “${name}”: ${candidates}. Name it by its id.`,
  },
} satisfies Record<string, AssistantPhrase<[name: string, other: string]>>;

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

const SCHEDULE_TEXT: {
  readonly days: AssistantPhrase<[days: string]>;
  readonly quota: AssistantPhrase<[perWeek: number]>;
} = {
  days: {
    sr: (days) => `na dane: ${days}`,
    en: (days) => `on ${days}`,
  },
  quota: {
    sr: (perWeek) => `${perWeek} puta nedeljno`,
    en: (perWeek) => `${perWeek} times a week`,
  },
};

const CREATE_SUMMARY: AssistantPhrase<[name: string, schedule: string]> = {
  sr: (name, schedule) => `Dodaj naviku „${name}“, ${schedule}`,
  en: (name, schedule) => `Add the habit “${name}”, ${schedule}`,
};

const CREATED: AssistantPhrase<[name: string, id: string]> = {
  sr: (name, id) => `Napravljena navika „${name}“ (${id}).`,
  en: (name, id) => `Created the habit “${name}” (${id}).`,
};

const UPDATE_SUMMARY: AssistantPhrase<[name: string, fields: string]> = {
  sr: (name, fields) => `Izmeni naviku „${name}“: ${fields}`,
  en: (name, fields) => `Change the habit “${name}”: ${fields}`,
};

const UPDATED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Izmenjena navika „${name}“.`,
  en: (name) => `Updated the habit “${name}”.`,
};

const ARCHIVE_SUMMARY: AssistantPhrase<[name: string]> = {
  sr: (name) => `Arhiviraj naviku „${name}“ (istorija ostaje)`,
  en: (name) => `Archive the habit “${name}” (its history is kept)`,
};

const ARCHIVED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Arhivirana navika „${name}“.`,
  en: (name) => `Archived the habit “${name}”.`,
};

const DELETE_SUMMARY: AssistantPhrase<[name: string]> = {
  sr: (name) => `Obriši naviku „${name}“ sa svim zabeleženim danima`,
  en: (name) => `Delete the habit “${name}” with all its recorded days`,
};

const DELETED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Obrisana navika „${name}“.`,
  en: (name) => `Deleted the habit “${name}”.`,
};

const HISTORY_HEADING: AssistantPhrase<[from: string, to: string]> = {
  sr: (from, to) => `Navike od ${from} do ${to}:`,
  en: (from, to) => `Habits from ${from} to ${to}:`,
};

const HISTORY_SCHEDULED: AssistantPhrase<[name: string, done: number, expected: number]> = {
  sr: (name, done, expected) => `- ${name}: ${done} od ${expected} zakazanih dana`,
  en: (name, done, expected) => `- ${name}: ${done} of ${expected} scheduled days`,
};

const HISTORY_QUOTA: AssistantPhrase<[name: string, done: number]> = {
  sr: (name, done) => `- ${name}: dana završeno: ${done}`,
  en: (name, done) => `- ${name}: days done: ${done}`,
};

const HISTORY_DAY: AssistantPhrase<[day: string, reading: string]> = {
  sr: (day, reading) => `  ${day}: ${reading}`,
  en: (day, reading) => `  ${day}: ${reading}`,
};

const DONE_DAY: { sr: string; en: string } = {
  sr: "završeno",
  en: "done",
};

const HISTORY_NONE: { sr: string; en: string } = {
  sr: "Nema zabeleženih dana u ovom periodu.",
  en: "Nothing is recorded in this window.",
};

const HISTORY_NOTE: { sr: string; en: string } = {
  sr: "Nizovi se vide na stranici navika, jer ona zna kojim danom počinje nedelja.",
  en: "Streaks are on the habits page, which knows which day your week starts on.",
};

const HISTORY_TOO_LONG: { sr: string; en: string } = {
  sr: `Period može imati najviše ${MAX_HISTORY_DAYS} dana.`,
  en: `A history window may cover at most ${MAX_HISTORY_DAYS} days.`,
};

const HISTORY_BEFORE: AssistantPhrase<[name: string, day: string]> = {
  sr: (name, day) => `Navika „${name}“ je napravljena ${day}, posle kraja ovog perioda.`,
  en: (name, day) => `“${name}” was created on ${day}, after this window.`,
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
        const active = currentHabits(store);
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
        habit: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "The habit's name as the user said it, or its id.",
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
      required: ["habit"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const store = habitStore(context.profileId);
        const habit = resolveHabit(currentHabits(store), asText(args.habit, "habit", MAX_ID_LENGTH), context.locale);
        const value = asOptionalCount(args.value, "value", 1, MAX_HABIT_COUNT) ?? 1;

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

        const entry = store.setEntry(habit.id, day, value, new Date(deps.now()).toISOString());
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

  const create: Tool = {
    name: "habits.create",
    description: {
      sr: "Pravi novu naviku. Raspored je „days“ (na određene dane, `days` kao ISO dane: 1 = ponedeljak, 7 = nedelja) ili „quota“ (koliko puta nedeljno, `perWeek`), ne oba. Koristi ga kada korisnik kaže „prati da pijem 8 čaša vode dnevno“ ili „teretana ponedeljkom i sredom“.",
      en: "Creates a new habit. The schedule is \"days\" (on set weekdays, given in `days` as ISO numbers: 1 = Monday, 7 = Sunday) or \"quota\" (a number of times a week, `perWeek`), never both. Use it when the user says \"track eight glasses of water a day\" or \"gym on Mondays and Wednesdays\".",
    },
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: MAX_HABIT_NAME_LENGTH,
          description: "The habit's name, as the user will read it.",
        },
        schedule: {
          type: "string",
          enum: [...SCHEDULE_KINDS],
          description: "days (on set weekdays) or quota (a number of times a week).",
        },
        days: {
          type: "array",
          items: { type: "integer", minimum: HABIT_MIN_WEEKDAY, maximum: HABIT_MAX_WEEKDAY },
          minItems: 1,
          maxItems: 7,
          description: "For schedule days: ISO weekdays, 1 = Monday to 7 = Sunday.",
        },
        perWeek: {
          type: "integer",
          minimum: 1,
          maximum: HABIT_MAX_PER_WEEK,
          description: "For schedule quota: how many days a week, 1 to 7.",
        },
        target: {
          type: "integer",
          minimum: 1,
          maximum: MAX_HABIT_COUNT,
          description: "For a counted habit: how many units a day count as done (8 glasses is 8).",
        },
        unit: {
          type: "string",
          minLength: 1,
          maxLength: MAX_HABIT_UNIT_LENGTH,
          description: "What the target counts, e.g. glasses. Only with a target.",
        },
        reminderTime: {
          type: "string",
          pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
          description: "The time to remind at, as HH:MM (24-hour).",
        },
      },
      required: ["name", "schedule"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const name = asText(args.name, "name", MAX_HABIT_NAME_LENGTH);
        const kind = asEnum(args.schedule, "schedule", SCHEDULE_KINDS);
        const schedule = scheduleFrom(args, kind);
        if (schedule === undefined) throw new Error('"schedule" needs "days" or "perWeek".');
        const target = asOptionalCount(args.target, "target", 1, MAX_HABIT_COUNT);
        const unit = args.unit === undefined ? undefined : asText(args.unit, "unit", MAX_HABIT_UNIT_LENGTH);
        const reminderTime = args.reminderTime === undefined ? undefined : asText(args.reminderTime, "reminderTime", 5);

        const declined = await confirmOrDecline(
          context,
          "habits.create",
          "write",
          phrase(context.locale, CREATE_SUMMARY, name, scheduleText(context.locale, schedule)),
        );
        if (declined !== null) return declined;

        const habit = habitStore(context.profileId).create(
          { name, schedule, target: target ?? null, unit: unit ?? null, reminderTime: reminderTime ?? null },
          new Date(deps.now()).toISOString(),
        );
        return okResult(phrase(context.locale, CREATED, habit.name, habit.id), {
          navigateTo: { module: "habits" },
        });
      }),
  };

  const update: Tool = {
    name: "habits.update",
    description: {
      sr: "Menja naziv, raspored, cilj, jedinicu ili vreme podsetnika postojeće navike. Navedi samo ono što se menja. Koristi ga kada korisnik kaže „premesti teretanu na utorak“ ili „podigni cilj na 10 čaša“.",
      en: "Changes the name, schedule, target, unit or reminder time of an existing habit. Send only what changes. Use it when the user says \"move gym to Tuesday\" or \"raise the water goal to ten glasses\".",
    },
    parameters: {
      type: "object",
      properties: {
        habit: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "The habit's current name as the user said it, or its id.",
        },
        name: { type: "string", minLength: 1, maxLength: MAX_HABIT_NAME_LENGTH, description: "A new name." },
        schedule: { type: "string", enum: [...SCHEDULE_KINDS], description: "days or quota, when the schedule changes." },
        days: {
          type: "array",
          items: { type: "integer", minimum: HABIT_MIN_WEEKDAY, maximum: HABIT_MAX_WEEKDAY },
          minItems: 1,
          maxItems: 7,
          description: "The new ISO weekdays (1 = Monday to 7 = Sunday).",
        },
        perWeek: { type: "integer", minimum: 1, maximum: HABIT_MAX_PER_WEEK, description: "The new times a week." },
        target: { type: "integer", minimum: 1, maximum: MAX_HABIT_COUNT, description: "A new target." },
        unit: { type: "string", minLength: 1, maxLength: MAX_HABIT_UNIT_LENGTH, description: "A new unit." },
        reminderTime: {
          type: "string",
          pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
          description: "A new reminder time, as HH:MM.",
        },
      },
      required: ["habit"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const store = habitStore(context.profileId);
        const habit = resolveHabit(store.listActive(), asText(args.habit, "habit", MAX_ID_LENGTH), context.locale);

        // A patch carries only the keys the model sent: the store reads a present
        // key as "change it", so an absent one must not be there at all.
        const fields: UpdateHabitFields = {};
        if (args.name !== undefined) fields.name = asText(args.name, "name", MAX_HABIT_NAME_LENGTH);
        const kind = args.schedule === undefined ? undefined : asEnum(args.schedule, "schedule", SCHEDULE_KINDS);
        const schedule = scheduleFrom(args, kind);
        if (schedule !== undefined) fields.schedule = schedule;
        const target = asOptionalCount(args.target, "target", 1, MAX_HABIT_COUNT);
        if (target !== undefined) fields.target = target;
        if (args.unit !== undefined) fields.unit = asText(args.unit, "unit", MAX_HABIT_UNIT_LENGTH);
        if (args.reminderTime !== undefined) fields.reminderTime = asText(args.reminderTime, "reminderTime", 5);
        const changed = Object.keys(fields) as (keyof typeof UPDATABLE_FIELDS)[];
        if (changed.length === 0) throw new Error("Nothing to change: name a field to update.");

        const fieldList = changed.map((field) => UPDATABLE_FIELDS[field][context.locale]).join(", ");
        const declined = await confirmOrDecline(
          context,
          "habits.update",
          "write",
          phrase(context.locale, UPDATE_SUMMARY, habit.name, fieldList),
        );
        if (declined !== null) return declined;

        const updated = store.update(habit.id, fields, new Date(deps.now()).toISOString());
        return okResult(phrase(context.locale, UPDATED, updated.name), {
          navigateTo: { module: "habits" },
        });
      }),
  };

  const archive: Tool = {
    name: "habits.archive",
    description: {
      sr: "Arhivira naviku koju je korisnik završio: ona nestaje sa današnje liste, a istorija ostaje. Koristi ga kada korisnik kaže da više ne prati naviku. Ne briše podatke.",
      en: "Archives a habit the user has finished with: it leaves today's list and its history is kept. Use it when the user says they no longer track a habit. It deletes nothing.",
    },
    parameters: {
      type: "object",
      properties: {
        habit: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "The habit's name as the user said it, or its id.",
        },
      },
      required: ["habit"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const store = habitStore(context.profileId);
        const habit = resolveHabit(store.listActive(), asText(asArgs(rawArgs).habit, "habit", MAX_ID_LENGTH), context.locale);

        const declined = await confirmOrDecline(
          context,
          "habits.archive",
          "write",
          phrase(context.locale, ARCHIVE_SUMMARY, habit.name),
        );
        if (declined !== null) return declined;

        store.archive(habit.id, new Date(deps.now()).toISOString());
        return okResult(phrase(context.locale, ARCHIVED, habit.name), {
          navigateTo: { module: "habits" },
        });
      }),
  };

  const remove: Tool = {
    name: "habits.delete",
    description: {
      sr: "Briše naviku sa svim zabeleženim danima. Koristi ga samo kada korisnik izričito kaže da briše naviku; za „gotov sam s tim“ koristi habits.archive.",
      en: "Deletes a habit together with its recorded days. Use it only when the user explicitly says to delete the habit; for \"I am done with this\" use habits.archive.",
    },
    parameters: {
      type: "object",
      properties: {
        habit: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "The habit's name as the user said it, or its id.",
        },
      },
      required: ["habit"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const store = habitStore(context.profileId);
        const habit = resolveHabit(store.listActive(), asText(asArgs(rawArgs).habit, "habit", MAX_ID_LENGTH), context.locale);

        const declined = await confirmOrDecline(
          context,
          "habits.delete",
          "write",
          phrase(context.locale, DELETE_SUMMARY, habit.name),
        );
        if (declined !== null) return declined;

        store.softDelete(habit.id, new Date(deps.now()).toISOString());
        return okResult(phrase(context.locale, DELETED, habit.name), {
          navigateTo: { module: "habits" },
        });
      }),
  };

  const history: Tool = {
    name: "habits.history",
    description: {
      sr: "Prikazuje zabeležene dane navika u periodu: koliko je dana završeno od zakazanih, i za jednu naviku dan po dan. Koristi ga kada korisnik pita kako mu ide sa navikom ili šta je radio u nekom periodu.",
      en: "Shows the recorded days of the habits over a period: how many scheduled days were done, and for one habit, day by day. Use it when the user asks how a habit has been going or what they did over a period.",
    },
    parameters: {
      type: "object",
      properties: {
        habit: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "One habit's name or id. Leave out for all habits.",
        },
        from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "The first day, YYYY-MM-DD." },
        to: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "The last day, YYYY-MM-DD. Days after today are not counted.",
        },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const store = habitStore(context.profileId);
        const from = asDay(args.from, "from");
        const to = asDay(args.to, "to");
        if (from > to) throw new Error('"from" must be on or before "to".');
        if (dayCount(from, to) > MAX_HISTORY_DAYS) throw new Error(text(context.locale, HISTORY_TOO_LONG));

        const all = store.listActive();
        const named =
          args.habit === undefined ? undefined : resolveHabit(all, asText(args.habit, "habit", MAX_ID_LENGTH), context.locale);
        if (named !== undefined && named.createdAt.slice(0, 10) > to) {
          throw new Error(phrase(context.locale, HISTORY_BEFORE, named.name, formatDay(context.locale, named.createdAt.slice(0, 10))));
        }
        // Across every habit, one created after the window has nothing in it and is left out.
        const scope = named === undefined ? all.filter((habit) => habit.createdAt.slice(0, 10) <= to) : [named];
        const today = localDay(deps.now());
        const entries = store.listAllEntries({ from, to });
        const lines: string[] = [phrase(context.locale, HISTORY_HEADING, formatDay(context.locale, from), formatDay(context.locale, to))];

        for (const habit of scope) {
          const createdDay = habit.createdAt.slice(0, 10);
          const start = createdDay > from ? createdDay : from;
          const end = to > today ? today : to;
          const days = start > end ? [] : dayRange(start, end);
          const mine = entries.filter((entry) => entry.habitId === habit.id);
          const done = mine.filter((entry) => countsAsDone(habit.target, entry.value));
          if (habit.schedule.kind === "quota") {
            lines.push(phrase(context.locale, HISTORY_QUOTA, habit.name, done.length));
          } else {
            const expected = days.filter((day) => expectsDay(habit, day)).length;
            const doneExpected = done.filter((entry) => expectsDay(habit, entry.date)).length;
            lines.push(phrase(context.locale, HISTORY_SCHEDULED, habit.name, doneExpected, expected));
          }
          if (args.habit !== undefined) {
            if (mine.length === 0) {
              lines.push(text(context.locale, HISTORY_NONE));
            }
            for (const entry of mine.sort((left, right) => left.date.localeCompare(right.date))) {
              lines.push(phrase(context.locale, HISTORY_DAY, formatDay(context.locale, entry.date), dayReading(context.locale, habit, entry.value)));
            }
          }
        }
        lines.push(text(context.locale, HISTORY_NOTE));
        return okResult(lines.join("\n"));
      }),
  };

  return [today, checkin, create, update, archive, remove, history];
}

/** The habits the list and the check-in offer: every live habit that is not archived. */
function currentHabits(store: HabitStore): Habit[] {
  return store.listActive().filter((habit) => habit.archivedAt === null);
}

/**
 * The one habit a name or id refers to, or a refusal. An id wins; a name is
 * matched ignoring case and diacritics; an ambiguous name is refused with the
 * candidates, and a missing one with the names that exist.
 */
function resolveHabit(habits: readonly Habit[], wanted: string, locale: AssistantLocale): Habit {
  const byId = habits.find((habit) => habit.id === wanted);
  if (byId !== undefined) return byId;
  const needle = foldSearchText(wanted);
  const matches = habits.filter((habit) => foldSearchText(habit.name.trim()) === needle);
  if (matches.length > 1) {
    throw new Error(
      phrase(
        locale,
        HABIT_LOOKUP.ambiguous,
        wanted,
        matches.map((habit) => `${habit.name} (${habit.id})`).join(", "),
      ),
    );
  }
  const [found] = matches;
  if (found === undefined) {
    throw new Error(
      phrase(locale, HABIT_LOOKUP.missing, wanted, habits.map((habit) => habit.name).join(", ") || "-"),
    );
  }
  return found;
}

/**
 * The schedule the arguments describe, or `undefined` when they describe none.
 *
 * The kind is given, or read off whichever of `days` and `perWeek` is present.
 * Both at once is refused, and a kind without its own field is refused by name:
 * a quota habit with no `perWeek` is the store's refusal, given here in words the
 * model can act on.
 */
function scheduleFrom(args: Record<string, unknown>, kind: (typeof SCHEDULE_KINDS)[number] | undefined): HabitSchedule | undefined {
  const days = args.days === undefined ? undefined : asWeekdays(args.days);
  const perWeek = args.perWeek === undefined ? undefined : asCount(args.perWeek, "perWeek", 1, HABIT_MAX_PER_WEEK);
  if (days !== undefined && perWeek !== undefined) {
    throw new Error('Give "days" or "perWeek", not both.');
  }
  const chosen = kind ?? (days !== undefined ? "days" : perWeek !== undefined ? "quota" : undefined);
  if (chosen === undefined) return undefined;
  if (chosen === "days") {
    if (days === undefined) throw new Error('"days" is required for a habit on set days.');
    return { kind: "days", weekdays: days };
  }
  if (perWeek === undefined) throw new Error('"perWeek" is required for a quota habit.');
  return { kind: "quota", perWeek };
}

function asWeekdays(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 7) {
    throw new Error('"days" must list ISO weekdays, 1 (Monday) to 7 (Sunday).');
  }
  return value.map((day) => asCount(day, "days", HABIT_MIN_WEEKDAY, HABIT_MAX_WEEKDAY));
}

function scheduleText(locale: AssistantLocale, schedule: HabitSchedule): string {
  if (schedule.kind === "quota") return phrase(locale, SCHEDULE_TEXT.quota, schedule.perWeek);
  const names = [...schedule.weekdays].sort((a, b) => a - b).map((day) => WEEKDAY_NAMES[locale][day]).join(", ");
  return phrase(locale, SCHEDULE_TEXT.days, names);
}

/** What one day of a habit reads as in the history: its reading against the target, or simply that it was done. */
function dayReading(locale: AssistantLocale, habit: Habit, value: number): string {
  if (habit.target === null) return text(locale, DONE_DAY);
  return `${value}/${habit.target}${habit.unit === null ? "" : ` ${habit.unit}`}`;
}

/** The number of days a span covers, both ends included. */
function dayCount(from: string, to: string): number {
  return Math.round((utcOf(to) - utcOf(from)) / DAY_MS) + 1;
}

/** Every bare day from `from` to `to`, both ends included. */
function dayRange(from: string, to: string): string[] {
  const days: string[] = [];
  for (let at = utcOf(from); at <= utcOf(to); at += DAY_MS) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  return days;
}

function utcOf(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
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
  return ((new Date(utcOf(day)).getUTCDay() + 6) % 7) + 1;
}
