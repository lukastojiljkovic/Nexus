import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

import { modeAllowsDownloads, modeAllowsUpdates, type NetworkMode } from "../../net/offline.js";

/**
 * THE WEB SWITCH, AND WHY IT IS A CONSENT RATHER THAN A FOURTH MODE (ADR-097).
 *
 * Luka's decision is one sentence: „Web search ONLY when the user turns it on;
 * otherwise the assistant uses local RAG only." The switch that carries it is
 * DEVICE-LEVEL and sits beside `cloud.json` and `network.json`, for the reason
 * `net/offline.ts` already records about both: the question has to be
 * answerable before any account is unlocked, and the answer cannot live inside
 * a profile's encrypted database. It is also world-readable and user-writable,
 * and therefore NOT a security control in the sense of „an attacker cannot
 * change it" — it does not need to be, for the same reason `cloud.json` does
 * not: whoever can write this file is already running as the user. What it has
 * to be is UNAMBIGUOUS and FAIL-CLOSED, which is what the parsing below is for.
 *
 * WHY NOT A FOURTH NETWORK MODE. The three modes answer „what may Nexus reach
 * ON ITS OWN", and each one is a superset of the one before it, which is what
 * makes the question on the first-run screen answerable in one sentence. Web
 * search is a different question — „may the assistant fetch a page the USER
 * asked for" — and it is not a superset of anything: a user who wants the
 * assistant to read a Wikipedia article may not want the app downloading a
 * content pack, and a fourth mode would have GIVEN them the pack, because a
 * wider mode inherits everything the narrower one allows. It would also have
 * re-opened the thing the modes are made of: `allowedHostsFor` returns a
 * compiled-in list, and a search result's host is by definition not in it.
 *
 * SO THE MODE STILL GATES IT, AND THE SWITCH IS AN AND ON TOP. Web search needs
 * a mode that allows a connection (`modeAllowsWebSearch`: `"updates"` or
 * `"downloads"`, read as the existing predicates rather than as mode names) and
 * the user's own consent, and it is off until both hold. Offline only stays
 * byte-for-byte the product it was: no mode, no request, whatever the switch
 * says.
 *
 * THE SWITCH IS READ LIVE, not at launch, and it is the one part of this
 * boundary that is. `network.json` is read once because `host-resolver-rules`
 * is a command-line switch and the launch's mode is the mode it keeps; nothing
 * downstream of the mode has that property. Reading this file at call time
 * means a user who turns web search off stops the NEXT request rather than the
 * next launch, which is the direction the mistake should fall in.
 */

export interface WebConfig {
  /** The user's consent. `false` unless the file says literally `true`. */
  readonly enabled: boolean;
  /** The user's SearXNG instance as an https origin, or `null` when none is set. */
  readonly searxng: string | null;
}

/** The one version this build writes and understands. A future version is a future parser. */
const WEB_CONFIG_VERSION = 1;

const WEB_FILE = "assistant-web.json";

export function webConfigPath(userData: string): string {
  return join(userData, WEB_FILE);
}

/** A fresh install's answer: no consent, no instance. */
export function defaultWebConfig(): WebConfig {
  return { enabled: false, searxng: null };
}

/**
 * The SearXNG instance a user typed, as a canonical origin — or `null`.
 *
 * The instance URL is FETCHED, so it is held to the same rule a search result
 * is: https, and a bare origin. Anything with a path, a query, a fragment or a
 * credential in it is refused rather than trimmed, because the request builder
 * appends `/search?q=…` and a base that already carried a path would silently
 * become a different endpoint than the one the user believes they configured.
 * `url.origin` is what makes `https://host:8443` (a self-hosted instance on a
 * non-default port, which is normal) one spelling of one value.
 */
export function parseSearxngOrigin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.search !== "" || parsed.hash !== "") return null;
  if (parsed.pathname !== "/" && parsed.pathname !== "") return null;
  return parsed.origin;
}

/**
 * Reads the switch. ANY doubt about the record reads as „no consent, no
 * instance", which is the state a user who never opened the setting is in.
 *
 * A MISSING file, an unreadable one, malformed JSON, a JSON value that is not
 * an object, and a `version` this build does not know are all THE SAME ANSWER as
 * an explicit `false`: every one of them has a path where the app comes up with
 * the switch on, and „I could not tell" and „it is off" must not be two
 * different outcomes.
 *
 * The two fields are judged SEPARATELY once the record itself is trusted, and
 * that is deliberate rather than sloppy: `enabled` is the consent and `searxng`
 * is one provider's address, so a hand-edited instance URL that no longer parses
 * turns that provider off and leaves the consent exactly as the user recorded
 * it. Folding them together would mean a typo in a URL silently switched web
 * search off, which is the failure a user cannot see.
 */
export function readWebConfig(userData: string): WebConfig {
  let raw: string;
  try {
    raw = readFileSync(webConfigPath(userData), "utf8");
  } catch {
    return defaultWebConfig();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultWebConfig();
  }
  if (typeof parsed !== "object" || parsed === null) return defaultWebConfig();
  const record = parsed as { version?: unknown; enabled?: unknown; searxng?: unknown };
  if (record.version !== WEB_CONFIG_VERSION) return defaultWebConfig();
  // `=== true`, not truthiness, for `readCloudSwitch`'s reason: the string
  // `"false"`, the number `1` and the object `{}` are all truthy, and each is a
  // plausible thing to find in a file a human or a half-finished migration has
  // edited.
  return {
    enabled: record.enabled === true,
    searxng: parseSearxngOrigin(record.searxng),
  };
}

/**
 * Records the switch, atomically, for `writeNetworkMode`'s reason: a crash
 * partway through a plain write leaves a truncated file, and a truncated file
 * reads as „no consent" — which turns web search off on a device that had it
 * on. A sibling `.tmp`, fsynced and closed before the rename, means a reader
 * sees either the old file or the new one, never half of one.
 */
export function writeWebConfig(userData: string, next: WebConfig): void {
  const path = webConfigPath(userData);
  mkdirSync(dirname(path), { recursive: true });
  const record = {
    version: WEB_CONFIG_VERSION,
    enabled: next.enabled,
    searxng: next.searxng,
  };
  const tmpPath = `${path}.tmp`;
  const fd = openSync(tmpPath, "w");
  try {
    writeSync(fd, `${JSON.stringify(record, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, path);
}

/**
 * Whether this mode may reach the web AT ALL, before the switch is consulted.
 *
 * Read as the two predicates `net/offline.ts` already exports rather than as a
 * comparison against mode names, which is that module's own rule: a mode that
 * allows a connection is a mode that allows a connection, and the day a fourth
 * mode arrives it is taught to the predicates in one place. `"offline"` is the
 * only mode that answers `false` today, and it is the answer that matters.
 */
export function modeAllowsWebSearch(mode: NetworkMode): boolean {
  return modeAllowsUpdates(mode) || modeAllowsDownloads(mode);
}

/** The whole gate: the user turned it on AND the mode this launch may act on allows one. */
export function webSearchActive(mode: NetworkMode, config: WebConfig): boolean {
  return config.enabled && modeAllowsWebSearch(mode);
}

/**
 * The one URL rule every web request is read through: **https only, and only
 * while the switch is on in a mode that allows it**.
 *
 * This is the rule `isHttpsHostAllowed` is for the pinned hosts, with the host
 * list replaced by „the public web" — because a search the user asked for has
 * no compiled-in destination set, which is the whole reason ADR-097 exists. The
 * rest of the boundary is where a URL is not enough and an ADDRESS is
 * (`target.ts`: resolve first, refuse anything that is not a public address),
 * and the size and time caps are `limits.ts`.
 *
 * A URL this function cannot parse is refused rather than treated as harmless,
 * exactly as `isRequestAllowed` and `isHttpsHostAllowed` refuse one: a
 * destination the code cannot name is one it cannot vouch for.
 */
export function allowsWebRequest(mode: NetworkMode, config: WebConfig, url: string): boolean {
  if (!webSearchActive(mode, config)) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
