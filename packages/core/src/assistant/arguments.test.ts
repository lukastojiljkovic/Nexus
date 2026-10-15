import { describe, expect, it } from "vitest";
import { normalizeToolArguments } from "./arguments.js";
import type { JsonSchema } from "./contract.js";

/** The turn's own day. Every relative word below is resolved against it. */
const TODAY = "2026-10-14";

/** The pattern the tools spell a calendar day with. */
const DAY: JsonSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };

/** The smallest object schema: the named properties, closed, `required` as given. */
function object(
  properties: Readonly<Record<string, JsonSchema>>,
  required: readonly string[] = [],
): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

/** One named property of a closed argument object, normalised. */
function only(property: JsonSchema, value: unknown, required = false): unknown {
  const normalized = normalizeToolArguments(
    object({ it: property }, required ? ["it"] : []),
    { it: value },
    TODAY,
  ) as Record<string, unknown>;
  return normalized["it"];
}

/** One day, resolved against a day of the caller's own choosing. */
function dayFrom(value: string, today: string): unknown {
  const normalized = normalizeToolArguments(object({ it: DAY }), { it: value }, today) as Record<
    string,
    unknown
  >;
  return normalized["it"];
}

/** The pantry's own unit vocabulary, as `PANTRY_UNITS` declares it. */
const PANTRY_UNIT: JsonSchema = { type: "string", enum: ["pcs", "g", "kg", "ml", "l", "pack"] };

describe("normalizeToolArguments", () => {
  it("removes an optional property that carries nothing, and no required one", () => {
    for (const empty of [null, undefined, "", "   "]) {
      expect(normalizeToolArguments(object({ note: { type: "string" } }), { note: empty }, TODAY)).toEqual({});
    }
    // A required empty string is still a value: only the tool may decide what
    // "nothing" means for it.
    expect(only({ type: "string" }, "   ", true)).toBe("");
    // And a required null is how tasks.reschedule says "clear the due date".
    expect(only({ type: ["string", "null"] }, null, true)).toBeNull();
  });

  it("trims what the model wrote", () => {
    expect(only({ type: "string" }, "  Kupi vodu\n")).toBe("Kupi vodu");
  });

  it("reads a number written as text as the number", () => {
    expect(only({ type: "number" }, "5")).toBe(5);
    expect(only({ type: "integer" }, "42")).toBe(42);
    expect(only({ type: "number" }, "-1.5")).toBe(-1.5);
    // Not a number: left for validation, which refuses it with a sentence.
    expect(only({ type: "number" }, "petsto")).toBe("petsto");
  });

  it("reads a boolean written as text as the boolean", () => {
    expect(only({ type: "boolean" }, "true")).toBe(true);
    expect(only({ type: "boolean" }, "false")).toBe(false);
    expect(only({ type: "boolean" }, "yes")).toBe("yes");
  });

  it("matches an enum member however the model spelled it", () => {
    const priority: JsonSchema = { type: "string", enum: ["low", "high"] };
    expect(only(priority, "HIGH")).toBe("high");
    // Diacritics folded: a member the model typed without them is that member.
    expect(only({ type: "string", enum: ["ni\u017ee", "vi\u0161e"] }, "nize")).toBe("ni\u017ee");
    // Nothing matched: validation refuses it, and the refusal quotes the list.
    expect(only(priority, "medium")).toBe("medium");
  });

  it("resolves a day word, and a written date, against the turn's own day", () => {
    for (const [written, resolved] of [
      ["danas", "2026-10-14"],
      ["today", "2026-10-14"],
      ["sutra", "2026-10-15"],
      ["tomorrow", "2026-10-15"],
      ["prekosutra", "2026-10-16"],
      ["day after tomorrow", "2026-10-16"],
      ["the day after tomorrow", "2026-10-16"],
      ["ju\u010de", "2026-10-13"],
      ["juce", "2026-10-13"],
      ["yesterday", "2026-10-13"],
      ["prekju\u010de", "2026-10-12"],
      ["the day before yesterday", "2026-10-12"],
      // The Cyrillic spelling is the same word.
      ["\u0434\u0430\u043d\u0430\u0441", "2026-10-14"],
      ["\u0441\u0443\u0442\u0440\u0430", "2026-10-15"],
      ["\u043f\u0440\u0435\u043a\u043e\u0441\u0443\u0442\u0440\u0430", "2026-10-16"],
      ["\u0458\u0443\u0447\u0435", "2026-10-13"],
      ["\u043f\u0440\u0435\u043a\u0458\u0443\u0447\u0435", "2026-10-12"],
      // Case is a spelling too.
      ["Sutra", "2026-10-15"],
      // A time of day names its own day.
      ["2026-10-16T09:00", "2026-10-16"],
      ["2026-10-16", "2026-10-16"],
      // Day-first, the trailing dot optional, as Serbian writes a date.
      ["16.10.2026", "2026-10-16"],
      ["16.10.2026.", "2026-10-16"],
    ]) {
      expect([written, only(DAY, written)]).toEqual([written, resolved]);
    }
  });

  it("resolves a weekday to the next such day, never today, in both languages", () => {
    // 2026-10-14 is a Wednesday; the next Friday is the 16th and the next
    // Monday the 19th.
    for (const written of ["petak", "u petak", "slede\u0107i petak", "on Friday", "next Friday", "next friday"]) {
      expect([written, only(DAY, written)]).toEqual([written, "2026-10-16"]);
    }
    for (const written of ["ponedeljak", "slede\u0107i ponedeljak", "next monday"]) {
      expect([written, only(DAY, written)]).toEqual([written, "2026-10-19"]);
    }
    // The Cyrillic spelling of a weekday is the same weekday.
    for (const written of ["\u043f\u0435\u0442\u0430\u043a", "\u0441\u043b\u0435\u0434\u0435\u045b\u0438 \u043f\u0435\u0442\u0430\u043a"]) {
      expect([written, only(DAY, written)]).toEqual([written, "2026-10-16"]);
    }
    // Said ON the day itself it is the one a week away: a person who meant
    // today says "danas".
    expect(dayFrom("u petak", "2026-10-16")).toBe("2026-10-23");
    // Sunday is the last day of the week, and a week spelled as a word of its
    // own is the week rather than a second reading of "nedelja".
    expect(only(DAY, "u nedelju")).toBe("2026-10-18");
    expect(only(DAY, "za nedelju dana")).toBe("2026-10-21");
  });

  it("counts days, weeks and months forward from the turn's own day", () => {
    for (const [written, resolved] of [
      ["za 3 dana", "2026-10-17"],
      ["za tri dana", "2026-10-17"],
      ["in 3 days", "2026-10-17"],
      ["za dva dana", "2026-10-16"],
      ["za dve nedelje", "2026-10-28"],
      ["za 1 nedelju", "2026-10-21"],
      ["in 2 weeks", "2026-10-28"],
      ["za mesec dana", "2026-11-14"],
      ["in 1 month", "2026-11-14"],
      ["2 days from today", "2026-10-16"],
      ["3 weeks from now", "2026-11-04"],
      ["slede\u0107e nedelje", "2026-10-21"],
      ["next week", "2026-10-21"],
    ]) {
      expect([written, only(DAY, written)]).toEqual([written, resolved]);
    }
  });

  it("leaves a fraction of a day, week or month alone, because no day is named", () => {
    expect(only(DAY, "za pola meseca")).toBe("za pola meseca");
    expect(only(DAY, "za 1,5 nedelje")).toBe("za 1,5 nedelje");
    expect(only(DAY, "za pola sata")).toBe("za pola sata");
  });

  it("clamps a month to the month it lands in, at the month end and the year end", () => {
    // The 31st plus a month is the last day of February, never the 3rd of March.
    expect(dayFrom("za mesec dana", "2026-01-31")).toBe("2026-02-28");
    expect(dayFrom("za mesec dana", "2026-03-31")).toBe("2026-04-30");
    // Across a year boundary the month rolls and the day keeps its place.
    expect(dayFrom("za mesec dana", "2026-12-15")).toBe("2027-01-15");
    expect(dayFrom("za dva meseca", "2026-12-31")).toBe("2027-02-28");
    // Week arithmetic is day arithmetic, so it crosses the year without a clamp.
    expect(dayFrom("za dve nedelje", "2026-12-25")).toBe("2027-01-08");
  });

  it("reads a decimal comma, and leaves a thousands-grouped number alone", () => {
    expect(only({ type: "number" }, "1,5")).toBe(1.5);
    expect(only({ type: "number" }, "0,25")).toBe(0.25);
    expect(only({ type: "integer" }, "1,0")).toBe(1);
    // Three digits after the comma are a thousands group as easily as a
    // decimal, and this module does not guess between 1.5 and 1500.
    expect(only({ type: "number" }, "1,500")).toBe("1,500");
    // The rule belongs to a number field: a text field keeps what was written.
    expect(only({ type: "string" }, "1,5")).toBe("1,5");
  });

  it("reads the small numbers people spell out, in both languages", () => {
    for (const [written, value] of [
      ["jedan", 1],
      ["dva", 2],
      ["dve", 2],
      ["tri", 3],
      ["pet", 5],
      ["deset", 10],
      ["pola", 0.5],
      ["one", 1],
      ["two", 2],
      ["ten", 10],
      ["half", 0.5],
      // The Cyrillic spelling of a spelled number is the same number.
      ["\u0458\u0435\u0434\u0430\u043d", 1],
      ["\u0434\u0432\u0430", 2],
      ["\u043f\u0435\u0442", 5],
    ]) {
      expect([written, only({ type: "number" }, written)]).toEqual([written, value]);
    }
    // A word that is not one of the small numbers is not a number.
    expect(only({ type: "number" }, "dvadeset")).toBe("dvadeset");
  });

  it("maps a spelled unit onto the vocabulary the schema declares, and only onto that", () => {
    for (const [written, unit] of [
      ["gram", "g"],
      ["grama", "g"],
      ["kila", "kg"],
      ["kile", "kg"],
      ["kilogram", "kg"],
      ["litar", "l"],
      ["litra", "l"],
      ["litre", "l"],
      ["ml", "ml"],
      ["kom", "pcs"],
      ["komada", "pcs"],
      ["pcs", "pcs"],
      ["piece", "pcs"],
      ["pakovanje", "pack"],
      ["pack", "pack"],
      // The Cyrillic spelling of a unit is the same unit.
      ["\u043a\u0438\u043b\u0430", "kg"],
      ["\u043b\u0438\u0442\u0430\u0440", "l"],
    ]) {
      expect([written, only(PANTRY_UNIT, written)]).toEqual([written, unit]);
    }
    // A unit the field does not declare is handed to validation untouched,
    // because a silent substitution would be this module inventing a vocabulary.
    expect(only({ type: "string", enum: ["l"] }, "kila")).toBe("kila");
    expect(only({ type: "string", enum: ["km"] }, "kila")).toBe("kila");
  });

  it("fills a pantry call the way the user said it", () => {
    const pantry: JsonSchema = object({
      name: { type: "string", minLength: 1 },
      quantity: { type: "number", minimum: 0 },
      unit: { type: "string", enum: ["pcs", "g", "kg", "ml", "l", "pack"] },
      expiry: DAY,
    });
    expect(
      normalizeToolArguments(pantry, { name: "Mleko", quantity: "pola", unit: "kile" }, TODAY),
    ).toEqual({ name: "Mleko", quantity: 0.5, unit: "kg" });
    // The same call, with the number and the day written the way a person says
    // them, is the same call.
    expect(
      normalizeToolArguments(
        pantry,
        { name: "Mleko", quantity: "1,5", unit: "l", expiry: "za dva dana" },
        TODAY,
      ),
    ).toEqual({ name: "Mleko", quantity: 1.5, unit: "l", expiry: "2026-10-16" });
  });

  it("leaves a day it cannot read for validation rather than guessing", () => {
    expect(only(DAY, "neka budu\u0107a nedelja")).toBe("neka budu\u0107a nedelja");
    // A day that does not exist is not a day this module invents a value for.
    expect(only(DAY, "31.02.2026")).toBe("31.02.2026");
    // A count this module cannot read is not arithmetic it may perform.
    expect(only(DAY, "za dvadeset dana")).toBe("za dvadeset dana");
    expect(only(DAY, "in a week")).toBe("in a week");
    // A word that is a key of the object prototype is not a day word.
    expect(only(DAY, "constructor")).toBe("constructor");
    expect(only({ type: "number" }, "constructor")).toBe("constructor");
    // The day rule belongs to the PATTERN, not to the string: a plain text
    // field keeps the word the model wrote.
    expect(only({ type: "string" }, "sutra")).toBe("sutra");
  });

  it("wraps one item into the array the schema declared", () => {
    expect(only({ type: "array", items: { type: "string" } }, "Kupi vodu")).toEqual(["Kupi vodu"]);
    expect(only({ type: "array", items: { type: "string" } }, ["Kupi vodu"])).toEqual(["Kupi vodu"]);
    // Nothing at all is still nothing, in an array field too: a `""` there is
    // not the one empty string the field would otherwise become.
    expect(
      normalizeToolArguments(object({ tags: { type: "array", items: { type: "string" } } }), {
        tags: "",
      }, TODAY),
    ).toEqual({});
  });

  it("drops a property the schema does not declare when the object is closed", () => {
    const schema = object({ title: { type: "string", minLength: 1 } });
    expect(normalizeToolArguments(schema, { title: "x", extra: "y" }, TODAY)).toEqual({ title: "x" });
    // An object that declares itself open keeps what it did not name: refusing
    // it is validation's sentence to write, and a schema that accepts extra
    // keys has to keep them.
    const open: JsonSchema = { type: "object", properties: { title: { type: "string" } } };
    expect(normalizeToolArguments(open, { title: "x", extra: "y" }, TODAY)).toEqual({
      title: "x",
      extra: "y",
    });
  });

  it("walks one level of nested objects and of objects inside an array", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        task: object({ title: { type: "string", minLength: 1 }, due: DAY, note: { type: "string" } }, [
          "title",
        ]),
        tags: { type: "array", items: object({ label: { type: "string", minLength: 1 } }) },
      },
      additionalProperties: false,
    };
    expect(
      normalizeToolArguments(
        schema,
        {
          task: { title: "  Kupi vodu ", due: "sutra", note: "  " },
          // One item, written without the brackets: the mistake this whole
          // module exists to absorb.
          tags: { label: " posao ", extra: "x" },
        },
        TODAY,
      ),
    ).toEqual({
      task: { title: "Kupi vodu", due: "2026-10-15" },
      tags: [{ label: "posao" }],
    });
  });

  it("hands anything that is not an argument object straight on", () => {
    expect(normalizeToolArguments(object({}), "not an object", TODAY)).toBe("not an object");
    expect(normalizeToolArguments(object({}), null, TODAY)).toBeNull();
  });

  it("does not change the schema or the arguments it was given", () => {
    const schema = object({ due: DAY, note: { type: "string" } });
    const args = { due: "sutra", note: "  ", extra: "x" };
    const before = JSON.stringify([schema, args]);
    normalizeToolArguments(schema, args, TODAY);
    expect(JSON.stringify([schema, args])).toBe(before);
  });

  it("keeps an argument named __proto__ an own member, never the result's prototype", () => {
    const open: JsonSchema = { type: "object", properties: { title: { type: "string" } } };
    // What JSON.parse gives for a model's `{"__proto__": {...}}`: an OWN member.
    const args = JSON.parse('{"title":"Kupi vodu","__proto__":{"title":7,"admin":true}}') as unknown;
    const result = normalizeToolArguments(open, args, TODAY) as Record<string, unknown>;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result["admin"]).toBeUndefined();
    expect(result.title).toBe("Kupi vodu");
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
  });
});
