import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentStore, NexusDatabase, PeopleStore, openDatabase, uuidv7 } from "@nexus/db";
import type { ConfirmRequest, Tool, ToolContext } from "@nexus/core";
import { directoryTools } from "./directory.js";

/**
 * The PEOPLE and DOCUMENTS tools over a real database.
 *
 * What this suite pins is that a write goes through the same store the IPC
 * channel calls (so the store's own rules hold: the year window, the reminder
 * ladder a document takes from its type, the renewal row), that nothing is
 * written when the user says no, and that a name is resolved or refused, never
 * guessed. The document store reads its own clock, so the clock is pinned: the
 * days-left figures are counted from 16 October 2026.
 */

const NOW_MS = new Date(2026, 9, 16, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-directory-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_MS);
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
});

function people(): PeopleStore {
  return new PeopleStore(db.raw, profileId);
}

function documents(): DocumentStore {
  return new DocumentStore(db.raw, profileId);
}

function tools(): readonly Tool[] {
  return directoryTools({ profileDb: (id, open) => open(db.raw, id), now: () => NOW_MS });
}

function toolOf(name: string): Tool {
  const found = tools().find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

function contextFor(locale: "sr" | "en", allow: boolean): {
  readonly context: ToolContext;
  readonly confirms: ConfirmRequest[];
} {
  const confirms: ConfirmRequest[] = [];
  return {
    confirms,
    context: {
      profileId,
      locale,
      signal: new AbortController().signal,
      confirm: (request) => {
        confirms.push(request);
        return Promise.resolve(allow);
      },
    },
  };
}

function count(table: string): number {
  return (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE profile_id = ?`).get(profileId) as { n: number }).n;
}

describe("people.list", () => {
  it("names each person with the date they recur on and the year when known", async () => {
    people().create({ name: "Ana", kind: "birthday", month: 5, day: 12, year: 1990 }, NOW_ISO);
    people().create({ name: "Marko", kind: "anniversary", month: 2, day: 29 }, NOW_ISO);

    const result = await toolOf("people.list").run({}, contextFor("en", true).context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Ana: birthday, 12 May 1990");
    expect(result.content).toContain("Marko: anniversary, 29 Feb");
  });

  it("filters by kind", async () => {
    people().create({ name: "Ana", kind: "birthday", month: 5, day: 12 }, NOW_ISO);
    people().create({ name: "Marko", kind: "anniversary", month: 2, day: 29 }, NOW_ISO);

    const only = await toolOf("people.list").run({ kind: "anniversary" }, contextFor("sr", true).context);
    expect(only.content).toContain("Marko");
    expect(only.content).not.toContain("Ana");
  });

  it("says so when nothing is saved", async () => {
    const result = await toolOf("people.list").run({}, contextFor("en", true).context);
    expect(result).toEqual({ ok: true, content: "No birthdays or anniversaries are saved." });
  });

  it("refuses a kind the calendar does not know", async () => {
    const result = await toolOf("people.list").run({ kind: "funeral" }, contextFor("en", true).context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('"kind" must be one of: birthday, anniversary.');
  });
});

describe("people.create", () => {
  it("saves the person through the store and reveals the calendar", async () => {
    const { context, confirms } = contextFor("sr", true);
    const result = await toolOf("people.create").run(
      { name: "Ana", kind: "birthday", month: 5, day: 12, year: 1990, note: "voli kafu" },
      context,
    );

    expect(confirms).toHaveLength(1);
    expect(confirms[0]?.summary).toBe("Dodati osobu „Ana“: rođendan, 12. maj 1990.");
    expect(result.ok).toBe(true);
    expect(result.content).toMatch(/^Sačuvana je osoba „Ana“ \(/);
    expect(result.navigateTo).toEqual({ module: "calendar" });
    const [saved] = people().listActive();
    expect(saved).toMatchObject({ name: "Ana", kind: "birthday", month: 5, day: 12, year: 1990, note: "voli kafu" });
  });

  it("takes the year as optional", async () => {
    await toolOf("people.create").run(
      { name: "Marko", kind: "anniversary", month: 2, day: 29 },
      contextFor("en", true).context,
    );
    expect(people().listActive()).toEqual([expect.objectContaining({ name: "Marko", month: 2, day: 29, year: null })]);
  });

  it("refuses a day that does not exist before asking, and a month out of range", async () => {
    const { context, confirms } = contextFor("en", true);
    const thirtyFebruary = await toolOf("people.create").run(
      { name: "Ana", kind: "birthday", month: 2, day: 30 },
      context,
    );
    expect(thirtyFebruary).toEqual({ ok: false, content: "Failed: That day does not exist." });

    const month13 = await toolOf("people.create").run(
      { name: "Ana", kind: "birthday", month: 13, day: 1 },
      context,
    );
    expect(month13.ok).toBe(false);
    expect(month13.content).toContain('"month"');
    expect(confirms).toHaveLength(0);
    expect(people().listActive()).toEqual([]);
  });

  it("refuses a year the store's window does not hold, with the store's reason", async () => {
    const result = await toolOf("people.create").run(
      { name: "Ana", kind: "birthday", month: 5, day: 12, year: 1800 },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain('"year"');
    expect(people().listActive()).toEqual([]);
  });

  it("writes nothing when the user declines", async () => {
    const result = await toolOf("people.create").run(
      { name: "Ana", kind: "birthday", month: 5, day: 12 },
      contextFor("en", false).context,
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(count("people")).toBe(0);
  });

  it("refuses an invalid argument with the reader's message", async () => {
    const result = await toolOf("people.create").run(
      { name: "", kind: "birthday", month: 5, day: 12 },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain('"name" must be a non-empty string.');
  });
});

describe("people.update", () => {
  it("changes only the fields given and names them in the confirmation", async () => {
    const ana = people().create({ name: "Ana", kind: "birthday", month: 5, day: 12 }, NOW_ISO);
    const { context, confirms } = contextFor("en", true);

    const result = await toolOf("people.update").run({ person: ana.id, day: 14 }, context);

    expect(confirms[0]?.summary).toBe("Change “Ana”: date: 14 May.");
    expect(result.content).toContain("Updated “Ana”");
    expect(people().listActive()[0]).toMatchObject({ month: 5, day: 14 });
  });

  it("finds the person by name, ignoring case and diacritics", async () => {
    people().create({ name: "Šimun", kind: "birthday", month: 1, day: 3 }, NOW_ISO);
    const result = await toolOf("people.update").run(
      { person: "simun", note: "kafa" },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(true);
    expect(people().listActive()[0]?.note).toBe("kafa");
  });

  it("refuses a name that matches several people, listing their ids", async () => {
    const first = people().create({ name: "Ana", kind: "birthday", month: 5, day: 12 }, NOW_ISO);
    const second = people().create({ name: "Ana", kind: "anniversary", month: 6, day: 1 }, NOW_ISO);
    const result = await toolOf("people.update").run(
      { person: "Ana", name: "Ana K." },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain(`Ana (${first.id}), Ana (${second.id})`);
  });

  it("refuses a name that matches nobody, listing the people that exist", async () => {
    people().create({ name: "Ana", kind: "birthday", month: 5, day: 12 }, NOW_ISO);
    const result = await toolOf("people.update").run(
      { person: "Petar", note: "x" },
      contextFor("sr", true).context,
    );
    expect(result).toEqual({ ok: false, content: "Neuspešno: Nema osobe „Petar“. Poznate osobe: Ana." });
  });

  it("checks a moved day against the person's stored month, and refuses a change that is nothing", async () => {
    people().create({ name: "Ana", kind: "birthday", month: 2, day: 10 }, NOW_ISO);
    const context = contextFor("en", true).context;
    const moved = await toolOf("people.update").run({ person: "Ana", day: 30 }, context);
    expect(moved).toEqual({ ok: false, content: "Failed: That day does not exist." });

    const nothing = await toolOf("people.update").run({ person: "Ana" }, context);
    expect(nothing).toEqual({ ok: false, content: "Failed: There is nothing to change." });
  });

  it("clears the note when it is given empty", async () => {
    people().create({ name: "Ana", kind: "birthday", month: 5, day: 12, note: "kafa" }, NOW_ISO);
    await toolOf("people.update").run({ person: "Ana", note: "" }, contextFor("en", true).context);
    expect(people().listActive()[0]?.note).toBeNull();
  });

  it("writes nothing when the user declines", async () => {
    people().create({ name: "Ana", kind: "birthday", month: 5, day: 12 }, NOW_ISO);
    const result = await toolOf("people.update").run({ person: "Ana", day: 14 }, contextFor("en", false).context);
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(people().listActive()[0]).toMatchObject({ day: 12 });
  });
});

describe("people.delete", () => {
  it("soft-deletes the person the name resolves to", async () => {
    people().create({ name: "Ana", kind: "birthday", month: 5, day: 12 }, NOW_ISO);
    const { context, confirms } = contextFor("sr", true);
    const result = await toolOf("people.delete").run({ person: "ana" }, context);

    expect(confirms[0]?.summary).toBe("Obrisati osobu „Ana“ (rođendan, 12. maj).");
    expect(result.navigateTo).toEqual({ module: "calendar" });
    expect(people().listActive()).toEqual([]);
  });

  it("writes nothing when the user declines, and refuses a missing person", async () => {
    people().create({ name: "Ana", kind: "birthday", month: 5, day: 12 }, NOW_ISO);
    const declined = await toolOf("people.delete").run({ person: "Ana" }, contextFor("en", false).context);
    expect(declined).toEqual({ ok: false, content: "The user declined." });
    expect(people().listActive()).toHaveLength(1);

    const missing = await toolOf("people.delete").run({ person: "Petar" }, contextFor("en", true).context);
    expect(missing.ok).toBe(false);
    expect(missing.content).toContain('No person “Petar”');
  });
});

describe("documents.list", () => {
  it("reads the days left to each expiry, soonest first", async () => {
    documents().create({ docType: "pasos", label: "Ana", expiryDate: "2027-01-10" });
    documents().create({ docType: "registracija", label: "Golf", expiryDate: "2026-10-20" });

    const result = await toolOf("documents.list").run({}, contextFor("sr", true).context);
    const lines = result.content.split("\n");
    expect(lines[0]).toContain("Golf (registracija vozila)");
    expect(lines[0]).toContain("rok ističe za 4 dana");
    expect(lines[1]).toContain("Ana (pasoš)");
  });

  it("says when a document has already expired, and filters by type", async () => {
    documents().create({ docType: "polisa", label: "Osiguranje", expiryDate: "2026-10-15" });
    documents().create({ docType: "pasos", label: "Ana", expiryDate: "2030-01-01" });

    const expired = await toolOf("documents.list").run({ type: "polisa" }, contextFor("en", true).context);
    expect(expired.content).toContain("Osiguranje (insurance policy)");
    expect(expired.content).toContain("expired 1 day ago");
    expect(expired.content).not.toContain("Ana");
  });
});

describe("documents.create", () => {
  it("takes its reminder ladder from the type when none is given", async () => {
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("documents.create").run(
      { docType: "pasos", label: "Ana", expiryDate: "2030-05-12" },
      context,
    );

    expect(confirms[0]?.summary).toBe("Add “Ana” (passport), expiring 12 May 2030.");
    expect(result.content).toContain("expires in");
    expect(result.navigateTo).toEqual({ module: "calendar" });
    expect(documents().listActive()[0]?.reminderOffsets).toEqual([90, 30, 7]);
  });

  it("keeps the reminders the user gave", async () => {
    await toolOf("documents.create").run(
      { docType: "pasos", label: "Ana", expiryDate: "2030-05-12", reminderOffsets: [14] },
      contextFor("en", true).context,
    );
    expect(documents().listActive()[0]?.reminderOffsets).toEqual([14]);
  });

  it("refuses a date that is not a day, and writes nothing when declined", async () => {
    const invalid = await toolOf("documents.create").run(
      { docType: "pasos", label: "Ana", expiryDate: "2030-02-30" },
      contextFor("en", true).context,
    );
    expect(invalid.ok).toBe(false);
    expect(invalid.content).toContain('"expiryDate" must be a calendar day');

    const declined = await toolOf("documents.create").run(
      { docType: "pasos", label: "Ana", expiryDate: "2030-05-12" },
      contextFor("en", false).context,
    );
    expect(declined).toEqual({ ok: false, content: "The user declined." });
    expect(count("tracked_documents")).toBe(0);
  });

  it("refuses an unknown document type", async () => {
    const result = await toolOf("documents.create").run(
      { docType: "diploma", label: "Ana", expiryDate: "2030-05-12" },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain('"docType" must be one of');
  });
});

describe("documents.update", () => {
  it("moves the expiry and re-derives the days left", async () => {
    documents().create({ docType: "pasos", label: "Ana", expiryDate: "2026-10-20" });
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("documents.update").run({ document: "ana", expiryDate: "2026-10-26" }, context);

    expect(confirms[0]?.summary).toBe("Change “Ana”: expiry: 26 October 2026.");
    expect(result.content).toContain("expires in 10 days");
    expect(documents().listActive()[0]?.expiryDate).toBe("2026-10-26");
  });

  it("refuses an empty change, and a name that is shared", async () => {
    const passport = documents().create({ docType: "pasos", label: "Ana", expiryDate: "2030-05-12" });
    documents().create({ docType: "vozacka", label: "Ana", expiryDate: "2031-05-12" });
    const context = contextFor("en", true).context;

    const shared = await toolOf("documents.update").run({ document: "Ana", notes: "x" }, context);
    expect(shared.ok).toBe(false);
    expect(shared.content).toContain("Several documents are called “Ana”");

    const nothing = await toolOf("documents.update").run({ document: passport.id }, context);
    expect(nothing).toEqual({ ok: false, content: "Failed: There is nothing to change." });
  });
});

describe("documents.delete", () => {
  it("soft-deletes the document and writes nothing when declined", async () => {
    documents().create({ docType: "kartica", label: "Visa", expiryDate: "2028-01-01" });

    const declined = await toolOf("documents.delete").run({ document: "Visa" }, contextFor("en", false).context);
    expect(declined).toEqual({ ok: false, content: "The user declined." });
    expect(documents().listActive()).toHaveLength(1);

    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("documents.delete").run({ document: "Visa" }, context);
    expect(confirms[0]?.summary).toBe("Delete “Visa” (bank card, expiring 1 January 2028).");
    expect(result.navigateTo).toEqual({ module: "calendar" });
    expect(documents().listActive()).toEqual([]);
  });

  it("refuses a document that does not exist", async () => {
    const result = await toolOf("documents.delete").run({ document: "Nema" }, contextFor("en", true).context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('No document “Nema”');
  });
});

describe("documents.renew", () => {
  it("moves the expiry, writes a renewal row with the old one, and reports the new days left", async () => {
    const pasos = documents().create({ docType: "pasos", label: "Ana", expiryDate: "2026-10-20" });
    const { context, confirms } = contextFor("sr", true);

    const result = await toolOf("documents.renew").run(
      { document: pasos.id, newExpiryDate: "2036-05-12" },
      context,
    );

    expect(confirms[0]?.summary).toBe("Obnoviti dokument „Ana“: novi rok 12. maj 2036.");
    expect(result.content).toContain("rok ističe za");
    expect(documents().listActive()[0]?.expiryDate).toBe("2036-05-12");
    expect(documents().listRenewals(pasos.id)).toEqual([
      expect.objectContaining({ previousExpiry: "2026-10-20" }),
    ]);
    expect(result.navigateTo).toEqual({ module: "calendar" });
  });

  it("writes nothing when declined, and refuses a date that is not a day", async () => {
    const pasos = documents().create({ docType: "pasos", label: "Ana", expiryDate: "2026-10-20" });
    const declined = await toolOf("documents.renew").run(
      { document: "Ana", newExpiryDate: "2036-05-12" },
      contextFor("en", false).context,
    );
    expect(declined).toEqual({ ok: false, content: "The user declined." });
    expect(documents().listRenewals(pasos.id)).toEqual([]);

    const invalid = await toolOf("documents.renew").run(
      { document: "Ana", newExpiryDate: "not a date" },
      contextFor("en", true).context,
    );
    expect(invalid.ok).toBe(false);
  });
});
