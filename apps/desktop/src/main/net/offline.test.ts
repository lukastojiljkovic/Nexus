import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  activeNetworkMode,
  allowedHostsFor,
  DOWNLOAD_HOSTS,
  cloudRequiresRestart,
  cloudSwitchIsUnset,
  cloudSwitchPath,
  devServerOrigin,
  isBareHostName,
  isHttpsHostAllowed,
  isRequestAllowed,
  isSessionRequestAllowed,
  modeAllowsDownloads,
  modeAllowsUpdates,
  networkChoiceRecorded,
  networkModePath,
  networkModeRequiresRestart,
  readCloudSwitch,
  readNetworkChoice,
  readNetworkMode,
  resolverRules,
  shouldBlockResolver,
  type NetworkMode,
  UPDATE_HOSTS,
  updatesActive,
  writeCloudSwitch,
  writeNetworkMode,
} from "./offline.js";

let userData: string;

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), "nexus-offline-"));
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

describe("the request allowlist", () => {
  it("admits the local schemes the app actually serves from", () => {
    for (const url of [
      "file:///C:/Program%20Files/Nexus/renderer/index.html",
      "nx-blob://a1b2c3",
      "priv-blob://a1b2c3",
      "nx-pack://prva-pomoc/uvod.md",
      "devtools://devtools/bundled/inspector.html",
      "data:image/png;base64,iVBORw0KGgo=",
      "blob:file:///9b1deb4d",
      "about:blank",
    ]) {
      expect(isRequestAllowed(url, [], null)).toBe(true);
    }
  });

  it("cancels every remote request while cloud is off", () => {
    for (const url of [
      "https://esm.sh/@excalidraw/excalidraw/dist/fonts.css",
      "https://redirector.gvt1.com/edgedl/chrome/dict/sr-x-hunspell.bdic",
      "http://192.168.1.4/beacon",
      "https://nexus-project.supabase.co/rest/v1/sync_objects",
      "wss://nexus-project.supabase.co/realtime/v1/websocket",
      "ws://127.0.0.1:9229",
    ]) {
      expect(isRequestAllowed(url, [], null)).toBe(false);
    }
  });

  it("names the two requests the shipped 1.0.0 actually made", () => {
    // Not decoration: the security review found BOTH of these live in a build
    // whose own privacy copy said the only outbound request was a version
    // check. They are the regression test for the claim, not for the code.
    expect(isRequestAllowed("https://esm.sh/x", [], null)).toBe(false);
    expect(
      isRequestAllowed("https://redirector.gvt1.com/edgedl/chrome/dict/en-US.bdic", [], null),
    ).toBe(false);
  });

  it("admits exactly the allowlisted origins once cloud is on, and nothing beside them", () => {
    const allowed = ["https://abcdefgh.supabase.co", "wss://abcdefgh.supabase.co"];
    expect(isRequestAllowed("https://abcdefgh.supabase.co/rest/v1/x", allowed, null)).toBe(true);
    expect(isRequestAllowed("wss://abcdefgh.supabase.co/realtime/v1", allowed, null)).toBe(true);

    // A different project, a different subdomain, and the same host on the
    // other scheme or port — an origin comparison catches all three, a
    // `endsWith("supabase.co")` catches none of them.
    expect(isRequestAllowed("https://evil.supabase.co/rest/v1/x", allowed, null)).toBe(false);
    expect(isRequestAllowed("https://abcdefgh.supabase.co.evil.tld/x", allowed, null)).toBe(false);
    expect(isRequestAllowed("http://abcdefgh.supabase.co/x", allowed, null)).toBe(false);
    expect(isRequestAllowed("https://abcdefgh.supabase.co:8443/x", allowed, null)).toBe(false);
  });

  it("cancels a request whose URL it cannot parse", () => {
    // „Unparseable" is not „harmless": it is a destination this code cannot
    // vouch for, and fail-open on the ones you do not understand is how a
    // boundary becomes a suggestion.
    expect(isRequestAllowed("http://[", [], null)).toBe(false);
    expect(isRequestAllowed("", [], null)).toBe(false);
  });

  it("admits the dev server only when electron-vite set its variable", () => {
    expect(devServerOrigin({})).toBeNull();
    expect(devServerOrigin({ ELECTRON_RENDERER_URL: "" })).toBeNull();
    expect(devServerOrigin({ ELECTRON_RENDERER_URL: "not a url" })).toBeNull();

    const origin = devServerOrigin({ ELECTRON_RENDERER_URL: "http://localhost:5173/" });
    expect(origin).toBe("http://localhost:5173");
    expect(isRequestAllowed("http://localhost:5173/src/main.tsx", [], origin)).toBe(true);
    // The hole is one origin wide. Another port on the same host is not it.
    expect(isRequestAllowed("http://localhost:5174/x", [], origin)).toBe(false);
  });

  it("cancels the allowlisted hosts for the renderer in EVERY mode", () => {
    // ADR-089's whole shape, as one assertion: the renderer's rule takes no
    // network mode, because the mode never widens it — and ADR-092's third mode
    // does not change that, which is the whole of „offline only stays exactly
    // as strong as it is". The hosts the dedicated session may reach — the
    // update list AND the download list, which contains it — are cancelled by
    // the renderer's rule exactly as they were in 1.4.0; only `ses.fetch` on
    // that session can use them, and this function is what the `defaultSession`
    // installs.
    for (const host of [...UPDATE_HOSTS, ...DOWNLOAD_HOSTS]) {
      expect(isRequestAllowed(`https://${host}/x`, [], null), host).toBe(false);
      expect(isRequestAllowed(`https://${host}/x`, [], "http://localhost:5173")).toBe(false);
    }
  });
});

describe("the device-level switch", () => {
  it("is off before anything has been written", () => {
    expect(cloudSwitchIsUnset(userData)).toBe(true);
    expect(readCloudSwitch(userData)).toEqual({ enabled: false });
    expect(shouldBlockResolver(userData)).toBe(true);
  });

  it("round-trips both states", () => {
    writeCloudSwitch(userData, { enabled: true });
    expect(readCloudSwitch(userData)).toEqual({ enabled: true });
    expect(cloudSwitchIsUnset(userData)).toBe(false);
    expect(shouldBlockResolver(userData)).toBe(false);

    writeCloudSwitch(userData, { enabled: false });
    expect(readCloudSwitch(userData)).toEqual({ enabled: false });
  });

  it("reads as OFF for every shape of damage", () => {
    // Each of these is a file a human, a crashed write or a half-finished
    // migration could plausibly leave behind, and every one of them must land
    // on the same answer. A single truthiness check would let three through.
    for (const contents of [
      "",
      "{",
      "null",
      "[]",
      '"true"',
      "42",
      "{}",
      '{"enabled":"true"}',
      '{"enabled":1}',
      '{"enabled":"false"}',
      '{"Enabled":true}',
      '{"enabled":null}',
    ]) {
      writeFileSync(cloudSwitchPath(userData), contents, "utf8");
      expect(readCloudSwitch(userData), `contents: ${contents}`).toEqual({ enabled: false });
    }
  });

  it("needs a restart in BOTH directions", () => {
    // The assertion this replaced said turning cloud ON was immediate, which
    // matched the code and was wrong about the product: `host-resolver-rules`
    // is installed at launch from `cloud.json` and is fixed for the life of the
    // process, so a user who enables cloud mid-session would get layers 1 and 2
    // lifted and DNS still dead — sync failing forever with every setting
    // reading „on". A test written to match the implementation agrees with the
    // bug.
    expect(cloudRequiresRestart(false, true)).toBe(true);
    expect(cloudRequiresRestart(true, false)).toBe(true);
    // A no-op change is not a change.
    expect(cloudRequiresRestart(false, false)).toBe(false);
    expect(cloudRequiresRestart(true, true)).toBe(false);
  });
});

describe("the network mode (ADR-089, ADR-092)", () => {
  it("is offline, and unrecorded, before anything has been written", () => {
    // Both halves of the first-run rule: the boundary is the strong one, and
    // the choice screen has not been answered. An upgrading user hits this
    // exact state on the first 1.5.0 launch, because no earlier version wrote
    // the file.
    expect(readNetworkMode(userData)).toBe("offline");
    expect(networkChoiceRecorded(userData)).toBe(false);
    expect(resolverRules(userData)).toBe("MAP * ~NOTFOUND");
  });

  it("round-trips every mode", () => {
    writeNetworkMode(userData, "updates");
    expect(readNetworkMode(userData)).toBe("updates");
    expect(networkChoiceRecorded(userData)).toBe(true);

    writeNetworkMode(userData, "offline");
    expect(readNetworkMode(userData)).toBe("offline");
    expect(networkChoiceRecorded(userData)).toBe(true);

    writeNetworkMode(userData, "downloads");
    expect(readNetworkMode(userData)).toBe("downloads");
    expect(readNetworkChoice(userData)).toBe("downloads");
    expect(networkChoiceRecorded(userData)).toBe(true);
  });

  it("reads as offline AND unrecorded for every shape of damage", () => {
    // Each of these is a file a human, a crashed write, a hand-edited future
    // version or a half-finished migration could plausibly leave behind. Every
    // one must fail closed on BOTH questions — the mode and the record — or
    // the choice screen would be skipped for a file this build cannot trust.
    for (const contents of [
      "",
      "{",
      "null",
      "[]",
      '"updates"',
      "42",
      "{}",
      '{"mode":"updates"}',
      '{"version":2,"mode":"offline"}',
      '{"version":"1","mode":"offline"}',
      '{"version":1}',
      '{"version":1,"mode":"offline "}',
      '{"version":1,"mode":"Offline"}',
      '{"version":1,"mode":"cloud"}',
      '{"Version":1,"Mode":"updates"}',
      '{"version":1,"mode":true}',
    ]) {
      writeFileSync(networkModePath(userData), contents, "utf8");
      expect(readNetworkMode(userData), `contents: ${contents}`).toBe("offline");
      expect(networkChoiceRecorded(userData), `contents: ${contents}`).toBe(false);
    }
  });

  it("installs the plain resolver block in offline mode, byte for byte", () => {
    // The 1.4.0 boundary. This string is the whole of the promise to a user who
    // picks „Offline only", so it may not gain so much as a space.
    writeNetworkMode(userData, "offline");
    expect(resolverRules(userData)).toBe("MAP * ~NOTFOUND");
  });

  it("adds exactly one EXCLUDE per pinned host in updates mode", () => {
    writeNetworkMode(userData, "updates");
    const rule = resolverRules(userData);
    expect(rule).not.toBeNull();
    // The base rule is unchanged; the exceptions are appended and named.
    expect(rule?.startsWith("MAP * ~NOTFOUND, ")).toBe(true);
    for (const host of UPDATE_HOSTS) {
      expect(rule).toContain(`EXCLUDE ${host}`);
    }
    // One base rule plus one EXCLUDE each — no wildcard, no fourth host.
    expect(rule?.split(", ").length).toBe(UPDATE_HOSTS.length + 1);
  });

  it("installs no resolver block at all once cloud is on", () => {
    // Cloud keeps its own behaviour: the block is what sync has to lift, and
    // the network mode must not add one back.
    writeNetworkMode(userData, "updates");
    writeCloudSwitch(userData, { enabled: true });
    expect(resolverRules(userData)).toBeNull();
    expect(shouldBlockResolver(userData)).toBe(false);
  });

  it("needs a restart in BOTH directions", () => {
    expect(networkModeRequiresRestart("offline", "updates")).toBe(true);
    expect(networkModeRequiresRestart("updates", "offline")).toBe(true);
    expect(networkModeRequiresRestart("offline", "offline")).toBe(false);
    expect(networkModeRequiresRestart("updates", "updates")).toBe(false);
    // The third mode is fixed at launch for the same reason the second is —
    // `host-resolver-rules` is a command-line switch — so both directions need
    // a restart here too, and a no-op change is still not a change.
    expect(networkModeRequiresRestart("updates", "downloads")).toBe(true);
    expect(networkModeRequiresRestart("downloads", "updates")).toBe(true);
    expect(networkModeRequiresRestart("downloads", "offline")).toBe(true);
    expect(networkModeRequiresRestart("downloads", "downloads")).toBe(false);
  });

  it("lets updates reach the network only when launch and stored choice agree", () => {
    // The one rule every update path consults, all four combinations. Switching
    // to offline stops checks at once (the second row); switching to updates
    // takes effect only after a restart (the third), because the mode the
    // process came up under is the mode it keeps.
    expect(updatesActive("updates", "updates")).toBe(true);
    expect(updatesActive("updates", "offline")).toBe(false);
    expect(updatesActive("offline", "updates")).toBe(false);
    expect(updatesActive("offline", "offline")).toBe(false);
  });

  it("records nothing on a read — closing the choice screen writes no file", () => {
    // „Closing the window without choosing records nothing": reading is the
    // only thing that happens while the screen is open, so nothing may create
    // the file, and `networkChoiceRecorded` must stay false afterwards.
    expect(existsSync(networkModePath(userData))).toBe(false);
    expect(readNetworkMode(userData)).toBe("offline");
    expect(networkChoiceRecorded(userData)).toBe(false);
    expect(existsSync(networkModePath(userData))).toBe(false);
  });

  it("parses the third mode, and still fails closed on a mode it has never heard of", () => {
    // The version did NOT move when the third mode arrived, because that number
    // describes the file's shape rather than its vocabulary — which is exactly
    // what ADR-089 said it was for. And the third row is the one that keeps this
    // honest the other way: a file a LATER build wrote (version 2, whatever its
    // mode) is a dialect this build must not guess at, so it falls through to
    // offline and „no valid choice recorded" like any corrupt file.
    for (const contents of [
      '{"version":1,"mode":"cloud"}',
      '{"version":1,"mode":"Downloads"}',
      '{"version":1,"mode":"downloads "}',
      '{"version":2,"mode":"downloads"}',
    ]) {
      writeFileSync(networkModePath(userData), contents, "utf8");
      expect(readNetworkMode(userData), `contents: ${contents}`).toBe("offline");
      expect(networkChoiceRecorded(userData), `contents: ${contents}`).toBe(false);
    }
  });

  it("names the mode a launch may ACT on, and no mode at all while a restart is owed", () => {
    expect(activeNetworkMode("offline", "offline")).toBe("offline");
    expect(activeNetworkMode("updates", "updates")).toBe("updates");
    expect(activeNetworkMode("downloads", "downloads")).toBe("downloads");
    // Every disagreement is a stored change, and a stored change is a restart
    // owed: until it happens the launch keeps the boundary it started with, and
    // the answer that can never be too wide is „offline". Switching DOWN to
    // offline is therefore immediate, and switching up waits — the same
    // asymmetry ADR-089 chose for the update check.
    const disagreements: readonly (readonly [NetworkMode, NetworkMode])[] = [
      ["updates", "offline"],
      ["offline", "updates"],
      ["downloads", "offline"],
      ["offline", "downloads"],
      ["downloads", "updates"],
      ["updates", "downloads"],
    ];
    for (const [running, stored] of disagreements) {
      expect(activeNetworkMode(running, stored), `${running}/${stored}`).toBe("offline");
    }
  });

  it("keeps the update check in the widest mode, and gives it to no other mode", () => {
    // ADR-092's superset order, as the two predicates every guard reads.
    expect(modeAllowsUpdates("offline")).toBe(false);
    expect(modeAllowsUpdates("updates")).toBe(true);
    expect(modeAllowsUpdates("downloads")).toBe(true);
    expect(modeAllowsDownloads("offline")).toBe(false);
    expect(modeAllowsDownloads("updates")).toBe(false);
    expect(modeAllowsDownloads("downloads")).toBe(true);

    expect(updatesActive("downloads", "downloads")).toBe(true);
    expect(updatesActive("downloads", "updates")).toBe(false);
    expect(updatesActive("downloads", "offline")).toBe(false);
  });
});

describe("the two host lists", () => {
  it("holds bare host names and nothing else, which is what keeps https-only structural", () => {
    // The whole of the list's own rule, over BOTH lists so a host added to
    // either is held to it: a scheme, a port, a path or a `*` fails this, and
    // the https requirement is not stated here because it cannot be — a bare
    // host name has no scheme, so the scheme rule lives in
    // `isHttpsHostAllowed` below, which is the only thing that reads a list.
    for (const host of [...UPDATE_HOSTS, ...DOWNLOAD_HOSTS]) {
      expect(isBareHostName(host), host).toBe(true);
    }
    for (const notAHost of [
      "https://api.github.com",
      "api.github.com:443",
      "*.github.com",
      "github.com/releases",
      "GitHub.com",
      "",
    ]) {
      expect(isBareHostName(notAHost), notAHost).toBe(false);
    }
  });

  it("makes the download list a superset of the update list, so the wider mode cannot cost the narrower one its exception", () => {
    // The invariant that makes „add a host with one line" safe. `"downloads"`
    // contains `"updates"`, so every host the update check is allowed must be in
    // the download list as well — otherwise a user who moved UP to downloads
    // would silently lose the update check they already had.
    for (const host of UPDATE_HOSTS) {
      expect(DOWNLOAD_HOSTS, host).toContain(host);
    }
  });
});

describe("the dedicated session's host rule (ADR-089, ADR-092)", () => {
  it("admits https requests to exactly the hosts the launch's mode names", () => {
    for (const host of UPDATE_HOSTS) {
      expect(isSessionRequestAllowed("updates", `https://${host}/some/path?q=1`), host).toBe(true);
      // The superset order, not a coincidence: the same host is admitted in the
      // wider mode, which is what lets one session serve both.
      expect(isSessionRequestAllowed("downloads", `https://${host}/some/path?q=1`), host).toBe(true);
    }
    for (const host of DOWNLOAD_HOSTS) {
      expect(isSessionRequestAllowed("downloads", `https://${host}/x`), host).toBe(true);
    }
    // The session rule is about HOSTS; the repository is pinned one layer up,
    // by `release.ts`'s asset-URL prefix. A github.com path outside this
    // repository is admitted here and refused there, which is the split that
    // keeps the resolver's EXCLUDE list and the session's list identical.
    expect(isSessionRequestAllowed("updates", "https://github.com/other/repo/x")).toBe(true);
  });

  it("refuses every host the launch's mode does not name, including lookalikes", () => {
    for (const url of [
      "https://example.com/",
      "https://evil-api.github.com/",
      "https://api.github.com.evil.tld/",
      "https://github.com.evil.tld/",
      "https://raw.githubusercontent.com/",
      "https://objects.githubusercontent.com/",
    ]) {
      expect(isSessionRequestAllowed("updates", url), url).toBe(false);
      expect(isSessionRequestAllowed("downloads", url), url).toBe(false);
    }
  });

  it("refuses anything that is not https, including an upgraded-looking port", () => {
    for (const url of [
      "http://api.github.com/",
      "http://github.com/lukastojiljkovic/Nexus/releases/download/x",
      "ws://github.com/",
      "https://api.github.com:8443/",
      // No scheme, an unparseable URL, and a bare word.
      "api.github.com",
      "http://[",
      "",
    ]) {
      expect(isSessionRequestAllowed("updates", url), url).toBe(false);
      expect(isSessionRequestAllowed("downloads", url), url).toBe(false);
      expect(isHttpsHostAllowed(url, DOWNLOAD_HOSTS), url).toBe(false);
    }
  });

  it("reaches nothing at all in offline mode, the hosts it allows elsewhere included", () => {
    // The assertion behind „offline only stays exactly as strong as it is": the
    // dedicated session is not merely unused in offline mode, it is dead — its
    // rule refuses the two other modes' own hosts.
    expect(allowedHostsFor("offline")).toBeNull();
    for (const host of [...UPDATE_HOSTS, ...DOWNLOAD_HOSTS]) {
      expect(isSessionRequestAllowed("offline", `https://${host}/x`), host).toBe(false);
    }
  });

  it("admits the wider list only in the wider mode", () => {
    // Vacuously true today, because the download list IS the update list — and
    // that is the point: the day a content host is appended (ADR-092 says
    // Kiwix's will be), this test is what proves the one-line change admitted
    // it in `"downloads"` without admitting it in `"updates"`.
    const addedByDownloads = DOWNLOAD_HOSTS.filter((host) => !UPDATE_HOSTS.includes(host));
    for (const host of addedByDownloads) {
      expect(isSessionRequestAllowed("downloads", `https://${host}/x`), host).toBe(true);
      expect(isSessionRequestAllowed("updates", `https://${host}/x`), host).toBe(false);
    }
  });
});
