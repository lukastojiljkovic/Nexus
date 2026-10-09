/**
 * The calculator's SESSION: the variables, the user's own functions, and `ans`.
 *
 * **It is plain JSON, and that is the whole point.** A session outlives the
 * window it was typed in — the store keeps one per profile (migration 079) and
 * stage 2 puts it in the profile archive — so what is persisted is a versioned
 * value with strings in it, never a mathjs scope. A mathjs value is a class
 * instance (`BigNumber`, `Unit`, `DenseMatrix`), and storing class instances is
 * how a file stops being readable by the next build.
 *
 * **What a variable holds is a VALUE, in mathjs's own lexical form.** The engine
 * renders every result with `math.format`, and that text is what is stored:
 * `5`, `0.30000000000000004`, `3.1068559611866697 mi`, `[[1, 2], [3, 4]]`. It
 * round-trips exactly — it is the same text mathjs writes and re-reads — and it
 * is order-independent, which the user's own source text would not be:
 * `x = 5` then `y = x` then `x = 9` would replay a stored `y = "x"` as nine.
 *
 * **A user function is a SIGNATURE and a body**, `{ params, body }`, never a
 * compiled function. That is what lets a session be validated by a reader that
 * has no mathjs in it (`parseCalculatorSession`), and what makes the body
 * auditable text rather than an opaque value.
 *
 * **Every refusal here is about untrusted input.** The store validates a session
 * on the way in AND on the way out of its column, and stage 2's import path
 * hands it a value out of a file somebody else wrote; so names, lengths, counts
 * and shapes are all checked, and a reader that is handed something it does not
 * recognise answers `null` rather than throwing. It is deliberately NOT a
 * syntax check: whether `x ^ 2 + 1` parses is the engine's question, and asking
 * mathjs here would put mathjs inside the storage layer's validator.
 */

import { MAX_EXPRESSION_LENGTH } from "./limits.js";

/**
 * The session's own version, refused when it is not the one this reader knows
 * (`parseCalculatorSession`). It travels with the value rather than with the
 * table, for the reason the archive's own versions do: the COLUMN outlives every
 * shape it has ever held.
 */
export const CALCULATOR_SESSION_VERSION = 1;

/**
 * How long a variable, a function or a parameter name may be.
 *
 * Forty characters is far past any name a person types (`poluprecnik`,
 * `bruto2`) and short of the length at which a name stops being a name and
 * starts being a sentence pasted into the input box. Mathjs identifiers accept
 * letters, digits and `_`, and that is what `parseCalculatorSession` enforces.
 */
export const MAX_CALCULATOR_NAME_LENGTH = 40;

/** How many variables a session carries. Two hundred is a notebook page, not a scope; the engine's own scope is one map either way. */
export const MAX_CALCULATOR_SESSION_VARIABLES = 200;

/** How many user functions a session carries, on the same footing. */
export const MAX_CALCULATOR_SESSION_FUNCTIONS = 100;

/**
 * How many parameters a user function may take.
 *
 * mathjs itself takes more; the calculator's own grammar is `f(x) = …` on one
 * line, and a signature wider than four is a function nobody reads on a
 * calculator's display. The bound also keeps a replayed session's work per call
 * proportional to something a person chose deliberately.
 */
export const MAX_CALCULATOR_FUNCTION_PARAMS = 4;

/**
 * How long ONE stored value's text may be.
 *
 * Set above the largest value a single evaluation can produce, because a session
 * that could not hold what the engine had just computed would be a store
 * refusing its own output: the engine refuses matrices of more than 10 000
 * elements (`limits.ts`), and 10 000 numbers render to roughly 30 kB of text
 * (measured: 250 000 elements rendered to 751 kB). Thirty-two kilobytes leaves
 * that with room to spare.
 */
export const MAX_CALCULATOR_VALUE_LENGTH = 32_768;

/** A user function as stored: its parameter names and its body, both as text. */
export interface CalculatorFunctionDefinition {
  readonly params: readonly string[];
  readonly body: string;
}

/**
 * One calculator session, in the shape the store persists and stage 2's archive
 * carries. See the file header for why every value is text.
 */
export interface CalculatorSession {
  readonly version: typeof CALCULATOR_SESSION_VERSION;
  readonly variables: Readonly<Record<string, string>>;
  readonly functions: Readonly<Record<string, CalculatorFunctionDefinition>>;
  /** The previous result, in the same lexical form a variable holds, or null before the first one. */
  readonly ans: string | null;
}

/** A session with nothing in it — what a profile that never opened the calculator has. */
export function emptyCalculatorSession(): CalculatorSession {
  return { version: CALCULATOR_SESSION_VERSION, variables: {}, functions: {}, ans: null };
}

/**
 * Reads a session out of a value of unknown shape, or answers `null` when it is
 * not one. Every field is checked; a field the reader does not know is ignored,
 * because a field a later version writes is not this version's business and
 * refusing the session over it would throw away everything the user does have.
 */
export function parseCalculatorSession(value: unknown): CalculatorSession | null {
  if (!isRecord(value)) return null;
  if (value["version"] !== CALCULATOR_SESSION_VERSION) return null;

  const variables = readVariables(value["variables"]);
  if (variables === null) return null;
  const functions = readFunctions(value["functions"]);
  if (functions === null) return null;

  const ans = value["ans"];
  if (ans !== null && !isValueText(ans)) return null;

  return { version: CALCULATOR_SESSION_VERSION, variables, functions, ans: ans ?? null };
}

/** The session as the JSON text the store's column holds. */
export function serializeCalculatorSession(session: CalculatorSession): string {
  return JSON.stringify(session);
}

/**
 * Reads that column back. Text that does not parse is corruption rather than
 * input to coerce, and it answers `null` on the same terms every other refusal
 * here does — the caller decides what to say about it.
 */
export function parseCalculatorSessionText(text: string): CalculatorSession | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return parseCalculatorSession(parsed);
}

/** A mathjs identifier, which is also every name this module accepts: a letter or `_`, then letters, digits and `_`. */
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_CALCULATOR_NAME_LENGTH && NAME.test(value);
}

/** One stored value's text: non-empty, and no longer than a value the engine can produce. */
function isValueText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_CALCULATOR_VALUE_LENGTH;
}

function readVariables(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_CALCULATOR_SESSION_VARIABLES) return null;
  const variables: Record<string, string> = {};
  for (const [name, text] of entries) {
    if (!isName(name) || !isValueText(text)) return null;
    variables[name] = text;
  }
  return variables;
}

function readFunctions(value: unknown): Record<string, CalculatorFunctionDefinition> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_CALCULATOR_SESSION_FUNCTIONS) return null;
  const functions: Record<string, CalculatorFunctionDefinition> = {};
  for (const [name, definition] of entries) {
    const read = readFunction(definition);
    if (!isName(name) || read === null) return null;
    functions[name] = read;
  }
  return functions;
}

function readFunction(value: unknown): CalculatorFunctionDefinition | null {
  if (!isRecord(value)) return null;
  const params = value["params"];
  const body = value["body"];
  if (!Array.isArray(params) || params.length === 0) return null;
  if (params.length > MAX_CALCULATOR_FUNCTION_PARAMS) return null;
  if (!params.every(isName)) return null;
  // A repeated parameter is a signature mathjs would accept and no reader could
  // act on: two names for one argument, where the second silently wins.
  if (new Set(params).size !== params.length) return null;
  if (typeof body !== "string" || body.length === 0) return null;
  if (body.length > MAX_EXPRESSION_LENGTH) return null;
  return { params: [...params], body };
}
