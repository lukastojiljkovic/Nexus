import { afterEach, describe, expect, it, vi } from "vitest";

import {
  discardUnsavedExit,
  reportUnsavedExit,
  retryUnsavedExit,
  unsavedExitsFor,
  type UnsavedExit,
} from "./unsavedExits.js";

/** The one exit the profile has, failing the test if it has any other number. */
function only(profileId: string): UnsavedExit {
  const [exit, ...rest] = unsavedExitsFor(profileId);
  if (exit === undefined || rest.length > 0) throw new Error(`expected one exit for ${profileId}`);
  return exit;
}

describe("unsaved exits", () => {
  afterEach(() => {
    for (const profile of ["p1", "p2"]) {
      for (const exit of unsavedExitsFor(profile)) discardUnsavedExit(exit.id);
    }
  });

  it("keeps what failed after its page was gone, for the profile it belongs to", () => {
    reportUnsavedExit({ subject: null, profileId: "p1", message: "A", retry: null });
    reportUnsavedExit({ subject: null, profileId: "p2", message: "B", retry: null });
    expect(only("p1").message).toBe("A");
    expect(only("p2").message).toBe("B");
  });

  it("says one thing per whole-written subject — a newer failure of the board replaces the older", () => {
    reportUnsavedExit({ subject: "canvas:x", profileId: "p1", message: "first", retry: null });
    reportUnsavedExit({ subject: "canvas:x", profileId: "p1", message: "second", retry: null });
    expect(only("p1").message).toBe("second");
  });

  it("keeps every failure with no subject, because each owes a different edit", () => {
    reportUnsavedExit({ subject: null, profileId: "p1", message: "A", retry: async () => {} });
    reportUnsavedExit({ subject: null, profileId: "p1", message: "A", retry: async () => {} });
    expect(unsavedExitsFor("p1")).toHaveLength(2);
  });

  it("drops an exit whose write lands on a retry", async () => {
    const retry = vi.fn(async () => undefined);
    reportUnsavedExit({ subject: null, profileId: "p1", message: "A", retry });
    await retryUnsavedExit(only("p1").id);
    expect(retry).toHaveBeenCalledOnce();
    expect(unsavedExitsFor("p1")).toEqual([]);
  });

  it("keeps an exit whose retry fails, marked, so the offer still stands and says so", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    reportUnsavedExit({
      subject: null,
      profileId: "p1",
      message: "A",
      retry: () => Promise.reject(new Error("disk")),
    });
    await retryUnsavedExit(only("p1").id);
    expect(only("p1")).toMatchObject({ retryable: true, retrying: false, retryFailed: true });
    errors.mockRestore();
  });

  it("starts no second retry while one is out", async () => {
    let land = (): void => undefined;
    const retry = vi.fn(() => new Promise<void>((resolve) => (land = resolve)));
    reportUnsavedExit({ subject: null, profileId: "p1", message: "A", retry });
    const { id } = only("p1");
    const first = retryUnsavedExit(id);
    expect(only("p1").retrying).toBe(true);
    await retryUnsavedExit(id);
    expect(retry).toHaveBeenCalledOnce();
    land();
    await first;
    expect(unsavedExitsFor("p1")).toEqual([]);
  });

  it("offers no retry where replaying the write could not help or could harm", async () => {
    reportUnsavedExit({ subject: "canvas:x", profileId: "p1", message: "X", retry: null });
    expect(only("p1").retryable).toBe(false);
    await retryUnsavedExit(only("p1").id);
    expect(only("p1")).toMatchObject({ retrying: false, retryFailed: false });
  });
});
