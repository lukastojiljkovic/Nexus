import { describe, expect, it } from "vitest";

import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";
import {
  CALCULATOR_FAILURE_CODES,
  KEYPAD_NAMES,
  KEYPAD_ROWS,
  caretColumn,
  decimalSeparatorOf,
  expandHistoryRefs,
  matchesQuery,
  recallIndex,
  sortNames,
  toEngineExpression,
} from "./expression.js";

/**
 * CALCULATOR's expression arithmetic (ADR-090). What is pinned here is the text a
 * typed line turns into before the engine reads it - the Serbian decimal comma,
 * a `#3` reference, the position a refusal points at - plus the two invariants of
 * the keypad's copy.
 *
 * The locale is an ARGUMENT rather than the active one, which is why these cases
 * need no locale switch: `toEngineExpression`/`decimalSeparatorOf` are called with
 * the locale the page read at render time, so both locales are tested by passing
 * both.
 */

describe("decimalSeparatorOf", () => {
  it("writes the decimal point the way each locale's own number format does", () => {
    expect(decimalSeparatorOf("sr")).toBe(",");
    expect(decimalSeparatorOf("en")).toBe(".");
  });
});

describe("toEngineExpression", () => {
  it("turns a Serbian decimal comma into the point mathjs reads, and nothing else", () => {
    expect(toEngineExpression("0,1 + 0,2", "sr")).toBe("0.1 + 0.2");
    expect(toEngineExpression("1,5 * 3", "sr")).toBe("1.5 * 3");
    expect(toEngineExpression("(1,5 + 2) / 2", "sr")).toBe("(1.5 + 2) / 2");
    // A comma with no digit on both sides is not a decimal comma: `1, 5` is a
    // mistake the engine should report rather than a value to guess at.
    expect(toEngineExpression("1, 5", "sr")).toBe("1, 5");
    expect(toEngineExpression(",5", "sr")).toBe(",5");
    expect(toEngineExpression("5,", "sr")).toBe("5,");
  });

  it("leaves a comma alone where it separates a call's arguments or a matrix's elements", () => {
    expect(toEngineExpression("max(1,2)", "sr")).toBe("max(1,2)");
    expect(toEngineExpression("[1,2]", "sr")).toBe("[1,2]");
    expect(toEngineExpression("ones(2, 3) * [1,2]", "sr")).toBe("ones(2, 3) * [1,2]");
    // What makes a bracket a CALL is the name in front of it, so a bare bracket is
    // a plain group and its comma is a decimal comma again.
    expect(toEngineExpression("(1,5 + 2) / 2", "sr")).toBe("(1.5 + 2) / 2");
    expect(toEngineExpression("((0,5))", "sr")).toBe("((0.5))");
    // ... and the depth comes back down: a comma after the closing bracket is a
    // decimal comma.
    expect(toEngineExpression("max(1,2) + 0,5", "sr")).toBe("max(1,2) + 0.5");
    // A group nested inside a call is still a group, so a decimal comma inside one
    // survives the argument separator around it.
    expect(toEngineExpression("max((1,5), 2)", "sr")).toBe("max((1.5), 2)");
  });

  it("leaves a quoted run alone, where a comma is part of a string a variable holds", () => {
    expect(toEngineExpression('"a,b" + 1,5', "sr")).toBe('"a,b" + 1.5');
  });

  it("does not guess at a group separator, and says so by leaving it", () => {
    // `1.234,5` pasted back from the display: the point is not touched, the comma
    // becomes a point, and the engine refuses `1.234.5` at a position the page
    // points at. Reading `1.234` as either 1.234 or 1234 is a guess the text
    // cannot settle, and this module does not make it.
    expect(toEngineExpression("1.234,5", "sr")).toBe("1.234.5");
  });

  it("does nothing at all in English, where the comma is not the separator", () => {
    expect(toEngineExpression("0.1 + 0.2", "en")).toBe("0.1 + 0.2");
    // `1,5` is a mistake in English rather than a value; the engine reports where.
    expect(toEngineExpression("1,5", "en")).toBe("1,5");
    expect(toEngineExpression("max(1,2)", "en")).toBe("max(1,2)");
  });
});

describe("expandHistoryRefs", () => {
  const values = ["5", "3.1 mi", "[[1, 2]]"];

  it("answers the line unchanged when it names no entry", () => {
    expect(expandHistoryRefs("ans * 2", values)).toEqual({ ok: true, expression: "ans * 2" });
    // A `#` with no digits is left where it is: the engine reports it as the
    // syntax error it is, at its own position.
    expect(expandHistoryRefs("# + 1", values)).toEqual({ ok: true, expression: "# + 1" });
  });

  it("substitutes the entry's VALUE, bracketed, newest entry first", () => {
    expect(expandHistoryRefs("#1 * 2", values)).toEqual({
      ok: true,
      expression: "(5) * 2",
    });
    // A value is not always an atom: a unit and a matrix both have to be
    // bracketed or `#2 * 2` would bind wrongly.
    expect(expandHistoryRefs("#2", values)).toEqual({ ok: true, expression: "(3.1 mi)" });
    expect(expandHistoryRefs("#3 ^ 2", values)).toEqual({
      ok: true,
      expression: "([[1, 2]]) ^ 2",
    });
  });

  it("reads the whole number, so a two-digit reference is not entry #1 followed by a digit", () => {
    const twelve = Array.from({ length: 12 }, (_, index) => String(index + 1));
    expect(expandHistoryRefs("#12 + 1", twelve)).toEqual({ ok: true, expression: "(12) + 1" });
    expect(expandHistoryRefs("#1#2", values)).toEqual({ ok: true, expression: "(5)(3.1 mi)" });
  });

  it("reports a reference the history cannot answer, rather than leaving a `#` for the engine", () => {
    expect(expandHistoryRefs("#10 + 1", values)).toEqual({ ok: false, ref: 10 });
    // #0 is not a row: the list is one-based, so nothing answers it.
    expect(expandHistoryRefs("#0", values)).toEqual({ ok: false, ref: 0 });
    expect(expandHistoryRefs("#1", [])).toEqual({ ok: false, ref: 1 });
  });

  it("leaves a reference inside a quoted string alone", () => {
    expect(expandHistoryRefs('"#3" + 1', values)).toEqual({ ok: true, expression: '"#3" + 1' });
  });
});

describe("caretColumn", () => {
  it("clamps the engine's position to the line rather than trusting it", () => {
    expect(caretColumn(0, 5)).toBe(0);
    expect(caretColumn(3, 5)).toBe(3);
    expect(caretColumn(5, 5)).toBe(5);
    expect(caretColumn(9, 5)).toBe(5);
  });

  it("answers null for a refusal with no character to blame", () => {
    expect(caretColumn(undefined, 5)).toBeNull();
  });
});

describe("matchesQuery", () => {
  it("finds a row by either half of it, folded the way every search here folds", () => {
    expect(matchesQuery("2 km to mi", "1,24 mi", "mi")).toBe(true);
    expect(matchesQuery("2 km to mi", "1,24 mi", "1,24")).toBe(true);
    // Diacritics are optional in the query, and a diacritic-free query finds the
    // accented copy.
    expect(matchesQuery("dužina * 2", "2", "duzina")).toBe(true);
    expect(matchesQuery("2 + 2", "4", "3")).toBe(false);
    // An empty query keeps everything, which is what the field's resting state is.
    expect(matchesQuery("2 + 2", "4", "   ")).toBe(true);
  });
});

describe("sortNames", () => {
  it("alphabetises the way a Serbian reader does, with č and ž in their own places", () => {
    // `Intl.Collator(["sr-Latn", "sr"])`: č belongs between c and ć, and ž is last.
    // The default collation would put both at the end, after z.
    expect(sortNames(["ždreb", "avion", "čamac", "cifra", "ćup"])).toEqual([
      "avion",
      "cifra",
      "čamac",
      "ćup",
      "ždreb",
    ]);
    // Sorted by a copy: the caller's array is not touched.
    const names = ["b", "a"];
    expect(sortNames(names)).toEqual(["a", "b"]);
    expect(names).toEqual(["b", "a"]);
  });
});

describe("recallIndex", () => {
  it("walks back through the history from the line being typed, and stops at both ends", () => {
    // -1 is the line the user is typing rather than a row of the history.
    expect(recallIndex(-1, "up", 3)).toBe(0);
    expect(recallIndex(0, "up", 3)).toBe(1);
    expect(recallIndex(2, "up", 3)).toBe(2);
    expect(recallIndex(1, "down", 3)).toBe(0);
    expect(recallIndex(0, "down", 3)).toBe(-1);
    expect(recallIndex(-1, "down", 3)).toBe(-1);
  });

  it("answers the not-recalling state for an empty history, whatever the cursor says", () => {
    expect(recallIndex(-1, "up", 0)).toBe(-1);
    expect(recallIndex(4, "down", 0)).toBe(-1);
  });
});

describe("the keypad table", () => {
  it("gives every symbol key a spoken name, and no two keys the same id", () => {
    const keys = KEYPAD_ROWS.flat();
    expect(new Set(keys.map((key) => key.id)).size).toBe(keys.length);
    for (const key of keys) {
      // A digit or the word `ans` is its own name; `÷`, `x²` and `π` are not, and a
      // button whose accessible name is a symbol tells a reader nothing.
      const label = key.label;
      const spoken = /^[0-9A-Za-z]+$/.test(label);
      if (!spoken) expect(key.name, `${key.id} (${label})`).toBeDefined();
      if (key.name !== undefined) expect(KEYPAD_NAMES).toContain(key.name);
    }
  });

  it("declares no name the copy tables do not carry, in either locale", () => {
    for (const key of KEYPAD_ROWS.flat()) {
      if (key.name === undefined) continue;
      expect(typeof sr.keys[key.name], key.name).toBe("string");
      expect(typeof en.keys[key.name], key.name).toBe("string");
      expect(sr.keys[key.name].length, key.name).toBeGreaterThan(0);
      expect(en.keys[key.name].length, key.name).toBeGreaterThan(0);
    }
  });

  it("inserts text that is not the label wherever a symbol stands for a call", () => {
    const byId = new Map(KEYPAD_ROWS.flat().map((key) => [key.id, key]));
    expect(byId.get("root")?.insert).toBe("sqrt(");
    expect(byId.get("square")?.insert).toBe("^2");
    expect(byId.get("multiply")?.insert).toBe("*");
    expect(byId.get("minus")?.insert).toBe("-");
    expect(byId.get("convert")?.insert).toBe(" to ");
    expect(byId.get("sin")?.insert).toBe("sin(");
  });
});

describe("the copy every refusal code needs", () => {
  it("has a sentence for every code the page can be handed, in both locales", () => {
    for (const code of CALCULATOR_FAILURE_CODES) {
      expect(typeof sr.errors[code], code).toBe("string");
      expect(typeof en.errors[code], code).toBe("string");
      expect(sr.errors[code].length, code).toBeGreaterThan(0);
      expect(en.errors[code].length, code).toBeGreaterThan(0);
    }
  });

  it("has a sentence for the three failures the ENGINE never reports", () => {
    // Two of them are stops (the worker's) and the rest are raised by the page
    // itself: a reference the history cannot answer, a failed read, a failed write.
    for (const key of ["timeout", "stopped", "noEntry", "load", "mutate"] as const) {
      expect(typeof sr.errors[key], key).toBe("string");
      expect(typeof en.errors[key], key).toBe("string");
    }
  });
});
