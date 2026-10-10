import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import { baseManifest, entry, makeKey, writePack } from "../../../main/packs/fixtures.js";
import { packVersionDir, refreshInstalled } from "../../../main/packs/registry.js";
import { configureReaderEnvironment, type ReaderPrintRequest } from "./env.js";
import { register } from "./register.js";

/**
 * The READER module through the kit (ADR-090, ADR-100): its channels, the
 * refusals, the two fixture packs on disk, the search index built over them, and
 * its archive section.
 *
 * **Why the packs are REAL and signed.** A content pack is only a pack when its
 * manifest verifies against a key, so a fixture that skipped that step would test
 * a library with nothing in it - and the case this module exists for (a signed
 * pack whose files are served, indexed and printed) would never be exercised. The
 * key is a throwaway pair from the packs layer's own fixture helper; the release
 * private key is never read by a test.
 *
 * **Why the tests drive the HOST.** `register(host)` is the only entry point the
 * discovery glue knows, and the sender check, the channel allowlist and the
 * validators are all the host's. Going through `dispatch` therefore tests what
 * actually runs in the app.
 */

const TRUSTED = { trusted: true };
const PRIMARY = "prva-pomoc";
const SECONDARY = "zakoni";
const VERSION = "1.0.0";

let dir: string;
let db: NexusDatabase;
let publicKeyPem: string;
/** One throwaway key for every fixture pack: one key, so both verify against the same list. */
let packKey: ReturnType<typeof makeKey>;
let printed: ReaderPrintRequest[];
let opened: string[];
const clock = Date.parse("2026-10-10T08:00:00.000Z");

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
    now: () => clock,
  };
  const host = new ModuleHost(platform);
  register(host);
  return { host };
}

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date(clock).toISOString());
  return id;
}

async function call<T>(host: ModuleHost, channel: string, payload: unknown): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

/** Writes one signed content pack into the installed layout and refreshes the index. */
function installPack(options: {
  id: string;
  notice?: "safety";
  files: Readonly<Record<string, string | Uint8Array>>;
}): void {
  const contents = options.files;
  const files = Object.entries(contents).map(([path, body]) => entry(path, body));
  writePack({
    dir: packVersionDir(dir, options.id, VERSION),
    key: packKey.privateKey,
    manifest: baseManifest(files, {
      id: options.id,
      version: VERSION,
      kind: "content",
      title: { sr: `Knjiga ${options.id}`, en: `Book ${options.id}` },
      description: { sr: "Opis.", en: "Description." },
      source: { name: "Izvor", url: "https://example.org/source" },
      ...(options.notice === undefined ? {} : { notice: options.notice }),
    }),
    contents,
  });
  refreshInstalled(dir, publicKeyPem);
  // TEMP DIAGNOSTIC
}

/** The index builds asynchronously; this asks again until it is ready, the way the page does. */
async function waitForIndex(host: ModuleHost, profileId: string, packId: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const view = await call<{ index: { state: string } }>(host, "reader:contents", {
      profileId,
      packId,
    });
    if (view.index.state !== "building") return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("the index never finished building");
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-reader-module-"));
  db = openDatabase({ path: join(dir, "reader.db") });
  packKey = makeKey();
  publicKeyPem = packKey.publicKeyPem;
  // TEMP DIAGNOSTIC
  installPack({
    id: PRIMARY,
    notice: "safety",
    files: {
      // The article's file name and its heading agree on the title on purpose: the
      // index reads the heading and the fallback reads the name, and a test that
      // asserted "Voda i elektroliti" would otherwise depend on which one answered.
      "voda-i-elektroliti.md": "# Voda i elektroliti\n\nVoda je osnov svega.\n\n- prvo\n- drugo\n",
      "prva-pomoc/opekotine.md":
        "# Opekotine\n\nHladi opekotinu vodom dvadeset minuta. Voda pomaže.\n",
      "prva-pomoc/slike/ozleda.png": "nije-prava-slika",
    },
  });
  installPack({
    id: SECONDARY,
    files: { "ustav.md": "# Ustav\n\nVoda je javno dobro.\n" },
  });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  printed = [];
  opened = [];
  configureReaderEnvironment({
    userData: dir,
    publicKeyPem,
    print: async (request) => {
      printed.push(request);
      return { outcome: "saved", filePath: join(dir, "izlaz.pdf"), articles: request.document.articles.length };
    },
    openExternal: async (url) => {
      opened.push(url);
      return true;
    },
  });
});

describe("the reader handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    const { host } = harness();
    expect(host.channels()).toEqual([
      "reader:library",
      "reader:contents",
      "reader:article",
      "reader:setPosition",
      "reader:setBookmark",
      "reader:removeBookmark",
      "reader:setTextSize",
      "reader:acknowledge",
      "reader:search",
      "reader:print",
      "reader:openExternal",
    ]);
  });

  it("lists the installed content packs, with the safety mark the manifest carries", async () => {
    const { host } = harness();
    const profileId = createProfile();

    const view = await call<{
      books: { id: string; safety: boolean; articleCount: number | null; lastArticle: string | null }[];
      settings: { textSize: string };
    }>(host, "reader:library", { profileId });

    expect(view.books.map((book) => book.id)).toEqual([PRIMARY, SECONDARY]);
    expect(view.books.map((book) => book.safety)).toEqual([true, false]);
    // Nothing has opened a book, so no index exists and the count is a fact the
    // module does not have - not a zero.
    expect(view.books.map((book) => book.articleCount)).toEqual([null, null]);
    expect(view.settings).toEqual({ textSize: "m" });
  });

  it("refuses a payload the wire should never carry, before anything is read", async () => {
    const { host } = harness();
    const profileId = createProfile();

    await expect(call(host, "reader:library", { profileId: "  padded  " })).rejects.toThrow(
      /not a well-formed id/,
    );
    await expect(call(host, "reader:contents", { profileId, packId: "" })).rejects.toThrow(
      /must be a non-empty string/,
    );
    await expect(
      call(host, "reader:contents", { profileId, packId: "x".repeat(65) }),
    ).rejects.toThrow(/must not exceed 64/);
    await expect(
      call(host, "reader:setTextSize", { profileId, textSize: "xl" }),
    ).rejects.toThrow(/must be one of s, m, l/);
    await expect(
      call(host, "reader:search", { profileId, packId: null, query: 42 }),
    ).rejects.toThrow(/must be a string/);
    await expect(
      call(host, "reader:print", {
        profileId,
        packId: PRIMARY,
        scope: "book",
        path: null,
        paper: "A4",
      }),
    ).rejects.toThrow(/scope/);
    await expect(
      call(host, "reader:print", {
        profileId,
        packId: PRIMARY,
        scope: "pack",
        path: null,
        paper: "A3",
      }),
    ).rejects.toThrow(/paper/);
  });

  it("refuses a pack that is not installed, and a path the pack does not list", async () => {
    const { host } = harness();
    const profileId = createProfile();

    await expect(call(host, "reader:contents", { profileId, packId: "nema" })).rejects.toThrow(
      /is installed/,
    );
    await expect(
      call(host, "reader:article", { profileId, packId: PRIMARY, path: "../../nexus.db" }),
    ).rejects.toThrow(/does not list/);
    await expect(
      call(host, "reader:setBookmark", {
        profileId,
        packId: PRIMARY,
        path: "prva-pomoc/slike/ozleda.png",
        note: "",
      }),
    ).rejects.toThrow(/does not list/);
  });
});

describe("one book", () => {
  it("answers the table of contents from the pack's paths, then with the articles' own titles", async () => {
    const { host } = harness();
    const profileId = createProfile();

    const building = await call<{
      toc: { kind: string; id: string; title: string; children: unknown[] }[];
      index: { state: string; articlesTotal: number };
      acknowledged: boolean;
    }>(host, "reader:contents", { profileId, packId: PRIMARY });

    expect(building.index.state).toBe("building");
    expect(building.index.articlesTotal).toBe(2);
    expect(building.acknowledged).toBe(false);
    expect(building.toc.map((node) => node.id)).toEqual(["prva-pomoc/", "voda-i-elektroliti.md"]);

    await waitForIndex(host, profileId, PRIMARY);

    const ready = await call<{
      toc: { id: string; title: string; children: { id: string; title: string }[] }[];
      book: { articleCount: number | null };
    }>(host, "reader:contents", { profileId, packId: PRIMARY });
    expect(ready.book.articleCount).toBe(2);
    // The chapter's articles are titled from their own first headings.
    expect(ready.toc[0]?.children.map((child) => child.title)).toEqual(["Opekotine"]);
    expect(ready.toc[1]?.title).toBe("Voda i elektroliti");
  });

  it("answers one article with its text, its source and its neighbours", async () => {
    const { host } = harness();
    const profileId = createProfile();

    const article = await call<{
      path: string;
      title: string;
      markdown: string;
      source: { url: string };
      licence: { spdx: string };
      notice: string | null;
      previous: string | null;
      next: string | null;
      bookmarked: boolean;
    }>(host, "reader:article", { profileId, packId: PRIMARY, path: "prva-pomoc/opekotine.md" });

    expect(article.markdown).toContain("Hladi opekotinu vodom");
    expect(article.title).toBe("Opekotine");
    expect(article.notice).toBe("safety");
    expect(article.source.url).toBe("https://example.org/source");
    expect(article.licence.spdx).toBe("CC-BY-SA-4.0");
    // Reading order is the pack's own tree: the chapter comes before the
    // unnumbered article that follows it, so this page is first and "Uvod" is next.
    expect(article.previous).toBeNull();
    expect(article.next).toBe("voda-i-elektroliti.md");
    expect(article.bookmarked).toBe(false);
  });

  it("records where the reader stopped, and the bookmark with its note", async () => {
    const { host } = harness();
    const profileId = createProfile();

    const afterPosition = await call<{ position: { articlePath: string } | null }>(
      host,
      "reader:setPosition",
      { profileId, packId: PRIMARY, path: "prva-pomoc/opekotine.md" },
    );
    expect(afterPosition.position).toEqual({
      packId: PRIMARY,
      articlePath: "prva-pomoc/opekotine.md",
    });

    const afterBookmark = await call<{
      bookmarks: { articlePath: string; note: string; title: string }[];
    }>(host, "reader:setBookmark", {
      profileId,
      packId: PRIMARY,
      path: "prva-pomoc/opekotine.md",
      note: "hladiti 20 minuta",
    });
    expect(afterBookmark.bookmarks).toEqual([
      {
        packId: PRIMARY,
        articlePath: "prva-pomoc/opekotine.md",
        note: "hladiti 20 minuta",
        title: "Opekotine",
      },
    ]);

    // The library then knows both facts, which is what the shelf draws.
    const library = await call<{ books: { id: string; lastArticle: string | null; bookmarkCount: number }[] }>(
      host,
      "reader:library",
      { profileId },
    );
    expect(library.books[0]).toMatchObject({
      id: PRIMARY,
      lastArticle: "prva-pomoc/opekotine.md",
      bookmarkCount: 1,
    });

    const afterRemoval = await call<{ bookmarks: unknown[] }>(host, "reader:removeBookmark", {
      profileId,
      packId: PRIMARY,
      path: "prva-pomoc/opekotine.md",
    });
    expect(afterRemoval.bookmarks).toEqual([]);
  });

  it("acknowledges a safety pack, and keeps the preference it was given", async () => {
    const { host } = harness();
    const profileId = createProfile();

    const acknowledged = await call<{ acknowledged: boolean }>(host, "reader:acknowledge", {
      profileId,
      packId: PRIMARY,
    });
    expect(acknowledged.acknowledged).toBe(true);

    const settings = await call<{ textSize: string }>(host, "reader:setTextSize", {
      profileId,
      textSize: "l",
    });
    expect(settings).toEqual({ textSize: "l" });
    const library = await call<{ settings: { textSize: string } }>(host, "reader:library", {
      profileId,
    });
    expect(library.settings).toEqual({ textSize: "l" });
  });
});

describe("search", () => {
  it("answers title matches first, then body matches, with the matched words highlighted", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await waitForIndex(host, profileId, PRIMARY);
    await waitForIndex(host, profileId, SECONDARY);

    const inPack = await call<{
      hits: { path: string; titleMatch: boolean; title: string; titleRanges: number[][]; snippet: string | null }[];
      truncated: boolean;
    }>(host, "reader:search", { profileId, packId: PRIMARY, query: "voda" });

    expect(inPack.truncated).toBe(false);
    expect(inPack.hits.map((hit) => hit.path)).toEqual([
      "voda-i-elektroliti.md",
      "prva-pomoc/opekotine.md",
    ]);
    expect(inPack.hits.map((hit) => hit.titleMatch)).toEqual([true, false]);
    expect(inPack.hits[0]?.title).toBe("Voda i elektroliti");
    expect(inPack.hits[0]?.titleRanges).toEqual([[0, 4]]);
    expect(inPack.hits[1]?.snippet).toBe(
      "Opekotine\n\nHladi opekotinu vodom dvadeset minuta. Voda pomaže.",
    );

    // Across every installed pack the same query also finds the second book.
    const everywhere = await call<{ hits: { packId: string }[]; pending: string[] }>(
      host,
      "reader:search",
      { profileId, packId: null, query: "voda" },
    );
    expect(everywhere.pending).toEqual([]);
    expect([...new Set(everywhere.hits.map((hit) => hit.packId))]).toEqual([PRIMARY, SECONDARY]);
  });

  it("answers nothing for a query of no usable terms", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const view = await call<{ hits: unknown[] }>(host, "reader:search", {
      profileId,
      packId: null,
      query: "i",
    });
    expect(view.hits).toEqual([]);
  });
});

describe("printing and the source link", () => {
  it("hands the printer the pack's title, the licence, the source and the notice", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await waitForIndex(host, profileId, PRIMARY);

    const result = await call<{ outcome: string; articles: number }>(host, "reader:print", {
      profileId,
      packId: PRIMARY,
      scope: "pack",
      path: null,
      paper: "A5",
    });

    expect(result).toEqual({ outcome: "saved", filePath: join(dir, "izlaz.pdf"), articles: 2 });
    const request = printed[0];
    expect(request?.paper).toBe("A5");
    expect(request?.language).toBe("sr");
    expect(request?.document.packTitle).toBe(`Knjiga ${PRIMARY}`);
    expect(request?.document.licence).toBe("CC-BY-SA-4.0 - Wikipedia contributors");
    expect(request?.document.sourceUrl).toBe("https://example.org/source");
    expect(request?.document.notice).toContain("112");
    expect(request?.document.articles.map((article) => article.title)).toEqual([
      "Opekotine",
      "Voda i elektroliti",
    ]);
    expect(request?.suggestedName).toBe(`${PRIMARY}-${VERSION}`);
  });

  it("refuses a scope that names nothing rather than printing the whole book", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await waitForIndex(host, profileId, PRIMARY);

    const result = await call<{ outcome: string; reason?: string }>(host, "reader:print", {
      profileId,
      packId: PRIMARY,
      scope: "chapter",
      path: "nema/",
      paper: "A4",
    });
    expect(result).toEqual({ outcome: "refused", reason: "no-article" });
    expect(printed).toEqual([]);
  });

  it("opens http(s) sources and refuses everything else", async () => {
    const { host } = harness();

    expect(await call(host, "reader:openExternal", { url: "https://example.org/x" })).toEqual({
      outcome: "opened",
    });
    expect(opened).toEqual(["https://example.org/x"]);

    for (const url of ["file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "data:text/html,x"]) {
      expect(await call(host, "reader:openExternal", { url }), url).toEqual({ outcome: "refused" });
    }
    expect(opened).toEqual(["https://example.org/x"]);
  });
});

describe("the reader archive section", () => {
  it("round-trips positions, bookmarks, notes, the size and the acknowledgements", async () => {
    const { host } = harness();
    const source = createProfile();
    const target = createProfile();

    await call(host, "reader:setPosition", {
      profileId: source,
      packId: PRIMARY,
      path: "voda-i-elektroliti.md",
    });
    await call(host, "reader:setBookmark", {
      profileId: source,
      packId: PRIMARY,
      path: "voda-i-elektroliti.md",
      note: "pocni odavde",
    });
    await call(host, "reader:setTextSize", { profileId: source, textSize: "l" });
    await call(host, "reader:acknowledge", { profileId: source, packId: PRIMARY });

    const [section] = host.collectExports([source]);
    expect(section?.moduleId).toBe("reader");
    host.applyImports([section!], [target]);

    const restored = await call<{
      bookmarks: { articlePath: string; note: string }[];
      position: { articlePath: string } | null;
      settings: { textSize: string };
      acknowledged: boolean;
    }>(host, "reader:contents", { profileId: target, packId: PRIMARY });

    expect(restored.position).toEqual({ packId: PRIMARY, articlePath: "voda-i-elektroliti.md" });
    expect(restored.bookmarks).toEqual([
      {
        packId: PRIMARY,
        articlePath: "voda-i-elektroliti.md",
        title: "Voda i elektroliti",
        note: "pocni odavde",
      },
    ]);
    expect(restored.settings).toEqual({ textSize: "l" });
    expect(restored.acknowledged).toBe(true);
  });

  it("refuses a payload it does not understand, leaving the profile exactly as it found it", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await call(host, "reader:setBookmark", {
      profileId,
      packId: PRIMARY,
      path: "voda-i-elektroliti.md",
      note: "moj",
    });

    const good = {
      version: 1,
      positions: [],
      bookmarks: [],
      settings: { textSize: "m" },
      acknowledged: [],
    };
    for (const payload of [
      { ...good, version: 99 },
      { ...good, bookmarks: [{ packId: PRIMARY, articlePath: "voda-i-elektroliti.md" }] },
      { ...good, settings: { textSize: "xl" } },
      { ...good, positions: [{ packId: PRIMARY, articlePath: "a.md" }, { packId: PRIMARY, articlePath: "b.md" }] },
    ]) {
      expect(() => host.applyImports([{ moduleId: "reader", payload }], [profileId])).toThrow();
      const after = await call<{ bookmarks: { note: string }[] }>(host, "reader:contents", {
        profileId,
        packId: PRIMARY,
      });
      expect(after.bookmarks.map((bookmark) => bookmark.note)).toEqual(["moj"]);
    }
  });

  it("empties the archived state when the section names no Reader entry", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await call(host, "reader:setBookmark", {
      profileId,
      packId: PRIMARY,
      path: "voda-i-elektroliti.md",
      note: "x",
    });
    await call(host, "reader:setTextSize", { profileId, textSize: "l" });

    host.applyImports([], [profileId]);

    const after = await call<{
      bookmarks: unknown[];
      position: unknown;
      settings: { textSize: string };
      acknowledged: boolean;
    }>(host, "reader:contents", { profileId, packId: PRIMARY });
    expect(after.bookmarks).toEqual([]);
    expect(after.position).toBeNull();
    expect(after.settings).toEqual({ textSize: "m" });
    expect(after.acknowledged).toBe(false);
  });

  it("writes nothing for a session that names more than one profile, rather than guess", () => {
    const { host } = harness();
    expect(host.collectExports(["profile-1", "profile-2"])).toEqual([]);
  });
});
