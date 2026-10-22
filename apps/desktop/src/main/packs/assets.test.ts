import { describe, expect, it } from "vitest";

import { packAssetName, packAssetUrl } from "./assets.js";

/**
 * The app derives every pack file's address from the rule the publishing tool
 * used to name it (ADR-103, format 2). That the two spellings agree is pinned on
 * the tool's side, `scripts/packs/catalogue.test.mjs`, where a test can import
 * both; this file pins the rule's own cases.
 */
const SHA = "0123456789abcdef".repeat(4);

describe("the asset name of a pack file", () => {
  it("flattens folders and replaces the characters GitHub refuses", () => {
    expect(packAssetName("survival", "pack.json", SHA)).toBe("survival__pack.json");
    expect(packAssetName("survival", "content/first-aid/a b#1?.md", SHA)).toBe(
      "survival__content__first-aid__a_b_1_.md",
    );
  });

  it("cuts a name over the cap and suffixes the file's own digest", () => {
    const long = packAssetName("reference-en", `content/${"x".repeat(300)}.html`, SHA);
    expect(long).toHaveLength(180 + 1 + 16);
    expect(long.endsWith(`-${SHA.slice(0, 16)}`)).toBe(true);
  });

  it("joins the entry's base and the name", () => {
    expect(
      packAssetUrl(
        "https://github.com/lukastojiljkovic/nexus-packs/releases/download/survival-2026.10.0/",
        "survival",
        "pack.json",
        SHA,
      ),
    ).toBe("https://github.com/lukastojiljkovic/nexus-packs/releases/download/survival-2026.10.0/survival__pack.json");
  });
});
