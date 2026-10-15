import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildZim } from "../../zim/testing/zimBuilder.js";
import { isHtmlMime } from "../../zim/protocol.js";
import { ZimReader } from "../../zim/reader.js";
import { articleText, searchKeys, zimWikiSource, type ZimWikiHost } from "./zimWiki.js";
import { leadSection } from "./markup.js";

const NEVER = new AbortController().signal;

/**
 * The adapter, against fakes AND against two real ZIM files.
 *
 * The fake host is where the RULES are pinned - which keys a question becomes,
 * which library is asked what, what order the titles come back in - because a
 * fake can be made to answer exactly what the rule is about. The two real files
 * are where the wiring is pinned, since a fake can only prove that the adapter
 * says what the test author believed: openZIM's Belarusian Wikibooks pack is a
 * file Nexus did not write, and the built one carries an article this build can
 * actually read a lead out of.
 */

// --- the fake -----------------------------------------------------------------

interface FakeCall {
  readonly libraryId: string;
  readonly prefix: string;
}

/** A host over a `prefix -> titles` table per library, remembering every prefix it was asked for. */
function fakeHost(input: {
  readonly libraries: readonly { readonly id: string; readonly language: string | null; readonly present?: boolean }[];
  readonly titles: Readonly<Record<string, readonly { readonly zimPath: string; readonly title: string }[]>>;
  readonly articles?: Readonly<Record<string, string>>;
}): { readonly host: ZimWikiHost; readonly calls: readonly FakeCall[] } {
  const calls: FakeCall[] = [];
  const host: ZimWikiHost = {
    libraries: () =>
      input.libraries.map((library) => ({
        id: library.id,
        language: library.language,
        present: library.present ?? true,
      })),
    search: (libraryId, prefix, limit) => {
      calls.push({ libraryId, prefix });
      return (input.titles[`${libraryId}\u0000${prefix}`] ?? []).slice(0, limit);
    },
    serve: (request) => {
      const html = input.articles?.[`${request.libraryId}\u0000${request.zimPath}`];
      if (html === undefined) return null;
      return { bytes: new TextEncoder().encode(html), html: true };
    },
  };
  return { host, calls };
}

describe("searchKeys", () => {
  it("asks for the name in a question before anything else", () => {
    expect(searchKeys("Ko je bio Nikola Tesla?")).toEqual(["Nikola Tesla", "Nikola", "Tesla"]);
  });

  it("drops the stop words of both languages and keeps the longest content word first", () => {
    expect(searchKeys("What is the capital of France?")).toEqual([
      "France",
      "capital",
      "Capital",
    ]);
    expect(searchKeys("Koji je glavni grad Francuske?")).toEqual([
      "Francuske",
      "glavni",
      "Glavni",
      "grad",
      "Grad",
    ]);
  });

  it("tries a lower-case word as typed and with its first letter upper-cased", () => {
    expect(searchKeys("francuska")).toEqual(["francuska", "Francuska"]);
  });

  it("reads a run of capitalised words even when the words around it are capitalised too", () => {
    // A stop word ends a run rather than being skipped inside one, so the two
    // names are two keys and the question words around them are neither.
    expect(searchKeys("Nikola Tesla and Mileva Maric")).toEqual([
      "Nikola Tesla",
      "Mileva Maric",
      "Nikola",
      "Mileva",
      "Tesla",
      "Maric",
    ]);
  });

  it("answers no keys for a question made only of stop words", () => {
    expect(searchKeys("Ko je to?")).toEqual([]);
  });
});

describe("zimWikiSource.searchTitles", () => {
  it("puts an exact title before the prefix matches, and stops at the limit", async () => {
    const { host } = fakeHost({
      libraries: [{ id: "wiki-en", language: "eng" }],
      titles: {
        "wiki-en\u0000France": [
          { zimPath: "A/France.html", title: "France" },
          { zimPath: "A/France_national_football_team.html", title: "France national football team" },
        ],
      },
    });
    const wiki = zimWikiSource(host);

    const asked = await wiki.searchTitles("France", 3, NEVER);
    expect(asked.map((title) => title.path)).toEqual([
      "wiki-en/A/France.html",
      "wiki-en/A/France_national_football_team.html",
    ]);
    // The exact title is first even though the reader answered in its own order.
    expect(asked[0]?.title).toBe("France");

    const capped = await wiki.searchTitles("France", 1, NEVER);
    expect(capped.map((title) => title.path)).toEqual(["wiki-en/A/France.html"]);
  });

  it("searches every library on disk, skips one whose file is gone, and never repeats a title", async () => {
    const { host, calls } = fakeHost({
      libraries: [
        { id: "wiki-en", language: "eng" },
        { id: "wiki-sr", language: "srp" },
        { id: "gone", language: "eng", present: false },
      ],
      titles: {
        "wiki-en\u0000Tesla": [{ zimPath: "A/Tesla.html", title: "Tesla" }],
        "wiki-sr\u0000Tesla": [{ zimPath: "A/Teсла.html", title: "Tesla" }],
        "gone\u0000Tesla": [{ zimPath: "A/Tesla.html", title: "Tesla" }],
      },
    });
    const wiki = zimWikiSource(host);

    const titles = await wiki.searchTitles("Tesla", 5, NEVER);

    expect(titles.map((title) => title.path)).toEqual(["wiki-en/A/Tesla.html", "wiki-sr/A/Teсла.html"]);
    expect(calls.map((call) => call.libraryId)).not.toContain("gone");
  });

  it("also tries the Cyrillic spelling of every key in a Serbian library", async () => {
    const { host, calls } = fakeHost({
      libraries: [{ id: "wikipedia-sr-mini", language: "srp" }],
      titles: {
        // What a Latin query finds in the file's own title order, and what the
        // Cyrillic one finds: the article itself first.
        "wikipedia-sr-mini\u0000Никола Тесла": [
          { zimPath: "A/Никола_Тесла.html", title: "Никола Тесла" },
        ],
        "wikipedia-sr-mini\u0000Тесла": [{ zimPath: "A/Тесла.html", title: "Тесла" }],
      },
    });
    const wiki = zimWikiSource(host);

    const titles = await wiki.searchTitles("Ko je bio Nikola Tesla?", 5, NEVER);

    // The paths are the reader's own and the titles are the app's script: the
    // same two articles, cited the way this app writes Serbian.
    expect(titles).toEqual([
      { path: "wikipedia-sr-mini/A/Никола_Тесла.html", title: "Nikola Tesla" },
      { path: "wikipedia-sr-mini/A/Тесла.html", title: "Tesla" },
    ]);
    expect(calls.map((call) => call.prefix)).toContain("Никола Тесла");
    // The Latin spelling is still asked first: a pack whose titles are Latin
    // needs it, and the transliteration is an addition rather than a swap.
    expect(calls.map((call) => call.prefix)).toContain("Nikola Tesla");
  });

  it("finds the nominative title of a declined word in a Serbian library", async () => {
    const { host, calls } = fakeHost({
      libraries: [{ id: "wikipedia-sr-mini", language: "srp" }],
      titles: {
        "wikipedia-sr-mini\u0000Београд": [
          // The index's own order, which puts the Latin entry first.
          { zimPath: "A/Beograd_na_vodi", title: "Beograd na vodi" },
          { zimPath: "A/Београд", title: "Београд" },
          { zimPath: "A/Београдска_арена", title: "Београдска арена" },
        ],
        "wikipedia-sr-mini\u0000Француск": [
          { zimPath: "A/Француска", title: "Француска" },
          { zimPath: "A/Француски_језик", title: "Француски језик" },
        ],
        "wikipedia-sr-mini\u0000Град": [{ zimPath: "A/Градац", title: "Градац" }],
      },
    });
    const wiki = zimWikiSource(host);

    // "Beogradu" less its ending is the title itself, and it is a prefix match
    // like the ones around it: a stem is a guess at an ending, so a hit that
    // merely equals one cannot jump ahead of the entry the search reached first.
    const located = await wiki.searchTitles("Šta znaš o Beogradu?", 5, NEVER);
    expect(located.map((title) => title.title)).toEqual([
      "Beograd na vodi",
      "Beograd",
      "Beogradska arena",
    ]);

    // A stem's prefix matches come before the next word's.
    const declined = await wiki.searchTitles("Koji je glavni grad Francuske?", 5, NEVER);
    expect(declined.map((title) => title.title)).toEqual(["Francuska", "Francuski jezik", "Gradac"]);

    // Never cut below four letters: "grad" is asked as itself only.
    expect(calls.map((call) => call.prefix)).not.toContain("gra");
  });

  it("does not transliterate or cut words for a library that is not Serbian", async () => {
    const { host, calls } = fakeHost({
      libraries: [{ id: "wiki-en", language: "eng" }],
      titles: {},
    });
    await zimWikiSource(host).searchTitles("Nikola Tesla", 5, NEVER);
    expect(calls.every((call) => /^[\x20-\x7f]*$/.test(call.prefix))).toBe(true);
    expect(calls.map((call) => call.prefix)).not.toContain("Tesl");
  });

  it("answers a Serbian library in the app's script, and leaves the path it routes back to alone", async () => {
    const article = [
      '<h1 id="firstHeading">Никола Тесла</h1>',
      "<p><b>Никола Тесла</b> (Смиљан, 10. јул 1856) био је српски проналазач.</p>",
    ].join("");
    const { host } = fakeHost({
      libraries: [{ id: "wikipedia-sr-mini", language: "srp" }],
      titles: {
        "wikipedia-sr-mini\u0000Никола Тесла": [
          { zimPath: "A/Никола_Тесла.html", title: "Никола Тесла" },
        ],
      },
      articles: { "wikipedia-sr-mini\u0000A/Никола_Тесла.html": article },
    });
    const wiki = zimWikiSource(host);

    const titles = await wiki.searchTitles("Ko je bio Nikola Tesla?", 5, NEVER);

    // The title is this app's script and the path is the reader's own bytes.
    expect(titles).toEqual([{ path: "wikipedia-sr-mini/A/Никола_Тесла.html", title: "Nikola Tesla" }]);
    // The passage follows the title: a model that copies it answers in the
    // script this app writes Serbian in.
    expect(await wiki.readArticle(titles[0]?.path ?? "", NEVER)).toBe(
      [
        "# Nikola Tesla",
        "Nikola Tesla (Smiljan, 10. jul 1856) bio je srpski pronalazač.",
      ].join("\n\n"),
    );
  });

  it("leaves a library that is not Serbian in its own script", async () => {
    // openZIM's Belarusian Wikibooks writes Cyrillic, and this build reads it as
    // written: the transliteration follows the LIBRARY's language, not the shape
    // of the letters.
    const article = "<h1>Кава</h1><p>Кава је напитак.</p>";
    const { host } = fakeHost({
      libraries: [{ id: "wikibooks-be", language: "bel" }],
      titles: { "wikibooks-be\u0000Кава": [{ zimPath: "A/Кава.html", title: "Кава" }] },
      articles: { "wikibooks-be\u0000A/Кава.html": article },
    });
    const wiki = zimWikiSource(host);

    const titles = await wiki.searchTitles("Кава", 5, NEVER);

    expect(titles).toEqual([{ path: "wikibooks-be/A/Кава.html", title: "Кава" }]);
    expect(await wiki.readArticle(titles[0]?.path ?? "", NEVER)).toBe(
      [
        "# Кава",
        "Кава је напитак.",
      ].join("\n\n"),
    );
  });

  it("answers nothing, and asks nothing, when there is no library or the signal is already aborted", async () => {
    const empty = fakeHost({ libraries: [], titles: {} });
    expect(await zimWikiSource(empty.host).searchTitles("Tesla", 5, NEVER)).toEqual([]);
    expect(empty.calls).toEqual([]);

    const aborted = fakeHost({
      libraries: [{ id: "wiki-en", language: "eng" }],
      titles: { "wiki-en\u0000Tesla": [{ zimPath: "A/Tesla.html", title: "Tesla" }] },
    });
    const signal = AbortSignal.abort();
    expect(await zimWikiSource(aborted.host).searchTitles("Tesla", 5, signal)).toEqual([]);
    expect(aborted.calls).toEqual([]);
  });

  it("does not offer a title whose path could not be cited", async () => {
    // The path becomes the citation's `id`, and the conversation store refuses
    // one longer than 200 characters when the turn is written: the choice is
    // between a title nobody can be told about and one that costs the answer.
    const long = `A/${"Dugačak_naslov".repeat(20)}.html`;
    const { host } = fakeHost({
      libraries: [{ id: "wiki-sr", language: "srp" }],
      titles: {
        "wiki-sr\u0000Tesla": [
          { zimPath: long, title: "Tesla" },
          { zimPath: "A/Tesla.html", title: "Tesla" },
        ],
      },
    });

    const titles = await zimWikiSource(host).searchTitles("Tesla", 5, NEVER);

    expect(titles).toEqual([{ path: "wiki-sr/A/Tesla.html", title: "Tesla" }]);
  });
});

describe("articleText", () => {
  /** One paragraph of a real article's shape: the lead, an infobox, a section, a table, a reference list and a navbox. */
  const ARTICLE = [
    "<!DOCTYPE html><html><head><title>Nikola Tesla</title>",
    "<style>.infobox{float:right}</style><script>var x = 1;</script></head><body>",
    '<h1 id="firstHeading">Nikola Tesla</h1>',
    '<table class="infobox"><tbody><tr><th>Born</th><td>10 July 1856</td></tr></tbody></table>',
    "<p><b>Nikola Tesla</b> (10 July 1856&nbsp;&ndash; 7 January 1943) was a Serbian-American",
    ' inventor and engineer.<sup class="reference"><a href="#cite_note-1">[1]</a></sup></p>',
    "<p>He is known for his contributions to the design of the modern alternating current</p>",
    '<h2><span class="mw-headline" id="Biography">Biography</span><span class="mw-editsection">[edit]</span></h2>',
    "<p>Tesla was born in Smiljan.</p>",
    '<table class="wikitable"><tbody><tr><td>The table nobody reads</td></tr></tbody></table>',
    '<ol class="references"><li id="cite_note-1"><span class="reference-text">"Tesla". Britannica.</span></li></ol>',
    '<div class="navbox"><div class="navbox-inner"><a href="#">V &middot; T &middot; E</a></div></div>',
    "</body></html>",
  ].join("");

  it("keeps the title, the headings and the paragraphs, and drops the encyclopaedia's furniture", () => {
    const text = articleText(ARTICLE);

    expect(text).toBe(
      [
        "# Nikola Tesla",
        "Nikola Tesla (10 July 1856 – 7 January 1943) was a Serbian-American inventor and engineer.",
        "He is known for his contributions to the design of the modern alternating current",
        "## Biography",
        "Tesla was born in Smiljan.",
      ].join("\n\n"),
    );
  });

  it("gives `leadSection` the article's opening paragraph and nothing below it", () => {
    expect(leadSection(articleText(ARTICLE), 2_000)).toBe(
      "Nikola Tesla (10 July 1856 – 7 January 1943) was a Serbian-American inventor and engineer. " +
        "He is known for his contributions to the design of the modern alternating current",
    );
  });

  it("reads a list item as a line and a heading with no title above it as a section", () => {
    expect(articleText("<h2>Uzroci</h2><ul><li>Hladnoća</li><li>Vlaga</li></ul>")).toBe(
      "## Uzroci\n\n- Hladnoća\n\n- Vlaga",
    );
  });

  it("decodes the numeric forms and leaves an entity this build does not know exactly as it was written", () => {
    // `&fjord;` is not an entity and stays one; the decimal and the hexadecimal
    // reference are the same letter, spelled the two ways a page may spell it.
    expect(articleText("<p>10 &fjord; 20 &amp; 30 &#65; &#x41D;</p>")).toBe(
      "10 &fjord; 20 & 30 A Н",
    );
  });

  it("answers empty text for a document with nothing readable in it", () => {
    expect(articleText("<html><head><style>p{}</style></head><body><script>x()</script></body></html>")).toBe("");
  });
});

// --- the two real files -------------------------------------------------------

const FIXTURE = fileURLToPath(new URL("../../zim/fixtures/wikibooks_be_all_nopic_2017-02.zim", import.meta.url));

/**
 * A host over a real `ZimReader`, in the host's own shape.
 *
 * Three lines and a try/catch, because that is all `zim/host.ts`'s `search` and
 * `serve` do around the same calls - including the catch, which is what turns a
 * cluster this build cannot decompress into the same `null` a missing entry
 * answers with.
 */
function hostOverReader(input: {
  readonly id: string;
  readonly language: string | null;
  readonly reader: ZimReader;
}): ZimWikiHost {
  return {
    libraries: () => [{ id: input.id, language: input.language, present: true }],
    search: (libraryId, prefix, limit) =>
      libraryId === input.id
        ? input.reader.titlesFrom(prefix, limit).map((entry) => ({
            zimPath: entry.zimPath,
            title: entry.title,
          }))
        : [],
    serve: (request) => {
      if (request.libraryId !== input.id) return null;
      try {
        const entry = input.reader.entryByPath(request.zimPath);
        if (entry === null) return null;
        return { bytes: input.reader.blob(entry), html: isHtmlMime(entry.mimetype) };
      } catch {
        return null;
      }
    },
  };
}

describe("zimWikiSource over the real reader", () => {
  it("finds a title a third-party ZIM really has, and reads nothing out of the LZMA cluster it cannot decompress", async () => {
    // openZIM's Belarusian Wikibooks pack: 118 entries, a title index, five
    // redirects - and every content entry in a format-5 LZMA cluster, which this
    // build refuses by name (ADR-098, `fixtures/README.md`). So the title search
    // is a real answer about a real file and the article is an honest empty one.
    const reader = ZimReader.open(FIXTURE);
    try {
      const wiki = zimWikiSource(hostOverReader({ id: "wikibooks-be", language: "bel", reader }));

      const titles = await wiki.searchTitles("Кава", 5, NEVER);
      expect(titles).toEqual([
        { path: "wikibooks-be/A/Кава.html", title: "Кава" },
      ]);
      expect(await wiki.readArticle(titles[0]?.path ?? "", NEVER)).toBe("");
      expect(await wiki.readArticle("wikibooks-be/A/No_such_entry.html", NEVER)).toBe("");
      expect(await wiki.readArticle("no-library-at-all", NEVER)).toBe("");
    } finally {
      reader.close();
    }
  });

  it("reads a lead out of an article the real reader can serve", async () => {
    // The fixture cannot prove the reading half - every byte of its prose is in
    // an LZMA cluster - so this half is a file the repository's own ZIM builder
    // writes, opened by the same reader. The article's title is Cyrillic, so the
    // question is asked the way a Serbian user would type it.
    const article = new TextEncoder().encode(
      [
        '<h1 id="firstHeading">Никола Тесла</h1>',
        '<table class="infobox"><tr><td>Рођен</td><td>10. јул 1856.</td></tr></table>',
        "<p><b>Никола Тесла</b> (Смиљан, 10. јул 1856) био је српски проналазач.</p>",
        "<h2>Биографија</h2><p>Рођен је у Смиљану.</p>",
      ].join(""),
    );
    const file = buildZim({
      entries: [
        { namespace: "A", path: "Никола_Тесла.html", title: "Никола Тесла", mime: "text/html", cluster: 0, blob: 0 },
        { namespace: "A", path: "Тесла.html", title: "Тесла", mime: "text/html", cluster: 0, blob: 1 },
        // The Latin spelling most Serbian wikis keep as a redirect, so the read
        // path is exercised through `resolve`'s redirect following rather than
        // only against the entry the bytes are stored in.
        { namespace: "A", path: "Nikola_Tesla.html", title: "Nikola Tesla", target: 0 },
      ],
      clusters: [{ blobs: [article, new TextEncoder().encode("<p>Тесла може бити:</p>")], compression: "none" }],
      mainPage: 0,
    });

    const dir = mkdtempSync(join(tmpdir(), "nexus-zim-wiki-"));
    const path = join(dir, "wikipedia-sr-mini.zim");
    writeFileSync(path, file);
    const reader = ZimReader.open(path);
    try {
      const wiki = zimWikiSource(hostOverReader({ id: "wikipedia-sr-mini", language: "srp", reader }));

      const titles = await wiki.searchTitles("Ko je bio Nikola Tesla?", 5, NEVER);
      // Both titles a Latin question reaches in this file, in the app's script.
      // Their ORDER is the fake host's business, not this file's: the Latin
      // redirect resolves to the same entry the Cyrillic key finds, so which
      // bucket claims it depends on which key was asked first.
      expect([...titles].map((title) => title.title).sort()).toEqual(["Nikola Tesla", "Tesla"]);

      const article = await wiki.readArticle("wikipedia-sr-mini/A/Никола_Тесла.html", NEVER);
      // The title, both paragraphs and the section heading - and nothing of the
      // infobox, which is where "10. јул 1856." also sits. Read in the app's
      // script, because this library is Serbian.
      expect(article).toBe(
        [
          "# Nikola Tesla",
          "Nikola Tesla (Smiljan, 10. jul 1856) bio je srpski pronalazač.",
          "## Biografija",
          "Rođen je u Smiljanu.",
        ].join("\n\n"),
      );
      expect(leadSection(article, 2_000)).toBe(
        "Nikola Tesla (Smiljan, 10. jul 1856) bio je srpski pronalazač.",
      );
      // The redirect entry answers with the article it points at - the same
      // bytes the reader resolves to for the path the bytes are stored in.
      expect(await wiki.readArticle("wikipedia-sr-mini/A/Nikola_Tesla.html", NEVER)).toBe(article);
    } finally {
      reader.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
