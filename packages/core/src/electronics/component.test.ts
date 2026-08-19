// What makes a catalogue entry fit to ship.
//
// Every test below mutates ONE field of a known-good entry, because that is the
// only way to know a rule fires for its own reason. A fixture written wrong in
// three places passes or fails as a lump and says nothing about which rule
// caught it.
//
// The two rules worth reading before the rest are `bus-pin` and `pin-bus`: a
// component that DECLARES i2c but has no SDA pin, and a component that HAS an
// SDA pin but declares no bus. Both are entries the rules engine cannot reason
// about later — the first promises a bus it cannot reach, the second carries a
// wire nothing knows the meaning of — and neither is visible by reading the
// entry, because each half looks correct on its own.

import { describe, expect, it } from "vitest";

import { validateComponent, type ComponentDef } from "./component.js";

/** A real entry, kept small: the BMP280 as it is actually wired. */
const bmp280 = (): Record<string, unknown> => ({
  id: "bmp280",
  kind: "sensor",
  name: "BMP280",
  summary: "Barometarski senzor pritiska i temperature.",
  supply: { min: 1.71, max: 3.6 },
  current: { typical: 0.0027, peak: 0.72 },
  buses: [{ kind: "i2c", addresses: [0x76, 0x77] }],
  pins: [
    { id: "VCC", label: "VCC", functions: ["power-in"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
    { id: "SCL", label: "SCL", functions: ["i2c-scl"] },
    { id: "SDA", label: "SDA", functions: ["i2c-sda"] },
  ],
  library: "Adafruit BMP280 Library",
});

/** A minimal board, for the rules that only boards have. */
const uno = (): Record<string, unknown> => ({
  id: "arduino-uno",
  kind: "board",
  name: "Arduino UNO R3",
  summary: "Osnovna ploča sa ATmega328P.",
  supply: { min: 7, max: 12 },
  current: { typical: 45, peak: 200 },
  logicVolts: 5,
  // A master lists no address, which the `address` rule allows only for a board.
  buses: [{ kind: "i2c", addresses: [] }],
  pins: [
    { id: "5V", label: "5V", functions: ["power-out"], volts: 5 },
    { id: "3V3", label: "3.3V", functions: ["power-out"], volts: 3.3 },
    { id: "GND1", label: "GND", functions: ["gnd"] },
    { id: "D9", label: "9", functions: ["digital-in", "digital-out", "pwm"], volts: 5 },
    { id: "A4", label: "A4", functions: ["analog-in", "i2c-sda"], volts: 5 },
    { id: "A5", label: "A5", functions: ["analog-in", "i2c-scl"], volts: 5 },
  ],
});

/** The unpowered shape: two interchangeable legs, no supply, no draw. */
const resistor = (): Record<string, unknown> => ({
  id: "resistor",
  kind: "passive",
  name: "Otpornik",
  summary: "Ograničava struju.",
  valueUnit: "ohm",
  buses: [],
  pins: [
    { id: "1", label: "1", functions: ["passive"] },
    { id: "2", label: "2", functions: ["passive"] },
  ],
});

/** Just the codes, which is what a reader of a failure scans. */
const codes = (value: unknown): string[] => validateComponent(value).map((p) => p.code);

/** Replaces one path in a fixture, so a test states its mutation in one line. */
function withField(base: Record<string, unknown>, field: string, value: unknown): unknown {
  return { ...base, [field]: value };
}

describe("validateComponent — a good entry", () => {
  it("accepts a real sensor", () => {
    expect(validateComponent(bmp280())).toEqual([]);
  });

  it("accepts a real board", () => {
    expect(validateComponent(uno())).toEqual([]);
  });

  it("refuses anything that is not an object", () => {
    expect(codes(null)).toEqual(["shape"]);
    expect(codes([])).toEqual(["shape"]);
    expect(codes("bmp280")).toEqual(["shape"]);
  });
});

describe("validateComponent — identity", () => {
  it("demands a kebab-case id", () => {
    expect(codes(withField(bmp280(), "id", "BMP280"))).toContain("id");
    expect(codes(withField(bmp280(), "id", "bmp_280"))).toContain("id");
    expect(codes(withField(bmp280(), "id", ""))).toContain("id");
    // Digits and internal hyphens are ordinary in part numbers.
    expect(validateComponent(withField(bmp280(), "id", "hc-sr04"))).toEqual([]);
  });

  it("demands a known kind", () => {
    expect(codes(withField(bmp280(), "kind", "gizmo"))).toContain("kind");
  });

  it("demands a name and a summary that say something", () => {
    expect(codes(withField(bmp280(), "name", "  "))).toContain("shape");
    expect(codes(withField(bmp280(), "summary", ""))).toContain("shape");
  });
});

describe("validateComponent — the electrical envelope", () => {
  it("refuses a supply range that runs backwards", () => {
    expect(codes(withField(bmp280(), "supply", { min: 5, max: 3.3 }))).toContain("order");
  });

  it("refuses a supply at or below zero, and one above what this catalogue covers", () => {
    expect(codes(withField(bmp280(), "supply", { min: 0, max: 3.6 }))).toContain("range");
    // 60 V is the ceiling: everything here is low-voltage DC, and a mains part
    // that slipped in would be a safety claim the module has no right to make.
    expect(codes(withField(bmp280(), "supply", { min: 5, max: 230 }))).toContain("range");
  });

  it("refuses a peak current below the typical one", () => {
    expect(codes(withField(bmp280(), "current", { typical: 100, peak: 10 }))).toContain("order");
  });

  it("refuses a negative current", () => {
    expect(codes(withField(bmp280(), "current", { typical: -1, peak: 10 }))).toContain("range");
  });

  it("accepts a part that states neither, because plenty of real parts have neither", () => {
    // A resistor. It is not „an entry missing two fields" — it has no supply to
    // state and draws whatever the circuit allows. The shipped catalogue is held
    // to a stricter rule in `catalogue.test.ts`; this validator also runs on
    // components the user defines, where „I do not know" is a true answer.
    expect(validateComponent(resistor())).toEqual([]);
  });

  it("still checks a stated supply on a part that need not have stated one", () => {
    // The permission is to omit, not to be wrong about it.
    expect(codes({ ...resistor(), supply: { min: 5, max: 3 } })).toContain("order");
  });
});

describe("validateComponent — a value the user picks", () => {
  it("accepts the units a part can be measured in", () => {
    expect(validateComponent({ ...resistor(), valueUnit: "farad" })).toEqual([]);
  });

  it("refuses a unit outside them", () => {
    // „kΩ" is a scale, not a unit, and a canvas switching on this string would
    // silently render no input at all for it.
    expect(codes({ ...resistor(), valueUnit: "kOhm" })).toContain("shape");
  });
});

describe("validateComponent — pins", () => {
  it("demands at least one pin", () => {
    expect(codes(withField(bmp280(), "pins", []))).toContain("pins");
  });

  it("refuses two pins with the same id", () => {
    const pins = [...(bmp280()["pins"] as unknown[]), { id: "VCC", label: "VCC2", functions: ["power-in"] }];
    expect(codes(withField(bmp280(), "pins", pins))).toContain("duplicate");
  });

  it("refuses a pin with no function at all", () => {
    const pins = [{ id: "P1", label: "1", functions: [] }];
    expect(codes(withField(bmp280(), "pins", pins))).toContain("pins");
  });

  it("refuses an unknown pin function", () => {
    const pins = [{ id: "P1", label: "1", functions: ["telepathy"] }];
    expect(codes(withField(bmp280(), "pins", pins))).toContain("pins");
  });

  it("demands a ground pin from anything that takes power", () => {
    // A part with a supply pin and no return path is not a part anyone can wire.
    // This is the one entry error that would otherwise reach the canvas and look
    // like the user's mistake.
    const pins = (bmp280()["pins"] as { id: string }[]).filter((pin) => pin.id !== "GND");
    expect(codes(withField(bmp280(), "pins", pins))).toContain("ground");
  });
});

describe("validateComponent — bus and pins must agree", () => {
  it("refuses an i2c bus with no SDA or no SCL pin", () => {
    const pins = (bmp280()["pins"] as { id: string }[]).filter((pin) => pin.id !== "SDA");
    expect(codes(withField(bmp280(), "pins", pins))).toContain("bus-pin");
  });

  it("refuses an SDA pin on a component that declares no i2c bus", () => {
    expect(codes(withField(bmp280(), "buses", []))).toContain("pin-bus");
  });

  it("refuses an spi bus without a clock", () => {
    const spi = {
      ...bmp280(),
      buses: [{ kind: "spi" }],
      pins: [
        { id: "VCC", label: "VCC", functions: ["power-in"] },
        { id: "GND", label: "GND", functions: ["gnd"] },
        { id: "MOSI", label: "MOSI", functions: ["spi-mosi"] },
        { id: "CS", label: "CS", functions: ["spi-cs"] },
      ],
    };
    expect(codes(spi)).toContain("bus-pin");
  });

  it("accepts a uart part that only transmits", () => {
    // A GPS module is wired TX-only in most sketches, and refusing that would be
    // the validator inventing a rule the hardware does not have.
    const gps = {
      ...bmp280(),
      id: "neo-6m",
      buses: [{ kind: "uart", baud: 9600 }],
      pins: [
        { id: "VCC", label: "VCC", functions: ["power-in"] },
        { id: "GND", label: "GND", functions: ["gnd"] },
        { id: "TX", label: "TX", functions: ["uart-tx"] },
      ],
    };
    expect(validateComponent(gps)).toEqual([]);
  });
});

describe("validateComponent — i2c addresses", () => {
  it("refuses an address outside the 7-bit usable range", () => {
    expect(codes(withField(bmp280(), "buses", [{ kind: "i2c", addresses: [0x00] }]))).toContain("address");
    expect(codes(withField(bmp280(), "buses", [{ kind: "i2c", addresses: [0x78] }]))).toContain("address");
  });

  it("refuses the same address listed twice", () => {
    expect(codes(withField(bmp280(), "buses", [{ kind: "i2c", addresses: [0x76, 0x76] }]))).toContain("duplicate");
  });

  it("demands at least one address from a peripheral", () => {
    // A board's i2c bus legitimately lists none — it is the master. A sensor
    // with no address is an entry nobody can check for a collision.
    expect(codes(withField(bmp280(), "buses", [{ kind: "i2c", addresses: [] }]))).toContain("address");
    expect(validateComponent(uno())).toEqual([]);
  });
});

describe("validateComponent — what only a board may be", () => {
  it("demands a logic level from a board", () => {
    const { logicVolts: _drop, ...rest } = uno() as Record<string, unknown> & { logicVolts?: number };
    expect(codes(rest)).toContain("board");
  });

  it("demands that a board supply power on some pin", () => {
    const pins = (uno()["pins"] as { functions: string[] }[]).filter(
      (pin) => !pin.functions.includes("power-out"),
    );
    expect(codes(withField(uno(), "pins", pins))).toContain("board");
  });

  it("refuses a power-out pin on anything that is not a board or a power part", () => {
    // A sensor that claims to feed the rail is a data error that would make the
    // current budget nonsense.
    const pins = [...(bmp280()["pins"] as unknown[]), { id: "OUT", label: "OUT", functions: ["power-out"], volts: 5 }];
    expect(codes(withField(bmp280(), "pins", pins))).toContain("board");
  });

  it("refuses a logic level on something that is not a board", () => {
    expect(codes(withField(bmp280(), "logicVolts", 3.3))).toContain("board");
  });

  it("demands a volts figure on every power-out pin", () => {
    const pins = [
      { id: "5V", label: "5V", functions: ["power-out"] },
      { id: "GND1", label: "GND", functions: ["gnd"] },
    ];
    expect(codes(withField(uno(), "pins", pins))).toContain("range");
  });
});

describe("validateComponent — the optional fields", () => {
  it("accepts an entry with no library", () => {
    const { library: _drop, ...rest } = bmp280() as Record<string, unknown> & { library?: string };
    expect(validateComponent(rest)).toEqual([]);
  });

  it("refuses a library key that is present and empty", () => {
    expect(codes(withField(bmp280(), "library", "   "))).toContain("shape");
  });
});

describe("the type actually compiles against a real entry", () => {
  it("is assignable", () => {
    // Not a runtime assertion — this test exists so a change to `ComponentDef`
    // that the JSON catalogue no longer satisfies fails at typecheck, in this
    // file, rather than at the first call site that reads a field.
    const entry: ComponentDef = {
      id: "ds18b20",
      kind: "sensor",
      name: "DS18B20",
      summary: "Digitalni temperaturni senzor na 1-Wire magistrali.",
      supply: { min: 3, max: 5.5 },
      current: { typical: 1, peak: 1.5 },
      buses: [{ kind: "onewire" }],
      pins: [
        { id: "VDD", label: "VDD", functions: ["power-in"] },
        { id: "GND", label: "GND", functions: ["gnd"] },
        { id: "DQ", label: "DQ", functions: ["onewire"] },
      ],
      library: "DallasTemperature",
    };
    expect(validateComponent(entry)).toEqual([]);
  });
});
