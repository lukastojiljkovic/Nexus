import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config.js";

/**
 * The security policy this app ships, asserted against the file that ships it.
 *
 * WHY THIS GATE EXISTS. `public/_headers` is not code: nothing imports it,
 * nothing typechecks it, and Cloudflare's parser answers a malformed rule by
 * ignoring it rather than by refusing the deployment. A policy that lost
 * `frame-ancestors 'none'` — to a stray edit, to a merge, to a "cleanup" that
 * reflowed the long line — would deploy green, serve every page happily, and be
 * clickjackable. There is no runtime symptom to notice. That is the same shape
 * as `check-tokens`'s undefined custom property and `check-css`'s swallowed
 * rule: not a crash, a disappearance.
 *
 * So the file is parsed the way Cloudflare parses it and every directive is
 * asserted by name. Three classes of failure are covered, and they are
 * genuinely different:
 *
 *   1. **Something went missing** — a directive or a header deleted.
 *   2. **Something was widened** — `'unsafe-inline'`, a bare `'unsafe-eval'`, a
 *      `*` source, a plain-`http:` origin. Each of these is a change somebody
 *      would make to fix a console error, and each undoes a decision.
 *   3. **The policy never reached the wire** — a perfect `_headers` in a
 *      directory Cloudflare does not read is a policy that does not exist, and
 *      it fails silently in exactly the same way. The last block below is the
 *      only thing that ties the file's location to what gets served.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(HERE, "..");

// --- Reading `_headers` the way Cloudflare reads it -------------------------

/**
 * Cloudflare's real limits, from `workers-shared/utils/configuration/constants`:
 * `MAX_HEADER_RULES = 100`, `MAX_LINE_LENGTH = 2000`, `HEADER_SEPARATOR = ":"`,
 * `UNSET_OPERATOR = "! "`.
 *
 * The line limit is the one that matters here and it is not theoretical: a
 * Content-Security-Policy is a single unwrappable line that only ever grows, and
 * the one below is already 346 characters. An over-long line is not rejected —
 * `parseHeaders` pushes „Ignoring line N as it exceeds the maximum allowed
 * length" onto a list of *invalid* entries that a deploy does not fail on, and
 * serves the site with no policy at all.
 */
const MAX_HEADER_RULES = 100;
const MAX_LINE_LENGTH = 2000;

/**
 * How Cloudflare decides a line is a PATH and not a header, verbatim from
 * `parseHeaders`: `LINE_IS_PROBABLY_A_PATH = /^([^\s]+:\/\/|^\/)/`, applied to
 * the line AFTER `.trim()`.
 *
 * THIS IS NOT THE GRAMMAR THIS FILE USED TO ASSERT, and the difference is the
 * reason the parser was rewritten. The old one keyed on INDENTATION — an
 * indented line is a header, an unindented one is a path. Cloudflare trims every
 * line before looking at it, so indentation carries no meaning whatsoever; what
 * decides is whether the line starts with `/` or contains `://` before its first
 * whitespace.
 *
 * That mattered in one direction only, but it mattered a great deal. A header
 * whose VALUE begins with a URL and carries no space before it — the natural
 * shape of `Report-To: {"endpoints":[{"url":"https://…"}]}`, or of any
 * `Link:`/`Refresh:` header written compactly — matches this pattern. Cloudflare
 * classifies the whole line as a path, `validateUrl` rejects it, and from that
 * point `skipUntilNextPath` is set: EVERY REMAINING HEADER IN THE BLOCK IS
 * SILENTLY DROPPED. The old parser saw an indented line with a colon, called it
 * a header, and reported the file as perfect.
 */
const LINE_IS_PROBABLY_A_PATH = /^([^\s]+:\/\/|\/)/;

type LineKind = "comment" | "over-long" | "path" | "header" | "unset" | "malformed";

/** What Cloudflare would make of one line, in isolation. */
export function classifyLine(raw: string): LineKind {
  const line = raw.trim();
  if (line.length === 0 || line.startsWith("#")) return "comment";
  // Length is checked BEFORE the kind, exactly as `parseHeaders` does — an
  // over-long line is dropped whatever it would otherwise have been.
  if (line.length > MAX_LINE_LENGTH) return "over-long";
  if (LINE_IS_PROBABLY_A_PATH.test(line)) return "path";
  if (!line.includes(":")) return line.startsWith("! ") ? "unset" : "malformed";
  return "header";
}

interface HeaderRule {
  /** The URL pattern the rule applies to, e.g. `/*`. */
  pattern: string;
  /** Header name → value, in file order. Names are lower-cased, as Cloudflare does. */
  headers: Map<string, string>;
  /** Names this rule DELETES via `! Name`. Cloudflare's syntax; must stay empty. */
  unset: string[];
}

/**
 * The file as Cloudflare would hold it, plus the problems it would swallow.
 *
 * Nothing here throws. The old parser threw on the malformed shapes, which read
 * as strictness but cost the suite its most useful property: a thrown error at
 * module scope fails collection, so the report names a stack frame instead of
 * naming the line and the rule it broke. Cloudflare does not throw either — it
 * collects and continues — so collecting is also the more faithful model.
 */
export function parseHeadersFile(text: string): { rules: HeaderRule[]; problems: string[] } {
  const rules: HeaderRule[] = [];
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const at = `_headers:${String(index + 1)}`;
    const line = raw.trim();
    const kind = classifyLine(raw);
    if (kind === "comment") return;
    if (kind === "over-long") {
      problems.push(`${at}: ${String(line.length)} chars — over Cloudflare's ${
        String(MAX_LINE_LENGTH)
      }-character limit, so the line is dropped.`);
      return;
    }
    if (kind === "path") {
      rules.push({ pattern: line, headers: new Map(), unset: [] });
      return;
    }
    const rule = rules.at(-1);
    if (rule === undefined) {
      problems.push(`${at}: header line before any path pattern.`);
      return;
    }
    if (kind === "malformed") {
      problems.push(`${at}: neither a path nor a "name: value" pair: ${line}`);
      return;
    }
    if (kind === "unset") {
      rule.unset.push(line.slice(2).trim());
      return;
    }
    const colon = line.indexOf(":");
    // Cloudflare lower-cases the name and, for a repeat, JOINS the values with
    // ", " rather than refusing. For a CSP that produces one header holding two
    // comma-separated policies, which browsers enforce as an intersection —
    // a policy nobody wrote. So a repeat is recorded as a problem here.
    const name = line.slice(0, colon).trim().toLowerCase();
    if (rule.headers.has(name)) {
      problems.push(`${at}: ${name} is set twice in one rule; Cloudflare joins them with ", ".`);
      return;
    }
    rule.headers.set(name, line.slice(colon + 1).trim());
  });
  if (rules.length > MAX_HEADER_RULES) {
    problems.push(
      `${String(rules.length)} rules — over Cloudflare's ${String(MAX_HEADER_RULES)}-rule limit.`,
    );
  }
  return { rules, problems };
}

/**
 * `default-src 'none'; script-src 'self' …` → directive name → source list.
 *
 * A repeated directive is a hard failure and not a merge, because that is what
 * the CSP specification says a browser does with one: the FIRST occurrence
 * wins and every later one is ignored with only a console warning. Appending
 * `; connect-src …` to a policy that already has one therefore changes nothing
 * at all, which is the most convincing way to be wrong about a policy.
 */
function parseCsp(value: string): Map<string, readonly string[]> {
  const directives = new Map<string, readonly string[]>();
  for (const part of value.split(";")) {
    const tokens = part.trim().split(/\s+/).filter((token) => token.length > 0);
    const [name, ...sources] = tokens;
    if (name === undefined) continue;
    if (directives.has(name)) throw new Error(`CSP names ${name} twice; browsers keep the first.`);
    directives.set(name, sources);
  }
  return directives;
}

const headersText = readFileSync(join(APP_ROOT, "public", "_headers"), "utf8");
const { rules, problems } = parseHeadersFile(headersText);
const rule = rules[0];
/** Cloudflare lower-cases every header name; look them up the way it stores them. */
const header = (name: string): string | undefined => rule?.headers.get(name.toLowerCase());

// --- What the file must say -------------------------------------------------

/** Every header other than the CSP, with the exact value each must carry. */
const EXPECTED_HEADERS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), usb=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/**
 * Every CSP directive and its exact source list, in the order the file states
 * them. Order carries no meaning to a browser; asserting it anyway keeps the
 * failure message pointing at one line instead of at a 500-character string.
 */
const EXPECTED_CSP: readonly (readonly [string, readonly string[]])[] = [
  ["default-src", ["'none'"]],
  // 'wasm-unsafe-eval' is here for Argon2id, which runs as WebAssembly in the
  // browser: instantiating a WASM module counts as evaluation, so without it
  // the web password KDF cannot run at all. It is the NARROW form on purpose —
  // it permits WebAssembly compilation and nothing else, where 'unsafe-eval'
  // would also hand back `eval`, `new Function` and string-bodied timers. It
  // must not widen to that, and the widening guards below are what stops it.
  ["script-src", ["'self'", "'wasm-unsafe-eval'"]],
  ["style-src", ["'self'"]],
  ["img-src", ["'self'", "blob:", "data:"]],
  ["font-src", ["'self'"]],
  ["connect-src", ["https://PROJECT.supabase.co", "wss://PROJECT.supabase.co"]],
  ["worker-src", ["'self'", "blob:"]],
  ["manifest-src", ["'self'"]],
  ["base-uri", ["'none'"]],
  ["form-action", ["'none'"]],
  ["frame-ancestors", ["'none'"]],
  ["upgrade-insecure-requests", []],
];

describe("public/_headers", () => {
  it("is a file Cloudflare parses without swallowing anything", () => {
    // Every shape Cloudflare drops in silence, in one assertion: a line over
    // 2,000 characters, a line it cannot make sense of, a header repeated inside
    // one rule, more than 100 rules. None of these fails a deploy. Each is
    // reported as text so the failure names the line rather than a count.
    expect(problems).toEqual([]);
  });

  it("states exactly one rule, and it covers every path", () => {
    // One rule, `/*`: a second rule would mean some paths are governed by a
    // policy this suite never reads, and a narrower pattern would leave the
    // rest of the site with no policy at all.
    expect(rules.map((each) => each.pattern)).toEqual(["/*"]);
  });

  it("has no header line Cloudflare would mistake for a path", () => {
    // The failure this exists for is total and silent: Cloudflare classifies a
    // line as a path if it starts with `/` or holds `://` before its first
    // space, rejects it as a URL, and then SKIPS EVERY REMAINING HEADER in the
    // block. Stated separately from the parse above because it is a rule about
    // the next header somebody adds, not about the eight that are here.
    const kinds = headersText.split(/\r?\n/).map(classifyLine);
    expect(kinds.filter((kind) => kind === "path")).toHaveLength(1);
    expect(kinds).not.toContain("malformed");
    expect(kinds).not.toContain("over-long");
  });

  it("removes no header", () => {
    // `! Name` — with the space; `UNSET_OPERATOR` is `"! "` — is Cloudflare's
    // syntax for DELETING a header. Two characters in front of
    // `Content-Security-Policy` turn this whole file into a no-op while leaving
    // the policy in place for a reader to see. It parses as a colon-less line,
    // so nothing else in this suite would have noticed.
    expect(rule?.unset).toEqual([]);
  });

  it("sets exactly the agreed headers, and no others", () => {
    expect([...(rule?.headers.keys() ?? [])].sort()).toEqual(
      ["Content-Security-Policy", ...Object.keys(EXPECTED_HEADERS)]
        .map((name) => name.toLowerCase())
        .sort(),
    );
  });

  for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
    it(`sets ${name}`, () => {
      expect(header(name)).toBe(value);
    });
  }
});

describe("the Content-Security-Policy", () => {
  const csp = parseCsp(header("Content-Security-Policy") ?? "");

  for (const [directive, sources] of EXPECTED_CSP) {
    it(`states ${directive}`, () => {
      expect(csp.get(directive)).toEqual([...sources]);
    });
  }

  it("states no directive nobody agreed to", () => {
    expect([...csp.keys()]).toEqual(EXPECTED_CSP.map(([directive]) => directive));
  });

  // --- The widening guards --------------------------------------------------
  // Stated separately from the directive assertions above even though those
  // already pin every source list. They are the rules that must survive the
  // NEXT policy change too: when a directive is legitimately added a year from
  // now, the list above gets a new line and stops proving anything about it,
  // while these keep applying to whatever the policy has become.

  const everySource = [...csp.values()].flat();

  it("allows no inline script or style", () => {
    expect(everySource).not.toContain("'unsafe-inline'");
  });

  it("allows no string evaluation", () => {
    // Token equality, not a substring test: `'wasm-unsafe-eval'` CONTAINS
    // `unsafe-eval`, so a naive `includes` would either fail on the policy we
    // want or, written the other way, pass on the one we do not.
    expect(everySource).not.toContain("'unsafe-eval'");
  });

  it("allows WebAssembly compilation in script-src alone", () => {
    const withWasm = [...csp.entries()]
      .filter(([, sources]) => sources.includes("'wasm-unsafe-eval'"))
      .map(([directive]) => directive);
    expect(withWasm).toEqual(["script-src"]);
  });

  it("names no wildcard and no bare scheme host", () => {
    // `*`, `https:` and `data:` as a SCRIPT source are the three shapes that
    // turn a directive into "anything"; `data:`/`blob:` are legitimate for
    // images and workers, which is why this looks at hosts rather than at
    // schemes generally.
    expect(everySource.filter((source) => source === "*" || source === "https:")).toEqual([]);
    expect(csp.get("script-src")).not.toContain("data:");
  });

  it("names no plaintext origin", () => {
    expect(everySource.filter((source) => source.startsWith("http://"))).toEqual([]);
  });

  it("keeps the Supabase project a placeholder", () => {
    // The committed file describes the product, not one deployment. The real
    // ref is written into `dist/_headers` at build time from
    // NEXUS_SUPABASE_PROJECT_REF (build/headers.ts) — so a substituted copy
    // arriving here means someone edited the source instead of the build, and
    // the next person to deploy would ship their environment.
    expect(csp.get("connect-src")).toEqual([
      "https://PROJECT.supabase.co",
      "wss://PROJECT.supabase.co",
    ]);
  });
});

// --- Does the gate itself work? ---------------------------------------------

/**
 * The parser above is the only thing standing between a broken policy and a
 * green deploy, and a parser nobody tested is a claim. Each fixture here is a
 * real Cloudflare behaviour, written as the smallest file that triggers it —
 * and every one of them was invisible to the indentation-based parser this
 * replaced.
 */
describe("the parser these assertions run through", () => {
  it("reads a header whatever its indentation, because Cloudflare trims first", () => {
    // Both of these are the same file to Cloudflare. The old parser called the
    // second one a path pattern and reported a policy that applies to nothing.
    for (const text of ["/*\n\tX-Frame-Options: DENY\n", "/*\nX-Frame-Options: DENY\n"]) {
      const parsed = parseHeadersFile(text);
      expect(parsed.problems).toEqual([]);
      expect(parsed.rules[0]?.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  it("catches a header value that makes Cloudflare read the line as a path", () => {
    // The shape: a compact URL-bearing value with no space before the `://`.
    // Cloudflare rejects it as a URL and then skips the rest of the block, so
    // the `X-Frame-Options` below would never be served.
    const text = '/*\n\tReport-To:{"url":"https://x.example/r"}\n\tX-Frame-Options: DENY\n';
    expect(text.split("\n").map(classifyLine).filter((kind) => kind === "path")).toHaveLength(2);
  });

  it("catches a line over Cloudflare's 2,000-character limit", () => {
    const text = `/*\n\tContent-Security-Policy: ${"a".repeat(MAX_LINE_LENGTH)}\n`;
    expect(parseHeadersFile(text).problems).toHaveLength(1);
    expect(parseHeadersFile(text).rules[0]?.headers.size).toBe(0);
  });

  it("catches `! Name`, which deletes a header rather than setting one", () => {
    const parsed = parseHeadersFile("/*\n\t! Content-Security-Policy\n\tX-Frame-Options: DENY\n");
    expect(parsed.rules[0]?.unset).toEqual(["Content-Security-Policy"]);
  });

  it("catches a header repeated inside one rule", () => {
    // Cloudflare joins the two values with ", ". For a CSP that is two policies
    // in one header, enforced as an intersection — a policy nobody wrote.
    const parsed = parseHeadersFile("/*\n\tX-Frame-Options: DENY\n\tX-Frame-Options: ALLOWALL\n");
    expect(parsed.problems).toHaveLength(1);
  });

  it("catches more rules than Cloudflare will keep", () => {
    const text = `${"/a\n\tX-Frame-Options: DENY\n".repeat(MAX_HEADER_RULES + 1)}`;
    expect(parseHeadersFile(text).problems).toHaveLength(1);
  });
});

// --- Does the policy actually reach the wire? -------------------------------

/**
 * `wrangler.jsonc` with its comments removed.
 *
 * Hand-rolled rather than pulled from a JSONC package: this repository does not
 * take a dependency to read one config file, and the state machine below is the
 * whole of the format's difficulty — a `//` inside a string is not a comment,
 * and a `\"` inside a string does not end it.
 */
function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (inString) {
      out += char;
      if (char === "\\") {
        out += text[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (char === '"') inString = false;
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      index += 1;
      continue;
    }
    if (text.startsWith("//", index)) {
      const end = text.indexOf("\n", index);
      index = end === -1 ? text.length : end;
      continue;
    }
    if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return JSON.parse(out) as unknown;
}

describe("the deployment that serves it", () => {
  const wrangler = parseJsonc(readFileSync(join(APP_ROOT, "wrangler.jsonc"), "utf8")) as {
    main?: unknown;
    compatibility_date?: unknown;
    workers_dev?: unknown;
    preview_urls?: unknown;
    assets?: { directory?: unknown; not_found_handling?: unknown };
  };

  it("is not published on a hostname nobody hardened", () => {
    // `workers_dev` DEFAULTS TO TRUE, and `preview_urls` defaults to whatever
    // `workers_dev` is. Left unstated, the first `wrangler deploy` therefore
    // puts the whole app on `nexus-web.<account>.workers.dev` — an origin the
    // founder does not own, cannot put a certificate policy on, and did not
    // choose — and mints a permanent per-version preview URL beside it.
    //
    // The preview URLs are the worse half. They are stable and version-pinned,
    // so every build ever deployed stays reachable forever at its own address.
    // For a product whose entire security model is „the client is the only
    // party we trust", that is a downgrade attack served by the vendor: point a
    // victim at the preview URL of the build from before a crypto fix and it
    // runs, on the real account, against the real data.
    //
    // The README asks a human to turn this off in the dashboard AFTER the first
    // deploy. That is an instruction, and an instruction is not a control — it
    // has to be followed every time, by whoever deploys, and the window it
    // leaves open is the whole of the first deployment. Two lines of config
    // make it a property of the product instead.
    expect(wrangler.workers_dev).toBe(false);
    expect(wrangler.preview_urls).toBe(false);
  });

  it("puts `_headers` where Cloudflare looks for it", () => {
    // Cloudflare reads `_headers` from the ROOT OF THE ASSETS DIRECTORY, and
    // nowhere else. Vite gets it there by copying `publicDir` into `outDir`, so
    // three separate settings have to agree or the file is simply not deployed
    // — with no error, because as far as every tool involved is concerned
    // nothing is wrong. This is the assertion that ties them together.
    expect(viteConfig.publicDir).toBe("public");
    expect(viteConfig.build?.outDir).toBe("dist");
    expect(wrangler.assets?.directory).toBe("./dist");
  });

  it("serves assets only — there is no Worker script", () => {
    // A `main` would mean requests reach code before they reach the asset
    // handler, and code can answer without the headers this file is about.
    // There is no server-side logic in this app by design (the server is
    // assumed hostile; it holds ciphertext), so there is nothing for a Worker
    // script to do and its absence is the security property.
    expect(wrangler.main).toBeUndefined();
    expect(wrangler.compatibility_date).toEqual(expect.any(String));
  });

  it("routes unknown paths back into the app", () => {
    // Client-side routing: a deep link like `/beleske/abc` must serve the app
    // rather than a 404, which is what `single-page-application` does.
    expect(wrangler.assets?.not_found_handling).toBe("single-page-application");
  });
});
