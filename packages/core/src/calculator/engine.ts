/**
 * THE ENGINE: mathjs, narrowed.
 *
 * **mathjs is the arithmetic; this file is the boundary around it.** An
 * expression a user types is a program, and mathjs evaluates programs — so the
 * boundary is what decides which programs are allowed, what a refusal is called,
 * and what a result looks like. It is drawn in four places:
 *
 *  1. **The instance is built by hand.** `create(all, …)` gives the full library
 *     (5 ms, measured), and `BIG_NUMBER_PRECISION`/the bignumber `number` setting
 *     is the mode's whole body. The functions the security page tells you to
 *     disable are installed as stubs that throw `CalculatorDisabledError`, and
 *     three more join them for reasons stated at
 *     {@link DISABLED_FUNCTIONS}. Our own `evaluate`, `parse` and `format` are
 *     taken BEFORE the stubs go in, which is the pattern the page itself uses:
 *     after this file's constructor block, no expression can reach an
 *     evaluator, and the engine still has one.
 *
 *  2. **The bounds are checked before evaluation.** `limits.ts` holds the
 *     numbers; `guardProblem` walks the parsed tree and refuses the shapes that
 *     would make the process work forever. It runs on the PARSED tree, never on
 *     a string, so no amount of quoting gets past it.
 *
 *  3. **Every refusal is a code.** The engine never throws to its caller: a
 *     syntax error, a name mathjs does not know, a unit clash, a disabled
 *     function and mathjs's own type errors all come back as
 *     {@link CalculatorOutcome} with one of {@link CALCULATOR_CODES}. Stage 2
 *     maps codes to sentences, and a code that were merely "some failure" would
 *     ship as "nešto je pošlo naopako".
 *
 *  4. **The display is not the value.** `value` is mathjs's own lexical form —
 *     exact, re-parseable, and what the session stores — while `display` is
 *     `formatCalculatorDisplay`'s answer for the caller's locale. A caller that
 *     showed `value` would show `0.30000000000000004`.
 *
 * **The angle mode is an argument, not state.** `evaluate` takes it per call and
 * installs it in the one holder the trig wrappers read, so the same engine can be
 * asked for `sin(30)` in degrees and in radians and answers both, and the answer
 * depends on nothing but the arguments. The wrapper converts a plain number (or
 * a BigNumber) and leaves a `Unit` alone, which is why `sin(30 deg)` means the
 * same thing in every mode.
 *
 * **Why the bignumber mode has no display ceiling.** `precision: null` shows
 * every digit the value carries — sixty-four of them — because that is what the
 * mode is FOR; a caller that would rather read `atan(1)` as `50` than as
 * `50.0000…001` passes a `precision` (the feature table does exactly that in one
 * row). The float mode's fifteen is `display.ts`'s default and not this file's
 * business to change.
 */

import { all, create } from "mathjs";
import type { FactoryFunctionMap, FormatOptions, MathJsInstance, MathNode } from "mathjs";

import {
  DEFAULT_CALCULATOR_FORMAT,
  formatCalculatorDisplay,
  type CalculatorFormatOptions,
} from "./display.js";
import {
  FACTORIAL_CALLS,
  MAX_EXPRESSION_LENGTH,
  MAX_FACTORIAL_ARGUMENT,
  MAX_MATRIX_ELEMENTS,
  elementCount,
  sizeBuildingCall,
} from "./limits.js";
import {
  CALCULATOR_SESSION_VERSION,
  MAX_CALCULATOR_VALUE_LENGTH,
  emptyCalculatorSession,
  parseCalculatorSession,
  type CalculatorSession,
} from "./session.js";

/** The two arithmetic modes the product offers. */
export const CALCULATOR_PRECISIONS = ["float", "bignumber"] as const;
export type CalculatorPrecision = (typeof CALCULATOR_PRECISIONS)[number];

/** The three angle modes a scientific calculator's DEG/RAD/GRAD switch has. */
export const CALCULATOR_ANGLE_MODES = ["deg", "rad", "grad"] as const;
export type CalculatorAngleMode = (typeof CALCULATOR_ANGLE_MODES)[number];

/**
 * Significant digits the bignumber mode carries. Sixty-four is `decimal.js`'s own
 * working precision and roughly the point where further digits stop being worth
 * the arithmetic: the sixty-four digits of `1/3` are exact to the last one.
 */
export const BIG_NUMBER_PRECISION = 64;

/**
 * The closed set of machine codes. Stage 2 maps them to copy and may not invent
 * a code of its own; `CALCULATOR_CODES` is exported so it can be checked against
 * a table rather than agreed in a comment.
 *
 * `division-by-zero` is the one worth explaining: mathjs does NOT report
 * `1/0` in either mode — it answers `Infinity`, and the display shows `∞`. The
 * code exists for the paths that do report it (`fraction(1, 0)`, the one this
 * package's tests pin), because a closed set has to cover what the library can
 * say rather than only what it usually says.
 */
export const CALCULATOR_CODES = [
  "syntax",
  "unknown-symbol",
  "wrong-arguments",
  "division-by-zero",
  "unit-mismatch",
  "too-large",
  "disabled",
] as const;
export type CalculatorCode = (typeof CALCULATOR_CODES)[number];

/** An integer result in the three bases a programmer reads it in. */
export interface CalculatorProgrammerView {
  readonly hex: string;
  readonly octal: string;
  readonly binary: string;
}

export interface CalculatorSuccess {
  readonly ok: true;
  /** The result in mathjs's own lexical form — exact, and what the session stores. */
  readonly value: string;
  /** The same result as the reader sees it, in the requested locale. */
  readonly display: string;
  /** The bases of an integer result that fits one machine word, or null. */
  readonly programmer: CalculatorProgrammerView | null;
  /** The session AFTER this expression: new variables and functions, and `ans`. */
  readonly session: CalculatorSession;
}

export interface CalculatorFailure {
  readonly ok: false;
  readonly code: CalculatorCode;
  /** The zero-based character a syntax error stopped at, when mathjs names one. */
  readonly position?: number;
}

export type CalculatorOutcome = CalculatorSuccess | CalculatorFailure;

export interface CalculatorEvaluateOptions {
  /** The session this expression runs against. Absent means an empty one. */
  readonly session?: CalculatorSession;
  /** DEG by default, because that is what a school calculator opens on. */
  readonly angleMode?: CalculatorAngleMode;
  /** Locale and display rounding; see `display.ts`. */
  readonly format?: Partial<CalculatorFormatOptions>;
}

export interface CalculatorEngine {
  readonly precision: CalculatorPrecision;
  evaluate(expression: string, options?: CalculatorEvaluateOptions): CalculatorOutcome;
}

/**
 * Builds an engine of one precision. Cheap (the whole instance is ~5 ms) and
 * stateless from the caller's point of view: everything an `evaluate` needs is
 * in its arguments, and the session it returns is the one to hand to the next
 * call.
 */
export function createCalculatorEngine(precision: CalculatorPrecision): CalculatorEngine {
  const instance = instances.get(precision) ?? buildInstance(precision);
  instances.set(precision, instance);
  return {
    precision,
    evaluate: (expression, options) => evaluate(instance, expression, options),
  };
}

/** Thrown by every disabled function. A class rather than a message test, because a message is somebody's wording and a class is not. */
class CalculatorDisabledError extends Error {
  override readonly name = "CalculatorDisabledError";
  constructor(readonly disabledFunction: string) {
    super(`Function ${disabledFunction} is disabled`);
  }
}

/**
 * The functions an expression may not call.
 *
 * The first eight are mathjs's own list (`docs/expressions/security.html`):
 * `import` and `createUnit` rewrite the library's own functions and units,
 * `reviver` parses values into class instances, and `evaluate`, `parse`,
 * `simplify`, `derivative` and `resolve` parse arbitrary text into a
 * manipulable tree.
 *
 * The last three are this module's additions, each for a reason worth stating:
 *
 *  - **`compile`** parses text into exactly the tree `parse` does; the page's
 *    argument covers it and its list simply predates it.
 *  - **`help`** is implemented by CALLING the instance's own `evaluate`, so with
 *    `evaluate` stubbed a real `help` fails with "Function evaluate is
 *    disabled" — a message that names the wrong function and sends a reader
 *    hunting for a bug that is not there.
 *  - **`parser`** hands back an object whose `evaluate` and `compile` methods are
 *    the stubs, so it is already inert; refusing the factory as well is the same
 *    decision stated one step earlier, and it keeps a Parser out of a result
 *    that is supposed to be a number.
 */
const DISABLED_FUNCTIONS = [
  "import",
  "createUnit",
  "reviver",
  "evaluate",
  "parse",
  "simplify",
  "derivative",
  "resolve",
  "compile",
  "help",
  "parser",
] as const;

/** The trig functions whose ARGUMENT the angle mode describes. */
const FORWARD_TRIG = ["sin", "cos", "tan", "sec", "csc", "cot"] as const;

/** The inverse trig functions whose RESULT the angle mode describes. */
const INVERSE_TRIG = ["asin", "acos", "atan", "asec", "acsc", "acot"] as const;

/**
 * The largest integer the programmer view is offered for: two to the sixty-fourth
 * power, one past the last unsigned 64-bit word.
 *
 * The bound is not cosmetic. `math.format(value, { notation: "hex" })` renders
 * every bit, so a bignumber `10^100000` — which is one compact number to Decimal
 * — would become a 332 193-character string of hex digits. The display of an
 * ordinary result is at most a couple of dozen characters; this keeps the
 * programmer view in the same class.
 */
const PROGRAMMER_MAX_MAGNITUDE = 2 ** 64;

interface BuiltInstance {
  readonly precision: CalculatorPrecision;
  readonly math: MathJsInstance;
  /** Captured before the stubs were installed, which is the only way to keep one. */
  readonly evaluate: (expression: string, scope: Record<string, unknown>) => unknown;
  readonly parse: (expression: string) => MathNode;
  readonly format: (value: unknown, options?: FormatOptions) => string;
  /** The angle mode the trig wrappers read for the duration of one call. */
  angleMode: CalculatorAngleMode;
  /** Radians per unit of each mode, computed by mathjs so the bignumber mode carries all sixty-four digits. */
  readonly radiansPer: Readonly<Record<Exclude<CalculatorAngleMode, "rad">, unknown>>;
  /** Units of each mode per radian, the inverse direction. */
  readonly perRadian: Readonly<Record<Exclude<CalculatorAngleMode, "rad">, unknown>>;
  /** Two to the sixty-fourth as a BigNumber, so a BigNumber result is never mixed with a float in a comparison mathjs refuses to convert. */
  readonly programmerMaxBig: unknown;
}

/** One instance per precision, shared by every engine of that precision — the angle holder is written at the start of each synchronous call. */
const instances = new Map<CalculatorPrecision, BuiltInstance>();

function buildInstance(precision: CalculatorPrecision): BuiltInstance {
  // `all` is typed as possibly absent (it is the runtime's own factory map and
  // is never absent in practice); the cast is what says so once, here, rather
  // than at every use.
  const math = create(
    all as FactoryFunctionMap,
    precision === "bignumber" ? { number: "BigNumber", precision: BIG_NUMBER_PRECISION } : {},
  );
  // Taken before anything is imported over them; `math.evaluate` stays reachable
  // through this reference and through nothing else.
  const evaluate = math.evaluate;
  const parse = math.parse;
  const format = math.format;
  const instance: BuiltInstance = {
    precision,
    math,
    evaluate,
    parse,
    format,
    angleMode: "deg",
    radiansPer: {
      deg: math.divide(math.pi, 180),
      grad: math.divide(math.pi, 200),
    },
    perRadian: {
      deg: math.divide(180, math.pi),
      grad: math.divide(200, math.pi),
    },
    // `2 ** 64` as a BigNumber is computed rather than converted: a JS double
    // that large cannot be turned into an exact BigNumber, and a bound four
    // units out would let one mode's 2^64 through where the other refused it.
    programmerMaxBig: math.pow(math.bignumber(2), 64),
  };

  const imports: Record<string, unknown> = {
    // The product's own spellings: mathjs calls the natural logarithm `log`
    // (with `log(x, base)` for the rest) and has no `ln`, `nCr` or `nPr` at all.
    ln: (value: unknown) => math.log(value as number),
    nCr: (n: number, k: number) => math.combinations(n, k),
    nPr: (n: number, k: number) => math.permutations(n, k),
  };
  for (const name of FORWARD_TRIG) imports[name] = forwardTrig(instance, name);
  for (const name of INVERSE_TRIG) imports[name] = inverseTrig(instance, name);
  math.import(imports, { override: true });

  const stubs: Record<string, unknown> = {};
  for (const name of DISABLED_FUNCTIONS) {
    stubs[name] = () => {
      throw new CalculatorDisabledError(name);
    };
  }
  // Last, and with `override`, for the page's own reason: every name above now
  // resolves to a function that throws instead of to the library's.
  math.import(stubs, { override: true });
  return instance;
}

/**
 * `sin(30)` in degrees is `sin` of the radians 30 degrees is. A unit argument
 * already says what it is, so it is passed through untouched.
 *
 * The wrappers take their arguments as a REST list and hand anything that is not
 * the single plain angle straight to mathjs's own function, which is what keeps
 * mathjs's arity checking: a wrapper declared `(value) => …` would silently
 * answer `sin(1, 2, 3)` by ignoring two of them.
 */
function forwardTrig(instance: BuiltInstance, name: string): (...args: unknown[]) => unknown {
  const raw = callable(instance, name);
  return (...args: unknown[]) => {
    const value = args[0];
    if (args.length !== 1 || value === undefined) return raw(...args);
    if (instance.angleMode === "rad" || !isPlainAngle(value, instance)) return raw(value);
    return raw(radiansFor(instance, value));
  };
}

/** `atan(1)` in gradians is the angle, expressed in the mode the caller asked for; a complex answer stays in radians. */
function inverseTrig(instance: BuiltInstance, name: string): (...args: unknown[]) => unknown {
  const raw = callable(instance, name);
  return (...args: unknown[]) => {
    const value = args[0];
    if (args.length !== 1 || value === undefined) return raw(...args);
    const result = raw(value);
    if (instance.angleMode === "rad") return result;
    if (!isPlainAngle(result, instance)) return result;
    return multiply(instance, result, instance.perRadian[modeOf(instance)]);
  };
}

/** A number or a BigNumber — what an angle mode is about. A `Unit`, a `Fraction` or a `Complex` says for itself what it is. */
function isPlainAngle(value: unknown, instance: BuiltInstance): boolean {
  return typeof value === "number" || instance.math.typeOf(value as object) === "BigNumber";
}

function radiansFor(instance: BuiltInstance, value: unknown): unknown {
  if (instance.angleMode === "rad") return value;
  return multiply(instance, value, instance.radiansPer[modeOf(instance)]);
}

function modeOf(instance: BuiltInstance): Exclude<CalculatorAngleMode, "rad"> {
  return instance.angleMode === "rad" ? "deg" : instance.angleMode;
}

/** One function off the instance by name. mathjs's own type for these is a hundred-odd named members, and this file needs three by string. */
function callable(instance: BuiltInstance, name: string): (...args: unknown[]) => unknown {
  return (instance.math as unknown as Record<string, (...args: unknown[]) => unknown>)[name] as (
    ...args: unknown[]
  ) => unknown;
}

function multiply(instance: BuiltInstance, left: unknown, right: unknown): unknown {
  return instance.math.multiply(left as number, right as number) as unknown;
}

function evaluate(
  instance: BuiltInstance,
  expression: string,
  options?: CalculatorEvaluateOptions,
): CalculatorOutcome {
  // An unreadable session is treated as an empty one rather than as a refusal:
  // the store validates what it hands over, so this is the recovery path for a
  // hand-edited file, and it must not make the calculator refuse every
  // expression the user types from then on.
  const session = parseCalculatorSession(options?.session ?? emptyCalculatorSession()) ?? emptyCalculatorSession();
  const angleMode = options?.angleMode ?? "deg";
  const formatOptions: Partial<CalculatorFormatOptions> = options?.format ?? {};

  if (expression.length > MAX_EXPRESSION_LENGTH) return { ok: false, code: "too-large" };
  // An empty box, or a line holding nothing but a comment: mathjs parses both to
  // a node with no value and answers `undefined`, which is not a result to show.
  if (expression.trim().length === 0) return { ok: false, code: "syntax" };

  let node: MathNode;
  try {
    node = instance.parse(expression);
  } catch (error) {
    return refusal(error);
  }

  instance.angleMode = angleMode;
  const scope: Record<string, unknown> = {};
  materialise(instance, session, scope);

  const tooLarge = guardProblem(instance, node, scope);
  if (tooLarge) return { ok: false, code: "too-large" };

  let result: unknown;
  try {
    result = instance.evaluate(expression, scope);
  } catch (error) {
    return refusal(error);
  }
  if (result === undefined) return { ok: false, code: "syntax" };

  const value = instance.format(result);
  const display = formatCalculatorDisplay(value, {
    precision: instance.precision === "float" ? DEFAULT_CALCULATOR_FORMAT.precision : null,
    ...formatOptions,
  });
  return {
    ok: true,
    value,
    display,
    programmer: programmerView(instance, result),
    session: sessionAfter(instance, node, scope, session, result),
  };
}

/**
 * Puts a stored session into a mathjs scope. FUNCTIONS FIRST, because a variable
 * may hold a function's name; values after, in the order they were added, which
 * is also the order they are written back in.
 *
 * An entry that fails to evaluate is SKIPPED rather than fatal: the store
 * validates a session's shape and lengths, and a text that no longer parses is
 * corruption — which must not make the calculator unusable for every other
 * expression. The value returned to the caller leaves it out, so the corruption
 * is not propagated either.
 */
function materialise(
  instance: BuiltInstance,
  session: CalculatorSession,
  scope: Record<string, unknown>,
): void {
  for (const [name, definition] of Object.entries(session.functions)) {
    tryTo(() => {
      instance.evaluate(`${name}(${definition.params.join(", ")}) = ${definition.body}`, scope);
    });
  }
  for (const [name, text] of Object.entries(session.variables)) {
    tryTo(() => {
      scope[name] = instance.evaluate(text, scope);
    });
  }
  if (session.ans !== null) {
    tryTo(() => {
      scope["ans"] = instance.evaluate(session.ans as string, scope);
    });
  }
}

function tryTo(action: () => void): void {
  try {
    action();
  } catch {
    // Skipped on purpose; the caller's comment says why.
  }
}

/**
 * The session after one expression: the scope's own values (minus `ans`, minus
 * anything that is a function), the user functions the expression DEFINED, and
 * the new `ans`.
 *
 * A defined function is read off the parsed tree rather than off the scope,
 * because a compiled mathjs function does not carry its source: the tree is the
 * only place the parameters and the body still exist as text. A function that
 * arrived any other way (`g = f`, an alias) is a value the session does not
 * store, and `renderValue` refuses it — which is what keeps the session's
 * functions a list of DEFINITIONS rather than of aliases.
 */
function sessionAfter(
  instance: BuiltInstance,
  node: MathNode,
  scope: Record<string, unknown>,
  previous: CalculatorSession,
  result: unknown,
): CalculatorSession {
  const variables: Record<string, string> = {};
  for (const [name, value] of Object.entries(scope)) {
    if (name === "ans") continue;
    const rendered = renderValue(instance, value);
    if (rendered !== null) variables[name] = rendered;
  }

  const functions: Record<string, { params: readonly string[]; body: string }> = {
    ...previous.functions,
  };
  node.traverse((child) => {
    if (child.type !== "FunctionAssignmentNode") return;
    const definition = child as unknown as { name: string; params: string[]; expr: MathNode };
    functions[definition.name] = { params: [...definition.params], body: definition.expr.toString() };
  });

  return {
    version: CALCULATOR_SESSION_VERSION,
    variables,
    functions,
    ans: renderValue(instance, result) ?? previous.ans,
  };
}

/**
 * One value as the text a session stores: mathjs's own lexical form, which is
 * exact and re-parseable (`math.format` round-trips for every type this engine
 * can produce — `display.ts`'s tests and this file's session rows are where that
 * is checked).
 *
 * Three types need saying out loud. A `Fraction` formats as `1/3`, which would
 * come back as a DIVISION in the float mode, so it is stored as the call that
 * builds it. A function is not a value a session holds. And a value longer than
 * {@link MAX_CALCULATOR_VALUE_LENGTH} is refused rather than truncated, because a
 * silently shortened number is worse than a missing one.
 */
function renderValue(instance: BuiltInstance, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const kind = instance.math.typeOf(value as object);
  if (kind === "function" || kind === "Object" || kind === "undefined") return null;
  const text = kind === "Fraction" ? `fraction("${instance.format(value)}")` : instance.format(value);
  if (text.length === 0 || text.length > MAX_CALCULATOR_VALUE_LENGTH) return null;
  return text;
}

/** The programmer view, for an integer that fits one machine word. */
function programmerView(
  instance: BuiltInstance,
  value: unknown,
): CalculatorProgrammerView | null {
  const kind = instance.math.typeOf(value as object);
  if (kind !== "number" && kind !== "BigNumber" && kind !== "bigint") return null;
  try {
    if (instance.math.isInteger(value as number) !== true) return null;
    if (!fitsOneWord(instance, value)) return null;
    return {
      hex: instance.format(value, { notation: "hex" }),
      octal: instance.format(value, { notation: "oct" }),
      binary: instance.format(value, { notation: "bin" }),
    };
  } catch {
    return null;
  }
}

/**
 * Whether a value is inside the word the programmer view is about.
 *
 * This is deliberately NOT `math.smaller`. mathjs's relational functions are
 * nearly-equal based (its default epsilon is 1e-12, relative), so
 * `smaller(2^64 - 1, 2^64)` answers FALSE â€” two numbers that differ in the
 * twentieth of twenty digits are "equal" to it, which is exactly the comparison
 * this bound is. A double is compared by its own exact arithmetic, and a
 * BigNumber by decimal.js's own `lessThan`, which has no epsilon at all.
 */
function fitsOneWord(instance: BuiltInstance, value: unknown): boolean {
  if (instance.math.typeOf(value as object) === "BigNumber") {
    const decimal = instance.math.abs(value as number) as unknown as {
      lessThan(other: unknown): boolean;
    };
    return decimal.lessThan(instance.programmerMaxBig);
  }
  return Math.abs(Number(value)) < PROGRAMMER_MAX_MAGNITUDE;
}

/**
 * The bounds, checked against the parsed tree.
 *
 * One walk, three questions per node, and the answers are the three shapes that
 * make mathjs work without end: a matrix whose size the expression states, a
 * factorial past the point where the arithmetic is worth doing, and a dimension
 * that is not a number. See `limits.ts` for the numbers and for what the guard
 * deliberately does not model.
 */
function guardProblem(
  instance: BuiltInstance,
  node: MathNode,
  scope: Record<string, unknown>,
): boolean {
  let found = false;
  node.traverse((child) => {
    if (found) return;
    const shape = shapeOf(instance, child, scope);
    if (shape !== null && elementCount(shape) > MAX_MATRIX_ELEMENTS) {
      found = true;
      return;
    }
    const name = callName(child);
    if (name === null) return;
    if ((FACTORIAL_CALLS as readonly string[]).includes(name)) {
      const argument = numberArgument(instance, child, 0, scope);
      if (argument === undefined) return;
      if (!Number.isFinite(argument) || argument > MAX_FACTORIAL_ARGUMENT) found = true;
      return;
    }
    const call = sizeBuildingCall(name);
    if (call === undefined) return;
    const dimensions = dimensionsOf(instance, child, scope);
    // A dimension the guard cannot read is left to mathjs, which refuses a
    // non-number itself. A dimension it CAN read but that is not finite is a
    // request for an unbounded array, which is this guard's business.
    if (dimensions !== null && dimensions.some((dimension) => !Number.isFinite(dimension))) {
      found = true;
    }
  });
  return found;
}

/** The function a call or an operator node names, or null. `3!` is a call to `factorial` with one argument, which is why it is asked here too. */
function callName(node: MathNode): string | null {
  if (node.type === "FunctionNode") {
    const fn = (node as unknown as { fn: MathNode }).fn;
    return fn.type === "SymbolNode" ? (fn as unknown as { name: string }).name : null;
  }
  if (node.type === "OperatorNode") {
    const operator = node as unknown as { fn: string | undefined };
    return operator.fn ?? null;
  }
  return null;
}

/** The arguments of a call or operator node, as nodes. */
function argumentsOf(node: MathNode): readonly MathNode[] {
  if (node.type === "FunctionNode") return (node as unknown as { args: MathNode[] }).args;
  if (node.type === "OperatorNode") return (node as unknown as { args: MathNode[] }).args;
  return [];
}

/** The n-th argument resolved to a number, `undefined` when it is not one. */
function numberArgument(
  instance: BuiltInstance,
  node: MathNode,
  index: number,
  scope: Record<string, unknown>,
): number | undefined {
  const argument = argumentsOf(node)[index];
  if (argument === undefined) return undefined;
  return resolveNumber(instance, argument, scope) ?? undefined;
}

/** Every argument of a size-building call, flattened: `ones(2, 3)` and `ones([2, 3])` say the same thing. */
function dimensionsOf(
  instance: BuiltInstance,
  node: MathNode,
  scope: Record<string, unknown>,
): readonly number[] | null {
  const dimensions: number[] = [];
  for (const argument of argumentsOf(node)) {
    if (argument.type === "ArrayNode") {
      const items = (argument as unknown as { items: MathNode[] }).items;
      for (const item of items) {
        const value = resolveNumber(instance, item, scope);
        if (value === null) return null;
        dimensions.push(value);
      }
      continue;
    }
    const value = resolveNumber(instance, argument, scope);
    if (value === null) return null;
    dimensions.push(value);
  }
  return dimensions.length === 0 ? null : dimensions;
}

/** A shape, or null when it is not something this guard models (`limits.ts` says why that is deliberate). */
type Shape = readonly number[];

function shapeOf(
  instance: BuiltInstance,
  node: MathNode,
  scope: Record<string, unknown>,
): Shape | null {
  switch (node.type) {
    case "ParenthesisNode":
      return shapeOf(instance, (node as unknown as { content: MathNode }).content, scope);
    case "ConstantNode": {
      const value = (node as unknown as { value: unknown }).value;
      return typeof value === "number" ? [] : null;
    }
    case "ArrayNode": {
      const items = (node as unknown as { items: MathNode[] }).items;
      if (items.length === 0) return [0];
      const shapes = items.map((item) => shapeOf(instance, item, scope));
      const first = shapes[0];
      if (first === null || first === undefined) return null;
      for (const shape of shapes) {
        if (shape === null || shape.length !== first.length) return null;
        if (shape.some((dimension, index) => dimension !== first[index])) return null;
      }
      return [items.length, ...first];
    }
    case "SymbolNode": {
      const name = (node as unknown as { name: string }).name;
      if (!Object.prototype.hasOwnProperty.call(scope, name)) return null;
      return shapeOfValue(instance, scope[name]);
    }
    case "FunctionNode": {
      const name = callName(node);
      const args = argumentsOf(node);
      if (name === "transpose" || name === "ctranspose") {
        const argument = args[0];
        if (argument === undefined) return null;
        const inner = shapeOf(instance, argument, scope);
        return inner === null ? null : [...inner].reverse();
      }
      const call = name === null ? undefined : sizeBuildingCall(name);
      if (call === undefined) return null;
      const dimensions = dimensionsOf(instance, node, scope);
      return dimensions === null ? null : call.dimensions(dimensions);
    }
    case "OperatorNode": {
      const operator = node as unknown as { fn: string | undefined; args: MathNode[] };
      const args = operator.args;
      const left = args[0];
      const right = args[1];
      if (left === undefined) return null;
      if (right === undefined) {
        return operator.fn === "unaryMinus" || operator.fn === "unaryPlus"
          ? shapeOf(instance, left, scope)
          : null;
      }
      const leftShape = shapeOf(instance, left, scope);
      const rightShape = shapeOf(instance, right, scope);
      if (leftShape === null || rightShape === null) return null;
      if (operator.fn === "multiply") return multiplyShape(leftShape, rightShape);
      if (operator.fn === "dotMultiply" || operator.fn === "add" || operator.fn === "subtract") {
        return sameShape(leftShape, rightShape) ? leftShape : null;
      }
      return null;
    }
    default:
      return null;
  }
}

function shapeOfValue(instance: BuiltInstance, value: unknown): Shape | null {
  try {
    const size = instance.math.size(value as number) as unknown;
    if (!Array.isArray(size) || size.some((dimension) => typeof dimension !== "number")) {
      return size === undefined ? null : [];
    }
    return size as number[];
  } catch {
    return null;
  }
}

/** A scalar leaves the other operand's shape alone; two vectors make a scalar; a matrix product is rows by columns. Anything wider is not modelled. */
function multiplyShape(left: Shape, right: Shape): Shape | null {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  if (left.length === 1 && right.length === 1) return [];
  if (left.length === 1) return [right[1] ?? 0];
  if (right.length === 1) return [left[0] ?? 0];
  if (left.length === 2 && right.length === 2) return [left[0] ?? 0, right[1] ?? 0];
  return null;
}

function sameShape(left: Shape, right: Shape): boolean {
  return left.length === right.length && left.every((dimension, index) => dimension === right[index]);
}

/**
 * A number, for the arguments of the calls the guard is about — and nothing
 * more. It resolves a literal, a session variable, and the arithmetic BETWEEN
 * literals (`ones(n, n)`, `range(1, 10^7)`, `ones(2 + 3, 4)`), because those are
 * the ways a size is spelled. It does not resolve a call, which is what keeps
 * the guard from becoming a second evaluator: `ones(factorial(20))` is left to
 * mathjs, and the factorial itself is checked by the rule above.
 */
function resolveNumber(
  instance: BuiltInstance,
  node: MathNode,
  scope: Record<string, unknown>,
): number | null {
  switch (node.type) {
    case "ConstantNode": {
      const value = (node as unknown as { value: unknown }).value;
      return typeof value === "number" ? value : null;
    }
    case "ParenthesisNode":
      return resolveNumber(instance, (node as unknown as { content: MathNode }).content, scope);
    case "SymbolNode": {
      const name = (node as unknown as { name: string }).name;
      const value = Object.prototype.hasOwnProperty.call(scope, name) ? scope[name] : undefined;
      if (typeof value === "number") return value;
      if (value !== undefined && instance.math.typeOf(value as object) === "BigNumber") {
        return Number(instance.format(value));
      }
      return null;
    }
    case "OperatorNode": {
      const operator = node as unknown as { fn: string | undefined; args: MathNode[] };
      const values = operator.args.map((argument) => resolveNumber(instance, argument, scope));
      if (values.some((value) => value === null)) return null;
      const numbers = values as number[];
      if (numbers.length === 1) {
        const only = numbers[0] as number;
        if (operator.fn === "unaryMinus") return -only;
        return operator.fn === "unaryPlus" ? only : null;
      }
      const left = numbers[0] as number;
      const right = numbers[1] as number;
      switch (operator.fn) {
        case "add":
          return left + right;
        case "subtract":
          return left - right;
        case "multiply":
          return left * right;
        case "divide":
          return right === 0 ? null : left / right;
        case "pow":
          return left ** right;
        case "mod":
          return right === 0 ? null : left % right;
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

/**
 * What mathjs's own refusals are called in this module's vocabulary.
 *
 * The order matters and is deliberate: a `SyntaxError` first (it is a class
 * rather than a wording), then the stubs, then the messages. The last line is
 * the catch-all, and it is honest about being one: `wrong-arguments` is what
 * mathjs's remaining refusals are — a dimension mismatch, an argument of the
 * wrong type, a user function that recursed until the stack ran out — and every
 * one of them is the expression asking an operation for something it cannot do.
 */
function refusal(error: unknown): CalculatorFailure {
  if (error instanceof CalculatorDisabledError) return { ok: false, code: "disabled" };

  const message = error instanceof Error ? error.message : "";
  if (error instanceof SyntaxError || /\(char \d+\)/.test(message)) {
    const position = positionOf(error);
    return position === undefined
      ? { ok: false, code: "syntax" }
      : { ok: false, code: "syntax", position };
  }
  if (/Undefined (symbol|function)/.test(message)) return { ok: false, code: "unknown-symbol" };
  // mathjs refuses the property names that would lead out of its own world;
  // there is no name here, so there is no symbol to name.
  if (/No access to property/.test(message)) return { ok: false, code: "unknown-symbol" };
  if (/Units do not match|is no angle/.test(message)) return { ok: false, code: "unit-mismatch" };
  if (/[Dd]ivision by [Zz]ero/.test(message)) return { ok: false, code: "division-by-zero" };
  if (/Invalid array length/.test(message)) return { ok: false, code: "too-large" };
  return { ok: false, code: "wrong-arguments" };
}

/** mathjs's `char` is one-based and names the character it wanted; a caret in a text field counts from zero. */
function positionOf(error: unknown): number | undefined {
  const char = (error as { char?: unknown }).char;
  return typeof char === "number" && char > 0 ? char - 1 : undefined;
}
