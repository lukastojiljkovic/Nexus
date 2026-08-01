import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/**
 * What the embedded editor is allowed to touch on this machine (CANV slice a).
 *
 * A third-party editor is the one dependency in this app that renders its own
 * UI, runs its own persistence and could quietly grow a new storage backend or a
 * telemetry call on any upgrade. The desktop app's own storage rules
 * (`rendererPrefs.ts`) say nothing about it, because it never goes through them
 * — so this suite reads the INSTALLED bundle and pins the surface directly. It
 * fails on an upgrade that changes any of it, which is the point: the failure is
 * a decision to re-make, not a regression to discover.
 *
 * Scanning the built bundle rather than importing the module, deliberately:
 * Excalidraw's dist is ESM with a DOM dependency, and a jsdom import would prove
 * only what happened to run at module scope. The text is the whole surface.
 */

const require = createRequire(import.meta.url);

/**
 * `dist/prod`, always — never whatever the package's `exports` conditions
 * happen to pick.
 *
 * Excalidraw ships `dist/dev` and `dist/prod` behind `development`/`production`
 * conditions, and a test runner is a development context: `require.resolve`
 * answers `dist/dev/index.js` here while the packaged app bundles `dist/prod`.
 * These assertions are about what SHIPS, so the entry is only used to find the
 * package, and the build that matters is named explicitly.
 */
function distProd(): string {
  return join(require.resolve("@excalidraw/excalidraw"), "..", "..", "prod");
}

function bundleFiles(): { name: string; text: string }[] {
  const dist = distProd();
  return readdirSync(dist)
    .filter((name) => name.endsWith(".js"))
    .map((name) => ({ name, text: readFileSync(join(dist, name), "utf8") }));
}

describe("the Excalidraw bundle's storage surface", () => {
  const files = bundleFiles();

  it("writes exactly two localStorage keys, both inside optional dialogs", () => {
    // The three keys it DECLARES. `excalidraw-oai-api-key` is declared and never
    // referenced — it belongs to the AI path, which `CanvasPage` switches off
    // with `aiEnabled={false}` — so it must stay unused, and this asserts it.
    const declared = files.some(({ text }) =>
      text.includes('OAI_API_KEY:"excalidraw-oai-api-key"') &&
      text.includes('MERMAID_TO_EXCALIDRAW:"mermaid-to-excalidraw"') &&
      text.includes('PUBLISH_LIBRARY:"publish-library-data"'),
    );
    expect(declared, "the three declared key constants").toBe(true);

    const used = new Set<string>();
    for (const { text } of files) {
      for (const match of text.matchAll(
        /[A-Za-z0-9_$]{1,4}\.(PUBLISH_LIBRARY|MERMAID_TO_EXCALIDRAW|OAI_API_KEY)\b/g,
      )) {
        if (match[1] !== undefined) used.add(match[1]);
      }
    }
    // `mermaid-to-excalidraw` is the definition dialog's own draft, and
    // `publish-library-data` the publish form's — both reachable only from
    // dialogs, both try/catch-wrapped by the bundle's own storage helper.
    expect([...used].sort()).toEqual(["MERMAID_TO_EXCALIDRAW", "PUBLISH_LIBRARY"]);
  });

  it("touches no IndexedDB, sessionStorage, service worker or storage-quota API", () => {
    for (const { name, text } of files) {
      for (const api of ["indexedDB", "sessionStorage", "serviceWorker", "navigator.storage"]) {
        expect(text, `${name} must not reference ${api}`).not.toContain(api);
      }
    }
  });

  it("ships Xiaolai as a lazily-fetched fallback family, which is why the build may drop it", () => {
    // `fallback:!0` is what keeps its 209 subset files out of the eager load:
    // `Fonts.loadFontFaces` only ever loads the families a scene actually uses,
    // and a fallback family joins that list only when the scene contains
    // characters no other family covers. See `electron.vite.config.ts`.
    const declared = files.some(({ text }) => /Xiaolai\]:\{metrics:.{0,200}fallback:!0/.test(text));
    expect(declared, "Xiaolai is declared as a fallback family").toBe(true);
  });
});

describe("the sidebar names CanvasPage steers by", () => {
  /**
   * `closeLibrarySidebar` compares against these three literals, because
   * Excalidraw does not export them as values a caller can import. A rename
   * upstream would silently stop the redirect working — and „Publish library"
   * would silently become reachable again — so the declarations are read
   * straight out of the package's own types.
   */
  it("are still `default`, `library` and `search`", () => {
    const types = join(distProd(), "..", "types", "excalidraw", "constants.d.ts");
    const text = readFileSync(types, "utf8");
    expect(text).toContain('export declare const LIBRARY_SIDEBAR_TAB = "library"');
    expect(text).toContain('export declare const CANVAS_SEARCH_TAB = "search"');
    expect(text).toMatch(/DEFAULT_SIDEBAR:\s*\{\s*readonly name:\s*"default"/);
  });
});

describe("the shipped font assets", () => {
  it("is 25 files once Xiaolai is dropped — the copy step's whole justification", () => {
    const root = join(distProd(), "fonts");
    const families = readdirSync(root);
    expect(families).toContain("Xiaolai");

    const count = (family: string) => readdirSync(join(root, family)).length;
    const kept = families.filter((family) => family !== "Xiaolai");
    expect(kept.reduce((sum, family) => sum + count(family), 0)).toBe(25);
    // The one that is dropped is 209 of the 234, which is the number that makes
    // this worth doing at all.
    expect(count("Xiaolai")).toBe(209);
  });
});
