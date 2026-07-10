/**
 * All timestamps in this file are mid-day UTC (e.g. "...T12:00:00.000Z") —
 * never near midnight. `FocusStore.listRange` buckets by
 * `date(started_at, 'localtime')`, which depends on the host machine's
 * timezone; mid-day UTC maps to the same calendar date in every timezone from
 * UTC-11 to UTC+11, so these tests pass identically on the founder's UTC+2
 * machine and on UTC CI.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FocusNotFoundError,
  FocusStore,
  FocusValidationError,
  NexusDatabase,
  openDatabase,
  SubjectStore,
  uuidv7,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-focus-"));
  db = openDatabase({ path: join(dir, "focus.db") });
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

/** A profile with one subject, plus the stores scoped to it. */
function fixture(): { focus: FocusStore; subjects: SubjectStore; subjectId: string } {
  const profileId = createProfile();
  const subjects = new SubjectStore(db.raw, profileId);
  const subjectId = subjects.create({ name: "Analiza 1" }).id;
  return { focus: new FocusStore(db.raw, profileId), subjects, subjectId };
}

describe("FocusStore", () => {
  describe("create", () => {
    it("persists a completed session against an active subject", () => {
      const { focus, subjectId } = fixture();
      const session = focus.create(
        { subjectId, startedAt: "2026-07-08T12:00:00.000Z", endedAt: "2026-07-08T13:00:00.000Z" },
        "2026-07-08T13:00:00.000Z",
      );

      expect(session.subjectId).toBe(subjectId);
      expect(session.startedAt).toBe("2026-07-08T12:00:00.000Z");
      expect(session.endedAt).toBe("2026-07-08T13:00:00.000Z");
      expect(session.createdAt).toBe("2026-07-08T13:00:00.000Z");
      expect(session.updatedAt).toBe("2026-07-08T13:00:00.000Z");
    });

    it("rejects an endedAt that does not strictly follow startedAt", () => {
      const { focus, subjectId } = fixture();
      expect(() =>
        focus.create(
          {
            subjectId,
            startedAt: "2026-07-08T12:00:00.000Z",
            endedAt: "2026-07-08T12:00:00.000Z",
          },
          "2026-07-08T13:00:00.000Z",
        ),
      ).toThrow(FocusValidationError);
      expect(() =>
        focus.create(
          {
            subjectId,
            startedAt: "2026-07-08T12:00:00.000Z",
            endedAt: "2026-07-08T11:00:00.000Z",
          },
          "2026-07-08T13:00:00.000Z",
        ),
      ).toThrow(FocusValidationError);
    });

    it("rejects a malformed now, startedAt, or endedAt", () => {
      const { focus, subjectId } = fixture();
      expect(() =>
        focus.create(
          { subjectId, startedAt: "not-a-date", endedAt: "2026-07-08T13:00:00.000Z" },
          "2026-07-08T13:00:00.000Z",
        ),
      ).toThrow(FocusValidationError);
      expect(() =>
        focus.create(
          { subjectId, startedAt: "2026-07-08T12:00:00.000Z", endedAt: "not-a-date" },
          "2026-07-08T13:00:00.000Z",
        ),
      ).toThrow(FocusValidationError);
      expect(() =>
        focus.create(
          {
            subjectId,
            startedAt: "2026-07-08T12:00:00.000Z",
            endedAt: "2026-07-08T13:00:00.000Z",
          },
          "not-a-date",
        ),
      ).toThrow(FocusValidationError);
    });

    it("rejects a subjectId that does not resolve to an active subject in this profile", () => {
      const { focus } = fixture();
      expect(() =>
        focus.create(
          {
            subjectId: "missing",
            startedAt: "2026-07-08T12:00:00.000Z",
            endedAt: "2026-07-08T13:00:00.000Z",
          },
          "2026-07-08T13:00:00.000Z",
        ),
      ).toThrow(FocusValidationError);
    });

    it("rejects a subjectId belonging to another profile", () => {
      const { focus } = fixture();
      const other = fixture();
      expect(() =>
        focus.create(
          {
            subjectId: other.subjectId,
            startedAt: "2026-07-08T12:00:00.000Z",
            endedAt: "2026-07-08T13:00:00.000Z",
          },
          "2026-07-08T13:00:00.000Z",
        ),
      ).toThrow(FocusValidationError);
    });

    it("rejects a subjectId referencing a soft-deleted subject", () => {
      const { focus, subjects, subjectId } = fixture();
      subjects.softDelete(subjectId);
      expect(() =>
        focus.create(
          {
            subjectId,
            startedAt: "2026-07-08T12:00:00.000Z",
            endedAt: "2026-07-08T13:00:00.000Z",
          },
          "2026-07-08T13:00:00.000Z",
        ),
      ).toThrow(FocusValidationError);
    });
  });

  describe("listRange", () => {
    it("returns active sessions in range, newest first", () => {
      const { focus, subjectId } = fixture();
      const a = focus.create(
        { subjectId, startedAt: "2026-07-08T12:00:00.000Z", endedAt: "2026-07-08T13:00:00.000Z" },
        "2026-07-08T13:00:00.000Z",
      );
      const b = focus.create(
        { subjectId, startedAt: "2026-07-09T12:00:00.000Z", endedAt: "2026-07-09T13:00:00.000Z" },
        "2026-07-09T13:00:00.000Z",
      );

      const range = focus.listRange("2026-07-08", "2026-07-09");
      expect(range.map((s) => s.id)).toEqual([b.id, a.id]);
    });

    it("excludes sessions outside the range", () => {
      const { focus, subjectId } = fixture();
      focus.create(
        { subjectId, startedAt: "2026-07-01T12:00:00.000Z", endedAt: "2026-07-01T13:00:00.000Z" },
        "2026-07-01T13:00:00.000Z",
      );
      expect(focus.listRange("2026-07-08", "2026-07-09")).toHaveLength(0);
    });

    it("excludes soft-deleted sessions", () => {
      const { focus, subjectId } = fixture();
      const created = focus.create(
        { subjectId, startedAt: "2026-07-08T12:00:00.000Z", endedAt: "2026-07-08T13:00:00.000Z" },
        "2026-07-08T13:00:00.000Z",
      );
      focus.softDelete(created.id, "2026-07-08T13:00:00.000Z");
      expect(focus.listRange("2026-07-08", "2026-07-08")).toHaveLength(0);
    });

    it("isolates the range query between profiles", () => {
      const a = fixture();
      const b = fixture();
      a.focus.create(
        {
          subjectId: a.subjectId,
          startedAt: "2026-07-08T12:00:00.000Z",
          endedAt: "2026-07-08T13:00:00.000Z",
        },
        "2026-07-08T13:00:00.000Z",
      );
      expect(b.focus.listRange("2026-07-08", "2026-07-08")).toHaveLength(0);
    });

    it("rejects a malformed fromDate or toDate", () => {
      const { focus } = fixture();
      expect(() => focus.listRange("not-a-date", "2026-07-08")).toThrow(FocusValidationError);
      expect(() => focus.listRange("2026-07-08", "not-a-date")).toThrow(FocusValidationError);
    });
  });

  describe("softDelete / restore", () => {
    it("throws FocusNotFoundError for operations on an unknown or wrong-state session", () => {
      const { focus, subjectId } = fixture();
      const created = focus.create(
        { subjectId, startedAt: "2026-07-08T12:00:00.000Z", endedAt: "2026-07-08T13:00:00.000Z" },
        "2026-07-08T13:00:00.000Z",
      );
      expect(() => focus.softDelete("missing", "2026-07-08T13:00:00.000Z")).toThrow(
        FocusNotFoundError,
      );
      expect(() => focus.restore(created.id, "2026-07-08T13:00:00.000Z")).toThrow(
        FocusNotFoundError,
      ); // not deleted yet
      focus.softDelete(created.id, "2026-07-08T13:00:00.000Z");
      expect(() => focus.softDelete(created.id, "2026-07-08T13:00:00.000Z")).toThrow(
        FocusNotFoundError,
      );
    });

    it("restores a soft-deleted session", () => {
      const { focus, subjectId } = fixture();
      const created = focus.create(
        { subjectId, startedAt: "2026-07-08T12:00:00.000Z", endedAt: "2026-07-08T13:00:00.000Z" },
        "2026-07-08T13:00:00.000Z",
      );
      focus.softDelete(created.id, "2026-07-08T13:00:00.000Z");
      focus.restore(created.id, "2026-07-08T13:00:00.000Z");
      expect(focus.listRange("2026-07-08", "2026-07-08").map((s) => s.id)).toEqual([created.id]);
    });
  });

  describe("cross-profile isolation", () => {
    it("keeps one profile's sessions invisible to another's store for mutations", () => {
      const a = fixture();
      const b = fixture();
      const owned = a.focus.create(
        {
          subjectId: a.subjectId,
          startedAt: "2026-07-08T12:00:00.000Z",
          endedAt: "2026-07-08T13:00:00.000Z",
        },
        "2026-07-08T13:00:00.000Z",
      );
      expect(() => b.focus.softDelete(owned.id, "2026-07-08T13:00:00.000Z")).toThrow(
        FocusNotFoundError,
      );
    });
  });
});
