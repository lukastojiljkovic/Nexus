// Unit tests for `check-invisibles.mjs` — the gate that keeps a character which
// renders as nothing, or as a character it is not, out of source.
//
// A gate whose job is to be quiet is indistinguishable from a gate that has
// stopped working (DC-01), and this one is more exposed to that than most: the
// thing it looks for is by definition something nobody can see in the test file
// either. So every fixture below BUILDS its offending character from a code
// point rather than containing one — `String.fromCharCode(0x00a0)` is legible,
// a literal NBSP in a test asserting NBSPs are banned is a joke that stops being
// funny the first time somebody „tidies" it.

import { describe, expect, it } from "vitest";

import { INVISIBLES, auditAll, scanText } from "./check-invisibles.mjs";

const ch = (code) => String.fromCodePoint(code);

/** Just the ids, which is what a reader of the failure output actually scans. */
const ids = (text) => scanText(text).map((hit) => hit.id);

describe("scanText — what must trip the gate", () => {
  it("catches the defect this gate was written for: a NBSP inside a template literal", () => {
    // Verbatim the shape from `pro/format.ts`, which compiled, linted,
    // typechecked and reviewed clean.
    const source = "return `${value}" + ch(0x00a0) + "${unit}`;";
    expect(ids(source)).toEqual(["NBSP"]);
  });

  it("catches every character in the table, one fixture each", () => {
    for (const entry of INVISIBLES) {
      expect(ids(`const x = "a${ch(entry.code)}b";`), entry.id).toEqual([entry.id]);
    }
  });

  it("reports the position, so the failure output points at a character nobody can see", () => {
    const hits = scanText(`line one\nconst x = "${ch(0x200b)}";`);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.line).toBe(2);
    // `const x = "` is 11 characters, so the ZWSP is the 12th on its line.
    expect(hits[0]?.column).toBe(12);
    expect(hits[0]?.escape).toBe("\\u200b");
  });

  it("catches several in one file rather than stopping at the first", () => {
    expect(ids(`"${ch(0x00a0)}" + "${ch(0xfeff)}"`)).toEqual(["NBSP", "BOM / ZWNBSP"]);
  });

  it("catches a file read as latin1 and written back — the 2026-08-14 corruption", () => {
    // `packages/core/src/pro/biznis.test.ts` was read with the wrong encoding
    // and rewritten: 58 lines of comments had every „—" turned into three
    // characters and every „…" into three more. Nothing failed. Typecheck,
    // 5 753 tests, the ten gates and the build were all green with the file in
    // that state, and it was found by reading a diff stat that said 152 lines
    // had changed in a file where 38 had been added.
    //
    // Built from BYTES here rather than pasted, because a fixture of mojibake
    // pasted into a source file is a source file with mojibake in it.
    const emDash = Buffer.from("—", "utf8").toString("latin1"); // U+00E2 U+0080 U+0094
    const ellipsis = Buffer.from("…", "utf8").toString("latin1");
    const serbianC = Buffer.from("č", "utf8").toString("latin1"); // U+00C4 U+008D
    expect(ids(`// a comment ${emDash} and more`)).toEqual(["MOJIBAKE"]);
    expect(ids(`// 0,4166${ellipsis}`)).toEqual(["MOJIBAKE"]);
    expect(ids(`// ra${serbianC}un`)).toEqual(["MOJIBAKE"]);
  });
});

describe("scanText — what must NOT trip it", () => {
  it("leaves the escape alone, which is the whole point of the rule", () => {
    // The fix the gate asks for must itself be clean, or the rule is unusable.
    expect(ids(String.raw`return \u00a0 + "x";`)).toEqual([]);
  });

  it("leaves Serbian letters and the app's curly quotes alone — this bans invisibility, not Unicode", () => {
    expect(ids(`const s = "Rešenje za Đorđa, „Alatke“ — 5 °C, ½, ×, →, ≤";`)).toEqual([]);
  });

  it("leaves ordinary whitespace alone, including the tab and the CRLF a Windows checkout carries", () => {
    expect(ids("const\tx = 1;\r\n  const y = 2;\r\n")).toEqual([]);
  });

  it("leaves an emoji and an astral code point alone — surrogate pairs are one character to the walk", () => {
    expect(ids(`const s = "✦ 𝔘 🙂";`)).toEqual([]);
  });

  it("leaves the three real texts that UTF-8's own continuation range would have failed", () => {
    // The mojibake rule was first written with UTF-8's actual continuation
    // range, 0x80–0xBF, and reported all three of these — every one correct.
    // An accented Latin-1 letter is in the LEAD range, and a middle dot or an
    // inverted exclamation is in the continuation range, so ordinary text puts
    // the pair side by side. The narrowing to the C1 controls is what this
    // pins; widening it back turns the gate against shipped copy.
    expect(ids("// n = 128 + 745/6 = 252 = U+00FC, inserted -> b·ü·cher")).toEqual([]);
    expect(ids("// n = 128 + 680/6 = 241 = U+00F1, at 2 -> ma·ñ·ana")).toEqual([]);
    // And the drawer's own `mojibake-repair` tool, whose Serbian copy and test
    // fixtures are mojibake ON PURPOSE — „Å¡" is how the user recognises the
    // problem the tool solves, so it can never be „fixed" out of the strings.
    expect(ids(`textHint: "Nalepi pokvaren tekst, na primer „Å¡\\" ili „Ä‡\\"."`)).toEqual([]);
  });
});

describe("the repository itself", () => {
  it("is clean — every invisible character in source is written as an escape", () => {
    expect(auditAll()).toEqual([]);
  });
});
