/**
 * The MINI-APPS module: what the nine small tools have kept.
 *
 * **The store is the app's own, and it keeps ONE document.** `MiniappsStore`
 * (migration 083) holds the counters, the scoreboard, the typing records and the
 * world clock's cities as one validated value, which is what the module's tiles
 * read and write; `read()` is the page's own call, so nothing here is a second
 * reader of `miniapps_state`.
 *
 * **What this file answers, and what it deliberately does not.** Four of the six
 * kept things are a record a person asks about — the counters, the scoreboard's
 * standings, the cities on the clock and the best typing runs. The dice history
 * is the fifth and it is left out: it is a glance backwards at rolls nobody
 * re-reads, and the page keeps it for its own dice tile rather than for a
 * question. Which tile was open last is the sixth and is not the user's data at
 * all.
 *
 * **Where the words come from.** The names a user typed are printed as typed.
 * The tile names („Brojači", „Semafor", „Kucanje", „Svetski sat") and the four
 * labels beside the figures are the page's own words restated, on `library.ts`'s
 * precedent: the page's copy table is part of the renderer's bundle and main
 * cannot read it. A CITY is the exception — the stored value is an IANA zone id,
 * and the page labels it from a table in that same copy („Beograd"), which is
 * the page's own vocabulary rather than a name the data carries; this file
 * prints the zone and the local time it is for, which is the fact the tile
 * exists to show.
 *
 * **What the assistant writes, and what it does not.** Two of the module's
 * records change through the store's own per-tool saves (`saveCounters`,
 * `saveCities`), which keep the rest of the document as it is, and through the
 * tally's own reducer for the arithmetic. The tile's undo history is the page's,
 * so a change made here is not on that stack; the tile re-reads the document when
 * the change reveals it. The scoreboard, the typing progress and the dice history
 * stay the page's: the assistant reads them but does not write them.
 *
 * **The dates tool is pure arithmetic.** `miniapps.dates` calls `@nexus/core`'s
 * `dateCalc` and changes nothing.
 */

import {
  MINIAPPS_MAX_CITIES,
  MiniappsStore,
  type MiniappsData,
  type MiniappsTypingRecord,
} from "@nexus/db";
import {
  addToDate,
  dateDifference,
  foldSearchText,
  scoreboardStandings,
  tallyReduce,
  tallyTotal,
  TALLY_MAX_NAME_LENGTH,
  TYPING_LAYOUTS,
  type AssistantLocale,
  type AssistantText,
  type DateUnits,
  type ScoreboardBoard,
  type ScoreboardStanding,
  type Tool,
  type TypingLayoutId,
} from "@nexus/core";
import { asArgs, asCount, asOptionalBoolean, asOptionalCount, asOptionalDay, asText } from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  failResult,
  formatClockIn,
  formatDayInSentence,
  formatNumber,
  formatPercent,
  guard,
  localDay,
  okResult,
  phrase,
  quote,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface MiniappsToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
  /** Main's wall clock: the world clock's cities are answered with the local time it is now. */
  readonly now: () => number;
}

/** The heading, and the sentence for a profile that has kept nothing yet. */
const HEADING: { readonly sr: string; readonly en: string } = {
  sr: "Mini aplikacije — šta pamte:",
  en: "Mini apps — what they keep:",
};

const NOTHING_KEPT: { readonly sr: string; readonly en: string } = {
  sr: "Mini aplikacije još ništa ne pamte.",
  en: "The mini apps keep nothing yet.",
};

/** The four tile names, as the page writes them. */
const TILE = {
  counters: { sr: "Brojači", en: "Counters" },
  scoreboard: { sr: "Semafor", en: "Scoreboard" },
  clock: { sr: "Svetski sat", en: "World clock" },
  typing: { sr: "Kucanje", en: "Typing" },
} as const;

/** One counter as `name value`, and the sum the tile shows under the column. */
const TOTAL_WORD: AssistantPhrase<[total: string]> = {
  sr: (total) => `ukupno ${total}`,
  en: (total) => `total ${total}`,
};

/** A player's total and place, the two columns of the tile's standings table. */
const PLAYER_TOTAL: AssistantPhrase<[total: string]> = {
  sr: (total) => `ukupno ${total}`,
  en: (total) => `total ${total}`,
};

const PLAYER_RANK: AssistantPhrase<[rank: string]> = {
  sr: (rank) => `mesto ${rank}`,
  en: (rank) => `rank ${rank}`,
};

const ROUNDS_WORD: AssistantPhrase<[count: number]> = {
  sr: (count) => `kola: ${count}`,
  en: (count) => `rounds: ${count}`,
};

const TIED_WORD: { readonly sr: string; readonly en: string } = {
  sr: "nerešeno",
  en: "tied",
};

/** The typing tile's own two column labels, with the figure beside them. */
const WPM_WORD: AssistantPhrase<[wpm: string]> = {
  sr: (wpm) => `reči u minuti: ${wpm}`,
  en: (wpm) => `words a minute: ${wpm}`,
};

const ACCURACY_WORD: AssistantPhrase<[accuracy: string]> = {
  sr: (accuracy) => `tačnost: ${accuracy}`,
  en: (accuracy) => `accuracy: ${accuracy}`,
};

/** The best run's own day, in brackets after its figures. */
const BEST_ON: AssistantPhrase<[day: string]> = {
  sr: (day) => `najbolje ${day}`,
  en: (day) => `best on ${day}`,
};

export function miniappsTools(deps: MiniappsToolDeps): readonly Tool[] {
  const kept: Tool = {
    name: "miniapps.kept",
    description: {
      sr: "Čita šta pamte Mini aplikacije: brojače, poredak na semaforu, gradove na svetskom satu sa lokalnim vremenom i najbolje rezultate kucanja. Koristi ga kada korisnik pita koliki mu je brojač, ko vodi na semaforu, koje gradove ima na satu ili kolika mu je brzina kucanja.",
      en: "Reads what the mini apps have kept: the counters, the scoreboard standings, the cities on the world clock with their local times, and the best typing runs. Use it when the user asks what a counter is at, who leads the scoreboard, which cities are on their clock, or how fast they type.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        asArgs(rawArgs);
        const data = deps.profileDb(context.profileId, (db, id) =>
          new MiniappsStore(db, id).read(),
        );

        const sections: string[] = [];
        const counters = countersLine(context.locale, data);
        if (counters !== null) sections.push(counters);
        const scoreboard = scoreboardLine(context.locale, data.scoreboard);
        if (scoreboard !== null) sections.push(scoreboard);
        const clock = clockLine(context.locale, data.cities, deps.now());
        if (clock !== null) sections.push(clock);
        const typing = typingLines(context.locale, data);
        sections.push(...typing);

        if (sections.length === 0) return okResult(text(context.locale, NOTHING_KEPT));
        return okResult([text(context.locale, HEADING), ...sections].join("\n"));
      }),
  };

  const dates: Tool = {
    name: "miniapps.dates",
    description: {
      sr: "Računa koliko dana ima između dva datuma ili pomera datum za dane, nedelje, mesece i godine. Koristi ga kada korisnik pita koliko je do nekog datuma ili koji je datum posle nekog roka.",
      en: "Works out the days between two dates, or moves a date by days, weeks, months and years. Use it when the user asks how far off a date is, or which date falls a span after another.",
    },
    parameters: {
      type: "object",
      properties: {
        from: {
          type: "string",
          format: "date",
          description: "The starting date. Defaults to today.",
        },
        to: {
          type: "string",
          format: "date",
          description: "The end date: the distance from the start to it.",
        },
        add: {
          type: "object",
          description: "A span to move the start date by. Give this or to, not both.",
          properties: {
            years: { type: "integer", minimum: -SPAN_LIMIT, maximum: SPAN_LIMIT },
            months: { type: "integer", minimum: -SPAN_LIMIT, maximum: SPAN_LIMIT },
            weeks: { type: "integer", minimum: -SPAN_LIMIT, maximum: SPAN_LIMIT },
            days: { type: "integer", minimum: -SPAN_LIMIT, maximum: SPAN_LIMIT },
          },
          required: [],
          additionalProperties: false,
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
        const from = asOptionalDay(args.from, "from") ?? localDay(deps.now());
        const to = asOptionalDay(args.to, "to");
        if ((to === undefined) === (args.add === undefined)) {
          return failResult(context.locale, text(context.locale, GIVE_ONE));
        }
        if (to !== undefined) {
          const distance = dateDifference(from, to);
          return okResult(
            phrase(
              context.locale,
              DISTANCE,
              from,
              to,
              daysPhrase(context.locale, distance.totalDays),
              formatNumber(context.locale, distance.years),
              formatNumber(context.locale, distance.months),
              formatNumber(context.locale, distance.days),
            ),
          );
        }
        const span = readSpan(args.add);
        const shifted = addToDate(from, span);
        return okResult(`${from} ${spanText(context.locale, span)} = ${shifted}`);
      }),
  };

  const counter: Tool = {
    name: "miniapps.counter",
    description: {
      sr: "Postavlja vrednost brojača Mini aplikacija, po imenu brojača, na primer brojača kafe ili vode. Koristi ga kada korisnik kaže da je brojač sada na nekom broju ili traži da ga podesi.",
      en: "Sets a mini-apps counter, found by its name, to a value, for example the coffee or water counter. Use it when the user says a counter is at a number now or asks to set it.",
    },
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: TALLY_MAX_NAME_LENGTH,
          description: "The counter's name, as the user knows it.",
        },
        value: {
          type: "integer",
          minimum: -COUNTER_LIMIT,
          maximum: COUNTER_LIMIT,
          description: "The new value.",
        },
      },
      required: ["name", "value"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const name = asText(args.name, "name", TALLY_MAX_NAME_LENGTH);
        const value = asCount(args.value, "value", -COUNTER_LIMIT, COUNTER_LIMIT);
        const data = deps.profileDb(context.profileId, (db, id) =>
          new MiniappsStore(db, id).read(),
        );
        const wanted = foldSearchText(name);
        const [found, ...others] = data.counters.filter(
          (entry) => foldSearchText(entry.name) === wanted,
        );
        if (found === undefined) {
          return failResult(context.locale, phrase(context.locale, NO_COUNTER, quote(context.locale, name)));
        }
        if (others.length > 0) {
          const names = [found, ...others].map((entry) => quote(context.locale, entry.name));
          return failResult(context.locale, phrase(context.locale, AMBIGUOUS, names.join(", ")));
        }
        const target = quote(context.locale, found.name);
        if (found.value === value) {
          return okResult(phrase(context.locale, UNCHANGED, target, formatNumber(context.locale, value)));
        }

        const next = tallyReduce(
          { counters: data.counters, past: [], future: [] },
          { type: "set-value", id: found.id, value },
        );
        const declined = await confirmOrDecline(
          context,
          "miniapps.counter",
          "write",
          phrase(
            context.locale,
            SET_SUMMARY,
            target,
            formatNumber(context.locale, found.value),
            formatNumber(context.locale, value),
          ),
        );
        if (declined !== null) return declined;

        const now = new Date(deps.now()).toISOString();
        deps.profileDb(context.profileId, (db, id) =>
          new MiniappsStore(db, id).saveCounters(next.counters, now),
        );
        return okResult(phrase(context.locale, SET, target, formatNumber(context.locale, value)), {
          navigateTo: { module: "miniapps", item: "tally" },
        });
      }),
  };

  const city: Tool = {
    name: "miniapps.city",
    description: {
      sr: "Stavlja grad na svetski sat ili ga skida sa njega. Grad je IANA zona, na primer Europe/Belgrade. Koristi ga kada korisnik traži da sat pokaže neki grad ili da ga ukloni.",
      en: "Puts a city on the world clock, or takes it off, by its IANA zone id, for example Europe/Belgrade. Use it when the user asks the clock to show a city or to drop one.",
    },
    parameters: {
      type: "object",
      properties: {
        zone: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ZONE_LENGTH,
          description: "An IANA time zone id, for example Europe/Belgrade.",
        },
        remove: {
          type: "boolean",
          description: "True to take the city off the clock. Leave out to put it on.",
        },
      },
      required: ["zone"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const zone = asText(args.zone, "zone", MAX_ZONE_LENGTH);
        const remove = asOptionalBoolean(args.remove, "remove") ?? false;
        if (!isTimeZone(zone)) {
          return failResult(context.locale, phrase(context.locale, UNKNOWN_ZONE, zone));
        }
        const data = deps.profileDb(context.profileId, (db, id) =>
          new MiniappsStore(db, id).read(),
        );
        const listed = data.cities.includes(zone);
        if (remove === !listed) {
          return failResult(
            context.locale,
            phrase(context.locale, remove ? NOT_ON_CLOCK : ON_CLOCK, zone),
          );
        }
        if (!remove && data.cities.length >= MINIAPPS_MAX_CITIES) {
          return failResult(context.locale, phrase(context.locale, FULL, MINIAPPS_MAX_CITIES));
        }

        const declined = await confirmOrDecline(
          context,
          "miniapps.city",
          "write",
          phrase(context.locale, remove ? REMOVE_SUMMARY : ADD_SUMMARY, zone),
        );
        if (declined !== null) return declined;

        const cities = remove
          ? data.cities.filter((entry) => entry !== zone)
          : [...data.cities, zone];
        const now = new Date(deps.now()).toISOString();
        deps.profileDb(context.profileId, (db, id) =>
          new MiniappsStore(db, id).saveCities(cities, now),
        );
        return okResult(phrase(context.locale, remove ? REMOVED : ADDED, zone), {
          navigateTo: { module: "miniapps", item: "worldclock" },
        });
      }),
  };

  return [kept, dates, counter, city];
}

/** A policy bound on one date span and on a counter's value, in the tool schemas. It is a ceiling on what the assistant may ask for, not a measurement. */
const SPAN_LIMIT = 10_000;
const COUNTER_LIMIT = 1_000_000_000;
/** The longest zone id the world clock accepts, as the store bounds it. */
const MAX_ZONE_LENGTH = 64;

const SPAN_UNITS = ["years", "months", "weeks", "days"] as const;
const UNIT_LABEL: Record<(typeof SPAN_UNITS)[number], AssistantText> = {
  years: { sr: "god.", en: "yr" },
  months: { sr: "mes.", en: "mo" },
  weeks: { sr: "ned.", en: "wk" },
  days: { sr: "d", en: "d" },
};

const GIVE_ONE: { readonly sr: string; readonly en: string } = {
  sr: "Navedi ili datum do kojeg se računa, ili razmak koji se dodaje, ne oba.",
  en: "Give either an end date to count to, or a span to add, not both.",
};

const DISTANCE: AssistantPhrase<
  [from: string, to: string, total: string, years: string, months: string, days: string]
> = {
  sr: (from, to, total, years, months, days) =>
    `Između ${from} i ${to}: ${total} (${years} god., ${months} mes., ${days} d).`,
  en: (from, to, total, years, months, days) =>
    `Between ${from} and ${to}: ${total} (${years} yr, ${months} mo, ${days} d).`,
};

const NO_COUNTER: AssistantPhrase<[name: string]> = {
  sr: (name) => `Nema brojača ${name}.`,
  en: (name) => `There is no counter ${name}.`,
};
const AMBIGUOUS: AssistantPhrase<[names: string]> = {
  sr: (names) => `Ima više brojača sa tim imenom: ${names}. Navedi tačno ime.`,
  en: (names) => `More than one counter has that name: ${names}. Name the one you mean.`,
};
const UNCHANGED: AssistantPhrase<[name: string, value: string]> = {
  sr: (name, value) => `Brojač ${name} je već na ${value}.`,
  en: (name, value) => `The counter ${name} is already at ${value}.`,
};
const SET_SUMMARY: AssistantPhrase<[name: string, from: string, to: string]> = {
  sr: (name, from, to) => `Postaviti brojač ${name} sa ${from} na ${to}?`,
  en: (name, from, to) => `Set the counter ${name} from ${from} to ${to}?`,
};
const SET: AssistantPhrase<[name: string, value: string]> = {
  sr: (name, value) => `Brojač ${name} je sada na ${value}.`,
  en: (name, value) => `The counter ${name} is now at ${value}.`,
};

const UNKNOWN_ZONE: AssistantPhrase<[zone: string]> = {
  sr: (zone) => `Nepoznata vremenska zona: ${zone}.`,
  en: (zone) => `Unknown time zone: ${zone}.`,
};
const ON_CLOCK: AssistantPhrase<[zone: string]> = {
  sr: (zone) => `${zone} je već na svetskom satu.`,
  en: (zone) => `${zone} is already on the world clock.`,
};
const NOT_ON_CLOCK: AssistantPhrase<[zone: string]> = {
  sr: (zone) => `${zone} nije na svetskom satu.`,
  en: (zone) => `${zone} is not on the world clock.`,
};
const FULL: AssistantPhrase<[max: number]> = {
  sr: (max) => `Na svetskom satu može biti najviše ${max} gradova.`,
  en: (max) => `The world clock holds at most ${max} cities.`,
};
const ADD_SUMMARY: AssistantPhrase<[zone: string]> = {
  sr: (zone) => `Staviti ${zone} na svetski sat?`,
  en: (zone) => `Put ${zone} on the world clock?`,
};
const REMOVE_SUMMARY: AssistantPhrase<[zone: string]> = {
  sr: (zone) => `Skinuti ${zone} sa svetskog sata?`,
  en: (zone) => `Take ${zone} off the world clock?`,
};
const ADDED: AssistantPhrase<[zone: string]> = {
  sr: (zone) => `${zone} je na svetskom satu.`,
  en: (zone) => `${zone} is on the world clock.`,
};
const REMOVED: AssistantPhrase<[zone: string]> = {
  sr: (zone) => `${zone} je skinut sa svetskog sata.`,
  en: (zone) => `${zone} is off the world clock.`,
};

/** A day count with its noun in the locale's plural: „76 dana", „1 dan", „76 days", „1 day". */
function daysPhrase(locale: AssistantLocale, count: number): string {
  const one = new Intl.PluralRules(locale).select(count) === "one";
  const noun = locale === "sr" ? (one ? "dan" : "dana") : one ? "day" : "days";
  return `${formatNumber(locale, count)} ${noun}`;
}

/** The units a span names, signed, in the order they are added: „+2 mes., +3 d". */
function spanText(locale: AssistantLocale, span: DateUnits): string {
  return SPAN_UNITS.filter((unit) => span[unit] !== undefined)
    .map((unit) => {
      const amount = span[unit] ?? 0;
      return `${amount > 0 ? "+" : ""}${formatNumber(locale, amount)} ${UNIT_LABEL[unit][locale]}`;
    })
    .join(", ");
}

/** The span an `add` argument names: each unit the model gave, and none it left out. */
function readSpan(value: unknown): DateUnits {
  const raw = asArgs(value);
  const span: { years?: number; months?: number; weeks?: number; days?: number } = {};
  for (const unit of SPAN_UNITS) {
    const amount = asOptionalCount(raw[unit], unit, -SPAN_LIMIT, SPAN_LIMIT);
    if (amount !== undefined) span[unit] = amount;
  }
  return span;
}

/**
 * Whether the runtime knows a zone id. `Intl` throws for one it does not, and the
 * tool refuses it by name instead of writing an id the clock would have to print
 * without a time.
 */
function isTimeZone(zone: string): boolean {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone !== undefined;
  } catch {
    return false;
  }
}

/** The counters, or `null` when the user has none. */
function countersLine(locale: AssistantLocale, data: MiniappsData): string | null {
  if (data.counters.length === 0) return null;
  const counters = data.counters
    .map((counter) => `${counter.name} ${formatNumber(locale, counter.value)}`)
    .join(", ");
  // The engine's own total, over a state whose undo history is empty: the store
  // never keeps one (`miniappsStore.ts`: "the stacks are not stored") and the sum
  // does not depend on it.
  const total = phrase(
    locale,
    TOTAL_WORD,
    formatNumber(locale, tallyTotal({ counters: data.counters, past: [], future: [] })),
  );
  return `- ${text(locale, TILE.counters)}: ${counters} (${total})`;
}

/**
 * The standings, or `null` when no player is on the board.
 *
 * The engine's own `scoreboardStandings` is handed a state whose undo history is
 * empty, because the store never keeps one (`miniappsStore.ts`: "the stacks are
 * not stored") and the totals do not depend on it.
 */
function scoreboardLine(locale: AssistantLocale, board: ScoreboardBoard): string | null {
  if (board.players.length === 0) return null;
  const rows = scoreboardStandings({ ...board, past: [], future: [] })
    .map((standing) => playerText(locale, standing))
    .join("; ");
  const parts = [rows];
  if (board.rounds.length > 0) parts.push(phrase(locale, ROUNDS_WORD, board.rounds.length));
  return `- ${text(locale, TILE.scoreboard)}: ${parts.join(" — ")}`;
}

/** One player's row: the name the user typed, the total and the place in the standings. */
function playerText(locale: AssistantLocale, standing: ScoreboardStanding): string {
  const parts = [
    phrase(locale, PLAYER_TOTAL, formatNumber(locale, standing.total)),
    phrase(locale, PLAYER_RANK, String(standing.rank)),
  ];
  if (standing.tied) parts.push(text(locale, TIED_WORD));
  return `${standing.player.name} (${parts.join(", ")})`;
}

/**
 * The clock's cities, or `null` when none is picked: each zone with the local
 * time it is now.
 *
 * A zone the runtime does not know is printed without a time rather than
 * dropped: the id came out of a user's own document, and a row that vanished
 * from the answer would be the tool hiding what the tile would refuse to draw.
 */
function clockLine(
  locale: AssistantLocale,
  cities: readonly string[],
  nowMs: number,
): string | null {
  if (cities.length === 0) return null;
  const rows = cities.map((zone) => {
    const clock = formatClockIn(locale, nowMs, zone);
    return clock === null ? zone : `${zone} ${clock}`;
  });
  return `- ${text(locale, TILE.clock)}: ${rows.join(", ")}`;
}

/**
 * One line per layout that has runs: the best run's figures, and the day it was
 * set.
 *
 * The record kept is the one with the highest net speed — the same number the
 * tile's own „Najbolje" row shows. The layout is named by its id, which is what
 * the store holds; the page's own name for a layout („Srpski (latinica)") is a
 * table in the renderer's copy, and this file does not carry a second copy of it
 * (see the file header).
 */
function typingLines(locale: AssistantLocale, data: MiniappsData): readonly string[] {
  const layouts = Object.keys(TYPING_LAYOUTS) as TypingLayoutId[];
  const lines: string[] = [];
  for (const layout of layouts) {
    const runs = data.typing.records.filter((record) => record.layout === layout);
    const best = bestRun(runs);
    if (best === null) continue;
    lines.push(
      `- ${text(locale, TILE.typing)}: ${layout} — ${phrase(
        locale,
        WPM_WORD,
        formatNumber(locale, best.netWpm),
      )}, ${phrase(locale, ACCURACY_WORD, formatPercent(locale, best.accuracy))} (${phrase(
        locale,
        BEST_ON,
        formatDayInSentence(locale, localDay(best.atMs)),
      )})`,
    );
  }
  return lines;
}

/** The run with the highest net speed, or `null` when the list is empty. */
function bestRun(runs: readonly MiniappsTypingRecord[]): MiniappsTypingRecord | null {
  let best: MiniappsTypingRecord | null = null;
  for (const run of runs) {
    if (best === null || run.netWpm > best.netWpm) best = run;
  }
  return best;
}
