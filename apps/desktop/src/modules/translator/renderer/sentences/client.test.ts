import { describe, expect, it, vi } from "vitest";

import { SentenceTranslatorClient, SENTENCES_PER_BATCH, type Transport } from "./client.js";
import { IDLE_UNLOAD_MS, type IdleClock } from "./idle.js";
import type { WorkerReply, WorkerRequest } from "./protocol.js";

/**
 * The worker conversation without a worker: a transport the test answers from,
 * and a clock the test moves. What is pinned here is the part of the page's
 * behaviour that is not the engine — that the text is split into sentences
 * BEFORE anything is sent, that the sentences go in batches with progress
 * counted per batch, that the model is loaded once per direction, and that the
 * idle rule reaches the worker as an `unload` message.
 */

class FakeTransport implements Transport {
  readonly requests: WorkerRequest[] = [];
  terminated = false;
  /** Overridden per test that needs a failing worker; the default acks and echoes. */
  answer: (request: WorkerRequest) => WorkerReply = defaultAnswer;
  /** Runs synchronously inside `post`, for the tests that need to kill the worker mid-request. */
  onPost: ((request: WorkerRequest) => void) | null = null;
  private handlers: {
    reply: (reply: WorkerReply) => void;
    failed: (message: string) => void;
  } | null = null;

  post(request: WorkerRequest): void {
    this.requests.push(request);
    this.onPost?.(request);
    queueMicrotask(() => this.handlers?.reply(this.answer(request)));
  }

  subscribe(handlers: {
    reply: (reply: WorkerReply) => void;
    failed: (message: string) => void;
  }): void {
    this.handlers = handlers;
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Fails the connection the way a crashed worker does. */
  crash(message: string): void {
    this.handlers?.failed(message);
  }
}

function defaultAnswer(request: WorkerRequest): WorkerReply {
  if (request.kind === "translate") {
    return { id: request.id, kind: "translated", sentences: request.sentences.map((s) => `[${s}]`) };
  }
  return { id: request.id, kind: "ack" };
}

interface FakeClock extends IdleClock {
  advance(ms: number): void;
}

function fakeClock(): FakeClock {
  let now = 0;
  let serial = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    setTimer: (at, run) => {
      const id = ++serial;
      timers.set(id, { at, run });
      return () => timers.delete(id);
    },
    advance: (ms) => {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.run();
      }
    },
  };
}

const SR_EN = {
  direction: "sr-en" as const,
  packId: "translate-sr-en",
  model: "nx-pack://translate-sr-en/model.bin",
  shortlist: "nx-pack://translate-sr-en/shortlist.bin",
  vocab: "nx-pack://translate-sr-en/vocab.spm",
};

function setup() {
  const transport = new FakeTransport();
  const clock = fakeClock();
  const onUnloaded = vi.fn();
  const client = new SentenceTranslatorClient({
    createTransport: () => transport,
    clock,
    onUnloaded,
  });
  return { transport, clock, client, onUnloaded };
}

describe("SentenceTranslatorClient", () => {
  it("splits into sentences before batching, and counts progress per batch", async () => {
    const { transport, client } = setup();
    const progress: Array<[number, number]> = [];

    const result = await client.translate(
      "Jedan. Dva. Tri. Četiri. Pet.",
      "sr-en",
      SR_EN,
      (done, total) => progress.push([done, total]),
    );

    expect(result).toEqual({ text: "[Jedan.] [Dva.] [Tri.] [Četiri.] [Pet.]", sentences: 5 });
    // One load, then ceil(5 / SENTENCES_PER_BATCH) translate requests.
    expect(transport.requests.map((r) => r.kind)).toEqual(["load", "translate", "translate"]);
    const batches = transport.requests.filter((r) => r.kind === "translate");
    expect(batches[0]).toMatchObject({ sentences: ["Jedan.", "Dva.", "Tri.", "Četiri."] });
    expect(batches[1]).toMatchObject({ sentences: ["Pet."] });
    expect(SENTENCES_PER_BATCH).toBe(4);
    expect(progress).toEqual([
      [4, 5],
      [5, 5],
    ]);
  });

  it("keeps the paragraph breaks of the input", async () => {
    const { client } = setup();
    const result = await client.translate("Prva. Druga.\n\nTreća.", "sr-en", SR_EN);
    expect(result.text).toBe("[Prva.] [Druga.]\n\n[Treća.]");
  });

  it("loads the model once per direction and remembers it", async () => {
    const { transport, client } = setup();
    await client.translate("Prva.", "sr-en", SR_EN);
    expect(client.loadedDirection).toBe("sr-en");
    await client.translate("Druga.", "sr-en", SR_EN);
    expect(transport.requests.filter((r) => r.kind === "load")).toHaveLength(1);

    await client.translate("Third.", "en-sr", { ...SR_EN, direction: "en-sr" });
    expect(transport.requests.filter((r) => r.kind === "load")).toHaveLength(2);
    expect(client.loadedDirection).toBe("en-sr");
  });

  it("answers nothing for text with no sentence, and sends nothing", async () => {
    const { transport, client } = setup();
    expect(await client.translate("   \n\n  ", "sr-en", SR_EN)).toEqual({ text: "", sentences: 0 });
    expect(transport.requests).toEqual([]);
  });

  it("rejects on an error reply, naming the worker's own words", async () => {
    const { transport, client } = setup();
    transport.answer = (request) => ({ id: request.id, kind: "error", message: "nema modela" });
    await expect(client.translate("Prva.", "sr-en", SR_EN)).rejects.toThrow("nema modela");
  });

  it("rejects everything waiting when the worker dies", async () => {
    const { transport, client } = setup();
    transport.onPost = (request) => {
      if (request.kind === "load") transport.crash("worker je pao");
    };
    const waiting = client.translate("Prva. Druga.", "sr-en", SR_EN);
    await expect(waiting).rejects.toThrow("worker je pao");
  });

  it("unloads the model when the idle window passes, and forgets it", async () => {
    const { transport, clock, client, onUnloaded } = setup();
    await client.translate("Prva.", "sr-en", SR_EN);

    clock.advance(IDLE_UNLOAD_MS);
    expect(transport.requests.at(-1)).toMatchObject({ kind: "unload" });
    expect(client.loadedDirection).toBeNull();
    expect(onUnloaded).toHaveBeenCalledTimes(1);

    // The next translation loads it again rather than trusting the old state.
    await client.translate("Druga.", "sr-en", SR_EN);
    expect(transport.requests.filter((r) => r.kind === "load")).toHaveLength(2);
  });

  it("stops the worker on dispose, once", async () => {
    const { transport, client } = setup();
    client.dispose();
    client.dispose();
    expect(transport.terminated).toBe(true);
    await expect(client.translate("Prva.", "sr-en", SR_EN)).rejects.toThrow();
  });
});
