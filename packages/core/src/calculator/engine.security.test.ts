import { describe, expect, it } from "vitest";

import {
  MAX_EXPRESSION_LENGTH,
  MAX_FACTORIAL_ARGUMENT,
  MAX_MATRIX_ELEMENTS,
} from "./limits.js";
import {
  CALCULATOR_CODES,
  createCalculatorEngine,
  type CalculatorCode,
  type CalculatorFailure,
} from "./engine.js";
import type { CalculatorSession } from "./session.js";

const ENGINE = createCalculatorEngine("float");
const BIG = createCalculatorEngine("bignumber");

function refuse(expression: string, options?: Parameters<typeof ENGINE.evaluate>[1]): CalculatorFailure {
  const outcome = ENGINE.evaluate(expression, options);
  if (outcome.ok) {
    throw new Error(`expected "${expression}" to be refused, but it displayed ${outcome.display}`);
  }
  return outcome;
}

/**
 * The refusals, each named.
 *
 * This file is the answer to two questions that are not the same one: *can an
 * expression reach JavaScript* (the disabled functions and the prototype
 * names), and *can an expression make the engine work forever* (the bounds).
 * Every case is asserted by the CODE it produces, because stage 2 turns codes
 * into sentences and a code that is merely "some failure" would ship as "nešto
 * je pošlo naopako".
 */

describe("the functions the security page names are disabled", () => {
  // The eight mathjs names its own security page lists, each called the way an
  // expression would call it. `engine.ts` stubs every one of them with a
  // function that throws a typed error, so the refusal is ours rather than
  // mathjs's "Undefined function".
  const DISABLED: readonly (readonly [string, string])[] = [
    ["import", 'import("x")'],
    ["createUnit", 'createUnit("foo")'],
    ["reviver", 'reviver("1")'],
    ["evaluate", 'evaluate("2 + 2")'],
    ["parse", 'parse("2 + 2")'],
    ["simplify", 'simplify("x + x")'],
    ["derivative", 'derivative("x^2", "x")'],
    ["resolve", "resolve(1)"],
    // Not on that page, and here for their own reasons: `compile` parses
    // arbitrary text into the same kind of tree `parse` does, and mathjs
    // implements `help` by calling the instance's own `evaluate` — so a help
    // that were left in place would fail with "Function evaluate is disabled",
    // which names the wrong thing.
    ["compile", 'compile("2 + 2")'],
    ["help", 'help("sqrt")'],
    // `parser` is the factory the page's list does not name, and it belongs
    // here for a reason the other nine share: the object it hands back has
    // methods, and a method is only reachable through the property access that
    // mathjs already refuses. Refusing the factory as well is the same decision
    // stated one step earlier.
    ["parser", "parser()"],
  ];

  for (const [name, expression] of DISABLED) {
    it(`refuses ${name}`, () => {
      const outcome = refuse(expression);
      expect({ name, code: outcome.code }).toEqual({ name, code: "disabled" });
    });
  }

  it("still evaluates everything else through the reference it captured first", () => {
    // The stubs replace the instance's methods; the engine's own evaluate was
    // taken before they were installed, which is the pattern the page shows.
    const outcome = ENGINE.evaluate("sqrt(16) + 1");
    expect(outcome.ok && outcome.display).toBe("5");
  });
});

describe("no access to JavaScript objects, constructors or prototypes", () => {
  // mathjs refuses the property names that would lead out of its own world;
  // what this file adds is that the refusal arrives as OUR code rather than as
  // an exception escaping the engine, and that a parser object cannot be used
  // to reach an evaluator either.
  const REFUSED: readonly (readonly [string, CalculatorCode])[] = [
    ["(1).constructor", "unknown-symbol"],
    ["[1, 2].constructor", "unknown-symbol"],
    ['"abc".constructor', "unknown-symbol"],
    ["sin.constructor", "unknown-symbol"],
    ["__proto__", "unknown-symbol"],
    ["(1).__proto__", "unknown-symbol"],
    ["constructor", "unknown-symbol"],
    ["unit(1, \"m\").value", "unknown-symbol"],
    ["parser().evaluate(\"2 + 2\")", "disabled"],
    // `rationalize` is the one function left that reads expression text, and
    // its detailed form hands back a tree — which this proves is inert: the
    // only way to reach inside it is the property access mathjs refuses.
    ['rationalize("x + 1", {}, true).expression', "disabled"],
  ];

  for (const [expression, code] of REFUSED) {
    it(`refuses ${expression}`, () => {
      const outcome = refuse(expression);
      expect({ expression, code: outcome.code }).toEqual({ expression, code });
    });
  }

  it("offers no function that turns text into code", () => {
    // `rationalize` is the one mathjs function left that reads expression text
    // as text, and it turns out to be unusable here for a reason worth keeping:
    // its string form reaches a parser INTERNALLY, so it lands on one of the
    // stubs and the refusal is `disabled` rather than an answer. Its numeric
    // form is untouched, which is what proves the names were stubbed rather
    // than deleted.
    // Both of its forms are refused, from opposite directions: the TEXT form
    // resolves its argument through a parser of its own and lands on a stub,
    // while a bare NUMBER is not in mathjs's own signature at all (it wants a
    // node or a string). Between the two there is no route left from expression
    // text to a tree.
    expect(refuse('rationalize("2/3")').code).toBe("disabled");
    expect(refuse("rationalize(0.75)").code).toBe("wrong-arguments");
  });
});

describe("the bounds", () => {
  it("states the three numbers it enforces, and refuses a longer expression than it says", () => {
    expect(MAX_EXPRESSION_LENGTH).toBe(1000);
    expect(MAX_MATRIX_ELEMENTS).toBe(10_000);
    expect(MAX_FACTORIAL_ARGUMENT).toBe(1000);

    const atTheBound = `1 + ${" ".repeat(MAX_EXPRESSION_LENGTH - 5)}1`;
    expect(atTheBound.length).toBe(MAX_EXPRESSION_LENGTH);
    expect(ENGINE.evaluate(atTheBound).ok).toBe(true);

    const overTheBound = `${atTheBound} + 1`;
    expect(overTheBound.length).toBe(MAX_EXPRESSION_LENGTH + 4);
    expect(refuse(overTheBound).code).toBe("too-large");
  });

  it("refuses a factorial past the argument bound, which is where the work stops being meaningful", () => {
    for (const expression of [
      "factorial(100000)",
      "100000!",
      "gamma(100000)",
      "combinations(100000, 2)",
      "permutations(100000, 2)",
    ]) {
      expect({ expression, code: refuse(expression).code }).toEqual({ expression, code: "too-large" });
    }
    // One hundred and seventy is about the last factorial a double can hold;
    // a thousand is the bound and a thousand works.
    expect(ENGINE.evaluate("factorial(170)").ok).toBe(true);
    expect(BIG.evaluate("factorial(1000)").ok).toBe(true);
  });

  it("refuses a matrix the expression itself sizes past the element bound", () => {
    for (const expression of [
      "ones(10000, 10000)",
      "ones([10000, 10000])",
      "zeros(5000, 5000)",
      "identity(10000)",
      "random(1000, 1000)",
      "range(1, 10^7)",
    ]) {
      expect({ expression, code: refuse(expression).code }).toEqual({ expression, code: "too-large" });
    }
  });

  it("refuses a size the guard can read through a session variable, not only through a literal", () => {
    const assigned = ENGINE.evaluate("n = 10000");
    if (!assigned.ok) throw new Error("expected n = 10000 to evaluate");
    const outcome = ENGINE.evaluate("ones(n, n)", { session: assigned.session });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe("too-large");

    // The same variable at a size that fits is allowed.
    const small = ENGINE.evaluate("ones(n, n)", {
      session: { ...assigned.session, variables: { n: "10" } },
    });
    expect(small.ok).toBe(true);
  });

  it("refuses a matrix PRODUCT of two shapes it can read, which no single call states", () => {
    for (const expression of [
      "ones(10000, 1) * ones(1, 10000)",
      "ones(200, 50) * ones(50, 200)",
    ]) {
      expect({ expression, code: refuse(expression).code }).toEqual({ expression, code: "too-large" });
    }
    // A product that fits is still a product.
    const small = ENGINE.evaluate("ones(3, 2) * ones(2, 3)");
    expect(small.ok && small.display).toBe("[[2, 2, 2], [2, 2, 2], [2, 2, 2]]");
    // And this is where the line is: two 100x100 operands are each exactly at
    // the element bound and their product is 100x100 as well, so it is allowed.
    // Its own text is what the bound was picked to cap — tens of kilobytes,
    // against the megabytes a 1 000 000-element result produces.
    const atTheBound = ENGINE.evaluate("ones(100, 100) * ones(100, 100)");
    expect(atTheBound.ok).toBe(true);
    expect(atTheBound.ok && atTheBound.value.length).toBeGreaterThan(20_000);
  });

  it("refuses a dimension that is not a number at all, rather than asking mathjs for an array of them", () => {
    // `10^10^10` is an ordinary double Infinity, and Infinity is not a size:
    // mathjs would spend its time and then throw "Invalid array length".
    expect(refuse("ones(10^10^10, 1)").code).toBe("too-large");
  });
});

describe("the engine never throws to its caller", () => {
  const REFUSALS: readonly (readonly [string, CalculatorCode])[] = [
    ["2 +", "syntax"],
    ["", "syntax"],
    ["2 +* 3", "syntax"],
    ["true = 1", "syntax"],
    ["foo(3)", "unknown-symbol"],
    ["foo + 1", "unknown-symbol"],
    ["sin()", "wrong-arguments"],
    ["sin(1, 2, 3)", "wrong-arguments"],
    ["1 m + 1", "wrong-arguments"],
    ["[1, 2] * [1, 2, 3]", "wrong-arguments"],
    ["1 m + 1 s", "unit-mismatch"],
    ["1 m to s", "unit-mismatch"],
    ["sin(1 m)", "unit-mismatch"],
    ["fraction(1, 0)", "division-by-zero"],
  ];

  for (const [expression, code] of REFUSALS) {
    it(`refuses ${JSON.stringify(expression)} with ${code}`, () => {
      expect({ expression, code: refuse(expression).code }).toEqual({ expression, code });
    });
  }

  it("names the character a syntax error stopped at, as a zero-based offset", () => {
    // mathjs reports "char 4" for both of these, one-based, where the token it
    // wanted was expected; a caret in a text field counts from zero.
    expect(refuse("2 +").position).toBe(3);
    expect(refuse("2 +* 3").position).toBe(3);
    // Nothing else carries a position, and the outcome says so by omitting it.
    expect("position" in refuse("foo + 1")).toBe(false);
  });

  it("survives a user function that calls itself forever", () => {
    // mathjs runs out of stack; the engine turns that into a code like any
    // other refusal, and the next expression still works.
    const defined = ENGINE.evaluate("f(x) = f(x)");
    expect(defined.ok).toBe(true);
    const session = defined.ok ? defined.session : undefined;
    const outcome = ENGINE.evaluate("f(1)", session ? { session } : undefined);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe("wrong-arguments");
    expect(ENGINE.evaluate("1 + 1").ok).toBe(true);
  });

  it("answers at all for the values that are not numbers", () => {
    const infinity = ENGINE.evaluate("1/0");
    expect(infinity.ok && infinity.display).toBe("∞");
    // mathjs does not report division by zero at all in either mode: it answers
    // Infinity, and NaN for 0/0. The code exists for the one path that DOES
    // report it (`fraction(1, 0)`, above), which is why it is in the closed set.
    const notANumber = ENGINE.evaluate("0/0");
    expect(notANumber.ok && notANumber.display).toBe("NaN");
    const bigInfinity = BIG.evaluate("1/0");
    expect(bigInfinity.ok && bigInfinity.display).toBe("∞");
  });

  it("keeps the code set closed", () => {
    expect([...CALCULATOR_CODES].sort()).toEqual([
      "disabled",
      "division-by-zero",
      "syntax",
      "too-large",
      "unit-mismatch",
      "unknown-symbol",
      "wrong-arguments",
    ]);
  });
});

describe("a session handed in from outside is treated as untrusted", () => {
  it("refuses to let a stored entry become a second expression to run", () => {
    // The value of a variable is text, and text that is not a value is simply
    // not injectable: the engine skips it rather than evaluating a statement.
    const session: CalculatorSession = {
      version: 1,
      variables: { x: "5", injected: 'import("x")' },
      functions: {},
      ans: null,
    };
    const outcome = ENGINE.evaluate("x", { session });
    expect(outcome.ok && outcome.display).toBe("5");
    expect(outcome.ok && outcome.session.variables).toEqual({ x: "5" });
  });
});
