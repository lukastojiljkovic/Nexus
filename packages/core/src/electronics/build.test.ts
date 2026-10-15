import { describe, expect, it } from "vitest";
import { COMPONENT_CATALOGUE, catalogueComponent } from "./catalogue.js";
import {
  findComponent,
  findPin,
  parseComponentValue,
  planBuild,
  splitEnd,
  wireColourFor,
  type BuildInput,
  type BuildResult,
} from "./build.js";

const plan = (input: BuildInput): BuildResult => planBuild(input, COMPONENT_CATALOGUE);

describe("findComponent", () => {
  it("finds a component by its id, or by its name in either language, folded", () => {
    expect(findComponent("arduino-uno", COMPONENT_CATALOGUE)?.id).toBe("arduino-uno");
    expect(findComponent("Arduino UNO R3", COMPONENT_CATALOGUE)?.id).toBe("arduino-uno");
    expect(findComponent("arduino uno r3", COMPONENT_CATALOGUE)?.id).toBe("arduino-uno");
    expect(findComponent("Otpornik", COMPONENT_CATALOGUE)?.id).toBe("resistor");
    expect(findComponent("Resistor", COMPONENT_CATALOGUE)?.id).toBe("resistor");
  });

  it("answers nothing for a name the catalogue does not hold", () => {
    expect(findComponent("nema-ga", COMPONENT_CATALOGUE)).toBeUndefined();
  });
});

describe("findPin", () => {
  it("matches a pin by its id or its printed label, case-blind", () => {
    const uno = catalogueComponent("arduino-uno");
    expect(uno).toBeDefined();
    if (uno === undefined) return;
    expect(findPin(uno, "d13")?.id).toBe("D13");
    expect(findPin(uno, "D13")?.id).toBe("D13");
    expect(findPin(uno, "D99")).toBeUndefined();
  });
});

describe("splitEnd", () => {
  it("splits a wire end at its last dot, so a ref may hold one", () => {
    expect(splitEnd("R1.1")).toEqual({ part: "R1", pin: "1" });
    expect(splitEnd("R1.v2.1")).toEqual({ part: "R1.v2", pin: "1" });
    expect(splitEnd("R1")).toBeUndefined();
    expect(splitEnd(".1")).toBeUndefined();
    expect(splitEnd("R1.")).toBeUndefined();
  });
});

describe("parseComponentValue", () => {
  it("reads a bare number and an SI prefix in the part's own unit", () => {
    expect(parseComponentValue("220", "ohm")).toBe(220);
    expect(parseComponentValue("4,7k", "ohm")).toBe(4700);
    expect(parseComponentValue("4.7k", "ohm")).toBe(4700);
    expect(parseComponentValue("1M", "ohm")).toBe(1_000_000);
    expect(parseComponentValue("10 mA", "ampere")).toBeCloseTo(0.01, 12);
    expect(parseComponentValue("100 µF", "farad")).toBeCloseTo(0.0001, 12);
    expect(parseComponentValue("5 V", "volt")).toBe(5);
  });

  it("refuses a unit the part does not measure, and text that is not a number", () => {
    expect(parseComponentValue("10 V", "ohm")).toBeUndefined();
    expect(parseComponentValue("dvesta", "ohm")).toBeUndefined();
    expect(parseComponentValue("", "ohm")).toBeUndefined();
  });
});

describe("wireColourFor", () => {
  it("colours a wire to ground black, to a supply red, and anything else yellow", () => {
    const uno = catalogueComponent("arduino-uno");
    const resistor = catalogueComponent("resistor");
    expect(uno).toBeDefined();
    expect(resistor).toBeDefined();
    if (uno === undefined || resistor === undefined) return;
    const gnd = findPin(uno, "GND");
    const rail = findPin(uno, "5V");
    const signal = findPin(uno, "D13");
    const leg = resistor.pins[0];
    expect(gnd && leg && wireColourFor(leg, gnd)).toBe("black");
    expect(rail && leg && wireColourFor(rail, leg)).toBe("red");
    expect(signal && leg && wireColourFor(signal, leg)).toBe("yellow");
  });
});

describe("planBuild", () => {
  it("plans a board and a sensor with their wires, the board first and the rest on a grid", () => {
    const result = plan({
      board: "arduino-uno",
      parts: [{ ref: "DHT1", component: "dht22" }],
      wires: [
        { from: "DHT1.VCC", to: "arduino-uno.5V" },
        { from: "DHT1.GND", to: "arduino-uno.GND" },
        { from: "DHT1.DATA", to: "Arduino UNO R3.D2" },
      ],
    });
    expect(result.kind).toBe("plan");
    if (result.kind !== "plan") return;
    const { parts, wires } = result.plan;
    expect(parts.map((part) => [part.label, part.componentId, part.x, part.y])).toEqual([
      ["Arduino UNO R3", "arduino-uno", 0, 0],
      ["DHT1", "dht22", 240, 0],
    ]);
    expect(wires).toHaveLength(3);
    expect(wires[0]).toEqual({
      from: { part: 1, pinId: "VCC" },
      to: { part: 0, pinId: "5V" },
      colour: "red",
    });
    expect(wires[1]?.colour).toBe("black");
    expect(wires[2]).toEqual({
      from: { part: 1, pinId: "DATA" },
      to: { part: 0, pinId: "D2" },
      colour: "yellow",
    });
  });

  it("carries a part's value, parsed in its unit", () => {
    const result = plan({
      board: "arduino-uno",
      parts: [{ ref: "R1", component: "resistor", value: "4,7k" }],
      wires: [],
    });
    expect(result.kind).toBe("plan");
    if (result.kind !== "plan") return;
    expect(result.plan.parts[1]?.value).toBe(4700);
  });

  it("refuses an unknown component by name", () => {
    expect(plan({ board: "arduino-uno", parts: [{ ref: "X1", component: "senzor-nepoznat" }], wires: [] })).toEqual({
      kind: "refused",
      problem: { code: "unknown-component", name: "senzor-nepoznat" },
    });
  });

  it("refuses a board that is not a board, and a board given as a part", () => {
    expect(plan({ board: "resistor", parts: [], wires: [] })).toEqual({
      kind: "refused",
      problem: { code: "not-a-board", name: "resistor" },
    });
    expect(plan({ board: "arduino-uno", parts: [{ ref: "U2", component: "arduino-nano" }], wires: [] })).toEqual({
      kind: "refused",
      problem: { code: "board-as-part", ref: "U2" },
    });
  });

  it("refuses a duplicate ref, including one that is the board's own id", () => {
    expect(
      plan({
        board: "arduino-uno",
        parts: [
          { ref: "R1", component: "resistor" },
          { ref: "r1", component: "resistor" },
        ],
        wires: [],
      }),
    ).toEqual({ kind: "refused", problem: { code: "duplicate-ref", ref: "r1" } });
  });

  it("refuses a wire to a pin that does not exist, by name, listing the valid pins", () => {
    const result = plan({
      board: "arduino-uno",
      parts: [{ ref: "R1", component: "resistor" }],
      wires: [{ from: "R1.1", to: "arduino-uno.D99" }],
    });
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.problem.code).toBe("unknown-pin");
    if (result.problem.code !== "unknown-pin") return;
    expect(result.problem.pin).toBe("D99");
    expect(result.problem.valid).toContain("D13");
  });

  it("refuses a wire to a part that is not on the circuit, listing the parts that are", () => {
    const result = plan({
      board: "arduino-uno",
      parts: [{ ref: "R1", component: "resistor" }],
      wires: [{ from: "R9.1", to: "arduino-uno.D13" }],
    });
    expect(result).toEqual({
      kind: "refused",
      problem: { code: "unknown-part", name: "R9", known: ["Arduino UNO R3", "R1"] },
    });
  });

  it("refuses a wire end that is not ref.pin", () => {
    expect(
      plan({ board: "arduino-uno", parts: [], wires: [{ from: "arduino-uno", to: "arduino-uno.D13" }] }),
    ).toEqual({ kind: "refused", problem: { code: "bad-end", end: "arduino-uno" } });
  });

  it("refuses a value on a part that takes none, and one that does not read", () => {
    expect(
      plan({ board: "arduino-uno", parts: [{ ref: "L1", component: "dht22", value: "5" }], wires: [] }),
    ).toEqual({ kind: "refused", problem: { code: "no-value", ref: "L1" } });
    expect(
      plan({ board: "arduino-uno", parts: [{ ref: "R1", component: "resistor", value: "pet" }], wires: [] }),
    ).toEqual({ kind: "refused", problem: { code: "bad-value", ref: "R1", value: "pet" } });
  });
});
