import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseManifest, entry, makeKey, writePack } from "../../../main/packs/fixtures.js";
import { packsRoot, readInstalled, type InstalledPack } from "../../../main/packs/registry.js";
import {
  LIBRARY_COLLECTIONS_FILE,
  LIBRARY_MAX_COLLECTIONS_BYTES,
  parsePackCollections,
  readPackCollections,
  suggestedCollectionId,
  suggestedCollectionOf,
  suggestionViewOf,
} from "./packCollections.js";

/**
 * The pack-to-store half of the module: the layout a `dataset` pack's
 * `collections.json` is written in, what this build refuses to read, and the
 * translation into the shape the library store adopts.
 *
 * The parser tests assert exact values, because "it did not throw" says nothing
 * about whether a title survived or a null became a zero. The reader tests drive
 * a REAL pack folder - written by the same fixture builder the packs suite uses,
 * signed with a throwaway key and listed by `readInstalled` - so the path
 * arithmetic, the manifest's own size claim and the `dataset` filter are all
 * exercised rather than assumed.
 */

/** A valid layout-1 file, written by hand: one collection of two works, one of them English-only and id-less. */
function fixtureCollections(): unknown {
  return {
    layout: 1,
    collections: [
      {
        id: "sr-classics",
        title: { sr: "Srpski klasici", en: "Serbian classics" },
        description: { sr: "Dela iz obavezne lektire.", en: "Set reading." },
        items: [
          {
            type: "book",
            title: { sr: "Na Drini ćuprija", en: "The Bridge on the Drina" },
            year: 1945,
            creators: ["Ivo Andrić"],
            wikidata: "Q1138351",
          },
          { type: "film", title: { en: "Who's Singin' Over There?" }, year: 1980 },
        ],
      },
      {
        id: "short-list",
        title: { sr: "Kratka lista", en: "A short list" },
        small: true,
        items: [{ type: "series", title: { sr: "Otpisani" } }],
      },
    ],
  };
}

describe("parsePackCollections", () => {
  it("reads a valid file into canonical collections, keeping the languages that are there", () => {
    const parsed = parsePackCollections(fixtureCollections());
    expect(parsed).toHaveLength(2);
    expect(parsed?.[0]).toEqual({
      id: "sr-classics",
      title: { sr: "Srpski klasici", en: "Serbian classics" },
      description: { sr: "Dela iz obavezne lektire.", en: "Set reading." },
      small: false,
      items: [
        {
          kind: "book",
          title: { sr: "Na Drini ćuprija", en: "The Bridge on the Drina" },
          year: 1945,
          creators: ["Ivo Andrić"],
          wikidataId: "Q1138351",
        },
        {
          kind: "film",
          title: { sr: null, en: "Who's Singin' Over There?" },
          year: 1980,
          creators: [],
          wikidataId: null,
        },
      ],
    });
    // `small: true` is the layout's own marker, and a collection that omits it
    // is not small rather than "unknown".
    expect(parsed?.[1]?.small).toBe(true);
    expect(parsed?.[1]?.description).toBeNull();
  });

  it("refuses a layout this build does not read, and a value with no collections", () => {
    expect(parsePackCollections({ layout: 2, collections: [] })).toBeNull();
    expect(parsePackCollections({ collections: [] })).toBeNull();
    expect(parsePackCollections({ layout: 1 })).toBeNull();
    expect(parsePackCollections(null)).toBeNull();
    expect(parsePackCollections([])).toBeNull();
  });

  it("accepts an empty list of collections, which is a pack with nothing to offer", () => {
    expect(parsePackCollections({ layout: 1, collections: [] })).toEqual([]);
  });

  it("refuses an unknown key anywhere, because the layout is versioned", () => {
    const top = fixtureCollections() as Record<string, unknown>;
    top["source"] = "Wikidata";
    expect(parsePackCollections(top)).toBeNull();

    const collection = fixtureCollections() as { collections: Record<string, unknown>[] };
    collection.collections[0]!["ranking"] = 1;
    expect(parsePackCollections(collection)).toBeNull();

    const item = fixtureCollections() as { collections: { items: Record<string, unknown>[] }[] };
    item.collections[0]!.items[0]!["isbn"] = "978-86-...";
    expect(parsePackCollections(item)).toBeNull();
  });

  it("refuses a collection whose title is missing a language, and one with no works", () => {
    const missing = fixtureCollections() as { collections: Record<string, unknown>[] };
    missing.collections[0]!["title"] = { sr: "Samo srpski" };
    expect(parsePackCollections(missing)).toBeNull();

    const empty = fixtureCollections() as { collections: Record<string, unknown>[] };
    empty.collections[0]!["items"] = [];
    expect(parsePackCollections(empty)).toBeNull();
  });

  it("refuses an item with no title in either language, a bad type and a bad year", () => {
    const noTitle = fixtureCollections() as { collections: { items: Record<string, unknown>[] }[] };
    noTitle.collections[0]!.items[0]!["title"] = {};
    expect(parsePackCollections(noTitle)).toBeNull();

    const badType = fixtureCollections() as { collections: { items: Record<string, unknown>[] }[] };
    badType.collections[0]!.items[0]!["type"] = "podcast";
    expect(parsePackCollections(badType)).toBeNull();

    const badYear = fixtureCollections() as { collections: { items: Record<string, unknown>[] }[] };
    badYear.collections[0]!.items[0]!["year"] = 1945.5;
    expect(parsePackCollections(badYear)).toBeNull();
  });

  it("refuses a wikidata that is not a Q-id, and two collections sharing one id", () => {
    const slug = fixtureCollections() as { collections: { items: Record<string, unknown>[] }[] };
    slug.collections[0]!.items[0]!["wikidata"] = "the-bridge";
    expect(parsePackCollections(slug)).toBeNull();

    const twice = fixtureCollections() as { collections: unknown[] };
    twice.collections[1] = { ...(twice.collections[0] as Record<string, unknown>) };
    expect(parsePackCollections(twice)).toBeNull();
  });

  it("refuses `small` spelled as anything but true", () => {
    const falsy = fixtureCollections() as { collections: Record<string, unknown>[] };
    falsy.collections[1]!["small"] = false;
    expect(parsePackCollections(falsy)).toBeNull();
  });
});

describe("suggestedCollectionOf", () => {
  let dir: string;
  let key: ReturnType<typeof makeKey>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nexus-library-suggestion-"));
    key = makeKey();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** One installed `dataset` pack, as the registry lists it - the shape both `suggestedCollectionOf` and `suggestionViewOf` read. */
  function pack(): InstalledPack {
    // A manifest must list at least one file (`parsePackManifest`), so the pack
    // carries its own collections file even though this test reads only its
    // manifest identity.
    const text = JSON.stringify(fixtureCollections());
    writePack({
      dir: join(packsRoot(dir), "sr-classics-pack", "1.0.0"),
      key: key.privateKey,
      manifest: baseManifest([entry(LIBRARY_COLLECTIONS_FILE, text)], {
        id: "sr-classics-pack",
        kind: "dataset",
      }),
      contents: { [LIBRARY_COLLECTIONS_FILE]: text },
    });
    return readInstalled(dir, key.publicKeyPem)[0] as InstalledPack;
  }

  it("marks the list with the pack it came from, and credits that pack's source and licence", () => {
    const parsed = parsePackCollections(fixtureCollections());
    const suggestion = suggestedCollectionOf(pack(), parsed![0]!);
    expect(suggestion.id).toBe("libpack:sr-classics-pack:sr-classics");
    expect(suggestedCollectionId("sr-classics-pack", "sr-classics")).toBe(suggestion.id);
    expect(suggestion.title).toEqual({ sr: "Srpski klasici", en: "Serbian classics" });
    expect(suggestion.source).toBe("Kiwix");
    expect(suggestion.licence).toBe("CC-BY-SA-4.0");
  });

  it("mirrors a one-language item title into both halves, and leaves an absent id out", () => {
    const parsed = parsePackCollections(fixtureCollections());
    const suggestion = suggestedCollectionOf(pack(), parsed![0]!);
    expect(suggestion.items[0]).toEqual({
      wikidataId: "Q1138351",
      kind: "book",
      title: { sr: "Na Drini ćuprija", en: "The Bridge on the Drina" },
      year: 1945,
      creators: ["Ivo Andrić"],
    });
    // The English-only film: the Serbian half carries the only title there is,
    // and the optional keys are ABSENT rather than null (the store's own shape).
    expect(suggestion.items[1]).toEqual({
      kind: "film",
      title: { sr: "Who's Singin' Over There?", en: "Who's Singin' Over There?" },
      year: 1980,
    });
    expect(Object.hasOwn(suggestion.items[1] ?? {}, "creators")).toBe(false);
  });
});

describe("suggestionViewOf", () => {
  it("carries the small flag, the attribution and the adopted mark the page draws", () => {
    const key = makeKey();
    const dir = mkdtempSync(join(tmpdir(), "nexus-library-view-"));
    try {
      const text = JSON.stringify(fixtureCollections());
      writePack({
        dir: join(packsRoot(dir), "sr-classics-pack", "1.0.0"),
        key: key.privateKey,
        manifest: {
          ...baseManifest([entry(LIBRARY_COLLECTIONS_FILE, text)], {
            id: "sr-classics-pack",
            kind: "dataset",
          }),
          kind: "dataset",
        },
        contents: { [LIBRARY_COLLECTIONS_FILE]: text },
      });
      const installed = readInstalled(dir, key.publicKeyPem)[0] as InstalledPack;
      const parsed = parsePackCollections(fixtureCollections());
      const view = suggestionViewOf(installed, parsed![1]!, true);
      expect(view).toMatchObject({
        packId: "sr-classics-pack",
        packVersion: "1.0.0",
        collectionId: "short-list",
        small: true,
        adopted: true,
        source: "Kiwix",
        licence: "CC-BY-SA-4.0",
      });
      expect(view.title).toEqual({ sr: "Kratka lista", en: "A short list" });
      expect(view.items).toEqual([
        {
          kind: "series",
          title: { sr: "Otpisani", en: null },
          year: null,
          creators: [],
          wikidataId: null,
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readPackCollections", () => {
  let dir: string;
  let publicKeyPem: string;
  let privateKey: ReturnType<typeof makeKey>["privateKey"];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nexus-library-pack-"));
    const key = makeKey();
    publicKeyPem = key.publicKeyPem;
    privateKey = key.privateKey;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Installs one pack folder under `<dir>/packs/<id>/<version>`, exactly as an install leaves it. */
  function install(id: string, manifest: Record<string, unknown>, contents: Record<string, string>): void {
    writePack({
      dir: join(packsRoot(dir), id, "1.0.0"),
      key: privateKey,
      manifest,
      contents,
    });
  }

  function installed(): InstalledPack[] {
    return readInstalled(dir, publicKeyPem);
  }

  it("reads a `dataset` pack's collections file", async () => {
    const text = JSON.stringify(fixtureCollections());
    install(
      "sr-classics-pack",
      {
        ...baseManifest([entry(LIBRARY_COLLECTIONS_FILE, text)], {
          id: "sr-classics-pack",
          kind: "dataset",
        }),
      },
      { [LIBRARY_COLLECTIONS_FILE]: text },
    );

    const collections = await readPackCollections(dir, installed()[0] as InstalledPack);
    expect(collections?.map((collection) => collection.id)).toEqual(["sr-classics", "short-list"]);
  });

  it("answers null for a pack of another kind, one that lists no list file, and one that is not installed", async () => {
    const text = JSON.stringify(fixtureCollections());
    install(
      "a-zim-pack",
      baseManifest([entry(LIBRARY_COLLECTIONS_FILE, text)], { id: "a-zim-pack" }),
      { [LIBRARY_COLLECTIONS_FILE]: text },
    );
    expect(await readPackCollections(dir, installed()[0] as InstalledPack)).toBeNull();

    // A `dataset` pack that simply carries no lists file: it lists some other
    // file, which is what makes its manifest one this build accepts at all.
    install(
      "an-empty-dataset",
      baseManifest([entry("data/notes.txt", "nothing here")], {
        id: "an-empty-dataset",
        kind: "dataset",
      }),
      { "data/notes.txt": "nothing here" },
    );
    const emptyDataset = installed().find((pack) => pack.manifest.id === "an-empty-dataset");
    expect(await readPackCollections(dir, emptyDataset as InstalledPack)).toBeNull();
  });

  it("refuses a file whose bytes are not the size the signed manifest claims", async () => {
    // The reader does not re-hash a pack (that is the Packs card's own Verify),
    // so the manifest's signed SIZE is the one claim it can check for free - and
    // a file that grew or shrank after signing is exactly what it catches.
    const text = JSON.stringify(fixtureCollections());
    const manifest = baseManifest([entry(LIBRARY_COLLECTIONS_FILE, text)], {
      id: "tampered",
      kind: "dataset",
    });
    install("tampered", manifest, { [LIBRARY_COLLECTIONS_FILE]: `${text} ` });

    expect(await readPackCollections(dir, installed()[0] as InstalledPack)).toBeNull();
  });

  it("refuses a file over the cap without reading it, and one that is not this layout", async () => {
    const huge = `{"layout":1,"collections":[]}`;
    install(
      "too-big",
      baseManifest(
        [
          {
            path: LIBRARY_COLLECTIONS_FILE,
            size: LIBRARY_MAX_COLLECTIONS_BYTES + 1,
            sha256: entry("collections.json", huge).sha256,
          },
        ],
        { id: "too-big", kind: "dataset" },
      ),
      { [LIBRARY_COLLECTIONS_FILE]: huge },
    );
    expect(await readPackCollections(dir, installed()[0] as InstalledPack)).toBeNull();

    const other = JSON.stringify({ layout: 2, collections: [] });
    install(
      "other-layout",
      baseManifest([entry(LIBRARY_COLLECTIONS_FILE, other)], { id: "other-layout", kind: "dataset" }),
      { [LIBRARY_COLLECTIONS_FILE]: other },
    );
    expect(await readPackCollections(dir, installed()[0] as InstalledPack)).toBeNull();
  });
});
