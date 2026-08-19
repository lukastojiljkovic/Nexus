// The gate that makes the shipped catalogue trustworthy.
//
// `catalogue.ts` asserts its imports are components rather than parsing them at
// startup, for the reason `fitness/catalogue.ts` gives: parsing at runtime either
// throws inside a bundled app — bricking it over a data typo — or silently drops
// entries, which is a catalogue quietly missing parts. This file is what makes
// that assertion honest, so every rule below is a rule about the FILES, not about
// the validator, which has its own tests next door.

import { describe, expect, it } from "vitest";

import { validateComponent } from "./component.js";
import { COMPONENT_CATALOGUE, catalogueComponent, componentsOfKind } from "./catalogue.js";

describe("the shipped catalogue", () => {
  it("has no entry the validator refuses", () => {
    const refused = COMPONENT_CATALOGUE.flatMap((component) =>
      validateComponent(component).map((problem) => `${component.id}: ${problem.field} (${problem.code})`),
    );
    expect(refused, refused.join("\n")).toEqual([]);
  });

  it("has no duplicate id", () => {
    const seen = new Set<string>();
    const duplicates = COMPONENT_CATALOGUE.filter((component) => {
      if (seen.has(component.id)) return true;
      seen.add(component.id);
      return false;
    });
    expect(duplicates.map((component) => component.id)).toEqual([]);
  });

  it("has no duplicate name, because two entries a user cannot tell apart are one entry", () => {
    const seen = new Set<string>();
    const duplicates = COMPONENT_CATALOGUE.filter((component) => {
      if (seen.has(component.name)) return true;
      seen.add(component.name);
      return false;
    });
    expect(duplicates.map((component) => component.name)).toEqual([]);
  });

  it("makes every part that takes power say how much it draws", () => {
    // `validateComponent` deliberately does NOT require this — it also runs on
    // components the user defines, where „I do not know my motor's stall
    // current" is a true answer. It is a claim about what WE ship: a part sold
    // as taking power and silently drawing nothing leaves the current budget
    // short by exactly the amount that would have made it interesting.
    //
    // Stated over `power-in` rather than over the kind, because the shapes that
    // legitimately have neither are spread across kinds — a 4×4 keypad is a
    // switch matrix filed under sensors, and a battery is a source filed under
    // power.
    const silent = COMPONENT_CATALOGUE.filter(
      (component) =>
        component.pins.some((pin) => pin.functions.includes("power-in")) &&
        (component.supply === undefined || component.current === undefined),
    );
    expect(silent.map((component) => component.id)).toEqual([]);
  });

  it("gives a value unit to the parts whose value the user picks, and to no others", () => {
    // A resistor without `valueUnit` is a part the canvas never asks a value
    // for, so every one placed is 0 Ω. An LED with one is a dialog asking for a
    // number that means nothing. Both read as ordinary entries.
    const parameterised = COMPONENT_CATALOGUE.filter((c) => c.valueUnit !== undefined).map((c) => c.id);
    expect(parameterised).toEqual([
      "resistor",
      "potentiometer",
      "trimpot",
      "thermistor-ntc",
      "photoresistor",
      "capacitor-ceramic",
      "capacitor-electrolytic",
      "inductor",
      "zener-diode",
    ]);
  });

  it("gives every pin on every entry a distinct label within its component", () => {
    // Distinct IDS are the validator's rule. Distinct LABELS are this file's,
    // because a label is what the canvas prints next to a hole: two pins reading
    // „GND" on one part is correct silkscreen and a user picking between them in
    // a wire dialog cannot. Where a board genuinely has several, the id carries
    // the number and the label may repeat — so the rule is stated as an
    // allowance, not an equality.
    const offenders: string[] = [];
    for (const component of COMPONENT_CATALOGUE) {
      const counted = new Map<string, number>();
      for (const pin of component.pins) {
        counted.set(pin.label, (counted.get(pin.label) ?? 0) + 1);
      }
      for (const [label, count] of counted) {
        if (count > 1 && label !== "GND" && label !== "5V" && label !== "3V3") {
          offenders.push(`${component.id}: ${count}× „${label}"`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("looking a component up", () => {
  it("finds one that ships", () => {
    expect(catalogueComponent("arduino-uno")?.name).toBe("Arduino UNO R3");
  });

  it("answers undefined for an id this build does not ship", () => {
    // The honest answer, and the one a circuit drawn under an older build needs:
    // „this build does not know that part" rather than a substitute nobody chose.
    expect(catalogueComponent("arduino-uno-r5")).toBeUndefined();
  });

  it("groups by kind in catalogue order", () => {
    const boards = componentsOfKind("board");
    expect(boards.length).toBeGreaterThan(0);
    expect(boards.every((component) => component.kind === "board")).toBe(true);
    expect(boards[0]?.id).toBe("arduino-uno");
  });
});

describe("the boards, spot-checked against their pinouts", () => {
  // Six facts a datasheet reader would come here to verify, and each is one the
  // rules engine will later refuse a wire over. They are asserted by hand rather
  // than derived from the entry, which is the only way the assertion can fail.

  it("gives the UNO exactly the six PWM pins it has", () => {
    const uno = catalogueComponent("arduino-uno");
    const pwm = uno?.pins.filter((pin) => pin.functions.includes("pwm")).map((pin) => pin.id);
    expect(pwm).toEqual(["D3", "D5", "D6", "D9", "D10", "D11"]);
  });

  it("puts the UNO's I²C on A4 and A5", () => {
    const uno = catalogueComponent("arduino-uno");
    expect(uno?.pins.find((pin) => pin.functions.includes("i2c-sda"))?.id).toBe("A4");
    expect(uno?.pins.find((pin) => pin.functions.includes("i2c-scl"))?.id).toBe("A5");
  });

  it("puts the Leonardo's I²C on D2 and D3, which is why UNO sketches surprise people", () => {
    const leonardo = catalogueComponent("arduino-leonardo");
    expect(leonardo?.pins.find((pin) => pin.functions.includes("i2c-sda"))?.id).toBe("D2");
    expect(leonardo?.pins.find((pin) => pin.functions.includes("i2c-scl"))?.id).toBe("D3");
  });

  it("makes the ESP32's 34–39 input-only", () => {
    const esp = catalogueComponent("esp32-devkit-v1");
    for (const id of ["GPIO34", "GPIO35", "GPIO36", "GPIO39"]) {
      const found = esp?.pins.find((pin) => pin.id === id);
      expect(found?.functions, id).toContain("digital-in");
      expect(found?.functions, id).not.toContain("digital-out");
    }
  });

  it("gives the Raspberry Pi no analogue input at all, where an UNO has six", () => {
    // Stated as a contrast rather than an absence: „the Pi has no analogue pin"
    // also passes if the catalogue has no analogue pins anywhere, which would be
    // a broken build reading as a correct fact about the Pi.
    for (const id of ["raspberry-pi-4b", "raspberry-pi-5"]) {
      const board = catalogueComponent(id);
      expect(board?.pins.some((pin) => pin.functions.includes("analog-in")), id).toBe(false);
    }
    const uno = catalogueComponent("arduino-uno");
    expect(uno?.pins.filter((pin) => pin.functions.includes("analog-in"))).toHaveLength(6);
  });

  it("gives the Mega its six interrupt pins and fifteen PWM pins", () => {
    const mega = catalogueComponent("arduino-mega-2560");
    const interrupts = mega?.pins.filter((pin) => pin.functions.includes("interrupt")).map((pin) => pin.id);
    expect(interrupts).toEqual(["D2", "D3", "D18", "D19", "D20", "D21"]);
    expect(mega?.pins.filter((pin) => pin.functions.includes("pwm"))).toHaveLength(15);
  });

  it("runs every board at a logic level the wiring can be checked against", () => {
    for (const board of componentsOfKind("board")) {
      expect(board.logicVolts, board.id).toBeGreaterThan(0);
      const signals = board.pins.filter(
        (pin) => !pin.functions.includes("gnd") && !pin.functions.includes("power-in"),
      );
      for (const pin of signals) {
        expect(pin.volts, `${board.id}.${pin.id}`).toBeGreaterThan(0);
      }
    }
  });
});
