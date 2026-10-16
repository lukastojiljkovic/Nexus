import { describe, expect, it } from "vitest";

import { asyncSurfacePlan, type AsyncState } from "./AsyncSurface.js";

/**
 * Which arm a read draws.
 *
 * The two failures worth pinning are both quiet ones. A failed read that fell
 * through to the body would draw the rows it could not fetch as if it had
 * fetched them — the wrong screen rather than a missing one — and a failure with
 * no way to ask again must draw no button at all, because a Retry that cannot
 * retry is a lie the user has to press to discover.
 */
describe("asyncSurfacePlan", () => {
  it("draws the skeleton while the read is in flight", () => {
    expect(asyncSurfacePlan({ status: "loading" }, undefined, 6)).toEqual({ arm: "loading", rows: 6 });
  });

  it("leaves the row count to the skeleton when the caller names none", () => {
    expect(asyncSurfacePlan({ status: "loading" }, undefined, undefined)).toEqual({
      arm: "loading",
      rows: undefined,
    });
  });

  it("never falls through to the body of a failed read", () => {
    const state: AsyncState<string> = { status: "failed" };
    expect(asyncSurfacePlan(state, undefined, undefined)).toEqual({ arm: "failed", retry: null });
  });

  it("carries the caller's own way to ask again", () => {
    const onClick = () => undefined;
    const retry = { label: "Pokušaj ponovo", onClick };
    expect(asyncSurfacePlan({ status: "failed" }, retry, undefined)).toEqual({
      arm: "failed",
      retry,
    });
  });

  it("hands the body its data in the ready arm", () => {
    expect(asyncSurfacePlan({ status: "ready", data: [1, 2] }, undefined, undefined)).toEqual({
      arm: "ready",
      data: [1, 2],
    });
  });
});
