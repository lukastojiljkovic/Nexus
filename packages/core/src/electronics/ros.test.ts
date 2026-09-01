// Fixtures written out by hand rather than pulled from the catalogue — the rule
// `circuit.test.ts` states and `sketch.test.ts` follows. A generator tested
// against the catalogue's own entries follows the catalogue wherever it moves
// and can never disagree with it.
//
// The assertions are about the SHAPE of the output — that a publisher exists,
// that a device is constructed from a parameter — rather than about the exact
// text of eight files. A snapshot would fail on a comma in a comment and would
// teach nobody which rule broke.

import { describe, expect, it } from "vitest";

import type { ComponentDef } from "./component.js";
import type { Circuit, CircuitPart, CircuitWire } from "./circuit.js";
import { generateRosPackage, type RosPackage } from "./ros.js";

const pi: ComponentDef = {
  id: "raspberry-pi-4b",
  kind: "board",
  name: "Raspberry Pi 4 Model B",
  summary: "Računar sa Linuxom.",
  supply: { min: 5, max: 5.1 },
  current: { typical: 600, peak: 3000 },
  logicVolts: 3.3,
  programming: "linux",
  buses: [{ kind: "i2c", addresses: [] }],
  pins: [
    { id: "5V", label: "5V", functions: ["power-out"], volts: 5 },
    { id: "GND1", label: "GND", functions: ["gnd"] },
    { id: "GPIO2", label: "GPIO2", functions: ["digital-in", "digital-out", "i2c-sda"] },
    { id: "GPIO3", label: "GPIO3", functions: ["digital-in", "digital-out", "i2c-scl"] },
    { id: "GPIO17", label: "GPIO17", functions: ["digital-in", "digital-out"], volts: 3.3 },
    { id: "GPIO18", label: "GPIO18", functions: ["digital-in", "digital-out", "pwm"], volts: 3.3 },
    { id: "GPIO23", label: "GPIO23", functions: ["digital-in", "digital-out"], volts: 3.3 },
    // A hand-written board may spell a pin anything at all, and gpiozero takes
    // a BCM number rather than a token.
    { id: "AUX", label: "AUX", functions: ["digital-in", "digital-out"], volts: 3.3 },
  ],
};

/** A microcontroller: same pins, wrong artefact. The reason `programming` exists. */
const uno: ComponentDef = {
  id: "arduino-uno",
  kind: "board",
  name: "Arduino UNO R3",
  summary: "Osnovna ploča.",
  supply: { min: 7, max: 12 },
  current: { typical: 45, peak: 200 },
  logicVolts: 5,
  programming: "arduino",
  buses: [],
  pins: [
    { id: "GND1", label: "GND", functions: ["gnd"] },
    { id: "D9", label: "9", functions: ["digital-in", "digital-out"], volts: 5 },
  ],
};

/** Drives a line; the board listens. */
const button: ComponentDef = {
  id: "button",
  kind: "sensor",
  name: "Taster",
  summary: "Prekidač.",
  buses: [],
  pins: [
    { id: "OUT", label: "OUT", functions: ["digital-out"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
  ],
};

/** Listens; the board drives. */
const relay: ComponentDef = {
  id: "relay",
  kind: "actuator",
  name: "Relej",
  summary: "Prekidač na struju.",
  buses: [],
  pins: [
    { id: "IN", label: "IN", functions: ["digital-in"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
  ],
};

/** An enable pin that wants a waveform — a duty cycle, not a level. */
const motorDriver: ComponentDef = {
  id: "l298n",
  kind: "driver",
  name: "L298N",
  summary: "Drajver za dva motora.",
  buses: [],
  pins: [
    { id: "ENA", label: "ENA", functions: ["digital-in", "pwm"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
  ],
};

const lm35: ComponentDef = {
  id: "lm35",
  kind: "sensor",
  name: "Analogni termometar",
  summary: "Napon srazmeran temperaturi.",
  buses: [],
  pins: [
    { id: "OUT", label: "OUT", functions: ["analog-out"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
  ],
};

/** Its DATA line is a timed protocol, and the library that owns it is Arduino's. */
const dht22: ComponentDef = {
  id: "dht22",
  kind: "sensor",
  name: "DHT22",
  summary: "Temperatura i vlažnost.",
  library: "DHT sensor library",
  buses: [],
  pins: [
    { id: "DATA", label: "DATA", functions: ["digital-in", "digital-out"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
  ],
};

const bmp280: ComponentDef = {
  id: "bmp280",
  kind: "sensor",
  name: "BMP280",
  summary: "Pritisak.",
  buses: [{ kind: "i2c", addresses: [0x76] }],
  pins: [
    { id: "SDA", label: "SDA", functions: ["i2c-sda"] },
    { id: "SCL", label: "SCL", functions: ["i2c-scl"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
  ],
};

/** Neither drives nor listens: `pwm` alone says only what the wire carries. */
const undirected: ComponentDef = {
  id: "modulator",
  kind: "driver",
  name: "Modulator",
  summary: "Ulaz bez smera.",
  buses: [],
  pins: [
    { id: "SIG", label: "SIG", functions: ["pwm"] },
    { id: "GND", label: "GND", functions: ["gnd"] },
  ],
};

const shipped = new Map(
  [pi, uno, button, relay, motorDriver, lm35, dht22, bmp280, undirected].map((component) => [
    component.id,
    component,
  ]),
);
const resolve = (id: string): ComponentDef | undefined => shipped.get(id);

const part = (id: string, componentId: string, label = ""): CircuitPart => ({
  id,
  circuitId: "c1",
  componentId,
  label,
  x: 0,
  y: 0,
  rotation: 0,
});

let wireCount = 0;
const w = (from: [string, string], to: [string, string]): CircuitWire => ({
  id: `w${(wireCount += 1)}`,
  circuitId: "c1",
  from: { partId: from[0], pinId: from[1] },
  to: { partId: to[0], pinId: to[1] },
  colour: "red",
});

const circuit = (
  parts: readonly CircuitPart[],
  wires: readonly CircuitWire[],
  name = "Merenje razdaljine",
): Circuit => ({
  id: "c1",
  name,
  notes: "",
  parts,
  wires,
});

/** The generated package, or a failure that names what came back instead. */
function packageOf(c: Circuit): Extract<RosPackage, { kind: "package" }> {
  const result = generateRosPackage(c, resolve);
  if (result.kind !== "package") throw new Error(`refused: ${result.reason}`);
  return result;
}

/** One file's contents by path, or a failure that names the path. */
function fileOf(c: Circuit, path: string): string {
  const found = packageOf(c).files.find((file) => file.path === path);
  if (found === undefined) throw new Error(`no such file: ${path}`);
  return found.contents;
}

function nodeOf(c: Circuit): string {
  return fileOf(c, `${packageOf(c).name}/wiring.py`);
}

describe("generateRosPackage — when there is no package to give", () => {
  it("refuses a circuit with no board", () => {
    const result = generateRosPackage(circuit([part("p1", "button")], []), resolve);
    expect(result).toEqual({ kind: "refused", reason: "no-board" });
  });

  it("refuses two boards, because a package is one node for one of them", () => {
    const c = circuit([part("p1", "raspberry-pi-4b"), part("p2", "raspberry-pi-4b")], []);
    expect(generateRosPackage(c, resolve)).toEqual({ kind: "refused", reason: "many-boards" });
  });

  it("refuses a microcontroller, which does not run ROS 2", () => {
    const c = circuit([part("p1", "arduino-uno"), part("p2", "button")], [w(["p1", "D9"], ["p2", "OUT"])]);
    expect(generateRosPackage(c, resolve)).toEqual({ kind: "refused", reason: "not-ros" });
  });

  it("says nothing about a part whose component this build does not ship", () => {
    const c = circuit([part("p1", "raspberry-pi-4b"), part("p2", "iz-buducnosti")], []);
    expect(packageOf(c).pins).toEqual([]);
  });
});

describe("generateRosPackage — the package around the node", () => {
  it("names the package after the circuit, as a valid ROS 2 name", () => {
    const c = circuit([part("p1", "raspberry-pi-4b")], [], "Stanica za vlažnost");
    expect(packageOf(c).name).toBe("stanica_za_vlaznost");
    expect(packageOf(c).name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("falls back to a name rather than producing a package with none", () => {
    const c = circuit([part("p1", "raspberry-pi-4b")], [], "«»");
    expect(packageOf(c).name).toBe("kolo");
  });

  it("emits every file colcon needs, and nothing outside the package", () => {
    const c = circuit([part("p1", "raspberry-pi-4b")], []);
    const paths = packageOf(c).files.map((file) => file.path);
    expect(paths).toEqual([
      "package.xml",
      "setup.py",
      "setup.cfg",
      "resource/merenje_razdaljine",
      "merenje_razdaljine/__init__.py",
      "merenje_razdaljine/wiring.py",
      "launch/wiring.launch.py",
      "README.md",
    ]);
    // Every path is relative, POSIX and inside the package. The main process
    // joins these onto a directory the user picked in a native dialog, so a
    // `..` here would be this module choosing where to write on their disk.
    for (const path of paths) {
      expect(path).not.toMatch(/^[/\\]|^[A-Za-z]:|\\|(^|\/)\.\.(\/|$)/);
    }
  });

  it("declares the ament build type and the runtime it really imports", () => {
    const manifest = fileOf(circuit([part("p1", "raspberry-pi-4b")], []), "package.xml");
    expect(manifest).toContain("<build_type>ament_python</build_type>");
    expect(manifest).toContain("<exec_depend>rclpy</exec_depend>");
    expect(manifest).toContain("<exec_depend>std_msgs</exec_depend>");
  });

  it("points setup.py at the node, so `ros2 run` finds it", () => {
    const setup = fileOf(circuit([part("p1", "raspberry-pi-4b")], []), "setup.py");
    expect(setup).toContain('package_name = "merenje_razdaljine"');
    expect(setup).toContain('"wiring = " + package_name + ".wiring:main"');
  });

  it("leaves the licence and the maintainer for the user, and says so", () => {
    const c = circuit([part("p1", "raspberry-pi-4b")], []);
    expect(fileOf(c, "package.xml")).toContain("nobody@example.invalid");
    expect(fileOf(c, "README.md")).toContain("Nexus ne bira licencu umesto tebe");
  });
});

describe("generateRosPackage — the pins it drives and reads", () => {
  it("publishes a pin the board listens to, on a timer", () => {
    const c = circuit(
      [part("p1", "raspberry-pi-4b"), part("p2", "button")],
      [w(["p1", "GPIO23"], ["p2", "OUT"])],
    );
    expect(packageOf(c).pins).toEqual([
      {
        boardPin: "GPIO23",
        part: "Taster",
        partPin: "OUT",
        gpio: 23,
        topic: "taster_out",
        role: "input",
        message: "std_msgs/msg/Bool",
      },
    ]);
    const node = nodeOf(c);
    expect(node).toContain("from gpiozero import DigitalInputDevice");
    expect(node).toContain('self.declare_parameter("taster_out_pin", 23)');
    expect(node).toContain("self._taster_out = DigitalInputDevice(");
    expect(node).toContain("self._taster_out_pub = self.create_publisher(");
    expect(node).toContain('"~/taster_out",');
    expect(node).toContain("self.create_timer(1.0 / POLL_HZ, self._read_inputs)");
  });

  it("subscribes a pin the board drives, and drives nothing on its own", () => {
    const c = circuit(
      [part("p1", "raspberry-pi-4b"), part("p2", "relay")],
      [w(["p1", "GPIO17"], ["p2", "IN"])],
    );
    expect(packageOf(c).pins[0]?.role).toBe("output");
    const node = nodeOf(c);
    expect(node).toContain("from gpiozero import DigitalOutputDevice");
    expect(node).toContain("self.create_subscription(");
    expect(node).toContain("def _on_relej_in(self, msg: Bool) -> None:");
    expect(node).toContain("self._relej_in.value = 1 if msg.data else 0");
    // Nothing is written at construction, and there is no timer with no input
    // to read: a relay closed by a node nobody wrote is a machine acting for no
    // reason, and that is the one thing this generator must never do.
    expect(node).not.toContain("create_timer");
    expect(node).not.toContain(".on()");
  });

  it("gives a pin that wants a waveform a duty cycle rather than a level", () => {
    const c = circuit(
      [part("p1", "raspberry-pi-4b"), part("p2", "l298n")],
      [w(["p1", "GPIO18"], ["p2", "ENA"])],
    );
    expect(packageOf(c).pins[0]?.role).toBe("pwm");
    const node = nodeOf(c);
    expect(node).toContain("from gpiozero import PWMOutputDevice");
    expect(node).toContain("from std_msgs.msg import Float64");
    expect(node).toContain("def _on_l298n_ena(self, msg: Float64) -> None:");
    // Clamped, not passed through: gpiozero raises outside 0–1, and an
    // exception in a subscription callback takes the whole node down.
    expect(node).toContain("min(max(msg.data, 0.0), 1.0)");
  });

  it("imports only the device classes it constructs", () => {
    const c = circuit(
      [part("p1", "raspberry-pi-4b"), part("p2", "button")],
      [w(["p1", "GPIO23"], ["p2", "OUT"])],
    );
    const node = nodeOf(c);
    expect(node).toContain("from gpiozero import DigitalInputDevice\n");
    expect(node).not.toContain("DigitalOutputDevice");
    expect(node).not.toContain("PWMOutputDevice");
    expect(node).not.toContain("Float64");
  });

  it("imports no gpiozero at all for a board with nothing wired to it", () => {
    const node = nodeOf(circuit([part("p1", "raspberry-pi-4b")], []));
    expect(node).not.toContain("gpiozero");
    expect(node).toContain("Nijedan pin nije izveden");
    // Still a node, and still one that spins.
    expect(node).toContain("rclpy.spin(node)");
  });

  it("never names two topics the same, so two unlabelled parts still run", () => {
    const c = circuit(
      [part("p1", "raspberry-pi-4b"), part("p2", "button"), part("p3", "button")],
      [w(["p1", "GPIO17"], ["p2", "OUT"]), w(["p1", "GPIO23"], ["p3", "OUT"])],
    );
    const topics = packageOf(c).pins.map((pin) => pin.topic);
    expect(topics).toEqual(["taster_out", "taster_out_2"]);
  });

  it("takes the user's own label over the catalogue's name", () => {
    const c = circuit(
      [part("p1", "raspberry-pi-4b"), part("p2", "button", "Prekidač svetla")],
      [w(["p1", "GPIO23"], ["p2", "OUT"])],
    );
    expect(packageOf(c).pins[0]?.topic).toBe("prekidac_svetla_out");
  });
});

describe("generateRosPackage — the pins it deliberately leaves alone", () => {
  const skipOf = (c: Circuit): string[] => packageOf(c).skipped.map((entry) => entry.reason);

  it("leaves a bus line to its controller", () => {
    const c = circuit(
      [part("p1", "raspberry-pi-4b"), part("p2", "bmp280")],
      [w(["p1", "GPIO2"], ["p2", "SDA"]), w(["p1", "GPIO3"], ["p2", "SCL"])],
    );
    expect(skipOf(c)).toEqual(["bus", "bus"]);
    expect(packageOf(c).pins).toEqual([]);
    expect(fileOf(c, "README.md")).toContain("magistrala");
  });

  it("leaves a pin whose part declares a driver library", () => {
    // The catalogue's `library` is an Arduino Library Manager name and there is
    // no rule taking it to a Python package. Left alone and listed, rather than
    // guessed at.
    const c = circuit(
      [part("p1", "raspberry-pi-4b"), part("p2", "dht22")],
      [w(["p1", "GPIO23"], ["p2", "DATA"])],
    );
    expect(skipOf(c)).toEqual(["library"]);
    expect(nodeOf(c)).not.toContain("gpiozero");
  });

  it("leaves a line more than one part sits on", () => {
    const c = circuit(
      [part("p1", "raspberry-pi-4b"), part("p2", "relay"), part("p3", "relay")],
      [w(["p1", "GPIO17"], ["p2", "IN"]), w(["p1", "GPIO17"], ["p3", "IN"])],
    );
    expect(skipOf(c)).toEqual(["shared", "shared"]);
  });

  it("publishes no coin toss for an analogue signal", () => {
    const c = circuit(
      [part("p1", "raspberry-pi-4b"), part("p2", "lm35")],
      [w(["p1", "GPIO23"], ["p2", "OUT"])],
    );
    expect(skipOf(c)).toEqual(["analog"]);
    expect(fileOf(c, "README.md")).toContain("gpiozero čita samo visoko i nisko");
  });

  it("leaves a pin the schematic gives no direction", () => {
    const c = circuit(
      [part("p1", "raspberry-pi-4b"), part("p2", "modulator")],
      [w(["p1", "GPIO23"], ["p2", "SIG"])],
    );
    expect(skipOf(c)).toEqual(["no-direction"]);
  });

  it("leaves a board pin whose id carries no number to be BCM", () => {
    const c = circuit(
      [part("p1", "raspberry-pi-4b"), part("p2", "button")],
      [w(["p1", "AUX"], ["p2", "OUT"])],
    );
    expect(skipOf(c)).toEqual(["no-number"]);
  });

  it("names no power or ground pin at all", () => {
    const c = circuit(
      [part("p1", "raspberry-pi-4b"), part("p2", "relay")],
      [w(["p1", "5V"], ["p2", "IN"]), w(["p1", "GND1"], ["p2", "GND"])],
    );
    expect(packageOf(c).pins).toEqual([]);
    expect(packageOf(c).skipped).toEqual([]);
  });
});

describe("generateRosPackage — text that came from outside this file", () => {
  it("cannot be made to end the node's header comment", () => {
    const c = circuit([part("p1", "raspberry-pi-4b")], [], "Prvi red\nprint('drugi red')");
    const node = nodeOf(c);
    const header = node.split("\n").find((line) => line.startsWith("# Prvi red"));
    expect(header).toContain("print('drugi red')");
    expect(node).not.toContain("\nprint(");
  });

  it("cannot be made to close the manifest's description", () => {
    const c = circuit([part("p1", "raspberry-pi-4b")], [], "Kolo & <takav>");
    expect(fileOf(c, "package.xml")).toContain(
      "<description>Kolo &amp; &lt;takav&gt;</description>",
    );
  });

  it("cannot be made to close a Python string literal", () => {
    // `setup.py` is executed by colcon. A quote or a backslash in the circuit's
    // name, interpolated raw, is a package that cannot be built at all.
    const c = circuit([part("p1", "raspberry-pi-4b")], [], 'Kolo "sa navodnikom" \\ i kosom');
    const setup = fileOf(c, "setup.py");
    expect(setup).toContain(
      'description="Kolo \\"sa navodnikom\\" \\\\ i kosom"',
    );
  });

  it("cannot be made to break the README's table", () => {
    const c = circuit(
      [part("p1", "raspberry-pi-4b"), part("p2", "button", "Gore\nDole")],
      [w(["p1", "GPIO23"], ["p2", "OUT"])],
    );
    const rows = fileOf(c, "README.md")
      .split("\n")
      .filter((line) => line.startsWith("| `~/"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("Gore Dole");
  });

  /**
   * The other way to break a table, and the one a newline check misses: a pipe
   * ends the cell and starts another, so „Motor | levi" shifts every column
   * after it and the row stops lining up with its header. One row, five cells,
   * whatever the user called the part.
   */
  it("cannot be made to shift the README's columns with a pipe", () => {
    const c = circuit(
      [part("p1", "raspberry-pi-4b"), part("p2", "button", "Motor | levi")],
      [w(["p1", "GPIO23"], ["p2", "OUT"])],
    );
    const rows = fileOf(c, "README.md")
      .split("\n")
      .filter((line) => line.startsWith("| `~/"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("Motor \\| levi");
    // Five columns and no more: the leading and trailing pipes bound four gaps
    // plus the two ends, so an escaped cell must not add a sixth.
    expect(rows[0]?.split(/(?<!\\)\|/)).toHaveLength(7);
  });
});

describe("generateRosPackage — the node as a whole", () => {
  const wired = (): Circuit =>
    circuit(
      [
        part("p1", "raspberry-pi-4b"),
        part("p2", "button"),
        part("p3", "relay"),
        part("p4", "l298n"),
      ],
      [
        w(["p1", "GPIO23"], ["p2", "OUT"]),
        w(["p1", "GPIO17"], ["p3", "IN"]),
        w(["p1", "GPIO18"], ["p4", "ENA"]),
      ],
    );

  it("reads down the board in the catalogue's own pin order", () => {
    expect(packageOf(wired()).pins.map((pin) => pin.boardPin)).toEqual([
      "GPIO17",
      "GPIO18",
      "GPIO23",
    ]);
  });

  it("constructs every device from a parameter, never from a literal", () => {
    const node = nodeOf(wired());
    for (const topic of ["relej_in", "l298n_ena", "taster_out"]) {
      expect(node).toContain(`self.get_parameter("${topic}_pin").value`);
    }
  });

  it("keeps every emitted line inside ament_flake8's ninety-nine columns", () => {
    // The user's own `colcon test` runs the linter over a file they did not
    // write, and a forty-character topic name is enough to push a call past it.
    const long = circuit(
      [part("p1", "raspberry-pi-4b"), part("p2", "button", "Prekidač za svetlo u hodniku gore")],
      [w(["p1", "GPIO23"], ["p2", "OUT"])],
    );
    for (const file of packageOf(long).files) {
      if (!file.path.endsWith(".py")) continue;
      for (const line of file.contents.split("\n")) {
        expect(line.length).toBeLessThanOrEqual(99);
      }
    }
  });

  it("ends every source file with a newline, as a source file does", () => {
    for (const file of packageOf(wired()).files) {
      if (file.contents === "") continue;
      expect(file.contents.endsWith("\n")).toBe(true);
    }
  });
});
