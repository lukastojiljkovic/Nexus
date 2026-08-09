import { beforeEach, describe, expect, it } from "vitest";
import {
  SYNC_RECOVERY_KDF_PARAMS,
  WEB_KDF_PARAMS,
  bytesToBase64url,
  openDeviceName,
  prepareSyncEnable,
  unwrapKey,
  utf8,
} from "@nexus/sync-crypto";
import { createFakeCryptoPort } from "@nexus/sync-crypto/testing";
import { base64urlToBytea, type AuthPort, type FunctionPort, type HttpPort } from "@nexus/sync-transport";

import { adoptWithRecoveryCode, type AdoptSyncResult } from "./adopt.js";
import type { CloudPorts } from "./port.js";
import { createSessionHolder } from "./session.js";

const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FACTOR = "6f2f4f5e-1b5c-4d3a-9a4e-2c7f0a1b2c3d";
const CHALLENGE = "11111111-2222-4333-8444-555555555555";
const BOOTSTRAP = "22222222-3333-4444-8555-666666666666";
const DATA_KEY = new Uint8Array(32).fill(7);
const NOW = new Date("2026-08-09T18:00:00.000Z");

const token = (sessionId: string, aal: string): string =>
  `h.${bytesToBase64url(
    utf8(JSON.stringify({ sub: USER, session_id: sessionId, aal, exp: 1_800_000_000 })),
  )}.s`;

const sessionBody = (sessionId: string, aal: string): string =>
  JSON.stringify({ access_token: token(sessionId, aal), refresh_token: `refresh-${sessionId}` });

interface Call {
  readonly root: "auth" | "functions" | "rest";
  readonly path: string;
  readonly bearer: string | null;
  readonly body: string | null;
}

interface HarnessOptions {
  readonly steppedAal?: string;
  readonly insertStatus?: number;
  readonly wrapRows?: string;
  readonly registerStatus?: number;
  readonly registerBody?: string;
}

/** What `sync-enable` minted on the FIRST computer, which this one is adopting. */
let minted: Awaited<ReturnType<typeof prepareSyncEnable>>;
let recoveryCode: string;
let crypto: ReturnType<typeof createFakeCryptoPort>;

function harness(options: HarnessOptions = {}): {
  ports: CloudPorts;
  calls: Call[];
  holder: ReturnType<typeof createSessionHolder>;
} {
  const calls: Call[] = [];
  let signIns = 0;

  const auth: AuthPort = async (request) => {
    calls.push({ root: "auth", path: request.path, bearer: null, body: request.body });
    if (request.path.startsWith("/token?grant_type=password")) {
      signIns += 1;
      return { status: 200, body: sessionBody(`session-${signIns}`, "aal1") };
    }
    if (request.path === "/user") {
      return {
        status: 200,
        body: JSON.stringify({
          id: USER,
          factors: [{ id: FACTOR, factor_type: "totp", status: "verified" }],
        }),
      };
    }
    if (request.path.endsWith("/challenge")) {
      return { status: 200, body: JSON.stringify({ id: CHALLENGE }) };
    }
    if (request.path.endsWith("/verify")) {
      return { status: 200, body: sessionBody("session-1", options.steppedAal ?? "aal2") };
    }
    if (request.path === "/logout?scope=local") return { status: 204, body: "" };
    throw new Error(`unexpected auth path ${request.path}`);
  };

  const functions: FunctionPort = async (request) => {
    calls.push({ root: "functions", path: request.name, bearer: null, body: request.body });
    return {
      status: options.registerStatus ?? 200,
      body: options.registerBody ?? JSON.stringify({ device_id: "device-9" }),
    };
  };

  /** The default REST port. Reaching it at all would mean the aal1 token was used. */
  const http: HttpPort = async () => {
    throw new Error("adoption must present the stepped-up token, not the holder's");
  };

  const httpAs = (accessToken: string): HttpPort => {
    return async (request) => {
      calls.push({
        root: "rest",
        path: request.path,
        bearer: accessToken,
        body: request.body,
      });
      if (request.method === "POST") {
        return {
          status: options.insertStatus ?? 201,
          body: options.insertStatus === undefined ? JSON.stringify([{ id: BOOTSTRAP }]) : "[]",
        };
      }
      if (request.method === "PATCH") return { status: 200, body: JSON.stringify([{ id: BOOTSTRAP }]) };
      // The recovery slot, exactly as the mint stored it on the first computer.
      return {
        status: 200,
        body:
          options.wrapRows ??
          JSON.stringify([
            {
              kind: "mk_under_src",
              nonce: base64urlToBytea(minted.recoveryWrap.nonce),
              wrapped: base64urlToBytea(minted.recoveryWrap.ciphertext),
              commit_tag: base64urlToBytea(minted.recoveryWrap.commitment),
              kdf_salt: base64urlToBytea(bytesToBase64url(minted.recoverySalt)),
              kdf_params: SYNC_RECOVERY_KDF_PARAMS,
            },
          ]),
      };
    };
  };

  return { ports: { auth, functions, http, httpAs }, calls, holder: createSessionHolder() };
}

beforeEach(async () => {
  crypto = createFakeCryptoPort();
  // The real mint, on a different machine, with a different data key: what this
  // computer is adopting really is another computer's account.
  minted = await prepareSyncEnable(crypto, {
    userId: USER,
    web: { email: "ana@example.com", password: "a password nobody sends", params: WEB_KDF_PARAMS },
    localDataKey: new Uint8Array(32).fill(3),
    deviceName: "Prvi računar",
  });
  recoveryCode = minted.recoveryCode;
});

const input = () => ({
  email: "  Ana@Example.COM ",
  password: "a password nobody sends",
  totpCode: "123456",
  recoveryCode,
  deviceName: "Drugi računar",
  localDataKey: DATA_KEY,
});

const run = (options: HarnessOptions = {}) => {
  const h = harness(options);
  return {
    h,
    result: adoptWithRecoveryCode(
      { crypto, ports: h.ports, holder: h.holder, now: () => NOW },
      input(),
    ),
  };
};

describe("adoptWithRecoveryCode", () => {
  it("walks the eight steps in the one order that works", async () => {
    const { h, result } = run();
    expect((await result).kind).toBe("adopted");
    expect(h.calls.map((call) => `${call.root} ${call.path.split("?")[0] ?? ""}`)).toEqual([
      "auth /token",
      "auth /user",
      `auth /factors/${FACTOR}/challenge`,
      `auth /factors/${FACTOR}/verify`,
      // The bootstrap row, then the wrap it makes readable.
      "rest /devices",
      "rest /key_wraps",
      // The session this computer KEEPS, signed in after the revocation.
      "auth /token",
      "functions device-register",
      // The scaffolding, retired, and the stepped-up session ended.
      "rest /devices",
      "auth /logout",
    ]);
  });

  /**
   * The whole reason `CloudPorts.httpAs` exists. `devices_insert_requires_aal2`
   * refuses the insert from anything else, and `session.ts` refuses to HOLD an
   * aal2 session — so the two PostgREST calls must carry a token this desktop is
   * deliberately not keeping.
   */
  it("presents the stepped-up token for both PostgREST calls and keeps the aal1 one", async () => {
    const { h, result } = run();
    await result;
    const rest = h.calls.filter((call) => call.root === "rest");
    expect(rest).toHaveLength(3);
    for (const call of rest) expect(call.bearer).toBe(token("session-1", "aal2"));
    expect(h.holder.current()?.sessionId).toBe("session-2");
    expect(h.holder.current()?.aal).toBe("aal1");
  });

  it("recovers the SAME master key the other computer minted", async () => {
    // The assertion the feature is for: the wrap this machine writes for itself
    // opens, under its own data key, to the key the first machine generated.
    const outcome = (await run().result) as Extract<AdoptSyncResult, { kind: "adopted" }>;
    expect(outcome.masterKey).toEqual(minted.masterKey);
    const reopened = await unwrapKey(crypto, DATA_KEY, outcome.localWrap, {
      purpose: "mk/local-data-key",
      userId: USER,
    });
    expect(reopened).toEqual(minted.masterKey);
    expect(outcome.deviceId).toBe("device-9");
    // Normalised, because that address is what a later sign-in derives from.
    expect(outcome.email).toBe("ana@example.com");
    expect(outcome.refreshToken).toBe("refresh-session-2");
  });

  it("retires the scaffolding under a name the account can actually read", async () => {
    const { h, result } = run();
    const outcome = (await result) as Extract<AdoptSyncResult, { kind: "adopted" }>;
    const rest = h.calls.filter((call) => call.root === "rest");
    const born = JSON.parse(rest[0]?.body ?? "{}") as Record<string, string>;
    const retired = JSON.parse(rest[2]?.body ?? "{}") as Record<string, string>;
    expect(retired["revoked_at"]).toBe(NOW.toISOString());
    // The row was BORN with 17 bytes of noise, because sealing a name needs the
    // key this flow exists to fetch. `devices` rows are never deleted, so the
    // one thing that must not happen is that noise staying there forever.
    expect(retired["name_ciphertext"]).not.toBe(born["name_ciphertext"]);
    const sealed = {
      nonce: retired["name_nonce"] ?? "",
      ciphertext: retired["name_ciphertext"] ?? "",
    };
    // 'web' — what the SERVER says this row is, and therefore the AAD every
    // reader will rebuild. The row is scaffolding, but `platform` is not a
    // column a client may write, so the name written into it has to be bound to
    // the platform the row actually has.
    const web = { userId: USER, platform: "web" } as const;
    expect(await openDeviceName(crypto, outcome.masterKey, web, sealed)).toBe("Drugi računar");
    // And the same words sealed for the real desktop row do NOT open here. Two
    // rows, two platforms, two ciphertexts — which is the whole point.
    await expect(
      openDeviceName(crypto, outcome.masterKey, { userId: USER, platform: "desktop" }, sealed),
    ).rejects.toThrow();
  });

  it("refuses a wrong recovery code without registering anything", async () => {
    const h = harness();
    const outcome = await adoptWithRecoveryCode(
      { crypto, ports: h.ports, holder: h.holder, now: () => NOW },
      { ...input(), recoveryCode: "ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ" },
    );
    expect(outcome).toMatchObject({ kind: "refused", reason: "recovery_code_rejected" });
    expect(h.calls.some((call) => call.root === "functions")).toBe(false);
    // And the scaffolding is still cleaned up — a failed adoption must not leave
    // a live device row on the account.
    expect(h.calls.filter((call) => call.path.startsWith("/devices"))).toHaveLength(2);
  });

  it("refuses a code that is not a recovery code at all", async () => {
    const h = harness();
    const outcome = await adoptWithRecoveryCode(
      { crypto, ports: h.ports, holder: h.holder, now: () => NOW },
      { ...input(), recoveryCode: "nope" },
    );
    expect(outcome).toMatchObject({ reason: "recovery_code_rejected" });
  });

  it("says the account was never minted when there is no recovery slot", async () => {
    const { result } = run({ wrapRows: "[]" });
    expect(await result).toMatchObject({ kind: "refused", reason: "not_minted" });
  });

  it("stops when the bootstrap row is refused, because nothing is readable without it", async () => {
    const { h, result } = run({ insertStatus: 403 });
    expect(await result).toMatchObject({ kind: "refused", reason: "bootstrap_failed" });
    expect(h.calls.some((call) => call.path.startsWith("/key_wraps"))).toBe(false);
  });

  it("refuses a step-up that answered 200 without stepping up", async () => {
    const { h, result } = run({ steppedAal: "aal1" });
    expect(await result).toMatchObject({ reason: "step_up_failed" });
    // Nothing was written, and there is no aal2 session to sign out.
    expect(h.calls.some((call) => call.root === "rest")).toBe(false);
  });

  it("passes the registration's own refusals through by name", async () => {
    const { result } = run({
      registerStatus: 403,
      registerBody: JSON.stringify({ error: "proof_rejected" }),
    });
    expect(await result).toMatchObject({ reason: "proof_rejected" });
  });
});
