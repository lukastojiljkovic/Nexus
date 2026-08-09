// The shared Edge Function request primitives, exercised under plain Node.
//
// WHY THESE ARE TESTED AND THE ENDPOINTS ARE NOT. `_shared/http.ts` is where the
// controls live that have nothing to do with either endpoint's business: a body
// cap that must fail closed, an address reader a caller must not be able to
// steer, decoders that pin lengths. Every one of them has a wrong version that
// looks right — `Number.isFinite(n) && n > MAX` skips the check on malformed
// input, `hops[0]` reads the value the client wrote — and none of those wrong
// versions changes any endpoint's happy path. So they are the parts that need a
// test that fails, and they are pure functions, which is why this file can run
// them without Deno, Docker or a database.
//
// The module is TypeScript; Node ≥ 22.18 strips the annotations on import.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  callerAddress,
  decodeBounded,
  decodeFixed,
  declaredLengthOk,
  fromBrowsingContext,
  parseJsonObject,
  readBounded,
  sha256,
  toHex,
  toPgBytea,
  unverifiedClaims,
} from "../../functions/_shared/http.ts";

/** A request with headers and no body — everything but `readBounded` reads only these. */
function headersOnly(headers) {
  return new Request("https://nexus.test/f", { method: "POST", headers });
}

/** base64url of a JSON value, the way a JWT payload is encoded. */
function jwtSegment(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

// ---------------------------------------------------------------------------
// decodeFixed / decodeBounded
// ---------------------------------------------------------------------------
test("decodeFixed accepts both base64 alphabets and pins the length", () => {
  const bytes = Uint8Array.from([0xfb, 0xff, 0xbe, 0x01]);
  const standard = Buffer.from(bytes).toString("base64"); // contains + and /
  const url = Buffer.from(bytes).toString("base64url"); // contains - and _
  assert.notEqual(standard, url, "fixture must actually exercise both alphabets");

  assert.deepEqual(decodeFixed(standard, 4), bytes);
  assert.deepEqual(decodeFixed(url, 4), bytes);
});

test("decodeFixed refuses anything that is not exactly the expected length", () => {
  const three = Buffer.from([1, 2, 3]).toString("base64url");
  assert.equal(decodeFixed(three, 4), null);
  assert.equal(decodeFixed(three, 2), null);
  assert.deepEqual(decodeFixed(three, 3), Uint8Array.from([1, 2, 3]));
});

test("decodeFixed refuses non-strings, empties and absurd lengths", () => {
  assert.equal(decodeFixed(undefined, 4), null);
  assert.equal(decodeFixed(null, 4), null);
  assert.equal(decodeFixed(1234, 4), null);
  assert.equal(decodeFixed({}, 4), null);
  assert.equal(decodeFixed("", 4), null);
  assert.equal(decodeFixed("!!!!", 4), null, "not base64 at all");
  assert.equal(decodeFixed("A".repeat(5000), 4), null, "refused before decoding");
});

test("decodeBounded takes an inclusive range", () => {
  const b64 = (n) => Buffer.alloc(n, 7).toString("base64url");
  assert.equal(decodeBounded(b64(16), 17, 32), null);
  assert.equal(decodeBounded(b64(17), 17, 32)?.length, 17);
  assert.equal(decodeBounded(b64(32), 17, 32)?.length, 32);
  assert.equal(decodeBounded(b64(33), 17, 32), null);
});

// ---------------------------------------------------------------------------
// declaredLengthOk — the fail-closed guard
// ---------------------------------------------------------------------------
test("declaredLengthOk refuses a malformed content-length rather than skipping", () => {
  // THE REGRESSION THIS EXISTS FOR. `Number.isFinite(n) && n > MAX` answers
  // „fine" for every one of these, because NaN fails the first half — so the
  // guard declines to guard exactly when the caller is not being straightforward.
  // `0x10`, `0b11` and `1e9` are the JavaScript-literal half of it: `Number`
  // reads all three, HTTP reads none of them, and `0x10` is small enough to pass
  // any budget while describing a body no client ever sent.
  //
  // Surrounding whitespace is absent from this list on purpose — `Headers`
  // trims field values on the way in, so ` 12` is not a string this function can
  // be handed by any runtime, and asserting it would be testing the fixture.
  for (const declared of ["abc", "1e9", "12.5", "-1", "0x10", "0b11", "+5", "Infinity"]) {
    assert.equal(
      declaredLengthOk(headersOnly({ "content-length": declared }), 4096),
      false,
      `content-length: ${declared} must be refused`,
    );
  }
});

test("declaredLengthOk allows an absent, zero or within-budget length", () => {
  assert.equal(declaredLengthOk(headersOnly({}), 4096), true);
  assert.equal(declaredLengthOk(headersOnly({ "content-length": "0" }), 4096), true);
  assert.equal(declaredLengthOk(headersOnly({ "content-length": "4096" }), 4096), true);
  assert.equal(declaredLengthOk(headersOnly({ "content-length": "4097" }), 4096), false);
});

// ---------------------------------------------------------------------------
// readBounded — the control
// ---------------------------------------------------------------------------
/** A duck-typed request whose body is a stream we can watch for cancellation. */
function streamingRequest(chunks) {
  const state = { cancelled: false };
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { req: { body }, state };
}

test("readBounded returns the whole body when it fits", async () => {
  const { req } = streamingRequest(['{"a":', '1}']);
  assert.equal(await readBounded(req, 4096), '{"a":1}');
});

test("readBounded returns null and CANCELS the stream once the budget is spent", async () => {
  const { req, state } = streamingRequest(["x".repeat(40), "y".repeat(40), "z".repeat(40)]);
  assert.equal(await readBounded(req, 64), null);
  // `break` alone would leave the sender writing into a stream nobody reads —
  // the same transfer this limit exists to refuse, with the cost on the socket.
  assert.equal(state.cancelled, true, "the stream must be cancelled, not abandoned");
});

test("readBounded treats a bodyless request as an empty body", async () => {
  assert.equal(await readBounded({ body: null }, 4096), "");
});

test("readBounded returns null when the stream errors", async () => {
  const body = new ReadableStream({
    pull() {
      throw new Error("connection reset");
    },
  });
  assert.equal(await readBounded({ body }, 4096), null);
});

// ---------------------------------------------------------------------------
// parseJsonObject
// ---------------------------------------------------------------------------
test("parseJsonObject accepts objects and refuses everything else", () => {
  assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
  assert.equal(parseJsonObject("[1,2]"), null, "an array is not an object here");
  assert.equal(parseJsonObject("null"), null);
  assert.equal(parseJsonObject('"a string"'), null);
  assert.equal(parseJsonObject("7"), null);
  assert.equal(parseJsonObject("{"), null);
  assert.equal(parseJsonObject(""), null);
});

// ---------------------------------------------------------------------------
// callerAddress — the header the caller cannot steer
// ---------------------------------------------------------------------------
test("callerAddress prefers cf-connecting-ip", () => {
  const req = headersOnly({
    "cf-connecting-ip": "198.51.100.7",
    "x-forwarded-for": "203.0.113.1, 10.0.0.1",
  });
  assert.equal(callerAddress(req), "198.51.100.7");
});

test("callerAddress reads the RIGHTMOST forwarded hop, not the client's own value", () => {
  // THE BUG THIS PINS. `hops[0]` is whatever the caller wrote, so a fresh value
  // per request yields a fresh rate-limit bucket per request and the limiter
  // stops limiting — while still running, still writing rows, still returning
  // true. Here the attacker claims 203.0.113.9; the trusted proxy appended
  // 10.0.0.1, and that is the answer.
  const req = headersOnly({ "x-forwarded-for": "203.0.113.9, 192.0.2.5, 10.0.0.1" });
  assert.equal(callerAddress(req), "10.0.0.1");
});

test("callerAddress falls back to one shared bucket, never to no bucket", () => {
  assert.equal(callerAddress(headersOnly({})), "unknown");
  assert.equal(callerAddress(headersOnly({ "cf-connecting-ip": "   " })), "unknown");
  assert.equal(callerAddress(headersOnly({ "x-forwarded-for": " , ," })), "unknown");
});

// ---------------------------------------------------------------------------
// fromBrowsingContext
// ---------------------------------------------------------------------------
test("fromBrowsingContext refuses anything carrying an Origin", () => {
  assert.equal(fromBrowsingContext(headersOnly({ origin: "https://evil.example" })), true);
  // A sandboxed or redirected page sends the literal string „null"; it is still
  // a browsing context and still refused.
  assert.equal(fromBrowsingContext(headersOnly({ origin: "null" })), true);
  assert.equal(fromBrowsingContext(headersOnly({})), false, "a server-to-server fetch");
});

// ---------------------------------------------------------------------------
// unverifiedClaims
// ---------------------------------------------------------------------------
test("unverifiedClaims reads sub, session_id and exp out of a JWT payload", () => {
  const token = [
    jwtSegment({ alg: "HS256" }),
    jwtSegment({ sub: "user-1", session_id: "sess-1", exp: 4102444800 }),
    "signature",
  ].join(".");
  assert.deepEqual(unverifiedClaims(token), {
    sub: "user-1",
    sessionId: "sess-1",
    exp: 4102444800,
  });
});

test("unverifiedClaims reports missing members as null rather than throwing", () => {
  // The anon key is a JWT with no `session_id` — this is the shape the cheap
  // pre-filter in `sync-enable` uses to drop it before spending a round trip.
  const anonShaped = [jwtSegment({ alg: "HS256" }), jwtSegment({ role: "anon" }), "sig"].join(".");
  assert.deepEqual(unverifiedClaims(anonShaped), { sub: null, sessionId: null, exp: null });

  const stringExp = [jwtSegment({}), jwtSegment({ sub: "u", exp: "soon" }), "sig"].join(".");
  assert.equal(unverifiedClaims(stringExp)?.exp, null);

  const emptySub = [jwtSegment({}), jwtSegment({ sub: "" }), "sig"].join(".");
  assert.equal(unverifiedClaims(emptySub)?.sub, null);
});

test("unverifiedClaims refuses anything that is not a three-part JWT with a JSON object payload", () => {
  assert.equal(unverifiedClaims(""), null);
  assert.equal(unverifiedClaims("only.two"), null);
  assert.equal(unverifiedClaims("a.b.c.d"), null);
  assert.equal(unverifiedClaims(`${jwtSegment({})}.!!!.sig`), null);
  assert.equal(unverifiedClaims(`${jwtSegment({})}.${jwtSegment([1, 2])}.sig`), null);
  assert.equal(unverifiedClaims(`${jwtSegment({})}.${jwtSegment("x")}.sig`), null);
});

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------
test("toPgBytea produces the hex literal PostgREST casts to bytea", () => {
  assert.equal(toPgBytea(Uint8Array.from([0x00, 0x0a, 0xff])), "\\x000aff");
  assert.equal(toPgBytea(new Uint8Array(0)), "\\x");
  assert.equal(toHex(Uint8Array.from([1, 255])), "01ff");
});

test("sha256 concatenates its parts before digesting", async () => {
  const split = await sha256(Uint8Array.from([1, 2]), Uint8Array.from([3]));
  const whole = await sha256(Uint8Array.from([1, 2, 3]));
  assert.deepEqual(split, whole);
  // Against a known vector, so „both sides are equally wrong" cannot pass.
  const abc = await sha256(new TextEncoder().encode("abc"));
  assert.equal(
    toHex(abc),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
