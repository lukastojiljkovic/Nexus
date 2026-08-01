import { afterEach } from "vitest";

/**
 * One macrotask turn after every test in this package, which is what stops
 * `pnpm test` failing a fully green run.
 *
 * **The mechanism, established from vitest's own source.** Vitest 3.2.6 arms a
 * hardcoded 60 000 ms birpc timer for every `onTaskUpdate` RPC
 * (`vitest/dist/chunks/index.B521nVV-.js:3` `DEFAULT_TIMEOUT = 6e4`, armed at
 * `:56-59`), and clears it in exactly ONE place: the worker's own
 * `process.on("message")` handler (`:136`). So the deadline does not measure
 * „main was slow to reply" — it measures **„the worker never dispatched the
 * reply"**, and main's promptness is irrelevant to it.
 *
 * `@vitest/runner` issues those calls unawaited on a 100 ms throttle, parks them
 * in a module-level list, and only settles the batch at the END of the file
 * (`@vitest/runner/dist/chunk-hooks.js:1466-1480`, `:1822`). **The exposure
 * window is therefore one FILE.** Between two tests the runner yields only a
 * microtask, and a microtask never advances libuv past its own queue — so a
 * file made of back-to-back synchronous native SQLite work never reaches the
 * poll phase, the acks pile up unread, and any file whose wall time crosses
 * 60 s has its first update time out. The loop finally turns at file end, the
 * timers phase runs BEFORE the poll phase, the expired timer throws, and one
 * rejected promise turns a run with 1 933 passing tests red.
 *
 * An awaited `setImmediate` forces a full loop turn — poll (the message is
 * dispatched and the timer cleared), then check (this callback) — so no ack
 * waits longer than one test. That removes the only conjunct of the mechanism
 * that lives in this repository, and it removes it regardless of how long a file
 * grows: after this, file duration stops being a variable at all.
 *
 * **Why a hook and not a smaller test file.** `migrations.test.ts` is the only
 * file anywhere near the line (394 tests, 369 database opens, each replaying the
 * whole migration chain; 41–84 s depending on contention, and that spread WAS
 * the intermittency). Splitting it would push today's duration back under the
 * limit and leave the same trap armed for migration 070. This fixes the
 * property instead of the symptom.
 *
 * `setImmediate` is captured at module scope so a test calling
 * `vi.useFakeTimers()` cannot replace the reference this hook depends on.
 */
const yieldToEventLoop = globalThis.setImmediate;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    yieldToEventLoop(() => {
      resolve();
    });
  });
});
