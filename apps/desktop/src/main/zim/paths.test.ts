import { describe, expect, it } from "vitest";

import {
  isZimPath,
  joinZimPath,
  splitZimPath,
  zimPathFromUrlPath,
  zimPathProblem,
  zimUrlPath,
} from "./paths.js";

/**
 * The one string that is between a page and a file: what a ZIM path may be, and
 * how it crosses a URL unchanged.
 */
describe("ZIM paths", () => {
  it("accepts the namespaces the format defines, and paths with slashes of their own", () => {
    expect(zimPathProblem("C/article.html")).toBeNull();
    expect(zimPathProblem("A/Першая_старонка.html")).toBeNull();
    expect(zimPathProblem("I/m/115a35549794e50dcd03e60ef1a1ae24.png")).toBeNull();
    expect(zimPathProblem("M/Title")).toBeNull();
    expect(zimPathProblem("X/listing/titleOrdered/v1")).toBeNull();
    expect(zimPathProblem("-/s/style.css")).toBeNull();
  });

  it("refuses a path that is not `<namespace>/<path>`", () => {
    expect(zimPathProblem("")).toBe("empty");
    expect(zimPathProblem("C")).toBe("no-namespace");
    expect(zimPathProblem("/C/article.html")).toBe("no-namespace");
    expect(zimPathProblem("CC/article.html")).toBe("no-namespace");
    expect(zimPathProblem("Z/article.html")).toBe("bad-namespace");
    expect(zimPathProblem("C/")).toBe("empty-path");
    expect(zimPathProblem(7)).toBe("not-a-string");
  });

  it("refuses the shapes that would confuse the layer that joins it onto a URL", () => {
    expect(zimPathProblem("C/../M/Title")).toBe("dot-segment");
    expect(zimPathProblem("C/a/./b")).toBe("dot-segment");
    expect(zimPathProblem("C/a\\b")).toBe("backslash");
    expect(zimPathProblem("C/a\u0000b")).toBe("control");
    expect(zimPathProblem(`C/${"a".repeat(600)}`)).toBe("too-long");
    expect(isZimPath("C/ok.html")).toBe(true);
  });

  it("splits at the FIRST slash and rejoins to the same string", () => {
    expect(splitZimPath("I/m/pix.png")).toEqual({ namespace: "I", path: "m/pix.png" });
    for (const path of ["C/a.html", "M/Title", "X/listing/titleOrdered/v1"]) {
      const { namespace, path: rest } = splitZimPath(path);
      expect(joinZimPath(namespace, rest)).toBe(path);
    }
  });

  it("percent-encodes each segment, keeping the separators", () => {
    expect(zimUrlPath("A/Першая_старонка.html")).toBe(
      "/A/%D0%9F%D0%B5%D1%80%D1%88%D0%B0%D1%8F_%D1%81%D1%82%D0%B0%D1%80%D0%BE%D0%BD%D0%BA%D0%B0.html",
    );
    expect(zimUrlPath("I/m/pix.png")).toBe("/I/m/pix.png");
    expect(zimUrlPath("C/a b.html")).toBe("/C/a%20b.html");
  });

  it("round-trips a path through a URL", () => {
    for (const path of [
      "C/article.html",
      "A/Першая_старонка.html",
      "I/m/115a35549794e50dcd03e60ef1a1ae24.png",
      "C/Članak o čaju.html",
    ]) {
      expect(zimPathFromUrlPath(zimUrlPath(path))).toBe(path);
    }
  });

  it("decodes once, before the rules are applied", () => {
    // `%2e%2e` is the shape that defeats a rule applied to the ENCODED string
    // with the decode happening afterwards: decoded first, it is a dot segment
    // and it is refused.
    expect(zimPathFromUrlPath("/C/%2e%2e/C/other.html")).toBeNull();
    // An encoded separator decodes to a separator, which a ZIM path may contain
    // (`I/m/pix.png` is one image in one subdirectory), so this is a path and not
    // an escape: nothing is joined onto a filesystem here.
    expect(zimPathFromUrlPath("/C%2Farticle.html")).toBe("C/article.html");
    // A malformed escape is not a path.
    expect(zimPathFromUrlPath("/C/%ZZ.html")).toBeNull();
  });
});
