import { getWorkerUrl } from "maplibre-gl";
import { describe, expect, it } from "vitest";

import "./mapLibre.js";

describe("MapLibre's worker", () => {
  it("is the bundled worker file, because at file:// MapLibre names none of its own", () => {
    expect(getWorkerUrl()).toMatch(/maplibre-gl-worker[^/]*\.mjs/);
  });
});
