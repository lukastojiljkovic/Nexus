// Fixtures by hand, for `ros.test.ts`'s reason: a generator tested against the
// catalogue's own entries follows the catalogue wherever it moves and can never
// disagree with it.
//
// The assertions ask for the SHAPE of the description — that a joint exists,
// that an inertia was computed from the mass and the box — rather than for the
// exact text of one XML file. The arithmetic is the exception: those are
// re-derived by hand in the test, because a moment of inertia that matches the
// implementation and nothing else is a test that only proves the code is stable.

import { describe, expect, it } from "vitest";

import type { Chassis } from "./chassis.js";
import type { Circuit, CircuitPart, CircuitWire } from "./circuit.js";
import type { ComponentDef } from "./component.js";
import { generateUrdf, type RobotDescription } from "./urdf.js";

const pi: ComponentDef = {
  id: "raspberry-pi-4b",
  kind: "board",
  name: "Raspberry Pi 4 Model B",
  summary: "Računar sa Linuxom.",
  supply: { min: 5, max: 5.1 },
  current: { typical: 600, peak: 3000 },
  logicVolts: 3.3,
  programming: "linux",
  buses: [],
  pins: [
    { id: "GND1", label: "GND", functions: ["gnd"] },
    { id: "GPIO23", label: "GPIO23", functions: ["digital-in", "digital-out"], volts: 3.3 },
  ],
};

const ranger: ComponentDef = {
  id: "hc-sr04",
  kind: "sensor",
  simulates: "ranger",
  simRangeCm: { min: 2, max: 400 },
  name: "HC-SR04",
  summary: "Ultrazvučni daljinomer.",
  supply: { min: 5, max: 5 },
  current: { typical: 15, peak: 20 },
  buses: [],
  pins: [{ id: "ECHO", label: "ECHO", functions: ["digital-out"], volts: 5 }],
};

const imu: ComponentDef = {
  id: "mpu6050",
  kind: "sensor",
  simulates: "imu",
  name: "MPU-6050",
  summary: "Akcelerometar i žiroskop.",
  supply: { min: 3, max: 5 },
  current: { typical: 4, peak: 5 },
  buses: [],
  pins: [{ id: "INT", label: "INT", functions: ["digital-out"], volts: 3.3 }],
};

/** A sensor a physics engine has nothing to say about. */
const gas: ComponentDef = {
  id: "mq-2",
  kind: "sensor",
  name: "MQ-2",
  summary: "Senzor gasa.",
  supply: { min: 5, max: 5 },
  current: { typical: 150, peak: 180 },
  buses: [],
  pins: [{ id: "AO", label: "AO", functions: ["analog-out"] }],
};

const shipped = new Map<string, ComponentDef>(
  [pi, ranger, imu, gas].map((component) => [component.id, component]),
);
const resolve = (id: string): ComponentDef | undefined => shipped.get(id);

const chassis: Chassis = {
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

function part(id: string, componentId: string, label = "", mount?: string): CircuitPart {
  return {
    id,
    circuitId: "c1",
    componentId,
    label,
    x: 0,
    y: 0,
    rotation: 0,
    ...(mount === undefined ? {} : { mount }),
  } as CircuitPart;
}

/**
 * `null` rather than `undefined` for „no chassis": passing `undefined`
 * explicitly is exactly what triggers a default parameter, so the obvious
 * spelling of this helper silently gave every „undimensioned" circuit the
 * default rover — and the refusal test passed a description.
 */
function circuit(parts: readonly CircuitPart[], withChassis: Chassis | null = chassis): Circuit {
  return {
    id: "c1",
    name: "Rover",
    notes: "",
    parts,
    wires: [] as readonly CircuitWire[],
    ...(withChassis === null ? {} : { chassis: withChassis }),
  } as Circuit;
}

function built(c: Circuit): Extract<RobotDescription, { kind: "urdf" }> {
  const result = generateUrdf(c, resolve);
  if (result.kind !== "urdf") throw new Error(`expected a description, got ${result.reason}`);
  return result;
}

describe("generateUrdf — when there is no description to give", () => {
  it("refuses a circuit nobody has dimensioned", () => {
    expect(generateUrdf(circuit([part("p1", "raspberry-pi-4b")], null), resolve)).toEqual({
      kind: "refused",
      reason: "no-chassis",
    });
  });
});

describe("generateUrdf — the machine the user dimensioned", () => {
  it("is one well-formed robot, named for the circuit", () => {
    const xml = built(circuit([part("p1", "raspberry-pi-4b")])).xml;
    expect(xml.startsWith('<?xml version="1.0"?>')).toBe(true);
    expect(xml).toContain('<robot name="rover">');
    expect(xml.trimEnd().endsWith("</robot>")).toBe(true);
    // Every element opened is closed: a description that does not parse is one
    // `check_urdf` rejects before the user ever sees the machine.
    expect((xml.match(/<link /g) ?? []).length).toBe((xml.match(/<\/link>/g) ?? []).length);
    expect((xml.match(/<joint /g) ?? []).length).toBe((xml.match(/<\/joint>/g) ?? []).length);
  });

  /**
   * Re-derived by hand from the box formula, not read off the implementation.
   * Body 0.20 × 0.15 × 0.06 m at 0.9 kg:
   *   Ixx = m(W² + H²)/12 = 0.9(0.0225 + 0.0036)/12 = 0.00195750
   *   Iyy = m(L² + H²)/12 = 0.9(0.0400 + 0.0036)/12 = 0.00327000
   *   Izz = m(L² + W²)/12 = 0.9(0.0400 + 0.0225)/12 = 0.00468750
   */
  it("computes the body's inertia from the mass and the box, in SI", () => {
    const xml = built(circuit([part("p1", "raspberry-pi-4b")])).xml;
    expect(xml).toContain('<box size="0.2 0.15 0.06"/>');
    expect(xml).toContain('<mass value="0.9"/>');
    expect(xml).toContain('ixx="0.0019575"');
    expect(xml).toContain('iyy="0.00327"');
    expect(xml).toContain('izz="0.0046875"');
  });

  /**
   * Wheel: a cylinder of r = 0.034 m, h = 0.026 m, 0.04 kg, spinning about Y.
   *   Iyy (the symmetry axis) = m r² / 2      = 0.04 · 0.001156 / 2 = 0.00002312
   *   Ixx = Izz = m(3r² + h²)/12 = 0.04(0.003468 + 0.000676)/12    = 0.000013813…
   */
  it("computes a wheel's inertia about the axis it actually spins on", () => {
    const xml = built(circuit([part("p1", "raspberry-pi-4b")])).xml;
    expect(xml).toContain('<cylinder radius="0.034" length="0.026"/>');
    expect(xml).toContain('iyy="0.00002312"');
    expect(xml).toMatch(/ixx="0\.0000138\d*"/);
  });

  it("puts a differential rover on two driven wheels and one caster", () => {
    const xml = built(circuit([part("p1", "raspberry-pi-4b")])).xml;
    expect(xml).toContain('<joint name="wheel_left_joint" type="continuous">');
    expect(xml).toContain('<joint name="wheel_right_joint" type="continuous">');
    // Track 17 cm → ±0.085 m; wheelbase 12 cm puts the pair 0.06 m forward.
    expect(xml).toContain('<origin xyz="0.06 0.085 0" rpy="0 0 0"/>');
    expect(xml).toContain('<origin xyz="0.06 -0.085 0" rpy="0 0 0"/>');
    // The caster is a sphere of half the wheel radius, centred half a radius
    // down — so its lowest point is exactly the ground the wheels stand on.
    expect(xml).toContain('<sphere radius="0.017"/>');
    expect(xml).toContain('<origin xyz="-0.06 0 -0.017" rpy="0 0 0"/>');
    expect(xml).toContain('<joint name="caster_joint" type="fixed">');
  });

  it("puts a four-wheel rover on four, and gives it no caster at all", () => {
    const xml = built(circuit([part("p1", "raspberry-pi-4b")], { ...chassis, shape: "four-wheel-rover" })).xml;
    for (const name of ["front_left", "front_right", "rear_left", "rear_right"]) {
      expect(xml).toContain(`<joint name="wheel_${name}_joint" type="continuous">`);
    }
    expect(xml).not.toContain("caster");
    expect(xml).toContain('<origin xyz="0.06 0.085 0" rpy="0 0 0"/>');
    expect(xml).toContain('<origin xyz="-0.06 -0.085 0" rpy="0 0 0"/>');
  });

  it("spins every wheel about Y, which is what makes it a wheel", () => {
    const xml = built(circuit([part("p1", "raspberry-pi-4b")])).xml;
    expect((xml.match(/<axis xyz="0 1 0"\/>/g) ?? []).length).toBe(2);
  });
});

describe("generateUrdf — the sensors the circuit really carries", () => {
  it("mounts a ranger where the user put it, pointing the way that means", () => {
    const result = built(circuit([part("p1", "raspberry-pi-4b"), part("p2", "hc-sr04", "", "front")]));
    expect(result.sensors).toEqual([
      {
        part: "HC-SR04",
        link: "hc_sr04",
        mount: "front",
        sim: "ranger",
        topic: "hc_sr04/range",
        message: "sensor_msgs/msg/Range",
      },
    ]);
    // Front face of a 20 cm body, at half its 6 cm height.
    expect(result.xml).toContain('<origin xyz="0.1 0 0.03" rpy="0 0 0"/>');
    expect(result.xml).toContain('<sensor name="hc_sr04" type="ray">');
    // The datasheet's own span, in metres — never a default.
    expect(result.xml).toContain("<min>0.02</min>");
    expect(result.xml).toContain("<max>4</max>");
  });

  it("turns a side mount so the beam looks out of that side", () => {
    const xml = built(circuit([part("p1", "raspberry-pi-4b"), part("p2", "hc-sr04", "", "left")])).xml;
    expect(xml).toMatch(/<origin xyz="0 0\.075 0\.03" rpy="0 0 1\.5707963\d*"\/>/);
  });

  it("gives an IMU its own sensor type and message, and no range at all", () => {
    const result = built(circuit([part("p1", "raspberry-pi-4b"), part("p2", "mpu6050", "", "top")]));
    expect(result.sensors[0]?.sim).toBe("imu");
    expect(result.sensors[0]?.message).toBe("sensor_msgs/msg/Imu");
    expect(result.xml).toContain('<sensor name="mpu_6050" type="imu">');
    expect(result.xml).not.toContain("<min>");
  });

  it("names a link from the part's own label when it has one", () => {
    const result = built(
      circuit([part("p1", "raspberry-pi-4b"), part("p2", "hc-sr04", "Prednji daljinomer", "front")]),
    );
    expect(result.sensors[0]?.link).toBe("prednji_daljinomer");
    expect(result.sensors[0]?.topic).toBe("prednji_daljinomer/range");
  });

  it("keeps two of the same part apart, because a link name is an identifier", () => {
    const result = built(
      circuit([
        part("p1", "raspberry-pi-4b"),
        part("p2", "hc-sr04", "", "front"),
        part("p3", "hc-sr04", "", "rear"),
      ]),
    );
    expect(result.sensors.map((sensor) => sensor.link)).toEqual(["hc_sr04", "hc_sr04_2"]);
    expect((result.xml.match(/<sensor name="hc_sr04(_2)?" type="ray">/g) ?? []).length).toBe(2);
  });
});

describe("generateUrdf — the sensors it deliberately leaves out", () => {
  it("lists a sensor no physics engine has an equivalent for", () => {
    const result = built(circuit([part("p1", "raspberry-pi-4b"), part("p2", "mq-2", "", "front")]));
    expect(result.sensors).toEqual([]);
    expect(result.skipped).toEqual([{ part: "MQ-2", reason: "no-equivalent" }]);
    expect(result.xml).not.toContain("mq_2");
  });

  it("lists a simulatable sensor the user never mounted, rather than guessing", () => {
    const result = built(circuit([part("p1", "raspberry-pi-4b"), part("p2", "hc-sr04")]));
    expect(result.sensors).toEqual([]);
    expect(result.skipped).toEqual([{ part: "HC-SR04", reason: "no-mount" }]);
  });

  it("says nothing at all about the board, which is not a sensor", () => {
    const result = built(circuit([part("p1", "raspberry-pi-4b")]));
    expect(result.skipped).toEqual([]);
  });

  it("leaves a part this build no longer ships out of both lists", () => {
    const result = built(circuit([part("p1", "raspberry-pi-4b"), part("p9", "dropped-part")]));
    expect(result.sensors).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

describe("generateUrdf — text that came from outside this file", () => {
  it("cannot be made to close an element early with a name full of markup", () => {
    const result = built(
      circuit([part("p1", "raspberry-pi-4b"), part("p2", "hc-sr04", '"><evil/><x a="', "front")]),
    );
    expect(result.xml).not.toContain("<evil/>");
    // The link name is an identifier, so the markup cannot survive into one.
    expect(result.sensors[0]?.link).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("escapes the circuit's name where it appears as XML text", () => {
    const c = { ...circuit([part("p1", "raspberry-pi-4b")]), name: "Rover <b>&" } as Circuit;
    const xml = built(c).xml;
    expect(xml).not.toContain("<b>");
    expect(xml).toContain("&lt;b&gt;&amp;");
  });
});
