// THE INVARIANT: this endpoint hands out a `platform = 'desktop'` device row,
// and the only thing that buys one is possession of the account's master key.
//
// WHY THAT IS THE PRICE, AND NOT A SECOND FACTOR. A desktop row is what
// `key_wraps_master_key_is_desktop_only` accepts as authority to read
// `mk_under_kwrap`, and K_wrap is derived from the web password. So „password
// plus TOTP ⇒ a desktop row" would mean „password plus TOTP ⇒ MK", and the
// policy that keeps a phished password away from the root of the key hierarchy
// would be worth nothing. Its own header says the routes to an existing MK are
// pairing and the Recovery Kit *because both are proofs a password thief does not
// have*; this is the third, and it is MK itself.
//
// And a step-up would not merely be insufficient, it would be actively wrong:
// verifying an MFA factor revokes every OTHER session the account holds, so a
// recovery that required one would strand every sibling desktop, whose own
// recovery would strand this one — two machines taking turns forever. Migration
// 013's header has the full argument.
//
// WHY IT TAKES ONE TOKEN AND NOT TWO. `sync-enable` takes two because it needs an
// `aal2` session to authorise the mint while keeping the desktop's own session
// `aal1`. Here the authorisation IS the proof, and the single session in play is
// the one the row will name. `nexus_device_register` refuses an `aal2` session
// outright (NX405) for the reason the mint keeps them apart: `aal` survives every
// refresh, and `devices_live_session` hands an `aal2` session read and write over
// every device row on the account.
//
// WHAT THIS FUNCTION DOES NOT DECIDE. Not whether the proof matches — that is
// `nexus_device_register`, comparing against a value in a schema PostgREST does
// not expose, under a blind so the comparison's duration says nothing. Not
// whether the session is live or which account it belongs to — the function reads
// `auth.sessions` itself rather than trusting a claim. This authenticates one
// token, shapes three fields, and carries them.

import { createClient } from "@supabase/supabase-js";

import {
  badRequest,
  decodeBounded,
  decodeFixed,
  declaredLengthOk,
  fromBrowsingContext,
  parseJsonObject,
  readBounded,
  toPgBytea,
  unavailable,
  type UnverifiedClaims,
  unverifiedClaims,
} from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

// A 32-byte proof, a 24-byte nonce and a device name of at most 1 KiB — well
// under 2 KiB base64-encoded. The same 4 KiB cap the other two functions use,
// with the same enforcement: see `readBounded` in `_shared/http.ts`.
const MAX_BODY_BYTES = 4096;

// Mirrors of CHECK constraints in migrations 001 and 013. Checking here as well
// turns „the database rejected a constraint you have never heard of" into a
// named field, before a service-role client is constructed at all. The DATABASE
// remains the authority: if these ever disagree, the row is what it says.
const PROOF_BYTES = 32;
const NAME_NONCE_BYTES = 24;
const MIN_NAME_CIPHERTEXT_BYTES = 17;
const MAX_NAME_CIPHERTEXT_BYTES = 1024;

type ShapedClaims = UnverifiedClaims & { readonly sessionId: string; readonly sub: string };

function looksLikeAccessToken(
  claims: UnverifiedClaims | null,
  nowSeconds: number,
): claims is ShapedClaims {
  return claims !== null && claims.sessionId !== null && claims.sub !== null &&
    (claims.exp === null || claims.exp > nowSeconds);
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function unauthenticated(): Response {
  return json(401, { error: "unauthenticated" });
}

// The `NX4xx` band belongs to registration (migration 013). Every one of these is
// a state of the CALLER'S OWN account, which it has authenticated to, so naming
// it is not a disclosure — and `proof_rejected` in particular has to be its own
// sentence: it means „this machine does not hold the master key", whose answer is
// pairing or the Recovery Kit and never „try again".
const REGISTER_REFUSALS: Record<string, { status: number; error: string }> = {
  NX401: { status: 403, error: "session_not_live" },
  NX402: { status: 409, error: "not_enabled" },
  NX403: { status: 403, error: "proof_rejected" },
  NX405: { status: 403, error: "session_not_aal1" },
  NX406: { status: 409, error: "too_many_devices" },
};

Deno.serve(async (req: Request): Promise<Response> => {
  // No CORS headers and no `OPTIONS` handler, and the `Origin` refusal is what
  // makes that a control rather than an inconvenience — absent CORS headers stop
  // a page READING a response, not sending the request. The only legitimate
  // caller is the desktop's Electron main process, whose fetch carries no
  // `Origin`, and a browser has no use for what this hands out: it would be a
  // browser asking to be called a desktop.
  if (req.method !== "POST") return badRequest("POST only");
  if (fromBrowsingContext(req)) return badRequest("not callable from a browser");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    console.error("device-register: missing required environment configuration");
    return unavailable();
  }

  const authorization = req.headers.get("authorization");
  const deviceToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
  if (!deviceToken) return unauthenticated();

  // The free filter, and it is not an authorisation check: `verify_jwt = true` is
  // satisfied by ANY JWT this project signed, including the anon key printed in
  // every client build. Decoding without verifying costs nothing and drops the
  // anon key (no `session_id`), a garbage string and an expired token before the
  // network round trip below.
  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims = unverifiedClaims(deviceToken);
  if (!looksLikeAccessToken(claims, nowSeconds)) return unauthenticated();

  if (!declaredLengthOk(req, MAX_BODY_BYTES)) return badRequest("body too large");
  const raw = await readBounded(req, MAX_BODY_BYTES);
  if (raw === null) return badRequest("body too large");
  const body = parseJsonObject(raw);
  if (body === null) return badRequest("body must be a JSON object");

  const proof = decodeFixed(body["mk_verifier"], PROOF_BYTES);
  const nameNonce = decodeFixed(body["device_name_nonce"], NAME_NONCE_BYTES);
  const nameCiphertext = decodeBounded(
    body["device_name_ciphertext"],
    MIN_NAME_CIPHERTEXT_BYTES,
    MAX_NAME_CIPHERTEXT_BYTES,
  );
  if (!proof || !nameNonce || !nameCiphertext) {
    return badRequest("malformed device-register request");
  }

  // Verification through the ANON client, never the service-role one: `getUser`
  // asks the auth server to validate signature, issuer and expiry, and doing that
  // with a client carrying BYPASSRLS authority would put the one credential that
  // ignores every wall on the path handling unauthenticated input. It is also why
  // this is `getUser` rather than a local JWKS parse — whether this project signs
  // with HS256 or an asymmetric key is a deployment setting that can change, and
  // a verifier that silently understands only one of them silently stops
  // verifying.
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const user = await anon.auth.getUser(deviceToken);
  if (user.error || !user.data.user) return unauthenticated();

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: deviceId, error } = await admin.rpc("nexus_device_register", {
    p_device_session_id: claims.sessionId,
    p_verifier: toPgBytea(proof),
    p_device_name_nonce: toPgBytea(nameNonce),
    p_device_name_ciphertext: toPgBytea(nameCiphertext),
  });

  if (error) {
    const refusal = REGISTER_REFUSALS[error.code ?? ""];
    if (refusal) return json(refusal.status, { error: refusal.error });

    // A CHECK violation means the payload was shaped in a way this function's own
    // validation let through, which is a bug in one of the two. Naming the
    // constraint costs nothing — it is a schema this repository publishes — and
    // it is the difference between a fixable report and „400".
    if (error.code === "23514") {
      console.error("device-register: schema refused the payload", error.message);
      return json(400, { error: "rejected_by_schema", detail: error.message });
    }

    console.error("device-register: failed", error.code, error.message);
    return json(500, { error: "register_failed" });
  }

  // The function returns the row's id and cannot return null on a path that did
  // not raise. A defensive check anyway, because „registered" with no id is a
  // claim the caller cannot act on: without it there is nothing to write
  // `last_seen_at` against and no way to retire this machine later.
  if (typeof deviceId !== "string" || deviceId.length === 0) {
    console.error("device-register: the registration returned no device id");
    return json(500, { error: "register_failed" });
  }

  return json(200, { device_id: deviceId });
});
