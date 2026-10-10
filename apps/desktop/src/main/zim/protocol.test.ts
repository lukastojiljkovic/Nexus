import { describe, expect, it } from "vitest";

import { ZIM_CSP, isHtmlMime, parseZimRequest, zimResponseHeaders } from "./protocol.js";

/**
 * The address rules of `nx-zim://`, which are the whole of the boundary between a
 * document in an iframe and a file on disk: the host names a library this
 * machine knows, and the path names an entry inside it.
 */
describe("nx-zim:// addresses", () => {
  it("reads a library and an entry out of a URL", () => {
    expect(parseZimRequest("nx-zim://wikipedia-sr-mini/C/Kafa")).toEqual({
      libraryId: "wikipedia-sr-mini",
      zimPath: "C/Kafa",
    });
    // Percent-encoded, which is what the iframe's loader will send for a
    // Serbian or Cyrillic title.
    expect(parseZimRequest("nx-zim://lib/A/Першая%20старонка.html")?.zimPath).toBe(
      "A/Першая старонка.html",
    );
    // A fragment is a link inside the document, not a different entry.
    expect(parseZimRequest("nx-zim://lib/A/Kafa#Istorija")?.zimPath).toBe("A/Kafa");
  });

  it("refuses an address that names no entry, or no library this app could have", () => {
    expect(parseZimRequest("nx-zim://lib/")).toBeNull();
    expect(parseZimRequest("nx-zim://lib")).toBeNull();
    expect(parseZimRequest("nx-zim://UPPER/C/Kafa")).toBeNull();
    expect(parseZimRequest("nx-zim://lib/Z/Kafa")).toBeNull();
  });

  it("resolves a dot segment the way the URL standard does, in both spellings", () => {
    // A dot segment never reaches the rule: the WHATWG URL parser resolves `..`
    // AND its percent-encoded spelling `%2e%2e`, exactly as it does for an http
    // address, so the request this code is handed is already `M/Title` — one
    // entry inside the library, and not a path that climbed anywhere. There is
    // nothing to escape TO: no path is ever joined onto a filesystem here.
    // `paths.ts` still refuses a dot segment, which is the rule for a path that
    // arrives by another route (the page's own toolbar), and `paths.test.ts`
    // drives it directly.
    expect(parseZimRequest("nx-zim://lib/C/../M/Title")).toEqual({
      libraryId: "lib",
      zimPath: "M/Title",
    });
    expect(parseZimRequest("nx-zim://lib/C/%2e%2e/M/Title")).toEqual({
      libraryId: "lib",
      zimPath: "M/Title",
    });
    // A path with no namespace at all is refused, which is the shape a
    // normalising parser leaves behind for `lib//foo`.
    expect(parseZimRequest("nx-zim://lib//foo")).toBeNull();
  });

  it("refuses every other scheme, so this handler can never be a file reader", () => {
    expect(parseZimRequest("file:///C:/Users/x/secret.txt")).toBeNull();
    expect(parseZimRequest("nx-blob://abc")).toBeNull();
    expect(parseZimRequest("https://example.com/C/Kafa")).toBeNull();
    expect(parseZimRequest("not a url")).toBeNull();
  });
});

describe("what a served entry carries", () => {
  it("gives a document the narrowest policy that still renders an article", () => {
    const headers = zimResponseHeaders("text/html");
    expect(headers["content-security-policy"]).toBe(ZIM_CSP);
    // The four directives that matter, asserted by name rather than by the whole
    // string: a policy that lost `script-src` would still be a policy.
    expect(ZIM_CSP).toContain("script-src 'none'");
    expect(ZIM_CSP).toContain("connect-src 'none'");
    expect(ZIM_CSP).toContain("object-src 'none'");
    expect(ZIM_CSP).toContain("img-src nx-zim: data:");
    // Nothing remote, in any directive: `https:` must not appear at all.
    expect(ZIM_CSP).not.toContain("https:");
    expect(ZIM_CSP).not.toContain("http:");
  });

  it("gives an image no policy to read and the same no-store", () => {
    const headers = zimResponseHeaders("image/png");
    expect(headers["content-security-policy"]).toBeUndefined();
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["content-type"]).toBe("image/png");
  });

  it("recognises the document types a pack writes", () => {
    expect(isHtmlMime("text/html")).toBe(true);
    expect(isHtmlMime("text/html; charset=utf-8")).toBe(true);
    expect(isHtmlMime("application/xhtml+xml")).toBe(true);
    expect(isHtmlMime("image/png")).toBe(false);
    expect(isHtmlMime("text/plain")).toBe(false);
  });
});
