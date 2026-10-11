import { describe, expect, it } from "vitest";
import { createPdfWorker, type PdfWorkerLike } from "./workerClient.js";
import type { PdfJob, PdfReply } from "./protocol.js";

/**
 * The job protocol between the page and its worker, driven through a fake.
 *
 * What has a right and a wrong answer here is not pdf-lib — that is
 * `operations.test.ts` — but the pairing: which promise a reply settles, what a
 * progress message does, and what happens to jobs that are still in flight when
 * the worker goes away. `preload/moduleBridge.test.ts` drives its bridge through
 * the same kind of fake, for the same reason.
 */

/** A worker that records what it was asked to do and answers on command. */
function fakeWorker(): PdfWorkerLike & {
  readonly jobs: PdfJob[];
  reply(message: PdfReply): void;
  terminated: boolean;
} {
  const listeners: ((event: MessageEvent) => void)[] = [];
  return {
    jobs: [],
    terminated: false,
    postMessage(message: unknown): void {
      this.jobs.push(message as PdfJob);
    },
    addEventListener(_type: "message", listener: (event: MessageEvent) => void): void {
      listeners.push(listener);
    },
    terminate(): void {
      this.terminated = true;
    },
    reply(message: PdfReply): void {
      for (const listener of listeners) listener({ data: message } as MessageEvent);
    },
  };
}

describe("createPdfWorker", () => {
  it("pairs a reply with the job it names, and gives every job its own id", async () => {
    const worker = fakeWorker();
    const runner = createPdfWorker(() => worker);
    const first = runner.run("inspect", { source: { name: "a.pdf", bytes: new Uint8Array(1) } });
    const second = runner.run("split", { source: { name: "a.pdf", bytes: new Uint8Array(1) }, parts: [[1]] });
    expect(worker.jobs.map((job) => job.id)).toEqual([1, 2]);

    // Answered out of order, which is exactly the case the id exists for.
    worker.reply({ id: 2, status: "ok", value: [{ name: "a-1.pdf", bytes: new Uint8Array(2) }] });
    worker.reply({
      id: 1,
      status: "ok",
      value: { pageCount: 3, pages: [{ width: 100, height: 200, rotation: 0 }] },
    });
    expect(await second).toEqual([{ name: "a-1.pdf", bytes: new Uint8Array(2) }]);
    expect(await first).toEqual({ pageCount: 3, pages: [{ width: 100, height: 200, rotation: 0 }] });
  });

  it("reports progress without settling the promise", async () => {
    const worker = fakeWorker();
    const runner = createPdfWorker(() => worker);
    const steps: string[] = [];
    const done = runner.run(
      "merge",
      { sources: [{ name: "a.pdf", bytes: new Uint8Array(1) }] },
      (at, total) => steps.push(`${at}/${total}`),
    );
    worker.reply({ id: 1, status: "progress", done: 1, total: 2 });
    worker.reply({ id: 1, status: "progress", done: 2, total: 2 });
    expect(steps).toEqual(["1/2", "2/2"]);
    worker.reply({ id: 1, status: "ok", value: new Uint8Array(4) });
    expect(await done).toEqual(new Uint8Array(4));
  });

  it("rejects with the worker's own message when a job fails", async () => {
    const worker = fakeWorker();
    const runner = createPdfWorker(() => worker);
    const failed = runner.run("inspect", { source: { name: "a.pdf", bytes: new Uint8Array(1) } });
    worker.reply({ id: 1, status: "failed", reason: "encrypted", message: "This PDF is password-protected." });
    await expect(failed).rejects.toThrow("This PDF is password-protected.");
  });

  it("ignores a reply that names no job it is waiting for", async () => {
    const worker = fakeWorker();
    const runner = createPdfWorker(() => worker);
    worker.reply({ id: 99, status: "ok", value: new Uint8Array(1) });
    const job = runner.run("inspect", { source: { name: "a.pdf", bytes: new Uint8Array(1) } });
    worker.reply({ id: 1, status: "ok", value: { pageCount: 0, pages: [] } });
    expect(await job).toEqual({ pageCount: 0, pages: [] });
  });

  it("creates the worker lazily, once, and rejects what it still owed on dispose", async () => {
    const worker = fakeWorker();
    let spawned = 0;
    const runner = createPdfWorker(() => {
      spawned += 1;
      return worker;
    });
    expect(spawned).toBe(0);
    const first = runner.run("inspect", { source: { name: "a.pdf", bytes: new Uint8Array(1) } });
    const second = runner.run("inspect", { source: { name: "b.pdf", bytes: new Uint8Array(1) } });
    expect(spawned).toBe(1);
    runner.dispose();
    expect(worker.terminated).toBe(true);
    await expect(first).rejects.toThrow("The worker was terminated.");
    await expect(second).rejects.toThrow("The worker was terminated.");
  });
});
