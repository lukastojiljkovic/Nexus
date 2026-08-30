// Unit tests for `check-zeroize.mjs` — the gate that keeps a key from being
// erased in the middle of the call that is using it.
//
// Every fixture is a whole `try/finally`, because the rule is about the
// relationship between three things (what the finally releases, what the return
// is, and whether it is awaited) and a fixture that omitted any of them would be
// testing a simpler rule than the one that ships.

import { describe, expect, it } from "vitest";

import { auditZeroize, scanSource } from "./check-zeroize.mjs";

/** Just the statements, which is what a reader of the failure output scans. */
const hits = (source) => scanSource(source).map((problem) => problem.statement);

describe("scanSource — what must trip the gate", () => {
  it("catches the defect this gate was written for", () => {
    // Verbatim the shape from `openContentKey`: the finally is correct, argued
    // in a comment, and running at the wrong moment.
    const source = [
      "async function open(deps, input) {",
      "  const masterKey = await unwrapKey(deps.crypto, input.dataKey, input.wrap, ctx);",
      "  try {",
      "    return openAll(deps, input, masterKey, wraps);",
      "  } finally {",
      "    zeroize(masterKey);",
      "  }",
      "}",
    ].join("\n");
    expect(hits(source)).toEqual(["return openAll("]);
  });

  it("catches a return that shares its line with an `if`", () => {
    // The first version anchored on the start of a line and therefore saw one of
    // the two real sites. `if (wraps.length > 0) return openAll(…)` is the same
    // statement with the guard in front of it.
    const source = [
      "try {",
      "  if (wraps.length > 0) return openAll(deps, wraps);",
      "} finally {",
      "  zeroize(masterKey);",
      "}",
    ].join("\n");
    expect(hits(source)).toEqual(["return openAll("]);
  });

  it("catches a return in the CATCH block, which has the same ordering", () => {
    const source = [
      "try {",
      "  await push(masterKey);",
      "} catch (error) {",
      "  return recover(error);",
      "} finally {",
      "  zeroize(masterKey);",
      "}",
    ].join("\n");
    expect(hits(source)).toEqual(["return recover("]);
  });

  it("catches a call to a function this file declares as async", () => {
    const source = [
      "async function openAll(a) { return a; }",
      "try {",
      "  return openAll(masterKey);",
      "} finally {",
      "  zeroize(masterKey);",
      "}",
    ].join("\n");
    expect(hits(source)).toEqual(["return openAll("]);
  });

  it("reports the real line number, not one counted from the block", () => {
    const source = ["// one", "// two", "try {", "  return openAll(k);", "} finally {", "  zeroize(k);", "}"].join("\n");
    expect(scanSource(source)[0]?.line).toBe(4);
  });
});

describe("scanSource — what must NOT trip it", () => {
  it("accepts `return await`, which is the whole fix", () => {
    const source = [
      "try {",
      "  return await openAll(deps, wraps);",
      "} finally {",
      "  zeroize(masterKey);",
      "}",
    ].join("\n");
    expect(hits(source)).toEqual([]);
  });

  it("accepts a call to a locally declared NON-async function", () => {
    // `adopt.ts` and `reconnect.ts` both do exactly this, correctly. Without the
    // exemption the gate would be teaching people to write `return await` in
    // front of an object-literal factory, which is misleading rather than safe.
    const source = [
      "const refused = (reason, detail = null) => ({ kind: 'refused', reason, detail });",
      "try {",
      "  if (bad) return refused('not_minted');",
      "} finally {",
      "  zeroize(masterKey);",
      "}",
    ].join("\n");
    expect(hits(source)).toEqual([]);
  });

  it("ignores a try whose finally releases something else", () => {
    // The class is wider than this gate. A handle closed early throws on the
    // next call; a key erased early produces plausible ciphertext and blames the
    // server. Only the silent half is worth a rule that can never be wrong.
    const source = [
      "try {",
      "  return readAll(handle);",
      "} finally {",
      "  await handle.close();",
      "}",
    ].join("\n");
    expect(hits(source)).toEqual([]);
  });

  it("ignores a return whose expression merely CONTAINS a call", () => {
    // Three real sites in the repository have this shape, and all three are
    // correct: the value is finished by the time `return` runs. Only a call in
    // the return POSITION can still be pending when the finally fires.
    const source = [
      "try {",
      "  if (a) return { outcome: 'refused', reason: faultOf(error) };",
      "  return new TextDecoder().decode(bytes);",
      "} finally {",
      "  zeroize(masterKey);",
      "}",
    ].join("\n");
    expect(hits(source)).toEqual([]);
  });

  it("ignores the defect QUOTED IN A COMMENT, which is how a file warns about it", () => {
    // The gate's first false failure, and the one that matters most: this defect
    // is invisible in correct-looking code, so a file that meets it is supposed
    // to write the wrong shape down and say why. A gate that punished that would
    // be deleting its own documentation.
    const source = [
      "/**",
      " * Never `try { return syncOnce(x) } finally { keys.zeroize() }`, which",
      " * erases the keys AT THE RETURN STATEMENT.",
      " */",
      "async function round() {",
      "  return await syncOnce(x);",
      "}",
    ].join("\n");
    expect(hits(source)).toEqual([]);
  });

  it("still reports the real thing on the line under the comment that describes it", () => {
    // Blanking must not move anything: the finding's line number is what a
    // reader opens the file at, and a stripper that deleted rather than blanked
    // would point three lines short of the defect.
    const source = [
      "// try { return openAll(mk) } finally { zeroize(mk) } is the trap.",
      "try {",
      "  return openAll(deps, masterKey);",
      "} finally {",
      "  zeroize(masterKey);",
      "}",
    ].join("\n");
    expect(scanSource(source)).toEqual([{ line: 3, statement: "return openAll(" }]);
  });

  it("ignores a bare `return` and a returned identifier", () => {
    const source = [
      "try {",
      "  if (a) return;",
      "  return claimed;",
      "} finally {",
      "  zeroize(masterKey);",
      "}",
    ].join("\n");
    expect(hits(source)).toEqual([]);
  });
});

describe("the repository as it stands", () => {
  it("has no key erased while it is still in use", () => {
    const problems = auditZeroize();
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
