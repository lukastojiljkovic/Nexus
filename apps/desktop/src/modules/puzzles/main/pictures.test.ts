import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  NONOGRAM_PICTURES_PACK_ID,
  loadNonogramPictures,
  parseNonogramPictures,
  picturesFile,
} from "./pictures.js";

/**
 * The nonogram pictures reader.
 *
 * A pack arrives from outside this machine, so what is pinned here is what the
 * reader keeps: the layout number this build reads, a picture whose size, rows
 * or text does not hold together is dropped rather than drawn, a duplicate id
 * keeps the first, and a file the signed manifest does not list is never opened.
 * The signature check and the bounded read are the shell's and have their own
 * suite; this file owns the translation from the file into the view the page
 * plays.
 */

const GOOD = {
  id: "10-carl-olsen-flame",
  size: 10,
  rows: [
    "0000010000",
    "0000111000",
    "0001111100",
    "0011111110",
    "0111111111",
    "1111111111",
    "0111111110",
    "0011111100",
    "0001111000",
    "0000010000",
  ],
  title: { en: "Flame", sr: "Plamen" },
  author: "Carl Olsen",
  source: "icons-master/carl-olsen/flame.svg",
};

describe("parseNonogramPictures", () => {
  it("keeps a valid picture as the view the page plays, without its source path", () => {
    const view = parseNonogramPictures({ format: 1, puzzles: [GOOD] });
    expect(view).toEqual({
      pictures: [
        {
          id: GOOD.id,
          size: 10,
          rows: GOOD.rows,
          title: { en: "Flame", sr: "Plamen" },
          author: "Carl Olsen",
        },
      ],
    });
  });

  it("refuses a document of another layout, whole", () => {
    for (const refused of [
      null,
      [],
      { puzzles: [GOOD] },
      { format: 2, puzzles: [GOOD] },
      { format: "1", puzzles: [GOOD] },
    ]) {
      expect(parseNonogramPictures(refused), JSON.stringify(refused)).toBeNull();
    }
  });

  it("drops each picture that fails a check, and keeps the rest", () => {
    const bad = [
      { ...GOOD, id: "10-Carl-Olsen-Flame" },
      { ...GOOD, id: "4-flame" },
      { ...GOOD, size: 4 },
      { ...GOOD, size: 21 },
      { ...GOOD, size: 10.5 },
      { ...GOOD, rows: GOOD.rows.slice(1) },
      { ...GOOD, rows: [...GOOD.rows.slice(1), "000001000x"] },
      { ...GOOD, rows: [...GOOD.rows.slice(1), "000001000"] },
      { ...GOOD, title: { en: "Flame" } },
      { ...GOOD, title: { en: "   ", sr: "Plamen" } },
      { ...GOOD, title: { en: "F".repeat(81), sr: "Plamen" } },
      { ...GOOD, author: "" },
      { ...GOOD, author: 7 },
    ];
    const view = parseNonogramPictures({ format: 1, puzzles: [...bad, GOOD] });
    expect(view?.pictures.map((picture) => picture.id)).toEqual([GOOD.id]);
  });

  it("keeps the first of two pictures with one id", () => {
    const second = { ...GOOD, title: { en: "Second", sr: "Drugi" } };
    const view = parseNonogramPictures({ format: 1, puzzles: [GOOD, second] });
    expect(view?.pictures.map((picture) => picture.title.en)).toEqual(["Flame"]);
  });

  it("answers null for a pack that carries no valid picture", () => {
    expect(parseNonogramPictures({ format: 1, puzzles: [] })).toBeNull();
    expect(parseNonogramPictures({ format: 1, puzzles: [{ ...GOOD, size: 4 }] })).toBeNull();
    expect(parseNonogramPictures({ format: 1 })).toBeNull();
  });
});

describe("picturesFile", () => {
  it("finds the file by its last path segment, the shallowest one first", () => {
    expect(
      picturesFile({
        files: [{ path: "data/deep/nonograms.json" }, { path: "nonograms.json" }],
      }),
    ).toBe("nonograms.json");
    expect(picturesFile({ files: [{ path: "data/nonograms.json" }] })).toBe("data/nonograms.json");
  });

  it("answers null for a manifest that does not list the file, or lists an unsafe path", () => {
    expect(picturesFile({ files: [{ path: "images/flame.svg" }] })).toBeNull();
    expect(picturesFile({ files: [{ path: "../nonograms.json" }] })).toBeNull();
  });
});

describe("loadNonogramPictures", () => {
  it("answers null when no pack is installed", async () => {
    // A directory that does not exist: the registry answers an empty index for
    // a missing packs root, so nothing is read and nothing is created.
    const userData = join(tmpdir(), `nexus-nonograms-absent-${String(Date.now())}`);
    expect(await loadNonogramPictures(userData, "not-a-key")).toBeNull();
    expect(NONOGRAM_PICTURES_PACK_ID).toBe("nonograms-pictures");
  });
});
