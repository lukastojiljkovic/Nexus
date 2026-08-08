import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What this app is allowed to reach out of its own directory for.
 *
 * `src/api.ts` and `src/theme.ts` each carry a paragraph saying the reach into
 * `apps/desktop` is deliberate, temporary, and confined to exactly two files —
 * „keeping the reach to exactly these two files is what makes that move small".
 * That was a promise in a comment. Two comments, in fact, in two files, about
 * each other. Nothing checked it, and nothing would have said anything the day
 * a third reach appeared, because a relative import that resolves is a relative
 * import that compiles.
 *
 * THE HALF THAT IS A SECURITY BOUNDARY, not tidiness:
 *
 *   - `ipc.ts` is 9,038 lines and holds the whole desktop contract. It is
 *     imported `import type`, so TypeScript erases it and nothing reaches the
 *     browser. Drop the word `type` and the same line becomes a runtime import
 *     of another app's module into a page served from a public origin.
 *   - `theme.ts` IS a runtime re-export. Whatever that file imports, this app
 *     ships. Today it imports one type and nothing else; it lives in the
 *     Electron renderer, where `window.nexus`, the preload bridge and the
 *     desktop's own strings table are all one import away, and it belongs to a
 *     different area than this one — so it can grow that import without anyone
 *     working here being asked.
 *
 * The failure would not be loud. A desktop-only import that happens to be
 * browser-safe code just makes the bundle bigger; one that reads
 * `window.nexus` throws at first paint, in a theme helper, with nothing
 * pointing at the line that caused it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(HERE, "..");
const REPO_ROOT = join(APP_ROOT, "..", "..");

/** Every module specifier in a file, with whether the import was type-only. */
interface Reach {
  file: string;
  specifier: string;
  typeOnly: boolean;
}

/**
 * Import and re-export specifiers, found by regex rather than by parsing.
 *
 * A regex is enough and a parser would be a dependency: this app's `src/` is
 * six files of hand-written TypeScript, and the shapes that carry a specifier
 * are `import … from "x"`, `export … from "x"` and `import("x")`. The `type`
 * keyword is captured because it is the whole difference between „the compiler
 * erased it" and „the browser downloads it".
 */
/**
 * Source with comments removed, so a regex reads code and not prose.
 *
 * Not optional, and not defensive: this codebase writes long reasoned comments,
 * and `src/api.ts`'s own comment contains the sentence „after which this import
 * changes and nothing else does". A regex looking for `import … from "…"` reads
 * that `import`, skips lazily across the rest of the comment, and lands on the
 * REAL import two lines below — reporting a genuinely type-only import as a
 * runtime one. Which is exactly what it did, until this function existed.
 */
function stripComments(text: string): string {
  let out = "";
  let index = 0;
  let quote: string | undefined;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (quote !== undefined) {
      out += char;
      if (char === "\\") {
        out += text[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (char === quote) quote = undefined;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
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
  return out;
}

function reaches(file: string): Reach[] {
  const text = stripComments(readFileSync(file, "utf8"));
  const found: Reach[] = [];
  // The clause between the keyword and `from` is captured WHOLE and tested for
  // a leading `type`, rather than matched with an optional `(type\s+)?` group.
  // The optional group is the version that looks right and silently does not
  // work: everything after it is lazy, so the engine prefers to skip the group
  // and let `type` be consumed as part of the import clause — which reports
  // `import type { NexusApi } from …` as a RUNTIME import. That was this
  // function's own first bug, caught by its own test being red first.
  for (const match of text.matchAll(/\b(?:import|export)\s+([^;]*?)\s*from\s*["']([^"']+)["']/g)) {
    found.push({
      file,
      specifier: match[2] ?? "",
      typeOnly: /^type\b/.test((match[1] ?? "").trim()),
    });
  }
  // Side-effect imports (`import "./app.css"`) and dynamic ones. Neither can be
  // type-only.
  for (const match of text.matchAll(/\bimport\s*\(?\s*["']([^"']+)["']\s*\)?/g)) {
    found.push({ file, specifier: match[1] ?? "", typeOnly: false });
  }
  return found;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.tsx?$/.test(path)) yield path;
  }
}

const sourceReaches = [...walk(join(APP_ROOT, "src"))]
  .flatMap(reaches)
  .filter((reach) => reach.specifier.startsWith("."))
  // Relative to this app's own files is not a reach at all.
  .filter((reach) => reach.specifier.startsWith("../.."));

const rel = (file: string): string => relative(APP_ROOT, file).split(sep).join("/");

describe("what apps/web reaches out for", () => {
  it("reaches into exactly two files of apps/desktop, and nowhere else", () => {
    expect(
      sourceReaches.map((reach) => `${rel(reach.file)} → ${reach.specifier}`).sort(),
    ).toEqual([
      "src/api.ts → ../../desktop/src/shared/ipc.js",
      "src/theme.ts → ../../desktop/src/renderer/src/theme.js",
    ]);
  });

  it("takes the 9,000-line desktop contract as types only", () => {
    // `import type` is erased. A plain `import` of the same path would put
    // `IpcChannel` and ~120 other runtime constants — the desktop's whole
    // channel table — into a bundle served from a public origin. It would also
    // compile, run, and pass every other test in this directory.
    const ipc = sourceReaches.find((reach) => reach.specifier.endsWith("shared/ipc.js"));
    expect(ipc?.typeOnly).toBe(true);
  });

  it("re-exports a desktop module that itself imports nothing at runtime", () => {
    // `src/theme.ts` is a RUNTIME re-export, so this app ships whatever that
    // file's import graph contains. It sits in the Electron renderer next to
    // `window.nexus` and a 7,148-line strings table. This is the assertion that
    // notices the day it grows an edge — from here, where somebody is looking,
    // rather than in a browser.
    const target = join(REPO_ROOT, "apps", "desktop", "src", "renderer", "src", "theme.ts");
    const runtime = reaches(target).filter((reach) => !reach.typeOnly);
    expect(runtime.map((reach) => reach.specifier)).toEqual([]);
  });

  it("reaches into no Electron-only source at all", () => {
    // The main and preload sides are the trusted half of the desktop: they hold
    // the data key, the SQLite handle and the IPC handlers. Nothing served to a
    // browser may import from them even by accident, and „by accident" is the
    // realistic case — `../../desktop/src/main/…` is one path segment away from
    // the two lines this app legitimately writes.
    const forbidden = sourceReaches.filter((reach) =>
      /desktop\/src\/(main|preload)\//.test(reach.specifier),
    );
    expect(forbidden).toEqual([]);
  });
});
