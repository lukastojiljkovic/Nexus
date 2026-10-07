import { describe, expect, it } from "vitest";

import { UPDATE_HOSTS } from "../net/offline.js";
import { isUpdateRequestAllowed } from "./allowlist.js";

describe("the update session's allowlist", () => {
  it("admits https requests to exactly the three pinned hosts", () => {
    for (const host of UPDATE_HOSTS) {
      expect(isUpdateRequestAllowed(`https://${host}/some/path?q=1`), host).toBe(true);
    }
    // The session rule is about HOSTS; the repository is pinned one layer up,
    // by `release.ts`'s asset-URL prefix. A github.com path outside this
    // repository is admitted here and refused there, which is the split that
    // keeps the resolver's EXCLUDE list and the session's list identical.
    expect(isUpdateRequestAllowed("https://github.com/other/repo/x")).toBe(true);
  });

  it("refuses every other host, including lookalikes", () => {
    for (const url of [
      "https://example.com/",
      "https://evil-api.github.com/",
      "https://api.github.com.evil.tld/",
      "https://github.com.evil.tld/",
      "https://raw.githubusercontent.com/",
      "https://objects.githubusercontent.com/",
    ]) {
      expect(isUpdateRequestAllowed(url), url).toBe(false);
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
      expect(isUpdateRequestAllowed(url), url).toBe(false);
    }
  });
});
