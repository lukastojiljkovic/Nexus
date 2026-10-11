import { describe, expect, it } from "vitest";

import { charsetFor, charsetOf, createWebFetcher, decodeText, type WebHttp, type WebHttpResponse } from "./fetch.js";
import type { WebConfig } from "./gate.js";
import type { AddressResolver, ResolvedAddress, VettedTarget } from "./target.js";

/**
 * The one vetted GET, on fixtures: the redirect chain, the caps and the charset.
 *
 * The transport is a table of canned replies here, and the resolver is a table
 * of addresses, which is what makes each of these cases about ONE rule: a `302`
 * to `http:` is a redirect case, `169.254.169.254` is an address case, and
 * neither of them needs a socket to be a fact.
 */

const ON: WebConfig = { enabled: true, searxng: null };

const PUBLIC: readonly ResolvedAddress[] = [{ address: "93.184.216.34", family: 4 }];

/** A resolver that answers these names and rejects every other one. */
function resolver(table: Readonly<Record<string, readonly ResolvedAddress[]>>): AddressResolver {
  return (hostname) => {
    const answers = table[hostname];
    return answers === undefined ? Promise.reject(new Error("no entry")) : Promise.resolve(answers);
  };
}

interface Recorded {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

interface FakeHttp extends WebHttp {
  readonly recorded: Recorded[];
}

/**
 * A body that fails on its first read, the way a connection reset does.
 *
 * An `AsyncIterable` rather than a throwing generator, because a generator that
 * never yields trips `require-yield` - and the faked failure is a property of
 * the ITERATOR, not of a function body that happens to be a generator.
 */
function failingBody(error: Error): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]: (): AsyncIterator<Uint8Array> => ({
      next: () => Promise.reject(error),
    }),
  };
}

/** A response whose body is one chunk, or none at all. */
function response(
  status: number,
  headers: Readonly<Record<string, string>>,
  body: string | null,
): WebHttpResponse {
  const bytes = body === null ? null : new TextEncoder().encode(body);
  return {
    status,
    header: (name) => headers[name.toLowerCase()] ?? null,
    body: bytes === null
      ? null
      : (async function* one(): AsyncGenerator<Uint8Array> {
          yield bytes;
        })(),
  };
}

/**
 * A transport that answers by URL, and records every request it was handed.
 *
 * The table is keyed by the URL as a string, so a redirect test can assert the
 * hop that was requested and not only the text that came back.
 */
function fakeHttp(handler: (target: VettedTarget) => WebHttpResponse): FakeHttp {
  const recorded: Recorded[] = [];
  return {
    recorded,
    request(target, init) {
      recorded.push({ url: target.url.toString(), headers: init.headers });
      return Promise.resolve(handler(target));
    },
  };
}

const fetcherFor = (http: WebHttp, resolve: AddressResolver) =>
  createWebFetcher({ mode: () => "downloads", config: () => ON, resolve, http });

const OPTIONS = {
  headers: { accept: "text/html" },
  signal: new AbortController().signal,
  bytes: 1024,
  timeoutMs: 1000,
};

describe("fetchText", () => {
  it("returns the body's text, its byte count and the URL it came from", async () => {
    const http = fakeHttp(() => response(200, { "content-type": "text/html; charset=utf-8" }, "<p>Vodonik</p>"));
    const outcome = await fetcherFor(http, resolver({ "example.org": PUBLIC })).fetchText(
      "https://example.org/a",
      OPTIONS,
    );
    expect(outcome).toEqual({
      ok: true,
      url: "https://example.org/a",
      status: 200,
      bytes: 14,
      text: "<p>Vodonik</p>",
    });
    expect(http.recorded).toEqual([{ url: "https://example.org/a", headers: { accept: "text/html" } }]);
  });

  it("follows a redirect after re-vetting the hop, and reports the URL the text came from", async () => {
    const http = fakeHttp((target) =>
      target.hostname === "example.org"
        ? response(302, { location: "https://moved.example/final" }, "")
        : response(200, {}, "tekst"),
    );
    const outcome = await fetcherFor(
      http,
      resolver({ "example.org": PUBLIC, "moved.example": [{ address: "1.1.1.1", family: 4 }] }),
    ).fetchText("https://example.org/a", OPTIONS);
    expect(outcome).toMatchObject({ ok: true, url: "https://moved.example/final", text: "tekst" });
    expect(http.recorded.map((entry) => entry.url)).toEqual([
      "https://example.org/a",
      "https://moved.example/final",
    ]);
  });

  it("resolves a relative Location against the hop it came from, not against the original URL", async () => {
    const http = fakeHttp((target) =>
      target.url.pathname === "/a"
        ? response(302, { location: "b/c" }, "")
        : response(200, {}, "drugi"),
    );
    const outcome = await fetcherFor(http, resolver({ "example.org": PUBLIC })).fetchText(
      "https://example.org/a",
      OPTIONS,
    );
    expect(outcome).toMatchObject({ ok: true, url: "https://example.org/b/c" });
  });

  it("refuses a redirect to http, to a private address, and to a name that resolves privately", async () => {
    const toHttp = fakeHttp(() => response(302, { location: "http://example.org/x" }, ""));
    expect(
      await fetcherFor(toHttp, resolver({ "example.org": PUBLIC })).fetchText("https://example.org/a", OPTIONS),
    ).toEqual({ ok: false, problem: "url", status: null });
    // Nothing was sent to the hop that failed: one request, the original.
    expect(toHttp.recorded).toHaveLength(1);

    const toLiteral = fakeHttp(() => response(302, { location: "https://169.254.169.254/latest/" }, ""));
    expect(
      await fetcherFor(toLiteral, resolver({ "example.org": PUBLIC })).fetchText("https://example.org/a", OPTIONS),
    ).toEqual({ ok: false, problem: "address", status: null });
    expect(toLiteral.recorded).toHaveLength(1);

    const toName = fakeHttp(() => response(302, { location: "https://internal.example/x" }, ""));
    expect(
      await fetcherFor(
        toName,
        resolver({ "example.org": PUBLIC, "internal.example": [{ address: "10.1.2.3", family: 4 }] }),
      ).fetchText("https://example.org/a", OPTIONS),
    ).toEqual({ ok: false, problem: "address", status: null });
    expect(toName.recorded).toHaveLength(1);
  });

  it("refuses a chain longer than the hop limit, and a 3xx with no Location", async () => {
    let hop = 0;
    const http = fakeHttp(() => {
      hop += 1;
      return response(302, { location: `https://example.org/${String(hop)}` }, "");
    });
    expect(
      await fetcherFor(http, resolver({ "example.org": PUBLIC })).fetchText("https://example.org/start", OPTIONS),
    ).toEqual({ ok: false, problem: "redirects", status: 302 });
    // One original request plus the hop limit, and not one more.
    expect(http.recorded).toHaveLength(6);

    const noLocation = fakeHttp(() => response(302, {}, ""));
    expect(
      await fetcherFor(noLocation, resolver({ "example.org": PUBLIC })).fetchText("https://example.org/a", OPTIONS),
    ).toEqual({ ok: false, problem: "http", status: 302 });
  });

  it("refuses a non-2xx status and keeps the status for the copy", async () => {
    const http = fakeHttp(() => response(404, {}, "nema"));
    expect(
      await fetcherFor(http, resolver({ "example.org": PUBLIC })).fetchText("https://example.org/a", OPTIONS),
    ).toEqual({ ok: false, problem: "http", status: 404 });
  });

  it("refuses a body over the cap, by the running count and by the declared length", async () => {
    const http = fakeHttp(() => response(200, {}, "x".repeat(2000)));
    expect(
      await fetcherFor(http, resolver({ "example.org": PUBLIC })).fetchText("https://example.org/a", {
        ...OPTIONS,
        bytes: 1024,
      }),
    ).toEqual({ ok: false, problem: "size", status: 200 });

    // A declared length over the cap ends the request before a byte of the body
    // is read, which is the only difference between the two refusals that a
    // test can see.
    let bodyRead = false;
    const declared: WebHttp = {
      request: () => {
        const bytes = new TextEncoder().encode("small");
        return Promise.resolve({
          status: 200,
          header: (name) => (name.toLowerCase() === "content-length" ? "99999999" : null),
          body: (async function* one(): AsyncGenerator<Uint8Array> {
            bodyRead = true;
            yield bytes;
          })(),
        });
      },
    };
    expect(
      await fetcherFor(declared, resolver({ "example.org": PUBLIC })).fetchText("https://example.org/a", OPTIONS),
    ).toEqual({ ok: false, problem: "size", status: 200 });
    expect(bodyRead).toBe(false);
  });

  it("accepts a body that is exactly the cap", async () => {
    const http = fakeHttp(() => response(200, {}, "x".repeat(1024)));
    const outcome = await fetcherFor(http, resolver({ "example.org": PUBLIC })).fetchText(
      "https://example.org/a",
      OPTIONS,
    );
    expect(outcome).toMatchObject({ ok: true, bytes: 1024 });
  });

  it("answers aborted when the caller's signal is already aborted, and sends nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const http = fakeHttp(() => response(200, {}, "x"));
    expect(
      await fetcherFor(http, resolver({ "example.org": PUBLIC })).fetchText("https://example.org/a", {
        ...OPTIONS,
        signal: controller.signal,
      }),
    ).toEqual({ ok: false, problem: "aborted", status: null });
    expect(http.recorded).toEqual([]);
  });

  it("answers aborted when the body fails under an aborted signal, and network when it does not", async () => {
    const controller = new AbortController();
    const http: WebHttp = {
      request: () => {
        controller.abort();
        return Promise.resolve({ status: 200, header: () => null, body: failingBody(new Error("reset")) });
      },
    };
    expect(
      await fetcherFor(http, resolver({ "example.org": PUBLIC })).fetchText("https://example.org/a", {
        ...OPTIONS,
        signal: controller.signal,
      }),
    ).toEqual({ ok: false, problem: "aborted", status: null });

    const broken: WebHttp = {
      request: () =>
        Promise.resolve({ status: 200, header: () => null, body: failingBody(new Error("the connection was reset")) }),
    };
    expect(
      await fetcherFor(broken, resolver({ "example.org": PUBLIC })).fetchText("https://example.org/a", OPTIONS),
    ).toEqual({ ok: false, problem: "network", status: null });
  });

  it("answers network when the transport itself refuses, and off when the switch went off mid-turn", async () => {
    const failing: WebHttp = { request: () => Promise.reject(new Error("no route")) };
    expect(
      await fetcherFor(failing, resolver({ "example.org": PUBLIC })).fetchText("https://example.org/a", OPTIONS),
    ).toEqual({ ok: false, problem: "network", status: null });

    // The switch is read per request, so a user who turns it off while a turn
    // is running stops the next hop rather than the next launch.
    let enabled = true;
    const toggling = createWebFetcher({
      mode: () => "downloads",
      config: () => ({ enabled, searxng: null }),
      resolve: resolver({ "example.org": PUBLIC }),
      http: fakeHttp(() => response(302, { location: "https://example.org/b" }, "")),
    });
    const outcome = await toggling
      .fetchText("https://example.org/a", OPTIONS)
      .then((_first) => {
        enabled = false;
        return toggling.fetchText("https://example.org/a", OPTIONS);
      });
    expect(outcome).toEqual({ ok: false, problem: "off", status: null });
  });
});

describe("the charset of a body", () => {
  it("reads the parameter out of a Content-Type header", () => {
    expect(charsetOf("text/html; charset=utf-8")).toBe("utf-8");
    expect(charsetOf('text/html; charset="windows-1252"')).toBe("windows-1252");
    expect(charsetOf("application/json")).toBeNull();
    expect(charsetOf(null)).toBeNull();
    // The header wins over the page's own meta tag, which is what the spec says.
    expect(charsetFor("text/html; charset=utf-8", new TextEncoder().encode('<meta charset="windows-1252">'))).toBe(
      "utf-8",
    );
  });

  it("sniffs a meta charset when the header says nothing, and answers null when nothing does", () => {
    expect(charsetFor("text/html", new TextEncoder().encode('<meta charset="windows-1252">x'))).toBe("windows-1252");
    expect(
      charsetFor(
        "text/html",
        new TextEncoder().encode('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-2">'),
      ),
    ).toBe("iso-8859-2");
    expect(charsetFor("text/html", new TextEncoder().encode("<p>no meta here</p>"))).toBeNull();
    expect(charsetFor(null, new Uint8Array(0))).toBeNull();
  });

  it("decodes the bytes a page actually sent, and falls back to UTF-8", () => {
    // 0xE9 is «é» in windows-1252 and an invalid byte in UTF-8.
    const latin = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
    expect(decodeText(latin, "windows-1252")).toBe("caf\u00e9");
    expect(decodeText(latin, null)).toBe("caf\uFFFD");
    expect(decodeText(latin, "not-a-charset")).toBe("caf\uFFFD");
    expect(decodeText(new TextEncoder().encode("vodonik"), "utf-8")).toBe("vodonik");
    expect(decodeText(new Uint8Array(0), "windows-1252")).toBe("");
  });
});
