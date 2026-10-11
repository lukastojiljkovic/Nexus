/**
 * The fakes the scripted mode runs against: a knowledge base that returns a
 * scenario's fixtures, and tools built from the scenario's own declarations.
 *
 * **Why the tools are built here rather than in the scenario file.** A scenario
 * says which tools are OFFERED and what each does; the shape the loop sees —
 * `ToolSpec` with a JSON Schema, `Tool.run` with a `ToolContext` — is code. So
 * the scenario declares `tasks.create` as a `write` with a `summary` and a
 * result, and this file turns that into an object the loop can call.
 *
 * **`knowledge.search` is backed by the fixtures.** A scenario does not repeat
 * its knowledge in the tool's result: the harness synthesises `knowledge.search`
 * from `scenario.knowledge`, highest score first, so the article a citation
 * names and the article the model reads cannot drift apart.
 */

import type {
  AppLocation,
  AssistantLocale,
  AssistantText,
  Citation,
  KnowledgeBase,
  KnowledgeHit,
  Tool,
  ToolContext,
  ToolResult,
} from "@nexus/core";

import type { ScenarioCitation, ScenarioHit, ScenarioTool } from "./scenario.js";

/** The name of the search tool, as the contract's own examples spell it. */
export const KNOWLEDGE_SEARCH = "knowledge.search";

/**
 * What a `write` or `network` tool returns when the user declines. The model
 * reads it — it is data, not copy — and a refusal is a normal result, never an
 * error. A scenario that cares what the model reads can override it with
 * `declined`.
 */
const DEFAULT_DECLINED = "The user declined. Nothing changed.";

/**
 * The schema a fake tool declares. Written as the contract's own shape rather
 * than importing its `JsonSchema` alias: `@nexus/core` already exports a
 * `JsonSchema` of its own (the widget contract's), and the barrel's named export
 * shadows the assistant contract's star export — see the report.
 */
const PARAMETERS: Readonly<Record<string, unknown>> = {
  type: "object",
  additionalProperties: true,
};

/** A scenario's citation as the contract's shape, with no key present holding `undefined`. */
export function toCitation(citation: ScenarioCitation): Citation {
  return {
    kind: citation.kind,
    id: citation.id,
    title: citation.title,
    ...(citation.locator === undefined ? {} : { locator: citation.locator }),
    ...(citation.packId === undefined ? {} : { packId: citation.packId }),
    ...(citation.safety === undefined ? {} : { safety: citation.safety }),
    ...(citation.location === undefined ? {} : { location: citation.location }),
  };
}

/** The fixtures as a search returns them: highest score first, citations deduplicated in that order. */
export function searchResult(hits: readonly ScenarioHit[]): ToolResult {
  const ordered = [...hits].sort((left, right) => right.score - left.score);
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const hit of ordered) {
    const key = `${hit.citation.kind}:${hit.citation.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push(toCitation(hit.citation));
  }
  return {
    ok: true,
    content: ordered.map((hit) => hit.text).join("\n\n"),
    ...(citations.length === 0 ? {} : { citations }),
  };
}

/**
 * A knowledge base that answers every query with the scenario's fixtures.
 *
 * Deliberately not a search: the evals measure what the agent does with the
 * passages it is given, and a fake ranker would put a second, unmeasured
 * retrieval quality between the fixture and the model. The query the model
 * actually sent is asserted through `toolsCalled` instead.
 */
export function createKnowledgeBase(hits: readonly ScenarioHit[]): KnowledgeBase {
  return {
    async search(_query, _signal): Promise<KnowledgeHit[]> {
      return [...hits]
        .sort((left, right) => right.score - left.score)
        .map((hit) => ({ citation: toCitation(hit.citation), text: hit.text, score: hit.score }));
    },
  };
}

/** The description a fake tool carries: its own name, which is not copy and reads the same in both locales. */
function describe(name: string): AssistantText {
  return { sr: name, en: name };
}

function summaryFor(tool: ScenarioTool, locale: AssistantLocale): string {
  return tool.summary === undefined ? tool.name : tool.summary[locale];
}

function resultOf(tool: ScenarioTool): ToolResult {
  const citations = (tool.citations ?? []).map(toCitation);
  const navigateTo: AppLocation | undefined = tool.navigateTo;
  return {
    ok: true,
    content: tool.content ?? "",
    ...(citations.length === 0 ? {} : { citations }),
    ...(navigateTo === undefined ? {} : { navigateTo }),
  };
}

/** One tool the scenario declared, as the loop calls it. */
export function createFakeTool(tool: ScenarioTool, hits: readonly ScenarioHit[]): Tool {
  return {
    name: tool.name,
    description: describe(tool.name),
    parameters: PARAMETERS,
    effect: tool.effect,
    async run(_args: unknown, context: ToolContext): Promise<ToolResult> {
      // Only `write` and `network` ask: `navigate` moves the app's own view, and
      // the contract runs a `read` without asking at all.
      if (tool.effect === "write" || tool.effect === "network") {
        const approved = await context.confirm({
          tool: tool.name,
          summary: summaryFor(tool, context.locale),
          effect: tool.effect,
        });
        if (!approved) return { ok: false, content: tool.declined ?? DEFAULT_DECLINED };
      }
      if (tool.fail !== undefined) throw new Error(tool.fail);
      if (tool.name === KNOWLEDGE_SEARCH) return searchResult(hits);
      return resultOf(tool);
    },
  };
}

/**
 * Every tool a scenario offers.
 *
 * **What "was called" means.** The harness scores the calls the LOOP emitted,
 * not the calls the fakes executed, so a refusal still counts as a call and a
 * call to a tool the scenario never offered is visible instead of silently
 * missing. That is why nothing here records anything.
 */
export function createFakeTools(
  tools: readonly ScenarioTool[],
  hits: readonly ScenarioHit[],
): readonly Tool[] {
  return tools.map((tool) => createFakeTool(tool, hits));
}
