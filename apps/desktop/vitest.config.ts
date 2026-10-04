import { defineConfig } from "vitest/config";

/**
 * Vitest for `apps/desktop`, NODE environment only — there is no DOM library
 * in this repo and none is being added, so what runs here is exactly what can
 * run without one. Two roots are included, on the same rule:
 *
 * - `src/main` — the Electron main process. A main-process module worth
 *   testing is one written electron-free; a module that imports `electron`
 *   still cannot be tested here (there is no Electron runtime under Vitest).
 * - `src/renderer/src` — the renderer's PURE and storage-backed logic: the
 *   date/duration formatters, the calendar source merge, the search-command
 *   registry, the module registry, the template merge, and the
 *   `localStorage`-backed preference modules. The browser globals those
 *   modules touch (`localStorage`, `document.documentElement`,
 *   `window.matchMedia`, `window.nexus`) are stubbed per test file with
 *   `vi.stubGlobal`, which is what makes a DOM environment unnecessary.
 *   React components, the TipTap/ProseMirror extensions and the `reveal.ts`
 *   hook are deliberately NOT covered here: they need a real document and a
 *   React renderer, and a DOM library would be the only way to provide one.
 * - `src/shared` — the IPC contract itself. Added 2026-08-07, and its absence
 *   until then was a trap of exactly the kind this repo has been finding all
 *   week: a test file written under `src/shared` would have been collected by
 *   nothing and reported nothing, which is indistinguishable from passing.
 *   `ipcCoverage.test.ts` is the first thing that lives there.
 *
 * An include list is a promise about where tests may be written. Anything not
 * named here is a directory whose tests do not run — so a new root gets added
 * the day something is written in it, never afterwards.
 */
export default defineConfig({
  test: {
    include: [
      "src/main/**/*.test.ts",
      "src/renderer/src/**/*.test.ts",
      "src/shared/**/*.test.ts",
    ],
    /**
     * Raised from Vitest's 5 000 ms default for the reason `packages/db` records
     * beside its own: the `src/main/demo` suites open a real encrypted database per case
     * and run every migration. `study.test.ts` takes about 0.6 s a case alone,
     * and on 2026-10-04 three of its four cases passed the 5 s mark while turbo
     * ran the core suite beside this one, then passed when rerun. 20 s matches
     * `packages/db` and still fails a hung test.
     */
    testTimeout: 20_000,
  },
});
