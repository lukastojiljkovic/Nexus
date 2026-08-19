import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CircuitNotFoundError,
  CircuitValidationError,
  ElectronicsStore,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";

const NOW = "2026-08-01T08:00:00.000Z";
const LATER = "2026-08-02T09:00:00.000Z";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-elec-"));
  db = openDatabase({ path: join(dir, "elec.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(name = "P"): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, NOW);
  return id;
}

function store(profileId = createProfile()): ElectronicsStore {
  return new ElectronicsStore(db.raw, profileId);
}

/** A board and a resistor on one circuit, plus the wire between them — the smallest real thing. */
function seeded(elec: ElectronicsStore) {
  const circuit = elec.createCircuit({ name: "Trepćuća dioda" }, NOW);
  const board = elec.addPart(
    circuit.id,
    { componentId: "arduino-uno", label: "", x: 0, y: 0, rotation: 0 },
    NOW,
  );
  const resistor = elec.addPart(
    circuit.id,
    { componentId: "resistor", label: "R1", x: 200, y: 40, rotation: 90, value: 220 },
    NOW,
  );
  const wire = elec.addWire(
    circuit.id,
    { from: { partId: board.id, pinId: "D9" }, to: { partId: resistor.id, pinId: "1" }, colour: "yellow" },
    NOW,
  );
  return { circuit, board, resistor, wire };
}

describe("ElectronicsStore.createCircuit", () => {
  it("stores a circuit and returns the row", () => {
    const elec = store();
    const circuit = elec.createCircuit({ name: "  Robot  " }, NOW);
    expect(circuit).toMatchObject({ name: "Robot", notes: "", createdAt: NOW, updatedAt: NOW });
    expect(elec.listActive()).toEqual([circuit]);
  });

  it("takes notes when given them, and defaults them to empty", () => {
    const elec = store();
    expect(elec.createCircuit({ name: "A", notes: "12 V napajanje" }, NOW).notes).toBe(
      "12 V napajanje",
    );
    expect(elec.createCircuit({ name: "B" }, NOW).notes).toBe("");
  });

  it("refuses a blank name, an over-long one, and a bad clock", () => {
    const elec = store();
    expect(() => elec.createCircuit({ name: "   " }, NOW)).toThrow(CircuitValidationError);
    expect(() => elec.createCircuit({ name: "x".repeat(201) }, NOW)).toThrow(CircuitValidationError);
    expect(() => elec.createCircuit({ name: "A" }, "juče")).toThrow(CircuitValidationError);
  });

  it("sorts the list sr-Latn, where BINARY collation would put Šema last", () => {
    const elec = store();
    for (const name of ["Zvono", "Šema", "Alarm"]) elec.createCircuit({ name }, NOW);
    expect(elec.listActive().map((row) => row.name)).toEqual(["Alarm", "Šema", "Zvono"]);
  });
});

describe("ElectronicsStore circuit lifecycle", () => {
  it("renames and re-notes a circuit through two statements that cannot do each other's job", () => {
    const elec = store();
    const circuit = elec.createCircuit({ name: "A", notes: "prvo" }, NOW);
    expect(elec.renameCircuit(circuit.id, "B", LATER)).toMatchObject({
      name: "B",
      notes: "prvo",
      updatedAt: LATER,
    });
    expect(elec.setNotes(circuit.id, "drugo", LATER)).toMatchObject({ name: "B", notes: "drugo" });
  });

  it("soft-deletes and restores, and a deleted circuit is not in the list", () => {
    const elec = store();
    const { circuit } = seeded(elec);
    elec.softDelete(circuit.id, LATER);
    expect(elec.listActive()).toEqual([]);
    expect(() => elec.read(circuit.id)).toThrow(CircuitNotFoundError);
    elec.restore(circuit.id, LATER);
    expect(elec.listActive().map((row) => row.id)).toEqual([circuit.id]);
  });

  it("brings the parts and wires back with a restored circuit", () => {
    // The rows never went anywhere — deleting the circuit hides it, and this is
    // what says so. A store that had cascaded the soft delete downward would
    // restore an empty canvas, which is the worse of the two failures.
    const elec = store();
    const { circuit } = seeded(elec);
    elec.softDelete(circuit.id, LATER);
    elec.restore(circuit.id, LATER);
    const detail = elec.read(circuit.id);
    expect(detail.parts).toHaveLength(2);
    expect(detail.wires).toHaveLength(1);
  });

  it("refuses every circuit operation against another profile's id", () => {
    const mine = store();
    const theirs = store();
    const circuit = theirs.createCircuit({ name: "Njihovo" }, NOW);
    expect(() => mine.read(circuit.id)).toThrow(CircuitNotFoundError);
    expect(() => mine.renameCircuit(circuit.id, "Moje", LATER)).toThrow(CircuitNotFoundError);
    expect(() => mine.setNotes(circuit.id, "x", LATER)).toThrow(CircuitNotFoundError);
    expect(() => mine.softDelete(circuit.id, LATER)).toThrow(CircuitNotFoundError);
    expect(() => mine.addPart(circuit.id, { componentId: "c", label: "", x: 0, y: 0, rotation: 0 }, NOW)).toThrow(
      CircuitNotFoundError,
    );
    expect(theirs.listActive()).toHaveLength(1);
  });
});

describe("ElectronicsStore parts", () => {
  it("places a part and reads it back on the circuit", () => {
    const elec = store();
    const { circuit, board, resistor } = seeded(elec);
    expect(resistor).toMatchObject({
      circuitId: circuit.id,
      componentId: "resistor",
      label: "R1",
      x: 200,
      y: 40,
      rotation: 90,
      value: 220,
    });
    expect(new Set(elec.read(circuit.id).parts.map((part) => part.id))).toEqual(
      new Set([board.id, resistor.id]),
    );
  });

  it("orders the parts by WHEN they were placed, not by id", () => {
    // This test found a real defect and is why the reads order by `created_at`:
    // a uuidv7 carries a MILLISECOND timestamp above CSPRNG bytes, so four ids
    // minted inside one millisecond sort randomly against each other and
    // `ORDER BY id` only LOOKS like placement order. The four parts below are
    // stamped in the reverse of the order they are inserted, so a correct read
    // is deterministic and an id-ordered one is a shuffle that matches by
    // chance at best.
    const elec = store();
    const circuit = elec.createCircuit({ name: "Redosled" }, NOW);
    const stamps = [
      ["četvrti", "2026-08-04T12:00:00.000Z"],
      ["treći", "2026-08-03T12:00:00.000Z"],
      ["drugi", "2026-08-02T12:00:00.000Z"],
      ["prvi", "2026-08-01T12:00:00.000Z"],
    ] as const;
    for (const [label, stamp] of stamps) {
      elec.addPart(circuit.id, { componentId: "led", label, x: 0, y: 0, rotation: 0 }, stamp);
    }
    expect(elec.read(circuit.id).parts.map((part) => part.label)).toEqual([
      "prvi",
      "drugi",
      "treći",
      "četvrti",
    ]);
  });

  it("omits `value` entirely for a part that has none, rather than carrying a null", () => {
    const elec = store();
    const { board } = seeded(elec);
    expect("value" in board).toBe(false);
  });

  it("refuses a part whose row the domain rejects, naming the field", () => {
    const elec = store();
    const { circuit } = seeded(elec);
    const bad = (over: Record<string, unknown>) =>
      elec.addPart(circuit.id, { componentId: "c", label: "", x: 0, y: 0, rotation: 0, ...over }, NOW);
    expect(() => bad({ componentId: "" })).toThrow(CircuitValidationError);
    expect(() => bad({ rotation: 37 })).toThrow(CircuitValidationError);
    expect(() => bad({ x: 100_001 })).toThrow(CircuitValidationError);
    expect(() => bad({ y: Number.NaN })).toThrow(CircuitValidationError);
    expect(() => bad({ value: 0 })).toThrow(CircuitValidationError);
    expect(() => bad({ label: "x".repeat(121) })).toThrow(CircuitValidationError);
  });

  it("moves a part without touching anything else about it", () => {
    const elec = store();
    const { resistor } = seeded(elec);
    const moved = elec.updatePart(resistor.id, { x: 12, y: -34 }, LATER);
    expect(moved).toMatchObject({ x: 12, y: -34, label: "R1", rotation: 90, value: 220, updatedAt: LATER });
  });

  it("clears a value when asked, and the row then carries none", () => {
    // `null` is how a caller SAYS „no value" — `undefined` would be
    // indistinguishable from „leave it alone" in a partial update, and a
    // resistor whose value cannot be unset is a resistor nobody can correct.
    const elec = store();
    const { resistor } = seeded(elec);
    expect("value" in elec.updatePart(resistor.id, { value: null }, LATER)).toBe(false);
  });

  it("refuses to update a part of another profile's circuit", () => {
    const mine = store();
    const theirs = store();
    const { resistor } = seeded(theirs);
    expect(() => mine.updatePart(resistor.id, { x: 1 }, LATER)).toThrow(CircuitNotFoundError);
    expect(() => mine.removePart(resistor.id, LATER)).toThrow(CircuitNotFoundError);
  });

  it("takes every wire touching a part when the part goes, from either end", () => {
    // SQLite's CASCADE fires on a HARD delete and this is a soft one, so the
    // wires are this store's job. A wire left hanging off a deleted part is a
    // row `circuitProblems` would report for ever and no screen could fix.
    const elec = store();
    const { circuit, board, resistor } = seeded(elec);
    const second = elec.addWire(
      circuit.id,
      { from: { partId: resistor.id, pinId: "2" }, to: { partId: board.id, pinId: "GND1" }, colour: "black" },
      NOW,
    );
    expect(elec.read(circuit.id).wires.map((wire) => wire.id)).toContain(second.id);

    elec.removePart(resistor.id, LATER);
    const detail = elec.read(circuit.id);
    expect(detail.parts.map((part) => part.id)).toEqual([board.id]);
    expect(detail.wires).toEqual([]);
  });
});

describe("ElectronicsStore wires", () => {
  it("stores a wire between two pins", () => {
    const elec = store();
    const { circuit, board, resistor, wire } = seeded(elec);
    expect(wire).toMatchObject({
      circuitId: circuit.id,
      fromPartId: board.id,
      fromPinId: "D9",
      toPartId: resistor.id,
      toPinId: "1",
      colour: "yellow",
    });
  });

  it("refuses a colour that is not one of the nine jumpers", () => {
    const elec = store();
    const { circuit, board, resistor } = seeded(elec);
    expect(() =>
      elec.addWire(
        circuit.id,
        { from: { partId: board.id, pinId: "5V" }, to: { partId: resistor.id, pinId: "2" }, colour: "magenta" },
        NOW,
      ),
    ).toThrow(CircuitValidationError);
  });

  it("refuses a wire from a pin back to itself", () => {
    const elec = store();
    const { circuit, board } = seeded(elec);
    expect(() =>
      elec.addWire(
        circuit.id,
        { from: { partId: board.id, pinId: "D9" }, to: { partId: board.id, pinId: "D9" }, colour: "red" },
        NOW,
      ),
    ).toThrow(CircuitValidationError);
  });

  it("allows a jumper between two pins of the SAME part", () => {
    const elec = store();
    const { circuit, board } = seeded(elec);
    expect(
      elec.addWire(
        circuit.id,
        { from: { partId: board.id, pinId: "5V" }, to: { partId: board.id, pinId: "GND1" }, colour: "red" },
        NOW,
      ).id,
    ).toBeTruthy();
  });

  it("refuses a wire reaching a part on ANOTHER circuit, which no CHECK can say", () => {
    // A CHECK cannot hold a sub-query, so migration 067 cannot state this and
    // says so. It is the one invariant here that is not structural, and this is
    // where it lives.
    const elec = store();
    const { board } = seeded(elec);
    const other = elec.createCircuit({ name: "Drugo" }, NOW);
    const stranger = elec.addPart(
      other.id,
      { componentId: "led", label: "", x: 0, y: 0, rotation: 0 },
      NOW,
    );
    expect(() =>
      elec.addWire(
        other.id,
        { from: { partId: stranger.id, pinId: "a" }, to: { partId: board.id, pinId: "GND1" }, colour: "green" },
        NOW,
      ),
    ).toThrow(CircuitValidationError);
  });

  it("refuses a wire naming a part that is not there at all", () => {
    const elec = store();
    const { circuit, board } = seeded(elec);
    expect(() =>
      elec.addWire(
        circuit.id,
        { from: { partId: board.id, pinId: "5V" }, to: { partId: uuidv7(), pinId: "1" }, colour: "white" },
        NOW,
      ),
    ).toThrow(CircuitValidationError);
  });

  it("removes a wire and leaves both its parts alone", () => {
    const elec = store();
    const { circuit, wire } = seeded(elec);
    elec.removeWire(wire.id, LATER);
    const detail = elec.read(circuit.id);
    expect(detail.wires).toEqual([]);
    expect(detail.parts).toHaveLength(2);
  });

  it("refuses to remove another profile's wire", () => {
    const mine = store();
    const theirs = store();
    const { wire } = seeded(theirs);
    expect(() => mine.removeWire(wire.id, LATER)).toThrow(CircuitNotFoundError);
  });
});

describe("ElectronicsStore.listAllForExport", () => {
  it("hands back the three collections in one read each, parents first", () => {
    const elec = store();
    const { circuit, board, resistor, wire } = seeded(elec);
    const all = elec.listAllForExport();
    expect(all.circuits.map((row) => row.id)).toEqual([circuit.id]);
    // A SET for the parts: `seeded` stamps both with the same instant, so which
    // of the two comes first is decided by the id and therefore by a CSPRNG.
    // Asserting a sequence here would be a coin flip — the order rule has its
    // own test, one describe up, with clocks that actually differ.
    expect(new Set(all.parts.map((row) => row.id))).toEqual(new Set([board.id, resistor.id]));
    expect(all.wires.map((row) => row.id)).toEqual([wire.id]);
  });

  it("carries nothing of a soft-deleted circuit — not the circuit, not its parts, not its wires", () => {
    // An archive that carried the parts of a circuit it did not carry would
    // restore rows a foreign key refuses.
    const elec = store();
    const { circuit } = seeded(elec);
    elec.softDelete(circuit.id, LATER);
    expect(elec.listAllForExport()).toEqual({ circuits: [], parts: [], wires: [] });
  });

  it("carries nothing of another profile", () => {
    const mine = store();
    const theirs = store();
    seeded(theirs);
    expect(mine.listAllForExport().circuits).toEqual([]);
    expect(mine.listAllForExport().parts).toEqual([]);
    expect(mine.listAllForExport().wires).toEqual([]);
  });
});
