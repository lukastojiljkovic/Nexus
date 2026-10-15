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
 * against the turn's own `today`; an unknown word is left alone, because
 * guessing at „sledeće nedelje" would be inventing a date the user never said.
 * Enum members are matched case- and diacritic-insensitively, which is a
 * spelling the model can only have got from the schema; a value that matches no
 * member is left for validation to refuse, because the refusal names the
 * vocabulary and a silent substitution would not.
 *
 * The walk covers the top-level object, one level of nested objects, and
 * objects inside an array - which is every shape the registry's tools declare,
 * where a schema deeper than that is not a tool schema the loop was built for.
 */

import { isValidDayKey, shiftDayKey } from "../calendar/calendarGrid.js";
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
 * The words a model writes for a day around today, as folded spellings, mapped
 * to the number of days to add. `juče`/`juce` fold to one entry because the
 * fold is what the model's spelling is read through - a diacritic it dropped is
 * not a different word.
 */
const DAY_WORDS: Readonly<Record<string, number>> = {
  danas: 0,
  today: 0,
  sutra: 1,
  tomorrow: 1,
  prekosutra: 2,
  "day after tomorrow": 2,
  juce: -1,
  yesterday: -1,
};

/** A day, or a day with a time of day: `2026-10-16T09:00` names the same day as `2026-10-16`. */
const ISO_DAY = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;

/** `16.10.2026` - day-first, the trailing dot optional, the way Serbian writes a date. */
const SERBIAN_DAY = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/;

/** A number written as JSON text, and nothing else: `""`, `"0x10"` and `"1,5"` are not numbers. */
const NUMERIC_TEXT = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;

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
    const property = properties[name];
    if (!isObject(property)) {
      // A property the schema does not declare: dropped only when the schema
      // closes the object, because validation is what refuses it otherwise and
      // the refusal is the sentence the model can act on.
      if (!closed) normalized[name] = raw;
      continue;
    }
    // A REQUIRED property is never removed, however empty it is: `due: null` on
    // tasks.reschedule means „clear the due date", and only the tool may decide
    // what an empty value means. An optional one is removed before anything is
    // read out of it, so a `""` in an array field is nothing rather than the
    // one empty string that field would otherwise become.
    if (!required.includes(name) && isEmpty(raw)) continue;
    normalized[name] = normalizeValue(property, raw, today, nested);
  }
  return normalized;
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
    const folded = foldSearchText(text);
    return members.find((member) => foldSearchText(member) === folded) ?? text;
  }

  const types = declaredTypes(schema);
  if (types.includes("number") || types.includes("integer")) {
    return NUMERIC_TEXT.test(text) && Number.isFinite(Number(text)) ? Number(text) : text;
  }
  if (types.includes("boolean")) {
    if (text === "true") return true;
    if (text === "false") return false;
  }
  return text;
}

/**
 * The day a day word or a written date names, or `null` when this is not one of
 * the forms above - an unknown word is left for validation rather than guessed
 * at, and a `today` that is not a day is no anchor at all.
 */
function resolveDay(value: string, today: string): string | null {
  const shift = DAY_WORDS[foldSearchText(value)];
  if (shift !== undefined) {
    return isValidDayKey(today) ? shiftDayKey(today, shift) : null;
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
