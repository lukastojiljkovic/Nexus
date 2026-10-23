/**
 * The translation the page is waiting for, as main holds it.
 *
 * The kit has no push channel, so a translation is a job the page polls, as an
 * assistant turn is. There is one at a time: the page translates as the user
 * types, so a new text replaces the one before it, and the old one is cancelled
 * rather than finished for nobody.
 *
 * **The model leaves memory when the translator is idle.** The 3.3B model holds
 * gigabytes, so the worker is ended {@link IDLE_UNLOAD_MS} after the last
 * translation; the next one starts it and loads the model again.
 */

import type { NllbLanguage } from "../../shared/languages.js";
import type { TranslationView } from "../../shared/ipc.js";
import { NllbError, type NllbHost } from "./host.js";
import { joinSegments, segmentText, type Segmented } from "./segments.js";

/** Fifteen minutes: the assistant's default idle time for its own model (migration 98). */
export const IDLE_UNLOAD_MS = 15 * 60_000;

interface Job {
  readonly id: string;
  readonly controller: AbortController;
  readonly segmented: Segmented;
  readonly translated: string[];
  done: boolean;
  error: TranslationView["error"];
}

export interface TranslationInput {
  readonly directory: string;
  readonly text: string;
  readonly source: NllbLanguage;
  readonly target: NllbLanguage;
}

export class TranslationJobs {
  private current: Job | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly host: () => NllbHost,
    private readonly newId: () => string,
  ) {}

  start(input: TranslationInput): string {
    this.current?.controller.abort();
    this.disarm();
    const segmented = segmentText(input.text, input.source.bcp47);
    const job: Job = {
      id: this.newId(),
      controller: new AbortController(),
      segmented,
      translated: [],
      done: false,
      error: null,
    };
    this.current = job;
    const sentences = segmented.sentences.map((sentence) => sentence.text);
    void this.host()
      .translate(
        { directory: input.directory, sentences, source: input.source.code, target: input.target.code },
        (index, text) => {
          job.translated[index] = text;
        },
        job.controller.signal,
      )
      .catch((error: unknown) => {
        job.error = error instanceof NllbError ? error.code : "translate-failed";
        if (job.error !== "aborted") console.error("Nexus: the translation failed:", error);
      })
      .finally(() => {
        job.done = true;
        if (this.current === job) this.arm();
      });
    return job.id;
  }

  /** The job's translation so far: the sentences done from the start, in the source's layout. */
  poll(id: string): TranslationView {
    const job = this.job(id);
    let ready = 0;
    while (job.translated[ready] !== undefined) ready += 1;
    const head = { lead: job.segmented.lead, sentences: job.segmented.sentences.slice(0, ready) };
    return {
      text: joinSegments(head, job.translated),
      translated: ready,
      total: job.segmented.sentences.length,
      done: job.done,
      error: job.error,
    };
  }

  cancel(id: string): void {
    this.job(id).controller.abort();
  }

  private job(id: string): Job {
    if (this.current?.id !== id) throw new Error(`No translation "${id}" is running or waiting to be read.`);
    return this.current;
  }

  private arm(): void {
    this.idle = setTimeout(() => {
      this.idle = null;
      this.host().dispose();
    }, IDLE_UNLOAD_MS);
    this.idle.unref?.();
  }

  private disarm(): void {
    if (this.idle !== null) clearTimeout(this.idle);
    this.idle = null;
  }
}
