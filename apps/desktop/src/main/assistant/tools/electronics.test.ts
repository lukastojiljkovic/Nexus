import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ElectronicsStore, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";
import type { StoredCircuitDetail } from "@nexus/db";
import {
  buildSimBench,
  catalogueComponent,
  simulateFrame,
  type AssistantLocale,
  type ConfirmRequest,
  type Tool,
  type ToolContext,
} from "@nexus/core";
import { toCircuitDocument } from "../../elecDocument.js";
import { electronicsTools } from "./electronics.js";

/**
 * The ELECTRONICS tools over a REAL database: every assertion is about rows the
 * store wrote, because that is the whole value of a tool — which part landed
 * where, which pins a wire joins, and what a refusal left behind.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

/** ONE database for the file and a fresh profile per case, as the task suite does. */
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-electronics-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
});

function tools(): readonly Tool[] {
  return electronicsTools({ profileDb: (id, open) => open(db.raw, id), now: () => NOW_MS });
}

function toolOf(name: string): Tool {
  const found = tools().find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

function store(): ElectronicsStore {
  return new ElectronicsStore(db.raw, profileId);
}

interface Recorder {
  readonly context: ToolContext;
  readonly confirms: ConfirmRequest[];
}

/** A tool context whose confirmation answers `allow`, remembering every request so a summary can be read. */
function contextFor(locale: AssistantLocale, allow: boolean): Recorder {
  const confirms: ConfirmRequest[] = [];
  return {
    confirms,
    context: {
      profileId,
      locale,
      signal: new AbortController().signal,
      confirm: (request) => {
        confirms.push(request);
        return Promise.resolve(allow);
      },
    },
  };
}

/** Builds the test circuit: an UNO, a DHT22 on its 5V, GND and D2, through the build tool itself. */
async function buildMeteo(): Promise<StoredCircuitDetail> {
  const { context } = contextFor("en", true);
  const result = await toolOf("electronics.build").run(
    {
      name: "Meteo",
      board: "arduino-uno",
      parts: [{ ref: "DHT1", component: "dht22" }],
      wires: [
        { from: "DHT1.VCC", to: "Arduino UNO R3.5V" },
        { from: "DHT1.GND", to: "arduino-uno.GND" },
        { from: "DHT1.DATA", to: "Arduino UNO R3.D2" },
      ],
    },
    context,
  );
  expect(result.ok).toBe(true);
  const circuit = store().listActive().find((row) => row.name === "Meteo");
  if (circuit === undefined) throw new Error("Test setup: the build wrote no circuit.");
  return store().read(circuit.id);
}

describe("electronics.build", () => {
  it("writes the board, the sensor and their wires as rows, and reveals the circuit", async () => {
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("electronics.build").run(
      {
        name: "Meteo",
        board: "arduino-uno",
        parts: [{ ref: "DHT1", component: "dht22" }],
        wires: [{ from: "DHT1.DATA", to: "arduino-uno.D2" }],
      },
      context,
    );
    expect(result.ok).toBe(true);
    expect(confirms).toHaveLength(1);
    expect(confirms[0]?.summary).toContain("Meteo");
    expect(confirms[0]?.summary).toContain("parts: 1, wires: 1");

    const [circuit] = store().listActive();
    expect(circuit?.name).toBe("Meteo");
    const detail = store().read(circuit?.id ?? "");
    expect(detail.parts.map((part) => [part.label, part.componentId])).toEqual([
      ["Arduino UNO R3", "arduino-uno"],
      ["DHT1", "dht22"],
    ]);
    const [wire] = detail.wires;
    expect(wire).toMatchObject({
      fromPartId: detail.parts[1]?.id,
      fromPinId: "DATA",
      toPartId: detail.parts[0]?.id,
      toPinId: "D2",
      colour: "yellow",
    });
    expect(result.navigateTo).toEqual({ module: "electronics", item: detail.id });
  });

  it("writes nothing when the user declines", async () => {
    const { context } = contextFor("en", false);
    const result = await toolOf("electronics.build").run(
      { name: "Nope", board: "arduino-uno", parts: [], wires: [] },
      context,
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(store().listActive()).toEqual([]);
  });

  it("refuses a wire to a pin the board does not have, by name, and leaves no circuit behind", async () => {
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("electronics.build").run(
      {
        name: "Broken",
        board: "arduino-uno",
        parts: [{ ref: "DHT1", component: "dht22" }],
        wires: [{ from: "DHT1.DATA", to: "Arduino UNO R3.D99" }],
      },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("D99");
    expect(confirms).toEqual([]);
    expect(store().listActive()).toEqual([]);
  });

  it("refuses a part the catalogue does not hold, and a second board", async () => {
    const { context } = contextFor("sr", true);
    const unknown = await toolOf("electronics.build").run(
      { name: "X", board: "arduino-uno", parts: [{ ref: "Q1", component: "senzor-nepoznat" }], wires: [] },
      context,
    );
    expect(unknown.ok).toBe(false);
    expect(unknown.content).toContain("senzor-nepoznat");
    const twoBoards = await toolOf("electronics.build").run(
      { name: "X", board: "arduino-uno", parts: [{ ref: "U2", component: "arduino-nano" }], wires: [] },
      context,
    );
    expect(twoBoards.content).toContain("U2");
    expect(store().listActive()).toEqual([]);
  });

  it("leaves no circuit behind when the store refuses a part after the circuit is written", async () => {
    // A zero value reads as a number, so the planner passes it; the store refuses it
    // (a part's value is positive), and the transaction must take the circuit back out.
    const { context } = contextFor("en", true);
    const result = await toolOf("electronics.build").run(
      {
        name: "Half",
        board: "arduino-uno",
        parts: [{ ref: "R1", component: "resistor", value: "0" }],
        wires: [{ from: "R1.1", to: "arduino-uno.D13" }],
      },
      context,
    );
    expect(result.ok).toBe(false);
    expect(store().listActive()).toEqual([]);
  });

  it("refuses arguments the description cannot carry", async () => {
    const { context } = contextFor("en", true);
    const result = await toolOf("electronics.build").run(
      { name: "X", board: "arduino-uno", parts: "not a list" },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain('"parts" must be a list');
  });
});

describe("electronics.connect and electronics.disconnect", () => {
  it("wires two pins, colours a supply wire red, and reveals the circuit", async () => {
    const circuit = await buildMeteo();
    const dht = circuit.parts.find((part) => part.label === "DHT1");
    expect(dht).toBeDefined();
    const { context, confirms } = contextFor("en", true);
    const led = await toolOf("electronics.place").run(
      { circuit: "Meteo", component: "led", ref: "L1" },
      context,
    );
    expect(led.ok).toBe(true);
    const connected = await toolOf("electronics.connect").run(
      { circuit: "Meteo", from: "L1.A", to: "Arduino UNO R3.5V" },
      context,
    );
    expect(connected.ok).toBe(true);
    expect(confirms.at(-1)?.summary).toBe("Connect L1.A to Arduino UNO R3.5V on “Meteo”");

    const after = store().read(circuit.id);
    const ledPart = after.parts.find((part) => part.label === "L1");
    const wire = after.wires.find((entry) => entry.fromPartId === ledPart?.id);
    expect(wire).toMatchObject({ fromPinId: "A", toPinId: "5V", colour: "red" });
    expect(connected.navigateTo).toEqual({ module: "electronics", item: circuit.id });
  });

  it("refuses a wire to a pin that does not exist, by name, and adds nothing", async () => {
    const circuit = await buildMeteo();
    const before = store().read(circuit.id).wires.length;
    const { context } = contextFor("en", true);
    const result = await toolOf("electronics.connect").run(
      { circuit: "Meteo", from: "DHT1.DATA", to: "Arduino UNO R3.D99" },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("D99");
    expect(store().read(circuit.id).wires).toHaveLength(before);
  });

  it("refuses a pair that is already wired", async () => {
    await buildMeteo();
    const { context } = contextFor("en", true);
    const result = await toolOf("electronics.connect").run(
      { circuit: "Meteo", from: "Arduino UNO R3.D2", to: "DHT1.DATA" },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("already connected");
  });

  it("removes the wire between two pins, either way round, and asks first", async () => {
    const circuit = await buildMeteo();
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("electronics.disconnect").run(
      { circuit: "Meteo", from: "Arduino UNO R3.D2", to: "DHT1.DATA" },
      context,
    );
    expect(result.ok).toBe(true);
    expect(confirms).toHaveLength(1);
    expect(store().read(circuit.id).wires).toHaveLength(2);
  });

  it("says there is no wire to remove when there is none", async () => {
    await buildMeteo();
    const { context } = contextFor("en", true);
    const result = await toolOf("electronics.disconnect").run(
      { circuit: "Meteo", from: "DHT1.VCC", to: "Arduino UNO R3.D13" },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("no wire");
  });
});

describe("electronics.place and electronics.unplace", () => {
  it("adds a part under its ref, and refuses a ref that is already on the circuit", async () => {
    const circuit = await buildMeteo();
    const { context } = contextFor("en", true);
    const placed = await toolOf("electronics.place").run(
      { circuit: "Meteo", component: "resistor", ref: "R1", value: "4,7k" },
      context,
    );
    expect(placed.ok).toBe(true);
    const part = store().read(circuit.id).parts.find((entry) => entry.label === "R1");
    expect(part).toMatchObject({ componentId: "resistor", value: 4700 });

    const again = await toolOf("electronics.place").run(
      { circuit: "Meteo", component: "resistor", ref: "r1" },
      context,
    );
    expect(again.ok).toBe(false);
    expect(again.content).toContain("already has a part");
  });

  it("refuses a value on a part that takes none", async () => {
    await buildMeteo();
    const { context } = contextFor("en", true);
    const result = await toolOf("electronics.place").run(
      { circuit: "Meteo", component: "dht22", value: "5" },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("takes no value");
  });

  it("removes a part with every wire on it, and says how many", async () => {
    const circuit = await buildMeteo();
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("electronics.unplace").run(
      { circuit: "Meteo", part: "DHT1" },
      context,
    );
    expect(result.ok).toBe(true);
    expect(confirms[0]?.summary).toContain("its 3 wires");
    expect(result.content).toContain("3 wires");
    const after = store().read(circuit.id);
    expect(after.parts.map((part) => part.label)).toEqual(["Arduino UNO R3"]);
    expect(after.wires).toEqual([]);
  });
});

describe("electronics.rename and electronics.delete", () => {
  it("renames a circuit, reading its name case- and diacritic-blind", async () => {
    const circuit = await buildMeteo();
    const { context } = contextFor("en", true);
    const result = await toolOf("electronics.rename").run(
      { circuit: "meteo", name: "Vremenska stanica" },
      context,
    );
    expect(result.ok).toBe(true);
    expect(store().read(circuit.id).name).toBe("Vremenska stanica");
  });

  it("deletes a circuit when the user agrees, and changes nothing when declined", async () => {
    const circuit = await buildMeteo();
    const declined = contextFor("en", false);
    const refused = await toolOf("electronics.delete").run({ circuit: "Meteo" }, declined.context);
    expect(refused).toEqual({ ok: false, content: "The user declined." });
    expect(store().listActive().map((row) => row.id)).toContain(circuit.id);

    const agreed = contextFor("en", true);
    const result = await toolOf("electronics.delete").run({ circuit: "Meteo" }, agreed.context);
    expect(result.ok).toBe(true);
    expect(store().listActive()).toEqual([]);
    expect(result.navigateTo).toEqual({ module: "electronics" });
  });

  it("refuses a name two circuits share, listing their ids", async () => {
    store().createCircuit({ name: "Dup" }, NOW_ISO);
    store().createCircuit({ name: "Dup" }, NOW_ISO);
    const { context } = contextFor("en", true);
    const result = await toolOf("electronics.rename").run({ circuit: "Dup", name: "X" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("more than one");
  });

  it("refuses a circuit it cannot find, naming the ones there are", async () => {
    await buildMeteo();
    const { context } = contextFor("en", true);
    const result = await toolOf("electronics.open").run({ circuit: "Nema" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("No circuit named “Nema”");
    expect(result.content).toContain("Meteo");
  });
});

describe("electronics reads", () => {
  it("lists the circuits and opens one with its parts and wires", async () => {
    const circuit = await buildMeteo();
    const { context } = contextFor("en", true);
    const listed = await toolOf("electronics.list").run({}, context);
    expect(listed.content).toContain(`Meteo (${circuit.id})`);

    const opened = await toolOf("electronics.open").run({ circuit: "Meteo" }, context);
    expect(opened.content).toContain("DHT1: DHT22 (AM2302) (dht22)");
    expect(opened.content).toContain("DHT1.DATA — Arduino UNO R3.D2");
    expect(opened.navigateTo).toEqual({ module: "electronics", item: circuit.id });
  });

  it("searches the catalogue in Serbian and in English, and says when nothing matches", async () => {
    // The DHT22's own summaries: „ispod nule" and „below zero".
    const serbian = await toolOf("electronics.parts").run(
      { query: "nule" },
      contextFor("sr", true).context,
    );
    expect(serbian.content).toContain("dht22");
    const english = await toolOf("electronics.parts").run(
      { query: "below zero" },
      contextFor("en", true).context,
    );
    expect(english.content).toContain("dht22");
    const none = await toolOf("electronics.parts").run(
      { query: "zzzz-nema-ovoga" },
      contextFor("en", true).context,
    );
    expect(none.ok).toBe(true);
    expect(none.content).toContain("No part matches");
  });

  it("simulates a fixed tick exactly as simulateFrame computes it", async () => {
    const circuit = await buildMeteo();
    const { context } = contextFor("en", true);
    // An LED's anode listens, so a board pin wired to it is an output the bench can drive.
    await toolOf("electronics.place").run({ circuit: "Meteo", component: "led", ref: "L1" }, context);
    await toolOf("electronics.connect").run(
      { circuit: "Meteo", from: "L1.A", to: "Arduino UNO R3.D13" },
      context,
    );
    const detail = store().read(circuit.id);
    const bench = buildSimBench(toCircuitDocument(detail), catalogueComponent);
    if (bench.kind !== "model") throw new Error("Test setup: the bench refused.");
    const channel = bench.channels.find((entry) => entry.id === "D13");
    expect(channel).toBeDefined();

    const result = await toolOf("electronics.simulate").run(
      {
        circuit: "Meteo",
        frames: 2,
        tickMs: 100,
        channels: [{ pin: "d13", wave: { kind: "constant", value: 1 } }],
      },
      context,
    );
    expect(result.ok).toBe(true);
    const expected = simulateFrame(bench, new Map([["D13", { kind: "constant", value: 1 }]]), 1, 100);
    const level = expected.values.find((value) => value.channel === "D13")?.value;
    expect(level).toBe(1);
    expect(result.content).toContain("- 0 ms: D13 1");
    expect(result.content).toContain("- 100 ms: D13 1");
    expect(result.content).toContain("Nothing is stored.");
  });

  it("refuses a simulated pin the bench does not drive, and a wave with a missing field", async () => {
    await buildMeteo();
    const { context } = contextFor("en", true);
    await toolOf("electronics.place").run({ circuit: "Meteo", component: "led", ref: "L1" }, context);
    await toolOf("electronics.connect").run(
      { circuit: "Meteo", from: "L1.A", to: "Arduino UNO R3.D13" },
      context,
    );
    const pin = await toolOf("electronics.simulate").run(
      { circuit: "Meteo", channels: [{ pin: "A5", wave: { kind: "constant", value: 1 } }] },
      context,
    );
    expect(pin.ok).toBe(false);
    expect(pin.content).toContain("A5");
    expect(pin.content).toContain("D13");

    const wave = await toolOf("electronics.simulate").run(
      { circuit: "Meteo", channels: [{ pin: "D2", wave: { kind: "ramp", from: 0 } }] },
      context,
    );
    expect(wave.ok).toBe(false);
    expect(wave.content).toContain('"to"');
  });

  it("answers the code an Arduino circuit yields, and a ROS package for a Raspberry Pi", async () => {
    await buildMeteo();
    const { context } = contextFor("en", true);
    const sketch = await toolOf("electronics.code").run({ circuit: "Meteo" }, context);
    expect(sketch.ok).toBe(true);
    expect(sketch.content).toContain(".ino");

    await toolOf("electronics.build").run(
      { name: "Rover", board: "raspberry-pi-4b", parts: [], wires: [] },
      context,
    );
    const pi = await toolOf("electronics.code").run({ circuit: "Rover" }, context);
    expect(pi.ok).toBe(true);
    expect(pi.content).toContain("ROS 2 package");
  });

  it("reads the machine of a dimensioned robot, and refuses one with no chassis or no ROS", async () => {
    await buildMeteo();
    const { context } = contextFor("en", true);
    const microcontroller = await toolOf("electronics.machine").run({ circuit: "Meteo" }, context);
    expect(microcontroller.ok).toBe(false);
    expect(microcontroller.content).toContain("microcontroller");

    await toolOf("electronics.build").run(
      { name: "Rover", board: "raspberry-pi-4b", parts: [], wires: [] },
      context,
    );
    const noChassis = await toolOf("electronics.machine").run({ circuit: "Rover" }, context);
    expect(noChassis.ok).toBe(false);
    expect(noChassis.content).toContain("not been entered");

    const rover = store().listActive().find((row) => row.name === "Rover");
    if (rover === undefined) throw new Error("Test setup: no rover circuit.");
    store().setChassis(
      rover.id,
      {
        shape: "diff-rover",
        bodyLength: 20,
        bodyWidth: 15,
        bodyHeight: 8,
        wheelRadius: 3.5,
        wheelWidth: 2,
        wheelTrack: 16,
        wheelBase: 18,
        bodyMass: 800,
        wheelMass: 60,
      },
      NOW_ISO,
    );
    const machine = await toolOf("electronics.machine").run({ circuit: "Rover" }, context);
    expect(machine.ok).toBe(true);
    expect(machine.content).toContain("The machine of “Rover”");
  });
});

describe("the tool set", () => {
  it("names every tool electronics.verb, in both languages, each described apart", () => {
    const all = tools();
    expect(all).toHaveLength(13);
    for (const tool of all) {
      expect(tool.name).toMatch(/^electronics\.[a-z]+$/);
      expect(tool.description.sr).not.toBe(tool.description.en);
    }
  });
});
