import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { openPrivNote, type ExportPrivateNotes, type PrivNoteEnvelope } from "@nexus/core";
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
import { PRIV_ATTACHMENTS_MAX_COUNT } from "../shared/ipc.js";
import {
  PRIV_VERSION_WRITE_CADENCE,
  privAddAttachment,
  privCollectForExport,
  privDelete,
  privHandleMinimize,
  privList,
  privLock,
  privOpenAttachment,
  privRead,
  privReadAttachmentForExport,
  privResealForRestore,
  privSearch,
  privSessionBlobKey,
  privSetLockPrefs,
  privSetup,
  privStatus,
  privUnlock,
  privUnlockedFor,
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
/** The `PrivDeps.privBlobs` seam, in memory — id → sealed container, exactly what the disk would hold. */
let privBlobFiles: Map<string, Uint8Array>;

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
    privBlobs: {
      write: async (id, sealed) => {
        privBlobFiles.set(id, sealed);
      },
      read: async (id) => {
        const sealed = privBlobFiles.get(id);
        if (sealed === undefined) throw new Error(`No private blob "${id}".`);
        return sealed;
      },
      remove: async (id) => {
        privBlobFiles.delete(id);
      },
    },
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
  privBlobFiles = new Map();
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
      hasRecoveryKit: false,
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
        hasRecoveryKit: false,
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
    expect(result.status.hasRecoveryKit).toBe(true);

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
    await expect(privDelete(deps, profileId, id)).rejects.toThrow("locked");
    await expect(privSearch(deps, profileId, "dnevnik")).rejects.toThrow("locked");
    await expect(
      privAddAttachment(deps, profileId, { fileName: "a.png", mime: "image/png", bytes: new Uint8Array([1]) }),
    ).rejects.toThrow("locked");
    await expect(privOpenAttachment(deps, profileId, "any")).rejects.toThrow("locked");
    expect(await privSessionBlobKey()).toBeNull();
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

  it("round-trips an envelope carrying attachment references", async () => {
    const deps = makeDeps();
    await setUp(deps);
    const refs = [{ id: "a1", fileName: "x.png", mime: "image/png", sizeBytes: 1 }];
    const { id } = await privWrite(deps, profileId, null, envelope({ attachments: refs }));
    expect((await privRead(deps, profileId, id)).attachments).toEqual(refs);
  });

  it(`refuses an envelope past the ${PRIV_ATTACHMENTS_MAX_COUNT}-attachment cap`, async () => {
    const deps = makeDeps();
    await setUp(deps);
    const refs = Array.from({ length: PRIV_ATTACHMENTS_MAX_COUNT + 1 }, (_, index) => ({
      id: `a${index}`,
      fileName: "x.bin",
      mime: "application/octet-stream",
      sizeBytes: 1,
    }));
    await expect(
      privWrite(deps, profileId, null, envelope({ attachments: refs })),
    ).rejects.toThrow("at most");
  });
});

describe("private attachments", () => {
  it("seals bytes under a random id and opens them back — and only under that id", async () => {
    const deps = makeDeps();
    await setUp(deps);
    const bytes = new Uint8Array([9, 8, 7, 6, 5]);
    const ref = await privAddAttachment(deps, profileId, {
      fileName: "tajna.pdf",
      mime: "application/pdf",
      bytes,
    });
    expect(ref).toMatchObject({ fileName: "tajna.pdf", mime: "application/pdf", sizeBytes: 5 });

    // The stored file is a sealed NXPB container, never the plaintext.
    const sealed = privBlobFiles.get(ref.id);
    expect(sealed).toBeDefined();
    expect(Buffer.from(sealed!).includes(Buffer.from(bytes))).toBe(false);

    expect(await privOpenAttachment(deps, profileId, ref.id)).toEqual(bytes);
    // A swapped id fails the AAD — the whole point of binding it.
    privBlobFiles.set("other-id", sealed!);
    await expect(privOpenAttachment(deps, profileId, "other-id")).rejects.toThrow();
  });

  it("privSessionBlobKey answers the open section's key, and null once locked", async () => {
    const deps = makeDeps();
    await setUp(deps);
    expect(await privSessionBlobKey()).toHaveLength(32);
    privLock();
    expect(await privSessionBlobKey()).toBeNull();
  });

  it("sealing identical bytes twice yields two unrelated containers — no content addressing, by design", async () => {
    const deps = makeDeps();
    await setUp(deps);
    const bytes = new Uint8Array([1, 2, 3]);
    const first = await privAddAttachment(deps, profileId, { fileName: "a", mime: "x/y", bytes });
    const second = await privAddAttachment(deps, profileId, { fileName: "a", mime: "x/y", bytes });
    expect(first.id).not.toBe(second.id);
    expect(privBlobFiles.get(first.id)).not.toEqual(privBlobFiles.get(second.id));
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
    await privDelete(deps, profileId, id);
    expect(await privList(deps, profileId)).toEqual([]);
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM private_notes").get() as { n: number }).n,
    ).toBe(0);
  });

  it("unlinks the note's sealed attachment blobs with the row", async () => {
    const deps = makeDeps();
    await setUp(deps);
    const ref = await privAddAttachment(deps, profileId, {
      fileName: "a.bin",
      mime: "application/octet-stream",
      bytes: new Uint8Array([1, 2]),
    });
    const kept = await privAddAttachment(deps, profileId, {
      fileName: "b.bin",
      mime: "application/octet-stream",
      bytes: new Uint8Array([3]),
    });
    const { id } = await privWrite(deps, profileId, null, envelope({ attachments: [ref] }));
    await privDelete(deps, profileId, id);
    expect(privBlobFiles.has(ref.id)).toBe(false);
    // A blob another envelope may still name is not this delete's to take.
    expect(privBlobFiles.has(kept.id)).toBe(true);
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

// --- Interchange (IMEX, ADR-057 §6) ------------------------------------------

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** A real, decodable Yjs state holding one `attachmentImage` node referencing `attachmentId` — what the re-seal's state remap has to rewrite. */
function stateWithAttachment(attachmentId: string): Uint8Array {
  const doc = new Y.Doc();
  const el = new Y.XmlElement("attachmentImage");
  doc.getXmlFragment("default").push([el]);
  el.setAttribute("attachmentId", attachmentId);
  const snapshot = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return snapshot;
}

/** Every `attachmentImage` node's `attachmentId` in `state`, in document order. */
function attachmentIdsOf(state: Uint8Array): string[] {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return doc
      .getXmlFragment("default")
      .toArray()
      .filter((node): node is Y.XmlElement => node instanceof Y.XmlElement && node.nodeName === "attachmentImage")
      .map((node) => node.getAttribute("attachmentId") ?? "");
  } finally {
    doc.destroy();
  }
}

describe("privCollectForExport (ADR-057 §6)", () => {
  it("answers null/null while there is nothing to carry — no setup, or zero notes", async () => {
    const deps = makeDeps();
    expect(await privCollectForExport(deps, profileId, true)).toEqual({ data: null, skipped: null });

    await setUp(deps);
    // Set up, unlocked, zero notes: nothing rides AND nothing was skipped —
    // even for a plaintext export, which has nothing to exclude.
    expect(await privCollectForExport(deps, profileId, false)).toEqual({ data: null, skipped: null });
  });

  it("names 'plaintext' for an unencrypted export — dominant even over a locked section", async () => {
    const deps = makeDeps();
    await setUp(deps);
    await privWrite(deps, profileId, null, envelope());

    expect(await privCollectForExport(deps, profileId, false)).toEqual({
      data: null,
      skipped: "plaintext",
    });
    privLock();
    // Unlocking would change nothing about shipping data in the clear.
    expect(await privCollectForExport(deps, profileId, false)).toEqual({
      data: null,
      skipped: "plaintext",
    });
  });

  it("names 'locked' for an encrypted export while the section is sealed", async () => {
    const deps = makeDeps();
    await setUp(deps);
    await privWrite(deps, profileId, null, envelope());
    privLock();

    expect(await privCollectForExport(deps, profileId, true)).toEqual({
      data: null,
      skipped: "locked",
    });
    expect(privUnlockedFor(profileId)).toBe(false);
  });

  it("decrypts every live envelope AND every surviving version while unlocked and encrypted", async () => {
    const deps = makeDeps();
    await setUp(deps);
    const { id } = await privWrite(deps, profileId, null, envelope({ title: "Prva" }));
    // Drive the write cadence to its capturing write, so a real version row
    // exists: the state being replaced lands sealed at seq 1.
    for (let write = 2; write <= PRIV_VERSION_WRITE_CADENCE; write += 1) {
      await privWrite(deps, profileId, id, envelope({ title: `Prva v${write}` }));
    }

    const outcome = await privCollectForExport(deps, profileId, true);
    expect(outcome.skipped).toBeNull();
    if (outcome.data === null) throw new Error("expected the decrypted section");
    expect(outcome.data.notes.map((note) => [note.id, note.title])).toEqual([
      [id, `Prva v${PRIV_VERSION_WRITE_CADENCE}`],
    ]);
    expect(outcome.data.versions.map((version) => [version.noteId, version.seq, version.title])).toEqual([
      [id, 1, `Prva v${PRIV_VERSION_WRITE_CADENCE - 1}`],
    ]);
  });
});

describe("privReadAttachmentForExport (ADR-057 §6)", () => {
  it("answers the plaintext under the open section, and null for a lock or an unknown id", async () => {
    const deps = makeDeps();
    await setUp(deps);
    const bytes = new Uint8Array([9, 8, 7]);
    const ref = await privAddAttachment(deps, profileId, {
      fileName: "slika.png",
      mime: "image/png",
      bytes,
    });

    expect(await privReadAttachmentForExport(deps, ref.id)).toEqual(bytes);
    expect(await privReadAttachmentForExport(deps, "no-such-id")).toBeNull();
    privLock();
    expect(await privReadAttachmentForExport(deps, ref.id)).toBeNull();
  });
});

describe("privResealForRestore (ADR-057 §6)", () => {
  const ARCHIVE_ATT_A = "0a1b2c3d-1111-4222-8333-abcdefabcdef";
  const ARCHIVE_ATT_B = "ffffffff-2222-4333-8444-000000000001";

  function archiveData(): ExportPrivateNotes {
    return {
      notes: [
        {
          id: "arch-note",
          title: "Iz arhive",
          yjsState: b64(stateWithAttachment(ARCHIVE_ATT_A)),
          plaintext: "sadržaj iz arhive",
          attachments: [
            { id: ARCHIVE_ATT_A, fileName: "slika.png", mime: "image/png", sizeBytes: 3 },
            { id: ARCHIVE_ATT_B, fileName: "nema.pdf", mime: "application/pdf", sizeBytes: 5 },
          ],
          createdAt: "2026-02-01T00:00:00.000Z",
          updatedAt: "2026-02-02T00:00:00.000Z",
        },
      ],
      versions: [
        {
          noteId: "arch-note",
          seq: 3,
          title: "Iz arhive (staro)",
          yjsState: b64(stateWithAttachment(ARCHIVE_ATT_A)),
          plaintext: "staro",
          attachments: [{ id: ARCHIVE_ATT_A, fileName: "slika.png", mime: "image/png", sizeBytes: 3 }],
          createdAt: "2026-02-01T00:00:00.000Z",
        },
      ],
    };
  }

  it("answers null while the section is locked or was never set up — the named-skip path", async () => {
    const deps = makeDeps();
    expect(await privResealForRestore(deps, profileId, archiveData(), async () => null)).toBeNull();
    await setUp(deps);
    privLock();
    expect(await privResealForRestore(deps, profileId, archiveData(), async () => null)).toBeNull();
  });

  it("re-seals under the CURRENT DEK — live at max(version seq) + 1, versions at their own seqs — with fresh attachment ids threaded through refs AND the Yjs state", async () => {
    const deps = makeDeps();
    await setUp(deps);
    const archiveBytes = new Uint8Array([1, 2, 3]);
    const outcome = await privResealForRestore(deps, profileId, archiveData(), async (id) =>
      id === ARCHIVE_ATT_A ? archiveBytes : null,
    );
    if (outcome === null) throw new Error("expected a re-seal");

    // ATT_A resolved and was re-sealed under ONE fresh id shared by the live
    // envelope and the version; ATT_B could not be supplied and is counted.
    expect(outcome.addedBlobIds).toHaveLength(1);
    expect(outcome.missingBlobs).toBe(1);
    const freshA = outcome.addedBlobIds[0];
    if (freshA === undefined) throw new Error("expected a fresh blob id");
    expect(freshA).not.toBe(ARCHIVE_ATT_A);
    // The fresh sealed file opens under the live session's own blob key.
    expect(await privOpenAttachment(deps, profileId, freshA)).toEqual(archiveBytes);

    const liveRow = outcome.rows.notes[0];
    const versionRow = outcome.rows.versions[0];
    if (liveRow === undefined || versionRow === undefined) throw new Error("expected rows");
    expect(liveRow).toMatchObject({
      id: "arch-note",
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-02T00:00:00.000Z",
    });
    expect(versionRow).toMatchObject({ noteId: "arch-note", seq: 3 });

    // The live container is bound to max(seq) + 1 = 4 and opens under the
    // CURRENT DEK; the version opens at its own archive seq.
    const live = await openVersionForTest(deps, "arch-note", 4, liveRow.sealed);
    expect(live.title).toBe("Iz arhive");
    expect(live.attachments.map((ref) => ref.id)).toEqual([freshA, expect.not.stringMatching(ARCHIVE_ATT_B)]);
    expect(attachmentIdsOf(Buffer.from(live.yjsState, "base64"))).toEqual([freshA]);

    const version = await openVersionForTest(deps, "arch-note", 3, versionRow.sealed);
    expect(version.title).toBe("Iz arhive (staro)");
    expect(version.attachments.map((ref) => ref.id)).toEqual([freshA]);
    expect(attachmentIdsOf(Buffer.from(version.yjsState, "base64"))).toEqual([freshA]);
  });
});
