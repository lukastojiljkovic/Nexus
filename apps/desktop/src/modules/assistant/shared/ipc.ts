import type {
  AgentEvent,
  AssistantText,
  Citation,
  HardwareProfile,
  ModelEntry,
  ModelTier,
  ToolCall,
} from "@nexus/core";
import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * THE ASSISTANT'S CONTRACT: the channels it answers on, what each payload is, and
 * the API its page calls - declared once, in its own folder (ADR-090).
 *
 * **A turn is a request, a poll and a stop.** The kit has request/response ops
 * and no push channel, and the assistant must stream: so `send` answers a turn
 * id, `poll` answers the events after a cursor plus whether the turn is done, and
 * `stop` ends it. The page polls while a turn runs and stops when it reads
 * `done`. That is a deliberate shape rather than a limitation worked around: a
 * channel main can push on would be a second seam every kit module's bridge
 * would have to grow, and one number travelling back and forth is smaller than
 * one subscription per page.
 *
 * **A confirmation is an event, not a fourth verb.** A `write` or `network` tool
 * parks on `ToolContext.confirm`; main puts a `confirm` event in the turn's
 * buffer and the page answers it with `answerConfirm`. The contract's own
 * `AgentEvent` union has no such variant - it is the loop's vocabulary and the
 * loop never asks anything - so this module declares its own wider event type,
 * which is what ADR-095 says a part that needs more than a type does.
 *
 * **The renderer never names a model file.** `setup` and `searchModels` are the
 * only places a `ModelEntry` is produced, and main remembers every entry it has
 * offered: `downloadModel` takes an id and looks it up there. A renderer that
 * could send an entry would be sending a URL and a hash, and the whole point of
 * the download service (ADR-092) is that neither is the renderer's to choose.
 */

/** One thread as the list reads it. */
export interface AssistantConversationView {
  readonly id: string;
  readonly title: string;
  /** The model that last answered in it, or `null` before the first answer. */
  readonly modelId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One message as the page draws it: the contract's own shapes, with the JSON columns already read. */
export interface AssistantMessageView {
  readonly id: string;
  readonly role: "user" | "assistant" | "tool";
  readonly text: string;
  readonly citations: readonly Citation[];
  /** The calls an assistant message asked for, or `null`. */
  readonly toolCalls: readonly ToolCall[] | null;
  /** On a tool message: the call it answers. */
  readonly toolCallId: string | null;
  /** True when a citation came from a `notice: "safety"` pack: the page draws the notice. */
  readonly safety: boolean;
  readonly createdAt: string;
}

/** One thread with its messages. */
export interface AssistantThreadView {
  readonly conversation: AssistantConversationView;
  readonly messages: readonly AssistantMessageView[];
}

/** The device's network mode, restated for the wire: no file under `shared/` may reach main's copy of it. */
export type AssistantNetworkMode = "offline" | "updates" | "downloads";

/** The module's own settings, as the card and the page read them. */
export interface AssistantSettingsView {
  readonly defaultTier: ModelTier;
  /** The user's own consent (ADR-097), and whether this launch's mode lets it act at all. */
  readonly webSearch: {
    readonly enabled: boolean;
    readonly modeAllows: boolean;
    readonly mode: AssistantNetworkMode;
  };
}

/** What the knowledge base says about itself. */
export interface AssistantKnowledgeView {
  readonly indexedChunks: number;
  readonly pendingSources: number;
  readonly embedderId: string | null;
}

/**
 * The language the assistant speaks, restated for the wire for `AssistantNetworkMode`'s
 * reason: no file under `shared/` may reach main's own copy of it. It is the
 * app's two locales, because the assistant's speech follows the app's language.
 */
export type AssistantSpeechLanguage = "sr" | "en";

/** One installed voice pack, as the page names it in the notice and in the setup line. */
export interface AssistantVoicePackView {
  readonly id: string;
  readonly version: string;
  /** `stt` hears, `tts` speaks - the descriptor's own two kinds (ADR-105 section 5). */
  readonly kind: "stt" | "tts";
  readonly languages: readonly AssistantSpeechLanguage[];
}

/**
 * What the machine can hear and say.
 *
 * The two language lists are the QUESTION the page asks - "can I talk to it in
 * Serbian, and can it answer out loud" - and the pack list is the evidence it
 * names when the answer is no. A language is never approximated (ADR-105
 * section 5), so the page must be able to say which pack to install rather than
 * offering a button that will refuse.
 */
export interface AssistantVoiceView {
  readonly speechLanguages: readonly AssistantSpeechLanguage[];
  readonly voiceLanguages: readonly AssistantSpeechLanguage[];
  readonly packs: readonly AssistantVoicePackView[];
}

/** What one transcription answered. */
export interface AssistantTranscriptView {
  readonly text: string;
}

/** One synthesized sentence: a WAV the page plays, and its rate. */
export interface AssistantSpeechView {
  readonly bytes: Uint8Array;
  readonly sampleRate: number;
}

/** Everything one read of the list answers with. */
export interface AssistantView {
  readonly conversations: readonly AssistantConversationView[];
  readonly settings: AssistantSettingsView;
  readonly knowledge: AssistantKnowledgeView;
}

/** One of the three machine picks, with what this profile has of it. */
export interface AssistantRecommendationView {
  readonly tier: ModelTier;
  readonly model: ModelEntry;
  /** Why this one, in the user's language - the runtime's own sentence. */
  readonly reason: AssistantText;
  readonly installed: boolean;
}

/**
 * One installed model, and the tiers it is the current pick for.
 *
 * There is no "installed at" field, and the reason is a fact about the contract
 * rather than an omission: `ModelHost.installed()` answers `ModelEntry[]`, which
 * carries no install time, and inventing one here would mean reading the
 * runtime's own registry file a second time from this module.
 */
export interface AssistantInstalledView {
  readonly model: ModelEntry;
  /** Which of the three tiers this model serves on THIS machine, in tier order. */
  readonly servesTiers: readonly ModelTier[];
}

/** Everything the setup and models screens read. */
export interface AssistantSetupView {
  readonly hardware: HardwareProfile;
  /** Empty when nothing fits; `unavailable` then carries the runtime's sentence. */
  readonly recommendations: readonly AssistantRecommendationView[];
  readonly unavailable: AssistantText | null;
  readonly installed: readonly AssistantInstalledView[];
  /** The last Hugging Face search's results, or `null` when none was run this session. */
  readonly search: readonly ModelEntry[] | null;
  /** The download this profile has running or stopped, or `null`. */
  readonly download: AssistantDownloadView | null;
  readonly defaultTier: ModelTier;
  /** Whether this launch may download at all: only the `downloads` network mode may (ADR-092). */
  readonly downloadsAllowed: boolean;
  readonly networkMode: AssistantNetworkMode;
}

/**
 * What one turn emits, for the page.
 *
 * The contract's own `AgentEvent`s, plus the one this module adds: a tool asking
 * the user before it acts. `effect` is never `read` - a read never asks - and the
 * page's dialog draws `summary`, the tool's own one-line sentence in the user's
 * language.
 */
export type AssistantTurnEventView =
  | AgentEvent
  | {
      readonly type: "confirm";
      readonly requestId: string;
      readonly tool: string;
      readonly summary: string;
      readonly effect: "write" | "navigate" | "network";
    };

/** One buffered event, with the sequence number a cursor counts. */
export interface AssistantTurnEventEntry {
  readonly seq: number;
  readonly event: AssistantTurnEventView;
}

/** A model download, as its progress row reads it. */
export interface AssistantDownloadView {
  readonly model: ModelEntry;
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly status: "running" | "stopped" | "failed";
}

// --- Payloads -----------------------------------------------------------------

interface ProfilePayload {
  profileId: string;
}

interface ConversationPayload {
  profileId: string;
  conversationId: string;
}

interface CreateConversationPayload {
  profileId: string;
  title: string;
}

interface RenameConversationPayload {
  profileId: string;
  id: string;
  title: string;
}

interface SendPayload {
  profileId: string;
  conversationId: string;
  text: string;
  /** One of `ASSISTANT_WORKFLOWS`' ids, or `null` for a free question. */
  workflowId: string | null;
}

interface PollPayload {
  profileId: string;
  turnId: string;
  cursor: number;
}

interface StopPayload {
  profileId: string;
  turnId: string;
}

interface AnswerConfirmPayload {
  profileId: string;
  requestId: string;
  allow: boolean;
}

interface ModelIdPayload {
  profileId: string;
  modelId: string;
}

interface SearchModelsPayload {
  profileId: string;
  query: string;
}

interface SetTierPayload {
  profileId: string;
  tier: ModelTier;
}

interface SetWebSearchPayload {
  profileId: string;
  enabled: boolean;
}

/** Arms the microphone window just before the page captures (ADR-105, `main/micAccess.ts`). */
interface CapturePayload {
  profileId: string;
}

/**
 * One utterance, as the page captured it.
 *
 * `bytes` is a WAV the renderer encoded from its own recording - the same shape
 * the recorder's own capture travels in - and `sampleRate` is the rate the
 * capture device ran at is written INTO it, so there is no second copy of that
 * number on the wire to disagree with the file. Main resamples to the 16 kHz
 * every voice model in this build is defined at, which is the one place that
 * arithmetic lives.
 */
interface TranscribePayload {
  profileId: string;
  /** The language the user is speaking, which is the app's own. Never approximated. */
  language: AssistantSpeechLanguage;
  bytes: Uint8Array;
}

/** One sentence to speak, decided by the page as the answer streams (ADR-105 section 6). */
interface SpeakPayload {
  profileId: string;
  language: AssistantSpeechLanguage;
  text: string;
}

/** One turn's answer to `send`: the id the page polls by. */
export interface AssistantTurnStartView {
  readonly turnId: string;
}

/**
 * One poll's answer.
 *
 * `nextCursor` is the sequence number of the last event in `events`, or the
 * cursor it was given when there was nothing new - so the page's next call is
 * always `poll(turnId, nextCursor)` and no event is read twice.
 *
 * `thread` is the SAVED conversation and arrives exactly once, on the poll that
 * reads `done: true`: the finished turn's messages are written by then, and a
 * page that drew the stream has no reason to re-read a thread it already has.
 */
export interface AssistantPollView {
  readonly events: readonly AssistantTurnEventEntry[];
  readonly nextCursor: number;
  readonly done: boolean;
  readonly thread: AssistantThreadView | null;
}

/** The declared ops, as a payload-to-result map. */
type AssistantOps = {
  list: { request: ProfilePayload; response: AssistantView };
  createConversation: { request: CreateConversationPayload; response: AssistantView };
  renameConversation: { request: RenameConversationPayload; response: AssistantView };
  removeConversation: { request: ConversationPayload; response: AssistantView };
  open: { request: ConversationPayload; response: AssistantThreadView };
  send: { request: SendPayload; response: AssistantTurnStartView };
  poll: { request: PollPayload; response: AssistantPollView };
  stop: { request: StopPayload; response: null };
  answerConfirm: { request: AnswerConfirmPayload; response: null };
  setup: { request: ProfilePayload; response: AssistantSetupView };
  searchModels: { request: SearchModelsPayload; response: AssistantSetupView };
  importModel: { request: ProfilePayload; response: AssistantSetupView };
  downloadModel: { request: ModelIdPayload; response: AssistantSetupView };
  cancelDownload: { request: ProfilePayload; response: AssistantSetupView };
  resumeDownload: { request: ModelIdPayload; response: AssistantSetupView };
  removeModel: { request: ModelIdPayload; response: AssistantSetupView };
  setDefaultTier: { request: SetTierPayload; response: AssistantSetupView };
  setWebSearch: { request: SetWebSearchPayload; response: AssistantSettingsView };
  reindexKnowledge: { request: ProfilePayload; response: AssistantKnowledgeView };
  voice: { request: ProfilePayload; response: AssistantVoiceView };
  capture: { request: CapturePayload; response: null };
  transcribe: { request: TranscribePayload; response: AssistantTranscriptView };
  speak: { request: SpeakPayload; response: AssistantSpeechView };
};

/** This module's renderer API: one method per op, named after the op. */
export type AssistantApi = ModuleApiOf<AssistantOps>;

/**
 * The contract the preload builds its bridge from and main refuses foreign ops
 * against (ADR-090's one name every module's `shared/ipc.ts` exports).
 */
export const contract = defineModuleContract<"assistant", AssistantOps>("assistant", [
  "list",
  "createConversation",
  "renameConversation",
  "removeConversation",
  "open",
  "send",
  "poll",
  "stop",
  "answerConfirm",
  "setup",
  "searchModels",
  "importModel",
  "downloadModel",
  "cancelDownload",
  "resumeDownload",
  "removeModel",
  "setDefaultTier",
  "setWebSearch",
  "reindexKnowledge",
  "voice",
  "capture",
  "transcribe",
  "speak",
]);

declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    assistant: AssistantApi;
  }
}
