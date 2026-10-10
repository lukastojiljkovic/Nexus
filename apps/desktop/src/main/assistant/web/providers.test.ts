import { describe, expect, it } from "vitest";

import type { WebConfig } from "./gate.js";
import { WEB_LIMITS } from "./limits.js";
import {
  braveSearchRequest,
  buildSearchPlan,
  isWebProviderId,
  normalizeQuery,
  parseBraveSearch,
  parseSearxngSearch,
  parseWikipediaSearch,
  requestHost,
  searxngSearchRequest,
  WEB_PROVIDER_IDS,
  WEB_USER_AGENT,
  wikipediaSearchRequest,
} from "./providers.js";

/**
 * The three providers, as a request builder and a response parser each.
 *
 * The fixtures are the SHAPES the providers' own documentation and their live
 * replies have; the numbers and the field names were checked against a real
 * reply while this was written, and each expectation below says which part of
 * the reply it is about. Nothing here reaches the network.
 */

const ON: WebConfig = { enabled: true, searxng: null };

/** A Wikipedia `action=query&list=search` reply in `formatversion=2`, trimmed to two rows. */
const WIKIPEDIA_REPLY = JSON.stringify({
  batchcomplete: true,
  query: {
    searchinfo: { totalhits: 12461 },
    search: [
      {
        ns: 0,
        title: "Vodonik-peroksid",
        pageid: 402281,
        size: 4643,
        wordcount: 392,
        snippet:
          '<span class="searchmatch">Vodonik</span>-peroksid (H2O2) je plavi\u010dasto jedinjenje <span class="searchmatch">vodonika</span> i kiseonika.',
        timestamp: "2025-04-11T15:34:03Z",
      },
      { ns: 0, title: "Vodonik-selenid", pageid: 572533, snippet: "H2Se je bezbojan gas &amp; zapaljiv." },
      { ns: 0, title: "Bez stranice", snippet: "nema pageid, pa se odbacuje" },
      { ns: 0, pageid: 1, snippet: "nema naslova, pa se odbacuje" },
    ],
  },
});

describe("the Wikipedia provider", () => {
  it("builds the documented search call, with the wiki from the locale", () => {
    expect(wikipediaSearchRequest("vodonik peroksid", "sr").url).toBe(
      "https://sr.wikipedia.org/w/api.php?action=query&list=search&srsearch=vodonik+peroksid&srlimit=8&format=json&formatversion=2",
    );
    expect(wikipediaSearchRequest("hydrogen", "en").url).toContain("https://en.wikipedia.org/w/api.php?");
    // `formatversion=2` is pinned rather than left to the API's default: the
    // parser below reads exactly one of the two shapes.
    expect(wikipediaSearchRequest("x", "sr").url).toContain("formatversion=2");
  });

  it("sends the User-Agent Wikimedia's policy asks for, on this and every other request", () => {
    // „Scripts should use an informative User-Agent string with contact
    // information, or they may be blocked without notice."
    // (https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy)
    const policy = /^[^/]+\/[^\s]+ \(https:\/\/[^;]+; [^)]+\)$/;
    expect(WEB_USER_AGENT).toMatch(policy);
    expect(wikipediaSearchRequest("x", "sr").headers["user-agent"]).toBe(WEB_USER_AGENT);
    expect(searxngSearchRequest("x", "https://searx.example.org").headers["user-agent"]).toBe(WEB_USER_AGENT);
    expect(braveSearchRequest("x", "KEY", "en").headers["user-agent"]).toBe(WEB_USER_AGENT);
  });

  it("reads the reply, strips the search-match spans and skips rows without an id or a title", () => {
    expect(parseWikipediaSearch(WIKIPEDIA_REPLY, "sr")).toEqual([
      {
        title: "Vodonik-peroksid",
        url: "https://sr.wikipedia.org/?curid=402281",
        snippet: "Vodonik-peroksid (H2O2) je plavi\u010dasto jedinjenje vodonika i kiseonika.",
      },
      {
        title: "Vodonik-selenid",
        url: "https://sr.wikipedia.org/?curid=572533",
        snippet: "H2Se je bezbojan gas & zapaljiv.",
      },
    ]);
    // The same page id on another wiki is another URL, and the wiki is the
    // caller's locale rather than anything in the reply.
    expect(parseWikipediaSearch(WIKIPEDIA_REPLY, "en")[0]?.url).toBe("https://en.wikipedia.org/?curid=402281");
  });

  it("answers nothing for a reply in the API's other shape, or for one that is not JSON", () => {
    // Version 1 keys `query.search` by index; the request pins version 2, and a
    // reply that arrives in the other shape is read as no results rather than
    // as garbage.
    const v1 = JSON.stringify({ query: { search: { "0": { title: "x", pageid: 1 } } } });
    expect(parseWikipediaSearch(v1, "sr")).toEqual([]);
    for (const body of ["", "<html>not json</html>", "null", "[]", '{"query":null}', '{"query":{"search":null}}']) {
      expect(parseWikipediaSearch(body, "sr"), body).toEqual([]);
    }
  });
});

describe("the SearXNG provider", () => {
  it("asks the configured instance for JSON", () => {
    expect(searxngSearchRequest("vodonik", "https://searx.example.org").url).toBe(
      "https://searx.example.org/search?q=vodonik&format=json",
    );
    expect(searxngSearchRequest("vodonik", "https://searx.example.org:8443").url).toBe(
      "https://searx.example.org:8443/search?q=vodonik&format=json",
    );
  });

  it("reads results[] and drops a row whose URL is not https, which nothing could open", () => {
    const body = JSON.stringify({
      query: "vodonik",
      results: [
        { title: "Prvi", url: "https://a.example/x", content: "tekst o vodoniku" },
        { title: "Nesiguran", url: "http://b.example/x", content: "baca se" },
        { title: "Bez adrese", content: "baca se" },
        { title: "Relativan", url: "/x", content: "baca se" },
      ],
    });
    expect(parseSearxngSearch(body)).toEqual([
      { title: "Prvi", url: "https://a.example/x", snippet: "tekst o vodoniku" },
    ]);
  });

  it("keeps at most the result cap and tolerates a reply with none", () => {
    const many = JSON.stringify({
      results: Array.from({ length: 20 }, (_value, index) => ({
        title: `r${String(index)}`,
        url: `https://example.org/${String(index)}`,
        content: "x",
      })),
    });
    expect(parseSearxngSearch(many)).toHaveLength(WEB_LIMITS.searchResults);
    expect(parseSearxngSearch("{}")).toEqual([]);
    expect(parseSearxngSearch("not json")).toEqual([]);
  });
});

describe("the Brave provider", () => {
  it("puts the key in the documented header and NEVER in the URL", () => {
    const request = braveSearchRequest("vodonik", "BSA-key-123456", "sr");
    expect(request.url).toBe(
      "https://api.search.brave.com/res/v1/web/search?q=vodonik&count=8&search_lang=sr",
    );
    expect(request.url).not.toContain("BSA-key-123456");
    expect(request.headers["x-subscription-token"]).toBe("BSA-key-123456");
    expect(request.headers["accept"]).toBe("application/json");
  });

  it("reads web.results[] and drops what could not be opened", () => {
    const body = JSON.stringify({
      web: {
        results: [
          { title: "Hydrogen", url: "https://en.wikipedia.org/wiki/Hydrogen", description: "A gas." },
          { title: "Insecure", url: "http://insecure.example/x", description: "dropped" },
        ],
      },
    });
    expect(parseBraveSearch(body)).toEqual([
      { title: "Hydrogen", url: "https://en.wikipedia.org/wiki/Hydrogen", snippet: "A gas." },
    ]);
    expect(parseBraveSearch("{}")).toEqual([]);
  });
});

describe("the plan behind a web.search call", () => {
  it("knows the three providers and no fourth", () => {
    expect(WEB_PROVIDER_IDS).toEqual(["wikipedia", "searxng", "brave"]);
    expect(isWebProviderId("wikipedia")).toBe(true);
    expect(isWebProviderId("duckduckgo")).toBe(false);
    expect(isWebProviderId(42)).toBe(false);
  });

  it("normalises a query and refuses one that is empty or too long", () => {
    expect(normalizeQuery("  vodonik \n peroksid  ")).toBe("vodonik peroksid");
    expect(normalizeQuery("")).toBeNull();
    expect(normalizeQuery("   ")).toBeNull();
    expect(normalizeQuery(42)).toBeNull();
    expect(normalizeQuery("x".repeat(WEB_LIMITS.queryChars))).toBe("x".repeat(WEB_LIMITS.queryChars));
    expect(normalizeQuery("x".repeat(WEB_LIMITS.queryChars + 1))).toBeNull();
  });

  it("defaults to Wikipedia and needs neither an instance nor a key", () => {
    const plan = buildSearchPlan("wikipedia", "vodonik", "sr", ON, null);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.request.url).toContain("https://sr.wikipedia.org/w/api.php");
  });

  it("refuses searxng with no instance and brave with no key, without asking the user anything", () => {
    expect(buildSearchPlan("searxng", "x", "sr", ON, null)).toEqual({ ok: false, problem: "not-configured" });
    expect(buildSearchPlan("brave", "x", "sr", ON, null)).toEqual({ ok: false, problem: "no-key" });

    const searxng = buildSearchPlan("searxng", "x", "sr", { enabled: true, searxng: "https://s.example.org" }, null);
    expect(searxng.ok).toBe(true);
    if (searxng.ok) expect(searxng.request.url).toBe("https://s.example.org/search?q=x&format=json");

    const brave = buildSearchPlan("brave", "x", "en", ON, "KEY");
    expect(brave.ok).toBe(true);
    if (brave.ok) expect(brave.request.headers["x-subscription-token"]).toBe("KEY");
  });

  it("refuses a query before it builds anything", () => {
    expect(buildSearchPlan("wikipedia", "", "sr", ON, null)).toEqual({ ok: false, problem: "query" });
    expect(buildSearchPlan("wikipedia", 7, "sr", ON, null)).toEqual({ ok: false, problem: "query" });
  });

  it("names the host a confirm line will show", () => {
    expect(requestHost("https://sr.wikipedia.org/w/api.php?x=1")).toBe("sr.wikipedia.org");
    expect(requestHost("https://searx.example.org:8443/search?q=x")).toBe("searx.example.org:8443");
    expect(requestHost("not a url")).toBe("not a url");
  });
});
