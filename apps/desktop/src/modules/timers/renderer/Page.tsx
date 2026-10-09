import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  ListRow,
  LoadingState,
  PageHeader,
  TextField,
} from "@nexus/ui";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import type {
  TimersCountdownView,
  TimersPresetView,
  TimersView,
} from "../shared/ipc.js";
import { copy } from "./copy.js";
import {
  durationSecondsOf,
  formatClock,
  formatStopwatch,
  isRunning,
  remainingSecondsOf,
  type DurationFields,
} from "./timing.js";
import "./timers.css";

/**
 * TAJMERI (ADR-090) — the module kit's worked example: a page that lives in its
 * own folder, is loaded the first time somebody opens it, and reaches main only
 * through its own declared contract.
 *
 * **Three sections and no fourth.** A stopwatch, the countdowns that are
 * running, and the presets they can be saved as. The split is the module's own
 * shape rather than a layout decision: a stopwatch measures a span you are
 * standing in, a countdown is a named thing with an end, and a preset is a
 * countdown you have not started yet.
 *
 * **Everything on the clock comes from main or from an instant.** The countdown
 * clocks are computed from `endsAt` against a `now` this page reads once a
 * second (`timing.ts`), so a page opened halfway through one shows the time
 * that is really left. The stopwatch is the one thing that lives HERE, because
 * it is the one timer whose span is the page's own: it is measured in
 * `performance.now()` deltas, which is the only reading that is monotonic (a
 * wall-clock jump, or a DST boundary, cannot make it run backwards), and its
 * laps are splits of that same reading rather than a count of ticks.
 *
 * **The module owns its own copy.** Nothing here reads the shell's `strings`
 * table: `copy.ts` is this module's table, rewritten in place by the same
 * `applyLocale` walk the shell's goes through, and it arrives with this chunk.
 */

export default function TimersPage({ profileId }: ModulePageProps) {
  const [view, setView] = useState<TimersView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  /**
   * One read, into state. Every mutation answers with the same shape, so there is
   * exactly one way this page learns anything: what main just said. A local guess
   * applied on top of a write would be a second answer to a question that has
   * one.
   */
  const run = useCallback(
    async (action: (timers: typeof window.nexus.modules.timers) => Promise<TimersView>) => {
      try {
        setView(await action(window.nexus.modules.timers));
        setError(null);
      } catch (failure) {
        setError(copy.errors.mutate);
        console.error("Nexus: a timers change failed:", failure);
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      setView(await window.nexus.modules.timers.list({ profileId }));
      setError(null);
    } catch (failure) {
      setError(copy.errors.load);
      // No toast, no dialog: a page that cannot read says so in its own body and
      // keeps saying so until a read works, which is the least surprising thing
      // it can do.
      console.error("Nexus: the timers could not be loaded:", failure);
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handle = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(handle);
  }, []);

  /**
   * A countdown that reached its end is gone from main's tables (main removed it
   * when it announced), so this page re-reads once to drop the row — ONCE per id,
   * which is what the ref is for: without it, a row main has not removed yet
   * would make every tick a fresh read.
   */
  const ended = useRef(new Set<string>());
  const countdowns = view?.countdowns ?? [];
  useEffect(() => {
    const justEnded = countdowns.filter(
      (countdown) =>
        isRunning(countdown) &&
        remainingSecondsOf(countdown, nowMs) === 0 &&
        !ended.current.has(countdown.id),
    );
    if (justEnded.length === 0) return;
    for (const countdown of justEnded) ended.current.add(countdown.id);
    void refresh();
  }, [countdowns, nowMs, refresh]);

  return (
    <div className="timers">
      {/* The page's own name is the word the module DECLARED, read in the
          language being spoken, rather than a second copy of it: the rail, the
          settings gallery and this header then cannot disagree about what the
          module is called (ADR-090's copy split). */}
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="timer"
      />
      {error !== null && (
        <p className="timers__error" role="alert">
          {error}
        </p>
      )}
      {view === null ? (
        error === null && <LoadingState label={copy.page.loading} rows={4} />
      ) : (
        <>
          <StopwatchSection />
          <CountdownsSection
            profileId={profileId}
            countdowns={view.countdowns}
            nowMs={nowMs}
            run={run}
          />
          <PresetsSection profileId={profileId} presets={view.presets} run={run} />
        </>
      )}
    </div>
  );
}

// --- Štoperica ---------------------------------------------------------------

/**
 * The stopwatch: a span the page measures itself, in `performance.now()` deltas.
 *
 * **Why the reading is a delta and not a counter.** A counter that added one per
 * tick would be wrong the moment the renderer throttled an interval — which it
 * does for a hidden window — and it would be wrong for a lap taken across such a
 * gap. `elapsed()` is the accumulated time of the runs that have finished plus
 * the time since the current one started, so it is exactly what a stopwatch
 * says, however long the page was away.
 *
 * **Why the interval exists at all.** It only forces a repaint; no state is
 * advanced by it. Twenty renders a second, because the readout carries
 * hundredths and a coarser repaint would show the same number twice.
 */
function StopwatchSection() {
  const [running, setRunning] = useState(false);
  const [laps, setLaps] = useState<number[]>([]);
  /** Milliseconds from runs that have already been paused. */
  const banked = useRef(0);
  /** The `performance.now()` reading the current run started at, or null while paused. */
  const startedAt = useRef<number | null>(null);
  const [, repaint] = useState(0);

  const elapsed = useCallback((): number => {
    const current = startedAt.current;
    return banked.current + (current === null ? 0 : performance.now() - current);
  }, []);

  useEffect(() => {
    if (!running) return;
    const handle = setInterval(() => repaint((tick) => tick + 1), 50);
    return () => clearInterval(handle);
  }, [running]);

  const start = useCallback(() => {
    if (startedAt.current !== null) return;
    startedAt.current = performance.now();
    setRunning(true);
  }, []);

  const pause = useCallback(() => {
    if (startedAt.current === null) return;
    banked.current += performance.now() - startedAt.current;
    startedAt.current = null;
    setRunning(false);
  }, []);

  const reset = useCallback(() => {
    banked.current = 0;
    startedAt.current = null;
    setRunning(false);
    setLaps([]);
  }, []);

  const lap = useCallback(() => {
    // A lap is a SPLIT, so it is worth taking only while the clock runs; on a
    // paused stopwatch it would record the same reading twice.
    if (startedAt.current === null) return;
    setLaps((current) => [...current, elapsed()]);
  }, [elapsed]);

  /**
   * Space starts and pauses, L takes a lap, R resets — but only while nobody is
   * typing and nothing focusable is under the keys. A timer that stole Space
   * from a focused button would break the button, and one that stole a letter
   * from a text field would be the worst kind of help.
   *
   * The listener is attached while this page is mounted, which IS "the page has
   * focus": the shell draws one page at a time.
   */
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        if (active.isContentEditable) return;
        if (active.closest("input, textarea, select, button, [role='textbox']") !== null) return;
      }
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        if (running) pause();
        else start();
        return;
      }
      if (event.key === "l" || event.key === "L") {
        event.preventDefault();
        lap();
        return;
      }
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        reset();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [running, start, pause, lap, reset]);

  const total = elapsed();

  return (
    <Card className="timers__card" title={copy.stopwatch.title}>
      <p className="timers__clock" aria-live="off">
        {formatStopwatch(total)}
      </p>
      <div className="timers__actions">
        {running ? (
          <Button size="sm" onClick={pause}>
            {copy.stopwatch.pause}
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={start}>
            {banked.current === 0 ? copy.stopwatch.start : copy.stopwatch.resume}
          </Button>
        )}
        <Button size="sm" onClick={lap} disabled={!running}>
          {copy.stopwatch.lap}
        </Button>
        <Button
          size="sm"
          variant="quiet"
          onClick={reset}
          disabled={total === 0 && laps.length === 0}
        >
          {copy.stopwatch.reset}
        </Button>
      </div>
      <p className="nx-hint">{copy.stopwatch.keysHint}</p>
      {laps.length > 0 && (
        <div className="timers__laps">
          <div className="nx-eyebrow timers__laps-head">
            <span>{copy.stopwatch.lapsTitle}</span>
            <span>{copy.stopwatch.lapTotal}</span>
          </div>
          {laps.map((split, index) => (
            <ListRow
              key={index}
              leading={<span className="timers__lap-number">{index + 1}</span>}
              trailing={<span className="timers__lap-total">{formatStopwatch(split)}</span>}
            >
              <span className="timers__lap-time">
                {formatStopwatch(split - (laps[index - 1] ?? 0))}
              </span>
            </ListRow>
          ))}
        </div>
      )}
    </Card>
  );
}

// --- Odbrojavanja ------------------------------------------------------------

/** What a mutation takes: the ops the two sections below share, narrowed so neither can call the other's. */
type TimersApi = typeof window.nexus.modules.timers;
type Run = (action: (timers: TimersApi) => Promise<TimersView>) => Promise<void>;

function CountdownsSection({
  profileId,
  countdowns,
  nowMs,
  run,
}: {
  profileId: string;
  countdowns: readonly TimersCountdownView[];
  nowMs: number;
  run: Run;
}) {
  const [name, setName] = useState("");
  const [fields, setFields] = useState<DurationFields>({ hours: "", minutes: "", seconds: "" });
  const [problem, setProblem] = useState<"name" | "duration" | null>(null);

  /** The form's two answers, or null: a name the store will take and a duration it will hold. */
  function read(): { name: string; durationSeconds: number } | null {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 60) {
      setProblem("name");
      return null;
    }
    const durationSeconds = durationSecondsOf(fields);
    if (durationSeconds === null) {
      setProblem("duration");
      return null;
    }
    setProblem(null);
    return { name: trimmed, durationSeconds };
  }

  function clear(): void {
    setName("");
    setFields({ hours: "", minutes: "", seconds: "" });
  }

  return (
    <Card className="timers__card" title={copy.countdowns.title}>
      <div className="timers__new">
        <TextField
          label={copy.countdowns.name}
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
        />
        {problem === "name" && <p className="timers__field-error">{copy.errors.name}</p>}
        <div className="timers__duration">
          {(["hours", "minutes", "seconds"] as const).map((part) => (
            <TextField
              key={part}
              label={copy.countdowns[part]}
              className="timers__duration-field"
              inputMode="numeric"
              value={fields[part]}
              onChange={(event) => setFields({ ...fields, [part]: event.target.value })}
            />
          ))}
        </div>
        <div className="timers__actions">
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              const input = read();
              if (input === null) return;
              clear();
              void run((timers) => timers.createCountdown({ profileId, ...input }));
            }}
          >
            {copy.countdowns.start}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const input = read();
              if (input === null) return;
              clear();
              void run((timers) => timers.createPreset({ profileId, ...input }));
            }}
          >
            {copy.countdowns.savePreset}
          </Button>
        </div>
        {problem === "duration" && (
          <p className="timers__field-error">{copy.errors.duration}</p>
        )}
      </div>

      {countdowns.length === 0 ? (
        <p className="nx-hint">{copy.countdowns.empty}</p>
      ) : (
        <div className="timers__list">
          {countdowns.map((countdown) => {
            const running = isRunning(countdown);
            return (
              <ListRow
                key={countdown.id}
                leading={<Icon name="clock" />}
                // The clock is the row's subject, so it is the row's CONTENT
                // rather than a trailing chip: a countdown is read by its time,
                // and its name is what tells two of them apart.
                trailing={
                  <span className="timers__row-actions">
                    <Chip>{running ? copy.countdowns.running : copy.countdowns.paused}</Chip>
                    <Button
                      size="sm"
                      onClick={() =>
                        void run((timers) =>
                          (running ? timers.pauseCountdown : timers.resumeCountdown)({
                            profileId,
                            id: countdown.id,
                          }),
                        )
                      }
                    >
                      {running ? copy.countdowns.pause : copy.countdowns.resume}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        void run((timers) =>
                          timers.extendCountdown({ profileId, id: countdown.id, seconds: 60 }),
                        )
                      }
                    >
                      {copy.countdowns.addMinute}
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() =>
                        void run((timers) =>
                          timers.cancelCountdown({ profileId, id: countdown.id }),
                        )
                      }
                    >
                      {copy.countdowns.cancel}
                    </Button>
                  </span>
                }
                muted={!running}
              >
                <span className="timers__row-label">{countdown.label}</span>
                <span className="timers__row-clock">
                  {formatClock(remainingSecondsOf(countdown, nowMs))}
                </span>
              </ListRow>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// --- Preseti ----------------------------------------------------------------

function PresetsSection({
  profileId,
  presets,
  run,
}: {
  profileId: string;
  presets: readonly TimersPresetView[];
  run: Run;
}) {
  /** Which preset is being renamed, and what has been typed so far. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  return (
    <Card className="timers__card" title={copy.presets.title}>
      {presets.length === 0 ? (
        <EmptyState
          variant="inline"
          title={copy.presets.emptyTitle}
          description={copy.presets.emptyBody}
        />
      ) : (
        <div className="timers__list">
          {presets.map((preset) => (
            // A row being renamed is NOT a `ListRow`: its content is a text
            // field, and `ListRow` puts its content in a `<span>` — a block
            // control inside an inline element is a nesting the DOM allows but
            // the layout does not expect. So the editing state is a row of its
            // own, and the reading state is the shared one.
            renaming === preset.id ? (
              <div key={preset.id} className="timers__preset-edit">
                <TextField
                  label={copy.presets.rename}
                  value={draft}
                  maxLength={60}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <div className="timers__actions">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      const name = draft.trim();
                      if (name.length === 0) return;
                      setRenaming(null);
                      void run((timers) =>
                        timers.renamePreset({ profileId, id: preset.id, name }),
                      );
                    }}
                  >
                    {copy.presets.save}
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => setRenaming(null)}>
                    {copy.presets.cancel}
                  </Button>
                </div>
              </div>
            ) : (
              <ListRow
                key={preset.id}
                leading={<Icon name="repeat" />}
                trailing={
                  <span className="timers__row-actions">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() =>
                        void run((timers) =>
                          timers.createCountdown({
                            profileId,
                            name: preset.name,
                            durationSeconds: preset.durationSeconds,
                          }),
                        )
                      }
                    >
                      {copy.presets.start}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setRenaming(preset.id);
                        setDraft(preset.name);
                      }}
                    >
                      {copy.presets.rename}
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() =>
                        void run((timers) => timers.removePreset({ profileId, id: preset.id }))
                      }
                    >
                      {copy.presets.remove}
                    </Button>
                  </span>
                }
              >
                <span className="timers__row-label">{preset.name}</span>
                <span className="timers__row-clock">{formatClock(preset.durationSeconds)}</span>
              </ListRow>
            )
          ))}
        </div>
      )}
    </Card>
  );
}
