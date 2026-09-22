import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EMPTY_LOG, LOG_CAP_BYTES, RUNNER_PROFILES, appendLog, logText } from "@nexus/core";
import type { RunnerLog, RunnerProfileId } from "@nexus/core";
import { Button, Select } from "@nexus/ui";

import type {
  RunnerDetection,
  RunnerOutcome,
  RunnerPlanResult,
  RunnerSettings,
  RunnerStartResult,
  RunnerState,
  RunnerStopState,
} from "../../shared/ipc.js";
import { fill, strings } from "./strings.js";
import { useFocusTrap } from "./useFocusTrap.js";

export interface ElecRunnerDialogProps {
  profileId: string;
  /**
   * The circuit whose package is built. Every run channel takes this id and
   * NOTHING else — not a command, not a profile, not a distribution — so this
   * dialog can ask for a build but cannot describe one.
   */
  circuitId: string;
  onClose: () => void;
}

/**
 * „Pokretač" — building the generated package with the user's own toolchain
 * (ADR-085 E6).
 *
 * **This is the first thing in Nexus that starts a process on somebody's
 * computer, and the screen is ordered for that fact alone.** The switch comes
 * first because nothing runs until it is on; the probe comes before the choice
 * because which profiles exist is a fact about the machine rather than about
 * this app; the choice comes before the command because the command is derived
 * from it; and the command is printed as the LITERAL argv before the button
 * that runs it. A screen that showed the command afterwards would be showing a
 * description, and a user who agreed to a description has consented to nothing
 * they could check.
 *
 * **Main builds the command and this file only draws it.** `runnerPlan` is a
 * separate channel from `runnerStart` for exactly this reason, and the renderer
 * never assembles a command line: it asks for one and prints what comes back.
 * `@nexus/core`'s `runner.ts` is where those command lines are written down,
 * and its header carries the argument for why that is a security boundary
 * rather than a tidy arrangement of constants.
 *
 * **The choice shows the ANSWER, never the click.** Every control on this screen
 * is drawn from `settings`, the last thing main said, rather than from what was
 * just clicked — and the two can differ, because the switch and the choice are
 * each a write main may refuse (a locked database) and because turning the
 * runner off CLEARS both. A control that obeys and then undoes itself is worse
 * than one that never moved, because the user has been told they were heard.
 *
 * **The log is capped here for the same reason it is capped in main.** A
 * toolchain prints as fast as it likes for as long as it likes, and this is the
 * renderer's memory as much as main's — `appendLog` drops whole chunks to stay
 * inside `LOG_CAP_BYTES`, and the panel says so above the log rather than
 * showing the tail of a build as if it were the whole of it.
 *
 * Same house recipe as the code, bench and chassis dialogs — backdrop and panel
 * as siblings, Escape and the backdrop close, focus trapped and handed back,
 * and the body scrolls rather than the panel growing past the window.
 */
export function ElecRunnerDialog({ profileId, circuitId, onClose }: ElecRunnerDialogProps) {
  const s = strings.electronics.runner;
  const titleId = useId();
  // One id prefix for the whole radio group rather than one per row: the rows
  // are a `map`, and a hook cannot be called inside one.
  const fieldIds = useId();
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });

  const [settings, setSettings] = useState<RunnerSettings | null>(null);
  /** The settings could not be read at all — a different sentence from „the runner is off". */
  const [failed, setFailed] = useState(false);
  const [state, setState] = useState<RunnerState | null>(null);
  /** Null until the probe button is pressed; the probe SPAWNS, so nothing does it for the user. */
  const [detection, setDetection] = useState<RunnerDetection[] | null>(null);
  const [plan, setPlan] = useState<RunnerPlanResult | null>(null);
  const [log, setLog] = useState<RunnerLog>(EMPTY_LOG);
  const [stopAnswer, setStopAnswer] = useState<RunnerStopState | null>(null);
  /** The sentence for whatever was refused, and the child's own words when it produced any. */
  const [message, setMessage] = useState<string | null>(null);
  const [verbatim, setVerbatim] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);
  /**
   * Which run the log belongs to, by when it started.
   *
   * A run has no id, and `startedAt` is the one field that changes when a new
   * one begins — so this is how the panel tells „more output from the run I am
   * already showing" (append) from „a run somebody started, possibly in another
   * window" (start a fresh log). Without it, a second build would be logged
   * onto the end of the first one's, and the boundary between them — the moment
   * the first one's errors stop being the second one's — would be invisible.
   */
  const loggedRun = useRef<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /**
   * The switch and the state, read once on open.
   *
   * Both, and together: `state` is what a second window may already be running,
   * and a panel that drew an idle screen over a live build for one frame would
   * offer „Pokreni" over a run that is already going (which main would refuse —
   * `already-running` — leaving the user with a sentence about a rule they
   * never broke).
   */
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [loaded, current] = await Promise.all([
          window.nexus.runnerSettings(profileId),
          window.nexus.runnerState(profileId),
        ]);
        if (!active) return;
        setSettings(loaded);
        setState(current);
        loggedRun.current = current.run?.startedAt ?? null;
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to read the runner settings:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  /**
   * The run's own two channels.
   *
   * `onRunnerChanged` carries the phase and the ending; `onRunnerOutput`
   * carries the output. They are separate because they are different kinds of
   * news — the phase changes a handful of times in a build and the output
   * arrives continuously — and subscribing to the first is what makes this
   * panel learn that a run ENDED rather than polling for it, and what lets a
   * second window watch a build it did not start.
   */
  useEffect(() => {
    const stopWatching = window.nexus.onRunnerChanged((next) => {
      setState(next);
      if (next.run !== null && next.run.startedAt !== loggedRun.current) {
        loggedRun.current = next.run.startedAt;
        setLog(EMPTY_LOG);
        setStopAnswer(null);
        // The failure that belonged to the attempt is now part of the state's
        // own ending, which carries it verbatim — twice would be one too many.
        setVerbatim(null);
      }
    });
    const stopListening = window.nexus.onRunnerOutput((event) => {
      setLog((previous) => appendLog(previous, event.text));
    });
    return () => {
      stopWatching();
      stopListening();
    };
  }, [profileId]);

  /**
   * The literal command, re-asked whenever the answer can change: the switch,
   * the profile, the distribution and the circuit.
   *
   * A read, not a write, so it costs nothing to ask again — and asking again is
   * the only way the block keeps up with a choice that main may have refused or
   * normalised. Nothing is started here, which is what makes it safe to run on
   * every one of those changes.
   */
  const enabled = settings?.enabled === true;
  const choice = settings?.choice ?? null;
  const distro = settings?.distro ?? null;

  useEffect(() => {
    if (!enabled) {
      setPlan(null);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const next = await window.nexus.runnerPlan(profileId, circuitId);
        if (active) setPlan(next);
      } catch (error) {
        if (active) setMessage(strings.electronics.actionError);
        console.error("Nexus: failed to build the runner's plan:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [enabled, choice, distro, profileId, circuitId]);

  /**
   * One write, one answer.
   *
   * `refusal` is the caller's because the two writes are two different acts: a
   * failed CHOICE leaves the panel saying nothing about a profile, and a failed
   * SWITCH is a consent that was not recorded — which is the one of the two a
   * user should be told about in those words rather than „something went wrong".
   */
  async function write(action: () => Promise<RunnerSettings>, refusal: string): Promise<void> {
    setMessage(null);
    setBusy(true);
    try {
      setSettings(await action());
    } catch (error) {
      setMessage(refusal);
      console.error("Nexus: runner write failed:", error);
    } finally {
      setBusy(false);
    }
  }

  async function choose(next: RunnerProfileId, nextDistro: string | null): Promise<void> {
    await write(
      () => window.nexus.runnerChoice(profileId, next, nextDistro),
      s.choice.rejected,
    );
  }

  /**
   * The one control on this screen that SPAWNS, and therefore a button.
   *
   * A probe is a process per profile — `colcon --help` and `docker version`
   * (the engine's answer and not the client's, which says „installed" with the
   * engine stopped) — and for WSL a `wsl.exe -l -q` plus one more inside each
   * distribution it lists. It takes seconds, and a dialog that ran it on open
   * would start six processes because somebody clicked a toolbar button.
   *
   * Main refuses this while the switch is off, which is why the button only
   * exists in the on branch: a probe is a process, so it is behind the consent
   * like everything else here.
   */
  async function probe(): Promise<void> {
    setMessage(null);
    setDetecting(true);
    try {
      setDetection(await window.nexus.runnerDetect(profileId));
    } catch (error) {
      setMessage(strings.electronics.actionError);
      console.error("Nexus: failed to probe the runner's profiles:", error);
    } finally {
      setDetecting(false);
    }
  }

  async function start(): Promise<void> {
    setMessage(null);
    setVerbatim(null);
    setBusy(true);
    try {
      const started: RunnerStartResult = await window.nexus.runnerStart(profileId, circuitId);
      if (!started.started) {
        setMessage(startSentence(started.reason));
        setVerbatim(started.message);
      }
    } catch (error) {
      setMessage(strings.electronics.actionError);
      console.error("Nexus: failed to start the run:", error);
    } finally {
      setBusy(false);
    }
  }

  async function stop(): Promise<void> {
    setMessage(null);
    setBusy(true);
    try {
      setStopAnswer(await window.nexus.runnerStop(profileId));
    } catch (error) {
      setMessage(strings.electronics.actionError);
      console.error("Nexus: failed to stop the run:", error);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Off, and a run in flight is stopped first.
   *
   * The order is the whole of this function: disabling under a live build would
   * leave a process running that the panel no longer draws, and nothing
   * afterwards would be able to say whether it had ended. So the stop is asked
   * for and awaited, and only then is the switch thrown.
   */
  async function disable(): Promise<void> {
    setMessage(null);
    setBusy(true);
    try {
      if (state !== null && state.phase !== "idle") {
        setStopAnswer(await window.nexus.runnerStop(profileId));
      }
      setSettings(await window.nexus.runnerEnable(profileId, false));
    } catch (error) {
      setMessage(strings.electronics.actionError);
      console.error("Nexus: failed to turn the runner off:", error);
    } finally {
      setBusy(false);
    }
  }

  const phase = state?.phase ?? "idle";
  const run = state?.run ?? null;
  const ending = endingOf(state?.last ?? null, stopAnswer);
  const dropped = log.truncated || run?.truncated === true;
  // Memoised on the log alone: `logText` joins every chunk, and a build prints
  // tens of chunks a second, so a panel that re-rendered for another reason
  // would otherwise rebuild a quarter of a megabyte to draw it again.
  const text = useMemo(() => logText(log), [log]);
  // Locked while a write is in flight and while a run is going. The second half
  // is not a UI courtesy: main refuses `already-running`, and a panel that
  // offered the choice would be offering a refusal.
  const locked = busy || phase !== "idle";
  // What the command block prints, and where it comes from: the RUN's own argv
  // when one is in flight (a second window shows the command it did not
  // consent to, which is the point of `RunnerRunView.argv`), and the plan's
  // otherwise.
  const shown = run ?? (plan?.kind === "command" ? plan : null);
  const hasRun = run !== null || log.bytes > 0 || ending !== null || stopAnswer === "idle";

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        className="recur-dialog__panel elec-runner__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="recur-dialog__title">
          {s.dialogTitle}
        </h2>

        {failed ? (
          <p className="nx-hint nx-hint--prose">{s.loadError}</p>
        ) : settings === null ? (
          <p className="nx-hint nx-hint--prose">{strings.app.loading}</p>
        ) : !settings.enabled ? (
          <div className="elec-code__body">
            <Consent
              busy={busy}
              onEnable={() =>
                void write(() => window.nexus.runnerEnable(profileId, true), s.consent.rejected)
              }
            />
          </div>
        ) : (
          <div className="elec-code__body">
            <section className="elec-code__section">
              <h3 className="nx-eyebrow elec-code__heading">{s.detect.heading}</h3>
              <div className="elec-runner__probe">
                <Button variant="ghost" disabled={detecting || busy} onClick={() => void probe()}>
                  {detecting ? s.detect.checking : s.detect.button}
                </Button>
              </div>
              {detection === null ? (
                <p className="nx-hint nx-hint--prose">{s.detect.empty}</p>
              ) : (
                <ul className="elec-runner__found">
                  {detection.map((entry) => (
                    <li key={entry.profile} className="elec-runner__found-row">
                      <span className="elec-runner__found-name">
                        {s.choice.profiles[entry.profile]}
                      </span>
                      <span className="elec-runner__found-state">{foundWord(entry)}</span>
                      {entry.detail !== null && (
                        <span className="elec-runner__found-detail">{entry.detail}</span>
                      )}
                      {entry.distros.length > 0 && (
                        <ul className="elec-runner__distros">
                          {entry.distros.map((listed) => (
                            <li
                              key={listed.name}
                              className={`elec-runner__distro${
                                listed.usable ? "" : " elec-runner__distro--unusable"
                              }`}
                            >
                              {listed.name} ·{" "}
                              {listed.usable ? s.detect.distroUsable : s.detect.distroUnusable}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <fieldset className="elec-runner__choices">
              <legend className="elec-inspector__label">{s.choice.heading}</legend>
              {detection === null && <p className="elec-code__hint">{s.choice.needsDetection}</p>}
              {RUNNER_PROFILES.map((profile) => {
                const found = detection?.find((entry) => entry.profile === profile);
                const absent = found === undefined || !found.present;
                return (
                  <div key={profile} className="elec-runner__choice">
                    <label className="elec-runner__choice-row">
                      <input
                        // The shared control, not a native one: a bare
                        // `input type=radio` renders at 13x13 in the OS widget
                        // and carries an eleven-pixel hole in its hit area.
                        className="nx-radio"
                        type="radio"
                        name={`${fieldIds}-profile`}
                        value={profile}
                        checked={choice === profile}
                        disabled={locked || detection === null || absent}
                        onChange={() => void choose(profile, profile === "wsl" ? distro : null)}
                        // The row is a wrapping label, so without these two the
                        // radio is introduced as „Docker colcon u kontejneru…" —
                        // the name and its explanation as one utterance. Naming
                        // the span fixes the name, and because
                        // `aria-labelledby` REPLACES the label's text rather
                        // than filtering it, the explanation has to be handed
                        // back deliberately: `aria-describedby` is what keeps
                        // the hint audible instead of trading one defect for a
                        // silence.
                        aria-labelledby={`${fieldIds}-${profile}`}
                        aria-describedby={`${fieldIds}-${profile}-hint`}
                      />
                      <span className="elec-runner__choice-name" id={`${fieldIds}-${profile}`}>
                        {s.choice.profiles[profile]}
                      </span>
                      <span
                        className="elec-runner__choice-hint"
                        id={`${fieldIds}-${profile}-hint`}
                      >
                        {s.choice.hints[profile]}
                      </span>
                    </label>
                    {profile === "wsl" && found !== undefined && found.distros.length > 0 && (
                      <div className="elec-runner__distro-row">
                        {/*
                          The distribution is the second half of choosing WSL, so
                          picking one writes the choice too — a select that only
                          remembered a name under a profile that was not chosen
                          would leave main with a distro and no profile to use
                          it in.

                          The placeholder carries an empty VALUE, because that is
                          how a `<select>` spells „nothing selected" — and `null`
                          is the only thing a caller may send for it. Passing the
                          empty string through was a control that could never
                          succeed: main takes `null` as „clear it" and any other
                          string as a name, so the one option the user can pick
                          to UNDO a distribution was the one option that always
                          came back as an error.
                        */}
                        <Select
                          className="elec-runner__distro-select"
                          label={s.choice.distroLabel}
                          value={distro ?? ""}
                          disabled={locked}
                          onChange={(event) =>
                            void choose("wsl", event.target.value === "" ? null : event.target.value)
                          }
                        >
                          <option value="">{s.choice.distroNone}</option>
                          {found.distros.map((listed) => (
                            // A distribution the probe could not find the
                            // toolchain in is DISABLED and says why, rather than
                            // being left out: „Ubuntu is not on this machine" and
                            // „Ubuntu is here and has no colcon" are different
                            // answers, and a list that hid the second one would
                            // send the user to look for a distribution they
                            // already have.
                            <option key={listed.name} value={listed.name} disabled={!listed.usable}>
                              {listed.usable
                                ? listed.name
                                : `${listed.name} — ${s.detect.distroUnusable}`}
                            </option>
                          ))}
                        </Select>
                      </div>
                    )}
                  </div>
                );
              })}
            </fieldset>

            <section className="elec-code__section">
              <h3 className="nx-eyebrow elec-code__heading">{s.command.heading}</h3>
              <p className="nx-hint nx-hint--prose">{s.command.exact}</p>
              {shown !== null ? (
                <>
                  <p className="elec-code__hint">
                    {s.command.workspaceLabel}{" "}
                    <span className="elec-code__mono">{shown.workspace}</span>
                  </p>
                  <pre className="elec-runner__argv">
                    {shown.argv.map((element, index) => (
                      // The index IS the identity: this is one argv in the order
                      // it was built, and an argument that repeats on the line
                      // (`--network none` beside `-v …:…`) has no id of its own.
                      <span key={index} className="elec-runner__arg">
                        {element}
                      </span>
                    ))}
                  </pre>
                  {plan?.kind === "command" && plan.pullsImage && (
                    <p className="elec-code__hint">{s.command.pullsImage}</p>
                  )}
                  {run === null && (
                    <div className="elec-runner__controls">
                      <Button variant="primary" disabled={busy} onClick={() => void start()}>
                        {s.command.start}
                      </Button>
                    </div>
                  )}
                </>
              ) : plan?.kind === "refused" ? (
                <p className="nx-hint nx-hint--prose">{s.refused[plan.reason]}</p>
              ) : null}
            </section>

            {hasRun && (
              <section className="elec-code__section">
                <h3 className="nx-eyebrow elec-code__heading">
                  {s.run.heading}
                  <span className="elec-runner__phase">{s.run.phases[phase]}</span>
                </h3>

                {/*
                  Above the log, because below it is too late: a reader who has
                  not been told that the beginning was dropped reads the end of
                  a build as the whole of it, and a build's errors are at its
                  end — which is exactly why the cap keeps the TAIL.
                */}
                {dropped && (
                  <p className="elec-code__warning" role="status">
                    {fill(s.run.dropped, { cap: Math.round(LOG_CAP_BYTES / 1024) })}
                  </p>
                )}

                {/* Drawn as TEXT, never as markup: a build prints whatever it
                    likes, and there is nothing here to inject into. The empty
                    case is a hint rather than an empty mono box — „još nema
                    izlaza" is a sentence, and the mono face is for the
                    toolchain's words. */}
                {text === "" ? (
                  <p className="elec-code__hint">{s.run.empty}</p>
                ) : (
                  <pre className="elec-runner__log">{text}</pre>
                )}

                {ending !== null && (
                  <>
                    {/* Who ended it — its own sentence, because a run that was
                        stopped and one that finished by itself are two
                        different things to have happened. */}
                    <p className="elec-code__hint">
                      {ending.stopped ? s.run.endedStopped : s.run.endedAlone}
                    </p>
                    {/* And whether the WORK is gone. For Docker the process
                        Nexus started can be gone while the container it started
                        is not, so this is drawn from `state` and never inferred
                        from the exit code. */}
                    <p className="nx-hint nx-hint--prose">
                      {ending.state === "still-running" ? s.run.workStill : s.run.workExited}
                    </p>
                    {/* A figure, not a verdict: what it means is above it. */}
                    {ending.exitCode !== null && (
                      <p className="elec-code__hint">
                        {s.run.exitCodeLabel}{" "}
                        <span className="elec-code__mono">{ending.exitCode}</span>
                      </p>
                    )}
                    {/* And the only one of these that is about the user's disk
                        rather than about the program: `colcon` exits 0 over an
                        empty workspace, so a zero is a claim the filesystem has
                        to be asked about separately. `missing` is drawn with the
                        prose hint because it is a sentence to read rather than a
                        figure to note — it is the one ending where a successful
                        exit code means the user got nothing. */}
                    {ending.artifact !== null && (
                      <p
                        className={
                          ending.artifact === "present" ? "elec-code__hint" : "nx-hint nx-hint--prose"
                        }
                        role={ending.artifact === "missing" ? "status" : undefined}
                      >
                        {ending.artifact === "present" ? s.run.artifactBuilt : s.run.artifactMissing}
                      </p>
                    )}
                  </>
                )}

                {(ending?.message ?? verbatim) !== null && (
                  <>
                    <p className="elec-code__hint">{s.run.messageLabel}</p>
                    <pre className="elec-code__source elec-runner__message">
                      {ending?.message ?? verbatim}
                    </pre>
                  </>
                )}

                <div className="elec-runner__controls">
                  <Button
                    variant={run === null ? "ghost" : "primary"}
                    disabled={busy || phase !== "running"}
                    onClick={() => void stop()}
                  >
                    {s.run.stop}
                  </Button>
                  {stopAnswer === "idle" && (
                    <p className="elec-code__hint" role="status">
                      {s.run.stopIdle}
                    </p>
                  )}
                </div>
              </section>
            )}
          </div>
        )}

        {message !== null && (
          <p className="elec-inspector__error" role="alert">
            {message}
          </p>
        )}

        <div className="recur-dialog__actions">
          <Button className="recur-dialog__cancel" onClick={onClose}>
            {s.close}
          </Button>
          {enabled && (
            <Button variant="ghost" disabled={busy} onClick={() => void disable()}>
              {phase === "idle" ? s.off.disable : s.off.disableRunning}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The switch, off: what turning it on means, and the button that does it.
 *
 * **Its own component because that block is the whole dialog in that state**,
 * and because the enable write is the only act on this screen that records a
 * consent — one `onEnable` and one click is easier to be sure of than one arm
 * of a five-way branch.
 *
 * The promises are a LIST and not a paragraph because each of the four is a
 * separate claim about the product: what runs, when it runs, what it touches,
 * and the one thing that leaves the machine. A reader checking this screen
 * against the behaviour has four things to check.
 */
function Consent({ busy, onEnable }: { busy: boolean; onEnable: () => void }) {
  const s = strings.electronics.runner.consent;
  return (
    <section className="elec-runner__consent">
      <h3 className="nx-eyebrow elec-code__heading">{s.heading}</h3>
      <ul className="elec-runner__promises">
        <li className="elec-runner__promise">{s.external}</li>
        <li className="elec-runner__promise">{s.manual}</li>
        <li className="elec-runner__promise">{s.writes}</li>
        <li className="elec-runner__promise">{s.network}</li>
      </ul>
      <Button className="elec-runner__enable" variant="primary" disabled={busy} onClick={onEnable}>
        {s.enable}
      </Button>
    </section>
  );
}

/**
 * What one probe found, in one of three words.
 *
 * `timedOut` is tested FIRST, and that order is the whole function: a tool that
 * is installed and never answered — `wsl.exe` with the WSL service stopped is
 * the case this exists for — is not a tool that is absent, and reporting it as
 * „nije nađen" sends the user to look for an installation they already have.
 */
function foundWord(entry: RunnerDetection): string {
  const s = strings.electronics.runner;
  if (entry.timedOut) return s.detect.states.timedOut;
  return entry.present ? s.detect.states.found : s.detect.states.missing;
}

/**
 * How to say that a start did not happen.
 *
 * The refusal reasons are the PLAN's own and are already written — main builds
 * both from the same function, so „no-choice" after pressing „Pokreni" is the
 * same fact as the sentence the plan printed a moment earlier — and this adds
 * only the four a plan cannot give. The `default` arm is what makes that true
 * by construction rather than by a copy: dropping a member from the start
 * reasons moves it into the refusal table, and adding one fails to compile.
 */
function startSentence(reason: RunnerStartResult["reason"]): string {
  const s = strings.electronics.runner;
  switch (reason) {
    case "already-running":
      return s.start.alreadyRunning;
    case "write-failed":
      return s.start.writeFailed;
    case "spawn-failed":
      return s.start.spawnFailed;
    case "none":
      return s.start.none;
    default:
      return s.refused[reason];
  }
}

/**
 * The ending to draw: main's own account of the last run, or — until that
 * arrives — what the stop button was just answered with.
 *
 * **One block, two sources, and never two blocks.** A stop answers
 * `exited` or `still-running` immediately, and `onRunnerChanged` delivers the
 * same fact as an ending a moment later; drawing both would put one fact on
 * the screen twice, and a reader who saw two sentences about one build would be
 * right not to know which one to believe.
 *
 * The synthesised ending says `stopped: true` because the user's click is what
 * produced it, carries no exit code because main's answer has none, and carries
 * no message because a stop that has an answer has no failure to explain. It
 * carries no ARTEFACT either, and that is the one of the three that is not
 * merely absent: a stop produces no conclusion about the disk, and the real
 * ending that follows says what there is to say about it.
 * `idle` is not an ending at all: there was nothing to stop.
 */
function endingOf(last: RunnerOutcome | null, stop: RunnerStopState | null): RunnerOutcome | null {
  if (last !== null) return last;
  if (stop === null || stop === "idle") return null;
  return { stopped: true, exitCode: null, state: stop, message: null, artifact: null };
}
