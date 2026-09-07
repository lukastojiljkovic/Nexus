// The precondition both live suites depend on, and which neither established:
// that the edge runtime can serve this project's functions at all.
//
// ─── WHAT WENT WRONG (2026-09-07, run 34160746105, `main`) ─────────────────
//
// `device-register`'s `before` hook enables sync for real, and that call was the
// FIRST request any function received in the job. It came back 503 with an EMPTY
// body, the hook threw `mint failed: ""`, and all ten of the suite's tests were
// cancelled — a red `database` job whose message named neither the runtime nor
// the boot. Every one of the twenty-four later calls succeeded, including the
// fourteen in `sync-enable.test.mjs` seconds afterwards.
//
// ─── THE RULE THAT WAS WRONG ───────────────────────────────────────────────
//
// Not „the runtime is flaky". It is that the suites treated „a function can be
// served" as something they could assume, so the request that discovered
// otherwise was an ASSERTION about a mint. `config.toml` sets
// `policy = "oneshot"`, so the runtime builds a worker per request, and the
// first one for a given function also populates the container's module cache —
// fetching that function's module graph over the network. That work is unbounded
// and has nothing to do with what either suite tests. It had been winning the
// race since the suites were written; on this run it lost.
//
// ─── THE DISCRIMINATOR ─────────────────────────────────────────────────────
//
// This is a bounded wait for one named condition and NOT a blanket „retry on
// 5xx", because a function's own 503 is a real failure this suite must keep
// catching: `unavailable()` in `_shared/http.ts` is what a server that cannot
// read its rate-limit salt or its service-role key answers, and it carries
// `{"error":"unavailable"}`. So readiness is stated positively — the runtime is
// ready when the FUNCTION answers — and the probe is a GET, which every endpoint
// refuses on its first line with `bad_request` before reading a header, touching
// the database or looking at `Origin`. Nothing else in the stack produces that
// pair, no account is provisioned and no row is written.
//
// The anon key is what makes the probe reach the handler: `verify_jwt = true` on
// both endpoints, and the anon key IS a JWT this project signed — `config.toml`
// says so at length, and says that is all that gate is worth.

import { setTimeout as sleep } from "node:timers/promises";

/** The probe's answer when — and only when — the function's own handler ran. */
const READY_STATUS = 400;
const READY_ERROR = "bad_request";

/** What the last attempt saw, in one line, for a timeout message. */
function describe(status, body) {
  const shown = body.length > 200 ? `${body.slice(0, 200)}…` : body;
  return `HTTP ${status} ${shown === "" ? "with an empty body" : `— ${shown}`}`;
}

/**
 * One probe. Returns `{ ready, saw }` rather than throwing: a connection refused
 * while the stack is still coming up is the same „not yet" as a 503, and making
 * the caller tell them apart would put the retry decision in two places.
 */
export async function probeFunction(urlBase, anonKey, name) {
  let response;
  try {
    response = await fetch(`${urlBase}/functions/v1/${name}`, {
      method: "GET",
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
  } catch (cause) {
    return { ready: false, saw: `no answer at all — ${cause?.message ?? String(cause)}` };
  }
  const body = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ready: false, saw: describe(response.status, body) };
  }
  const ready = response.status === READY_STATUS && parsed?.error === READY_ERROR;
  return { ready, saw: describe(response.status, body) };
}

/**
 * Waits until each named function answers for itself, or fails the suite with a
 * message that names the runtime instead of the mint.
 *
 * The deadline is generous because the cost being waited on is a network fetch
 * of a module graph on a cold runner, and bounded because a function that is
 * genuinely broken must fail the job rather than hang it — the message then
 * carries the last response verbatim, which is the thing this defect had to be
 * dug out of a log to learn.
 */
export async function awaitFunctions(urlBase, anonKey, names, options = {}) {
  const { deadlineMs = 90_000, intervalMs = 250 } = options;
  for (const name of names) {
    const startedAt = Date.now();
    let attempts = 0;
    for (;;) {
      attempts++;
      const { ready, saw } = await probeFunction(urlBase, anonKey, name);
      if (ready) break;
      if (Date.now() - startedAt >= deadlineMs) {
        throw new Error(
          `the edge runtime never served ${name}: ${attempts} probes over ` +
            `${Date.now() - startedAt}ms, last answer ${saw}. The suite below asserts ` +
            "on what this function RETURNS, so it cannot start until the function is the " +
            "one answering.",
        );
      }
      await sleep(intervalMs);
    }
  }
}
