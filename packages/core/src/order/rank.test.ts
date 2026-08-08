import { describe, expect, it } from "vitest";
import {
  FIRST_RANK,
  MAX_RANK_SEQUENCE,
  RANK_ALPHABET,
  isRank,
  normalizeRank,
  rankAfter,
  rankBetween,
  rankForInteger,
  rankSequence,
} from "./rank.js";

/**
 * Deterministic PRNG (mulberry32). The property tests below run thousands of
 * random reorderings, and a failure that cannot be re-run is not a finding.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every rank in `ranks` is well-formed and strictly ascending by plain string comparison. */
function expectAscending(ranks: readonly string[]): void {
  for (const rank of ranks) expect(isRank(rank)).toBe(true);
  for (let index = 1; index < ranks.length; index += 1) {
    expect(ranks[index - 1]! < ranks[index]!).toBe(true);
  }
}

describe("the alphabet", () => {
  it("is strictly ascending in code points — the whole scheme rests on it", () => {
    for (let index = 1; index < RANK_ALPHABET.length; index += 1) {
      expect(RANK_ALPHABET.charCodeAt(index - 1)).toBeLessThan(RANK_ALPHABET.charCodeAt(index));
    }
  });

  it("holds no uppercase, so COLLATE NOCASE and BINARY cannot disagree", () => {
    expect(RANK_ALPHABET).toBe(RANK_ALPHABET.toLowerCase());
    expect(RANK_ALPHABET).toHaveLength(36);
  });
});

describe("isRank", () => {
  it("accepts what the module produces", () => {
    expect(isRank(FIRST_RANK)).toBe(true);
    expect(isRank("i0i")).toBe(true);
    expect(isRank("hz")).toBe(true);
    expect(isRank("j00")).toBe(true);
  });

  it("rejects an integer part that was cut short", () => {
    // `i` promises one integer digit and `j` two; neither string carries them.
    expect(isRank("i")).toBe(false);
    expect(isRank("j0")).toBe(false);
    expect(isRank("")).toBe(false);
  });

  it("rejects foreign characters and a trailing zero in the fraction", () => {
    expect(isRank("i00")).toBe(false);
    expect(isRank("I0")).toBe(false);
    expect(isRank("i0-j")).toBe(false);
    expect(isRank(42)).toBe(false);
    expect(isRank(null)).toBe(false);
  });
});

describe("normalizeRank", () => {
  it("drops trailing zeros from the fraction and none from the integer part", () => {
    expect(normalizeRank("i00")).toBe("i0");
    expect(normalizeRank("i0")).toBe("i0");
    expect(normalizeRank("j00")).toBe("j00");
    expect(normalizeRank("i0j00")).toBe("i0j");
  });

  it("throws for a string that was never a rank", () => {
    expect(() => normalizeRank("I0")).toThrow(RangeError);
    expect(() => normalizeRank("i")).toThrow(RangeError);
    expect(() => normalizeRank("i0 j")).toThrow(RangeError);
  });
});

describe("rankBetween", () => {
  it("places the only row in a scope at the integer zero", () => {
    expect(rankBetween(null, null)).toBe(FIRST_RANK);
    expect(FIRST_RANK).toBe("i0");
  });

  it("appends and prepends by whole integers, so the key does not grow", () => {
    expect(rankBetween("i0", null)).toBe("i1");
    expect(rankBetween(null, "i0")).toBe("hz");
  });

  it("widens the integer part rather than failing at a magnitude boundary", () => {
    expect(rankBetween("iz", null)).toBe("j00");
    expect(rankBetween(null, "h0")).toBe("gzz");
  });

  it("drops into the fraction only when two integers are adjacent", () => {
    expect(rankBetween("i0", "i1")).toBe("i0i");
    expect(rankBetween("i0", "i0i")).toBe("i09");
  });

  it("borrows a digit when two fractions are adjacent", () => {
    expect(rankBetween("i0i", "i0j")).toBe("i0ii");
  });

  it("truncates the upper fraction when that is enough", () => {
    expect(rankBetween("i0i", "i0jz")).toBe("i0j");
  });

  it("returns the bare integer when the upper neighbour is that integer plus a fraction", () => {
    expect(rankBetween(null, "i0i")).toBe("i0");
  });

  it("returns null for a pair that is not a gap", () => {
    expect(rankBetween("i0", "i0")).toBeNull();
    expect(rankBetween("i1", "i0")).toBeNull();
    expect(rankBetween("i0", "i00")).toBeNull();
  });

  it("reads a non-canonical stored rank as the number it denotes", () => {
    expect(rankBetween("i00", null)).toBe(rankBetween("i0", null));
    expect(rankBetween(null, "i0i0")).toBe(rankBetween(null, "i0i"));
  });

  it("never runs out of room — 2000 splits at the same spot all succeed", () => {
    let lower = "i0";
    const upper = "i1";
    const produced: string[] = [];
    for (let round = 0; round < 2000; round += 1) {
      const next = rankBetween(lower, upper);
      expect(next).not.toBeNull();
      expect(isRank(next as string)).toBe(true);
      expect(lower < (next as string)).toBe(true);
      expect((next as string) < upper).toBe(true);
      produced.push(next as string);
      lower = next as string;
    }
    expectAscending(produced);
  });

  it("keeps ten thousand appends and ten thousand prepends short", () => {
    let last = FIRST_RANK;
    let first = FIRST_RANK;
    for (let round = 0; round < 10_000; round += 1) {
      last = rankBetween(last, null) as string;
      first = rankBetween(null, first) as string;
    }
    expect(last.length).toBeLessThanOrEqual(5);
    expect(first.length).toBeLessThanOrEqual(5);
    expect(first < FIRST_RANK).toBe(true);
    expect(FIRST_RANK < last).toBe(true);
  });

  it("survives ten thousand random moves inside one scope", () => {
    const random = seeded(0x5eed);
    // The scope as the user sees it, top to bottom. Its rank column must always
    // sort into exactly this order.
    let rows: { id: number; rank: string }[] = [];
    let nextId = 0;

    for (let step = 0; step < 10_000; step += 1) {
      const target = Math.floor(random() * (rows.length + 1));
      const before = target === 0 ? null : (rows[target - 1]?.rank ?? null);
      const after = target === rows.length ? null : (rows[target]?.rank ?? null);
      const rank = rankBetween(before, after);
      expect(rank).not.toBeNull();

      const row = { id: nextId++, rank: rank as string };
      rows = [...rows.slice(0, target), row, ...rows.slice(target)];

      // Every few steps, take one out again — a scope shrinks as well as grows.
      if (rows.length > 60) rows.splice(Math.floor(random() * rows.length), 1);
    }

    expectAscending(rows.map((row) => row.rank));
    const sorted = [...rows].sort((left, right) => (left.rank < right.rank ? -1 : 1));
    expect(sorted.map((row) => row.id)).toEqual(rows.map((row) => row.id));
  });

  it("stays short under realistic use — a thousand appends and a thousand inserts", () => {
    const ranks: string[] = [];
    for (let index = 0; index < 1000; index += 1) {
      ranks.push(rankBetween(ranks[ranks.length - 1] ?? null, null) as string);
    }
    const random = seeded(7);
    for (let index = 0; index < 1000; index += 1) {
      const at = 1 + Math.floor(random() * (ranks.length - 1));
      ranks.splice(at, 0, rankBetween(ranks[at - 1]!, ranks[at]!) as string);
    }
    expectAscending(ranks);
    const longest = ranks.reduce((max, rank) => Math.max(max, rank.length), 0);
    expect(longest).toBeLessThanOrEqual(8);
  });
});

describe("rankForInteger", () => {
  it("puts zero at the first rank and mirrors the space around it", () => {
    expect(rankForInteger(0)).toBe(FIRST_RANK);
    expect(rankForInteger(1)).toBe("i1");
    expect(rankForInteger(35)).toBe("iz");
    expect(rankForInteger(36)).toBe("j00");
    expect(rankForInteger(1331)).toBe("jzz");
    expect(rankForInteger(1332)).toBe("k000");
    expect(rankForInteger(-1)).toBe("hz");
    expect(rankForInteger(-36)).toBe("h0");
    expect(rankForInteger(-37)).toBe("gzz");
  });

  it("is exactly the walk — an append off n lands on n + 1, either side of zero", () => {
    for (let value = -2000; value < 2000; value += 1) {
      expect(rankAfter(rankForInteger(value))).toBe(rankForInteger(value + 1));
    }
  });

  it("preserves order over the whole range an old sparse position could hold", () => {
    const values = [-4_194_304, -1024, -1, 0, 1, 1024, 2048, 1_048_576, 16_777_216];
    const ranks = values.map(rankForInteger);
    expectAscending(ranks);
  });

  it("preserves order for the gap-1024 spacing migration 022 actually wrote", () => {
    const ranks = Array.from({ length: 500 }, (_, index) => rankForInteger((index + 1) * 1024));
    expectAscending(ranks);
    // And every one of them still has room on both sides and in between.
    expect(rankBetween(null, ranks[0]!)).not.toBeNull();
    expect(rankBetween(ranks[0]!, ranks[1]!)).not.toBeNull();
    expect(rankBetween(ranks[ranks.length - 1]!, null)).not.toBeNull();
  });

  it("refuses anything that is not a whole number", () => {
    expect(() => rankForInteger(1.5)).toThrow(RangeError);
    expect(() => rankForInteger(Number.NaN)).toThrow(RangeError);
    expect(() => rankForInteger(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("rankAfter", () => {
  it("opens an empty scope and then appends, never failing", () => {
    expect(rankAfter(null)).toBe(FIRST_RANK);
    expect(rankAfter("i0")).toBe("i1");
    expect(rankAfter("iz")).toBe("j00");
    // Appending off a fraction stays above it — the case an empty scope maximum
    // cannot produce, but a restored row can.
    expect(rankAfter("i0i") > "i0i").toBe(true);
    expect(isRank(rankAfter("i0i"))).toBe(true);
  });

  it("agrees with rankSequence, which is what a fresh scope is", () => {
    const walked: string[] = [];
    let last: string | null = null;
    for (let index = 0; index < 200; index += 1) {
      last = rankAfter(last);
      walked.push(last);
    }
    expect(walked).toEqual(rankSequence(200));
  });
});

describe("rankSequence", () => {
  it("lays out a fresh scope in ascending order", () => {
    expectAscending(rankSequence(1));
    expectAscending(rankSequence(2));
    // 36 values per head at the narrowest width, so these straddle `iz` -> `j00`.
    expectAscending(rankSequence(35));
    expectAscending(rankSequence(36));
    expectAscending(rankSequence(37));
    expectAscending(rankSequence(1400));
  });

  it("returns exactly the count asked for, and nothing for zero", () => {
    expect(rankSequence(0)).toEqual([]);
    expect(rankSequence(1)).toEqual([FIRST_RANK]);
    expect(rankSequence(500)).toHaveLength(500);
  });

  it("keeps keys short at the cap", () => {
    const ranks = rankSequence(MAX_RANK_SEQUENCE);
    expect(ranks).toHaveLength(MAX_RANK_SEQUENCE);
    expect(ranks[ranks.length - 1]!.length).toBeLessThanOrEqual(5);
    expect(ranks[0]! < ranks[ranks.length - 1]!).toBe(true);
  });

  it("leaves room above and below for an append and a prepend", () => {
    const ranks = rankSequence(200);
    expect(rankBetween(null, ranks[0]!)).not.toBeNull();
    expect(rankBetween(ranks[ranks.length - 1]!, null)).not.toBeNull();
    for (let index = 1; index < ranks.length; index += 1) {
      expect(rankBetween(ranks[index - 1]!, ranks[index]!)).not.toBeNull();
    }
  });

  it("refuses a count that is not a whole number of rows, or more than it can space", () => {
    expect(() => rankSequence(-1)).toThrow(RangeError);
    expect(() => rankSequence(1.5)).toThrow(RangeError);
    expect(() => rankSequence(Number.NaN)).toThrow(RangeError);
    expect(() => rankSequence(MAX_RANK_SEQUENCE + 1)).toThrow(RangeError);
  });
});
