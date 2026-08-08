import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

/**
 * The one origin the Content-Security-Policy names, and the only value in
 * `public/_headers` that differs between the repository and a deployment.
 *
 * WHY A PLACEHOLDER AT ALL. `connect-src` has to name the real Supabase host or
 * every sync request is blocked; but the committed file must not carry one
 * deployment's identity — the repository is the product, not an environment.
 * So the source of truth keeps `PROJECT.supabase.co` and the BUILD writes the
 * real ref into `dist/_headers`. `test/headers.test.ts` asserts the committed
 * file still says `PROJECT`, which is what stops a substituted copy from being
 * checked in by hand.
 *
 * A project ref is not a credential — it is in the URL of every request the
 * browser makes, so it is public by construction. It is treated this way for
 * the other reason: a value that changes per deployment does not belong in a
 * file that is the same for every deployment.
 */
const PLACEHOLDER = /\bPROJECT\.supabase\.co\b/g;

/**
 * A Supabase project ref: twenty lowercase letters today, but the shape is
 * checked rather than the length, because the length is Supabase's to change.
 *
 * THE REASON THIS IS VALIDATED AT ALL is header injection. Whatever this holds
 * is written into a `Content-Security-Policy` line, so a value containing a
 * space would append a source to `connect-src`, a `;` would append a whole
 * directive, and a newline would append a HEADER — a `_headers` file is
 * line-oriented, so `X-Frame-Options: ALLOWALL` on its own line is one
 * environment variable away. The character class is therefore an allowlist and
 * not a denylist: the only characters that can reach the file are the ones a
 * host name may legally contain.
 */
const PROJECT_REF = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** The environment variable the deploy step sets. Read `README.md` first. */
export const PROJECT_REF_ENV = "NEXUS_SUPABASE_PROJECT_REF";

/**
 * Rewrites the placeholder origin to a real project's.
 *
 * Throws rather than returning the text unchanged when the placeholder is not
 * found. A substitution that silently matched nothing is the defect this
 * function exists to prevent: the build would report success, `dist/_headers`
 * would ship with `connect-src https://PROJECT.supabase.co`, and the only
 * symptom would be that sync never connects — from a page whose console blames
 * a CSP the developer believes they configured.
 */
export function applyProjectRef(headersText: string, projectRef: string): string {
  if (!PROJECT_REF.test(projectRef)) {
    throw new Error(
      `${PROJECT_REF_ENV} is not a Supabase project ref: ${JSON.stringify(projectRef)}. ` +
        "Expected lowercase letters, digits and hyphens only — this value is written " +
        "into a Content-Security-Policy header, where anything else is an injection.",
    );
  }
  const replaced = headersText.replace(PLACEHOLDER, `${projectRef}.supabase.co`);
  if (replaced === headersText) {
    throw new Error(
      "public/_headers contains no `PROJECT.supabase.co` placeholder to substitute. " +
        "Either the placeholder was renamed or the file was committed already " +
        "substituted; both ship a policy nobody chose.",
    );
  }
  return replaced;
}

/**
 * Writes the deployment's Supabase origin into the emitted `_headers`.
 *
 * It runs in `closeBundle`, after Vite has copied `public/` into the output
 * directory, and it edits the emitted copy on disk rather than emitting an
 * asset of its own — emitting `_headers` as a bundle asset would race that copy
 * for the same file name, and whichever won would be silent.
 *
 * WITH THE VARIABLE UNSET the file is left exactly as committed and the build
 * says so on stdout. That is deliberate: CI builds this app on every pull
 * request and has no deployment identity to give it, so an unset variable must
 * not be an error. What must be an error is a DEPLOY with the placeholder still
 * in place, and that belongs to the deploy step (README.md), which is the only
 * place that knows a deployment is happening.
 */
export function supabaseOriginPlugin(): Plugin {
  // Both, because `build.outDir` is NOT absolute on a resolved Vite config —
  // it is kept as written ("dist") and resolved against `root` wherever Vite
  // itself uses it (`getResolvedOutDirs` does `path.resolve(root, outDir)`).
  // Joining it on its own therefore resolves against `process.cwd()`, which is
  // this directory only because of how pnpm happens to run the script. Under
  // `vite build --config apps/web/vite.config.ts` from the repository root it
  // reads a `dist/_headers` that is not there — and the day one IS there, it
  // would rewrite a file belonging to something else.
  let root = process.cwd();
  let outDir = "dist";
  return {
    name: "nexus-web-supabase-origin",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
    },
    closeBundle() {
      const projectRef = process.env[PROJECT_REF_ENV];
      const target = join(root, outDir, "_headers");
      if (projectRef === undefined || projectRef.length === 0) {
        console.log(
          `nexus-web: ${PROJECT_REF_ENV} is unset — ${target} keeps the PROJECT placeholder, ` +
            "so connect-src names no real host. Fine for CI; not deployable.",
        );
        return;
      }
      writeFileSync(target, applyProjectRef(readFileSync(target, "utf8"), projectRef));
      console.log(`nexus-web: ${target} now names ${projectRef}.supabase.co.`);
    },
  };
}
