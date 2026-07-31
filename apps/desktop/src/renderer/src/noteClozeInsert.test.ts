import { describe, expect, it } from "vitest";

import { planClozeInsertion, type ClozeInsertBlock } from "./noteClozeInsert.js";

/**
 * The pure half of „napravi prazninu" (ADR-068). Same arrangement as
 * `noteFind.test.ts`: a textblock is plain text plus the document positions of
 * its characters, so every rule here is exercised under node with no editor.
 */

/** One contiguous textblock with no inline atoms, starting at document position `start`. */
function block(text: string, start = 1): ClozeInsertBlock {
  return {
    text,
    positions: Array.from({ length: text.length }, (_, index) => start + index),
    blockPos: start - 1,
  };
}

/** The same text with an inline atom (a wiki-link, an attachment) occupying one position after `afterIndex`. */
function blockWithAtom(text: string, afterIndex: number, start = 1): ClozeInsertBlock {
  return {
    text,
    positions: Array.from({ length: text.length }, (_, index) =>
      index <= afterIndex ? start + index : start + index + 1,
    ),
    blockPos: start - 1,
  };
}

/**
 * Applies a plan to the block's text, so an assertion can read the result
 * rather than the arithmetic. Document positions are inverted through the
 * block's own `positions` — an atom makes the two run apart, which is half of
 * what these tests are about.
 */
function applied(source: ClozeInsertBlock, from: number, to: number): string | null {
  const plan = planClozeInsertion(source, from, to);
  if (plan === null) return null;
  let text = source.text;
  for (const insert of plan.inserts) {
    const index = source.positions.indexOf(insert.at);
    const offset = index === -1 ? source.text.length : index;
    text = text.slice(0, offset) + insert.text + text.slice(offset);
  }
  return text;
}

describe("planClozeInsertion", () => {
  it("wraps the selected text and numbers the deletion", () => {
    // "Ana voli čaj" at positions 1..12; „čaj" is [10, 13).
    expect(applied(block("Ana voli čaj"), 10, 13)).toBe("Ana voli {{c1::čaj}}");
  });

  it("puts the selection on the answer inside the new deletion", () => {
    const plan = planClozeInsertion(block("Ana voli čaj"), 10, 13);
    // `{{c1::` is six characters, so the answer starts six past where it was.
    expect(plan?.selection).toEqual({ from: 16, to: 19 });
  });

  it("materialises the numbers of the runs already there, keeping each one's own", () => {
    expect(applied(block("{{Ana}} voli čaj"), 14, 17)).toBe("{{c1::Ana}} voli {{c2::čaj}}");
  });

  it("returns insertions in descending document position, so applying them needs no re-mapping", () => {
    const plan = planClozeInsertion(block("{{Ana}} voli {{čaj}}"), 9, 13);
    const positions = plan?.inserts.map((insert) => insert.at) ?? [];
    expect(positions).toEqual([...positions].sort((a, b) => b - a));
  });

  it("inserts an empty deletion at a caret, with the caret inside it", () => {
    const plan = planClozeInsertion(block("Ana "), 5, 5);
    expect(applied(block("Ana "), 5, 5)).toBe("Ana {{c1::}}");
    expect(plan?.selection).toEqual({ from: 11, to: 11 });
  });

  it("works in an empty block, where the only position is the block's own", () => {
    const empty: ClozeInsertBlock = { text: "", positions: [], blockPos: 0 };
    const plan = planClozeInsertion(empty, 1, 1);
    expect(plan?.inserts.map((insert) => insert.at)).toEqual([1, 1]);
    expect(applied(empty, 1, 1)).toBe("{{c1::}}");
  });

  it("refuses a range that leaves the block's own text", () => {
    expect(planClozeInsertion(block("Ana"), 0, 2)).toBeNull();
    expect(planClozeInsertion(block("Ana"), 2, 9)).toBeNull();
  });

  it("refuses a selection spanning an inline atom — it occupies positions but is not text", () => {
    // "Ana X" with an atom after "Ana ": the four text characters sit at
    // 1..4, the atom at 5, and „X" at 6.
    const source = blockWithAtom("Ana X", 3);
    expect(planClozeInsertion(source, 1, 7)).toBeNull();
    // The text on the far side of the atom is still wrappable on its own.
    expect(applied(source, 6, 7)).toBe("Ana {{c1::X}}");
  });

  it("refuses a range overlapping a deletion already there — one cannot nest in another", () => {
    const source = block("Ana voli {{čaj}}");
    expect(planClozeInsertion(source, 5, 13)).toBeNull();
    expect(planClozeInsertion(source, 13, 13)).toBeNull();
  });
});
