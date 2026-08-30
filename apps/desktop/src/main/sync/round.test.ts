/**
 * What this suite is for, and what it deliberately leaves to something else.
 *
 * `runSyncRound` composes pieces that are each proved elsewhere — the engine's
 * order in `round.test.ts`, the wire against a running PostgREST, the key set in
 * `contentKey.test.ts`, two real databases against one server in
 * `syncRound.test.ts`. What is only true HERE is the composition: which refusal
 * comes before which, that a round asks for nothing it does not need, and that a
 * refresh's rotation is written back.
 *
 * The ONE rule below that no test asserts is the erasure ordering — that the key
 * set is released after the round rather than at the return statement. It is not
 * observable from outside the function, and it is exactly what `check:zeroize`
 * exists to see: `keys.zeroize()` in a `finally` beside `return syncOnce(…)` is
 * the shape the gate refuses, which is why the method is named `zeroize` and not
 * `close`.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { bytesToBase64url, utf8, wrapKey, type SealedKey } from "@nexus/sync-crypto";
import { createFakeCryptoPort } from "@nexus/sync-crypto/testing";
import { fakeServer, type FakeServer } from "@nexus/sync-engine/testing";
import type { SyncStore } from "@nexus/sync-engine";
import {
  base64urlToBytea,
  type AuthPort,
  type AuthSession,
  type HttpPort,
  type HttpRequest,
} from "@nexus/sync-transport";
import type { SyncAccount } from "@nexus/db";

import { createSessionHolder, type SessionHolder } from "./session.js";
import type { CloudPorts } from "./port.js";
import { runSyncRound, type SyncRoundDeps } from "./round.js";

const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PROFILE = "11111111-2222-4333-8444-555555555555";
const DATA_KEY_HEX = "07".repeat(32);
const DATA_KEY = new Uint8Array(32).fill(7);

let crypto: ReturnType<typeof createFakeCryptoPort>;
let masterKey: Uint8Array;
let localWrap: SealedKey;
let server: FakeServer;

/** Every request the round made, whatever port it went through. */
let restPaths: string[];
let authPaths: string[];
let saved: string[];

/** `key_wraps` answers, in order; the last repeats. Everything else is the fake server. */
let wrapAnswers: { status: number; body: string }[];

const account = (overrides: Partial<SyncAccount> = {}): SyncAccount => ({
  userId: USER,
  email: "person@example.com",
  deviceId: "device-one",
  localWrap,
  refreshToken: "refresh-one",
  enabledAt: "2026-08-30T10:00:00.000Z",
  ...overrides,
});

/** An access token this build can read back: `parseSession` decodes the claims. */
const jwt = (exp: number): string =>
  `h.${bytesToBase64url(utf8(JSON.stringify({ sub: USER, session_id: "session-one", aal: "aal1", exp })))}.s`;

/** A live session whose token has hours left, so no round refreshes by accident. */
const session = (expiresAt: number): AuthSession => ({
  accessToken: jwt(expiresAt),
  refreshToken: "refresh-one",
  userId: USER,
  sessionId: "session-one",
  aal: "aal1",
  expiresAt,
});

const NOW = new Date("2026-08-30T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

function ports(): CloudPorts {
  const http: HttpPort = async (request: HttpRequest) => {
    restPaths.push(`${request.method} ${request.path}`);
    if (!request.path.startsWith("/key_wraps")) return server.port(request);
    const answer = wrapAnswers.shift() ?? wrapAnswers[wrapAnswers.length - 1];
    return answer ?? { status: 500, body: "" };
  };
  const auth: AuthPort = async (request) => {
    authPaths.push(request.path);
    return {
      status: 200,
      body: JSON.stringify({ access_token: jwt(NOW_SECONDS + 3600), refresh_token: "refresh-two" }),
    };
  };
  return {
    http,
    auth,
    functions: async () => ({ status: 500, body: "" }),
    httpAs: () => http,
  };
}

/** A store that answers everything and owes nothing: the round's composition is the subject. */
function emptyStore(): SyncStore {
  return {
    sweep: () => undefined,
    owed: () => [],
    owedCount: () => 0,
    confirmPushed: () => undefined,
    recordPushFailure: () => undefined,
    readState: () => null,
    apply: (requests) =>
      requests.map((request) => ({
        collection: request.collection,
        objectId: request.objectId,
        status: "written" as const,
      })),
    cursor: () => 0,
    advance: () => undefined,
    quarantine: () => undefined,
  };
}

interface Setup {
  readonly deps: SyncRoundDeps;
  readonly holder: SessionHolder;
}

function setup(overrides: Partial<SyncRoundDeps> = {}, signedIn = true): Setup {
  const holder = createSessionHolder();
  if (signedIn) holder.setSession(session(NOW_SECONDS + 3600));
  const deps: SyncRoundDeps = {
    crypto,
    ports: ports(),
    holder,
    account: () => account(),
    saveRefreshToken: (token) => saved.push(token),
    dataKeyHex: () => DATA_KEY_HEX,
    store: () => emptyStore(),
    now: () => NOW,
    ...overrides,
  };
  return { deps, holder };
}

/** One `key_wraps` row, as PostgREST serves it. */
async function wrapRow(key: Uint8Array, epoch: number): Promise<Record<string, unknown>> {
  const sealed = await wrapKey(crypto, masterKey, key, {
    purpose: "ck/master-key",
    userId: USER,
    profileId: PROFILE,
    epoch,
  });
  return {
    profile_id: PROFILE,
    epoch,
    nonce: base64urlToBytea(sealed.nonce),
    wrapped: base64urlToBytea(sealed.ciphertext),
    commit_tag: base64urlToBytea(sealed.commitment),
    disabled_at: null,
  };
}

const ok = (rows: readonly unknown[]): { status: number; body: string } => ({
  status: 200,
  body: JSON.stringify(rows),
});

beforeEach(async () => {
  crypto = createFakeCryptoPort({ seed: 7 });
  masterKey = crypto.randomBytes(32);
  localWrap = await wrapKey(crypto, DATA_KEY, masterKey, {
    purpose: "mk/local-data-key",
    userId: USER,
  });
  server = fakeServer();
  restPaths = [];
  authPaths = [];
  saved = [];
  wrapAnswers = [ok([await wrapRow(crypto.randomBytes(32), 1)])];
});

describe("the three refusals that cost nothing", () => {
  it("refuses cloud_off, and there is no port to refuse with", async () => {
    const { deps } = setup({ ports: null });
    const outcome = await runSyncRound(deps, { profileId: PROFILE });
    expect(outcome).toEqual({ kind: "blocked", reason: "cloud_off", detail: null });
    expect(restPaths).toEqual([]);
  });

  it("refuses not_enabled when this computer has no account row", async () => {
    const { deps } = setup({ account: () => null });
    const outcome = await runSyncRound(deps, { profileId: PROFILE });
    expect(outcome).toMatchObject({ kind: "blocked", reason: "not_enabled" });
    expect(restPaths).toEqual([]);
  });

  it("refuses locked rather than letting the throw out", async () => {
    const { deps } = setup({
      dataKeyHex: () => {
        throw new Error("the database is locked");
      },
    });
    const outcome = await runSyncRound(deps, { profileId: PROFILE });
    expect(outcome).toMatchObject({ kind: "blocked", reason: "locked" });
  });

  /**
   * The ORDER is the claim, and it is load-bearing: a refresh SPENDS the stored
   * refresh token. Asking for one on behalf of a device that is locked — and
   * therefore was never going to send anything — costs the account a token for
   * nothing.
   */
  it("checks all three before spending a refresh", async () => {
    const { deps, holder } = setup({
      dataKeyHex: () => {
        throw new Error("locked");
      },
    });
    // A token one second inside the margin: any round that reaches step 4 refreshes.
    holder.setSession(session(NOW_SECONDS + 1));

    await runSyncRound(deps, { profileId: PROFILE });
    expect(authPaths).toEqual([]);
    expect(saved).toEqual([]);
  });
});

describe("the session", () => {
  it("refuses signed_out when nothing is signed in", async () => {
    const { deps } = setup({}, false);
    const outcome = await runSyncRound(deps, { profileId: PROFILE });
    expect(outcome).toMatchObject({ kind: "blocked", reason: "signed_out" });
    expect(restPaths).toEqual([]);
  });

  /**
   * The reason `accessTokenForRound` exists. A loop that refreshes on a timer and
   * never writes the rotation back leaves `sync_account` holding a token that was
   * spent inside this process, and the next launch cannot resume.
   */
  it("writes back a refresh token the round rotated", async () => {
    const { deps, holder } = setup();
    holder.setSession(session(NOW_SECONDS + 1));

    const outcome = await runSyncRound(deps, { profileId: PROFILE, collections: ["notes"] });
    expect(outcome.kind).toBe("ran");
    expect(authPaths).toEqual(["/token?grant_type=refresh_token"]);
    expect(saved).toEqual(["refresh-two"]);
  });

  it("sends no auth request while the token is still good", async () => {
    const { deps } = setup();
    await runSyncRound(deps, { profileId: PROFILE, collections: ["notes"] });
    expect(authPaths).toEqual([]);
    expect(saved).toEqual([]);
  });
});

describe("the content key", () => {
  it("names forbidden as forbidden, so a scheduler stops rather than waits", async () => {
    wrapAnswers = [{ status: 403, body: JSON.stringify({ code: "42501" }) }];
    const { deps } = setup();
    const outcome = await runSyncRound(deps, { profileId: PROFILE });
    expect(outcome).toMatchObject({ kind: "blocked", reason: "forbidden" });
  });

  it("names a server fault offline, so a scheduler waits rather than stops", async () => {
    wrapAnswers = [{ status: 503, body: "" }];
    const { deps } = setup();
    const outcome = await runSyncRound(deps, { profileId: PROFILE });
    expect(outcome).toMatchObject({ kind: "blocked", reason: "offline" });
  });

  /**
   * Three different missing keys, one answer. They differ in which key is gone —
   * a fact for the log, carried in `detail` — and not in what waiting would do
   * about it, which is what a scheduler is asking.
   */
  it("names an unopenable master key key_unavailable, and says which in the detail", async () => {
    const { deps } = setup({ dataKeyHex: () => "aa".repeat(32) });
    const outcome = await runSyncRound(deps, { profileId: PROFILE });
    expect(outcome).toMatchObject({ kind: "blocked", reason: "key_unavailable" });
    if (outcome.kind !== "blocked") return;
    expect(outcome.detail).not.toBeNull();
  });

  it("reports the generations it could not open without failing the round", async () => {
    const foreign = createFakeCryptoPort({ seed: 99 }).randomBytes(32);
    const stale = await wrapKey(crypto, foreign, crypto.randomBytes(32), {
      purpose: "ck/master-key",
      userId: USER,
      profileId: PROFILE,
      epoch: 1,
    });
    wrapAnswers = [
      ok([
        {
          profile_id: PROFILE,
          epoch: 1,
          nonce: base64urlToBytea(stale.nonce),
          wrapped: base64urlToBytea(stale.ciphertext),
          commit_tag: base64urlToBytea(stale.commitment),
          disabled_at: "2026-08-01T00:00:00Z",
        },
        await wrapRow(crypto.randomBytes(32), 2),
      ]),
    ];

    const { deps } = setup();
    const outcome = await runSyncRound(deps, { profileId: PROFILE, collections: ["notes"] });
    expect(outcome).toMatchObject({ kind: "ran", minted: false, unopenable: [1] });
  });

  /**
   * Opened per round, and therefore released per round. The observable half of
   * the lifetime rule: nothing caches the set between rounds, so a second round
   * reads `key_wraps` again.
   */
  it("opens the key again on the next round rather than holding one", async () => {
    const row = await wrapRow(crypto.randomBytes(32), 1);
    wrapAnswers = [ok([row]), ok([row])];
    const { deps } = setup();

    await runSyncRound(deps, { profileId: PROFILE, collections: ["notes"] });
    await runSyncRound(deps, { profileId: PROFILE, collections: ["notes"] });

    expect(restPaths.filter((path) => path.includes("/key_wraps"))).toHaveLength(2);
  });
});

describe("the round itself", () => {
  it("runs, and answers the engine's report", async () => {
    const { deps } = setup();
    const outcome = await runSyncRound(deps, { profileId: PROFILE, collections: ["notes"] });

    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.report.halted).toBeNull();
    expect(outcome.report.owed).toBe(0);
  });

  /** The scheduler's hint reaches the engine: one collection asked for, one walked. */
  it("walks only the collections it was given", async () => {
    const { deps } = setup();
    await runSyncRound(deps, { profileId: PROFILE, collections: ["notes"] });

    const pulls = restPaths.filter((path) => path.startsWith("GET /sync_objects"));
    expect(pulls).toHaveLength(1);
    expect(pulls[0]).toContain("collection=eq.notes");
  });

  /** Nothing named means every collection, which is what makes the interval a guarantee. */
  it("walks everything when no hint is given", async () => {
    const { deps } = setup();
    await runSyncRound(deps, { profileId: PROFILE });

    const pulls = restPaths.filter((path) => path.startsWith("GET /sync_objects"));
    expect(pulls.length).toBeGreaterThan(20);
  });

  /**
   * The profile the round was asked for is the profile it binds — the store is
   * built from the input, never from anything remembered at construction, which
   * is what stops a round outliving a profile switch.
   */
  it("binds the store to the profile it was asked about", async () => {
    const asked: string[] = [];
    const { deps } = setup({
      store: (profileId) => {
        asked.push(profileId);
        return emptyStore();
      },
    });
    await runSyncRound(deps, { profileId: PROFILE, collections: ["notes"] });
    expect(asked).toEqual([PROFILE]);
  });
});
