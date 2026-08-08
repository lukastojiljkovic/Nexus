import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { supabaseOriginPlugin } from "./build/headers.js";

/**
 * The web build. Deliberately the SAME shape as `apps/desktop`'s renderer half
 * (`electron.vite.config.ts`) — React plus a `dedupe` on react/react-dom, which
 * a pnpm workspace needs the moment a component library takes React as a peer —
 * minus everything that only means something inside Electron.
 *
 * Three of the desktop's renderer settings are absent on purpose, and each
 * absence is a decision:
 *
 * - **`base: "./"`.** The desktop needs relative asset URLs because it loads the
 *   built page over `file://`. This one is served from the root of a real
 *   origin, where absolute `/assets/...` URLs are correct and relative ones
 *   break the moment a client-side route has a path segment
 *   (`/beleske/123` would resolve `./assets/x.js` to `/beleske/assets/x.js`).
 *
 * - **The CSP-injecting `transformIndexHtml` plugin.** A `file://` page has no
 *   server to send headers, so the desktop has to put its policy in a `<meta>`.
 *   Here the policy is a real header (`public/_headers`), which is strictly
 *   stronger: `frame-ancestors`, `report-to` and `upgrade-insecure-requests`
 *   are ignored in `<meta>` entirely. Adding a second policy in the HTML would
 *   not tighten anything either — multiple policies compose as an INTERSECTION,
 *   so the meta copy could only ever break something the header allows, from a
 *   place nobody looks.
 *
 * - **The Excalidraw font plugin.** CANV is not part of this shell yet. When it
 *   arrives, its fonts come with it and this file grows the same emitter.
 */
export default defineConfig({
  plugins: [react(), supabaseOriginPlugin()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  // Both stated rather than left to their defaults, because `test/headers.test.ts`
  // reads them: the security policy only ships if `publicDir` is where `_headers`
  // is written and `outDir` is where wrangler serves from, and a default is not
  // something a test can assert against a config file.
  publicDir: "public",
  build: {
    outDir: "dist",
  },

  // WHAT IS DELIBERATELY NOT HERE: a `rollupOptions.treeshake.moduleSideEffects`
  // override for `@nexus/core`.
  //
  // This build currently ships 554 kB of JavaScript, of which 337 kB is the FIT
  // food catalogue — a 446 kB JSON file this shell never renders a byte of. It
  // arrives because `@nexus/ui`'s barrel re-exports `views/*`, which import
  // `@nexus/core`'s barrel, which pulls `fitness/catalogue.ts`; that module
  // builds its lookup `Map` at module scope, so Rollup sees top-level work and
  // — with no `sideEffects` hint on the package — cannot drop it.
  //
  // Marking core side-effect-free FROM HERE was measured and does work (554 →
  // 216 kB, gzip 113 → 67). It is still the wrong fix twice over: it is one
  // app asserting a property of another package behind that package's back, so
  // the day core gains a real import-time effect this build would silently drop
  // it; and it leaves every other consumer paying the same cost. The fix is one
  // line in `packages/core/package.json` — see README.md, „Handed to other
  // areas".
});
