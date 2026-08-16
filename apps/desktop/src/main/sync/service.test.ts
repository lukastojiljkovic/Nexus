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
const SECOND_DEVICE = "33333333-4444-4555-8666-777777777777";
const BOOTSTRAP_DEVICE = "44444444-5555-4666-8777-888888888888";
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
function wire(
  options: {
    retireStatus?: number;
    retireBody?: string;
    refreshStatus?: number;
    registerStatus?: number;
    registerBody?: string;
    /** Overrides the `key_wraps` read, for the account that never minted. */
    keyWrapsBody?: string;
    /** Status for the bootstrap INSERT only, so adopt's step 3 can be failed. */
    deviceInsertStatus?: number;
  } = {},
): Wire {
  const urls: string[] = [];
  const bodies: (string | null)[] = [];
  let signIns = 0;
  let refreshes = 0;
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
    if (path === "/auth/v1/token?grant_type=refresh_token") {
      if (options.refreshStatus !== undefined) {
        return { status: options.refreshStatus, body: '{"error_code":"refresh_token_not_found"}' };
      }
      // GoTrue rotates the TOKEN and keeps the SESSION, which is the whole
      // reason a resume is cheap: the device row names `session-2` either way.
      refreshes += 1;
      return {
        status: 200,
        body: JSON.stringify({
          access_token: token("session-2", "aal1"),
          refresh_token: `refresh-rotated-${refreshes}`,
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

    if (path === "/functions/v1/device-register") {
      return {
        status: options.registerStatus ?? 200,
        body: options.registerBody ?? JSON.stringify({ device_id: SECOND_DEVICE }),
      };
    }

    if (path.startsWith("/rest/v1/key_wraps")) {
      if (options.keyWrapsBody !== undefined) return { status: 200, body: options.keyWrapsBody };
      const kwrap = mint?.["kwrap"] ?? {};
      const src = mint?.["src"] ?? {};
      const rows = [
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
      ];
      // The `kind` filter is HONOURED, not ignored. Enable asks for both rows
      // with `in.(…)` and adopt asks for one with `eq.…`, and a fake that always
      // answered both would hand adopt the `mk_under_kwrap` row first — whose
      // `kdf_salt` is null, so the parser rejects it and the flow reports
      // `not_minted` on an account that minted perfectly well. A fake server
      // that ignores a filter does not test the caller, it tests the fake.
      const filter = /[?&]kind=(eq|in)\.([^&]*)/.exec(path);
      const wanted =
        filter === null
          ? null
          : new Set(
              decodeURIComponent(filter[2] ?? "")
                .replace(/^\(|\)$/g, "")
                .split(",")
                .map((kind) => kind.trim()),
            );
      return {
        status: 200,
        body: JSON.stringify(
          wanted === null ? rows : rows.filter((row) => wanted.has(row.kind)),
        ),
      };
    }

    if (path.startsWith("/rest/v1/devices")) {
      // Adopt's step 3 writes the bootstrap row; every other call on this table
      // is a PATCH that retires one. Two different answers, told apart by the
      // method rather than by the path, because the path is the same.
      if (request.method === "POST") {
        return {
          status: options.deviceInsertStatus ?? 201,
          body: JSON.stringify([{ id: BOOTSTRAP_DEVICE }]),
        };
      }
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
/** Every second machine a test built, so `afterEach` can close and remove them. */
let others: { db: NexusDatabase; home: string }[];

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

/**
 * A SECOND computer on the same account: its own user-data directory, its own
 * database and its own account row, reaching the same fake server.
 *
 * Adopting is the one flow whose whole point is that two machines are involved,
 * and a test that ran it against the first machine's store would be testing
 * something the product cannot do. The shared thing is the wire, which is what
 * is shared in life.
 */
interface Machine {
  readonly sync: SyncService;
  readonly store: SyncAccountStore;
}

const otherMachine = (
  net: Wire,
  env: Record<string, string | undefined> = configured,
  cloudOn = true,
): Machine => {
  const home = mkdtempSync(join(tmpdir(), "nexus-sync-second-"));
  const other = openDatabase({ path: join(home, "sync.db") });
  const store = new SyncAccountStore(other.raw);
  if (cloudOn) writeCloudSwitch(home, { enabled: true });
  others.push({ db: other, home });
  return {
    store,
    sync: createSyncService({
      userDataPath: home,
      env,
      fetch: net.fetch,
      accountStore: () => store,
      dataKeyHex: () => {
        if (locked) throw new Error("The data key is locked.");
        // A DIFFERENT data key, because it is a different computer. The local
        // wrap adopt writes must be readable under THIS machine's key, and a
        // shared constant would hide a flow that wrapped under the wrong one.
        return "cd".repeat(32);
      },
      now: () => new Date("2026-08-16T09:00:00.000Z"),
      crypto: createFakeCryptoPort(),
    }),
  };
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
  others = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  for (const other of others) {
    other.db.close();
    rmSync(other.home, { recursive: true, force: true });
  }
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

describe("resume", () => {
  it("gets back on the same session with no password, and banks the rotated token", async () => {
    const net = wire();
    await service(configured, net).enable(enableInput);
    net.urls.length = 0;

    // A second service over the same store is what a relaunch looks like: the
    // account row survives, the session in memory does not.
    const relaunched = service(configured, net);
    expect(relaunched.status()).toMatchObject({ signedIn: false, account: { deviceId: DEVICE } });

    const after = await relaunched.resume();

    expect(net.urls.map((url) => url.slice(ORIGIN.length))).toEqual([
      "/auth/v1/token?grant_type=refresh_token",
    ]);
    expect(after).toMatchObject({ signedIn: true, account: { deviceId: DEVICE } });
    // The stored token is spent the moment it is used. Not writing the new one
    // back would make every launch the LAST one that could resume.
    expect(store.read()?.refreshToken).toBe("refresh-rotated-1");
  });

  it("keeps the stored token when the refresh fails, because an outage is not a password", async () => {
    const net = wire({ refreshStatus: 400 });
    await service(configured, net).enable(enableInput);

    const after = await service(configured, net).resume();

    expect(after).toMatchObject({ signedIn: false, account: { deviceId: DEVICE } });
    // A refused refresh and an unreachable server are the same answer here, and
    // throwing the token away on the second would turn a five-minute outage into
    // a password the user has to go and find.
    expect(store.read()?.refreshToken).toBe("refresh-2");
  });

  it("asks nothing of the network on a computer that was never enrolled", async () => {
    const net = wire();
    const sync = service(configured, net);
    expect(await sync.resume()).toMatchObject({ account: null, signedIn: false });
    expect(net.urls).toEqual([]);
  });
});

describe("reconnect", () => {
  it("refuses before a packet when cloud is off, or the build has no project", async () => {
    const request = { password: "a password nobody sends", deviceName: "Anin laptop" };
    expect(await service(configured, wire(), false).reconnect(request)).toEqual({
      outcome: "refused",
      reason: "cloud_off",
    });
    expect(await service({}).reconnect(request)).toEqual({
      outcome: "refused",
      reason: "cloud_off",
    });
  });

  it("refuses while the database is locked, because the wrap cannot be opened", async () => {
    locked = true;
    expect(
      await service(configured).reconnect({ password: "x", deviceName: "Anin laptop" }),
    ).toEqual({ outcome: "refused", reason: "locked" });
  });

  it("refuses on a computer that has no account to get back onto", async () => {
    expect(
      await service(configured).reconnect({ password: "x", deviceName: "Anin laptop" }),
    ).toEqual({ outcome: "refused", reason: "not_enabled_here" });
  });

  it("signs in, buys a new device row, and stores both halves of it", async () => {
    const net = wire();
    await service(configured, net).enable(enableInput);
    net.urls.length = 0;

    const after = await service(configured, net).reconnect({
      password: "a password nobody sends",
      deviceName: "Anin laptop",
    });

    expect(net.urls.map((url) => url.slice(ORIGIN.length))).toEqual([
      "/auth/v1/token?grant_type=password",
      "/functions/v1/device-register",
    ]);
    expect(after).toMatchObject({
      outcome: "reconnected",
      status: { signedIn: true, account: { deviceId: SECOND_DEVICE } },
    });
    // The row this desktop now owns AND the token that will resume it next
    // launch. Either one missing leaves a machine reconnected only until it is
    // closed, which is the failure nobody reports because it looks like nothing.
    expect(store.read()).toMatchObject({ deviceId: SECOND_DEVICE, refreshToken: "refresh-3" });
  });

  it("leaves the stored row alone when the server refuses the proof", async () => {
    const net = wire({ registerStatus: 403, registerBody: '{"error":"proof_rejected"}' });
    await service(configured, net).enable(enableInput);

    const after = await service(configured, net).reconnect({
      password: "a password nobody sends",
      deviceName: "Anin laptop",
    });

    expect(after).toEqual({ outcome: "refused", reason: "proof_rejected" });
    expect(store.read()).toMatchObject({ deviceId: DEVICE, refreshToken: "refresh-2" });
  });

  it("refuses a device name this schema cannot store, without signing in", async () => {
    const net = wire();
    await service(configured, net).enable(enableInput);
    net.urls.length = 0;

    const after = await service(configured, net).reconnect({
      password: "a password nobody sends",
      deviceName: "   ",
    });
    expect(after).toEqual({ outcome: "refused", reason: "bad_request" });
    expect(net.urls).toEqual([]);
  });
});

describe("adopt", () => {
  const adoptInput = {
    email: "  Ana@Example.COM ",
    password: "a password nobody sends",
    totpCode: "123456",
    recoveryCode: "placeholder — every test that gets this far replaces it",
    deviceName: "Anin stoni računar",
  };

  /** Enable on the first machine, and hand back the code it printed once. */
  const mintOn = async (net: Wire): Promise<string> => {
    const result = await service(configured, net).enable(enableInput);
    if (result.outcome !== "enabled") throw new Error(`the mint did not happen: ${result.outcome}`);
    return result.recoveryCode;
  };

  it("refuses before a packet when cloud is off, or the build has no project", async () => {
    const net = wire();
    expect(await otherMachine(net, configured, false).sync.adopt(adoptInput)).toEqual({
      outcome: "refused",
      reason: "cloud_off",
    });
    expect(await otherMachine(net, {}).sync.adopt(adoptInput)).toEqual({
      outcome: "refused",
      reason: "cloud_off",
    });
    expect(net.urls).toEqual([]);
  });

  it("refuses while the database is locked, because there is no key to wrap under", async () => {
    const net = wire();
    const second = otherMachine(net);
    locked = true;
    expect(await second.sync.adopt(adoptInput)).toEqual({ outcome: "refused", reason: "locked" });
    expect(net.urls).toEqual([]);
  });

  /**
   * The mirror of enable's own guard, and it exists for a sharper reason:
   * adopting over a live account would overwrite the local wrap — the only copy
   * of MK this computer holds — after a step-up has already revoked every other
   * session on the account.
   */
  it("refuses on a computer that already belongs to an account", async () => {
    const net = wire();
    const code = await mintOn(net);
    net.urls.length = 0;

    expect(await service(configured, net).adopt({ ...adoptInput, recoveryCode: code })).toEqual({
      outcome: "refused",
      reason: "already_enabled",
    });
    expect(net.urls).toEqual([]);
    // The row the first enable wrote is untouched.
    expect(store.read()).toMatchObject({ deviceId: DEVICE });
  });

  it("refuses a device name this schema cannot store, without signing in", async () => {
    const net = wire();
    const code = await mintOn(net);
    net.urls.length = 0;

    const second = otherMachine(net);
    expect(
      await second.sync.adopt({ ...adoptInput, recoveryCode: code, deviceName: "   " }),
    ).toEqual({ outcome: "refused", reason: "bad_request" });
    // Before the sign-in, and therefore before the step-up that would have
    // signed the user's other computers out to learn this.
    expect(net.urls).toEqual([]);
    expect(second.store.read()).toBeNull();
  });

  it("joins the account with the code the first computer printed, and stores its own row", async () => {
    const net = wire();
    const code = await mintOn(net);
    net.urls.length = 0;

    const second = otherMachine(net);
    const after = await second.sync.adopt({ ...adoptInput, recoveryCode: code });

    expect(after).toMatchObject({
      outcome: "adopted",
      status: { signedIn: true, account: { deviceId: SECOND_DEVICE } },
    });
    expect(second.store.read()).toMatchObject({
      userId: USER,
      // The normalised address, because that is what a later sign-in derives
      // its key from — and adopt returns it rather than re-normalising here.
      email: "ana@example.com",
      deviceId: SECOND_DEVICE,
      refreshToken: "refresh-4",
      enabledAt: "2026-08-16T09:00:00.000Z",
    });
    // Wrapped under the SECOND machine's data key, which is the whole point of
    // the local wrap: MK is re-openable here and nowhere else.
    expect(second.store.read()?.localWrap.purpose).toBe("mk/local-data-key");
    // And the first machine's account row is untouched by any of it.
    expect(store.read()).toMatchObject({ deviceId: DEVICE });
  });

  it("walks the eight steps in order and retires its scaffolding on the way out", async () => {
    const net = wire();
    const code = await mintOn(net);
    net.urls.length = 0;

    await otherMachine(net).sync.adopt({ ...adoptInput, recoveryCode: code });

    expect(net.urls.map((url) => url.slice(ORIGIN.length))).toEqual([
      "/auth/v1/token?grant_type=password",
      "/auth/v1/user",
      `/auth/v1/factors/${FACTOR}/challenge`,
      `/auth/v1/factors/${FACTOR}/verify`,
      "/rest/v1/devices?select=id",
      "/rest/v1/key_wraps?select=kind%2Cnonce%2Cwrapped%2Ccommit_tag%2Ckdf_salt%2Ckdf_params&kind=eq.mk_under_src",
      "/auth/v1/token?grant_type=password",
      "/functions/v1/device-register",
      `/rest/v1/devices?id=eq.${BOOTSTRAP_DEVICE}&select=id`,
      "/auth/v1/logout?scope=local",
    ]);
  });

  it("rejects a wrong recovery code, and still retires the row it wrote to try", async () => {
    const net = wire();
    await mintOn(net);
    net.urls.length = 0;

    const second = otherMachine(net);
    const after = await second.sync.adopt({
      ...adoptInput,
      recoveryCode: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF",
    });

    expect(after).toEqual({ outcome: "refused", reason: "recovery_code_rejected" });
    expect(second.store.read()).toBeNull();
    // The scaffolding row is retired on the failing path too. A live `web` row
    // for a session that is about to be signed out is scaffolding nobody comes
    // back for, and `devices` rows are never deleted.
    expect(net.urls.map((url) => url.slice(ORIGIN.length))).toContain(
      `/rest/v1/devices?id=eq.${BOOTSTRAP_DEVICE}&select=id`,
    );
  });

  it("says the account never minted rather than blaming the code", async () => {
    // An account with no `mk_under_src` has nothing to adopt. Retyping the code
    // cannot help, so telling the user it was wrong would send them at the one
    // thing that is fine.
    const net = wire({ keyWrapsBody: "[]" });
    const second = otherMachine(net);
    expect(await second.sync.adopt({ ...adoptInput, recoveryCode: "AAAA-BBBB" })).toEqual({
      outcome: "refused",
      reason: "not_minted",
    });
    expect(second.store.read()).toBeNull();
  });

  it("stops when the bootstrap row is refused, because nothing on the account is readable", async () => {
    const net = wire({ deviceInsertStatus: 403 });
    const second = otherMachine(net);
    expect(await second.sync.adopt({ ...adoptInput, recoveryCode: "AAAA-BBBB" })).toEqual({
      outcome: "refused",
      reason: "bootstrap_failed",
    });
    expect(net.urls.some((url) => url.includes("/key_wraps"))).toBe(false);
    expect(second.store.read()).toBeNull();
  });

  it("leaves nothing stored when the server refuses the device registration", async () => {
    const net = wire({ registerStatus: 403, registerBody: '{"error":"too_many_devices"}' });
    const code = await mintOn(net);

    const second = otherMachine(net);
    const after = await second.sync.adopt({ ...adoptInput, recoveryCode: code });

    expect(after).toEqual({ outcome: "refused", reason: "too_many_devices" });
    expect(second.store.read()).toBeNull();
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
