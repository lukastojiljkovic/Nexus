import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_PRIV_AUTO_LOCK_MINUTES,
  NexusDatabase,
  PrivateSettingsStore,
  PrivateSettingsValidationError,
  openDatabase,
  type CreatePrivateSettingsInput,
} from "../index.js";

let dir: string;
let db: NexusDatabase;
let store: PrivateSettingsStore;

const NOW = "2026-07-30T10:00:00.000Z";
const LATER = "2026-07-30T11:00:00.000Z";

/** A valid credential-only setup; tests spread overrides on top. */
function input(overrides: Partial<CreatePrivateSettingsInput> = {}): CreatePrivateSettingsInput {
  return {
    kdf: '{"algorithm":"argon2id","memoryKiB":65536,"iterations":3,"parallelism":1}',
    passSalt: "c2FsdA==",
    passWrap: '{"nonce":"bg==","ciphertext":"Y3Q="}',
    kitSalt: null,
    kitWrap: null,
    usesAccountPasscode: false,
    autoLockMinutes: DEFAULT_PRIV_AUTO_LOCK_MINUTES,
    lockOnMinimize: true,
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-priv-settings-"));
  db = openDatabase({ path: join(dir, "test.db") });
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run("p1", "personal", "P", NOW);
  store = new PrivateSettingsStore(db.raw, "p1");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("get / create", () => {
  it("answers null while PRIV was never set up — absence IS 'not set up'", () => {
    expect(store.get()).toBeNull();
  });

  it("creates the row and reads it back, opaque fields untouched", () => {
    store.create(input({ kitSalt: "a2l0", kitWrap: '{"nonce":"bg==","ciphertext":"a3c="}' }), NOW);
    expect(store.get()).toEqual({
      kdf: '{"algorithm":"argon2id","memoryKiB":65536,"iterations":3,"parallelism":1}',
      passSalt: "c2FsdA==",
      passWrap: '{"nonce":"bg==","ciphertext":"Y3Q="}',
      kitSalt: "a2l0",
      kitWrap: '{"nonce":"bg==","ciphertext":"a3c="}',
      usesAccountPasscode: false,
      autoLockMinutes: DEFAULT_PRIV_AUTO_LOCK_MINUTES,
      lockOnMinimize: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("refuses a second setup — the row's existence is what 'already set up' means", () => {
    store.create(input(), NOW);
    expect(() => store.create(input(), LATER)).toThrow(PrivateSettingsValidationError);
  });

  it("refuses a kit salt without a kit wrap and the reverse", () => {
    expect(() => store.create(input({ kitSalt: "a2l0" }), NOW)).toThrow(
      PrivateSettingsValidationError,
    );
    expect(() => store.create(input({ kitWrap: '{"v":1}' }), NOW)).toThrow(
      PrivateSettingsValidationError,
    );
  });

  it("refuses empty opaque fields, out-of-range lock minutes and a malformed now", () => {
    expect(() => store.create(input({ passWrap: "" }), NOW)).toThrow(
      PrivateSettingsValidationError,
    );
    expect(() => store.create(input({ autoLockMinutes: 0 }), NOW)).toThrow(
      PrivateSettingsValidationError,
    );
    expect(() => store.create(input({ autoLockMinutes: 61 }), NOW)).toThrow(
      PrivateSettingsValidationError,
    );
    expect(() => store.create(input({ autoLockMinutes: 2.5 }), NOW)).toThrow(
      PrivateSettingsValidationError,
    );
    expect(() => store.create(input(), "yesterday")).toThrow(PrivateSettingsValidationError);
  });
});

describe("updateLockPrefs", () => {
  it("changes only the two lock preferences and bumps updated_at", () => {
    store.create(input(), NOW);
    const updated = store.updateLockPrefs(30, false, LATER);
    expect(updated.autoLockMinutes).toBe(30);
    expect(updated.lockOnMinimize).toBe(false);
    expect(updated.passWrap).toBe(input().passWrap);
    expect(updated.createdAt).toBe(NOW);
    expect(updated.updatedAt).toBe(LATER);
  });

  it("refuses before setup and outside the 1..60 bound", () => {
    expect(() => store.updateLockPrefs(5, true, NOW)).toThrow(PrivateSettingsValidationError);
    store.create(input(), NOW);
    expect(() => store.updateLockPrefs(0, true, LATER)).toThrow(PrivateSettingsValidationError);
  });
});

describe("replaceWraps", () => {
  it("replaces the whole wrap set — kit regeneration and credential change ride the same statement", () => {
    store.create(input(), NOW);
    const updated = store.replaceWraps(
      {
        kdf: '{"algorithm":"argon2id","memoryKiB":65536,"iterations":4,"parallelism":1}',
        passSalt: "bmV3",
        passWrap: '{"nonce":"bg==","ciphertext":"bnc="}',
        kitSalt: "a2l0Mg==",
        kitWrap: '{"nonce":"bg==","ciphertext":"a3cy"}',
        usesAccountPasscode: true,
      },
      LATER,
    );
    expect(updated.passSalt).toBe("bmV3");
    expect(updated.kitSalt).toBe("a2l0Mg==");
    expect(updated.usesAccountPasscode).toBe(true);
    expect(updated.autoLockMinutes).toBe(DEFAULT_PRIV_AUTO_LOCK_MINUTES); // lock prefs untouched
    expect(updated.updatedAt).toBe(LATER);
  });

  it("can drop the kit wraps to NULL together — opting back out of the Recovery Kit", () => {
    store.create(input({ kitSalt: "a2l0", kitWrap: '{"v":1}' }), NOW);
    const updated = store.replaceWraps(
      {
        kdf: input().kdf,
        passSalt: input().passSalt,
        passWrap: input().passWrap,
        kitSalt: null,
        kitWrap: null,
        usesAccountPasscode: false,
      },
      LATER,
    );
    expect(updated.kitSalt).toBeNull();
    expect(updated.kitWrap).toBeNull();
  });

  it("refuses before setup and refuses a half-present kit pair", () => {
    expect(() =>
      store.replaceWraps(
        {
          kdf: input().kdf,
          passSalt: input().passSalt,
          passWrap: input().passWrap,
          kitSalt: null,
          kitWrap: null,
          usesAccountPasscode: false,
        },
        NOW,
      ),
    ).toThrow(PrivateSettingsValidationError);
    store.create(input(), NOW);
    expect(() =>
      store.replaceWraps(
        {
          kdf: input().kdf,
          passSalt: input().passSalt,
          passWrap: input().passWrap,
          kitSalt: "a2l0",
          kitWrap: null,
          usesAccountPasscode: false,
        },
        LATER,
      ),
    ).toThrow(PrivateSettingsValidationError);
  });
});
