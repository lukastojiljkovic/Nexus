// THE INVARIANT: this endpoint converts proof that a device finished the pairing
// handshake — a 256-bit token it could only have obtained by decrypting the
// initiator's sealed payload — into exactly one desktop session, exactly once,
// and it will never convert anything derived from the pairing code itself.
//
// Read that sentence twice, because every rule below is a consequence of it and
// nothing below is allowed to contradict it.
//
// WHY THE DISTINCTION BETWEEN THE TOKEN AND THE CODE IS THE WHOLE FUNCTION. The
// pairing code is thirteen Crockford-base32 characters — about 65 bits. It is
// typed by a human, so it cannot be longer, and 65 bits is a number a determined
// party with a rented cluster can search, especially the party that operates this
// database and can read `pairing.code_id` at leisure. If a session could be
// obtained by presenting the code, or a hash of it, or anything computable from
// it, then that search would be an account takeover. It cannot be, because the
// only thing this endpoint accepts is a value the initiator generated at random
// and sealed under the ECDH secret: to hold it you must have completed the
// handshake, and to complete the handshake you must have been the peer.
//
// WHY THIS FUNCTION EXISTS AT ALL, rather than the desktop calling PostgREST. At
// the moment of the first pairing the desktop has no session — that is the
// problem being solved — so it cannot authenticate to anything. Something with
// authority has to vouch for it, and that something has to hold a service-role
// key. This is that something, and it is the ONLY place in the entire system
// where a service-role key exists. A service-role key bypasses row level
// security completely; it is the one credential for which every wall in
// `migrations/` is transparent. It lives in one function's environment, is
// never returned in a response, never logged, and never reaches a client.
//
// WHAT THIS FUNCTION DELIBERATELY DOES NOT DO. It does not decide whether the
// pairing was legitimate. It cannot: it never sees the handshake secret and
// cannot open the sealed payload. Consent is a separate, human act performed in
// the desktop MAIN process behind the account passcode, showing the peer's
// device name and the account email this endpoint attests to. This endpoint
// answers one narrow question — „did the caller complete the handshake" — and
// the answer to „should this pairing happen at all" belongs to the human.

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Configuration.
// ---------------------------------------------------------------------------
// Every one of these is read from the environment and none has a default. A
// default here would be a credential in a repository or, worse, a working
// deployment that silently skipped a control — a rate-limit salt with a fallback
// value is a rate-limit salt that is public.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
// Salts the caller-address digest before it is written to
// `private.pair_rate_limit`. Without it the rate-limit table is an IP log: the
// address space is small enough to enumerate, so an unsalted hash is a
// reversible one, and this database's operator is assumed hostile.
const RATE_SALT = Deno.env.get("NEXUS_PAIR_RATE_SALT");

// Per-address: enough for a human retrying a typo and a flaky network, far too
// few to be worth using as an amplifier.
const RATE_LIMIT_PER_ADDRESS = 10;
const RATE_WINDOW = "00:10:00";
// Per-token: a completion token is single-use, so a SECOND presentation is
// already anomalous and a third has no honest explanation. Kept above one only
// because a response can be lost in flight and an honest desktop will retry.
const RATE_LIMIT_PER_TOKEN = 3;

// A completion request is a handful of fixed-size fields; anything larger is not
// a pairing. The cheapest denial-of-service against any JSON endpoint is a large
// body, and there is exactly one way to refuse one: stop reading. Checking
// `content-length` first is worth doing because it costs nothing and refuses the
// honest oversized caller before a byte arrives — but it is a CLAIM, absent under
// chunked encoding and free to be a lie, so it cannot be the control. The control
// is `readBounded` below, which counts bytes off the stream and cancels the
// moment the budget is spent. `await req.text()` cannot play that role no matter
// what is asserted about its result: by the time it resolves, the whole body has
// been received and decoded, and a length check there protects `JSON.parse` and
// nothing else.
const MAX_BODY_BYTES = 4096;

const TOKEN_BYTES = 32;
const X25519_PUBLIC_BYTES = 32;
const CONFIRM_BYTES = 32;
const NAME_NONCE_BYTES = 24;
const MAX_NAME_CIPHERTEXT_BYTES = 1024;

// ---------------------------------------------------------------------------
// One failure, one shape.
// ---------------------------------------------------------------------------
// EVERY refusal below returns this, with the same status and the same body. Not
// laziness — the opposite. Distinguishing „no such token", „already used",
// „expired" and „rate limited" hands an attacker an oracle: presenting a guess
// and being told „already used" rather than „no such token" confirms the guess
// was real. It also tells a probe whether an account is currently pairing, which
// is when it is most worth attacking. The desktop does not need the distinction
// either; from its side there is exactly one recovery, which is to ask the user
// for a fresh code.
//
// The one exception is a malformed request, which is a client bug rather than a
// guess and carries no information about anybody's state.
function refuse(): Response {
  return new Response(
    JSON.stringify({ error: "pairing_not_available" }),
    { status: 401, headers: { "content-type": "application/json" } },
  );
}

function badRequest(detail: string): Response {
  return new Response(
    JSON.stringify({ error: "bad_request", detail }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
}

// ---------------------------------------------------------------------------
// Input decoding.
// ---------------------------------------------------------------------------
// Base64url, decoded to a fixed length that the caller does not get to choose.
// Returning null rather than throwing keeps every validation failure on one path
// — a thrown decode error inside a `try` that also wraps the database call would
// be reported as a server fault, and a malformed field would look like an outage.
function decodeFixed(value: unknown, expectedBytes: number): Uint8Array | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) return null;
  // Accept both alphabets: the desktop and the web build encode with different
  // helpers, and rejecting `+`/`/` here would be a bug that only appears on one
  // of the two clients, which is the kind that ships.
  const normalised = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }
  if (binary.length !== expectedBytes) return null;
  const out = new Uint8Array(expectedBytes);
  for (let i = 0; i < expectedBytes; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function decodeBounded(value: unknown, min: number, max: number): Uint8Array | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) return null;
  const normalised = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }
  if (binary.length < min || binary.length > max) return null;
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// PostgREST speaks `bytea` as a hex string with a leading backslash-x. Building
// it here rather than sending base64 keeps the database from having to guess an
// encoding, and a wrong guess would compare a digest against its own base64
// text and never match — a failure that looks exactly like „token not found".
function toPgBytea(bytes: Uint8Array): string {
  return `\\x${toHex(bytes)}`;
}

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  let total = 0;
  for (const part of parts) total += part.length;
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", joined));
}

// The `session_id` claim, read out of a token this function just received from
// its own auth server over the platform's internal network. Decoded WITHOUT
// signature verification, and that is safe here for a reason worth stating: the
// value is used only as an opaque identifier to write into `devices.session_id`,
// never as an authorisation input, and the token did not come from a client. If
// this value is ever used to decide anything, it must be verified first.
function readSessionId(accessToken: string): string | null {
  const parts = accessToken.split(".");
  const payload = parts[1];
  if (parts.length !== 3 || payload === undefined) return null;
  try {
    const normalised = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
    const decoded: unknown = JSON.parse(atob(padded));
    if (typeof decoded !== "object" || decoded === null) return null;
    const sessionId = (decoded as Record<string, unknown>)["session_id"];
    return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  } catch {
    return null;
  }
}

// Reads at most `maxBytes` off the request body and returns null the instant the
// budget is exceeded, cancelling the stream rather than draining it. Returning
// null instead of throwing keeps every rejection on the one refusal path.
async function readBounded(req: Request, maxBytes: number): Promise<string | null> {
  if (req.body === null) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      // Cancelled, not broken out of. `break` alone leaves the sender writing
      // into a stream nobody is reading, which is the same transfer this limit
      // exists to refuse — just with the cost moved to the socket.
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

// The address this request came from, as the PLATFORM reports it — which is not
// the same thing as what the caller says, and the difference is the whole of this
// function.
//
// `x-forwarded-for` is a list that grows to the RIGHT: each proxy appends the
// address it received the connection from. So the leftmost entry is whatever the
// original client wrote, and it is writable by anyone — `x-forwarded-for:
// 203.0.113.<random>` on every request yields a fresh rate-limit bucket every
// time, and the per-address limiter below stops firing at all. Reading position
// [0] is the standard shape of this bug and it disables the control silently:
// the limiter still runs, still writes rows, still returns true.
//
// So: `cf-connecting-ip` first, because an edge that sets it overwrites whatever
// the client sent, and only then the RIGHTMOST forwarded hop, which is the entry
// the closest trusted proxy appended and therefore the only one the caller could
// not choose.
//
// THE CAVEAT, WHICH MUST BE CHECKED ON THE REAL PLATFORM AND NOT ASSUMED. If more
// than one proxy appends, the rightmost hop is an internal address shared by
// every caller, and the per-address limiter collapses into one global bucket.
// That fails in the safe direction — everyone is limited together rather than
// nobody being limited — but it is an outage rather than a control, so the
// deployment step in the README says to confirm which header actually carries the
// client address before trusting this.
function callerAddress(req: Request): string {
  const direct = req.headers.get("cf-connecting-ip")?.trim();
  if (direct !== undefined && direct.length > 0) return direct;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const hops = forwarded.split(",").map((hop) => hop.trim()).filter((hop) => hop.length > 0);
    const nearest = hops[hops.length - 1];
    if (nearest !== undefined) return nearest;
  }
  // Not a fallback to „no limit": every caller the platform cannot identify
  // shares this one bucket, so an unidentifiable flood limits itself.
  return "unknown";
}

Deno.serve(async (req: Request): Promise<Response> => {
  // NO CORS HEADERS, AND NO `OPTIONS` HANDLER, DELIBERATELY. The only caller is
  // the desktop's Electron MAIN process, which issues a server-to-server fetch
  // and is not subject to the same-origin policy at all. Adding permissive CORS
  // would make this endpoint reachable from any web page the user happens to
  // have open — a page that could then replay a token it observed, or simply
  // hammer it. The absence of these headers is the access-control decision.
  if (req.method !== "POST") return badRequest("POST only");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY || !RATE_SALT) {
    // Refuse rather than run degraded. A missing rate-limit salt in particular
    // must never fall back to „no salt" or „no limit": a control that silently
    // turns itself off when misconfigured is worse than one that was never
    // written, because the deployment reports itself as protected.
    //
    // 503 rather than the uniform 401 below. The uniform refusal exists so the
    // endpoint cannot be used as an oracle about somebody's pairing state, and a
    // missing environment variable says nothing about any account — while a 401
    // for a server misconfiguration sends whoever is debugging it to look at the
    // client for as long as it takes them to give up.
    console.error("pair-complete: missing required environment configuration");
    return new Response(
      JSON.stringify({ error: "unavailable" }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }

  // The cheap refusal first, and it FAILS CLOSED. The previous shape was
  // `Number.isFinite(n) && n > MAX` — which skips the check whenever the header
  // is absent (`Number("") === 0`) or unparseable (`Number("abc")` is NaN), i.e.
  // exactly when the caller is not being straightforward. A guard whose condition
  // is „the input was well-formed AND too big" declines to guard against
  // malformed input, which is the input worth guarding against.
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const declaredBytes = Number(declared);
    if (!Number.isInteger(declaredBytes) || declaredBytes < 0 ||
        declaredBytes > MAX_BODY_BYTES) {
      return badRequest("body too large");
    }
  }

  // The real limit. See MAX_BODY_BYTES for why this cannot be `req.text()`.
  const raw = await readBounded(req, MAX_BODY_BYTES);
  if (raw === null) return badRequest("body too large");

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return badRequest("body must be a JSON object");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return badRequest("body must be JSON");
  }

  // THE ONLY CREDENTIAL THIS ENDPOINT ACCEPTS. Note what is NOT in this list:
  // the pairing code, `code_id`, or any digest of either. If a future change
  // adds one, the invariant at the top of this file is broken and a ~65-bit
  // secret has become sufficient to obtain a session.
  const completionToken = decodeFixed(body["completion_token"], TOKEN_BYTES);
  const responderPub = decodeFixed(body["responder_pub"], X25519_PUBLIC_BYTES);
  const responderConfirm = decodeFixed(body["responder_confirm"], CONFIRM_BYTES);
  const nameNonce = decodeFixed(body["device_name_nonce"], NAME_NONCE_BYTES);
  const nameCiphertext = decodeBounded(
    body["device_name_ciphertext"],
    17,
    MAX_NAME_CIPHERTEXT_BYTES,
  );
  const platform = body["platform"];

  if (
    !completionToken || !responderPub || !responderConfirm ||
    !nameNonce || !nameCiphertext || platform !== "desktop"
  ) {
    return badRequest("malformed pairing completion");
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // RATE LIMIT BEFORE ANYTHING EXPENSIVE, AND BEFORE THE CLAIM. Ordering is the
  // control: run the claim first and an attacker gets unlimited attempts at the
  // one operation that mutates state, with the limiter arriving afterwards to
  // report what already happened.
  const addressDigest = await sha256(
    new TextEncoder().encode(RATE_SALT),
    new TextEncoder().encode(callerAddress(req)),
  );
  const { data: addressAllowed, error: addressLimitError } = await admin.rpc(
    "nexus_pair_rate_limit_hit",
    {
      p_bucket_key: `addr:${toHex(addressDigest)}`,
      p_limit: RATE_LIMIT_PER_ADDRESS,
      p_window: RATE_WINDOW,
    },
  );
  if (addressLimitError || addressAllowed !== true) return refuse();

  // The token digest is computed once and used for both the per-token limiter
  // and the claim, so a caller cannot be limited under one identity and claim
  // under another.
  const tokenDigest = await sha256(completionToken);
  const { data: tokenAllowed, error: tokenLimitError } = await admin.rpc(
    "nexus_pair_rate_limit_hit",
    {
      p_bucket_key: `tok:${toHex(tokenDigest)}`,
      p_limit: RATE_LIMIT_PER_TOKEN,
      p_window: RATE_WINDOW,
    },
  );
  if (tokenLimitError || tokenAllowed !== true) return refuse();

  // SINGLE USE, ENFORCED IN ONE SQL STATEMENT. This function does not read the
  // pairing row and then decide; `nexus_pair_claim` consumes it in the same
  // statement that finds it, so two concurrent requests with the same token
  // serialise on the row lock and exactly one is answered. A check-then-act here
  // would let a token be redeemed twice under concurrency, which is two desktops
  // paired from one handshake — and the second one is whoever was listening.
  const { data: claimed, error: claimError } = await admin.rpc("nexus_pair_claim", {
    p_token_hash: toPgBytea(tokenDigest),
    p_responder_pub: toPgBytea(responderPub),
    p_responder_confirm: toPgBytea(responderConfirm),
  });
  if (claimError) {
    console.error("pair-complete: claim failed", claimError.message);
    return refuse();
  }
  const claim = Array.isArray(claimed) ? claimed[0] : undefined;
  if (!claim || typeof claim.account_id !== "string") return refuse();
  const accountId: string = claim.account_id;

  // From here the pairing is spent whatever happens. Every remaining failure
  // returns the same refusal and the user starts again with a fresh code — which
  // is the correct trade: a token that survived a partial failure so it could be
  // retried would be a token that is no longer single-use.
  const { data: userLookup, error: userError } = await admin.auth.admin.getUserById(accountId);
  const email = userLookup?.user?.email;
  if (userError || typeof email !== "string" || email.length === 0) {
    console.error("pair-complete: account lookup failed");
    return refuse();
  }

  // MINTING THE SESSION. `generateLink` produces a verification hash without
  // sending any mail; exchanging it through the anon client yields an ordinary
  // session. It is aal1 and will stay aal1 for its whole life, because the
  // desktop never sees the web password and cannot step up. That is not a
  // shortcoming to be worked around later — it is the reason the restrictive
  // policy in migration 002 carries its `OR`, and the reason the `pairing`
  // INSERT is aal2-only: the desktop's authority comes from a handshake a human
  // confirmed on two screens, not from a factor it could never present.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const hashedToken = link?.properties?.hashed_token;
  if (linkError || typeof hashedToken !== "string") {
    console.error("pair-complete: link generation failed");
    return refuse();
  }

  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: hashedToken,
  });
  const session = verified?.session;
  if (verifyError || !session) {
    console.error("pair-complete: session mint failed");
    return refuse();
  }

  const sessionId = readSessionId(session.access_token);
  if (!sessionId) {
    console.error("pair-complete: minted token carries no session_id");
    return refuse();
  }

  // THE DEVICE ROW IS WHAT MAKES THE SESSION USABLE, and writing it last is the
  // safe order. Until this row exists the freshly minted aal1 session satisfies
  // `auth.uid()` but fails `private.nexus_session_is_live()`, so it can read
  // nothing — a session that leaked out of a half-completed pairing is inert.
  // Written first, a failure after it would leave a live device row for a
  // session nobody holds, which is a permanent hole in the gate.
  const { data: device, error: deviceError } = await admin
    .from("devices")
    .insert({
      user_id: accountId,
      session_id: sessionId,
      platform: "desktop",
      name_nonce: toPgBytea(nameNonce),
      name_ciphertext: toPgBytea(nameCiphertext),
    })
    .select("id")
    .single();
  if (deviceError || !device) {
    console.error("pair-complete: device registration failed", deviceError?.message);
    return refuse();
  }

  // The response carries the session and the SERVER-ATTESTED account email,
  // which is the whole point of returning it: the desktop shows that email in
  // the consent dialog behind the account passcode, so the human confirms which
  // account they are joining rather than trusting the screen that produced the
  // code. Nothing else about the account is disclosed.
  return new Response(
    JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? null,
      account_email: email,
      device_id: device.id,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        // A session in a response body must never be cached by anything.
        "cache-control": "no-store",
      },
    },
  );
});
