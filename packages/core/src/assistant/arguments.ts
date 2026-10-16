/**
 * What a model's tool arguments are made of, before anything validates them.
 *
 * A call arrives as text that was parsed as JSON and decoded under a grammar
 * (`runtime/messages.ts` builds that grammar from the same schema this reads),
 * and the two gates around this function are the grammar and
 * {@link validateToolArguments}. Between them sits the one thing a small model
 * reliably gets ALMOST right: the value it wrote. `"5"` where a number is
 * wanted, `"Sutra"` where a day is, `"HIGH"` where a closed vocabulary is,
 * three spaces where the model had nothing to say - each is a call the model
 * meant and the schema refused, and a refusal costs a whole step of a turn that
 * may only have eight of them.
 *
 * **Normalising is not validating, and this never refuses.** It rewrites what it
 * recognises (`"sutra"` becomes the turn's own next day, `"5"` becomes `5`) and hands
 * everything it does not recognise straight to validation, which is still the
 * only thing that decides whether a call runs. Nothing here throws: a
 * malformed schema, a missing `today`, a value of a shape nobody expected all
 * leave the arguments as they were rather than turning a tool call into a
 * crash inside main.
 *
 * **Only what the model can be sure of is rewritten.** A day word is resolved
 * against the turn's own `today`, and so is every phrase that is arithmetic on
 * it: a weekday ("u petak" names that weekday's next occurrence, never today),
 * "za dva dana" / "in two weeks" (calendar arithmetic, with the month end
 * clamped), and the Cyrillic spelling of any of those. A phrase none of that
 * recognises is left as it is, for the schema to refuse with its own message.
 *
 * **A number written the way a person writes one.** A decimal comma is the
 * Serbian decimal mark, so "1,5" is one and a half - but only where the schema
 * declares a number, and never in the thousands-grouped form this module cannot
 * tell from a decimal, because a guess between 1.5 and 1500 is exactly the
 * invention the paragraph above refuses. The small numbers people spell out, in
 * both languages, are read for the same reason: the model meant a number and
 * wrote the word.
 *
 * **A unit is a word beside a quantity, and the schema decides which ones.**
 * `UNIT_WORDS` below is a LEXICON - the spellings a person uses for each unit
 * symbol, and nothing else: it converts nothing and it measures nothing, it only
 * says which declared symbol a spelled unit names. A spelled unit is rewritten
 * only into a member the field's own `enum` already holds, so a vocabulary
 * nothing declares stays a refusal rather than a substitution this module
 * invented.
 *
 * **An enum member is matched however the model spelled it.** Case and
 * diacritics fold away - a spelling the model can only have got from the schema
 * - and, on a field that declares a unit, a spelled unit is read through the
 * lexicon. A value that matches no member is left for validation to refuse,
 * because the refusal names the vocabulary and a silent substitution would not.
 *
 * The walk covers the top-level object, one level of nested objects, and
 * objects inside an array - which is every shape the registry's tools declare,
 * where a schema deeper than that is not a tool schema the loop was built for.
 */

import { dayKeyToUtcMs, isValidDayKey, shiftDayKey } from "../calendar/calendarGrid.js";
import { foldSearchText } from "../search/searchText.js";
import type { JsonSchema } from "./contract.js";

/**
 * The pattern the tools spell a calendar day with (`apps/desktop`'s
 * `tools/tasks.ts` and its siblings), and the one pattern this module treats as
 * a day rather than as text. Exported because the loop's refusal text has to
 * name the same rule: a day word is rewritten for a field that declares it, and
 * the model is told so in those words.
 */
export const DAY_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

/**
 * The words a model writes for a day around today, as FOLDED spellings mapped to
 * the number of days to add. The fold is what every spelling below is read
 * through - `foldSearchText` strips the diacritics and transliterates the
 * Cyrillic - so "juce", "ju\u010de" and "\u0458\u0443\u0447\u0435" are the one
 * word a person said, and a diacritic the model dropped is not a different word.
 * English is in the same table because it is the same question.
 */
const DAY_WORDS: Readonly<Record<string, number>> = {
  danas: 0,
  today: 0,
  sutra: 1,
  tomorrow: 1,
  prekosutra: 2,
  "day after tomorrow": 2,
  "the day after tomorrow": 2,
  juce: -1,
  yesterday: -1,
  prekjuce: -2,
  "day before yesterday": -2,
  "the day before yesterday": -2,
};

/**
 * The seven weekdays, folded, as `Date.getUTCDay()` values. `"nedelja"` is also
 * the Serbian word for a week, which is why the week phrase is resolved before
 * the weekday table is consulted: "za nedelju dana" is a week from today and
 * "u nedelju" is the Sunday after it - the preposition is what tells the two
 * apart, and both forms of the noun are listed so neither reading is unreachable.
 */
const WEEKDAYS: Readonly<Record<string, number>> = {
  ponedeljak: 1,
  ponedeljka: 1,
  utorak: 2,
  utorka: 2,
  sreda: 3,
  sredu: 3,
  cetvrtak: 4,
  cetvrtka: 4,
  petak: 5,
  petka: 5,
  subota: 6,
  subotu: 6,
  nedelja: 0,
  nedelju: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
};

/**
 * The small numbers a model spells out, folded, as the value each names. `pola`
 * and `half` are in the table because a person says "pola kile" and means a
 * number: the quantity field is where the half belongs. `dva` and `dve` are
 * separate entries rather than a gender rule, because a model writes whichever
 * the noun took.
 */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  nula: 0,
  jedan: 1,
  jedna: 1,
  dva: 2,
  dve: 2,
  tri: 3,
  cetiri: 4,
  pet: 5,
  sest: 6,
  sedam: 7,
  osam: 8,
  devet: 9,
  deset: 10,
  pola: 0.5,
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  half: 0.5,
};

/**
 * A LEXICON, not a measurement: each unit symbol of this app's own vocabularies
 * (`PANTRY_UNITS` and the car's fuel unit) with the words a person writes it
 * with, in both languages and in both scripts, folded. It converts nothing and
 * it measures nothing - "kila" is a kilogram and "litar" a litre, while the
 * arithmetic of a conversion belongs to whatever declared the vocabulary. A
 * spelled unit reaches a field only through an `enum` that already holds the
 * symbol, so this table cannot widen one.
 */
const UNIT_WORDS: Readonly<Record<string, readonly string[]>> = {
  g: ["g", "gram", "grama", "grami", "grams"],
  kg: ["kg", "kila", "kile", "kilu", "kilo", "kilogram", "kilograma", "kilograms", "kilos"],
  l: ["l", "litar", "litra", "litre", "litru", "litara", "liter", "liters", "litres"],
  ml: ["ml", "mililitar", "mililitra", "mililitara", "milliliter", "milliliters", "millilitre"],
  pcs: ["kom", "komad", "komada", "komadi", "pcs", "piece", "pieces"],
  pack: ["pakovanje", "pakovanja", "paket", "paketa", "pack", "packs", "packet", "packets"],
};

/** `UNIT_WORDS` read the other way: one folded spelling, one unit symbol. */
const UNIT_LEXICON: ReadonlyMap<string, string> = new Map(
  Object.entries(UNIT_WORDS).flatMap(([unit, spellings]) =>
    spellings.map((spelling): [string, string] => [foldSearchText(spelling), unit]),
  ),
);

/**
 * The words a person names a whole week or a whole month with, folded, as the
 * span from today each means. They are fixed offsets and not a calendar rule:
 * "sledece nedelje" is seven days from now, which is the reading a small model
 * gets right and a weekday table cannot express.
 */
const WEEK_PHRASES: Readonly<Record<string, number>> = {
  "sledece nedelje": 1,
  "next week": 1,
};

/** A day, or a day with a time of day: `2026-10-16T09:00` names the same day as `2026-10-16`. */
const ISO_DAY = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;

/** `16.10.2026` - day-first, the trailing dot optional, the way Serbian writes a date. */
const SERBIAN_DAY = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/;

/** A number written as JSON text, and nothing else: `""` and `"0x10"` are not numbers. */
const NUMERIC_TEXT = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;

/**
 * The decimal comma, and only where it is unambiguous: one comma with one or
 * two digits after it. `1,5` is one and a half and `0,25` a quarter, while
 * `1,500` carries the three digits a thousands group has - which this module
 * cannot tell from a decimal, and a guess between 1.5 and 1500 is the invention
 * the header refuses.
 */
const DECIMAL_COMMA = /^([+-]?\d+),(\d{1,2})$/;

/**
 * The arithmetic each span unit word means, keyed by its folded spelling. The
 * unit word chooses the entry, so a phrase and the arithmetic it means can never
 * drift apart.
 */
const SPAN_UNITS: Readonly<Record<string, (today: string, count: number) => string>> = {
  dana: shiftDays,
  dan: shiftDays,
  days: shiftDays,
  day: shiftDays,
  nedelju: shiftWeeks,
  nedelje: shiftWeeks,
  nedelja: shiftWeeks,
  nedelji: shiftWeeks,
  weeks: shiftWeeks,
  week: shiftWeeks,
  meseca: addMonths,
  mesece: addMonths,
  mesec: addMonths,
  meseci: addMonths,
  months: addMonths,
  month: addMonths,
};

function shiftDays(today: string, count: number): string {
  return shiftDayKey(today, count);
}

function shiftWeeks(today: string, count: number): string {
  return shiftDayKey(today, count * 7);
}

/**
 * `today` moved by whole months, the day of the month CLAMPED to the month it
 * lands in: a month after the 31st of January is the 28th of February, not the
 * 3rd of March, because a person naming a month means the last day of it rather
 * than an overflow.
 */
function addMonths(today: string, count: number): string {
  const year = Number(today.slice(0, 4));
  const monthIndex = Number(today.slice(5, 7)) - 1;
  const total = year * 12 + monthIndex + count;
  const landedYear = Math.floor(total / 12);
  const landedMonth = total - landedYear * 12;
  const day = Math.min(Number(today.slice(8, 10)), daysInMonth(landedYear, landedMonth));
  return formatDay(landedYear, landedMonth, day);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function formatDay(year: number, monthIndex: number, day: number): string {
  return [
    String(year).padStart(4, "0"),
    String(monthIndex + 1).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

/** A table's entry for a key the table itself holds: `DAY_WORDS["constructor"]` is Object's, not a day word. */
function lookup<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * The number one token names, or `null` for a token that names none: a written
 * number (`"5"`), the decimal comma (`"1,5"`), and the small numbers people
 * spell out. Nothing else - a count word this table does not hold is not a
 * number, and the phrase holding it goes to validation unread.
 */
function spelledCount(token: string): number | null {
  const word = lookup(NUMBER_WORDS, foldSearchText(token));
  if (word !== undefined) return word;
  if (NUMERIC_TEXT.test(token)) {
    const value = Number(token);
    return Number.isFinite(value) ? value : null;
  }
  const comma = DECIMAL_COMMA.exec(token);
  if (comma !== null) return Number(`${comma[1]}.${comma[2]}`);
  return null;
}

const COUNT_ALTERNATIVE = Object.keys(NUMBER_WORDS)
  .filter((word) => /^[a-z]+$/.test(word))
  .join("|");
const COUNT = `(\\d{1,3}(?:,\\d{1,2})?|${COUNT_ALTERNATIVE})`;

/**
 * `za 3 dana`, `in 2 weeks`, `za mesec dana` (a month: the idiom puts the unit
 * before the "dana"), and `3 months from today`. The count is optional only in
 * the preposition form, where it means one. Every alternative is anchored, so a
 * word no unit lists holds cannot be read as a part of one that does.
 *
 * The preposition is also what keeps this apart from a weekday phrase - "u
 * nedelju" names a Sunday, while "za nedelju dana" is a week - so the two
 * readers cannot claim the same words.
 */
const SPAN_UNIT_WORDS = Object.keys(SPAN_UNITS).join("|");
const SPAN_PATTERN = new RegExp(
  `^(?:` +
    `(?:za|in|kroz|after|for)\\s+(?:(?<count>${COUNT})\\s+)?(?<unit>${SPAN_UNIT_WORDS})(?:\\s+dana)?` +
    `|(?<countAfter>${COUNT})\\s+(?<unitAfter>${SPAN_UNIT_WORDS})\\s+(?:od danas|from today|from now)` +
    `)$`,
);

/**
 * A weekday named with a preposition ("u petak", "on Friday") or with the word
 * in front of it that makes it relative ("sledeci petak", "next Friday"). A
 * bare weekday name is the next such day as well, which is the same answer the
 * two prefixes below give.
 */
const WEEKDAY_WORDS = Object.keys(WEEKDAYS).join("|");
const WEEKDAY_PREFIXES = "sledeceg|sledeci|sledecu|sledeca|ovog|ovaj|ove|ovu|proslog|prosle|next|this|last";
const WEEKDAY_PATTERN = new RegExp(
  `^(?:` +
    `(?:${WEEKDAY_PREFIXES}|u|on|in|for)\\s+(?:dan\\s+)?(${WEEKDAY_WORDS})` +
    `|(?:${WEEKDAY_PREFIXES})\\s+(${WEEKDAY_WORDS})` +
    `|(${WEEKDAY_WORDS})` +
    `)$`,
);

const WEEK_PATTERN = new RegExp(`^(?:${Object.keys(WEEK_PHRASES).join("|")})$`);

/** One pattern above, with the group each of its readings lives in. */
interface DayReader {
  readonly pattern: RegExp;
  readonly read: (match: RegExpExecArray, today: string) => string | null;
}

/**
 * The readers of a phrase longer than one word, in the one order that does not
 * let one of them answer for another. The span pattern is read before the named
 * week so "za mesec dana" is a month rather than a week, and both before the
 * weekdays so "za nedelju dana" is a week rather than next Sunday.
 */
const DAY_READERS: readonly DayReader[] = [
  {
    pattern: SPAN_PATTERN,
    read: (match, today) => {
      const groups: Readonly<Record<string, string | undefined>> = match.groups ?? {};
      // A fraction of a day, week or month names no day: "pola meseca" is left
      // for validation rather than given a convention of its own.
      const count = spelledCount(groups["count"] ?? groups["countAfter"] ?? "1");
      const unit = lookup(SPAN_UNITS, groups["unit"] ?? groups["unitAfter"] ?? "");
      if (count === null || !Number.isInteger(count) || unit === undefined) return null;
      return unit(today, count);
    },
  },
  {
    pattern: WEEK_PATTERN,
    read: (match, today) => shiftDayKey(today, (lookup(WEEK_PHRASES, match[0]) ?? 0) * 7),
  },
  {
    pattern: WEEKDAY_PATTERN,
    read: (match, today) => {
      const named = lookup(WEEKDAYS, match[1] ?? match[2] ?? match[3] ?? "");
      return named === undefined ? null : nextWeekday(today, named);
    },
  },
];

/**
 * A tool call's arguments, with everything the model wrote loosely made
 * explicit, ready for {@link validateToolArguments}.
 *
 * `today` is the turn's own day (`AgentTurnInput.today`): the anchor a day word
 * is resolved against. Returns a new value; the input is never changed.
 */
export function normalizeToolArguments(
  schema: JsonSchema,
  args: unknown,
  today: string,
): unknown {
  if (!isObject(args)) return args;
  return normalizeObject(schema, args, today, true);
}

/**
 * One object, against one schema.
 *
 * `nested` says whether the values of this object may be walked into: true for
 * the top-level arguments, false one level down, which is the whole depth this
 * module promises.
 */
function normalizeObject(
  schema: JsonSchema,
  value: Record<string, unknown>,
  today: string,
  nested: boolean,
): Record<string, unknown> {
  const properties = isObject(schema["properties"]) ? schema["properties"] : {};
  const required = stringList(schema["required"]);
  const closed = schema["additionalProperties"] === false;
  const normalized: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(value)) {
    // Own members only: `properties["__proto__"]` is Object.prototype, which
    // would read as a schema for a property the tool never declared.
    const property = Object.hasOwn(properties, name) ? properties[name] : undefined;
    if (!isObject(property)) {
      // A property the schema does not declare: dropped only when the schema
      // closes the object, because validation is what refuses it otherwise and
      // the refusal is the sentence the model can act on.
      if (!closed) setOwn(normalized, name, raw);
      continue;
    }
    // A REQUIRED property is never removed, however empty it is: `due: null` on
    // tasks.reschedule means "clear the due date", and only the tool may decide
    // what an empty value means. An optional one is removed before anything is
    // read out of it, so a `""` in an array field is nothing rather than the
    // one empty string that field would otherwise become.
    if (!required.includes(name) && isEmpty(raw)) continue;
    setOwn(normalized, name, normalizeValue(property, raw, today, nested));
  }
  return normalized;
}

/**
 * One member of a rebuilt object, DEFINED rather than assigned: an argument
 * named `__proto__` is a property of the object the model wrote, and
 * `normalized["__proto__"] = value` would replace the result's prototype
 * instead - members placed there pass validation, which reads own members,
 * and still reach the tool that reads `args.title`.
 */
function setOwn(target: Record<string, unknown>, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value, enumerable: true, writable: true, configurable: true });
}

/** One property's value, against that property's schema. */
function normalizeValue(
  schema: JsonSchema,
  value: unknown,
  today: string,
  nested: boolean,
): unknown {
  if (declaredTypes(schema).includes("array") && !Array.isArray(value) && !isEmpty(value)) {
    // A list the model wrote as one item, without the brackets.
    return normalizeValue(schema, [value], today, nested);
  }
  if (Array.isArray(value)) {
    const items = schema["items"];
    if (!nested || !isObject(items)) return value;
    return value.map((item) =>
      isObject(item) ? normalizeObject(items, item, today, false) : normalizeScalar(items, item, today),
    );
  }
  if (isObject(value)) return nested ? normalizeObject(schema, value, today, false) : value;
  return normalizeScalar(schema, value, today);
}

/**
 * One value that is not an object or an array: trimmed, and rewritten where the
 * schema says what it would have to be. Anything unrecognised is returned as
 * the model wrote it (trimmed), for validation to refuse.
 */
function normalizeScalar(schema: JsonSchema, value: unknown, today: string): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();

  if (schema["pattern"] === DAY_PATTERN) {
    const day = resolveDay(text, today);
    if (day !== null) return day;
  }

  const members = stringList(schema["enum"]);
  if (members.length > 0) {
    return enumMember(text, members);
  }

  const types = declaredTypes(schema);
  if (types.includes("number") || types.includes("integer")) {
    return numericValue(text);
  }
  if (types.includes("boolean")) {
    if (text === "true") return true;
    if (text === "false") return false;
  }
  return text;
}

/**
 * The member of an enum a value names: the folded spelling of a member, or - for
 * a unit, the one vocabulary a person writes as a word rather than as the symbol
 * - a spelled unit read through the lexicon. A value that names neither is
 * handed back for validation's own refusal.
 */
function enumMember(text: string, members: readonly string[]): string {
  const folded = foldSearchText(text);
  const exact = members.find((member) => foldSearchText(member) === folded);
  if (exact !== undefined) return exact;
  const unit = UNIT_LEXICON.get(folded);
  if (unit === undefined) return text;
  return members.find((member) => foldSearchText(member) === unit) ?? text;
}

/** A number a field declared as one holds: a written number, a decimal comma, or a spelled number word. */
function numericValue(text: string): number | string {
  return spelledCount(text) ?? text;
}

/**
 * The day a day word, a relative phrase or a written date names, or `null` when
 * this is not one of the forms above - a phrase that is none of them is left for
 * validation rather than guessed at, and a `today` that is not a day is no
 * anchor at all.
 */
function resolveDay(value: string, today: string): string | null {
  const folded = foldSearchText(value);
  const shift = lookup(DAY_WORDS, folded);
  if (shift !== undefined) {
    return utcMsOf(today) === null ? null : shiftDayKey(today, shift);
  }
  if (utcMsOf(today) === null) return null;

  for (const reader of DAY_READERS) {
    const match = reader.pattern.exec(folded);
    const day = match === null ? null : reader.read(match, today);
    if (day !== null) return day;
  }

  const iso = ISO_DAY.exec(value);
  if (iso !== null) return isValidDayKey(iso[1] ?? "") ? (iso[1] ?? null) : null;
  const serbian = SERBIAN_DAY.exec(value);
  if (serbian !== null) {
    const [day, month, year] = [serbian[1] ?? "", serbian[2] ?? "", serbian[3] ?? ""];
    const key = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    return isValidDayKey(key) ? key : null;
  }
  return null;
}

/**
 * The next day with the weekday `target` (`Date.getUTCDay()`), TODAY EXCLUDED:
 * "u petak" said on a Friday is the Friday a week away, because a person who
 * meant today says "danas". The seven-day week is all the arithmetic there is.
 */
function nextWeekday(today: string, target: number): string {
  const daysSinceMonday = (new Date(dayKeyToUtcMs(today)).getUTCDay() + 6) % 7;
  const wanted = (target + 6) % 7;
  const ahead = wanted - daysSinceMonday;
  return shiftDayKey(today, ahead <= 0 ? ahead + 7 : ahead);
}

/** Whether a day key is a real calendar day, which every anchor has to be. */
function utcMsOf(day: string): number | null {
  return isValidDayKey(day) ? dayKeyToUtcMs(day) : null;
}

/** Whether an OPTIONAL property carries nothing: null, absent, or whitespace only. */
function isEmpty(value: unknown): boolean {
  return (
    value === null || value === undefined || (typeof value === "string" && value.trim() === "")
  );
}

/** The type names a node accepts, as the list the coercions above read. */
function declaredTypes(schema: JsonSchema): readonly string[] {
  const type = schema["type"];
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) {
    return type.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

/** The strings of a list-valued keyword, ignoring anything that is not one. */
function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** A JSON Schema node or a JSON object, as opposed to a scalar or a list. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
