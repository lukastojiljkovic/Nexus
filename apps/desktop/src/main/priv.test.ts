import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openPrivNote, type PrivNoteEnvelope } from "@nexus/core";
import {
  derivePrivCredentialKey,
  generateRecoveryCode,
  normalizeRecoveryCode,
  unwrapPrivDek,
  unwrapPrivDekWithKit,
  type KdfParams,
  type WrappedKey,
} from "@nexus/core/auth";
import {
  NexusDatabase,
  PrivateNoteStore,
  PrivateSettingsStore,
  openDatabase,
} from "@nexus/db";
import {
  PRIV_VERSION_WRITE_CADENCE,
  privDelete,
  privHandleMinimize,
  privList,
  privLock,
  privRead,
  privSearch,
  privSetLockPrefs,
  privSetup,
  privStatus,
  privUnlock,
  privWrite,
  resetPrivStateForTests,
  rewrapPrivKitsForNewCode,
  shouldCaptureVersion,
  type PrivDeps,
} from "./priv.js";

/** Argon2id small enough for a test run — the production parameters ride in through `PrivDeps.kdfParams`, exactly why that seam exists (`privKeys.test.ts`'s own precedent). */
const FAST_KDF_PARAMS: KdfParams = {
  algorithm: "argon2id",
  memoryKiB: 8,
  iterations: 1,
  parallelism: 1,
};

const DEVICE_SECRET = new Uint8Array(32).fill(7);
const PASSPHRASE = "tajna-lozinka-1";

let dir: string;
let db: NexusDatabase;
let profileId: string;

function createProfile(name: string): string {
  const id = `p-${name}`;
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, new Date().toISOString());
  return id;
}

function makeDeps(overrides: Partial<PrivDeps> = {}): PrivDeps {
  return {
    privateNotes: (pid) => new PrivateNoteStore(db.raw, pid),
    privateSettings: (pid) => new PrivateSettingsStore(db.raw, pid),
    listProfileIds: () =>
      (db.raw.prepare("SELECT id FROM profiles").all() as { id: string }[]).map((row) => row.id),
    deviceSecret: () => DEVICE_SECRET,
    kdfParams: () => FAST_KDF_PARAMS,
    verifyAccountPasscode: async () => ({ ok: true }),
    regenerateRecoveryKit: async () => generateRecoveryCode(),
    runInTransaction: (write) => db.raw.transaction(write)(),
    stillThisSession: () => true,
    now: () => new Date(),
    ...overrides,
  };
}

function envelope(overrides: Partial<PrivNoteEnvelope> = {}): PrivNoteEnvelope {
  return {
    title: "Dnevnik",
    yjsState: "AAECAw==",
    plaintext: "prvi privatni zapis",
    attachments: [],
    ...overrides,
  };
}

/** Sets PRIV up with the separate passphrase and leaves the section unlocked, the shape most tests start from. */
async function setUp(deps: PrivDeps): Promise<void> {
  const result = await privSetup(deps, profileId, {
    credential: PASSPHRASE,
    usesAccountPasscode: false,
    regenerateKit: false,
  });
  expect(result.ok).toBe(true);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nexus-priv-"));
  db = openDatabase({ path: join(dir, "test.db") });
  profileId = createProfile("A");
});

afterEach(async () => {
  resetPrivStateForTests();
  vi.useRealTimers();
  db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("shouldCaptureVersion", () => {
  it(`captures on every ${PRIV_VERSION_WRITE_CADENCE}th write and never between`, () => {
    const captured = [1, 2, 3, 4, 5, 6, 9, 10, 11, 15].filter(shouldCaptureVersion);
    expect(captured).toEqual([5, 10, 15]);
  });
});

describe("privStatus", () => {
  it("reports not-set-up with the defaults while no settings row exists", () => {
    expect(privStatus(makeDeps(), profileId)).toEqual({
      setUp: false,
      unlocked: false,
      usesAccountPasscode: false,
      autoLockMinutes: 5,
      lockOnMinimize: true,
    });
  });
});

describe("privSetup", () => {
  it("writes the settings row, holds the DEK, and reads/writes immediately", async () => {
    const deps = makeDeps();
    const result = await privSetup(deps, profileId, {
      credential: PASSPHRASE,
      usesAccountPasscode: false,
      regenerateKit: false,
    });
    expect(result).toEqual({
      ok: true,
      recoveryCode: null,
      status: {
        setUp: true,
        unlocked: true,
        usesAccountPasscode: false,
        autoLockMinutes: 5,
        lockOnMinimize: true,
      },
    });
    const settings = new PrivateSettingsStore(db.raw, profileId).get();
    expect(settings?.kitSalt).toBeNull();
    expect(settings?.kitWrap).toBeNull();

    const { id } = await privWrite(deps, profileId, null, envelope());
    expect((await privRead(deps, profileId, id)).title).toBe("Dnevnik");
  });

  it("refuses a weak separate passphrase without touching the database", async () => {
    const result = await privSetup(makeDeps(), profileId, {
      credential: "kratko",
      usesAccountPasscode: false,
      regenerateKit: false,
    });
    expect(result).toEqual({ ok: false, reason: "weakCredential" });
    expect(new PrivateSettingsStore(db.raw, profileId).get()).toBeNull();
  });

  it("verifies the account passcode through the injected seam and relays its refusal", async () => {
    const verify = vi.fn(async () => ({ ok: false, reason: "wrongPasscode" }) as const);
    const result = await privSetup(makeDeps({ verifyAccountPasscode: verify }), profileId, {
      credential: "account-pass-9",
      usesAccountPasscode: true,
      regenerateKit: false,
    });
    expect(verify).toHaveBeenCalledWith("account-pass-9");
    expect(result).toEqual({ ok: false, reason: "wrongPasscode" });
    expect(new PrivateSettingsStore(db.raw, profileId).get()).toBeNull();
  });

  it("refuses a second setup", async () => {
    const deps = makeDeps();
    await setUp(deps);
    const again = await privSetup(deps, profileId, {
      credential: PASSPHRASE,
      usesAccountPasscode: false,
      regenerateKit: false,
    });
    expect(again).toEqual({ ok: false, reason: "alreadySetUp" });
  });

  it("regenerateKit mints ONE code that opens the PRIV DEK too — wrapPrivDekWithKit under the row's own salt", async () => {
    const code = generateRecoveryCode();
    const deps = makeDeps({ regenerateRecoveryKit: vi.fn(async () => code) });
    const result = await privSetup(deps, profileId, {
      credential: PASSPHRASE,
      usesAccountPasscode: false,
      regenerateKit: true,
    });
    if (!result.ok) throw new Error("setup failed");
    expect(result.recoveryCode).toBe(code);

    // The stored kit wrap opens under the canonical code — proving the same
    // sheet the account flow just printed also carries the private notes.
    const settings = new PrivateSettingsStore(db.raw, profileId).get();
    if (settings?.kitSalt == null || settings.kitWrap == null) throw new Error("kit wrap missing");
    const canonical = normalizeRecoveryCode(code);
    if (canonical === null) throw new Error("code failed to normalize");
    const dek = await unwrapPrivDekWithKit(
      JSON.parse(settings.kitWrap) as WrappedKey,
      canonical,
      new Uint8Array(Buffer.from(settings.kitSalt, "base64")),
      FAST_KDF_PARAMS,
    );
    // The kit-opened DEK opens a note the session's own DEK sealed.
    const { id } = await privWrite(deps, profileId, null, envelope());
    const store = new PrivateNoteStore(db.raw, profileId);
    const opened = await openPrivNote(dek, id, 1, store.readSealed(id));
    expect(opened.title).toBe("Dnevnik");
  });
});

describe("privUnlock", () => {
  it("unlocks with the right credential and refuses before setup", async () => {
    const deps = makeDeps();
    expect(await privUnlock(deps, profileId, PASSPHRASE)).toEqual({
      ok: false,
      reason: "notSetUp",
    });
    await setUp(deps);
    privLock();
    const result = await privUnlock(deps, profileId, PASSPHRASE);
    if (!result.ok) throw new Error("unlock failed");
    expect(result.status.unlocked).toBe(true);
  });

  it("refuses a wrong credential, then escalates into a timed throttle after the free attempts", async () => {
    const deps = makeDeps();
    await setUp(deps);
    privLock();

    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(await privUnlock(deps, profileId, "pogresna-lozinka-9")).toEqual({
        ok: false,
        reason: "wrongCredential",
      });
    }
    // The fifth failure imposes the first wait; from then on even the RIGHT
    // credential is refused until it passes.
    expect(await privUnlock(deps, profileId, "pogresna-lozinka-9")).toEqual({
      ok: false,
      reason: "wrongCredential",
    });
    const throttled = await privUnlock(deps, profileId, PASSPHRASE);
    expect(throttled.ok).toBe(false);
    if (throttled.ok || throttled.reason !== "throttled") throw new Error("expected a throttle");
    expect(throttled.lockedForMs).toBeGreaterThan(0);
  });

  it("clears the throttle count on success", async () => {
    const deps = makeDeps();
    await setUp(deps);
    privLock();
    await privUnlock(deps, profileId, "pogresna-lozinka-9");
    const ok = await privUnlock(deps, profileId, PASSPHRASE);
    expect(ok.ok).toBe(true);
  });
});

describe("privLock", () => {
  it("wipes the held key: every data call refuses afterwards", async () => {
    const deps = makeDeps();
    await setUp(deps);
    const { id } = await privWrite(deps, profileId, null, envelope());
    privLock();
    expect(privStatus(deps, profileId).unlocked).toBe(false);
    await expect(privList(deps, profileId)).rejects.toThrow("locked");
    await expect(privRead(deps, profileId, id)).rejects.toThrow("locked");
    await expect(privWrite(deps, profileId, id, envelope())).rejects.toThrow("locked");
    expect(() => privDelete(deps, profileId, id)).toThrow("locked");
    await expect(privSearch(deps, profileId, "dnevnik")).rejects.toThrow("locked");
  });

  it("locks by itself once the auto-lock interval passes without a data call", async () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    await setUp(deps);
    expect(privStatus(deps, profileId).unlocked).toBe(true);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(privStatus(deps, profileId).unlocked).toBe(false);
  });
});

describe("privWrite", () => {
  it(`captures a sealed version on every ${PRIV_VERSION_WRITE_CADENCE}th write per note per session, and the live note stays readable`, async () => {
    const deps = makeDeps();
    await setUp(deps);
    const store = new PrivateNoteStore(db.raw, profileId);

    const { id } = await privWrite(deps, profileId, null, envelope({ title: "v1" }));
    for (let write = 2; write <= 10; write++) {
      await privWrite(deps, profileId, id, envelope({ title: `v${write}` }));
    }
    // Writes 5 and 10 captured the state being replaced: v4 and v9.
    expect(store.listVersions(id).map((version) => version.seq)).toEqual([2, 1]);
    expect((await privRead(deps, profileId, id)).title).toBe("v10");

    // Each version container opens at its OWN bound seq and carries the state
    // the capturing write replaced.
    const sealedTitles = [
      (await openVersionForTest(deps, id, 1, store.readVersion(id, 1))).title,
      (await openVersionForTest(deps, id, 2, store.readVersion(id, 2))).title,
    ];
    expect(sealedTitles).toEqual(["v4", "v9"]);
  });

  it("refuses an envelope carrying attachments — those arrive with slice c", async () => {
    const deps = makeDeps();
    await setUp(deps);
    await expect(
      privWrite(
        deps,
        profileId,
        null,
        envelope({
          attachments: [{ id: "a1", fileName: "x.png", mime: "image/png", sizeBytes: 1 }],
        }),
      ),
    ).rejects.toThrow("attachments");
  });
});

/** Opens a captured version container by re-deriving the DEK from the settings row exactly as `privUnlock` does — version-read channels are slice c's, so tests reach the bytes store-side. */
async function openVersionForTest(
  deps: PrivDeps,
  noteId: string,
  seq: number,
  sealed: Uint8Array,
): Promise<PrivNoteEnvelope> {
  const settings = deps.privateSettings(profileId).get();
  if (settings === null) throw new Error("not set up");
  const kek = await derivePrivCredentialKey(
    PASSPHRASE,
    new Uint8Array(Buffer.from(settings.passSalt, "base64")),
    DEVICE_SECRET,
    FAST_KDF_PARAMS,
  );
  const dek = await unwrapPrivDek(JSON.parse(settings.passWrap) as WrappedKey, kek);
  return openPrivNote(dek, noteId, seq, sealed);
}

describe("privList / privSearch", () => {
  it("lists decrypted titles newest-first and reports a corrupt row as a named unreadable entry, never a crash", async () => {
    const deps = makeDeps();
    await setUp(deps);
    const good = await privWrite(deps, profileId, null, envelope({ title: "Čitljiva" }));
    const bad = await privWrite(deps, profileId, null, envelope({ title: "Oštećena" }));
    db.raw
      .prepare("UPDATE private_notes SET sealed = ? WHERE id = ?")
      .run(Buffer.from([1, 2, 3, 4]), bad.id);

    const entries = await privList(deps, profileId);
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.id === good.id)).toMatchObject({
      title: "Čitljiva",
      unreadable: false,
    });
    expect(entries.find((entry) => entry.id === bad.id)).toMatchObject({
      title: null,
      unreadable: true,
    });
  });

  it("searches decrypted envelopes through the shared folding grammar, title matches first", async () => {
    const deps = makeDeps();
    await setUp(deps);
    const inTitle = await privWrite(deps, profileId, null, envelope({ title: "Đorđe", plaintext: "ništa" }));
    const inBody = await privWrite(deps, profileId, null, envelope({ title: "Drugo", plaintext: "o Đorđu i još nečemu" }));
    await privWrite(deps, profileId, null, envelope({ title: "Treće", plaintext: "nevezano" }));

    expect(await privSearch(deps, profileId, "djordj")).toEqual([inTitle.id, inBody.id]);
    expect(await privSearch(deps, profileId, "")).toEqual([]);
  });
});

describe("privDelete", () => {
  it("hard-deletes the row and its versions", async () => {
    const deps = makeDeps();
    await setUp(deps);
    const { id } = await privWrite(deps, profileId, null, envelope());
    privDelete(deps, profileId, id);
    expect(await privList(deps, profileId)).toEqual([]);
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM private_notes").get() as { n: number }).n,
    ).toBe(0);
  });
});

describe("privSetLockPrefs / privHandleMinimize", () => {
  it("persists the prefs and locks on minimize exactly when the preference says so", async () => {
    const deps = makeDeps();
    await setUp(deps);
    privHandleMinimize(deps); // default lockOnMinimize: true
    expect(privStatus(deps, profileId).unlocked).toBe(false);

    const unlocked = await privUnlock(deps, profileId, PASSPHRASE);
    expect(unlocked.ok).toBe(true);
    const status = privSetLockPrefs(deps, profileId, {
      autoLockMinutes: 30,
      lockOnMinimize: false,
    });
    expect(status).toMatchObject({ autoLockMinutes: 30, lockOnMinimize: false });
    privHandleMinimize(deps);
    expect(privStatus(deps, profileId).unlocked).toBe(true);
  });
});

describe("rewrapPrivKitsForNewCode", () => {
  it("re-wraps an UNLOCKED profile's kit under the new code and drops a LOCKED profile's stale kit to null", async () => {
    const deps = makeDeps();
    const otherProfile = createProfile("B");

    // Profile B: set up with a kit, then lock — its DEK is unreachable.
    const otherSetup = await privSetup(deps, otherProfile, {
      credential: PASSPHRASE,
      usesAccountPasscode: false,
      regenerateKit: true,
    });
    expect(otherSetup.ok).toBe(true);
    // Profile A: set up with a kit and stay unlocked (setup B's session was
    // replaced by A's — one PRIV section at a time).
    const setup = await privSetup(deps, profileId, {
      credential: PASSPHRASE,
      usesAccountPasscode: false,
      regenerateKit: true,
    });
    expect(setup.ok).toBe(true);

    const newCode = generateRecoveryCode();
    await rewrapPrivKitsForNewCode(deps, newCode);

    // A (unlocked): the new code opens the new wrap.
    const settingsA = new PrivateSettingsStore(db.raw, profileId).get();
    if (settingsA?.kitSalt == null || settingsA.kitWrap == null) throw new Error("kit missing");
    const canonical = normalizeRecoveryCode(newCode);
    if (canonical === null) throw new Error("code failed to normalize");
    await expect(
      unwrapPrivDekWithKit(
        JSON.parse(settingsA.kitWrap) as WrappedKey,
        canonical,
        new Uint8Array(Buffer.from(settingsA.kitSalt, "base64")),
        FAST_KDF_PARAMS,
      ),
    ).resolves.toHaveLength(32);

    // B (locked): the stale wrap is DROPPED rather than left openable under a
    // code the account flow just declared dead.
    const settingsB = new PrivateSettingsStore(db.raw, otherProfile).get();
    expect(settingsB?.kitSalt).toBeNull();
    expect(settingsB?.kitWrap).toBeNull();
  });
});
