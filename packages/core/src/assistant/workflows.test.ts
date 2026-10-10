import { describe, expect, it } from "vitest";
import {
  ASSISTANT_WORKFLOWS,
  findWorkflow,
  renderWorkflowBrief,
  toolsForWorkflow,
} from "./workflows.js";
import type { Tool } from "./contract.js";

const tool = (name: string): Tool => ({
  name,
  description: { sr: "opis", en: "description" },
  parameters: { type: "object" },
  effect: "read",
  async run() {
    return { ok: true, content: "" };
  },
});

describe("the built-ins", () => {
  it("are the four recipes, in the order the list shows them", () => {
    expect(ASSISTANT_WORKFLOWS.map((workflow) => workflow.id)).toEqual([
      "plan-day",
      "note-to-tasks",
      "what-to-read",
      "stranded",
    ]);
  });

  it("have kebab-case ids that no other recipe repeats", () => {
    const ids = ASSISTANT_WORKFLOWS.map((workflow) => workflow.id);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carry both languages in every field, with a checklist nobody could call empty", () => {
    for (const workflow of ASSISTANT_WORKFLOWS) {
      for (const text of [workflow.name, workflow.goal]) {
        expect(text.sr.length).toBeGreaterThan(0);
        expect(text.en.length).toBeGreaterThan(0);
      }
      expect(workflow.checklist.length).toBeGreaterThanOrEqual(3);
      for (const step of workflow.checklist) {
        expect(step.sr.length).toBeGreaterThan(0);
        expect(step.en.length).toBeGreaterThan(0);
      }
      expect(workflow.tools.length).toBeGreaterThan(0);
      for (const name of workflow.tools) expect(name).toMatch(/^[a-z][a-z0-9]*\.[a-z][a-z0-9-]*$/);
    }
  });

  it("keeps what-to-read to the knowledge tool alone", () => {
    expect(findWorkflow("what-to-read")?.tools).toEqual(["knowledge.search"]);
  });

  it("puts 112 and the safety notice into the stranded recipe, in both languages", () => {
    const stranded = findWorkflow("stranded");
    expect(stranded).toBeDefined();
    const serbian = (stranded?.checklist ?? []).map((step) => step.sr).join("\n");
    const english = (stranded?.checklist ?? []).map((step) => step.en).join("\n");
    expect(serbian).toContain("112");
    expect(english).toContain("112");
    expect(serbian).toContain("obaveštenje o bezbednosti");
    expect(english).toContain("safety notice");
    expect(stranded?.tools).toContain("knowledge.search");
  });

  it("finds a recipe by id and nothing by a name it does not have", () => {
    expect(findWorkflow("plan-day")?.id).toBe("plan-day");
    expect(findWorkflow("nope")).toBeUndefined();
  });
});

describe("toolsForWorkflow", () => {
  const registry = [
    tool("tasks.list"),
    tool("tasks.create"),
    tool("calendar.list"),
    tool("knowledge.search"),
    tool("web.search"),
  ];

  it("keeps the registry's order and only the allowed names", () => {
    const planDay = findWorkflow("plan-day");
    expect(planDay).toBeDefined();
    if (planDay === undefined) return;
    expect(toolsForWorkflow(planDay, registry).map((entry) => entry.name)).toEqual([
      "tasks.list",
      "tasks.create",
      "calendar.list",
    ]);
  });

  it("never lets a web tool into a recipe that does not name one", () => {
    for (const workflow of ASSISTANT_WORKFLOWS) {
      expect(toolsForWorkflow(workflow, registry).some((entry) => entry.name === "web.search")).toBe(false);
    }
  });
});

describe("renderWorkflowBrief", () => {
  it("writes the goal, the numbered steps and the allowed tools in the turn's language", () => {
    const planDay = findWorkflow("plan-day");
    expect(planDay).toBeDefined();
    if (planDay === undefined) return;
    const serbian = renderWorkflowBrief(planDay, "sr");
    expect(serbian).toContain(`Cilj: ${planDay.goal.sr}`);
    expect(serbian).toContain(`1. ${planDay.checklist[0]?.sr ?? ""}`);
    expect(serbian).toContain("Dozvoljene alatke: tasks.list, calendar.list, tasks.create, app.open");
    const english = renderWorkflowBrief(planDay, "en");
    expect(english).toContain(`Goal: ${planDay.goal.en}`);
    expect(english).toContain("Checklist:");
    expect(english).toContain("Allowed tools: tasks.list, calendar.list, tasks.create, app.open");
  });
});
