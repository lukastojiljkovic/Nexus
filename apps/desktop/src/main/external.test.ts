import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { allowsDocumentExternalUrl, allowsExternalUrl } from "./external.js";

/**
 * The external-link rule (ADR-103), as a table.
 *
 * The rule is the whole security story of the credits screen: `shell.openExternal`
 * hands the string to the operating system, so what may be handed over is a
 * decision rather than a check at the call site. `openExternalUrl` is one line
 * around this function and is not tested here (it needs Electron); everything
 * that decides anything is.
 */
describe("what may be opened in the user's browser", () => {
  it("allows a plain https address", () => {
    expect(allowsExternalUrl("https://creativecommons.org/licenses/by-sa/4.0/")).toBe(true);
    expect(allowsExternalUrl("https://www.kiwix.org/")).toBe(true);
    expect(allowsExternalUrl("https://example.org/a/b?c=d#e")).toBe(true);
  });

  it("refuses every scheme but https", () => {
    expect(allowsExternalUrl("http://example.org/")).toBe(false);
    expect(allowsExternalUrl("file:///C:/Windows/System32/calc.exe")).toBe(false);
    expect(allowsExternalUrl("javascript:alert(1)")).toBe(false);
    expect(allowsExternalUrl("ms-settings:privacy")).toBe(false);
    expect(allowsExternalUrl("\\\\server\\share\\setup.exe")).toBe(false);
    expect(allowsExternalUrl("C:\\Windows\\System32\\calc.exe")).toBe(false);
  });

  it("refuses an address that carries credentials, which is not the address it appears to be", () => {
    expect(allowsExternalUrl("https://user:secret@example.org/")).toBe(false);
    expect(allowsExternalUrl("https://user@example.org/")).toBe(false);
  });

  it("refuses an unparseable or empty address, and an over-long one", () => {
    expect(allowsExternalUrl("")).toBe(false);
    expect(allowsExternalUrl("not a url")).toBe(false);
    expect(allowsExternalUrl(`https://example.org/${"a".repeat(4096)}`)).toBe(false);
  });
});

/**
 * The document variant (ADR-107): the same rule, with `http:` allowed — and
 * allowed for the same reason the credits screen has no host allowlist: most of
 * an old encyclopedia's own links are `http:`, and the document is what the
 * reader opened.
 *
 * Everything else about the address is the shared half of the rule and is
 * asserted again here rather than assumed, because "the second variant is
 * looser" is exactly the sentence that would be written while it drifted.
 */
describe("what may be opened from inside a document the user opened", () => {
  it("allows an http address, which the app's own rule refuses", () => {
    expect(allowsDocumentExternalUrl("http://sr.wikipedia.org/wiki/Kafa")).toBe(true);
    expect(allowsDocumentExternalUrl("https://sr.wikipedia.org/wiki/Kafa")).toBe(true);
    expect(allowsExternalUrl("http://sr.wikipedia.org/wiki/Kafa")).toBe(false);
  });

  it("refuses everything the app's own rule refuses, apart from that one scheme", () => {
    expect(allowsDocumentExternalUrl("file:///C:/Windows/System32/calc.exe")).toBe(false);
    expect(allowsDocumentExternalUrl("javascript:alert(1)")).toBe(false);
    expect(allowsDocumentExternalUrl("mailto:someone@example.com")).toBe(false);
    expect(allowsDocumentExternalUrl("ftp://example.org/a")).toBe(false);
    expect(allowsDocumentExternalUrl("\\\\server\\share\\setup.exe")).toBe(false);
    expect(allowsDocumentExternalUrl("https://user:secret@example.org/")).toBe(false);
    expect(allowsDocumentExternalUrl("")).toBe(false);
    expect(allowsDocumentExternalUrl("not a url")).toBe(false);
    expect(allowsDocumentExternalUrl(`http://example.org/${"a".repeat(4096)}`)).toBe(false);
  });
});

/**
 * THE ONE DOOR (ADR-107), asserted over the tree rather than trusted.
 *
 * `shell.openExternal` hands a string to the operating system, so every call
 * site in the app is a place the rule can be forgotten — and there were three of
 * them beside this file (the ZIM link rule, the update feature's release page
 * and the Reader's pack source line). Nothing else in the repository can see a
 * second call site: it typechecks, it lints, and the screenshots photograph an
 * opened link and a refused one identically.
 *
 * Comments are skipped by their own line prefix, because this rule's doc
 * comments NAME the call (including this file's own: the paragraph above
 * mentions it twice). That is also why the walk reads the whole `src` tree and
 * not only `main`: a module's Electron half is a call site like any other, and
 * the two that exist today are the ZIM module's and the Reader's.
 */
const SRC_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Every `.ts`/`.tsx` file under `src`, tests excluded — a test may name the call to assert it is gone. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
    found.push(path);
  }
  return found;
}

/** The lines of one file that CALL `shell.openExternal`, never a comment that describes it. */
function callSites(source: string): number[] {
  const lines: number[] = [];
  source.split(/\r?\n/).forEach((line, index) => {
    if (!line.includes("shell.openExternal(")) return;
    const trimmed = line.trimStart();
    if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) return;
    lines.push(index + 1);
  });
  return lines;
}

describe("the one door", () => {
  it("is the only file in the app that calls shell.openExternal", () => {
    const callers = sourceFiles(SRC_ROOT)
      .map((path) => ({ path, lines: callSites(readFileSync(path, "utf8")) }))
      .filter((entry) => entry.lines.length > 0)
      .map((entry) => entry.path.slice(SRC_ROOT.length).replace(/\\/gu, "/"));
    expect(callers).toEqual(["main/external.ts"]);
  });

  it("is what the ZIM rule's browser hand-off and the update feature's release page go through", () => {
    const zim = readFileSync(join(SRC_ROOT, "main/zim/zimElectron.ts"), "utf8");
    expect(zim).toContain("openDocumentExternalUrl");
    const update = readFileSync(join(SRC_ROOT, "main/update/electron.ts"), "utf8");
    expect(update).toContain("openExternalUrl");
    const reader = readFileSync(join(SRC_ROOT, "modules/reader/main/electron.ts"), "utf8");
    expect(reader).toContain("openDocumentExternalUrl");
  });
});
