import { describe, expect, it } from "vitest";
import { sourceOfAction } from "./intent.js";

/**
 * The scanner's `source` action, read as data. The page points at the file input
 * or the camera button for it, so what matters here is that only the two sources
 * the page has ever offered come through, and that nothing else is guessed.
 */
describe("the source action", () => {
  it("points at the file input and the camera button, and nothing else", () => {
    expect(sourceOfAction({ source: "file" })).toBe("file");
    expect(sourceOfAction({ source: "camera" })).toBe("camera");
    expect(sourceOfAction({ source: "paste" })).toBeNull();
    expect(sourceOfAction({ source: "Camera" })).toBeNull();
  });

  it("refuses a payload with no source, or no object at all", () => {
    expect(sourceOfAction({})).toBeNull();
    expect(sourceOfAction(undefined)).toBeNull();
    expect(sourceOfAction("camera")).toBeNull();
  });
});
