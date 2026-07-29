import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NexusDatabase,
  PeopleStore,
  PERSON_KINDS,
  PersonNotFoundError,
  PersonValidationError,
  openDatabase,
  uuidv7,
} from "../index.js";
import type { PersonKind } from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-people-"));
  db = openDatabase({ path: join(dir, "people.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(name = "P"): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, new Date().toISOString());
  return id;
}

function store(profileId = createProfile()): { profileId: string; people: PeopleStore } {
  return { profileId, people: new PeopleStore(db.raw, profileId) };
}

const T0 = "2026-07-25T10:00:00.000Z";
const T1 = "2026-07-25T10:01:00.000Z";
const T2 = "2026-07-25T10:02:00.000Z";

describe("PeopleStore", () => {
  describe("create", () => {
    it("inserts a person and returns the stored row", () => {
      const { profileId, people } = store();

      const created = people.create(
        { name: "Marko", kind: "birthday", month: 3, day: 14, year: 1990, note: "Voli čaj" },
        T0,
      );

      expect(created).toEqual({
        id: expect.any(String),
        profileId,
        name: "Marko",
        kind: "birthday",
        month: 3,
        day: 14,
        year: 1990,
        note: "Voli čaj",
        createdAt: T0,
        updatedAt: T0,
      });
      expect(people.listActive()).toEqual([created]);
    });

    it("defaults an absent year and note to null", () => {
      const { people } = store();
      const created = people.create({ name: "Ana", kind: "anniversary", month: 9, day: 1 }, T0);
      expect(created.year).toBeNull();
      expect(created.note).toBeNull();
    });

    it("trims the name and collapses a blank note to null", () => {
      const { people } = store();
      const created = people.create(
        { name: "  Jovana  ", kind: "birthday", month: 1, day: 2, note: "   " },
        T0,
      );
      expect(created.name).toBe("Jovana");
      expect(created.note).toBeNull();
    });

    it("accepts 29 February — leap-day birthdays exist", () => {
      const { people } = store();
      expect(() =>
        people.create({ name: "Prestupna", kind: "birthday", month: 2, day: 29 }, T0),
      ).not.toThrow();
    });

    it("accepts every kind in the closed set and refuses anything else", () => {
      const { people } = store();
      for (const kind of PERSON_KINDS) {
        expect(() => people.create({ name: `X ${kind}`, kind, month: 5, day: 5 }, T0)).not.toThrow();
      }
      expect(() =>
        people.create({ name: "Slava", kind: "imendan" as unknown as PersonKind, month: 5, day: 5 }, T0),
      ).toThrow(PersonValidationError);
    });

    it("refuses an empty or whitespace-only name", () => {
      const { people } = store();
      expect(() => people.create({ name: "", kind: "birthday", month: 1, day: 1 }, T0)).toThrow(
        PersonValidationError,
      );
      expect(() => people.create({ name: "   ", kind: "birthday", month: 1, day: 1 }, T0)).toThrow(
        PersonValidationError,
      );
    });

    it("refuses a (month, day) pair that is no calendar day in any year", () => {
      const { people } = store();
      // 30 February and 31 April break no per-column CHECK, which is exactly
      // why the store validates the PAIR (migration 020's doc comment).
      expect(() => people.create({ name: "X", kind: "birthday", month: 2, day: 30 }, T0)).toThrow(
        PersonValidationError,
      );
      expect(() => people.create({ name: "X", kind: "birthday", month: 4, day: 31 }, T0)).toThrow(
        PersonValidationError,
      );
      expect(() => people.create({ name: "X", kind: "birthday", month: 6, day: 31 }, T0)).toThrow(
        PersonValidationError,
      );
    });

    it("refuses a month or day outside its range, and a non-integer either way", () => {
      const { people } = store();
      expect(() => people.create({ name: "X", kind: "birthday", month: 0, day: 1 }, T0)).toThrow(
        PersonValidationError,
      );
      expect(() => people.create({ name: "X", kind: "birthday", month: 13, day: 1 }, T0)).toThrow(
        PersonValidationError,
      );
      expect(() => people.create({ name: "X", kind: "birthday", month: 1, day: 0 }, T0)).toThrow(
        PersonValidationError,
      );
      expect(() => people.create({ name: "X", kind: "birthday", month: 1, day: 32 }, T0)).toThrow(
        PersonValidationError,
      );
      expect(() => people.create({ name: "X", kind: "birthday", month: 1.5, day: 1 }, T0)).toThrow(
        PersonValidationError,
      );
      expect(() => people.create({ name: "X", kind: "birthday", month: 1, day: 2.5 }, T0)).toThrow(
        PersonValidationError,
      );
    });

    it("accepts a year inside 1900-2100 and refuses one outside it or non-integer", () => {
      const { people } = store();
      expect(() =>
        people.create({ name: "A", kind: "birthday", month: 1, day: 1, year: 1900 }, T0),
      ).not.toThrow();
      expect(() =>
        people.create({ name: "B", kind: "birthday", month: 1, day: 1, year: 2100 }, T0),
      ).not.toThrow();
      expect(() =>
        people.create({ name: "C", kind: "birthday", month: 1, day: 1, year: 1899 }, T0),
      ).toThrow(PersonValidationError);
      expect(() =>
        people.create({ name: "D", kind: "birthday", month: 1, day: 1, year: 19858 }, T0),
      ).toThrow(PersonValidationError);
      expect(() =>
        people.create({ name: "E", kind: "birthday", month: 1, day: 1, year: 1990.5 }, T0),
      ).toThrow(PersonValidationError);
    });

    it("refuses a malformed `now`", () => {
      const { people } = store();
      expect(() =>
        people.create({ name: "X", kind: "birthday", month: 1, day: 1 }, "2026-07-25"),
      ).toThrow(PersonValidationError);
    });
  });

  describe("listActive", () => {
    it("orders by name and hides soft-deleted rows", () => {
      const { people } = store();
      const zoran = people.create({ name: "Zoran", kind: "birthday", month: 1, day: 1 }, T0);
      const ana = people.create({ name: "Ana", kind: "birthday", month: 2, day: 2 }, T0);
      const marko = people.create({ name: "Marko", kind: "birthday", month: 3, day: 3 }, T0);

      expect(people.listActive().map((row) => row.name)).toEqual(["Ana", "Marko", "Zoran"]);

      people.softDelete(marko.id, T1);
      expect(people.listActive()).toEqual([
        { ...ana },
        { ...zoran },
      ]);
    });

    it("never sees another profile's people", () => {
      const first = store();
      const second = store();
      first.people.create({ name: "Mine", kind: "birthday", month: 1, day: 1 }, T0);

      expect(second.people.listActive()).toEqual([]);
    });
  });

  describe("update", () => {
    it("applies a partial patch, leaves omitted fields alone and restamps updatedAt", () => {
      const { people } = store();
      const created = people.create(
        { name: "Marko", kind: "birthday", month: 3, day: 14, year: 1990, note: "Prvi" },
        T0,
      );

      const updated = people.update(created.id, { name: "  Marko M.  ", month: 4, day: 1 }, T1);

      expect(updated).toEqual({
        ...created,
        name: "Marko M.",
        month: 4,
        day: 1,
        updatedAt: T1,
      });
      expect(people.listActive()).toEqual([updated]);
    });

    it("clears year and note with an explicit null", () => {
      const { people } = store();
      const created = people.create(
        { name: "Ana", kind: "birthday", month: 3, day: 14, year: 1990, note: "Beleška" },
        T0,
      );

      const updated = people.update(created.id, { year: null, note: null }, T1);
      expect(updated.year).toBeNull();
      expect(updated.note).toBeNull();
    });

    it("changes the kind", () => {
      const { people } = store();
      const created = people.create({ name: "Svadba", kind: "birthday", month: 6, day: 6 }, T0);
      expect(people.update(created.id, { kind: "anniversary" }, T1).kind).toBe("anniversary");
    });

    it("validates the merged pair, not only the field that moved", () => {
      const { people } = store();
      // 30 January is fine; moving only the month to February would make the
      // stored pair 30 February, which the merged-pair check has to catch.
      const created = people.create({ name: "X", kind: "birthday", month: 1, day: 30 }, T0);
      expect(() => people.update(created.id, { month: 2 }, T1)).toThrow(PersonValidationError);
      // ...and the refused write left the row exactly as it was.
      expect(people.listActive()).toEqual([created]);
    });

    it("refuses an unknown, soft-deleted or foreign id", () => {
      const first = store();
      const second = store();
      const created = first.people.create({ name: "X", kind: "birthday", month: 1, day: 1 }, T0);

      expect(() => first.people.update(uuidv7(), { name: "Y" }, T1)).toThrow(PersonNotFoundError);
      expect(() => second.people.update(created.id, { name: "Y" }, T1)).toThrow(PersonNotFoundError);

      first.people.softDelete(created.id, T1);
      expect(() => first.people.update(created.id, { name: "Y" }, T2)).toThrow(PersonNotFoundError);
    });
  });

  describe("softDelete / restore", () => {
    it("round-trips a person out of and back into the active list", () => {
      const { people } = store();
      const created = people.create({ name: "Marko", kind: "birthday", month: 3, day: 14 }, T0);

      people.softDelete(created.id, T1);
      expect(people.listActive()).toEqual([]);

      people.restore(created.id, T2);
      expect(people.listActive()).toEqual([{ ...created, updatedAt: T2 }]);
    });

    it("refuses to delete twice or restore something that is not deleted", () => {
      const { people } = store();
      const created = people.create({ name: "Marko", kind: "birthday", month: 3, day: 14 }, T0);

      expect(() => people.restore(created.id, T1)).toThrow(PersonNotFoundError);
      people.softDelete(created.id, T1);
      expect(() => people.softDelete(created.id, T2)).toThrow(PersonNotFoundError);
    });

    it("never reaches another profile's rows", () => {
      const first = store();
      const second = store();
      const created = first.people.create({ name: "X", kind: "birthday", month: 1, day: 1 }, T0);

      expect(() => second.people.softDelete(created.id, T1)).toThrow(PersonNotFoundError);
      expect(first.people.listActive()).toEqual([created]);
    });

    it("refuses a malformed `now` on either side", () => {
      const { people } = store();
      const created = people.create({ name: "X", kind: "birthday", month: 1, day: 1 }, T0);
      expect(() => people.softDelete(created.id, "danas")).toThrow(PersonValidationError);
      people.softDelete(created.id, T1);
      expect(() => people.restore(created.id, "danas")).toThrow(PersonValidationError);
    });
  });
});
