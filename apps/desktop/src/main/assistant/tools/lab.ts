/**
 * The LAB module: the sensor logs a device filled, and the off-grid budget.
 *
 * **The store is the app's own.** `LabStore` (migration 087) is what the page's
 * „CSV senzori" card and its „Van mreže — dnevni bilans" card call: `listLogs()`
 * answers each log's name, its columns and how many readings it holds without
 * loading one, `readSamples()` answers the newest readings in time order, and
 * `offGrid()` answers the saved budget. Nothing here writes: a reading is what a
 * device printed (main parses the device's own lines, `lab/main/register.ts`),
 * and an assistant that appended a number nobody measured would be putting a
 * reading into a chart under the user's own name.
 *
 * **The budget arithmetic is `@nexus/core`'s, restated nowhere.** `whPerDay`,
 * `usableWh` and `daysOfPower` are the three functions the page's own card
 * computes with, called here on the same stored inputs, so a tool answer and the
 * card cannot disagree about how long a battery lasts. The PANEL figure is the
 * one number this file does not answer: the page divides by a charge efficiency
 * it holds in the renderer (`BatteryCard.tsx`'s own constant), and a second copy
 * of that constant here would be two answers to one question.
 *
 * **A log's readings are the device's columns, so they are named.** A sample is
 * a bare list of numbers; printed without its log's column names it is a row
 * nobody can read.
 */

import { LabStore, type LabLog, type LabOffGrid, type LabSample } from "@nexus/db";
import {
  daysOfPower,
  foldSearchText,
  usableWh,
  whPerDay,
  type AssistantLocale,
  type Tool,
} from "@nexus/core";
import { asArgs, asOptionalCount, asOptionalText } from "./args.js";
import {
  assertLive,
  formatClock,
  formatDayInSentence,
  formatNumber,
  formatPercent,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface LabToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
}

/** How many readings one read answers with when the model names no cap, and the ceiling it may ask for. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
/** The longest log name the store keeps, so a model cannot ask for one it could not have made. */
const MAX_LOG_NAME_CHARS = 60;

/** The heading the page's log list carries, and the one its budget card carries. */
const LOGS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Dnevnici senzora (${count}):`,
  en: (count) => `Sensor logs (${count}):`,
};

const BUDGET_HEADING: { readonly sr: string; readonly en: string } = {
  sr: "Van mreže — dnevni bilans:",
  en: "Off grid — the daily budget:",
};

const LOGS_EMPTY: { readonly sr: string; readonly en: string } = {
  sr: "Još nema dnevnika senzora.",
  en: "No sensor log is kept yet.",
};

const BUDGET_EMPTY: { readonly sr: string; readonly en: string } = {
  sr: "Van mreže — dnevni bilans nije upisan.",
  en: "No off-grid daily budget is kept.",
};

const LOGS_MORE: AssistantPhrase<[count: number]> = {
  sr: (count) => `…i još ${count}.`,
  en: (count) => `…and ${count} more.`,
};

/** A label and a figure, the shape the page's own rows use — Serbian's three plural forms stay out of a line a model reads. */
const COLUMNS_WORD: AssistantPhrase<[columns: string]> = {
  sr: (columns) => `kolone: ${columns}`,
  en: (columns) => `columns: ${columns}`,
};

const READINGS_WORD: AssistantPhrase<[count: number]> = {
  sr: (count) => `očitavanja: ${count}`,
  en: (count) => `readings: ${count}`,
};

const NEWEST_WORD: AssistantPhrase<[when: string]> = {
  sr: (when) => `poslednje: ${when}`,
  en: (when) => `newest: ${when}`,
};

const DEVICES_WORD: AssistantPhrase<[count: number]> = {
  sr: (count) => `uređaja: ${count}`,
  en: (count) => `devices: ${count}`,
};

const PER_DAY_WORD: AssistantPhrase<[wattHours: string]> = {
  sr: (wattHours) => `potrošnja dnevno: ${wattHours} Wh`,
  en: (wattHours) => `consumption a day: ${wattHours} Wh`,
};

const BATTERY_WORD: AssistantPhrase<[wattHours: string, depth: string]> = {
  sr: (wattHours, depth) => `baterija: ${wattHours} Wh, dubina pražnjenja ${depth}`,
  en: (wattHours, depth) => `battery: ${wattHours} Wh, depth of discharge ${depth}`,
};

/**
 * „traje: 1 dan" / „traje: 2 dana" — the unit is passed in, because Serbian has
 * three plural forms and a fixed `dana` would read „1 dana" on the one figure
 * somebody always happens to hit.
 */
const LASTS_WORD: AssistantPhrase<[days: string, unit: string]> = {
  sr: (days, unit) => `traje: ${days} ${unit}`,
  en: (days, unit) => `lasts: ${days} ${unit}`,
};

const DAY_ONE: { readonly sr: string; readonly en: string } = { sr: "dan", en: "day" };
const DAY_MANY: { readonly sr: string; readonly en: string } = { sr: "dana", en: "days" };

const NO_CONSUMPTION: { readonly sr: string; readonly en: string } = {
  sr: "potrošnja je nula, pa se trajanje ne računa",
  en: "the consumption is zero, so how long it lasts is not computed",
};

const READINGS_HEADING: AssistantPhrase<[name: string, count: number]> = {
  sr: (name, count) => `${name} — poslednja očitavanja (${count}):`,
  en: (name, count) => `${name} — the newest readings (${count}):`,
};

const READINGS_EMPTY: AssistantPhrase<[name: string]> = {
  sr: (name) => `Dnevnik „${name}“ još nema očitavanja.`,
  en: (name) => `The log “${name}” has no readings yet.`,
};

const READINGS_MORE: AssistantPhrase<[count: number]> = {
  // „pre ovih" rather than „starijih očitavanja": a phrase with no noun after the
  // number is the one Serbian spelling that is right for every count.
  sr: (count) => `…i još ${count} pre ovih.`,
  en: (count) => `…and ${count} more before these.`,
};

const NO_LOGS_TO_READ: { readonly sr: string; readonly en: string } = {
  sr: "Nijedan dnevnik ne postoji; prvo se napravi dnevnik u Laboratoriji.",
  en: "There is no log at all; a log is made in the Lab first.",
};

const UNKNOWN_LOG: AssistantPhrase<[name: string, known: string]> = {
  sr: (name, known) => `Nema dnevnika „${name}“. Dnevnici: ${known}.`,
  en: (name, known) => `No log “${name}”. The logs: ${known}.`,
};

const NEEDS_LOG: AssistantPhrase<[known: string]> = {
  sr: (known) => `Postoji više dnevnika, pa navedi koji. Dnevnici: ${known}.`,
  en: (known) => `More than one log exists, so name one. The logs: ${known}.`,
};

export function labTools(deps: LabToolDeps): readonly Tool[] {
  const logs: Tool = {
    name: "lab.logs",
    description: {
      sr: "Izlistava dnevnike senzora iz Laboratorije — naziv, kolone i koliko očitavanja ima — i dnevni bilans van mreže: uređaje, potrošnju i koliko traje baterija. Koristi ga kada korisnik pita šta je izmerio, šta mu je u dnevniku ili koliko mu baterija traje.",
      en: "Lists the Lab's sensor logs — name, columns and how many readings each holds — and the off-grid daily budget: the devices, the consumption and how long the battery lasts. Use it when the user asks what they measured, what is in their log, or how long their battery lasts.",
    },
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `How many logs to list. Defaults to ${String(DEFAULT_LIMIT)}.`,
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
        const read = deps.profileDb(context.profileId, (db, id) => {
          const store = new LabStore(db, id);
          return { logs: store.listLogs(), offGrid: store.offGrid() };
        });

        const lines: string[] = [];
        if (read.logs.length === 0) {
          lines.push(text(context.locale, LOGS_EMPTY));
        } else {
          const shown = read.logs.slice(0, limit);
          lines.push(phrase(context.locale, LOGS_HEADING, read.logs.length));
          lines.push(...shown.map((log) => logLine(context.locale, log)));
          if (read.logs.length > shown.length) {
            lines.push(phrase(context.locale, LOGS_MORE, read.logs.length - shown.length));
          }
        }

        lines.push(text(context.locale, BUDGET_HEADING));
        lines.push(
          ...(read.offGrid === null
            ? [text(context.locale, BUDGET_EMPTY)]
            : budgetLines(context.locale, read.offGrid)),
        );
        return okResult(lines.join("\n"));
      }),
  };

  const readings: Tool = {
    name: "lab.readings",
    description: {
      sr: "Čita poslednja očitavanja jednog dnevnika senzora iz Laboratorije, po kolonama. Koristi ga kada korisnik pita šta je uređaj poslednje izmerio ili kakve su vrednosti u dnevniku.",
      en: "Reads the newest readings of one Lab sensor log, column by column. Use it when the user asks what the device measured last or what the values in a log are.",
    },
    parameters: {
      type: "object",
      properties: {
        log: {
          type: "string",
          minLength: 1,
          maxLength: MAX_LOG_NAME_CHARS,
          description: "The log's name, as the Lab lists it. Left out, the only log that exists is read.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `How many of the newest readings to list. Defaults to ${String(DEFAULT_LIMIT)}.`,
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const wanted = asOptionalText(args.log, "log", MAX_LOG_NAME_CHARS);
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
        const read = deps.profileDb(context.profileId, (db, id) => {
          const store = new LabStore(db, id);
          const all = store.listLogs();
          const log =
            wanted === undefined ? onlyLog(all, context.locale) : resolveLog(all, wanted, context.locale);
          // The store answers the newest `limit` rows, oldest first within them,
          // which is the order the page's own list draws.
          return { log, samples: store.readSamples(log.id, limit) };
        });

        if (read.samples.length === 0) {
          return okResult(phrase(context.locale, READINGS_EMPTY, read.log.name));
        }
        const lines = [
          phrase(context.locale, READINGS_HEADING, read.log.name, read.samples.length),
          ...read.samples.map((sample) => sampleLine(context.locale, read.log, sample)),
        ];
        const older = read.log.sampleCount - read.samples.length;
        if (older > 0) lines.push(phrase(context.locale, READINGS_MORE, older));
        return okResult(lines.join("\n"));
      }),
  };

  return [logs, readings];
}

/** One log as a line: what it is called, the columns its readings carry, how many there are and when the newest arrived. */
function logLine(locale: AssistantLocale, log: LabLog): string {
  const parts = [phrase(locale, COLUMNS_WORD, log.columns.join(", "))];
  parts.push(phrase(locale, READINGS_WORD, log.sampleCount));
  if (log.lastAt !== null) parts.push(phrase(locale, NEWEST_WORD, instantText(locale, log.lastAt)));
  return `- ${log.name} (${parts.join(", ")})`;
}

/**
 * The saved budget as the card states it: how many devices, what they draw a
 * day, the pack and the depth of discharge it is used to, and the days that
 * follow. See the file header for why the panel figure is not here.
 */
function budgetLines(locale: AssistantLocale, budget: LabOffGrid): readonly string[] {
  const daily = whPerDay(budget.devices);
  const usable = usableWh(budget.batteryWh, budget.depthOfDischarge);
  return [
    `- ${phrase(locale, DEVICES_WORD, budget.devices.length)}`,
    `- ${phrase(locale, PER_DAY_WORD, formatNumber(locale, daily))}`,
    `- ${phrase(
      locale,
      BATTERY_WORD,
      formatNumber(locale, budget.batteryWh),
      formatPercent(locale, budget.depthOfDischarge),
    )}`,
    `- ${lastsText(locale, usable, daily)}`,
  ];
}

/** How long the usable capacity lasts, or the sentence that says the question has no answer at zero consumption. */
function lastsText(locale: AssistantLocale, usable: number, daily: number): string {
  const days = daysOfPower(usable, daily);
  if (days === null) return text(locale, NO_CONSUMPTION);
  // One decimal, which is the precision a worksheet shows; the unit word follows
  // the ROUNDED figure, so 0,96 days is „1 dan" rather than „1 dana".
  const shown = Math.round(days * 10) / 10;
  return phrase(
    locale,
    LASTS_WORD,
    formatNumber(locale, shown),
    text(locale, shown === 1 ? DAY_ONE : DAY_MANY),
  );
}

/** One reading: when it arrived, and each value under the column it belongs to. */
function sampleLine(locale: AssistantLocale, log: LabLog, sample: LabSample): string {
  const values = sample.values
    .map((value, index) => {
      const column = log.columns[index] ?? String(index + 1);
      return `${column} ${formatNumber(locale, value)}`;
    })
    .join(", ");
  return `- ${instantText(locale, sample.at)}: ${values}`;
}

/**
 * An instant as a person reads one: the day, then the wall-clock time in the
 * machine's own zone.
 *
 * The store validates every `at` as a full ISO date-time (`LabStore.validInstant`),
 * so the day is always the first ten characters; the clock half is shown only
 * when the string parses, because an instant a future build stored in a shape
 * this one cannot read is still worth its own text rather than an exception.
 */
function instantText(locale: AssistantLocale, at: string): string {
  const day = at.slice(0, 10);
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) return at;
  return `${formatDayInSentence(locale, day)}, ${formatClock(locale, parsed)}`;
}

/** The log a name means: its id, its exact name folded, or a refusal listing the names that exist. */
function resolveLog(logs: readonly LabLog[], name: string, locale: AssistantLocale): LabLog {
  const needle = foldSearchText(name.trim());
  const found =
    logs.find((log) => log.id === name) ?? logs.find((log) => foldSearchText(log.name) === needle);
  if (found !== undefined) return found;
  throw new Error(
    phrase(locale, UNKNOWN_LOG, name, logs.map((log) => log.name).join(", ")),
  );
}

/** The one log that exists, or a refusal saying which name to use. */
function onlyLog(logs: readonly LabLog[], locale: AssistantLocale): LabLog {
  if (logs.length === 0) throw new Error(text(locale, NO_LOGS_TO_READ));
  const first = logs[0];
  if (logs.length === 1 && first !== undefined) return first;
  throw new Error(phrase(locale, NEEDS_LOG, logs.map((log) => log.name).join(", ")));
}
