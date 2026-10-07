import { describe, expect, it, vi } from "vitest";

import { assertDeclaredLength, readWithin, UpdateLimitError } from "./limits.js";

/** A body that hands over `chunks` in order and then closes. */
function bodyOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("assertDeclaredLength", () => {
  it("refuses a declaration over the limit, and only then", () => {
    expect(() => assertDeclaredLength("101", 100)).toThrow(UpdateLimitError);
    expect(() => assertDeclaredLength("100", 100)).not.toThrow();
    expect(() => assertDeclaredLength("99", 100)).not.toThrow();
  });

  it("leaves a missing or unusable declaration to the read", () => {
    for (const value of [null, "", "abc", "-1", "NaN"]) {
      expect(() => assertDeclaredLength(value, 100), String(value)).not.toThrow();
    }
  });
});

describe("readWithin", () => {
  it("reads every chunk in order and answers the total", async () => {
    const seen: number[] = [];
    const total = await readWithin(
      bodyOf([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5, 6])]),
      10,
      (chunk) => {
        seen.push(chunk.byteLength);
      },
    );
    expect(total).toBe(6);
    expect(seen).toEqual([2, 1, 3]);
  });

  it("throws the moment the running total passes the limit, and cancels the reader", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(4));
      },
      cancel() {
        cancelled = true;
      },
    });
    const onChunk = vi.fn();
    await expect(readWithin(stream, 6, onChunk)).rejects.toBeInstanceOf(UpdateLimitError);
    // The first chunk is handed over; the chunk that crosses the cap is not,
    // because the reader is cancelled first.
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(cancelled).toBe(true);
  });

  it("accepts a body that lands exactly on the limit", async () => {
    await expect(readWithin(bodyOf([new Uint8Array(6)]), 6, () => undefined)).resolves.toBe(6);
  });
});
