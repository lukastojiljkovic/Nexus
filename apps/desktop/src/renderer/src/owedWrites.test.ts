import { describe, expect, it, vi } from "vitest";

import { OwedWrites } from "./owedWrites.js";

/** A write whose answer the test gives by hand, recording what it was handed. */
function wire<T>() {
  const sent: { owed: T; land: () => void; fail: () => void }[] = [];
  const write = (owed: T): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      sent.push({ owed, land: resolve, fail: () => reject(new Error("disk")) });
    });
  return { sent, write };
}

/** Lets every settled promise run its continuation. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A note's owed updates: what failed goes out again, ahead of what is new. */
function noteWrites() {
  const failures: { owed: string[] }[] = [];
  const writes = new OwedWrites<string[]>({
    carry: (failed, next) => [...failed, ...next],
    onFailed: (owed) => failures.push({ owed }),
  });
  return { writes, failures };
}

describe("OwedWrites", () => {
  it("starts a write only once the one before it has answered, in the order asked", async () => {
    const { writes } = noteWrites();
    const { sent, write } = wire<string[]>();
    void writes.send(["a"], write);
    void writes.send(["b"], write);
    await tick();
    expect(sent.map((one) => one.owed)).toEqual([["a"]]);
    sent[0]?.land();
    await tick();
    expect(sent.map((one) => one.owed)).toEqual([["a"], ["b"]]);
  });

  it("resolves `settled` only once every write asked so far has answered", async () => {
    const { writes } = noteWrites();
    const { sent, write } = wire<string[]>();
    void writes.send(["a"], write);
    let settled = false;
    void writes.settled().then(() => (settled = true));
    await tick();
    expect(settled).toBe(false);
    sent[0]?.land();
    await tick();
    expect(settled).toBe(true);
  });

  it("carries what a write failed to land onto the next one, which speaks for both", async () => {
    const { writes, failures } = noteWrites();
    const { sent, write } = wire<string[]>();
    void writes.send(["a"], write);
    void writes.send(["b"], write);
    await tick();
    sent[0]?.fail();
    await tick();
    expect(failures).toEqual([]);
    expect(sent[1]?.owed).toEqual(["a", "b"]);
    sent[1]?.land();
    await tick();
    expect(writes.owesFailure).toBe(false);
    expect(failures).toEqual([]);
  });

  it("says a failure when no later write was asked for to carry it — and still owes it", async () => {
    const { writes, failures } = noteWrites();
    const { sent, write } = wire<string[]>();
    void writes.send(["a"], write);
    await tick();
    sent[0]?.fail();
    await tick();
    expect(failures).toEqual([{ owed: ["a"] }]);
    expect(writes.owesFailure).toBe(true);
  });

  it("sends a failed write again with the next one, even one asked long after the failure", async () => {
    const { writes } = noteWrites();
    const { sent, write } = wire<string[]>();
    void writes.send(["a"], write);
    await tick();
    sent[0]?.fail();
    await tick();
    void writes.send([], write);
    await tick();
    expect(sent[1]?.owed).toEqual(["a"]);
  });

  it("says a carried failure once more if the write carrying it fails too, with all it owes", async () => {
    const { writes, failures } = noteWrites();
    const { sent, write } = wire<string[]>();
    void writes.send(["a"], write);
    void writes.send(["b"], write);
    await tick();
    sent[0]?.fail();
    await tick();
    sent[1]?.fail();
    await tick();
    expect(failures).toEqual([{ owed: ["a", "b"] }]);
  });

  it("lets a whole-state writer drop the failed state for the newer one", async () => {
    const failures: string[] = [];
    const writes = new OwedWrites<string>({
      carry: (_failed, next) => next,
      onFailed: (owed) => failures.push(owed),
    });
    const { sent, write } = wire<string>();
    void writes.send("v1", write);
    void writes.send("v2", write);
    await tick();
    sent[0]?.fail();
    await tick();
    expect(sent[1]?.owed).toBe("v2");
  });

  it("keeps going past a failure report that throws, and says so", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const writes = new OwedWrites<string[]>({
      carry: (failed, next) => [...failed, ...next],
      onFailed: () => {
        throw new Error("report");
      },
    });
    const { sent, write } = wire<string[]>();
    void writes.send(["a"], write);
    await tick();
    sent[0]?.fail();
    await writes.settled();
    void writes.send(["b"], write);
    await tick();
    expect(sent[1]?.owed).toEqual(["a", "b"]);
    expect(errors).toHaveBeenCalledOnce();
    errors.mockRestore();
  });
});
