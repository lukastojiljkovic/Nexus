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

// Shared with `check:elec`, which has the same problem for the same reason —
// see the module for why one reading of it rather than two.
import { stripComments } from "./strip-comments.mjs";

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
  /**
   * A BARE `fetch(` — the global — and deliberately not `x.fetch(`.
   *
   * The rule used to be `\bfetch\s*\(`, which fires on any call to any method
   * named `fetch` on anything. That was right while nothing in the tree had one
   * and wrong the moment `main/sync/port.ts` appeared: its whole design is that
   * the transport is an INJECTED port, so `options.fetch({…})` is a call to
   * whatever the caller passed — in production `net.fetch`, in tests a
   * function — and is precisely the construct that makes the boundary
   * enforceable. Exempting the file would have been the wrong repair twice
   * over: it would bless every other construct in it, and the next port would
   * need its own exemption until the allowlist was wallpaper.
   *
   * The two things the widened rule was really catching are kept as rules of
   * their own below, so nothing is lost: reaching the global through an
   * explicit `globalThis`/`window`, and Electron's `net.fetch`. What is now
   * allowed is exactly „a method named fetch on some other object", which is a
   * seam, not a socket.
   *
   * A DESTRUCTURED port (`const { fetch } = options; fetch(…)`) still fires,
   * and should: at the call site it is indistinguishable from the global, and a
   * later edit deleting the binding would silently turn it into one. That is
   * why `createAuthPort` takes its port as `send` rather than `fetch`.
   */
  { id: "fetch", pattern: /(?<![.\w$])fetch\s*\(/, what: "the global fetch()" },
  { id: "global-fetch", pattern: /\b(globalThis|window|self|global)\s*\.\s*fetch\s*\(/, what: "the global fetch(), reached explicitly" },
  { id: "electron-net-fetch", pattern: /\bnet\s*\.\s*fetch\s*\(/, what: "Electron's net.fetch()" },
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
    // The test asserts the blocker blocks, which means constructing the thing.
    "apps/desktop/src/main/net/offline.test.ts",
    ["websocket"],
  ],
  [
    // The one file in `@nexus/sync-transport` that talks to a server, and it is
    // opt-in: it skips unless four `NEXUS_LIVE_*` variables point it at a local
    // Supabase. The package itself holds no `fetch` — its whole design is an
    // injected port — so this exemption covers the test's own port and its two
    // admin calls, and nothing that ships. If this entry ever needs a second
    // rule id, something in the package has grown a capability it should not
    // have.
    "packages/sync-transport/src/live.test.ts",
    ["fetch"],
  ],
  [
    // The ONE socket in the shipped application, and the exemption is the point
    // rather than a concession: what it exempts is `net.fetch`, which goes
    // through the default session and therefore through the four cloud-off
    // layers. Node's `fetch` in this process would go through none of them, so
    // the rule firing here is the gate doing its job — the file's entire header
    // is the argument for why this call and no other. It is also why the
    // exemption names one file and not a directory: `port.ts` beside it is pure
    // and takes this as a parameter, and must keep failing the gate if it ever
    // stops being.
    //
    // It exempts `electron-net-fetch` and NOT `fetch`, which is the whole
    // distinction: this file may call `net.fetch`, and may still not call the
    // global — the one substitution that would quietly bypass all four layers
    // while leaving the file looking identical.
    "apps/desktop/src/main/sync/electronFetch.ts",
    ["electron-net-fetch"],
  ],
  [
    // The update feature's Electron half (ADR-089). Its one flagged construct
    // is `shell.openExternal("<the pinned release page>")`, which the
    // `load-remote` rule reads as „a remote URL handed to a loader" — and it
    // is, deliberately: the loader is the USER'S BROWSER, not this process's
    // network stack. Nothing here fetches anything; the actual update traffic
    // goes through `ses.fetch` on the dedicated `nexus-update` session, which
    // the rule set already allows because it is a method on a session rather
    // than the global `fetch`. The exemption is scoped to the one rule id so
    // this file is still forbidden from reaching for the global, and it names
    // one file rather than `main/update/` so a new module there never inherits
    // the permission.
    "apps/desktop/src/main/update/electron.ts",
    ["load-remote"],
  ],
  [
    // A LOOPBACK TEST SERVER, and nothing else. The download service's promises
    // are about the WIRE — a pause must become a `Range` request, a server
    // without ranges must make the file restart rather than continue, a
    // redirect out of the allowlist must cost one request and not two — so the
    // suite serves real bytes from 127.0.0.1 instead of stubbing a reply, and
    // `node:http` is both the server and the client (which does not follow
    // redirects, the one property `service.ts` requires of a port). The port
    // this stands in for is `ses.fetch` on the dedicated in-memory session;
    // nothing here can leave the machine, and the single exempted rule id is
    // why this entry may not grow a second one.
    "apps/desktop/src/main/download/service.test.ts",
    ["node-http"],
  ],
  [
    // The pack downloader's end-to-end suite (ADR-103): the same shape as the
    // entry above and for the same reason. What it proves is that a catalogue
    // entry becomes an INSTALLED pack through the real download service and the
    // real install, which means bytes have to arrive over a wire — so a loopback
    // server serves a fixture pack, and `node:http` is both server and client.
    // Nothing here can leave the machine, and the one exempted rule id is why
    // this entry may not grow a second.
    "apps/desktop/src/main/packs/download.test.ts",
    ["node-http"],
  ],
  [
    // The external-link rule's Electron half (ADR-103). Its one flagged
    // construct is `shell.openExternal`, which the `load-remote` rule reads as
    // "a remote URL handed to a loader" — and it is, deliberately: the loader is
    // the USER'S BROWSER, not this process's network stack. Nothing here fetches
    // anything, and the exemption is scoped to the one rule id and to one file,
    // so the rule (which is pure and lives beside it) still fails the gate if it
    // ever grows a call of its own.
    "apps/desktop/src/main/external.ts",
    ["load-remote"],
  ],
  [
    // A LOCAL SCHEME, and one file of one module. `nx-pack://<packId>/<path>`
    // is answered in this process by `protocol.handle`, which opens a file
    // under `<userData>/packs/<id>/` and serves a byte range of it - that is
    // how the map pack's tiles, style and glyphs reach the renderer, and it is
    // the same mechanism MapLibre's own loader uses a few lines away (in
    // `node_modules`, which this gate does not read). The URL cannot leave the
    // machine: there is no host in it, and the handler has no branch that
    // resolves anything outside the pack folder. The exemption names ONE file
    // and ONE rule id, so the rest of the module - and every other module -
    // stays forbidden from reaching for the global, which is the substitution
    // that would put a real request behind a URL that reads like a local one.
    "apps/desktop/src/modules/maps/renderer/packFile.ts",
    ["fetch"],
  ],
  [
    // The translation worker's `fetch`, declared on its own worker-scope type.
    // The rule fires on the declaration, which is the shape it must not ignore —
    // and the two things that URL is ever given are both served from THIS
    // process: the wasm asset the build emitted, and
    // `nx-pack://<packId>/<file>` model files, which `protocol.handle` answers
    // out of a signed, hash-verified pack folder (ADR-091). There is no host in
    // the module and no way for one to arrive: the URLs come from
    // `models.ts`, which builds them from a pack id and three constants.
    // Exempted from `fetch` alone, so reaching for anything else still fails.
    "apps/desktop/src/modules/translator/renderer/sentences/bergamot.worker.ts",
    ["fetch"],
  ],
]);

/**
 * Every id in the allowlist has to be a rule that exists.
 *
 * The three entries this replaced all exempted `"absolute-url"`, a rule id no
 * rule has ever carried — a leftover from the first version of the URL rule,
 * which was split into `remote-import`/`css-remote`/`src-assign`/`load-remote`
 * (see the comment above them) without the allowlist following. Nothing was
 * unsafe: an unknown id exempts nothing, so the gate stayed fail-closed and the
 * files were passing on their own merits. What was unsafe was the SHAPE — an
 * exemption that silently means nothing today would silently mean something the
 * day a rule is named `absolute-url`, and the reader of the file would have had
 * no way to tell the two states apart. So the ids are checked instead of
 * trusted, and a stale exemption is now a failure at startup rather than a
 * sentence that reads true.
 */
for (const [path, ids] of ALLOWLIST) {
  for (const id of ids) {
    if (!EGRESS_RULES.some((rule) => rule.id === id)) {
      throw new Error(
        `check-egress: allowlist entry ${path} exempts "${id}", which is not a rule id. ` +
          `Known ids: ${EGRESS_RULES.map((rule) => rule.id).join(", ")}.`,
      );
    }
  }
}

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
