import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * One flat config for the whole monorepo. Every package's `lint` script is a
 * bare `eslint .`, which walks up to this file — so the rules are decided here
 * once and a new package inherits them by existing, not by remembering to copy
 * a config.
 *
 * Deliberate baseline choice: the RECOMMENDED typescript-eslint preset, not the
 * type-checked ones. The type-aware presets need a `projectService`/`project`
 * wired per package — six tsconfigs here, two of them for a single app (node +
 * web) — and they make ESLint pay for a full type-check that `pnpm typecheck`
 * already runs as its own gate. Lint stays a fast syntactic pass; TypeScript
 * stays the type authority. Turning the type-checked presets on later is a
 * separate, deliberate arc, not something to smuggle into a baseline.
 */

/** Everything that renders: the two renderers and the design system. */
const REACT_FILES = [
  "apps/desktop/src/renderer/**/*.{ts,tsx}",
  "apps/gallery/src/**/*.{ts,tsx}",
  "packages/ui/src/**/*.{ts,tsx}",
];

export default tseslint.config(
  {
    // Mirrors .gitignore's build outputs — including `packages/tokens/gen`,
    // which build.mjs writes and tsc then compiles into dist — plus the tool
    // config files, which are build-tool inputs evaluated by their own
    // runtimes (electron-vite, vite, vitest), not application code.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/release/**",
      "**/gen/**",
      "**/.turbo/**",
      "**/*.config.*",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // ESLint 9 only walks `.js/.mjs/.cjs` by default; naming the TS extensions
    // is what makes `eslint .` see the actual codebase.
    files: ["**/*.{ts,tsx,mts,cts,js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
    },
    rules: {
      // Unused values are a real signal, but the house convention for
      // "declared on purpose, not read" is a leading underscore — a rename is
      // a mechanical fix, deleting a binding is not always one.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  // --- Platform globals per area -------------------------------------------
  // `no-undef` is off for TypeScript (typescript-eslint/eslint-recommended
  // disables it — tsc is the authority there), so these matter mainly for the
  // plain `.mjs` build/launch scripts. They are declared for every area anyway
  // so the config states where each file is expected to run.

  {
    // Node: the storage layer, the Electron main/preload sides, and the
    // repo's build, launch and CI scripts.
    files: [
      "packages/db/**/*.ts",
      "packages/tokens/*.mjs",
      "apps/desktop/src/main/**/*.ts",
      "apps/desktop/src/preload/**/*.ts",
      "apps/desktop/scripts/**/*.mjs",
      ".github/scripts/**/*.mjs",
    ],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    // Browser.
    files: REACT_FILES,
    languageOptions: { globals: { ...globals.browser } },
  },

  {
    // `@nexus/core` is platform-free by contract (no React, DOM, or Node
    // APIs), so it runs in both — only the globals both runtimes share are
    // legitimately reachable from here, and that intersection is what
    // declaring both leaves usable in practice.
    files: ["packages/core/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  {
    // Ambient declaration files describe other people's modules, so they are
    // written in the shape those modules actually have.
    files: ["**/*.d.ts"],
    rules: {
      // `import X = require("…")` is not a CommonJS import here — inside a
      // `declare module` it is the ONLY syntax that can alias a module whose
      // types use `export =`, which is how @types/better-sqlite3 is written.
      // The ESM rewrite the rule asks for does not typecheck.
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // Test suites need no block of their own: they sit inside the areas above
  // and import describe/it/expect from "vitest" rather than reading them off a
  // global. `no-explicit-any` is deliberately left ON for them too — the
  // codebase currently contains not one `any`, in tests or anywhere else, and
  // a baseline should not pre-authorise the first one.

  // --- React ---------------------------------------------------------------
  {
    files: REACT_FILES,
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Only the two classic hook rules, NOT the plugin's `recommended`
      // preset. v7's preset bundles the React Compiler rule family
      // (purity, immutability, static-components, set-state-in-effect, …),
      // which does not describe a lint baseline — every finding it raises
      // needs a real change to component code. Adopting it is its own arc.
      "react-hooks/rules-of-hooks": "error",
      // `warn`, which is also the plugin's own recommended severity: a missing
      // dependency is sometimes a bug and sometimes the point (an effect that
      // must subscribe once per profile, a layout effect that must re-measure
      // on every render). Deciding which is which changes how a component
      // re-renders, so this rule reports and a human judges — it does not
      // block the build into a mechanical "fix".
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
