import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

// Workspace packages are consumed as TypeScript source, so they must be BUNDLED
// into the main/preload output rather than externalized and require()d at
// runtime (Node cannot execute their raw .ts).
//
// DERIVED from this app's own dependencies, and it used to be a hand-written
// list of eight names. That list was a second declaration of „which of our
// dependencies are workspace packages", and the first one is three metres away
// in `package.json` — so adding `@nexus/sync-engine` there and forgetting it
// here was a build that SUCCEEDED, a typecheck that passed, a lint that passed
// and 1 700 tests that passed, because every one of them reads TypeScript source
// and none of them runs the packaged main process. The only thing that could see
// it was launching the app: `ERR_MODULE_NOT_FOUND … sync-engine/src/round.js`,
// Electron resolving a bare `./round.js` inside a package that ships none.
// Derived, the ninth package is bundled the day it is depended on.
const NEXUS_WORKSPACE = Object.entries(
  (
    JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
      dependencies?: Record<string, string>;
    }
  ).dependencies ?? {},
)
  .filter(([, range]) => range.startsWith("workspace:"))
  .map(([name]) => name);

/**
 * Production-only renderer hardening. Injects a strict CSP (SEC-EL-05,
 * SEC-WEB-01) and strips the `crossorigin` attribute Vite adds to module scripts
 * — a file:// origin rejects crossorigin fetches. Dev is served from the
 * electron-vite dev server and keeps HMR, so this is build-only.
 */
function rendererHardening(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // ADR-014 inline previews; ADR-057 private attachments (unlocked-only);
    // ADR-100 a content pack's own images, and `connect-src` for the same
    // scheme because a map reads its tiles through `fetch`, not through an
    // `<img>` - see `main/packs/protocol.ts`. CULTURE's arts guide
    // (ADR-091) reads its images through the same scheme.
    "img-src 'self' data: nx-blob: priv-blob: nx-pack:",
    "font-src 'self' data:",
    "connect-src 'self' nx-pack:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  return {
    name: "nexus-renderer-hardening",
    apply: "build",
    transformIndexHtml(html) {
      // CSP must precede every fetched resource, so anchor it immediately after
      // the charset meta (charset stays first for encoding detection).
      return html
        .replace(
          /(<meta charset=["'][^"']*["']\s*\/?>)/i,
          `$1\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        )
        .replace(/\s+crossorigin/g, "");
    },
  };
}

/**
 * Excalidraw's hand-drawn fonts, emitted beside the built page (CANV slice a).
 *
 * **Why they are copied at all.** Excalidraw resolves every font URL against
 * `window.EXCALIDRAW_ASSET_PATH` and falls back to `https://esm.sh/...` when it
 * finds nothing there. The renderer sets that global to the built page's own
 * `file://` directory (`renderer/src/excalidrawAssets.ts`), so the files have to
 * BE in that directory — which is what this plugin puts there.
 *
 * **Why a plugin and not `public/`.** Vite copies `public/` verbatim, which
 * would mean committing a megabyte of woff2 that already exists in
 * `node_modules` and re-committing it on every Excalidraw upgrade. Emitting them
 * at build time keeps exactly one copy of the fonts in the repository: none.
 *
 * **Two families are DROPPED, and that is the whole reason this is a filter
 * rather than a directory copy.**
 *
 * *Xiaolai* is a CJK fallback family — 209 of the package's 234 font files and
 * 12.37 MB of its 12.50 MB — that a Serbian product's users will never see a
 * glyph of. Excalidraw registers it lazily (its FontFaces are only fetched when
 * a scene actually contains CJK characters), so its absence costs nothing but
 * the CJK fallback itself.
 *
 * *Liberation Sans* is dropped for a different reason, and the stronger one:
 * **its licence could not be established from anything that ships.** The file's
 * own `name` table says only „subject to the license agreement under which you
 * accepted the Liberation font software" and points at a dead Ascender URL;
 * Excalidraw ships no licence file for it and neither does its upstream repo at
 * this tag. The version string is the Ascender-era `1.05` line, whose terms are
 * NOT the OFL that Liberation 2.x carries — so writing today's licence onto a
 * 2009 binary would be a guess, and this product does not ship guessed notices.
 * It also costs nothing at all to leave out: the package's own metadata marks
 * the family `serverSide: true`, and the font picker filters exactly those out
 * (`!metadata.serverSide && !metadata.fallback`), so no element can ever be set
 * to it. A font no user can select and no notice can be written for is a font
 * with no reason to be in the installer.
 *
 * Both are dropped HERE, in the copy step, rather than by patching the package:
 * a patch would have to be re-applied on every upgrade and would silently stop
 * matching, while a missing directory is simply a directory that is not there.
 * `scripts/generate-licences.mjs` reads this very set, so the notices always
 * describe what the build actually copied.
 */
function excalidrawFonts(): Plugin {
  /** The families left out — see the plugin's own doc for why each one is. */
  const DROPPED_FAMILIES = new Set(["Xiaolai", "Liberation"]);
  const require = createRequire(import.meta.url);

  function walk(dir: string, out: string[]): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  }

  /**
   * `dist/prod/fonts`, always — never whatever the package's `exports`
   * conditions happen to pick. Excalidraw ships `dist/dev` and `dist/prod`
   * behind `development`/`production`, and their font directories are
   * byte-identical (same content-hashed file names), so naming one keeps dev and
   * build serving the very same files rather than two copies that only look
   * alike.
   */
  function fontsRoot(): string {
    return join(require.resolve("@excalidraw/excalidraw"), "..", "..", "prod", "fonts");
  }

  /** The URL prefix both halves below agree on; `excalidrawAssets.ts` resolves the same one. */
  const PREFIX = "/excalidraw-assets/fonts/";

  return {
    name: "nexus-excalidraw-fonts",
    /**
     * Dev serves the same files over the dev server, and that is not a
     * convenience: dev has no CSP (it is the electron-vite dev server, not the
     * built `file://` page), so a font Excalidraw could not find locally would
     * be fetched from esm.sh for real. Offline-first has to hold in `pnpm dev`
     * too, which means the files must be reachable there as well.
     */
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith(PREFIX)) return next();
        // The tail is matched against the files that actually exist rather than
        // joined onto a path: a request is only ever answered with a file this
        // plugin would have emitted, so there is nothing for a `..` to escape.
        const wanted = url.slice(PREFIX.length).split("?")[0] ?? "";
        const root = fontsRoot();
        const match = walk(root, [])
          .map((file) => relative(root, file).split(sep).join(posix.sep))
          .find((rel) => rel === wanted && !DROPPED_FAMILIES.has(rel.split("/")[0] ?? ""));
        if (match === undefined) return next();
        res.setHeader("Content-Type", "font/woff2");
        res.end(readFileSync(join(root, match)));
      });
    },
    generateBundle() {
      const root = fontsRoot();
      for (const family of readdirSync(root)) {
        if (DROPPED_FAMILIES.has(family)) continue;
        for (const file of walk(join(root, family), [])) {
          this.emitFile({
            type: "asset",
            // Rollup asset names are posix paths regardless of platform.
            fileName: posix.join(
              "excalidraw-assets/fonts",
              relative(root, file).split(sep).join(posix.sep),
            ),
            source: readFileSync(file),
          });
        }
      }
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: NEXUS_WORKSPACE })],
    build: {
      rollupOptions: {
        // The SQLite native addon cannot be bundled; it stays external and is
        // require()d at runtime, from the prebuild its own loader picks for
        // this platform.
        external: ["better-sqlite3-multiple-ciphers"],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    base: "./", // relative asset URLs so the production bundle loads over file://
    resolve: {
      dedupe: ["react", "react-dom"],
    },
    /**
     * A CSP IN DEVELOPMENT TOO, which is the half that was missing.
     *
     * `rendererHardening` is `apply: "build"`, so until now `pnpm dev` ran with
     * no Content-Security-Policy at all. Two comments elsewhere in this repo
     * already state the consequence out loud — `excalidrawFonts` explains that
     * it serves fonts in dev because „dev has no CSP … so a font Excalidraw
     * could not find locally would be fetched from esm.sh for real", and
     * `excalidrawAssets.ts` explains that the packaged build is safe precisely
     * BECAUSE the CSP drops that entry before a request exists. Put together:
     * the protection the packaged app relies on was absent in the mode a
     * developer spends every day in, and the mitigation was „make sure the
     * fallback is never needed" rather than „make the fallback impossible".
     *
     * This is the same policy the build injects, with exactly two relaxations
     * that HMR cannot work without, both scoped to loopback: the client's
     * WebSocket, and the inline preamble React Refresh injects. Everything the
     * policy is FOR — `font-src`, `img-src`, `connect-src`, `object-src`,
     * `base-uri`, `frame-ancestors` — is identical to production.
     */
    server: {
      headers: {
        "Content-Security-Policy": [
          "default-src 'self'",
          // React Refresh injects an inline preamble; Vite serves modules from
          // the dev origin. No 'unsafe-eval' — Vite dev is native ESM.
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: nx-blob: priv-blob: nx-pack:",
          // THE LINE THIS BLOCK EXISTS FOR.
          "font-src 'self' data:",
          // The HMR socket, and nothing else. Not `ws:` — that would admit any
          // host on the network.
          "connect-src 'self' ws://localhost:* ws://127.0.0.1:* nx-pack:",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
          "frame-ancestors 'none'",
        ].join("; "),
      },
    },
    plugins: [react(), rendererHardening(), excalidrawFonts()],
    /**
     * MINIFIED, which electron-vite's renderer default is not (`minify: false`,
     * beside the Chromium target it picks). Measured 2026-09-26: the startup
     * chunk 2 331 423 → 1 283 478 bytes, all renderer JS 21.9 → 13.2 MB, the CSS
     * 873 395 → 439 826. Keeping identifiers would have kept 337 KB of that
     * startup chunk, and it was measured too.
     *
     * The price of full minification is a stack trace that names `a3` rather
     * than `buildProfilePlan`, and in this renderer nobody reads one: the menu
     * is `null`, so the shipped app opens no DevTools; nothing in `src` reads
     * `.stack`; and no renderer console is forwarded to a log. A defect in the
     * renderer is diagnosed in `pnpm dev`, which Vite never minifies. MAIN is the
     * other case and stays unminified on purpose: an uncaught exception there is
     * shown to the user in Electron's own dialog, stack and all, and a
     * screenshot of that dialog is the one bug report this product can actually
     * receive — so its names have to survive.
     */
    build: { minify: "esbuild" },
  },
});
