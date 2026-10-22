import { describe, expect, it } from "vitest";
import { copy } from "./copy.js";
import {
  effectCopy,
  loadPhase,
  hasAnsweringModel,
  pickInstalled,
  servesTiers,
  webStatus,
  type ConfirmEffect,
} from "./surfaceStates.js";

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

/**
 * The setup read answers from the disk and the probe answers seconds later, so
 * the page joins the two itself. The defect these pin is the setup screen
 * flashing at everyone who has a model, every time the page opens.
 */
describe("which model answers, before and after the hardware probe", () => {
  const chat = (id: string, chosen = false) => ({ model: { id, capabilities: ["chat"] }, chosen });
  const embedding = { model: { id: "embed", capabilities: ["embedding"] }, chosen: false };
  const probe = {
    recommendations: [
      { tier: "balance" as const, model: { id: "pick" } },
      { tier: "speed" as const, model: { id: "pick" } },
    ],
  };

  it("is ready with a chosen model, whatever the probe says", () => {
    expect(hasAnsweringModel([chat("mine", true)], null)).toBe(true);
    expect(hasAnsweringModel([chat("mine", true)], probe)).toBe(true);
  });

  it("takes an installed chat model to answer until the probe has said which tier it serves", () => {
    expect(hasAnsweringModel([chat("other")], null)).toBe(true);
    expect(hasAnsweringModel([embedding], null)).toBe(false);
    expect(hasAnsweringModel([], null)).toBe(false);
  });

  it("is ready after the probe only when an installed model is a tier's pick", () => {
    expect(hasAnsweringModel([chat("pick")], probe)).toBe(true);
    expect(hasAnsweringModel([chat("other")], probe)).toBe(false);
  });

  it("names the tiers an installed model serves, in the probe's order, and none before it answers", () => {
    expect(servesTiers(probe, "pick")).toEqual(["balance", "speed"]);
    expect(servesTiers(probe, "other")).toEqual([]);
    expect(servesTiers(null, "pick")).toEqual([]);
  });

  it("marks a pick installed when the disk has it", () => {
    expect(pickInstalled([chat("pick")], "pick")).toBe(true);
    expect(pickInstalled([chat("other")], "pick")).toBe(false);
  });
});
