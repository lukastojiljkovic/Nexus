/**
 * The machine the circuit sits on, as a robot description — ADR-085 slice E4c.
 *
 * **What this file emits and what it refuses to.** A URDF describes rigid
 * bodies: links, joints, masses, inertias. Almost none of that is in a circuit,
 * so almost none of it is derived here — the chassis comes from
 * {@link Chassis}, which is nine numbers the user typed, and every length and
 * every moment of inertia below is arithmetic ON those numbers. Nothing is
 * defaulted. A simulator treats this file as fact, and a plausible number
 * nobody measured propagates into every result computed from it.
 *
 * **What the CIRCUIT contributes is the sensors, and that is the only reason
 * this belongs to the electronics module at all.** A chassis generator with no
 * circuit attached would be a CAD toy in the wrong app. What makes it Nexus's
 * job is that the parts on the bench are the parts on the robot: an HC-SR04
 * wired to a Pi becomes a `<sensor type="ray">` with the HC-SR04's own datasheet
 * span, mounted where the user said they mounted it.
 *
 * **The sensor topics are deliberately NOT the ROS package's topics.** E4b
 * publishes what a GPIO pin does — a `Bool` per pin, because that is what
 * gpiozero gives you off an HC-SR04's ECHO line. A simulator publishes a
 * `sensor_msgs/Range`, because a physics engine knows the distance directly.
 * Those are different quantities and pretending they are one would be the
 * dishonest move: the generated README says so rather than leaving the reader
 * to discover it when the two disagree.
 *
 * **No `<plugin>` block, on `rosdep`'s reasoning from E4b.** Which plugin
 * bridges an SDF sensor onto a ROS topic depends on the user's Gazebo — Classic
 * wants `gazebo_ros`, modern wants `ros_gz_bridge` — and a wrong one is a
 * description that fails to load rather than one missing a feature. The
 * `<sensor>` element itself is stable across both, so that is what is written,
 * and the README names the bridge.
 */

import { type Chassis, type Mount, mountOrigin } from "./chassis.js";
import type { Circuit } from "./circuit.js";
import type { ComponentDef, SimSensor } from "./component.js";
import { identifier, placedParts, uniqueName } from "./wiring.js";

export type UrdfRefusal = "no-chassis";

/** Why a part on the bench is not on the robot. */
export type UrdfSkip = "no-equivalent" | "no-mount";

export interface UrdfSkipped {
  readonly part: string;
  readonly reason: UrdfSkip;
}

export interface UrdfSensor {
  readonly part: string;
  /** The link it hangs off, and the stem of its topic. A valid identifier. */
  readonly link: string;
  readonly mount: Mount;
  readonly sim: SimSensor;
  readonly topic: string;
  readonly message: string;
}

export type RobotDescription =
  | {
      readonly kind: "urdf";
      readonly xml: string;
      readonly sensors: readonly UrdfSensor[];
      readonly skipped: readonly UrdfSkipped[];
    }
  | { readonly kind: "refused"; readonly reason: UrdfRefusal };

/** The same rate E4b polls an input at — one machine, one story about time. */
const UPDATE_HZ = 10;

const LINK_NAME_LENGTH = 24;

/** What each simulated sensor is called in SDF, and what it publishes in ROS. */
const SENSOR_SDF: Record<SimSensor, { readonly type: string; readonly suffix: string; readonly message: string }> = {
  ranger: { type: "ray", suffix: "range", message: "sensor_msgs/msg/Range" },
  imu: { type: "imu", suffix: "imu", message: "sensor_msgs/msg/Imu" },
  magnetometer: { type: "magnetometer", suffix: "mag", message: "sensor_msgs/msg/MagneticField" },
};

/**
 * Escapes text that came from the user into XML content.
 *
 * Lives here rather than in `ros.ts` because this file's entire output is XML
 * and `package.xml` is the only other tag in the module — one escaper, owned by
 * the generator that cannot work without it, read by the one that has a single
 * line to protect. The dependency runs `ros.ts` → here, which is the same
 * direction as the package that contains this description.
 */
export function xmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A number as XML, without a float's tail and never in exponential notation.
 *
 * `String(0.9 * 0.0261 / 12)` is `0.0019574999999999998`, and `String(1e-7)` is
 * `"1e-7"` — which no URDF parser accepts. Fixing to ten places and trimming
 * the zeros by hand answers both: the rounding is far below any dimension a
 * ruler produced, and the string never leaves decimal notation because it is
 * never handed back to `Number`.
 */
function num(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const trimmed = value.toFixed(10).replace(/\.?0+$/, "");
  return trimmed === "" || trimmed === "-0" ? "0" : trimmed;
}

const m = (cm: number): number => cm / 100;
const kg = (grams: number): number => grams / 1000;

const xyz = (values: readonly [number, number, number]): string => values.map(num).join(" ");

function origin(at: readonly [number, number, number], rpy: readonly [number, number, number]): string {
  return `<origin xyz="${xyz(at)}" rpy="${xyz(rpy)}"/>`;
}

/** A solid box's moments about its own centre: the standard formula, nothing else. */
function boxInertia(mass: number, l: number, w: number, h: number): string {
  return inertiaTag(
    (mass * (w * w + h * h)) / 12,
    (mass * (l * l + h * h)) / 12,
    (mass * (l * l + w * w)) / 12,
  );
}

/**
 * A wheel's moments, about the axis it actually spins on.
 *
 * The cylinder is laid along **Y** — that is what makes it a wheel rather than
 * a roller — so `iyy` is the symmetry-axis term `m r²/2` and the other two are
 * the perpendicular `m(3r² + h²)/12`. Getting this pair the wrong way round is
 * a robot that is hard to turn and easy to tip, which reads as a physics bug
 * rather than as a typo.
 */
function wheelInertia(mass: number, radius: number, length: number): string {
  const perpendicular = (mass * (3 * radius * radius + length * length)) / 12;
  return inertiaTag(perpendicular, (mass * radius * radius) / 2, perpendicular);
}

function sphereInertia(mass: number, radius: number): string {
  const moment = (2 / 5) * mass * radius * radius;
  return inertiaTag(moment, moment, moment);
}

function inertiaTag(ixx: number, iyy: number, izz: number): string {
  return `<inertia ixx="${num(ixx)}" ixy="0" ixz="0" iyy="${num(iyy)}" iyz="0" izz="${num(izz)}"/>`;
}

function inertial(mass: number, moments: string, at: readonly [number, number, number] = [0, 0, 0]): string {
  return [
    `    <inertial>`,
    `      ${origin(at, [0, 0, 0])}`,
    `      <mass value="${num(mass)}"/>`,
    `      ${moments}`,
    `    </inertial>`,
  ].join("\n");
}

/** Visual and collision share one geometry: the shapes here are already the simple ones. */
function body(shape: string, at: readonly [number, number, number] = [0, 0, 0]): string {
  return ["visual", "collision"]
    .map((tag) =>
      [
        `    <${tag}>`,
        `      ${origin(at, [0, 0, 0])}`,
        `      <geometry>${shape}</geometry>`,
        `    </${tag}>`,
      ].join("\n"),
    )
    .join("\n");
}

function link(name: string, contents: readonly string[]): string {
  return [`  <link name="${name}">`, ...contents, `  </link>`].join("\n");
}

function fixedJoint(name: string, parent: string, child: string, at: MountLike): string {
  return [
    `  <joint name="${name}" type="fixed">`,
    `    <parent link="${parent}"/>`,
    `    <child link="${child}"/>`,
    `    ${origin(at.xyz, at.rpy)}`,
    `  </joint>`,
  ].join("\n");
}

interface MountLike {
  readonly xyz: readonly [number, number, number];
  readonly rpy: readonly [number, number, number];
}

/** A wheel is a continuous joint about Y. Nothing else in this file rotates. */
function wheelJoint(name: string, at: readonly [number, number, number]): string {
  return [
    `  <joint name="${name}_joint" type="continuous">`,
    `    <parent link="base_link"/>`,
    `    <child link="${name}"/>`,
    `    ${origin(at, [0, 0, 0])}`,
    `    <axis xyz="0 1 0"/>`,
    `  </joint>`,
  ].join("\n");
}

function wheelLink(name: string, chassis: Chassis): string {
  const radius = m(chassis.wheelRadius);
  const width = m(chassis.wheelWidth);
  // Rolled onto its side: a URDF cylinder stands on Z, and a wheel does not.
  const laid: [number, number, number] = [Math.PI / 2, 0, 0];
  const shape = `<cylinder radius="${num(radius)}" length="${num(width)}"/>`;
  return [
    `  <link name="${name}">`,
    ["visual", "collision"]
      .map((tag) =>
        [
          `    <${tag}>`,
          `      ${origin([0, 0, 0], laid)}`,
          `      <geometry>${shape}</geometry>`,
          `    </${tag}>`,
        ].join("\n"),
      )
      .join("\n"),
    inertial(kg(chassis.wheelMass), wheelInertia(kg(chassis.wheelMass), radius, width)),
    `  </link>`,
  ].join("\n");
}

/** Where each shape's wheels sit: name, then the joint origin in metres. */
function wheelPlan(chassis: Chassis): readonly (readonly [string, [number, number, number]])[] {
  const halfTrack = m(chassis.wheelTrack) / 2;
  const halfBase = m(chassis.wheelBase) / 2;
  if (chassis.shape === "diff-rover") {
    return [
      ["wheel_left", [halfBase, halfTrack, 0]],
      ["wheel_right", [halfBase, -halfTrack, 0]],
    ];
  }
  return [
    ["wheel_front_left", [halfBase, halfTrack, 0]],
    ["wheel_front_right", [halfBase, -halfTrack, 0]],
    ["wheel_rear_left", [-halfBase, halfTrack, 0]],
    ["wheel_rear_right", [-halfBase, -halfTrack, 0]],
  ];
}

/**
 * The caster a differential drive needs in order to stand up.
 *
 * Its radius is DERIVED rather than chosen: the sphere has to reach from the
 * body's underside (z = 0, where `base_link` sits) down to the ground the
 * wheels stand on (z = −wheelRadius), and the only sphere that spans exactly
 * that is one of half the wheel radius centred half a radius down. The single
 * thing here that is not the user's own number is the caster's MASS, which
 * takes the wheel's — a number they typed, applied to the third contact point,
 * and named as such in the generated README.
 */
function caster(chassis: Chassis): readonly string[] {
  const radius = m(chassis.wheelRadius) / 2;
  const at: [number, number, number] = [-m(chassis.wheelBase) / 2, 0, -radius];
  const mass = kg(chassis.wheelMass);
  return [
    link("caster", [body(`<sphere radius="${num(radius)}"/>`), inertial(mass, sphereInertia(mass, radius))]),
    fixedJoint("caster_joint", "base_link", "caster", { xyz: at, rpy: [0, 0, 0] }),
  ];
}

/**
 * The datasheet span rides along on the sensor so `rayBlock` needs no second
 * lookup into the catalogue — and is stripped before the caller sees the list,
 * because it is a fact about the part that the screen reads from the part.
 */
interface UrdfSensorInternal extends UrdfSensor {
  readonly span?: { readonly min: number; readonly max: number };
}

/** A sensor's own link: massless in all but name, because it is a mounting point. */
function sensorLink(sensor: UrdfSensorInternal, chassis: Chassis): readonly string[] {
  const at = mountOrigin(sensor.mount, chassis);
  const sdf = SENSOR_SDF[sensor.sim];
  return [
    link(sensor.link, [
      // A gram, not zero: a link with no inertia at all is one KDL and several
      // solvers refuse to build a tree from, and the mass of an HC-SR04's board
      // is not a number the user was asked for.
      inertial(0.001, inertiaTag(1e-6, 1e-6, 1e-6)),
    ]),
    fixedJoint(`${sensor.link}_joint`, "base_link", sensor.link, at),
    `  <gazebo reference="${sensor.link}">`,
    `    <sensor name="${sensor.link}" type="${sdf.type}">`,
    `      <always_on>true</always_on>`,
    `      <update_rate>${UPDATE_HZ}</update_rate>`,
    `      <topic>${sensor.topic}</topic>`,
    ...rayBlock(sensor),
    `    </sensor>`,
    `  </gazebo>`,
  ];
}

/**
 * A ranger's beam, and its span from the datasheet.
 *
 * One sample rather than a sweep: none of the three rangers this catalogue
 * marks scans, they each report one distance along one axis. `<resolution>` is
 * deliberately absent from `<range>` — it is a measurement none of the three
 * datasheets gives in a form worth transcribing, and SDF's own default is a
 * better answer than a number invented here.
 */
function rayBlock(sensor: UrdfSensorInternal): readonly string[] {
  if (sensor.sim !== "ranger" || sensor.span === undefined) return [];
  return [
    `      <ray>`,
    `        <scan><horizontal><samples>1</samples><resolution>1</resolution>`,
    `          <min_angle>0</min_angle><max_angle>0</max_angle></horizontal></scan>`,
    `        <range><min>${num(m(sensor.span.min))}</min><max>${num(m(sensor.span.max))}</max></range>`,
    `      </ray>`,
  ];
}

/**
 * The robot a circuit and its chassis describe.
 *
 * Refuses when there is no chassis, and that refusal is the honest one: the
 * circuit alone cannot say how big the machine is, and this module would rather
 * ask than invent. Everything else is emitted or explicitly listed as left out.
 */
export function generateUrdf(
  circuit: Circuit,
  resolve: (componentId: string) => ComponentDef | undefined,
): RobotDescription {
  const chassis = circuit.chassis;
  if (chassis === undefined) return { kind: "refused", reason: "no-chassis" };

  const sensors: UrdfSensorInternal[] = [];
  const skipped: UrdfSkipped[] = [];
  const taken = new Set<string>();

  for (const placed of placedParts(circuit, resolve)) {
    if (placed.component.kind !== "sensor") continue;
    const sim = placed.component.simulates;
    if (sim === undefined) {
      skipped.push({ part: placed.name, reason: "no-equivalent" });
      continue;
    }
    const mount = placed.part.mount;
    if (mount === undefined) {
      skipped.push({ part: placed.name, reason: "no-mount" });
      continue;
    }
    const name = uniqueName(identifier(placed.name, "sensor", LINK_NAME_LENGTH), taken);
    sensors.push({
      part: placed.name,
      link: name,
      mount,
      sim,
      topic: `${name}/${SENSOR_SDF[sim].suffix}`,
      message: SENSOR_SDF[sim].message,
      ...(placed.component.simRangeCm === undefined ? {} : { span: placed.component.simRangeCm }),
    });
  }

  const length = m(chassis.bodyLength);
  const width = m(chassis.bodyWidth);
  const height = m(chassis.bodyHeight);
  const mass = kg(chassis.bodyMass);
  // `base_link` sits at the centre of the body's UNDERSIDE, so the box itself is
  // raised half its height — see `mountOrigin`, which reads the same frame.
  const centre: [number, number, number] = [0, 0, height / 2];

  const parts: string[] = [
    `<?xml version="1.0"?>`,
    `<!-- ${xmlText(circuit.name)} — generated by Nexus. Every dimension below came from you. -->`,
    `<robot name="${identifier(circuit.name, "robot", LINK_NAME_LENGTH)}">`,
    link("base_link", [
      body(`<box size="${num(length)} ${num(width)} ${num(height)}"/>`, centre),
      inertial(mass, boxInertia(mass, length, width, height), centre),
    ]),
  ];

  for (const [name, at] of wheelPlan(chassis)) {
    parts.push(wheelLink(name, chassis), wheelJoint(name, at));
  }
  if (chassis.shape === "diff-rover") parts.push(...caster(chassis));
  for (const sensor of sensors) parts.push(...sensorLink(sensor, chassis));

  parts.push(`</robot>`, ``);

  return {
    kind: "urdf",
    xml: parts.join("\n"),
    sensors: sensors.map(({ span: _span, ...rest }) => rest),
    skipped,
  };
}
