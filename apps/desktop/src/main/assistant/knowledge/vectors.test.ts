import { describe, expect, it } from "vitest";
import { cosineSimilarity, decodeVector, encodeVector, rankBySimilarity } from "./vectors.js";

describe("encodeVector / decodeVector", () => {
  it("round-trips the values", () => {
    const vector = new Float32Array([0.5, -1.25, 3, 0]);
    const blob = encodeVector(vector);
    expect(blob.byteLength).toBe(16);
    expect(Array.from(decodeVector(blob) ?? [])).toEqual([0.5, -1.25, 3, 0]);
  });

  it("does not alias the caller's buffer - a later write does not change the blob", () => {
    const vector = new Float32Array([1, 2]);
    const blob = encodeVector(vector);
    vector[0] = 99;
    expect(Array.from(decodeVector(blob) ?? [])).toEqual([1, 2]);
  });

  it("refuses a blob that is not a whole number of four-byte words", () => {
    expect(decodeVector(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(decodeVector(new Uint8Array([]))).toBeNull();
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for a vector with itself, 0 for orthogonal ones and -1 for opposites", () => {
    expect(cosineSimilarity(new Float32Array([1, 2, 3]), new Float32Array([1, 2, 3]))).toBeCloseTo(1, 6);
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([-1, 0]))).toBe(-1);
  });

  it("is a true cosine, not a dot product - the contract normalises, this does not rely on it", () => {
    // dot([1,0],[3,0]) = 3; cosine = 10 / (sqrt(5) * sqrt(20)) = 1.
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([3, 0]))).toBeCloseTo(1, 6);
    expect(cosineSimilarity(new Float32Array([1, 2]), new Float32Array([2, 4]))).toBeCloseTo(1, 6);
  });

  it("answers 0 for vectors that cannot be compared rather than throwing", () => {
    expect(cosineSimilarity(new Float32Array([1, 2]), new Float32Array([1, 2, 3]))).toBe(0);
    expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
    expect(cosineSimilarity(new Float32Array([]), new Float32Array([]))).toBe(0);
  });
});

describe("rankBySimilarity", () => {
  const query = new Float32Array([1, 0]);
  const candidates = [
    { id: 3, vector: new Float32Array([0, 1]) }, // 0
    { id: 1, vector: new Float32Array([1, 0]) }, // 1
    { id: 2, vector: new Float32Array([1, 1]) }, // 0.7071...
  ];

  it("returns the best first, by descending similarity", () => {
    const ranked = rankBySimilarity(query, candidates, 3);
    expect(ranked.map((entry) => entry.id)).toEqual([1, 2, 3]);
    expect(ranked[0]!.score).toBeCloseTo(1, 6);
    expect(ranked[1]!.score).toBeCloseTo(Math.SQRT1_2, 6);
    expect(ranked[2]!.score).toBe(0);
  });

  it("drops a candidate at or under the floor - the vector search's own rule", () => {
    // The store passes a floor of 0, so an orthogonal or opposite passage is not
    // a candidate at all rather than a candidate at the bottom of the list.
    const ranked = rankBySimilarity(query, candidates, 3, { minScore: 0 });
    expect(ranked.map((entry) => entry.id)).toEqual([1, 2]);

    const opposite = [{ id: 7, vector: new Float32Array([-1, 0]) }];
    expect(rankBySimilarity(query, opposite, 3, { minScore: 0 })).toEqual([]);
    // And without a floor it is still ranked, at the score its cosine says.
    expect(rankBySimilarity(query, opposite, 3)[0]).toEqual({ id: 7, score: -1 });
  });

  it("keeps only the best `limit`, and answers nothing for a limit of zero", () => {
    expect(rankBySimilarity(query, candidates, 1)).toEqual([{ id: 1, score: 1 }]);
    expect(rankBySimilarity(query, candidates, 0)).toEqual([]);
  });

  it("breaks a tie by id, so the order never depends on the row order SQLite chose", () => {
    const tied = [
      { id: 9, vector: new Float32Array([1, 0]) },
      { id: 4, vector: new Float32Array([1, 0]) },
    ];
    expect(rankBySimilarity(query, tied, 2).map((entry) => entry.id)).toEqual([4, 9]);
    // The same two rows in the other order give the same answer.
    expect(rankBySimilarity(query, [...tied].reverse(), 2).map((entry) => entry.id)).toEqual([4, 9]);
  });
});
