// `device-register` against a REAL stack — GoTrue, the edge runtime, PostgREST
// and Postgres — or nothing at all.
//
// WHY IT CANNOT BE FAKED, and why it needs a full mint first. Everything this
// endpoint decides comes from state only GoTrue writes (does the session exist,
// what assurance does it carry) and from a row only `nexus_mk_mint` can write
// (`private.mk_verifiers`, which no client and no PostgREST request can reach).
// So there is no way to arrange the fixture except to enable sync for real, and
// no way to test the interesting case except to then destroy the device session
// the way the product actually destroys it.
//
// ─── THE SEQUENCE THIS FILE EXISTS TO PROVE ────────────────────────────────
//
//   1. an account enables sync           → MK minted, desktop row bound to S1
//   2. S1 dies                           → sign-out, which is what a second
//                                          machine's step-up does to it too
//   3. the desktop signs in again        → S2, aal1, and no device row
//   4. it presents the proof             → a live desktop row bound to S2
//
// Without step 4 the machine is stranded: it holds MK on its own disk and is
// refused every read and every write. Migration 013's header has the argument
// for why step 4 costs MK and not a second factor.
//
// ─── Opt-in, and silent when it is not opted into ──────────────────────────
//
// Same three variables and the same reasoning as `sync-enable.test.mjs`: a suite
// that cannot run without Docker gets deleted within a month, and CI's `database`
// job starts the stack anyway and feeds this file the keys out of
// `supabase status`. None of them is written down in this repository.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

import { awaitFunctions, callFunction } from "./ready.mjs";

const URL_BASE = process.env["NEXUS_LIVE_SUPABASE_URL"];
const ANON = process.env["NEXUS_LIVE_ANON_KEY"];
const SERVICE = process.env["NEXUS_LIVE_SERVICE_KEY"];
const LIVE = URL_BASE !== undefined && ANON !== undefined && SERVICE !== undefined;

async function readJson(response) {
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
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

const b64 = (length, fill) => Buffer.alloc(length, fill).toString("base64url");

/** The proof this suite's accounts mint with, and therefore the only one that opens them. */
const PROOF = b64(32, 0x51);
const KDF_PARAMS = { memoryKiB: 65536, iterations: 3, parallelism: 1 };

const users = [];

async function provision() {
  const email = `live-${randomUUID()}@nexus.test`;
  const password = `pw-${randomUUID()}`;
  const created = await auth(
    "/admin/users",
    { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) },
    SERVICE,
  );
  assert.equal(created.status, 200, `admin user creation failed: ${JSON.stringify(created.body)}`);
  users.push(created.body.id);

  const signIn = async () => {
    const session = await auth("/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    assert.equal(session.status, 200, `sign-in failed: ${JSON.stringify(session.body)}`);
    return session.body.access_token;
  };

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
      {
        method: "POST",
        body: JSON.stringify({ challenge_id: challenge.body.id, code: totp(secret) }),
      },
      token,
    );
    assert.equal(verified.status, 200, `verify failed: ${JSON.stringify(verified.body)}`);
    return verified.body.access_token;
  };

  await stepUp(bootstrap);
  return { userId: created.body.id, signIn, stepUp };
}

function register({ device, body, headers = {} }) {
  return callFunction(`${URL_BASE}/functions/v1/device-register`, {
    method: "POST",
    headers: {
      apikey: ANON,
      ...(device === undefined ? {} : { Authorization: `Bearer ${device}` }),
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }).then(readJson);
}

const namePayload = (overrides = {}) => ({
  mk_verifier: PROOF,
  device_name_nonce: b64(24, 0x61),
  device_name_ciphertext: b64(64, 0x62),
  ...overrides,
});

/**
 * An account that has enabled sync, in the order the product enables it — the
 * authorising session first, because stepping up revokes everything older.
 */
async function enabled() {
  const account = await provision();
  const authorising = await account.stepUp(await account.signIn());
  const deviceToken = await account.signIn();
  const minted = await callFunction(`${URL_BASE}/functions/v1/sync-enable`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${deviceToken}`,
      "x-nexus-authorising-token": authorising,
      "content-type": "application/json",
    },
    body: JSON.stringify({
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
      mk_verifier: PROOF,
    }),
  }).then(readJson);
  assert.equal(minted.status, 200, `mint failed: ${JSON.stringify(minted.body)}`);
  assert.equal(minted.body.status, "minted");
  return { ...account, deviceToken, deviceId: minted.body.device_id };
}

describe(
  "device-register, against a real Supabase",
  { skip: LIVE ? false : "NEXUS_LIVE_SUPABASE_URL / _ANON_KEY / _SERVICE_KEY are not set" },
  () => {
    let account;

    before(async () => {
      // BOTH functions, because this suite calls both and each boots its own
      // worker — `enabled()` mints through `sync-enable` before a single test
      // touches `device-register`. `ready.mjs` carries the argument for why a
      // suite that asserts on what a function RETURNS may not open with a
      // request that is also the runtime's first.
      await awaitFunctions(URL_BASE, ANON, ["sync-enable", "device-register"]);
      account = await enabled();
    });

    after(async () => {
      for (const id of users) {
        await auth(`/admin/users/${id}`, { method: "DELETE" }, SERVICE);
      }
    });

    test("a signed-out session really does disappear from auth.sessions", async () => {
      // The platform fact the whole feature rests on: „stranded" is „the devices
      // row names a session id with no row behind it", and the function retires
      // those rows by looking for exactly that absence. Asserted first, so a
      // GoTrue change here fails as itself rather than as a confusing 403 in a
      // test about something else.
      const throwaway = await provision();
      const token = await throwaway.signIn();
      assert.equal((await auth("/user", {}, token)).status, 200, "alive before the sign-out");
      await auth("/logout", { method: "POST" }, token);
      assert.notEqual((await auth("/user", {}, token)).status, 200, "dead after it");
    });

    test("a valid session without the proof is refused, which is the whole design", async () => {
      // This caller holds the password — it has just signed in with it — and not
      // the master key. Handing it a desktop row would hand it authority over
      // `mk_under_kwrap`, and K_wrap comes from that same password.
      await auth("/logout", { method: "POST" }, account.deviceToken);
      const fresh = await account.signIn();
      const answer = await register({
        device: fresh,
        body: namePayload({ mk_verifier: b64(32, 0xff) }),
      });
      assert.equal(answer.status, 403);
      assert.equal(answer.body.error, "proof_rejected");
      account.deviceToken = fresh;
    });

    test("the right proof registers the desktop and retires the stranded row", async () => {
      const answer = await register({ device: account.deviceToken, body: namePayload() });
      assert.equal(answer.status, 200, JSON.stringify(answer.body));
      assert.match(answer.body.device_id, /^[0-9a-f-]{36}$/);
      assert.notEqual(answer.body.device_id, account.deviceId, "a NEW row, not the old one");

      const rows = await rest(
        `/devices?user_id=eq.${account.userId}&select=id,platform,revoked_at&order=created_at`,
      );
      assert.equal(rows.status, 200);
      assert.equal(rows.body.length, 2, "the old row is kept as proof its session is dead");
      const [old_, current] = rows.body;
      assert.equal(old_.id, account.deviceId);
      assert.notEqual(old_.revoked_at, null, "the stranded row is retired in the same call");
      assert.equal(current.id, answer.body.device_id);
      assert.equal(current.revoked_at, null);
      // The caller never says `desktop`; nothing a client sends can. This and the
      // mint are the only two writers that may.
      assert.equal(current.platform, "desktop");
      account.registeredId = answer.body.device_id;
    });

    test("the same call again answers with the row it already wrote", async () => {
      const answer = await register({ device: account.deviceToken, body: namePayload() });
      assert.equal(answer.status, 200);
      assert.equal(answer.body.device_id, account.registeredId);
      const rows = await rest(
        `/devices?user_id=eq.${account.userId}&revoked_at=is.null&select=id`,
      );
      assert.equal(rows.body.length, 1, "and wrote no second row");
    });

    test("a stepped-up session may not become a desktop", async () => {
      // `aal` survives every refresh, so an aal2 token in a `devices` row is
      // permanent browser authority sitting on a laptop's disk.
      const stepped = await account.stepUp(await account.signIn());
      const answer = await register({ device: stepped, body: namePayload() });
      assert.equal(answer.status, 403);
      assert.equal(answer.body.error, "session_not_aal1");
    });

    test("an account that never minted has nothing to prove possession of", async () => {
      const fresh = await provision();
      const answer = await register({ device: await fresh.signIn(), body: namePayload() });
      assert.equal(answer.status, 409);
      assert.equal(answer.body.error, "not_enabled");
    });

    test("no token at all is 401, and no oracle", async () => {
      const answer = await register({ body: namePayload() });
      assert.equal(answer.status, 401);
      assert.equal(answer.body.error, "unauthenticated");
    });

    test("a proof of the wrong length is refused as a shape, before any account is touched", async () => {
      const fresh = await provision();
      const answer = await register({
        device: await fresh.signIn(),
        body: namePayload({ mk_verifier: b64(31, 0x51) }),
      });
      assert.equal(answer.status, 400);
    });

    test("it is not callable from a browsing context", async () => {
      // A browser asking to be called a desktop. The `Origin` refusal is the
      // control; absent CORS headers would only stop it reading the answer.
      const fresh = await provision();
      const answer = await register({
        device: await fresh.signIn(),
        body: namePayload(),
        headers: { Origin: "https://nexus.example" },
      });
      assert.equal(answer.status, 400);
    });

    test("only POST reaches the handler", async () => {
      const answer = await callFunction(`${URL_BASE}/functions/v1/device-register`, {
        method: "GET",
        headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
      }).then(readJson);
      assert.equal(answer.status, 400);
    });
  },
);
