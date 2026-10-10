/**
 * The assistant's seams: the types every part of the local agent agrees on.
 *
 * The assistant is built by several parts at once: the model runtime, the
 * knowledge base, the tools, the voice, the web search, the agent loop and the
 * page. This file is the only thing they share, so each part can be written
 * and tested against these shapes alone and the module wires them together.
 * It holds types and nothing else: no part may add behaviour here, and a part
 * that needs more than a type says so by extending its own interface.
 *
 * Everything runs on the user's machine. Nothing here implies a network: the
 * only parts that may reach one are the model download (through the download
 * service, ADR-092) and the web search the user turns on, and both say so in
 * their `effect`.
 */

/** The two languages the app speaks. */
export type AssistantLocale = "sr" | "en";

/** Copy in both languages, the house shape for anything a user reads. */
export interface AssistantText {
  readonly sr: string;
  readonly en: string;
}

// --- conversation ------------------------------------------------------------

export type ChatRole = "system" | "user" | "assistant" | "tool";

/** An image attached to a message, for a model that can see. Bytes, never a path. */
export interface ChatImage {
  readonly mime: "image/png" | "image/jpeg" | "image/webp";
  readonly bytes: Uint8Array;
}

/** One call the model asks for. `arguments` is unvalidated until the tool reads it. */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
  /** On an assistant message: the calls it asked for. */
  readonly toolCalls?: readonly ToolCall[];
  /** On a tool message: the call it answers. */
  readonly toolCallId?: string;
  /** On a user message, for a model whose `capabilities` include `vision`. */
  readonly images?: readonly ChatImage[];
}

// --- the model ---------------------------------------------------------------

export type ModelCapability = "chat" | "tools" | "vision" | "embedding";

/** A model loaded in memory, as the runtime reports it. */
export interface LoadedModelInfo {
  readonly id: string;
  readonly title: string;
  readonly capabilities: readonly ModelCapability[];
  /** The context length the runtime loaded it with, in tokens. */
  readonly contextTokens: number;
}

export interface CompletionRequest {
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ToolSpec[];
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export type StopReason = "end" | "tool-calls" | "length" | "aborted";

export interface CompletionResult {
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
  readonly stopReason: StopReason;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/** A chat model. `onToken` receives the visible text as it streams. */
export interface ChatModel {
  readonly info: LoadedModelInfo;
  complete(
    request: CompletionRequest,
    signal: AbortSignal,
    onToken: (text: string) => void,
  ): Promise<CompletionResult>;
}

/** An embedding model. Vectors are L2-normalised, all of `dimensions` length. */
export interface Embedder {
  readonly modelId: string;
  readonly dimensions: number;
  embed(texts: readonly string[], signal: AbortSignal): Promise<Float32Array[]>;
}

// --- models: the catalogue, the hardware, the recommendation ------------------

export type ModelTier = "intelligence" | "balance" | "speed";

/** Where a model file came from. Only `catalogue` entries are pinned by our signature. */
export type ModelOrigin = "catalogue" | "huggingface" | "file";

export interface ModelLicence {
  /** An SPDX id where one exists, otherwise the licence's own name ("Gemma Terms of Use"). */
  readonly name: string;
  readonly url: string;
}

/** One downloadable GGUF, as the signed catalogue or a Hugging Face search describes it. */
export interface ModelEntry {
  readonly id: string;
  readonly origin: ModelOrigin;
  readonly title: string;
  readonly family: string;
  /** `owner/name` on Hugging Face. */
  readonly repo: string;
  readonly file: string;
  /** For `catalogue`: our signed hash. For `huggingface`: the hash Hugging Face publishes for the file. */
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly quantization: string;
  readonly contextTokens: number;
  readonly capabilities: readonly ModelCapability[];
  /** Language codes the model is documented to handle well; `sr` matters here. */
  readonly languages: readonly string[];
  readonly licence: ModelLicence;
  /** The vision projector a `vision` model needs beside it, when it is a separate file. */
  readonly projector?: { readonly file: string; readonly sha256: string; readonly sizeBytes: number };
}

export interface GpuInfo {
  readonly name: string;
  readonly vramBytes: number;
  readonly backend: "cuda" | "vulkan" | "metal" | "cpu";
}

export interface HardwareProfile {
  readonly totalRamBytes: number;
  readonly freeRamBytes: number;
  readonly cpuThreads: number;
  readonly gpus: readonly GpuInfo[];
}

/** One pick per tier for this machine, with the reason in both languages. */
export interface ModelRecommendation {
  readonly tier: ModelTier;
  readonly model: ModelEntry;
  readonly reason: AssistantText;
}

// --- tools -------------------------------------------------------------------

/**
 * What a tool does to the world. `read` runs without asking. `write` and
 * `network` always ask the user first, through `ToolContext.confirm`, and a
 * refusal is an answer the model receives. `navigate` moves the app's own view.
 */
export type ToolEffect = "read" | "write" | "navigate" | "network";

/** A JSON Schema object, as the model sees it. Tools validate their own input regardless. */
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface ToolSpec {
  /** `module.verb`, lower-case: `tasks.create`, `app.open`, `knowledge.search`. */
  readonly name: string;
  readonly description: AssistantText;
  readonly parameters: JsonSchema;
  readonly effect: ToolEffect;
}

export interface ConfirmRequest {
  readonly tool: string;
  /** What will happen, in the user's language, specific enough to say no to. */
  readonly summary: string;
  readonly effect: Exclude<ToolEffect, "read">;
}

export interface ToolContext {
  readonly profileId: string;
  readonly locale: AssistantLocale;
  readonly signal: AbortSignal;
  confirm(request: ConfirmRequest): Promise<boolean>;
}

export interface ToolResult {
  readonly ok: boolean;
  /** What the model reads. Text from user data or packs is DATA, never instructions. */
  readonly content: string;
  readonly citations?: readonly Citation[];
  /** Where the page should go after a `navigate` tool. */
  readonly navigateTo?: AppLocation;
}

export interface Tool extends ToolSpec {
  run(args: unknown, context: ToolContext): Promise<ToolResult>;
}

/** A place in the app the assistant can open: a module page, a settings card, an item. */
export interface AppLocation {
  readonly module: string;
  readonly item?: string;
  readonly settings?: string;
}

// --- knowledge ---------------------------------------------------------------

/** Where a passage came from. `app-manual` is the assistant's knowledge of Nexus itself. */
export type SourceKind = "app-manual" | "note" | "task" | "event" | "file" | "pack" | "wiki";

export interface Citation {
  readonly kind: SourceKind;
  readonly id: string;
  readonly title: string;
  /** A section, page or heading inside the source. */
  readonly locator?: string;
  readonly packId?: string;
  /** Set for a passage from a `notice: "safety"` pack: the answer must carry the disclaimer. */
  readonly safety?: boolean;
  /** Where opening the citation takes the user. */
  readonly location?: AppLocation;
}

export interface KnowledgeHit {
  readonly citation: Citation;
  readonly text: string;
  readonly score: number;
}

export interface KnowledgeQuery {
  readonly text: string;
  readonly kinds?: readonly SourceKind[];
  readonly limit: number;
  readonly locale: AssistantLocale;
}

export interface KnowledgeBase {
  search(query: KnowledgeQuery, signal: AbortSignal): Promise<KnowledgeHit[]>;
}

// --- voice -------------------------------------------------------------------

export interface SpeechToText {
  transcribe(
    pcm: Float32Array,
    sampleRate: number,
    language: AssistantLocale | "auto",
    signal: AbortSignal,
  ): Promise<string>;
}

export interface TextToSpeech {
  speak(
    text: string,
    language: AssistantLocale,
    signal: AbortSignal,
  ): Promise<{ readonly pcm: Float32Array; readonly sampleRate: number }>;
}

// --- the agent loop ------------------------------------------------------------

/** What one turn of the agent emits, in order, for the page to draw. */
export type AgentEvent =
  | { readonly type: "token"; readonly text: string }
  | { readonly type: "tool-call"; readonly call: ToolCall }
  | { readonly type: "tool-result"; readonly callId: string; readonly result: ToolResult }
  | { readonly type: "message"; readonly message: ChatMessage; readonly citations: readonly Citation[] }
  | { readonly type: "error"; readonly code: AgentErrorCode }
  | { readonly type: "done"; readonly stopReason: StopReason };

export type AgentErrorCode =
  | "no-model"
  | "model-failed"
  | "tool-failed"
  | "step-limit"
  | "context-full"
  | "aborted";

export interface AgentTurnInput {
  readonly history: readonly ChatMessage[];
  readonly user: ChatMessage;
  readonly locale: AssistantLocale;
  /** Tools this turn may use; web tools appear only when the user turned web search on. */
  readonly tools: readonly Tool[];
  readonly knowledge: KnowledgeBase;
  readonly model: ChatModel;
  readonly context: ToolContext;
  /** The most model calls one turn may make before it stops with `step-limit`. */
  readonly maxSteps: number;
}

/** The agent loop's signature (`packages/core/src/assistant/loop.ts` implements it). */
export type RunAgentTurn = (input: AgentTurnInput, emit: (event: AgentEvent) => void) => Promise<void>;

// --- the services the module composes ---------------------------------------------
//
// Each part exports one factory from a fixed path under
// `apps/desktop/src/main/assistant/` and the module's `main/register.ts` wires
// them together: `runtime/index.ts` → `createModelHost`, `knowledge/index.ts` →
// `createKnowledgeService`, `tools/index.ts` → `createToolRegistry`,
// `voice/index.ts` → `createVoiceService`, `web/index.ts` → `createWebService`.

export interface DownloadProgress {
  readonly receivedBytes: number;
  readonly totalBytes: number;
}

/** Models on disk and in memory. Runs in main; inference itself runs off the main thread. */
export interface ModelHost {
  hardware(): Promise<HardwareProfile>;
  /** The signed catalogue, verified with the release key; empty when it cannot be verified. */
  catalogue(): Promise<readonly ModelEntry[]>;
  recommend(hardware: HardwareProfile, catalogue: readonly ModelEntry[]): readonly ModelRecommendation[];
  /** Only in the `downloads` network mode; refused otherwise. */
  searchHuggingFace(query: string, signal: AbortSignal): Promise<readonly ModelEntry[]>;
  installed(): Promise<readonly ModelEntry[]>;
  download(entry: ModelEntry, onProgress: (progress: DownloadProgress) => void, signal: AbortSignal): Promise<void>;
  importFile(path: string): Promise<ModelEntry>;
  remove(id: string): Promise<void>;
  loadChat(id: string, signal: AbortSignal): Promise<ChatModel>;
  loadEmbedder(id: string, signal: AbortSignal): Promise<Embedder>;
  unloadAll(): Promise<void>;
}

export interface KnowledgeStatus {
  readonly indexedChunks: number;
  readonly pendingSources: number;
  readonly embedderId: string | null;
}

export interface KnowledgeService extends KnowledgeBase {
  status(): Promise<KnowledgeStatus>;
  reindex(signal: AbortSignal): Promise<void>;
}

export interface ToolRegistry {
  /** The tools a turn may use. `web` adds the web tools, only when the user turned web search on. */
  tools(options: { readonly web: boolean }): readonly Tool[];
}

/** `null` when the pack a voice needs is not installed. */
export interface VoiceService {
  speechToText(): Promise<SpeechToText | null>;
  textToSpeech(): Promise<TextToSpeech | null>;
}

export interface WebService {
  /** The web search and page-fetch tools. Each is `effect: "network"`. */
  tools(): readonly Tool[];
}
