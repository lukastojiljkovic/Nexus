import { beforeEach, describe, expect, it } from "vitest";
import {
  WEB_KDF_PARAMS,
  bytesToBase64url,
  prepareSyncEnable,
  utf8,
  type SealedKey,
} from "@nexus/sync-crypto";
import { createFakeCryptoPort } from "@nexus/sync-crypto/testing";
import type { AuthPort, FunctionPort, HttpPort } from "@nexus/sync-transport";

import type { CloudPorts } from "./port.js";
import { reconnectSync, resumeSync } from "./reconnect.js";
import { createSessionHolder } from "./session.js";

const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_USER = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const DATA_KEY = new Uint8Array(32).fill(7);

const token = (sessionId: string, aal: string, sub = USER): string =>
  `h.${bytesToBase64url(
    utf8(JSON.stringify({ sub, session_id: sessionId, aal, exp: 1_800_000_000 })),
  )}.s`;

const sessionBody = (sessionId: string, aal: string, sub = USER): string =>
  JSON.stringify({ access_token: token(sessionId, aal, sub), refresh_token: `refresh-${sessionId}` });

interface Call {
  readonly root: "auth" | "functions";
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
}

interface HarnessOptions {
  readonly refreshStatus?: number;
  readonly refreshBody?: string;
  readonly signInStatus?: number;
  readonly signInBody?: string;
  readonly registerStatus?: number;
  readonly registerBody?: string;
}

function harness(options: HarnessOptions = {}): {
  ports: CloudPorts;
  calls: Call[];
  holder: ReturnType<typeof createSessionHolder>;
} {
  const calls: Call[] = [];

  const auth: AuthPort = async (request) => {
    calls.push({ root: "auth", ...request });
    if (request.path === "/token?grant_type=refresh_token") {
      if (options.refreshStatus !== undefined) {
        return { status: options.refreshStatus, body: options.refreshBody ?? "{}" };
      }
      // A refresh keeps the session and rotates only the token, so the id here
      // is deliberately the one the caller was already on.
      return { status: 200, body: options.refreshBody ?? sessionBody("session-old", "aal1") };
    }
    if (request.path.startsWith("/token?grant_type=password")) {
      if (options.signInStatus !== undefined) {
        return { status: options.signInStatus, body: options.signInBody ?? "{}" };
      }
      return { status: 200, body: options.signInBody ?? sessionBody("session-new", "aal1") };
    }
    throw new Error(`unexpected auth path ${request.path}`);
  };

  const functions: FunctionPort = async (request) => {
    calls.push({
      root: "functions",
      path: request.name,
      headers: request.headers,
      body: request.body,
    });
    return {
      status: options.registerStatus ?? 200,
      body: options.registerBody ?? JSON.stringify({ device_id: "device-9" }),
    };
  };

  // Nothing in this file speaks REST. A port that throws proves it.
  const http: HttpPort = async () => {
    throw new Error("reconnect must not touch the REST root");
  };

  // Nothing in this flow steps a session up, so the aal2 port is unreachable
  // here — it throws rather than answering, which is what makes that a claim.
  const httpAs = (): never => {
    throw new Error("this flow must not need an aal2 port");
  };

  return { ports: { auth, functions, http, httpAs }, calls, holder: createSessionHolder() };
}

let crypto: ReturnType<typeof createFakeCryptoPort>;
let localWrap: SealedKey;
let mintedProof: Uint8Array;

beforeEach(async () => {
  crypto = createFakeCryptoPort();
  // The real thing, not a hand-made wrap: what `sync-enable` would have stored
  // for this computer, so the proof asserted below is the proof the mint kept.
  const material = await prepareSyncEnable(crypto, {
    userId: USER,
    web: { email: "ana@example.com", password: "a password nobody sends", params: WEB_KDF_PARAMS },
    localDataKey: DATA_KEY,
    deviceName: "Anin laptop",
  });
  localWrap = material.localWrap;
  mintedProof = material.registerProof;
});

const input = () => ({
  email: "Ana@Example.com",
  password: "a password nobody sends",
  deviceName: "Anin laptop",
  localWrap,
  localDataKey: DATA_KEY,
  userId: USER,
});

describe("resumeSync", () => {
  it("asks nothing of the network when this computer kept no token", async () => {
    const h = harness();
    const result = await resumeSync({ crypto, ports: h.ports, holder: h.holder }, { refreshToken: null });
    expect(result).toEqual({ kind: "expired" });
    expect(h.calls).toHaveLength(0);
  });

  it("comes back on the SAME session, which is what keeps the device row valid", async () => {
    const h = harness();
    const result = await resumeSync(
      { crypto, ports: h.ports, holder: h.holder },
      { refreshToken: "refresh-session-old" },
    );
    expect(result).toMatchObject({ kind: "resumed" });
    expect(h.holder.current()?.sessionId).toBe("session-old");
    expect(h.calls.map((call) => call.path)).toEqual(["/token?grant_type=refresh_token"]);
  });

  it("calls a refused refresh expired rather than an error", async () => {
    // The ordinary end of a session's life — another computer enabled sync, or
    // the token simply aged out. The answer is the password form, not a stack.
    const h = harness({
      refreshStatus: 400,
      refreshBody: JSON.stringify({ error_code: "refresh_token_not_found" }),
    });
    const result = await resumeSync(
      { crypto, ports: h.ports, holder: h.holder },
      { refreshToken: "spent" },
    );
    expect(result).toEqual({ kind: "expired" });
    expect(h.holder.current()).toBeNull();
  });

  it("refuses to adopt a stepped-up session even if one comes back", async () => {
    // `aal` survives every refresh, so a stored `aal2` token would otherwise
    // become this desktop's permanent identity — and an `aal2` desktop is the
    // one thing the device policy exists to prevent.
    const h = harness({ refreshBody: sessionBody("session-old", "aal2") });
    const result = await resumeSync(
      { crypto, ports: h.ports, holder: h.holder },
      { refreshToken: "refresh-session-old" },
    );
    expect(result).toEqual({ kind: "expired" });
    expect(h.holder.current()).toBeNull();
  });
});

describe("reconnectSync", () => {
  it("signs in and buys a device row, in that order", async () => {
    const h = harness();
    const result = await reconnectSync({ crypto, ports: h.ports, holder: h.holder }, input());
    expect(result).toMatchObject({ kind: "reconnected", deviceId: "device-9" });
    expect(h.calls.map((call) => `${call.root} ${call.path}`)).toEqual([
      "auth /token?grant_type=password",
      "functions device-register",
    ]);
    // The holder was set before the call, so the request carried the session
    // that is about to own the row.
    expect(h.holder.current()?.sessionId).toBe("session-new");
  });

  /**
   * The assertion this whole file exists for. The proof is derived from MK and
   * the account id with no clock and no challenge in it, so what the mint stored
   * months ago and what this computer computes now must be the same 32 bytes —
   * and if they ever stop being, every reconnect on every machine fails forever
   * with no way to tell why.
   */
  it("sends exactly the proof the mint stored", async () => {
    const h = harness();
    await reconnectSync({ crypto, ports: h.ports, holder: h.holder }, input());
    const register = h.calls.find((call) => call.root === "functions");
    const body = JSON.parse(register?.body ?? "{}") as Record<string, string>;
    expect(body["mk_verifier"]).toBe(bytesToBase64url(mintedProof));
  });

  it("sends no password, no wrap and no key", async () => {
    const h = harness();
    await reconnectSync({ crypto, ports: h.ports, holder: h.holder }, input());
    const register = h.calls.find((call) => call.root === "functions");
    for (const forbidden of ["password", "wrapped", "kdf", "recovery"]) {
      expect(register?.body).not.toContain(forbidden);
    }
  });

  it("opens the master key BEFORE it signs in, so a dead wrap costs no round trip", async () => {
    const h = harness();
    const result = await reconnectSync(
      { crypto, ports: h.ports, holder: h.holder },
      { ...input(), localDataKey: new Uint8Array(32).fill(9) },
    );
    expect(result).toMatchObject({ kind: "refused", reason: "master_key_unreadable" });
    expect(h.calls).toHaveLength(0);
  });

  it("stops at a wrong password without registering anything", async () => {
    const h = harness({
      signInStatus: 400,
      signInBody: JSON.stringify({ error_code: "invalid_credentials", msg: "Invalid" }),
    });
    const result = await reconnectSync({ crypto, ports: h.ports, holder: h.holder }, input());
    expect(result).toMatchObject({ kind: "refused", reason: "invalid_credentials" });
    expect(h.calls.some((call) => call.root === "functions")).toBe(false);
  });

  it("refuses a session that belongs to a different account than the stored wrap", async () => {
    const h = harness({ signInBody: sessionBody("session-new", "aal1", OTHER_USER) });
    const result = await reconnectSync({ crypto, ports: h.ports, holder: h.holder }, input());
    expect(result).toMatchObject({ kind: "refused", reason: "account_mismatch" });
    expect(h.calls.some((call) => call.root === "functions")).toBe(false);
  });

  it("passes the endpoint's own refusals through by name", async () => {
    const h = harness({
      registerStatus: 403,
      registerBody: JSON.stringify({ error: "proof_rejected" }),
    });
    const result = await reconnectSync({ crypto, ports: h.ports, holder: h.holder }, input());
    expect(result).toMatchObject({ kind: "refused", reason: "proof_rejected" });
    // The session is real and live; it simply owns no row. Keeping it is what
    // lets the user try again without a second sign-in.
    expect(h.holder.current()?.sessionId).toBe("session-new");
  });

  it("refuses a 200 that carried no device id", async () => {
    const h = harness({ registerBody: JSON.stringify({ status: "ok" }) });
    const result = await reconnectSync({ crypto, ports: h.ports, holder: h.holder }, input());
    expect(result).toMatchObject({ kind: "refused", reason: "unknown" });
  });
});
