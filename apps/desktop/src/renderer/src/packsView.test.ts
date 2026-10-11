import { describe, expect, it } from "vitest";

import type { InstalledPackView, PackCatalogueEntryView, PackKind } from "../../shared/ipc.js";
import { formatPackSize, groupCatalogueByKind, packText, sortPacksByTitle } from "./packsView.js";

function pack(id: string, sr: string, en: string): InstalledPackView {
  return {
    id,
    version: "1.0.0",
    kind: "zim",
    title: { sr, en },
    description: { sr: "opis", en: "description" },
    licence: { spdx: "CC-BY-SA-4.0", attribution: "authors", url: "https://example.org" },
    source: { name: "Kiwix", url: "https://www.kiwix.org/" },
    notice: null,
    size: 1024,
    fileCount: 1,
    installedAt: 1,
  };
}

describe("pack copy", () => {
  it("reads a title in the language being served, without falling back", () => {
    const text = { sr: "Vikipedija", en: "Wikipedia" };
    expect(packText(text, "sr")).toBe("Vikipedija");
    expect(packText(text, "en")).toBe("Wikipedia");
  });
});

describe("the pack list's order", () => {
  it("sorts by the Serbian title, diacritics included", () => {
    // The whole reason `intl.ts` asks for `sr-Latn`: plain `"sr"` is the
    // Cyrillic tailoring, and "Čačak" would sort after "Šabac".
    const sorted = sortPacksByTitle(
      [
        pack("sabac", "Šabac", "Sabac"),
        pack("cvet", "Cvet", "Flower"),
        pack("sombor", "Sombor", "Sombor"),
        pack("cacak", "Čačak", "Cacak"),
      ],
      "sr",
    );
    expect(sorted.map((entry) => entry.id)).toEqual(["cvet", "cacak", "sombor", "sabac"]);
  });

  it("sorts by the English title when English is being served", () => {
    // The English titles put "Alpha" (id `b`) before "Zulu" (id `a`), which is
    // the opposite order from the Serbian titles — the whole point of sorting
    // by the copy being served rather than by the pack's id.
    const sorted = sortPacksByTitle(
      [pack("b", "Zvezda", "Alpha"), pack("a", "Alfa", "Zulu")],
      "en",
    );
    expect(sorted.map((entry) => entry.id)).toEqual(["b", "a"]);
  });
});

describe("pack sizes", () => {
  it("reads bytes whole and everything else with one decimal", () => {
    expect(formatPackSize(0)).toBe("0 B");
    expect(formatPackSize(1023)).toBe("1023 B");
    // A whole number keeps no decimal: `Intl.NumberFormat` drops the ",0", and
    // a size that reads "1 KB" is the size a user compares against the folder.
    expect(formatPackSize(1024)).toBe("1 KB");
    expect(formatPackSize(1536)).toMatch(/^1(,|\.)5 KB$/);
    expect(formatPackSize(2 * 1024 ** 3)).toBe("2 GB");
    expect(formatPackSize(5 * 1024 ** 4)).toBe("5 TB");
  });
});

/** A catalogue entry, with only the fields the grouping reads doing any work. */
function catalogueEntry(id: string, kind: PackKind, sr: string): PackCatalogueEntryView {
  return {
    id,
    version: "2026.10.0",
    kind,
    title: { sr, en: id },
    description: { sr: "opis", en: "description" },
    size: 1024,
    fileCount: 3,
    licence: { spdx: "CC-BY-SA-4.0", attribution: "authors", url: "https://example.org" },
    source: { name: "Kiwix", url: "https://www.kiwix.org/" },
    notice: null,
    state: "not-installed",
    installedVersion: null,
  };
}

describe("the catalogue's order", () => {
  it("groups by kind, and sorts the entries inside a group by the title being served", () => {
    const groups = groupCatalogueByKind(
      [
        catalogueEntry("map-sr", "map", "Mapa Srbije"),
        catalogueEntry("zim-b", "zim", "Beta"),
        catalogueEntry("zim-a", "zim", "Alfa"),
        catalogueEntry("map-bih", "map", "Mapa Bosne"),
      ],
      "sr",
    );
    expect(groups.map((group) => group.kind)).toEqual(["map", "zim"]);
    expect(groups[0]?.entries.map((entry) => entry.id)).toEqual(["map-bih", "map-sr"]);
    expect(groups[1]?.entries.map((entry) => entry.id)).toEqual(["zim-a", "zim-b"]);
  });

  it("draws no group for a kind the catalogue does not offer", () => {
    const groups = groupCatalogueByKind([catalogueEntry("zim-a", "zim", "Alfa")], "sr");
    expect(groups.map((group) => group.kind)).toEqual(["zim"]);
  });

  it("is empty when the catalogue is empty", () => {
    expect(groupCatalogueByKind([], "sr")).toEqual([]);
  });
});
