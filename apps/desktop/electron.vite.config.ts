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
    plugins: [react(), rendererHardening()],
  },
});
