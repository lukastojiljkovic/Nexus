import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ASSISTANT_WORKFLOWS, type Citation } from "@nexus/core";
import {
  Button,
  Card,
  Chip,
  ConfirmDialog,
  Dialog,
  Disclosure,
  EmptyState,
  Icon,
  ListRow,
  LoadingState,
  PageHeader,
  Select,
  TextArea,
  TextField,
  type AsyncState,
} from "@nexus/ui";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { activeLocale, declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { SafetyNotice } from "../../../renderer/src/safetyNotice.js";
import { manifest } from "../shared/manifest.js";
import type {
  AssistantKnowledgeView,
  AssistantProbeView,
  AssistantSetupView,
  AssistantSettingsView,
  AssistantSummaryView,
  AssistantThreadView,
  AssistantTurnEventView,
  AssistantTurnStartView,
  AssistantView,
} from "../shared/ipc.js";
import {
  NO_CONFIRMS,
  dropConfirm,
  enqueueConfirm,
  headConfirm,
  type ConfirmAsk,
} from "./confirmQueue.js";
import { copy } from "./copy.js";
import { isNearBottom, locationTiming } from "./dockRules.js";
import { openAppLocation, openWebAddress } from "./location.js";
import { ModelPanel } from "./ModelPanel.js";
import {
  canCompact,
  citationTarget,
  firstLine,
  groupThread,
  numberedCitations,
  summaryBoundary,
  toolLabel,
  toolLineView,
  turnEndError,
  turnErrorSentence,
  type ThreadItem,
  type ThreadToolLine,
} from "./thread.js";
import { placeOf, turnLocations } from "./turnLocations.js";
import { downloadRunning, effectCopy, hasAnsweringModel, loadPhase, webStatus } from "./surfaceStates.js";
import "./assistant.css";

/**
 * ASISTENT (ADR-106) - the chat surface: the conversations on the left, one
 * thread on the right, and the models where the two meet when no model is ready.
 *
 * **A turn is polled, not pushed.** The kit has request/response ops (see this
 * module's `shared/ipc.ts` for why), so this page calls `send`, then polls while
 * a turn runs with the cursor main answered last, and stops when it reads
 * `done` - at which point main has already written the thread into the database
 * and hands it back once. The streamed text a person watches is therefore a
 * PROVISIONAL draft of the answer, and the saved thread replaces it: what stays
 * on screen is what the store holds, not what this page hoped.
 *
 * **A confirmation is a dialog per parked tool, and leaving the page refuses.**
 * A `write` or `network` tool parks in main until the user answers; this page
 * draws the house `ConfirmDialog` with the tool's own one-line summary, and its
 * cleanup calls `stop` - so a page that is left, or a turn that is stopped,
 * resolves every parked question as refused rather than leaving a tool waiting
 * forever. One step can park TWO tools (a model may write twice in one step), so
 * the questions are a queue (`confirmQueue.ts`): the dialog draws the oldest,
 * answering drops it and draws the next, and the end of the turn clears the lot.
 * A single slot showed the second question and left the first tool parked on a
 * promise nobody could answer - a turn only Stop could escape.
 *
 * **Where the turn asks to go is opened when the turn ENDS, on the full page.**
 * `app.open` and every later `navigate` tool answer with `result.navigateTo`, and
 * acting on one mid-turn would unmount this page - whose cleanup stops the turn -
 * so the full page collects them while it polls (`turnLocations.ts`) and opens
 * them, in order, once the poll has read `done`: the answer is saved, the draft
 * dropped, the thread refreshed, and then the view moves. A DOCKED assistant does
 * not unmount when the page beside it changes, so it opens each place as its
 * result arrives and the turn carries on (`dockRules.ts` says which rule is in force).
 * A turn that ended in an error, or that the user stopped, opens nothing at the
 * end: its last request is not a place anybody asked for.
 *
 * **The same assistant, docked.** `AssistantSurface` is the whole page body, drawn
 * in full or beside another page (`Dock.tsx`). Docked, the conversation rail is a
 * picker and the header is one row; everything else - the thread, the models, the
 * confirmations - is the same code, so the two surfaces cannot disagree.
 *
 * **A failed turn says why.** The loop's `error` events are codes - `step-limit`,
 * `context-full`, `model-failed` - and `thread.ts` turns each into one sentence
 * this page draws in the line above the thread, so a turn that died of a full
 * context does not read as one that merely stopped.
 *
 * **The rail is the conversations, and the composer is the only input.** Enter
 * sends and Shift+Enter is a new line, which is the app's own grammar for a
 * single-line intent in a multi-line box; the four built-in recipes are buttons
 * above it, because a workflow is a conversation somebody does not want to have
 * to compose.
 */

interface LiveTurn {
  readonly turnId: string;
  text: string;
  /**
   * One line per tool call and per result, as they happen - the shape
   * `toolLineView` reads, written mutably here because the events fill it in.
   */
  readonly tools: { id: string; name: string; ok: boolean | null; text: string }[];
  /** The last compaction event of this turn, or `null` while none has come. */
  compaction: "running" | "done" | "failed" | null;
}

export default function AssistantPage({ profileId }: ModulePageProps) {
  return <AssistantSurface profileId={profileId} />;
}

/** The assistant as a surface: the full page, or the same thing docked beside `beside` (the page the user is reading). */
export function AssistantSurface({
  profileId,
  docked = false,
  beside = manifest.id,
  onPageChanged,
}: {
  readonly profileId: string;
  readonly docked?: boolean;
  readonly beside?: string;
  /**
   * Remounts the page beside the dock, so it re-reads what a docked turn wrote: as
   * a place without an action opens, or at the end of a turn that asked to change
   * something and opened no place.
   */
  readonly onPageChanged?: () => void;
}) {
  const [view, setView] = useState<AssistantView | null>(null);
  const [setup, setSetup] = useState<AssistantSetupView | null>(null);
  const [probe, setProbe] = useState<AsyncState<AssistantProbeView>>({ status: "loading" });
  const [thread, setThread] = useState<AssistantThreadView | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** True when the first load failed; the page then says so and offers a retry, rather than a skeleton. */
  const [loadFailed, setLoadFailed] = useState(false);
  /** True when the stream of a turn was lost: the message was saved, so the retry re-reads the thread. */
  const [lost, setLost] = useState(false);
  /** True from the moment a send is issued until main answers with the turn id: the model may still be loading. */
  const [starting, setStarting] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<LiveTurn | null>(null);
  /**
   * The questions parked tools are waiting on, oldest first. A queue and not one
   * slot: two writes in one step are two questions, and a single slot let the
   * second overwrite the first (`confirmQueue.ts` says what that cost).
   */
  const [confirms, setConfirms] = useState<readonly ConfirmAsk[]>(NO_CONFIRMS);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  /** How far this page has read a turn. A ref, because the poll reads it without re-rendering. */
  const cursor = useRef(0);
  const liveRef = useRef<LiveTurn | null>(null);
  /**
   * True from the moment a send is issued until main has answered with the turn
   * id. `liveRef` is only set after that answer, so without this a second click
   * landing inside the same round trip would be a second `send` - which main
   * refuses, but as an error the user did not cause.
   */
  const sendingRef = useRef(false);
  /** Set when Stop is pressed before main has answered: the turn is ended as soon as its id arrives. */
  const abandonStart = useRef(false);
  /**
   * Every event of the turn being polled. The places a turn named are read from
   * them once the poll has said the turn is over (`turnLocations.ts`), which is
   * the only moment this page may leave itself.
   */
  const turnEvents = useRef<AssistantTurnEventView[]>([]);

  const refresh = useCallback(async () => {
    try {
      setView(await window.nexus.modules.assistant.list({ profileId }));
      setError(null);
    } catch (failure) {
      setLoadFailed(true);
      setError(copy.errors.load);
      console.error("Nexus: the assistant could not be loaded:", failure);
    }
  }, [profileId]);

  const refreshSetup = useCallback(async () => {
    try {
      setSetup(await window.nexus.modules.assistant.setup({ profileId }));
    } catch (failure) {
      setLoadFailed(true);
      setError(copy.errors.load);
      console.error("Nexus: the assistant's models could not be loaded:", failure);
    }
  }, [profileId]);

  /**
   * The hardware probe and the picks, read beside the page rather than before it:
   * the probe loads the native runtime in the model worker, which takes seconds on
   * a cold start, and only the models pane draws what it found. A failure is that
   * pane's to say; the rest of the page works without it.
   */
  const refreshProbe = useCallback(async () => {
    setProbe({ status: "loading" });
    try {
      setProbe({ status: "ready", data: await window.nexus.modules.assistant.probe({ profileId }) });
    } catch (failure) {
      setProbe({ status: "failed" });
      console.error("Nexus: the assistant could not read this computer's hardware:", failure);
    }
  }, [profileId]);

  /** Loads every read again, from the first load and from the retry the failure offers. */
  const reload = useCallback(() => {
    setLoadFailed(false);
    void refresh();
    void refreshSetup();
    void refreshProbe();
  }, [refresh, refreshSetup, refreshProbe]);

  useEffect(() => {
    reload();
  }, [reload]);

  // A running model download is followed by reading `setup` each second, the way
  // Maps follows a region: the bytes, then the model in the installed list.
  const downloading = downloadRunning(setup);
  useEffect(() => {
    if (!downloading) return;
    const handle = window.setInterval(() => void refreshSetup(), 1000);
    return () => window.clearInterval(handle);
  }, [downloading, refreshSetup]);

  const openConversation = useCallback(
    async (conversationId: string) => {
      try {
        setThread(await window.nexus.modules.assistant.open({ profileId, conversationId }));
        setError(null);
      } catch (failure) {
        setError(copy.errors.load);
        console.error("Nexus: the assistant conversation could not be opened:", failure);
      }
    },
    [profileId],
  );

  const stopTurn = useCallback(
    async (turnId: string) => {
      try {
        await window.nexus.modules.assistant.stop({ profileId, turnId });
      } catch (failure) {
        // A turn that already ended is not a failure the user needs to read: the
        // poll that observes `done` is what clears the page.
        console.error("Nexus: the assistant turn could not be stopped:", failure);
      }
    },
    [profileId],
  );

  /**
   * Ends the turn this page is watching, if any. Called by Stop and by leaving the
   * page. While the model is still loading there is no turn id yet, so Stop marks
   * the start as abandoned and `send` ends the turn the moment main names it.
   */
  const stop = useCallback(async () => {
    const current = liveRef.current;
    if (current === null) {
      abandonStart.current = sendingRef.current;
      return;
    }
    await stopTurn(current.turnId);
  }, [stopTurn]);

  // The page's own unmount stops the turn: a parked confirmation must not outlive
  // the dialog that would have answered it.
  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  /**
   * Starts one turn - a `send` or a `compact` - and hands the page to the poll below.
   * Both kinds of turn are watched by the same loop, so a compaction is one more turn
   * and not a second loop. `onStarted` runs once main has accepted the turn, so the
   * draft is cleared only when a message was really sent.
   */
  const startTurn = useCallback(
    async (
      conversationId: string,
      start: () => Promise<AssistantTurnStartView>,
      failureText: string,
      onStarted?: () => void,
    ) => {
      sendingRef.current = true;
      abandonStart.current = false;
      setStarting(true);
      setLost(false);
      try {
        const started = await start();
        if (abandonStart.current) {
          await stopTurn(started.turnId);
          await openConversation(conversationId);
          return;
        }
        cursor.current = 0;
        turnEvents.current = [];
        const next: LiveTurn = { turnId: started.turnId, text: "", tools: [], compaction: null };
        liveRef.current = next;
        setLive(next);
        setError(null);
        onStarted?.();
        // The user's own message is written before the model is asked anything,
        // so the thread gains it here rather than waiting for the answer.
        await openConversation(conversationId);
      } catch (failure) {
        setError(failureText);
        console.error("Nexus: the assistant turn could not be started:", failure);
      } finally {
        sendingRef.current = false;
        setStarting(false);
      }
    },
    [openConversation, profileId, stopTurn],
  );

  const send = useCallback(
    async (text: string, workflowId: string | null) => {
      const trimmed = text.trim();
      if (trimmed === "" || liveRef.current !== null || sendingRef.current || thread === null) return;
      const conversationId = thread.conversation.id;
      await startTurn(
        conversationId,
        () =>
          window.nexus.modules.assistant.send({
            profileId,
            conversationId,
            text: trimmed,
            workflowId,
            // The page beside the dock, so "this" and "here" mean what the user is
            // looking at; the full page names no place (`prompts.ts`).
            location: docked ? beside : null,
          }),
        copy.errors.send,
        () => setDraft(""),
      );
    },
    [beside, docked, profileId, startTurn, thread],
  );

  /** Summarizes the thread's head as a turn of its own: the same poll, the same Stop. */
  const compact = useCallback(async () => {
    if (thread === null || liveRef.current !== null || sendingRef.current) return;
    const conversationId = thread.conversation.id;
    await startTurn(
      conversationId,
      () => window.nexus.modules.assistant.compact({ profileId, conversationId }),
      copy.errors.compact,
    );
  }, [profileId, startTurn, thread]);

  /**
   * The poll: about every hundred milliseconds while a turn runs, which is the
   * cadence the brief fixes. It reads only what arrived after the cursor, and it
   * stops the moment main says the turn is over - at which point the saved
   * thread arrives with it and the provisional draft is dropped.
   */
  useEffect(() => {
    if (live === null) return;
    let active = true;
    /**
     * One poll at a time. An interval tick does not wait for the previous round
     * trip, and a poll that outlives the hundred milliseconds would let the next
     * tick read the same cursor again - appending every token of the answer to
     * the draft a second time.
     */
    let inFlight = false;
    const handle = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void (async () => {
        try {
          const polled = await window.nexus.modules.assistant.poll({
            profileId,
            turnId: live.turnId,
            cursor: cursor.current,
          });
          if (!active) return;
          cursor.current = polled.nextCursor;
          for (const entry of polled.events) {
            const event = entry.event;
            const current = liveRef.current;
            if (current === null) break;
            turnEvents.current.push(event);
            // A docked assistant opens a place as its result arrives; the full page
            // waits for the end (`locationTiming`). A place with no action opens on a
            // fresh page, so one already on screen re-reads what the turn wrote; an
            // action is applied to the page's own state, which a remount would drop.
            const place = placeOf(event);
            if (place !== null && locationTiming(docked) === "as-it-arrives") {
              if (place.action === undefined) onPageChanged?.();
              openAppLocation(place);
            }
            if (event.type === "token") {
              current.text += event.text;
              setLive({ ...current });
            } else if (event.type === "tool-call") {
              // No result yet: `ok: null` is the line saying the tool is running.
              current.tools.push({
                id: event.call.id,
                name: event.call.name,
                ok: null,
                text: "",
              });
              setLive({ ...current });
            } else if (event.type === "tool-result") {
              const line = current.tools.find((tool) => tool.id === event.callId);
              if (line !== undefined) {
                line.text = firstLine(event.result.content);
                // The tool's own verdict, kept so a live line reads exactly as
                // the saved one it becomes a moment later.
                line.ok = event.result.ok;
              }
              setLive({ ...current });
            } else if (event.type === "confirm") {
              // Queued, not shown in place: the dialog below draws the head, so
              // a second question waits its turn instead of replacing the first.
              setConfirms((queue) =>
                enqueueConfirm(queue, {
                  requestId: event.requestId,
                  tool: event.tool,
                  effect: event.effect,
                  summary: event.summary,
                }),
              );
            } else if (event.type === "error") {
              // Every code, not only `aborted`: a turn cut off by the step limit
              // or a full context says so rather than just stopping.
              setError(turnErrorSentence(event.code));
            } else if (event.type === "compaction") {
              // `running` is drawn in the live region; `done` draws nothing, because
              // the saved thread arrives with it and draws the divider. `failed` leaves
              // the thread as it was, and says so.
              current.compaction = event.status;
              if (event.status === "failed") setError(copy.errors.compactFailed);
              setLive({ ...current });
            }
          }
          if (polled.done) {
            const locations =
              locationTiming(docked) === "at-turn-end" ? turnLocations(turnEvents.current) : [];
            liveRef.current = null;
            setLive(null);
            setConfirms(NO_CONFIRMS);
            if (polled.thread !== null) setThread(polled.thread);
            await refresh();
            const failure = turnEndError(turnEvents.current);
            if (failure !== null) setError(failure);
            // A docked turn that asked to change something but opened no place may
            // have written under the page beside the dock, which re-reads once.
            const events = turnEvents.current;
            const wroteInPlace =
              events.some((turnEvent) => turnEvent.type === "confirm") &&
              !events.some((turnEvent) => placeOf(turnEvent) !== null);
            if (docked && wroteInPlace) onPageChanged?.();
            // Last, because opening a place unmounts this page: the answer and
            // the saved thread are on screen first, and then the view moves.
            for (const location of locations) openAppLocation(location);
          }
        } catch (failure) {
          if (!active) return;
          liveRef.current = null;
          setLive(null);
          // The message was saved before the stream began, so the retry re-reads the
          // thread rather than sending anything again.
          setLost(true);
          setError(copy.errors.lostStream);
          console.error("Nexus: the assistant turn could not be read:", failure);
        } finally {
          inFlight = false;
        }
      })();
    }, 100);
    return () => {
      active = false;
      clearInterval(handle);
    };
  }, [docked, live, onPageChanged, profileId, refresh]);

  /** Re-reads the conversation after a lost stream, so what was saved is what is on screen. */
  const retryLost = useCallback(() => {
    setLost(false);
    setError(null);
    if (thread !== null) void openConversation(thread.conversation.id);
    void refresh();
  }, [openConversation, refresh, thread]);

  const newConversation = useCallback(async () => {
    try {
      const next = await window.nexus.modules.assistant.createConversation({
        profileId,
        title: copy.rail.new,
      });
      setView(next);
      const created = next.conversations[0];
      if (created !== undefined) await openConversation(created.id);
    } catch (failure) {
      setError(copy.errors.action);
      console.error("Nexus: a new assistant conversation could not be created:", failure);
    }
  }, [openConversation, profileId]);

  const rename = useCallback(
    async (id: string, title: string) => {
      try {
        setView(await window.nexus.modules.assistant.renameConversation({ profileId, id, title }));
        setThread((current) =>
          current !== null && current.conversation.id === id
            ? { ...current, conversation: { ...current.conversation, title } }
            : current,
        );
      } catch (failure) {
        setError(copy.errors.action);
        console.error("Nexus: the assistant conversation could not be renamed:", failure);
      }
    },
    [profileId],
  );

  const remove = useCallback(
    async (conversationId: string) => {
      try {
        setView(await window.nexus.modules.assistant.removeConversation({ profileId, conversationId }));
        setThread((current) =>
          current !== null && current.conversation.id === conversationId ? null : current,
        );
      } catch (failure) {
        setError(copy.errors.action);
        console.error("Nexus: the assistant conversation could not be removed:", failure);
      }
    },
    [profileId],
  );

  // A model is ready when one can answer: the tier's own pick, or the model the
  // user chose by hand - which serves no tier at all, and is exactly the case
  // this page has to be able to open a conversation for.
  const probed = probe.status === "ready" ? probe.data : null;
  const modelReady = setup !== null && hasAnsweringModel(setup.installed, probed);
  const conversation = thread?.conversation ?? null;
  /** The question the dialog draws: the oldest one a parked tool is waiting on. */
  const confirm = headConfirm(confirms);
  const phase = loadPhase({ view, setup, failed: loadFailed });
  /** The permission dialog opens on "No": the answer that changes nothing is the one a bare Enter gives. */
  const denyRef = useRef<HTMLButtonElement | null>(null);

  /** Answers one parked question. Answering drops it, and the next one is drawn. */
  const answer = (ask: ConfirmAsk, allow: boolean) => {
    setConfirms(dropConfirm);
    void window.nexus.modules.assistant
      .answerConfirm({ profileId, requestId: ask.requestId, allow })
      .catch((failure: unknown) => {
        console.error("Nexus: a confirmation could not be answered:", failure);
      });
  };

  const newButton = (
    <Button size="sm" variant="primary" disabled={!modelReady} onClick={() => void newConversation()}>
      {copy.rail.new}
    </Button>
  );
  // What is in memory changes under the page (a turn loads the model, the idle
  // timer unloads it), so the pane reads it again as it opens.
  const toggleModels = () => {
    if (!modelsOpen) void refreshSetup();
    setModelsOpen((open) => !open);
  };
  const modelsButton = (
    <Button key="models" size="sm" onClick={toggleModels}>
      {modelsOpen ? copy.setup.close : copy.rail.models}
    </Button>
  );

  return (
    <div className={docked ? "asst asst--docked" : "asst nx-measure"}>
      {/* The page's own name is the word the manifest DECLARED, so the rail, the
          settings gallery and this header cannot disagree about it. A dock has no
          title of its own: it is named by the region that holds it. */}
      {docked ? (
        <div className="asst__dock-head">
          {view !== null && conversation !== null && (
            <Select
              label={copy.dock.picker}
              value={conversation.id}
              onChange={(event) => void openConversation(event.target.value)}
            >
              {view.conversations.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title}
                </option>
              ))}
            </Select>
          )}
          {newButton}
          {modelsButton}
        </div>
      ) : (
        <PageHeader
          title={declaredText(manifest.copy?.name)}
          subtitle={copy.page.subtitle}
          sigil="assistant"
          primaryAction={newButton}
          secondaryActions={[modelsButton]}
          overflowLabel={copy.rail.models}
        />
      )}
      {phase === "loading" && <LoadingState label={copy.page.loading} rows={4} />}
      {phase === "failed" && (
        <EmptyState
          title={copy.page.loadFailed}
          description={copy.errors.load}
          sigil="assistant"
          action={
            <Button size="sm" variant="primary" onClick={reload}>
              {copy.errors.retry}
            </Button>
          }
        />
      )}
      {error !== null && phase !== "failed" && (
        <div className="asst__error" role="alert">
          <span>{error}</span>
          {lost && (
            <Button size="sm" variant="quiet" onClick={retryLost}>
              {copy.errors.retry}
            </Button>
          )}
        </div>
      )}
      {view !== null && setup !== null && (
        <StatusRow settings={view.settings} knowledge={view.knowledge} />
      )}
      {view !== null && setup !== null && (
        <div className="asst__grid">
          {modelReady && !docked && (
            <Card className="asst__rail">
              <span className="nx-eyebrow">{copy.rail.title}</span>
              {view.conversations.length === 0 ? (
                <p className="nx-hint">{copy.rail.empty}</p>
              ) : (
                view.conversations.map((row) =>
                  renaming === row.id ? (
                    <div key={row.id} className="asst__rename">
                      <TextField
                        label={copy.rail.rename}
                        value={renameDraft}
                        maxLength={120}
                        onChange={(event) => setRenameDraft(event.target.value)}
                      />
                      <div className="asst__actions">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => {
                            const title = renameDraft.trim();
                            setRenaming(null);
                            if (title !== "") void rename(row.id, title);
                          }}
                        >
                          {copy.rail.save}
                        </Button>
                        <Button size="sm" variant="quiet" onClick={() => setRenaming(null)}>
                          {copy.rail.cancel}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <ListRow
                      key={row.id}
                      onClick={() => void openConversation(row.id)}
                      className={row.id === conversation?.id ? "asst__row-active" : undefined}
                      trailing={
                        <span className="asst__actions">
                          <Button
                            size="sm"
                            variant="quiet"
                            onClick={() => {
                              setRenaming(row.id);
                              setRenameDraft(row.title);
                            }}
                          >
                            {copy.rail.rename}
                          </Button>
                          <Button size="sm" variant="quiet" onClick={() => setRemoving(row.id)}>
                            {copy.rail.delete}
                          </Button>
                        </span>
                      }
                    >
                      <span>{row.title}</span>
                    </ListRow>
                  ),
                )
              )}
            </Card>
          )}

          <div className="asst__main">
            {modelsOpen || !modelReady ? (
              <ModelPanel profileId={profileId} setup={setup} probe={probe} onSetup={setSetup} />
            ) : conversation === null ? (
              <EmptyState
                title={copy.thread.emptyTitle}
                description={copy.thread.emptyBody}
                sigil="assistant"
              />
            ) : (
              <>
                <Thread
                  items={groupThread(thread?.messages ?? [])}
                  summary={thread?.summary ?? null}
                  boundary={summaryBoundary(thread?.messages ?? [], thread?.summary ?? null)}
                  live={live}
                  starting={starting}
                />
                <div className="asst__workflows">
                  <span className="nx-eyebrow">{copy.workflows.title}</span>
                  <div className="asst__actions">
                    {ASSISTANT_WORKFLOWS.map((workflow) => (
                      <Button
                        key={workflow.id}
                        size="sm"
                        disabled={live !== null || starting}
                        onClick={() => void send(workflow.name[activeLocale()], workflow.id)}
                      >
                        {workflow.name[activeLocale()]}
                      </Button>
                    ))}
                  </div>
                  <p className="nx-hint">{copy.workflows.hint}</p>
                </div>
                <div className="asst__composer">
                  <TextArea
                    label={copy.composer.placeholder}
                    rows={3}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.shiftKey) return;
                      event.preventDefault();
                      void send(draft, null);
                    }}
                  />
                  <div className="asst__actions">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={draft.trim() === "" || live !== null || starting}
                      onClick={() => void send(draft, null)}
                    >
                      {copy.composer.send}
                    </Button>
                    {thread !== null && canCompact(thread.messages, thread.summary) && (
                      <Button size="sm" disabled={live !== null || starting} onClick={() => void compact()}>
                        {copy.composer.summarize}
                      </Button>
                    )}
                    {(live !== null || starting) && (
                      <Button size="sm" onClick={() => void stop()}>
                        {copy.composer.stop}
                      </Button>
                    )}
                  </div>
                  <p className="nx-hint">{copy.composer.hint}</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {confirm !== null && (
        <Dialog
          title={copy.confirm.title}
          subject={confirm.summary}
          description={copy.confirm.question}
          onClose={() => answer(confirm, false)}
          initialFocusRef={denyRef}
          actions={
            <>
              <Button ref={denyRef} className="nx-dialog__cancel" onClick={() => answer(confirm, false)}>
                {copy.confirm.deny}
              </Button>
              <Button variant="primary" onClick={() => answer(confirm, true)}>
                {copy.confirm.allow}
              </Button>
            </>
          }
        >
          {/* Who is asking, and what the answer changes: the tool by its label, then
              its effect as a chip and one sentence. */}
          <div className="asst__ask">
            <span>{toolLabel(confirm.tool)}</span>
            <Chip>{effectCopy(confirm.effect).chip}</Chip>
          </div>
          <p className="nx-hint">{effectCopy(confirm.effect).note}</p>
        </Dialog>
      )}

      {removing !== null && (
        <ConfirmDialog
          title={copy.rail.confirmDeleteTitle}
          question={copy.rail.confirmDeleteBody}
          confirmLabel={copy.rail.confirmDelete}
          cancelLabel={copy.rail.cancel}
          destructive
          onConfirm={() => {
            const id = removing;
            setRemoving(null);
            void remove(id);
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

/**
 * One thread: the saved items, then the provisional draft of the turn that is
 * running. The draft is deliberately NOT merged into `items`: it becomes the
 * saved thread's own message the moment the poll reads `done`, and a page that
 * mixed the two would show the answer twice for one frame.
 */
function Thread({
  items,
  summary,
  boundary,
  live,
  starting,
}: {
  readonly items: readonly ThreadItem[];
  readonly summary: AssistantSummaryView | null;
  /** The id of the first message the summary does not stand for, or `null`. */
  readonly boundary: string | null;
  readonly live: LiveTurn | null;
  readonly starting: boolean;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  /** Whether the reader is at the bottom, so the stream may be followed. A scroll up stops it; sending starts it again. */
  const following = useRef(true);

  useEffect(() => {
    if (starting) following.current = true;
  }, [starting]);

  // After every render, so each streamed token keeps the answer in view while the
  // reader is following it (`dockRules.ts`). A scroll that changes nothing keeps the thread still.
  useEffect(() => {
    const element = scroller.current;
    if (element !== null && following.current) element.scrollTop = element.scrollHeight;
  });

  return (
    <div
      className="asst__scroll"
      ref={scroller}
      onScroll={(event) => {
        following.current = isNearBottom(event.currentTarget);
      }}
    >
      <div className="asst__thread">
        {items.map((item) => (
          <Fragment key={item.id}>
            {summary !== null && item.kind === "message" && item.id === boundary && (
              <SummaryDivider summary={summary} />
            )}
            {item.kind === "tools" ? (
              <ToolLines lines={item.lines} />
            ) : (
              <div className={item.role === "user" ? "asst__msg asst__msg-user" : "asst__msg"}>
                <p className="asst__text">{item.text}</p>
                {item.role === "assistant" && item.citations.length > 0 && (
                  <Citations citations={item.citations} />
                )}
                {item.role === "assistant" && item.safety && <SafetyNotice />}
              </div>
            )}
          </Fragment>
        ))}

        {/* The one region a screen reader is told about as the answer arrives. */}
        <div className="asst__msg" aria-live="polite">
          {live === null && starting && <p className="asst__text nx-hint">{copy.thread.loadingModel}</p>}
          {live !== null && live.tools.length > 0 && <ToolLines lines={live.tools} />}
          {live !== null && <p className="asst__text">{liveLine(live)}</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * What the live region says while a turn has no text yet: the earlier messages
 * being summarized, or the model thinking. The answer's own text replaces both.
 */
function liveLine(live: LiveTurn): string {
  if (live.text !== "") return live.text;
  return live.compaction === "running" ? copy.thread.summarizing : copy.thread.thinking;
}

/**
 * The line where a summary ends: the messages above it are summarized for the
 * assistant, and the summary's own text is one click away, closed by default.
 */
function SummaryDivider({ summary }: { readonly summary: AssistantSummaryView }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="asst__summary">
      <div className="asst__divider">
        <span className="nx-hint">{copy.thread.summaryDivider}</span>
      </div>
      <Disclosure label={copy.thread.summaryLabel} open={open} onToggle={setOpen}>
        <p className="asst__text">{summary.text}</p>
      </Disclosure>
    </div>
  );
}

/**
 * The line under the header: whether web search is on (and whether the network
 * mode lets it act), and what the knowledge base holds. It is the state that
 * decides whether a question leaves the machine, so it is read before the question
 * is asked, and it links to the card that changes it.
 */
function StatusRow({
  settings,
  knowledge,
}: {
  readonly settings: AssistantSettingsView;
  readonly knowledge: AssistantKnowledgeView;
}) {
  return (
    <div className="asst__status">
      <span className="nx-hint">{copy.status.web[webStatus(settings.webSearch)]}</span>
      <span className="nx-hint">
        {`${copy.status.indexed}: ${String(knowledge.indexedChunks)} · ${copy.status.pending}: ${String(knowledge.pendingSources)}`}
      </span>
      <Button
        size="sm"
        variant="quiet"
        onClick={() => openAppLocation({ module: "settings", settings: manifest.id })}
      >
        {copy.dock.settings}
      </Button>
    </div>
  );
}

/**
 * One run of tool activity: a line per call, with the outcome stated by the app.
 *
 * **The line is the receipt; the answer is commentary on it.** A small model
 * that says „I added the task" after a call that failed is the failure this
 * component exists for, and no prompt fixes it: the page knows whether the tool
 * acted (`ThreadToolLine.ok`), so the page says so itself. Everything the tools
 * did stays a quiet aside - the one line that did nothing is the one that
 * stands out, in words and a glyph as well as in the problem colour, which is
 * how this design system states a state that must not be carried by colour
 * alone.
 */
function ToolLines({ lines }: { readonly lines: readonly ThreadToolLine[] }) {
  return (
    <div className="asst__tools">
      {lines.map((line) => {
        const view = toolLineView(line);
        const failed = view.state === "failed";
        return (
          <p key={line.id} className={failed ? "nx-hint asst__tool-failed" : "nx-hint"}>
            {failed && (
              <span className="asst__tool-mark" aria-hidden="true">
                <Icon name="warning" size={13} />
              </span>
            )}
            {`${view.label} — ${copy.thread.tools.states[view.state]}`}
            {view.detail === "" ? "" : ` — ${view.detail}`}
          </p>
        );
      })}
    </div>
  );
}

/**
 * The sources under one answer, as links where there is somewhere to go.
 *
 * Each is prefixed with the number the answer's own markers use (`[1]`), so a
 * sentence that says `[2]` can be matched to the passage under it - which is
 * the whole point of showing sources at all. The numbers are the positions in
 * the list main built from the answer's own citations (`thread.ts`).
 */
function Citations({ citations }: { readonly citations: readonly Citation[] }) {
  return (
    <div className="asst__citations">
      <span className="nx-eyebrow">{copy.citations.sources}</span>
      {numberedCitations(citations).map(({ citation, number, label }) => {
        const target = citationTarget(citation);
        if (target.kind === "app") {
          return (
            <Button
              key={`${citation.kind}:${citation.id}`}
              size="sm"
              variant="quiet"
              onClick={() => openAppLocation(target.location)}
            >
              {`[${number}] ${label}`}
            </Button>
          );
        }
        if (target.kind === "web") {
          return (
            <Button
              key={`${citation.kind}:${citation.id}`}
              size="sm"
              variant="quiet"
              onClick={() => void openWebAddress(target.url)}
            >
              {`[${number}] ${label}`}
            </Button>
          );
        }
        return (
          <span key={`${citation.kind}:${citation.id}`} className="nx-hint">
            {`[${number}] ${label}`}
          </span>
        );
      })}
    </div>
  );
}
