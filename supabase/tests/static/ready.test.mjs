// The live suites' readiness gate, exercised against a server that is not
// Supabase.
//
// WHY IT LIVES HERE rather than beside the module it tests. `ready.mjs` is a
// live-suite helper, but the thing worth proving about it needs no Docker, no
// Deno and no database — only a socket that answers wrongly on demand, which is
// the one thing a real stack will not do to order. So it sits in `static/`,
// where `pnpm test` runs it on every push, instead of in `live/`, where it would
// only ever run inside the `database` job that this gate exists to keep green.
//
// AND WHY IT IS TESTED AT ALL. A wait loop is the shape of code that looks right
// while doing nothing: `while (!ready) retry` with a readiness test that is
// always true is indistinguishable from a working gate on a stack that was warm
// anyway — which is every stack, on every run but the one that fails. The
// assertion that matters is not that it eventually returns. It is that it
// refuses the two answers a careless version would accept: the runtime's empty
// 503, and the function's OWN 503, which is a real fault the suites must keep
// catching.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { awaitFunctions, probeFunction } from "../live/ready.mjs";

const ANON = "anon-key-that-is-not-a-secret";

/** The answer a booted function gives a GET: the first line of every endpoint. */
const BOOTED = { status: 400, body: '{"error":"bad_request","detail":"POST only"}' };
/** The runtime's answer while it is still building a worker. */
const BOOTING = { status: 503, body: "" };
/** The FUNCTION's own 503 — a server that cannot read its own configuration. */
const UNAVAILABLE = { status: 503, body: '{"error":"unavailable"}' };

const servers = [];

after(() => {
  for (const server of servers) server.close();
});

/**
 * A stack whose answers are scripted per function name. Each entry is consumed
 * in order; the last one repeats, so a test can say „503 twice, then booted" or
 * „always 503" without counting requests.
 */
async function stack(script) {
  const seen = [];
  const server = createServer((req, res) => {
    const name = req.url.replace("/functions/v1/", "");
    seen.push({
      name,
      method: req.method,
      apikey: req.headers["apikey"],
      authorization: req.headers["authorization"],
    });
    const queue = script[name] ?? [BOOTED];
    const answer = queue.length > 1 ? queue.shift() : queue[0];
    res.writeHead(answer.status, { "content-type": "application/json" });
    res.end(answer.body);
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, seen };
}

test("returns as soon as the function itself answers, and probes once when it does", async () => {
  const { url, seen } = await stack({ "sync-enable": [BOOTED] });
  await awaitFunctions(url, ANON, ["sync-enable"]);
  assert.equal(seen.length, 1, "a warm stack must not be made to wait");
});

test("waits through the runtime's empty 503 — the defect this exists for", async () => {
  const { url, seen } = await stack({ "sync-enable": [BOOTING, BOOTING, BOOTING, BOOTED] });
  await awaitFunctions(url, ANON, ["sync-enable"], { intervalMs: 1 });
  assert.equal(seen.length, 4);
});

test("never accepts the function's own 503, which a retry-on-5xx would swallow", async () => {
  // `unavailable()` is what an endpoint answers when its service-role key or its
  // rate-limit salt is missing. It is a server running degraded, it is the exact
  // thing `supabase/tests/static/edge-http.test.mjs` and the live suites are for,
  // and a gate that treated „503" as „not up yet" would turn every one of those
  // failures into a ninety-second pause followed by the same red job.
  const { url } = await stack({ "sync-enable": [UNAVAILABLE] });
  await assert.rejects(
    () => awaitFunctions(url, ANON, ["sync-enable"], { deadlineMs: 0, intervalMs: 1 }),
    /unavailable/,
  );
});

test("gives up rather than hanging, naming the function and the last answer", async () => {
  const { url } = await stack({ "device-register": [BOOTING] });
  await assert.rejects(
    () => awaitFunctions(url, ANON, ["device-register"], { deadlineMs: 0, intervalMs: 1 }),
    (error) => {
      assert.match(error.message, /never served device-register/);
      assert.match(error.message, /empty body/);
      return true;
    },
  );
});

test("waits for each function it is given, not just the first", async () => {
  const { url, seen } = await stack({
    "sync-enable": [BOOTED],
    "device-register": [BOOTING, BOOTED],
  });
  await awaitFunctions(url, ANON, ["sync-enable", "device-register"], { intervalMs: 1 });
  assert.deepEqual(
    seen.map((r) => r.name),
    ["sync-enable", "device-register", "device-register"],
  );
});

test("probes with a GET carrying the anon key twice over, which is what reaches the handler", async () => {
  // `verify_jwt = true` on both endpoints, so a probe without a JWT is answered
  // by the platform's gate and boots nothing — the wait would then end on a
  // response no function produced. The anon key IS a JWT this project signed;
  // `apikey` is what the gateway routes on and `Authorization` is what the gate
  // reads. GET, because every endpoint refuses it on its first line, before it
  // reads a header, touches the database or provisions anything.
  const { url, seen } = await stack({ "sync-enable": [BOOTED] });
  await awaitFunctions(url, ANON, ["sync-enable"]);
  assert.deepEqual(seen[0], {
    name: "sync-enable",
    method: "GET",
    apikey: ANON,
    authorization: `Bearer ${ANON}`,
  });
});

test("treats a refused connection the same as a 503, so a stack coming up is one case", async () => {
  const server = createServer(() => {});
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));

  const { ready, saw } = await probeFunction(`http://127.0.0.1:${port}`, ANON, "sync-enable");
  assert.equal(ready, false);
  assert.match(saw, /no answer at all/);
});

test("does not read the platform's own refusal as the function answering", async () => {
  // The near miss, and the one a `status < 500` rule waves straight through.
  // `verify_jwt = true` means the gateway can refuse a probe BEFORE any worker
  // is built, and it refuses in JSON. So a parsed body is not the test, and
  // neither is a status under 500. Only the pair the endpoint itself produces
  // on its first line proves the module graph loaded and the handler ran.
  const gate = { status: 401, body: '{"code":401,"message":"Invalid JWT"}' };
  const { url } = await stack({ "sync-enable": [gate] });
  await assert.rejects(
    () => awaitFunctions(url, ANON, ["sync-enable"], { deadlineMs: 0, intervalMs: 1 }),
    /HTTP 401/,
  );
});

test("does not read a 404 as an answer, so a name that is wrong never reads as up", async () => {
  const missing = { status: 404, body: '{"error":"not_found"}' };
  const { url } = await stack({ "sync-enabl": [missing] });
  await assert.rejects(
    () => awaitFunctions(url, ANON, ["sync-enabl"], { deadlineMs: 0, intervalMs: 1 }),
    /never served sync-enabl:/,
  );
});

test("does not read a non-JSON body as an answer", async () => {
  // A gateway that is up while its upstream is not answers 200 with HTML often
  // enough to be worth refusing by shape rather than by status.
  const { url } = await stack({ "sync-enable": [{ status: 200, body: "<html>ok</html>" }] });
  await assert.rejects(
    () => awaitFunctions(url, ANON, ["sync-enable"], { deadlineMs: 0, intervalMs: 1 }),
    /HTTP 200/,
  );
});
