import { describe, expect, it } from "vitest";

import { ALLOWLIST, EGRESS_RULES, scanRepo, scanSource } from "./check-egress.mjs";

const ids = (findings) => findings.map((f) => f.rule).sort();

// The lexer this gate depends on moved to `strip-comments.mjs` when `check:elec`
// turned out to need the same one; its four tests moved with it, unchanged, to
// `strip-comments.test.mjs`. What stays here is this gate's own behaviour.

describe("the rules catch what they are for", () => {
  const cases = [
    ["fetch", 'await fetch("/x")'],
    ["global-fetch", 'await globalThis.fetch("/x")'],
    ["electron-net-fetch", "await net.fetch(url, init)"],
    ["xhr", "const r = new XMLHttpRequest()"],
    ["beacon", 'navigator.sendBeacon("/collect", body)'],
    ["eventsource", 'const es = new EventSource("/stream")'],
    ["websocket", 'const s = new WebSocket(url)'],
    ["webtransport", 'const t = new WebTransport(url)'],
    ["rtc", "const pc = new RTCPeerConnection()"],
    ["image-src", 'new Image().src = leak'],
    ["preconnect", '<link rel="preconnect" href={h} />'],
    ["node-http", 'import { request } from "node:https";'],
    ["node-require", 'const dgram = require("node:dgram");'],
    ["node-dns", 'import { lookup } from "node:dns/promises";'],
    ["electron-net", 'net.request({ url })'],
    ["remote-import", 'const m = await import("https://esm.sh/x")'],
    ["css-remote", '@import url("https://fonts.example/x.css");'],
    ["src-assign", 'el.src = "https://tracker.example/p.gif"'],
    ["load-remote", 'win.loadURL("https://example.com")'],
  ];

  for (const [id, source] of cases) {
    it(`catches ${id}`, () => {
      expect(ids(scanSource("some/file.ts", source))).toContain(id);
    });
  }

  it("has a test for every rule, so a new rule cannot arrive untested", () => {
    // The rule that keeps this file honest. Adding a rule to EGRESS_RULES
    // without a case above fails here rather than silently shipping a pattern
    // nobody has ever seen match.
    expect(EGRESS_RULES.map((r) => r.id).sort()).toEqual([...new Set(cases.map(([id]) => id))].sort());
  });
});

describe("the rules do NOT fire on data", () => {
  it("ignores a remote URL stored or rendered as content", () => {
    // The 27 false positives the first version produced: a link href in a
    // markdown round-trip test, a canvas card fixture, the USDA citation on a
    // food in the public-domain catalogue. None is a request.
    for (const source of [
      'text("Nexus", { link: "https://example.com" })',
      'source: { kind: "usda", url: "https://fdc.nal.usda.gov/food-details/170393" }',
      'expect(canvasCardView("https://example.com", r)).toEqual({ state: "foreign" })',
      'const NOTE = `https://note/${id}`;',
    ]) {
      expect(scanSource("some/file.test.ts", source)).toEqual([]);
    }
  });

  it("ignores prose that merely names an egress construct", () => {
    // `strings.sr.ts` describes the guarantee („contains no fetch,
    // XMLHttpRequest…") and a JSDoc says „in one fetch (ADR-029)" about an IPC
    // round trip. A gate that fires on a description of itself is a gate people
    // learn to scroll past.
    const source = [
      "//  - `offline` — apps/desktop/src contains no fetch, XMLHttpRequest,",
      "/** Everything the task rail draws, in one fetch (ADR-029). */",
    ].join("\n");
    expect(scanSource("some/file.ts", source)).toEqual([]);
  });

  it("ignores a loopback URL, which is the dev server and never egress", () => {
    expect(scanSource("some/file.ts", 'win.loadURL("http://localhost:5173")')).toEqual([]);
  });

  it("ignores an injected transport port, which is the seam and not the socket", () => {
    // `main/sync/port.ts` calls whatever it was handed. Firing here would force
    // an exemption on the one file whose purity is the thing worth checking, and
    // then on every port after it — see the `fetch` rule's own comment.
    for (const source of [
      "return options.fetch({ url, method, headers, body });",
      "await deps.ports.http({ path, method });",
      "const response = await this.fetch(request);",
    ]) {
      expect(scanSource("some/file.ts", source)).toEqual([]);
    }
  });

  it("still fires on the global reached through a name that only looks like a port", () => {
    // The two ways round the narrowed rule, both of them real sockets.
    expect(ids(scanSource("some/file.ts", "await window.fetch(url)"))).toContain("global-fetch");
    expect(ids(scanSource("some/file.ts", "await self.fetch(url)"))).toContain("global-fetch");
    // And a destructured port, which at the call site IS the global as far as
    // anything reading the line can tell. `createAuthPort` names its parameter
    // `send` for exactly this reason.
    expect(ids(scanSource("some/file.ts", "const { fetch } = deps;\nawait fetch(request);"))).toContain(
      "fetch",
    );
  });
});

describe("the allowlist is an allowlist", () => {
  it("exempts only the named rule, not the whole file", () => {
    const file = "apps/desktop/src/main/net/offline.test.ts";
    expect(ALLOWLIST.get(file)).toContain("websocket");
    // The test of the blocker may construct a WebSocket; it may still not fetch.
    expect(ids(scanSource(file, 'await fetch("https://x/y")'))).toContain("fetch");
    expect(scanSource(file, "new WebSocket(url)")).toEqual([]);
  });

  it("names only rules that exist, so an exemption cannot quietly mean nothing", () => {
    // This used to be false: three entries exempted "absolute-url", a rule id
    // split into four narrower ones long ago. An unknown id exempts nothing, so
    // the gate stayed correct — but the file read as though something had been
    // decided, and the day a rule took that name it would have started
    // exempting three files nobody re-examined.
    const known = new Set(EGRESS_RULES.map((rule) => rule.id));
    const unknown = [...ALLOWLIST].flatMap(([path, exempt]) =>
      exempt.filter((id) => !known.has(id)).map((id) => `${path}:${id}`),
    );
    expect(unknown).toEqual([]);
  });

  it("does not extend to a neighbouring file", () => {
    expect(ids(scanSource("apps/desktop/src/main/net/other.ts", 'el.src = "https://x/y"'))).toContain(
      "src-assign",
    );
  });
});

describe("the repository itself", () => {
  it("is clean end to end", () => {
    // The assertion the CLI makes, run here so a red gate is a red TEST — the
    // form people actually notice — and not only a red pipeline step.
    expect(scanRepo()).toEqual([]);
  });
});

// ADR-097: the assistant's web service is the second egress path, and its
// exemption has to stay exactly one file wide. These assertions exist because
// the interesting failure is not "somebody added a socket" - that is what the
// other rules catch - but "somebody added a socket to a file NEXT TO the one
// that is allowed to have one", which would leave the module looking unchanged
// while the boundary moved from "one socket behind a gate" to "a socket wherever
// it is convenient".
describe("the assistant's web service (ADR-097)", () => {
  const WEB_DIR = "apps/desktop/src/main/assistant/web/";

  it("exempts its one socket file, for both of the rule ids that file earns", () => {
    expect(ALLOWLIST.get(`${WEB_DIR}transport.ts`)).toEqual(["node-http", "node-dns"]);
    // And the new DNS rule really is what catches a lookup, which is the half of
    // that exemption a reader cannot see from the entry alone.
    expect(ids(scanSource("some/file.ts", 'import { lookup } from "node:dns/promises";'))).toContain("node-dns");
    expect(ids(scanSource("some/file.ts", 'import { lookup } from "node:dns";'))).toContain("node-dns");
  });

  it("does not extend to the files that decide what may be requested", () => {
    for (const file of ["index.ts", "fetch.ts", "gate.ts", "target.ts", "providers.ts", "secrets.ts", "electron.ts"]) {
      const path = `${WEB_DIR}${file}`;
      expect(ALLOWLIST.has(path), path).toBe(false);
      expect(ids(scanSource(path, 'import { request } from "node:https";')), path).toContain("node-http");
      expect(ids(scanSource(path, 'import { lookup } from "node:dns/promises";')), path).toContain("node-dns");
      // Including the global, which is the substitution that would bypass this
      // gate's own record of where the socket is.
      expect(ids(scanSource(path, 'await fetch("https://example.org/")')), path).toContain("fetch");
    }
  });
});
