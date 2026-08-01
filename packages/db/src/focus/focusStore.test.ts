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

  describe("create — the phase fields (migration 057)", () => {
    it("defaults an unadorned session to what every pre-057 row was", () => {
      const { focus, subjectId } = fixture();
      const session = focus.create(
        { subjectId, startedAt: "2026-07-08T12:00:00.000Z", endedAt: "2026-07-08T13:00:00.000Z" },
        "2026-07-08T13:00:00.000Z",
      );
      expect(session).toMatchObject({
        kind: "work",
        plannedMinutes: null,
        pausedSeconds: 0,
        outcome: null,
        cycleIndex: 0,
        taskId: null,
        label: null,
      });
    });

    it("persists a Pomodoro phase with no subject at all", () => {
      const { focus } = fixture();
      const session = focus.create(
        {
          startedAt: "2026-07-08T12:00:00.000Z",
          endedAt: "2026-07-08T12:25:00.000Z",
          kind: "work",
          plannedMinutes: 25,
          outcome: "completed",
          cycleIndex: 3,
          taskId: "t-1",
          label: "  Pisanje izveštaja  ",
        },
        "2026-07-08T12:25:00.000Z",
      );
      expect(session).toMatchObject({
        subjectId: null,
        kind: "work",
        plannedMinutes: 25,
        outcome: "completed",
        cycleIndex: 3,
        taskId: "t-1",
        label: "Pisanje izveštaja",
      });
      // Read back, not merely returned.
      expect(focus.listRange("2026-07-08", "2026-07-08")[0]).toEqual(session);
    });

    it("keeps a taskId that names nothing — the time was spent either way", () => {
      const { focus } = fixture();
      const session = focus.create(
        {
          startedAt: "2026-07-08T12:00:00.000Z",
          endedAt: "2026-07-08T12:25:00.000Z",
          taskId: "a-task-that-was-deleted",
          label: "Glava 4",
        },
        "2026-07-08T12:25:00.000Z",
      );
      expect(session.taskId).toBe("a-task-that-was-deleted");
    });

    it("accepts each of the three kinds and refuses a fourth", () => {
      const { focus } = fixture();
      for (const kind of ["work", "short_break", "long_break"] as const) {
        expect(
          focus.create(
            { startedAt: "2026-07-08T12:00:00.000Z", endedAt: "2026-07-08T12:25:00.000Z", kind },
            "2026-07-08T12:25:00.000Z",
          ).kind,
        ).toBe(kind);
      }
      expect(() =>
        focus.create(
          {
            startedAt: "2026-07-08T12:00:00.000Z",
            endedAt: "2026-07-08T12:25:00.000Z",
            kind: "pause" as never,
          },
          "2026-07-08T12:25:00.000Z",
        ),
      ).toThrow(FocusValidationError);
    });

    it("accepts both outcomes and refuses anything else — there is no abandoned", () => {
      const { focus } = fixture();
      for (const outcome of ["completed", "stopped"] as const) {
        expect(
          focus.create(
            { startedAt: "2026-07-08T12:00:00.000Z", endedAt: "2026-07-08T12:25:00.000Z", outcome },
            "2026-07-08T12:25:00.000Z",
          ).outcome,
        ).toBe(outcome);
      }
      expect(() =>
        focus.create(
          {
            startedAt: "2026-07-08T12:00:00.000Z",
            endedAt: "2026-07-08T12:25:00.000Z",
            outcome: "abandoned" as never,
          },
          "2026-07-08T12:25:00.000Z",
        ),
      ).toThrow(FocusValidationError);
    });

    it("refuses a fractional or out-of-range plan, cycle index, or pause", () => {
      const { focus } = fixture();
      const base = { startedAt: "2026-07-08T12:00:00.000Z", endedAt: "2026-07-08T13:00:00.000Z" };
      const now = "2026-07-08T13:00:00.000Z";
      expect(() => focus.create({ ...base, plannedMinutes: 25.5 }, now)).toThrow(
        FocusValidationError,
      );
      expect(() => focus.create({ ...base, plannedMinutes: 0 }, now)).toThrow(FocusValidationError);
      expect(() => focus.create({ ...base, plannedMinutes: 181 }, now)).toThrow(
        FocusValidationError,
      );
      expect(() => focus.create({ ...base, cycleIndex: -1 }, now)).toThrow(FocusValidationError);
      expect(() => focus.create({ ...base, cycleIndex: 1.5 }, now)).toThrow(FocusValidationError);
      expect(() => focus.create({ ...base, pausedSeconds: -1 }, now)).toThrow(FocusValidationError);
      expect(() => focus.create({ ...base, pausedSeconds: 0.5 }, now)).toThrow(
        FocusValidationError,
      );
    });

    it("refuses a pause longer than the session it is inside — attention can never be negative", () => {
      const { focus } = fixture();
      const base = { startedAt: "2026-07-08T12:00:00.000Z", endedAt: "2026-07-08T12:10:00.000Z" };
      const now = "2026-07-08T12:10:00.000Z";
      // 600 s is the whole span; one more second would mean negative attention.
      expect(focus.create({ ...base, pausedSeconds: 600 }, now).pausedSeconds).toBe(600);
      expect(() => focus.create({ ...base, pausedSeconds: 601 }, now)).toThrow(
        FocusValidationError,
      );
    });

    it("collapses a blank label to null and refuses an over-long one", () => {
      const { focus } = fixture();
      const base = { startedAt: "2026-07-08T12:00:00.000Z", endedAt: "2026-07-08T13:00:00.000Z" };
      const now = "2026-07-08T13:00:00.000Z";
      expect(focus.create({ ...base, label: "   " }, now).label).toBeNull();
      expect(focus.create({ ...base, label: "x".repeat(200) }, now).label).toHaveLength(200);
      expect(() => focus.create({ ...base, label: "x".repeat(201) }, now)).toThrow(
        FocusValidationError,
      );
    });

    it("refuses an empty string pretending to be a taskId", () => {
      const { focus } = fixture();
      expect(() =>
        focus.create(
          {
            startedAt: "2026-07-08T12:00:00.000Z",
            endedAt: "2026-07-08T13:00:00.000Z",
            taskId: "",
          },
          "2026-07-08T13:00:00.000Z",
        ),
      ).toThrow(FocusValidationError);
    });
  });

  describe("statsByKind", () => {
    /** Minutes of wall span, from a fixed noon start. */
    const span = (minutes: number, day = "2026-07-08") => ({
      startedAt: `${day}T12:00:00.000Z`,
      endedAt: new Date(Date.parse(`${day}T12:00:00.000Z`) + minutes * 60_000).toISOString(),
    });

    it("groups by kind, counting sessions and attention minutes", () => {
      const { focus } = fixture();
      focus.create({ ...span(25), kind: "work" }, "2026-07-08T13:00:00.000Z");
      focus.create({ ...span(30), kind: "work" }, "2026-07-08T13:00:00.000Z");
      focus.create({ ...span(5), kind: "short_break" }, "2026-07-08T13:00:00.000Z");

      // Ordered by kind, and `long_break` is simply absent — nothing in range.
      expect(focus.statsByKind("2026-07-08", "2026-07-08")).toEqual([
        { kind: "short_break", sessions: 1, minutes: 5 },
        { kind: "work", sessions: 2, minutes: 55 },
      ]);
    });

    it("subtracts paused time — a phase you paused held less attention", () => {
      const { focus } = fixture();
      focus.create(
        { ...span(30), kind: "work", pausedSeconds: 600 },
        "2026-07-08T13:00:00.000Z",
      );
      expect(focus.statsByKind("2026-07-08", "2026-07-08")).toEqual([
        { kind: "work", sessions: 1, minutes: 20 },
      ]);
    });

    it("omits a kind with nothing in range, and excludes soft-deleted rows", () => {
      const { focus } = fixture();
      const deleted = focus.create({ ...span(25), kind: "work" }, "2026-07-08T13:00:00.000Z");
      focus.create({ ...span(15), kind: "long_break" }, "2026-07-08T13:00:00.000Z");
      focus.softDelete(deleted.id, "2026-07-08T13:00:00.000Z");

      expect(focus.statsByKind("2026-07-08", "2026-07-08")).toEqual([
        { kind: "long_break", sessions: 1, minutes: 15 },
      ]);
    });

    it("bounds by the local start day and isolates profiles", () => {
      const a = fixture();
      const b = fixture();
      a.focus.create({ ...span(25, "2026-07-01"), kind: "work" }, "2026-07-01T13:00:00.000Z");
      expect(a.focus.statsByKind("2026-07-08", "2026-07-09")).toEqual([]);
      expect(b.focus.statsByKind("2026-07-01", "2026-07-01")).toEqual([]);
    });

    it("rejects a malformed fromDate or toDate", () => {
      const { focus } = fixture();
      expect(() => focus.statsByKind("not-a-date", "2026-07-08")).toThrow(FocusValidationError);
      expect(() => focus.statsByKind("2026-07-08", "not-a-date")).toThrow(FocusValidationError);
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

    it("returns every kind, so a history can group them itself", () => {
      const { focus } = fixture();
      focus.create(
        {
          startedAt: "2026-07-08T12:00:00.000Z",
          endedAt: "2026-07-08T12:25:00.000Z",
          kind: "work",
        },
        "2026-07-08T12:25:00.000Z",
      );
      focus.create(
        {
          startedAt: "2026-07-08T12:30:00.000Z",
          endedAt: "2026-07-08T12:35:00.000Z",
          kind: "short_break",
        },
        "2026-07-08T12:35:00.000Z",
      );
      expect(focus.listRange("2026-07-08", "2026-07-08").map((s) => s.kind)).toEqual([
        "short_break",
        "work",
      ]);
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

  describe("listActive", () => {
    it("returns every active session for this profile with no date bounds, ordered by startedAt then id", () => {
      const { focus, subjectId } = fixture();
      const earlier = focus.create(
        { subjectId, startedAt: "2020-01-01T12:00:00.000Z", endedAt: "2020-01-01T13:00:00.000Z" },
        "2020-01-01T13:00:00.000Z",
      );
      const later = focus.create(
        { subjectId, startedAt: "2026-07-09T12:00:00.000Z", endedAt: "2026-07-09T13:00:00.000Z" },
        "2026-07-09T13:00:00.000Z",
      );

      expect(focus.listActive().map((s) => s.id)).toEqual([earlier.id, later.id]);
    });

    it("excludes soft-deleted sessions", () => {
      const { focus, subjectId } = fixture();
      const created = focus.create(
        { subjectId, startedAt: "2026-07-08T12:00:00.000Z", endedAt: "2026-07-08T13:00:00.000Z" },
        "2026-07-08T13:00:00.000Z",
      );
      focus.softDelete(created.id, "2026-07-08T13:00:00.000Z");
      expect(focus.listActive()).toEqual([]);
    });

    it("isolates sessions between profiles", () => {
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
      expect(b.focus.listActive()).toEqual([]);
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
