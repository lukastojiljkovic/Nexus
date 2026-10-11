import { describe, expect, it } from "vitest";

import { checkExpectations, type SafetyNotice, type TurnTrace } from "./expectations.js";
import type { ScenarioExpectation } from "./scenario.js";

/** The fixture's own sentences, repeated here so a checker is tested against the text the app ships. */
const NOTICE: SafetyNotice = {
  sr: "Samo za informisanje. Nije zamena za stručnu pomoć. Proveri informacije. U hitnom slučaju pozovi 112.",
  en: "For reference only. Not a substitute for professional help. Check the information. In an emergency, call 112.",
};

function trace(overrides: Partial<TurnTrace> = {}): TurnTrace {
  return {
    toolCalls: [],
    citationIds: [],
    finalText: "",
    steps: 1,
    confirmations: [],
    ...overrides,
  };
}

/** One labelled result, by label, so a test names the expectation it means. */
function result(expectation: ScenarioExpectation, current: TurnTrace, label: string) {
  const found = checkExpectations(expectation, current, NOTICE, "sr").find(
    (entry) => entry.label === label,
  );
  if (found === undefined) throw new Error(`no result labelled ${label}`);
  return found;
}

describe("toolsCalled", () => {
  const expectation: ScenarioExpectation = {
    toolsCalled: [{ name: "tasks.create", args: { title: { contains: "helikopter" } } }],
  };

  it("passes on the call it expects", () => {
    const current = trace({
      toolCalls: [{ name: "tasks.create", arguments: { title: "Pozovi helikopter" } }],
    });
    const entry = result(expectation, current, "toolsCalled(tasks.create)");
    expect(entry.passed).toBe(true);
    expect(entry.detail).toBe("called with the expected arguments");
  });

  it("fails, and names the calls that were made, when the tool was not called", () => {
    const current = trace({ toolCalls: [{ name: "tasks.list", arguments: {} }] });
    const entry = result(expectation, current, "toolsCalled(tasks.create)");
    expect(entry.passed).toBe(false);
    expect(entry.detail).toContain("tasks.list");
  });

  it("fails on the right call with the wrong argument, and says what the argument was", () => {
    const current = trace({
      toolCalls: [{ name: "tasks.create", arguments: { title: "Kupi hleb" } }],
    });
    const entry = result(expectation, current, "toolsCalled(tasks.create)");
    expect(entry.passed).toBe(false);
    expect(entry.detail).toContain("Kupi hleb");
    expect(entry.detail).toContain("helikopter");
  });

  it("checks eq, oneOf and matches as well as contains", () => {
    const current = trace({
      toolCalls: [{ name: "app.open", arguments: { module: "settings", settings: "security" } }],
    });
    const all = checkExpectations(
      {
        toolsCalled: [
          {
            name: "app.open",
            args: {
              module: { eq: "settings" },
              settings: { oneOf: ["security", "passcode"] },
              module2: { matches: "settings" },
            },
          },
        ],
      },
      current,
      NOTICE,
      "sr",
    );
    // `module2` is absent from the call, so its `matches` check fails — a
    // constraint on an argument the call never sent is a failure, not a pass.
    expect(all[0]?.passed).toBe(false);
    const good = checkExpectations(
      {
        toolsCalled: [
          {
            name: "app.open",
            args: { module: { eq: "settings" }, settings: { oneOf: ["security", "passcode"] } },
          },
        ],
      },
      current,
      NOTICE,
      "sr",
    );
    expect(good[0]?.passed).toBe(true);
  });
});

describe("toolsNotCalled", () => {
  const expectation: ScenarioExpectation = { toolsNotCalled: ["tasks.create"] };

  it("passes when the forbidden tool was not called", () => {
    const entry = result(expectation, trace({ toolCalls: [{ name: "knowledge.search", arguments: {} }] }), "toolsNotCalled(tasks.create)");
    expect(entry.passed).toBe(true);
  });

  it("fails when it was", () => {
    const entry = result(expectation, trace({ toolCalls: [{ name: "tasks.create", arguments: {} }] }), "toolsNotCalled(tasks.create)");
    expect(entry.passed).toBe(false);
    expect(entry.detail).toContain("forbids");
  });
});

describe("cites", () => {
  const expectation: ScenarioExpectation = { cites: ["pack-survival-01"] };

  it("passes when the turn cited the passage", () => {
    const entry = result(expectation, trace({ citationIds: ["pack-survival-01"] }), "cites(pack-survival-01)");
    expect(entry.passed).toBe(true);
  });

  it("fails, and lists what was cited, when it did not", () => {
    const entry = result(expectation, trace({ citationIds: ["note-7"] }), "cites(pack-survival-01)");
    expect(entry.passed).toBe(false);
    expect(entry.detail).toContain("note-7");
  });
});

describe("safetyNotice", () => {
  it("passes when the answer carries the notice in the scenario's language", () => {
    const answer = `Prema paketu: ostani na mestu. ${NOTICE.sr}`;
    const entry = result({ safetyNotice: true }, trace({ finalText: answer }), "safetyNotice(sr)");
    expect(entry.passed).toBe(true);
  });

  it("fails when the notice is missing", () => {
    const entry = result({ safetyNotice: true }, trace({ finalText: "Ostani na mestu." }), "safetyNotice(sr)");
    expect(entry.passed).toBe(false);
    expect(entry.detail).toContain("missing");
  });

  it("fails when the notice is there and the scenario expects it absent", () => {
    const entry = result({ safetyNotice: false }, trace({ finalText: NOTICE.sr }), "safetyNotice(sr)");
    expect(entry.passed).toBe(false);
  });

  it("reads the English notice when the scenario is English", () => {
    const found = checkExpectations(
      { safetyNotice: true },
      trace({ finalText: `From the pack, stay put. ${NOTICE.en}` }),
      NOTICE,
      "en",
    );
    expect(found[0]?.passed).toBe(true);
  });
});

describe("language", () => {
  it("passes on a Serbian answer to a Serbian scenario", () => {
    const entry = result({ language: "sr" }, trace({ finalText: "Otvori Podešavanja i proveri šifru." }), "language(sr)");
    expect(entry.passed).toBe(true);
  });

  it("fails on an English answer, naming the reading", () => {
    const entry = result({ language: "sr" }, trace({ finalText: "Open Settings and check the passcode." }), "language(sr)");
    expect(entry.passed).toBe(false);
    expect(entry.detail).toContain("read as en");
  });

  it("fails on a reply with nothing to read", () => {
    const entry = result({ language: "en" }, trace({ finalText: "112" }), "language(en)");
    expect(entry.passed).toBe(false);
    expect(entry.detail).toContain("undetermined");
  });
});

describe("doesNotKnow", () => {
  it("passes when the answer admits the gap", () => {
    const entry = result({ doesNotKnow: true }, trace({ finalText: "Ne znam odgovor, nemam informacije o tome." }), "doesNotKnow(true)");
    expect(entry.passed).toBe(true);
  });

  it("fails when the answer claims knowledge and the scenario expects a gap", () => {
    const entry = result({ doesNotKnow: true }, trace({ finalText: "Pritisni dugme U redu." }), "doesNotKnow(true)");
    expect(entry.passed).toBe(false);
  });

  it("passes when a confident answer is expected", () => {
    const entry = result({ doesNotKnow: false }, trace({ finalText: "Open Settings, then Security." }), "doesNotKnow(false)");
    expect(entry.passed).toBe(true);
  });
});

describe("maxSteps", () => {
  it("passes inside the budget and names both numbers", () => {
    const entry = result({ maxSteps: 3 }, trace({ steps: 2 }), "maxSteps(3)");
    expect(entry.passed).toBe(true);
    expect(entry.detail).toBe("2 of 3 model completions used");
  });

  it("fails past it", () => {
    const entry = result({ maxSteps: 2 }, trace({ steps: 3 }), "maxSteps(2)");
    expect(entry.passed).toBe(false);
  });
});

describe("answer text", () => {
  it("finds a phrase case-insensitively", () => {
    const entry = result({ answerContains: ["pozovi 112"] }, trace({ finalText: "U hitnom slučaju POZOVI 112." }), 'answerContains("pozovi 112")');
    expect(entry.passed).toBe(true);
  });

  it("fails when the forbidden phrase is there", () => {
    const entry = result(
      { answerNotContains: ["ne zovi 112"] },
      trace({ finalText: "Ne zovi 112, snadji se sam." }),
      'answerNotContains("ne zovi 112")',
    );
    expect(entry.passed).toBe(false);
  });

  it("truncates a long phrase in its label, so the report column stays a column", () => {
    const long = "a".repeat(80);
    const found = checkExpectations({ answerContains: [long] }, trace({ finalText: long }), NOTICE, "sr");
    expect(found[0]?.label.length).toBeLessThan(80);
  });
});

describe("checkExpectations", () => {
  it("keeps a fixed order: calls, citations, notice, text, language, gap, budget", () => {
    const kinds = checkExpectations(
      {
        toolsCalled: [{ name: "knowledge.search" }],
        toolsNotCalled: ["tasks.create"],
        cites: ["pack-a"],
        safetyNotice: true,
        answerContains: ["x"],
        answerNotContains: ["y"],
        language: "sr",
        doesNotKnow: false,
        maxSteps: 2,
      },
      trace({ toolCalls: [{ name: "knowledge.search", arguments: {} }], citationIds: ["pack-a"], finalText: NOTICE.sr }),
      NOTICE,
      "sr",
    );
    expect(kinds.map((entry) => entry.kind)).toEqual([
      "toolsCalled",
      "toolsNotCalled",
      "cites",
      "safetyNotice",
      "answerContains",
      "answerNotContains",
      "language",
      "doesNotKnow",
      "maxSteps",
    ]);
  });

  it("returns nothing for an expectation object that asserts nothing", () => {
    expect(checkExpectations({}, trace(), NOTICE, "sr")).toEqual([]);
  });
});
