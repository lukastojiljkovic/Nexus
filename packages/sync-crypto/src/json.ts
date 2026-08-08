/**
 * Canonical JSON: one byte string per value, on every device.
 *
 * Two independent parts of sync need this and would otherwise each invent it.
 * `row.ts` seals a field map, and two devices that hold the same state must
 * produce the same plaintext — otherwise identical rows look different, and
 * "did this actually change?" stops being answerable without decrypting and
 * deep-comparing. `merge.ts` needs a deterministic tie-break when two writes
 * carry the same hybrid-logical-clock stamp, and "the greater canonical
 * serialisation wins" is only a rule if every device computes the same
 * serialisation.
 *
 * `JSON.stringify` alone is not that: object key order follows insertion
 * order, so `{a, b}` and `{b, a}` serialise differently while being the same
 * value. Sorting the keys by UTF-16 code unit fixes it — and it has to be code
 * unit, never `localeCompare`, whose ordering depends on the locale and on the
 * ICU version the runtime shipped with. A Serbian desktop and a browser on the
 * same laptop would otherwise disagree about whether "š" sorts before "t", and
 * that disagreement would surface as rows that never stop syncing.
 */

/** Exactly what JSON can hold — no `undefined`, no `Date`, no class instances. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** A row's decrypted state: named fields, JSON values. */
export type JsonObject = { readonly [key: string]: JsonValue };

/**
 * Deterministic serialisation.
 *
 * Throws rather than degrading, in three cases `JSON.stringify` would handle
 * silently and wrongly:
 *
 *  - A non-finite number. `JSON.stringify(NaN)` is `"null"` — the value is
 *    destroyed and the round trip lies about it.
 *  - `undefined` inside an object. `JSON.stringify` drops the key entirely,
 *    which turns "this field is explicitly nothing" into "this field is
 *    absent" and, in a field-level LWW merge, into "keep the other device's
 *    value".
 *  - A `__proto__` key. See `bytes.ts`'s `isSafeFieldName`.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonicalJson refuses a non-finite number: ${String(value)}`);
      }
      // JSON.stringify's number formatting is the ECMAScript Number-to-String
      // algorithm: shortest round-tripping decimal, identical in every engine.
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    default:
      break;
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const record = value as { readonly [key: string]: JsonValue };
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) {
    if (key === "__proto__") {
      throw new TypeError("canonicalJson refuses a __proto__ key.");
    }
    const item = record[key];
    if (item === undefined) {
      throw new TypeError(`canonicalJson refuses an undefined value at key ${JSON.stringify(key)}.`);
    }
    parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * `JSON.parse` for untrusted text, returning `null` for anything malformed —
 * including any object carrying a `__proto__` key at any depth.
 *
 * `JSON.parse` itself creates `__proto__` as an ordinary own property, so it
 * is not the parse that is dangerous; it is what a later `merged[key] = value`
 * does with that key, which invokes the prototype setter and reparents an
 * object shared by the whole process. Rejecting the key here means no code
 * downstream has to remember.
 */
export function parseJsonValue(text: string): JsonValue | null {
  let poisoned = false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, function reviver(key: string, value: unknown): unknown {
      if (key === "__proto__") poisoned = true;
      return value;
    });
  } catch {
    return null;
  }
  return poisoned ? null : (parsed as JsonValue);
}

/** True for a plain JSON object — not an array, not `null`, not a scalar. */
export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
