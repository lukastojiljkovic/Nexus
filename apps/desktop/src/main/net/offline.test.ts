import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cloudRequiresRestart,
  cloudSwitchIsUnset,
  cloudSwitchPath,
  devServerOrigin,
  isRequestAllowed,
  readCloudSwitch,
  shouldBlockResolver,
  writeCloudSwitch,
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
