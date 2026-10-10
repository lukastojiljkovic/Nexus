/**
 * The page's half of the worker conversation: split, batch, translate, and let
 * the model go when nobody is using it.
 *
 * **Split before batching, and the batch is what progress counts.** The reader's
 * text becomes sentences here (`splitParagraphs`), the sentences are sent in
 * batches of `SENTENCES_PER_BATCH`, and every finished batch reports how many
 * sentences are done out of how many there are. A batch is small on purpose: a
 * pasted page shows its first translated lines in a second rather than after a
 * minute, and the engine packs its own mini-batches underneath anyway.
 *
 * **One request in flight, in order.** Calls are chained internally, so a page
 * that types faster than the engine translates cannot interleave two batches
 * through one worker. The page-level answer to that is debouncing (a keystroke
 * restarts the timer); this is the backstop that makes the worker's own state
 * (which model is loaded) a fact rather than a race.
 *
 * **The model is loaded once per direction and released on idle** (`idle.ts`),
 * and the load is remembered HERE rather than guessed from a reply, so a second
 * translation of the same direction costs no reload. A direction change loads
 * the new model; the worker drops the old one as its own load replaces it.
 *
 * Both the transport (the Worker) and the clock are injected, which is what lets
 * the batching, the progress and the unload be tested without a browser, a
 * worker or a real minute passing.
 */

import type { Direction, ModelUrls } from "./models.js";
import { createIdleUnload, type IdleClock, type IdleUnload } from "./idle.js";
import type { WorkerReply, WorkerRequest, WorkerRequestPayload } from "./protocol.js";
import { splitParagraphs } from "./split.js";

/**
 * Sentences per request. Four is the point where a long text starts answering
 * before the reader gives up watching, and where a batch is still big enough for
 * the engine's own packing to have something to do — the two costs this number
 * trades are "first line on screen" and "requests barely bigger than one".
 */
export const SENTENCES_PER_BATCH = 4;

/** What the client needs of the worker: post, listen, stop. `Worker` satisfies it with one adapter line. */
export interface Transport {
  post(request: WorkerRequest): void;
  subscribe(handlers: {
    readonly reply: (reply: WorkerReply) => void;
    readonly failed: (message: string) => void;
  }): void;
  terminate(): void;
}

/** One translation's outcome. `sentences` is what progress was counted in. */
export interface TranslateResult {
  readonly text: string;
  readonly sentences: number;
}

export interface ClientDeps {
  readonly createTransport: () => Transport;
  readonly clock: IdleClock;
  /** Called when the idle rule released the model, so the page can drop its own "loaded" idea of it. */
  readonly onUnloaded?: () => void;
}

interface Pending {
  readonly accept: (reply: WorkerReply) => void;
  readonly reject: (error: Error) => void;
}

export class SentenceTranslatorClient {
  private readonly transport: Transport;
  private readonly idle: IdleUnload;
  private readonly pending = new Map<number, Pending>();
  private readonly onUnloaded: (() => void) | undefined;
  private serial = 0;
  private loaded: Direction | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(deps: ClientDeps) {
    this.transport = deps.createTransport();
    this.onUnloaded = deps.onUnloaded;
    this.idle = createIdleUnload(deps.clock, () => {
      // The unload is fire-and-forget: the timer's whole job is to give the
      // memory back, and nothing waits on the acknowledgement. The loaded
      // direction is forgotten first, because a translation that arrives while
      // the worker is releasing the model must load it again rather than trust
      // a reply that is now about a model that is gone.
      this.loaded = null;
      if (this.disposed) return;
      this.transport.post({ id: ++this.serial, kind: "unload" });
      this.onUnloaded?.();
    });
    this.transport.subscribe({
      reply: (reply) => this.settle(reply),
      failed: (message) => this.failAll(message),
    });
  }

  /** Which model the worker holds right now, as this side last established it. */
  get loadedDirection(): Direction | null {
    return this.loaded;
  }

  /**
   * Translates `text` in `direction`, loading the model first when this side
   * does not already hold that direction.
   *
   * Paragraph breaks are kept: each paragraph's sentences are translated in
   * order and the paragraphs are joined with a blank line, so the answer reads
   * like the question.
   */
  translate(
    text: string,
    direction: Direction,
    urls: ModelUrls,
    onProgress?: (done: number, total: number) => void,
  ): Promise<TranslateResult> {
    const run = this.chain.then(
      () => this.run(text, direction, urls, onProgress),
      () => this.run(text, direction, urls, onProgress),
    );
    // The chain must not carry a rejection forward, or one failed translation
    // would poison every later one; the caller still receives the rejection.
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Stops the idle timer and the worker. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.idle.stop();
    this.failAll("the translator was closed");
    this.transport.terminate();
  }

  private async run(
    text: string,
    direction: Direction,
    urls: ModelUrls,
    onProgress?: (done: number, total: number) => void,
  ): Promise<TranslateResult> {
    if (this.disposed) throw new Error("the translator was closed");
    const paragraphs = splitParagraphs(text);
    const total = paragraphs.reduce((count, sentences) => count + sentences.length, 0);
    if (total === 0) return { text: "", sentences: 0 };

    if (this.loaded !== direction) {
      await this.request({ kind: "load", direction, urls });
      this.loaded = direction;
    }
    this.idle.touch();

    let done = 0;
    const translated: string[][] = [];
    for (const sentences of paragraphs) {
      const paragraph: string[] = [];
      for (let at = 0; at < sentences.length; at += SENTENCES_PER_BATCH) {
        const batch = sentences.slice(at, at + SENTENCES_PER_BATCH);
        const reply = await this.request({ kind: "translate", direction, sentences: batch });
        if (reply.kind !== "translated") throw new Error("the translation worker answered the wrong shape");
        paragraph.push(...reply.sentences);
        done += batch.length;
        // Touched per batch rather than per translation: the model is in use
        // until the last batch of this text is answered.
        this.idle.touch();
        onProgress?.(Math.min(done, total), total);
      }
      translated.push(paragraph);
    }
    return { text: translated.map((paragraph) => paragraph.join(" ")).join("\n\n"), sentences: total };
  }

  /** Sends one request and waits for the reply that carries its id. */
  private request(request: WorkerRequestPayload): Promise<WorkerReply> {
    return new Promise<WorkerReply>((accept, reject) => {
      const id = ++this.serial;
      this.pending.set(id, { accept, reject });
      try {
        this.transport.post({ ...request, id });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private settle(reply: WorkerReply): void {
    const pending = this.pending.get(reply.id);
    if (pending === undefined) return;
    this.pending.delete(reply.id);
    if (reply.kind === "error") pending.reject(new Error(reply.message));
    else pending.accept(reply);
  }

  /** Fails every waiting caller — a worker that died has answered nobody. */
  private failAll(message: string): void {
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const pending of waiting) pending.reject(new Error(message));
  }
}
