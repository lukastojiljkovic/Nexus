import {
  CALCULATOR_CODES,
  foldSearchText,
  type CalculatorLocale,
  type CalculatorSuccess,
} from "@nexus/core";

/**
 * CALCULATOR's expression arithmetic, as pure functions (ADR-090).
 *
 * Everything here is about the LINE the user types rather than about the value
 * the engine computes: which character means a decimal point on this machine,
 * what `#3` stands for, where a refusal points, how a history row is found by a
 * query, and which row the arrow keys are standing on. None of it needs a DOM,
 * a worker or a database, which is why it lives in its own file and has its own
 * tests - `timing.ts` one module over is the same arrangement for the same
 * reason.
 *
 * **The engine is not re-implemented here.** Nothing in this file evaluates
 * anything; it rewrites text the engine will parse (a decimal comma into a
 * point, a `#3` into the result it names) and answers questions about text.
 */

/**
 * The codes the page can be handed, and there is one more here than the engine
 * has.
 *
 * `CALCULATOR_CODES` is the engine's closed set (`engine.ts`), and it is
 * deliberately not extended: a refusal the ENGINE makes is one of its eight.
 * `timeout` and `stopped` are this stage's own, and both describe the WORKER
 * rather than the arithmetic: it ran past its deadline and was terminated
 * (`engineClient.ts`), or it failed outright. Neither is something the engine can
 * report - it is the thing that was interrupted - and they are two codes rather
 * than one because they ask the reader to do two different things. The union is
 * stated here so the copy table can be checked against it rather than agreed in a
 * comment.
 */
export const CALCULATOR_FAILURE_CODES = [...CALCULATOR_CODES, "timeout", "stopped"] as const;
export type CalculatorFailureCode = (typeof CALCULATOR_FAILURE_CODES)[number];

/**
 * What the page can be holding: the engine's own success shape, or a refusal that
 * may name one of the two codes the ENGINE never produces (a stop is the worker's,
 * `engineClient.ts`).
 *
 * Declared here rather than in `engineClient.ts` because the copy table is what
 * the union has to be checkable against, and the page is where a code becomes a
 * sentence. `CalculatorFailure` (core) is deliberately not reused as the second
 * arm: its `code` is the engine's closed set, and a stop is not one of its eight.
 */
export type CalculatorAnswer =
  | CalculatorSuccess
  | {
      readonly ok: false;
      readonly code: CalculatorFailureCode;
      readonly position?: number | undefined;
    };

/** The character the locale writes a decimal point with - `,` in Serbian, `.` in English. */
export function decimalSeparatorOf(locale: CalculatorLocale): string {
  return locale === "sr" ? "," : ".";
}

/**
 * The line as the ENGINE should read it: in Serbian, a comma between two digits
 * outside every bracket becomes a point.
 *
 * **Why a comma has to be rewritten at all.** mathjs writes and reads numbers
 * the C way (`1.5`), and its comma separates the elements of a matrix and the
 * arguments of a call - so `0,1 + 0,2` is a syntax error rather than `0.3`, in
 * the one locale this product ships by default. The display layer already goes
 * the other way (`formatCalculatorDisplay` writes `0,3`), so without this a
 * result could not be typed back in.
 *
 * **The bracket rule is what keeps it unambiguous, and it is about the KIND of
 * bracket.** A comma after a NAME's `(` separates arguments (`max(1,2)`,
 * `ones(2, 3)`) and one inside `[...]` separates matrix elements, so neither is a
 * decimal comma. A bare `(` is a plain GROUP, and a comma inside one is a decimal
 * comma like any other - which is what makes `(1,5 + 2) / 2` the sixteen-fifths a
 * person wrote rather than an argument list. The two are told apart by what
 * precedes the bracket, which is a syntactic fact and not a guess: a name before
 * it makes it a call. A quoted run - a variable can hold a string - is left alone
 * whatever encloses it.
 *
 * **What it deliberately does NOT do is guess at group separators.** `1.234,5`
 * pasted back from the display becomes `1.234.5`, which the engine refuses at a
 * position the page then points at. Reading a point as „either a decimal point
 * or a thousands separator" is a guess the row itself cannot settle (`1.234` is
 * 1.234 to one reader and 1234 to another), and a calculator that silently
 * picked one would be wrong half the time and silent about it.
 *
 * English needs no rule at all: there the comma is not the decimal separator, so
 * `1,5` stays what it was and the engine reports where it stopped.
 */
export function toEngineExpression(input: string, locale: CalculatorLocale): string {
  if (locale !== "sr") return input;
  let out = "";
  /** Every bracket still open, by what its commas mean: a call's arguments, a plain group, or a matrix. */
  const open: ("call" | "group" | "matrix")[] = [];
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] ?? "";
    if (character === '"') {
      quoted = !quoted;
      out += character;
      continue;
    }
    if (!quoted) {
      if (character === "(") open.push(isNameEnd(input, index - 1) ? "call" : "group");
      else if (character === "[" || character === "{") open.push("matrix");
      else if (character === ")" || character === "]" || character === "}") open.pop();
      else if (
        character === "," &&
        isDecimalContext(open) &&
        isDigit(input[index - 1]) &&
        isDigit(input[index + 1])
      ) {
        out += ".";
        continue;
      }
    }
    out += character;
  }
  return out;
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

/** Whether a comma here is a decimal comma: nothing is open, or the innermost bracket is a plain group. */
function isDecimalContext(open: readonly string[]): boolean {
  return open.length === 0 || open[open.length - 1] === "group";
}

/** Whether the character before an opening bracket is a NAME - which is what makes the bracket a call rather than a group. */
function isNameEnd(input: string, at: number): boolean {
  for (let index = at; index >= 0; index -= 1) {
    const character = input[index] ?? "";
    if (character === " ") continue;
    return /[0-9A-Za-z_]/.test(character);
  }
  return false;
}

/**
 * A history reference: `#1` is the newest row, `#2` the one before it, and so
 * on - the order the list is READ in, which is the only order a person counting
 * rows on the screen can mean.
 */
export type HistoryRef =
  | { readonly ok: true; readonly expression: string }
  | { readonly ok: false; readonly ref: number };

const REFERENCE = /^#(\d+)/;

/**
 * Rewrites every `#N` into the result that row holds, in brackets, and answers
 * which one it could not find.
 *
 * **Why the VALUE and not the row's expression.** A result reused by name must be
 * the number the row is showing - that is what reuse means, and it is what `ans`
 * already is one keystroke away. Substituting the row's EXPRESSION instead would
 * re-run it: `random()` would answer a different number, and an expression built
 * on a variable that has since changed would answer a different one too. The
 * value is exact (migration 079 stores it beside the display string for
 * precisely this) and it carries units, fractions and matrices unchanged.
 *
 * The substitution is bracketed because a value is not always an atom - `3.1 mi`
 * or `[[1, 2]]` in the middle of `#3 * 2` would otherwise bind wrongly. A
 * reference the history cannot answer is REPORTED rather than left in the line:
 * `#` is not mathjs syntax at all, so the engine's own refusal would be a syntax
 * error pointing at a character that was never the problem.
 */
export function expandHistoryRefs(input: string, values: readonly string[]): HistoryRef {
  let out = "";
  let index = 0;
  let quoted = false;
  while (index < input.length) {
    const character = input[index] ?? "";
    if (character === '"') {
      quoted = !quoted;
      out += character;
      index += 1;
      continue;
    }
    if (!quoted && character === "#") {
      const match = REFERENCE.exec(input.slice(index));
      if (match !== null && match[1] !== undefined) {
        const ref = Number(match[1]);
        const value = ref >= 1 ? values[ref - 1] : undefined;
        if (value === undefined) return { ok: false, ref };
        out += `(${value})`;
        index += match[0].length;
        continue;
      }
    }
    out += character;
    index += 1;
  }
  return { ok: true, expression: out };
}

/**
 * Where a refusal points, as a character index into the line, or `null` when
 * the engine named no position (a unit clash and an over-large matrix have no
 * single character to blame).
 *
 * Clamped to the line rather than trusted: the position comes off the wire from
 * the engine, and a page that sliced a string with a number out of range would
 * draw a caret past the end of the row it is under.
 */
export function caretColumn(position: number | undefined, length: number): number | null {
  if (position === undefined) return null;
  return Math.max(0, Math.min(position, length));
}

/**
 * Whether a history row answers a query, folded the way every search in this app
 * folds (`foldSearchText`: „ucenje" finds „Učenje", and a Cyrillic query finds
 * the Latin copy).
 *
 * BOTH halves of the row are searched, because they are both on the screen: the
 * expression is what the user typed, and the result is what they remember.
 */
export function matchesQuery(expression: string, result: string, query: string): boolean {
  const needle = foldSearchText(query).trim();
  if (needle.length === 0) return true;
  return foldSearchText(`${expression} ${result}`).includes(needle);
}

/**
 * Names, in the order a Serbian reader alphabetises them.
 *
 * `Intl.Collator(["sr-Latn", "sr"])` and not the default collation (CLAUDE.md's
 * house rule): plain `"sr"` mis-tailors the Latin digraphs, and the default would
 * put „š" after „z".
 */
export function sortNames(names: readonly string[]): readonly string[] {
  return [...names].sort((left, right) => collator().compare(left, right));
}

let srCollator: Intl.Collator | null = null;

function collator(): Intl.Collator {
  srCollator ??= new Intl.Collator(["sr-Latn", "sr"]);
  return srCollator;
}

/**
 * The row the arrow keys are standing on after one press.
 *
 * `-1` is not recalling: the line holds what the user is typing. `0` is the
 * newest row, and the index counts into the history as it is drawn (newest
 * first), which is the order `#N` counts in too. `up` walks back in time and
 * `down` walks forward, and the cursor stops at both ends rather than wrapping -
 * a wrap would move the line's text to the other end of the history under a key
 * the user is holding down.
 */
export function recallIndex(cursor: number, direction: "up" | "down", count: number): number {
  if (count <= 0) return -1;
  const next = cursor + (direction === "up" ? 1 : -1);
  if (next < -1) return -1;
  return Math.min(next, count - 1);
}

/**
 * One key of the scientific keypad.
 *
 * `insert` is the TEXT the key puts into the line and `label` is what is drawn
 * on it, and the two differ wherever a symbol is shorter than the call it stands
 * for: the radical key draws `√` and inserts `sqrt(`.
 *
 * `name` is present exactly when the drawn label is not already a spoken name -
 * a digit and the word `ans` are their own names, while `÷` and `x²` are not, and
 * a button whose accessible name is a division sign tells a reader nothing. The
 * type is the CLOSED set of those names, so a key that declares one and a copy
 * table that is missing it is a compile error rather than a button that reads
 * out its own punctuation.
 */
export const KEYPAD_NAMES = [
  "open",
  "close",
  "plus",
  "minus",
  "multiply",
  "divide",
  "power",
  "equals",
  "root",
  "square",
  "pi",
  "factorial",
  "percent",
  "decimal",
  "clear",
] as const;
export type KeypadName = (typeof KEYPAD_NAMES)[number];

export interface KeypadKey {
  readonly id: string;
  readonly label: string;
  readonly insert: string;
  readonly name?: KeypadName;
}

/**
 * The keypad, in the order it is drawn: four rows of a pocket calculator, then
 * three rows of the functions a school one keeps behind a shift key.
 *
 * The decimal key's label is the locale's own separator, so the page draws that
 * one (`id: "decimal"`); everything else is fixed text. A key that needs a
 * bracket (`sin`) inserts the opening bracket with it, because a calculator's
 * one line rarely wants a bare `sin` - and the closing bracket is a key of its
 * own, on the row above.
 */
export const KEYPAD_ROWS: readonly (readonly KeypadKey[])[] = [
  [
    { id: "7", label: "7", insert: "7" },
    { id: "8", label: "8", insert: "8" },
    { id: "9", label: "9", insert: "9" },
    { id: "open", label: "(", insert: "(", name: "open" },
    { id: "close", label: ")", insert: ")", name: "close" },
  ],
  [
    { id: "4", label: "4", insert: "4" },
    { id: "5", label: "5", insert: "5" },
    { id: "6", label: "6", insert: "6" },
    { id: "multiply", label: "\u00d7", insert: "*", name: "multiply" },
    { id: "divide", label: "\u00f7", insert: "/", name: "divide" },
  ],
  [
    { id: "1", label: "1", insert: "1" },
    { id: "2", label: "2", insert: "2" },
    { id: "3", label: "3", insert: "3" },
    { id: "plus", label: "+", insert: "+", name: "plus" },
    { id: "minus", label: "\u2212", insert: "-", name: "minus" },
  ],
  [
    { id: "0", label: "0", insert: "0" },
    { id: "decimal", label: ".", insert: ".", name: "decimal" },
    { id: "ans", label: "ans", insert: "ans" },
    { id: "power", label: "x\u02b8", insert: "^", name: "power" },
    { id: "commit", label: "=", insert: "", name: "equals" },
  ],
  [
    { id: "sin", label: "sin", insert: "sin(" },
    { id: "cos", label: "cos", insert: "cos(" },
    { id: "tan", label: "tan", insert: "tan(" },
    { id: "root", label: "\u221a", insert: "sqrt(", name: "root" },
    { id: "square", label: "x\u00b2", insert: "^2", name: "square" },
  ],
  [
    { id: "ln", label: "ln", insert: "ln(" },
    { id: "log", label: "log", insert: "log(" },
    { id: "abs", label: "abs", insert: "abs(" },
    { id: "pi", label: "\u03c0", insert: "pi", name: "pi" },
    { id: "euler", label: "e", insert: "e" },
  ],
  [
    { id: "factorial", label: "!", insert: "!", name: "factorial" },
    { id: "modulo", label: "mod", insert: " mod " },
    { id: "convert", label: "to", insert: " to " },
    { id: "percent", label: "%", insert: "%", name: "percent" },
    { id: "clear", label: "C", insert: "", name: "clear" },
  ],
];
