/**
 * The editors that are open, and what every exit owes them (DC-149).
 *
 * **What the registry is for.** Three editors write behind the user's hand — the
 * two note editors and the canvas — each on a debounce of about 800 ms, so an
 * edit is on screen for that long before it is anywhere else. Every one of them
 * had exactly one guard for that window: a flush from an unmount cleanup or from
 * `beforeunload`. Both run AFTER the exit has torn down what the write needs —
 * the database an app lock closed, the key a private lock zeroed, the process a
 * close ended — so the guard held on navigation and on nothing else. The exits
 * the guard was written for were the only ones it covered.
 *
 * So an open editor registers what it owes here, and an exit does not tear
 * anything down until `flushOpenEditors` has answered. The rule is stated about
 * EXITS, not about editors, because a fourth editor should be covered by
 * registering and not by somebody remembering the list — and
 * `openEditors.test.ts` reads the sources to hold it to that.
 *
 * **Who asks.** The renderer's own exits — the app lock, the private section's
 * button, the panic shortcut — call `flushOpenEditors` themselves, before they
 * ask main to lock. Main's exits run before any renderer event could say so: the
 * private section's idle lock, lock-on-minimize, and closing the window. Those
 * send a request (`main/editorFlush.ts`) and `answerEditorFlushRequests` is what
 * answers it, once, for the whole app.
 *
 * **Why the wait is bounded.** A lock must never be held hostage by a write that
 * does not answer, so `flushOpenEditors` gives up after `EDITOR_FLUSH_GRACE_MS`
 * and the exit goes ahead. It is the same bound main puts on its own wait, on
 * purpose: whichever side runs out first, the exit is late by the grace and no
 * more.
 *
 * **Why a failure is not reported here.** A write that failed is its editor's to
 * say — `OwedWrites` carries it and the editor's save line and exit banner
 * report it — and this module cannot say it better, because it never sees what
 * was written. It only waits for the answer, whichever it is, so `flushOpenEditors`
 * never rejects and a lock never has to wonder whether a failed write should stop
 * it.
 */

import { EDITOR_FLUSH_GRACE_MS } from "../../shared/ipc.js";

/** Each open editor's flush. A `Set`, so an unregister cannot remove a neighbour's. */
const openEditors = new Set<() => Promise<void>>();

/** Registers an open write-behind editor's flush; returns the unregister. `flush` resolves once the write it asks for has answered. */
export function registerOpenEditor(flush: () => Promise<void>): () => void {
  openEditors.add(flush);
  return () => {
    openEditors.delete(flush);
  };
}

/** Sends what every open editor owes and resolves once every write has answered, or after `EDITOR_FLUSH_GRACE_MS`, whichever is first. Never rejects: a failed write is its editor's to report. */
export function flushOpenEditors(): Promise<void> {
  const flushes = [...openEditors];
  if (flushes.length === 0) return Promise.resolve();
  // Through `then`, so a flush that throws before it returns a promise is a
  // rejection like any other, and `allSettled` swallows both.
  const answered = Promise.allSettled(flushes.map((flush) => Promise.resolve().then(flush)));
  return new Promise<void>((resolve) => {
    const grace = setTimeout(resolve, EDITOR_FLUSH_GRACE_MS);
    void answered.then(() => {
      clearTimeout(grace);
      resolve();
    });
  });
}

/** Answers main's flush requests for the app's lifetime (`App` mounts it once). Returns the unsubscribe. */
export function answerEditorFlushRequests(): () => void {
  return window.nexus.onEditorsFlushRequested((requestId) => {
    void flushOpenEditors()
      .then(() => window.nexus.editorsFlushed(requestId))
      .catch((error: unknown) => {
        console.error("Nexus: could not answer the request to flush the open editors:", error);
      });
  });
}
