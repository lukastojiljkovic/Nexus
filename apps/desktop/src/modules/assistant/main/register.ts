import { randomUUID } from "node:crypto";
import {
  DEFAULT_MAX_STEPS,
  findWorkflow,
  renderWorkflowBrief,
  runAgentTurn,
  toolsForWorkflow,
  type AgentEvent,
  type AgentTurnInput,
  type ChatMessage,
  type ConfirmRequest,
  type ModelEntry,
  type ModelTier,
} from "@nexus/core";
import {
  ASSISTANT_TIERS,
  MAX_CONVERSATION_TITLE_LENGTH,
  MAX_MESSAGE_CHARS,
  TimersStore,
  parseAssistantExport,
  type AssistantConversation,
  type AssistantExport,
  type AssistantMessage,
  type AssistantMessageInput,
} from "@nexus/db";
import { noRecommendation } from "../../../main/assistant/runtime/recommend.js";
import { mainLocale } from "../../../main/locale.js";
import type { ModuleCall, ModuleHostSurface, ModuleSession } from "../../../main/moduleIpc.js";
import {
  contract,
  type AssistantInstalledView,
  type AssistantKnowledgeView,
  type AssistantMessageView,
  type AssistantPollView,
  type AssistantRecommendationView,
  type AssistantSettingsView,
  type AssistantSetupView,
  type AssistantThreadView,
  type AssistantView,
} from "../shared/ipc.js";
import { applyAssistantData, exportAssistantData } from "./imex.js";
import { AssistantProfile } from "./profile.js";
import { assistantServices, type AssistantServices } from "./services.js";
import { createAssistantTimerHost } from "./timers.js";
import {
  ConfirmPark,
  TurnBusyError,
  TurnRegistry,
  TurnLog,
  TurnUnknownError,
} from "./turns.js";

/**
 * THE ASSISTANT in the main process (ADR-106): its handlers, its turn engine,
 * its confirmations, its archive section and the lifetime of the services it
 * composes.
 *
 * **The arithmetic is not here.** Retrieval, prompting, tool execution and the
 * context budget all belong to the parts ADR-095 built
 * (`packages/core/src/assistant`, `main/assistant/*`); what this file owns is
 * the module's own three questions: which services a profile has, what one turn
 * looks like from the outside, and what a page is allowed to ask for. Every
 * handler validates the wire first (SEC-EL-02), then narrows what the user asked
 * for against what this build can name - a model id main did not offer, a
 * workflow id that does not exist and a tier outside the three are all refused
 * by name rather than bent into something close.
 *
 * **A turn is one at a time per profile.** `send` opens it in the
 * `TurnRegistry`, which refuses a second one by name; the loop's events go into
 * that turn's buffer, and `poll` reads them from a cursor. A confirm parks the
 * tool, emits a `confirm` event and is answered by `answerConfirm`; a turn that
 * is stopped resolves every parked confirm as refused, which is what makes "a
 * refusal is a normal result" true even for a page that walked away.
 *
 * **The model host is per profile, and it is dropped whole.** A profile switch
 * or a lock disposes every service this module built - including `unloadAll` on
 * the runtime, so a gigabyte-scale model does not follow a user from one profile
 * to another.
 */

/** One turn, as this process holds it while a page is reading it. */
interface Turn {
  readonly id: string;
  readonly profileId: string;
  readonly conversationId: string;
  readonly controller: AbortController;
  readonly log: TurnLog;
  /** The questions this turn's tools are parked on. */
  readonly confirms: ConfirmPark;
  /** The assistant and tool messages the turn produced, ready for the store. */
  readonly collected: AssistantMessageInput[];
  /**
   * The assistant row of the step being run, when that step asked for tools -
   * the row the step's `tool-call` events add to (`collect` explains why).
   */
  openCallsRow: number;
  modelId: string | null;
  /** The thread as it was saved, set before the turn is marked finished and read once. */
  saved: AssistantThreadView | null;
}

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  // The module's own state, scoped to the ONE registration this process makes
  // (`moduleHost.ts` adopts every discovered module exactly once, at startup).
  // It is held here rather than at module scope so that registering the module a
  // second time - which only a test does - starts from nothing rather than
  // sharing a previous call's profiles and turns.
  //
  /** Every service this process built, one per profile, with the profile's own database handle. */
  const profiles = new Map<string, AssistantProfile>();
  const turns = new Map<string, Turn>();
  /** Which turn is waiting on a confirm id, so `answerConfirm` can find it. */
  const confirmations = new Map<string, { readonly turn: Turn; readonly park: ConfirmPark }>();
  const registry = new TurnRegistry(() => randomUUID());

  function services(): AssistantServices {
    return assistantServices();
  }

  function profileFor(
    call: { profileDb: ModuleCall["profileDb"] },
    profileId: string,
  ): AssistantProfile {
    const existing = profiles.get(profileId);
    if (existing !== undefined) return existing;
    const profile = call.profileDb(
      profileId,
      (db, id) =>
        new AssistantProfile(
          services(),
          id,
          db,
          createAssistantTimerHost({
            store: new TimersStore(db, id),
            arming: { armUntil: ctx.armUntil, notify: ctx.notify },
            now: () => services().now(),
          }),
        ),
    );
    profiles.set(profileId, profile);
    return profile;
  }

  // --- Views -----------------------------------------------------------------

  function conversationView(conversation: AssistantConversation) {
    return {
      id: conversation.id,
      title: conversation.title,
      modelId: conversation.modelId,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  function messageView(message: AssistantMessage): AssistantMessageView {
    return {
      id: message.id,
      role: message.role,
      text: message.text,
      citations: message.citations,
      toolCalls: message.toolCalls,
      toolCallId: message.toolCallId,
      safety: message.safety,
      createdAt: message.createdAt,
    };
  }

  function threadView(profile: AssistantProfile, conversationId: string): AssistantThreadView {
    const conversation = profile.store.conversation(conversationId);
    if (conversation === null) {
      throw new Error(`No assistant conversation "${conversationId}" in this profile.`);
    }
    return {
      conversation: conversationView(conversation),
      messages: profile.store.listMessages(conversationId).map(messageView),
    };
  }

  async function knowledgeView(profile: AssistantProfile): Promise<AssistantKnowledgeView> {
    const status = await profile.knowledgeBase().status();
    return {
      indexedChunks: status.indexedChunks,
      pendingSources: status.pendingSources,
      embedderId: status.embedderId,
    };
  }

  function settingsView(profile: AssistantProfile): AssistantSettingsView {
    return {
      defaultTier: profile.settings().defaultTier,
      webSearch: {
        enabled: profile.webConfig().enabled,
        modeAllows: profile.modeAllowsWebSearch(),
        mode: services().networkMode(),
      },
    };
  }

  async function listView(profile: AssistantProfile): Promise<AssistantView> {
    return {
      conversations: profile.store.listConversations().map(conversationView),
      settings: settingsView(profile),
      knowledge: await knowledgeView(profile),
    };
  }

  async function setupView(profile: AssistantProfile): Promise<AssistantSetupView> {
    // The three picks are read once per profile (the probe loads the native
    // addon), and the installed list is read fresh: a download that just finished
    // must show up on the next poll without a restart.
    const recommendations = await profile.recommendations();
    const available = await profile.installedEntries();
    const installedIds = new Set(available.map((entry) => entry.id));
    const unavailable =
      recommendations.length === 0
        ? (noRecommendation(await profile.hardware(), await profile.catalogue()) ?? null)
        : null;
    const recommendationsView: AssistantRecommendationView[] = recommendations.map((pick) => ({
      tier: pick.tier,
      model: pick.model,
      reason: pick.reason,
      installed: installedIds.has(pick.model.id),
    }));
    const installedView: AssistantInstalledView[] = available.map((entry) => ({
      model: entry,
      servesTiers: recommendations
        .filter((pick) => pick.model.id === entry.id)
        .map((pick) => pick.tier),
    }));
    // Every entry main produced is remembered, so `downloadModel` can only name
    // one this process offered.
    profile.offer([...recommendations.map((pick) => pick.model), ...available]);
    return {
      hardware: await profile.hardware(),
      recommendations: recommendationsView,
      unavailable,
      installed: installedView,
      search: profile.searchResults(),
      download: profile.downloadView(),
      defaultTier: profile.settings().defaultTier,
      downloadsAllowed: profile.downloadsAllowed(),
      networkMode: services().networkMode(),
    };
  }

  // --- Conversations ---------------------------------------------------------

  ctx.handle("list", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return await listView(profileFor(call, profileId));
  });

  ctx.handle("createConversation", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const title = call.as.asCappedChars(
      call.as.asNonEmptyString(payload.title, "title"),
      "title",
      MAX_CONVERSATION_TITLE_LENGTH,
    );
    const profile = profileFor(call, profileId);
    profile.store.createConversation(title, profile.instant());
    return await listView(profile);
  });

  ctx.handle("renameConversation", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const id = call.as.asId(payload.id, "id");
    const title = call.as.asCappedChars(
      call.as.asNonEmptyString(payload.title, "title"),
      "title",
      MAX_CONVERSATION_TITLE_LENGTH,
    );
    const profile = profileFor(call, profileId);
    profile.store.renameConversation(id, title, profile.instant());
    return await listView(profile);
  });

  ctx.handle("removeConversation", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const conversationId = call.as.asId(payload.conversationId, "conversationId");
    const profile = profileFor(call, profileId);
    profile.store.removeConversation(conversationId);
    return await listView(profile);
  });

  ctx.handle("open", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const conversationId = call.as.asId(payload.conversationId, "conversationId");
    return threadView(profileFor(call, profileId), conversationId);
  });

  // --- One turn --------------------------------------------------------------

  /**
   * Records one model request as the turn accumulates it.
   *
   * **ONE assistant row per step, whichever way the step announced its calls.**
   * The loop emits a step that produced visible text as a `message` event, and
   * that event's `message.toolCalls` already carries the calls - and it THEN
   * emits one `tool-call` event per call (loop.ts). A step with no text emits no
   * message event at all, and its calls are known only from those `tool-call`
   * events. So the row is opened by whichever comes first and the events after it
   * ADD to it, deduplicated by the call's own id: writing the calls again would
   * put two assistant rows with the same request in the thread, and a replayed
   * history in which the model asks for one call twice but is answered once is a
   * request it can no longer see.
   *
   * A `tool-result` closes the row: the next step starts one of its own.
   */
  function collect(turn: Turn, event: AgentEvent): void {
    if (event.type === "message") {
      const calls = event.message.toolCalls ?? [];
      turn.collected.push({
        role: "assistant",
        text: event.message.content,
        citations: event.citations,
        ...(calls.length === 0 ? {} : { toolCalls: [...calls] }),
      });
      turn.openCallsRow = calls.length === 0 ? -1 : turn.collected.length - 1;
      return;
    }
    if (event.type === "tool-call") {
      const open = turn.openCallsRow === -1 ? undefined : turn.collected[turn.openCallsRow];
      if (open === undefined) {
        turn.collected.push({
          role: "assistant",
          text: "",
          citations: [],
          toolCalls: [event.call],
        });
        turn.openCallsRow = turn.collected.length - 1;
        return;
      }
      const held = open.toolCalls ?? [];
      if (!held.some((call) => call.id === event.call.id)) {
        turn.collected[turn.openCallsRow] = { ...open, toolCalls: [...held, event.call] };
      }
      return;
    }
    if (event.type === "tool-result") {
      // A step's own row is done: whatever arrives next is the next step's.
      turn.openCallsRow = -1;
      turn.collected.push({
        role: "tool",
        text: event.result.content,
        toolCallId: event.callId,
        citations: event.result.citations ?? [],
      });
    }
  }

  /** Parks a tool on the user's answer, and puts the question in the turn's buffer. */
  function park(turn: Turn, request: ConfirmRequest): Promise<boolean> {
    const requestId = randomUUID();
    confirmations.set(requestId, { turn, park: turn.confirms });
    turn.log.emit({
      type: "confirm",
      requestId,
      tool: request.tool,
      summary: request.summary,
      effect: request.effect,
    });
    // The index entry goes the moment the question is resolved, whichever way:
    // an answered id is not one a second answer may reach.
    return turn.confirms.park(requestId).finally(() => {
      confirmations.delete(requestId);
    });
  }

  /** Resolves every question a turn is still waiting on, as refused. */
  function refusePending(turn: Turn): void {
    turn.confirms.refuseAll();
    for (const [requestId, entry] of [...confirmations]) {
      if (entry.park === turn.confirms) confirmations.delete(requestId);
    }
  }

  /** The history a turn replays: what the thread already holds, in the loop's own message shape. */
  function historyOf(profile: AssistantProfile, conversationId: string): ChatMessage[] {
    return profile.store.listMessages(conversationId).map((message) => ({
      role: message.role,
      content: message.text,
      ...(message.toolCalls === null || message.toolCalls.length === 0
        ? {}
        : { toolCalls: message.toolCalls }),
      ...(message.toolCallId === null ? {} : { toolCallId: message.toolCallId }),
    }));
  }

  ctx.handle("send", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const conversationId = call.as.asId(payload.conversationId, "conversationId");
    const text = call.as.asCappedChars(
      call.as.asNonEmptyString(payload.text, "text"),
      "text",
      MAX_MESSAGE_CHARS,
    ).trim();
    // A message of nothing but spaces is not a message: the model would be asked
    // to answer an empty turn, and the row would be a blank bubble in the thread.
    if (text === "") {
      throw new Error('Invalid IPC payload: "text" must not be blank.');
    }
    const workflowId = call.as.asNullableString(payload.workflowId, "workflowId");
    const workflow = workflowId === null ? null : (findWorkflow(workflowId) ?? null);
    if (workflowId !== null && workflow === null) {
      throw new Error(`There is no assistant workflow named "${workflowId}".`);
    }
    const profile = profileFor(call, profileId);
    if (profile.store.conversation(conversationId) === null) {
      throw new Error(`No assistant conversation "${conversationId}" in this profile.`);
    }
    // The refusal comes before anything is written, so a page that asks for a
    // second turn while one runs leaves the thread exactly as it was.
    const running = registry.runningTurn(profileId);
    if (running !== null) throw new TurnBusyError(running);

    const controller = new AbortController();
    const locale = mainLocale();
    // A tier with no installed model is refused here, before the user's message is
    // written: a missing model is a setup mistake, not half a conversation.
    const model = await profile.loadChat(profile.settings().defaultTier, controller.signal);
    const history = historyOf(profile, conversationId);
    // The AUTHORITATIVE refusal. `loadChat` above awaits, so two sends issued in
    // the same breath are both past the check at the top of this handler by the
    // time either reaches here - and only one of them can open the profile's
    // turn. Opening BEFORE the user's message is written is what keeps the loser
    // from leaving a question in the thread that nothing will ever answer.
    const log = registry.open(profileId, conversationId);
    try {
      profile.store.appendTurn(conversationId, [{ role: "user", text }], null, profile.instant());
    } catch (error) {
      // The turn was opened and its question could not be written, so nothing
      // holds the profile: a store refusal (a thread at its message cap, a
      // closed database) must not leave a turn running that nobody sent.
      registry.finish(profileId, log.id);
      registry.close(log.id);
      throw error;
    }
    const turn: Turn = {
      id: log.id,
      profileId,
      conversationId,
      controller,
      log,
      confirms: new ConfirmPark(),
      collected: [],
      openCallsRow: -1,
      modelId: model.info.id,
      saved: null,
    };
    turns.set(turn.id, turn);

    const offered = profile.tools(profile.webSearchActive());
    const input: AgentTurnInput = {
      history,
      user: {
        role: "user",
        content:
          workflow === null ? text : `${text}\n\n${renderWorkflowBrief(workflow, locale)}`,
      },
      locale,
      tools: workflow === null ? offered : toolsForWorkflow(workflow, offered),
      knowledge: profile.knowledgeBase(),
      model,
      context: {
        profileId,
        locale,
        signal: controller.signal,
        confirm: (request) => park(turn, request),
      },
      maxSteps: DEFAULT_MAX_STEPS,
    };

    // Unawaited: the page polls. The failure of a whole turn is caught here and
    // turned into the turn's own events rather than into an unhandled rejection.
    void runAgentTurn(input, (event) => {
      const entry = turn.log.emit(event);
      collect(turn, event);
      if (entry === null) {
        // The buffer is full: the model is talking without stopping, and the
        // honest answer is to stop it rather than to keep counting.
        controller.abort();
      }
    })
      .catch((error: unknown) => {
        turn.log.emit({ type: "error", code: "model-failed" });
        console.error("Nexus: the assistant turn failed:", error);
      })
      .finally(() => {
        refusePending(turn);
        try {
          if (turn.collected.length > 0) {
            profile.store.appendTurn(
              conversationId,
              turn.collected,
              turn.modelId,
              profile.instant(),
            );
          }
          turn.saved = threadView(profile, conversationId);
        } catch (error) {
          // The turn itself ran; failing to write it is a store problem, and the
          // page is told by the thread it reads next rather than by a throw out
          // of a promise nobody awaits.
          console.error("Nexus: the assistant conversation could not be saved:", error);
        }
        // Marked finished AFTER the write, which is what makes `done` mean "the
        // thread it points at is in the database".
        registry.finish(profileId, turn.id);
      });

    return { turnId: turn.id };
  });

  ctx.handle("poll", (payload, call): AssistantPollView => {
    const turnId = call.as.asId(payload.turnId, "turnId");
    const cursor = call.as.asInteger(payload.cursor, "cursor");
    const log = registry.get(turnId);
    if (log === null) throw new TurnUnknownError(turnId);
    const view = log.poll(cursor);
    const turn = turns.get(turnId);
    if (!view.done || turn === undefined) return view;
    // The thread is answered exactly once, on the poll that reads the end, and
    // the turn is forgotten in the same breath - "dropped when it ends and has
    // been read" is one statement, not two.
    if (view.nextCursor >= log.lastSeq()) {
      registry.close(turnId);
      turns.delete(turnId);
    }
    return { ...view, thread: turn.saved };
  });

  ctx.handle("stop", (payload, call): null => {
    const turnId = call.as.asId(payload.turnId, "turnId");
    const log = registry.get(turnId);
    if (log === null) throw new TurnUnknownError(turnId);
    const turn = turns.get(turnId);
    if (turn !== undefined) refusePending(turn);
    turn?.controller.abort();
    return null;
  });

  ctx.handle("answerConfirm", (payload, call): null => {
    const requestId = call.as.asId(payload.requestId, "requestId");
    const allow = call.as.asBoolean(payload.allow, "allow");
    // An unknown or already answered request is refused by name rather than
    // silently accepted: a page answering the same question twice would otherwise
    // be indistinguishable from one answering it once.
    const waiting = confirmations.get(requestId);
    if (waiting === undefined) {
      throw new Error(`No assistant confirmation "${requestId}" is waiting for an answer.`);
    }
    waiting.park.answer(requestId, allow);
    return null;
  });

  // --- Setup and models ------------------------------------------------------

  ctx.handle("setup", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return await setupView(profileFor(call, profileId));
  });

  ctx.handle("searchModels", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const query = call.as.asCappedChars(
      call.as.asNonEmptyString(payload.query, "query"),
      "query",
      200,
    );
    const profile = profileFor(call, profileId);
    // The runtime refuses outside the `downloads` mode, before a URL is built.
    const found = await profile
      .modelHost()
      .searchHuggingFace(query, new AbortController().signal);
    profile.rememberSearch(found);
    return await setupView(profile);
  });

  ctx.handle("importModel", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const profile = profileFor(call, profileId);
    const path = await services().pickGgufFile();
    if (path !== null) {
      const entry = await profile.modelHost().importFile(path);
      profile.offer([entry]);
    }
    return await setupView(profile);
  });

  ctx.handle("downloadModel", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const modelId = call.as.asId(payload.modelId, "modelId");
    const profile = profileFor(call, profileId);
    const entry = requireOffered(profile, modelId);
    startDownload(profile, entry);
    return await setupView(profile);
  });

  ctx.handle("cancelDownload", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const profile = profileFor(call, profileId);
    profile.cancelDownload();
    return await setupView(profile);
  });

  ctx.handle("resumeDownload", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const modelId = call.as.asId(payload.modelId, "modelId");
    const profile = profileFor(call, profileId);
    const entry = requireOffered(profile, modelId);
    startDownload(profile, entry);
    return await setupView(profile);
  });

  ctx.handle("removeModel", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const modelId = call.as.asId(payload.modelId, "modelId");
    const profile = profileFor(call, profileId);
    await profile.modelHost().remove(modelId);
    return await setupView(profile);
  });

  ctx.handle("setDefaultTier", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const profile = profileFor(call, profileId);
    profile.setDefaultTier(tierOf(call, payload.tier));
    return await setupView(profile);
  });

  ctx.handle("setWebSearch", (payload, call): AssistantSettingsView => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const enabled = call.as.asBoolean(payload.enabled, "enabled");
    const profile = profileFor(call, profileId);
    profile.setWebSearch(enabled);
    return settingsView(profile);
  });

  ctx.handle("reindexKnowledge", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const profile = profileFor(call, profileId);
    // Unawaited: a rebuild walks the whole profile, and the page reads its
    // progress from the status the next `list` answers with.
    void profile
      .knowledgeBase()
      .reindex(new AbortController().signal)
      .catch((error: unknown) => {
        console.error("Nexus: the assistant knowledge index could not be rebuilt:", error);
      });
    return await knowledgeView(profile);
  });

  // --- The archive (ADR-090 section 5) ---------------------------------------

  ctx.exportData((session: ModuleSession) => exportAssistantData(session));

  ctx.importData({
    // The module's own reader, which the host runs at the preview and again
    // before any module writes. It throws on anything this build will not take.
    parse: parseAssistantExport,
    apply: (payload: AssistantExport | undefined, session: ModuleSession) =>
      applyAssistantData(payload, session),
  });

  // --- Lifetime --------------------------------------------------------------

  ctx.onSessionEnd(() => {
    for (const profileId of [...profiles.keys()]) registry.closeProfile(profileId);
    for (const turn of [...turns.values()]) {
      refusePending(turn);
      turn.controller.abort();
    }
    turns.clear();
    confirmations.clear();
    for (const profile of profiles.values()) void profile.dispose();
    profiles.clear();
  });
}

/**
 * Starts a download and lets it run.
 *
 * Unawaited, and its failure reaches the page as the failed progress row the
 * next `setup` answers with rather than as a throw out of the handler that asked:
 * a mode refusal or a full disk is something the user reads in the model list,
 * next to the model they tried to download.
 */
function startDownload(profile: AssistantProfile, entry: ModelEntry): void {
  void profile
    .downloadModel(entry, () => undefined)
    .catch((error: unknown) => {
      console.error("Nexus: the assistant model download failed:", error);
    });
}

/** The one model a download may name: an entry this process offered. Anything else is refused by name. */
function requireOffered(profile: AssistantProfile, modelId: string) {
  const entry = profile.offeredEntry(modelId);
  if (entry === null) {
    throw new Error(
      `No model "${modelId}" was offered by this session's setup or search, so it cannot be downloaded.`,
    );
  }
  return entry;
}

/** One of the three tiers, off the wire. */
function tierOf(call: { as: ModuleCall["as"] }, value: unknown): ModelTier {
  const tier = call.as.asString(value, "tier");
  if (!(ASSISTANT_TIERS as readonly string[]).includes(tier)) {
    throw new Error(
      `Invalid IPC payload: "tier" must be one of ${ASSISTANT_TIERS.join(", ")}.`,
    );
  }
  return tier as ModelTier;
}
