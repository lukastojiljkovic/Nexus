import { describe, expect, it } from "vitest";
import {
  MAX_CANVAS_SKETCH_NODES,
  parseCanvasSketch,
  positionCanvasSketch,
  type CanvasSketch,
} from "./canvasSketch.js";

/** A sketch of `count` boxes named n0..n(count-1), chained by arrows unless `edges` says otherwise. */
function chain(count: number, layout: CanvasSketch["layout"] = "auto"): unknown {
  const nodes = Array.from({ length: count }, (_, i) => ({ id: `n${i}`, label: `Box ${i}` }));
  const edges = Array.from({ length: count - 1 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` }));
  return { nodes, edges, layout };
}

describe("parseCanvasSketch", () => {
  it("accepts a five-shape diagram and fills the defaults", () => {
    const sketch = parseCanvasSketch({
      title: "Order flow",
      nodes: [
        { id: "a", label: "Cart", shape: "rect" },
        { id: "b", label: "Pay", shape: "diamond", tone: "ruza" },
        { id: "c", label: "Ship" },
        { id: "d", label: "Note", shape: "text" },
        { id: "e", label: "Done", shape: "ellipse" },
      ],
      edges: [
        { from: "a", to: "b", label: "submit" },
        { from: "b", to: "c" },
        { from: "c", to: "e" },
      ],
    });
    expect(sketch.title).toBe("Order flow");
    expect(sketch.layout).toBe("auto");
    expect(sketch.nodes[2]).toEqual({ id: "c", label: "Ship", shape: "rect" });
    expect(sketch.nodes[1]).toEqual({ id: "b", label: "Pay", shape: "diamond", tone: "ruza" });
    expect(sketch.edges[0]).toEqual({ from: "a", to: "b", label: "submit" });
  });

  it("refuses an unknown shape and names it", () => {
    expect(() =>
      parseCanvasSketch({ nodes: [{ id: "a", label: "A", shape: "hexagon" }] }),
    ).toThrow(/shape of node "a" must be one of: rect, ellipse, diamond, text/);
  });

  it("refuses an unknown tone", () => {
    expect(() => parseCanvasSketch({ nodes: [{ id: "a", label: "A", tone: "red" }] })).toThrow(
      /tone of node "a"/,
    );
  });

  it("refuses an edge to a missing node by name", () => {
    expect(() =>
      parseCanvasSketch({ nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "zed" }] }),
    ).toThrow(/node "zed", which the sketch does not have/);
  });

  it("refuses duplicate ids, and an edge that loops to its own node", () => {
    expect(() =>
      parseCanvasSketch({
        nodes: [
          { id: "a", label: "A" },
          { id: "a", label: "B" },
        ],
      }),
    ).toThrow(/Node id "a" is used twice/);
    expect(() =>
      parseCanvasSketch({ nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "a" }] }),
    ).toThrow(/may not start and end at node "a"/);
  });

  it("caps a sketch at 60 nodes and refuses an empty one", () => {
    expect(MAX_CANVAS_SKETCH_NODES).toBe(60);
    expect(() => parseCanvasSketch(chain(MAX_CANVAS_SKETCH_NODES))).not.toThrow();
    expect(() => parseCanvasSketch(chain(MAX_CANVAS_SKETCH_NODES + 1))).toThrow(
      /1-60 nodes; this sketch has 61/,
    );
    expect(() => parseCanvasSketch({ nodes: [] })).toThrow(/this sketch has 0/);
  });

  it("refuses labels that are blank after trimming", () => {
    expect(() => parseCanvasSketch({ nodes: [{ id: "a", label: "   " }] })).toThrow(
      /label of node "a" must be 1-200 characters/,
    );
  });

  it("refuses a value that is not an object", () => {
    expect(() => parseCanvasSketch("boxes")).toThrow(/"sketch" must be an object/);
  });
});

describe("positionCanvasSketch", () => {
  it("is deterministic: the same sketch always draws the same diagram", () => {
    const sketch = parseCanvasSketch(chain(7));
    expect(positionCanvasSketch(sketch)).toEqual(positionCanvasSketch(sketch));
  });

  it("stacks an auto layout by the arrows, each layer below the one it points from", () => {
    const sketch = parseCanvasSketch({
      nodes: [
        { id: "root", label: "Root" },
        { id: "left", label: "Left" },
        { id: "right", label: "Right" },
        { id: "leaf", label: "Leaf" },
      ],
      edges: [
        { from: "root", to: "left" },
        { from: "root", to: "right" },
        { from: "left", to: "leaf" },
      ],
    });
    const { boxes } = positionCanvasSketch(sketch);
    const byId = Object.fromEntries(boxes.map((box) => [box.id, box]));
    expect(byId.root?.y).toBe(0);
    expect(byId.left?.y).toBe(byId.right?.y);
    expect(byId.leaf?.y ?? 0).toBeGreaterThan(byId.left?.y ?? 0);
    expect(byId.left?.x ?? 0).toBeLessThan(byId.right?.x ?? 0);
  });

  it("keeps every box inside its bounds with no two boxes overlapping", () => {
    const sketch = parseCanvasSketch({
      nodes: Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, label: `N${i}` })),
      edges: [
        { from: "n0", to: "n1" },
        { from: "n0", to: "n2" },
        { from: "n1", to: "n3" },
        { from: "n3", to: "n0" },
      ],
    });
    const { boxes } = positionCanvasSketch(sketch);
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a === undefined || b === undefined) continue;
        const apart =
          a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(apart).toBe(true);
      }
    }
  });

  it("places a grid in rows of ceil(sqrt(n)) and a column in one x", () => {
    const grid = positionCanvasSketch(parseCanvasSketch(chain(5, "grid"))).boxes;
    expect(grid.map((box) => [box.x, box.y])).toEqual([
      [0, 0],
      [260, 0],
      [520, 0],
      [0, 160],
      [260, 160],
    ]);
    const column = positionCanvasSketch(parseCanvasSketch(chain(3, "column"))).boxes;
    expect(new Set(column.map((box) => box.x))).toEqual(new Set([0]));
  });

  it("draws every arrow between the facing sides of the boxes it joins", () => {
    const { arrows } = positionCanvasSketch(parseCanvasSketch(chain(2, "column")));
    expect(arrows).toHaveLength(1);
    expect(arrows[0]?.start).toEqual({ x: 100, y: 80 });
    expect(arrows[0]?.end).toEqual({ x: 100, y: 160 });
  });

  it("survives a cycle without losing a node", () => {
    const sketch = parseCanvasSketch({
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    });
    expect(positionCanvasSketch(sketch).boxes).toHaveLength(2);
  });
});
