import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExamNotFoundError,
  ExamStore,
  ExamValidationError,
  NexusDatabase,
  openDatabase,
  SubjectStore,
  uuidv7,
  type ExamType,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-exams-"));
  db = openDatabase({ path: join(dir, "exams.db") });
});

afterEach(() => {
  vi.useRealTimers();
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

/** A profile with one subject, plus the two stores scoped to it. */
function fixture(): { exams: ExamStore; subjects: SubjectStore; subjectId: string } {
  const profileId = createProfile();
  const subjects = new SubjectStore(db.raw, profileId);
  const subjectId = subjects.create({ name: "Analiza 1" }).id;
  return { exams: new ExamStore(db.raw, profileId), subjects, subjectId };
}

describe("ExamStore", () => {
  it("creates an exam against a subject in this profile", () => {
    const { exams, subjectId } = fixture();
    const created = exams.create({
      subjectId,
      examType: "pismeni",
      examDate: "2026-09-01",
      scope: "  glave 1-5  ",
    });

    expect(created.subjectId).toBe(subjectId);
    expect(created.examType).toBe("pismeni");
    expect(created.examDate).toBe("2026-09-01");
    expect(created.scope).toBe("  glave 1-5  "); // preserved verbatim (not a whitespace-only value)
    expect(exams.listActive()[0]).toEqual(created);
  });

  it("defaults scope to null when omitted", () => {
    const { exams, subjectId } = fixture();
    const created = exams.create({ subjectId, examType: "usmeni", examDate: "2026-09-01" });
    expect(created.scope).toBeNull();
  });

  it("rejects an exam referencing a subject from another profile", () => {
    const { exams } = fixture();
    const foreign = new SubjectStore(db.raw, createProfile());
    const foreignSubjectId = foreign.create({ name: "Elsewhere" }).id;

    expect(() =>
      exams.create({ subjectId: foreignSubjectId, examType: "pismeni", examDate: "2026-09-01" }),
    ).toThrow(ExamValidationError);
  });

  it("rejects an exam referencing a soft-deleted subject", () => {
    const { exams, subjects, subjectId } = fixture();
    subjects.softDelete(subjectId);
    expect(() =>
      exams.create({ subjectId, examType: "pismeni", examDate: "2026-09-01" }),
    ).toThrow(ExamValidationError);
  });

  it("rejects an unknown exam type", () => {
    const { exams, subjectId } = fixture();
    expect(() =>
      exams.create({
        subjectId,
        examType: "esej" as unknown as ExamType,
        examDate: "2026-09-01",
      }),
    ).toThrow(ExamValidationError);
  });

  it("rejects a malformed exam date", () => {
    const { exams, subjectId } = fixture();
    expect(() =>
      exams.create({ subjectId, examType: "pismeni", examDate: "not-a-date" }),
    ).toThrow(ExamValidationError);
  });

  it("rejects an update that moves an exam to a subject in another profile", () => {
    const { exams, subjectId } = fixture();
    const created = exams.create({ subjectId, examType: "pismeni", examDate: "2026-09-01" });
    const foreign = new SubjectStore(db.raw, createProfile());
    const foreignSubjectId = foreign.create({ name: "Elsewhere" }).id;

    expect(() => exams.update(created.id, { subjectId: foreignSubjectId })).toThrow(
      ExamValidationError,
    );
  });

  it("updates an exam's own fields", () => {
    const { exams, subjectId } = fixture();
    const created = exams.create({ subjectId, examType: "pismeni", examDate: "2026-09-01" });

    const updated = exams.update(created.id, {
      examType: "kolokvijum",
      examDate: "2026-10-15",
      scope: "kolokvijum 1",
    });

    expect(updated.examType).toBe("kolokvijum");
    expect(updated.examDate).toBe("2026-10-15");
    expect(updated.scope).toBe("kolokvijum 1");
    expect(updated.subjectId).toBe(subjectId); // untouched
  });

  it("lists active exams ordered by exam_date then id", () => {
    vi.useFakeTimers();
    const { exams, subjectId } = fixture();
    vi.setSystemTime(new Date("2026-07-06T10:00:00.000Z"));
    const later = exams.create({ subjectId, examType: "pismeni", examDate: "2026-10-01" });
    vi.setSystemTime(new Date("2026-07-06T10:00:01.000Z"));
    const earlyA = exams.create({ subjectId, examType: "pismeni", examDate: "2026-09-01" });
    vi.setSystemTime(new Date("2026-07-06T10:00:02.000Z"));
    const earlyB = exams.create({ subjectId, examType: "usmeni", examDate: "2026-09-01" });

    // earlyA/earlyB share an exam_date, so the id tiebreak (creation order) settles them.
    expect(exams.listActive().map((e) => e.id)).toEqual([earlyA.id, earlyB.id, later.id]);
  });

  it("excludes soft-deleted exams from the active list and restores them", () => {
    const { exams, subjectId } = fixture();
    const created = exams.create({ subjectId, examType: "pismeni", examDate: "2026-09-01" });

    exams.softDelete(created.id);
    expect(exams.listActive()).toHaveLength(0);

    exams.restore(created.id);
    const listed = exams.listActive();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
  });

  it("throws ExamNotFoundError for operations on an unknown or wrong-state exam", () => {
    const { exams, subjectId } = fixture();
    const created = exams.create({ subjectId, examType: "pismeni", examDate: "2026-09-01" });

    expect(() => exams.update("missing", { examType: "usmeni" })).toThrow(ExamNotFoundError);
    expect(() => exams.softDelete("missing")).toThrow(ExamNotFoundError);
    // not currently deleted -> nothing to restore.
    expect(() => exams.restore(created.id)).toThrow(ExamNotFoundError);
    // double delete -> the second finds no active row.
    exams.softDelete(created.id);
    expect(() => exams.softDelete(created.id)).toThrow(ExamNotFoundError);
  });

  it("isolates exams between profiles", () => {
    const a = fixture();
    const b = fixture();
    const owned = a.exams.create({ subjectId: a.subjectId, examType: "pismeni", examDate: "2026-09-01" });

    expect(b.exams.listActive()).toHaveLength(0);
    expect(() => b.exams.update(owned.id, { examType: "usmeni" })).toThrow(ExamNotFoundError);
    expect(() => b.exams.softDelete(owned.id)).toThrow(ExamNotFoundError);
    expect(a.exams.listActive()).toHaveLength(1);
  });
});
