import { describe, expect, it } from "vitest";

import type { InstalledPackView } from "../../shared/ipc.js";
import { formatPackSize, packText, sortPacksByTitle } from "./packsView.js";

function pack(id: string, sr: string, en: string): InstalledPackView {
  return {
    id,
    version: "1.0.0",
    kind: "zim",
    title: { sr, en },
    description: { sr: "opis", en: "description" },
    licence: { spdx: "CC-BY-SA-4.0", attribution: "authors", url: "https://example.org" },
    source: { name: "Kiwix", url: "https://www.kiwix.org/" },
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
