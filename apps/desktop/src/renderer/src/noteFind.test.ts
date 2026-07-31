import { describe, expect, it } from "vitest";

import {
  findNoteMatches,
  matchIndexAt,
  planNoteReplacements,
  stepMatchIndex,
  type NoteFindBlock,
  type NoteFindMatch,
} from "./noteFind.js";

/**
 * `noteFind.ts` is the pure half of in-note find/replace (NOTE-005): it never
 * touches ProseMirror, only plain text plus the position array a textblock walk
 * hands it. That is what makes every rule below — the Serbian folding, the
 * atom-gap refusal, the back-to-front replacement order — testable under node
 * with no editor and no DOM anywhere in sight.
 */

/**
 * One contiguous textblock starting at document position `start`, the shape a
 * paragraph with no inline atoms in it produces.
 */
function block(text: string, start = 1): NoteFindBlock {
  return { text, positions: Array.from({ length: text.length }, (_, index) => start + index) };
}

/** Document ranges as `[from, to)` pairs — terser to assert than object literals. */
function ranges(matches: readonly NoteFindMatch[]): Array<[number, number]> {
  return matches.map((match) => [match.from, match.to]);
}

describe("findNoteMatches", () => {
  it("finds nothing for an empty query, whatever the document says", () => {
    expect(findNoteMatches([block("Nexus")], "", false)).toEqual([]);
    expect(findNoteMatches([block("Nexus")], "", true)).toEqual([]);
  });

  it("maps a match onto document positions, half-open", () => {
    // "beleska" starts at index 4 of the text, whose char 0 sits at position 1.
    expect(ranges(findNoteMatches([block("Ova beleska")], "beleska", false))).toEqual([[5, 12]]);
  });

  it("returns matches in document order across blocks", () => {
    const blocks = [block("prvi red", 1), block("drugi red", 20)];
    expect(ranges(findNoteMatches(blocks, "red", false))).toEqual([
      [6, 9],
      [26, 29],
    ]);
  });

  it("does not overlap matches — each scan resumes past the previous one", () => {
    expect(ranges(findNoteMatches([block("aaaa")], "aa", false))).toEqual([
      [1, 3],
      [3, 5],
    ]);
  });

  describe("case-insensitive matching (the default)", () => {
    it("ignores case", () => {
      expect(ranges(findNoteMatches([block("Nexus")], "nexus", false))).toEqual([[1, 6]]);
      expect(ranges(findNoteMatches([block("nexus")], "NEXUS", false))).toEqual([[1, 6]]);
    });

    it("folds Serbian diacritics — „Đorđe“ is found by „djordje“", () => {
      expect(ranges(findNoteMatches([block("Đorđe")], "djordje", false))).toEqual([[1, 6]]);
      expect(ranges(findNoteMatches([block("Šešir")], "sesir", false))).toEqual([[1, 6]]);
      expect(ranges(findNoteMatches([block("čačak")], "cacak", false))).toEqual([[1, 6]]);
    });

    it("folds Cyrillic onto the same string, so „Ђорђе“ is found by „djordje“ too", () => {
      expect(ranges(findNoteMatches([block("Ђорђе")], "djordje", false))).toEqual([[1, 6]]);
      expect(ranges(findNoteMatches([block("Ђорђе")], "Đorđe", false))).toEqual([[1, 6]]);
    });

    it("snaps a match that lands inside a folded expansion out to the whole source character", () => {
      // "đ" folds to "dj": querying either half must select the "đ" itself,
      // never half of a character the document cannot cut in two.
      expect(ranges(findNoteMatches([block("đak")], "d", false))).toEqual([[1, 2]]);
      expect(ranges(findNoteMatches([block("đak")], "j", false))).toEqual([[1, 2]]);
    });

    it("keeps snapped matches apart rather than letting them overlap", () => {
      expect(ranges(findNoteMatches([block("đđ")], "d", false))).toEqual([
        [1, 2],
        [2, 3],
      ]);
    });

    it("finds nothing for a query that folds away to nothing", () => {
      // A lone combining acute contributes no folded character at all — it must
      // not degenerate into an empty needle that matches everywhere.
      expect(findNoteMatches([block("Nexus")], "́", false)).toEqual([]);
    });
  });

  describe("case-sensitive matching", () => {
    it("matches exactly, and therefore folds nothing", () => {
      expect(ranges(findNoteMatches([block("Nexus")], "Nexus", true))).toEqual([[1, 6]]);
      expect(findNoteMatches([block("Nexus")], "nexus", true)).toEqual([]);
      expect(findNoteMatches([block("Đorđe")], "djordje", true)).toEqual([]);
      expect(ranges(findNoteMatches([block("Đorđe")], "Đorđe", true))).toEqual([[1, 6]]);
    });
  });

  describe("inline atoms", () => {
    /**
     * A wiki-link or attachment image contributes no text but does occupy
     * document positions, so the walk that builds a block leaves a gap in
     * `positions` where it sat: "ab" at 1–2, an atom at 3, "cd" at 4–5.
     */
    const gapped: NoteFindBlock = { text: "abcd", positions: [1, 2, 4, 5] };

    it("still finds a match that lies wholly on one side of the atom", () => {
      expect(ranges(findNoteMatches([gapped], "ab", false))).toEqual([[1, 3]]);
      expect(ranges(findNoteMatches([gapped], "cd", false))).toEqual([[4, 6]]);
    });

    it("refuses a match that spans the atom — replacing it would eat the atom", () => {
      expect(findNoteMatches([gapped], "bc", false)).toEqual([]);
      expect(findNoteMatches([gapped], "abcd", false)).toEqual([]);
    });
  });
});

describe("matchIndexAt", () => {
  const matches: NoteFindMatch[] = [
    { from: 5, to: 8 },
    { from: 20, to: 23 },
    { from: 40, to: 43 },
  ];

  it("has no answer when there are no matches", () => {
    expect(matchIndexAt([], 0)).toBe(-1);
  });

  it("takes the first match at or after the position", () => {
    expect(matchIndexAt(matches, 0)).toBe(0);
    expect(matchIndexAt(matches, 5)).toBe(0);
    expect(matchIndexAt(matches, 6)).toBe(1);
    expect(matchIndexAt(matches, 20)).toBe(1);
    expect(matchIndexAt(matches, 21)).toBe(2);
  });

  it("wraps to the first match when the position is past them all", () => {
    expect(matchIndexAt(matches, 41)).toBe(0);
    expect(matchIndexAt(matches, 9999)).toBe(0);
  });
});

describe("stepMatchIndex", () => {
  it("has no answer when there are no matches", () => {
    expect(stepMatchIndex(0, -1, 1)).toBe(-1);
    expect(stepMatchIndex(0, 2, -1)).toBe(-1);
  });

  it("enters the list from either end when nothing is active yet", () => {
    expect(stepMatchIndex(4, -1, 1)).toBe(0);
    expect(stepMatchIndex(4, -1, -1)).toBe(3);
  });

  it("wraps in both directions", () => {
    expect(stepMatchIndex(3, 2, 1)).toBe(0);
    expect(stepMatchIndex(3, 0, -1)).toBe(2);
    expect(stepMatchIndex(3, 1, 1)).toBe(2);
    expect(stepMatchIndex(3, 1, -1)).toBe(0);
  });
});

describe("planNoteReplacements", () => {
  it("orders the edits strictly back to front", () => {
    const matches: NoteFindMatch[] = [
      { from: 5, to: 8 },
      { from: 20, to: 23 },
      { from: 40, to: 43 },
    ];
    expect(planNoteReplacements(matches).map((match) => match.from)).toEqual([40, 20, 5]);
  });

  /**
   * The whole point of the plan, proven the way the editor experiences it: each
   * planned edit is applied in turn to the text that the previous ones already
   * changed. Splicing a plain string is exactly what a ProseMirror transaction
   * does to document positions, so if the order is right here it is right there.
   */
  function applyPlan(text: string, matches: readonly NoteFindMatch[], replacement: string): string {
    let result = text;
    for (const match of matches) {
      result = result.slice(0, match.from) + replacement + result.slice(match.to);
    }
    return result;
  }

  it("survives a LONGER replacement, where a front-to-back walk would corrupt every later match", () => {
    const text = "ab ab ab";
    // `block(text, 0)` puts char 0 at position 0, so the document ranges ARE
    // string indices and the splice above stands in for the transaction.
    const matches = findNoteMatches([block(text, 0)], "ab", false);
    expect(applyPlan(text, planNoteReplacements(matches), "xyz")).toBe("xyz xyz xyz");
    // The same edits front-to-back drift further wrong with every replacement.
    expect(applyPlan(text, matches, "xyz")).not.toBe("xyz xyz xyz");
  });

  it("survives a SHORTER replacement the same way", () => {
    const text = "abcd abcd abcd";
    const matches = findNoteMatches([block(text, 0)], "abcd", false);
    expect(applyPlan(text, planNoteReplacements(matches), "z")).toBe("z z z");
    expect(applyPlan(text, matches, "z")).not.toBe("z z z");
  });

  it("survives an EMPTY replacement (a delete) and a same-length one", () => {
    const text = "ab-ab-ab";
    const matches = findNoteMatches([block(text, 0)], "ab", false);
    expect(applyPlan(text, planNoteReplacements(matches), "")).toBe("--");
    expect(applyPlan(text, planNoteReplacements(matches), "xy")).toBe("xy-xy-xy");
  });

  it("replaces folded matches of differing source lengths without drifting", () => {
    // "Đorđe" is 5 source characters that fold to 7 — the plan works in source
    // positions, so an expansion in the folded string changes nothing here.
    const text = "Đorđe i Ђорђе";
    const matches = findNoteMatches([block(text, 0)], "djordje", false);
    expect(matches).toHaveLength(2);
    expect(applyPlan(text, planNoteReplacements(matches), "Marko")).toBe("Marko i Marko");
  });

  it("leaves an already-descending plan alone and does not mutate its input", () => {
    const matches: NoteFindMatch[] = [
      { from: 40, to: 43 },
      { from: 5, to: 8 },
    ];
    expect(planNoteReplacements(matches).map((match) => match.from)).toEqual([40, 5]);
    expect(matches.map((match) => match.from)).toEqual([40, 5]);
  });
});
