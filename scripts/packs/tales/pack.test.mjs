import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assemblePack, articleFile, checkPackShape, writeMeta } from "./pack.mjs";
import { PACK_IDS, packMeta, pageUrl, parseArgs } from "./build.mjs";

/**
 * The pack folder itself: the layout ADR-091's `content` kind describes, and the
 * checks the builder runs against its own output.
 *
 * The articles here are two lines of invented text, because what is under test
 * is the folder and not a tale; every rule of the layout that can be broken is
 * broken below, one per case, and the check has to say which one it was.
 */

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tales-pack-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function pack(outDir = join(root, "tales-en")) {
  return assemblePack({
    id: "tales-en",
    language: "en",
    outDir,
    collections: [
      {
        id: "grimm-5314",
        title: "Household Tales by Brothers Grimm",
        source: { title: "Household Tales", url: "https://www.gutenberg.org/ebooks/5314" },
        articles: [
          {
            id: "grimm-5314-the-frog-king",
            title: "1 The Frog-King, or Iron Henry",
            markdown: "# 1 The Frog-King, or Iron Henry\n\nIn old times, when wishing still helped one.\n",
            source: { title: "Household Tales", url: "https://www.gutenberg.org/ebooks/5314" },
            sourceLine: "*Source:* Household Tales by Brothers Grimm — Project Gutenberg eBook #5314",
          },
          {
            id: "grimm-5314-cat-and-mouse",
            title: "2 Cat and Mouse in Partnership",
            markdown: "# 2 Cat and Mouse in Partnership\n\nA cat and a mouse once lived together.\n",
            source: { title: "Household Tales", url: "https://www.gutenberg.org/ebooks/5314" },
            sourceLine: "*Source:* Household Tales by Brothers Grimm — Project Gutenberg eBook #5314",
          },
        ],
      },
    ],
  });
}

describe("assembling a pack", () => {
  it("writes content.json and one article per tale", () => {
    const built = pack();
    expect(built.articles).toBe(2);
    expect(built.files.map((file) => file.path)).toEqual([
      "content.json",
      "articles/grimm-5314-the-frog-king.md",
      "articles/grimm-5314-cat-and-mouse.md",
    ]);
    const content = JSON.parse(readFileSync(join(root, "tales-en", "content.json"), "utf8"));
    expect(content.layout).toBe(1);
    expect(content.language).toBe("en");
    expect(content.notice).toBeUndefined();
    expect(content.toc[0].children[0].file).toBe("articles/grimm-5314-the-frog-king.md");
    expect(() => checkPackShape(join(root, "tales-en"))).not.toThrow();
  });

  it("rebuilds from nothing, so a corrected list cannot leave a stale article", () => {
    const outDir = join(root, "tales-en");
    pack(outDir);
    const stale = join(outDir, "articles", "grimm-5314-the-frog-king.md");
    expect(readFileSync(stale, "utf8")).toContain("wishing still helped one");
    assemblePack({
      id: "tales-en",
      language: "en",
      outDir,
      collections: [{ id: "grimm-5314", title: "t", articles: [] }],
    });
    expect(() => readFileSync(stale, "utf8")).toThrow();
  });

  it("refuses to write a pack into a folder that is not that pack's own", () => {
    expect(() => pack(join(root, "elsewhere"))).toThrow(/refusing to write/);
  });
});

describe("what the layout check refuses", () => {
  it("an id that is not kebab-case, and an id used twice", () => {
    const outDir = join(root, "tales-en");
    pack(outDir);
    expect(checkPackShape(outDir).articles).toBe(2);
    const content = JSON.parse(readFileSync(join(outDir, "content.json"), "utf8"));
    content.toc[0].children[1].id = content.toc[0].children[0].id;
    writeFileSync(join(outDir, "content.json"), JSON.stringify(content));
    expect(() => checkPackShape(outDir)).toThrow(/repeats/);
  });

  it("a file listed in the contents that is not on disk", () => {
    const outDir = join(root, "tales-en");
    pack(outDir);
    rmSync(join(outDir, "articles", "grimm-5314-cat-and-mouse.md"));
    expect(() => checkPackShape(outDir)).toThrow(/is missing/);
  });

  it("an article that carries raw HTML, or that lost its Source line", () => {
    const outDir = join(root, "tales-en");
    pack(outDir);
    const article = join(outDir, "articles", "grimm-5314-cat-and-mouse.md");
    writeFileSync(article, "# 2 Cat and Mouse in Partnership\n\nA <b>cat</b> and a mouse.\n");
    expect(() => checkPackShape(outDir)).toThrow(/raw HTML/);
    writeFileSync(article, "# 2 Cat and Mouse in Partnership\n\nA cat and a mouse.\n");
    expect(() => checkPackShape(outDir)).toThrow(/Source line/);
  });

  it("an article whose file name is not its id, and a file nobody listed", () => {
    const outDir = join(root, "tales-en");
    pack(outDir);
    writeFileSync(join(outDir, "articles", "orphan.md"), "# nothing\n");
    expect(() => checkPackShape(outDir)).toThrow(/orphan.md is not listed/);
  });
});

describe("the article wrapper", () => {
  it("puts the title first and the Source line last", () => {
    const text = articleFile({ title: "T", markdown: "body", sourceLine: "*Source:* somewhere" });
    expect(text.split("\n")[0]).toBe("# T");
    expect(text.trimEnd().split("\n").at(-1)).toBe("*Source:* somewhere");
  });
});

describe("the pack metadata", () => {
  it("carries both languages of copy, a licence and the app floor", () => {
    for (const id of PACK_IDS) {
      const meta = packMeta(id);
      expect(meta.format).toBe(1);
      expect(meta.kind).toBe("content");
      expect(meta.minAppVersion).toBe("1.5.0");
      expect(meta.title.sr.length).toBeGreaterThan(0);
      expect(meta.title.en.length).toBeGreaterThan(0);
      expect(meta.description.sr.length).toBeGreaterThan(0);
      expect(meta.description.en.length).toBeGreaterThan(0);
      expect(meta.licence.spdx.length).toBeGreaterThan(0);
      expect(meta.licence.url).toMatch(/^https:\/\//);
      expect(Object.hasOwn(meta, "files")).toBe(false);
    }
    expect(packMeta("tales-sr").licence.spdx).toBe("CC-BY-SA-4.0");
    expect(packMeta("tales-en").licence.spdx).toBe("LicenseRef-Public-Domain");
  });

  it("is written where pack-sign.mjs is told to look for it", () => {
    const file = writeMeta({ outDir: join(root, "tales-sr"), meta: packMeta("tales-sr") });
    expect(JSON.parse(readFileSync(file, "utf8")).id).toBe("tales-sr");
  });
});

describe("the command line", () => {
  it("defaults to both packs and reads what it is told", () => {
    expect(parseArgs([]).packs).toEqual(PACK_IDS);
    expect(parseArgs(["--pack", "tales-sr"]).packs).toEqual(["tales-sr"]);
    expect(parseArgs(["--pack", "all", "--offline"]).offline).toBe(true);
  });

  it("refuses a flag it does not know and a pack that does not exist", () => {
    expect(() => parseArgs(["--pak", "tales-sr"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--pack", "grimm"])).toThrow(/no pack called/);
    expect(() => parseArgs(["--out"])).toThrow(/--out needs a value/);
  });
});

describe("page urls", () => {
  it("keeps the wiki's own underscore form", () => {
    expect(pageUrl("Еро и кадија")).toBe(
      "https://sr.wikisource.org/wiki/%D0%95%D1%80%D0%BE_%D0%B8_%D0%BA%D0%B0%D0%B4%D0%B8%D1%98%D0%B0",
    );
  });
});
