import { describe, expect, it } from "vitest";

import { overwriteLeaves } from "../src/strings.js";

/**
 * `overwriteLeaves` folds the English table onto the Serbian one at import, and
 * it recurses through whatever `target[key]` already holds. `JSON.parse` makes
 * a `__proto__` member an OWN property of the source, so the recursion from
 * that key lands on `Object.prototype` -- a polluted global rather than a bad
 * string. The web shell's two tables are literals, so nothing in a normal run
 * exercises the guard; these cases are the only place it can be seen.
 */
describe("overwriteLeaves refuses the prototype names", () => {
  it("does not follow __proto__ into Object.prototype", () => {
    const target: Record<string, unknown> = {};
    const polluted = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    overwriteLeaves(target, polluted);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
  });

  it("does not follow a constructor.prototype chain either", () => {
    const target: Record<string, unknown> = {};
    const polluted = JSON.parse('{"constructor":{"prototype":{"polluted":true}}}') as Record<
      string,
      unknown
    >;
    overwriteLeaves(target, polluted);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("still merges an ordinary subtree in place", () => {
    const subtree = { b: "b" };
    const target: Record<string, unknown> = { a: subtree };
    overwriteLeaves(target, { a: { b: "z" }, c: "c" });
    expect(target).toEqual({ a: { b: "z" }, c: "c" });
    // The identity of the subtree survives, which is the whole point of the
    // leaf-by-leaf copy on both shells.
    expect(target.a).toBe(subtree);
  });
});
