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

describe("normalizeToolArguments", () => {
  it("removes an optional property that carries nothing, and no required one", () => {
    for (const empty of [null, undefined, "", "   "]) {
      expect(normalizeToolArguments(object({ note: { type: "string" } }), { note: empty }, TODAY)).toEqual({});
    }
    // A required empty string is still a value: only the tool may decide what
    // „nothing" means for it.
    expect(only({ type: "string" }, "   ", true)).toBe("");
    // And a required null is how tasks.reschedule says „clear the due date".
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
    expect(only({ type: "number" }, "pet")).toBe("pet");
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
    expect(only({ type: "string", enum: ["niže", "više"] }, "nize")).toBe("niže");
    // Nothing matched: validation refuses it, and the refusal quotes the list.
    expect(only(priority, "medium")).toBe("medium");
  });

  it("resolves a day word, and a written date, against the turn's own day", () => {
    expect(only(DAY, "danas")).toBe("2026-10-14");
    expect(only(DAY, "today")).toBe("2026-10-14");
    expect(only(DAY, "sutra")).toBe("2026-10-15");
    expect(only(DAY, "tomorrow")).toBe("2026-10-15");
    expect(only(DAY, "prekosutra")).toBe("2026-10-16");
    expect(only(DAY, "day after tomorrow")).toBe("2026-10-16");
    expect(only(DAY, "juče")).toBe("2026-10-13");
    expect(only(DAY, "juce")).toBe("2026-10-13");
    expect(only(DAY, "yesterday")).toBe("2026-10-13");
    // Case is a spelling too.
    expect(only(DAY, "Sutra")).toBe("2026-10-15");
    // A time of day names its own day.
    expect(only(DAY, "2026-10-16T09:00")).toBe("2026-10-16");
    expect(only(DAY, "2026-10-16")).toBe("2026-10-16");
    // Day-first, the trailing dot optional, as Serbian writes a date.
    expect(only(DAY, "16.10.2026")).toBe("2026-10-16");
    expect(only(DAY, "16.10.2026.")).toBe("2026-10-16");
  });

  it("leaves a day it cannot read for validation rather than guessing", () => {
    expect(only(DAY, "sledeće nedelje")).toBe("sledeće nedelje");
    // A day that does not exist is not a day this module invents a value for.
    expect(only(DAY, "31.02.2026")).toBe("31.02.2026");
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
});
