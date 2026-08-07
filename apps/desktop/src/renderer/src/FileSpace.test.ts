import { describe, expect, it } from "vitest";
import type { DocAttachmentEntry } from "../../shared/ipc.js";

import { familySpace, fileSpaceDescription } from "./FileSpace.js";

function entry(mime: string, sizeBytes: number): DocAttachmentEntry {
  return {
    id: "a",
    ownerKind: "note",
    ownerId: "n",
    ownerTitle: "Beleška",
    fileName: "a",
    mime,
    sizeBytes,
    sha256: "a".repeat(64),
    createdAt: "2026-07-30T10:00:00.000Z",
  };
}

describe("familySpace", () => {
  it("is a zeroed row per family, in MIME_FAMILIES order, for no entries", () => {
    expect(familySpace([])).toEqual([
      { family: "slika", bytes: 0, count: 0 },
      { family: "pdf", bytes: 0, count: 0 },
      { family: "tekst", bytes: 0, count: 0 },
      { family: "ostalo", bytes: 0, count: 0 },
    ]);
  });

  it("sums bytes and counts per family, using the one mime→family rule", () => {
    const rows = familySpace([
      entry("image/png", 100),
      entry("image/jpeg", 300),
      entry("application/pdf", 1000),
      entry("text/plain", 50),
      entry("application/zip", 20),
    ]);
    expect(rows).toEqual([
      { family: "slika", bytes: 400, count: 2 },
      { family: "pdf", bytes: 1000, count: 1 },
      { family: "tekst", bytes: 50, count: 1 },
      { family: "ostalo", bytes: 20, count: 1 },
    ]);
  });
});

describe("fileSpaceDescription", () => {
  it("is the empty reason when every family is a genuine zero", () => {
    expect(fileSpaceDescription(familySpace([]), false)).toBe(
      "Pregled se crta čim postoji bar jedna priložena datoteka.",
    );
  });

  it("states every family's size, even a zero one, when there is at least one byte", () => {
    const rows = familySpace([entry("application/pdf", 1024)]);
    expect(fileSpaceDescription(rows, false)).toBe(
      "Šta zauzima prostor: Slike 0 B, PDF 1 KB, Tekst 0 B, Ostalo 0 B.",
    );
  });

  it("leads with the truncation caveat, unchanged, when the read was capped", () => {
    const rows = familySpace([entry("application/pdf", 1024)]);
    expect(fileSpaceDescription(rows, true)).toBe(
      "Prikazano je 500 najnovijih datoteka, pa je ovo najmanje što zauzimaju — ne ukupno. " +
        "Slike 0 B, PDF 1 KB, Tekst 0 B, Ostalo 0 B.",
    );
  });
});
