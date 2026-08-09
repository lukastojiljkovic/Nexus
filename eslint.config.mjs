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
      // Agent worktrees (gitignored working copies of older commits). Flat
      // config reads no .gitignore, so a root-level `eslint .` would lint
      // stale snapshots of the whole repo without this.
      ".claude/**",
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
      "scripts/**/*.mjs",
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

  // --- Raw colour literals ---------------------------------------------
  // The authoritative gate is `pnpm check:colours` (`scripts/check-colours.mjs`):
  // it alone covers CSS, HTML and the CSS-declaration-vs-selector distinction,
  // and it is what CI blocks on. This block is a deliberately narrower
  // in-editor ECHO of the same rule for TS/TSX string and template literals —
  // the common case — so a violation is a red squiggle before it is ever a
  // failed `pnpm check:colours` run. Scoped to the exact same source trees
  // (every package's `src/`, `packages/tokens` excluded as the one package
  // allowed to hold real colour values) via `ignores`, since `packages/tokens`
  // carries no `src/` directory for the positive globs to reach anyway.
  // A genuinely justified exception uses the same escape hatch ESLint always
  // has: `// eslint-disable-next-line no-restricted-syntax`.
  {
    files: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
    ignores: ["packages/tokens/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/]",
          message: "Raw hex colour literal — use a --nx-* design token from packages/tokens (see README.md 'Styling rules').",
        },
        {
          selector: "TemplateElement[value.raw=/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/]",
          message: "Raw hex colour literal — use a --nx-* design token from packages/tokens (see README.md 'Styling rules').",
        },
        {
          selector: "Literal[value=/\\b(?:rgba?|hsla?|oklch|lab|lch|color)\\(/]",
          message: "Raw colour function — use a --nx-* design token from packages/tokens (see README.md 'Styling rules').",
        },
        {
          selector: "TemplateElement[value.raw=/\\b(?:rgba?|hsla?|oklch|lab|lch|color)\\(/]",
          message: "Raw colour function — use a --nx-* design token from packages/tokens (see README.md 'Styling rules').",
        },
      ],
    },
  },

  // --- The AEAD library has exactly one import site ------------------------
  // `@nexus/sync-crypto` reaches every primitive through `CryptoPort`, and its
  // header states the payoff: „What crypto does sync use?" is answered by
  // reading that interface and its one adapter, never by walking a lockfile.
  // XChaCha20-Poly1305 is the single primitive WebCrypto cannot supply, so
  // `@noble/ciphers` is a real dependency of `@nexus/sync-port` — and a real
  // dependency is one `import` away from being used somewhere the port cannot
  // see, at which point the sentence stops being true and nothing says so.
  //
  // pnpm's strict layout already stops OTHER packages resolving it (only
  // `@nexus/sync-port` declares it). This rule covers the case that isolation
  // cannot: a second import inside sync-port itself. The exemption is the exact
  // path of the adapter, so a new file never inherits it.
  {
    files: ["**/*.{ts,tsx,mts,cts,js,mjs,cjs}"],
    ignores: ["packages/sync-port/src/webCryptoPort.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@noble/**"],
              message:
                "The AEAD library has one import site: packages/sync-port/src/webCryptoPort.ts. " +
                "Everything else reaches crypto through CryptoPort (packages/sync-crypto/src/port.ts).",
            },
          ],
        },
      ],
    },
  },

  // --- The browser gets one barrel, and it is not the package root ---------
  // `@nexus/sync-crypto`'s root barrel exports `deriveWebPasswordKeys`,
  // `rewrapMasterKeyForEmailChange` and `unwrapKey`. K_wrap opens the
  // master-key wrap; the wrap is a row of the signed-in user's own account and
  // the server will hand it over on request. So a browser that can compute
  // K_wrap is a browser that is one call from MK, and MK opens every profile.
  //
  // `@nexus/sync-crypto/web` is the same package with those absent — see its
  // header for what is missing and why each one is. `/testing` is refused for a
  // sharper reason: it is a DETERMINISTIC fake `CryptoPort`, a random number
  // generator that is not one, and a bundle that reached for it would produce
  // predictable nonces and predictable keys while every test stayed green.
  //
  // THE `@noble/**` GROUP IS REPEATED HERE ON PURPOSE. Flat config does not
  // merge rule options: the last matching block wins outright, so a block that
  // sets `no-restricted-imports` for `apps/web` REPLACES the AEAD rule above
  // for every file under it. Dropping the group would silently exempt the web
  // app from the one-import-site rule, and nothing in either block would say so.
  {
    files: ["apps/web/**/*.{ts,tsx,mts,cts,js,mjs,cjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          // `paths` AND NOT `patterns`, WHICH THE FIRST VERSION USED AND WHICH
          // DOES NOT WORK HERE. `patterns.group` matches the way `.gitignore`
          // matches: `@nexus/sync-crypto` covers every subpath beneath it, and
          // gitignore cannot re-include a path under an excluded directory — so
          // `!@nexus/sync-crypto/web` does nothing and the rule refuses the one
          // import the web app is SUPPOSED to make. Found by running it, not by
          // reading it. That failure does not read as a rule being too broad; it
          // reads as the barrel being wrong, and the repair somebody reaches for
          // is an `eslint-disable` on the exact line the rule exists for.
          //
          // `paths` matches the specifier exactly, so `/web` is untouched. The
          // list is complete rather than open-ended because a package's
          // importable subpaths are closed by its `exports` map — an undeclared
          // one does not resolve — and `scripts/web-key-surface.test.mjs`
          // asserts that every entry in that map except `./web` is named here.
          paths: [
            {
              name: "@nexus/sync-crypto",
              message:
                "The web app imports @nexus/sync-crypto/web. This barrel exports " +
                "deriveWebPasswordKeys, rewrapMasterKeyForEmailChange and unwrapKey, which " +
                "together turn the web password into the master key. " +
                "See packages/sync-crypto/src/kdf.ts.",
            },
            {
              name: "@nexus/sync-crypto/testing",
              message:
                "That is a DETERMINISTIC fake CryptoPort — a random number generator that is " +
                "not one. The web app imports @nexus/sync-crypto/web.",
            },
          ],
          patterns: [
            {
              group: ["@noble/**"],
              message:
                "The AEAD library has one import site: packages/sync-port/src/webCryptoPort.ts. " +
                "Everything else reaches crypto through CryptoPort (packages/sync-crypto/src/port.ts).",
            },
          ],
        },
      ],
    },
  },

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
