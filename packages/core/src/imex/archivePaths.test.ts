import { describe, expect, it } from "vitest";
import { claimUniqueName, sanitizePathSegment, UNTITLED_NOTE_NAME } from "./archivePaths.js";

describe("sanitizePathSegment", () => {
  it("replaces path separators and other forbidden characters with -", () => {
    expect(sanitizePathSegment('a/b\\c:d*e?f"g<h>i|j', "fallback")).toBe("a-b-c-d-e-f-g-h-i-j");
  });

  it("replaces C0/C1 control characters with -", () => {
    // Built from character codes rather than typed literally — a real NUL/DEL
    // byte cannot reliably survive being authored as ordinary source text.
    const nul = String.fromCharCode(0x00);
    const unitSeparator = String.fromCharCode(0x1f);
    const del = String.fromCharCode(0x7f);
    const raw = `x${nul}y${unitSeparator}z${del}w`;
    expect(sanitizePathSegment(raw, "fallback")).toBe("x-y-z-w");
  });

  it("collapses runs of whitespace into a single space and trims", () => {
    expect(sanitizePathSegment("  Moj    plan   za   dan  ", "fallback")).toBe("Moj plan za dan");
  });

  it("strips trailing dots and spaces (Windows drops them silently)", () => {
    expect(sanitizePathSegment("Plan...", "fallback")).toBe("Plan");
    expect(sanitizePathSegment("Plan . . ", "fallback")).toBe("Plan");
  });

  it("caps to 80 characters and trims again", () => {
    const raw = `${"x".repeat(85)}${" ".repeat(1)}`;
    const result = sanitizePathSegment(raw, "fallback");
    expect(result).toBe("x".repeat(80));
    expect(result.length).toBe(80);
  });

  it.each(["", ".", ".."])("falls back for %j", (raw) => {
    expect(sanitizePathSegment(raw, "fallback")).toBe("fallback");
  });

  it("keeps a result made only of replaced forbidden characters (it is not empty)", () => {
    expect(sanitizePathSegment("///", "fallback")).toBe("---");
  });

  it("falls back when the input is whitespace-only", () => {
    const whitespaceOnly = " ".repeat(3);
    expect(sanitizePathSegment(whitespaceOnly, "fallback")).toBe("fallback");
  });

  it.each(["CON", "com1", "Com1", "LPT9", "nul", "AUX", "PRN"])(
    "suffixes the reserved Windows device name %j",
    (name) => {
      expect(sanitizePathSegment(name, "fallback")).toBe(`${name}_`);
    },
  );

  it("does not suffix a name that merely starts with a reserved device name", () => {
    expect(sanitizePathSegment("CONcert", "fallback")).toBe("CONcert");
    expect(sanitizePathSegment("COM10", "fallback")).toBe("COM10");
  });

  it("suffixes the STEM of a reserved device name that carries an extension", () => {
    // `CON.txt` is still the console device on Windows, and `CON.txt_` would
    // be too — the `_` has to land before the dot.
    expect(sanitizePathSegment("CON.txt", "fallback")).toBe("CON_.txt");
    expect(sanitizePathSegment("nul.md", "fallback")).toBe("nul_.md");
  });

  it("re-strips a trailing dot that the 80-character cap re-exposed", () => {
    const raw = `${"x".repeat(79)}.${"y".repeat(10)}`;
    expect(sanitizePathSegment(raw, "fallback")).toBe("x".repeat(79));
  });

  it("uses UNTITLED_NOTE_NAME as the caller's fallback for an empty note title", () => {
    expect(sanitizePathSegment("", UNTITLED_NOTE_NAME)).toBe("Bez naslova");
  });
});

describe("claimUniqueName", () => {
  it("returns base + extension when free", () => {
    const taken = new Set<string>();
    expect(claimUniqueName(taken, "Plan", ".md")).toBe("Plan.md");
  });

  it("numbers collisions from (2)", () => {
    const taken = new Set<string>();
    expect(claimUniqueName(taken, "Plan", ".md")).toBe("Plan.md");
    expect(claimUniqueName(taken, "Plan", ".md")).toBe("Plan (2).md");
    expect(claimUniqueName(taken, "Plan", ".md")).toBe("Plan (3).md");
  });

  it("treats collisions case-insensitively", () => {
    const taken = new Set<string>();
    expect(claimUniqueName(taken, "Plan", ".md")).toBe("Plan.md");
    expect(claimUniqueName(taken, "plan", ".md")).toBe("plan (2).md");
  });

  it("uses an empty extension for directory segments", () => {
    const taken = new Set<string>();
    expect(claimUniqueName(taken, "Fascikla", "")).toBe("Fascikla");
    expect(claimUniqueName(taken, "Fascikla", "")).toBe("Fascikla (2)");
  });

  it("registers the chosen (numbered) name, not the original base", () => {
    const taken = new Set<string>();
    claimUniqueName(taken, "Plan", ".md");
    claimUniqueName(taken, "Plan", ".md"); // claims "Plan (2).md"
    expect(taken.has("plan (2).md")).toBe(true);
  });

  it("does not collide with a name reused in a different registry", () => {
    const registryA = new Set<string>();
    const registryB = new Set<string>();
    expect(claimUniqueName(registryA, "Plan", ".md")).toBe("Plan.md");
    expect(claimUniqueName(registryB, "Plan", ".md")).toBe("Plan.md");
  });
});

/**
 * The trailing dots and spaces used to come off with `/[. ]+$/`, which re-walked
 * the run from every position in it: a title of a hundred thousand dots spent
 * seconds here, and a title comes from an archive. A scan is linear, and what it
 * removes is the same run.
 */
describe("a segment's trailing dots and spaces come off in one pass", () => {
  it("removes the run, and leaves every other name alone", () => {
    expect(sanitizePathSegment("Plan. . . ", "Fascikla")).toBe("Plan");
    expect(sanitizePathSegment("...", "Fascikla")).toBe("Fascikla");
    expect(sanitizePathSegment("Plan.", "Fascikla")).toBe("Plan");
    expect(sanitizePathSegment("Plan. 2026", "Fascikla")).toBe("Plan. 2026");
  });

  it("answers a 128k-dot title in linear time", () => {
    const started = performance.now();
    const name = sanitizePathSegment(".".repeat(128 * 1024), "Fascikla");
    expect(performance.now() - started).toBeLessThan(200);
    expect(name).toBe("Fascikla");
  });
});
