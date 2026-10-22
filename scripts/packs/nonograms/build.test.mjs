import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { checkMeta } from "../../pack-sign.mjs";
import {
  FILL_MAX,
  FILL_MIN,
  PACK_ID,
  buildMetadata,
  evaluate,
  iconsOf,
  keepable,
  parseAuthors,
  rowsOf,
  selectPuzzles,
  stripBackground,
} from "./build.mjs";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const fixture = (name) => readFileSync(join(FIXTURES, name), "utf8");

/** A candidate as `selectPuzzles` receives it, judged at the given sizes only. */
async function candidate(folder, name, svg, sizes = [10]) {
  const stripped = stripBackground(svg).svg;
  const evaluations = new Map();
  for (const size of sizes) evaluations.set(size, await evaluate(stripped, size));
  return {
    icon: { id: `${folder}/${name}`, folder, name, author: `Author ${folder}`, path: `icons-master/${folder}/${name}.svg` },
    title: { en: `Title ${name}`, sr: `Naslov ${name}` },
    evaluations,
  };
}

describe("stripBackground", () => {
  it("removes the rectangle that covers the viewBox and keeps the icon", () => {
    const { svg, removed } = stripBackground(fixture("square.svg"));
    expect(removed).toBe(1);
    expect(svg).not.toContain("M0 0h100v100H0z");
    expect(svg).toContain("M20 20h60v60H20z");
  });

  it("keeps a square that is smaller than the viewBox", () => {
    const smaller = '<svg viewBox="0 0 100 100"><path d="M0 0h50v50H0z"/></svg>';
    expect(stripBackground(smaller)).toEqual({ svg: smaller, removed: 0 });
  });
});

describe("evaluate", () => {
  it("rasterises a square into the cells it covers at least half of", async () => {
    const { cells, fill, solved } = await evaluate(stripBackground(fixture("square.svg")).svg, 10);
    expect(rowsOf(cells, 10)).toEqual([
      "0000000000",
      "0000000000",
      "0011111100",
      "0011111100",
      "0011111100",
      "0011111100",
      "0011111100",
      "0011111100",
      "0000000000",
      "0000000000",
    ]);
    expect(fill).toBeCloseTo(0.36, 10);
    expect(solved).toBe(true);
  });

  it("finds a checkerboard unsolvable by line propagation, though its fill is in bounds", async () => {
    const judged = await evaluate(stripBackground(fixture("checkerboard.svg")).svg, 10);
    expect(judged.fill).toBe(0.5);
    expect(judged.solved).toBe(false);
  });
});

describe("keepable", () => {
  it("keeps a solvable grid whose fill is within the bounds, and nothing else", () => {
    expect(keepable({ solved: true, fill: (FILL_MIN + FILL_MAX) / 2 })).toBe(true);
    expect(keepable({ solved: true, fill: FILL_MIN / 2 })).toBe(false);
    expect(keepable({ solved: true, fill: FILL_MAX + 0.01 })).toBe(false);
    expect(keepable({ solved: false, fill: 0.3 })).toBe(false);
  });
});

describe("licence and archive reading", () => {
  const licence = [
    "Icons provided under the Creative Commons 3.0 BY or CC0 if mentioned below.",
    "",
    "- Lorc, http://lorcblog.blogspot.com",
    "- Zeromancer - CC0",
    "- Viscious Speed, http://viscious-speed.deviantart.com - CC0",
    "- Caro Asercion",
  ].join("\n");

  it("parses the contributors and marks the CC0 ones", () => {
    const authors = parseAuthors(licence);
    expect(authors.get("lorc")).toEqual({ name: "Lorc", cc0: false });
    expect(authors.get("zeromancer")).toEqual({ name: "Zeromancer", cc0: true });
    expect(authors.get("visciousspeed")).toEqual({ name: "Viscious Speed", cc0: true });
    expect(authors.get("caroasercion")).toEqual({ name: "Caro Asercion", cc0: false });
  });

  it("lists only icons of CC BY authors, sorted by id", () => {
    const entries = new Map(
      [
        "icons-master/lorc/sword.svg",
        "icons-master/caro-asercion/cat.svg",
        "icons-master/zeromancer/zed.svg",
        "icons-master/badges/medal.svg",
        "icons-master/README.md",
      ].map((name) => [name, Buffer.alloc(0)]),
    );
    expect(iconsOf(entries, parseAuthors(licence)).map((icon) => icon.id)).toEqual([
      "caro-asercion/cat",
      "lorc/sword",
    ]);
  });
});

describe("selectPuzzles", () => {
  it("drops an unsolvable picture and keeps a solvable one, with the puzzle shape the app reads", async () => {
    const candidates = [
      await candidate("delapouite", "square", fixture("square.svg")),
      await candidate("lorc", "checker", fixture("checkerboard.svg")),
    ];
    const puzzles = selectPuzzles(candidates, 5);
    expect(puzzles).toHaveLength(1);
    expect(puzzles[0]).toEqual({
      id: "10-delapouite-square",
      size: 10,
      rows: rowsOf((await evaluate(stripBackground(fixture("square.svg")).svg, 10)).cells, 10),
      title: { en: "Title square", sr: "Naslov square" },
      author: "Author delapouite",
      source: "icons-master/delapouite/square.svg",
    });
  });

  it("ships one picture per name stem, so castle and castle-tower never both appear", async () => {
    const candidates = [
      await candidate("lorc", "castle", fixture("square.svg")),
      await candidate("delapouite", "castle-tower", fixture("square.svg")),
    ];
    expect(selectPuzzles(candidates, 5).map((puzzle) => puzzle.title.en)).toEqual(["Title castle-tower"]);
  });

  it("caps each size, taking the authors in turn", async () => {
    const candidates = [
      await candidate("lorc", "ship", fixture("square.svg")),
      await candidate("delapouite", "cat", fixture("square.svg")),
    ];
    expect(selectPuzzles(candidates, 1).map((puzzle) => puzzle.id)).toEqual(["10-delapouite-cat"]);
  });
});

describe("output", () => {

  it("writes metadata that the signing tool accepts, under the CC BY 3.0 licence", () => {
    const metadata = buildMetadata(["Lorc", "Delapouite"]);
    expect(() => checkMeta(metadata)).not.toThrow();
    expect(metadata).toMatchObject({ id: PACK_ID, kind: "dataset", minAppVersion: "2.5.0" });
    expect(metadata.licence.spdx).toBe("CC-BY-3.0");
  });
});
