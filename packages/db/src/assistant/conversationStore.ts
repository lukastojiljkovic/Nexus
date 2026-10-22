import type Database from "better-sqlite3-multiple-ciphers";
import {
  MAX_ID_LENGTH,
  type AppLocation,
  type Citation,
  type ModelTier,
  type SourceKind,
  type ToolCall,
} from "@nexus/core";
import { DatabaseError } from "../errors.js";
import { isDateTime } from "../finance/money.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/**
 * THE ASSISTANT'S CONVERSATIONS (migration 91, ADR-106).
 *
 * **What this store is.** The threads a person had with the local assistant:
 * a title, the two instants a list sorts and shows by, the model that last
 * answered, and the messages - the user's own words, the assistant's replies,
 * the citations each reply drew on, the tool calls it asked for and whether each
 * of those tools did the thing (migration 93's `ok`). It writes to the profile's
 * encrypted database, scoped by `profile_id`, like every store in this package,
 * and it is the module's only arm of the archive (`exportData` / `importData`),
 * so a restored profile gets its threads back.
 *
 * **Why the store owns the validation.** The renderer is untrusted (SEC-EL-02)
 * and an archive is a file somebody may have edited, so every value is read
 * through one reader - `parseAssistantExport` for a whole section, and the
 * field readers below for the fields of one message. The module's own
 * `register.ts` validates the wire; this store validates what it is about to
 * write and what it is about to hand out, because a row that came in from a
 * restore did not pass through the wire at all.
 *
 * **Why the JSON columns are validated structurally rather than kept opaque.**
 * A citation's `kind` decides which page a click opens and a tool call's
 * `name` decides which tool a thread replays, so a row carrying an unreadable
 * one is a broken thread. Reading them here means `listMessages` answers a shape
 * the page can draw without a second check, and it is why the export type
 * carries them as parsed values rather than as text.
 *
 * **Sorting is by time, not by name.** A conversation list is a diary: the one
 * you want is nearly always the last one you touched, so it is ordered by
 * `updated_at` descending and ties break by id. That is why this file has no
 * `Intl.Collator` - the house rule for Serbian collation applies to a list of
 * NAMES, and a thread's own title is not what its position means.
 */

/** The schema of one archive section. A new shape is a new number, never a quiet reinterpretation. */
export const ASSISTANT_EXPORT_VERSION = 1;

/** A conversation's title, as the page writes it and the list shows it. */
export const MAX_CONVERSATION_TITLE_LENGTH = 120;

/** The most conversations one profile keeps. A list is for finding a thread, not for keeping an archive of them. */
export const MAX_CONVERSATIONS = 500;

/** The most messages one conversation holds. A local model's context is a few thousand tokens; this is far past the point a thread stops being replayed. */
export const MAX_MESSAGES_PER_CONVERSATION = 2000;

/** One message's text, in characters. A pasted document is the case the bound is for. */
export const MAX_MESSAGE_CHARS = 32_000;

/** The most citations one message may carry, and the most tool calls one asked for. */
export const MAX_MESSAGE_CITATIONS = 64;
export const MAX_MESSAGE_TOOL_CALLS = 32;

/** The most one message's JSON columns may take, together. */
export const MAX_MESSAGE_JSON_CHARS = 64_000;

/** The tiers a profile's default model may be picked from. */
export const ASSISTANT_TIERS: readonly ModelTier[] = ["intelligence", "balance", "speed"];

/**
 * Every source kind a citation may name: the contract's own union, restated as a
 * runtime set, PLUS `"web"`.
 *
 * `"web"` is not a `SourceKind`, and that is not an oversight here: the web
 * service widens the contract's type by one member (`main/assistant/web/citation.ts`
 * records the decision and the single cast that carries it) because a SearXNG or
 * Brave result is not a pack, a note, a task, a file, the manual or a wiki page,
 * and typing it as one of those would put a wrong label on a source the user may
 * click. A store that refused the value would make a conversation mentioning a
 * web page impossible to save, so the runtime set admits it and the row keeps
 * what the loop produced.
 */
const SOURCE_KINDS: ReadonlySet<string> = new Set<string>([
  "app-manual",
  "note",
  "task",
  "event",
  "file",
  "pack",
  "wiki",
  "web",
]);

/** Thrown when a write is refused at the store boundary: a title, a message, a citation or a bound the schema states. */
export class AssistantValidationError extends DatabaseError {}

/** Thrown when an operation names a conversation that is not a row of THIS profile. */
export class AssistantNotFoundError extends DatabaseError {}

/** One thread, as the list and the page read it. */
export interface AssistantConversation {
  id: string;
  profileId: string;
  title: string;
  /** The model that last answered in it, or `null` before the first answer. */
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One message of a thread, with its JSON columns already read. */
export interface AssistantMessage {
  id: string;
  profileId: string;
  conversationId: string;
  ordinal: number;
  role: AssistantRole;
  text: string;
  citations: Citation[];
  toolCalls: ToolCall[] | null;
  toolCallId: string | null;
  /**
   * On a tool message: whether the tool did the thing it was asked to, or
   * `undefined` when the row records no outcome at all - every row written
   * before migration 93's column existed. Absent on every other role, which has
   * no outcome to record.
   */
  ok?: boolean;
  /** True when one of `citations` came from a `notice: "safety"` pack. */
  safety: boolean;
  createdAt: string;
}

/** The three roles a stored message may have. The loop's own `system` is deliberately not one of them. */
export type AssistantRole = "user" | "assistant" | "tool";

/** What appending one turn takes: the messages, in order. */
export interface AssistantMessageInput {
  readonly role: AssistantRole;
  readonly text: string;
  readonly citations?: readonly Citation[];
  readonly toolCalls?: readonly ToolCall[];
  readonly toolCallId?: string;
  /** On a tool message: whether it did the thing. Absent means "no outcome recorded". */
  readonly ok?: boolean;
}

/** The module's own profile preferences. */
export interface AssistantSettings {
  /** Which of the three recommendations a new turn takes its model from. */
  readonly defaultTier: ModelTier;
  /**
   * The installed chat model this profile answers with by hand, or `null` when
   * the tier decides. `setDefaultTier` clears it, and it is device data that
   * never travels in an archive - the model file lives on this machine.
   */
  readonly chatModelId: string | null;
}

/**
 * How this profile's chat model is loaded and sampled (migration 98). Every
 * `null` is "the model's own": the load keeps the catalogue's context cap, and
 * the sampler keeps the entry's and the library's defaults. Device data, as
 * `chatModelId` is: the archive does not carry it.
 */
export interface AssistantRuntimeOptions {
  /** The context the model is loaded with, in tokens; still capped by what it was trained on. */
  readonly contextTokens: number | null;
  readonly temperature: number | null;
  readonly topP: number | null;
  readonly topK: number | null;
  readonly repeatPenalty: number | null;
  /** Minutes with nothing asked before the model leaves memory; `0` is never. */
  readonly idleUnloadMinutes: number;
}

/**
 * The bounds a runtime option is held to. The sampling ranges are the ones the
 * engine's wire accepts (`protocol.ts`); the context runs from the smallest
 * window a tool-calling turn fits in to the largest any catalogued model is
 * trained on, and the idle unload to a day.
 */
export const ASSISTANT_RUNTIME_LIMITS = {
  contextTokens: { min: 2048, max: 131_072, integer: true },
  temperature: { min: 0, max: 4, integer: false },
  topP: { min: 0, max: 1, integer: false },
  topK: { min: 0, max: 1000, integer: true },
  repeatPenalty: { min: 1, max: 4, integer: false },
  idleUnloadMinutes: { min: 0, max: 1440, integer: true },
} as const;

/** What a profile with no row answers: the model's own everything, and fifteen idle minutes. */
export const DEFAULT_ASSISTANT_RUNTIME: AssistantRuntimeOptions = {
  contextTokens: null,
  temperature: null,
  topP: null,
  topK: null,
  repeatPenalty: null,
  idleUnloadMinutes: 15,
};

/** One conversation as an archive carries it: its rows, without this database's keys. */
export interface ExportedAssistantMessage {
  readonly role: AssistantRole;
  readonly text: string;
  readonly citations: readonly Citation[];
  readonly toolCalls?: readonly ToolCall[];
  readonly toolCallId?: string;
  /**
   * On a tool message: whether it did the thing, absent when the archive was
   * written before migration 93 - which `parseAssistantExport` accepts, and
   * which `importData` writes as NULL.
   */
  readonly ok?: boolean;
  readonly createdAt: string;
}

/** One conversation as an archive carries it. Ids are re-minted on import, so they do not travel. */
export interface ExportedAssistantConversation {
  readonly title: string;
  readonly modelId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: readonly ExportedAssistantMessage[];
}

/** The whole section: the profile's threads and its one preference. */
export interface AssistantExport {
  readonly version: number;
  readonly defaultTier: ModelTier;
  readonly conversations: readonly ExportedAssistantConversation[];
}

interface ConversationRow {
  id: string;
  profile_id: string;
  title: string;
  model_id: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  profile_id: string;
  conversation_id: string;
  ordinal: number;
  role: string;
  text: string;
  citations_json: string;
  tool_calls_json: string | null;
  tool_call_id: string | null;
  ok: number | null;
  safety: number;
  created_at: string;
}

function conversationFromRow(row: ConversationRow): AssistantConversation {
  return {
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    modelId: row.model_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Reading one value, from the wire or from an archive ----------------------

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AssistantValidationError(`Assistant data: "${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value)) {
    throw new AssistantValidationError(`Assistant data: "${field}" must be an array.`);
  }
  if (value.length > max) {
    throw new AssistantValidationError(
      `Assistant data: "${field}" may hold at most ${max} entries.`,
    );
  }
  return value;
}

/** A bounded non-empty string: an id, a title, a name. */
function asText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new AssistantValidationError(`Assistant data: "${field}" must be a string.`);
  }
  if (value.length === 0 || value.length > max) {
    throw new AssistantValidationError(
      `Assistant data: "${field}" must be 1..${max} characters.`,
    );
  }
  return value;
}

function asOptionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  return asText(value, field, max);
}

function asInstant(value: unknown, field: string): string {
  const text = asText(value, field, 40);
  if (!isDateTime(text)) {
    throw new AssistantValidationError(`Assistant data: "${field}" is not an instant.`);
  }
  return text;
}

function asRole(value: unknown, field: string): AssistantRole {
  if (value !== "user" && value !== "assistant" && value !== "tool") {
    throw new AssistantValidationError(
      `Assistant data: "${field}" must be one of user, assistant, tool.`,
    );
  }
  return value;
}

function asTier(value: unknown, field: string): ModelTier {
  if (value !== "intelligence" && value !== "balance" && value !== "speed") {
    throw new AssistantValidationError(
      `Assistant data: "${field}" must be one of ${ASSISTANT_TIERS.join(", ")}.`,
    );
  }
  return value;
}

/** Where a citation opens: a module page, optionally an item inside it, and optionally a Settings card. */
function asLocation(value: unknown, field: string): AppLocation {
  const record = asRecord(value, field);
  const location: { module: string; item?: string; settings?: string } = {
    module: asText(record["module"], `${field}.module`, MAX_ID_LENGTH),
  };
  const item = asOptionalText(record["item"], `${field}.item`, MAX_ID_LENGTH);
  const settings = asOptionalText(record["settings"], `${field}.settings`, MAX_ID_LENGTH);
  if (item !== null) location.item = item;
  if (settings !== null) location.settings = settings;
  return location;
}

/** One citation, as the loop put it on a message event. */
function asCitation(value: unknown, field: string): Citation {
  const record = asRecord(value, field);
  const kind = record["kind"];
  if (typeof kind !== "string" || !SOURCE_KINDS.has(kind)) {
    throw new AssistantValidationError(`Assistant data: "${field}.kind" is not a source kind.`);
  }
  const citation: {
    kind: SourceKind;
    id: string;
    title: string;
    locator?: string;
    packId?: string;
    safety?: boolean;
    location?: AppLocation;
  } = {
    kind: kind as SourceKind,
    id: asText(record["id"], `${field}.id`, MAX_ID_LENGTH),
    title: asText(record["title"], `${field}.title`, 400),
  };
  const locator = asOptionalText(record["locator"], `${field}.locator`, 400);
  const packId = asOptionalText(record["packId"], `${field}.packId`, MAX_ID_LENGTH);
  if (locator !== null) citation.locator = locator;
  if (packId !== null) citation.packId = packId;
  if (record["safety"] === true) citation.safety = true;
  if (record["location"] !== undefined && record["location"] !== null) {
    citation.location = asLocation(record["location"], `${field}.location`);
  }
  return citation;
}

/** One tool call, as the model asked for it. `arguments` stays exactly as the model sent it. */
function asToolCall(value: unknown, field: string): ToolCall {
  const record = asRecord(value, field);
  return {
    id: asText(record["id"], `${field}.id`, MAX_ID_LENGTH),
    name: asText(record["name"], `${field}.name`, MAX_ID_LENGTH),
    arguments: record["arguments"] ?? null,
  };
}

function asCitations(value: unknown, field: string): Citation[] {
  return asArray(value, field, MAX_MESSAGE_CITATIONS).map((entry, index) =>
    asCitation(entry, `${field}[${index}]`),
  );
}

function asToolCalls(value: unknown, field: string): ToolCall[] {
  return asArray(value, field, MAX_MESSAGE_TOOL_CALLS).map((entry, index) =>
    asToolCall(entry, `${field}[${index}]`),
  );
}

function asMessageText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new AssistantValidationError(`Assistant data: "${field}" must be a string.`);
  }
  if (value.length > MAX_MESSAGE_CHARS) {
    throw new AssistantValidationError(
      `Assistant data: "${field}" may not exceed ${MAX_MESSAGE_CHARS} characters.`,
    );
  }
  return value;
}

function asModelId(value: unknown, field: string): string | null {
  return asOptionalText(value, field, MAX_ID_LENGTH);
}

/** One runtime option inside its bounds; `null` only where "the model's own" is a value. */
function asRuntimeValue(
  value: unknown,
  field: keyof AssistantRuntimeOptions,
  nullable: boolean,
): number | null {
  if (value === null && nullable) return null;
  const { min, max, integer } = ASSISTANT_RUNTIME_LIMITS[field];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value)) ||
    value < min ||
    value > max
  ) {
    throw new AssistantValidationError(
      `Assistant data: "${field}" must be ${integer ? "a whole number" : "a number"} from ${min} to ${max}${nullable ? ", or null" : ""}.`,
    );
  }
  return value;
}

function asRuntimeOptions(value: AssistantRuntimeOptions): AssistantRuntimeOptions {
  return {
    contextTokens: asRuntimeValue(value.contextTokens, "contextTokens", true),
    temperature: asRuntimeValue(value.temperature, "temperature", true),
    topP: asRuntimeValue(value.topP, "topP", true),
    topK: asRuntimeValue(value.topK, "topK", true),
    repeatPenalty: asRuntimeValue(value.repeatPenalty, "repeatPenalty", true),
    idleUnloadMinutes: asRuntimeValue(value.idleUnloadMinutes, "idleUnloadMinutes", false) as number,
  };
}

/** A tool result's outcome: `true`, `false`, or `undefined` where none is recorded. */
function asToolOutcome(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new AssistantValidationError(`Assistant data: "${field}" must be a boolean.`);
  }
  return value;
}

/** One message's outcome as the column keeps it: `1`/`0` where one was recorded, NULL where none was. */
function okColumn(message: { readonly ok?: boolean }): number | null {
  if (message.ok === undefined) return null;
  return message.ok ? 1 : 0;
}

/** One message, read whole: what a row and an archive entry both have to be. */
function asMessageInput(value: unknown, field: string): AssistantMessageInput {
  const record = asRecord(value, field);
  const role = asRole(record["role"], `${field}.role`);
  const message: {
    role: AssistantRole;
    text: string;
    citations?: Citation[];
    toolCalls?: ToolCall[];
    toolCallId?: string;
    ok?: boolean;
  } = {
    role,
    text: asMessageText(record["text"], `${field}.text`),
    citations:
      record["citations"] === undefined ? [] : asCitations(record["citations"], `${field}.citations`),
  };
  if (record["toolCalls"] !== undefined && record["toolCalls"] !== null) {
    message.toolCalls = asToolCalls(record["toolCalls"], `${field}.toolCalls`);
  }
  const toolCallId = asOptionalText(record["toolCallId"], `${field}.toolCallId`, MAX_ID_LENGTH);
  if (toolCallId !== null) message.toolCallId = toolCallId;
  const ok = asToolOutcome(record["ok"], `${field}.ok`);
  if (ok !== undefined) message.ok = ok;
  // The two halves of a tool exchange, refused where they cannot be true: only an
  // assistant message asks for calls, and only a tool message answers one. A row
  // that carried the wrong half would replay into a request the model could not
  // read.
  if (role === "assistant" && message.toolCallId !== undefined) {
    throw new AssistantValidationError(
      `Assistant data: "${field}.toolCallId" belongs on a tool message.`,
    );
  }
  if (role === "tool" && (message.toolCallId === undefined || message.toolCallId === "")) {
    throw new AssistantValidationError(
      `Assistant data: "${field}.toolCallId" is required on a tool message.`,
    );
  }
  // An outcome is the same kind of half: only a tool result HAS one, so a row
  // that named one elsewhere would be a claim its reader has to decide to
  // ignore (migration 93).
  if (role !== "tool" && message.ok !== undefined) {
    throw new AssistantValidationError(`Assistant data: "${field}.ok" belongs on a tool message.`);
  }
  return message;
}

/** One conversation, read whole, as an archive carries it. */
function asExportedConversation(value: unknown, field: string): ExportedAssistantConversation {
  const record = asRecord(value, field);
  const messages = asArray(record["messages"], `${field}.messages`, MAX_MESSAGES_PER_CONVERSATION).map(
    (entry, index) => {
      const message = asMessageInput(entry, `${field}.messages[${index}]`);
      const at = asInstant(
        asRecord(entry, `${field}.messages[${index}]`)["createdAt"],
        `${field}.messages[${index}].createdAt`,
      );
      return {
        role: message.role,
        text: message.text,
        citations: message.citations ?? [],
        ...(message.toolCalls === undefined ? {} : { toolCalls: message.toolCalls }),
        ...(message.toolCallId === undefined ? {} : { toolCallId: message.toolCallId }),
        ...(message.ok === undefined ? {} : { ok: message.ok }),
        createdAt: at,
      };
    },
  );
  return {
    title: asText(record["title"], `${field}.title`, MAX_CONVERSATION_TITLE_LENGTH),
    modelId: asModelId(record["modelId"], `${field}.modelId`),
    createdAt: asInstant(record["createdAt"], `${field}.createdAt`),
    updatedAt: asInstant(record["updatedAt"], `${field}.updatedAt`),
    messages,
  };
}

/**
 * Reads one archive section, completely, or throws.
 *
 * Total and pure: no database, no clock, nothing written. The kit runs it at the
 * restore's PREVIEW (so a refusal reaches the user before their profile is
 * replaced) and again before any module writes, so a plan confirmed against one
 * build cannot be applied by another.
 */
export function parseAssistantExport(value: unknown): AssistantExport {
  const record = asRecord(value, "payload");
  if (record["version"] !== ASSISTANT_EXPORT_VERSION) {
    throw new AssistantValidationError(
      `The assistant's conversations were written by another version of this module ` +
        `(found ${String(record["version"])}, expected ${ASSISTANT_EXPORT_VERSION}).`,
    );
  }
  const conversations = asArray(
    record["conversations"],
    "conversations",
    MAX_CONVERSATIONS,
  ).map((entry, index) => asExportedConversation(entry, `conversations[${index}]`));
  return {
    version: ASSISTANT_EXPORT_VERSION,
    defaultTier: asTier(record["defaultTier"], "defaultTier"),
    conversations,
  };
}

/** The section a restore applies when the archive names none: no threads, and the shipped tier. */
export function emptyAssistantExport(): AssistantExport {
  return { version: ASSISTANT_EXPORT_VERSION, defaultTier: "balance", conversations: [] };
}

/**
 * THE ASSISTANT'S STORAGE, as the module's main half reaches it.
 *
 * Every write takes the instant it is stamped with rather than reading a clock,
 * on this package's rule: a test moves the clock, production passes `Date.now()`.
 */
export class ConversationStore {
  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {}

  // --- Conversations ---------------------------------------------------------

  /** Newest first, ties by id: a thread's position is when it was last written. */
  listConversations(): AssistantConversation[] {
    const rows = this.db
      .prepare(
        `SELECT id, profile_id, title, model_id, created_at, updated_at
           FROM assistant_conversations
          WHERE profile_id = ?
          ORDER BY updated_at DESC, id DESC`,
      )
      .all(this.profileId) as ConversationRow[];
    return rows.map(conversationFromRow);
  }

  conversation(id: string): AssistantConversation | null {
    const row = this.db
      .prepare(
        `SELECT id, profile_id, title, model_id, created_at, updated_at
           FROM assistant_conversations
          WHERE id = ? AND profile_id = ?`,
      )
      .get(id, this.profileId) as ConversationRow | undefined;
    return row === undefined ? null : conversationFromRow(row);
  }

  createConversation(title: string, now: string): AssistantConversation {
    const name = this.validTitle(title);
    const stamp = this.validInstant(now);
    const existing = this.db
      .prepare("SELECT count(*) AS n FROM assistant_conversations WHERE profile_id = ?")
      .get(this.profileId) as { n: number };
    if (existing.n >= MAX_CONVERSATIONS) {
      throw new AssistantValidationError(
        `A profile keeps at most ${MAX_CONVERSATIONS} conversations.`,
      );
    }
    const id = uuidv7();
    this.db
      .prepare(
        `INSERT INTO assistant_conversations
           (id, profile_id, title, model_id, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?)`,
      )
      .run(id, this.profileId, name, stamp, stamp);
    return this.requireConversation(id);
  }

  renameConversation(id: string, title: string, now: string): AssistantConversation {
    const name = this.validTitle(title);
    const stamp = this.validInstant(now);
    const result = this.db
      .prepare(
        `UPDATE assistant_conversations
            SET title = ?, updated_at = ?
          WHERE id = ? AND profile_id = ?`,
      )
      .run(name, stamp, id, this.profileId);
    if (result.changes === 0) throw new AssistantNotFoundError(`No conversation "${id}".`);
    return this.requireConversation(id);
  }

  /**
   * Removes a thread and its messages.
   *
   * A hard delete rather than a soft one, and deliberately: a soft-deleted thread
   * is a thread the archive would carry back, and "delete this conversation"
   * means exactly that - the rows go, and `ON DELETE CASCADE` takes the messages
   * with them.
   */
  removeConversation(id: string): void {
    const result = this.db
      .prepare("DELETE FROM assistant_conversations WHERE id = ? AND profile_id = ?")
      .run(id, this.profileId);
    if (result.changes === 0) throw new AssistantNotFoundError(`No conversation "${id}".`);
  }

  // --- Messages --------------------------------------------------------------

  /** One thread's messages, in order. An empty thread is an empty list. */
  listMessages(conversationId: string): AssistantMessage[] {
    const rows = this.db
      .prepare(
        `SELECT id, profile_id, conversation_id, ordinal, role, text, citations_json,
                tool_calls_json, tool_call_id, ok, safety, created_at
           FROM assistant_messages
          WHERE profile_id = ? AND conversation_id = ?
          ORDER BY ordinal ASC`,
      )
      .all(this.profileId, conversationId) as MessageRow[];
    return rows.map((row) => this.messageFromRow(row));
  }

  /**
   * Appends the messages of one finished turn, in order, and stamps the thread.
   *
   * The ordinals continue from the thread's own last row rather than from a count
   * the caller kept: a page that appended a turn it had drawn would otherwise
   * write the same ordinals twice. `modelId` is written only when it is given,
   * because a turn that failed before a model was loaded has nothing to say about
   * what answered.
   */
  appendTurn(
    conversationId: string,
    messages: readonly AssistantMessageInput[],
    modelId: string | null,
    now: string,
  ): AssistantMessage[] {
    if (messages.length === 0) return [];
    const stamp = this.validInstant(now);
    this.requireConversation(conversationId);
    const read = messages.map((message, index) =>
      asMessageInput(message, `messages[${index}]`),
    );
    const counted = this.db
      .prepare(
        "SELECT count(*) AS n FROM assistant_messages WHERE profile_id = ? AND conversation_id = ?",
      )
      .get(this.profileId, conversationId) as { n: number };
    if (counted.n + read.length > MAX_MESSAGES_PER_CONVERSATION) {
      throw new AssistantValidationError(
        `A conversation holds at most ${MAX_MESSAGES_PER_CONVERSATION} messages.`,
      );
    }
    const start = this.db
      .prepare(
        `SELECT coalesce(max(ordinal), -1) AS last FROM assistant_messages
          WHERE profile_id = ? AND conversation_id = ?`,
      )
      .get(this.profileId, conversationId) as { last: number };

    this.db.transaction(() => {
      const insert = this.db.prepare(
        `INSERT INTO assistant_messages
           (id, profile_id, conversation_id, ordinal, role, text, citations_json,
            tool_calls_json, tool_call_id, ok, safety, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      read.forEach((message, index) => {
        const citations = message.citations ?? [];
        const citationsJson = JSON.stringify(citations);
        const toolCallsJson =
          message.toolCalls === undefined ? null : JSON.stringify(message.toolCalls);
        if (citationsJson.length + (toolCallsJson?.length ?? 0) > MAX_MESSAGE_JSON_CHARS) {
          throw new AssistantValidationError(
            `One message's citations and tool calls may not exceed ${MAX_MESSAGE_JSON_CHARS} characters.`,
          );
        }
        insert.run(
          uuidv7(),
          this.profileId,
          conversationId,
          start.last + 1 + index,
          message.role,
          message.text,
          citationsJson,
          toolCallsJson,
          message.toolCallId ?? null,
          okColumn(message),
          citations.some((citation) => citation.safety === true) ? 1 : 0,
          stamp,
        );
      });
      this.db
        .prepare(
          `UPDATE assistant_conversations
              SET updated_at = ?, model_id = coalesce(?, model_id)
            WHERE id = ? AND profile_id = ?`,
        )
        .run(stamp, modelId, conversationId, this.profileId);
    })();
    return this.listMessages(conversationId);
  }

  // --- Settings --------------------------------------------------------------

  /**
   * A profile with no row answers the shipped tier and no chosen model, which is
   * the only place either is written down.
   */
  settings(): AssistantSettings {
    const row = this.db
      .prepare("SELECT default_tier, chat_model_id FROM assistant_settings WHERE profile_id = ?")
      .get(this.profileId) as
      | { default_tier: string; chat_model_id: string | null }
      | undefined;
    if (row === undefined) return { defaultTier: "balance", chatModelId: null };
    return {
      defaultTier: asTier(row.default_tier, "default_tier"),
      chatModelId: asModelId(row.chat_model_id, "chat_model_id"),
    };
  }

  /**
   * Writes the tier a new turn starts from, and CLEARS any chosen model with it.
   *
   * Choosing a tier is choosing the tier's own pick again: a profile that kept
   * both would have a choice the tier could never reach, so the two are one
   * write rather than two states that can disagree.
   */
  setDefaultTier(tier: ModelTier, now: string): AssistantSettings {
    const stamp = this.validInstant(now);
    const value = asTier(tier, "defaultTier");
    this.db
      .prepare(
        `INSERT INTO assistant_settings (profile_id, default_tier, chat_model_id, updated_at)
         VALUES (?, ?, NULL, ?)
         ON CONFLICT (profile_id) DO UPDATE SET default_tier = excluded.default_tier,
                                                chat_model_id = NULL,
                                                updated_at = excluded.updated_at`,
      )
      .run(this.profileId, value, stamp);
    return { defaultTier: value, chatModelId: null };
  }

  /**
   * Writes the one installed model this profile answers with, or clears it with
   * `null`.
   *
   * The id is written as it is and not against the installed list: which files
   * are on this machine is main's question (`AssistantProfile.chatModelEntry`
   * reads it, and the module's handler refuses an id that is not installed), and
   * a store that consulted a runtime would be a store with a runtime in it.
   */
  setChatModel(id: string | null, now: string): AssistantSettings {
    const stamp = this.validInstant(now);
    const value = asModelId(id, "chatModelId");
    this.db
      .prepare(
        `INSERT INTO assistant_settings (profile_id, default_tier, chat_model_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (profile_id) DO UPDATE SET chat_model_id = excluded.chat_model_id,
                                                updated_at = excluded.updated_at`,
      )
      // The shipped tier, for the row this write may be the first to create: a
      // profile that only ever chose a model still answers `balance` when the
      // choice is cleared, which is what `settings()` answers with no row at all.
      .run(this.profileId, "balance", value, stamp);
    return this.settings();
  }

  /** How the chat model is loaded and sampled; a profile with no row answers the defaults. */
  runtimeOptions(): AssistantRuntimeOptions {
    const row = this.db
      .prepare(
        `SELECT context_tokens, temperature, top_p, top_k, repeat_penalty, idle_unload_minutes
           FROM assistant_settings WHERE profile_id = ?`,
      )
      .get(this.profileId) as
      | {
          context_tokens: number | null;
          temperature: number | null;
          top_p: number | null;
          top_k: number | null;
          repeat_penalty: number | null;
          idle_unload_minutes: number;
        }
      | undefined;
    if (row === undefined) return DEFAULT_ASSISTANT_RUNTIME;
    return asRuntimeOptions({
      contextTokens: row.context_tokens,
      temperature: row.temperature,
      topP: row.top_p,
      topK: row.top_k,
      repeatPenalty: row.repeat_penalty,
      idleUnloadMinutes: row.idle_unload_minutes,
    });
  }

  /**
   * Writes all six options at once, so a reset is writing `null` back; the tier
   * and the chosen model on the same row are left as they are.
   */
  setRuntimeOptions(options: AssistantRuntimeOptions, now: string): AssistantRuntimeOptions {
    const stamp = this.validInstant(now);
    const value = asRuntimeOptions(options);
    this.db
      .prepare(
        `INSERT INTO assistant_settings (profile_id, default_tier, chat_model_id, updated_at,
                                         context_tokens, temperature, top_p, top_k, repeat_penalty,
                                         idle_unload_minutes)
         VALUES (?, 'balance', NULL, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (profile_id) DO UPDATE SET context_tokens = excluded.context_tokens,
                                                temperature = excluded.temperature,
                                                top_p = excluded.top_p,
                                                top_k = excluded.top_k,
                                                repeat_penalty = excluded.repeat_penalty,
                                                idle_unload_minutes = excluded.idle_unload_minutes,
                                                updated_at = excluded.updated_at`,
      )
      .run(
        this.profileId,
        stamp,
        value.contextTokens,
        value.temperature,
        value.topP,
        value.topK,
        value.repeatPenalty,
        value.idleUnloadMinutes,
      );
    return value;
  }

  // --- The archive -----------------------------------------------------------

  /**
   * The whole section: every thread with its messages, and the tier.
   *
   * The chosen model is deliberately NOT here. It names a file on THIS machine
   * (`chat_model_id` says why the column holds an id rather than a path), and an
   * archive that carried it would restore a choice for a model the machine it is
   * restored onto may not have - so `importData` leaves the choice NULL and the
   * profile answers from its tier again.
   */
  exportData(): AssistantExport {
    const conversations = this.listConversations().map((conversation) => ({
      title: conversation.title,
      modelId: conversation.modelId,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: this.listMessages(conversation.id).map((message) => ({
        role: message.role,
        text: message.text,
        citations: message.citations,
        ...(message.toolCalls === null ? {} : { toolCalls: message.toolCalls }),
        ...(message.toolCallId === null ? {} : { toolCallId: message.toolCallId }),
        ...(message.ok === undefined ? {} : { ok: message.ok }),
        createdAt: message.createdAt,
      })),
    }));
    return {
      version: ASSISTANT_EXPORT_VERSION,
      defaultTier: this.settings().defaultTier,
      conversations,
    };
  }

  /**
   * Replaces this profile's threads and its tier with one archive section.
   *
   * `undefined` is an archive that says nothing about this module, which for a
   * restore that replaces a profile whole means EMPTY: every row goes, and the
   * settings row with it, so the profile answers the shipped tier again. The
   * whole write is one transaction, so a section that fails halfway leaves
   * nothing of itself behind. The chosen model is not restored with the tier -
   * the archive does not carry it, so the row arrives with the column NULL and
   * the profile answers from its tier again. The runtime options are device
   * data on the same row, so they arrive as the defaults.
   *
   * Ids are re-minted rather than restored: a conversation's id is this
   * database's own key, and an archive carries what the person wrote.
   */
  importData(payload: AssistantExport | undefined, now: string): void {
    const section = payload ?? emptyAssistantExport();
    const stamp = this.validInstant(now);
    // Re-read through the same reader that produced the type: a payload handed
    // in by a caller rather than parsed by the kit is still checked here.
    const parsed = parseAssistantExport(section);
    this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM assistant_messages WHERE profile_id = ?")
        .run(this.profileId);
      this.db
        .prepare("DELETE FROM assistant_conversations WHERE profile_id = ?")
        .run(this.profileId);
      this.db
        .prepare("DELETE FROM assistant_settings WHERE profile_id = ?")
        .run(this.profileId);
      for (const conversation of parsed.conversations) {
        const conversationId = uuidv7();
        this.db
          .prepare(
            `INSERT INTO assistant_conversations
               (id, profile_id, title, model_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            conversationId,
            this.profileId,
            conversation.title,
            conversation.modelId,
            conversation.createdAt,
            conversation.updatedAt,
          );
        conversation.messages.forEach((message, index) => {
          const citationsJson = JSON.stringify(message.citations);
          const toolCallsJson =
            message.toolCalls === undefined ? null : JSON.stringify(message.toolCalls);
          this.db
            .prepare(
              `INSERT INTO assistant_messages
                 (id, profile_id, conversation_id, ordinal, role, text, citations_json,
                  tool_calls_json, tool_call_id, ok, safety, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              uuidv7(),
              this.profileId,
              conversationId,
              index,
              message.role,
              message.text,
              citationsJson,
              toolCallsJson,
              message.toolCallId ?? null,
              okColumn(message),
              message.citations.some((citation) => citation.safety === true) ? 1 : 0,
              message.createdAt,
            );
        });
      }
      this.db
        .prepare(
          `INSERT INTO assistant_settings (profile_id, default_tier, updated_at)
           VALUES (?, ?, ?)`,
        )
        .run(this.profileId, parsed.defaultTier, stamp);
    })();
  }

  // --- Internals -------------------------------------------------------------

  private requireConversation(id: string): AssistantConversation {
    const conversation = this.conversation(id);
    if (conversation === null) throw new AssistantNotFoundError(`No conversation "${id}".`);
    return conversation;
  }

  private messageFromRow(row: MessageRow): AssistantMessage {
    let citations: Citation[];
    let toolCalls: ToolCall[] | null;
    try {
      citations = asCitations(JSON.parse(row.citations_json) as unknown, "citations");
      toolCalls = row.tool_calls_json === null ? null : asToolCalls(JSON.parse(row.tool_calls_json) as unknown, "toolCalls");
    } catch (error) {
      // A row this build cannot read is reported rather than drawn half-way: the
      // page would otherwise render a citation that opens the wrong place.
      throw new AssistantValidationError(
        `The message "${row.id}" holds data this build cannot read: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    return {
      id: row.id,
      profileId: row.profile_id,
      conversationId: row.conversation_id,
      ordinal: row.ordinal,
      role: asRole(row.role, "role"),
      text: row.text,
      citations,
      toolCalls,
      toolCallId: row.tool_call_id,
      ...(row.ok === null ? {} : { ok: row.ok === 1 }),
      safety: row.safety === 1,
      createdAt: row.created_at,
    };
  }

  private validTitle(raw: string): string {
    const title = raw.trim();
    if (title.length === 0 || title.length > MAX_CONVERSATION_TITLE_LENGTH) {
      throw new AssistantValidationError(
        `A title must be 1..${MAX_CONVERSATION_TITLE_LENGTH} characters.`,
      );
    }
    return title;
  }

  private validInstant(value: string): string {
    if (!isDateTime(value)) {
      throw new AssistantValidationError(`"${value}" is not an instant.`);
    }
    return value;
  }
}
