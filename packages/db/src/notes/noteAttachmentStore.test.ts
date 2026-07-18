import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_NOTE_ATTACHMENT_BYTES,
  NexusDatabase,
  NoteAttachmentNotFoundError,
  NoteAttachmentStore,
  NoteAttachmentValidationError,
  NoteNotFoundError,
  NoteStore,
  openDatabase,
  uuidv7,
  type AddNoteAttachmentInput,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-note-attachments-"));
  db = openDatabase({ path: join(dir, "note-attachments.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date().toISOString());
  return id;
}

interface Fixture {
  attachments: NoteAttachmentStore;
  notes: NoteStore;
  profileId: string;
}

function fixture(): Fixture {
  const profileId = createProfile();
  return {
    attachments: new NoteAttachmentStore(db.raw, profileId),
    notes: new NoteStore(db.raw, profileId),
    profileId,
  };
}

const T0 = "2026-07-18T10:00:00.000Z";
const T1 = "2026-07-18T10:01:00.000Z";
const T2 = "2026-07-18T10:02:00.000Z";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function validInput(overrides: Partial<AddNoteAttachmentInput> = {}): AddNoteAttachmentInput {
  return { fileName: "photo.png", mime: "image/png", sizeBytes: 1024, sha256: SHA_A, ...overrides };
}

describe("NoteAttachmentStore — add", () => {
  it("adds an attachment, trims the file name, and returns the full row", () => {
    const { attachments, notes } = fixture();
    const note = notes.create(T0);

    const result = attachments.add(
      note.id,
      { fileName: "  photo.png  ", mime: "image/png", sizeBytes: 1024, sha256: SHA_A },
      T1,
    );

    expect(result.fileName).toBe("photo.png");
    expect(result.noteId).toBe(note.id);
    expect(result.mime).toBe("image/png");
    expect(result.sizeBytes).toBe(1024);
    expect(result.sha256).toBe(SHA_A);
    expect(result.createdAt).toBe(T1);
    expect(result.id).toBeTruthy();
  });

  it("rejects adding to an unknown, soft-deleted, or cross-profile note", () => {
    const a = fixture();
    const b = fixture();
    const note = a.notes.create(T0);
    const deleted = a.notes.create(T0);
    a.notes.softDelete(deleted.id, T1);

    expect(() => a.attachments.add("missing", validInput(), T1)).toThrow(NoteNotFoundError);
    expect(() => a.attachments.add(deleted.id, validInput(), T1)).toThrow(NoteNotFoundError);
    expect(() => b.attachments.add(note.id, validInput(), T1)).toThrow(NoteNotFoundError);
  });

  it("rejects an empty, over-255-character, or path-separator-carrying file name", () => {
    const { attachments, notes } = fixture();
    const note = notes.create(T0);

    expect(() => attachments.add(note.id, validInput({ fileName: "   " }), T1)).toThrow(
      NoteAttachmentValidationError,
    );
    expect(() =>
      attachments.add(note.id, validInput({ fileName: "x".repeat(256) }), T1),
    ).toThrow(NoteAttachmentValidationError);
    expect(() =>
      attachments.add(note.id, validInput({ fileName: "x".repeat(255) }), T1),
    ).not.toThrow();
    expect(() => attachments.add(note.id, validInput({ fileName: "a/b.png" }), T1)).toThrow(
      NoteAttachmentValidationError,
    );
    expect(() => attachments.add(note.id, validInput({ fileName: "a\\b.png" }), T1)).toThrow(
      NoteAttachmentValidationError,
    );
  });

  it("rejects a malformed mime type", () => {
    const { attachments, notes } = fixture();
    const note = notes.create(T0);

    expect(() => attachments.add(note.id, validInput({ mime: "not-a-mime" }), T1)).toThrow(
      NoteAttachmentValidationError,
    );
    expect(() => attachments.add(note.id, validInput({ mime: "IMAGE/PNG" }), T1)).toThrow(
      NoteAttachmentValidationError,
    );
    expect(() =>
      attachments.add(note.id, validInput({ mime: `a/${"x".repeat(100)}` }), T1),
    ).toThrow(NoteAttachmentValidationError);
    expect(() => attachments.add(note.id, validInput({ mime: "application/zip" }), T1)).not.toThrow();
  });

  it("rejects a sizeBytes that is zero, negative, non-integer, or over the cap", () => {
    const { attachments, notes } = fixture();
    const note = notes.create(T0);

    expect(() => attachments.add(note.id, validInput({ sizeBytes: 0 }), T1)).toThrow(
      NoteAttachmentValidationError,
    );
    expect(() => attachments.add(note.id, validInput({ sizeBytes: -1 }), T1)).toThrow(
      NoteAttachmentValidationError,
    );
    expect(() => attachments.add(note.id, validInput({ sizeBytes: 1.5 }), T1)).toThrow(
      NoteAttachmentValidationError,
    );
    expect(() =>
      attachments.add(note.id, validInput({ sizeBytes: MAX_NOTE_ATTACHMENT_BYTES + 1 }), T1),
    ).toThrow(NoteAttachmentValidationError);
    expect(() =>
      attachments.add(note.id, validInput({ sizeBytes: MAX_NOTE_ATTACHMENT_BYTES }), T1),
    ).not.toThrow();
  });

  it("rejects a malformed sha256", () => {
    const { attachments, notes } = fixture();
    const note = notes.create(T0);

    expect(() => attachments.add(note.id, validInput({ sha256: "abc" }), T1)).toThrow(
      NoteAttachmentValidationError,
    );
    // uppercase hex is rejected — the stored form is always lowercase.
    expect(() => attachments.add(note.id, validInput({ sha256: "A".repeat(64) }), T1)).toThrow(
      NoteAttachmentValidationError,
    );
  });

  it("rejects a malformed now", () => {
    const { attachments, notes } = fixture();
    const note = notes.create(T0);
    expect(() => attachments.add(note.id, validInput(), "nope")).toThrow(
      NoteAttachmentValidationError,
    );
  });
});

describe("NoteAttachmentStore — list", () => {
  it("is empty for a note with no attachments, and orders by created_at then id", () => {
    const { attachments, notes } = fixture();
    const note = notes.create(T0);
    expect(attachments.list(note.id)).toEqual([]);

    const first = attachments.add(note.id, validInput({ sha256: SHA_A }), T0);
    const second = attachments.add(note.id, validInput({ sha256: SHA_B }), T1);
    expect(attachments.list(note.id).map((a) => a.id)).toEqual([first.id, second.id]);
  });

  it("rejects listing an unknown, soft-deleted, or cross-profile note", () => {
    const a = fixture();
    const b = fixture();
    const note = a.notes.create(T0);
    const deleted = a.notes.create(T0);
    a.notes.softDelete(deleted.id, T1);

    expect(() => a.attachments.list("missing")).toThrow(NoteNotFoundError);
    expect(() => a.attachments.list(deleted.id)).toThrow(NoteNotFoundError);
    expect(() => b.attachments.list(note.id)).toThrow(NoteNotFoundError);
  });
});

describe("NoteAttachmentStore — remove", () => {
  it("removes an attachment and returns the removed row", () => {
    const { attachments, notes } = fixture();
    const note = notes.create(T0);
    const added = attachments.add(note.id, validInput(), T0);

    const removed = attachments.remove(note.id, added.id);
    expect(removed).toEqual(added);
    expect(attachments.list(note.id)).toEqual([]);
  });

  it("rejects removing an unknown attachment id", () => {
    const { attachments, notes } = fixture();
    const note = notes.create(T0);
    expect(() => attachments.remove(note.id, "missing")).toThrow(NoteAttachmentNotFoundError);
  });

  it("rejects removing an attachment via the wrong note id, without deleting it", () => {
    const { attachments, notes } = fixture();
    const noteA = notes.create(T0);
    const noteB = notes.create(T0);
    const added = attachments.add(noteA.id, validInput(), T0);

    expect(() => attachments.remove(noteB.id, added.id)).toThrow(NoteAttachmentNotFoundError);
    expect(attachments.list(noteA.id)).toHaveLength(1);
  });

  it("rejects removing from an unknown, soft-deleted, or cross-profile note", () => {
    const a = fixture();
    const b = fixture();
    const note = a.notes.create(T0);
    const added = a.attachments.add(note.id, validInput(), T0);
    const deleted = a.notes.create(T0);
    a.notes.softDelete(deleted.id, T1);

    expect(() => a.attachments.remove("missing", added.id)).toThrow(NoteNotFoundError);
    expect(() => a.attachments.remove(deleted.id, added.id)).toThrow(NoteNotFoundError);
    expect(() => b.attachments.remove(note.id, added.id)).toThrow(NoteNotFoundError);
  });
});

describe("NoteAttachmentStore — refCount / mimeForHash (profile-agnostic)", () => {
  it("counts references to a hash across notes and across profiles", () => {
    const a = fixture();
    const b = fixture();
    const noteA1 = a.notes.create(T0);
    const noteA2 = a.notes.create(T0);
    const noteB1 = b.notes.create(T0);

    expect(a.attachments.refCount(SHA_A)).toBe(0);
    a.attachments.add(noteA1.id, validInput({ sha256: SHA_A }), T0);
    expect(a.attachments.refCount(SHA_A)).toBe(1);
    a.attachments.add(noteA2.id, validInput({ sha256: SHA_A }), T0);
    expect(a.attachments.refCount(SHA_A)).toBe(2);
    b.attachments.add(noteB1.id, validInput({ sha256: SHA_A }), T0);
    // Deliberately profile-agnostic: B's store reports the same total as A's.
    expect(a.attachments.refCount(SHA_A)).toBe(3);
    expect(b.attachments.refCount(SHA_A)).toBe(3);
  });

  it("resolves a hash's stored mime across profiles, and null for an unknown hash", () => {
    const a = fixture();
    const b = fixture();
    expect(a.attachments.mimeForHash(SHA_A)).toBeNull();

    const noteA = a.notes.create(T0);
    a.attachments.add(noteA.id, validInput({ sha256: SHA_A, mime: "image/png" }), T0);
    expect(a.attachments.mimeForHash(SHA_A)).toBe("image/png");
    // Deliberately profile-agnostic: B's store resolves the same hash too.
    expect(b.attachments.mimeForHash(SHA_A)).toBe("image/png");
  });
});

describe("NoteAttachmentStore — soft-delete / hard-delete interaction", () => {
  it("keeps rows (and refCount) through a soft delete, and list works again after restore", () => {
    const { attachments, notes } = fixture();
    const note = notes.create(T0);
    attachments.add(note.id, validInput(), T0);
    expect(attachments.refCount(SHA_A)).toBe(1);

    notes.softDelete(note.id, T1);
    expect(attachments.refCount(SHA_A)).toBe(1); // unchanged by soft-delete

    notes.restore(note.id, T2);
    expect(attachments.list(note.id)).toHaveLength(1);
  });

  it("cascades rows away on a hard delete of the note, reflected in refCount", () => {
    const { attachments, notes } = fixture();
    const note = notes.create(T0);
    attachments.add(note.id, validInput(), T0);
    expect(attachments.refCount(SHA_A)).toBe(1);

    db.raw.prepare("DELETE FROM notes WHERE id = ?").run(note.id);
    expect(attachments.refCount(SHA_A)).toBe(0);
  });
});
