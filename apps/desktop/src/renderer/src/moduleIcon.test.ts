import { describe, expect, it } from "vitest";

import { createModuleRegistry } from "../../shared/modules.js";
import { moduleIconName } from "./moduleIcon.js";

describe("moduleIconName", () => {
  it("gives every module the shipping registry holds a mark — the rail draws none for a gap", () => {
    const bare = createModuleRegistry()
      .all()
      .map((manifest) => manifest.id)
      .filter((id) => moduleIconName(id) === undefined);
    expect(bare).toEqual([]);
  });

  it("answers undefined for a module the set does not cover", () => {
    expect(moduleIconName("not-a-module")).toBeUndefined();
  });

  it("reads own keys only — a stored layout row naming `toString` is not a module", () => {
    expect(moduleIconName("toString")).toBeUndefined();
    expect(moduleIconName("constructor")).toBeUndefined();
  });
});
