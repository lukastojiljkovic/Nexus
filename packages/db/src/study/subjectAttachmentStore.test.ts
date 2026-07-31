import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_SUBJECT_ATTACHMENT_BYTES,
  NexusDatabase,
  SubjectAttachmentNotFoundError,
  SubjectAttachmentStore,
  SubjectAttachmentValidationError,
  SubjectNotFoundError,
  SubjectStore,
  openDatabase,
  uuidv7,
  type AddSubjectAttachmentInput,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-subject-attachments-"));
  db = openDatabase({ path: join(dir, "subject-attachments.db") });
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
  materials: SubjectAttachmentStore;
  subjects: SubjectStore;
  profileId: string;
}

function fixture(): Fixture {
  const profileId = createProfile();
  return {
    materials: new SubjectAttachmentStore(db.raw, profileId),
    subjects: new SubjectStore(db.raw, profileId),
    profileId,
  };
}

const T1 = "2026-07-30T10:01:00.000Z";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function validInput(
  overrides: Partial<AddSubjectAttachmentInput> = {},
): AddSubjectAttachmentInput {
  return {
    fileName: "skripta.pdf",
    mime: "application/pdf",
    sizeBytes: 1024,
    sha256: SHA_A,
    ...overrides,
  };
}

describe("SubjectAttachmentStore — add", () => {
  it("adds a material, trims the file name, and returns the full row", () => {
    const { materials, subjects } = fixture();
    const subject = subjects.create({ name: "Analiza 1" });

    const result = materials.add(
      subject.id,
      { fileName: "  skripta.pdf  ", mime: "application/pdf", sizeBytes: 1024, sha256: SHA_A },
      T1,
    );

    expect(result.fileName).toBe("skripta.pdf");
    expect(result.subjectId).toBe(subject.id);
    expect(result.mime).toBe("application/pdf");
    expect(result.sizeBytes).toBe(1024);
    expect(result.sha256).toBe(SHA_A);
    expect(result.createdAt).toBe(T1);
    expect(result.id).toBeTruthy();
  });

  it("rejects adding to an unknown, soft-deleted, or cross-profile subject", () => {
    const a = fixture();
    const b = fixture();
    const subject = a.subjects.create({ name: "A" });
    const deleted = a.subjects.create({ name: "Obrisan" });
    a.subjects.softDelete(deleted.id);

    expect(() => a.materials.add("missing", validInput(), T1)).toThrow(SubjectNotFoundError);
    expect(() => a.materials.add(deleted.id, validInput(), T1)).toThrow(SubjectNotFoundError);
    expect(() => b.materials.add(subject.id, validInput(), T1)).toThrow(SubjectNotFoundError);
  });

  it("rejects an empty, over-255-character, or path-separator-carrying file name", () => {
    const { materials, subjects } = fixture();
    const subject = subjects.create({ name: "A" });

    expect(() => materials.add(subject.id, validInput({ fileName: "   " }), T1)).toThrow(
      SubjectAttachmentValidationError,
    );
    expect(() => materials.add(subject.id, validInput({ fileName: "x".repeat(256) }), T1)).toThrow(
      SubjectAttachmentValidationError,
    );
    expect(() =>
      materials.add(subject.id, validInput({ fileName: "x".repeat(255) }), T1),
    ).not.toThrow();
    expect(() => materials.add(subject.id, validInput({ fileName: "a/b.pdf" }), T1)).toThrow(
      SubjectAttachmentValidationError,
    );
    expect(() => materials.add(subject.id, validInput({ fileName: "a\\b.pdf" }), T1)).toThrow(
      SubjectAttachmentValidationError,
    );
  });

  it("rejects a malformed mime type", () => {
    const { materials, subjects } = fixture();
    const subject = subjects.create({ name: "A" });

    expect(() => materials.add(subject.id, validInput({ mime: "not-a-mime" }), T1)).toThrow(
      SubjectAttachmentValidationError,
    );
    expect(() => materials.add(subject.id, validInput({ mime: "IMAGE/PNG" }), T1)).toThrow(
      SubjectAttachmentValidationError,
    );
    expect(() =>
      materials.add(subject.id, validInput({ mime: `a/${"x".repeat(100)}` }), T1),
    ).toThrow(SubjectAttachmentValidationError);
    expect(() =>
      materials.add(subject.id, validInput({ mime: "application/zip" }), T1),
    ).not.toThrow();
  });

  it("rejects a sizeBytes that is zero, negative, non-integer, or over the cap", () => {
    const { materials, subjects } = fixture();
    const subject = subjects.create({ name: "A" });

    expect(() => materials.add(subject.id, validInput({ sizeBytes: 0 }), T1)).toThrow(
      SubjectAttachmentValidationError,
    );
    expect(() => materials.add(subject.id, validInput({ sizeBytes: -1 }), T1)).toThrow(
      SubjectAttachmentValidationError,
    );
    expect(() => materials.add(subject.id, validInput({ sizeBytes: 1.5 }), T1)).toThrow(
      SubjectAttachmentValidationError,
    );
    expect(() =>
      materials.add(subject.id, validInput({ sizeBytes: MAX_SUBJECT_ATTACHMENT_BYTES + 1 }), T1),
    ).toThrow(SubjectAttachmentValidationError);
    expect(() =>
      materials.add(subject.id, validInput({ sizeBytes: MAX_SUBJECT_ATTACHMENT_BYTES }), T1),
    ).not.toThrow();
  });

  it("rejects a malformed sha256", () => {
    const { materials, subjects } = fixture();
    const subject = subjects.create({ name: "A" });

    expect(() => materials.add(subject.id, validInput({ sha256: "abc" }), T1)).toThrow(
      SubjectAttachmentValidationError,
    );
    // uppercase hex is rejected — the stored form is always lowercase.
    expect(() => materials.add(subject.id, validInput({ sha256: "A".repeat(64) }), T1)).toThrow(
      SubjectAttachmentValidationError,
    );
  });

  it("rejects a malformed now", () => {
    const { materials, subjects } = fixture();
    const subject = subjects.create({ name: "A" });
    expect(() => materials.add(subject.id, validInput(), "nope")).toThrow(
      SubjectAttachmentValidationError,
    );
  });
});

describe("SubjectAttachmentStore — list", () => {
  it("is empty for a subject with no materials, and orders by created_at then id", () => {
    const { materials, subjects } = fixture();
    const subject = subjects.create({ name: "A" });
    expect(materials.list(subject.id)).toEqual([]);

    const first = materials.add(
      subject.id,
      validInput({ sha256: SHA_A }),
      "2026-07-30T10:00:00.000Z",
    );
    const second = materials.add(subject.id, validInput({ sha256: SHA_B }), T1);
    expect(materials.list(subject.id).map((m) => m.id)).toEqual([first.id, second.id]);
  });

  it("rejects listing an unknown, soft-deleted, or cross-profile subject", () => {
    const a = fixture();
    const b = fixture();
    const subject = a.subjects.create({ name: "A" });
    const deleted = a.subjects.create({ name: "Obrisan" });
    a.subjects.softDelete(deleted.id);

    expect(() => a.materials.list("missing")).toThrow(SubjectNotFoundError);
    expect(() => a.materials.list(deleted.id)).toThrow(SubjectNotFoundError);
    expect(() => b.materials.list(subject.id)).toThrow(SubjectNotFoundError);
  });
});

describe("SubjectAttachmentStore — remove", () => {
  it("removes a material and returns the removed row", () => {
    const { materials, subjects } = fixture();
    const subject = subjects.create({ name: "A" });
    const added = materials.add(subject.id, validInput(), T1);

    const removed = materials.remove(subject.id, added.id);
    expect(removed).toEqual(added);
    expect(materials.list(subject.id)).toEqual([]);
  });

  it("rejects removing an unknown material id", () => {
    const { materials, subjects } = fixture();
    const subject = subjects.create({ name: "A" });
    expect(() => materials.remove(subject.id, "missing")).toThrow(SubjectAttachmentNotFoundError);
  });

  it("rejects removing a material via the wrong subject id, without deleting it", () => {
    const { materials, subjects } = fixture();
    const subjectA = subjects.create({ name: "A" });
    const subjectB = subjects.create({ name: "B" });
    const added = materials.add(subjectA.id, validInput(), T1);

    expect(() => materials.remove(subjectB.id, added.id)).toThrow(SubjectAttachmentNotFoundError);
    expect(materials.list(subjectA.id)).toHaveLength(1);
  });

  it("rejects removing from an unknown, soft-deleted, or cross-profile subject", () => {
    const a = fixture();
    const b = fixture();
    const subject = a.subjects.create({ name: "A" });
    const added = a.materials.add(subject.id, validInput(), T1);
    const deleted = a.subjects.create({ name: "Obrisan" });
    a.subjects.softDelete(deleted.id);

    expect(() => a.materials.remove("missing", added.id)).toThrow(SubjectNotFoundError);
    expect(() => a.materials.remove(deleted.id, added.id)).toThrow(SubjectNotFoundError);
    expect(() => b.materials.remove(subject.id, added.id)).toThrow(SubjectNotFoundError);
  });
});

describe("SubjectAttachmentStore — refCount / mimeForHash (profile-agnostic)", () => {
  it("counts references to a hash across subjects and across profiles", () => {
    const a = fixture();
    const b = fixture();
    const subjectA1 = a.subjects.create({ name: "A1" });
    const subjectA2 = a.subjects.create({ name: "A2" });
    const subjectB1 = b.subjects.create({ name: "B1" });

    expect(a.materials.refCount(SHA_A)).toBe(0);
    a.materials.add(subjectA1.id, validInput({ sha256: SHA_A }), T1);
    expect(a.materials.refCount(SHA_A)).toBe(1);
    a.materials.add(subjectA2.id, validInput({ sha256: SHA_A }), T1);
    expect(a.materials.refCount(SHA_A)).toBe(2);
    b.materials.add(subjectB1.id, validInput({ sha256: SHA_A }), T1);
    // Deliberately profile-agnostic: B's store reports the same total as A's.
    expect(a.materials.refCount(SHA_A)).toBe(3);
    expect(b.materials.refCount(SHA_A)).toBe(3);
  });

  it("resolves a hash's stored mime across profiles, and null for an unknown hash", () => {
    const a = fixture();
    const b = fixture();
    expect(a.materials.mimeForHash(SHA_A)).toBeNull();

    const subjectA = a.subjects.create({ name: "A" });
    a.materials.add(subjectA.id, validInput({ sha256: SHA_A, mime: "image/png" }), T1);
    expect(a.materials.mimeForHash(SHA_A)).toBe("image/png");
    // Deliberately profile-agnostic: B's store resolves the same hash too.
    expect(b.materials.mimeForHash(SHA_A)).toBe("image/png");
  });
});

describe("SubjectAttachmentStore — countsBySubject", () => {
  it("returns one entry per live subject that carries at least one material", () => {
    const { materials, subjects } = fixture();
    const withTwo = subjects.create({ name: "Dva" });
    const withOne = subjects.create({ name: "Jedan" });
    subjects.create({ name: "Bez materijala" });

    expect(materials.countsBySubject()).toEqual([]);

    materials.add(withTwo.id, validInput({ sha256: SHA_A }), T1);
    materials.add(withTwo.id, validInput({ sha256: SHA_B }), T1);
    materials.add(withOne.id, validInput({ sha256: SHA_A }), T1);

    const counts = materials.countsBySubject();
    expect(new Map(counts.map((row) => [row.subjectId, row.count]))).toEqual(
      new Map([
        [withTwo.id, 2],
        [withOne.id, 1],
      ]),
    );
  });

  it("hides a soft-deleted subject's count and never counts another profile's", () => {
    const a = fixture();
    const b = fixture();
    const kept = a.subjects.create({ name: "Ostaje" });
    const deleted = a.subjects.create({ name: "Obrisan" });
    const other = b.subjects.create({ name: "Tuđi" });
    a.materials.add(kept.id, validInput(), T1);
    a.materials.add(deleted.id, validInput(), T1);
    b.materials.add(other.id, validInput(), T1);

    a.subjects.softDelete(deleted.id);

    expect(a.materials.countsBySubject()).toEqual([{ subjectId: kept.id, count: 1 }]);
    expect(b.materials.countsBySubject()).toEqual([{ subjectId: other.id, count: 1 }]);
  });
});

describe("SubjectAttachmentStore — soft-delete / hard-delete interaction", () => {
  it("keeps rows (and refCount) through a soft delete, and list works again after restore", () => {
    const { materials, subjects } = fixture();
    const subject = subjects.create({ name: "A" });
    materials.add(subject.id, validInput(), T1);
    expect(materials.refCount(SHA_A)).toBe(1);

    subjects.softDelete(subject.id);
    expect(materials.refCount(SHA_A)).toBe(1); // unchanged by soft-delete

    subjects.restore(subject.id);
    expect(materials.list(subject.id)).toHaveLength(1);
  });

  it("cascades rows away on a hard delete of the subject, reflected in refCount", () => {
    const { materials, subjects } = fixture();
    const subject = subjects.create({ name: "A" });
    materials.add(subject.id, validInput(), T1);
    expect(materials.refCount(SHA_A)).toBe(1);

    db.raw.prepare("DELETE FROM subjects WHERE id = ?").run(subject.id);
    expect(materials.refCount(SHA_A)).toBe(0);
  });
});
