import { describe, expect, it } from "vitest";

import { PRIVILEGED_SCHEMES } from "./schemes.js";

describe("the privileged schemes", () => {
  it("registers each scheme once", () => {
    const names = PRIVILEGED_SCHEMES.map((entry) => entry.scheme);
    expect(names).toEqual([...new Set(names)]);
  });

  it("lets the page read pack files, map regions and the Reference frame across origins, and nothing else", () => {
    const cors = PRIVILEGED_SCHEMES.filter((entry) => entry.privileges?.corsEnabled === true).map((entry) => entry.scheme);
    expect(cors.sort()).toEqual(["nx-map", "nx-pack", "nx-zim"]);
  });
});
