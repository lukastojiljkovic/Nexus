import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

// Workspace packages are consumed as TypeScript source, so they must be BUNDLED
// into the main/preload output rather than externalized and require()d at
// runtime (Node cannot execute their raw .ts).
const NEXUS_WORKSPACE = ["@nexus/core", "@nexus/db", "@nexus/ui", "@nexus/tokens"];

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
    "img-src 'self' data: nx-blob: priv-blob:", // ADR-014 inline previews; ADR-057 private attachments (unlocked-only)
    "font-src 'self' data:",
    "connect-src 'self'",
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
 * **Xiaolai is DROPPED, and that is the whole reason this is a filter rather
 * than a directory copy.** It is a CJK fallback family — 209 of the package's
 * 234 font files and 12.37 MB of its 12.50 MB — that a Serbian product's users
 * will never see a glyph of. Excalidraw registers it lazily (its FontFaces are
 * only fetched when a scene actually contains CJK characters), so its absence
 * costs nothing but the CJK fallback itself. Dropped HERE, in the copy step,
 * rather than by patching the package: a patch would have to be re-applied on
 * every upgrade and would silently stop matching, while a missing directory is
 * simply a directory that is not there.
 */
function excalidrawFonts(): Plugin {
  /** The one family left out — see the plugin's own doc. */
  const DROPPED_FAMILIES = new Set(["Xiaolai"]);
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
        // require()d at runtime. scripts/rebuild-native.mjs provisions the
        // Electron-ABI binary.
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
    plugins: [react(), rendererHardening(), excalidrawFonts()],
  },
});
