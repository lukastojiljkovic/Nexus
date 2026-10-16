import { describe, expect, it } from "vitest";
import { parseBookmarksHtml, translateBookmarks, type ParsedBookmarks } from "./bookmarksImport.js";
import { renderNoteMarkdown } from "./noteMarkdown.js";

const HEADER = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
`;

function parsed(text: string): ParsedBookmarks {
  const result = parseBookmarksHtml(text);
  if (result.status !== "ok") throw new Error(`expected a parse, got ${result.code}`);
  return result.bookmarks;
}

describe("parseBookmarksHtml", () => {
  it("keeps every folder's links in file order, with nested folders named by their path", () => {
    const text = `${HEADER}
    <DT><H3 ADD_DATE="1">Work</H3>
    <DL><p>
        <DT><A HREF="https://example.com/a" ADD_DATE="2">Alpha</A>
        <DT><H3>Docs</H3>
        <DL><p>
            <DT><A HREF="http://example.org/b">Beta</A>
        </DL><p>
        <DT><A HREF="https://example.com/c">Gamma</A>
    </DL><p>
    <DT><A HREF="https://example.net/root">Root link</A>
</DL><p>
`;
    const { folders, bookmarks, skips } = parsed(text);

    expect(bookmarks).toBe(4);
    expect(skips).toEqual([]);
    expect(folders).toEqual([
      { path: [], bookmarks: [{ title: "Root link", url: "https://example.net/root" }] },
      {
        path: ["Work"],
        bookmarks: [
          { title: "Alpha", url: "https://example.com/a" },
          { title: "Gamma", url: "https://example.com/c" },
        ],
      },
      { path: ["Work", "Docs"], bookmarks: [{ title: "Beta", url: "http://example.org/b" }] },
    ]);
  });

  it("decodes entities in titles and URLs, and leaves an impossible code point as written", () => {
    const text = `${HEADER}
<DT><A HREF="https://example.com/search?a=1&amp;b=2">Tom &amp; Jerry &#39;99 &#x41;&#x110000;</A>
</DL><p>
`;
    const [root] = parsed(text).folders;
    expect(root?.bookmarks).toEqual([
      { title: "Tom & Jerry '99 A&#x110000;", url: "https://example.com/search?a=1&b=2" },
    ]);
  });

  it("keeps a URL whose quoted attribute holds a '>' intact", () => {
    const text = `${HEADER}<DT><A HREF="https://example.com/a?x=>y">Arrow</A>\n</DL><p>\n`;
    expect(parsed(text).folders[0]?.bookmarks).toEqual([{ title: "Arrow", url: "https://example.com/a?x=>y" }]);
  });

  it("skips every scheme that is not http or https, and counts them", () => {
    const text = `${HEADER}
<DT><A HREF="javascript:alert(1)">Script</A>
<DT><A HREF="data:text/html,hi">Data</A>
<DT><A HREF="file:///C:/secret.txt">Local</A>
<DT><A HREF="place:sort=8&maxResults=10">Places query</A>
<DT><A HREF="relative/page.html">Relative</A>
<DT><A HREF="https://example.com/ok">Kept</A>
</DL><p>
`;
    const { bookmarks, skips, folders } = parsed(text);
    expect(bookmarks).toBe(1);
    expect(skips).toEqual([{ code: "unsupported-url", count: 5 }]);
    expect(folders[0]?.bookmarks).toEqual([{ title: "Kept", url: "https://example.com/ok" }]);
  });

  it("names a link with no text by its URL, and drops an anchor with no href", () => {
    const text = `${HEADER}<DT><A HREF="https://example.com/untitled"></A>\n<DT><A NAME="anchor">no href</A>\n</DL><p>\n`;
    expect(parsed(text).folders[0]?.bookmarks).toEqual([
      { title: "https://example.com/untitled", url: "https://example.com/untitled" },
    ]);
  });

  it("reads a malformed file as far as it goes: unclosed tags, a stray </DL>, a missing </H3>", () => {
    const text = `<DL>
<DT><H3>Unclosed
<DT><A HREF="https://example.com/one">One
</DL></DL></DL>
<DT><A HREF="https://example.com/two">Two
`;
    const { folders, bookmarks } = parsed(text);
    expect(bookmarks).toBe(2);
    // The stray closings never pop the top level, and nothing is lost to them.
    expect(folders.flatMap((folder) => folder.bookmarks.map((bookmark) => bookmark.url)).sort()).toEqual([
      "https://example.com/one",
      "https://example.com/two",
    ]);
  });

  it("refuses text with no <DL> in it as not a bookmark file", () => {
    expect(parseBookmarksHtml("<html><body><p>Hello</p></body></html>")).toEqual({
      status: "failed",
      code: "not-bookmarks",
    });
    expect(parseBookmarksHtml("")).toEqual({ status: "failed", code: "not-bookmarks" });
  });

  it("reads a 5,000-bookmark file well inside the one-second budget", () => {
    const links = Array.from(
      { length: 5000 },
      (_, index) => `<DT><A HREF="https://example.com/page/${index}">Page ${index}</A>`,
    ).join("\n");
    const started = performance.now();
    const { bookmarks } = parsed(`${HEADER}${links}\n</DL><p>\n`);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(bookmarks).toBe(5000);
  });
});

describe("translateBookmarks", () => {
  const target = { profileId: "profile-b", now: "2026-10-15T10:00:00.000Z", tagName: "Obeleživači", rootTitle: "Obeleživači" };

  it("writes one note per folder, titled by its path, all under the one tag", () => {
    const bookmarks = parsed(`${HEADER}
<DT><H3>Work</H3>
<DL><p>
    <DT><H3>Docs</H3>
    <DL><p>
        <DT><A HREF="https://example.org/b">Beta</A>
    </DL><p>
    <DT><A HREF="https://example.com/a">Alpha</A>
</DL><p>
<DT><A HREF="https://example.net/root">Root</A>
</DL><p>
`);
    const data = translateBookmarks(bookmarks, target);

    expect(data.notes.map((note) => note.title)).toEqual(["Obeleživači", "Work", "Work / Docs"]);
    expect(data.notes.every((note) => note.profileId === "profile-b" && note.createdAt === target.now)).toBe(true);
    expect(data.noteTags).toEqual([
      { id: "bookmarks:tag", profileId: "profile-b", name: "Obeleživači", createdAt: target.now },
    ]);
    expect(data.noteTagLinks).toEqual(data.notes.map((note) => ({ noteId: note.id, tagId: "bookmarks:tag" })));
    // Nothing else is planned: a bookmark file carries no other module.
    expect(data.tasks).toEqual([]);
    expect(data.events).toEqual([]);
  });

  it("writes each folder's links as a markdown list under its title", () => {
    const data = translateBookmarks(
      parsed(`${HEADER}<DT><H3>Work</H3>\n<DL><p>\n<DT><A HREF="https://example.com/a">Alpha & co</A>\n<DT><A HREF="https://example.com/c">Gamma</A>\n</DL><p>\n</DL><p>\n`),
      target,
    );
    const [note] = data.notes;
    expect(note?.snapshot).not.toBeNull();
    const markdown = renderNoteMarkdown(note?.snapshot ?? new Uint8Array(), { attachments: new Map(), rootPrefix: "" });
    expect(markdown).toContain("# Work");
    expect(markdown).toContain("- [Alpha & co](https://example.com/a)");
    expect(markdown).toContain("- [Gamma](https://example.com/c)");
    expect(markdown.indexOf("Alpha")).toBeLessThan(markdown.indexOf("Gamma"));
  });

  it("plans no tag and no note for a file with nothing kept", () => {
    const data = translateBookmarks(parsed(`${HEADER}<DT><A HREF="javascript:void(0)">Only script</A>\n</DL><p>\n`), target);
    expect(data.notes).toEqual([]);
    expect(data.noteTags).toEqual([]);
    expect(data.noteTagLinks).toEqual([]);
  });
});
