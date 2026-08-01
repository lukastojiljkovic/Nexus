import { describe, expect, it } from "vitest";

import {
  DATA_CONVENTIONS,
  UNIT_KINDS,
  convertUnit,
  findUnit,
  isRatioUnit,
  roundForDisplay,
  unitsOfKind,
} from "./units.js";

describe("the unit table", () => {
  it("gives every kind at least two units, since a converter with one unit converts nothing", () => {
    for (const kind of UNIT_KINDS) {
      expect(unitsOfKind(kind).length, kind).toBeGreaterThan(1);
    }
  });

  it("keeps every unit id unique across the WHOLE table, so an id names one unit and never two", () => {
    const ids = UNIT_KINDS.flatMap((kind) => unitsOfKind(kind).map((unit) => unit.id));
    expect(new Set(ids).size).toBe(ids.length);
    // An id is a key — it reaches `strings` as a lookup and a stored preference —
    // so it carries no diacritics, no spaces and no case surprises.
    for (const id of ids) expect(id, id).toMatch(/^[a-z0-9-]+$/);
  });

  it("files every unit under the kind it was fetched from", () => {
    for (const kind of UNIT_KINDS) {
      for (const unit of unitsOfKind(kind)) expect(unit.kind, unit.id).toBe(kind);
    }
  });

  it("gives every kind exactly one unit that is the base — the one that round-trips as identity", () => {
    for (const kind of UNIT_KINDS) {
      const bases = unitsOfKind(kind).filter(
        (unit) => unit.toBase(1) === 1 && unit.fromBase(1) === 1 && unit.toBase(0) === 0,
      );
      expect(bases.length, kind).toBe(1);
    }
  });

  it("makes toBase and fromBase exact inverses for every RATIO unit, at several magnitudes", () => {
    for (const kind of UNIT_KINDS) {
      for (const unit of unitsOfKind(kind)) {
        if (!isRatioUnit(unit)) continue;
        for (const value of [0, 1, -40, 0.001, 12.5, 98765.4321]) {
          expect(roundForDisplay(unit.fromBase(unit.toBase(value))), `${unit.id} @ ${value}`).toBe(
            roundForDisplay(value),
          );
        }
      }
    }
  });

  /**
   * The offset scales round-trip to an ABSOLUTE tolerance rather than to a
   * significant-digit identity, and that is a property of the arithmetic rather
   * than a defect in the pair. Going to base and back crosses ±273,15 (or ±32),
   * so a double's ~1e-16 relative slack is spent against the OFFSET's magnitude,
   * not against the value's: 0,001 °F survives to about twelve decimal places,
   * which is fifteen digits finer than any thermometer and far finer than
   * anything this converter will ever be asked to show.
   */
  it("makes them inverses to a fine absolute tolerance for the offset units", () => {
    for (const unit of unitsOfKind("temperature")) {
      for (const value of [0, 1, -40, 0.001, 12.5, 98765.4321]) {
        expect(unit.fromBase(unit.toBase(value)), `${unit.id} @ ${value}`).toBeCloseTo(value, 9);
      }
    }
  });

  it("finds a unit by id and refuses an id nobody declared", () => {
    expect(findUnit("km")?.kind).toBe("length");
    expect(findUnit("degf")?.kind).toBe("temperature");
    expect(findUnit("parsek")).toBeUndefined();
  });
});

describe("convertUnit", () => {
  it("converts within length", () => {
    expect(convertUnit(1, "km", "m")).toBe(1000);
    expect(convertUnit(2500, "m", "km")).toBe(2.5);
    expect(roundForDisplay(convertUnit(1, "in", "cm") ?? NaN)).toBe(2.54);
    expect(roundForDisplay(convertUnit(1, "mi", "km") ?? NaN)).toBe(1.609344);
  });

  it("converts within mass, area, volume and speed", () => {
    expect(convertUnit(1, "kg", "g")).toBe(1000);
    expect(roundForDisplay(convertUnit(1, "lb", "g") ?? NaN)).toBe(453.59237);
    expect(convertUnit(1, "ha", "m2")).toBe(10_000);
    expect(convertUnit(1, "l", "ml")).toBe(1000);
    expect(convertUnit(1, "m3", "l")).toBe(1000);
    expect(roundForDisplay(convertUnit(36, "kmh", "ms") ?? NaN)).toBe(10);
  });

  it("returns the value unchanged when the two units are the same one", () => {
    expect(convertUnit(7.5, "kg", "kg")).toBe(7.5);
  });

  it("refuses a conversion ACROSS kinds rather than inventing one", () => {
    // Kilograms are not metres. A table of factors with one shared base would
    // happily answer this; the answer would be meaningless.
    expect(convertUnit(1, "kg", "m")).toBeNull();
    expect(convertUnit(1, "degc", "l")).toBeNull();
  });

  it("refuses an unknown unit rather than guessing which one was meant", () => {
    expect(convertUnit(1, "km", "parsek")).toBeNull();
    expect(convertUnit(1, "parsek", "km")).toBeNull();
  });

  it("refuses a value that is not a finite number", () => {
    expect(convertUnit(Number.NaN, "km", "m")).toBeNull();
    expect(convertUnit(Number.POSITIVE_INFINITY, "km", "m")).toBeNull();
  });
});

/**
 * The offset case. A "multiply by this" table silently produces nonsense here —
 * 0 °C is 32 °F, not 0 °F — which is exactly why the model is a function PAIR.
 */
describe("temperature — the conversion that is not a ratio", () => {
  it("converts the fixed points of the Celsius/Fahrenheit scales", () => {
    expect(roundForDisplay(convertUnit(0, "degc", "degf") ?? NaN)).toBe(32);
    expect(roundForDisplay(convertUnit(100, "degc", "degf") ?? NaN)).toBe(212);
    expect(roundForDisplay(convertUnit(32, "degf", "degc") ?? NaN)).toBe(0);
    expect(roundForDisplay(convertUnit(212, "degf", "degc") ?? NaN)).toBe(100);
  });

  it("converts the one temperature the two scales agree on", () => {
    expect(roundForDisplay(convertUnit(-40, "degc", "degf") ?? NaN)).toBe(-40);
  });

  it("converts Kelvin against both, including absolute zero", () => {
    expect(roundForDisplay(convertUnit(0, "degc", "k") ?? NaN)).toBe(273.15);
    expect(roundForDisplay(convertUnit(0, "k", "degc") ?? NaN)).toBe(-273.15);
    expect(roundForDisplay(convertUnit(0, "k", "degf") ?? NaN)).toBe(-459.67);
  });

  it("marks the temperature units as NOT ratio units, and every other unit as one", () => {
    // The property a caller needs to know before it does anything proportional
    // with a figure — doubling 10 °C is not 20 °C in any physical sense.
    for (const unit of unitsOfKind("temperature")) expect(isRatioUnit(unit), unit.id).toBe(false);
    for (const kind of UNIT_KINDS) {
      if (kind === "temperature") continue;
      for (const unit of unitsOfKind(kind)) expect(isRatioUnit(unit), unit.id).toBe(true);
    }
  });
});

/**
 * kB and KiB are different quantities, and a converter that offers only one of
 * them is quietly wrong for whoever meant the other.
 */
describe("data — the ambiguity the app must not paper over", () => {
  it("offers BOTH conventions, each labelled by which it is", () => {
    const data = unitsOfKind("data");
    const decimal = data.filter((unit) => unit.convention === "decimal");
    const binary = data.filter((unit) => unit.convention === "binary");
    expect(decimal.map((unit) => unit.id)).toEqual(["kb-dec", "mb-dec", "gb-dec", "tb-dec"]);
    expect(binary.map((unit) => unit.id)).toEqual(["kib", "mib", "gib", "tib"]);
    expect(DATA_CONVENTIONS).toEqual(["decimal", "binary"]);
  });

  it("keeps the two conventions numerically distinct — the whole point of offering both", () => {
    expect(convertUnit(1, "kb-dec", "byte")).toBe(1000);
    expect(convertUnit(1, "kib", "byte")).toBe(1024);
    expect(convertUnit(1, "gb-dec", "byte")).toBe(1_000_000_000);
    expect(convertUnit(1, "gib", "byte")).toBe(1_073_741_824);
    // The gap a user notices on a disk label: a „1 TB" drive is ~0,909 TiB.
    expect(roundForDisplay(convertUnit(1, "tb-dec", "tib") ?? NaN, 4)).toBe(0.9095);
  });

  it("carries bits alongside bytes, at eight to the byte", () => {
    expect(convertUnit(1, "byte", "bit")).toBe(8);
    expect(convertUnit(8, "bit", "byte")).toBe(1);
  });

  it("leaves every non-data unit without a convention, because none is ambiguous that way", () => {
    for (const kind of UNIT_KINDS) {
      if (kind === "data") continue;
      for (const unit of unitsOfKind(kind)) expect(unit.convention, unit.id).toBeUndefined();
    }
  });
});

describe("roundForDisplay", () => {
  it("rounds for DISPLAY only, at twelve significant digits by default", () => {
    expect(roundForDisplay(1 / 3)).toBe(0.333333333333);
    expect(roundForDisplay(123456.789)).toBe(123456.789);
  });

  it("clears the float noise an exact conversion leaves behind", () => {
    // The reason this exists at all: 0.1 + 0.2 is 0.30000000000000004, and a
    // converter that prints that has lost the user's trust over nothing.
    expect(roundForDisplay(0.1 + 0.2)).toBe(0.3);
    expect(roundForDisplay(convertUnit(0.1, "km", "m") ?? NaN)).toBe(100);
  });

  it("keeps a round trip through a distant unit visibly lossless", () => {
    const there = convertUnit(1.23456789, "km", "mm") ?? NaN;
    expect(roundForDisplay(convertUnit(there, "mm", "km") ?? NaN)).toBe(1.23456789);
  });

  it("leaves zero, negatives and non-finite values alone", () => {
    expect(roundForDisplay(0)).toBe(0);
    expect(roundForDisplay(-2.5)).toBe(-2.5);
    expect(Number.isNaN(roundForDisplay(Number.NaN))).toBe(true);
  });
});
