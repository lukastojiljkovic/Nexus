import { useEffect, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { FOCUS_PHASE_KINDS, phaseProgress } from "@nexus/core";
import type { FocusPhaseKind } from "@nexus/core";
import { Button, Chip, EmptyState, ListRow, PageHeader, TextField } from "@nexus/ui";
import { MAX_FOCUS_LABEL_LENGTH } from "../../shared/ipc.js";
import type { FocusSession, RunningFocusSession, Subject, Task } from "../../shared/ipc.js";
import { localTodayKey, shiftDayKey } from "./examDates.js";
import {
  focusSessionMinutes,
  formatDurationMinutes,
  formatFocusSessionWhen,
  formatPhaseClock,
} from "./focusFormat.js";
import { focusDayTotals, plannedWorkPhases, upcomingPhase } from "./focusPhases.js";
import { readStoredFocusConfig } from "./focusPrefs.js";
import { FocusDiscardDialog } from "./FocusDiscardDialog.js";
import { countUnit, strings } from "./strings.js";
import { moduleName } from "./moduleName.js";

/**
 * Fokus (UTIL slice b) — the page of the ONE focus timer. Slice a shipped the
 * engine (`focusSession.ts`), migration 057 and the store; this screen is bound
 * by every one of their decisions and revisits none:
 *
 * - **The running phase is NOT a row.** It lives in the main process, so this
 *   page reads it through `focus:status` and holds no idea of its own about
 *   what is running. Killing the app loses the phase honestly — there is no
 *   recovery here, and adding one would mean inventing a duration nobody saw.
 * - **One row is one PHASE, breaks included.** „Danas" states all three kinds,
 *   zeros and all: somebody who never takes a break has to be able to SEE that,
 *   and an omitted row would read as „no data" rather than as none.
 * - **Progress is wall-clock.** Every number on screen comes from
 *   `phaseProgress` against a `now` this page reads once a second — never from a
 *   tick count, so a machine that slept through half a phase tells the truth
 *   about it.
 * - **Overrun is visible and nothing ends by itself.** Past its plan the clock
 *   turns into a `+` and the page says so in words. The phase keeps running
 *   until the user closes it, because ending is a deliberate act and the end
 *   time is the one thing a focus row must not invent.
 * - **A paused phase LOOKS paused**: the clock is frozen (the engine freezes it
 *   at `pausedAt`), the heading says so, and the only forward action is
 *   „Nastavi".
 *
 * Two things the page deliberately does NOT do. It does not chain phases
 * automatically — the next one is SUGGESTED and started by hand, because an app
 * that silently put you into a break has decided something for you. And it never
 * edits a finished phase: a row is a fact about time that passed, so the only
 * thing offered on one is a delete with an undo.
 */

/** How far back the short history looks. A week: long enough to show a pattern, short enough to still be „recently". */
const HISTORY_DAYS = 7;

/** What a phase may be attached to. „Ni uz šta" is the ordinary case, and it is the default. */
type Attachment = { kind: "none" } | { kind: "task"; id: string } | { kind: "subject"; id: string };

/** The `<select>`'s flat value space — one string, so one native picker can hold two groups and a null. */
const NO_ATTACHMENT = "";

function attachmentValue(attachment: Attachment): string {
  return attachment.kind === "none" ? NO_ATTACHMENT : `${attachment.kind}:${attachment.id}`;
}

function parseAttachment(value: string): Attachment {
  const separator = value.indexOf(":");
  if (separator <= 0) return { kind: "none" };
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (id.length === 0) return { kind: "none" };
  if (kind === "task") return { kind: "task", id };
  if (kind === "subject") return { kind: "subject", id };
  return { kind: "none" };
}

/** Everything one render of this page stands on, read in one round of parallel calls. */
interface FocusSnapshot {
  running: RunningFocusSession | null;
  sessions: FocusSession[];
  tasks: Task[];
  subjects: Subject[];
}

/**
 * The page's one read. All four parts come back together for HABIT's reason: a
 * render showing a running phase but not the day it belongs to — or a day that
 * predates the phase that just ended — is never shown.
 *
 * Tasks and subjects ride along because the attach picker offers them, and they
 * are asked for only when their module is on: a picker listing rows from a
 * module the user switched off would be a door that is not there. With both off
 * a phase is simply subjectless, which is the ordinary case anyway.
 *
 * Module-level so the mount effect and every write's refresh call the same thing
 * without either becoming a dependency of the other.
 */
async function loadFocus(
  profileId: string,
  tasksOn: boolean,
  studyOn: boolean,
): Promise<FocusSnapshot> {
  const today = localTodayKey();
  const [running, sessions, tasks, subjects] = await Promise.all([
    window.nexus.focusStatus(profileId),
    window.nexus.listFocusRange(profileId, shiftDayKey(today, -(HISTORY_DAYS - 1)), today),
    tasksOn ? window.nexus.listTasks(profileId) : Promise.resolve<Task[]>([]),
    studyOn ? window.nexus.listSubjects(profileId) : Promise.resolve<Subject[]>([]),
  ]);
  return { running, sessions, tasks, subjects };
}

export interface FocusPageProps {
  profileId: string;
  /** SET-007 flags — which modules the attach picker may draw rows from. */
  enabledModules: ReadonlySet<string>;
}

export function FocusPage({ profileId, enabledModules }: FocusPageProps) {
  const s = strings.focus;
  // Read into booleans first, the idiom every dashboard widget's `load` follows:
  // `enabledModules` is a fresh `Set` on each of App's renders, so an effect
  // depending on it directly would re-read on every one of them.
  const tasksOn = enabledModules.has("tasks");
  const studyOn = enabledModules.has("study");

  const [running, setRunning] = useState<RunningFocusSession | null>(null);
  const [sessions, setSessions] = useState<FocusSession[] | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [failed, setFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);
  // „Odbaci" writes nothing at all and offers no undo afterwards — the one
  // running phase, so a boolean is enough to say the confirm is open.
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  // What the NEXT phase is attached to and called. Kept across a phase, so
  // starting the one after it does not begin from a blank form.
  const [attachment, setAttachment] = useState<Attachment>({ kind: "none" });
  const [labelDraft, setLabelDraft] = useState("");

  /**
   * The one reading of the clock every derived number here comes from, advanced
   * once a second. State rather than a `Date.now()` sprinkled through the
   * render, so ONE render is ONE instant: the clock, the overrun sentence and
   * the styling that marks it can never disagree about what time it is.
   */
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());

  /**
   * The Pomodoro shape, read ONCE per mount rather than per render: it is a
   * device preference the „Fokus" settings card owns and this page never writes,
   * and re-reading `localStorage` inside a per-second render would put a
   * synchronous storage call on every tick. A change made in Podešavanja lands
   * the next time this page is opened, exactly as every other module's device
   * preference does.
   */
  const [config] = useState(readStoredFocusConfig);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const snapshot = await loadFocus(profileId, tasksOn, studyOn);
        if (!active) return;
        setRunning(snapshot.running);
        setSessions(snapshot.sessions);
        setTasks(snapshot.tasks);
        setSubjects(snapshot.subjects);
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load focus:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, tasksOn, studyOn]);

  /**
   * The one-second tick, and it runs ONLY while a phase is running: a page
   * showing yesterday's totals has no reason to re-render at all, and an
   * interval left going would be a wake-up a second for a still screen.
   *
   * A PAUSED phase keeps ticking, deliberately. The numbers it recomputes are
   * frozen by the engine, so nothing on screen moves — but the tick is also what
   * would notice a phase that ended somewhere else, and stopping it would make
   * „pauzirano" the one state the page could get stuck in.
   */
  useEffect(() => {
    if (running === null) return;
    const id = window.setInterval(() => setNowIso(new Date().toISOString()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  /** Re-reads the whole screen after every write — a total, a history row and the running phase all move together. */
  async function reload(): Promise<void> {
    const snapshot = await loadFocus(profileId, tasksOn, studyOn);
    setRunning(snapshot.running);
    setSessions(snapshot.sessions);
    setTasks(snapshot.tasks);
    setSubjects(snapshot.subjects);
  }

  /** Runs one mutation: clears the previous refusal, performs it, re-reads. A failure leaves what was typed where it is. */
  async function run(action: () => Promise<void>): Promise<void> {
    setActionError(null);
    try {
      await action();
      await reload();
    } catch (error) {
      setActionError(s.actionError);
      console.error("Nexus: focus action failed:", error);
    }
  }

  const todayKey = localTodayKey();
  const allSessions = sessions ?? [];
  // The store answers newest-first, so today's rows lead and the rest are the
  // history below them — one read, two sections, no second query.
  const todaySessions = allSessions.filter((session) => session.startedAt.slice(0, 10) === todayKey);
  const earlierSessions = allSessions.filter(
    (session) => session.startedAt.slice(0, 10) !== todayKey,
  );
  const totals = focusDayTotals(todaySessions);
  const suggestion = upcomingPhase(config, todaySessions);

  const taskById = new Map(tasks.map((task) => [task.id, task] as const));
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject] as const));
  // A finished task is not something to focus ON, and an archived subject is one
  // somebody is done with — neither belongs in a picker about what to do next.
  const openTasks = tasks.filter((task) => !task.done);
  const openSubjects = subjects.filter((subject) => !subject.archived);

  /**
   * Starts one phase.
   *
   * The label snapshot is what the user typed, or — when they typed nothing —
   * the NAME of whatever they attached, which is the whole point of the
   * snapshot: the row must stay readable once the task is gone, and „what it was
   * called at the time" is exactly that fact.
   *
   * A BREAK carries no attachment and no label, and that is not an oversight: a
   * pause is not work done on anything, and letting it inherit the task would
   * put five minutes of not-working into that task's history.
   */
  async function start(kind: FocusPhaseKind, plannedMinutes: number): Promise<void> {
    const attachedName =
      attachment.kind === "task"
        ? (taskById.get(attachment.id)?.title ?? null)
        : attachment.kind === "subject"
          ? (subjectById.get(attachment.id)?.name ?? null)
          : null;
    const typed = labelDraft.trim();
    const isWork = kind === "work";
    await run(async () => {
      await window.nexus.startFocus(profileId, {
        kind,
        plannedMinutes,
        subjectId: isWork && attachment.kind === "subject" ? attachment.id : null,
        taskId: isWork && attachment.kind === "task" ? attachment.id : null,
        label: isWork ? (typed.length > 0 ? typed : attachedName) : null,
        // Where this phase sits in the cycle, counted off TODAY's own rows —
        // so a page reopened mid-afternoon resumes the count rather than
        // restarting it at one. A break carries the index of the work phase it
        // follows, which is what makes a cycle readable back out of the history.
        cycleIndex: plannedWorkPhases(todaySessions) + (isWork ? 1 : 0),
      });
    });
  }

  /** The phase running right now: what it is, how much is left of it, and the four things you may do to it. */
  function renderRunning(phase: RunningFocusSession): ReactNode {
    const progress = phaseProgress(phase, nowIso);
    const overrun = progress.overrunSeconds > 0;
    const clockClass = ["foc__clock"]
      .concat(progress.isPaused ? ["foc__clock--paused"] : [])
      .concat(overrun ? ["foc__clock--overrun"] : [])
      .join(" ");
    // The live name where the thing still exists, the row's own snapshot where
    // it does not — a phase must stay readable after its task is deleted.
    const attached =
      phase.subjectId !== null
        ? `${s.running.subjectPrefix}: ${subjectById.get(phase.subjectId)?.name ?? phase.label ?? ""}`
        : phase.taskId !== null
          ? `${s.running.taskPrefix}: ${taskById.get(phase.taskId)?.title ?? phase.label ?? ""}`
          : phase.label;

    return (
      <section className="foc__now" aria-label={s.running.heading}>
        <div className="foc__now-head">
          <span className="foc__heading">
            {progress.isPaused ? s.running.pausedHeading : s.running.heading}
          </span>
          <Chip variant={phase.kind === "work" ? "accent" : "data"}>{s.kind[phase.kind]}</Chip>
        </div>
        {/* `aria-live` off on purpose: a clock that announced itself every
            second would make the page unusable with a screen reader, and the
            two things worth announcing — the overrun line and the paused
            heading — say themselves. */}
        <div className={clockClass} role="timer" aria-live="off">
          {formatPhaseClock(progress, phase.plannedMinutes)}
        </div>
        {phase.plannedMinutes === null && <p className="foc__note">{s.running.openEnded}</p>}
        {overrun && (
          <p className="foc__note foc__note--overrun" role="status">
            {s.running.overrun}
          </p>
        )}
        {attached !== null && attached.length > 0 && <p className="foc__now-what">{attached}</p>}
        <div className="foc__now-actions">
          {/* Every action goes through `run`, which re-reads afterwards — so
              none of them patches `running` from its own answer. The phase lives
              in main and `focus:status` is the one thing that knows what it is;
              a locally applied answer plus a refresh would be two sources for
              one fact. */}
          {progress.isPaused ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => void run(async () => void (await window.nexus.resumeFocus(profileId)))}
            >
              {s.running.resume}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void run(async () => void (await window.nexus.pauseFocus(profileId)))}
            >
              {s.running.pause}
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            onClick={() => void run(async () => void (await window.nexus.stopFocus(profileId)))}
          >
            {s.running.stop}
          </Button>
          {/* „Odbaci" is `focus:cancel`: the phase ends and NOTHING is written.
              Offered because a timer started by mistake should not have to
              become a row somebody then deletes — but that same asymmetry
              (no row, no undo) is why it asks first, and stays visually
              subordinate to „Završi" (danger-outline vs. filled primary,
              tokens only) rather than sitting beside it as an equal. */}
          <Button
            size="sm"
            variant="danger"
            title={s.running.discardTitle}
            onClick={() => setConfirmingDiscard(true)}
          >
            {s.running.discard}
          </Button>
        </div>
        {confirmingDiscard && (
          <FocusDiscardDialog
            onConfirm={() => {
              setConfirmingDiscard(false);
              void run(async () => window.nexus.cancelFocus(profileId));
            }}
            onCancel={() => setConfirmingDiscard(false)}
          />
        )}
      </section>
    );
  }

  /** Nothing runs: what the cycle suggests, what to attach to it, and the three explicit starts. */
  function renderIdle(): ReactNode {
    return (
      <section className="foc__now" aria-label={s.idle.heading}>
        <div className="foc__now-head">
          <span className="foc__heading">{s.idle.heading}</span>
          <Chip variant={suggestion.kind === "work" ? "accent" : "data"}>
            {s.kind[suggestion.kind]}
          </Chip>
        </div>
        <div className="foc__clock foc__clock--idle">
          {formatDurationMinutes(suggestion.plannedMinutes)}
        </div>
        <p className="foc__note">{s.idle.caption}</p>

        {/* The attachment and the label describe a WORK phase, so they are
            offered where one is started and quietly ignored by a break's own
            button (see `start`). */}
        <div className="foc__fields">
          <label className="foc__field">
            <span className="foc__field-label">{s.idle.attachLabel}</span>
            <select
              className="foc__select"
              value={attachmentValue(attachment)}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setAttachment(parseAttachment(event.target.value))
              }
            >
              <option value={NO_ATTACHMENT}>{s.idle.attachNone}</option>
              {openTasks.length > 0 && (
                <optgroup label={s.idle.attachTaskGroup}>
                  {openTasks.map((task) => (
                    <option key={task.id} value={`task:${task.id}`}>
                      {task.title}
                    </option>
                  ))}
                </optgroup>
              )}
              {openSubjects.length > 0 && (
                <optgroup label={s.idle.attachSubjectGroup}>
                  {openSubjects.map((subject) => (
                    <option key={subject.id} value={`subject:${subject.id}`}>
                      {subject.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <TextField
            label={s.idle.labelLabel}
            value={labelDraft}
            placeholder={s.idle.labelPlaceholder}
            maxLength={MAX_FOCUS_LABEL_LENGTH}
            onChange={(event) => setLabelDraft(event.target.value)}
          />
        </div>
        <span className="foc__field-hint">{s.idle.labelHint}</span>

        <div className="foc__now-actions">
          <Button
            size="sm"
            variant="primary"
            onClick={() => void start(suggestion.kind, suggestion.plannedMinutes)}
          >
            {s.idle.start}
          </Button>
          {/* The suggestion is a suggestion. Every kind stays one click away, so
              the cycle never becomes a rule the user has to argue with. */}
          <Button
            size="sm"
            className="foc__quiet"
            onClick={() => void start("work", config.workMinutes)}
          >
            {s.idle.startWork}
          </Button>
          <Button
            size="sm"
            className="foc__quiet"
            onClick={() => void start("short_break", config.shortBreakMinutes)}
          >
            {s.idle.startShortBreak}
          </Button>
          <Button
            size="sm"
            className="foc__quiet"
            onClick={() => void start("long_break", config.longBreakMinutes)}
          >
            {s.idle.startLongBreak}
          </Button>
        </div>
      </section>
    );
  }

  /** One finished phase: when it was, what kind, how long it actually held, and what it was about. */
  function renderRow(session: FocusSession): ReactNode {
    const minutes = focusSessionMinutes(session);
    // The row's own overrun test is against the ATTENTION it held, the same
    // figure printed beside it — so the chip and the number can never disagree.
    const overran = session.plannedMinutes !== null && minutes > session.plannedMinutes;
    const what =
      session.subjectId !== null
        ? (subjectById.get(session.subjectId)?.name ?? session.label)
        : (session.label ??
          (session.taskId !== null ? (taskById.get(session.taskId)?.title ?? null) : null));
    return (
      <ListRow
        key={session.id}
        leading={
          <Chip variant={session.kind === "work" ? "accent" : "data"}>{s.kind[session.kind]}</Chip>
        }
        trailing={
          <span className="foc__row-actions">
            <Button
              size="sm"
              className="foc__row-action"
              onClick={() =>
                void run(async () => {
                  await window.nexus.deleteFocus(profileId, session.id);
                  // One pending undo at a time — a fresh delete replaces the offer.
                  setPendingUndoId(session.id);
                })
              }
            >
              {s.history.delete}
            </Button>
          </span>
        }
      >
        <span className="foc__row-body">
          <span className="foc__row-when">{formatFocusSessionWhen(session.startedAt)}</span>
          <span className="foc__row-minutes">{formatDurationMinutes(minutes)}</span>
          {what !== null && what.length > 0 && <span className="foc__row-what">{what}</span>}
          {session.plannedMinutes === null ? (
            <Chip>{s.history.openEndedChip}</Chip>
          ) : overran ? (
            <Chip variant="data">{s.history.overrunChip}</Chip>
          ) : null}
        </span>
      </ListRow>
    );
  }

  // --- The screen -------------------------------------------------------------

  if (failed) {
    return <EmptyState title={s.loadErrorTitle} description={s.loadError} />;
  }
  if (sessions === null) {
    return <p className="app__muted">{strings.app.loading}</p>;
  }

  return (
    <div className="foc">
      <PageHeader title={moduleName("focus")} />
      {pendingUndoId !== null && (
        <div className="foc__undo" role="status">
          <span className="foc__undo-text">{s.history.deletedNotice}</span>
          <Button
            size="sm"
            onClick={() =>
              void run(async () => {
                await window.nexus.restoreFocus(profileId, pendingUndoId);
                setPendingUndoId(null);
              })
            }
          >
            {s.undo}
          </Button>
          <Button
            size="sm"
            className="foc__quiet"
            aria-label={s.dismiss}
            onClick={() => setPendingUndoId(null)}
          >
            ×
          </Button>
        </div>
      )}

      {running !== null ? renderRunning(running) : renderIdle()}

      {actionError !== null && (
        <p className="foc__error" role="status">
          {actionError}
        </p>
      )}

      <section className="foc__section" aria-label={s.today.heading}>
        <div className="foc__heading">{s.today.heading}</div>
        {todaySessions.length === 0 ? (
          <EmptyState title={s.today.emptyTitle} description={s.today.emptyDescription} />
        ) : (
          <>
            <div className="foc__totals">
              {FOCUS_PHASE_KINDS.map((kind) => (
                <div key={kind} className="foc__total">
                  <span className="foc__total-label">{s.kind[kind]}</span>
                  <span className="foc__total-value">
                    {formatDurationMinutes(totals[kind].minutes)}
                  </span>
                  <span className="foc__total-caption">
                    {`${totals[kind].sessions} ${countUnit(
                      totals[kind].sessions,
                      s.today.phaseUnitOne,
                      s.today.phaseUnitFew,
                      s.today.phaseUnitMany,
                    )}`}
                  </span>
                </div>
              ))}
            </div>
            {/* The zero that has something to say. Stated in words as well as in
                the totals above, because a „0 min" among three figures is easy
                to read past and „danas nijedna pauza" is not. */}
            {totals.short_break.sessions + totals.long_break.sessions === 0 && (
              <p className="foc__note">{s.today.noBreaks}</p>
            )}
            <div className="foc__list">{todaySessions.map((session) => renderRow(session))}</div>
          </>
        )}
      </section>

      <section className="foc__section" aria-label={s.history.heading}>
        <div className="foc__heading">{s.history.heading}</div>
        {earlierSessions.length === 0 ? (
          <p className="foc__note">{s.history.empty}</p>
        ) : (
          <div className="foc__list">{earlierSessions.map((session) => renderRow(session))}</div>
        )}
      </section>
    </div>
  );
}
