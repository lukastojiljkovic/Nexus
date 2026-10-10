import { describe, expect, it } from "vitest";

import { PackError } from "./errors.js";
import { baseManifest, entry } from "./fixtures.js";
import { parsePackManifest } from "./manifest.js";

/** The refusal code a call throws, or a marker that it threw something else. */
function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof PackError ? error.code : `not-a-pack-error: ${String(error)}`;
  }
  return "no-throw";
}

const FILE = entry("wikipedia.zim", "content that stands in for a ZIM");

function manifest(overrides: Readonly<Record<string, unknown>> = {}): unknown {
  return baseManifest([FILE], overrides);
}

describe("the pack manifest", () => {
  it("reads a valid manifest, lower-casing the hashes", () => {
    const parsed = parsePackManifest(manifest());
    expect(parsed.id).toBe("wikipedia-sr");
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.kind).toBe("zim");
    expect(parsed.title.sr).toBe("Vikipedija na srpskom");
    expect(parsed.files).toEqual([{ ...FILE, sha256: FILE.sha256.toLowerCase() }]);
  });

  it("refuses a non-object", () => {
    expect(refusal(() => parsePackManifest("nope"))).toBe("manifest-unreadable");
    expect(refusal(() => parsePackManifest([]))).toBe("manifest-unreadable");
  });

  it("refuses a field the format does not define, at any depth", () => {
    expect(refusal(() => parsePackManifest(manifest({ extra: 1 })))).toBe("manifest-unreadable");
    expect(
      refusal(() =>
        parsePackManifest(
          manifest({
            licence: {
              spdx: "CC-BY-SA-4.0",
              attribution: "Wikipedia contributors",
              url: "https://creativecommons.org/licenses/by-sa/4.0/",
              note: "x",
            },
          }),
        ),
      ),
    ).toBe("manifest-unreadable");
  });

  it("refuses a format this build does not read", () => {
    expect(refusal(() => parsePackManifest(manifest({ format: 2 })))).toBe("format-unknown");
    expect(refusal(() => parsePackManifest(manifest({ format: "1" })))).toBe("format-unknown");
  });

  it("refuses an id that is not kebab-case, too long, or a reserved name", () => {
    expect(refusal(() => parsePackManifest(manifest({ id: "Wikipedia_SR" })))).toBe("id-invalid");
    expect(refusal(() => parsePackManifest(manifest({ id: "-lead" })))).toBe("id-invalid");
    expect(refusal(() => parsePackManifest(manifest({ id: "aux" })))).toBe("id-invalid");
    expect(refusal(() => parsePackManifest(manifest({ id: "a".repeat(65) })))).toBe("id-invalid");
  });

  it("refuses a version that is not MAJOR.MINOR.PATCH", () => {
    for (const version of ["1.0", "1.0.0-rc.1", "v1.0.0", "01.0.0", " 1.0.0"]) {
      expect(refusal(() => parsePackManifest(manifest({ version }))), version).toBe(
        "version-invalid",
      );
    }
  });

  it("refuses a kind outside the five", () => {
    expect(refusal(() => parsePackManifest(manifest({ kind: "video" })))).toBe("kind-unknown");
  });

  it("refuses copy that is missing a language, empty, or over its cap", () => {
    expect(refusal(() => parsePackManifest(manifest({ title: { sr: "Samo srpski" } })))).toBe(
      "title-invalid",
    );
    expect(refusal(() => parsePackManifest(manifest({ title: { sr: " ", en: "x" } })))).toBe(
      "title-invalid",
    );
    expect(
      refusal(() => parsePackManifest(manifest({ title: { sr: "a".repeat(201), en: "x" } }))),
    ).toBe("title-invalid");
    expect(
      refusal(() => parsePackManifest(manifest({ description: { sr: "", en: "x" } }))),
    ).toBe("description-invalid");
  });

  it("refuses a files list that is empty or absent", () => {
    expect(refusal(() => parsePackManifest(manifest({ files: [] })))).toBe("files-invalid");
    expect(refusal(() => parsePackManifest(manifest({ files: null })))).toBe("files-invalid");
  });

  it("refuses a path that breaks a path rule, and names the rule", () => {
    let message = "";
    try {
      parsePackManifest(manifest({ files: [entry("../escape.zim", "x")] }));
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("dot-segment");
  });

  it("refuses a hash that is not 64 hex characters", () => {
    expect(refusal(() => parsePackManifest(manifest({ files: [{ ...FILE, sha256: "abc" }] })))).toBe(
      "hash-invalid",
    );
  });

  it("refuses a size that is not a whole, non-negative number of bytes", () => {
    expect(refusal(() => parsePackManifest(manifest({ files: [{ ...FILE, size: -1 }] })))).toBe(
      "size-invalid",
    );
    expect(refusal(() => parsePackManifest(manifest({ files: [{ ...FILE, size: 1.5 }] })))).toBe(
      "size-invalid",
    );
  });

  it("refuses the same path twice", () => {
    expect(refusal(() => parsePackManifest(manifest({ files: [FILE, FILE] })))).toBe(
      "path-duplicate",
    );
  });

  it("refuses two paths that differ only by case", () => {
    expect(
      refusal(() =>
        parsePackManifest(manifest({ files: [FILE, entry("Wikipedia.zim", "other")] })),
      ),
    ).toBe("path-duplicate-case");
  });

  it("refuses a licence without attribution, or with an address that is not a URL", () => {
    expect(refusal(() => parsePackManifest(manifest({ licence: { spdx: "CC0-1.0", url: "https://x" } })))).toBe(
      "licence-invalid",
    );
    expect(
      refusal(() =>
        parsePackManifest(
          manifest({ licence: { spdx: "CC0-1.0", attribution: "x", url: "file:///etc" } }),
        ),
      ),
    ).toBe("licence-invalid");
  });

  it("refuses a source without a name or an address", () => {
    expect(refusal(() => parsePackManifest(manifest({ source: { url: "https://x" } })))).toBe(
      "source-invalid",
    );
    expect(refusal(() => parsePackManifest(manifest({ source: { name: "x", url: "not a url" } })))).toBe(
      "source-invalid",
    );
  });

  it("refuses a minimum app version that is not a version", () => {
    expect(refusal(() => parsePackManifest(manifest({ minAppVersion: "latest" })))).toBe(
      "min-app-version-invalid",
    );
  });
});

describe("a tool pack's `tool` record", () => {
  /** A manifest of kind `tool`, whose one file the record names as its entry. */
  function toolManifest(tool: unknown, overrides: Readonly<Record<string, unknown>> = {}): unknown {
    return manifest({ kind: "tool", tool, ...overrides });
  }

  it("reads the entry, the protocol and the fixed arguments", () => {
    const parsed = parsePackManifest(toolManifest({ entry: "wikipedia.zim", protocol: "uci" }));
    expect(parsed.kind).toBe("tool");
    expect(parsed.tool).toEqual({ entry: "wikipedia.zim", protocol: "uci" });
    expect(
      parsePackManifest(toolManifest({ entry: "wikipedia.zim", protocol: "stdio", args: ["-y"] }))
        .tool,
    ).toEqual({ entry: "wikipedia.zim", protocol: "stdio", args: ["-y"] });
  });

  it("leaves every other kind without one", () => {
    expect(parsePackManifest(manifest()).tool).toBeUndefined();
  });

  it("refuses `tool` on a kind that is not `tool`", () => {
    expect(
      refusal(() => parsePackManifest(manifest({ tool: { entry: "wikipedia.zim", protocol: "uci" } }))),
    ).toBe("tool-invalid");
  });

  it("refuses a `tool` pack with no `tool`", () => {
    expect(refusal(() => parsePackManifest(manifest({ kind: "tool" })))).toBe("tool-invalid");
  });

  it("refuses an entry that is not one of the manifest's files", () => {
    expect(
      refusal(() => parsePackManifest(toolManifest({ entry: "engine.exe", protocol: "uci" }))),
    ).toBe("tool-invalid");
  });

  it("refuses a protocol outside the two it defines", () => {
    expect(
      refusal(() => parsePackManifest(toolManifest({ entry: "wikipedia.zim", protocol: "json" }))),
    ).toBe("tool-invalid");
  });

  it("refuses a field inside `tool` that the format does not define", () => {
    expect(
      refusal(() =>
        parsePackManifest(toolManifest({ entry: "wikipedia.zim", protocol: "uci", cwd: "/tmp" })),
      ),
    ).toBe("manifest-unreadable");
  });

  it("refuses arguments that are empty, not strings, over the caps, or carry a control character", () => {
    const withArgs = (args: unknown): unknown =>
      toolManifest({ entry: "wikipedia.zim", protocol: "uci", args });
    expect(refusal(() => parsePackManifest(withArgs([""])))).toBe("tool-invalid");
    expect(refusal(() => parsePackManifest(withArgs([1])))).toBe("tool-invalid");
    expect(refusal(() => parsePackManifest(withArgs(["a".repeat(257)])))).toBe("tool-invalid");
    expect(
      refusal(() => parsePackManifest(withArgs(Array.from({ length: 65 }, (_unused, i) => `-${String(i)}`)))),
    ).toBe("tool-invalid");
    expect(refusal(() => parsePackManifest(withArgs(["a\u0000b"])))).toBe("tool-invalid");
  });
});
