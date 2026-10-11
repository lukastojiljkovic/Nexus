/**
 * The eval scenario format, and the validator that refuses a bad one.
 *
 * A scenario is DATA: a locale, a conversation, the tools a turn may use, the
 * knowledge fixtures a search would return, the user's answers to confirmation
 * prompts, what the turn is expected to do, and the scripted transcript a fake
 * model plays so the expectations can be proven without a real model. Nothing
 * here runs anything — {@link parseScenario} turns `unknown` into the shapes the
 * harness consumes, or throws.
 *
 * **Why the schema is strict about unknown keys.** An expectation the validator
 * ignored would be a check nobody runs, and a scenario file reads green because
 * of the checks beside it. `expect` is a closed set of keys, a typo in one is a
 * refusal, and the failure message names the key the file actually wrote.
 *
 * **Why the cross-checks live here rather than in the harness.** They are
 * statements about the FILE, and they are cheapest to make once, before any turn
 * runs: an expectation about a tool the scenario never offers, a citation id no
 * fixture carries, a `safetyNotice` expectation with no safety fixture to have
 * caused it, a script longer than the step budget it is scored against, or a
 * write tool with no confirmation to answer it — each of those is a scenario
 * that could never pass, and each is refused by name.
 */

import type { AppLocation, AssistantLocale, SourceKind, ToolEffect } from "@nexus/core";

/** Raised for a scenario the harness will not run. The message names the field and the file. */
export class ScenarioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioError";
  }
}

export interface ScenarioCitation {
  readonly kind: SourceKind;
  readonly id: string;
  readonly title: string;
  readonly locator?: string;
  readonly packId?: string;
  readonly safety?: boolean;
  readonly location?: AppLocation;
}

/** One knowledge fixture: a passage a search would return, with what it cites. */
export interface ScenarioHit {
  readonly citation: ScenarioCitation;
  readonly text: string;
  readonly score: number;
}

/**
 * A tool the turn may use, and what the fake behind it does. `summary` is the
 * one line the confirmation asks with, in both languages, and is required for
 * `write` and `network` tools — the harness never writes that copy itself.
 */
export interface ScenarioTool {
  readonly name: string;
  readonly effect: ToolEffect;
  readonly summary?: { readonly sr: string; readonly en: string };
  readonly content?: string;
  readonly citations?: readonly ScenarioCitation[];
  readonly navigateTo?: AppLocation;
  readonly declined?: string;
  readonly fail?: string;
}

/** How one argument of a tool call is checked. At least one field must be set. */
export interface ArgumentConstraint {
  readonly eq?: unknown;
  readonly contains?: string;
  readonly matches?: string;
  readonly oneOf?: readonly string[];
}

export interface ToolCallExpectation {
  readonly name: string;
  readonly args?: Readonly<Record<string, ArgumentConstraint>>;
}

/** Everything a scenario asserts about the turn. Every key is optional; an empty object asserts nothing. */
export interface ScenarioExpectation {
  readonly toolsCalled?: readonly ToolCallExpectation[];
  readonly toolsNotCalled?: readonly string[];
  readonly cites?: readonly string[];
  readonly safetyNotice?: boolean;
  readonly language?: AssistantLocale;
  readonly doesNotKnow?: boolean;
  readonly maxSteps?: number;
  readonly answerContains?: readonly string[];
  readonly answerNotContains?: readonly string[];
}

export interface ScenarioMessage {
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
}

/** One completion the fake model returns, in order. */
export interface ScenarioStep {
  readonly text?: string;
  readonly toolCalls?: readonly { readonly name: string; readonly arguments?: unknown }[];
  readonly promptTokens?: number;
  readonly completionTokens?: number;
}

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly locale: AssistantLocale;
  /** The history, oldest first; the LAST message must be the user turn under test. */
  readonly conversation: readonly ScenarioMessage[];
  readonly tools: readonly ScenarioTool[];
  readonly knowledge: readonly ScenarioHit[];
  /** What the user answers to each confirmation prompt, in the order they are asked. */
  readonly confirmations: readonly boolean[];
  readonly maxSteps: number;
  readonly expect: ScenarioExpectation;
  readonly script: readonly ScenarioStep[];
  /** The context the scripted model reports it was loaded with; a long-history scenario sets it low on purpose. */
  readonly modelContextTokens?: number;
}

const LOCALES: readonly AssistantLocale[] = ["sr", "en"];

const TOOL_EFFECTS: readonly ToolEffect[] = ["read", "write", "navigate", "network"];

const SOURCE_KINDS: readonly SourceKind[] = [
  "app-manual",
  "note",
  "task",
  "event",
  "file",
  "pack",
  "wiki",
];

/** `module.verb`, lower-case, one or more dots: `tasks.create`, `app.open`, `web.readPage`. */
const TOOL_NAME = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

const SCENARIO_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A fixture's own id, in the lower-case slug shape a citation is written in: `pack-survival-01`. */
const FIXTURE_ID = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * The longest id a scenario may carry: the same 200 characters `MAX_ID_LENGTH`
 * bounds main's IPC ids with, written out rather than imported.
 *
 * The reason is structural. Every other import in this directory is a type, so
 * the whole evals module graph is free of runtime dependencies — which is what
 * lets `scripts/assistant-eval.mjs` load it under Node's own type stripping
 * without pulling the `@nexus/core` barrel in. Importing one constant would end
 * that, for a number the tests pin anyway.
 */
const MAX_ID_CHARS = 200;

const EXPECT_KEYS = [
  "toolsCalled",
  "toolsNotCalled",
  "cites",
  "safetyNotice",
  "language",
  "doesNotKnow",
  "maxSteps",
  "answerContains",
  "answerNotContains",
];

const SCENARIO_KEYS = [
  "id",
  "title",
  "locale",
  "conversation",
  "tools",
  "knowledge",
  "confirmations",
  "maxSteps",
  "expect",
  "script",
  "modelContextTokens",
];

const TOOL_KEYS = [
  "name",
  "effect",
  "summary",
  "content",
  "citations",
  "navigateTo",
  "declined",
  "fail",
];

const MESSAGE_KEYS = ["role", "content"];

const HIT_KEYS = ["citation", "text", "score"];

const CITATION_KEYS = ["kind", "id", "title", "locator", "packId", "safety", "location"];

const LOCATION_KEYS = ["module", "item", "settings"];

const STEP_KEYS = ["text", "toolCalls", "promptTokens", "completionTokens"];

const CALL_KEYS = ["name", "arguments"];

const CONSTRAINT_KEYS = ["eq", "contains", "matches", "oneOf"];

const TOOL_CALL_EXPECTATION_KEYS = ["name", "args"];

// --- The primitive readers ---------------------------------------------------
//
// Local, and deliberately the same shape and the same messages as main's IPC
// validators: a scenario arrives from a file somebody else wrote, and the rule
// for an untrusted shape is the rule this repository already states once.

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ScenarioError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new ScenarioError(`${field} must be an array.`);
  return value as unknown[];
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ScenarioError(`${field} must be a non-empty string.`);
  }
  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new ScenarioError(`${field} must be a boolean.`);
  return value;
}

function asPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ScenarioError(`${field} must be a positive integer.`);
  }
  return value;
}

function asOneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  const text = asString(value, field);
  if (!(allowed as readonly string[]).includes(text)) {
    throw new ScenarioError(`${field} must be one of ${allowed.join(", ")}.`);
  }
  return text as T;
}

function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return asString(value, field);
}

function asKeys(record: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new ScenarioError(`${field} has an unknown key "${key}".`);
    }
  }
}

/** A scenario id: a bounded, lower-case slug. */
function asSlug(value: unknown, field: string): string {
  const slug = asString(value, field);
  if (slug.length > MAX_ID_CHARS || !SCENARIO_ID.test(slug)) {
    throw new ScenarioError(`${field} "${slug}" is not a lower-case slug.`);
  }
  return slug;
}

/** A citation's own id: a bounded, lower-case slug. Never a display name, and never bounded by nothing. */
function asFixtureId(value: unknown, field: string): string {
  const id = asString(value, field);
  if (id.length > MAX_ID_CHARS || !FIXTURE_ID.test(id)) {
    throw new ScenarioError(`${field} "${id}" is not a citation id.`);
  }
  return id;
}

/** The optional-field idiom `exactOptionalPropertyTypes` forces: a key is present or absent, never `undefined`. */
function optional<T>(value: T | undefined, key: string): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

// --- The shapes --------------------------------------------------------------

function parseLocation(value: unknown, field: string): AppLocation {
  const record = asRecord(value, field);
  asKeys(record, LOCATION_KEYS, field);
  const module = asString(record["module"], `${field}.module`);
  const item = asOptionalString(record["item"], `${field}.item`);
  const settings = asOptionalString(record["settings"], `${field}.settings`);
  return { module, ...optional(item, "item"), ...optional(settings, "settings") };
}

function parseCitation(value: unknown, field: string): ScenarioCitation {
  const record = asRecord(value, field);
  asKeys(record, CITATION_KEYS, field);
  const kind = asOneOf(record["kind"], `${field}.kind`, SOURCE_KINDS);
  const id = asFixtureId(record["id"], `${field}.id`);
  const title = asString(record["title"], `${field}.title`);
  const locator = asOptionalString(record["locator"], `${field}.locator`);
  const packId = asOptionalString(record["packId"], `${field}.packId`);
  const safety = record["safety"] === undefined ? undefined : asBoolean(record["safety"], `${field}.safety`);
  const location =
    record["location"] === undefined ? undefined : parseLocation(record["location"], `${field}.location`);
  return {
    kind,
    id,
    title,
    ...optional(locator, "locator"),
    ...optional(packId, "packId"),
    ...optional(safety, "safety"),
    ...optional(location, "location"),
  };
}

function parseHit(value: unknown, field: string): ScenarioHit {
  const record = asRecord(value, field);
  asKeys(record, HIT_KEYS, field);
  const score = record["score"];
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new ScenarioError(`${field}.score must be a finite number.`);
  }
  return {
    citation: parseCitation(record["citation"], `${field}.citation`),
    text: asString(record["text"], `${field}.text`),
    score,
  };
}

function parseBilingual(value: unknown, field: string): { sr: string; en: string } {
  const record = asRecord(value, field);
  asKeys(record, ["sr", "en"], field);
  return {
    sr: asString(record["sr"], `${field}.sr`),
    en: asString(record["en"], `${field}.en`),
  };
}

function parseTool(value: unknown, field: string): ScenarioTool {
  const record = asRecord(value, field);
  asKeys(record, TOOL_KEYS, field);
  const name = asString(record["name"], `${field}.name`);
  if (!TOOL_NAME.test(name)) {
    throw new ScenarioError(`${field}.name "${name}" is not a module.verb tool name.`);
  }
  const effect = asOneOf(record["effect"], `${field}.effect`, TOOL_EFFECTS);
  const summaryRaw = record["summary"];
  const summary =
    summaryRaw === undefined ? undefined : parseBilingual(summaryRaw, `${field}.summary`);
  if ((effect === "write" || effect === "network") && summary === undefined) {
    throw new ScenarioError(
      `${field}.summary is required: a ${effect} tool asks the user first, and the scenario owns that line.`,
    );
  }
  const citationsRaw = record["citations"];
  const citations =
    citationsRaw === undefined
      ? undefined
      : asArray(citationsRaw, `${field}.citations`).map((entry, index) =>
          parseCitation(entry, `${field}.citations[${index}]`),
        );
  const navigateToRaw = record["navigateTo"];
  const navigateTo =
    navigateToRaw === undefined ? undefined : parseLocation(navigateToRaw, `${field}.navigateTo`);
  const content = asOptionalString(record["content"], `${field}.content`);
  const declined = asOptionalString(record["declined"], `${field}.declined`);
  const fail = asOptionalString(record["fail"], `${field}.fail`);
  return {
    name,
    effect,
    ...optional(summary, "summary"),
    ...optional(content, "content"),
    ...optional(citations, "citations"),
    ...optional(navigateTo, "navigateTo"),
    ...optional(declined, "declined"),
    ...optional(fail, "fail"),
  };
}

function parseMessage(value: unknown, field: string): ScenarioMessage {
  const record = asRecord(value, field);
  asKeys(record, MESSAGE_KEYS, field);
  return {
    role: asOneOf(record["role"], `${field}.role`, ["user", "assistant", "system"] as const),
    content: asString(record["content"], `${field}.content`),
  };
}

function parseConstraint(value: unknown, field: string): ArgumentConstraint {
  const record = asRecord(value, field);
  asKeys(record, CONSTRAINT_KEYS, field);
  const contains = asOptionalString(record["contains"], `${field}.contains`);
  const matches = asOptionalString(record["matches"], `${field}.matches`);
  const oneOfRaw = record["oneOf"];
  const oneOf =
    oneOfRaw === undefined
      ? undefined
      : asArray(oneOfRaw, `${field}.oneOf`).map((entry, index) =>
          asString(entry, `${field}.oneOf[${index}]`),
        );
  if (record["eq"] === undefined && contains === undefined && matches === undefined && oneOf === undefined) {
    throw new ScenarioError(`${field} must set at least one of eq, contains, matches, oneOf.`);
  }
  if (matches !== undefined) {
    try {
      new RegExp(matches, "iu");
    } catch {
      throw new ScenarioError(`${field}.matches is not a regular expression.`);
    }
  }
  return {
    ...("eq" in record ? { eq: record["eq"] } : {}),
    ...optional(contains, "contains"),
    ...optional(matches, "matches"),
    ...optional(oneOf, "oneOf"),
  };
}

function parseToolCallExpectation(value: unknown, field: string): ToolCallExpectation {
  const record = asRecord(value, field);
  asKeys(record, TOOL_CALL_EXPECTATION_KEYS, field);
  const name = asString(record["name"], `${field}.name`);
  const argsRaw = record["args"];
  if (argsRaw === undefined) return { name };
  const argsRecord = asRecord(argsRaw, `${field}.args`);
  const args: Record<string, ArgumentConstraint> = {};
  for (const [key, constraint] of Object.entries(argsRecord)) {
    args[key] = parseConstraint(constraint, `${field}.args.${key}`);
  }
  return { name, args };
}

function parseExpectation(value: unknown, field: string): ScenarioExpectation {
  const record = asRecord(value, field);
  asKeys(record, EXPECT_KEYS, field);
  const strings = (key: string): string[] | undefined => {
    const raw = record[key];
    if (raw === undefined) return undefined;
    return asArray(raw, `${field}.${key}`).map((entry, index) =>
      asString(entry, `${field}.${key}[${index}]`),
    );
  };
  const callsRaw = record["toolsCalled"];
  const toolsCalled =
    callsRaw === undefined
      ? undefined
      : asArray(callsRaw, `${field}.toolsCalled`).map((entry, index) =>
          parseToolCallExpectation(entry, `${field}.toolsCalled[${index}]`),
        );
  const languageRaw = record["language"];
  return {
    ...optional(toolsCalled, "toolsCalled"),
    ...optional(strings("toolsNotCalled"), "toolsNotCalled"),
    ...optional(strings("cites"), "cites"),
    ...(record["safetyNotice"] === undefined
      ? {}
      : { safetyNotice: asBoolean(record["safetyNotice"], `${field}.safetyNotice`) }),
    ...(languageRaw === undefined
      ? {}
      : { language: asOneOf(languageRaw, `${field}.language`, LOCALES) }),
    ...(record["doesNotKnow"] === undefined
      ? {}
      : { doesNotKnow: asBoolean(record["doesNotKnow"], `${field}.doesNotKnow`) }),
    ...(record["maxSteps"] === undefined
      ? {}
      : { maxSteps: asPositiveInteger(record["maxSteps"], `${field}.maxSteps`) }),
    ...optional(strings("answerContains"), "answerContains"),
    ...optional(strings("answerNotContains"), "answerNotContains"),
  };
}

function parseStep(value: unknown, field: string): ScenarioStep {
  const record = asRecord(value, field);
  asKeys(record, STEP_KEYS, field);
  const text = asOptionalString(record["text"], `${field}.text`);
  const callsRaw = record["toolCalls"];
  const toolCalls =
    callsRaw === undefined
      ? undefined
      : asArray(callsRaw, `${field}.toolCalls`).map((entry, index) => {
          const call = asRecord(entry, `${field}.toolCalls[${index}]`);
          asKeys(call, CALL_KEYS, `${field}.toolCalls[${index}]`);
          const name = asString(call["name"], `${field}.toolCalls[${index}].name`);
          return "arguments" in call
            ? { name, arguments: call["arguments"] }
            : { name };
        });
  const promptTokens =
    record["promptTokens"] === undefined
      ? undefined
      : asPositiveInteger(record["promptTokens"], `${field}.promptTokens`);
  const completionTokens =
    record["completionTokens"] === undefined
      ? undefined
      : asPositiveInteger(record["completionTokens"], `${field}.completionTokens`);
  if (text === undefined && toolCalls === undefined) {
    throw new ScenarioError(`${field} must carry text, toolCalls, or both.`);
  }
  return {
    ...optional(text, "text"),
    ...optional(toolCalls, "toolCalls"),
    ...optional(promptTokens, "promptTokens"),
    ...optional(completionTokens, "completionTokens"),
  };
}

/**
 * Turns one file's worth of `unknown` into a {@link Scenario}, or throws
 * {@link ScenarioError} naming the field. `source` is the file the value came
 * from and is used in every message.
 */
export function parseScenario(value: unknown, source: string): Scenario {
  const field = `${source}`;
  const record = asRecord(value, field);
  asKeys(record, SCENARIO_KEYS, field);

  const id = asSlug(record["id"], `${field}.id`);
  const locale = asOneOf(record["locale"], `${field}.locale`, LOCALES);
  const conversation = asArray(record["conversation"], `${field}.conversation`).map((entry, index) =>
    parseMessage(entry, `${field}.conversation[${index}]`),
  );
  if (conversation.length === 0) {
    throw new ScenarioError(`${field}.conversation must hold at least the user turn under test.`);
  }
  if (conversation[conversation.length - 1]?.role !== "user") {
    throw new ScenarioError(`${field}.conversation must END with the user turn under test.`);
  }

  const tools = asArray(record["tools"], `${field}.tools`).map((entry, index) =>
    parseTool(entry, `${field}.tools[${index}]`),
  );
  const toolNames = new Set<string>();
  for (const tool of tools) {
    if (toolNames.has(tool.name)) {
      throw new ScenarioError(`${field}.tools lists "${tool.name}" twice.`);
    }
    toolNames.add(tool.name);
  }

  const knowledge = asArray(record["knowledge"], `${field}.knowledge`).map((entry, index) =>
    parseHit(entry, `${field}.knowledge[${index}]`),
  );
  const citationIds = new Set<string>();
  for (const hit of knowledge) {
    if (citationIds.has(hit.citation.id)) {
      throw new ScenarioError(`${field}.knowledge cites "${hit.citation.id}" twice.`);
    }
    citationIds.add(hit.citation.id);
  }
  // A tool's own result may cite something the knowledge fixtures do not — the
  // web tools do — and a scenario may expect that id too. What it may NOT do is
  // expect an id nothing in the file can produce.
  for (const tool of tools) {
    for (const citation of tool.citations ?? []) {
      if (citationIds.has(citation.id)) {
        throw new ScenarioError(`${field} carries the citation "${citation.id}" twice.`);
      }
      citationIds.add(citation.id);
    }
  }

  const confirmations = asArray(record["confirmations"], `${field}.confirmations`).map(
    (entry, index) => asBoolean(entry, `${field}.confirmations[${index}]`),
  );
  const maxSteps = asPositiveInteger(record["maxSteps"], `${field}.maxSteps`);
  const script = asArray(record["script"], `${field}.script`).map((entry, index) =>
    parseStep(entry, `${field}.script[${index}]`),
  );
  if (script.length === 0) {
    throw new ScenarioError(`${field}.script must hold at least one completion.`);
  }
  if (script.length > maxSteps) {
    throw new ScenarioError(
      `${field}.script has ${script.length} completions but maxSteps is ${maxSteps}: the last one could never run.`,
    );
  }

  const expect = parseExpectation(record["expect"], `${field}.expect`);

  // Only a call the scenario EXPECTS to happen needs an answer declared: a
  // write tool is often offered precisely to show that the turn does not call
  // it, and demanding a reply there would be a reply nothing ever asks for.
  const expectsConfirmation = (expect.toolsCalled ?? []).some((call) => {
    const tool = tools.find((candidate) => candidate.name === call.name);
    return tool !== undefined && (tool.effect === "write" || tool.effect === "network");
  });
  if (expectsConfirmation && confirmations.length === 0) {
    throw new ScenarioError(
      `${field}.confirmations must answer the confirmation that ${field}.expect.toolsCalled asks for.`,
    );
  }

  for (const call of expect.toolsCalled ?? []) {
    if (!toolNames.has(call.name)) {
      throw new ScenarioError(`${field}.expect.toolsCalled names "${call.name}", which is not offered.`);
    }
  }
  for (const name of expect.toolsNotCalled ?? []) {
    if (!toolNames.has(name)) {
      throw new ScenarioError(`${field}.expect.toolsNotCalled names "${name}", which is not offered.`);
    }
  }
  for (const id2 of expect.cites ?? []) {
    if (!citationIds.has(id2)) {
      throw new ScenarioError(`${field}.expect.cites names "${id2}", which no fixture carries.`);
    }
  }
  const safetyCitable =
    knowledge.some((hit) => hit.citation.safety === true) ||
    tools.some((tool) => (tool.citations ?? []).some((citation) => citation.safety === true));
  if (expect.safetyNotice === true && !safetyCitable) {
    throw new ScenarioError(
      `${field}.expect.safetyNotice is true but no knowledge fixture is marked safety.`,
    );
  }

  const modelContextTokens =
    record["modelContextTokens"] === undefined
      ? undefined
      : asPositiveInteger(record["modelContextTokens"], `${field}.modelContextTokens`);

  return {
    id,
    title: asString(record["title"], `${field}.title`),
    locale,
    conversation,
    tools,
    knowledge,
    confirmations,
    maxSteps,
    expect,
    script,
    ...optional(modelContextTokens, "modelContextTokens"),
  };
}

/**
 * One `scenarios/*.json` file: `{ "scenarios": [ ... ] }`. A file that holds a
 * bare array or a single object is refused, so a mis-shaped file names itself
 * instead of being read as a scenario with no `id`.
 */
export function parseScenarioFile(value: unknown, source: string): readonly Scenario[] {
  const record = asRecord(value, source);
  asKeys(record, ["scenarios"], source);
  const scenarios = asArray(record["scenarios"], `${source}.scenarios`).map((entry, index) =>
    parseScenario(entry, `${source}.scenarios[${index}]`),
  );
  if (scenarios.length === 0) {
    throw new ScenarioError(`${source}.scenarios is empty.`);
  }
  return scenarios;
}
