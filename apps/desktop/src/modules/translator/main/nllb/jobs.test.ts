import { afterEach, describe, expect, it, vi } from "vitest";

import { languageByCode } from "../../shared/languages.js";
import { NllbError, type NllbHost, type NllbJob } from "./host.js";
import { IDLE_UNLOAD_MS, TranslationJobs } from "./jobs.js";

const SERBIAN = languageByCode("srp_Cyrl")!;
const ENGLISH = languageByCode("eng_Latn")!;

/** A host whose translations a test finishes by hand. */
function fakeHost() {
  const calls: {
    job: NllbJob;
    onSentence: (index: number, text: string) => void;
    signal: AbortSignal;
    finish: () => void;
    fail: (error: unknown) => void;
  }[] = [];
  let disposals = 0;
  const host: NllbHost = {
    translate(job, onSentence, signal) {
      return new Promise<void>((resolve, reject) => {
        calls.push({ job, onSentence, signal, finish: resolve, fail: reject });
        signal.addEventListener("abort", () => reject(new NllbError("aborted", "cancelled.")), { once: true });
      });
    },
    dispose() {
      disposals += 1;
    },
  };
  return { host, calls, disposals: () => disposals };
}

function jobs(host: NllbHost) {
  let next = 0;
  return new TranslationJobs(() => host, () => `job-${String((next += 1))}`);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe("TranslationJobs", () => {
  it("sends the text as sentences and reads back the ones done, in the source's layout", async () => {
    const { host, calls } = fakeHost();
    const translations = jobs(host);
    const id = translations.start({
      directory: "dir",
      text: "Добар дан. Како сте?\n\nХвала.",
      source: SERBIAN,
      target: ENGLISH,
    });
    const call = calls[0]!;
    expect(call.job).toEqual({
      directory: "dir",
      sentences: ["Добар дан.", "Како сте?", "Хвала."],
      source: "srp_Cyrl",
      target: "eng_Latn",
    });
    call.onSentence(0, "Good day.");
    expect(translations.poll(id)).toEqual({ text: "Good day. ", translated: 1, total: 3, done: false, error: null });
    call.onSentence(1, "How are you?");
    call.onSentence(2, "Thank you.");
    call.finish();
    await settle();
    expect(translations.poll(id)).toEqual({
      text: "Good day. How are you?\n\nThank you.",
      translated: 3,
      total: 3,
      done: true,
      error: null,
    });
  });

  it("replaces a running translation with the next one, cancelling it and forgetting it", async () => {
    const { host, calls } = fakeHost();
    const translations = jobs(host);
    const first = translations.start({ directory: "dir", text: "Prva.", source: SERBIAN, target: ENGLISH });
    const second = translations.start({ directory: "dir", text: "Druga.", source: SERBIAN, target: ENGLISH });
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(() => translations.poll(first)).toThrow(/No translation/);
    expect(translations.poll(second).done).toBe(false);
  });

  it("states how a translation stopped, and cancels on request", async () => {
    const { host, calls } = fakeHost();
    const translations = jobs(host);
    const failed = translations.start({ directory: "dir", text: "Jedna.", source: SERBIAN, target: ENGLISH });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    calls[0]!.fail(new NllbError("load-failed", "the model did not load"));
    await settle();
    expect(translations.poll(failed)).toMatchObject({ done: true, error: "load-failed" });

    const cancelled = translations.start({ directory: "dir", text: "Druga.", source: SERBIAN, target: ENGLISH });
    translations.cancel(cancelled);
    await settle();
    expect(translations.poll(cancelled)).toMatchObject({ done: true, error: "aborted" });
  });

  it("ends the worker once the translator has been idle, and not while it works", async () => {
    vi.useFakeTimers();
    const { host, calls, disposals } = fakeHost();
    const translations = jobs(host);
    translations.start({ directory: "dir", text: "Jedna.", source: SERBIAN, target: ENGLISH });
    vi.advanceTimersByTime(IDLE_UNLOAD_MS * 2);
    expect(disposals()).toBe(0);
    calls[0]!.finish();
    await vi.advanceTimersByTimeAsync(IDLE_UNLOAD_MS - 1);
    expect(disposals()).toBe(0);
    // A new translation before the time is up keeps the model.
    translations.start({ directory: "dir", text: "Druga.", source: SERBIAN, target: ENGLISH });
    await vi.advanceTimersByTimeAsync(IDLE_UNLOAD_MS);
    expect(disposals()).toBe(0);
    calls[1]!.finish();
    await vi.advanceTimersByTimeAsync(IDLE_UNLOAD_MS);
    expect(disposals()).toBe(1);
  });
});
