/**
 * The calculator's bounds, and the table that says which calls build a matrix
 * out of numbers the guard can already read.
 *
 * **Why there are bounds at all.** mathjs evaluates expression text, so a typed
 * expression is a program, and two of its shapes are cheap to type and
 * expensive to run: `ones(10000, 10000)` held a Node process at 100 % for
 * twenty-five seconds and was killed (measured), and `range(1, 10^7)` the same;
 * `ones(1000, 1000)` finished in 1 468 ms and produced a 3 MB display string
 * (measured). The engine therefore refuses, BEFORE evaluating, the shapes it can
 * see coming — and `limits.ts` is what tells it which those are.
 *
 * **The guard bounds what it can READ, and says so.** The count is computed from
 * the call's own arguments, resolved as numbers against the session's variables
 * — so `ones(10000, 10000)` and `ones(n, n)` with `n = 10000` are both refused,
 * while a size the guard cannot resolve (a unit, a matrix, a symbol it does not
 * know) is left to mathjs, which refuses it itself with a type error. What the
 * guard deliberately does NOT model is the dozen exotic builders whose result
 * size is not written in their arguments (`diag`, `kron`, `resize`, `concat`,
 * `inv`, …): modelling them would mean modelling matrix algebra, and stage 2's
 * worker timeout is the second line of defence for exactly the residue.
 */

/**
 * The longest expression the engine accepts, in characters.
 *
 * A thousand is an order of magnitude beyond anything a person types into one
 * line — the whole of `2 + 3 * (4 - 5) / 6` is sixteen — and it is the bound
 * that keeps the parse, the guard's walk and the worker's message all
 * proportional to something small. It is also the length a function's BODY is
 * held to when a session is read back from a column (`session.ts`), because that
 * body is expression text by construction.
 */
export const MAX_EXPRESSION_LENGTH = 1000;

/**
 * The most elements a matrix one expression builds may hold.
 *
 * Ten thousand is roughly a 100 × 100 grid: already more than a person reads on
 * a calculator's line, and small enough that the canonical text one such result
 * produces stays in the tens of kilobytes. The measurement that fixes the order
 * of magnitude is above — 250 000 elements cost 332 ms and a 751 kB string,
 * 1 000 000 cost 1 468 ms and 3 MB, and five million did not finish.
 */
export const MAX_MATRIX_ELEMENTS = 10_000;

/**
 * The largest argument `factorial`, `gamma`, `combinations` and `permutations`
 * will be evaluated with.
 *
 * In the float mode anything past `171!` is `Infinity` before the arithmetic
 * starts, so a larger argument can only be asked for in the bignumber mode,
 * where the cost is real and grows with the argument: 100 000! took 117 ms and
 * 1 000 000! took 1 430 ms (both measured, both producing a 64-significant-digit
 * answer nobody reads). A thousand keeps every number a person might actually
 * want — 1 000! is a 2 568-digit integer — while refusing the shape that only
 * exists to make the engine work.
 */
export const MAX_FACTORIAL_ARGUMENT = 1000;

/**
 * A call whose result is a matrix whose size its OWN arguments state.
 *
 * `dimensions` receives the call's arguments already flattened to numbers (an
 * array argument such as `ones([2, 3])` arrives as `[2, 3]`) and answers the
 * shape, or `null` when the arguments do not describe one.
 */
export interface SizeBuildingCall {
  readonly name: string;
  readonly dimensions: (arguments_: readonly number[]) => readonly number[] | null;
}

export const SIZE_BUILDING_CALLS: readonly SizeBuildingCall[] = [
  // `ones(2, 3)`, `zeros(4)` and `random(2, 2)` all take the dimensions
  // directly; a missing one is mathjs's own default and is not this table's
  // business (an argument list it cannot read answers `null`).
  { name: "ones", dimensions: (arguments_) => (arguments_.length > 0 ? arguments_ : null) },
  { name: "zeros", dimensions: (arguments_) => (arguments_.length > 0 ? arguments_ : null) },
  { name: "random", dimensions: (arguments_) => (arguments_.length > 0 ? arguments_ : null) },
  {
    name: "identity",
    dimensions: (arguments_) =>
      arguments_.length === 1 && arguments_[0] !== undefined
        ? [arguments_[0], arguments_[0]]
        : null,
  },
  { name: "range", dimensions: (arguments_) => rangeDimensions(arguments_) },
];

/** The table's entry for a function name, or `undefined` when the call is not one of them. */
export function sizeBuildingCall(name: string): SizeBuildingCall | undefined {
  return SIZE_BUILDING_CALLS.find((call) => call.name === name);
}

/** How many elements a shape holds. An empty shape is a scalar: one element. */
export function elementCount(shape: readonly number[]): number {
  return shape.reduce((total, dimension) => total * dimension, 1);
}

/**
 * The shape of `range(start, end)` and `range(start, end, step)`: the number of
 * steps that fit, inclusive of both ends, which is mathjs's own rule
 * (`floor((end - start) / step) + 1`). A step of zero is left to mathjs, which
 * refuses it, so it answers `null` here rather than dividing by it.
 */
function rangeDimensions(arguments_: readonly number[]): readonly number[] | null {
  const [start, end, step] = arguments_;
  if (arguments_.length === 2 && start !== undefined && end !== undefined) {
    return [Math.floor(end - start) + 1];
  }
  if (arguments_.length === 3 && start !== undefined && end !== undefined && step !== undefined) {
    if (step === 0) return null;
    return [Math.floor((end - start) / step) + 1];
  }
  return null;
}

/** The names whose argument the factorial bound applies to, in the spelling mathjs knows them by. */
export const FACTORIAL_CALLS = ["factorial", "gamma", "combinations", "permutations"] as const;
