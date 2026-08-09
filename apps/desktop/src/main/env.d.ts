/**
 * The two build-time variables the main process reads, and nothing else.
 *
 * The renderer gets `vite/client`'s full `ImportMetaEnv` through
 * `tsconfig.web.json`. Main deliberately does not: its config loads `["node"]`
 * only, so `import.meta.env` is undeclared there and this file declares exactly
 * the two members that exist rather than the whole surface. A narrow
 * declaration is the honest one — main has no `BASE_URL`, no `MODE`, and no
 * `VITE_*`, because electron-vite exposes only the `MAIN_VITE_` prefix to this
 * bundle.
 *
 * **They must be read as literal member accesses.** electron-vite replaces
 * `import.meta.env.MAIN_VITE_X` statically at build time; an indexed read
 * (`import.meta.env[NAME]`) is not replaced and comes back `undefined` in a
 * packaged app while working perfectly in development. `config.ts`'s
 * `buildCloudEnv` is the one place that does it, for that reason.
 */
interface ImportMetaEnv {
  readonly MAIN_VITE_SUPABASE_URL?: string;
  readonly MAIN_VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
