import { describe, expect, it } from "vitest";
import { validateToolArguments } from "./schema.js";
import type { JsonSchema } from "./contract.js";

/** The shape the tool specs use: one required string, an integer with bounds, an array, an enum. */
const TASK_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 120 },
    priority: { type: "integer", minimum: 0, maximum: 5 },
    tags: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 3 },
    kind: { type: "string", enum: ["note", "task"] },
    done: { type: "boolean" },
  },
  required: ["title"],
  additionalProperties: false,
};

const args = (text: string): unknown => JSON.parse(text) as unknown;

describe("validateToolArguments", () => {
  it("accepts a call that matches, and hands the arguments back uncoerced", () => {
    const call = args('{"title":"Kupovina","priority":2,"tags":["a"],"kind":"task","done":false}');
    const check = validateToolArguments(TASK_SCHEMA, call);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.value).toBe(call);
  });

  it("names a missing required property", () => {
    expect(validateToolArguments(TASK_SCHEMA, {})).toEqual({
      ok: false,
      errors: ['/title: required property is missing'],
    });
  });

  it("refuses a wrong type and says what it got", () => {
    expect(validateToolArguments(TASK_SCHEMA, { title: 7 })).toEqual({
      ok: false,
      errors: ["/title: expected string, got number"],
    });
  });

  it("keeps integer and number apart, and does not coerce a numeric string", () => {
    expect(validateToolArguments(TASK_SCHEMA, { title: "x", priority: 2.5 })).toEqual({
      ok: false,
      errors: ["/priority: expected integer, got number"],
    });
    expect(validateToolArguments(TASK_SCHEMA, { title: "x", priority: "2" })).toEqual({
      ok: false,
      errors: ["/priority: expected integer, got string"],
    });
  });

  it("checks minimum and maximum with the value in the message", () => {
    expect(validateToolArguments(TASK_SCHEMA, { title: "x", priority: -1 })).toEqual({
      ok: false,
      errors: ["/priority: expected a value >= 0, got -1"],
    });
    expect(validateToolArguments(TASK_SCHEMA, { title: "x", priority: 9 })).toEqual({
      ok: false,
      errors: ["/priority: expected a value <= 5, got 9"],
    });
  });

  it("counts characters and items", () => {
    expect(validateToolArguments(TASK_SCHEMA, { title: "" })).toEqual({
      ok: false,
      errors: ["/title: expected at least 1 characters, got 0"],
    });
    expect(validateToolArguments(TASK_SCHEMA, { title: "x", tags: ["a", "b", "c", "d"] })).toEqual({
      ok: false,
      errors: ["/tags: expected at most 3 items, got 4"],
    });
  });

  it("drops an empty optional string, and refuses an empty required one", () => {
    // The shape that made this rule: the model called `tasks.create` with
    // `"description": ""`, which the spec's `minLength: 1` refused - a refusal
    // about a property the model believed it had left out.
    expect(validateToolArguments(TASK_SCHEMA, { title: "Kupovina", priority: "", tags: [] })).toEqual({
      ok: true,
      value: { title: "Kupovina", tags: [] },
    });
    expect(validateToolArguments(TASK_SCHEMA, { title: "Kupovina", kind: "   " })).toEqual({
      ok: true,
      value: { title: "Kupovina" },
    });
    // `title` is required: it is never dropped, so an empty one is a call to
    // refuse rather than to repair.
    expect(validateToolArguments(TASK_SCHEMA, { title: "" })).toEqual({
      ok: false,
      errors: ["/title: expected at least 1 characters, got 0"],
    });
    // Nothing else is read as absent: `0`, `false` and `[]` are values a model
    // chose to send.
    expect(validateToolArguments(TASK_SCHEMA, { title: "x", priority: 0, done: false })).toEqual({
      ok: true,
      value: { title: "x", priority: 0, done: false },
    });
  });

  it("drops an empty optional string wherever the schema says a property is", () => {
    const nested: JsonSchema = {
      type: "object",
      properties: {
        a: { type: "object", properties: { b: { type: "string", minLength: 1 } } },
        rows: { type: "array", items: { type: "object", properties: { c: { type: "string" } } } },
      },
      required: ["a"],
    };
    expect(validateToolArguments(nested, { a: { b: "" }, rows: [{ c: "x" }, { c: "" }] })).toEqual({
      ok: true,
      value: { a: {}, rows: [{ c: "x" }, {}] },
    });
  });

  it("drops an empty string without letting a property named __proto__ reach the prototype", () => {
    const hostile = args('{"title":"x","priority":"","__proto__":{"polluted":true}}');
    expect(validateToolArguments(TASK_SCHEMA, hostile)).toEqual({
      ok: false,
      errors: ["/__proto__: unexpected property"],
    });
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("walks array items and names the index", () => {
    expect(validateToolArguments(TASK_SCHEMA, { title: "x", tags: ["a", 2] })).toEqual({
      ok: false,
      errors: ["/tags/1: expected string, got number"],
    });
  });

  it("lists an enum's allowed values", () => {
    expect(validateToolArguments(TASK_SCHEMA, { title: "x", kind: "event" })).toEqual({
      ok: false,
      errors: ['/kind: expected one of "note", "task", got "event"'],
    });
  });

  it("refuses an undeclared property when the schema closes the object", () => {
    expect(validateToolArguments(TASK_SCHEMA, { title: "x", extra: 1 })).toEqual({
      ok: false,
      errors: ["/extra: unexpected property"],
    });
  });

  it("refuses arguments that are not an object at all", () => {
    expect(validateToolArguments(TASK_SCHEMA, "prose instead of JSON")).toEqual({
      ok: false,
      errors: ["(root): expected object, got string"],
    });
    expect(validateToolArguments(TASK_SCHEMA, null)).toEqual({
      ok: false,
      errors: ["(root): expected object, got null"],
    });
  });

  it("collects every finding, in the schema's own order", () => {
    expect(validateToolArguments(TASK_SCHEMA, { priority: 1.5, kind: "nope", extra: true })).toEqual({
      ok: false,
      errors: [
        "/title: required property is missing",
        "/priority: expected integer, got number",
        '/kind: expected one of "note", "task", got "nope"',
        "/extra: unexpected property",
      ],
    });
  });

  it("reads a property name as a path, escaping the pointer", () => {
    const schema: JsonSchema = { type: "object", properties: { "a/b": { type: "string" } } };
    expect(validateToolArguments(schema, { "a/b": 1 })).toEqual({
      ok: false,
      errors: ["/a~1b: expected string, got number"],
    });
  });

  it("ignores a keyword outside the subset instead of refusing a valid call", () => {
    const schema: JsonSchema = { type: "object", properties: { a: { type: "string", pattern: "^x" } } };
    expect(validateToolArguments(schema, { a: "y" })).toEqual({ ok: true, value: { a: "y" } });
  });

  it("never throws, and never lets a JSON object reach the prototype", () => {
    const hostile = args('{"title":"x","__proto__":{"polluted":true}}');
    expect(validateToolArguments(TASK_SCHEMA, hostile)).toEqual({
      ok: false,
      errors: ["/__proto__: unexpected property"],
    });
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});
