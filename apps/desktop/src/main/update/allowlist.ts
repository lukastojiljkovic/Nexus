import { UPDATE_HOSTS } from "../net/offline.js";

/**
 * The update session's request rule, as a pure function so it can be tested
 * without a Chromium session.
 *
 * Two conditions, and both are load-bearing:
 *
 *   1. **https only.** The release API and every asset URL are https, and a
 *      request on any other scheme is not one this feature ever needs.
 *   2. **the host, matched exactly.** `parsed.host` includes a port, so
 *      `api.github.com:8443` is refused, and an equality test against the
 *      pinned list refuses `evil-api.github.com` and `api.github.com.evil.tld`
 *      as well — the two shapes an `endsWith` would wave through. There is no
 *      wildcard and no subdomain rule, exactly as ADR-089 requires.
 *
 * This is the only place besides `resolverRules` that names the hosts, and both
 * read `UPDATE_HOSTS`, so the resolver's `EXCLUDE` list and the session's
 * allowlist cannot drift into admitting different names.
 */
export function isUpdateRequestAllowed(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Unparseable is a destination this code cannot vouch for, not a harmless
    // one — the same rule `net/offline.ts`'s renderer allowlist applies.
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return UPDATE_HOSTS.includes(parsed.host);
}
