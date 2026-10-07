import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

/**
 * THE OFF SWITCH, AND WHY IT IS A BOUNDARY RATHER THAN A PREFERENCE.
 *
 * The founder's requirement is not „there is a setting". It is: *„da na desktop
 * app moze da se ugasi web funkcionalnost, da je ugašeno po difoltu"* — a user
 * who never turns cloud on must be in exactly the product 1.0.0 was, with no
 * network calls at all. `CLAUDE.md` records the consequence: „This is a
 * structural guarantee, not a promise — the local-only path must not be *able*
 * to reach the network."
 *
 * A boolean consulted by the sync code is not that. It is a promise that every
 * future call site keeps voluntarily, and the first one that forgets is
 * indistinguishable from the ones that did not — the failure is a packet, and
 * packets are not visible in a code review. The security review was blunt about
 * it: the grep gate and the Node tripwire „are honesty checks, not boundaries",
 * and it found the shipped app already making two network calls nobody
 * intended (an `esm.sh` font fetch in dev, and Chromium's own spellcheck
 * dictionary download) while the privacy copy in `strings.sr.ts` told the user
 * the only outbound request was a version check.
 *
 * So the guarantee is asserted where a packet has to pass, in four independent
 * places, each of which alone would stop most of it:
 *
 *   1. `webRequest.onBeforeRequest` cancels every request whose scheme is not
 *      local. This catches everything Chromium initiates — `fetch`, `<img>`,
 *      `<link>`, a stylesheet `url()`, a redirect, a service worker.
 *   2. The proxy is pointed at a dead loopback port with loopback bypass
 *      disabled, so anything that slipped past (1) has nowhere to connect.
 *   3. `host-resolver-rules` maps every name to NOTFOUND, so DNS does not
 *      resolve at all. This one is a command-line switch and therefore cannot
 *      be lifted at runtime — see `cloudRequiresRestart` below, which is not a
 *      limitation but the reason the DEFAULT state is the strong one.
 *   4. The spellchecker, which is the one network client Chromium runs without
 *      being asked, is switched off and pointed at a `file:` base.
 *
 * Layer 3 is read once per launch, which makes the whole switch once-per-launch:
 * see `cloudRequiresRestart`, and the mistake its comment records.
 */

/** Schemes a request may use while cloud is off. Everything else is cancelled. */
const LOCAL_SCHEMES: readonly string[] = [
  // The renderer bundle itself in a packaged build.
  "file:",
  // Chromium's own internals. Blocking these breaks devtools and the built-in
  // error pages while blocking nothing an attacker wants.
  "devtools:",
  "chrome-extension:",
  "chrome:",
  "blob:",
  "data:",
  "about:",
  // The two privileged schemes this app registers (ADR-014): attachment bytes
  // and private-vault bytes, both served from the local database by
  // `protocol.handle`. They never leave the process.
  "nx-blob:",
  "priv-blob:",
];

/**
 * The dev server, and the one hole this file deliberately leaves.
 *
 * `pnpm dev` serves the renderer over http on loopback, so in development the
 * boundary must admit exactly that origin and nothing else. It is read from
 * `ELECTRON_RENDERER_URL`, which electron-vite sets and which is `undefined` in
 * every packaged build — so the hole cannot exist in a shipped app, and it does
 * not depend on anyone remembering to remove it.
 */
export function devServerOrigin(env: NodeJS.ProcessEnv): string | null {
  const url = env["ELECTRON_RENDERER_URL"];
  if (url === undefined || url === "") return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The decision, as a pure function, so it can be tested without an Electron
 * session and so the rule is readable in one place.
 *
 * `allowedRemoteOrigins` is EMPTY while cloud is off. When cloud is on it holds
 * exactly the Supabase project's REST and Realtime origins — never a wildcard,
 * never „any https". A compromised renderer that wants to exfiltrate then has
 * one reachable host, which is the one that already holds the ciphertext.
 */
export function isRequestAllowed(
  url: string,
  allowedRemoteOrigins: readonly string[],
  devOrigin: string | null,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Unparseable is not „harmless": `onBeforeRequest` reports the URL
    // Chromium is about to fetch, and a URL this code cannot understand is one
    // whose destination it cannot vouch for.
    return false;
  }
  if (LOCAL_SCHEMES.includes(parsed.protocol)) return true;
  if (devOrigin !== null && parsed.origin === devOrigin) return true;
  return allowedRemoteOrigins.includes(parsed.origin);
}

// ── The device-level switch ──────────────────────────────────────────────────

/**
 * DEVICE-LEVEL, not per-account and not per-profile, and that is deliberate.
 *
 * „Cloud is off on this computer" has to be answerable before any account is
 * unlocked — the boundary is installed while the app is starting, long before
 * anybody has typed a passcode, and a setting stored inside an encrypted
 * profile database cannot be read at that moment. It sits beside
 * `accounts.json` in `userData` for the same reason that file does.
 *
 * Being outside the encrypted database also means it is world-readable and
 * user-writable, so it is NOT a security control in the „an attacker cannot
 * change it" sense. It does not need to be: an attacker who can write this file
 * is running as the user and can replace the whole application. What it needs
 * to be is UNAMBIGUOUS and FAIL-CLOSED, which is what the parsing below is for.
 */
export interface CloudSwitch {
  readonly enabled: boolean;
}

const CLOUD_FILE = "cloud.json";

export function cloudSwitchPath(userData: string): string {
  return join(userData, CLOUD_FILE);
}

/**
 * Reads the switch. ANY doubt reads as off.
 *
 * Missing file, unreadable file, malformed JSON, a JSON value that is not an
 * object, an `enabled` that is not literally `true` — every one of them
 * answers `{ enabled: false }`. There is no repair, no default-on branch and no
 * error propagated to the caller, because every one of those has a path where
 * the app comes up with the boundary down. „I could not tell" and „it is off"
 * must be the same outcome, or the guarantee is conditional on the filesystem.
 */
export function readCloudSwitch(userData: string): CloudSwitch {
  let raw: string;
  try {
    raw = readFileSync(cloudSwitchPath(userData), "utf8");
  } catch {
    return { enabled: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { enabled: false };
  }
  if (typeof parsed !== "object" || parsed === null) return { enabled: false };
  // `=== true`, not truthiness: the string "false", the number 1 and the object
  // `{}` are all truthy, and each is a plausible thing to find in a file a
  // human or a half-finished migration has edited.
  return { enabled: (parsed as { enabled?: unknown }).enabled === true };
}

export function writeCloudSwitch(userData: string, next: CloudSwitch): void {
  const path = cloudSwitchPath(userData);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ enabled: next.enabled }, null, 2)}\n`, "utf8");
}

/**
 * Whether moving from `from` to `to` needs the app restarted before the change
 * is fully in effect. BOTH directions do.
 *
 * The first version of this function returned `from && !to` and its comment
 * claimed „turning cloud ON takes effect immediately — the three runtime layers
 * lift, and DNS was never the layer doing the work". That was wrong, and wrong
 * in the direction that produces a bug report rather than a breach: the
 * resolver block is installed at LAUNCH, from `cloud.json`, and
 * `host-resolver-rules` is a Chromium command-line switch fixed for the life of
 * the process. A user who enables cloud mid-session gets layers 1 and 2 lifted
 * and layer 3 still mapping every name to NOTFOUND — so the transport resolves
 * nothing, forever, with every setting reading „on".
 *
 * The honest rule is that this switch is read once per launch and any change to
 * it needs another one. That is also the simpler thing to explain to a user,
 * and it keeps the guarantee unconditional: the state a launch establishes is
 * the state it stays in.
 */
export function cloudRequiresRestart(from: boolean, to: boolean): boolean {
  return from !== to;
}

/** True when this launch should install the resolver-level block. */
export function shouldBlockResolver(userData: string): boolean {
  return !readCloudSwitch(userData).enabled;
}

/** `true` when `cloud.json` has never been written — i.e. a first run. */
export function cloudSwitchIsUnset(userData: string): boolean {
  return !existsSync(cloudSwitchPath(userData));
}

// ── The network mode (ADR-089) ────────────────────────────────────────────
//
// A SECOND device-level switch, beside cloud.json, and a narrower one: it does
// not decide whether Nexus may reach a server — cloud does that, and there is
// no server yet — it decides whether Nexus may reach GitHub to check for and
// download a new version of ITSELF. The product's default is `"offline"`,
// which is byte-for-byte the 1.4.0 boundary: the resolver maps every name to
// NOTFOUND and no session is given a host to talk to.
//
// It is NOT a boolean, and `version` is not decoration. The file is a small
// forward-compatible record (`{"version":1,"mode":"offline"|"updates"}`) so a
// later release can add a `"cloud"` mode — or any third value — by teaching
// this parser about it, without a migration pass over every device. The
// parser is fail-closed on EVERY kind of doubt, exactly as `readCloudSwitch`
// is: a missing file, an unreadable one, malformed JSON, a version this build
// does not understand, a mode that is not literally one of the two — each
// answers `"offline"`.

/** Which network mode this device is in. `"offline"` is the default and the fail-closed answer. */
export type NetworkMode = "offline" | "updates";

/** The one version this build writes and understands. A future version is a future parser. */
const NETWORK_MODE_VERSION = 1;

const NETWORK_FILE = "network.json";

export function networkModePath(userData: string): string {
  return join(userData, NETWORK_FILE);
}

/**
 * The stored mode, or `null` when no VALID choice is recorded.
 *
 * Exported because two callers ask different questions of the same bytes: the
 * resolver wants "which mode", and the first-run choice screen wants "is a
 * choice recorded at all". A malformed file is `null` — which both callers
 * read as "offline, and ask again", never as "the user chose offline".
 */
export function readNetworkChoice(userData: string): NetworkMode | null {
  let raw: string;
  try {
    raw = readFileSync(networkModePath(userData), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as { version?: unknown; mode?: unknown };
  // `=== 1` and the literal modes, not truthiness: `"1"`, `2`, `"updates "`
  // and an object with a `mode` that merely looks like one all have to land on
  // the same answer as a corrupt file, or a half-finished future migration
  // would come up with the boundary down.
  if (record.version !== NETWORK_MODE_VERSION) return null;
  if (record.mode === "offline") return "offline";
  if (record.mode === "updates") return "updates";
  return null;
}

/** The mode this launch runs under. Missing, unreadable or malformed is `"offline"`. */
export function readNetworkMode(userData: string): NetworkMode {
  return readNetworkChoice(userData) ?? "offline";
}

/**
 * Whether a VALID choice is recorded on this device — the first-run screen's
 * trigger, and true for new installs and upgrades alike on the first 1.5.0
 * launch, because no earlier version ever wrote this file.
 */
export function networkChoiceRecorded(userData: string): boolean {
  return readNetworkChoice(userData) !== null;
}

/**
 * Records the user's choice, atomically.
 *
 * The `network:set-mode` handler is the only writer on the user's behalf: it
 * serves the choice screen's Continue and the card's Save, and selecting a
 * radio and then closing the window must record nothing, so this is
 * deliberately not wired to `onChange`. The harness sandbox is the one other
 * caller — the smoke and shots runs record the default at startup so a sweep
 * photographs the app rather than the question.
 *
 * Atomic for `writeRegistry`'s reason in `accounts.ts`: a crash partway through
 * a plain write leaves a truncated file, and `readNetworkChoice` reads a
 * truncated file as "no choice" — which re-asks the question on a device that
 * already answered it. A sibling `.tmp`, fsynced and closed before the rename,
 * means a reader sees either the old choice or the new one, never half of one.
 */
export function writeNetworkMode(userData: string, mode: NetworkMode): void {
  const path = networkModePath(userData);
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  const fd = openSync(tmpPath, "w");
  try {
    writeSync(fd, `${JSON.stringify({ version: NETWORK_MODE_VERSION, mode }, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, path);
}

/**
 * Whether moving from `from` to `to` needs the app restarted. BOTH directions
 * do, for `cloudRequiresRestart`'s exact reason: the resolver block is a
 * command-line switch installed at launch, so the mode a process came up under
 * is the mode it keeps.
 */
export function networkModeRequiresRestart(from: NetworkMode, to: NetworkMode): boolean {
  return from !== to;
}

/** Updates may reach the network only when this launch came up in "updates" AND the stored choice is still "updates". */
export function updatesActive(running: NetworkMode, stored: NetworkMode): boolean {
  return running === "updates" && stored === "updates";
}

/**
 * The three hosts the update session may reach, matched EXACTLY — no wildcard
 * and no subdomain. They are the whole of ADR-089's pinned chain, verified on
 * 2026-10-07 with `curl.exe -sIL` on a real release asset:
 *
 *   - `api.github.com`            the release API that answers `releases/latest`
 *   - `github.com`                the `/releases/download/…` URL the API names
 *   - `release-assets.githubusercontent.com`  where `github.com` 302-redirects
 *
 * If GitHub ever moves release assets elsewhere the download fails closed —
 * the chain is not re-derived at runtime and the release page is offered
 * instead — which is the behaviour ADR-089 requires.
 */
export const UPDATE_HOSTS: readonly string[] = [
  "api.github.com",
  "github.com",
  "release-assets.githubusercontent.com",
];

/**
 * The value for Chromium's `host-resolver-rules`, or `null` when no block
 * should be installed at all (cloud on).
 *
 * `"MAP * ~NOTFOUND"` is unchanged, byte for byte, in offline mode — that is
 * the 1.4.0 boundary and this change may not widen it. In updates mode the
 * same mapping carries one `EXCLUDE` per pinned host, which is the smallest
 * edit that lets the dedicated update session resolve those three names and
 * nothing else. Cloud on keeps its own untouched behaviour: the resolver block
 * is not installed at all, so sync can reach its Supabase origins.
 */
export function resolverRules(userData: string): string | null {
  if (!shouldBlockResolver(userData)) return null;
  if (readNetworkMode(userData) !== "updates") return "MAP * ~NOTFOUND";
  return `MAP * ~NOTFOUND, ${UPDATE_HOSTS.map((host) => `EXCLUDE ${host}`).join(", ")}`;
}
