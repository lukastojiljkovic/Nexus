import { useCallback, useEffect, useRef, useState } from "react";
import { ASSISTANT_WORKFLOWS, type Citation } from "@nexus/core";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ListRow,
  LoadingState,
  PageHeader,
  TextArea,
  TextField,
} from "@nexus/ui";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { activeLocale, declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { SafetyNotice } from "../../../renderer/src/safetyNotice.js";
import { manifest } from "../shared/manifest.js";
import type {
  AssistantSetupView,
  AssistantThreadView,
  AssistantView,
} from "../shared/ipc.js";
import { copy } from "./copy.js";
import { openAppLocation, openWebAddress } from "./location.js";
import { ModelPanel } from "./ModelPanel.js";
import { citationTarget, groupThread, type ThreadItem } from "./thread.js";
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
 * **A confirmation is a dialog, and leaving the page refuses.** A `write` or
 * `network` tool parks in main until the user answers; this page draws the
 * house `ConfirmDialog` with the tool's own one-line summary, and its cleanup
 * calls `stop` - so a page that is left, or a turn that is stopped, resolves
 * every parked question as refused rather than leaving a tool waiting forever.
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
  /** One line per tool call and per result, as they happen. */
  readonly tools: { id: string; name: string; text: string }[];
}

export default function AssistantPage({ profileId }: ModulePageProps) {
  const [view, setView] = useState<AssistantView | null>(null);
  const [setup, setSetup] = useState<AssistantSetupView | null>(null);
  const [thread, setThread] = useState<AssistantThreadView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [confirm, setConfirm] = useState<{ requestId: string; summary: string } | null>(null);
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

  const refresh = useCallback(async () => {
    try {
      setView(await window.nexus.modules.assistant.list({ profileId }));
      setError(null);
    } catch (failure) {
      setError(copy.errors.load);
      console.error("Nexus: the assistant could not be loaded:", failure);
    }
  }, [profileId]);

  const refreshSetup = useCallback(async () => {
    try {
      setSetup(await window.nexus.modules.assistant.setup({ profileId }));
    } catch (failure) {
      setError(copy.errors.load);
      console.error("Nexus: the assistant's models could not be loaded:", failure);
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
    void refreshSetup();
  }, [refresh, refreshSetup]);

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

  /** Ends the turn this page is watching, if any. Called by Stop and by leaving the page. */
  const stop = useCallback(async () => {
    const current = liveRef.current;
    if (current === null) return;
    try {
      await window.nexus.modules.assistant.stop({ profileId, turnId: current.turnId });
    } catch (failure) {
      // A turn that already ended is not a failure the user needs to read: the
      // poll that observes `done` is what clears the page.
      console.error("Nexus: the assistant turn could not be stopped:", failure);
    }
  }, [profileId]);

  // The page's own unmount stops the turn: a parked confirmation must not outlive
  // the dialog that would have answered it.
  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  const send = useCallback(
    async (text: string, workflowId: string | null) => {
      const trimmed = text.trim();
      if (trimmed === "" || liveRef.current !== null || sendingRef.current || thread === null) return;
      sendingRef.current = true;
      try {
        const started = await window.nexus.modules.assistant.send({
          profileId,
          conversationId: thread.conversation.id,
          text: trimmed,
          workflowId,
        });
        cursor.current = 0;
        const next: LiveTurn = { turnId: started.turnId, text: "", tools: [] };
        liveRef.current = next;
        setLive(next);
        setDraft("");
        setError(null);
        // The user's own message is written before the model is asked anything,
        // so the thread gains it here rather than waiting for the answer.
        await openConversation(thread.conversation.id);
      } catch (failure) {
        setError(copy.errors.send);
        console.error("Nexus: the assistant turn could not be started:", failure);
      } finally {
        sendingRef.current = false;
      }
    },
    [openConversation, profileId, thread],
  );

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
            if (event.type === "token") {
              current.text += event.text;
              setLive({ ...current });
            } else if (event.type === "tool-call") {
              current.tools.push({ id: event.call.id, name: event.call.name, text: "" });
              setLive({ ...current });
            } else if (event.type === "tool-result") {
              const line = current.tools.find((tool) => tool.id === event.callId);
              if (line !== undefined) line.text = event.result.content.slice(0, 120);
              setLive({ ...current });
            } else if (event.type === "confirm") {
              setConfirm({ requestId: event.requestId, summary: event.summary });
            } else if (event.type === "error" && event.code === "aborted") {
              setError(copy.thread.stopped);
            }
          }
          if (polled.done) {
            liveRef.current = null;
            setLive(null);
            setConfirm(null);
            if (polled.thread !== null) setThread(polled.thread);
            await refresh();
          }
        } catch (failure) {
          if (!active) return;
          liveRef.current = null;
          setLive(null);
          setError(copy.errors.send);
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
  }, [live, profileId, refresh]);

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

  const modelReady = setup !== null && setup.installed.some((entry) => entry.servesTiers.length > 0);
  const conversation = thread?.conversation ?? null;

  return (
    <div className="asst">
      {/* The page's own name is the word the manifest DECLARED, so the rail, the
          settings gallery and this header cannot disagree about it. */}
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="assistant"
        primaryAction={
          <Button size="sm" variant="primary" disabled={!modelReady} onClick={() => void newConversation()}>
            {copy.rail.new}
          </Button>
        }
        secondaryActions={[
          <Button key="models" size="sm" onClick={() => setModelsOpen((open) => !open)}>
            {modelsOpen ? copy.setup.close : copy.rail.models}
          </Button>,
        ]}
        overflowLabel={copy.rail.models}
      />
      {error !== null && (
        <p className="asst__error" role="alert">
          {error}
        </p>
      )}
      {view === null || setup === null ? (
        <LoadingState label={copy.page.loading} rows={4} />
      ) : (
        <div className="asst__grid">
          {modelReady && (
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
              <ModelPanel profileId={profileId} setup={setup} onSetup={setSetup} />
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
                  live={live}
                />
                <div className="asst__workflows">
                  <span className="nx-eyebrow">{copy.workflows.title}</span>
                  <div className="asst__actions">
                    {ASSISTANT_WORKFLOWS.map((workflow) => (
                      <Button
                        key={workflow.id}
                        size="sm"
                        disabled={live !== null}
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
                    {live === null ? (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={draft.trim() === ""}
                        onClick={() => void send(draft, null)}
                      >
                        {copy.composer.send}
                      </Button>
                    ) : (
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
        <ConfirmDialog
          title={copy.confirm.title}
          name={confirm.summary}
          question={copy.confirm.question}
          confirmLabel={copy.confirm.allow}
          cancelLabel={copy.confirm.deny}
          onConfirm={() => {
            const requestId = confirm.requestId;
            setConfirm(null);
            void window.nexus.modules.assistant
              .answerConfirm({ profileId, requestId, allow: true })
              .catch((failure: unknown) => {
                console.error("Nexus: a confirmation could not be answered:", failure);
              });
          }}
          onCancel={() => {
            const requestId = confirm.requestId;
            setConfirm(null);
            void window.nexus.modules.assistant
              .answerConfirm({ profileId, requestId, allow: false })
              .catch((failure: unknown) => {
                console.error("Nexus: a confirmation could not be answered:", failure);
              });
          }}
        />
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
  live,
}: {
  readonly items: readonly ThreadItem[];
  readonly live: LiveTurn | null;
}) {
  return (
    <div className="asst__thread">
      {items.map((item) =>
        item.kind === "tools" ? (
          <div key={item.id} className="asst__tools">
            {item.lines.map((line) => (
              <p key={line.id} className="nx-hint">
                {line.name === null ? copy.thread.tools : `${copy.thread.tools}: ${line.name}`}
                {line.text === "" ? "" : ` — ${line.text}`}
              </p>
            ))}
          </div>
        ) : (
          <div
            key={item.id}
            className={item.role === "user" ? "asst__msg asst__msg-user" : "asst__msg"}
          >
            <p className="asst__text">{item.text}</p>
            {item.role === "assistant" && item.citations.length > 0 && (
              <Citations citations={item.citations} />
            )}
            {item.role === "assistant" && item.safety && <SafetyNotice />}
          </div>
        ),
      )}

      {live !== null && (
        <div className="asst__msg">
          {live.tools.length > 0 && (
            <div className="asst__tools">
              {live.tools.map((line) => (
                <p key={line.id} className="nx-hint">
                  {`${copy.thread.tools}: ${line.name}`}
                  {line.text === "" ? "" : ` — ${line.text}`}
                </p>
              ))}
            </div>
          )}
          <p className="asst__text">{live.text === "" ? copy.thread.thinking : live.text}</p>
        </div>
      )}
    </div>
  );
}

/** The sources under one answer, as links where there is somewhere to go. */
function Citations({ citations }: { readonly citations: readonly Citation[] }) {
  return (
    <div className="asst__citations">
      <span className="nx-eyebrow">{copy.citations.sources}</span>
      {citations.map((citation) => {
        const target = citationTarget(citation);
        const label =
          citation.locator === undefined ? citation.title : `${citation.title} — ${citation.locator}`;
        if (target.kind === "app") {
          return (
            <Button
              key={`${citation.kind}:${citation.id}`}
              size="sm"
              variant="quiet"
              onClick={() => openAppLocation(target.location)}
            >
              {label}
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
              {label}
            </Button>
          );
        }
        return (
          <span key={`${citation.kind}:${citation.id}`} className="nx-hint">
            {label}
          </span>
        );
      })}
    </div>
  );
}
