import { beforeEach, describe, expect, it } from "vitest";
import { bytesToBase64url, utf8 } from "@nexus/sync-crypto";
import { createFakeCryptoPort } from "@nexus/sync-crypto/testing";
import { base64urlToBytea, type AuthPort, type FunctionPort, type HttpPort } from "@nexus/sync-transport";

import { enableSyncOnThisDevice, type EnableSyncResult } from "./enable.js";
import type { CloudPorts } from "./port.js";
import { createSessionHolder } from "./session.js";

const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FACTOR = "6f2f4f5e-1b5c-4d3a-9a4e-2c7f0a1b2c3d";
const SECOND_FACTOR = "7f2f4f5e-1b5c-4d3a-9a4e-2c7f0a1b2c3d";
const CHALLENGE = "11111111-2222-4333-8444-555555555555";

const token = (sessionId: string, aal: string): string =>
  `h.${bytesToBase64url(
    utf8(JSON.stringify({ sub: USER, session_id: sessionId, aal, exp: 1_800_000_000 })),
  )}.s`;

const sessionBody = (sessionId: string, aal: string): string =>
  JSON.stringify({ access_token: token(sessionId, aal), refresh_token: `refresh-${sessionId}` });

/** One recorded request, flattened to what the assertions are about. */
interface Call {
  readonly root: "auth" | "functions" | "rest";
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
}

interface HarnessOptions {
  readonly factors?: readonly Record<string, unknown>[];
  /** The `aal` the verify call answers with. */
  readonly steppedAal?: string;
  /** Session ids handed out by the two sign-ins, in order. */
  readonly sessionIds?: readonly string[];
  readonly signInStatus?: number;
  readonly signInBody?: string;
  readonly verifyStatus?: number;
  readonly verifyBody?: string;
  readonly mintBody?: string;
  readonly mintStatus?: number;
  /** Corrupts one stored byte on the way back, standing in for a hostile server. */
  readonly corruptReadback?: boolean;
  readonly signOutStatus?: number;
}

function harness(options: HarnessOptions = {}): {
  ports: CloudPorts;
  calls: Call[];
  holder: ReturnType<typeof createSessionHolder>;
} {
  const calls: Call[] = [];
  const sessionIds = options.sessionIds ?? ["session-one", "session-two"];
  const factors = options.factors ?? [
    { id: FACTOR, factor_type: "totp", status: "verified", friendly_name: "Telefon" },
  ];
  let signIns = 0;
  let mintBody: Record<string, Record<string, string>> | null = null;

  const auth: AuthPort = async (request) => {
    calls.push({ root: "auth", ...request });
    if (request.path.startsWith("/token?grant_type=password")) {
      if (options.signInStatus !== undefined) {
        return { status: options.signInStatus, body: options.signInBody ?? "{}" };
      }
      // The FIRST sign-in gets the session that is about to be stepped up; the
      // second gets the device session. Which one is which is the protocol.
      const id = sessionIds[Math.min(signIns, sessionIds.length - 1)] ?? "session-one";
      signIns += 1;
      return { status: 200, body: sessionBody(id, "aal1") };
    }
    if (request.path === "/user") {
      return { status: 200, body: JSON.stringify({ id: USER, factors }) };
    }
    if (request.path.endsWith("/challenge")) {
      return { status: 200, body: JSON.stringify({ id: CHALLENGE, type: "totp" }) };
    }
    if (request.path.endsWith("/verify")) {
      if (options.verifyStatus !== undefined) {
        return { status: options.verifyStatus, body: options.verifyBody ?? "{}" };
      }
      return {
        status: 200,
        body: sessionBody(sessionIds[0] ?? "session-one", options.steppedAal ?? "aal2"),
      };
    }
    if (request.path === "/logout?scope=local") {
      return { status: options.signOutStatus ?? 204, body: "" };
    }
    throw new Error(`unexpected auth path ${request.path}`);
  };

  const functions: FunctionPort = async (request) => {
    calls.push({ root: "functions", path: request.name, headers: request.headers, body: request.body });
    mintBody = JSON.parse(request.body) as Record<string, Record<string, string>>;
    return {
      status: options.mintStatus ?? 200,
      body: options.mintBody ?? JSON.stringify({ status: "minted", device_id: "device-1" }),
    };
  };

  /** Answers the readback with exactly what the mint was given — a faithful server. */
  const http: HttpPort = async (request) => {
    calls.push({ root: "rest", ...request });
    if (mintBody === null) throw new Error("readback before the mint");
    const kwrap = mintBody["kwrap"] as unknown as Record<string, string>;
    const src = mintBody["src"] as unknown as Record<string, string>;
    const nonce = options.corruptReadback
      ? base64urlToBytea(bytesToBase64url(new Uint8Array(24)))
      : base64urlToBytea(kwrap["nonce"] ?? "");
    return {
      status: 200,
      body: JSON.stringify([
        {
          kind: "mk_under_kwrap",
          nonce,
          wrapped: base64urlToBytea(kwrap["wrapped"] ?? ""),
          commit_tag: base64urlToBytea(kwrap["commit_tag"] ?? ""),
          kdf_salt: null,
          kdf_params: kwrap["kdf_params"],
        },
        {
          kind: "mk_under_src",
          nonce: base64urlToBytea(src["nonce"] ?? ""),
          wrapped: base64urlToBytea(src["wrapped"] ?? ""),
          commit_tag: base64urlToBytea(src["commit_tag"] ?? ""),
          kdf_salt: base64urlToBytea(src["kdf_salt"] ?? ""),
          kdf_params: src["kdf_params"],
        },
      ]),
    };
  };

  return { ports: { auth, functions, http }, calls, holder: createSessionHolder() };
}

const input = {
  email: "Ana@Example.com",
  password: "a password nobody sends",
  totpCode: "123456",
  deviceName: "Anin laptop",
  localDataKey: new Uint8Array(32).fill(7),
};

let crypto: ReturnType<typeof createFakeCryptoPort>;

beforeEach(() => {
  // Deterministic, and with no Argon2id work factor at all — which is why the
  // package keeps it behind its own export subpath.
  crypto = createFakeCryptoPort();
});

const run = (options: HarnessOptions = {}) => {
  const h = harness(options);
  return { h, result: enableSyncOnThisDevice({ crypto, ports: h.ports, holder: h.holder }, input) };
};

describe("enableSyncOnThisDevice", () => {
  it("runs the four round trips in the one order that works, then signs the step-up out", async () => {
    const { h, result } = run();
    const outcome = await result;

    expect(outcome).toMatchObject({ kind: "enabled", deviceId: "device-1" });
    expect(h.calls.map((call) => `${call.root} ${call.path}`)).toEqual([
      "auth /token?grant_type=password",
      "auth /user",
      `auth /factors/${FACTOR}/challenge`,
      `auth /factors/${FACTOR}/verify`,
      // The device session is signed in AFTER the step-up, because verifying a
      // factor revokes every other session the account holds.
      "auth /token?grant_type=password",
      "functions sync-enable",
      "rest /key_wraps?select=kind%2Cnonce%2Cwrapped%2Ccommit_tag%2Ckdf_salt%2Ckdf_params&kind=in.(mk_under_kwrap%2Cmk_under_src)",
      "auth /logout?scope=local",
    ]);
  });

  it("gives the mint the device session as bearer and the step-up as the second token", async () => {
    const { h, result } = run();
    expect((await result).kind).toBe("enabled");

    const mint = h.calls.find((call) => call.root === "functions");
    expect(mint?.headers["x-nexus-authorising-token"]).toBe(token("session-one", "aal2"));
    // The port supplies `Authorization` from the holder, so what this asserts is
    // that the holder was set to the DEVICE session before the mint.
    expect(h.holder.accessToken()).toBe(token("session-two", "aal1"));
  });

  it("signs out the STEP-UP session and not the device session", async () => {
    const { h, result } = run();
    await result;
    const logout = h.calls.find((call) => call.path === "/logout?scope=local");
    expect(logout?.headers["Authorization"]).toBe(`Bearer ${token("session-one", "aal2")}`);
  });

  it("keeps the aal1 session and never the aal2 one", async () => {
    const { h, result } = run();
    await result;
    expect(h.holder.current()?.aal).toBe("aal1");
    expect(h.holder.current()?.sessionId).toBe("session-two");
  });

  it("returns the recovery code and the local wrap, and nothing about the server's", async () => {
    const { result } = run();
    const outcome = (await result) as Extract<EnableSyncResult, { kind: "enabled" }>;
    expect(outcome.recoveryCode).toMatch(/^[0-9A-Z]+$/);
    expect(outcome.localWrap.purpose).toBe("mk/local-data-key");
    expect(outcome.masterKey).toHaveLength(32);
    expect(outcome.masterKey.some((byte) => byte !== 0)).toBe(true);
  });

  it("stops at a wrong password without touching anything else", async () => {
    const { h, result } = run({
      signInStatus: 400,
      signInBody: JSON.stringify({ error_code: "invalid_credentials", msg: "Invalid" }),
    });
    expect(await result).toEqual({
      kind: "refused",
      reason: "invalid_credentials",
      detail: "Invalid",
    });
    expect(h.calls).toHaveLength(1);
  });

  /** „Enrol one on the web" and „choose which one" are different instructions. */
  it("separates no second factor from several", async () => {
    expect(await run({ factors: [] }).result).toMatchObject({ reason: "mfa_not_enrolled" });

    const two = [
      { id: FACTOR, factor_type: "totp", status: "verified" },
      { id: SECOND_FACTOR, factor_type: "totp", status: "verified" },
    ];
    expect(await run({ factors: two }).result).toMatchObject({ reason: "mfa_ambiguous" });
  });

  it("uses the factor the caller named when the account has several", async () => {
    const h = harness({
      factors: [
        { id: FACTOR, factor_type: "totp", status: "verified" },
        { id: SECOND_FACTOR, factor_type: "totp", status: "verified" },
      ],
    });
    const outcome = await enableSyncOnThisDevice(
      { crypto, ports: h.ports, holder: h.holder },
      { ...input, factorId: SECOND_FACTOR },
    );
    expect(outcome.kind).toBe("enabled");
    expect(h.calls.some((call) => call.path === `/factors/${SECOND_FACTOR}/challenge`)).toBe(true);
  });

  it("names a wrong code as a wrong code", async () => {
    const { result } = run({
      verifyStatus: 400,
      verifyBody: JSON.stringify({ error_code: "mfa_verification_failed", msg: "Invalid TOTP" }),
    });
    expect(await result).toMatchObject({ reason: "invalid_code", detail: "Invalid TOTP" });
  });

  /**
   * A 200 that did not raise the assurance level would be refused by the mint
   * four calls later (NX302). Stopping here says the same thing at the point it
   * became true.
   */
  it("refuses a step-up that answered 200 without stepping up", async () => {
    const { h, result } = run({ steppedAal: "aal1" });
    expect(await result).toMatchObject({ reason: "step_up_failed" });
    // And nothing was signed out, because there is no aal2 session to end.
    expect(h.calls.some((call) => call.path === "/logout?scope=local")).toBe(false);
  });

  it("refuses when the auth server hands back the same session twice", async () => {
    const { h, result } = run({ sessionIds: ["one-session"] });
    expect(await result).toMatchObject({ reason: "sessions_must_differ" });
    // The step-up is still ended — the `finally` runs on every path past it.
    expect(h.calls.some((call) => call.path === "/logout?scope=local")).toBe(true);
  });

  it("reports an existing master key without adopting it", async () => {
    const { result } = run({ mintBody: JSON.stringify({ status: "already_minted" }) });
    expect(await result).toEqual({ kind: "already_minted" });
  });

  it("passes the mint's own refusals through by name", async () => {
    const { result } = run({
      mintStatus: 403,
      mintBody: JSON.stringify({ error: "email_not_confirmed" }),
    });
    expect(await result).toMatchObject({ reason: "email_not_confirmed" });
  });

  /**
   * The mint is the only moment this account's master key comes into existence.
   * A server that stored something else produces an account whose key nothing
   * can recover, and the only moment to notice is now.
   */
  it("refuses to call sync enabled when the server stored something else", async () => {
    const { result } = run({ corruptReadback: true });
    const outcome = await result;
    expect(outcome).toMatchObject({ kind: "refused", reason: "round_trip_mismatch" });
    expect(outcome.kind === "refused" && outcome.detail).toContain("mk_under_kwrap.nonce");
  });

  it("refuses when the wraps cannot be read back at all", async () => {
    const h = harness();
    const ports: CloudPorts = {
      ...h.ports,
      http: async () => ({ status: 401, body: '{"message":"JWT expired"}' }),
    };
    const outcome = await enableSyncOnThisDevice({ crypto, ports, holder: h.holder }, input);
    expect(outcome).toMatchObject({ kind: "refused", reason: "round_trip_mismatch" });
  });

  /** A sign-out that fails leaves a token nobody holds. It must not fail the flow. */
  it("still reports success when the step-up could not be signed out", async () => {
    const { result } = run({ signOutStatus: 503 });
    expect((await result).kind).toBe("enabled");
  });
});
