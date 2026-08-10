/**
 * `json-to-types` — a JSON sample turned into the type declarations a person
 * would have written by hand.
 *
 * **Why this is not fifty lines.** The naive generator walks the sample, emits
 * one interface per object named after its key, and reads the FIRST element of
 * every array. On a real API payload that produces three things nobody wants: a
 * field marked required because it happened to be present in element zero, a
 * `User`, `User2` and `User3` that are the same shape three times, and a type
 * that disagrees with the data the moment element one arrives. Every rule below
 * exists because of one of those.
 *
 * **One model, three emitters.** Inference produces a `TypeNode` tree; a naming
 * pass turns repeated shapes into named declarations plus refs; the emitters are
 * pure renderers over that. Writing three walkers instead would guarantee that
 * the Zod output and the interface output eventually disagree about the same
 * sample, and no test written per-target would notice.
 *
 * **Inference is structural; naming is a separate pass.** A `TypeNode` never
 * carries a name suggestion, because a shape's identity must not depend on where
 * it was found — that is precisely what lets two objects reached by different
 * key paths merge into one declaration. The naming pass re-walks the tree with
 * the key path in hand and hands out names afterwards.
 *
 * **The traps this module is built around, named so nobody re-discovers them:**
 *
 * - `{}` in TypeScript does NOT mean "an object with no fields" — it means
 *   anything that is not `null` or `undefined`. An empty object in the sample
 *   therefore emits `Record<string, unknown>`, which says what is actually
 *   known: it is an object, and the sample showed no fields.
 * - Zod schemas are `const` bindings, so a schema used before it is declared is
 *   a runtime TDZ error. Interfaces are hoisted and do not care. The declaration
 *   order is therefore per-target: discovery order (top-down, reads best) for
 *   TypeScript, dependency order for Zod.
 * - A type named `Date`, `Object` or `Error` does NOT merge with the lib global
 *   of that name — every declaration this module emits is `export`ed, so the
 *   output is a MODULE, and a module-scoped `interface`/`type` never merges
 *   with an ambient global. It still SHADOWS the global in every TYPE position
 *   in that module: `new Date()` keeps resolving to the real constructor, but a
 *   field typed `Date` resolves to the local declaration instead. Such names
 *   get a `Type` suffix so a reader is never left guessing which `Date` a
 *   signature means.
 * - `T | null[]` parses as `T | (null[])`. Any array whose element renders as a
 *   union or an inline object is emitted through `Array<…>` instead of `…[]`.
 * - A string format read off a sample is a GUESS. It is kept as a comment and
 *   never as a validator: emitting `z.string().email()` from three sample rows
 *   builds a schema that rejects real data, which is worse than no schema at
 *   all. The type stays `string` in all three targets.
 * - `__proto__` is a legal JSON key and `JSON.parse` really does produce it as an
 *   own property. Every accumulator keyed by field name here is a `Map`, never a
 *   plain object, so a payload cannot reach into one.
 * - `Object.keys` returns integer-like keys first, in ascending numeric order,
 *   whatever the text said. Field order follows JS own-property order because
 *   the sample's textual order is not recoverable from a parsed value.
 * - A deeply nested sample, or a hand-built `TypeNode` that references itself,
 *   would eventually overflow the real call stack — and WHERE that happens is a
 *   property of the engine, the OS thread, and even prior calls in the same
 *   process (a cold call overflows far earlier than a JIT-warmed one), never a
 *   number this module could promise. `MAX_NESTING_DEPTH` replaces that with a
 *   small, fixed, measured bound that every recursive stage checks for itself.
 *
 * **Refusal, never repair.** Input that is not JSON, or nests deeper than
 * `MAX_NESTING_DEPTH`, yields a typed refusal from `jsonToTypes` — never a
 * best-effort parse and never a thrown error. `buildTypeModel` and `emitTypes`
 * sit one level lower: they take a `JsonValue`/`TypeNode`/`TypeModel` a caller
 * assembles directly, which nothing stops from being self-referential, so for
 * them the same limit surfaces as a thrown `NestingTooDeepError` instead.
 */

/* ------------------------------------------------------------------ JSON in */

/** Exactly the values `JSON.parse` can produce. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Why a sample was refused. `detail` carries the engine's message for the syntax case. */
export type JsonSampleError = "empty" | "syntax";

export type JsonSampleResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly reason: JsonSampleError; readonly detail: string };

/**
 * The one door text comes through. A sample that is not JSON is refused with a
 * reason the surface can translate, plus the engine's own message — which names
 * a character offset and is the only thing that helps a user find the typo.
 */
export function parseJsonSample(text: string): JsonSampleResult {
  if (text.trim() === "") return { ok: false, reason: "empty", detail: "" };
  try {
    // `JSON.parse` is typed `any`, which this codebase does not admit. The cast
    // is sound rather than convenient: the call either produced a `JsonValue` or
    // threw, and there is no third outcome.
    const value = JSON.parse(text) as JsonValue;
    return { ok: true, value };
  } catch (error) {
    return { ok: false, reason: "syntax", detail: error instanceof Error ? error.message : "" };
  }
}

/**
 * Narrowing helper: `Array.isArray`'s own predicate does not narrow a readonly
 * array out of a union.
 */
function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/* ------------------------------------------------------------ the depth guard */

/**
 * How many levels of nesting a sample — or a hand-built `TypeNode`/`TypeModel`
 * handed straight to `buildTypeModel`/`emitTypes` — may go before every
 * recursive stage below refuses to follow it any further.
 *
 * MEASURED here, not guessed, by walking the real `jsonToTypes` pipeline
 * (parse → infer → canonical/link → emit) over `{"a": … }` nested to various
 * depths, in this environment's Vitest worker. A COLD call — the first call in
 * a fresh process, which is what a user's first click actually is — survives
 * 2 200 levels and overflows the real stack at 2 300. A WARM process (the same
 * functions called repeatedly first, as a test file that exercises this module
 * before reaching the deep case does) survives past 4 000, because V8 shrinks a
 * hot function's frame once it is optimised. That gap is exactly why the limit
 * cannot be "the largest number that worked in one run" — that number moves
 * with the engine, the OS thread and the call history. 500 leaves better than
 * 4x headroom under the LOWER of the two measured failures.
 */
export const MAX_NESTING_DEPTH = 500;

/**
 * Thrown by every guarded recursive stage the instant its own depth counter
 * crosses `MAX_NESTING_DEPTH`, instead of continuing until the real call stack
 * gives out. A named, fixed-depth, deterministic failure is strictly more
 * useful than the `RangeError` it replaces: that error's depth is a property of
 * the engine, the call history and the OS thread — none of it under this
 * module's control, or stable between two calls, let alone two machines.
 *
 * `jsonToTypes` is the one caller with a typed refusal to fall back to, and
 * catches this to produce one. `buildTypeModel` and `emitTypes` take a
 * `JsonValue`/`TypeNode`/`TypeModel` a caller can assemble by hand — nothing
 * stops a self-referential object from reaching either directly — so for them
 * this is allowed to surface as a thrown error; it is exported so such a caller
 * can catch it by name instead of guessing at `RangeError`.
 */
export class NestingTooDeepError extends Error {
  constructor() {
    super(`nesting exceeds ${MAX_NESTING_DEPTH} levels`);
    this.name = "NestingTooDeepError";
  }
}

/** The one check every guarded stage below opens with. */
function guardDepth(level: number): void {
  if (level > MAX_NESTING_DEPTH) throw new NestingTooDeepError();
}

/* -------------------------------------------------------------- the model */

/** Formats worth NOTING on a string field. Every one of them stays typed `string`. */
export const STRING_FORMATS = ["date-time", "date", "uuid", "email", "url"] as const;

export type StringFormat = (typeof STRING_FORMATS)[number];

/**
 * A type as the model holds it. `ref` appears only after the naming pass, and
 * `unknown` only where the sample carried no evidence at all (an empty array's
 * element).
 */
export type TypeNode =
  | { readonly kind: "string"; readonly format?: StringFormat }
  | { readonly kind: "number" }
  | { readonly kind: "boolean" }
  | { readonly kind: "null" }
  | { readonly kind: "unknown" }
  | { readonly kind: "array"; readonly element: TypeNode }
  | { readonly kind: "object"; readonly fields: readonly TypeField[] }
  | { readonly kind: "union"; readonly members: readonly TypeNode[] }
  | { readonly kind: "ref"; readonly name: string };

/**
 * One property. `optional` means the sample showed at least one object of this
 * shape without the key.
 */
export interface TypeField {
  readonly key: string;
  readonly type: TypeNode;
  readonly optional: boolean;
}

/**
 * A declaration the emitters will write out. `node` is always an object node
 * with at least one field.
 */
export interface NamedType {
  readonly name: string;
  readonly node: TypeNode;
}

/**
 * The intermediate model — the actual design of this module. `root` is normally
 * a `ref` to `rootName`; it is a structural node when the sample's top level is
 * an array or a primitive, and then the emitter writes a root alias.
 */
export interface TypeModel {
  readonly rootName: string;
  readonly root: TypeNode;
  /** Declarations in discovery order: root first, then depth-first through its fields. */
  readonly types: readonly NamedType[];
}

const NULL_NODE: TypeNode = { kind: "null" };
const NUMBER_NODE: TypeNode = { kind: "number" };
const BOOLEAN_NODE: TypeNode = { kind: "boolean" };
const UNKNOWN_NODE: TypeNode = { kind: "unknown" };

/**
 * `exactOptionalPropertyTypes` forbids `{ format: undefined }` — and rightly:
 * "no format" is an absent field, not a field holding nothing.
 */
function stringNode(format: StringFormat | undefined): TypeNode {
  return format === undefined ? { kind: "string" } : { kind: "string", format };
}

/* ------------------------------------------------------------ the options */

export const JSON_TYPE_TARGETS = ["interface", "type", "zod"] as const;

export type JsonTypeTarget = (typeof JSON_TYPE_TARGETS)[number];

/** How an optional field is spelled. The two differ under `exactOptionalPropertyTypes`. */
export type OptionalStyle = "question" | "undefined";

export interface JsonTypeOptions {
  readonly target: JsonTypeTarget;
  /** Already PascalCased and made shadow-safe by `resolveJsonTypeOptions`. */
  readonly rootName: string;
  /** `readonly` on every property and array. Defaults on for the `type` target, off elsewhere. */
  readonly useReadonly: boolean;
  /**
   * `key?: T` versus `key: T | undefined`. Ignored by the Zod target, where
   * `.optional()` is the only spelling and covers both.
   */
  readonly optionalStyle: OptionalStyle;
  /** Emit a type used exactly once inline at its single use site instead of as a declaration. */
  readonly inlineSingleUse: boolean;
}

export const DEFAULT_ROOT_NAME = "Root";

/**
 * The options with every gap filled.
 *
 * `useReadonly` defaults to whether the target is `type`, because a `type` alias
 * is where `readonly` is idiomatic and an `interface` is where it is noise —
 * but it stays an independent switch, so neither default is a decision the
 * caller cannot undo.
 *
 * `rootName` is normalised HERE and nowhere else: it is PascalCased and given
 * the same shadow-safety treatment as a key-derived name, so a root called
 * `date` cannot emit an `interface Date` that merges with the lib global.
 */
export function resolveJsonTypeOptions(partial?: Partial<JsonTypeOptions>): JsonTypeOptions {
  const target = partial?.target ?? "interface";
  const requested = partial?.rootName ?? "";
  const rootName =
    requested.trim() === "" ? DEFAULT_ROOT_NAME : shadowSafe(toPascalCase(requested));
  return {
    target,
    rootName,
    useReadonly: partial?.useReadonly ?? target === "type",
    optionalStyle: partial?.optionalStyle ?? "question",
    inlineSingleUse: partial?.inlineSingleUse ?? false,
  };
}

/* ----------------------------------------------------------- string formats */

// RFC 3339 §5.6, spelled out rather than approximated: the month, day, hour and
// minute ranges are in the grammar, and second 60 is admitted because the RFC
// admits leap seconds. There is no calendar validation — 2026-02-30 has the
// shape of a date and this is a note, not a validator.
const RFC3339_DATE = String.raw`\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])`;
const RFC3339_TIME = String.raw`(?:[01]\d|2[0-3]):[0-5]\d:(?:[0-5]\d|60)(?:\.\d+)?`;
const RFC3339_OFFSET = String.raw`(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)`;

/**
 * The offset is OPTIONAL here although RFC 3339 requires it, because ISO 8601
 * local time does not and half the payloads in the world are `…T10:15:30`. The
 * note says „ISO 8601 date-time", which is true of both; it deliberately does
 * not claim the value is unambiguous. The space separator is RFC 3339's own
 * §5.6 NOTE alternative and what SQL timestamps use.
 */
const DATE_TIME_PATTERN = new RegExp(
  `^${RFC3339_DATE}[Tt ]${RFC3339_TIME}${RFC3339_OFFSET}?$`,
);

const DATE_PATTERN = new RegExp(`^${RFC3339_DATE}$`);

// RFC 9562 §4: the version nibble is 1–8 and the variant nibble is one of
// 8/9/a/b. The Nil (§5.9) and Max (§5.10) UUIDs satisfy neither and are named
// separately — they are real values that appear in real payloads, and refusing
// them would drop the note for a whole column because one row was nil.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_NIL = "00000000-0000-0000-0000-000000000000";
const UUID_MAX = "ffffffff-ffff-ffff-ffff-ffffffffffff";

/**
 * Deliberately far narrower than RFC 5322, which no regex implements correctly.
 * One `@`, no whitespace, and a dotted domain. A hint that is wrong is worse
 * than a hint that is missing, so this errs towards missing.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/**
 * Only the two schemes whose note is useful. The slashes are escaped, so no
 * literal URL appears anywhere in this source.
 */
const URL_PATTERN = /^https?:\/\/[^\s/?#]+[^\s]*$/i;

/**
 * The format a string value looks like, or `undefined`.
 *
 * The order is fixed and pinned by tests: UUID, then date-time, then date, then
 * email, then URL — narrowest first, so the loosest pattern never claims a value
 * a stricter one already recognised.
 */
export function detectStringFormat(value: string): StringFormat | undefined {
  if (UUID_PATTERN.test(value) || value === UUID_NIL || value.toLowerCase() === UUID_MAX) {
    return "uuid";
  }
  if (DATE_TIME_PATTERN.test(value)) return "date-time";
  if (DATE_PATTERN.test(value)) return "date";
  if (EMAIL_PATTERN.test(value)) return "email";
  if (URL_PATTERN.test(value)) return "url";
  return undefined;
}

const FORMAT_NOTES: Readonly<Record<StringFormat, string>> = {
  "date-time": "ISO 8601 date-time",
  date: "ISO 8601 date",
  uuid: "UUID",
  email: "email address",
  url: "HTTP(S) URL",
};

/** Said out loud because a field typed `null` is otherwise indistinguishable from a mistake. */
const ALL_NULL_NOTE = "only null in the sample";

/**
 * The format carried by a field's string values, looking through `| null` and
 * through arrays — the note describes the strings wherever they sit, so
 * `ids: string[]` of UUIDs is noted the same way a scalar one is.
 *
 * A union with more than one non-null member has no single answer and gets none.
 */
function findFormat(node: TypeNode): StringFormat | undefined {
  switch (node.kind) {
    case "string":
      return node.format;
    case "array":
      return findFormat(node.element);
    case "union": {
      const rest = node.members.filter((member) => member.kind !== "null");
      const only = rest[0];
      return rest.length === 1 && only !== undefined ? findFormat(only) : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * The one comment a field may carry: what its strings looked like, or that it
 * was never anything but null.
 */
function fieldNote(type: TypeNode): string | null {
  if (type.kind === "null") return ALL_NULL_NOTE;
  const format = findFormat(type);
  return format === undefined ? null : FORMAT_NOTES[format];
}

/* ------------------------------------------------------------- inference */

type ObjectNode = Extract<TypeNode, { kind: "object" }>;

/**
 * Two nodes folded into one, or `null` when they are different things and have
 * to stand side by side in a union.
 *
 * Objects MERGE rather than union — this is requirement one of the whole tool.
 * `[{ a }, { b }]` is one shape with two optional fields, not two shapes; a
 * union of object types would be technically defensible and useless to write
 * code against.
 *
 * Arrays merge element-wise for the same reason: `[[1], ["a"]]` is more usable
 * as `(number | string)[][]` than as `number[][] | string[][]`.
 *
 * Two strings keep a format only if they AGREE on it. One plain string among
 * fifty UUIDs means the column is not UUIDs, and the note has to go — silently
 * keeping the first value's format is how a generator ends up asserting
 * something the sample already contradicted.
 */
function mergeMembers(left: TypeNode, right: TypeNode): TypeNode | null {
  if (left.kind === "object" && right.kind === "object") return mergeObjects(left, right);
  if (left.kind === "array" && right.kind === "array") {
    return { kind: "array", element: unionOf(left.element, right.element) };
  }
  if (left.kind === "string" && right.kind === "string") {
    return left.format !== undefined && left.format === right.format ? left : { kind: "string" };
  }
  return left.kind === right.kind ? left : null;
}

/**
 * Two objects folded field-wise. A key present in only one of them becomes
 * optional; a key in both keeps the union of its types and is optional if it was
 * optional anywhere.
 *
 * Field order is the left operand's, with the right's new keys appended — so
 * folding an array left-to-right preserves the order the first element declared,
 * which is the order the API's author chose.
 *
 * The lookup is a `Map` because a payload may legally contain `__proto__`, and a
 * plain-object accumulator keyed by user data is how that becomes someone
 * else's problem.
 */
function mergeObjects(left: ObjectNode, right: ObjectNode): ObjectNode {
  const rightByKey = new Map(right.fields.map((field) => [field.key, field] as const));
  const leftKeys = new Set(left.fields.map((field) => field.key));

  const fields: TypeField[] = left.fields.map((field) => {
    const other = rightByKey.get(field.key);
    return other === undefined
      ? { key: field.key, type: field.type, optional: true }
      : {
          key: field.key,
          type: unionOf(field.type, other.type),
          optional: field.optional || other.optional,
        };
  });
  for (const field of right.fields) {
    if (!leftKeys.has(field.key)) fields.push({ key: field.key, type: field.type, optional: true });
  }
  return { kind: "object", fields };
}

/** Flattening keeps unions one level deep, so a union never has a union inside it. */
function unionMembers(node: TypeNode): readonly TypeNode[] {
  return node.kind === "union" ? node.members : [node];
}

function addMember(members: TypeNode[], node: TypeNode): void {
  for (let index = 0; index < members.length; index += 1) {
    const existing = members[index];
    if (existing === undefined) continue;
    const merged = mergeMembers(existing, node);
    if (merged !== null) {
      members[index] = merged;
      return;
    }
  }
  members.push(node);
}

/**
 * `null` is moved to the END rather than treated as a type of its own, so a
 * field reads `string | null` — which is what a person writes.
 *
 * `unknown` is EVIDENCE-FREE and loses to anything: it enters only from an empty
 * array, and `[[], [1]]` must come out `number[][]`, not `(unknown | number)[][]`.
 */
function finishUnion(members: readonly TypeNode[]): TypeNode {
  const real = members.length > 1 ? members.filter((node) => node.kind !== "unknown") : members;
  const [first] = real;
  if (first === undefined) return UNKNOWN_NODE;
  if (real.length === 1) return first;
  const nulls = real.filter((node) => node.kind === "null");
  const rest = real.filter((node) => node.kind !== "null");
  return { kind: "union", members: [...rest, ...nulls] };
}

function unionOf(left: TypeNode, right: TypeNode): TypeNode {
  const members: TypeNode[] = [];
  for (const node of unionMembers(left)) addMember(members, node);
  for (const node of unionMembers(right)) addMember(members, node);
  return finishUnion(members);
}

/** An array's element type, folded over EVERY element — the rule a naive generator misses. */
function inferElements(items: readonly JsonValue[], level: number): TypeNode {
  let element: TypeNode = UNKNOWN_NODE;
  for (const item of items) element = unionOf(element, inferValue(item, level));
  return element;
}

function inferObject(value: { readonly [key: string]: JsonValue }, level: number): TypeNode {
  const fields: TypeField[] = [];
  // `Object.keys` order, which puts integer-like keys first — the sample's
  // textual order did not survive `JSON.parse` and cannot be recovered here.
  for (const key of Object.keys(value)) {
    const child = value[key];
    // Unreachable for a parsed value; `noUncheckedIndexedAccess` is right to
    // make it sayable, and skipping is the only honest response.
    if (child === undefined) continue;
    fields.push({ key, type: inferValue(child, level), optional: false });
  }
  return { kind: "object", fields };
}

/**
 * A value's structure. No names are assigned here — see the module doc.
 *
 * `level` counts one per array/object hop and is checked against
 * `MAX_NESTING_DEPTH` on every call — see „the depth guard" above. This is the
 * single choke point every `JsonValue` passed to `buildTypeModel` (directly, or
 * via `jsonToTypes`) must go through to become a `TypeNode`, so guarding it here
 * bounds the tree that `canonical`/`link`/the emitters walk afterwards too.
 */
function inferValue(value: JsonValue, level = 0): TypeNode {
  guardDepth(level);
  if (value === null) return NULL_NODE;
  if (typeof value === "boolean") return BOOLEAN_NODE;
  if (typeof value === "number") return NUMBER_NODE;
  if (typeof value === "string") return stringNode(detectStringFormat(value));
  if (isJsonArray(value)) return { kind: "array", element: inferElements(value, level + 1) };
  return inferObject(value, level + 1);
}

/* ----------------------------------------------------------------- naming */

/**
 * A shape's identity, as a string that is equal for two shapes a person would
 * call the same type.
 *
 * Keys and union members are SORTED, so `{ a, b }` and `{ b, a }` are one type.
 * The sort is `Array.prototype.sort`'s default UTF-16 code-unit order,
 * deliberately: this key is compared by machines for equality, and
 * `Intl.Collator(["sr-Latn","sr"])` — the right sort for anything a person reads
 * — would make the key depend on the machine's ICU tailoring, so the same sample
 * could produce different type names on two computers.
 *
 * A string's FORMAT is deliberately absent. It is a comment, not structure, and
 * including it would emit two byte-identical interfaces differing only in a note
 * line — exactly the `User`/`User2` problem this pass exists to prevent.
 * Optionality IS included: `{ a?: T }` and `{ a: T }` are different types, and
 * folding them together would erase the knowledge that one of the two always has
 * the field.
 *
 * Guarded independently of `inferValue`'s own guard, rather than relying on it:
 * every call here is fresh (from `collectShapes`, from `link`, from the field
 * loop below), each starting its own walk over a subtree, and a `TypeNode` can
 * reach this function without ever having passed through `inferValue` — a
 * hand-built one hasn't. See „the depth guard" above.
 */
function canonical(node: TypeNode, level = 0): string {
  guardDepth(level);
  switch (node.kind) {
    case "string":
    case "number":
    case "boolean":
    case "null":
    case "unknown":
      return node.kind;
    case "array":
      return `[${canonical(node.element, level + 1)}]`;
    case "union":
      return `(${node.members
        .map((member) => canonical(member, level + 1))
        .sort()
        .join("|")})`;
    case "object":
      return `{${node.fields
        .map((f) => {
          const type = canonical(f.type, level + 1);
          return `${JSON.stringify(f.key)}${f.optional ? "?" : ""}:${type}`;
        })
        .sort()
        .join(",")}}`;
    case "ref":
      return `ref(${node.name})`;
  }
}

/** A key turned into a type name: `user_profile` and `userProfile` both become `UserProfile`. */
function toPascalCase(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== "");
  const joined = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
  if (joined === "") return "Type";
  // A name has to be a legal identifier, and a key like `2fa` does not start
  // like one. Prefixing keeps the digits rather than dropping them.
  return /^[A-Za-z_$]/.test(joined) ? joined : `Type${joined}`;
}

/**
 * Lib globals this module never reuses as a declaration name. Every declaration
 * it emits is `export`ed — making the output a MODULE — so `interface Date {
 * day: number }` here would NOT merge with the lib global the way it would in a
 * script; `new Date()` keeps calling the real constructor either way. It would
 * still SHADOW the global in every TYPE position in that module: a field typed
 * `Date` would silently mean the local declaration, not `lib.dom.d.ts`'s. That
 * is confusing enough on its own, so such names get a `Type` suffix instead.
 */
const SHADOWED_GLOBALS: ReadonlySet<string> = new Set([
  "Array",
  "BigInt",
  "Boolean",
  "Date",
  "Error",
  "Function",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Promise",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "WeakMap",
  "WeakSet",
]);

function shadowSafe(name: string): string {
  return SHADOWED_GLOBALS.has(name) ? `${name}Type` : name;
}

/**
 * English plurals the regex rules below get wrong. An exhaustive pluraliser is a
 * bottomless pit; this covers the words that actually appear as payload keys and
 * leaves everything else alone. A name that stayed plural is a cosmetic miss —
 * it is never a wrong type.
 */
const IRREGULAR_PLURALS: ReadonlyMap<string, string> = new Map([
  ["children", "Child"],
  ["people", "Person"],
  ["men", "Man"],
  ["women", "Woman"],
  ["indices", "Index"],
  ["matrices", "Matrix"],
  ["vertices", "Vertex"],
  ["series", "Series"],
  ["species", "Species"],
  ["news", "News"],
  ["data", "Data"],
  ["media", "Media"],
  ["metadata", "Metadata"],
]);

/** `Users` → `User`, `Categories` → `Category`, `Addresses` → `Address`, `Status` → `Status`. */
function singularizeName(name: string): string {
  const irregular = IRREGULAR_PLURALS.get(name.toLowerCase());
  if (irregular !== undefined) return irregular;
  // `Status`, `Analysis`, `Atlas`, `Chaos` — singular words that end in `s`.
  if (/(?:ss|us|is|as|os)$/i.test(name)) return name;
  if (/ies$/i.test(name) && name.length > 4) return `${name.slice(0, -3)}y`;
  if (/(?:ch|sh|s|x|z)es$/i.test(name)) return name.slice(0, -2);
  if (/s$/i.test(name)) return name.slice(0, -1);
  return name;
}

/**
 * The name suggestion for the elements of the TOP-LEVEL array.
 *
 * The root alias has already claimed `rootName`, so an already-singular root name
 * cannot also be the element's. `RootItem` is chosen over letting the
 * de-duplicator answer `Root2`, which is what a generator produces when nobody
 * thought about the most common payload shape there is.
 */
function rootElementHint(rootName: string): string {
  const singular = singularizeName(rootName);
  return singular === rootName ? `${rootName}Item` : singular;
}

/**
 * A group of structurally identical objects. `name` is a placeholder until the
 * naming pass, immediately below, fills it in.
 */
interface ShapeGroup {
  readonly hint: string;
  readonly members: ObjectNode[];
  name: string;
}

/**
 * Every non-empty object shape in the tree, grouped by structure, in DISCOVERY
 * order — root first, then depth-first through its fields. That order decides
 * which key path gets to name a shape found at several of them, and it is why
 * two runs over the same sample produce the same names.
 *
 * Empty objects are never grouped: there is nothing to name, and `{}` is a
 * TypeScript trap rather than a type.
 */
function collectShapes(node: TypeNode, hint: string, groups: Map<string, ShapeGroup>): void {
  switch (node.kind) {
    case "array":
      collectShapes(node.element, singularizeName(hint), groups);
      return;
    case "union":
      for (const member of node.members) collectShapes(member, hint, groups);
      return;
    case "object": {
      if (node.fields.length === 0) return;
      const key = canonical(node);
      const existing = groups.get(key);
      if (existing === undefined) groups.set(key, { hint, members: [node], name: "" });
      else existing.members.push(node);
      for (const field of node.fields) collectShapes(field.type, toPascalCase(field.key), groups);
      return;
    }
    default:
      return;
  }
}

function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let suffix = 2;
  while (used.has(`${base}${suffix}`)) suffix += 1;
  const name = `${base}${suffix}`;
  used.add(name);
  return name;
}

/**
 * Every named object replaced by a reference to the declaration its shape was
 * named as. Guarded like `canonical` — see „the depth guard" above — because a
 * `TypeNode` can reach this function without having passed through the guarded
 * `inferValue`.
 */
function link(node: TypeNode, names: ReadonlyMap<string, string>, level = 0): TypeNode {
  guardDepth(level);
  switch (node.kind) {
    case "array":
      return { kind: "array", element: link(node.element, names, level + 1) };
    case "union":
      return {
        kind: "union",
        members: node.members.map((member) => link(member, names, level + 1)),
      };
    case "object": {
      if (node.fields.length === 0) return node;
      const name = names.get(canonical(node));
      return name === undefined ? node : { kind: "ref", name };
    }
    default:
      return node;
  }
}

/**
 * The sample as a model: named declarations, one per distinct shape, plus a root
 * that is normally a reference to the first of them.
 *
 * The fold over each group is load-bearing even though its members are already
 * structurally equal, because folding is also what reconciles their string
 * FORMATS: a shape found once with UUIDs and once with free text ends up with no
 * UUID note rather than with whichever note was seen first. Folding cannot change
 * a shape's structure — merging two equal-canonical nodes yields a node with the
 * same canonical form — so the names handed out before the fold still resolve
 * after it.
 *
 * A cycle IS possible here, even though it cannot arise from `jsonToTypes(text)`:
 * that path is gated by `JSON.parse`, which can only ever produce a finite tree.
 * This function takes a `JsonValue` directly, and TypeScript's structural typing
 * cannot enforce acyclicity on a plain object literal handed in through a cast.
 * `MAX_NESTING_DEPTH` is what actually stops it: `inferValue` — the one function
 * every `JsonValue` reaching this function is turned into a `TypeNode` by —
 * counts its own depth and throws `NestingTooDeepError` the instant it is
 * crossed, so a self-referential sample fails fast and by name instead of by
 * exhausting the real call stack.
 */
export function buildTypeModel(value: JsonValue, options: JsonTypeOptions): TypeModel {
  const inferred = inferValue(value);
  const groups = new Map<string, ShapeGroup>();
  if (inferred.kind === "array") {
    collectShapes(inferred.element, rootElementHint(options.rootName), groups);
  } else {
    collectShapes(inferred, options.rootName, groups);
  }

  const used = new Set<string>();
  // When the root is not a named object it becomes a type ALIAS, so its name has
  // to be reserved before any nested shape can take it.
  const rootIsNamed = inferred.kind === "object" && inferred.fields.length > 0;
  if (!rootIsNamed) used.add(options.rootName);

  const names = new Map<string, string>();
  for (const [key, group] of groups) {
    group.name = uniqueName(shadowSafe(group.hint), used);
    names.set(key, group.name);
  }

  const types: NamedType[] = [];
  for (const group of groups.values()) {
    const [first, ...rest] = group.members;
    if (first === undefined) continue;
    const merged = rest.reduce<ObjectNode>((left, right) => mergeObjects(left, right), first);
    const fields = merged.fields.map((field) => ({
      key: field.key,
      type: link(field.type, names),
      optional: field.optional,
    }));
    types.push({ name: group.name, node: { kind: "object", fields } });
  }

  return { rootName: options.rootName, root: link(inferred, names), types };
}

/* --------------------------------------------------------------- emitting */

interface EmitContext {
  readonly options: JsonTypeOptions;
  readonly bodies: ReadonlyMap<string, TypeNode>;
  /** Names that are rendered at their use site instead of being declared. */
  readonly inlined: ReadonlySet<string>;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * A property key as it is written in a declaration. `JSON.stringify` is the
 * escaper because a JSON string literal IS a valid JS string literal, quotes and
 * backslashes included — hand-rolling the escaping is how a key containing a
 * quote becomes emitted code that does not parse.
 */
function propertyKey(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

function indentOf(depth: number): string {
  return "  ".repeat(depth);
}

/** The body a reference stands for, or `undefined` when the name is declared not inlined. */
function inlineBody(node: TypeNode, ctx: EmitContext): TypeNode | undefined {
  if (node.kind !== "ref" || !ctx.inlined.has(node.name)) return undefined;
  return ctx.bodies.get(node.name);
}

/**
 * Whether an element type has to go through `Array<…>`. `T | null[]` parses as
 * `T | (null[])`, so a union element written with the postfix `[]` is not merely
 * ugly — it is a different type. An inline object body is multi-line and wants
 * the wrapper for the same reason a reader does.
 */
function needsArrayWrapper(node: TypeNode, ctx: EmitContext): boolean {
  if (node.kind === "union") return true;
  if (node.kind === "object") return node.fields.length > 0;
  const body = inlineBody(node, ctx);
  return body !== undefined && needsArrayWrapper(body, ctx);
}

/**
 * `depth` is INDENTATION — how many object bodies deep we are, for `pad`.
 * `level` is the independent recursion GUARD counted in `render` — see „the
 * depth guard" above — and is incremented on every hop (array/union/ref/object
 * field alike), unlike `depth`, which only changes at an object body. Both are
 * needed: a hand-built `TypeModel` reaches this function through `emitTypes`
 * without ever passing through the guarded `inferValue`.
 */
function renderTs(node: TypeNode, ctx: EmitContext, depth: number, level = 0): string {
  guardDepth(level);
  switch (node.kind) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "unknown":
      return "unknown";
    case "ref": {
      const body = inlineBody(node, ctx);
      return body === undefined ? node.name : renderTs(body, ctx, depth, level + 1);
    }
    case "object":
      // `{}` means "anything but null and undefined" in TypeScript, so it is
      // never what an empty sample object should emit.
      return node.fields.length === 0
        ? "Record<string, unknown>"
        : renderTsObject(node.fields, ctx, depth, level);
    case "union":
      return node.members.map((member) => renderTs(member, ctx, depth, level + 1)).join(" | ");
    case "array": {
      const inner = renderTs(node.element, ctx, depth, level + 1);
      const wrap = needsArrayWrapper(node.element, ctx);
      if (ctx.options.useReadonly) return wrap ? `ReadonlyArray<${inner}>` : `readonly ${inner}[]`;
      return wrap ? `Array<${inner}>` : `${inner}[]`;
    }
  }
}

function renderTsObject(
  fields: readonly TypeField[],
  ctx: EmitContext,
  depth: number,
  level: number,
): string {
  const pad = indentOf(depth + 1);
  const modifier = ctx.options.useReadonly ? "readonly " : "";
  const lines: string[] = [];
  for (const field of fields) {
    const note = fieldNote(field.type);
    if (note !== null) lines.push(`${pad}/** ${note} */`);
    const rendered = renderTs(field.type, ctx, depth + 1, level + 1);
    const optionalMark = field.optional && ctx.options.optionalStyle === "question" ? "?" : "";
    const type =
      field.optional && ctx.options.optionalStyle === "undefined"
        ? `${rendered} | undefined`
        : rendered;
    lines.push(`${pad}${modifier}${propertyKey(field.key)}${optionalMark}: ${type};`);
  }
  return `{\n${lines.join("\n")}\n${indentOf(depth)}}`;
}

/** `depth`/`level` split exactly as in `renderTs` above — indentation versus recursion guard. */
function renderZod(node: TypeNode, ctx: EmitContext, depth: number, level = 0): string {
  guardDepth(level);
  switch (node.kind) {
    // The format is a comment in every target and a validator in none: a rule
    // guessed from a sample would reject real data the sample did not contain.
    case "string":
      return "z.string()";
    case "number":
      return "z.number()";
    case "boolean":
      return "z.boolean()";
    case "null":
      return "z.null()";
    case "unknown":
      return "z.unknown()";
    case "ref": {
      const body = inlineBody(node, ctx);
      return body === undefined ? node.name : renderZod(body, ctx, depth, level + 1);
    }
    case "object": {
      if (node.fields.length === 0) {
        // Two arguments rather than one: the single-argument `z.record` is the
        // v3-only spelling and is not a schema in v4.
        return withZodReadonly("z.record(z.string(), z.unknown())", ctx);
      }
      return withZodReadonly(renderZodObject(node.fields, ctx, depth, level), ctx);
    }
    case "array":
      return withZodReadonly(`z.array(${renderZod(node.element, ctx, depth, level + 1)})`, ctx);
    case "union": {
      const rest = node.members.filter((member) => member.kind !== "null");
      const nullable = rest.length !== node.members.length;
      const [only] = rest;
      if (only === undefined) return "z.null()";
      const base =
        rest.length === 1
          ? renderZod(only, ctx, depth, level + 1)
          : `z.union([${rest
              .map((member) => renderZod(member, ctx, depth, level + 1))
              .join(", ")}])`;
      return nullable ? `${base}.nullable()` : base;
    }
  }
}

function withZodReadonly(schema: string, ctx: EmitContext): string {
  return ctx.options.useReadonly ? `${schema}.readonly()` : schema;
}

function renderZodObject(
  fields: readonly TypeField[],
  ctx: EmitContext,
  depth: number,
  level: number,
): string {
  const pad = indentOf(depth + 1);
  const lines: string[] = [];
  for (const field of fields) {
    const note = fieldNote(field.type);
    if (note !== null) lines.push(`${pad}/** ${note} */`);
    const base = renderZod(field.type, ctx, depth + 1, level + 1);
    // `optionalStyle` has no meaning here: Zod's `.optional()` is the only
    // spelling, and it makes the key optional AND admits `undefined`.
    lines.push(`${pad}${propertyKey(field.key)}: ${field.optional ? `${base}.optional()` : base},`);
  }
  return `z.object({\n${lines.join("\n")}\n${indentOf(depth)}})`;
}

/** Every declaration a node reaches directly, with inlined names expanded through. */
function dependencies(node: TypeNode, ctx: EmitContext): readonly string[] {
  const found: string[] = [];
  const walk = (current: TypeNode): void => {
    switch (current.kind) {
      case "ref": {
        const body = inlineBody(current, ctx);
        if (body === undefined) found.push(current.name);
        else walk(body);
        return;
      }
      case "array":
        walk(current.element);
        return;
      case "union":
        for (const member of current.members) walk(member);
        return;
      case "object":
        for (const field of current.fields) walk(field.type);
        return;
      default:
        return;
    }
  };
  walk(node);
  return found;
}

function countReferences(model: TypeModel): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const walk = (node: TypeNode): void => {
    switch (node.kind) {
      case "ref":
        counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
        return;
      case "array":
        walk(node.element);
        return;
      case "union":
        for (const member of node.members) walk(member);
        return;
      case "object":
        for (const field of node.fields) walk(field.type);
        return;
      default:
        return;
    }
  };
  walk(model.root);
  for (const type of model.types) walk(type.node);
  return counts;
}

function makeContext(model: TypeModel, options: JsonTypeOptions): EmitContext {
  const bodies = new Map(model.types.map((type) => [type.name, type.node] as const));
  const inlined = new Set<string>();
  if (options.inlineSingleUse) {
    const counts = countReferences(model);
    // The root's own declaration is never inlined — there would be nothing left
    // to inline it INTO.
    const rootRef = model.root.kind === "ref" ? model.root.name : undefined;
    for (const type of model.types) {
      if (type.name !== rootRef && (counts.get(type.name) ?? 0) <= 1) inlined.add(type.name);
    }
  }
  return { options, bodies, inlined };
}

/**
 * The declarations in the order the target needs them.
 *
 * TypeScript gets discovery order, which reads top-down: the root first, then
 * what it refers to. Zod gets dependency order, because a schema is a `const`
 * and using one before its declaration is a TDZ error at run time rather than a
 * compile error — the one way these two targets genuinely differ.
 */
function orderedDeclarations(model: TypeModel, ctx: EmitContext): readonly NamedType[] {
  const emitted = model.types.filter((type) => !ctx.inlined.has(type.name));
  if (ctx.options.target !== "zod") return emitted;

  const byName = new Map(emitted.map((type) => [type.name, type] as const));
  const ordered: NamedType[] = [];
  const done = new Set<string>();
  const visit = (name: string): void => {
    if (done.has(name)) return;
    const type = byName.get(name);
    if (type === undefined) return;
    // Marked before recursing. A cycle cannot arise from a finite sample, but a
    // guard that is only correct while that stays true is not a guard.
    done.add(name);
    for (const dep of dependencies(type.node, ctx)) visit(dep);
    ordered.push(type);
  };

  for (const dep of dependencies(model.root, ctx)) visit(dep);
  for (const type of emitted) visit(type.name);
  return ordered;
}

/** `null` when the root is a declaration in its own right and needs no alias. */
function renderRootAlias(model: TypeModel, ctx: EmitContext): string | null {
  if (model.root.kind === "ref" && model.root.name === model.rootName) return null;
  if (ctx.options.target === "zod") {
    return renderZodDeclaration(model.rootName, model.root, ctx);
  }
  return `export type ${model.rootName} = ${renderTs(model.root, ctx, 0)};`;
}

function renderZodDeclaration(name: string, node: TypeNode, ctx: EmitContext): string {
  return [
    `export const ${name} = ${renderZod(node, ctx, 0)};`,
    `export type ${name} = z.infer<typeof ${name}>;`,
  ].join("\n");
}

function renderDeclaration(type: NamedType, ctx: EmitContext): string {
  switch (ctx.options.target) {
    case "zod":
      return renderZodDeclaration(type.name, type.node, ctx);
    case "type":
      return `export type ${type.name} = ${renderTs(type.node, ctx, 0)};`;
    case "interface":
      return `export interface ${type.name} ${renderTs(type.node, ctx, 0)}`;
  }
}

/**
 * The model as source text, with no trailing newline — a caller that wants one
 * knows better than this module whether it is pasting into a file or a field.
 *
 * The root NAME comes from the model rather than from `options`, so switching
 * targets is a re-emit and never a re-parse.
 */
export function emitTypes(model: TypeModel, options: JsonTypeOptions): string {
  const ctx = makeContext(model, options);
  const rootAlias = renderRootAlias(model, ctx);
  const blocks: string[] = [];

  if (options.target === "zod") blocks.push(`import { z } from "zod";`);
  else if (rootAlias !== null) blocks.push(rootAlias);

  for (const type of orderedDeclarations(model, ctx)) blocks.push(renderDeclaration(type, ctx));

  // Last for Zod, where it may reference schemas declared above it.
  if (options.target === "zod" && rootAlias !== null) blocks.push(rootAlias);

  return blocks.join("\n\n");
}

/**
 * Every reason `jsonToTypes` can refuse for, extending the sample-level reasons
 * with the one failure mode that can only surface once parsing has already
 * succeeded: a nesting depth `JSON.parse` tolerates but no stage after it can
 * walk safely.
 */
export type JsonToTypesError = JsonSampleError | "too_deep";

export type JsonToTypesResult =
  | { readonly ok: true; readonly code: string; readonly model: TypeModel }
  | { readonly ok: false; readonly reason: JsonToTypesError; readonly detail: string };

/**
 * Parse, model and emit in one call — the whole tool, for a surface with no use
 * for the model.
 *
 * The `try` covers both `buildTypeModel` and `emitTypes`: either can throw
 * `NestingTooDeepError` — the former for a sample that nests too deep, the
 * latter only were it ever handed a model from somewhere other than this
 * function's own `buildTypeModel` call, which cannot happen here. Catching
 * around both, rather than just the one that actually applies, keeps this
 * function's „never throws" promise true even if that stops being so.
 */
export function jsonToTypes(text: string, partial?: Partial<JsonTypeOptions>): JsonToTypesResult {
  const parsed = parseJsonSample(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, detail: parsed.detail };
  const options = resolveJsonTypeOptions(partial);
  try {
    const model = buildTypeModel(parsed.value, options);
    return { ok: true, code: emitTypes(model, options), model };
  } catch (error) {
    if (!(error instanceof NestingTooDeepError)) throw error;
    return { ok: false, reason: "too_deep", detail: error.message };
  }
}
