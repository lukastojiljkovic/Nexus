import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DocumentNotFoundError,
  DocumentStore,
  DocumentValidationError,
  NexusDatabase,
  openDatabase,
  uuidv7,
  type DocumentType,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-documents-"));
  db = openDatabase({ path: join(dir, "documents.db") });
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

function store(): DocumentStore {
  return new DocumentStore(db.raw, createProfile());
}

/** An ISO date `days` whole days from `from`'s UTC date — the unit `deriveStatus` counts in. */
function isoDateInDays(from: Date, days: number): string {
  const shifted = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + days),
  );
  return shifted.toISOString().slice(0, 10);
}

describe("DocumentStore", () => {
  it("applies the default reminder ladder for the document type when offsets are omitted", () => {
    const docs = store();
    const lk = docs.create({ docType: "licna_karta", label: "LK", expiryDate: "2027-01-01" });
    const kartica = docs.create({ docType: "kartica", label: "Kartica", expiryDate: "2027-01-01" });
    const reg = docs.create({ docType: "registracija", label: "Reg", expiryDate: "2027-01-01" });

    expect(lk.reminderOffsets).toEqual([90, 30, 7]);
    expect(kartica.reminderOffsets).toEqual([30, 7]);
    expect(reg.reminderOffsets).toEqual([30, 14, 3]);
  });

  it("stores explicit reminder offsets when supplied", () => {
    const docs = store();
    const created = docs.create({
      docType: "custom",
      label: "Warranty",
      expiryDate: "2027-01-01",
      reminderOffsets: [60, 14, 1],
    });

    expect(created.reminderOffsets).toEqual([60, 14, 1]);
    expect(docs.listActive()[0]?.reminderOffsets).toEqual([60, 14, 1]); // round-trips through JSON
  });

  it("rejects reminder offsets that are negative, non-integer, or not an array", () => {
    const docs = store();
    const base = { docType: "pasos", label: "x", expiryDate: "2027-01-01" } as const;
    expect(() => docs.create({ ...base, reminderOffsets: [-1] })).toThrow(DocumentValidationError);
    expect(() => docs.create({ ...base, reminderOffsets: [1.5] })).toThrow(DocumentValidationError);
    expect(() =>
      docs.create({ ...base, reminderOffsets: "nope" as unknown as number[] }),
    ).toThrow(DocumentValidationError);
  });

  it("rejects an empty or whitespace-only label", () => {
    const docs = store();
    expect(() => docs.create({ docType: "pasos", label: "", expiryDate: "2027-01-01" })).toThrow(
      DocumentValidationError,
    );
    expect(() => docs.create({ docType: "pasos", label: "   ", expiryDate: "2027-01-01" })).toThrow(
      DocumentValidationError,
    );
  });

  it("rejects a malformed expiry date", () => {
    const docs = store();
    expect(() =>
      docs.create({ docType: "pasos", label: "x", expiryDate: "not-a-date" }),
    ).toThrow(DocumentValidationError);
  });

  it("rejects an unknown document type", () => {
    const docs = store();
    expect(() =>
      docs.create({
        docType: "passport" as unknown as DocumentType,
        label: "x",
        expiryDate: "2027-01-01",
      }),
    ).toThrow(DocumentValidationError);
  });

  it("derives status from the reminder ladder at read time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00.000Z"));
    const now = new Date();
    const docs = store();

    const ok = docs.create({ docType: "pasos", label: "ok", expiryDate: isoDateInDays(now, 200) });
    const soon = docs.create({ docType: "kartica", label: "soon", expiryDate: isoDateInDays(now, 20) });
    const gone = docs.create({ docType: "licna_karta", label: "gone", expiryDate: isoDateInDays(now, -5) });

    expect(ok.status).toBe("ok"); // 200 > pasos ladder max 90
    expect(ok.daysUntilExpiry).toBe(200);
    expect(soon.status).toBe("uskoro"); // 20 <= kartica ladder max 30
    expect(soon.daysUntilExpiry).toBe(20);
    expect(gone.status).toBe("istekao");
    expect(gone.daysUntilExpiry).toBe(-5);
  });

  it("treats registracija 45 days out as 'ok' under the confirmed 30/14/3 ladder", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00.000Z"));
    const now = new Date();
    const docs = store();

    const far = docs.create({ docType: "registracija", label: "Reg", expiryDate: isoDateInDays(now, 45) });
    const near = docs.create({ docType: "registracija", label: "Reg2", expiryDate: isoDateInDays(now, 20) });

    expect(far.status).toBe("ok"); // 45 > ladder max 30 (PRD §8's 60-day example is stale)
    expect(near.status).toBe("uskoro"); // 20 <= 30
  });

  it("re-derives status on each read as time advances", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00.000Z"));
    const docs = store();
    const created = docs.create({
      docType: "kartica",
      label: "K",
      expiryDate: isoDateInDays(new Date(), 40),
    });
    expect(created.status).toBe("ok"); // 40 > kartica ladder max 30

    // Advance to 20 days before expiry: now inside the ladder window.
    vi.setSystemTime(new Date("2026-07-26T12:00:00.000Z"));
    expect(docs.listActive()[0]?.status).toBe("uskoro");
  });

  it("lists active documents ordered by expiry_date then id, carrying derived status", () => {
    vi.useFakeTimers();
    const docs = store();
    vi.setSystemTime(new Date("2026-07-06T10:00:00.000Z"));
    const later = docs.create({ docType: "pasos", label: "Later", expiryDate: "2027-01-10" });
    vi.setSystemTime(new Date("2026-07-06T10:00:01.000Z"));
    const earlyA = docs.create({ docType: "pasos", label: "Early A", expiryDate: "2026-08-01" });
    vi.setSystemTime(new Date("2026-07-06T10:00:02.000Z"));
    const earlyB = docs.create({ docType: "pasos", label: "Early B", expiryDate: "2026-08-01" });

    // earlyA/earlyB share an expiry_date, so the id tiebreak (creation order) settles them.
    const listed = docs.listActive();
    expect(listed.map((d) => d.id)).toEqual([earlyA.id, earlyB.id, later.id]);
    expect(listed[0]?.status).toBe("uskoro"); // 2026-08-01 is 26 days out
    expect(listed[2]?.status).toBe("ok"); // 2027-01-10 is far out
  });

  it("updates fields and re-derives status", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T10:00:00.000Z"));
    const docs = store();
    const created = docs.create({ docType: "pasos", label: "Old", expiryDate: "2027-01-01" });
    expect(created.status).toBe("ok");

    vi.setSystemTime(new Date("2026-07-06T10:05:00.000Z"));
    const updated = docs.update(created.id, {
      label: "New",
      docType: "kartica",
      expiryDate: "2026-07-14",
      reminderOffsets: [10],
      notes: "renewing",
    });

    expect(updated.label).toBe("New");
    expect(updated.docType).toBe("kartica");
    expect(updated.expiryDate).toBe("2026-07-14");
    expect(updated.reminderOffsets).toEqual([10]);
    expect(updated.notes).toBe("renewing");
    expect(updated.status).toBe("uskoro"); // 8 days out, ladder max 10
    expect(updated.daysUntilExpiry).toBe(8);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe(created.updatedAt);
    expect(docs.listActive()[0]).toEqual(updated);
  });

  it("excludes soft-deleted documents from the active list and restores them", () => {
    const docs = store();
    const created = docs.create({ docType: "pasos", label: "x", expiryDate: "2027-01-01" });

    docs.softDelete(created.id);
    expect(docs.listActive()).toHaveLength(0);

    docs.restore(created.id);
    const listed = docs.listActive();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
  });

  it("throws DocumentNotFoundError for operations on an unknown or wrong-state document", () => {
    const docs = store();
    const created = docs.create({ docType: "pasos", label: "x", expiryDate: "2027-01-01" });

    expect(() => docs.update("missing", { label: "y" })).toThrow(DocumentNotFoundError);
    expect(() => docs.softDelete("missing")).toThrow(DocumentNotFoundError);
    expect(() => docs.renew("missing", "2028-01-01")).toThrow(DocumentNotFoundError);
    expect(() => docs.listRenewals("missing")).toThrow(DocumentNotFoundError);
    // not currently deleted -> nothing to restore.
    expect(() => docs.restore(created.id)).toThrow(DocumentNotFoundError);
    // double delete -> the second finds no active row.
    docs.softDelete(created.id);
    expect(() => docs.softDelete(created.id)).toThrow(DocumentNotFoundError);
  });

  it("renews a document, recording the previous expiry, and lists its history", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T10:00:00.000Z"));
    const docs = store();
    const created = docs.create({ docType: "pasos", label: "Pasoš", expiryDate: "2026-07-20" });

    vi.setSystemTime(new Date("2026-07-06T10:10:00.000Z"));
    const renewed = docs.renew(created.id, "2031-07-20");

    expect(renewed.expiryDate).toBe("2031-07-20");
    expect(renewed.status).toBe("ok");
    expect(renewed.updatedAt).not.toBe(created.updatedAt);

    const history = docs.listRenewals(created.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.documentId).toBe(created.id);
    expect(history[0]?.previousExpiry).toBe("2026-07-20"); // the expiry that was replaced

    // The active list reflects the new expiry only.
    expect(docs.listActive()[0]?.expiryDate).toBe("2031-07-20");
  });

  it("rejects a malformed new expiry date on renew", () => {
    const docs = store();
    const created = docs.create({ docType: "pasos", label: "x", expiryDate: "2026-07-20" });
    expect(() => docs.renew(created.id, "not-a-date")).toThrow(DocumentValidationError);
  });

  it("isolates documents between profiles", () => {
    const a = new DocumentStore(db.raw, createProfile());
    const b = new DocumentStore(db.raw, createProfile());
    const owned = a.create({ docType: "pasos", label: "A only", expiryDate: "2027-01-01" });

    expect(b.listActive()).toHaveLength(0);
    expect(() => b.update(owned.id, { label: "hijack" })).toThrow(DocumentNotFoundError);
    expect(() => b.softDelete(owned.id)).toThrow(DocumentNotFoundError);
    expect(() => b.renew(owned.id, "2030-01-01")).toThrow(DocumentNotFoundError);
    expect(() => b.listRenewals(owned.id)).toThrow(DocumentNotFoundError);
    expect(a.listActive()).toHaveLength(1);
  });
});
