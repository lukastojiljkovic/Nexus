import { describe, expect, it } from "vitest";
import { isOwnOrigin } from "./workerOrigin.js";

describe("isOwnOrigin", () => {
  it("accepts the origin the packaged app's page carries", () => {
    // Measured: a `file:` page's messages arrive with the empty origin while
    // `location.origin` reads "file://" on both sides of the worker.
    expect(isOwnOrigin("", "file://")).toBe(true);
  });

  it("accepts a message whose origin is the worker's own", () => {
    expect(isOwnOrigin("http://localhost:5173", "http://localhost:5173")).toBe(true);
  });

  it("refuses every other origin", () => {
    expect(isOwnOrigin("https://example.com", "file://")).toBe(false);
    expect(isOwnOrigin("https://example.com", "http://localhost:5173")).toBe(false);
  });
});
