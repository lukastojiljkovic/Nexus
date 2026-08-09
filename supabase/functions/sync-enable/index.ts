// THE INVARIANT: this endpoint is the only way an account's master key comes
// into existence, it does so exactly once, and it never tells a caller anything
// about a master key that already exists.
//
// The second half is as important as the first. `nexus_mk_mint`'s header spells
// out why a device that loses the mint race must NOT adopt the existing wrap:
// opening `mk_under_kwrap` proves knowledge of the web password, and this whole
// design starts from the premise that the web password is phishable — that is
// why K_auth and K_wrap are split at all. So a caller that arrives second is
// told `already_minted` and nothing else. It gets no ciphertext, no salt, no
// parameters, and no route to the key. The two routes to an existing MK are
// pairing with a device that holds it and the Recovery Kit, and both are proofs
// a password thief does not have.
//
// WHY IT IS AN EDGE FUNCTION AND NOT A POSTGREST CALL. `nexus_mk_mint` must read
// `auth.sessions`, `auth.mfa_amr_claims`, `auth.mfa_factors` and `auth.users` to
// decide whether the caller is entitled to mint, and the only role holding those
// grants is `service_role` (migration 011 explains why a `security definer`
// function was refused instead). `service_role` bypasses row level security
// entirely, so the key that holds it lives here, in one function's environment,
// and never reaches a client.
//
// WHY IT TAKES TWO TOKENS.
//
//  * `Authorization: Bearer …` carries the DEVICE session — long-lived, `aal1`,
//    the one the desktop syncs with forever and the one written into
//    `devices.session_id`.
//  * `x-nexus-authorising-token` carries an EPHEMERAL `aal2` session that
//    authorises this single call and is signed out by the client immediately
//    afterwards.
//
// They must be two different sessions, and the database refuses them being one
// (NX306). GoTrue's `aal` is a column on the session row that survives every
// refresh, so a desktop that ever stepped up would be `aal2` for the rest of its
// life — and `devices_live_session` hands an `aal2` session read and write over
// EVERY device row on the account, while `pairing_insert_requires_aal2` would let
// it act as a pairing initiator. Those are browser powers, and they would be
// sitting in a token on a laptop's disk. One extra sign-in buys „a desktop's
// working session is aal1" as a structural fact.
//
// THE ORDER THE CLIENT MUST SIGN IN, WHICH IS NOT A STYLE CHOICE. Measured
// against this GoTrue and pinned by `supabase/tests/live/sync-enable.test.mjs`:
// verifying an MFA factor REVOKES every other session the account holds. The
// stepped-up session survives and so does anything signed in afterwards, so the
// only order that works is
//
//   1. sign in  → step the session up to aal2   (the authorising session)
//   2. sign in again                            (the device session)
//   3. call this endpoint
//   4. sign the authorising session out
//
// Backwards — device session first — the desktop destroys its own device session
// at step 1 and this endpoint answers 401, which says nothing about ordering.
// The same fact has a consequence beyond this endpoint: enabling sync from a
// SECOND desktop revokes the first one's device session, and a `devices` row is
// bound to a `session_id`. What a desktop does when its session is revoked under
// it is device lifecycle, is not built, and is recorded in `docs/STATUS.md`.
//
// WHAT THIS FUNCTION DOES NOT DECIDE. Not whether the caller may mint — that is
// `nexus_mk_mint`, reading the session rows themselves rather than any claim the
// caller presents. Not whether the wraps are well-formed for this account — it
// cannot, it holds no key; the client verifies its own work by re-fetching both
// wraps afterwards and opening them. This function authenticates two tokens,
// shapes the payload, and carries it.

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

// The header the ephemeral `aal2` token arrives in. NOT the body: a value that
// travels in a JSON field ends up in request logs, replay fixtures and error
// reports written by whoever is debugging the client, and a bearer token has no
// business in any of them.
const AUTHORISING_TOKEN_HEADER = "x-nexus-authorising-token";

// Two 48-byte wraps, three 24/32/16-byte fields each, a device name of at most
// 1 KiB and two small parameter objects — under 2 KiB base64-encoded. The cap is
// the same 4 KiB `pair-complete` uses, for the same reason and with the same
// enforcement: see `readBounded` in `_shared/http.ts`.
const MAX_BODY_BYTES = 4096;

// Every one of these mirrors a CHECK in migration 001. Checking here as well is
// not belt-and-braces for its own sake — it turns „the database rejected a
// constraint you have never heard of" into a named field, before a service-role
// client is constructed at all. The DATABASE remains the authority: if these
// ever disagree, the row is what the database says it is.
const NONCE_BYTES = 24;
const WRAPPED_BYTES = 48;
const COMMIT_TAG_BYTES = 32;
const KDF_SALT_BYTES = 16;
const MK_VERIFIER_BYTES = 32;
const NAME_NONCE_BYTES = 24;
const MIN_NAME_CIPHERTEXT_BYTES = 17;
const MAX_NAME_CIPHERTEXT_BYTES = 1024;

/** The `mk_under_kwrap` shape: no salt, because K_wrap's salt is derived. */
interface Wrap {
  readonly nonce: Uint8Array;
  readonly wrapped: Uint8Array;
  readonly commitTag: Uint8Array;
  readonly kdfParams: Record<string, number>;
}

/** The `mk_under_src` shape. Two types rather than a nullable field, so „the
 *  recovery wrap arrived without its salt" is not a state this file can hold. */
interface SaltedWrap extends Wrap {
  readonly kdfSalt: Uint8Array;
}

/** Claims that have passed the cheap pre-filter — still unverified, see below. */
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

// A caller who holds neither token learns only that it holds neither token.
// There is no oracle to protect here — every distinction below is about the
// caller's OWN account, which it has just proved it can sign into — but a
// missing or expired token is not about an account at all.
function unauthenticated(): Response {
  return json(401, { error: "unauthenticated" });
}

// EXACTLY THE THREE ARGON2ID PARAMETERS, each a positive integer, and no other
// key. `kdf_params` is `jsonb`: whatever arrives is stored, so an unbounded
// object is storage an account grants itself, and an unexpected key is a client
// that believes the schema is something this one does not implement.
//
// NO FLOOR AND NO CEILING HERE, DELIBERATELY. The floor
// (`key_wraps_kdf_params_floor`) and the ceiling (`key_wraps_kdf_params_ceiling`)
// are constraints in the database, and `kdf.ts` bounds the same values again when
// it READS them, treating the server as hostile. Restating either bound in this
// file would make three places responsible for one number, which is how one of
// them ends up lower than the others without anybody noticing.
const KDF_PARAM_KEYS = ["memoryKiB", "iterations", "parallelism"] as const;

function readKdfParams(value: unknown): Record<string, number> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length !== KDF_PARAM_KEYS.length) return null;
  const out: Record<string, number> = {};
  for (const key of KDF_PARAM_KEYS) {
    const raw = source[key];
    if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 1) return null;
    out[key] = raw;
  }
  return out;
}

function readWrapFields(value: unknown): { wrap: Wrap; salt: unknown } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;

  const nonce = decodeFixed(source["nonce"], NONCE_BYTES);
  const wrapped = decodeFixed(source["wrapped"], WRAPPED_BYTES);
  const commitTag = decodeFixed(source["commit_tag"], COMMIT_TAG_BYTES);
  const kdfParams = readKdfParams(source["kdf_params"]);
  if (!nonce || !wrapped || !commitTag || !kdfParams) return null;
  return { wrap: { nonce, wrapped, commitTag, kdfParams }, salt: source["kdf_salt"] };
}

// `mk_under_kwrap` carries NO salt — its KEK is K_wrap, whose salt is
// SHA-256("nexus/web-kdf/v1" ‖ lowercase(email)), derived on every device and
// deliberately never stored (`key_wraps_kdf_salt_presence`, migration 009). A
// salt arriving on this slot is a client that has confused the two wraps, and it
// is refused rather than quietly dropped: dropping it would store a wrap whose
// author believed a different derivation was in force.
//
// An explicit `null` is accepted as „no salt", because that is what a client
// serialising an optional field writes and it is not a confusion about anything.
// Only an actual value is refused.
function readUnsaltedWrap(value: unknown): Wrap | null {
  const read = readWrapFields(value);
  if (!read || (read.salt !== undefined && read.salt !== null)) return null;
  return read.wrap;
}

function readSaltedWrap(value: unknown): SaltedWrap | null {
  const read = readWrapFields(value);
  if (!read) return null;
  const kdfSalt = decodeFixed(read.salt, KDF_SALT_BYTES);
  if (!kdfSalt) return null;
  return { ...read.wrap, kdfSalt };
}

// The `NX3xx` band belongs to the mint (migration 011). Each one is a state of
// the CALLER'S OWN account, which it has authenticated to twice over, so naming
// it is not a disclosure — and it is the difference between a desktop that can
// say „confirm your email address, then try again" and one that shows a spinner.
const MINT_REFUSALS: Record<string, { status: number; error: string }> = {
  NX301: { status: 403, error: "session_not_live" },
  NX302: { status: 403, error: "second_factor_required" },
  NX303: { status: 403, error: "factor_must_predate_session" },
  NX304: { status: 403, error: "email_not_confirmed" },
  NX305: { status: 403, error: "sessions_from_different_accounts" },
  // A client bug rather than an account state: the desktop sent one session
  // twice instead of signing in a second time.
  NX306: { status: 400, error: "sessions_must_differ" },
};

Deno.serve(async (req: Request): Promise<Response> => {
  // No CORS headers and no `OPTIONS` handler, and the `Origin` refusal is what
  // makes that a control rather than an inconvenience — absent CORS headers stop
  // a page reading the response, not sending the request, and this request mints
  // a master key. The only legitimate caller is the desktop's Electron MAIN
  // process, whose fetch carries no `Origin` at all.
  if (req.method !== "POST") return badRequest("POST only");
  if (fromBrowsingContext(req)) return badRequest("not callable from a browser");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    console.error("sync-enable: missing required environment configuration");
    return unavailable();
  }

  const authorization = req.headers.get("authorization");
  const deviceToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
  const authorisingToken = req.headers.get(AUTHORISING_TOKEN_HEADER)?.trim() ?? null;
  if (!deviceToken || !authorisingToken) return unauthenticated();

  // THE FREE FILTER, AND IT IS NOT AN AUTHORISATION CHECK. `verify_jwt = true`
  // in `config.toml` is satisfied by ANY JWT this project signed — including the
  // anon key, which is printed in every client build. So the platform gate keeps
  // out noise and nothing else, and an unauthenticated caller does reach this
  // line. Decoding both tokens without verifying them costs nothing and drops
  // the anon key (no `session_id`), a garbage string, and an expired token
  // before either of the two network round trips below.
  //
  // What comes out of here is used for exactly one thing: deciding whether to
  // spend those round trips. The session ids sent to the database are the ones
  // taken from tokens the auth server has by then confirmed it signed.
  const nowSeconds = Math.floor(Date.now() / 1000);
  const deviceClaims = unverifiedClaims(deviceToken);
  const authClaims = unverifiedClaims(authorisingToken);
  if (
    !looksLikeAccessToken(deviceClaims, nowSeconds) ||
    !looksLikeAccessToken(authClaims, nowSeconds)
  ) {
    return unauthenticated();
  }

  if (!declaredLengthOk(req, MAX_BODY_BYTES)) return badRequest("body too large");
  const raw = await readBounded(req, MAX_BODY_BYTES);
  if (raw === null) return badRequest("body too large");
  const body = parseJsonObject(raw);
  if (body === null) return badRequest("body must be a JSON object");

  const nameNonce = decodeFixed(body["device_name_nonce"], NAME_NONCE_BYTES);
  const nameCiphertext = decodeBounded(
    body["device_name_ciphertext"],
    MIN_NAME_CIPHERTEXT_BYTES,
    MAX_NAME_CIPHERTEXT_BYTES,
  );
  // `kwrap` is the wrap under the web-password key; `src` is the wrap under the
  // Sync Recovery Code. BOTH are required, and migration 011 inserts them in one
  // statement for a reason worth repeating here: no client can add `mk_under_src`
  // afterwards, because `key_wraps_desktop_only` demands a device row and the
  // device row is written by the same transaction. An account minted without a
  // recovery wrap would have no recovery path and no way to acquire one.
  const kwrap = readUnsaltedWrap(body["kwrap"]);
  const src = readSaltedWrap(body["src"]);
  // THE DEVICE-REGISTRATION PROOF, AND IT IS REQUIRED (migration 013). Nothing
  // can write `private.mk_verifiers` except the mint and the function that reads
  // it, so an account minted without one could never register a second desktop —
  // and a desktop whose session dies would be stranded with the key on its own
  // disk and no way to present it. Same argument as `mk_under_src`: the mint is a
  // one-shot, so everything a later recovery needs is written by it or never.
  const mkVerifier = decodeFixed(body["mk_verifier"], MK_VERIFIER_BYTES);
  if (!nameNonce || !nameCiphertext || !kwrap || !src || !mkVerifier) {
    return badRequest("malformed sync-enable request");
  }

  // Verification through the ANON client, never the service-role one. `getUser`
  // asks the auth server to validate the token it is handed — signature, issuer
  // and expiry — which is the whole point; doing it with a client that carries
  // BYPASSRLS authority would put the one credential that ignores every wall on
  // the path that handles unauthenticated input.
  //
  // This is also why the check is `getUser` rather than a local JWKS parse:
  // whether this project signs with HS256 or an asymmetric key is a deployment
  // setting that can change, and a verifier that silently understands only one of
  // them is a verifier that silently stops verifying.
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [deviceUser, authorisingUser] = await Promise.all([
    anon.auth.getUser(deviceToken),
    anon.auth.getUser(authorisingToken),
  ]);
  if (deviceUser.error || !deviceUser.data.user) return unauthenticated();
  if (authorisingUser.error || !authorisingUser.data.user) return unauthenticated();

  // Both tokens are now known to have been signed by this project, so their
  // payloads are authentic and the session ids may be trusted. Whether the two
  // sessions belong to the same account, are still live, and carry the assurance
  // this operation needs is NOT decided here: `nexus_mk_mint` reads the session
  // rows themselves. A second opinion in this file would be a second place for
  // the rule to be written down, and eventually a second answer.
  const deviceSessionId = deviceClaims.sessionId;
  const authSessionId = authClaims.sessionId;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: outcome, error: mintError } = await admin.rpc("nexus_mk_mint", {
    p_auth_session_id: authSessionId,
    p_device_session_id: deviceSessionId,
    p_device_name_nonce: toPgBytea(nameNonce),
    p_device_name_ciphertext: toPgBytea(nameCiphertext),
    p_kwrap_nonce: toPgBytea(kwrap.nonce),
    p_kwrap_wrapped: toPgBytea(kwrap.wrapped),
    p_kwrap_commit_tag: toPgBytea(kwrap.commitTag),
    p_kwrap_kdf_params: kwrap.kdfParams,
    p_src_nonce: toPgBytea(src.nonce),
    p_src_wrapped: toPgBytea(src.wrapped),
    p_src_commit_tag: toPgBytea(src.commitTag),
    p_src_kdf_salt: toPgBytea(src.kdfSalt),
    p_src_kdf_params: src.kdfParams,
    p_mk_verifier: toPgBytea(mkVerifier),
  });

  if (mintError) {
    const refusal = MINT_REFUSALS[mintError.code ?? ""];
    if (refusal) return json(refusal.status, { error: refusal.error });

    // 23505 IS AN ANSWER, NOT A FAULT. `key_wraps_one_per_slot` is the mint's
    // serializer: the loser of a concurrent race gets a unique violation and its
    // whole transaction rolls back. From the client's side that is the same
    // situation as the fast path inside the function reporting `already_minted`
    // — an MK exists that this device did not choose — and the correct next step
    // is identical: pair, or use the Recovery Kit. Never adopt.
    if (mintError.code === "23505") return json(200, { status: "already_minted" });

    // A CHECK violation means the payload was shaped in a way this function's
    // own validation let through, which is a bug in one of the two. Naming the
    // constraint costs nothing — it is a schema this repository publishes — and
    // it is the difference between a fixable report and „400".
    if (mintError.code === "23514") {
      console.error("sync-enable: schema refused the payload", mintError.message);
      return json(400, { error: "rejected_by_schema", detail: mintError.message });
    }

    console.error("sync-enable: mint failed", mintError.code, mintError.message);
    return json(500, { error: "mint_failed" });
  }

  if (outcome !== "minted" && outcome !== "already_minted") {
    console.error("sync-enable: mint returned an unknown outcome");
    return json(500, { error: "mint_failed" });
  }

  // The device row exists only on the minting path. Read back rather than
  // assumed, because „the mint said minted" and „a live desktop row exists for
  // this session" are two statements, and the client is about to write
  // `last_seen_at` against whichever id this returns.
  let deviceId: string | null = null;
  if (outcome === "minted") {
    const { data: device } = await admin
      .from("devices")
      .select("id")
      .eq("session_id", deviceSessionId)
      .is("revoked_at", null)
      .maybeSingle();
    deviceId = typeof device?.id === "string" ? device.id : null;
  }

  return json(200, { status: outcome, device_id: deviceId });
});
