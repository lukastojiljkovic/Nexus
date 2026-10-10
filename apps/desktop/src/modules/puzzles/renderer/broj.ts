import { checkBrojExpression } from "@nexus/core";
import type { BrojExpression, BrojRefusal } from "@nexus/core";

/**
 * Broj's own arithmetic input, as a pure parser (ADR-090).
 *
 * **Why a parser at all.** The engine answers two very different questions about
 * a round: what the six numbers can make (`solveBroj`, the answer shown after a
 * round) and what a player's expression is worth (`checkBrojExpression`, which
 * counts the numbers used and refuses an inexact division). The second needs an
 * expression TREE, and the only thing a person can type is text — so the reading
 * of that text lives here, and every rule about what an expression MEANS stays
 * in the engine: this file never evaluates anything.
 *
 * **The grammar is the game's, and it is four operations deep.** `+ - * /` with
 * the usual precedence, brackets, and positive whole numbers — no unary minus,
 * because no number this game deals is negative and „−3" is therefore not an
 * expression a player can mean. `×`, `÷` and `−` are accepted beside `*`, `/`
 * and `-`, because a Serbian keyboard's „×" is the same operation as the
 * asterisk and refusing one of them would be the app arguing about typography.
 *
 * **Two bounds, because the input is a text field.** A payload off a wire is
 * bounded by the store; a string typed into a field is bounded here — a length
 * and a nesting depth — so a pathological line cannot make the reader recurse
 * without end. Both refusals are the same sentence to the user, because „too
 * long to be an expression" and „not an expression" are the same problem from
 * where the player is standing.
 */

/** The longest string this reader will look at. The field caps typing well below it; this is the bound for anything else. */
export const MAX_EXPRESSION_LENGTH = 200;

/** How deeply brackets may nest. Six numbers need five operations, so twelve is already absurd. */
const MAX_DEPTH = 12;

export type ParseResult =
  | { readonly ok: true; readonly expression: BrojExpression }
  | { readonly ok: false; readonly refusal: "syntax" };

/** What one submitted expression is: a value with its distance, or the reason it was refused. */
export type BrojCheckResult =
  | { readonly kind: "refusal"; readonly refusal: "syntax" | BrojRefusal }
  | {
      readonly kind: "value";
      /** The expression the text was read as, so the caller can keep it in the game it is saving. */
      readonly expression: BrojExpression;
      readonly value: number;
      readonly distance: number;
      readonly exact: boolean;
    };

interface Cursor {
  readonly text: string;
  at: number;
}

function skipSpaces(cursor: Cursor): void {
  while (cursor.at < cursor.text.length && /\s/.test(cursor.text[cursor.at] as string)) {
    cursor.at += 1;
  }
}

function peek(cursor: Cursor): string {
  return cursor.text[cursor.at] ?? "";
}

/** One whole number. Written out rather than tokenised: a number is the only token that has a length to it. */
function parseNumber(cursor: Cursor): BrojExpression | null {
  const start = cursor.at;
  while (/[0-9]/.test(peek(cursor))) cursor.at += 1;
  if (cursor.at === start) return null;
  return { kind: "number", value: Number(cursor.text.slice(start, cursor.at)) };
}

/** `sum := product (("+" | "-") product)*`, left-associative — which is what makes „10 - 3 - 2" read as `(10 - 3) - 2`. */
function parseSum(cursor: Cursor, depth: number): BrojExpression | null {
  if (depth > MAX_DEPTH) return null;
  let left = parseProduct(cursor, depth);
  if (left === null) return null;
  for (;;) {
    skipSpaces(cursor);
    const symbol = peek(cursor);
    const operation = symbol === "+" ? "+" : symbol === "-" || symbol === "−" ? "-" : null;
    if (operation === null) return left;
    cursor.at += 1;
    const right = parseProduct(cursor, depth);
    if (right === null) return null;
    left = { kind: "operation", operation, left, right };
  }
}

/** `product := factor (("*" | "/") factor)*` — the tighter binding, and the reason „2 + 3 × 4" is 14 and not 20. */
function parseProduct(cursor: Cursor, depth: number): BrojExpression | null {
  let left = parseFactor(cursor, depth);
  if (left === null) return null;
  for (;;) {
    skipSpaces(cursor);
    const symbol = peek(cursor);
    const operation =
      symbol === "*" || symbol === "×" ? "*" : symbol === "/" || symbol === "÷" ? "/" : null;
    if (operation === null) return left;
    cursor.at += 1;
    const right = parseFactor(cursor, depth);
    if (right === null) return null;
    left = { kind: "operation", operation, left, right };
  }
}

/** `factor := number | "(" sum ")"` — brackets are the only other thing that is a factor. */
function parseFactor(cursor: Cursor, depth: number): BrojExpression | null {
  skipSpaces(cursor);
  if (peek(cursor) === "(") {
    cursor.at += 1;
    const inner = parseSum(cursor, depth + 1);
    if (inner === null) return null;
    skipSpaces(cursor);
    if (peek(cursor) !== ")") return null;
    cursor.at += 1;
    return inner;
  }
  return parseNumber(cursor);
}

/**
 * Reads the text, completely: what is left after the expression has to be
 * nothing but spaces. „3+4)" and „3+4 junk" are both refusals, which is the half
 * a reader that stopped at the first sum would miss.
 */
export function parseExpression(text: string): ParseResult {
  if (text.length > MAX_EXPRESSION_LENGTH) return { ok: false, refusal: "syntax" };
  const cursor: Cursor = { text, at: 0 };
  const expression = parseSum(cursor, 0);
  if (expression === null) return { ok: false, refusal: "syntax" };
  skipSpaces(cursor);
  if (cursor.at !== text.length) return { ok: false, refusal: "syntax" };
  return { ok: true, expression };
}

/**
 * Everything „Proveri" asks: is the text an expression, is it one the six
 * numbers can make, and what is it worth.
 *
 * The engine answers the middle and the last part — the pool with its copies
 * counted, the exact-division rule, the distance to the target — and this
 * function's whole job is to keep the order of those questions in one place: a
 * reader that asked the engine first would answer „that number is not yours" for
 * a line that is not an expression at all.
 */
export function checkSubmitted(
  numbers: readonly number[],
  target: number,
  text: string,
): BrojCheckResult {
  const parsed = parseExpression(text);
  if (!parsed.ok) return { kind: "refusal", refusal: parsed.refusal };
  const check = checkBrojExpression(numbers, target, parsed.expression);
  if (!check.valid || check.value === null || check.distance === null) {
    return { kind: "refusal", refusal: check.refusal ?? "syntax" };
  }
  return {
    kind: "value",
    expression: parsed.expression,
    value: check.value,
    distance: check.distance,
    exact: check.exact,
  };
}
