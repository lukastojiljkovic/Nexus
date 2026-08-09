/**
 * WHICH Supabase project this build talks to — and the fact that a build may
 * legitimately talk to none.
 *
 * ─── Why the anon key is compiled in, and why that is not a leaked secret ────
 *
 * Supabase's anon key is a JWT signed by the project whose only claim is
 * `role: anon`. It is printed in every web client that has ever connected, and
 * the project's security does not rest on it: row level security decides what an
 * `anon` or `authenticated` request may see, and migration 002 revokes `anon`
 * from every table in this schema outright. So compiling it in costs nothing.
 * The SERVICE ROLE key is a different object entirely and appears nowhere in
 * this repository, this build, or this process — it lives in one Edge Function's
 * environment and is the reason `sync-enable` is an Edge Function at all.
 *
 * ─── Why „unconfigured" is a first-class state ──────────────────────────────
 *
 * The project does not exist yet: creating it is the founder's, and one of two
 * things the desktop cannot do for him. A build without it must therefore come
 * up as exactly the product 1.0.0 is — every local feature working, the sync
 * screen saying so in plain Serbian — and not crash, not retry, and not
 * half-enable. {@link cloudConfig} returns `null` and every caller has to handle
 * it, which is a compile-time obligation rather than a remembered one.
 *
 * ─── Validation is strict because a wrong value here is a wrong destination ──
 *
 * A misspelled host is not a broken feature; it is ciphertext posted to
 * somebody else's server. So the URL must be `https:` with no path, no query and
 * no credentials, and the key must at least be shaped like a JWT. What this
 * cannot check is that the project is the RIGHT one — nothing in a client can —
 * which is why the value comes from the build and not from anything a user or a
 * file can supply at runtime.
 */

/** A validated project, or nothing. There is no partially-configured state. */
export interface CloudConfig {
  /** Origin only, no trailing slash — `https://<ref>.supabase.co`. */
  readonly url: string;
  /** The publishable `anon` key. See the header on why this is not a secret. */
  readonly anonKey: string;
}

/**
 * The two variables, named for electron-vite's main-process prefix.
 *
 * `MAIN_VITE_` is what electron-vite exposes to the main bundle; a variable
 * without the prefix is not visible there at all, which is the behaviour that
 * keeps a stray `SUPABASE_SERVICE_ROLE_KEY` in somebody's shell out of this
 * build by construction.
 */
export const CLOUD_URL_VAR = "MAIN_VITE_SUPABASE_URL";
export const CLOUD_ANON_KEY_VAR = "MAIN_VITE_SUPABASE_ANON_KEY";

/** Three dot-separated base64url segments. Not a verification — a shape check. */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * The pair as THIS BUILD carries them — the one place `import.meta.env` is read.
 *
 * The two accesses are literal member reads and have to stay that way:
 * electron-vite replaces `import.meta.env.MAIN_VITE_X` statically at build time,
 * and an indexed read is not replaced — it comes back `undefined` in a packaged
 * application while working perfectly in development, which is the worst
 * possible place for a difference. The KEYS are the constants above, so the two
 * halves of each name cannot drift apart silently: a mismatch produces an
 * unconfigured build, which the settings screen says out loud.
 */
export function buildCloudEnv(): Record<string, string | undefined> {
  return {
    [CLOUD_URL_VAR]: import.meta.env.MAIN_VITE_SUPABASE_URL,
    [CLOUD_ANON_KEY_VAR]: import.meta.env.MAIN_VITE_SUPABASE_ANON_KEY,
  };
}

/**
 * Reads the pair out of an environment, or returns `null`.
 *
 * A pure function over a plain record so the rules can be tested without a
 * build. ANY doubt returns `null`: one variable set and not the other, a URL
 * that is not `https:`, a URL carrying a path or credentials, a key that is not
 * JWT-shaped. Half-configured must not be reachable, because the half that is
 * present is the half that would be used.
 */
export function parseCloudConfig(env: Record<string, string | undefined>): CloudConfig | null {
  const rawUrl = env[CLOUD_URL_VAR]?.trim();
  const anonKey = env[CLOUD_ANON_KEY_VAR]?.trim();
  if (!rawUrl || !anonKey) return null;
  if (!JWT_SHAPE.test(anonKey)) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  // `https:` only. A local stack is `http://127.0.0.1:54321` and is deliberately
  // NOT admitted here: this value decides where a user's ciphertext goes, and a
  // scheme that can be downgraded is not a decision worth making twice. Anything
  // testing against a local stack drives the port directly.
  if (parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.search !== "" || parsed.hash !== "") return null;
  if (parsed.pathname !== "/" && parsed.pathname !== "") return null;

  return { url: parsed.origin, anonKey };
}

/**
 * The origins the cloud-off boundary admits once cloud is ON — and exactly
 * those.
 *
 * TWO entries for one host, because `URL.origin` includes the scheme and
 * Realtime is a WebSocket. `wss://<host>` and `https://<host>` are different
 * origins to `isRequestAllowed`, and listing only the first would leave the
 * change signal blocked in a way that looks like a server that never sends one.
 *
 * Empty for an unconfigured build, which is the same list cloud-off produces —
 * so „no project" and „cloud off" are the same boundary, not two.
 */
export function cloudOrigins(config: CloudConfig | null): readonly string[] {
  if (config === null) return [];
  const host = new URL(config.url).host;
  return [`https://${host}`, `wss://${host}`];
}
