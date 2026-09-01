/**
 * Which artefact a circuit implies — the front door to ADR-085's slice E4.
 *
 * Two generators, and the board decides between them: a microcontroller gets an
 * Arduino sketch, a single-board computer gets a ROS 2 package. This module is
 * forty lines because the decision is one field, `ComponentDef.programming`,
 * and the whole value of putting it here is that **the app never chooses**. A
 * screen that called `generateSketch` directly would be a screen that had
 * decided a Raspberry Pi gets a `.ino`, and that is a choice about hardware
 * being made in a React component.
 *
 * It also makes the third refusal honest. `generateSketch` says
 * `not-programmable` about anything that is not an Arduino, which was true when
 * it was the only generator and became a lie the moment there were two. Through
 * this door the reason means what it says — the board declares no toolchain at
 * all — and a Pi is routed rather than refused.
 */

import type { Circuit } from "./circuit.js";
import type { ComponentDef } from "./component.js";
import { generateRosPackage, type RosPackage, type RosRefusal } from "./ros.js";
import { generateSketch, type Sketch, type SketchRefusal } from "./sketch.js";
import { soleBoard } from "./wiring.js";

/**
 * Whatever E4 produced. Discriminated on `kind`, which is `"sketch"`,
 * `"package"` or `"refused"` — so a screen that forgets one is a type error
 * rather than a blank panel.
 */
export type GeneratedCode = Sketch | RosPackage;

/**
 * Why there is no code. The two generators' refusals in one union, so a screen
 * can hold ONE total table of Serbian for them — `Record<CodeRefusal, string>`
 * is then a compile error when a seventh reason appears, which a hand-kept map
 * over „whatever `generateCode` happens to return" would never be.
 */
export type CodeRefusal = SketchRefusal | RosRefusal;

export function generateCode(
  circuit: Circuit,
  resolve: (componentId: string) => ComponentDef | undefined,
): GeneratedCode {
  const chosen = soleBoard(circuit, resolve);
  if (chosen.kind === "refused") return { kind: "refused", reason: chosen.reason };

  switch (chosen.board.component.programming) {
    case "arduino":
      return generateSketch(circuit, resolve);
    case "linux":
      return generateRosPackage(circuit, resolve);
    // A board that names no toolchain. The catalogue gate rejects one of those,
    // so in a shipped build this is a component the user wrote themselves —
    // which is exactly the case where guessing would be worst.
    default:
      return { kind: "refused", reason: "not-programmable" };
  }
}
