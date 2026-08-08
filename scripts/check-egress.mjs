// No shebang, for the reason the other gates in this directory have none: this
// module is both a CLI (`node scripts/check-egress.mjs`) and an import target
// for its own tests.
//
// WHAT THIS GATE IS, AND — MORE IMPORTANTLY — WHAT IT IS NOT.
//
// It is a STYLE check. It reads source text and objects to constructs that
// reach the network. It cannot prove that the app makes no network call, and
// nothing that reads source can: the two real egress paths the security review
// found in the shipped 1.0.0 were an `esm.sh` font URL sitting in a string, and
// a dictionary download Chromium performs on its own with no call site in this
// repository at all. A grep would have caught the first and could never have
// caught the second.
//
// The ASSERTION lives at the packet layer — `apps/desktop/src/main/net/offline.ts`
// installs a request allowlist, a dead proxy and a resolver block, and
// `offline.test.ts` pins the rules. This file exists underneath that, to catch
// the case where somebody adds an egress construct in a hurry and the boundary
// is the only thing stopping it. Defence in depth means the outer layer is
// allowed to be imperfect; it does not mean it is allowed to be absent.
//
// Every rule here is scoped to a file set and every exception is named in
// source, so a green run means „nothing new", never „nothing".

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");

/** Where renderer/main/shared source lives. Tests and configs are scanned too — see `IGNORED_DIRS`. */
const SCAN_ROOTS = ["apps/desktop/src", "apps/web/src", "packages"];

const IGNORED_DIRS = new Set(["node_modules", "dist", "out", ".turbo", "shots", "coverage"]);

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".css"]);

/**
 * The constructs that reach the network, and why each is on the list.
 *
 * The first version of this idea checked for `fetch(` and `XMLHttpRequest` and
 * called it done. The review widened it, and the widening is the interesting
 * part: `sendBeacon` survives page unload and is designed to be
 * unblockable-by-the-page; `EventSource` and `WebTransport` are transports
 * nobody thinks of as „fetch"; `RTCPeerConnection` performs a STUN lookup
 * before any application code runs, which is a DNS request and a UDP packet
 * from merely CONSTRUCTING it; `new Image().src` is the oldest exfiltration
 * primitive on the web and contains none of the words above; and
 * `<link rel=preconnect|dns-prefetch>` opens a connection as a HINT, with no
 * JavaScript involved at all.
 *
 * COMMENTS ARE STRIPPED BEFORE MATCHING, which the first version of this file
 * did not do and argued against („a URL in a comment is still a URL somebody
 * will uncomment"). Running it settled the argument: both remaining findings
 * were prose. One was `strings.sr.ts`'s own privacy copy, whose text is the
 * SENTENCE „apps/desktop/src contains no fetch, XMLHttpRequest…" — the gate
 * flagged the claim it exists to enforce. The other was a JSDoc line reading
 * „in one fetch (ADR-029)", describing an IPC round trip. Neither is a request,
 * and a gate that fires on a description of itself teaches people to add
 * exemptions, which is how an allowlist becomes wallpaper.
 */
export const EGRESS_RULES = [
  { id: "fetch", pattern: /\bfetch\s*\(/, what: "fetch()" },
  { id: "xhr", pattern: /\bXMLHttpRequest\b/, what: "XMLHttpRequest" },
  { id: "beacon", pattern: /\bsendBeacon\s*\(/, what: "navigator.sendBeacon()" },
  { id: "eventsource", pattern: /\bnew\s+EventSource\b/, what: "EventSource" },
  { id: "websocket", pattern: /\bnew\s+WebSocket\b/, what: "WebSocket" },
  { id: "webtransport", pattern: /\bnew\s+WebTransport\b/, what: "WebTransport" },
  { id: "rtc", pattern: /\bnew\s+RTCPeerConnection\b/, what: "RTCPeerConnection (STUN fires on construction)" },
  { id: "image-src", pattern: /\bnew\s+Image\s*\([^)]*\)\s*\.\s*src\b/, what: "new Image().src" },
  { id: "preconnect", pattern: /rel\s*=\s*["']?(preconnect|dns-prefetch|prefetch|preload)\b/, what: "a connection-opening <link rel>" },
  { id: "node-http", pattern: /from\s+["']node:(http|https|http2|net|dgram|tls)["']/, what: "a Node network module" },
  { id: "node-require", pattern: /require\s*\(\s*["']node:(http|https|http2|net|dgram|tls)["']\s*\)/, what: "a Node network module" },
  { id: "electron-net", pattern: /\bnet\.request\s*\(/, what: "Electron's net.request()" },
  /**
   * A REMOTE URL IN A REQUESTING POSITION — not merely a remote URL.
   *
   * The first version of this rule flagged any `"https://…"` anywhere in
   * source, and running it returned 30 findings of which 27 were noise: a link
   * href inside a markdown round-trip test, `https://example.com` as a canvas
   * card fixture, the USDA citation on a food in the public-domain catalogue.
   * Every one of those is a URL the app STORES or RENDERS, never one it
   * fetches, and a gate whose output is 90% noise is a gate people learn to
   * scroll past — which is worse than not having it, because it also carries
   * the authority of having run.
   *
   * So the rule matches the syntactic positions that actually initiate a
   * request: a dynamic `import()`, CSS `url()` and `@import`, an assignment to
   * `.src`/`.href`, and a remote URL handed to `loadURL`/`open`. A URL sitting
   * in an object literal as data matches none of them.
   */
  //
  // Each carries the same `(?!localhost|127.0.0.1)` guard: a loopback URL is
  // the dev server or a local service, never egress, and flagging one sends a
  // reader hunting for a leak that is not there.
  { id: "remote-import", pattern: /\bimport\s*\(\s*["'`](https?|wss?):\/\/(?!localhost|127\.0\.0\.1)/, what: "a dynamic import() of a remote module" },
  { id: "css-remote", pattern: /(url\s*\(|@import\s+)["']?\s*(https?):\/\/(?!localhost|127\.0\.0\.1)/, what: "a remote CSS url() or @import" },
  { id: "src-assign", pattern: /\.\s*(src|href)\s*=\s*["'`](https?|wss?):\/\/(?!localhost|127\.0\.0\.1)/, what: "an assignment of a remote URL to .src/.href" },
  { id: "load-remote", pattern: /\b(loadURL|openExternal|open)\s*\(\s*["'`](https?|wss?):\/\/(?!localhost|127\.0\.0\.1)/, what: "a remote URL handed to a loader" },
];

/**
 * Files allowed to contain an otherwise-forbidden construct, each with the
 * reason IN THIS FILE rather than in a comment at the site.
 *
 * Two properties make this an allowlist and not a hole. It is keyed by exact
 * repo-relative path, so a new file never inherits an exemption; and each entry
 * names the rule ids it exempts, so a file allowed to hold a URL is still not
 * allowed to call `fetch`.
 */
export const ALLOWLIST = new Map([
  [
    // The boundary itself has to name the things it blocks.
    "apps/desktop/src/main/net/offline.ts",
    ["absolute-url"],
  ],
  [
    "apps/desktop/src/main/net/offline.test.ts",
    ["absolute-url", "websocket"],
  ],
  [
    // The CSP declares the origins the page may talk to; writing them down is
    // the entire content of the file.
    "apps/web/src/app.css",
    ["absolute-url"],
  ],
]);

function isIgnored(path) {
  return path.split(sep).some((segment) => IGNORED_DIRS.has(segment));
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (isIgnored(full)) continue;
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      yield* walk(full);
    } else if (SCANNED_EXTENSIONS.has(extname(full))) {
      yield full;
    }
  }
}

/**
 * Scans one file's text. Exported so the tests can drive it with a string
 * instead of a fixture tree — a gate whose own tests need files on disk is a
 * gate whose tests get skipped.
 */
/**
 * Blanks comment bodies while preserving line count and line breaks, so a
 * finding's reported line number still points at the right line.
 *
 * Blanked rather than deleted for exactly that reason. This is a lexer, not a
 * parser: it tracks whether it is inside a string, a template literal, a
 * regex-looking `//`, a line comment or a block comment, because a naive
 * `replace(/\/\/.*$/)` eats the `//` in every `https://` URL and would silently
 * disarm four of the rules above.
 */
export function stripComments(source) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote !== null) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        // Newlines survive, so every later line keeps its number.
        if (source[i] === "\n") out += "\n";
        i += 1;
      }
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function scanSource(relPath, source) {
  const exempt = ALLOWLIST.get(relPath.split(sep).join("/")) ?? [];
  const findings = [];
  const lines = stripComments(source).split(/\r?\n/);
  const originalLines = source.split(/\r?\n/);
  for (const rule of EGRESS_RULES) {
    if (exempt.includes(rule.id)) continue;
    lines.forEach((line, index) => {
      if (rule.pattern.test(line)) {
        // Reported from the ORIGINAL line, so the message a human reads is the
        // code as written rather than the comment-blanked version of it.
        const text = (originalLines[index] ?? line).trim();
        findings.push({ file: relPath, line: index + 1, rule: rule.id, what: rule.what, text });
      }
    });
  }
  return findings;
}

export function scanRepo(root = REPO_ROOT) {
  const findings = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const file of walk(join(root, scanRoot))) {
      const rel = relative(root, file);
      findings.push(...scanSource(rel, readFileSync(file, "utf8")));
    }
  }
  return findings;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = scanRepo();
  if (findings.length > 0) {
    console.error(`Egress audit FAILED — ${findings.length} construct(s) that reach the network:\n`);
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line}  ${f.what}\n    ${f.text}`);
    }
    console.error(
      "\nIf this is deliberate, add the file and rule id to ALLOWLIST in " +
        "scripts/check-egress.mjs WITH ITS REASON, and make sure the request is " +
        "reachable through apps/desktop/src/main/net/offline.ts's allowlist — " +
        "otherwise it will be cancelled at runtime while cloud is off.",
    );
    process.exit(1);
  }
  console.log("Egress audit OK");
}
