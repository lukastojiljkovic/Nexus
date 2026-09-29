/**
 * Main's half of „every exit waits for what the open editors owe" (DC-149).
 *
 * **Why main has to ask.** The renderer can flush ahead of a lock the RENDERER
 * starts — the lock button, the shortcut, the idle timer that lives in `App` —
 * because it knows the lock is coming. It cannot flush ahead of a lock main
 * starts itself: the private section's idle timer and its lock-on-minimize hook
 * run in main, on an OS event or a clock, before any renderer event could tell
 * an editor to write. Closing the window is the same — Electron emits the
 * window's `close` before the page's `beforeunload`, which is why main can ask
 * first and why a flush left to `beforeunload` was only ever best effort.
 *
 * So an exit main starts sends a request, the renderer flushes every open editor
 * and answers with the request's id, and the exit goes ahead. Nothing here
 * touches Electron: `send` is whatever delivers the request, which keeps the
 * protocol — ids, answers, the bound — testable without a window.
 *
 * **The wait is bounded.** A lock must never be refused, or held hostage, by a
 * renderer that is busy, hung or gone. Past `graceMs` the request resolves
 * anyway and the exit goes ahead; the cost of a renderer that never answers is
 * the grace and nothing else. And `request` never rejects, so no caller has to
 * remember that a failed ask must not stop the lock.
 */

export interface EditorFlush {
  /** Asks the renderer for what its open editors owe; resolves when it answers, or after the grace. Never rejects. */
  request(): Promise<void>;
  /** The renderer's answer to request `requestId`. An unknown or stale id is ignored. */
  acknowledge(requestId: number): void;
}

/**
 * `send` delivers request `requestId` to the renderer and answers `false` when
 * there is nobody to ask — no window, or one already destroyed.
 */
export function createEditorFlush(
  send: (requestId: number) => boolean,
  graceMs: number,
): EditorFlush {
  let lastId = 0;
  /** Requests waiting for their answer, each with the way to resolve it. */
  const pending = new Map<number, () => void>();

  return {
    request: () =>
      new Promise<void>((resolve) => {
        const requestId = ++lastId;
        let sent = false;
        try {
          sent = send(requestId);
        } catch (error) {
          console.error("Nexus: could not ask the window to flush its editors:", error);
        }
        if (!sent) {
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          pending.delete(requestId);
          resolve();
        }, graceMs);
        pending.set(requestId, () => {
          clearTimeout(timer);
          pending.delete(requestId);
          resolve();
        });
      }),
    acknowledge: (requestId) => {
      pending.get(requestId)?.();
    },
  };
}
