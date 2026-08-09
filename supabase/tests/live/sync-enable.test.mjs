// `sync-enable` against a REAL stack — GoTrue, the edge runtime, PostgREST and
// Postgres — or nothing at all.
//
// WHY IT CANNOT BE FAKED. Everything this endpoint decides is decided from state
// only GoTrue writes: whether a session exists, what assurance it carries, which
// factors were presented, when the factor was armed relative to the session. A
// hand-minted JWT satisfies none of that — it names a `session_id` that is not in
// `auth.sessions`, which is precisely the design (`nexus_mk_mint` derives the
// account from a session row rather than trusting a claim). So a test that mocks
// the auth server tests the mock. This file signs in for real, enrols and
// verifies a real TOTP factor, and steps a real session up to `aal2`.
//
// ─── Opt-in, and silent when it is not opted into ───────────────────────────
//
// It SKIPS unless all three variables below are set, for the reason
// `packages/sync-transport/src/live.test.ts` states at length: a suite that
// cannot run without Docker would be deleted within a month. What keeps the skip
// honest is that CI's `database` job starts the stack anyway and feeds this file
// the stack's own keys out of `supabase status`.
//
//   NEXUS_LIVE_SUPABASE_URL   http://127.0.0.1:54321
//   NEXUS_LIVE_ANON_KEY       the project's anon key
//   NEXUS_LIVE_SERVICE_KEY    used ONLY to create and delete throwaway users and
//                             to read back the rows the mint wrote
//
// All three come out of `supabase status`; none is written down in this
// repository and none may be.
//
// ─── One account per outcome ────────────────────────────────────────────────
//
// An account can be minted exactly once — that is the entire point — so every
// case that needs a successful mint needs an account of its own. `provision`
// below builds one: a confirmed user with a verified TOTP factor, able to hand
// out fresh `aal1` sessions and fresh stepped-up `aal2` ones on demand.
//
// ─── THE STEP-UP KILLS THE ACCOUNT'S OTHER SESSIONS ─────────────────────────
//
// Measured here, against this GoTrue, and it dictates the order of every test
// below: verifying an MFA factor revokes every OTHER session the user holds.
// The stepped-up session survives, sessions created AFTERWARDS survive, and
// anything signed in beforehand is dead — `/auth/v1/user` answers 403 for it.
//
// So the authorising session must be obtained and stepped up FIRST, and the
// device session signed in AFTER. Backwards, the desktop mints a device session,
// immediately destroys it by stepping up, and gets a 401 whose text says nothing
// about ordering. It is exactly the shape of fact this file exists for: nothing
// in the code reads as if it depends on it, and a GoTrue upgrade that changed it
// would otherwise be found by a user.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

const URL_BASE = process.env["NEXUS_LIVE_SUPABASE_URL"];
const ANON = process.env["NEXUS_LIVE_ANON_KEY"];
const SERVICE = process.env["NEXUS_LIVE_SERVICE_KEY"];
const LIVE = URL_BASE !== undefined && ANON !== undefined && SERVICE !== undefined;

async function readJson(response) {
  const text = await response.text();
  try {
    return { status: response.status, headers: response.headers, body: JSON.parse(text) };
  } catch {
    return { status: response.status, headers: response.headers, body: text };
  }
}

const auth = (path, init = {}, token = ANON) =>
  fetch(`${URL_BASE}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  }).then(readJson);

const rest = (path) =>
  fetch(`${URL_BASE}/rest/v1${path}`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  }).then(readJson);

/** RFC 4648 base32, which is how GoTrue hands back a TOTP secret. */
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238, SHA-1, six digits, thirty-second step — GoTrue's defaults. */
function totp(secret) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

const claimsOf = (token) =>
  JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));

const users = [];

/**
 * A confirmed account with a verified TOTP factor armed BEFORE any session this
 * helper hands out — which is what `NX303` requires and what an honest desktop
 * satisfies without trying, since a user arms their factor on the web long
 * before they enable sync on a machine.
 */
async function provision() {
  const email = `live-${randomUUID()}@nexus.test`;
  const password = `pw-${randomUUID()}`;
  const created = await auth(
    "/admin/users",
    { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) },
    SERVICE,
  );
  assert.equal(created.status, 200, `admin user creation failed: ${JSON.stringify(created.body)}`);
  const userId = created.body.id;
  users.push(userId);

  const signIn = async () => {
    const session = await auth("/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    assert.equal(session.status, 200, `sign-in failed: ${JSON.stringify(session.body)}`);
    return session.body.access_token;
  };

  // The factor is enrolled by a session that has none, which is the only way a
  // first factor can ever be armed — see the README's measured note on what
  // `aal2` is worth. That session is then discarded.
  const bootstrap = await signIn();
  const enrolled = await auth(
    "/factors",
    { method: "POST", body: JSON.stringify({ factor_type: "totp", friendly_name: "live" }) },
    bootstrap,
  );
  assert.equal(enrolled.status, 200, `enrol failed: ${JSON.stringify(enrolled.body)}`);
  const factorId = enrolled.body.id;
  const secret = enrolled.body.totp.secret;

  const stepUp = async (token) => {
    const challenge = await auth(`/factors/${factorId}/challenge`, { method: "POST" }, token);
    assert.equal(challenge.status, 200, `challenge failed: ${JSON.stringify(challenge.body)}`);
    const verified = await auth(
      `/factors/${factorId}/verify`,
      { method: "POST", body: JSON.stringify({ challenge_id: challenge.body.id, code: totp(secret) }) },
      token,
    );
    assert.equal(verified.status, 200, `verify failed: ${JSON.stringify(verified.body)}`);
    return verified.body.access_token;
  };

  await stepUp(bootstrap);

  return {
    userId,
    signIn,
    /** A fresh session, signed in and then stepped up to aal2. */
    authorisingSession: async () => stepUp(await signIn()),
  };
}

const b64 = (length, fill) => Buffer.alloc(length, fill).toString("base64url");

const KDF_PARAMS = { memoryKiB: 65536, iterations: 3, parallelism: 1 };

function payload(overrides = {}) {
  return {
    device_name_nonce: b64(24, 0x11),
    device_name_ciphertext: b64(64, 0x22),
    kwrap: {
      nonce: b64(24, 0x31),
      wrapped: b64(48, 0x32),
      commit_tag: b64(32, 0x33),
      kdf_params: { ...KDF_PARAMS },
    },
    src: {
      nonce: b64(24, 0x41),
      wrapped: b64(48, 0x42),
      commit_tag: b64(32, 0x43),
      kdf_salt: b64(16, 0x44),
      kdf_params: { ...KDF_PARAMS },
    },
    ...overrides,
  };
}

function enable({ device, authorising, body = payload(), headers = {} }) {
  return fetch(`${URL_BASE}/functions/v1/sync-enable`, {
    method: "POST",
    headers: {
      apikey: ANON,
      ...(device === undefined ? {} : { Authorization: `Bearer ${device}` }),
      ...(authorising === undefined ? {} : { "x-nexus-authorising-token": authorising }),
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }).then(readJson);
}

describe(
  "sync-enable, against a real Supabase",
  { skip: LIVE ? false : "NEXUS_LIVE_SUPABASE_URL / _ANON_KEY / _SERVICE_KEY are not set" },
  () => {
    let account;
    let mintedDeviceSession;

    before(async () => {
      account = await provision();
    });

    after(async () => {
      for (const id of users) {
        await auth(`/admin/users/${id}`, { method: "DELETE" }, SERVICE);
      }
    });

    test("stepping a session up to aal2 revokes the account's other sessions", async () => {
      // The platform fact the whole ordering below rests on. Asserted first so
      // that a GoTrue change here fails as itself rather than as six confusing
      // 401s in tests that are about something else.
      const fresh = await provision();
      const doomed = await fresh.signIn();
      assert.equal((await auth("/user", {}, doomed)).status, 200, "alive before the step-up");

      const authorising = await fresh.authorisingSession();
      assert.equal((await auth("/user", {}, doomed)).status, 403, "and dead after it");
      assert.equal((await auth("/user", {}, authorising)).status, 200, "the stepped-up one lives");
      assert.equal(
        (await auth("/user", {}, await fresh.signIn())).status,
        200,
        "and so does one signed in afterwards — which is why the device session comes last",
      );
    });

    test("mints the master key and registers the desktop that did it", async () => {
      // AUTHORISING SESSION FIRST, DEVICE SESSION SECOND, and never the other way
      // round: the step-up above would revoke a device session signed in before
      // it. This is the order the desktop client has to follow too.
      const authorising = await account.authorisingSession();
      assert.equal(claimsOf(authorising).aal, "aal2");

      const device = await account.signIn();
      mintedDeviceSession = claimsOf(device).session_id;
      assert.equal(claimsOf(device).aal, "aal1", "the device session must stay aal1");
      assert.notEqual(claimsOf(authorising).session_id, mintedDeviceSession);

      const response = await enable({ device, authorising });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.status, "minted");
      assert.match(response.body.device_id, /^[0-9a-f-]{36}$/);
      // An account-specific answer must never be cached by anything in between.
      assert.equal(response.headers.get("cache-control"), "no-store");

      const wraps = await rest(
        `/key_wraps?user_id=eq.${account.userId}&select=kind,kdf_salt,kdf_params,profile_id,epoch&order=kind`,
      );
      assert.equal(wraps.status, 200);
      assert.deepEqual(
        wraps.body.map((row) => row.kind),
        ["mk_under_kwrap", "mk_under_src"],
        "both wraps, or the account has no recovery path and no way to acquire one",
      );
      // The password wrap carries no salt: K_wrap's salt is derived from the
      // email, so storing one would imply a derivation this product does not do.
      assert.equal(wraps.body[0].kdf_salt, null);
      assert.equal(wraps.body[1].kdf_salt, `\\x${"44".repeat(16)}`);
      for (const row of wraps.body) {
        assert.deepEqual(row.kdf_params, KDF_PARAMS);
        assert.equal(row.profile_id, null, "a master-key wrap belongs to no profile");
        assert.equal(row.epoch, null, "and to no content-key generation");
      }

      const devices = await rest(
        `/devices?user_id=eq.${account.userId}&select=id,platform,session_id,revoked_at`,
      );
      assert.equal(devices.body.length, 1);
      assert.equal(devices.body[0].platform, "desktop");
      assert.equal(devices.body[0].session_id, mintedDeviceSession);
      assert.equal(devices.body[0].revoked_at, null);
      assert.equal(devices.body[0].id, response.body.device_id);
    });

    test("a second device is told already_minted and is given NOTHING else", async () => {
      const authorising = await account.authorisingSession();
      const device = await account.signIn();

      const response = await enable({ device, authorising });
      assert.equal(response.status, 200);
      assert.equal(response.body.status, "already_minted");
      // The whole security argument of the mint is in this assertion. A loser
      // that received the existing wrap could open it with the K_wrap it already
      // derived — and „it opened under my password key" says nothing about who
      // CHOSE the key inside. A phished password would become a permanent silent
      // compromise. So: no ciphertext, no salt, no parameters, no device row.
      assert.equal(response.body.device_id, null);
      assert.deepEqual(Object.keys(response.body).sort(), ["device_id", "status"]);

      const devices = await rest(`/devices?user_id=eq.${account.userId}&select=session_id`);
      assert.deepEqual(
        devices.body.map((row) => row.session_id),
        [mintedDeviceSession],
        "the losing device gets no row, so its session stays inert",
      );
    });

    test("the same session presented twice is refused", async () => {
      const device = await account.signIn();
      const response = await enable({ device, authorising: device });
      assert.equal(response.status, 400);
      assert.equal(response.body.error, "sessions_must_differ");
    });

    test("an aal1 session cannot authorise a mint", async () => {
      const fresh = await provision();
      const device = await fresh.signIn();
      const authorising = await fresh.signIn(); // a real session, never stepped up
      const response = await enable({ device, authorising });
      assert.equal(response.status, 403);
      assert.equal(response.body.error, "second_factor_required");
    });

    test("a factor armed after the session does not authorise it", async () => {
      // The account is provisioned the WRONG way round on purpose: sign in
      // first, arm the factor inside that session. It reaches `aal2` with a
      // `totp` claim and is still refused, because the factor is younger than
      // the session — which is the sequence an attacker who phished a password
      // and enrolled their own factor would produce.
      const email = `live-${randomUUID()}@nexus.test`;
      const password = `pw-${randomUUID()}`;
      const created = await auth(
        "/admin/users",
        { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) },
        SERVICE,
      );
      users.push(created.body.id);

      const signIn = async () => {
        const session = await auth("/token?grant_type=password", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        return session.body.access_token;
      };

      const authorising = await signIn();
      const enrolled = await auth(
        "/factors",
        { method: "POST", body: JSON.stringify({ factor_type: "totp", friendly_name: "late" }) },
        authorising,
      );
      const challenge = await auth(
        `/factors/${enrolled.body.id}/challenge`,
        { method: "POST" },
        authorising,
      );
      const verified = await auth(
        `/factors/${enrolled.body.id}/verify`,
        {
          method: "POST",
          body: JSON.stringify({
            challenge_id: challenge.body.id,
            code: totp(enrolled.body.totp.secret),
          }),
        },
        authorising,
      );
      assert.equal(claimsOf(verified.body.access_token).aal, "aal2", "it really did step up");

      const response = await enable({
        device: await signIn(),
        authorising: verified.body.access_token,
      });
      assert.equal(response.status, 403);
      assert.equal(response.body.error, "factor_must_predate_session");
    });

    test("a signed-out authorising session is refused by the auth server itself", async () => {
      // MEASURED, and worth writing down because it is not what the code reads
      // like: this comes back 401 from the token check, NOT 403 from the mint's
      // NX301. GoTrue's `/user` rejects a token whose session has been deleted,
      // so a revoked session never reaches the database at all. NX301 remains the
      // wall for an EXPIRED session and for any future caller that does not go
      // through this endpoint — it is not dead code, it is just not the first
      // thing a revoked session meets.
      const fresh = await provision();
      const authorising = await fresh.authorisingSession();
      await auth("/logout?scope=local", { method: "POST" }, authorising);

      const response = await enable({ device: await fresh.signIn(), authorising });
      assert.equal(response.status, 401);
      assert.equal(response.body.error, "unauthenticated");
    });

    test("neither token may be missing, and the anon key is not a session", async () => {
      const device = await account.signIn();
      assert.equal((await enable({ device })).status, 401);
      assert.equal((await enable({ device, authorising: "not.a.jwt" })).status, 401);
      // The anon key IS a JWT this project signed, so the platform's
      // `verify_jwt` gate is satisfied by it. It carries no `session_id`, which
      // is what the function's own filter refuses it on.
      const anonAsToken = await enable({ device, authorising: ANON });
      assert.equal(anonAsToken.status, 401);
      assert.equal(anonAsToken.body.error, "unauthenticated");
    });

    test("a salt on the password wrap is refused rather than dropped", async () => {
      const fresh = await provision();
      const authorising = await fresh.authorisingSession();
      const device = await fresh.signIn();

      const salted = payload();
      salted.kwrap.kdf_salt = b64(16, 0x55);
      const response = await enable({ device, authorising, body: salted });
      assert.equal(response.status, 400);
      assert.equal(response.body.error, "bad_request");

      // An explicit `null` is what a client serialising an optional field
      // writes, and it says the same thing as leaving the key out. It must not
      // be the difference between a working sync and a 400 with no detail.
      const explicitNull = payload();
      explicitNull.kwrap.kdf_salt = null;
      const accepted = await enable({ device, authorising, body: explicitNull });
      assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
      assert.equal(accepted.body.status, "minted");
    });

    test("kdf_params takes exactly three integers and no other key", async () => {
      const fresh = await provision();
      const device = await fresh.signIn();
      const authorising = await fresh.authorisingSession();

      const extra = payload();
      extra.src.kdf_params = { ...KDF_PARAMS, note: 1 };
      assert.equal((await enable({ device, authorising, body: extra })).status, 400);

      const fractional = payload();
      fractional.src.kdf_params = { ...KDF_PARAMS, iterations: 3.5 };
      assert.equal((await enable({ device, authorising, body: fractional })).status, 400);
    });

    test("the cost floor is the DATABASE's answer, not this function's", async () => {
      // Deliberately NOT rejected by the Edge Function: the floor lives in
      // `key_wraps_kdf_params_floor` and the ceiling in
      // `key_wraps_kdf_params_ceiling`, and restating either in the function
      // would make three places responsible for one number. This assertion is
      // what proves the payload really does reach the constraint.
      const fresh = await provision();
      const authorising = await fresh.authorisingSession();
      const device = await fresh.signIn();

      const low = payload();
      low.kwrap.kdf_params = { memoryKiB: 1024, iterations: 3, parallelism: 1 };
      const belowFloor = await enable({ device, authorising, body: low });
      assert.equal(belowFloor.status, 400);
      assert.equal(belowFloor.body.error, "rejected_by_schema");
      assert.match(belowFloor.body.detail, /key_wraps_kdf_params_floor/);

      const high = payload();
      high.src.kdf_params = { memoryKiB: 65536, iterations: 3, parallelism: 64 };
      const aboveCeiling = await enable({ device, authorising, body: high });
      assert.equal(aboveCeiling.status, 400);
      assert.equal(aboveCeiling.body.error, "rejected_by_schema");
      assert.match(aboveCeiling.body.detail, /key_wraps_kdf_params_ceiling/);

      // And neither attempt left anything behind — a partially minted account
      // would be the worst outcome of the three.
      const wraps = await rest(`/key_wraps?user_id=eq.${fresh.userId}&select=kind`);
      assert.deepEqual(wraps.body, []);
    });

    test("an oversized body is refused before it is parsed", async () => {
      const device = await account.signIn();
      const response = await enable({
        device,
        authorising: await account.authorisingSession(),
        body: JSON.stringify({ padding: "x".repeat(5000) }),
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.detail, "body too large");
    });

    test("neither endpoint is callable from a browsing context", async () => {
      // The `Origin` refusal is the control; absent CORS headers only stop a page
      // READING the response, and both of these change state. Asserted on
      // `pair-complete` as well because the rule was added there at the same
      // time — and because it is the one line that proves that function still
      // loads after its helpers moved into `_shared/http.ts`.
      // The bearer is the ANON KEY, and it has to be: `verify_jwt = true` makes
      // the platform reject anything that is not a JWT this project signed,
      // BEFORE the function runs — so a page holding only the publicly printed
      // anon key is exactly the caller that can reach the handler, and exactly
      // the caller this refusal is for.
      const browser = { Origin: "https://evil.example" };
      const enabled = await enable({ device: ANON, authorising: ANON, headers: browser });
      assert.equal(enabled.status, 400);
      assert.equal(enabled.body.detail, "not callable from a browser");

      const paired = await fetch(`${URL_BASE}/functions/v1/pair-complete`, {
        method: "POST",
        headers: { apikey: ANON, "content-type": "application/json", ...browser },
        body: "{}",
      }).then(readJson);
      assert.equal(paired.status, 400);
      assert.equal(paired.body.detail, "not callable from a browser");
    });

    test("only POST reaches the handler", async () => {
      const response = await fetch(`${URL_BASE}/functions/v1/sync-enable`, {
        method: "GET",
        headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
      }).then(readJson);
      assert.equal(response.status, 400);
      assert.equal(response.body.detail, "POST only");
    });
  },
);
