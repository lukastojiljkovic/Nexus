import { describe, expect, it } from "vitest";

import { ALLOWED, scanRepo, scanSource } from "./check-elec.mjs";

/**
 * `check:elec` makes DEV-006's scope structural instead of remembered.
 *
 * The deviation says the workbench palette „reaches the canvas surface and the
 * component legend, and nothing else" — a rule over a reachability set, which is
 * the shape DC-61 was written about. This suite's job is to show the gate goes
 * RED on the thing the sentence forbids, because a scope rule that cannot fail
 * is the sentence again with extra steps.
 */

const BENCH = "apps/desktop/src/renderer/src/styles/electronics.css";
const ELSEWHERE = "packages/ui/src/styles.css";

describe("scanSource", () => {
  it("refuses a workbench colour read from outside the workbench", () => {
    const findings = scanSource(ELSEWHERE, ".x { color: var(--nx-elec-wire-blue); }");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.token).toBe("--nx-elec-wire-blue");
    expect(findings[0]?.line).toBe(1);
  });

  it("refuses a REDEFINITION as well as a read", () => {
    // The escape that a read-only rule would miss: a page that declares the
    // token for itself gets the colour without ever naming `var()`.
    expect(scanSource(ELSEWHERE, ":root { --nx-elec-wire-blue: #123456; }")).toHaveLength(1);
  });

  it("allows the workbench its own palette", () => {
    expect(scanSource(BENCH, ".elec-wire--blue { stroke: var(--nx-elec-wire-blue); }")).toEqual([]);
  });

  /**
   * The negative control that matters, and the one that made the gate's first
   * version wrong. Six files explain in prose that a wire's colour is painted
   * through a `--nx-elec-wire-*` token. Every comment syntax has to be inert —
   * including SQL's `--`, which the lexer cannot strip, because blanking every
   * `--` to end of line would blank every custom-property declaration there is.
   */
  it("is not set off by prose about the tokens", () => {
    const cases = [
      "// painted through a --nx-elec-wire-* token",
      "/* the --nx-elec-wire-red group, see DEV-006 */",
      "  -- --nx-elec-wire-* token instead of painting a stored value.",
      " * palette would be teaching the wrong thing. They live behind --nx-elec-wire-*",
    ];
    for (const source of cases) {
      expect(scanSource(ELSEWHERE, source)).toEqual([]);
    }
  });

  it("reports the line the reader has to open", () => {
    const source = ["a", "b", ".x { border-color: var(--nx-elec-part-edge); }"].join("\n");
    expect(scanSource(ELSEWHERE, source)[0]?.line).toBe(3);
  });
});

describe("the live tree", () => {
  it("has no workbench colour outside the workbench", () => {
    expect(scanRepo()).toEqual([]);
  });

  /**
   * One entry, on purpose. A directory pattern would re-state the rule over a
   * set and admit the next matching file by accident rather than by decision —
   * which is the failure the gate exists to prevent, one level up.
   */
  it("admits exactly one file, and it is the workbench stylesheet", () => {
    expect([...ALLOWED]).toEqual([BENCH]);
  });
});
