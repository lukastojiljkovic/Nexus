import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryStore, openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import { baseManifest, entry, makeKey, writePack } from "../../../main/packs/fixtures.js";
import { packsRoot, readInstalled, writeInstalled } from "../../../main/packs/registry.js";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import { LIBRARY_COLLECTIONS_FILE } from "./packCollections.js";
import { register } from "./register.js";

/**
 * BIBLIOTEKA through the kit (ADR-090): its ops, the refusals the wire owes, the
 * adoption of a pack's curated list, and its archive section.
 *
 * **Why these tests drive the HOST rather than calling the module directly.**
 * `register(host)` is the only entry point the discovery glue knows, and the
 * refusals, the sender check and the channel allowlist are all the host's. Going
 * through `dispatch` therefore tests what actually runs in the app - a typo in an
 * op name or a payload the validators refuse is a rejected promise here, not a
 * surprise on the first click.
 *
 * The clock is the harness's and the database is real (migrations and all), and
 * the PACKS are a real folder written by the same fixture builder the packs
 * suite uses: the adoption path reads a signed `collections.json` off disk
 * through the registry, which is the half of this module no unit test of the
 * parser can reach.
 */

const TRUSTED = { trusted: true };

let dir: string;
let packs: string;
let db: NexusDatabase;
let clock = Date.parse("2026-06-01T08:00:00.000Z");

/** The curated list the fixture pack carries: two collections, one of them offering a work the profile already logs. */
const PACK_COLLECTIONS = {
  layout: 1,
  collections: [
    {
      id: "sr-classics",
      title: { sr: "Srpski klasici", en: "Serbian classics" },
      items: [
        {
          type: "book",
          title: { sr: "Na Drini ćuprija", en: "The Bridge on the Drina" },
          year: 1945,
          creators: ["Ivo Andrić"],
          wikidata: "Q1000000001",
        },
        {
          type: "film",
          title: { sr: "Ko to tamo peva", en: "Who's Singin' Over There?" },
          year: 1980,
          wikidata: "Q1000000002",
        },
      ],
    },
    {
      id: "short-list",
      title: { sr: "Kratka lista", en: "A short list" },
      small: true,
      items: [{ type: "series", title: { sr: "Otpisani", en: "The Written Off" }, year: 1974 }],
    },
  ],
};

interface Harness {
  readonly host: ModuleHost;
}

function harness(): Harness {
  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => db.raw,
    notify: () => undefined,
    schedule: () => () => undefined,
    // The packs this process may read: one real `dataset` pack, installed the
    // way an install leaves it (`<userData>/packs/<id>/<version>`).
    packs: { userData: () => packs, publicKeyPem: publicKeyPem() },
    now: () => clock,
  };
  const host = new ModuleHost(platform);
  register(host);
  return { host };
}

/** The throwaway key the fixture pack is signed with, made once per test run. */
let key: ReturnType<typeof makeKey> | null = null;
function publicKeyPem(): string {
  key ??= makeKey();
  return key.publicKeyPem;
}

function createProfile(label = "P"): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", label, new Date(clock).toISOString());
  return id;
}

async function call<T>(host: ModuleHost, channel: string, payload: unknown): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

/** The view's shape, narrowed to what an assertion needs. */
interface View {
  readonly items: {
    id: string;
    kind: string;
    title: string;
    status: string;
    rating: number | null;
    year: number | null;
    pagesRead: number | null;
    passes: { id: string; seq: number; startedOn: string | null; finishedOn: string | null }[];
    thoughts: { id: string; entryDate: string; text: string }[];
  }[];
  readonly collections: {
    id: string;
    name: string;
    description: string | null;
    suggestedId: string | null;
    progress: { done: number; total: number };
    itemIds: string[];
  }[];
  readonly suggestions: {
    packId: string;
    collectionId: string;
    title: { sr: string; en: string };
    small: boolean;
    adopted: boolean;
    items: unknown[];
  }[];
}

function list(host: ModuleHost, profileId: string): Promise<View> {
  return call<View>(host, "library:list", { profileId });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-library-module-"));
  packs = join(dir, "userData");
  const text = JSON.stringify(PACK_COLLECTIONS);
  const packKey = makeKey();
  key = packKey;
  writePack({
    dir: join(packsRoot(packs), "sr-classics-pack", "1.0.0"),
    key: packKey.privateKey,
    manifest: {
      ...baseManifest([entry(LIBRARY_COLLECTIONS_FILE, text)], {
        id: "sr-classics-pack",
        kind: "dataset",
        title: { sr: "Srpski klasici", en: "Serbian classics" },
      }),
    },
    contents: { [LIBRARY_COLLECTIONS_FILE]: text },
  });
  // The packs index, written the way every install and removal ends: without it
  // every read of the module's view would rebuild the index from disk and
  // re-verify a signature, which is the read path an install already shortens.
  writeInstalled(packs, readInstalled(packs, packKey.publicKeyPem));
  db = openDatabase({ path: join(dir, "library.db") });
  clock = Date.parse("2026-06-01T08:00:00.000Z");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the library handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    const { host } = harness();
    expect(host.channels()).toEqual([
      "library:list",
      "library:addItem",
      "library:updateItem",
      "library:removeItem",
      "library:restoreItem",
      "library:addPass",
      "library:removePass",
      "library:addThought",
      "library:updateThought",
      "library:removeThought",
      "library:createCollection",
      "library:updateCollection",
      "library:removeCollection",
      "library:restoreCollection",
      "library:addToCollection",
      "library:removeFromCollection",
      "library:moveCollectionItem",
      "library:adoptSuggestion",
    ]);
  });

  it("adds a work with a title and a kind, and answers the whole view", async () => {
    const { host } = harness();
    const profileId = createProfile();

    const view = await call<View>(host, "library:addItem", {
      profileId,
      kind: "book",
      title: "Na Drini ćuprija",
    });

    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({
      kind: "book",
      title: "Na Drini ćuprija",
      status: "planned",
      rating: null,
      year: null,
      pagesRead: null,
      passes: [],
      thoughts: [],
    });
  });

  it("refuses a payload the wire should never carry, before the store sees it", async () => {
    const { host } = harness();
    const profileId = createProfile();

    await expect(call(host, "library:addItem", { profileId, kind: "podcast", title: "X" })).rejects.toThrow(
      /must be book, film or series/,
    );
    await expect(call(host, "library:addItem", { profileId, kind: "book", title: "" })).rejects.toThrow(
      /must be a non-empty string/,
    );
    await expect(
      call(host, "library:addItem", { profileId, kind: "book", title: "x".repeat(301) }),
    ).rejects.toThrow(/must not exceed 300 characters/);
    await expect(
      call(host, "library:updateItem", {
        profileId,
        id: "  padded  ",
        title: "A",
        originalTitle: null,
        creators: [],
        year: null,
        status: "planned",
        rating: null,
        pagesRead: null,
        pagesTotal: null,
        season: null,
        episode: null,
        seasonsTotal: null,
        episodesTotal: null,
        tags: [],
        summary: null,
      }),
    ).rejects.toThrow(/not a well-formed id/);
    await expect(
      call(host, "library:addPass", {
        profileId,
        itemId: "x",
        startedOn: "2026-02-30",
        finishedOn: null,
        rating: 11,
      }),
    ).rejects.toThrow(/between 1 and 10/);
    await expect(
      call(host, "library:addItem", { profileId: "x".repeat(201), kind: "book", title: "A" }),
    ).rejects.toThrow(/not a well-formed id/);
  });
});

describe("works, passes and thoughts", () => {
  it("edits a work, records a reading and derives its status from the latest pass", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const added = await call<View>(host, "library:addItem", {
      profileId,
      kind: "book",
      title: "Na Drini ćuprija",
    });
    const id = added.items[0]?.id ?? "";

    const edited = await call<View>(host, "library:updateItem", {
      profileId,
      id,
      title: "Na Drini ćuprija",
      originalTitle: "The Bridge on the Drina",
      creators: ["Ivo Andrić"],
      year: 1945,
      status: "planned",
      rating: null,
      pagesRead: 40,
      pagesTotal: 320,
      season: null,
      episode: null,
      seasonsTotal: null,
      episodesTotal: null,
      tags: ["teretana", "teretana"],
      summary: "Most na Drini.",
    });
    // The store's own canonicalisation, not the wire's: a duplicate tag collapses.
    expect(edited.items[0]).toMatchObject({
      originalTitle: "The Bridge on the Drina",
      creators: ["Ivo Andrić"],
      year: 1945,
      pagesRead: 40,
      pagesTotal: 320,
      tags: ["teretana"],
      summary: "Most na Drini.",
    });

    clock += 60_000;
    const running = await call<View>(host, "library:addPass", {
      profileId,
      itemId: id,
      startedOn: "2026-06-01",
      finishedOn: null,
      rating: null,
    });
    expect(running.items[0]?.status).toBe("in-progress");
    expect(running.items[0]?.passes).toHaveLength(1);

    clock += 60_000;
    const done = await call<View>(host, "library:addPass", {
      profileId,
      itemId: id,
      startedOn: "2026-05-01",
      finishedOn: "2026-05-20",
      rating: 9,
    });
    // A pass that finishes IS a work done, and its rating becomes the work's -
    // even though the LATER pass is the one that started earlier in the year.
    expect(done.items[0]?.status).toBe("done");
    expect(done.items[0]?.rating).toBe(9);
    expect(done.items[0]?.passes.map((pass) => pass.seq)).toEqual([1, 2]);

    const after = await call<View>(host, "library:removePass", {
      profileId,
      itemId: id,
      id: done.items[0]?.passes[1]?.id ?? "",
    });
    // With the finishing pass gone, the pass that is then latest decides again.
    expect(after.items[0]?.status).toBe("in-progress");
    // The rating STANDS: `deriveLibraryRatingFromPass` refuses to guess that a
    // rating the user typed came from the pass that was just deleted.
    expect(after.items[0]?.rating).toBe(9);
  });

  it("keeps a dated journal, edits one entry and removes another", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const added = await call<View>(host, "library:addItem", {
      profileId,
      kind: "series",
      title: "Otpisani",
    });
    const id = added.items[0]?.id ?? "";

    await call(host, "library:addThought", {
      profileId,
      itemId: id,
      date: "2026-06-02",
      text: "Prva sezona drži tempo.",
    });
    const withSecond = await call<View>(host, "library:addThought", {
      profileId,
      itemId: id,
      date: "2026-06-01",
      text: "Prva epizoda.",
    });
    // Oldest first, with the day closing the order - the store's own read.
    expect(withSecond.items[0]?.thoughts.map((thought) => thought.text)).toEqual([
      "Prva epizoda.",
      "Prva sezona drži tempo.",
    ]);

    const second = withSecond.items[0]?.thoughts[1];
    const edited = await call<View>(host, "library:updateThought", {
      profileId,
      itemId: id,
      id: second?.id ?? "",
      date: "2026-06-02",
      text: "Prva sezona drži tempo, ali kraj je brz.",
    });
    expect(edited.items[0]?.thoughts[1]?.text).toBe("Prva sezona drži tempo, ali kraj je brz.");

    const removed = await call<View>(host, "library:removeThought", {
      profileId,
      itemId: id,
      id: second?.id ?? "",
    });
    expect(removed.items[0]?.thoughts).toHaveLength(1);

    await expect(
      call(host, "library:addThought", { profileId, itemId: id, date: "2026-06-01", text: "   " }),
    ).rejects.toThrow(/must be 1-4000 characters/);
  });

  it("removes a work softly and puts it back with its story", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const added = await call<View>(host, "library:addItem", {
      profileId,
      kind: "film",
      title: "Ko to tamo peva",
    });
    const id = added.items[0]?.id ?? "";
    await call(host, "library:addThought", { profileId, itemId: id, date: "2026-06-01", text: "Klasičan." });

    const removed = await call<View>(host, "library:removeItem", { profileId, id });
    expect(removed.items).toEqual([]);

    const restored = await call<View>(host, "library:restoreItem", { profileId, id });
    expect(restored.items[0]?.thoughts.map((thought) => thought.text)).toEqual(["Klasičan."]);
  });
});

describe("collections", () => {
  it("creates, fills, reorders, renames and deletes a collection, computing its progress", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const book = await call<View>(host, "library:addItem", {
      profileId,
      kind: "book",
      title: "Knjiga",
    });
    const film = await call<View>(host, "library:addItem", {
      profileId,
      kind: "film",
      title: "Film",
    });
    const bookId = book.items[0]?.id ?? "";
    const filmId = film.items[0]?.id ?? "";

    const created = await call<View>(host, "library:createCollection", {
      profileId,
      name: "Letnje čitanje",
      description: "Za odmor.",
    });
    const collectionId = created.collections[0]?.id ?? "";
    expect(created.collections[0]).toMatchObject({
      name: "Letnje čitanje",
      description: "Za odmor.",
      suggestedId: null,
      progress: { done: 0, total: 0 },
      itemIds: [],
    });

    const withFilm = await call<View>(host, "library:addToCollection", {
      profileId,
      collectionId,
      itemId: filmId,
    });
    const both = await call<View>(host, "library:addToCollection", {
      profileId,
      collectionId,
      itemId: bookId,
    });
    expect(withFilm.collections[0]?.itemIds).toEqual([filmId]);
    expect(both.collections[0]?.itemIds).toEqual([filmId, bookId]);
    expect(both.collections[0]?.progress).toEqual({ done: 0, total: 2 });

    // Move the book above the film: between nothing and the film.
    const moved = await call<View>(host, "library:moveCollectionItem", {
      profileId,
      collectionId,
      itemId: bookId,
      beforeId: null,
      afterId: filmId,
    });
    expect(moved.collections[0]?.itemIds).toEqual([bookId, filmId]);

    const renamed = await call<View>(host, "library:updateCollection", {
      profileId,
      id: collectionId,
      name: "Zimske večeri",
      description: null,
    });
    expect(renamed.collections[0]).toMatchObject({ name: "Zimske večeri", description: null });

    const emptied = await call<View>(host, "library:removeFromCollection", {
      profileId,
      collectionId,
      itemId: filmId,
    });
    expect(emptied.collections[0]?.itemIds).toEqual([bookId]);

    const deleted = await call<View>(host, "library:removeCollection", { profileId, id: collectionId });
    expect(deleted.collections).toEqual([]);
    const back = await call<View>(host, "library:restoreCollection", { profileId, id: collectionId });
    expect(back.collections[0]?.itemIds).toEqual([bookId]);
  });

  it("refuses a pair that does not describe a gap, and a move of a foreign row", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const one = await call<View>(host, "library:addItem", { profileId, kind: "book", title: "A" });
    const collection = await call<View>(host, "library:createCollection", {
      profileId,
      name: "Zbirka",
      description: null,
    });
    const itemId = one.items[0]?.id ?? "";
    const collectionId = collection.collections[0]?.id ?? "";
    await call(host, "library:addToCollection", { profileId, collectionId, itemId });

    await expect(
      call(host, "library:moveCollectionItem", {
        profileId,
        collectionId,
        itemId,
        beforeId: itemId,
        afterId: null,
      }),
    ).rejects.toThrow(/must name other works/);
    await expect(
      call(host, "library:addToCollection", { profileId, collectionId, itemId: "missing" }),
    ).rejects.toThrow(/No live library item/);
    // A whitespace-only name passes the wire's own check (it IS a non-empty
    // string) and is refused by the store, which is where the sentence naming
    // the field after trimming is written.
    await expect(
      call(host, "library:createCollection", { profileId, name: "   ", description: null }),
    ).rejects.toThrow(/must be 1-120 characters/);
    await expect(
      call(host, "library:createCollection", { profileId, name: "x".repeat(121), description: null }),
    ).rejects.toThrow(/must not exceed 120 characters/);
  });
});

describe("the curated lists an installed pack offers", () => {
  it("offers what the pack carries, adopts one, matches what exists, and adds nothing on a second adoption", async () => {
    const { host } = harness();
    const profileId = createProfile();
    // One of the list's two works is already in the profile - logged by hand,
    // with the Wikidata id the pack names, which is what the match uses first.
    await call(host, "library:addItem", { profileId, kind: "film", title: "Ko to tamo peva" });
    const store = new LibraryStore(db.raw, profileId);
    const film = store.listItems().find((item) => item.title === "Ko to tamo peva");
    store.updateItem(film?.id ?? "", { wikidataId: "Q1000000002" }, new Date(clock).toISOString());

    const offered = await list(host, profileId);
    expect(offered.suggestions.map((suggestion) => suggestion.collectionId)).toEqual([
      "sr-classics",
      "short-list",
    ]);
    expect(offered.suggestions[0]).toMatchObject({
      packId: "sr-classics-pack",
      adopted: false,
      small: false,
      title: { sr: "Srpski klasici", en: "Serbian classics" },
    });
    expect(offered.suggestions[1]?.small).toBe(true);
    expect(offered.suggestions[0]?.items).toHaveLength(2);

    const adopted = await call<View>(host, "library:adoptSuggestion", {
      profileId,
      packId: "sr-classics-pack",
      packVersion: "1.0.0",
      collectionId: "sr-classics",
    });
    expect(adopted.items).toHaveLength(2);
    expect(adopted.collections).toHaveLength(1);
    const collection = adopted.collections[0];
    expect(collection).toMatchObject({
      name: "Srpski klasici",
      suggestedId: "libpack:sr-classics-pack:sr-classics",
      progress: { done: 0, total: 2 },
    });
    // The film already existed (matched by Wikidata id); the book was created.
    expect(collection?.itemIds).toHaveLength(2);
    expect(collection?.itemIds).toContain(film?.id);
    // The list's own order: the book first, then the film it matched.
    expect(collection?.itemIds[1]).toBe(film?.id);
    expect(adopted.items.map((item) => item.kind).sort()).toEqual(["book", "film"]);
    // And the suggestion now says so, so the page offers no second adoption.
    expect(adopted.suggestions[0]?.adopted).toBe(true);

    const again = await call<View>(host, "library:adoptSuggestion", {
      profileId,
      packId: "sr-classics-pack",
      packVersion: "1.0.0",
      collectionId: "sr-classics",
    });
    expect(again.items).toHaveLength(2);
    expect(again.collections).toHaveLength(1);

    // A second, DIFFERENT list from the same pack is still adoptable: the marker
    // is the pack's id AND the list's, so two lists are two collections.
    const second = await call<View>(host, "library:adoptSuggestion", {
      profileId,
      packId: "sr-classics-pack",
      packVersion: "1.0.0",
      collectionId: "short-list",
    });
    expect(second.collections).toHaveLength(2);
    expect(second.items).toHaveLength(3);
  });

  it("refuses a pack or a list that is not installed, and a malformed pack id", async () => {
    const { host } = harness();
    const profileId = createProfile();

    await expect(
      call(host, "library:adoptSuggestion", {
        profileId,
        packId: "not-installed",
        packVersion: "1.0.0",
        collectionId: "sr-classics",
      }),
    ).rejects.toThrow(/No installed pack/);
    await expect(
      call(host, "library:adoptSuggestion", {
        profileId,
        packId: "sr-classics-pack",
        packVersion: "1.0.0",
        collectionId: "not-a-list",
      }),
    ).rejects.toThrow(/No installed pack/);
    await expect(
      call(host, "library:adoptSuggestion", {
        profileId,
        packId: "  ",
        packVersion: "1.0.0",
        collectionId: "sr-classics",
      }),
    ).rejects.toThrow(/not a well-formed id/);
  });
});

describe("the library archive section", () => {
  it("round-trips works, passes, thoughts, a collection and their links through a wipe and a restore", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const added = await call<View>(host, "library:addItem", {
      profileId,
      kind: "book",
      title: "Na Drini cuprija",
    });
    const itemId = added.items[0]?.id ?? "";
    await call(host, "library:updateItem", {
      profileId,
      id: itemId,
      title: "Na Drini cuprija",
      originalTitle: "The Bridge on the Drina",
      creators: ["Ivo Andric"],
      year: 1945,
      status: "done",
      rating: 9,
      pagesRead: 320,
      pagesTotal: 320,
      season: null,
      episode: null,
      seasonsTotal: null,
      episodesTotal: null,
      tags: ["klasik"],
      summary: null,
    });
    await call(host, "library:addPass", {
      profileId,
      itemId,
      startedOn: "2026-05-01",
      finishedOn: "2026-05-20",
      rating: 9,
    });
    await call(host, "library:addThought", {
      profileId,
      itemId,
      date: "2026-05-21",
      text: "Ostaje.",
    });
    const withCollection = await call<View>(host, "library:createCollection", {
      profileId,
      name: "Klasici",
      description: "Obavezna lektira.",
    });
    await call(host, "library:addToCollection", {
      profileId,
      collectionId: withCollection.collections[0]?.id ?? "",
      itemId,
    });

    const before = await list(host, profileId);
    const [section] = host.collectExports([profileId]);
    expect(section?.moduleId).toBe("library");

    // A restore replaces a profile WHOLE, so the archive is applied onto the
    // profile it came from (the rule every compiled-in module's archive keeps,
    // and the reason the value carries row ids at all: every link in it points
    // at them). First the wipe: an archive that says nothing about the Library
    // empties it.
    host.applyImports([], [profileId]);
    expect(await list(host, profileId)).toMatchObject({ items: [], collections: [] });

    host.applyImports([section!], [profileId]);

    const restored = await list(host, profileId);
    // The WHOLE value, ids included: a second export of the restored profile
    // has to be identical to the first, which is what makes this a round trip
    // rather than a check that some fields survived.
    expect(restored).toEqual(before);
    expect(restored.collections[0]?.itemIds).toEqual([itemId]);
    expect(restored.items[0]?.passes.map((pass) => [pass.startedOn, pass.finishedOn])).toEqual([
      ["2026-05-01", "2026-05-20"],
    ]);
    expect(restored.items[0]?.thoughts.map((thought) => thought.text)).toEqual(["Ostaje."]);
  });
  it("refuses a payload it does not understand, leaving the profile exactly as it found it", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await call(host, "library:addItem", { profileId, kind: "book", title: "Ostaje" });

    for (const payload of [
      // A version this module does not know.
      { version: 99, items: [], covers: [], passes: [], thoughts: [], collections: [], collectionItems: [] },
      // A row that is not an item at all.
      {
        version: 1,
        items: [{ id: "x" }],
        covers: [],
        passes: [],
        thoughts: [],
        collections: [],
        collectionItems: [],
      },
      // A dangling reference: a pass on a work the value does not carry.
      {
        version: 1,
        items: [],
        covers: [],
        passes: [
          {
            id: "pass",
            itemId: "ghost",
            seq: 1,
            startedOn: null,
            finishedOn: null,
            rating: null,
            createdAt: "2026-06-01T08:00:00.000Z",
            updatedAt: "2026-06-01T08:00:00.000Z",
          },
        ],
        thoughts: [],
        collections: [],
        collectionItems: [],
      },
    ]) {
      expect(() => host.applyImports([{ moduleId: "library", payload }], [profileId])).toThrow();
      const after = await list(host, profileId);
      expect(after.items.map((item) => item.title)).toEqual(["Ostaje"]);
    }
  });

  it("empties the archived state when the section names no Library entry", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await call(host, "library:addItem", { profileId, kind: "book", title: "Ostaje" });

    // An archive with no Library entry is what a restore of a pre-kit archive
    // hands over, and a restore replaces the profile whole.
    host.applyImports([], [profileId]);

    const after = await list(host, profileId);
    expect(after.items).toEqual([]);
    expect(after.collections).toEqual([]);
  });

  it("writes nothing for a session that names more than one profile, rather than guess", () => {
    const { host } = harness();
    expect(host.collectExports(["profile-1", "profile-2"])).toEqual([]);
  });
});
