import { describe, expect, it } from "vitest";

import { PRIVILEGED_SCHEMES } from "./schemes.js";

describe("the privileged schemes", () => {
  it("registers each scheme once", () => {
    const names = PRIVILEGED_SCHEMES.map((entry) => entry.scheme);
    expect(names).toEqual([...new Set(names)]);
  });

  it("lets the page fetch a pack's files and a map region, and nothing else across origins", () => {
    const cors = PRIVILEGED_SCHEMES.filter((entry) => entry.privileges?.corsEnabled === true).map((entry) => entry.scheme);
    expect(cors.sort()).toEqual(["nx-map", "nx-pack"]);
  });
});
