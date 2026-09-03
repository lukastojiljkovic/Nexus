/**
 * The ROS 2 package a wired circuit implies — slice E4b of ADR-085.
 *
 * The sibling of `sketch.ts`, and the same honest boundary: it emits the
 * WIRING, never the behaviour. Every board pin a peripheral is really wired to
 * becomes a GPIO device and a topic — an input publishes, an output subscribes
 * — and what the machine DOES with those topics is a decision nobody but the
 * user has made. A generator that wrote the control loop would be handing back
 * a guess with the authority of generated code.
 *
 * **A whole package, or nothing.** The output is the eight files
 * `ros2 pkg create --build-type ament_python` makes, because a half package is
 * worse than none: a `wiring.py` with no `setup.py` cannot be built, and the
 * user is left to write ament boilerplate they came here to avoid. Everything
 * in it that is not derived from the circuit is the standard shape, and the two
 * fields that are genuinely the user's to decide — the licence and the
 * maintainer's address — are placeholders the README points at by name.
 *
 * **gpiozero, and no other driver.** It is the Raspberry Pi platform's own
 * library, present on Raspberry Pi OS, and it works on a Pi 5 where `RPi.GPIO`
 * does not. That makes it the same kind of fact `Wire.h` was for the Arduino
 * sketch. The catalogue's `library` field is NOT reused here: it holds an
 * *Arduino Library Manager* name — „DHT sensor library", „Servo" — and no rule
 * takes you from that string to a Python package. A pin whose part declares one
 * is therefore left alone and listed, exactly as the sketch leaves it alone.
 *
 * **It is not declared as a rosdep dependency, deliberately.** A wrong key in
 * `package.xml` makes `rosdep install --from-paths src` fail for the user's
 * whole workspace, not just for this package. The README gives the apt line
 * instead, which is a fact about Debian rather than a claim about rosdistro.
 */

import type { Circuit } from "./circuit.js";
import type { ComponentDef } from "./component.js";
import type { Mount } from "./chassis.js";
import { generateUrdf, xmlText, type RobotDescription, type UrdfSkip } from "./urdf.js";
import {
  boardWiring,
  identifier,
  pinNumber,
  soleBoard,
  uniqueName,
  type BoardWire,
  type Placed,
} from "./wiring.js";

/** Why a circuit produced no package. Never a failure — see {@link generateRosPackage}. */
export type RosRefusal =
  | "no-board"
  | "many-boards"
  /** The board is programmed as a microcontroller; it does not run ROS 2. */
  | "not-ros";

/** One file of the generated package. */
export interface RosFile {
  /** Relative to the package root, POSIX separators. Never absolute, never `..`. */
  readonly path: string;
  readonly contents: string;
}

/** What a pin became in the node. */
export type RosRole =
  /** `DigitalInputDevice` + a `Bool` publisher, polled. */
  | "input"
  /** `DigitalOutputDevice` + a `Bool` subscription. */
  | "output"
  /** `PWMOutputDevice` + a `Float64` subscription — a duty cycle, not a level. */
  | "pwm";

export interface RosPin {
  /** The board pin's id, as the catalogue spells it: `GPIO23`. */
  readonly boardPin: string;
  readonly part: string;
  readonly partPin: string;
  /** The BCM number gpiozero is constructed with. */
  readonly gpio: number;
  /** Relative to the node — the code prefixes `~/`. */
  readonly topic: string;
  readonly role: RosRole;
  /** `std_msgs/msg/Bool` — how ROS names the type, for a panel that lists it. */
  readonly message: string;
}

/** Why a wire got no device. The first three are `BoardWire.owner` verbatim. */
export type RosSkip =
  | "bus"
  | "library"
  | "shared"
  /** gpiozero reads high and low; an analogue line through it is a coin toss. */
  | "analog"
  /** Nothing about the wire says which way it goes — see `PIN_FLOW`. */
  | "no-direction"
  /** The board pin's id carries no number, so there is no BCM pin to name. */
  | "no-number";

export interface RosSkipped {
  readonly boardPin: string;
  readonly part: string;
  readonly partPin: string;
  readonly reason: RosSkip;
}

export type RosPackage =
  | {
      readonly kind: "package";
      /** `stanica_za_vlaznost` — a valid ROS 2 package name, and the directory's. */
      readonly name: string;
      readonly files: readonly RosFile[];
      /** What the node drives and reads, in board-pin order. */
      readonly pins: readonly RosPin[];
      /** Every wire it deliberately did not, and why. */
      readonly skipped: readonly RosSkipped[];
      /**
       * The machine, when the user has dimensioned one — ADR-085 E4c. A
       * refusal here is not a refusal of the package: the node is about wires
       * and needs no geometry, so this only decides whether `urdf/` exists.
       */
      readonly robot: RobotDescription;
    }
  | { readonly kind: "refused"; readonly reason: RosRefusal };

/**
 * The ROS 2 package for a circuit, or the reason there is not one.
 *
 * Refusing is a first-class answer for the reason `generateSketch` gives: „this
 * circuit has two boards" is a true and useful thing to show, and an exception
 * would leave the panel choosing between nothing and a stack trace.
 */
export function generateRosPackage(
  circuit: Circuit,
  resolve: (componentId: string) => ComponentDef | undefined,
): RosPackage {
  const chosen = soleBoard(circuit, resolve);
  if (chosen.kind === "refused") return { kind: "refused", reason: chosen.reason };

  const { board, placed } = chosen;
  if (board.component.programming !== "linux") return { kind: "refused", reason: "not-ros" };

  const name = identifier(circuit.name, "kolo", PACKAGE_NAME_LENGTH);
  const { pins, skipped } = rosPins(boardWiring(circuit, resolve, placed, board));
  // A refusal here is the ordinary case — most circuits are a breadboard rather
  // than a robot — and it costs the package only its `urdf/` directory.
  const robot = generateUrdf(circuit, resolve);

  return {
    kind: "package",
    name,
    files: renderPackage(name, circuit, board, pins, skipped, robot),
    pins,
    skipped,
    robot,
  };
}

// ---------------------------------------------------------------------------
// From wires to node pins
// ---------------------------------------------------------------------------

/** Long enough for three Serbian words, short enough to stay a directory name. */
const PACKAGE_NAME_LENGTH = 40;

/** The same, for a topic: `senzor_vlaznosti_out` is already at the edge of readable. */
const TOPIC_NAME_LENGTH = 40;

/**
 * Which board pins become devices, and which are left alone with a reason.
 *
 * Exported because the SIMULATOR reads it too (ADR-085 E5): a channel's topic
 * has to be the topic the generated package publishes on, and the only way to
 * guarantee that is for both to come out of this function. A second naming pass
 * would agree today and disagree the first time `TOPIC_NAME_LENGTH` or the
 * uniqueness rule moved — and the user would be looking at a bench readout that
 * names a topic their own node does not have.
 */
export function rosPins(wired: readonly BoardWire[]): {
  pins: RosPin[];
  skipped: RosSkipped[];
} {
  const pins: RosPin[] = [];
  const skipped: RosSkipped[] = [];
  const taken = new Set<string>();

  for (const wire of wired) {
    const where = {
      boardPin: wire.boardPin.id,
      part: wire.partName,
      partPin: wire.partPin.label,
    };
    const reason = skipReason(wire);
    if (reason !== undefined) {
      skipped.push({ ...where, reason });
      continue;
    }

    const gpio = pinNumber(wire.boardPin.id);
    if (gpio === undefined) {
      skipped.push({ ...where, reason: "no-number" });
      continue;
    }

    const role = roleOf(wire);
    pins.push({
      ...where,
      gpio,
      // `relej_in`, not `gpio17`: a topic is read by a person deciding what to
      // publish to, and the board pin is the one fact they can see on the
      // bench. The pin's LABEL where it has one — `partPin.id` is the
      // catalogue's key and is sometimes a bare number.
      topic: uniqueName(
        identifier(
          `${wire.partName} ${wire.partPin.label || wire.partPin.id}`,
          "pin",
          TOPIC_NAME_LENGTH,
        ),
        taken,
      ),
      role,
      message: messageType(role),
    });
  }
  return { pins, skipped };
}

/**
 * Which of the three devices this wire becomes, once it has passed
 * {@link skipReason} and so is known to have a direction the board can act on.
 *
 * `pwm` earns the third only on an OUTPUT: it means the peripheral wants a
 * waveform, which `PWMOutputDevice` supplies as a duty cycle. On an input the
 * word would say the board should measure one, and gpiozero has no such device
 * — see `PIN_FLOW` for why the word alone never implies a direction.
 */
function roleOf(wire: BoardWire): RosRole {
  if (wire.direction === "in") return "input";
  return wire.partPin.functions.includes("pwm") ? "pwm" : "output";
}

/**
 * Why this wire gets no device, or `undefined` where it may have one.
 *
 * The order matters where a wire qualifies twice, and it runs from the most
 * structural reason to the most local: a bus line is a bus line whatever else
 * is true of it, and „nema smera" is only worth saying about a pin nothing else
 * has already claimed.
 */
function skipReason(wire: BoardWire): RosSkip | undefined {
  if (wire.owner !== undefined) return wire.owner;
  // The board would be listening to a voltage, and `DigitalInputDevice` would
  // report it as a true or a false chosen by where the level happened to sit.
  // The rules engine already says this as `analog-signal`; the generator's job
  // is not to repeat the finding, it is not to publish the coin toss.
  if (wire.partPin.functions.includes("analog-out")) return "analog";
  if (wire.direction === undefined) return "no-direction";
  return undefined;
}

// ---------------------------------------------------------------------------
// Escaping — every name below comes from outside this file
// ---------------------------------------------------------------------------

/**
 * A user-supplied name on one line, for a `#` comment or a markdown cell.
 *
 * A part's label is any string up to 120 characters and a circuit's name any
 * string up to 200; a newline in either pushes whatever follows out of the
 * comment it was meant to be in, or out of the table row. Not an attack — it is
 * the user's own bench and their own label — but it produces a file that does
 * not run, from a generator whose whole value is that its output does.
 */
function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ");
}

/**
 * A Python string literal holding arbitrary text.
 *
 * `JSON.stringify` is exactly the right tool and not an approximation: its
 * output escapes the quote, the backslash and every control character, and
 * every escape it can produce — `\"`, `\\`, `\n`, `\r`, `\t`, `\b`, `\f`,
 * `\uXXXX` — means in Python precisely what it means in JSON. The file is UTF-8,
 * which is Python 3's default source encoding, so the non-ASCII it passes
 * through unescaped needs nothing further.
 */
function pyString(text: string): string {
  return JSON.stringify(text);
}

/** Text inside an XML element. The three that must never appear raw. */
// `xmlText` lives in `urdf.ts` — the generator whose whole output is XML — and
// is imported here for the one `<description>` this manifest carries. One
// escaper rather than two: a second copy is a second thing to get right, and
// the copy that is wrong is always the one nobody was looking at.

/**
 * One cell of a markdown table, from a name the user chose.
 *
 * A pipe in a part's label ends the cell and starts another, so „Motor | levi"
 * silently shifts every column after it and the row stops lining up with its
 * header. Backslash is the escape markdown gives for exactly this, and it has
 * to be escaped first or it would escape the escape.
 */
function mdCell(text: string): string {
  return oneLine(text).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Reads per second. Slow enough to watch on `ros2 topic echo`. */
const POLL_HZ = 10;

function renderPackage(
  name: string,
  circuit: Circuit,
  board: Placed,
  pins: readonly RosPin[],
  skipped: readonly RosSkipped[],
  robot: RobotDescription,
): RosFile[] {
  return [
    { path: "package.xml", contents: renderManifest(name, circuit) },
    { path: "setup.py", contents: renderSetup(name, circuit, robot) },
    { path: "setup.cfg", contents: renderSetupCfg(name) },
    // The ament index marker: an empty file whose PATH is the whole content.
    { path: `resource/${name}`, contents: "" },
    { path: `${name}/__init__.py`, contents: "" },
    { path: `${name}/wiring.py`, contents: renderNode(circuit, board, pins) },
    { path: `launch/wiring.launch.py`, contents: renderLaunch(name) },
    // The robot description, when the user has dimensioned a machine — ADR-085
    // E4c. Inside this package rather than beside it, because that is where a
    // ROS 2 developer looks for one and because it makes a single `colcon
    // build` produce the node and the description together.
    ...(robot.kind === "urdf" ? [{ path: `urdf/${name}.urdf`, contents: robot.xml }] : []),
    { path: "README.md", contents: renderReadme(name, circuit, board, pins, skipped, robot) },
  ];
}

function renderManifest(name: string, circuit: Circuit): string {
  return `<?xml version="1.0"?>
<?xml-model href="http://download.ros.org/schema/package_format3.xsd" schematypens="http://www.w3.org/2001/XMLSchema"?>
<package format="3">
  <name>${name}</name>
  <version>0.0.0</version>
  <description>${xmlText(oneLine(circuit.name))}</description>

  <!-- Ime i adresa su ovde da bi paket bio ispravan; upiši svoje. -->
  <maintainer email="nobody@example.invalid">Nexus</maintainer>
  <!-- Nexus ne bira licencu umesto tebe: paket je tvoj. -->
  <license>Proprietary</license>

  <exec_depend>rclpy</exec_depend>
  <exec_depend>std_msgs</exec_depend>
  <exec_depend>launch</exec_depend>
  <exec_depend>launch_ros</exec_depend>

  <export>
    <build_type>ament_python</build_type>
  </export>
</package>
`;
}

function renderSetup(name: string, circuit: Circuit, robot: RobotDescription): string {
  // A data file that is generated but not INSTALLED is one `colcon build`
  // silently leaves in the source tree, so the description has to be listed
  // here or `ros2 launch` cannot find it in `share/`.
  const urdf =
    robot.kind === "urdf"
      ? `\n        ("share/" + package_name + "/urdf", ["urdf/" + package_name + ".urdf"]),`
      : "";
  return `from setuptools import find_packages, setup

package_name = ${pyString(name)}

setup(
    name=package_name,
    version="0.0.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
        ("share/" + package_name + "/launch", ["launch/wiring.launch.py"]),${urdf}
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="Nexus",
    maintainer_email="nobody@example.invalid",
    description=${pyString(oneLine(circuit.name))},
    license="Proprietary",
    entry_points={
        "console_scripts": [
            "wiring = " + package_name + ".wiring:main",
        ],
    },
)
`;
}

function renderSetupCfg(name: string): string {
  return `[develop]
script_dir=$base/lib/${name}

[install]
install_scripts=$base/lib/${name}
`;
}

function renderLaunch(name: string): string {
  return `from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description() -> LaunchDescription:
    return LaunchDescription(
        [
            Node(
                package=${pyString(name)},
                executable="wiring",
                name="wiring",
                output="screen",
            ),
        ]
    )
`;
}

/**
 * The node.
 *
 * Every device is constructed from a declared PARAMETER rather than from a
 * literal, so the bench can be re-pinned from a launch file or the command line
 * without editing generated code — which is the difference between a file the
 * user owns and a file they have to regenerate.
 */
function renderNode(circuit: Circuit, board: Placed, pins: readonly RosPin[]): string {
  const inputs = pins.filter((pin) => pin.role === "input");
  const lines: string[] = [];

  // The circuit's own name goes in a `#` line and never in the docstring
  // below. A comment survives anything but a newline; a triple-quoted string
  // is closed early by a name that happens to contain three quotes.
  lines.push("#!/usr/bin/env python3");
  lines.push(`# ${oneLine(circuit.name)} — ${oneLine(board.component.name)}`);
  lines.push('"""');
  lines.push("Čvor opisuje VEZE, ne ponašanje.");
  lines.push("");
  lines.push("Pinovi i njihovi smerovi izvedeni su iz šeme: ulaz objavljuje temu, izlaz je");
  lines.push("sluša. Šta mašina radi sa tim temama nije izvedeno ni iz čega — to pišeš ti,");
  lines.push("u svom čvoru, koji ove teme čita i piše.");
  lines.push("");
  lines.push("Brojevi pinova su BCM i stoje kao parametri, pa se menjaju bez diranja koda.");
  lines.push('"""');
  lines.push("");
  lines.push("import rclpy");
  for (const line of gpiozeroImport(pins)) lines.push(line);
  lines.push("from rclpy.node import Node");
  for (const line of messageImport(pins)) lines.push(line);
  lines.push("");
  if (inputs.length > 0) {
    lines.push("# Koliko puta u sekundi se ulazi očitavaju.");
    lines.push(`POLL_HZ = ${POLL_HZ}.0`);
    lines.push("");
  }
  lines.push("# Dubina reda, ista za sve teme.");
  lines.push("QUEUE = 10");
  lines.push("");
  lines.push("");
  lines.push("class Wiring(Node):");
  lines.push("    def __init__(self) -> None:");
  lines.push('        super().__init__("wiring")');

  for (const pin of pins) {
    lines.push("");
    lines.push(`        # ${pin.boardPin} → ${oneLine(pin.part)} · ${oneLine(pin.partPin)}`);
    lines.push(`        self.declare_parameter(${pyString(`${pin.topic}_pin`)}, ${pin.gpio})`);
    lines.push(`        self._${pin.topic} = ${DEVICE[pin.role]}(`);
    lines.push(`            self.get_parameter(${pyString(`${pin.topic}_pin`)}).value`);
    lines.push("        )");
    // One argument per line, always. A topic is up to forty characters and the
    // arguments run to four; on one line a long name puts the call past
    // `ament_flake8`'s ninety-nine columns, and the user's own build turns red
    // over a file they did not write.
    if (pin.role === "input") {
      lines.push(`        self._${pin.topic}_pub = self.create_publisher(`);
      lines.push(`            ${MESSAGE[pin.role]},`);
      lines.push(`            ${pyString(`~/${pin.topic}`)},`);
      lines.push("            QUEUE,");
      lines.push("        )");
    } else {
      lines.push("        self.create_subscription(");
      lines.push(`            ${MESSAGE[pin.role]},`);
      lines.push(`            ${pyString(`~/${pin.topic}`)},`);
      lines.push(`            self._on_${pin.topic},`);
      lines.push("            QUEUE,");
      lines.push("        )");
    }
  }

  if (pins.length === 0) {
    lines.push("");
    lines.push("        # Nijedan pin nije izveden — pogledaj README.md.");
  }

  if (inputs.length > 0) {
    lines.push("");
    lines.push("        self.create_timer(1.0 / POLL_HZ, self._read_inputs)");
    lines.push("");
    lines.push("    def _read_inputs(self) -> None:");
    for (const pin of inputs) {
      lines.push(`        self._${pin.topic}_pub.publish(`);
      lines.push(`            Bool(data=bool(self._${pin.topic}.value))`);
      lines.push("        )");
    }
  }

  for (const pin of pins) {
    if (pin.role === "input") continue;
    lines.push("");
    lines.push(`    def _on_${pin.topic}(self, msg: ${MESSAGE[pin.role]}) -> None:`);
    if (pin.role === "pwm") {
      // Clamped rather than passed through: gpiozero raises on a value outside
      // 0–1, and an exception inside a subscription callback takes the whole
      // node down. A publisher that sends 1.5 has made a mistake; a node that
      // dies because of it has made a worse one.
      lines.push(`        self._${pin.topic}.value = min(max(msg.data, 0.0), 1.0)`);
    } else {
      lines.push(`        self._${pin.topic}.value = 1 if msg.data else 0`);
    }
  }

  lines.push("");
  lines.push("");
  lines.push("def main(args=None) -> None:");
  lines.push("    rclpy.init(args=args)");
  lines.push("    node = Wiring()");
  lines.push("    try:");
  lines.push("        rclpy.spin(node)");
  lines.push("    except KeyboardInterrupt:");
  lines.push("        pass");
  lines.push("    finally:");
  lines.push("        node.destroy_node()");
  lines.push("        rclpy.try_shutdown()");
  lines.push("");
  lines.push("");
  lines.push('if __name__ == "__main__":');
  lines.push("    main()");
  lines.push("");

  return lines.join("\n");
}

/** The gpiozero class each role is built from. */
const DEVICE: Record<RosRole, string> = {
  input: "DigitalInputDevice",
  output: "DigitalOutputDevice",
  pwm: "PWMOutputDevice",
};

/** The `std_msgs` CLASS each role's topic carries — what the node imports. */
const MESSAGE: Record<RosRole, string> = {
  input: "Bool",
  output: "Bool",
  pwm: "Float64",
};

/**
 * The same three as ROS spells a type on the wire, in `ros2 topic info` and in
 * the README. Derived from the class rather than written out beside it, so the
 * import and the label can never name different messages — and carried on
 * {@link RosPin} so a panel reads the fact instead of re-deriving it.
 */
function messageType(role: RosRole): string {
  return `std_msgs/msg/${MESSAGE[role]}`;
}

/**
 * Only the classes the node really constructs.
 *
 * An import nothing uses is a lint error in the user's package and, worse, a
 * claim: it says this node talks to hardware it does not touch. A circuit with
 * nothing wired imports no gpiozero at all, and then runs on a machine that
 * does not have it.
 */
function gpiozeroImport(pins: readonly RosPin[]): string[] {
  const used = [...new Set(pins.map((pin) => DEVICE[pin.role]))].sort();
  return used.length === 0 ? [] : [`from gpiozero import ${used.join(", ")}`];
}

/** The same argument, for `std_msgs`, and one line however many types it needs. */
function messageImport(pins: readonly RosPin[]): string[] {
  const used = [...new Set(pins.map((pin) => MESSAGE[pin.role]))].sort();
  return used.length === 0 ? [] : [`from std_msgs.msg import ${used.join(", ")}`];
}

/** Serbian for each reason a pin was left out, for the README's table. */
const SKIP_REASON: Record<RosSkip, string> = {
  bus: "magistrala — vodi je kontroler, ne pojedinačan pin",
  library: "vodi ga drajver komponente, ne ovaj čvor",
  shared: "na liniji je više komponenti, pa nije ničija",
  analog: "analogni signal — gpiozero čita samo visoko i nisko",
  "no-direction": "iz šeme se ne vidi smer",
  "no-number": "pin nema broj, pa nema ni BCM oznaku",
};

/** Serbian for each role, for the same table. */
const ROLE_LABEL: Record<RosRole, string> = {
  input: "ulaz — čvor objavljuje",
  output: "izlaz — čvor sluša",
  pwm: "izlaz (PWM) — čvor sluša",
};

const MOUNT_LABEL: Record<Mount, string> = {
  front: "napred",
  rear: "nazad",
  left: "levo",
  right: "desno",
  top: "gore",
};

const URDF_SKIP_REASON: Record<UrdfSkip, string> = {
  "no-equivalent": "fizika nema šta da simulira umesto njega",
  "no-mount": "nije postavljen ni na jednu stranu mašine",
};

function renderReadme(
  name: string,
  circuit: Circuit,
  board: Placed,
  pins: readonly RosPin[],
  skipped: readonly RosSkipped[],
  robot: RobotDescription,
): string {
  const lines: string[] = [];
  lines.push(`# ${oneLine(circuit.name)}`);
  lines.push("");
  lines.push(`ROS 2 paket izveden iz šeme, za ploču **${oneLine(board.component.name)}**.`);
  lines.push("");
  lines.push("Paket opisuje **veze**, ne ponašanje. Svaki pin koji je u šemi zaista");
  lines.push("povezan dobio je uređaj i temu; šta mašina radi sa tim temama pišeš ti, u");
  lines.push("svom čvoru koji ih čita i piše.");
  lines.push("");

  lines.push("## Teme");
  lines.push("");
  if (pins.length === 0) {
    lines.push("Nijedna — pogledaj tabelu ispod.");
  } else {
    lines.push("| Tema | Poruka | Uloga | Pin | Komponenta |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const pin of pins) {
      const target = `${mdCell(pin.part)} · ${mdCell(pin.partPin)}`;
      lines.push(
        `| \`~/${pin.topic}\` | \`${pin.message}\` | ${ROLE_LABEL[pin.role]}` +
          ` | BCM ${pin.gpio} | ${target} |`,
      );
    }
  }
  lines.push("");

  if (skipped.length > 0) {
    lines.push("## Šta nije izvedeno");
    lines.push("");
    lines.push("Ove veze postoje u šemi, ali čvor ih ne dira — svaka bi tražila kod koji");
    lines.push("se iz šeme ne može izvesti.");
    lines.push("");
    lines.push("| Pin | Komponenta | Razlog |");
    lines.push("| --- | --- | --- |");
    for (const entry of skipped) {
      const target = `${mdCell(entry.part)} · ${mdCell(entry.partPin)}`;
      lines.push(`| ${entry.boardPin} | ${target} | ${SKIP_REASON[entry.reason]} |`);
    }
    lines.push("");
  }

  if (robot.kind === "urdf") {
    lines.push("## Mašina — `urdf/" + name + ".urdf`");
    lines.push("");
    lines.push("Opis mašine izveden iz dimenzija koje uneseš u Nexusu. Svaka mera dole je");
    lines.push("tvoja; nijedna nije pretpostavljena. Masa kastera je jedini izuzetak —");
    lines.push("uzima masu točka, jer diferencijalni pogon bez treće tačke oslonca ne");
    lines.push("stoji, a ta masa se ne pita posebno.");
    lines.push("");
    if (robot.sensors.length > 0) {
      lines.push("| Senzor | Mesto | Tema u simulaciji | Poruka |");
      lines.push("| --- | --- | --- | --- |");
      for (const sensor of robot.sensors) {
        lines.push(
          `| ${mdCell(sensor.part)} | ${MOUNT_LABEL[sensor.mount]}` +
            ` | \`${sensor.topic}\` | \`${sensor.message}\` |`,
        );
      }
      lines.push("");
      lines.push("**Ove teme nisu teme čvora iznad, i to je namerno.** Čvor objavljuje ono");
      lines.push("što GPIO pin daje — `Bool` po pinu, jer to je ono što gpiozero pročita sa");
      lines.push("ECHO linije. Simulacija objavljuje `sensor_msgs/Range`, jer fizika zna");
      lines.push("rastojanje direktno. To su različite veličine i spajanje bi bilo laž.");
      lines.push("");
    }
    if (robot.skipped.length > 0) {
      lines.push("Senzori koji nisu u opisu:");
      lines.push("");
      for (const entry of robot.skipped) {
        lines.push(`- ${mdCell(entry.part)} — ${URDF_SKIP_REASON[entry.reason]}`);
      }
      lines.push("");
    }
    lines.push("`<sensor>` je tu, `<plugin>` namerno nije: koji plugin spaja senzor na ROS");
    lines.push("temu zavisi od tvog Gazeba (`gazebo_ros` za Classic, `ros_gz_bridge` za");
    lines.push("novi), a pogrešan se ne učitava uopšte. Provera opisa:");
    lines.push("");
    lines.push("```sh");
    lines.push(`check_urdf install/${name}/share/${name}/urdf/${name}.urdf`);
    lines.push("```");
    lines.push("");
  }

  lines.push("## Pokretanje");
  lines.push("");
  lines.push("```sh");
  lines.push("# gpiozero je već na Raspberry Pi OS-u; ako nije:");
  lines.push("sudo apt install python3-gpiozero");
  lines.push("");
  lines.push(`colcon build --packages-select ${name}`);
  lines.push("source install/setup.bash");
  lines.push(`ros2 launch ${name} wiring.launch.py`);
  lines.push("```");
  lines.push("");
  lines.push("Brojevi pinova su parametri, pa se menjaju bez diranja koda:");
  lines.push("");
  lines.push("```sh");
  const example = pins[0];
  lines.push(
    example === undefined
      ? "ros2 param list /wiring"
      : `ros2 run ${name} wiring --ros-args -p ${example.topic}_pin:=${example.gpio}`,
  );
  lines.push("```");
  lines.push("");

  lines.push("## Pre nego što ga podeliš");
  lines.push("");
  lines.push("Dva polja u `package.xml` i `setup.py` su namerno ostavljena da ih popuniš:");
  lines.push("`maintainer` (ime i adresa) i `license`. Nexus ne bira licencu umesto tebe.");
  lines.push("");

  return lines.join("\n");
}
