import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { CanvasStore, NexusDatabase, NoteStore, openDatabase, uuidv7 } from "@nexus/db";
import {
  emptyCanvasScene,
  serializeCanvasScene,
  type AssistantLocale,
  type ConfirmRequest,
  type Tool,
  type ToolContext,
  type ToolResult,
} from "@nexus/core";
import { canvasTools } from "./canvas.js";

/**
 * The CANVAS tools over a REAL database: every assertion is about boards and
 * notes the app's own stores hold, because the point of a tool is what it leaves
 * behind — a board that exists, a name that was refused, a write that a „no"
 * prevented.
 *
 * The drawing itself is not written here. The drawing tools answer with an
 * `action` the page applies, so these tests assert the action's payload and that
 * main never touched the board's scene.
 */

const NOW_ISO = new Date(2026, 9, 10, 9, 0, 0).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-canvas-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
});

function boards(): CanvasStore {
  return new CanvasStore(db.raw, profileId);
}

function notes(): NoteStore {
  return new NoteStore(db.raw, profileId);
}

function tools(): readonly Tool[] {
  return canvasTools({ profileDb: (id, open) => open(db.raw, id), now: () => Date.parse(NOW_ISO) });
}

interface Outcome {
  readonly result: ToolResult;
  readonly confirms: ConfirmRequest[];
}

/** Runs one tool, answering its confirmation with `allow`, and remembers every question asked. */
async function run(
  name: string,
  args: unknown,
  { allow = true, locale = "en" }: { allow?: boolean; locale?: AssistantLocale } = {},
): Promise<Outcome> {
  const tool = tools().find((entry) => entry.name === name);
  if (tool === undefined) throw new Error(`Test setup: no tool "${name}".`);
  const confirms: ConfirmRequest[] = [];
  const context: ToolContext = {
    profileId,
    locale,
    signal: new AbortController().signal,
    confirm: (request) => {
      confirms.push(request);
      return Promise.resolve(allow);
    },
  };
  return { result: await tool.run(args, context), confirms };
}

const SKETCH = {
  nodes: [
    { id: "a", label: "Cart", shape: "rect" },
    { id: "b", label: "Pay", shape: "diamond", tone: "ruza" },
    { id: "c", label: "Ship" },
  ],
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c", label: "ok" },
  ],
  layout: "auto",
};

/** A note as the editor writes it: a heading, then a paragraph with a wiki-link to another note. */
function writeNote(title: string, linkTo: string | null): string {
  const note = notes().create(NOW_ISO);
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("default");
  const heading = new Y.XmlElement("heading");
  heading.setAttribute("level", "1");
  heading.insert(0, [new Y.XmlText("Overview")]);
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText("See ")]);
  if (linkTo !== null) {
    const link = new Y.XmlElement("noteLink");
    link.setAttribute("noteId", linkTo);
    link.setAttribute("label", "Other");
    paragraph.insert(1, [link]);
  }
  fragment.insert(0, [heading, paragraph]);
  notes().appendUpdate(note.id, Y.encodeStateAsUpdate(doc), title, NOW_ISO);
  doc.destroy();
  return note.id;
}

describe("canvas.boards", () => {
  it("says the profile has no boards when it has none", async () => {
    const { result } = await run("canvas.boards", {});
    expect(result).toEqual({ ok: true, content: "This profile has no boards." });
  });

  it("lists boards by name with their ids", async () => {
    const board = boards().create({ name: "Plan" }, NOW_ISO);
    const { result } = await run("canvas.boards", {});
    expect(result.ok).toBe(true);
    expect(result.content).toContain(`- Plan (${board.id}, 2026-10-10)`);
  });

  it("reads one board: its element counts by kind and its text, without navigating", async () => {
    const board = boards().create({ name: "Flow" }, NOW_ISO);
    const scene = {
      ...emptyCanvasScene(),
      elements: [
        { type: "rectangle", id: "r1" },
        { type: "text", id: "t1", text: "Order received" },
        { type: "text", id: "t2", text: "Shipped", isDeleted: true },
      ],
    };
    boards().saveScene(board.id, serializeCanvasScene(scene), NOW_ISO);
    const { result } = await run("canvas.boards", { board: "flow" });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Elements: 1 rectangle, 1 text");
    expect(result.content).toContain("- Order received");
    expect(result.content).not.toContain("Shipped");
    expect(result.navigateTo).toBeUndefined();
  });

  it("refuses a board name it does not know, naming the boards there are", async () => {
    boards().create({ name: "Plan" }, NOW_ISO);
    const { result } = await run("canvas.boards", { board: "Nope" });
    expect(result.ok).toBe(false);
    expect(result.content).toBe(`Failed: No board named “Nope”. This profile's boards: Plan.`);
  });
});

describe("canvas.create", () => {
  it("asks first, then makes the board and points the page at it", async () => {
    const { result, confirms } = await run("canvas.create", { name: "Sprint" });
    const created = boards().listActive();
    expect(confirms.map((request) => request.summary)).toEqual(["Make a board called “Sprint”"]);
    expect(created.map((board) => board.name)).toEqual(["Sprint"]);
    expect(result).toEqual({
      ok: true,
      content: `Created board “Sprint” (${created[0]?.id}).`,
      navigateTo: { module: "canvas", item: created[0]?.id },
    });
  });

  it("writes nothing when the user says no", async () => {
    const { result } = await run("canvas.create", { name: "Sprint" }, { allow: false });
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(boards().listActive()).toEqual([]);
  });

  it("refuses a name that is blank or longer than the board limit, and asks nothing", async () => {
    const blank = await run("canvas.create", { name: "   " });
    expect(blank.result.ok).toBe(false);
    const long = await run("canvas.create", { name: "x".repeat(61) });
    expect(long.result.ok).toBe(false);
    expect(blank.confirms).toEqual([]);
    expect(long.confirms).toEqual([]);
  });
});

describe("canvas.rename", () => {
  it("renames the board and points the page at it", async () => {
    const board = boards().create({ name: "Plan" }, NOW_ISO);
    const { result, confirms } = await run("canvas.rename", { board: board.id, name: "Roadmap" });
    expect(confirms[0]?.summary).toBe("Rename the board “Plan” to “Roadmap”");
    expect(boards().listActive()[0]?.name).toBe("Roadmap");
    expect(result.navigateTo).toEqual({ module: "canvas", item: board.id });
  });

  it("refuses an ambiguous board name with every candidate and changes nothing", async () => {
    boards().create({ name: "Plan" }, NOW_ISO);
    boards().create({ name: "plan" }, NOW_ISO);
    const { result, confirms } = await run("canvas.rename", { board: "PLAN", name: "X" });
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/^Failed: More than one board is called “PLAN”: /);
    expect(result.content).toMatch(/Plan \(/);
    expect(result.content).toMatch(/plan \(/);
    expect(confirms).toEqual([]);
    expect(boards().listActive().map((board) => board.name).sort()).toEqual(["Plan", "plan"]);
  });
});

describe("canvas.delete", () => {
  it("soft-deletes a board the user agreed to delete", async () => {
    boards().create({ name: "Old" }, NOW_ISO);
    const { result } = await run("canvas.delete", { board: "Old" });
    expect(result).toEqual({ ok: true, content: "Deleted the board “Old”." });
    expect(boards().listActive()).toEqual([]);
  });

  it("keeps the board when the user says no", async () => {
    boards().create({ name: "Old" }, NOW_ISO);
    const { result } = await run("canvas.delete", { board: "Old" }, { allow: false });
    expect(result.content).toBe("The user declined.");
    expect(boards().listActive()).toHaveLength(1);
  });
});

describe("canvas.draw", () => {
  it("makes the board, asks for the whole change, and sends the validated sketch to the page", async () => {
    const { result, confirms } = await run("canvas.draw", { board: "Flow", sketch: SKETCH });
    const [created] = boards().listActive();
    expect(confirms[0]?.summary).toBe("Make a board called “Flow” and draw 3 boxes on it");
    expect(created?.name).toBe("Flow");
    expect(result.ok).toBe(true);
    expect(result.navigateTo).toEqual({
      module: "canvas",
      item: created?.id,
      action: {
        name: "sketch",
        payload: {
          nodes: [
            { id: "a", label: "Cart", shape: "rect" },
            { id: "b", label: "Pay", shape: "diamond", tone: "ruza" },
            { id: "c", label: "Ship", shape: "rect" },
          ],
          edges: [
            { from: "a", to: "b" },
            { from: "b", to: "c", label: "ok" },
          ],
          layout: "auto",
        },
      },
    });
  });

  it("draws on an existing board matched by name, without making another", async () => {
    const board = boards().create({ name: "Plán" }, NOW_ISO);
    const { result, confirms } = await run("canvas.draw", { board: "plan", sketch: SKETCH });
    expect(confirms[0]?.summary).toBe("Draw 3 boxes on the board “Plán”");
    expect(boards().listActive()).toHaveLength(1);
    expect(result.navigateTo?.item).toBe(board.id);
  });

  it("writes nothing when the user says no", async () => {
    const { result } = await run("canvas.draw", { board: "Flow", sketch: SKETCH }, { allow: false });
    expect(result.content).toBe("The user declined.");
    expect(boards().listActive()).toEqual([]);
  });

  it("refuses an unknown shape with the sketch's own message, and asks nothing", async () => {
    const sketch = { nodes: [{ id: "a", label: "A", shape: "hexagon" }] };
    const { result, confirms } = await run("canvas.draw", { board: "Flow", sketch });
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/shape of node "a" must be one of: rect, ellipse, diamond, text/);
    expect(confirms).toEqual([]);
    expect(boards().listActive()).toEqual([]);
  });
});

describe("canvas.visualize", () => {
  it("makes a board named after the note and sends its outline to the page", async () => {
    const other = writeNote("Other", null);
    writeNote("Plan", other);
    const { result, confirms } = await run("canvas.visualize", { note: "plan" });
    const [created] = boards().listActive();
    expect(created?.name).toBe("Plan");
    expect(confirms[0]?.summary).toBe("Make a board from the note “Plan” with 3 boxes");
    expect(result.navigateTo?.item).toBe(created?.id);
    const action = result.navigateTo?.action;
    expect(action?.name).toBe("sketch");
    const payload = action?.payload as { nodes: { label: string }[]; edges: unknown[] };
    expect(payload.nodes.map((node) => node.label)).toEqual(["Plan", "Overview", "Other"]);
    expect(payload.edges).toHaveLength(2);
  });

  it("refuses a note it cannot find, and an ambiguous title", async () => {
    const missing = await run("canvas.visualize", { note: "Nowhere" });
    expect(missing.result.content).toBe(`Failed: No active note matches “Nowhere”.`);
    writeNote("Twin", null);
    writeNote("Twin", null);
    const twins = await run("canvas.visualize", { note: "twin" });
    expect(twins.result.ok).toBe(false);
    expect(twins.result.content).toMatch(/More than one note is called “twin”/);
    expect(twins.confirms).toEqual([]);
  });

  it("writes nothing when the user says no", async () => {
    writeNote("Quiet", null);
    const { result } = await run("canvas.visualize", { note: "Quiet" }, { allow: false });
    expect(result.content).toBe("The user declined.");
    expect(boards().listActive()).toEqual([]);
  });
});

describe("canvas.card", () => {
  it("pins a note on a board: the page places the card for its reference", async () => {
    const board = boards().create({ name: "Map" }, NOW_ISO);
    const noteId = writeNote("Budget", null);
    const { result, confirms } = await run("canvas.card", { board: "Map", kind: "note", id: noteId });
    expect(confirms[0]?.summary).toBe("Put the note “Budget” on the board “Map”");
    expect(result.navigateTo).toEqual({
      module: "canvas",
      item: board.id,
      action: { name: "place-card", payload: { ref: `nexus://note/${noteId}` } },
    });
  });

  it("refuses an object that does not exist, by its id, and asks nothing", async () => {
    boards().create({ name: "Map" }, NOW_ISO);
    const id = uuidv7();
    const { result, confirms } = await run("canvas.card", { board: "Map", kind: "task", id });
    expect(result).toEqual({ ok: false, content: `Failed: No active task has the id “${id}”.` });
    expect(confirms).toEqual([]);
  });

  it("writes nothing when the user says no", async () => {
    boards().create({ name: "Map" }, NOW_ISO);
    const noteId = writeNote("Quiet card", null);
    const { result } = await run("canvas.card", { board: "Map", kind: "note", id: noteId }, { allow: false });
    expect(result.content).toBe("The user declined.");
  });
});
