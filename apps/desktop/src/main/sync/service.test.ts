import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bytesToBase64url, utf8 } from "@nexus/sync-crypto";
import { createFakeCryptoPort } from "@nexus/sync-crypto/testing";
import { base64urlToBytea } from "@nexus/sync-transport";
import { NexusDatabase, SyncAccountStore, openDatabase } from "@nexus/db";

import { writeCloudSwitch } from "../net/offline.js";
import { createSyncService, type SyncService } from "./service.js";
import type { CloudFetch } from "./port.js";
import { CLOUD_ANON_KEY_VAR, CLOUD_URL_VAR } from "./config.js";

const ORIGIN = "https://abc.supabase.co";
const KEY = "aaaa.bbbb.cccc";
const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FACTOR = "6f2f4f5e-1b5c-4d3a-9a4e-2c7f0a1b2c3d";
const CHALLENGE = "11111111-2222-4333-8444-555555555555";
const DEVICE = "22222222-3333-4444-8555-666666666666";
const DATA_KEY_HEX = "ab".repeat(32);

const configured = { [CLOUD_URL_VAR]: ORIGIN, [CLOUD_ANON_KEY_VAR]: KEY };

const token = (sessionId: string, aal: string): string =>
  `h.${bytesToBase64url(
    utf8(JSON.stringify({ sub: USER, session_id: sessionId, aal, exp: 1_800_000_000 })),
  )}.s`;

interface Wire {
  readonly fetch: CloudFetch;
  readonly urls: string[];
  readonly bodies: (string | null)[];
}

/**
 * The whole server as one URL-dispatching fake, so the ports, the protocol and
 * the service are exercised together rather than one layer at a time.
 */
function wire(options: { retireStatus?: number; retireBody?: string } = {}): Wire {
  const urls: string[] = [];
  const bodies: (string | null)[] = [];
  let signIns = 0;
  let mint: Record<string, Record<string, string>> | null = null;

  const fetch: CloudFetch = async (request) => {
    urls.push(request.url);
    bodies.push(request.body);
    const path = request.url.slice(ORIGIN.length);

    if (path.startsWith("/auth/v1/token?grant_type=password")) {
      signIns += 1;
      return {
        status: 200,
        body: JSON.stringify({
          access_token: token(`session-${signIns}`, "aal1"),
          refresh_token: `refresh-${signIns}`,
        }),
      };
    }
    if (path === "/auth/v1/user") {
      return {
        status: 200,
        body: JSON.stringify({
          id: USER,
          factors: [{ id: FACTOR, factor_type: "totp", status: "verified" }],
        }),
      };
    }
    if (path.endsWith("/challenge")) {
      return { status: 200, body: JSON.stringify({ id: CHALLENGE }) };
    }
    if (path.endsWith("/verify")) {
      return {
        status: 200,
        body: JSON.stringify({
          access_token: token("session-1", "aal2"),
          refresh_token: "refresh-stepped",
        }),
      };
    }
    if (path === "/auth/v1/logout?scope=local") return { status: 204, body: "" };

    if (path === "/functions/v1/sync-enable") {
      mint = JSON.parse(request.body ?? "{}") as Record<string, Record<string, string>>;
      return { status: 200, body: JSON.stringify({ status: "minted", device_id: DEVICE }) };
    }

    if (path.startsWith("/rest/v1/key_wraps")) {
      const kwrap = mint?.["kwrap"] ?? {};
      const src = mint?.["src"] ?? {};
      return {
        status: 200,
        body: JSON.stringify([
          {
            kind: "mk_under_kwrap",
            nonce: base64urlToBytea(kwrap["nonce"] ?? ""),
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
    }

    if (path.startsWith("/rest/v1/devices")) {
      return {
        status: options.retireStatus ?? 200,
        body: options.retireBody ?? JSON.stringify([{ id: DEVICE }]),
      };
    }

    throw new Error(`unexpected url ${request.url}`);
  };

  return { fetch, urls, bodies };
}

let dir: string;
let db: NexusDatabase;
let store: SyncAccountStore;
let locked: boolean;

const service = (
  env: Record<string, string | undefined>,
  net: Wire = wire(),
  cloudOn = true,
): SyncService => {
  if (cloudOn) writeSwitch(true);
  return createSyncService({
    userDataPath: dir,
    env,
    fetch: net.fetch,
    accountStore: () => store,
    dataKeyHex: () => {
      if (locked) throw new Error("The data key is locked.");
      return DATA_KEY_HEX;
    },
    now: () => new Date("2026-08-09T18:00:00.000Z"),
    crypto: createFakeCryptoPort(),
  });
};

/**
 * Through the same writer the service uses, and therefore through the same file
 * the boundary reads at launch. A stub here would be a second spelling of the
 * one fact the whole cloud-off design rests on.
 */
const writeSwitch = (enabled: boolean): void => {
  writeCloudSwitch(dir, { enabled });
};

const enableInput = {
  email: "  Ana@Example.COM ",
  password: "a password nobody sends",
  totpCode: "123456",
  deviceName: "Anin laptop",
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-sync-service-"));
  db = openDatabase({ path: join(dir, "sync.db") });
  store = new SyncAccountStore(db.raw);
  locked = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("the cloud switch", () => {
  it("comes up off on a file that has never had one written", () => {
    const sync = createSyncService({
      userDataPath: dir,
      env: configured,
      fetch: wire().fetch,
      accountStore: () => store,
      dataKeyHex: () => DATA_KEY_HEX,
      now: () => new Date(),
      crypto: createFakeCryptoPort(),
    });
    expect(sync.status()).toMatchObject({ cloudEnabled: false, configured: true, account: null });
    expect(sync.allowedOrigins()).toEqual([]);
  });

  it("writes the switch and answers with the status, restart flag included", () => {
    // A restart is needed in BOTH directions. The status carries the switch as
    // STORED — which is what the checkbox shows — and the flag, computed from
    // `cloudRequiresRestart`, the one place that rule is written.
    const sync = service(configured, wire(), false);
    expect(sync.setCloudEnabled(true)).toMatchObject({
      cloudEnabled: true,
      cloudRestartRequired: true,
    });
    expect(JSON.parse(readFileSync(join(dir, "cloud.json"), "utf8"))).toEqual({ enabled: true });

    expect(sync.setCloudEnabled(false)).toMatchObject({
      cloudEnabled: false,
      cloudRestartRequired: false,
    });
  });

  it("re-reads the stored switch on every status, not once at construction", () => {
    // The settings card draws its checkbox from this. A construction-time
    // constant would untick a box the user has just ticked, the moment they
    // left the page and came back.
    const sync = service(configured, wire(), false);
    expect(sync.status()).toMatchObject({ cloudEnabled: false, cloudRestartRequired: false });

    // Written from OUTSIDE this service — another window, or the value a
    // previous session left behind.
    writeSwitch(true);
    expect(sync.status()).toMatchObject({ cloudEnabled: true, cloudRestartRequired: true });
  });

  /** „No project" and „cloud off" are the same boundary, not two. */
  it("admits no origin for an unconfigured build even with the switch on", () => {
    const sync = service({});
    expect(sync.status()).toMatchObject({ configured: false });
    expect(sync.allowedOrigins()).toEqual([]);
  });
});

describe("enable", () => {
  it("refuses before a packet when cloud is off, or the build has no project", async () => {
    expect(await service(configured, wire(), false).enable(enableInput)).toEqual({
      outcome: "refused",
      reason: "cloud_off",
    });
    expect(await service({}).enable(enableInput)).toEqual({
      outcome: "refused",
      reason: "cloud_off",
    });
  });

  it("refuses while the database is locked, because there is no key to wrap under", async () => {
    locked = true;
    expect(await service(configured).enable(enableInput)).toEqual({
      outcome: "refused",
      reason: "locked",
    });
  });

  it("mints, stores the account, and hands back the recovery code once", async () => {
    const net = wire();
    const sync = service(configured, net);
    const result = await sync.enable(enableInput);

    expect(result).toMatchObject({ outcome: "enabled" });
    expect(result.outcome === "enabled" && result.recoveryCode).toMatch(/^[0-9A-Z]+$/);

    const saved = store.read();
    expect(saved).toMatchObject({
      userId: USER,
      // The SAME normaliser the KDF salt was derived under — trimmed and
      // lower-cased, so a later sign-in derives the same key.
      email: "ana@example.com",
      deviceId: DEVICE,
      refreshToken: "refresh-2",
      enabledAt: "2026-08-09T18:00:00.000Z",
    });
    expect(saved?.localWrap.purpose).toBe("mk/local-data-key");
    expect(sync.status()).toMatchObject({ signedIn: true, account: { deviceId: DEVICE } });
  });

  it("puts every call at the right root, and the readback at REST", async () => {
    const net = wire();
    await service(configured, net).enable(enableInput);
    expect(net.urls.map((url) => url.slice(ORIGIN.length))).toEqual([
      "/auth/v1/token?grant_type=password",
      "/auth/v1/user",
      `/auth/v1/factors/${FACTOR}/challenge`,
      `/auth/v1/factors/${FACTOR}/verify`,
      "/auth/v1/token?grant_type=password",
      "/functions/v1/sync-enable",
      "/rest/v1/key_wraps?select=kind%2Cnonce%2Cwrapped%2Ccommit_tag%2Ckdf_salt%2Ckdf_params&kind=in.(mk_under_kwrap%2Cmk_under_src)",
      "/auth/v1/logout?scope=local",
    ]);
  });

  /**
   * Enabling twice would mint a second master key for an account that has one,
   * and be told `already_minted` after spending a step-up and a TOTP code.
   */
  it("refuses a second enable on a computer that already has an account", async () => {
    const sync = service(configured);
    expect((await sync.enable(enableInput)).outcome).toBe("enabled");
    expect(await sync.enable(enableInput)).toEqual({
      outcome: "refused",
      reason: "already_enabled",
    });
  });

  it("refuses a device name this schema cannot store, without minting anything", async () => {
    const net = wire();
    const result = await service(configured, net).enable({ ...enableInput, deviceName: "   " });
    expect(result).toEqual({ outcome: "refused", reason: "bad_request" });
    expect(store.read()).toBeNull();
    // The name is refused after the step-up (it is validated where the material
    // is built) but before anything is minted.
    expect(net.urls.some((url) => url.includes("/functions/"))).toBe(false);
  });
});

describe("disconnect", () => {
  it("retires the device row, ends the session, and forgets the key", async () => {
    const net = wire();
    const sync = service(configured, net);
    await sync.enable(enableInput);
    net.urls.length = 0;

    const after = await sync.disconnect();

    expect(net.urls.map((url) => url.slice(ORIGIN.length))).toEqual([
      `/rest/v1/devices?id=eq.${DEVICE}&select=id`,
      "/auth/v1/logout?scope=local",
    ]);
    expect(store.read()).toBeNull();
    expect(after).toMatchObject({ account: null, signedIn: false });
  });

  /**
   * A computer must be able to leave an account even when the server is down.
   * The local half is what makes the leaving true for this machine.
   */
  it("forgets locally even when the server refuses to retire the row", async () => {
    const net = wire({ retireStatus: 200, retireBody: "[]" });
    const sync = service(configured, net);
    await sync.enable(enableInput);

    await sync.disconnect();
    expect(store.read()).toBeNull();
  });

  it("does nothing dramatic when there was never an account", async () => {
    const sync = service(configured);
    expect(await sync.disconnect()).toMatchObject({ account: null, signedIn: false });
  });
});
