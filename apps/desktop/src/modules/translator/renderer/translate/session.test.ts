import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TranslationView } from "../../shared/ipc.js";
import {
  POLL_MS,
  TRANSLATE_DEBOUNCE_MS,
  TranslationSession,
  type SessionRequest,
  type SessionView,
} from "./session.js";

/**
 * The page's translate timing, against fake timers and a fake API.
 *
 * The session is the one unit that decides WHEN to ask main, so it is tested by
 * the clock: the debounce, the polling, a change that replaces a running job, the
 * same-language and empty cases, unmounting, and each way a translation can stop.
 */

const REQUEST: SessionRequest = {
  packId: "nllb-600m",
  text: "Good day. How are you?",
  source: "eng_Latn",
  target: "srp_Cyrl",
};

function view(overrides: Partial<TranslationView> = {}): TranslationView {
  return { text: "", translated: 0, total: 2, done: false, error: null, ...overrides };
}

/** An API that numbers its jobs, answers polls with `translation`'s queued answers, and records every call. */
function fakeApi() {
  let jobs = 0;
  return {
    translate: vi.fn(async (_payload: SessionRequest) => ({ jobId: `job-${String((jobs += 1))}` })),
    translation: vi.fn(async (_payload: { jobId: string }) => view()),
    cancelTranslation: vi.fn(async (_payload: { jobId: string }) => null),
  };
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("TranslationSession", () => {
  let shown: SessionView[];
  let api: ReturnType<typeof fakeApi>;
  let session: TranslationSession;

  beforeEach(() => {
    vi.useFakeTimers();
    shown = [];
    api = fakeApi();
    session = new TranslationSession(api, (next) => shown.push(next));
  });

  afterEach(() => {
    session.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("waits for the debounce after the last change, then asks once with that change", async () => {
    session.update({ ...REQUEST, text: "Good" });
    await advance(TRANSLATE_DEBOUNCE_MS - 100);
    session.update(REQUEST);
    await advance(TRANSLATE_DEBOUNCE_MS - 1);
    expect(api.translate).not.toHaveBeenCalled();
    await advance(1);
    expect(api.translate).toHaveBeenCalledTimes(1);
    expect(api.translate).toHaveBeenCalledWith(REQUEST);
  });

  it("polls the job until it is done, and shows the text as it grows", async () => {
    api.translation
      .mockResolvedValueOnce(view({ text: "Dobar dan. ", translated: 1 }))
      .mockResolvedValueOnce(view({ text: "Dobar dan. Kako ste?", translated: 2, done: true }));
    session.update(REQUEST);
    await advance(TRANSLATE_DEBOUNCE_MS + POLL_MS);
    expect(shown.at(-1)).toEqual({ kind: "translating", text: "Dobar dan. ", translated: 1, total: 2 });
    await advance(POLL_MS);
    expect(shown.at(-1)).toEqual({ kind: "done", text: "Dobar dan. Kako ste?" });
    expect(api.translation).toHaveBeenCalledTimes(2);
    expect(api.translation).toHaveBeenLastCalledWith({ jobId: "job-1" });

    // A finished job is not cancelled: main has nothing running to stop.
    session.dispose();
    expect(api.cancelTranslation).not.toHaveBeenCalled();
  });

  it("stops polling a running job when the request changes, and the next request starts its own", async () => {
    api.translation.mockResolvedValue(view({ text: "Dobar", translated: 1 }));
    session.update(REQUEST);
    await advance(TRANSLATE_DEBOUNCE_MS + POLL_MS);
    const polls = api.translation.mock.calls.length;

    session.update({ ...REQUEST, text: "Good morning." });
    await advance(TRANSLATE_DEBOUNCE_MS - 100);
    expect(api.translation).toHaveBeenCalledTimes(polls);

    await advance(100);
    expect(api.translate).toHaveBeenCalledTimes(2);
    expect(api.translate).toHaveBeenLastCalledWith({ ...REQUEST, text: "Good morning." });
  });

  it("makes no call for the same language, and says so", async () => {
    session.update({ ...REQUEST, target: REQUEST.source });
    await advance(TRANSLATE_DEBOUNCE_MS * 2);
    expect(api.translate).not.toHaveBeenCalled();
    expect(shown).toEqual([{ kind: "same-language" }]);
  });

  it("makes no call for an empty text, and shows nothing", async () => {
    session.update({ ...REQUEST, text: "   " });
    await advance(TRANSLATE_DEBOUNCE_MS * 2);
    session.update(null);
    expect(api.translate).not.toHaveBeenCalled();
    expect(shown).toEqual([{ kind: "idle" }, { kind: "idle" }]);
  });

  it("cancels the running job and stops polling when it is disposed", async () => {
    api.translation.mockResolvedValue(view({ text: "Dobar", translated: 1 }));
    session.update(REQUEST);
    await advance(TRANSLATE_DEBOUNCE_MS + POLL_MS);
    session.dispose();
    expect(api.cancelTranslation).toHaveBeenCalledWith({ jobId: "job-1" });

    const polls = api.translation.mock.calls.length;
    await advance(POLL_MS * 10);
    expect(api.translation).toHaveBeenCalledTimes(polls);
  });

  it("shows the translate failure when the translation cannot start", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    api.translate.mockRejectedValueOnce(new Error("refused"));
    session.update(REQUEST);
    await advance(TRANSLATE_DEBOUNCE_MS);
    expect(shown.at(-1)).toEqual({ kind: "failed", reason: "translate-failed", text: "" });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("shows the translate failure when a poll cannot be read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    api.translation.mockRejectedValueOnce(new Error("replaced"));
    session.update(REQUEST);
    await advance(TRANSLATE_DEBOUNCE_MS + POLL_MS);
    expect(shown.at(-1)).toEqual({ kind: "failed", reason: "translate-failed", text: "" });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("shows the model's load failure as its own line", async () => {
    api.translation.mockResolvedValueOnce(view({ error: "load-failed", done: true }));
    session.update(REQUEST);
    await advance(TRANSLATE_DEBOUNCE_MS + POLL_MS);
    expect(shown.at(-1)).toEqual({ kind: "failed", reason: "load-failed", text: "" });
  });

  it("keeps the text done so far when the translation stops part way", async () => {
    api.translation.mockResolvedValueOnce(view({ text: "Dobar dan. ", translated: 1, done: true, error: "translate-failed" }));
    session.update(REQUEST);
    await advance(TRANSLATE_DEBOUNCE_MS + POLL_MS);
    expect(shown.at(-1)).toEqual({ kind: "failed", reason: "translate-failed", text: "Dobar dan. " });
  });

  it("shows nothing for a translation that was aborted, because it was replaced or cancelled", async () => {
    api.translation.mockResolvedValueOnce(view({ error: "aborted", done: true }));
    session.update(REQUEST);
    await advance(TRANSLATE_DEBOUNCE_MS + POLL_MS);
    expect(shown.at(-1)).toEqual({ kind: "idle" });
  });
});
