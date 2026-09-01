// The dispatch only, and deliberately nothing else: what each generator emits
// is `sketch.test.ts`'s and `ros.test.ts`'s business, and asserting it a third
// time here would mean a change to the Arduino header comment broke a test
// about routing.

import { describe, expect, it } from "vitest";

import type { ComponentDef } from "./component.js";
import type { Circuit, CircuitPart } from "./circuit.js";
import { generateCode } from "./code.js";

const board = (id: string, programming: ComponentDef["programming"]): ComponentDef => ({
  id,
  kind: "board",
  name: id,
  summary: "Ploča.",
  supply: { min: 5, max: 5 },
  current: { typical: 10, peak: 20 },
  logicVolts: 3.3,
  ...(programming === undefined ? {} : { programming }),
  buses: [],
  pins: [{ id: "D1", label: "1", functions: ["digital-in", "digital-out"] }],
});

const shipped = new Map(
  [
    board("mikro", "arduino"),
    board("racunar", "linux"),
    // A board a user could write themselves: the catalogue gate rejects one,
    // but `programming` is optional in the type and this is what happens.
    board("nepoznata", undefined),
    {
      id: "taster",
      kind: "sensor",
      name: "Taster",
      summary: "Prekidač.",
      buses: [],
      pins: [{ id: "OUT", label: "OUT", functions: ["digital-out"] }],
    } satisfies ComponentDef,
  ].map((component) => [component.id, component]),
);

const part = (id: string, componentId: string): CircuitPart => ({
  id,
  circuitId: "c1",
  componentId,
  label: "",
  x: 0,
  y: 0,
  rotation: 0,
});

const circuit = (parts: readonly CircuitPart[]): Circuit => ({
  id: "c1",
  name: "Kolo",
  notes: "",
  parts,
  wires: [],
});

const codeFor = (parts: readonly CircuitPart[]) =>
  generateCode(circuit(parts), (id) => shipped.get(id));

describe("generateCode", () => {
  it("gives a microcontroller a sketch", () => {
    expect(codeFor([part("p1", "mikro")]).kind).toBe("sketch");
  });

  it("gives a single-board computer a ROS 2 package", () => {
    expect(codeFor([part("p1", "racunar")]).kind).toBe("package");
  });

  it("refuses a board that names no toolchain, rather than guessing one", () => {
    expect(codeFor([part("p1", "nepoznata")])).toEqual({
      kind: "refused",
      reason: "not-programmable",
    });
  });

  it("counts the boards before it asks what kind they are", () => {
    expect(codeFor([])).toEqual({ kind: "refused", reason: "no-board" });
    expect(codeFor([part("p1", "taster")])).toEqual({ kind: "refused", reason: "no-board" });
    expect(codeFor([part("p1", "mikro"), part("p2", "racunar")])).toEqual({
      kind: "refused",
      reason: "many-boards",
    });
  });
});
