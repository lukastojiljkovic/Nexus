import { describe, expect, it } from "vitest";

import { resolvePackPath } from "./paths.js";

/**
 * The relative-target rule (ADR-100).
 *
 * Both the page and the printed document resolve a link through this function, so
 * the case that matters most is the one where it refuses: a target that would
 * leave the pack is answered with nothing rather than with a clamped path.
 */
describe("resolvePackPath", () => {
  it("resolves a relative target against the article's own folder", () => {
    expect(resolvePackPath("prva-pomoc/opekotine.md", "slike/ozleda.png")).toBe(
      "prva-pomoc/slike/ozleda.png",
    );
    expect(resolvePackPath("opekotine.md", "slike/ozleda.png")).toBe("slike/ozleda.png");
    expect(resolvePackPath("a/b/c.md", "../d/e.png")).toBe("a/d/e.png");
    expect(resolvePackPath("a/b/c.md", "./d.png")).toBe("a/b/d.png");
  });

  it("refuses a target that leaves the pack, and one that names no file", () => {
    expect(resolvePackPath("opekotine.md", "../../../etc/passwd")).toBeNull();
    expect(resolvePackPath("a/b/c.md", "../../../../x.png")).toBeNull();
    expect(resolvePackPath("a.md", "#odeljak")).toBeNull();
    expect(resolvePackPath("a.md", "/apsolutno.png")).toBeNull();
    expect(resolvePackPath("a.md", "")).toBeNull();
  });

  it("drops a query string, which names the same file", () => {
    expect(resolvePackPath("a.md", "b.png?v=2")).toBe("b.png");
  });
});
