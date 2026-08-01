import { describe, expect, it } from "vitest";
import {
  CANVAS_REF_KINDS,
  CANVAS_REF_SCHEME,
  MAX_CANVAS_REF_LENGTH,
  canvasRefText,
  isCanvasRefText,
  parseCanvasRef,
} from "./canvasRef.js";

/** A uuidv7 exactly as `@nexus/db`'s `uuidv7()` mints one: version nibble 7, variant nibble 8/9/a/b. */
const NOTE_ID = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const TASK_ID = "0198a1b2-c3d4-7e5f-9a9b-0c1d2e3f4a5c";
const EVENT_ID = "0198a1b2-c3d4-7e5f-ba9b-0c1d2e3f4a5d";

describe("the reference grammar's constants", () => {
  it("closes the list of what may ride on a board", () => {
    expect(CANVAS_REF_KINDS).toEqual(["note", "task", "event"]);
  });

  it("names a scheme that is ours and is NOT one the app registers", () => {
    // `nx-blob` and `priv-blob` are the two schemes `registerSchemesAsPrivileged`
    // grants; this one is deliberately not among them, so nothing can ever be
    // fetched through it (see the module header).
    expect(CANVAS_REF_SCHEME).toBe("nexus");
  });

  it("caps a reference at exactly the longest one the grammar can produce", () => {
    expect(MAX_CANVAS_REF_LENGTH).toBe(canvasRefText({ kind: "event", id: EVENT_ID }).length);
  });
});

describe("canvasRefText", () => {
  it("writes the one spelling a reference has", () => {
    expect(canvasRefText({ kind: "note", id: NOTE_ID })).toBe(`nexus://note/${NOTE_ID}`);
    expect(canvasRefText({ kind: "task", id: TASK_ID })).toBe(`nexus://task/${TASK_ID}`);
    expect(canvasRefText({ kind: "event", id: EVENT_ID })).toBe(`nexus://event/${EVENT_ID}`);
  });

  it("round-trips through the parser for every kind, inside the bound the wire caps at", () => {
    for (const kind of CANVAS_REF_KINDS) {
      const ref = { kind, id: NOTE_ID } as const;
      const text = canvasRefText(ref);
      expect(text.length).toBeLessThanOrEqual(MAX_CANVAS_REF_LENGTH);
      expect(parseCanvasRef(text)).toEqual(ref);
    }
  });
});

describe("parseCanvasRef", () => {
  it("reads a well-formed reference of each kind", () => {
    expect(parseCanvasRef(`nexus://note/${NOTE_ID}`)).toEqual({ kind: "note", id: NOTE_ID });
    expect(parseCanvasRef(`nexus://task/${TASK_ID}`)).toEqual({ kind: "task", id: TASK_ID });
    expect(parseCanvasRef(`nexus://event/${EVENT_ID}`)).toEqual({ kind: "event", id: EVENT_ID });
  });

  it("accepts every variant nibble `uuidv7()` can mint, and no other", () => {
    for (const variant of ["8", "9", "a", "b"]) {
      expect(parseCanvasRef(`nexus://note/0198a1b2-c3d4-7e5f-${variant}a9b-0c1d2e3f4a5b`)).toEqual({
        kind: "note",
        id: `0198a1b2-c3d4-7e5f-${variant}a9b-0c1d2e3f4a5b`,
      });
    }
    for (const variant of ["0", "7", "c", "f"]) {
      expect(
        parseCanvasRef(`nexus://note/0198a1b2-c3d4-7e5f-${variant}a9b-0c1d2e3f4a5b`),
      ).toBeNull();
    }
  });

  /**
   * The refusal table. Every row is something a compromised renderer, a pasted
   * string or a hand-edited scene could put in an element's `link`, and every
   * row must answer `null` — because a nullish answer from the host predicate
   * built on this is exactly what makes Excalidraw draw a real iframe instead
   * (see the module header).
   *
   * The rows are kept INSIDE `MAX_CANVAS_REF_LENGTH` wherever the point is a
   * grammar rule, so it is the grammar refusing them and not the length guard
   * in front of it; the two rows that are deliberately over-long say so.
   */
  const REFUSED: readonly (readonly [string, string])[] = [
    ["a foreign scheme", `https://note/${NOTE_ID}`],
    ["a javascript: URL wearing our shape", `javascript:nexus://note/${NOTE_ID}`],
    ["a bare javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,<x>"],
    ["a nested URL as the id", "nexus://note/https://example.invalid/x"],
    ["a trailing path separator", `nexus://note/${NOTE_ID}/`],
    ["a trailing query string", `nexus://note/${NOTE_ID}?`],
    ["a trailing fragment", `nexus://note/${NOTE_ID}#`],
    ["a trailing newline", `nexus://note/${NOTE_ID}\n`],
    ["a whole path appended (over-long, refused by the guard)", `nexus://note/${NOTE_ID}/steal`],
    ["an id carrying a stray percent", "nexus://note/0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5%"],
    ["an empty kind", `nexus:///${NOTE_ID}`],
    ["a kind that is a PREFIX of a real one", `nexus://not/${NOTE_ID}`],
    ["a kind a real one is a PREFIX of", `nexus://notes/${NOTE_ID}`],
    ["a kind this resolver does not answer", `nexus://board/${NOTE_ID}`],
    ["an empty id", "nexus://note/"],
    ["a missing id", "nexus://note"],
    ["an authority in front of the kind", `nexus://@note/${NOTE_ID}`],
    ["a single-slash form", `nexus:/note/${NOTE_ID}`],
    ["an opaque form", `nexus:note/${NOTE_ID}`],
    ["backslashes where the slashes belong", `nexus:\\\\note\\${NOTE_ID}`],
    ["an uppercase scheme", `NEXUS://note/${NOTE_ID}`],
    ["an uppercase kind", `nexus://NOTE/${NOTE_ID}`],
    ["an uppercase id", `nexus://note/${NOTE_ID.toUpperCase()}`],
    ["a UUIDv4 id", "nexus://note/0198a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b"],
    ["an unhyphenated id", `nexus://note/${NOTE_ID.replace(/-/g, "")}`],
    ["a token id this codebase never mints", "nexus://note/note-1"],
    ["leading whitespace", ` nexus://note/${NOTE_ID}`],
    ["trailing whitespace", `nexus://note/${NOTE_ID} `],
    ["an over-long string (refused by the guard)", `nexus://note/${"a".repeat(2000)}`],
    ["an empty string", ""],
  ];

  it.each(REFUSED)("refuses %s", (_label, text) => {
    expect(parseCanvasRef(text)).toBeNull();
  });
});

describe("isCanvasRefText", () => {
  it("answers exactly what the parser answers — it is the same decision, asked as a question", () => {
    const cases = [
      `nexus://note/${NOTE_ID}`,
      `nexus://task/${TASK_ID}`,
      `nexus://event/${EVENT_ID}`,
      `https://note/${NOTE_ID}`,
      "javascript:alert(1)",
      "nexus://note/",
      "",
    ];
    for (const text of cases) {
      expect(isCanvasRefText(text)).toBe(parseCanvasRef(text) !== null);
    }
    expect(isCanvasRefText(`nexus://note/${NOTE_ID}`)).toBe(true);
    expect(isCanvasRefText("javascript:alert(1)")).toBe(false);
  });
});
