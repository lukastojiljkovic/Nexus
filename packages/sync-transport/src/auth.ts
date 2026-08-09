/**
 * GoTrue, as six requests and the answers to them — no client library, no
 * session store, no clock.
 *
 * ─── Why this is here and not `@supabase/supabase-js` ───────────────────────
 *
 * `http.ts`'s header already gives the general answer: the SDK is four clients
 * in one, each with its own `fetch`, and it would land in the Electron main
 * process beside the SQLCipher key. Auth adds a second, sharper reason. The
 * SDK's auth client is a SESSION MANAGER — it persists tokens, refreshes them on
 * a timer, and emits events — and every one of those is a decision this product
 * has to make differently. It signs in twice on purpose. It keeps one session and
 * throws the other away within the same second. It must never write a token to
 * disk unencrypted. A library whose job is to do the opposite of each of those,
 * helpfully, in the background, is not a shortcut.
 *
 * So what is here is the wire: a URL, a body, and a reader for what comes back.
 * WHICH sessions exist and how long they are held is the caller's, because that
 * is the part with the security argument in it.
 *
 * ─── The order these are called in is a protocol, not a preference ──────────
 *
 * `supabase/functions/sync-enable/index.ts` sets it out in full and this file
 * will not restate it, except for the one fact that explains the shape of
 * everything below: **verifying an MFA factor revokes every other session the
 * account holds.** That is measured against this GoTrue, not assumed. It is why
 * the desktop signs in, steps that session up, and only then signs in a second
 * time for the session it keeps — and why a port here must not be allowed to
 * decide which token a request carries.
 *
 * ─── What is deliberately absent: enrolment ─────────────────────────────────
 *
 * There is no `POST /factors` here, and the omission is a design decision rather
 * than an unfinished piece. Enrolling a factor creates it AFTER every session
 * that already exists, and `nexus_mk_mint` refuses a factor that does not
 * predate the authorising session (NX303) — so a desktop that enrolled would
 * have to sign in again, step up again, and ask for a second TOTP code from a
 * second time window, to reach a state the web app reaches with one. The account
 * is created on the web; the second factor is enrolled there too. A desktop that
 * meets an account without one says so, in words, and sends the user there.
 */

import { base64urlToBytes } from "@nexus/sync-crypto/web";

import type { AuthPort, AuthRequest, HttpResponse } from "./http.js";

/** `apikey` only — see {@link AuthRequest} for why the bearer is not the port's. */
const JSON_HEADERS: Readonly<Record<string, string>> = { "content-type": "application/json" };

const bearer = (accessToken: string): Readonly<Record<string, string>> => ({
  ...JSON_HEADERS,
  Authorization: `Bearer ${accessToken}`,
});

/**
 * A factor id reaches a URL path. It arrives from the server, so it is not
 * hostile in the ordinary sense — but a value that is interpolated into a path
 * is checked where it is interpolated, or it is checked nowhere.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// What a token says about itself
// ---------------------------------------------------------------------------
/**
 * Claims read out of an access token WITHOUT verifying its signature.
 *
 * That is not a shortcut, and it is not a hole either: a client cannot verify a
 * token it was just handed by the server that signs it, and it has no reason to
 * — it is not deciding anything on the strength of these. It uses them for three
 * things, all of which are about its own bookkeeping. `exp` says when to
 * refresh. `sessionId` says whether the two sessions it holds are actually two
 * (the mint refuses them being one, NX306, and finding that out before spending
 * the call is politeness rather than security). `aal` says whether the step-up
 * it just performed took effect.
 *
 * The authority on every one of those is the server, which reads the session
 * rows themselves. Nothing here is trusted; it is read.
 */
export interface TokenClaims {
  readonly sub: string | null;
  readonly sessionId: string | null;
  /** `"aal1"` or `"aal2"` — GoTrue writes it on the session and it survives refresh. */
  readonly aal: string | null;
  /** Epoch seconds, or null when the token carries none. */
  readonly exp: number | null;
}

export function readTokenClaims(accessToken: string): TokenClaims | null {
  const parts = accessToken.split(".");
  const payload = parts[1];
  if (parts.length !== 3 || payload === undefined) return null;
  // `base64urlToBytes` rather than `atob`: a JWT payload IS unpadded base64url,
  // and the strict decoder refuses padding and the `+`/`/` alphabet outright. A
  // token spelled either of those ways is not one this project's auth server
  // issued, and the tolerant decode would have accepted it silently.
  const bytes = base64urlToBytes(payload);
  if (bytes === null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  const claims = asRecord(decoded);
  if (claims === null) return null;
  const exp = claims["exp"];
  return {
    sub: text(claims["sub"]),
    sessionId: text(claims["session_id"]),
    aal: text(claims["aal"]),
    exp: typeof exp === "number" && Number.isFinite(exp) ? exp : null,
  };
}

// ---------------------------------------------------------------------------
// A session
// ---------------------------------------------------------------------------
/**
 * One GoTrue session, flattened to what this product uses.
 *
 * `expiresAt` comes from the token's own `exp` claim rather than the response's
 * `expires_in`, because `expires_in` is a duration that has to be added to a
 * clock — and the clock available here is the local one, which is exactly the
 * thing that is wrong on a machine whose tokens keep expiring early. The claim
 * is the same number the server will compare against.
 */
export interface AuthSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly aal: string | null;
  /** Epoch seconds, from the access token's `exp`. */
  readonly expiresAt: number | null;
}

/**
 * Every way an auth call can fail, named.
 *
 * These ARE shown to the user — an account this person has just proved they can
 * sign into is not an oracle about anyone — and the difference between them is
 * the difference between „check your code" and „confirm your email address",
 * which is the difference between a screen that helps and a spinner.
 */
export type AuthRefusal =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "invalid_code"
  | "mfa_not_enrolled"
  | "session_expired"
  | "rate_limited"
  | "unavailable"
  | "unknown";

export type AuthResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: AuthRefusal;
      readonly httpStatus: number;
      /** The server's own message, English, for a log — never user copy. */
      readonly detail: string | null;
    };

/**
 * GoTrue's error codes, which arrive in two spellings because the auth server
 * changed shape and both are still emitted depending on the endpoint: the modern
 * `{"code":400,"error_code":"invalid_credentials","msg":"…"}` and the
 * OAuth-styled `{"error":"invalid_grant","error_description":"…"}`. Reading only
 * one of them is how a client ends up showing „unknown error" for a wrong
 * password.
 */
const REFUSAL_BY_CODE: Readonly<Record<string, AuthRefusal>> = {
  invalid_credentials: "invalid_credentials",
  invalid_grant: "invalid_credentials",
  bad_jwt: "session_expired",
  session_not_found: "session_expired",
  session_expired: "session_expired",
  refresh_token_not_found: "session_expired",
  refresh_token_already_used: "session_expired",
  email_not_confirmed: "email_not_confirmed",
  mfa_verification_failed: "invalid_code",
  mfa_challenge_expired: "invalid_code",
  mfa_factor_not_found: "mfa_not_enrolled",
  over_request_rate_limit: "rate_limited",
  over_email_send_rate_limit: "rate_limited",
  mfa_ip_address_mismatch: "session_expired",
};

// ---------------------------------------------------------------------------
// The six requests
// ---------------------------------------------------------------------------
/**
 * Signing in — with K_auth, never with the password the user typed.
 *
 * `@nexus/sync-crypto`'s `kdf.ts` derives it: `authPassword` is 43 characters of
 * base64url over 32 bytes, and the password itself never leaves the client. This
 * function takes the derived value and has no way to compute it, which is the
 * point — nothing on the wire side of this package can be handed a password by
 * accident.
 */
export function signInRequest(email: string, authPassword: string): AuthRequest {
  return {
    method: "POST",
    path: "/token?grant_type=password",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, password: authPassword }),
  };
}

/** Exchanging a refresh token. Carries no bearer: the token IS the credential. */
export function refreshRequest(refreshToken: string): AuthRequest {
  return {
    method: "POST",
    path: "/token?grant_type=refresh_token",
    headers: JSON_HEADERS,
    body: JSON.stringify({ refresh_token: refreshToken }),
  };
}

/** The signed-in user, which is where GoTrue reports the account's factors. */
export function userRequest(accessToken: string): AuthRequest {
  return { method: "GET", path: "/user", headers: bearer(accessToken), body: null };
}

export function challengeRequest(accessToken: string, factorId: string): AuthRequest {
  assertFactorId(factorId);
  return {
    method: "POST",
    path: `/factors/${factorId}/challenge`,
    headers: bearer(accessToken),
    body: "{}",
  };
}

/**
 * Verifying the TOTP code, which is the call that steps the session up to `aal2`
 * — and, as this file's header says, the call that revokes every OTHER session
 * the account holds.
 */
export function verifyRequest(
  accessToken: string,
  factorId: string,
  challengeId: string,
  code: string,
): AuthRequest {
  assertFactorId(factorId);
  return {
    method: "POST",
    path: `/factors/${factorId}/verify`,
    headers: bearer(accessToken),
    body: JSON.stringify({ challenge_id: challengeId, code }),
  };
}

/**
 * Ending ONE session — `scope=local`, and the scope is the whole point.
 *
 * The default is `global`, which signs out every session on the account. The
 * only sign-out this product performs is of the ephemeral authorising session,
 * immediately after the mint, and doing that globally would take the device
 * session with it: sync would be enabled, and the desktop that just enabled it
 * would be signed out of the account it enabled.
 */
export function signOutRequest(accessToken: string): AuthRequest {
  return { method: "POST", path: "/logout?scope=local", headers: bearer(accessToken), body: null };
}

// ---------------------------------------------------------------------------
// The answers
// ---------------------------------------------------------------------------
/**
 * Reads a session out of a token response. Never throws — see
 * `parseSyncEnableResponse` for the same argument: a body is a server's, and a
 * server this client cannot parse is a fact to report rather than an exception
 * to let a hostile party raise inside the caller.
 */
export function parseSession(response: HttpResponse): AuthResult<AuthSession> {
  const record = readBody(response);
  if (response.status < 200 || response.status >= 300) return refusal(response, record);

  const accessToken = text(record["access_token"]);
  const refreshToken = text(record["refresh_token"]);
  if (accessToken === null || refreshToken === null) {
    return { ok: false, reason: "unknown", httpStatus: response.status, detail: null };
  }
  const claims = readTokenClaims(accessToken);
  // No `sub`, or no `session_id`, means this is not an access token — the anon
  // key parses as a JWT and has neither. Continuing would mean a „session" whose
  // device row could never be written, which fails much later and elsewhere.
  if (claims === null || claims.sub === null || claims.sessionId === null) {
    return { ok: false, reason: "unknown", httpStatus: response.status, detail: null };
  }
  return {
    ok: true,
    value: {
      accessToken,
      refreshToken,
      userId: claims.sub,
      sessionId: claims.sessionId,
      aal: claims.aal,
      expiresAt: claims.exp,
    },
  };
}

/** One TOTP factor, as much of it as any decision here depends on. */
export interface TotpFactor {
  readonly id: string;
  readonly friendlyName: string | null;
  /** `"verified"` or `"unverified"`. Only a verified factor can be challenged. */
  readonly status: string | null;
}

/**
 * The account's VERIFIED TOTP factors, from `GET /user`.
 *
 * Unverified factors are filtered out here rather than by the caller, because an
 * unverified factor is a half-finished enrolment somebody abandoned on another
 * device: challenging it fails, and offering it in a list would be offering a
 * second factor that cannot be used. An account with none of these is
 * `mfa_not_enrolled` — a state with a clear instruction attached, not an error.
 */
export function parseFactors(response: HttpResponse): AuthResult<readonly TotpFactor[]> {
  const record = readBody(response);
  if (response.status < 200 || response.status >= 300) return refusal(response, record);

  const raw = record["factors"];
  const factors = Array.isArray(raw) ? raw : [];
  const totp = factors
    .map(asRecord)
    .filter((factor): factor is Record<string, unknown> => factor !== null)
    .filter((factor) => factor["factor_type"] === "totp" && factor["status"] === "verified")
    .map((factor) => ({
      id: text(factor["id"]) ?? "",
      friendlyName: text(factor["friendly_name"]),
      status: text(factor["status"]),
    }))
    .filter((factor) => UUID.test(factor.id));

  return { ok: true, value: totp };
}

/** A challenge id, which the verify call has to quote back. */
export function parseChallengeId(response: HttpResponse): AuthResult<string> {
  const record = readBody(response);
  if (response.status < 200 || response.status >= 300) return refusal(response, record);
  const id = text(record["id"]);
  if (id === null || !UUID.test(id)) {
    return { ok: false, reason: "unknown", httpStatus: response.status, detail: null };
  }
  return { ok: true, value: id };
}

/**
 * Sign-out, where the ONLY outcome that matters is „this token is now dead".
 *
 * A 401 counts as success and that is deliberate: the session being gone is
 * precisely what was asked for, and reporting a failure would send a caller into
 * a retry loop trying to end something that has already ended. What is NOT
 * treated as success is a 5xx — that is a session still alive, and the caller
 * has a decision to make about it.
 */
export function parseSignOut(response: HttpResponse): AuthResult<null> {
  if ((response.status >= 200 && response.status < 300) || response.status === 401) {
    return { ok: true, value: null };
  }
  return refusal(response, readBody(response));
}

// ---------------------------------------------------------------------------
// The six calls
// ---------------------------------------------------------------------------
export async function signIn(
  port: AuthPort,
  email: string,
  authPassword: string,
): Promise<AuthResult<AuthSession>> {
  return parseSession(await port(signInRequest(email, authPassword)));
}

export async function refreshSession(
  port: AuthPort,
  refreshToken: string,
): Promise<AuthResult<AuthSession>> {
  return parseSession(await port(refreshRequest(refreshToken)));
}

export async function listTotpFactors(
  port: AuthPort,
  accessToken: string,
): Promise<AuthResult<readonly TotpFactor[]>> {
  return parseFactors(await port(userRequest(accessToken)));
}

export async function startChallenge(
  port: AuthPort,
  accessToken: string,
  factorId: string,
): Promise<AuthResult<string>> {
  return parseChallengeId(await port(challengeRequest(accessToken, factorId)));
}

/** Answers with the STEPPED-UP session, which replaces the one that was passed in. */
export async function verifyChallenge(
  port: AuthPort,
  accessToken: string,
  factorId: string,
  challengeId: string,
  code: string,
): Promise<AuthResult<AuthSession>> {
  return parseSession(await port(verifyRequest(accessToken, factorId, challengeId, code)));
}

export async function signOut(port: AuthPort, accessToken: string): Promise<AuthResult<null>> {
  return parseSignOut(await port(signOutRequest(accessToken)));
}

// ---------------------------------------------------------------------------
// Shared readers
// ---------------------------------------------------------------------------
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readBody(response: HttpResponse): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(response.body)) ?? {};
  } catch {
    return {};
  }
}

function refusal<T>(
  response: HttpResponse,
  record: Record<string, unknown>,
): Extract<AuthResult<T>, { ok: false }> {
  const code = text(record["error_code"]) ?? text(record["error"]);
  const detail = text(record["msg"]) ?? text(record["error_description"]) ?? text(record["message"]);
  const named = code === null ? undefined : REFUSAL_BY_CODE[code];
  // The status is the fallback, not the first answer: GoTrue answers 400 to a
  // wrong password AND to a malformed body, and only the code separates them.
  const byStatus: AuthRefusal =
    response.status === 429
      ? "rate_limited"
      : response.status === 401
        ? "session_expired"
        : response.status >= 500
          ? "unavailable"
          : "unknown";
  return { ok: false, reason: named ?? byStatus, httpStatus: response.status, detail };
}

function assertFactorId(factorId: string): void {
  if (!UUID.test(factorId)) {
    throw new TypeError(`sync: not a factor id: ${JSON.stringify(factorId)}`);
  }
}
