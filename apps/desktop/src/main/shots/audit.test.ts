import { describe, expect, it } from "vitest";

import { AUDIT_SCRIPT } from "./audit.js";

/**
 * The audit script is a STRING, and a string is the one thing in this repository
 * that no gate reads.
 *
 * It is written as a template literal because it runs inside the renderer via
 * `executeJavaScript`, which means `tsc` sees an opaque sequence of characters,
 * ESLint sees the same, and the editor offers no syntax colouring to notice with
 * the eye either. The first time that mattered, an edit left two `const painted`
 * declarations in one block. That is a plain `SyntaxError` — a compiler would
 * have refused it instantly — but the only thing that could observe it was a
 * six-minute build-and-sweep, and what it printed was `SHOTS FAIL: Script failed
 * to execute, this normally means an error was thrown. Check the renderer
 * console`, with no line, no message, and no console to check because the run
 * had already exited.
 *
 * `new Function` compiles the source and does not run it, so this costs
 * microseconds and turns that six-minute opaque failure into a named
 * `SyntaxError` at the usual moment. It cannot prove the audit is CORRECT — the
 * frames and the report are what do that — only that it is a program.
 *
 * The usual objection to `new Function` does not apply: its argument here is a
 * module constant compiled from this repository's own source, nothing is
 * interpolated into it, and the constructed function is never called.
 */
describe("AUDIT_SCRIPT", () => {
  it("parses as JavaScript", () => {
    expect(() => new Function(AUDIT_SCRIPT)).not.toThrow();
  });

  it("would refuse the redeclaration that motivated it", () => {
    // The negative control. A green check on a mechanism that cannot go red is
    // the thing this whole audit exists to stop shipping, so the mechanism is
    // shown failing on the exact shape that got through — two `const`s of one
    // name in one block, which is what the edit to the offscreen check left.
    expect(() => new Function("{ const painted = 1; const painted = 2; }")).toThrow(SyntaxError);
  });

  it("is an expression that yields the findings, not a statement", () => {
    // `executeJavaScript` resolves to the COMPLETION VALUE of the source, so the
    // script has to be an IIFE whose value is the finding list. A stray `;` or a
    // leading `const` would still parse and would still run, and the sweep would
    // then record `undefined` findings on every frame while reporting success.
    expect(AUDIT_SCRIPT.trimStart().startsWith("(")).toBe(true);
  });
});
