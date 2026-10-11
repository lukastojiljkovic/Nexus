import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ContentPack } from "./catalog.js";
import { READER_INDEX_FORMAT, createReaderIndexStore } from "./searchIndex.js";

/**
 * The search index and its cache (ADR-100).
 *
 * The three properties are the promises the ADR makes: the index is built ONCE
 * PER INSTALLED PACK VERSION into the profile's cache, it reports progress while
 * it builds, and a later read is answered from the cache without the pack's bytes
 * being there at all. No signature is involved: this layer reads a folder the
 * packs layer has already verified, so the fixture is a plain directory.
 */

let root: string;
let packDir: string;
const PROFILE = "profile-1";

function pack(): ContentPack {
  return {
    id: "prva-pomoc",
    version: "1.0.0",
    dir: packDir,
    manifest: {
      format: 1,
      id: "prva-pomoc",
      version: "1.0.0",
      kind: "content",
      title: { sr: "Knjiga", en: "Book" },
      description: { sr: "Opis.", en: "Description." },
      files: [
        { path: "uvod.md", size: 0, sha256: "0".repeat(64) },
        { path: "opekotine.md", size: 0, sha256: "0".repeat(64) },
        { path: "slika.png", size: 0, sha256: "0".repeat(64) },
      ],
      licence: { spdx: "CC0-1.0", attribution: "Niko", url: "https://example.org/l" },
      source: { name: "Izvor", url: "https://example.org/s" },
      minAppVersion: "1.0.0",
      notice: null,
    },
    size: 0,
    fileCount: 2,
    installedAt: 0,
  };
}

/** Waits for a build to finish, the way the page polls. */
async function settle(store: ReturnType<typeof createReaderIndexStore>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const view = store.ensure(PROFILE, pack());
    if (view.state !== "building") return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("the index never finished building");
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "nexus-reader-index-"));
  packDir = join(root, "packs", "prva-pomoc", "1.0.0");
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, "uvod.md"),
    "# Voda i elektroliti\n\nTelo bez vode ne izdrži dugo.\n",
    "utf8",
  );
  writeFileSync(join(packDir, "opekotine.md"), "# Opekotine\n\nHladi vodom.\n", "utf8");
  // A listed file that is NOT an article: it must never reach the index.
  writeFileSync(join(packDir, "slika.png"), "nije-slika", "utf8");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the reader index", () => {
  it("indexes the pack's articles with their own titles, and nothing else", async () => {
    const store = createReaderIndexStore({ userData: root });
    const building = store.ensure(PROFILE, pack());
    expect(building.state).toBe("building");
    // Two articles and one image: the total counts what will be READ, so the
    // progress a page draws is not diluted by files that are not pages.
    expect(building.articlesTotal).toBe(2);

    await settle(store);

    expect(store.articles(PROFILE, "prva-pomoc")).toEqual([
      {
        path: "uvod.md",
        title: "Voda i elektroliti",
        text: "Voda i elektroliti\n\nTelo bez vode ne izdrži dugo.",
      },
      { path: "opekotine.md", title: "Opekotine", text: "Opekotine\n\nHladi vodom." },
    ]);
  });

  it("writes the index into the profile's cache, once per installed version", async () => {
    const store = createReaderIndexStore({ userData: root });
    await settle(store);

    const file = join(root, "reader-cache", PROFILE, "prva-pomoc", "1.0.0.json");
    expect(existsSync(file)).toBe(true);
    const written = JSON.parse(readFileSync(file, "utf8")) as {
      version: number;
      packId: string;
      packVersion: string;
      articles: unknown[];
    };
    expect(written.version).toBe(READER_INDEX_FORMAT);
    expect(written.packId).toBe("prva-pomoc");
    expect(written.packVersion).toBe("1.0.0");
    expect(written.articles).toHaveLength(2);
  });

  it("answers a later read from the cache, with the pack's own bytes gone", async () => {
    const store = createReaderIndexStore({ userData: root });
    await settle(store);
    rmSync(join(packDir, "uvod.md"));

    // A SECOND store instance, which is what a new session is: it finds the cache
    // and never touches the file that is now missing.
    const fresh = createReaderIndexStore({ userData: root });
    const view = fresh.ensure(PROFILE, pack());
    expect(view.state).toBe("ready");
    expect(view.articlesDone).toBe(2);
    expect(fresh.articles(PROFILE, "prva-pomoc")?.[0]?.title).toBe("Voda i elektroliti");

    // The file goes back, so the case below starts from a whole pack: this suite is
    // about the cache, not about a broken install.
    writeFileSync(
      join(packDir, "uvod.md"),
      "# Voda i elektroliti\n\nTelo bez vode ne izdrži dugo.\n",
      "utf8",
    );
  });

  it("searches the packs it is given, and names the ones it could not reach yet", () => {
    const store = createReaderIndexStore({ userData: root });
    // A profile of its own: the two cases above have already filled PROFILE's cache,
    // and this one is about a pack whose index does not exist yet.
    const { packs, pending } = store.searchable("profile-2", [pack()]);
    // A pack whose index has not been built is PENDING, not empty: a query must be
    // able to say "not yet" rather than answer nothing.
    expect(packs).toEqual([]);
    expect(pending).toEqual(["prva-pomoc"]);
  });
});
