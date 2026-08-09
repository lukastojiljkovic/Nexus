import { describe, expect, it } from "vitest";
import { bytesToBase64url, utf8 } from "@nexus/sync-crypto/web";
import {
  challengeRequest,
  parseChallengeId,
  parseFactors,
  parseSession,
  parseSignOut,
  readTokenClaims,
  refreshRequest,
  signInRequest,
  signOutRequest,
  userRequest,
  verifyRequest,
} from "./auth.js";
import type { HttpResponse } from "./http.js";

const FACTOR = "6f2f4f5e-1b5c-4d3a-9a4e-2c7f0a1b2c3d";
const CHALLENGE = "11111111-2222-4333-8444-555555555555";
const SESSION = "99999999-8888-4777-8666-555555555555";
const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

/**
 * A token with a real, decodable payload and a signature that is not one. The
 * reader verifies nothing by design — see its doc comment — so a placeholder
 * signature is the honest fixture rather than a shortcut.
 */
const token = (claims: Record<string, unknown>): string =>
  `header.${bytesToBase64url(utf8(JSON.stringify(claims)))}.signature`;

const access = token({ sub: USER, session_id: SESSION, aal: "aal1", exp: 1_800_000_000 });

const ok = (body: unknown): HttpResponse => ({ status: 200, body: JSON.stringify(body) });
const fail = (status: number, body: unknown): HttpResponse => ({
  status,
  body: JSON.stringify(body),
});

const session = (accessToken = access): HttpResponse =>
  ok({ access_token: accessToken, refresh_token: "refresh-value", token_type: "bearer" });

describe("readTokenClaims", () => {
  it("reads the four claims this client keeps its own books with", () => {
    expect(readTokenClaims(access)).toEqual({
      sub: USER,
      sessionId: SESSION,
      aal: "aal1",
      exp: 1_800_000_000,
    });
  });

  it("reports absent claims as null rather than inventing them", () => {
    expect(readTokenClaims(token({}))).toEqual({
      sub: null,
      sessionId: null,
      aal: null,
      exp: null,
    });
  });

  it("refuses anything that is not three dot-separated parts", () => {
    expect(readTokenClaims("")).toBeNull();
    expect(readTokenClaims("a.b")).toBeNull();
    expect(readTokenClaims("a.b.c.d")).toBeNull();
  });

  /**
   * The strict decoder is the point: a payload spelled with padding or with the
   * standard alphabet was not issued by this project's auth server, and the
   * tolerant decode would have taken it silently.
   */
  it("refuses a payload that is not canonical base64url", () => {
    const payload = bytesToBase64url(utf8(JSON.stringify({ sub: USER })));
    expect(readTokenClaims(`h.${payload}=.s`)).toBeNull();
    expect(readTokenClaims(`h.${payload}+.s`)).toBeNull();
  });

  it("refuses a payload that is not a JSON object", () => {
    expect(readTokenClaims(`h.${bytesToBase64url(utf8("[1,2]"))}.s`)).toBeNull();
    expect(readTokenClaims(`h.${bytesToBase64url(utf8("not json"))}.s`)).toBeNull();
  });
});

describe("the requests", () => {
  it("signs in with the derived password at the password grant", () => {
    const request = signInRequest("Ana@Example.com", "k-auth-value");
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/token?grant_type=password");
    expect(JSON.parse(request.body ?? "null")).toEqual({
      email: "Ana@Example.com",
      password: "k-auth-value",
    });
    // No bearer: there is no session yet to present one from.
    expect(request.headers["Authorization"]).toBeUndefined();
  });

  it("refreshes without a bearer, because the refresh token is the credential", () => {
    const request = refreshRequest("refresh-value");
    expect(request.path).toBe("/token?grant_type=refresh_token");
    expect(JSON.parse(request.body ?? "null")).toEqual({ refresh_token: "refresh-value" });
    expect(request.headers["Authorization"]).toBeUndefined();
  });

  it("reads the user with the session's own bearer", () => {
    expect(userRequest(access)).toEqual({
      method: "GET",
      path: "/user",
      headers: { "content-type": "application/json", Authorization: `Bearer ${access}` },
      body: null,
    });
  });

  it("challenges and verifies a factor by id", () => {
    expect(challengeRequest(access, FACTOR).path).toBe(`/factors/${FACTOR}/challenge`);
    const verify = verifyRequest(access, FACTOR, CHALLENGE, "123456");
    expect(verify.path).toBe(`/factors/${FACTOR}/verify`);
    expect(JSON.parse(verify.body ?? "null")).toEqual({
      challenge_id: CHALLENGE,
      code: "123456",
    });
  });

  /** A value interpolated into a path is checked where it is interpolated. */
  it("refuses a factor id that is not one", () => {
    for (const id of ["", "..", `${FACTOR}/../../user`, "not-a-uuid", `${FACTOR} `]) {
      expect(() => challengeRequest(access, id), JSON.stringify(id)).toThrow(TypeError);
      expect(() => verifyRequest(access, id, CHALLENGE, "123456")).toThrow(TypeError);
    }
  });

  /**
   * `scope=local`, and it is the whole call. The default is global, which would
   * take the device session with it — sync enabled, and the desktop that just
   * enabled it signed out.
   */
  it("signs out exactly one session", () => {
    const request = signOutRequest(access);
    expect(request.path).toBe("/logout?scope=local");
    expect(request.headers["Authorization"]).toBe(`Bearer ${access}`);
  });
});

describe("parseSession", () => {
  it("flattens a token response, taking the expiry from the token's own claim", () => {
    const result = parseSession(session());
    expect(result).toEqual({
      ok: true,
      value: {
        accessToken: access,
        refreshToken: "refresh-value",
        userId: USER,
        sessionId: SESSION,
        aal: "aal1",
        expiresAt: 1_800_000_000,
      },
    });
  });

  it("carries the assurance level through, which is how a step-up is checked", () => {
    const stepped = token({ sub: USER, session_id: SESSION, aal: "aal2", exp: 1 });
    const result = parseSession(session(stepped));
    expect(result.ok && result.value.aal).toBe("aal2");
  });

  /**
   * The anon key parses as a JWT and has neither claim. A „session" built from
   * it would fail much later, at a device row that could never be written.
   */
  it("refuses a token that carries no session", () => {
    expect(parseSession(session(token({ role: "anon" })))).toMatchObject({
      ok: false,
      reason: "unknown",
    });
  });

  it("refuses a 200 with no tokens in it", () => {
    expect(parseSession(ok({ user: { id: USER } }))).toMatchObject({ ok: false });
  });

  it("names a wrong password in both of GoTrue's error spellings", () => {
    expect(
      parseSession(fail(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid" })),
    ).toEqual({ ok: false, reason: "invalid_credentials", httpStatus: 400, detail: "Invalid" });

    expect(
      parseSession(fail(400, { error: "invalid_grant", error_description: "Invalid" })),
    ).toEqual({ ok: false, reason: "invalid_credentials", httpStatus: 400, detail: "Invalid" });
  });

  it("names the states a user can act on", () => {
    expect(parseSession(fail(400, { error_code: "email_not_confirmed" }))).toMatchObject({
      reason: "email_not_confirmed",
    });
    expect(parseSession(fail(400, { error_code: "mfa_verification_failed" }))).toMatchObject({
      reason: "invalid_code",
    });
    expect(parseSession(fail(422, { error_code: "mfa_challenge_expired" }))).toMatchObject({
      reason: "invalid_code",
    });
    expect(parseSession(fail(400, { error_code: "refresh_token_already_used" }))).toMatchObject({
      reason: "session_expired",
    });
  });

  /** The status is the fallback, never the first answer — 400 means four things. */
  it("falls back to the status when the body names no code", () => {
    expect(parseSession(fail(429, {}))).toMatchObject({ reason: "rate_limited" });
    expect(parseSession(fail(401, {}))).toMatchObject({ reason: "session_expired" });
    expect(parseSession(fail(503, {}))).toMatchObject({ reason: "unavailable" });
    expect(parseSession(fail(400, {}))).toMatchObject({ reason: "unknown" });
  });

  it("never throws on a body it cannot parse", () => {
    expect(parseSession({ status: 500, body: "<html>gateway</html>" })).toMatchObject({
      ok: false,
      reason: "unavailable",
    });
    expect(parseSession({ status: 200, body: "" })).toMatchObject({ ok: false });
  });
});

describe("parseFactors", () => {
  it("keeps the verified TOTP factors and nothing else", () => {
    const result = parseFactors(
      ok({
        id: USER,
        factors: [
          { id: FACTOR, factor_type: "totp", status: "verified", friendly_name: "Telefon" },
          { id: CHALLENGE, factor_type: "totp", status: "unverified", friendly_name: "Napola" },
          { id: SESSION, factor_type: "phone", status: "verified", friendly_name: "SMS" },
          { id: "not-a-uuid", factor_type: "totp", status: "verified" },
          "nonsense",
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      value: [{ id: FACTOR, friendlyName: "Telefon", status: "verified" }],
    });
  });

  /** „No second factor" is a state with an instruction attached, not an error. */
  it("reports an account with no factors as an empty list", () => {
    expect(parseFactors(ok({ id: USER }))).toEqual({ ok: true, value: [] });
    expect(parseFactors(ok({ id: USER, factors: [] }))).toEqual({ ok: true, value: [] });
  });

  it("refuses an expired session rather than calling it an empty list", () => {
    expect(parseFactors(fail(401, { msg: "invalid claim" }))).toMatchObject({
      ok: false,
      reason: "session_expired",
    });
  });
});

describe("parseChallengeId", () => {
  it("reads the id the verify call has to quote back", () => {
    expect(parseChallengeId(ok({ id: CHALLENGE, type: "totp" }))).toEqual({
      ok: true,
      value: CHALLENGE,
    });
  });

  it("refuses an id that is not one, rather than putting it in a path", () => {
    expect(parseChallengeId(ok({ id: "../../user" }))).toMatchObject({ ok: false });
    expect(parseChallengeId(ok({}))).toMatchObject({ ok: false });
  });
});

describe("parseSignOut", () => {
  it("accepts the 204 GoTrue actually sends", () => {
    expect(parseSignOut({ status: 204, body: "" })).toEqual({ ok: true, value: null });
  });

  /** The session being gone is precisely what was asked for. */
  it("accepts a 401, because a dead token is the outcome", () => {
    expect(parseSignOut({ status: 401, body: '{"msg":"invalid claim"}' })).toEqual({
      ok: true,
      value: null,
    });
  });

  /** A 5xx is a session still alive, and the caller has a decision to make. */
  it("refuses a server fault", () => {
    expect(parseSignOut({ status: 503, body: "{}" })).toMatchObject({
      ok: false,
      reason: "unavailable",
    });
  });
});
