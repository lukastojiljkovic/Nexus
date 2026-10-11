import { describe, expect, it } from "vitest";

import {
  CALCULATOR_SESSION_VERSION,
  MAX_CALCULATOR_FUNCTION_PARAMS,
  MAX_CALCULATOR_NAME_LENGTH,
  MAX_CALCULATOR_SESSION_FUNCTIONS,
  MAX_CALCULATOR_SESSION_VARIABLES,
  emptyCalculatorSession,
  parseCalculatorSession,
  parseCalculatorSessionText,
  serializeCalculatorSession,
  type CalculatorSession,
} from "./session.js";

const SESSION: CalculatorSession = {
  version: 1,
  variables: { x: "5", poluprecnik: "2.5 km" },
  functions: { f: { params: ["x"], body: "x ^ 2 + 1" } },
  ans: "0.3",
};

/**
 * The session is the only thing that survives a closed window, and it is stored
 * as TEXT in a column that an archive can refill from a file somebody else
 * wrote — so every one of these cases is about a value arriving from outside.
 * A refusal is `null`, never an exception: the caller (the store, and behind it
 * main's IPC layer) is the one that decides what to say about it.
 */

describe("emptyCalculatorSession", () => {
  it("is a versioned, JSON-safe value with nothing in it", () => {
    const session = emptyCalculatorSession();
    expect(session).toEqual({ version: CALCULATOR_SESSION_VERSION, variables: {}, functions: {}, ans: null });
    expect(JSON.parse(JSON.stringify(session))).toEqual(session);
  });
});

describe("parseCalculatorSession", () => {
  it("accepts a session and returns its own canonical copy", () => {
    const parsed = parseCalculatorSession(SESSION);
    expect(parsed).toEqual(SESSION);
    expect(parsed).not.toBe(SESSION);
    expect(parsed?.functions["f"]).not.toBe(SESSION.functions["f"]);
  });

  it("round-trips through the JSON text the store keeps in its column", () => {
    const text = serializeCalculatorSession(SESSION);
    expect(typeof text).toBe("string");
    expect(parseCalculatorSessionText(text)).toEqual(SESSION);
  });

  it("answers null for text that is not JSON at all, rather than throwing", () => {
    expect(parseCalculatorSessionText("{oops")).toBeNull();
    expect(parseCalculatorSessionText("")).toBeNull();
  });

  it("refuses anything that is not a version-1 object", () => {
    expect(parseCalculatorSession(null)).toBeNull();
    expect(parseCalculatorSession([])).toBeNull();
    expect(parseCalculatorSession("x = 5")).toBeNull();
    // An unknown version is the one refusal that matters most: a later version
    // may hold shapes this reader would silently drop.
    expect(parseCalculatorSession({ ...SESSION, version: 2 })).toBeNull();
    expect(parseCalculatorSession({ ...SESSION, version: "1" })).toBeNull();
    expect(parseCalculatorSession({ ...SESSION, version: undefined })).toBeNull();
  });

  it("refuses a variable that is not a name holding text", () => {
    expect(parseCalculatorSession({ ...SESSION, variables: { x: 5 } })).toBeNull();
    expect(parseCalculatorSession({ ...SESSION, variables: [] })).toBeNull();
    expect(parseCalculatorSession({ ...SESSION, variables: { "": "5" } })).toBeNull();
    expect(parseCalculatorSession({ ...SESSION, variables: { "1x": "5" } })).toBeNull();
    expect(parseCalculatorSession({ ...SESSION, variables: { "x y": "5" } })).toBeNull();
    expect(
      parseCalculatorSession({
        ...SESSION,
        variables: { ["a".repeat(MAX_CALCULATOR_NAME_LENGTH + 1)]: "5" },
      }),
    ).toBeNull();
    expect(parseCalculatorSession({ ...SESSION, variables: { x: "" } })).toBeNull();
    expect(parseCalculatorSession({ ...SESSION, variables: { x: "5".repeat(40_000) } })).toBeNull();
  });

  it("refuses a function whose signature or body could not have come from the engine", () => {
    const withFunction = (f: unknown): unknown => ({ ...SESSION, functions: { f } });
    expect(parseCalculatorSession(withFunction({ params: [], body: "1" }))).toBeNull();
    expect(parseCalculatorSession(withFunction({ params: ["x", "y", "z", "w", "v"], body: "1" }))).toBeNull();
    expect(parseCalculatorSession(withFunction({ params: ["x", "x"], body: "1" }))).toBeNull();
    expect(parseCalculatorSession(withFunction({ params: ["1x"], body: "1" }))).toBeNull();
    expect(parseCalculatorSession(withFunction({ params: "x", body: "1" }))).toBeNull();
    expect(parseCalculatorSession(withFunction({ params: ["x"], body: "" }))).toBeNull();
    expect(parseCalculatorSession(withFunction({ params: ["x"], body: "x".repeat(1001) }))).toBeNull();
    expect(parseCalculatorSession(withFunction(null))).toBeNull();
  });

  it("refuses an ans that is neither null nor a stored value", () => {
    expect(parseCalculatorSession({ ...SESSION, ans: 5 })).toBeNull();
    expect(parseCalculatorSession({ ...SESSION, ans: "" })).toBeNull();
    expect(parseCalculatorSession({ ...SESSION, ans: "5".repeat(40_000) })).toBeNull();
  });

  it("keeps at most a stated number of variables and functions", () => {
    const variables = Object.fromEntries(
      Array.from({ length: MAX_CALCULATOR_SESSION_VARIABLES }, (_, index) => [`v${index}`, "1"]),
    );
    expect(parseCalculatorSession({ ...SESSION, variables })).not.toBeNull();
    expect(
      parseCalculatorSession({ ...SESSION, variables: { ...variables, oneTooMany: "1" } }),
    ).toBeNull();

    const functions = Object.fromEntries(
      Array.from({ length: MAX_CALCULATOR_SESSION_FUNCTIONS }, (_, index) => [
        `f${index}`,
        { params: ["x"], body: "x" },
      ]),
    );
    expect(parseCalculatorSession({ ...SESSION, variables: {}, functions })).not.toBeNull();
    expect(
      parseCalculatorSession({ ...SESSION, variables: {}, functions: { ...functions, oneTooMany: { params: ["x"], body: "x" } } }),
    ).toBeNull();
  });

  it("accepts four parameters, which is one more than any function the engine ships", () => {
    const fn = { params: ["a", "b", "c", "d"], body: "a + b + c + d" };
    expect(MAX_CALCULATOR_FUNCTION_PARAMS).toBe(4);
    expect(parseCalculatorSession({ ...SESSION, functions: { f: fn } })).toEqual({
      ...SESSION,
      functions: { f: fn },
    });
  });

  it("ignores a field it does not know rather than refusing the whole session", () => {
    // A field a later version writes is not this version's business, and
    // refusing the session over it would lose everything the user did have.
    expect(parseCalculatorSession({ ...SESSION, angleMode: "grad" })).toEqual(SESSION);
  });
});
