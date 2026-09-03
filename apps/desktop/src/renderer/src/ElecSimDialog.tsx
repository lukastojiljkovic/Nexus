import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { simulateFrame } from "@nexus/core";
import type { SimBench, SimChannel, SimModel, SimWave } from "@nexus/core";
import { Button, Select, TextField } from "@nexus/ui";

import {
  SIM_PREVIEW_HEIGHT,
  SIM_PREVIEW_MS,
  SIM_PREVIEW_WIDTH,
  SIM_WAVE_KINDS,
  formatSimValue,
  previewPath,
  restingDraft,
  simNumber,
  waveFrom,
  wavePreview,
  type SimWaveDraft,
} from "./elecSim.js";
import { strings } from "./strings.js";
import { useFocusTrap } from "./useFocusTrap.js";

export interface ElecSimDialogProps {
  /** Derived by the page from the open circuit, and rebuilt whenever it changes. */
  bench: SimBench;
  onClose: () => void;
}

/**
 * How often the clock advances, in WALL time — which the tick deliberately is
 * not.
 *
 * A bench whose frame rate was the user's step would run a 1 ms step at a
 * thousand frames a second and a 10 s step as a stopped clock. Ten frames a
 * second is a readout a person can actually read a number off, and the step
 * stays what it says it is: simulated milliseconds.
 */
const FRAME_MS = 100;

/** What the step field opens at — one tick is one tenth of a second, so the sat runs 1:1. */
const DEFAULT_TICK_MS = "100";

/**
 * „Klupa" — the circuit as a running thing (ADR-085 E5).
 *
 * **What is on screen is a chain the circuit really has, moving.** For each
 * board pin that carries a signal: which component is on the other end, which
 * way the board faces it, which ROS topic the generated package gives it, and
 * what value is on it at this tick. Every one of those but the last comes out
 * of the same derivation the generators read — `boardWiring` and `rosPins` —
 * so a topic printed here is the topic the user's own package publishes on.
 *
 * **The last one is the user's.** The module's rule since E4 is that Nexus
 * emits the wiring and never the behaviour, and a simulator is where that rule
 * is easiest to break and worst to break: a bench that decided a ranger reads
 * 20 cm when a robot is 20 cm from a wall would be inventing both the physics
 * and the control loop, and would be believed, because it moves. So the
 * waveform on every channel is declared in this dialog and nowhere else.
 *
 * **Nothing here is stored.** The bench is an instrument, like the generated
 * code next door: the circuit is what the profile keeps, and closing this
 * dialog leaves exactly the circuit that was open when it opened.
 *
 * Same house recipe as the code and chassis dialogs — backdrop and panel as
 * siblings, Escape and the backdrop close, focus trapped and handed back, and
 * the body scrolls rather than the panel growing past the window.
 */
export function ElecSimDialog({ bench, onClose }: ElecSimDialogProps) {
  const s = strings.electronics.sim;
  const titleId = useId();
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });

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

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        className="recur-dialog__panel elec-sim__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="recur-dialog__title">
          {s.dialogTitle}
        </h2>

        {bench.kind === "refused" ? (
          <p className="elec-code__refused">{s.refused[bench.reason]}</p>
        ) : (
          <SimBody model={bench} />
        )}

        <div className="recur-dialog__actions">
          <Button className="recur-dialog__cancel" onClick={onClose}>
            {s.close}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The bench proper — the clock, the channels and what the clock is not driving.
 *
 * Its own component so the transport's state is created only once there is
 * something to run: a refusal has no clock, and a `useState` above the branch
 * would be a timer ticking behind a sentence that says there is no bench.
 */
function SimBody({ model }: { model: SimModel }) {
  const s = strings.electronics.sim;

  const [drafts, setDrafts] = useState<Record<string, SimWaveDraft>>(() =>
    Object.fromEntries(model.channels.map((channel) => [channel.id, restingDraft(channel)])),
  );
  const [tickDraft, setTickDraft] = useState(DEFAULT_TICK_MS);
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(false);

  // The clock. Wall time, and the only thing in this dialog that is: everything
  // it drives is a closed form of the simulated milliseconds below, so pausing
  // and stepping land on exactly the frames running through would have.
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setTick((previous) => previous + 1), FRAME_MS);
    return () => clearInterval(timer);
  }, [running]);

  // Each channel with the draft it is on, resolved once: a channel that appeared
  // after the dialog opened has none, and the resting one is what it would have
  // been given had it been there — which is also what `simulateFrame` assumes
  // for a channel it is handed no wave for.
  const rows = model.channels.map((channel) => ({
    channel,
    draft: drafts[channel.id] ?? restingDraft(channel),
  }));

  const waves = useMemo((): ReadonlyMap<string, SimWave> => {
    const built = new Map<string, SimWave>();
    for (const channel of model.channels) {
      built.set(channel.id, waveFrom(drafts[channel.id] ?? restingDraft(channel), channel));
    }
    return built;
    // `drafts` and the channel list are the whole input; `waveFrom` is pure.
  }, [drafts, model.channels]);

  // The same reader every field on this screen uses. Not `|| DEFAULT`, which
  // would quietly turn a typed 0 into 100 — a zero is a step the core clamps to
  // its floor, and a form that answered it with a different number would be
  // disagreeing with the readout beside it.
  const tickMs = simNumber(tickDraft, Number(DEFAULT_TICK_MS));
  const frame = simulateFrame(model, waves, tick, tickMs);
  const values = new Map(frame.values.map((value) => [value.channel, value]));
  const overLogic = frame.values.some((value) => value.overLogic);

  const update = (channel: SimChannel, patch: Partial<SimWaveDraft>): void =>
    setDrafts((previous) => ({
      ...previous,
      [channel.id]: { ...(previous[channel.id] ?? restingDraft(channel)), ...patch },
    }));

  return (
    <div className="elec-code__body">
      <p className="elec-code__description">{s.description}</p>

      <section className="elec-code__section">
        <h3 className="nx-eyebrow elec-code__heading">
          {s.clockHeading}
          <span className="elec-code__filename">
            {model.board}
            {model.logicVolts !== undefined &&
              ` · ${s.logicPrefix} ${formatSimValue("volts", model.logicVolts)}`}
          </span>
        </h3>
        <div className="elec-sim__clock">
          <Button variant="primary" onClick={() => setRunning((was) => !was)}>
            {running ? s.pause : s.run}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setRunning(false);
              setTick((previous) => previous + 1);
            }}
          >
            {s.step}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setRunning(false);
              setTick(0);
            }}
          >
            {s.reset}
          </Button>
          <TextField
            className="elec-sim__tick-field"
            label={s.tickLabel}
            value={tickDraft}
            inputMode="numeric"
            onChange={(event) => setTickDraft(event.target.value)}
          />
          {/*
            Not announced, on purpose: at ten frames a second an `aria-live`
            region would read the counter over everything else on the screen.
            The instrument is watched rather than narrated, and every control
            that CHANGES it is a labelled button.
          */}
          <p className="elec-sim__readout">
            {s.tickPrefix} {frame.tick} · {frame.ms} ms
          </p>
        </div>
        <p className="elec-code__hint">{s.tickHint}</p>
      </section>

      <section className="elec-code__section">
        <h3 className="nx-eyebrow elec-code__heading">{s.channelsHeading}</h3>
        {model.channels.length === 0 ? (
          <p className="elec-code__hint">{s.channelsEmpty}</p>
        ) : (
          <>
            <ul className="elec-sim__channels">
              {rows.map(({ channel, draft }) => (
                <SimChannelRow
                  key={channel.id}
                  channel={channel}
                  draft={draft}
                  ms={frame.ms}
                  value={values.get(channel.id)?.value ?? channel.range.min}
                  over={values.get(channel.id)?.overLogic === true}
                  onChange={(patch) => update(channel, patch)}
                />
              ))}
            </ul>
            {overLogic && <p className="elec-code__warning">{s.overLogicHint}</p>}
            {model.channels.some((channel) => channel.topic === undefined) &&
              model.channels.some((channel) => channel.topic !== undefined) && (
                <p className="elec-code__hint">{s.topicHint}</p>
              )}
          </>
        )}
      </section>

      {model.skipped.length > 0 && (
        <section className="elec-code__section">
          <h3 className="nx-eyebrow elec-code__heading">{s.skippedHeading}</h3>
          <p className="elec-code__hint">{s.skippedIntro}</p>
          <table className="elec-code__table">
            <thead>
              <tr>
                <th scope="col" className="nx-eyebrow">
                  {s.channelPin}
                </th>
                <th scope="col" className="nx-eyebrow">
                  {s.channelPart}
                </th>
                <th scope="col" className="nx-eyebrow">
                  {s.skippedReason}
                </th>
              </tr>
            </thead>
            <tbody>
              {model.skipped.map((row, index) => (
                // One derived list in the order it was derived, with no id of
                // its own — the code dialog's tables, exactly.
                <tr key={index}>
                  <th scope="row" className="elec-code__mono">
                    {row.boardPin}
                  </th>
                  <td className="elec-code__wrap">
                    {row.part} · {row.partPin}
                  </td>
                  <td>{s.reasons[row.reason]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

/**
 * One channel: what it is, what the user is putting on it, and what is on it now.
 *
 * The head names the chain in the order it runs — board pin, component and its
 * pin, direction, topic — so a row reads as one sentence rather than as five
 * columns. The controls below it are only the fields the chosen waveform uses;
 * the rest stay in the draft, so switching back finds them where they were.
 */
function SimChannelRow({
  channel,
  draft,
  ms,
  value,
  over,
  onChange,
}: {
  channel: SimChannel;
  draft: SimWaveDraft;
  ms: number;
  value: number;
  over: boolean;
  onChange: (patch: Partial<SimWaveDraft>) => void;
}) {
  const s = strings.electronics.sim;
  const wave = waveFrom(draft, channel);
  const marker = ((ms % SIM_PREVIEW_MS) / SIM_PREVIEW_MS) * SIM_PREVIEW_WIDTH;

  // `wide` for the one field that holds a LIST rather than a number: the others
  // are sized to four digits, and „0; 1,5; 3,3" in that width is a field the
  // user cannot read back what they typed into.
  const field = (
    label: string,
    key: "value" | "from" | "to" | "periodMs" | "dutyPercent" | "values",
    mode: "decimal" | "numeric" = "decimal",
    wide = false,
  ) => (
    <TextField
      className={`elec-sim__field${wide ? " elec-sim__field--wide" : ""}`}
      label={label}
      value={draft[key]}
      inputMode={mode}
      onChange={(event) => onChange({ [key]: event.target.value })}
    />
  );

  return (
    <li className="elec-sim__channel">
      <div className="elec-sim__head">
        <span className="elec-code__mono elec-sim__pin">{channel.id}</span>
        <span className="elec-code__wrap elec-sim__part">
          {channel.part} · {channel.partPin}
        </span>
        <span className="elec-sim__flow">{s.flows[channel.flow]}</span>
        <span className="elec-code__mono elec-sim__topic">
          {channel.topic === undefined ? s.topicNone : `~/${channel.topic}`}
        </span>
      </div>

      <div className="elec-sim__body">
        <div className="elec-sim__controls">
          <Select
            className="elec-sim__kind"
            label={s.waveKindLabel}
            value={draft.kind}
            onChange={(event) => onChange({ kind: asWaveKind(event.target.value) })}
          >
            {SIM_WAVE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {s.waves[kind]}
              </option>
            ))}
          </Select>
          {draft.kind === "constant" && field(s.waveValue, "value")}
          {(draft.kind === "square" || draft.kind === "ramp") && (
            <>
              {field(s.waveFrom, "from")}
              {field(s.waveTo, "to")}
              {field(s.wavePeriod, "periodMs", "numeric")}
            </>
          )}
          {draft.kind === "square" && field(s.waveDuty, "dutyPercent", "numeric")}
          {draft.kind === "steps" && (
            <>
              {field(s.waveValues, "values", "decimal", true)}
              {field(s.waveHold, "periodMs", "numeric")}
              {/*
                The separator, said where it is typed. It is a rule this app
                invented — a semicolon, because a Serbian decimal comma makes a
                comma-separated list ambiguous — so nothing about the field
                announces it, and a user who types „0, 1,5" gets ONE reading and
                no error. Rendered beside the field rather than in the section's
                own hint, which is about the clock.
              */}
              <p className="elec-code__hint elec-sim__values-hint">{s.waveValuesHint}</p>
            </>
          )}
        </div>

        <div className="elec-sim__gauge">
          {/*
            Decorative: every number it draws is in the readout beside it and in
            the form above it, so a screen reader gains nothing from the shape
            and loses a hundred coordinates.
          */}
          <svg
            className="elec-sim__preview"
            viewBox={`0 0 ${SIM_PREVIEW_WIDTH} ${SIM_PREVIEW_HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            <polyline
              className="elec-sim__trace"
              points={previewPath(wavePreview(wave, channel))}
            />
            <line
              className="elec-sim__marker"
              x1={marker}
              y1={0}
              x2={marker}
              y2={SIM_PREVIEW_HEIGHT}
            />
          </svg>
          <p className={`elec-sim__value${over ? " elec-sim__value--over" : ""}`}>
            <span className="elec-sim__number">{formatSimValue(channel.unit, value)}</span>
            <span className="elec-sim__unit">{over ? s.overLogic : s.units[channel.unit]}</span>
          </p>
        </div>
      </div>
    </li>
  );
}

/**
 * The `<select>`'s value as the tag it is.
 *
 * A `<select>` hands back a `string`, and the four options are the only strings
 * it can hand back — but that is a fact about the markup rather than one the
 * type system has, and a cast would be the same claim with nothing checking it.
 */
function asWaveKind(value: string): SimWaveDraft["kind"] {
  const found = SIM_WAVE_KINDS.find((kind) => kind === value);
  return found ?? "constant";
}
