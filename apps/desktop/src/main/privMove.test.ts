import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { sniffMime } from "@nexus/core";
import type { KdfParams } from "@nexus/core/auth";
import {
  CardStore,
  NexusDatabase,
  NoteAttachmentStore,
  NoteStore,
  PrivateNoteStore,
  PrivateSettingsStore,
  openDatabase,
  rebuildSearchIndex,
  uuidv7,
} from "@nexus/db";
import { generateRecoveryCode } from "@nexus/core/auth";
import { privList, privLock, privRead, privSetup, resetPrivStateForTests, type PrivDeps } from "./priv.js";
import { moveNoteToPrivate, movePrivateNoteOut, type PrivMoveDeps } from "./privMove.js";

/** Argon2id small enough for a test run — `priv.test.ts`'s own parameters. */
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
/** The `PrivDeps.privBlobs` seam, in memory — id → sealed container. */
let privBlobFiles: Map<string, Uint8Array>;
/** The PUBLIC content-addressed blob store, in memory — sha256 → plaintext bytes. */
let publicBlobs: Map<string, Uint8Array>;
/** Every `releaseBlob` call, in order — what move-in must GC after the teardown. */
let releasedHashes: string[];

function createProfile(name: string): string {
  const id = `p-${name}`;
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, new Date().toISOString());
  return id;
}

function makePrivDeps(): PrivDeps {
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
      list: async () => [...privBlobFiles.keys()],
    },
    privateUndoPending: () => false,
    stillThisSession: () => true,
    now: () => new Date(),
  };
}

function makeDeps(): PrivMoveDeps {
  return {
    priv: makePrivDeps(),
    notes: (pid) => new NoteStore(db.raw, pid),
    noteAttachments: (pid) => new NoteAttachmentStore(db.raw, pid),
    cards: (pid) => new CardStore(db.raw, pid),
    readBlob: async (sha256) => publicBlobs.get(sha256) ?? null,
    saveBlob: async (bytes) => {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      publicBlobs.set(sha256, bytes);
      return { sha256 };
    },
    releaseBlob: async (_pid, sha256) => {
      releasedHashes.push(sha256);
      publicBlobs.delete(sha256);
    },
    sniffMime,
    runInTransaction: (write) => db.raw.transaction(write)(),
    rebuildSearchIndex: () => {
      rebuildSearchIndex(db.raw);
    },
    now: () => new Date(),
  };
}

/** Sets PRIV up (separate passphrase, no kit) and leaves the section unlocked. */
async function setUpPriv(deps: PrivMoveDeps): Promise<void> {
  const result = await privSetup(deps.priv, profileId, {
    credential: PASSPHRASE,
    usesAccountPasscode: false,
    regenerateKit: false,
  });
  expect(result.ok).toBe(true);
}

/** A real Yjs state: one paragraph of `text`, plus optional `attachmentImage` blocks naming ids. */
function docState(text: string, attachmentIds: string[] = []): Uint8Array {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("default");
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  fragment.insert(0, [paragraph]);
  fragment.insert(
    1,
    attachmentIds.map((id) => {
      const node = new Y.XmlElement("attachmentImage");
      node.setAttribute("attachmentId", id);
      return node;
    }),
  );
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}

/** Every `attachmentImage` id inside a base64 Yjs state. */
function attachmentIdsIn(yjsStateBase64: string): string[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(Buffer.from(yjsStateBase64, "base64")));
  const ids: string[] = [];
  const walk = (node: Y.XmlElement | Y.XmlText | Y.XmlHook): void => {
    if (!(node instanceof Y.XmlElement)) return;
    if (node.nodeName === "attachmentImage") {
      const id = node.getAttribute("attachmentId");
      if (typeof id === "string") ids.push(id);
    }
    for (const child of node.toArray()) walk(child);
  };
  for (const child of doc.getXmlFragment("default").toArray()) walk(child);
  doc.destroy();
  return ids;
}

/** A public note carrying `text` (which is also its title). */
function createPublicNote(deps: PrivMoveDeps, text: string): string {
  const notes = deps.notes(profileId);
  const note = notes.create(new Date().toISOString());
  notes.appendUpdate(note.id, docState(text), text, new Date().toISOString());
  return note.id;
}

function countRows(table: string, column: string, id: string): number {
  const { n } = db.raw
    .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`)
    .get(id) as { n: number };
  return n;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nexus-priv-move-"));
  db = openDatabase({ path: join(dir, "test.db") });
  profileId = createProfile("A");
  privBlobFiles = new Map();
  publicBlobs = new Map();
  releasedHashes = [];
});

afterEach(async () => {
  resetPrivStateForTests();
  db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("moveNoteToPrivate", () => {
  it("seals the merged document as a new private note and hard-deletes the public one, FTS scrubbed", async () => {
    const deps = makeDeps();
    await setUpPriv(deps);
    const noteId = createPublicNote(deps, "Poverljiv plan");

    const result = await moveNoteToPrivate(deps, profileId, noteId);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);

    const envelope = await privRead(deps.priv, profileId, result.id);
    expect(envelope.title).toBe("Poverljiv plan");
    expect(envelope.plaintext).toContain("Poverljiv plan");
    expect(envelope.attachments).toEqual([]);

    expect(countRows("notes", "id", noteId)).toBe(0);
    expect(countRows("note_updates", "note_id", noteId)).toBe(0);
    expect(countRows("search_entries", "entity_id", noteId)).toBe(0);
    expect((await privList(deps.priv, profileId)).map((entry) => entry.id)).toEqual([result.id]);
  });

  it("moves attachment bytes into the private store, remaps the document's ids, and GCs the public blobs", async () => {
    const deps = makeDeps();
    await setUpPriv(deps);
    const notes = deps.notes(profileId);
    const note = notes.create(new Date().toISOString());
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const { sha256 } = await deps.saveBlob(bytes);
    const row = deps
      .noteAttachments(profileId)
      .add(note.id, { fileName: "slika.png", mime: "image/png", sizeBytes: bytes.byteLength, sha256 }, new Date().toISOString());
    notes.appendUpdate(note.id, docState("Sa prilogom", [row.id]), "Sa prilogom", new Date().toISOString());

    const result = await moveNoteToPrivate(deps, profileId, note.id);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);

    const envelope = await privRead(deps.priv, profileId, result.id);
    expect(envelope.attachments).toHaveLength(1);
    const ref = envelope.attachments[0]!;
    expect(ref).toMatchObject({ fileName: "slika.png", mime: "image/png", sizeBytes: bytes.byteLength });
    // The document's attachmentImage node now names the PRIVATE reference.
    expect(attachmentIdsIn(envelope.yjsState)).toEqual([ref.id]);
    // The sealed private file exists; the public blob was refcount-released.
    expect(privBlobFiles.has(ref.id)).toBe(true);
    expect(releasedHashes).toEqual([sha256]);
    expect(countRows("note_attachments", "note_id", note.id)).toBe(0);
  });

  it("DETACHES note-sourced cards (both source fields) rather than deleting them — the AK rule", async () => {
    const deps = makeDeps();
    await setUpPriv(deps);
    const now = new Date().toISOString();
    const subjectId = uuidv7();
    const deckId = uuidv7();
    db.raw
      .prepare("INSERT INTO subjects (id, profile_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(subjectId, profileId, "Matematika", now, now);
    db.raw
      .prepare("INSERT INTO decks (id, profile_id, subject_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(deckId, profileId, subjectId, "Analiza", now, now);

    const noteId = createPublicNote(deps, "Pitanje :: Odgovor");
    deps.notes(profileId).setCardDeck(noteId, deckId, now);
    deps
      .cards(profileId)
      .syncFromNote(noteId, deckId, [{ key: "k1", front: "Pitanje", back: "Odgovor", kind: "basic", clozeText: null, clozeOrdinal: null }], now);

    const result = await moveNoteToPrivate(deps, profileId, noteId);
    expect(result.ok).toBe(true);

    const card = db.raw
      .prepare("SELECT front, source_note_id, source_block_key, deleted_at FROM cards WHERE profile_id = ?")
      .get(profileId) as { front: string; source_note_id: string | null; source_block_key: string | null; deleted_at: string | null };
    expect(card.front).toBe("Pitanje");
    expect(card.deleted_at).toBeNull();
    expect(card.source_note_id).toBeNull();
    expect(card.source_block_key).toBeNull();
  });

  it("refuses a note with more attachments than an envelope may carry, touching nothing", async () => {
    const deps = makeDeps();
    await setUpPriv(deps);
    const notes = deps.notes(profileId);
    const note = notes.create(new Date().toISOString());
    notes.appendUpdate(note.id, docState("Puno priloga"), "Puno priloga", new Date().toISOString());
    const attachments = deps.noteAttachments(profileId);
    for (let index = 0; index < 51; index++) {
      attachments.add(
        note.id,
        {
          fileName: `f${index}.bin`,
          mime: "application/octet-stream",
          sizeBytes: 1,
          sha256: createHash("sha256").update(String(index)).digest("hex"),
        },
        new Date().toISOString(),
      );
    }

    const result = await moveNoteToPrivate(deps, profileId, note.id);
    expect(result).toEqual({ ok: false, reason: "too-many-attachments" });
    expect(countRows("notes", "id", note.id)).toBe(1);
    expect(await privList(deps.priv, profileId)).toEqual([]);
    expect(privBlobFiles.size).toBe(0);
  });

  it("refuses while the section is locked, touching nothing", async () => {
    const deps = makeDeps();
    await setUpPriv(deps);
    privLock();
    const noteId = createPublicNote(deps, "Ostaje javna");
    await expect(moveNoteToPrivate(deps, profileId, noteId)).rejects.toThrow("locked");
    expect(countRows("notes", "id", noteId)).toBe(1);
  });
});

describe("movePrivateNoteOut", () => {
  it("recreates the note through the normal path — searchable, snapshot compacted — and destroys the sealed rows", async () => {
    const deps = makeDeps();
    await setUpPriv(deps);
    const noteId = createPublicNote(deps, "Tamo i nazad");
    const movedIn = await moveNoteToPrivate(deps, profileId, noteId);
    if (!movedIn.ok) throw new Error("move-in failed");

    const result = await movePrivateNoteOut(deps, profileId, movedIn.id);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);

    expect(result.note.title).toBe("Tamo i nazad");
    const listed = deps.notes(profileId).list();
    expect(listed.map((entry) => entry.id)).toEqual([result.note.id]);
    // The normal creation path compacts, so the body is indexed immediately.
    expect(deps.notes(profileId).storedPlaintext(result.note.id)).toContain("Tamo i nazad");
    expect(countRows("search_entries", "entity_id", result.note.id)).toBe(1);
    // Nothing sealed survives.
    expect(await privList(deps.priv, profileId)).toEqual([]);
    expect(privBlobFiles.size).toBe(0);
  });

  it("recreates attachments as public rows with remapped document ids and re-hosted bytes", async () => {
    const deps = makeDeps();
    await setUpPriv(deps);
    const notes = deps.notes(profileId);
    const note = notes.create(new Date().toISOString());
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 9, 9]);
    const { sha256 } = await deps.saveBlob(bytes);
    const row = deps
      .noteAttachments(profileId)
      .add(note.id, { fileName: "ugovor.pdf", mime: "application/pdf", sizeBytes: bytes.byteLength, sha256 }, new Date().toISOString());
    notes.appendUpdate(note.id, docState("Ugovor", [row.id]), "Ugovor", new Date().toISOString());
    const movedIn = await moveNoteToPrivate(deps, profileId, note.id);
    if (!movedIn.ok) throw new Error("move-in failed");

    const result = await movePrivateNoteOut(deps, profileId, movedIn.id);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);

    const rows = deps.noteAttachments(profileId).list(result.note.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fileName: "ugovor.pdf", sizeBytes: bytes.byteLength, sha256 });
    expect(publicBlobs.get(sha256)).toEqual(bytes);
    // The recreated document names the fresh PUBLIC row, not the dead private ref.
    const load = deps.notes(profileId).load(result.note.id);
    const merged = Y.mergeUpdates([load.snapshot ?? new Uint8Array(), ...load.updates].filter((u) => u.byteLength > 0));
    expect(attachmentIdsIn(Buffer.from(merged).toString("base64"))).toEqual([rows[0]!.id]);
    expect(privBlobFiles.size).toBe(0);
  });

  it("refuses a document past the public per-update cap, leaving the private note standing", async () => {
    const deps = makeDeps();
    await setUpPriv(deps);
    const big = docState("x".repeat(400_000));
    const envelope = {
      title: "Prevelika",
      yjsState: Buffer.from(big).toString("base64"),
      plaintext: "x",
      attachments: [],
    };
    const { privWrite } = await import("./priv.js");
    const { id } = await privWrite(deps.priv, profileId, null, envelope);

    const result = await movePrivateNoteOut(deps, profileId, id);
    expect(result).toEqual({ ok: false, reason: "too-large" });
    expect((await privList(deps.priv, profileId)).map((entry) => entry.id)).toEqual([id]);
    expect(deps.notes(profileId).list()).toEqual([]);
  });

  it("refuses while the section is locked", async () => {
    const deps = makeDeps();
    await setUpPriv(deps);
    privLock();
    await expect(movePrivateNoteOut(deps, profileId, "any")).rejects.toThrow("locked");
  });
});
