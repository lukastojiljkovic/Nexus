/**
 * THE WORDS THE MAIN PROCESS AND ITS UTILITY PROCESS SAY TO EACH OTHER.
 *
 * The assistant's inference runs in an Electron `utilityProcess`, because
 * llama.cpp blocks the thread it is on and the thread it must not block is the
 * one that owns the window, the database and every IPC handler. That gives the
 * runtime a second process, and a second process means a wire — so this file is
 * the wire: the requests main sends, the events the worker sends back, and the
 * validators that BOTH sides run before acting on anything.
 *
 * **Both sides validate, and the reasons are different.** The worker validates
 * because it is a process, and a process receives whatever is posted to it.
 * Main validates because a worker that has gone wrong is exactly the kind of
 * sender that produces a `NaN` size or a `stopReason` nobody defined, and a
 * `ChatModel` implementation that trusts its worker would hand that straight to
 * the agent loop. Neither side assumes the other's checks succeeded.
 *
 * **The version field is load-bearing.** A `utilityProcess` is forked from a
 * FILE (`out/main/assistant-model-host.js`), and a stale copy of that file from
 * an earlier build is a real hazard on a developer's machine and on a machine
 * that updated over an old install. A mismatched version is refused with a
 * sentence that names the reason, rather than a worker that answers a request
 * it understood differently.
 *
 * **Nothing on this wire is a path from anywhere but main.** The worker is told
 * which file to load and nothing else: it has no userData, no database and no
 * network. That is the whole point of the split, and this module is where it is
 * kept — every string that crosses is bounded, and the only file names on it are
 * ones main put there.
 */

import type {
  ChatMessage,
  CompletionResult,
  GpuInfo,
  HardwareProfile,
  LoadedModelInfo,
  ModelCapability,
  ToolSpec,
} from "@nexus/core";
import { MAX_ID_LENGTH } from "@nexus/core";

/** The one protocol version this build speaks, in both directions. */
export const PROTOCOL_VERSION = 1;

/** Bounds on everything that crosses. A number here is a bound on work, not a guess at a real value. */
export const PROTOCOL_LIMITS = {
  /** Messages in one completion. The context window is the real limit; this is the sanity limit. */
  messages: 1024,
  /** Characters in one message. A knowledge passage is the largest thing that legitimately arrives. */
  messageChars: 256 * 1024,
  /** Tools offered in one completion. */
  tools: 256,
  /** Characters in a tool description, per language. */
  toolDescriptionChars: 4096,
  /** Texts in one embedding call. */
  embedTexts: 64,
  /** Characters in one text to embed. */
  embedChars: 16 * 1024,
  /** A path. Windows' own limit is 260 by policy and 32 767 by API. */
  pathChars: 4096,
  /** The largest context either side may ask for, in tokens. */
  contextTokens: 4_000_000,
  /** Reasons a `stopReason` is allowed to carry. */
  maxTokens: 4_000_000,
} as const;

/** Where a request or an event is not the shape this build speaks. */
export class ProtocolError extends Error {
  readonly code: "shape" | "version" | "kind";

  constructor(code: "shape" | "version" | "kind", message: string) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
  }
}

/** What main asks the worker to do. */
export type HostRequest =
  | { readonly v: number; readonly kind: "hardware"; readonly seq: number }
  | {
      readonly v: number;
      readonly kind: "load-chat";
      readonly seq: number;
      readonly id: string;
      readonly modelPath: string;
      readonly projectorPath?: string;
      readonly contextTokens: number;
      readonly gpuLayers: number | "auto";
      readonly threads: number;
      readonly title: string;
      readonly capabilities: readonly ModelCapability[];
    }
  | {
      readonly v: number;
      readonly kind: "load-embedder";
      readonly seq: number;
      readonly id: string;
      readonly modelPath: string;
      readonly contextTokens: number;
      readonly threads: number;
    }
  | {
      readonly v: number;
      readonly kind: "complete";
      readonly seq: number;
      readonly callId: number;
      readonly messages: readonly ChatMessage[];
      readonly tools: readonly ToolSpec[];
      readonly temperature?: number;
      readonly maxTokens?: number;
    }
  | {
      readonly v: number;
      readonly kind: "embed";
      readonly seq: number;
      readonly callId: number;
      readonly texts: readonly string[];
    }
  | { readonly v: number; readonly kind: "abort"; readonly callId: number }
  | { readonly v: number; readonly kind: "unload"; readonly seq: number };

/** Why a request failed, as a machine code the host maps to its own error. */
export type HostFailureCode =
  /** The model file could not be loaded, or there is no model to load. */
  | "load"
  /** Generation failed. */
  | "complete"
  /** Embedding failed. */
  | "embed"
  /** A user message carried images and this runtime loads no projector (ADR-096). */
  | "unsupported-images"
  /** An abort named a call that is not running. */
  | "unknown-call"
  /** The message was refused before anything was attempted. */
  | "refused"
  /** Something in the worker itself failed. */
  | "internal";

/** What the worker tells main. */
export type HostEvent =
  | { readonly v: number; readonly kind: "hardware"; readonly seq: number; readonly hardware: HardwareProfile }
  | { readonly v: number; readonly kind: "loaded"; readonly seq: number; readonly info: LoadedModelInfo }
  | {
      readonly v: number;
      readonly kind: "embedder-ready";
      readonly seq: number;
      readonly modelId: string;
      readonly dimensions: number;
    }
  | { readonly v: number; readonly kind: "unloaded"; readonly seq: number }
  | { readonly v: number; readonly kind: "token"; readonly callId: number; readonly text: string }
  | {
      readonly v: number;
      readonly kind: "result";
      readonly seq: number;
      readonly callId: number;
      readonly result: CompletionResult;
    }
  | {
      readonly v: number;
      readonly kind: "embedded";
      readonly seq: number;
      readonly callId: number;
      readonly dimensions: number;
      readonly vectors: readonly (readonly number[])[];
    }
  | {
      readonly v: number;
      readonly kind: "failed";
      readonly seq?: number;
      readonly callId?: number;
      readonly code: HostFailureCode;
      readonly message: string;
    };

const CAPABILITIES: readonly ModelCapability[] = ["chat", "tools", "vision", "embedding"];

/** The compute layers a GPU entry may name. `cpu` is the "no offload" entry. */
const BACKENDS: readonly GpuInfo["backend"][] = ["cuda", "vulkan", "metal", "cpu"];

const ROLES: readonly ChatMessage["role"][] = ["system", "user", "assistant", "tool"];

const EFFECTS: readonly ToolSpec["effect"][] = ["read", "write", "navigate", "network"];

const FAILURE_CODES: readonly HostFailureCode[] = [
  "load",
  "complete",
  "embed",
  "unsupported-images",
  "unknown-call",
  "refused",
  "internal",
];

/**
 * What main posted, or a refusal. Called by the WORKER, which trusts nothing.
 */
export function parseHostRequest(value: unknown): HostRequest {
  const record = asRecord(value, "a request");
  const kind = record["kind"];
  const v = version(record);
  switch (kind) {
    case "hardware":
      return { v, kind, seq: seq(record) };
    case "unload":
      return { v, kind, seq: seq(record) };
    case "load-chat": {
      const projectorPath = record["projectorPath"];
      return {
        v,
        kind,
        seq: seq(record),
        id: id(record),
        modelPath: path(record, "modelPath"),
        ...(projectorPath === undefined ? {} : { projectorPath: path(record, "projectorPath") }),
        contextTokens: contextTokens(record),
        gpuLayers: gpuLayers(record),
        threads: integer(record, "threads", 1, 1024),
        title: text(record["title"], "title", 200),
        capabilities: array(record["capabilities"], "capabilities", CAPABILITIES.length).map((capability) =>
          asCapability("capabilities", capability),
        ),
      };
    }
    case "load-embedder":
      return {
        v,
        kind,
        seq: seq(record),
        id: id(record),
        modelPath: path(record, "modelPath"),
        contextTokens: contextTokens(record),
        threads: integer(record, "threads", 1, 1024),
      };
    case "complete": {
      const temperature = record["temperature"];
      const maxTokens = record["maxTokens"];
      return {
        v,
        kind,
        seq: seq(record),
        callId: seq(record, "callId"),
        messages: array(record["messages"], "messages", PROTOCOL_LIMITS.messages).map((message) =>
          chatMessage(message),
        ),
        tools: array(record["tools"], "tools", PROTOCOL_LIMITS.tools).map((tool) => toolSpec(tool)),
        ...(temperature === undefined ? {} : { temperature: number(temperature, "temperature", 0, 4) }),
        ...(maxTokens === undefined
          ? {}
          : { maxTokens: integer(record, "maxTokens", 1, PROTOCOL_LIMITS.maxTokens) }),
      };
    }
    case "embed":
      return {
        v,
        kind,
        seq: seq(record),
        callId: seq(record, "callId"),
        texts: array(record["texts"], "texts", PROTOCOL_LIMITS.embedTexts).map((text) =>
          string(text, "texts", PROTOCOL_LIMITS.embedChars),
        ),
      };
    case "abort":
      return { v, kind, callId: seq(record, "callId") };
    default:
      throw new ProtocolError("kind", `A request of kind "${String(kind)}" is not one this build speaks.`);
  }
}

/**
 * What the worker posted, or a refusal. Called by MAIN, on every event, before
 * anything in it reaches the agent loop.
 */
export function parseHostEvent(value: unknown): HostEvent {
  const record = asRecord(value, "an event");
  const kind = record["kind"];
  const v = version(record);
  switch (kind) {
    case "hardware":
      return { v, kind, seq: seq(record), hardware: hardware(record["hardware"]) };
    case "loaded":
      return { v, kind, seq: seq(record), info: loadedInfo(record["info"]) };
    case "embedder-ready":
      return {
        v,
        kind,
        seq: seq(record),
        modelId: text(record["modelId"], "modelId", MAX_ID_LENGTH),
        dimensions: integer(record, "dimensions", 1, 1 << 16),
      };
    case "unloaded":
      return { v, kind, seq: seq(record) };
    case "token":
      return { v, kind, callId: seq(record, "callId"), text: string(record["text"], "text", PROTOCOL_LIMITS.messageChars) };
    case "result":
      return { v, kind, seq: seq(record), callId: seq(record, "callId"), result: completionResult(record["result"]) };
    case "embedded": {
      const dimensions = integer(record, "dimensions", 1, 1 << 16);
      const vectors = array(record["vectors"], "vectors").map((vector) =>
        array(vector, "vector").map((component) => finiteNumber(component, "vector")),
      );
      for (const vector of vectors) {
        if (vector.length !== dimensions) {
          throw new ProtocolError("shape", "An embedding vector is not the length it says it is.");
        }
      }
      return { v, kind, seq: seq(record), callId: seq(record, "callId"), dimensions, vectors };
    }
    case "failed": {
      const code = record["code"];
      if (typeof code !== "string" || !FAILURE_CODES.includes(code as HostFailureCode)) {
        throw new ProtocolError("shape", "A failure is not a failure code this build knows.");
      }
      const seqValue = record["seq"];
      const callIdValue = record["callId"];
      return {
        v,
        kind,
        ...(seqValue === undefined ? {} : { seq: seq(record) }),
        ...(callIdValue === undefined ? {} : { callId: seq(record, "callId") }),
        code: code as HostFailureCode,
        message: string(record["message"], "message", PROTOCOL_LIMITS.messageChars),
      };
    }
    default:
      throw new ProtocolError("kind", `An event of kind "${String(kind)}" is not one this build speaks.`);
  }
}

function version(record: Record<string, unknown>): number {
  if (record["v"] !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      "version",
      `The model host speaks protocol ${String(PROTOCOL_VERSION)}, and this message says ` +
        `${String(record["v"])} — a stale worker file beside a newer main process is the usual cause.`,
    );
  }
  return PROTOCOL_VERSION;
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolError("shape", `${where} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string, limit: number = Number.MAX_SAFE_INTEGER): readonly unknown[] {
  if (!Array.isArray(value)) throw new ProtocolError("shape", `"${field}" must be a list.`);
  if (value.length > limit) throw new ProtocolError("shape", `"${field}" carries more entries than this build accepts.`);
  return value;
}

function string(value: unknown, field: string, maxChars: number): string {
  if (typeof value !== "string") throw new ProtocolError("shape", `"${field}" must be a string.`);
  if (value.length > maxChars) throw new ProtocolError("shape", `"${field}" is longer than this build accepts.`);
  return value;
}

function text(value: unknown, field: string, maxChars: number): string {
  const result = string(value, field, maxChars);
  if (result === "") throw new ProtocolError("shape", `"${field}" must not be empty.`);
  return result;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ProtocolError("shape", `"${field}" must be a finite number.`);
  }
  return value;
}

function number(value: unknown, field: string, min: number, max: number): number {
  const result = finiteNumber(value, field);
  if (result < min || result > max) throw new ProtocolError("shape", `"${field}" is outside the range this build accepts.`);
  return result;
}

function integer(
  record: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ProtocolError("shape", `"${field}" must be a whole number between ${min} and ${max}.`);
  }
  return value;
}

/** A correlation id: positive, and small enough to stay a safe integer for the life of a session. */
function seq(record: Record<string, unknown>, field = "seq"): number {
  return integer(record, field, 1, Number.MAX_SAFE_INTEGER);
}

function id(record: Record<string, unknown>): string {
  const value = text(record["id"], "id", MAX_ID_LENGTH);
  if (value !== value.trim()) throw new ProtocolError("shape", '"id" is not a well-formed id.');
  return value;
}

function path(record: Record<string, unknown>, field: string): string {
  return text(record[field], field, PROTOCOL_LIMITS.pathChars);
}

function contextTokens(record: Record<string, unknown>): number {
  return integer(record, "contextTokens", 1, PROTOCOL_LIMITS.contextTokens);
}

function gpuLayers(record: Record<string, unknown>): number | "auto" {
  const value = record["gpuLayers"];
  if (value === "auto") return "auto";
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1024) return value;
  throw new ProtocolError("shape", '"gpuLayers" must be "auto" or the number of layers to offload.');
}

function asCapability(field: string, value: unknown): ModelCapability {
  if (typeof value !== "string" || !CAPABILITIES.includes(value as ModelCapability)) {
    throw new ProtocolError("shape", `"${field}" names a capability this build does not know.`);
  }
  return value as ModelCapability;
}

function chatMessage(value: unknown): ChatMessage {
  const record = asRecord(value, "a message");
  const role = record["role"];
  if (typeof role !== "string" || !ROLES.includes(role as ChatMessage["role"])) {
    throw new ProtocolError("shape", "A message has a role this build does not know.");
  }
  const content = string(record["content"], "content", PROTOCOL_LIMITS.messageChars);
  const toolCallId = record["toolCallId"];
  const toolCalls = record["toolCalls"];
  const images = record["images"];
  return {
    role: role as ChatMessage["role"],
    content,
    ...(toolCalls === undefined
      ? {}
      : {
          toolCalls: array(toolCalls, "toolCalls", PROTOCOL_LIMITS.tools).map((call) => {
            const record_ = asRecord(call, "a tool call");
            return {
              id: text(record_["id"], "toolCalls.id", MAX_ID_LENGTH),
              name: text(record_["name"], "toolCalls.name", 200),
              arguments: record_["arguments"],
            };
          }),
        }),
    ...(toolCallId === undefined ? {} : { toolCallId: text(toolCallId, "toolCallId", MAX_ID_LENGTH) }),
    // Images are validated structurally so a message that carries them is still
    // a message, and REFUSED by the engine: this runtime loads no vision model
    // (ADR-096), and silently dropping a user's picture would be worse than
    // saying so.
    ...(images === undefined
      ? {}
      : {
          images: array(images, "images", 8).map((image) => {
            const record_ = asRecord(image, "an image");
            const mime = record_["mime"];
            if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/webp") {
              throw new ProtocolError("shape", "An image has a mime type this build does not know.");
            }
            const bytes = record_["bytes"];
            if (!(bytes instanceof Uint8Array)) {
              throw new ProtocolError("shape", "An image's bytes are not bytes.");
            }
            return { mime, bytes };
          }),
        }),
  };
}

function toolSpec(value: unknown): ToolSpec {
  const record = asRecord(value, "a tool");
  const description = asRecord(record["description"], "a tool description");
  const effect = record["effect"];
  if (typeof effect !== "string" || !EFFECTS.includes(effect as ToolSpec["effect"])) {
    throw new ProtocolError("shape", "A tool has an effect this build does not know.");
  }
  return {
    name: text(record["name"], "tools.name", 200),
    description: {
      sr: text(description["sr"], "tools.description.sr", PROTOCOL_LIMITS.toolDescriptionChars),
      en: text(description["en"], "tools.description.en", PROTOCOL_LIMITS.toolDescriptionChars),
    },
    parameters: asRecord(record["parameters"], "a tool's parameters"),
    effect: effect as ToolSpec["effect"],
  };
}

function completionResult(value: unknown): CompletionResult {
  const record = asRecord(value, "a completion result");
  const stopReason = record["stopReason"];
  if (stopReason !== "end" && stopReason !== "tool-calls" && stopReason !== "length" && stopReason !== "aborted") {
    throw new ProtocolError("shape", "A completion result has a stop reason this build does not know.");
  }
  const toolCalls = array(record["toolCalls"], "toolCalls", PROTOCOL_LIMITS.tools).map((call) => {
    const record_ = asRecord(call, "a tool call");
    return {
      id: text(record_["id"], "toolCalls.id", MAX_ID_LENGTH),
      name: text(record_["name"], "toolCalls.name", 200),
      arguments: record_["arguments"],
    };
  });
  return {
    text: string(record["text"], "result.text", PROTOCOL_LIMITS.messageChars),
    toolCalls,
    stopReason,
    promptTokens: integer(record, "promptTokens", 0, PROTOCOL_LIMITS.maxTokens),
    completionTokens: integer(record, "completionTokens", 0, PROTOCOL_LIMITS.maxTokens),
  };
}

function loadedInfo(value: unknown): LoadedModelInfo {
  const record = asRecord(value, "loaded model info");
  return {
    id: text(record["id"], "info.id", MAX_ID_LENGTH),
    title: text(record["title"], "info.title", 200),
    capabilities: array(record["capabilities"], "info.capabilities").map((capability) =>
      asCapability("info.capabilities", capability),
    ),
    contextTokens: integer(record, "contextTokens", 1, PROTOCOL_LIMITS.contextTokens),
  };
}

function hardware(value: unknown): HardwareProfile {
  const record = asRecord(value, "a hardware profile");
  const gpus = array(record["gpus"], "gpus", 8).map((gpu) => {
    const record_ = asRecord(gpu, "a gpu");
    const backend = record_["backend"];
    if (typeof backend !== "string" || !BACKENDS.includes(backend as GpuInfo["backend"])) {
      throw new ProtocolError("shape", "A GPU reports a backend this build does not know.");
    }
    return {
      name: string(record_["name"], "gpus.name", 200),
      vramBytes: integer(record_, "vramBytes", 0, Number.MAX_SAFE_INTEGER),
      backend: backend as GpuInfo["backend"],
    };
  });
  if (gpus.length === 0) throw new ProtocolError("shape", "A hardware profile lists no device at all.");
  return {
    totalRamBytes: integer(record, "totalRamBytes", 1, Number.MAX_SAFE_INTEGER),
    freeRamBytes: integer(record, "freeRamBytes", 0, Number.MAX_SAFE_INTEGER),
    cpuThreads: integer(record, "cpuThreads", 1, 4096),
    gpus,
  };
}
