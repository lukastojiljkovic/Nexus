import { defineConfig } from "vitest/config";

/**
 * Vitest for the Electron MAIN process only. `apps/desktop` had no test
 * harness before this; `src/main` modules that import `electron` still cannot
 * be tested here (there is no Electron runtime under Vitest), so the rule this
 * config encodes is: a main-process module worth testing is one written
 * electron-free, and `include` deliberately reaches no further than
 * `src/main`, since the renderer would need a DOM environment and its own
 * setup.
 */
export default defineConfig({
  test: { include: ["src/main/**/*.test.ts"] },
});
