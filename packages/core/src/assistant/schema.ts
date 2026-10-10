/**
 * The slice of JSON Schema the tool specs actually use, and a validator for it.
 *
 * A model's tool call arrives as TEXT that was parsed as JSON, so every
 * argument is `unknown` until something checks it ({@link ToolCall.arguments}).
 * The tool itself validates semantics, but a call whose SHAPE is wrong must
 * never reach the tool: a router that reads `args.id` from a missing property
 * is a crash inside main, and the contract's answer is that a bad call goes
 * back to the model as a tool error so it can correct itself
 * (`loop.ts`).
 *
 * **The supported subset is small on purpose** - `type` (object, string,
 * number, integer, boolean, array, null), `properties`, `required`, `items`,
 * `enum`, `additionalProperties: false`, `minimum`, `maximum`, `minLength`,
 * `maxLength`, `minItems`, `maxItems`. That is what `ToolSpec.parameters`
 * carries, and a validator that ignored a keyword it does not know would report
 * a call as valid while the tool believed something else. Anything the schema
 * says that is NOT in that list is ignored deliberately, and the tools validate
 * their own input regardless (`contract.ts`), so the subset stays honest
 * instead of pretending to be a complete JSON Schema implementation.
 *
 * Nothing here throws, and nothing coerces: `"5"` is not a `5`, `"yes"` is not
 * a `true`. A silently coerced call is a call the model never learns was wrong.
 */

import type { JsonSchema } from "./contract.js";

export interface ToolArgumentsValid {
  readonly ok: true;
  /** The arguments as they arrived, uncoerced. */
  readonly value: unknown;
}

export interface ToolArgumentsInvalid {
  readonly ok: false;
  /** One line per problem, each naming the path it is about. Empty strings are not produced. */
  readonly errors: readonly string[];
}

export type ToolArgumentsCheck = ToolArgumentsValid | ToolArgumentsInvalid;

/** Validate one tool call's arguments against the tool's own schema. */
export function validateToolArguments(schema: JsonSchema, args: unknown): ToolArgumentsCheck {
  const errors: string[] = [];
  validate(schema, args, "", errors);
  return errors.length === 0 ? { ok: true, value: args } : { ok: false, errors };
}

function validate(schema: JsonSchema, value: unknown, path: string, errors: string[]): void {
  const type = readString(schema["type"]);
  if (type !== undefined && !matchesType(type, value)) {
    errors.push(`${display(path)}: expected ${type}, got ${describe(value)}`);
    return;
  }

  if (Array.isArray(schema["enum"])) {
    const allowed = schema["enum"] as readonly unknown[];
    if (!allowed.some((candidate) => Object.is(candidate, value))) {
      errors.push(
        `${display(path)}: expected one of ${allowed.map(short).join(", ")}, got ${short(value)}`,
      );
    }
  }

  if (typeof value === "string") {
    checkBound(schema, "minLength", value.length, errors, (bound) =>
      `${display(path)}: expected at least ${bound} characters, got ${value.length}`,
    );
    checkBound(schema, "maxLength", value.length, errors, (bound) =>
      `${display(path)}: expected at most ${bound} characters, got ${value.length}`,
    );
  }

  if (typeof value === "number") {
    checkBound(schema, "minimum", value, errors, (bound) =>
      `${display(path)}: expected a value >= ${bound}, got ${value}`,
    );
    checkBound(schema, "maximum", value, errors, (bound) =>
      `${display(path)}: expected a value <= ${bound}, got ${value}`,
    );
  }

  if (Array.isArray(value)) {
    checkBound(schema, "minItems", value.length, errors, (bound) =>
      `${display(path)}: expected at least ${bound} items, got ${value.length}`,
    );
    checkBound(schema, "maxItems", value.length, errors, (bound) =>
      `${display(path)}: expected at most ${bound} items, got ${value.length}`,
    );
    const items = schema["items"];
    if (items !== null && typeof items === "object" && !Array.isArray(items)) {
      value.forEach((element, index) => {
        validate(items as JsonSchema, element, `${path}/${index}`, errors);
      });
    }
  }

  if (isPlainObject(value)) {
    const properties = isPlainObject(schema["properties"]) ? schema["properties"] : undefined;
    const required = Array.isArray(schema["required"])
      ? (schema["required"] as readonly unknown[]).filter(
          (name): name is string => typeof name === "string",
        )
      : [];
    for (const name of required) {
      if (!Object.hasOwn(value, name) || value[name] === undefined) {
        errors.push(`${display(`${path}/${escapePointer(name)}`)}: required property is missing`);
      }
    }
    if (properties !== undefined) {
      for (const [name, child] of Object.entries(properties)) {
        if (Object.hasOwn(value, name) && value[name] !== undefined) {
          validate((child ?? {}) as JsonSchema, value[name], `${path}/${escapePointer(name)}`, errors);
        }
      }
    }
    if (schema["additionalProperties"] === false) {
      for (const name of Object.keys(value)) {
        if (properties === undefined || !Object.hasOwn(properties, name)) {
          errors.push(`${display(`${path}/${escapePointer(name)}`)}: unexpected property`);
        }
      }
    }
  }
}

/** A `min*`/`max*` keyword, when the schema states it as a finite number. */
function checkBound(
  schema: JsonSchema,
  keyword: string,
  value: number,
  errors: string[],
  message: (bound: number) => string,
): void {
  const bound = schema[keyword];
  if (typeof bound !== "number" || !Number.isFinite(bound)) return;
  const lower = keyword.startsWith("min");
  if (lower ? value < bound : value > bound) errors.push(message(bound));
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
    case "null":
      return value === null;
    default:
      // A type name this subset does not know: the tool validates its own input,
      // and refusing a call because OUR reader is old would be the loop lying
      // about the schema.
      return true;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON-pointer escaping, so a property named `a/b` is not read as a path. */
function escapePointer(name: string): string {
  return name.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** The path a finding is about; the root has no pointer, so it is named. */
function display(path: string): string {
  return path.length === 0 ? "(root)" : path;
}

/** What a value IS, for a message a model can act on. */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  return type === "number" && !Number.isFinite(value) ? "number" : type;
}

/** A value as it is written in a message, short enough for a prompt line. */
function short(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return describe(value);
}
