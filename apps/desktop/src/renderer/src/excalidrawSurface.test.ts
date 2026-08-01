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

/**
 * What `app.css` hides, and — far more importantly — what it structurally
 * CANNOT hide (CANV slice b1).
 *
 * The editor's chrome is removed so our own Serbian toolbar can replace it, and
 * the founder explicitly chose to keep the mermaid dialog. Those two facts pull
 * against each other, so both halves are pinned here: an upstream rename that
 * made a hiding rule dead, and an upstream change that moved a dialog inside
 * the hidden containers, must each fail a test rather than be discovered by
 * somebody clicking „Mermaid dijagram".
 */
describe("the chrome our CSS removes", () => {
  const bundle = readFileSync(join(distProd(), "index.js"), "utf8");

  it("still renders under the three container classes `.canv__surface` hides", () => {
    // Desktop chrome: the toolbar, the left islands, the top-right cluster and
    // the footer are ALL children of this one wrapper and of nothing else.
    expect(bundle).toContain('className:"layer-ui__wrapper"');
    // Mobile chrome: `MobileMenu` is a SIBLING of that wrapper, so these two
    // are what keep the editor's own toolbar from reappearing when the pane is
    // narrow enough to cross its breakpoint.
    expect(bundle).toContain('className:"App-top-bar"');
    expect(bundle).toContain('className:"App-bottom-bar"');
  });

  /**
   * The reason „Mermaid dijagram" survives the hiding, and it is structural
   * rather than lucky: every dialog goes through `Modal`, whose portal
   * container is created with a class and NO `parentSelector` — and the helper
   * falls back to `document.body` in exactly that case. A rule rooted at
   * `.canv__surface` therefore cannot reach a dialog at all.
   */
  it("puts every dialog on `document.body`, out of reach of any rule of ours", () => {
    expect(
      /\w+\(\{className:"excalidraw-modal-container"\}\)/.test(bundle),
      "the modal container is created with a class and no parentSelector",
    ).toBe(true);
    expect(
      /parentSelector\?[^:]*:document\.body/.test(bundle),
      "no parentSelector means the portal is appended to document.body",
    ).toBe(true);
  });

  it("opens the mermaid dialog off `openDialog.name === \"ttd\"`, which is what our button sets", () => {
    // `CanvasPage.openMermaid` writes `{ name: "ttd", tab: "mermaid" }`; this is
    // the condition the editor renders `TTDDialog` on.
    expect(bundle).toMatch(/openDialog\?\.name==="ttd"/);
  });
});

describe("the shipped font assets", () => {
  /**
   * The families the build leaves out, read from the build's own declaration
   * rather than restated here.
   *
   * Restating them was this suite's original defect: it excluded Xiaolai by
   * name, so when Liberation Sans was dropped too the arithmetic below stayed
   * green while describing a build that no longer existed. A test about what
   * ships has to read what the build actually decided — the same rule
   * `scripts/generate-licences.mjs` follows for the same set.
   */
  function droppedFamilies(): Set<string> {
    // `src/renderer/src` → the app root, where the build config lives.
    const config = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "electron.vite.config.ts"),
      "utf8",
    );
    const literal = /DROPPED_FAMILIES\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(config);
    if (literal === null) throw new Error("electron.vite.config.ts no longer declares DROPPED_FAMILIES");
    return new Set([...(literal[1] ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? ""));
  }

  it("ships 24 files — everything the package has, minus the two families the build drops", () => {
    const root = join(distProd(), "fonts");
    const families = readdirSync(root);
    const dropped = droppedFamilies();
    const count = (family: string) => readdirSync(join(root, family)).length;

    // Both dropped families must still BE in the package: a name that stopped
    // matching would silently ship the family it was meant to leave out.
    expect([...dropped].sort()).toEqual(["Liberation", "Xiaolai"]);
    for (const family of dropped) expect(families).toContain(family);

    const kept = families.filter((family) => !dropped.has(family));
    expect(kept.reduce((sum, family) => sum + count(family), 0)).toBe(24);
    // Xiaolai alone is 209 of the package's 234 files, which is the number that
    // makes a filtered copy worth doing at all. Liberation is one file and is
    // dropped for its licence, not its weight.
    expect(count("Xiaolai")).toBe(209);
    expect(count("Liberation")).toBe(1);
  });
});
