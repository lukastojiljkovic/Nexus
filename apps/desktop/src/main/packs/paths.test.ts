import { describe, expect, it } from "vitest";

import { isSafePackPath, packPathProblem, packPathSegments } from "./paths.js";

/**
 * One test per rule, because "a path is refused" is a claim about a dozen
 * different things and a single test that asserts one refusal cannot tell which
 * of them stopped working.
 */
describe("pack paths", () => {
  it("accepts an ordinary nested path", () => {
    expect(packPathProblem("data/2026/articles.zim")).toBeNull();
    expect(isSafePackPath("wikipedia.zim")).toBe(true);
  });

  it("refuses a value that is not a string", () => {
    expect(packPathProblem(7)).toBe("not-a-string");
    expect(packPathProblem(null)).toBe("not-a-string");
  });

  it("refuses an empty path", () => {
    expect(packPathProblem("")).toBe("empty");
  });

  it("refuses a path over the length cap", () => {
    expect(packPathProblem(`${"a".repeat(239)}.zim`)).toBe("too-long");
  });

  it("refuses a NUL", () => {
    expect(packPathProblem("a\u0000b")).toBe("nul");
  });

  it("refuses any other control character", () => {
    expect(packPathProblem("a\u0007b")).toBe("control");
    expect(packPathProblem("a\u007fb")).toBe("control");
  });

  it("refuses an absolute path", () => {
    expect(packPathProblem("/etc/passwd")).toBe("absolute");
  });

  it("refuses a drive letter", () => {
    expect(packPathProblem("C:/windows/system32")).toBe("drive");
    expect(packPathProblem("c:file")).toBe("drive");
  });

  it("refuses a UNC path", () => {
    expect(packPathProblem("\\\\server\\share")).toBe("unc");
  });

  it("refuses a backslash anywhere, even on its own", () => {
    expect(packPathProblem("data\\file.zim")).toBe("backslash");
  });

  it("refuses an empty segment, which covers a double slash and a trailing slash", () => {
    expect(packPathProblem("data//file.zim")).toBe("empty-segment");
    expect(packPathProblem("data/file.zim/")).toBe("empty-segment");
  });

  it("refuses a dot segment", () => {
    expect(packPathProblem("data/./file.zim")).toBe("dot-segment");
    expect(packPathProblem("..")).toBe("dot-segment");
    expect(packPathProblem("data/../../secrets")).toBe("dot-segment");
  });

  it("refuses the characters Windows forbids in a name", () => {
    for (const bad of ["a<.zim", "a>.zim", 'a".zim', "a|b.zim", "a?b.zim", "a*b.zim"]) {
      expect(packPathProblem(bad), bad).toBe("forbidden-char");
    }
  });

  it("refuses a segment Windows would silently shorten", () => {
    expect(packPathProblem("data/file.")).toBe("trailing-dot-or-space");
    expect(packPathProblem("data/file.zim ")).toBe("trailing-dot-or-space");
    expect(packPathProblem("data ")).toBe("trailing-dot-or-space");
    // A space in the middle is a legal Windows name and stays legal here.
    expect(packPathProblem("data/the file.zim")).toBeNull();
  });

  it("refuses a reserved Windows device name, with or without an extension", () => {
    expect(packPathProblem("CON")).toBe("reserved-name");
    expect(packPathProblem("nul")).toBe("reserved-name");
    expect(packPathProblem("data/com1.txt")).toBe("reserved-name");
    expect(packPathProblem("data/LPT9.zim")).toBe("reserved-name");
  });

  it("accepts a name that merely starts like a reserved one", () => {
    expect(packPathProblem("data/constitution.txt")).toBeNull();
    expect(packPathProblem("data/com10.txt")).toBeNull();
  });

  it("refuses a path that nests more deeply than the cap", () => {
    expect(packPathProblem("a/b/c/d/e/f/g/h/i")).toBe("too-deep");
  });

  it("splits a safe path into the segments it joins with", () => {
    expect(packPathSegments("data/articles.zim")).toEqual(["data", "articles.zim"]);
  });
});
