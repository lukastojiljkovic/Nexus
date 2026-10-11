import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  allowsWebRequest,
  defaultWebConfig,
  modeAllowsWebSearch,
  parseSearxngOrigin,
  readWebConfig,
  webConfigPath,
  webSearchActive,
  writeWebConfig,
  type WebConfig,
} from "./gate.js";

let userData: string;

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), "nexus-web-"));
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

const ON: WebConfig = { enabled: true, searxng: null };

describe("the web switch", () => {
  it("is off, with no instance, before anything has been written", () => {
    expect(readWebConfig(userData)).toEqual({ enabled: false, searxng: null });
    expect(readWebConfig(userData)).toEqual(defaultWebConfig());
    // Reading is not writing: the file must not exist afterwards.
    expect(existsSync(webConfigPath(userData))).toBe(false);
  });

  it("round-trips both fields", () => {
    writeWebConfig(userData, { enabled: true, searxng: "https://searx.example.org" });
    expect(readWebConfig(userData)).toEqual({ enabled: true, searxng: "https://searx.example.org" });

    writeWebConfig(userData, { enabled: false, searxng: null });
    expect(readWebConfig(userData)).toEqual({ enabled: false, searxng: null });
  });

  it("reads as OFF for every shape of damage", () => {
    // Each of these is a file a human, a crashed write or a half-finished
    // migration could leave behind, and every one of them must land on the same
    // answer: consent is a fact a user recorded or it is absent.
    for (const contents of [
      "",
      "{",
      "null",
      "[]",
      '"true"',
      "42",
      "{}",
      '{"enabled":true}',
      '{"version":"1","enabled":true}',
      '{"version":2,"enabled":true}',
      '{"version":1,"enabled":"true"}',
      '{"version":1,"enabled":1}',
      '{"version":1,"Enabled":true}',
      '{"version":1,"enabled":null}',
    ]) {
      writeFileSync(webConfigPath(userData), contents, "utf8");
      expect(readWebConfig(userData), `contents: ${contents}`).toEqual({ enabled: false, searxng: null });
    }
  });

  it("keeps the consent when only the instance URL is unusable", () => {
    // The two fields are separate decisions: a typo in an instance URL turns
    // that one provider off and does not switch web search off behind the
    // user's back.
    writeFileSync(
      webConfigPath(userData),
      '{"version":1,"enabled":true,"searxng":"http://searx.example.org/","extra":1}',
      "utf8",
    );
    expect(readWebConfig(userData)).toEqual({ enabled: true, searxng: null });
  });
});

describe("parseSearxngOrigin", () => {
  it("takes a bare https origin, and normalises the spellings of one", () => {
    expect(parseSearxngOrigin("https://searx.example.org")).toBe("https://searx.example.org");
    expect(parseSearxngOrigin("https://searx.example.org/")).toBe("https://searx.example.org");
    expect(parseSearxngOrigin("  https://Searx.Example.ORG  ")).toBe("https://searx.example.org");
    // A non-default port is normal for a self-hosted instance, and `origin`
    // keeps it.
    expect(parseSearxngOrigin("https://searx.example.org:8443")).toBe("https://searx.example.org:8443");
  });

  it("refuses anything that is not exactly an origin", () => {
    // Refused rather than trimmed: the request builder appends `/search?q=`, so
    // a base that carried a path would quietly become a different endpoint than
    // the one the user believes they configured.
    for (const raw of [
      "http://searx.example.org",
      "https://searx.example.org/search",
      "https://searx.example.org/?q=x",
      "https://searx.example.org#x",
      "https://user:pass@searx.example.org",
      "searx.example.org",
      "https://",
      "",
      "   ",
      "not a url",
    ]) {
      expect(parseSearxngOrigin(raw), raw).toBeNull();
    }
    for (const notAString of [42, true, null, undefined, { url: "https://searx.example.org" }]) {
      expect(parseSearxngOrigin(notAString), JSON.stringify(notAString)).toBeNull();
    }
  });
});

describe("the mode half of the gate", () => {
  it("needs a mode that allows a connection, and refuses offline only", () => {
    expect(modeAllowsWebSearch("offline")).toBe(false);
    expect(modeAllowsWebSearch("updates")).toBe(true);
    expect(modeAllowsWebSearch("downloads")).toBe(true);
  });

  it("needs BOTH the switch and the mode, and is off on either one alone", () => {
    expect(webSearchActive("downloads", ON)).toBe(true);
    expect(webSearchActive("updates", ON)).toBe(true);
    // The switch on with the mode offline is still no: the mode is the outer
    // promise, and „Offline only" means no connection at all.
    expect(webSearchActive("offline", ON)).toBe(false);
    expect(webSearchActive("downloads", { enabled: false, searxng: null })).toBe(false);
    expect(webSearchActive("offline", { enabled: false, searxng: null })).toBe(false);
  });
});

describe("allowsWebRequest", () => {
  it("admits https while the switch is on in a mode that allows it", () => {
    expect(allowsWebRequest("downloads", ON, "https://sr.wikipedia.org/w/api.php?q=1")).toBe(true);
    expect(allowsWebRequest("updates", ON, "https://93.184.216.34/x")).toBe(true);
  });

  it("refuses http, whatever the switch says", () => {
    expect(allowsWebRequest("downloads", ON, "http://sr.wikipedia.org/")).toBe(false);
    expect(allowsWebRequest("downloads", ON, "ws://sr.wikipedia.org/")).toBe(false);
  });

  it("refuses everything while the switch is off or the mode is offline", () => {
    expect(allowsWebRequest("downloads", { enabled: false, searxng: null }, "https://example.org/")).toBe(false);
    expect(allowsWebRequest("offline", ON, "https://example.org/")).toBe(false);
  });

  it("refuses a URL it cannot parse, for `isRequestAllowed`'s reason", () => {
    for (const raw of ["", "not a url", "http://[", "//example.org/"]) {
      expect(allowsWebRequest("downloads", ON, raw), raw).toBe(false);
    }
  });
});
