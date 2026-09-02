import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Chassis } from "@nexus/core";
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
    const { circuit, board, resistor, wire } = seeded(elec);
    const second = elec.addWire(
      circuit.id,
      { from: { partId: resistor.id, pinId: "2" }, to: { partId: board.id, pinId: "GND1" }, colour: "black" },
      NOW,
    );
    expect(elec.read(circuit.id).wires.map((wire) => wire.id)).toContain(second.id);

    const taken = elec.removePart(resistor.id, LATER);
    const detail = elec.read(circuit.id);
    expect(detail.parts.map((part) => part.id)).toEqual([board.id]);
    expect(detail.wires).toEqual([]);
    // The ids come back because the caller is a canvas holding the document in
    // memory: „the part is gone" alone leaves it drawing wires to nothing, and
    // re-reading the whole circuit to find out would cost every other row on it.
    expect(new Set(taken)).toEqual(new Set([wire.id, second.id]));
  });

  it("answers with an empty list for a part nothing was wired to", () => {
    // The other half of the same question, and the one a mutation reaches: a
    // removal that reported the wires of some OTHER part would still pass the
    // test above, which only ever removes the part every wire touches.
    const elec = store();
    const { circuit, board, resistor } = seeded(elec);
    const lone = elec.addPart(
      circuit.id,
      { componentId: "led", label: "D1", x: 300, y: 0, rotation: 0 },
      NOW,
    );
    expect(elec.removePart(lone.id, LATER)).toEqual([]);
    // And the wire between the two OTHER parts is untouched.
    expect(elec.read(circuit.id).wires).toHaveLength(1);
    // A Set, not an array: `seeded` stamps both parts with the same instant, so
    // the order between them is the id tie-break — deterministic per row pair and
    // a coin flip across runs, because uuidv7 puts CSPRNG bytes under the clock.
    expect(new Set(elec.read(circuit.id).parts.map((part) => part.id))).toEqual(
      new Set([board.id, resistor.id]),
    );
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

  it("recolours a wire in place, keeping its id and both its ends", () => {
    const elec = store();
    const { circuit, wire } = seeded(elec);
    const recoloured = elec.setWireColour(wire.id, "black", LATER);
    expect(recoloured).toEqual({ ...wire, colour: "black", updatedAt: LATER });
    expect(elec.read(circuit.id).wires).toEqual([recoloured]);
  });

  it("refuses a recolour to something that is not one of the nine jumpers", () => {
    const elec = store();
    const { circuit, wire } = seeded(elec);
    expect(() => elec.setWireColour(wire.id, "magenta", LATER)).toThrow(CircuitValidationError);
    // And the refusal left the row alone — a validation that has already
    // written is a validation that ran too late.
    expect(elec.read(circuit.id).wires[0]).toEqual(wire);
  });

  it("recolours only the wire it names", () => {
    const elec = store();
    const { circuit, board, resistor, wire } = seeded(elec);
    const other = elec.addWire(
      circuit.id,
      { from: { partId: board.id, pinId: "GND1" }, to: { partId: resistor.id, pinId: "2" }, colour: "black" },
      NOW,
    );
    elec.setWireColour(wire.id, "red", LATER);
    expect(elec.read(circuit.id).wires.find((row) => row.id === other.id)).toEqual(other);
  });

  it("refuses to recolour another profile's wire", () => {
    const mine = store();
    const theirs = store();
    const { wire } = seeded(theirs);
    expect(() => mine.setWireColour(wire.id, "red", LATER)).toThrow(CircuitNotFoundError);
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
  it("hands back the four collections in one read each, parents first", () => {
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

  it("carries the machine with the circuit that owns it, keyed by that circuit", () => {
    // The one export row with no id of its own: `circuit_id` is the whole
    // primary key, so the export has to say which circuit it belongs to or the
    // row cannot be written back.
    const elec = store();
    const { circuit } = seeded(elec);
    elec.setChassis(circuit.id, ROVER, LATER);
    expect(elec.listAllForExport().chassis).toEqual([
      { circuitId: circuit.id, ...ROVER, createdAt: LATER, updatedAt: LATER },
    ]);
  });

  it("carries no machine for a circuit that has none", () => {
    const elec = store();
    seeded(elec);
    expect(elec.listAllForExport().chassis).toEqual([]);
  });

  it("carries nothing of a soft-deleted circuit — not the circuit, not its machine, not its parts, not its wires", () => {
    // An archive that carried the parts of a circuit it did not carry would
    // restore rows a foreign key refuses.
    const elec = store();
    const { circuit } = seeded(elec);
    elec.setChassis(circuit.id, ROVER, NOW);
    elec.softDelete(circuit.id, LATER);
    expect(elec.listAllForExport()).toEqual({ circuits: [], chassis: [], parts: [], wires: [] });
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

/** A rover somebody actually measured — centimetres and grams, as typed. */
const ROVER: Chassis = {
  shape: "diff-rover",
  bodyLength: 20,
  bodyWidth: 15,
  bodyHeight: 6,
  wheelRadius: 3.4,
  wheelWidth: 2.6,
  wheelTrack: 17,
  wheelBase: 12,
  bodyMass: 900,
  wheelMass: 40,
};

describe("ElectronicsStore chassis", () => {
  it("says nothing about a machine when nobody dimensioned one", () => {
    // Absent, not null: a breadboard is not a robot, and the difference matters
    // to the generator, which refuses rather than inventing a wheel radius.
    const elec = store();
    const { circuit } = seeded(elec);
    expect(elec.read(circuit.id).chassis).toBeUndefined();
  });

  it("keeps the nine numbers in the units they were typed in", () => {
    const elec = store();
    const { circuit } = seeded(elec);
    elec.setChassis(circuit.id, ROVER, LATER);
    expect(elec.read(circuit.id).chassis).toEqual(ROVER);
  });

  it("replaces the machine rather than keeping two of them", () => {
    const elec = store();
    const { circuit } = seeded(elec);
    elec.setChassis(circuit.id, ROVER, NOW);
    elec.setChassis(circuit.id, { ...ROVER, bodyLength: 24 }, LATER);
    expect(elec.read(circuit.id).chassis?.bodyLength).toBe(24);
    const row = db.raw
      .prepare("SELECT COUNT(*) AS n FROM circuit_chassis WHERE circuit_id = ?")
      .get(circuit.id);
    expect(row).toEqual({ n: 1 });
  });

  it("keeps the first measurement's created_at through a re-measure", () => {
    const elec = store();
    const { circuit } = seeded(elec);
    elec.setChassis(circuit.id, ROVER, NOW);
    elec.setChassis(circuit.id, { ...ROVER, bodyMass: 1200 }, LATER);
    expect(
      db.raw
        .prepare("SELECT created_at, updated_at FROM circuit_chassis WHERE circuit_id = ?")
        .get(circuit.id),
    ).toEqual({ created_at: NOW, updated_at: LATER });
  });

  it("takes the machine away when told there is not one", () => {
    const elec = store();
    const { circuit } = seeded(elec);
    elec.setChassis(circuit.id, ROVER, NOW);
    elec.setChassis(circuit.id, null, LATER);
    expect(elec.read(circuit.id).chassis).toBeUndefined();
  });

  it("is content to be told twice there is no machine", () => {
    const elec = store();
    const { circuit } = seeded(elec);
    expect(() => elec.setChassis(circuit.id, null, LATER)).not.toThrow();
  });

  it("refuses wheels that would grind through each other", () => {
    // Track is centre-to-centre, so a track no wider than a wheel puts the two
    // wheels in the same space. The store, the canvas and the SQL CHECK all
    // refuse it, and this is the one of the three a user can reach.
    const elec = store();
    const { circuit } = seeded(elec);
    expect(() => elec.setChassis(circuit.id, { ...ROVER, wheelTrack: 2.6 }, LATER)).toThrow(
      CircuitValidationError,
    );
  });

  it("refuses a dimension of zero as firmly as a negative one", () => {
    // A body 0 cm long has zero inertia and simulates a machine that cannot be
    // pushed — a silent wrong answer, which is worse than a refused row.
    const elec = store();
    const { circuit } = seeded(elec);
    expect(() => elec.setChassis(circuit.id, { ...ROVER, bodyHeight: 0 }, LATER)).toThrow(
      CircuitValidationError,
    );
  });

  it("refuses a shape the generator has no geometry for", () => {
    // The cast is the test: the shape arrives over IPC from an untrusted
    // renderer, where „it is one of the two" is a claim rather than a fact, so
    // the store has to refuse it at runtime and not merely at compile time.
    const elec = store();
    const { circuit } = seeded(elec);
    const hexapod = { ...ROVER, shape: "hexapod" } as unknown as Chassis;
    expect(() => elec.setChassis(circuit.id, hexapod, LATER)).toThrow(CircuitValidationError);
  });

  it("names the field at fault under its chassis prefix", () => {
    const elec = store();
    const { circuit } = seeded(elec);
    expect(() => elec.setChassis(circuit.id, { ...ROVER, wheelRadius: -1 }, LATER)).toThrow(
      /chassis\.wheelRadius/,
    );
  });

  it("refuses to dimension another profile's circuit", () => {
    const mine = store();
    const theirs = store();
    const { circuit } = seeded(theirs);
    expect(() => mine.setChassis(circuit.id, ROVER, LATER)).toThrow(CircuitNotFoundError);
    expect(theirs.read(circuit.id).chassis).toBeUndefined();
  });

  it("refuses to un-dimension another profile's circuit", () => {
    const mine = store();
    const theirs = store();
    const { circuit } = seeded(theirs);
    theirs.setChassis(circuit.id, ROVER, NOW);
    expect(() => mine.setChassis(circuit.id, null, LATER)).toThrow(CircuitNotFoundError);
    expect(theirs.read(circuit.id).chassis).toEqual(ROVER);
  });
});

describe("ElectronicsStore part mounts", () => {
  function ranger(elec: ElectronicsStore, circuitId: string, mount?: string) {
    return elec.addPart(
      circuitId,
      { componentId: "hc-sr04", label: "US1", x: 40, y: 40, rotation: 0, ...(mount === undefined ? {} : { mount }) },
      NOW,
    );
  }

  it("places a sensor on a face of the machine", () => {
    const elec = store();
    const { circuit } = seeded(elec);
    const part = ranger(elec, circuit.id, "front");
    expect(part.mount).toBe("front");
    expect(elec.read(circuit.id).parts.find((row) => row.id === part.id)?.mount).toBe("front");
  });

  it("leaves a part that is not on the machine without the field at all", () => {
    const elec = store();
    const { circuit } = seeded(elec);
    const part = ranger(elec, circuit.id);
    expect(part).not.toHaveProperty("mount");
    expect(elec.read(circuit.id).parts.find((row) => row.id === part.id)).not.toHaveProperty("mount");
  });

  it("refuses a face the machine does not have", () => {
    const elec = store();
    const { circuit } = seeded(elec);
    expect(() => ranger(elec, circuit.id, "underneath")).toThrow(CircuitValidationError);
  });

  it("keeps the mount through an edit that never mentions it", () => {
    // The regression this exists for: the by-id read is a different statement
    // from the by-circuit one, and a column missing from it makes „leave it
    // alone" read as „it was never set" — so renaming a sensor would quietly
    // take it off the robot.
    const elec = store();
    const { circuit } = seeded(elec);
    const part = ranger(elec, circuit.id, "front");
    expect(elec.updatePart(part.id, { label: "Prednji" }, LATER).mount).toBe("front");
    expect(elec.read(circuit.id).parts.find((row) => row.id === part.id)?.mount).toBe("front");
  });

  it("moves a sensor from one face to another", () => {
    const elec = store();
    const { circuit } = seeded(elec);
    const part = ranger(elec, circuit.id, "front");
    expect(elec.updatePart(part.id, { mount: "rear" }, LATER).mount).toBe("rear");
  });

  it("takes a sensor off the machine when the mount is cleared", () => {
    // `null` clears, `undefined` leaves alone — `value`'s three states, for
    // `value`'s reason: a sensor taken off the robot must be expressible.
    const elec = store();
    const { circuit } = seeded(elec);
    const part = ranger(elec, circuit.id, "top");
    expect(elec.updatePart(part.id, { mount: null }, LATER)).not.toHaveProperty("mount");
    expect(elec.read(circuit.id).parts.find((row) => row.id === part.id)).not.toHaveProperty("mount");
  });

  it("carries the mount into an export", () => {
    const elec = store();
    const { circuit } = seeded(elec);
    const part = ranger(elec, circuit.id, "left");
    expect(elec.listAllForExport().parts.find((row) => row.id === part.id)?.mount).toBe("left");
  });
});
