import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  decideRelease,
  installerAssetName,
  isAllowedReleaseAssetUrl,
  parseRelease,
  RELEASES_PAGE_URL,
  type Release,
} from "./release.js";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("release asset URLs", () => {
  it("accepts only https GitHub download URLs under the pinned repository", () => {
    expect(
      isAllowedReleaseAssetUrl(
        "https://github.com/lukastojiljkovic/Nexus/releases/download/v1.5.0/Nexus-Setup-1.5.0.exe",
      ),
    ).toBe(true);
    for (const bad of [
      // A different repository, even one that shares the prefix's shape.
      "https://github.com/someoneelse/Nexus/releases/download/v1.5.0/Nexus-Setup-1.5.0.exe",
      // The right path under a lookalike host.
      "https://github.com.evil.tld/lukastojiljkovic/Nexus/releases/download/v1.5.0/x.exe",
      // Dot-segment traversal. The WHATWG parser normalises `..` and its
      // `%2e%2e` spelling before the pathname is read, which is exactly why the
      // check runs on the parsed path and never on the raw string.
      "https://github.com/lukastojiljkovic/Nexus/releases/download/../../../attacker/x/releases/download/v1/a.exe",
      "https://github.com/lukastojiljkovic/Nexus/releases/download/%2e%2e/%2e%2e/%2e%2e/attacker/x/releases/download/v1/a.exe",
      // A userinfo, an explicit port and a query string all change the parsed
      // shape away from the pinned one.
      "https://user@github.com/lukastojiljkovic/Nexus/releases/download/v1.5.0/x.exe",
      "https://github.com:444/lukastojiljkovic/Nexus/releases/download/v1.5.0/x.exe",
      "https://github.com/lukastojiljkovic/Nexus/releases/download/v1.5.0/x.exe?redirect=1",
      // Plain http, a redirect host, and a bare releases page.
      "http://github.com/lukastojiljkovic/Nexus/releases/download/v1.5.0/x.exe",
      "https://release-assets.githubusercontent.com/lukastojiljkovic/Nexus/download/x.exe",
      "https://github.com/lukastojiljkovic/Nexus/releases/latest",
      "",
      "not a url",
    ]) {
      expect(isAllowedReleaseAssetUrl(bad), bad).toBe(false);
    }
  });

  it("names the one Windows installer", () => {
    expect(installerAssetName("1.5.0")).toBe("Nexus-Setup-1.5.0.exe");
  });
});

describe("reading a release", () => {
  it("keeps the version, the notes and the two assets it needs", () => {
    const release = parseRelease({
      tag_name: "v1.5.0",
      body: "## Šta je novo\n\n- mrežni režim",
      html_url: "https://github.com/lukastojiljkovic/Nexus/releases/tag/v1.5.0",
      assets: [
        {
          name: "Nexus-Setup-1.5.0.exe",
          browser_download_url:
            "https://github.com/lukastojiljkovic/Nexus/releases/download/v1.5.0/Nexus-Setup-1.5.0.exe",
        },
        {
          name: "SHA256SUMS.txt",
          browser_download_url:
            "https://github.com/lukastojiljkovic/Nexus/releases/download/v1.5.0/SHA256SUMS.txt",
        },
      ],
    });
    expect(release?.version).toBe("v1.5.0");
    expect(release?.notes).toContain("mrežni režim");
    expect(release?.assets).toHaveLength(2);
  });

  it("answers null for anything that is not a release object", () => {
    for (const bad of [null, "x", 42, {}, { tag_name: 5 }]) {
      expect(parseRelease(bad)).toBeNull();
    }
  });
});

describe("deciding whether a release is an update", () => {
  const base: Release = {
    version: "v1.5.0",
    notes: "notes",
    pageUrl: RELEASES_PAGE_URL,
    assets: [
      {
        name: "Nexus-Setup-1.5.0.exe",
        url: "https://github.com/lukastojiljkovic/Nexus/releases/download/v1.5.0/Nexus-Setup-1.5.0.exe",
      },
      {
        name: "SHA256SUMS.txt",
        url: "https://github.com/lukastojiljkovic/Nexus/releases/download/v1.5.0/SHA256SUMS.txt",
      },
      {
        name: "SHA256SUMS.txt.sig",
        url: "https://github.com/lukastojiljkovic/Nexus/releases/download/v1.5.0/SHA256SUMS.txt.sig",
      },
    ],
  };

  it("is up to date when the tag is not newer", () => {
    expect(decideRelease({ ...base, version: "v1.4.0" }, "1.4.0", "win32").kind).toBe("up-to-date");
  });

  it("is undecidable for a tag it cannot parse, rather than silently older", () => {
    expect(decideRelease({ ...base, version: "latest" }, "1.4.0", "win32")).toEqual({
      kind: "undecidable",
      version: "latest",
    });
    // No pre-release grammar at all (A6): a tag that looks like one is
    // undecidable rather than quietly sorting below its release.
    expect(decideRelease({ ...base, version: "v1.5.0-rc.1" }, "1.5.0", "win32").kind).toBe(
      "undecidable",
    );
  });

  it("offers the installer on Windows when the exact asset is present", () => {
    const decision = decideRelease(base, "1.4.0", "win32");
    expect(decision.kind).toBe("available");
    if (decision.kind === "available") {
      expect(decision.offer.installer?.name).toBe("Nexus-Setup-1.5.0.exe");
    }
  });

  it("offers the version but refuses Install when the Windows asset is missing or mistyped", () => {
    const missing = decideRelease({ ...base, assets: [] }, "1.4.0", "win32");
    expect(missing.kind).toBe("available");
    if (missing.kind === "available") expect(missing.offer.installer).toBeNull();

    const mistyped = decideRelease(
      {
        ...base,
        assets: [
          {
            name: "Nexus-Setup-1.5.0.exe",
            url: "https://evil.tld/Nexus-Setup-1.5.0.exe",
          },
        ],
      },
      "1.4.0",
      "win32",
    );
    if (mistyped.kind === "available") expect(mistyped.offer.installer).toBeNull();
  });

  it("installs nothing on Linux — the release page is the offer", () => {
    const decision = decideRelease(base, "1.4.0", "linux");
    if (decision.kind === "available") expect(decision.offer.installer).toBeNull();
  });
});

describe("the release page literal", () => {
  it("is byte-identical to the one `electron.ts` hands to the browser", () => {
    // `electron.ts` cannot be imported here (it needs a live Electron), so the
    // one pinned literal is guaranteed by reading the file. The exemption in
    // `check-egress.mjs` is real because that file names the URL directly; this
    // test is what keeps the two spellings from drifting apart.
    const source = readFileSync(join(HERE, "electron.ts"), "utf8");
    expect(source).toContain(`"${RELEASES_PAGE_URL}"`);
  });
});
