import { EventEmitter } from "node:events";

import type { UtilityProcess } from "electron";
import { describe, expect, it } from "vitest";

import { createNllbHost, NllbError, type NllbJob } from "./host.js";

const JOB: NllbJob = {
  directory: "C:\\packs\\nllb-600m\\1.0.0",
  sentences: ["Добар дан.", "Како сте?"],
  source: "srp_Cyrl",
  target: "eng_Latn",
};

/** A utility process that records what it was sent, and answers only when a test makes it. */
class FakeWorker extends EventEmitter {
  readonly sent: Record<string, unknown>[] = [];
  killed = false;
  postMessage(message: Record<string, unknown>): void {
    this.sent.push(message);
  }
  kill(): boolean {
    this.killed = true;
    this.emit("exit", 0);
    return true;
  }
  reply(message: unknown): void {
    this.emit("message", message);
  }
}

function harness() {
  const workers: FakeWorker[] = [];
  const host = createNllbHost("worker.js", () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as UtilityProcess;
  });
  return { host, workers };
}

describe("the translator worker's host", () => {
  it("hands each sentence over as it arrives, then resolves, and ignores what is not a reply", async () => {
    const { host, workers } = harness();
    const seen: [number, string][] = [];
    const done = host.translate(JOB, (index, text) => seen.push([index, text]), new AbortController().signal);
    const worker = workers[0]!;
    expect(worker.sent[0]).toMatchObject({ id: 1, type: "translate", ...JOB });
    worker.reply({ id: 1, type: "sentence", index: 0, text: "Good day." });
    worker.reply({ id: 1, type: "sentence", index: -3, text: "forged" });
    worker.reply({ id: 1, type: "sentence", index: 1, text: "How are you?" });
    worker.reply({ id: 1, type: "translated" });
    await done;
    expect(seen).toEqual([
      [0, "Good day."],
      [1, "How are you?"],
    ]);
  });

  it("rejects with the worker's own failure code", async () => {
    const { host, workers } = harness();
    const done = host.translate(JOB, () => undefined, new AbortController().signal);
    workers[0]!.reply({ id: 1, type: "failed", code: "load-failed", message: "no such folder" });
    await expect(done).rejects.toMatchObject({ code: "load-failed" });
  });

  it("cancels in the worker on abort, at once, and drops what arrives after", async () => {
    const { host, workers } = harness();
    const controller = new AbortController();
    const seen: number[] = [];
    const done = host.translate(JOB, (index) => seen.push(index), controller.signal);
    controller.abort();
    await expect(done).rejects.toMatchObject({ code: "aborted" });
    expect(workers[0]!.sent[1]).toMatchObject({ type: "cancel", request: 1 });
    workers[0]!.reply({ id: 1, type: "sentence", index: 0, text: "late" });
    expect(seen).toEqual([]);
  });

  it("fails what was waiting when the worker stops, and starts another for the next one", async () => {
    const { host, workers } = harness();
    const first = host.translate(JOB, () => undefined, new AbortController().signal);
    workers[0]!.emit("exit", 1);
    await expect(first).rejects.toBeInstanceOf(NllbError);
    await expect(first).rejects.toMatchObject({ code: "no-worker" });
    void host.translate(JOB, () => undefined, new AbortController().signal).catch(() => undefined);
    expect(workers).toHaveLength(2);
  });

  it("ends the worker on dispose, failing what was waiting", async () => {
    const { host, workers } = harness();
    const waiting = host.translate(JOB, () => undefined, new AbortController().signal);
    host.dispose();
    await expect(waiting).rejects.toMatchObject({ code: "no-worker" });
    expect(workers[0]!.killed).toBe(true);
  });
});
