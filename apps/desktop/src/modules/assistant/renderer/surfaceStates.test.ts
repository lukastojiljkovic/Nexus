import { describe, expect, it } from "vitest";
import { copy } from "./copy.js";
import { effectCopy, loadPhase, webStatus, type ConfirmEffect } from "./surfaceStates.js";

/**
 * THE PAGE'S LOAD AND ITS PERMISSION COPY ARE DECIDED HERE, NOT IN THE JSX.
 *
 * The defect the load phase pins is a page that waits forever: a failed read left
 * the skeleton up under an error line and offered no way forward. A failed page is
 * the one whose state says so, and only that page draws the retry.
 */
describe("the page's first load", () => {
  const list = { conversations: [] };
  const setup = { installed: [] };

  it("is loading until both reads have answered", () => {
    expect(loadPhase({ view: null, setup: null, failed: false })).toBe("loading");
    expect(loadPhase({ view: list, setup: null, failed: false })).toBe("loading");
  });

  it("is ready once both reads have answered", () => {
    expect(loadPhase({ view: list, setup, failed: false })).toBe("ready");
  });

  it("has failed when a read failed and nothing has answered since", () => {
    expect(loadPhase({ view: null, setup: null, failed: true })).toBe("failed");
    expect(loadPhase({ view: list, setup: null, failed: true })).toBe("failed");
  });
});

describe("the permission's effect", () => {
  const effects: readonly ConfirmEffect[] = ["write", "navigate", "network"];

  it("draws a distinct chip for each effect, so the three cannot read alike", () => {
    const chips = effects.map((effect) => effectCopy(effect).chip);
    expect(new Set(chips).size).toBe(effects.length);
    for (const effect of effects) {
      expect(effectCopy(effect).note.length).toBeGreaterThan(0);
    }
  });

  it("names a web search as leaving the machine, not as an app write", () => {
    expect(effectCopy("network").chip).toBe(copy.confirm.effects.network.chip);
    expect(effectCopy("network").chip).not.toBe(effectCopy("write").chip);
  });
});

describe("the status row's web search", () => {
  it("is off when the consent is not given, whatever the network mode", () => {
    expect(webStatus({ enabled: false, modeAllows: true })).toBe("off");
  });

  it("is on when given and the mode allows it", () => {
    expect(webStatus({ enabled: true, modeAllows: true })).toBe("on");
  });

  it("is blocked when given but the network mode refuses it", () => {
    expect(webStatus({ enabled: true, modeAllows: false })).toBe("blocked");
  });
});
