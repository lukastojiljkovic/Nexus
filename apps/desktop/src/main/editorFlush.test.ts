import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditorFlush } from "./editorFlush.js";

/**
 * Main's half of DC-149: an exit main starts itself asks the renderer for what
 * its open editors owe, and waits — for the answer, or for the grace, never
 * longer. The properties worth pinning are the ones a lock depends on: it is
 * resolved exactly once, it is never resolved late, and nothing it cannot
 * deliver makes it wait.
 */

const GRACE = 1_500;

/** Whether the promise has settled yet, read without waiting on it. */
function watch(promise: Promise<void>): { settled: () => boolean } {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  return { settled: () => done };
}

describe("createEditorFlush", () => {
  let sent: number[];
  let deliver: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    deliver = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const create = () =>
    createEditorFlush((requestId) => {
      sent.push(requestId);
      return deliver;
    }, GRACE);

  it("resolves when the renderer answers", async () => {
    const flush = create();
    const request = watch(flush.request());
    expect(sent).toEqual([1]);
    flush.acknowledge(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(request.settled()).toBe(true);
    // The answer cleared its own timer: nothing is left to fire.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is not resolved by an answer to another request", async () => {
    const flush = create();
    const request = watch(flush.request());
    flush.acknowledge(2);
    flush.acknowledge(0);
    await vi.advanceTimersByTimeAsync(GRACE - 1);
    expect(request.settled()).toBe(false);
  });

  it("resolves at the grace when nobody answers, and not a millisecond before", async () => {
    const flush = create();
    const request = watch(flush.request());
    await vi.advanceTimersByTimeAsync(GRACE - 1);
    expect(request.settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(request.settled()).toBe(true);
  });

  it("resolves at once when there is nobody to ask, with no timer left", async () => {
    deliver = false;
    const flush = create();
    const request = watch(flush.request());
    await vi.advanceTimersByTimeAsync(0);
    expect(request.settled()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves at once when delivering the request throws, and says so", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const flush = createEditorFlush(() => {
      throw new Error("Object has been destroyed");
    }, GRACE);
    const request = watch(flush.request());
    await vi.advanceTimersByTimeAsync(0);
    expect(request.settled()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(errors).toHaveBeenCalledOnce();
    errors.mockRestore();
  });

  it("ignores an answer that arrives after the grace", async () => {
    const flush = create();
    const request = watch(flush.request());
    await vi.advanceTimersByTimeAsync(GRACE);
    expect(request.settled()).toBe(true);
    expect(() => flush.acknowledge(1)).not.toThrow();
    // A late answer must not be mistaken for the answer to the next request.
    const next = watch(flush.request());
    flush.acknowledge(1);
    await vi.advanceTimersByTimeAsync(GRACE - 1);
    expect(next.settled()).toBe(false);
  });

  it("gives concurrent requests distinct ids and resolves each on its own answer", async () => {
    const flush = create();
    const first = watch(flush.request());
    const second = watch(flush.request());
    expect(sent).toEqual([1, 2]);
    flush.acknowledge(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(second.settled()).toBe(true);
    expect(first.settled()).toBe(false);
    flush.acknowledge(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(first.settled()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
