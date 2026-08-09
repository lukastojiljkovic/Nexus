import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SealedKey } from "@nexus/sync-crypto";
import { NexusDatabase, SyncAccountStore, openDatabase } from "../index.js";

let dir: string;
let db: NexusDatabase;
let store: SyncAccountStore;

/** Shaped exactly as `parseSealedKey` demands: 32, 24 and 48 bytes, base64url. */
const wrap = (purpose: SealedKey["purpose"] = "mk/local-data-key"): SealedKey => ({
  v: 2,
  purpose,
  commitment: "A".repeat(43),
  nonce: "B".repeat(32),
  ciphertext: "C".repeat(64),
});

const input = {
  userId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  email: "ana@example.com",
  deviceId: "device-1",
  localWrap: wrap(),
  refreshToken: "refresh-one",
  enabledAt: "2026-08-09T18:00:00.000Z",
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-sync-account-"));
  db = openDatabase({ path: join(dir, "account.db") });
  store = new SyncAccountStore(db.raw);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("SyncAccountStore", () => {
  /** What every 1.0.0 file holds, and what a user who never turns cloud on keeps. */
  it("reads nothing from a file that has never enabled sync", () => {
    expect(store.read()).toBeNull();
  });

  it("round-trips the account, wrap included", () => {
    store.save(input);
    expect(store.read()).toEqual(input);
  });

  /**
   * `CHECK (id = 1)` and the upsert together: a Nexus file has one local data
   * key, so it can belong to one account. Two rows would be two master keys
   * claiming the same file.
   */
  it("holds exactly one account, replacing rather than accumulating", () => {
    store.save(input);
    store.save({ ...input, userId: "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee", email: "b@e.com" });

    expect(db.raw.prepare("SELECT count(*) AS n FROM sync_account").get()).toEqual({ n: 1 });
    expect(store.read()?.email).toBe("b@e.com");
  });

  it("rotates the refresh token without being handed the wrap again", () => {
    store.save(input);
    store.setRefreshToken("refresh-two");
    expect(store.read()?.refreshToken).toBe("refresh-two");
    expect(store.read()?.localWrap).toEqual(wrap());
  });

  /** Signed out is a state an ENABLED account can be in, not a missing account. */
  it("keeps the account when the refresh token is cleared", () => {
    store.save(input);
    store.setRefreshToken(null);
    expect(store.read()).toMatchObject({ refreshToken: null, userId: input.userId });
  });

  it("fills in a device id the mint could not read back", () => {
    store.save({ ...input, deviceId: null });
    expect(store.read()?.deviceId).toBeNull();
    store.setDeviceId("device-9");
    expect(store.read()?.deviceId).toBe("device-9");
  });

  it("forgets the account entirely when told to", () => {
    store.save(input);
    store.forget();
    expect(store.read()).toBeNull();
  });

  /**
   * The wrap is validated on the way out as well as in. A row read as „whatever
   * JSON was in the column" would be handed to `unwrapKey`, and a corrupt row
   * would surface as a cryptographic error nobody could place.
   */
  it("refuses to read a wrap that is not one, rather than passing it on", () => {
    store.save(input);
    for (const damaged of [
      "not json",
      JSON.stringify({ ...wrap(), v: 1 }),
      JSON.stringify({ ...wrap(), extra: "smuggled" }),
      JSON.stringify({ ...wrap(), nonce: "B".repeat(20) }),
    ]) {
      db.raw.prepare("UPDATE sync_account SET local_wrap = ? WHERE id = 1").run(damaged);
      expect(() => store.read(), damaged).toThrow(TypeError);
    }
  });

  /**
   * A wrap of the right SHAPE and the wrong purpose opens under no key this
   * machine has. Storing one would be a master key nothing here can reach.
   */
  it("refuses a wrap of any purpose but this computer's, in both directions", () => {
    expect(() => store.save({ ...input, localWrap: wrap("mk/web-password") })).toThrow(TypeError);

    store.save(input);
    db.raw
      .prepare("UPDATE sync_account SET local_wrap = ? WHERE id = 1")
      .run(JSON.stringify(wrap("mk/sync-recovery")));
    expect(() => store.read()).toThrow(TypeError);
  });

  /** The schema refuses the empty strings that would make a row meaningless. */
  it("refuses an account with no user or no address", () => {
    expect(() => store.save({ ...input, userId: "" })).toThrow();
    expect(() => store.save({ ...input, email: "" })).toThrow();
  });
});
