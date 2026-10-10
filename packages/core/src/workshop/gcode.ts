/**
 * G-code, as Marlin and RepRap printers write it, read from untrusted bytes.
 *
 * **What this parses.** The common subset both flavours agree on, and nothing
 * beyond it: `G0`/`G1` linear moves, `G2`/`G3` arcs (both the `I`/`J` and the
 * `R` spelling), `G20`/`G21` units, `G90`/`G91` positioning, `M82`/`M83`
 * extrusion, `F` feed rates and `E` extrusion. Anything else a file contains -
 * temperatures, fans, `M104` - is skipped rather than guessed at, which is the
 * reason the subset is stated: a viewer that invented a behaviour for a command
 * it did not know would draw a toolpath nobody cut.
 *
 * **Layers come from Z, not from slicer comments.** Marlin jobs carry
 * `;LAYER_CHANGE` markers and RepRap jobs `;LAYER:`, but a hand-written file
 * carries neither, and the Z a move is at is the fact all three share. A layer
 * is therefore a Z at which moves happen, quantised to a micrometre so two
 * spellings of one height are one layer.
 *
 * **The print-time estimate, and exactly what it models.** Time is the
 * commanded travel of each segment divided by the feed rate in force when it was
 * issued - `length / feed`. It deliberately models NOTHING else, and that is why
 * it differs from the slicer's figure:
 *
 *  - no acceleration or jerk, so a printer that spends the first and last
 *    millimetre of every short segment ramping up takes longer than this says;
 *  - no firmware look-ahead limits, which cap the feed on tight geometry;
 *  - no per-move overhead, which a slicer's estimate usually carries a constant
 *    for and this one carries none;
 *  - a move with no `F` at all has no feed rate to divide by, and its time is
 *    left out with a `missing-feed` warning rather than being invented.
 *
 * So the figure is a lower bound in practice. The page says so in as many words
 * rather than presenting it as a promise.
 *
 * **Filament length is the sum of the positive `E` deltas.** Retractions move
 * filament backwards and are therefore not part of what the print consumed,
 * which is the meaning a slicer's own "filament used" line has. In `M83` mode
 * each `E` is already a delta and is used as one.
 */

/** Largest G-code this module reads, in bytes (32 MiB: a very large one-piece print). */
export const GCODE_MAX_BYTES = 32 * 1024 * 1024;

/** Longest G-code this module reads, in lines. */
export const GCODE_MAX_LINES = 2_000_000;

/** Largest number of toolpath segments this module emits, across every layer. */
export const GCODE_MAX_SEGMENTS = 2_000_000;

/** How many straight segments one full turn of an arc becomes, so a curve is drawn as a curve. */
export const GCODE_ARC_SEGMENTS_PER_TURN = 64;

/** How many warning kinds the page is given, however many a file produced. */
export const GCODE_MAX_WARNINGS = 8;

/** Millimetres in one inch, the exact definition. */
const MM_PER_INCH = 25.4;

/** How a Z is quantised into a layer: one micrometre, below any printer's own resolution. */
const Z_LAYER_DECIMALS = 3;

/** Why a G-code file was refused. A code, so the page words it in the reader's language. */
export type GcodeProblem = "too-large" | "empty" | "not-gcode";

export class GcodeParseError extends Error {
  readonly problem: GcodeProblem;

  constructor(problem: GcodeProblem, message: string) {
    super(message);
    this.name = "GcodeParseError";
    this.problem = problem;
  }
}

/**
 * A shape in the file that the viewer mentions rather than corrects.
 *
 * `segments-capped` is the one that is about this viewer rather than about the
 * file: a file larger than `GCODE_MAX_SEGMENTS` is drawn as its first two
 * million segments and says so, because refusing the whole print at that point
 * would be worse than drawing nearly all of it.
 */
export type GcodeWarning =
  | "missing-feed"
  | "arc-without-centre"
  | "arc-radius-too-small"
  | "segments-capped";

export interface GcodeBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly size: readonly [number, number, number];
}

/**
 * One layer's toolpath, as two flat arrays of segment ENDPOINTS - six floats a
 * segment, the `LineSegments` layout `THREE.BufferGeometry` takes, so the
 * renderer uploads them without reshaping anything.
 */
export interface GcodeLayer {
  readonly index: number;
  /** The Z this layer printed at, in millimetres. */
  readonly zMm: number;
  readonly extrusion: Float32Array;
  readonly travel: Float32Array;
  readonly extrusionMm: number;
  readonly travelMm: number;
  readonly estimatedSeconds: number;
  /** Print time before this layer, so a slider position reads as "an hour in". */
  readonly startsAfterSeconds: number;
}

export interface GcodeModel {
  /** Units in force when the file ended: `mm` unless `G20` said inches. */
  readonly units: "mm" | "inch";
  readonly layers: readonly GcodeLayer[];
  readonly bounds: GcodeBounds;
  readonly segmentCount: number;
  /** Commanded path length of extruding moves, in millimetres. */
  readonly extrusionMm: number;
  /** Commanded path length of travel moves, in millimetres. */
  readonly travelMm: number;
  /** Millimetres of filament the print consumed, retractions excluded. */
  readonly filamentMm: number;
  /** The estimate the header describes, in seconds. */
  readonly estimatedSeconds: number;
  readonly warnings: readonly GcodeWarning[];
}

/** The modal machine state a file's lines move forward. */
interface State {
  absolutePositioning: boolean;
  absoluteExtrusion: boolean;
  inch: boolean;
  feedMmPerMinute: number | null;
  x: number;
  y: number;
  z: number;
  e: number;
}

/** One layer while it is being filled: arrays of numbers until the end, then typed arrays. */
interface LayerBuffer {
  z: number;
  extrusion: number[];
  travel: number[];
  extrusionMm: number;
  travelMm: number;
  seconds: number;
}

/** Reads one G-code file, or throws `GcodeParseError`. */
export function parseGcode(bytes: Uint8Array): GcodeModel {
  if (bytes.byteLength === 0) throw new GcodeParseError("empty", "The file is empty.");
  if (bytes.byteLength > GCODE_MAX_BYTES) {
    throw new GcodeParseError("too-large", `The file is larger than ${GCODE_MAX_BYTES} bytes.`);
  }
  // Decoded with replacement rather than fatally: a stray high byte inside a
  // comment must not cost the user the whole print.
  return parseGcodeText(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
}

/**
 * The parser proper, on text - what `parseGcode` decodes to, and what a test can
 * hand a fixture directly.
 */
export function parseGcodeText(text: string): GcodeModel {
  const lines = text.split("\n");
  if (lines.length > GCODE_MAX_LINES) {
    throw new GcodeParseError("too-large", `The file has more than ${GCODE_MAX_LINES} lines.`);
  }

  const state: State = {
    absolutePositioning: true,
    absoluteExtrusion: true,
    inch: false,
    feedMmPerMinute: null,
    x: 0,
    y: 0,
    z: 0,
    e: 0,
  };
  const warnings = new Set<GcodeWarning>();
  const buffers: LayerBuffer[] = [];
  const low: [number, number, number] = [Infinity, Infinity, Infinity];
  const high: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let layer: LayerBuffer | null = null;
  let layerKey: string | null = null;
  let segmentCount = 0;
  let filamentMm = 0;
  let estimatedSeconds = 0;
  let sawMotion = false;

  /** The layer a move at `z` belongs to, created on first use: Z is the layer's identity. */
  function layerAt(z: number): LayerBuffer {
    const key = z.toFixed(Z_LAYER_DECIMALS);
    if (layer !== null && layerKey === key) return layer;
    layer = { z, extrusion: [], travel: [], extrusionMm: 0, travelMm: 0, seconds: 0 };
    layerKey = key;
    buffers.push(layer);
    return layer;
  }

  /** Records one drawn segment, its length and its commanded time. */
  function addSegment(
    target: LayerBuffer,
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    extruding: boolean,
    length: number,
  ): void {
    if (segmentCount >= GCODE_MAX_SEGMENTS) {
      warnings.add("segments-capped");
      return;
    }
    segmentCount += 1;
    const array = extruding ? target.extrusion : target.travel;
    array.push(from[0], from[1], from[2], to[0], to[1], to[2]);
    if (extruding) target.extrusionMm += length;
    else target.travelMm += length;
    for (let axis = 0; axis < 3; axis += 1) {
      low[axis] = Math.min(low[axis] as number, from[axis] as number, to[axis] as number);
      high[axis] = Math.max(high[axis] as number, from[axis] as number, to[axis] as number);
    }
    if (state.feedMmPerMinute !== null && state.feedMmPerMinute > 0) {
      const cost = (length / state.feedMmPerMinute) * 60;
      target.seconds += cost;
      estimatedSeconds += cost;
    } else {
      warnings.add("missing-feed");
    }
  }

  /**
   * A `G2`/`G3`, drawn as straight segments.
   *
   * `I`/`J` are the centre's offset FROM THE START POINT (the spelling every
   * slicer emits); `R` is the radius, positive for the minor arc and negative
   * for the major one, solved for which side the centre falls on. A Z that
   * changes across the arc makes it a helix, and Z is interpolated along it -
   * a real pattern in vase mode, and not worth drawing wrong.
   */
  function emitArc(
    code: 2 | 3,
    target: LayerBuffer,
    words: readonly (readonly [string, number])[],
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    extruding: boolean,
    scale: number,
  ): void {
    const iWord = read(words, "I") * scale;
    const jWord = read(words, "J") * scale;
    const rWord = read(words, "R") * scale;
    const centre = arcCentre(from, to, iWord, jWord, rWord);
    if (centre === null) {
      // An arc whose centre cannot be worked out is drawn as the straight move
      // between its own two ends: the head really does end up at the target, so
      // dropping the segment would put everything after it in the wrong place.
      // The warning is what keeps this from looking like the file's intent.
      const straight = distance(from, to);
      if (straight > 0) addSegment(target, from, to, extruding, straight);
      return;
    }
    const [cx, cy, radius] = centre;
    const startAngle = Math.atan2(from[1] - cy, from[0] - cx);
    const endAngle = Math.atan2(to[1] - cy, to[0] - cx);
    // A full circle is the one arc whose end angle says nothing: the start and
    // the end are the same point, and only `I`/`J` distinguish it from no move.
    const fullCircle =
      (iWord !== 0 || jWord !== 0) && from[0] === to[0] && from[1] === to[1];
    const counterClockwise = fullCircle ? Math.PI * 2 : normaliseAngle(endAngle - startAngle);
    const magnitude = fullCircle || code === 3 ? counterClockwise : Math.PI * 2 - counterClockwise;
    const sign = code === 3 ? 1 : -1;
    const steps = Math.max(
      1,
      Math.ceil((magnitude / (Math.PI * 2)) * GCODE_ARC_SEGMENTS_PER_TURN),
    );
    // The ARC's length, not the polyline's: the drawn curve is `steps` chords
    // between points on the circle, which are a hair shorter than the curve they
    // approximate, while the machine moves along the arc. So each step accounts
    // the arc it draws, and the reported length is the commanded one.
    const arcStep = (radius * magnitude) / steps;
    let previous: readonly [number, number, number] = from;
    for (let step = 1; step <= steps; step += 1) {
      const angle = startAngle + sign * magnitude * (step / steps);
      // The last point IS the target: a division rarely lands there, and a
      // toolpath that stops a nanometre short of its own end is one the next
      // move then jumps from.
      const point: [number, number, number] =
        step === steps
          ? [to[0], to[1], to[2]]
          : [
              cx + radius * Math.cos(angle),
              cy + radius * Math.sin(angle),
              from[2] + (to[2] - from[2]) * (step / steps),
            ];
      addSegment(target, previous, point, extruding, arcStep);
      previous = point;
    }
  }

  /**
   * The centre and radius of one arc, or `null` when the words do not describe
   * one - a `warning`, not an exception: a file with one bad arc still has every
   * other move in it worth drawing.
   */
  function arcCentre(
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    i: number,
    j: number,
    r: number,
  ): [number, number, number] | null {
    if (i !== 0 || j !== 0) return [from[0] + i, from[1] + j, Math.hypot(i, j)];
    if (r === 0) {
      warnings.add("arc-without-centre");
      return null;
    }
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const chord = Math.hypot(dx, dy);
    const radius = Math.abs(r);
    if (chord === 0) {
      warnings.add("arc-radius-too-small");
      return null;
    }
    if (chord / 2 > radius * (1 + 1e-9)) {
      // The radius cannot reach both ends, so the file is inconsistent. Falling
      // back to the straight move the firmware would have made is what keeps the
      // rest of the toolpath in the right place; the warning says it happened.
      warnings.add("arc-radius-too-small");
      return null;
    }
    const half = Math.sqrt(Math.max(0, radius * radius - (chord / 2) * (chord / 2)));
    const midX = (from[0] + to[0]) / 2;
    const midY = (from[1] + to[1]) / 2;
    const px = -dy / chord;
    const py = dx / chord;
    const candidates: [number, number, number][] = [
      [midX + half * px, midY + half * py, radius],
      [midX - half * px, midY - half * py, radius],
    ];
    // `R`'s sign picks the side: positive is the minor arc, negative the major
    // one, and each candidate is one of the two.
    const wantedMinor = r > 0;
    for (const candidate of candidates) {
      const sweep = normaliseAngle(
        Math.atan2(to[1] - candidate[1], to[0] - candidate[0]) -
          Math.atan2(from[1] - candidate[1], from[0] - candidate[0]),
      );
      if (sweep === 0) continue;
      if (sweep <= Math.PI + 1e-9 === wantedMinor) return candidate;
    }
    return candidates[0] as [number, number, number];
  }

  for (const line of lines) {
    const words = readWords(line);
    if (words.length === 0) continue;
    /**
     * Two passes over one line's words, and the order is the format's.
     *
     * A machine reads a line's non-motion words first - a `G90` that repositions
     * the meaning of the axes, an `M83` that redefines `E`, and `F`, whose value
     * is the feed rate FOR THIS LINE's move - and then moves. Processing the
     * words left to right would apply a line's `F` to the NEXT move instead,
     * which is how a slicer's `G1 Z0.2 F600` comes out a fifth faster than it is.
     */
    for (const [letter, value] of words) {
      if (letter === "F") {
        state.feedMmPerMinute = state.inch ? value * MM_PER_INCH : value;
        continue;
      }
      if (letter === "M") {
        // The two extrusion modes, and nothing else: every other `M` command is
        // machine state that does not move the head.
        if (value === 82) state.absoluteExtrusion = true;
        else if (value === 83) state.absoluteExtrusion = false;
        continue;
      }
      if (letter !== "G") continue;
      // A motion waits for the second pass; every other `G` is state.
      if (value === 0 || value === 1 || value === 2 || value === 3) continue;
      if (value === 20 || value === 21) {
        state.inch = value === 20;
        continue;
      }
      if (value === 90) {
        state.absolutePositioning = true;
        continue;
      }
      if (value === 91) {
        state.absolutePositioning = false;
        continue;
      }
      if (value === 92) {
        // `G92` sets the current position without moving: the axes it names are
        // adopted, the ones it does not are left alone.
        const scale = state.inch ? MM_PER_INCH : 1;
        if (has(words, "X")) state.x = read(words, "X") * scale;
        if (has(words, "Y")) state.y = read(words, "Y") * scale;
        if (has(words, "Z")) state.z = read(words, "Z") * scale;
        if (has(words, "E")) state.e = read(words, "E");
      }
    }
    for (const [letter, value] of words) {
      if (letter !== "G") continue;
      if (value !== 0 && value !== 1 && value !== 2 && value !== 3) continue;
      sawMotion = true;
      const scale = state.inch ? MM_PER_INCH : 1;
      const from: [number, number, number] = [state.x, state.y, state.z];
      const target: [number, number, number] = [
        axis(words, 0, "X"),
        axis(words, 1, "Y"),
        has(words, "Z") ? axis(words, 2, "Z") : state.z,
      ];
      const eWord = read(words, "E");
      const deltaE = state.absoluteExtrusion ? (has(words, "E") ? eWord - state.e : 0) : eWord;
      if (state.absoluteExtrusion) state.e = has(words, "E") ? eWord : state.e;
      else state.e += eWord;
      if (deltaE > 0) filamentMm += deltaE;
      // A segment belongs to the layer it STARTS on: the head is at `from[2]`
      // when the move begins, so a Z lift out of a layer is that layer's own
      // last move, and the layer above comes into being with its first move
      // rather than with the travel that reaches its height.
      const moveLayer = layerAt(from[2]);
      if (value === 0 || value === 1) {
        const length = distance(from, target);
        if (length > 0) addSegment(moveLayer, from, target, deltaE > 0, length);
      } else {
        emitArc(value, moveLayer, words, from, target, deltaE > 0, scale);
      }
      state.x = target[0];
      state.y = target[1];
      state.z = target[2];
    }
  }

  /**
   * One axis of a motion's target, honouring absolute/relative positioning and
   * the file's units. An axis the line does not name stays where it is - which
   * is the modal rule this format is built on.
   */
  function axis(
    words: readonly (readonly [string, number])[],
    index: 0 | 1 | 2,
    letter: "X" | "Y" | "Z",
  ): number {
    const current = index === 0 ? state.x : index === 1 ? state.y : state.z;
    const scale = state.inch ? MM_PER_INCH : 1;
    if (!has(words, letter)) return current;
    const value = read(words, letter) * scale;
    return state.absolutePositioning ? value : current + value;
  }

  if (!sawMotion && segmentCount === 0) {
    throw new GcodeParseError("not-gcode", "The file holds no motion command.");
  }

  const hasBounds = low[0] !== Infinity;
  const min: [number, number, number] = hasBounds ? [low[0], low[1], low[2]] : [0, 0, 0];
  const max: [number, number, number] = hasBounds ? [high[0], high[1], high[2]] : [0, 0, 0];
  let running = 0;
  const layers: GcodeLayer[] = buffers.map((buffer, index) => {
    const built: GcodeLayer = {
      index,
      zMm: buffer.z,
      extrusion: Float32Array.from(buffer.extrusion),
      travel: Float32Array.from(buffer.travel),
      extrusionMm: buffer.extrusionMm,
      travelMm: buffer.travelMm,
      estimatedSeconds: buffer.seconds,
      startsAfterSeconds: running,
    };
    running += buffer.seconds;
    return built;
  });
  return {
    units: state.inch ? "inch" : "mm",
    layers,
    bounds: {
      min,
      max,
      size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    },
    segmentCount,
    extrusionMm: layers.reduce((total, each) => total + each.extrusionMm, 0),
    travelMm: layers.reduce((total, each) => total + each.travelMm, 0),
    filamentMm,
    estimatedSeconds,
    warnings: [...warnings].slice(0, GCODE_MAX_WARNINGS),
  };
}

/** One of a line's words, or 0 when the line does not carry it. */
function read(words: readonly (readonly [string, number])[], letter: string): number {
  for (const [wordLetter, value] of words) {
    if (wordLetter === letter) return value;
  }
  return 0;
}

/** Whether a line carries a word at all - the difference between "move to 0" and "leave it alone". */
function has(words: readonly (readonly [string, number])[], letter: string): boolean {
  return words.some(([wordLetter]) => wordLetter === letter);
}

function distance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

/** An angle folded into `[0, 2π)`, which is the domain the arc maths is written in. */
function normaliseAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = angle % twoPi;
  return wrapped < 0 ? wrapped + twoPi : wrapped;
}

/**
 * One line's `letter number` words, comments removed.
 *
 * Three comment styles are dropped, because all three appear in real files:
 * `;` to the end of the line, the `(...)` blocks a RepRap file may carry, and
 * anything after a `*` checksum. `N` line numbers are read and ignored, because
 * a line number is not a command.
 */
function readWords(line: string): [string, number][] {
  const words: [string, number][] = [];
  let depth = 0;
  let index = 0;
  while (index < line.length) {
    const character = line[index] as string;
    if (character === ";") break;
    if (character === "(") {
      depth += 1;
      index += 1;
      continue;
    }
    if (character === ")") {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (depth > 0) {
      index += 1;
      continue;
    }
    if (character === "*") break;
    if (/[A-Za-z]/.test(character)) {
      const letter = character.toUpperCase();
      let cursor = index + 1;
      let text = "";
      while (cursor < line.length && /[-+0-9.]/.test(line[cursor] as string)) {
        text += line[cursor];
        cursor += 1;
      }
      index = cursor;
      if (text !== "") {
        const value = Number(text);
        if (Number.isFinite(value)) words.push([letter, value]);
      }
      continue;
    }
    index += 1;
  }
  return words;
}
