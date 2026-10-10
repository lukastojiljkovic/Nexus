import { describe, expect, it } from "vitest";
import { RRF_K, fuseRanked, type RankedHit } from "./fusion.js";

function hit(key: string, text = `text of ${key}`): RankedHit {
  return { key, citation: { kind: "note", id: key, title: key }, text };
}

describe("fuseRanked", () => {
  it("scores by reciprocal rank across every list, as the paper defines it", () => {
    // Cormack, Clarke & Buettcher (SIGIR 2009): score(d) = sum 1 / (k + rank),
    // rank counted from 1, k = 60. With A = [a, b] and B = [b, c]:
    //   a: 1/61                     b: 1/62 + 1/61                    c: 1/62
    // so the order is b, a, c.
    const fused = fuseRanked([[hit("a"), hit("b")], [hit("b"), hit("c")]], { limit: 10 });

    expect(fused.map((entry) => entry.citation.id)).toEqual(["b", "a", "c"]);
    expect(fused[0]!.score).toBeCloseTo(1 / 62 + 1 / 61, 12);
    expect(fused[1]!.score).toBeCloseTo(1 / 61, 12);
    expect(fused[2]!.score).toBeCloseTo(1 / 62, 12);
    expect(RRF_K).toBe(60);
  });

  it("counts a passage found by two lists once, carrying both contributions", () => {
    const fused = fuseRanked([[hit("same")], [hit("same")]], { limit: 10 });
    expect(fused).toHaveLength(1);
    expect(fused[0]!.score).toBeCloseTo(2 / 61, 12);
  });

  it("keeps the text of the first list that offered the passage", () => {
    const fused = fuseRanked([[hit("a", "full text")], [hit("a", "passage")]], { limit: 10 });
    expect(fused[0]!.text).toBe("full text");
  });

  it("breaks a tie by key, never by which list came first", () => {
    // Both are rank 1 in their own list, so both score 1/61: the order has to be
    // a property of the data.
    const fused = fuseRanked([[hit("b")], [hit("a")]], { limit: 10 });
    expect(fused.map((entry) => entry.citation.id)).toEqual(["a", "b"]);
  });

  it("caps at the limit and answers nothing for none", () => {
    const lists = [[hit("a"), hit("b"), hit("c")]];
    expect(fuseRanked(lists, { limit: 2 }).map((entry) => entry.citation.id)).toEqual(["a", "b"]);
    expect(fuseRanked(lists, { limit: 0 })).toEqual([]);
    expect(fuseRanked([], { limit: 5 })).toEqual([]);
  });

  it("honours an explicit k", () => {
    // k = 0 makes the score 1/rank: the first list's first entry scores 1.
    const fused = fuseRanked([[hit("a")], [hit("b")]], { limit: 5, k: 0 });
    expect(fused[0]!.score).toBe(1);
  });
});
