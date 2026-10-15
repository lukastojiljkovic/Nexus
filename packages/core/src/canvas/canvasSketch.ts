/**
 * CANV's sketch: the small diagram an assistant (or a person) describes, which
 * the app lays out and draws on a board.
 *
 * **Why the model never gives coordinates.** A 2–5B model places boxes badly and
 * invents numbers when it is asked for them. So the sketch names nodes and the
 * edges between them, and this module positions them: a deterministic layered
 * layout for `auto` and `tree`, plain rows, columns and grids for the rest.
 * Nothing here is random, so the same sketch always draws the same diagram.
 *
 * **What the caps are.** `MAX_CANVAS_SKETCH_NODES` is a policy choice, not a
 * measurement: a diagram a person reads at a glance has a few dozen boxes, and a
 * model that writes hundreds is looping. The other limits are the lengths the
 * board already accepts, so a sketch never carries a string the board would
 * refuse.
 *
 * Pure: no editor and no database. The renderer turns a positioned sketch into
 * Excalidraw skeletons, and main validates one before it asks the page to draw.
 */

/** The closed set of box shapes. `text` is a bare label with no border. */
export const CANVAS_SKETCH_SHAPES = ["rect", "ellipse", "diamond", "text"] as const;
export type CanvasSketchShape = (typeof CANVAS_SKETCH_SHAPES)[number];

/**
 * The colours a box may take: the board's own palette ids (`CANVAS_SWATCHES` in
 * the renderer), restated here because this package does not depend on
 * `@nexus/tokens`. The renderer's test pins the two lists equal.
 */
export const CANVAS_SKETCH_TONES = [
  "mastilo",
  "zlato",
  "bronza",
  "maslina",
  "suma",
  "zad",
  "ruza",
  "bordo",
  "grafit",
] as const;
export type CanvasSketchTone = (typeof CANVAS_SKETCH_TONES)[number];

/** How the nodes are arranged. `auto` lays out by the arrows; the rest ignore them. */
export const CANVAS_SKETCH_LAYOUTS = ["auto", "row", "column", "grid", "tree"] as const;
export type CanvasSketchLayout = (typeof CANVAS_SKETCH_LAYOUTS)[number];

/** A policy cap on one sketch, not a limit the board has (see the header). */
export const MAX_CANVAS_SKETCH_NODES = 60;
const MAX_ID_CHARS = 40;
const MAX_LABEL_CHARS = 200;
const MAX_TITLE_CHARS = 200;

export interface CanvasSketchNode {
  readonly id: string;
  readonly label: string;
  readonly shape: CanvasSketchShape;
  readonly tone?: CanvasSketchTone;
}

export interface CanvasSketchEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

export interface CanvasSketch {
  readonly title?: string;
  readonly nodes: readonly CanvasSketchNode[];
  readonly edges: readonly CanvasSketchEdge[];
  readonly layout: CanvasSketchLayout;
}

/**
 * The validated sketch, from an untrusted value: a model's arguments, or a
 * payload the assistant sent to a page. Throws with a sentence the model can act
 * on, naming the offending id or value, because the caller hands that sentence
 * back as the tool's answer.
 */
export function parseCanvasSketch(value: unknown): CanvasSketch {
  if (!isRecord(value)) throw new Error(`"sketch" must be an object with "nodes" and "edges".`);
  const nodes = value.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > MAX_CANVAS_SKETCH_NODES) {
    const count = Array.isArray(nodes) ? nodes.length : 0;
    throw new Error(`"nodes" must hold 1-${MAX_CANVAS_SKETCH_NODES} nodes; this sketch has ${count}.`);
  }

  const ids = new Set<string>();
  const parsedNodes = nodes.map((raw): CanvasSketchNode => {
    if (!isRecord(raw)) throw new Error(`Every node must be an object with "id" and "label".`);
    const id = boundedText(raw.id, "node id", MAX_ID_CHARS);
    if (ids.has(id)) throw new Error(`Node id "${id}" is used twice; ids must be unique.`);
    ids.add(id);
    const label = boundedText(raw.label, `label of node "${id}"`, MAX_LABEL_CHARS);
    const shape = oneOf(raw.shape, CANVAS_SKETCH_SHAPES, `shape of node "${id}"`) ?? "rect";
    const tone = oneOf(raw.tone, CANVAS_SKETCH_TONES, `tone of node "${id}"`);
    return tone === undefined ? { id, label, shape } : { id, label, shape, tone };
  });

  const edges = value.edges ?? [];
  if (!Array.isArray(edges)) throw new Error(`"edges" must be a list.`);
  const parsedEdges = edges.map((raw): CanvasSketchEdge => {
    if (!isRecord(raw)) throw new Error(`Every edge must be an object with "from" and "to".`);
    const from = boundedText(raw.from, "edge from", MAX_ID_CHARS);
    const to = boundedText(raw.to, "edge to", MAX_ID_CHARS);
    for (const end of [from, to]) {
      if (!ids.has(end)) throw new Error(`An edge names node "${end}", which the sketch does not have.`);
    }
    if (from === to) throw new Error(`An edge may not start and end at node "${from}".`);
    const label =
      raw.label === undefined ? undefined : boundedText(raw.label, "edge label", MAX_LABEL_CHARS);
    return label === undefined ? { from, to } : { from, to, label };
  });

  const title =
    value.title === undefined ? undefined : boundedText(value.title, "title", MAX_TITLE_CHARS);
  const layout = oneOf(value.layout, CANVAS_SKETCH_LAYOUTS, "layout") ?? "auto";
  return {
    ...(title === undefined ? {} : { title }),
    nodes: parsedNodes,
    edges: parsedEdges,
    layout,
  };
}

/** A box after layout: its top-left corner and its size, in the board's own units. */
export interface CanvasSketchBox extends CanvasSketchNode {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** An arrow after layout: its two ends, on the sides of the boxes it joins. */
export interface CanvasSketchArrow extends CanvasSketchEdge {
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
}

export interface PositionedCanvasSketch {
  readonly title?: string;
  readonly boxes: readonly CanvasSketchBox[];
  readonly arrows: readonly CanvasSketchArrow[];
}

/**
 * Box size and spacing. Policy constants, chosen so a label of a line or two
 * fits and the layers stay readable; they are not measurements of the editor.
 */
const BOX_WIDTH = 200;
const BOX_HEIGHT = 80;
const GAP_ACROSS = 60;
const GAP_DOWN = 80;

type Cell = { readonly x: number; readonly y: number };
type Edge = readonly [from: number, to: number];

/**
 * Positions a validated sketch. Deterministic: every tie is broken by the order
 * the nodes were written in, so one sketch always draws one diagram.
 */
export function positionCanvasSketch(sketch: CanvasSketch): PositionedCanvasSketch {
  const index = new Map(sketch.nodes.map((node, i) => [node.id, i]));
  const edges: Edge[] = sketch.edges.map((edge) => [
    index.get(edge.from) ?? 0,
    index.get(edge.to) ?? 0,
  ]);
  const cells = placeCells(sketch.layout, sketch.nodes.length, edges);

  const boxes = sketch.nodes.map((node, i): CanvasSketchBox => {
    const cell = cells[i] ?? { x: 0, y: 0 };
    return { ...node, x: cell.x, y: cell.y, width: BOX_WIDTH, height: BOX_HEIGHT };
  });
  const arrows = sketch.edges.map((edge, k): CanvasSketchArrow => {
    const [from, to] = edges[k] ?? [0, 0];
    return { ...edge, ...arrowEnds(boxes[from], boxes[to]) };
  });
  return sketch.title === undefined ? { boxes, arrows } : { title: sketch.title, boxes, arrows };
}

/** The top-left cell of every node, by layout. */
function placeCells(layout: CanvasSketchLayout, count: number, edges: readonly Edge[]): Cell[] {
  const stepX = BOX_WIDTH + GAP_ACROSS;
  const stepY = BOX_HEIGHT + GAP_DOWN;
  switch (layout) {
    case "row":
      return Array.from({ length: count }, (_, i) => ({ x: i * stepX, y: 0 }));
    case "column":
      return Array.from({ length: count }, (_, i) => ({ x: 0, y: i * stepY }));
    case "grid": {
      const columns = Math.ceil(Math.sqrt(count));
      return Array.from({ length: count }, (_, i) => ({
        x: (i % columns) * stepX,
        y: Math.floor(i / columns) * stepY,
      }));
    }
    case "auto":
      return layered(longestPathLayers(count, edges), stepX, stepY);
    case "tree":
      return layered(breadthFirstLayers(count, edges), stepX, stepY);
  }
}

/**
 * Layers by longest path from the sources, so an arrow points down to a later
 * layer. An edge that closes a cycle is left out of the layering (it is still
 * drawn), so the walk always terminates.
 */
function longestPathLayers(count: number, edges: readonly Edge[]): number[] {
  const back = backEdges(count, edges);
  const layer = new Array<number>(count).fill(0);
  for (let pass = 0; pass < count; pass++) {
    let changed = false;
    for (const [from, to] of edges) {
      const below = (layer[from] ?? 0) + 1;
      if (back.has(`${from}>${to}`) || (layer[to] ?? 0) >= below) continue;
      layer[to] = below;
      changed = true;
    }
    if (!changed) break;
  }
  return layer;
}

/**
 * The depth of every node in a breadth-first walk. The walk starts from the
 * nodes nothing points at, in the order they were written, and then from any
 * node a cycle left unreached.
 */
function breadthFirstLayers(count: number, edges: readonly Edge[]): number[] {
  const out = adjacency(count, edges);
  const pointedAt = new Set(edges.map(([, to]) => to));
  const order = Array.from({ length: count }, (_, i) => i);
  const starts = [...order.filter((i) => !pointedAt.has(i)), ...order];
  const depth = new Array<number>(count).fill(-1);
  for (const start of starts) {
    if (depth[start] !== -1) continue;
    depth[start] = 0;
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const node = queue[head] ?? start;
      for (const next of out[node] ?? []) {
        if (depth[next] !== -1) continue;
        depth[next] = (depth[node] ?? 0) + 1;
        queue.push(next);
      }
    }
  }
  return depth;
}

/** Each layer as a centred row, the rows stacked downwards in layer order. */
function layered(layer: readonly number[], stepX: number, stepY: number): Cell[] {
  const rows: number[][] = [];
  layer.forEach((r, node) => {
    (rows[r] ??= []).push(node);
  });
  const rowWidth = (members: number): number => members * BOX_WIDTH + (members - 1) * GAP_ACROSS;
  const widest = Math.max(0, ...rows.map((row) => rowWidth(row.length)));
  const cells: { x: number; y: number }[] = layer.map(() => ({ x: 0, y: 0 }));
  rows.forEach((row, r) => {
    const left = (widest - rowWidth(row.length)) / 2;
    row.forEach((node, c) => {
      cells[node] = { x: left + c * stepX, y: r * stepY };
    });
  });
  return cells;
}

/** The edges that close a cycle, as `from>to` keys, found by a depth-first walk in written order. */
function backEdges(count: number, edges: readonly Edge[]): Set<string> {
  const out = adjacency(count, edges);
  const state = new Array<number>(count).fill(0); // 0 unseen, 1 on the walk, 2 done
  const back = new Set<string>();
  const visit = (node: number): void => {
    state[node] = 1;
    for (const next of out[node] ?? []) {
      if (state[next] === 1) back.add(`${node}>${next}`);
      else if (state[next] === 0) visit(next);
    }
    state[node] = 2;
  };
  for (let i = 0; i < count; i++) if (state[i] === 0) visit(i);
  return back;
}

function adjacency(count: number, edges: readonly Edge[]): number[][] {
  const out: number[][] = Array.from({ length: count }, () => []);
  for (const [from, to] of edges) out[from]?.push(to);
  return out;
}

/**
 * The two ends of an arrow, on the sides of the boxes it joins: vertical when
 * the boxes sit one above the other, horizontal otherwise. Centres decide.
 */
function arrowEnds(
  from: CanvasSketchBox | undefined,
  to: CanvasSketchBox | undefined,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const a = from ?? { x: 0, y: 0, width: 0, height: 0 };
  const b = to ?? { x: 0, y: 0, width: 0, height: 0 };
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dy) >= Math.abs(dx)) {
    const down = dy >= 0;
    return {
      start: { x: a.x + a.width / 2, y: down ? a.y + a.height : a.y },
      end: { x: b.x + b.width / 2, y: down ? b.y : b.y + b.height },
    };
  }
  const right = dx >= 0;
  return {
    start: { x: right ? a.x + a.width : a.x, y: a.y + a.height / 2 },
    end: { x: right ? b.x : b.x + b.width, y: b.y + b.height / 2 },
  };
}

function boundedText(value: unknown, field: string, maxChars: number): string {
  if (typeof value !== "string") throw new Error(`The ${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxChars) {
    throw new Error(`The ${field} must be 1-${maxChars} characters after trimming.`);
  }
  return trimmed;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`The ${field} must be one of: ${allowed.join(", ")}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
