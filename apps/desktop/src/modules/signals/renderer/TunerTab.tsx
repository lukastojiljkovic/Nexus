import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Chip, Select, StatBand } from "@nexus/ui";
import { CHROMATIC_PRESET, TUNING_PRESETS, type InstrumentPreset } from "@nexus/core";
import { numberFormat } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { nearestTarget, type TunerReading } from "./analysis.js";
import { createAnalyzer, type Analyzer } from "./analyzer.js";
import { copy } from "./copy.js";
import { NumberField } from "./fields.js";
import { microphoneFailure, startMicrophone, type MicrophoneSession } from "./microphone.js";
import { parseA4Input } from "./prefs.js";
import type { TabProps } from "./tabs.js";

/**
 * The tuner: one string at a time, read from the microphone by YIN.
 *
 * **The needle is a number with a picture attached, never the other way round.**
 * A tuner that showed only a needle would be unreadable to somebody who cannot
 * see it and unquotable to everybody else, so the cents figure is set as text
 * beside the track and the needle repeats it. The track spans exactly ±50 cents
 * because that IS the reading's range: `noteForFrequency` reports the distance to
 * the nearest note, and the nearest note is never more than half a semitone away.
 *
 * **„Ugađeno" is this module's own display threshold, and the number stays on
 * screen beside it.** The engine names no threshold and inventing one it did not
 * state would be a verdict dressed as a measurement; five cents is where the
 * readout stops hedging, and the figure it hedged about is right there.
 *
 * **The preset is drawn in the order the engine lists it.** `arrangement` is the
 * engine's own field, and it exists because the ukulele is re-entrant: its G is
 * higher than the C and E listed after it, so a sorted list would be four strings
 * in an order nobody is holding.
 */

/** How often the pitch is read while the tuner runs. Ten a second is faster than a hand turns a peg and slower than YIN costs. */
const READ_INTERVAL_MS = 100;
/** The width of the needle's scale, in cents — half a semitone, which is every distance a nearest-note reading can report. */
const NEEDLE_CENTS = 50;
/** Where the readout stops hedging — see this file's header. */
const IN_TUNE_CENTS = 5;

/** Every preset the picker offers, in the order the engine says a picker should offer them. */
const PRESETS: readonly InstrumentPreset[] = [...TUNING_PRESETS, CHROMATIC_PRESET];

/** The name of a preset, in the language being read. Read at CALL time: the copy table is rewritten in place by a language switch. */
function presetLabel(id: string): string {
  switch (id) {
    case "guitar-standard":
      return copy.tuner.presetNames.guitar;
    case "bass":
      return copy.tuner.presetNames.bass;
    case "violin":
      return copy.tuner.presetNames.violin;
    case "ukulele":
      return copy.tuner.presetNames.ukulele;
    case "ukulele-low-g":
      return copy.tuner.presetNames.ukuleleLowG;
    default:
      return copy.tuner.presetNames.chromatic;
  }
}

/** A frequency with its unit, in the active locale: „82,4 Hz". */
function hertz(value: number): string {
  return numberFormat({
    style: "unit",
    unit: "hertz",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value);
}

export function TunerTab({ prefs, onChange }: TabProps) {
  const [presetId, setPresetId] = useState<string>(() => TUNING_PRESETS[0]?.id ?? "guitar-standard");
  const [listening, setListening] = useState(false);
  const [reading, setReading] = useState<TunerReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mainThread, setMainThread] = useState(false);
  const sessionRef = useRef<MicrophoneSession | null>(null);
  const analyzerRef = useRef<Analyzer | null>(null);
  const timerRef = useRef(0);
  /** One request in flight at a time: a worker that is slower than the interval must not build a queue. */
  const busyRef = useRef(false);
  /**
   * The reference the RUNNING loop reads.
   *
   * The interval's callback is created once, at Start, so a closure over
   * `prefs.a4Hz` would freeze the tuning reference at the moment somebody pressed
   * the button — and the A4 field beside it is editable while the tuner runs. The
   * ref is what makes „move the reference and watch every name move" true rather
   * than true-until-you-start.
   */
  const a4Ref = useRef(prefs.a4Hz);
  useEffect(() => {
    a4Ref.current = prefs.a4Hz;
  }, [prefs.a4Hz]);

  const preset = useMemo(
    () => PRESETS.find((candidate) => candidate.id === presetId) ?? CHROMATIC_PRESET,
    [presetId],
  );

  const stop = useCallback((): void => {
    window.clearInterval(timerRef.current);
    timerRef.current = 0;
    sessionRef.current?.stop();
    sessionRef.current = null;
    analyzerRef.current?.dispose();
    analyzerRef.current = null;
    busyRef.current = false;
    setListening(false);
  }, []);

  // A session that outlived its card would keep the microphone open.
  useEffect(
    () => () => {
      stop();
    },
    [stop],
  );

  async function start(): Promise<void> {
    try {
      const session = await startMicrophone();
      const analyzer = createAnalyzer();
      sessionRef.current = session;
      analyzerRef.current = analyzer;
      setError(null);
      setReading(null);
      setMainThread(analyzer.onMainThread);
      setListening(true);
      timerRef.current = window.setInterval(() => {
        void tick(session, analyzer);
      }, READ_INTERVAL_MS);
    } catch (failure) {
      console.error("Nexus: the tuner could not open the microphone:", failure);
      setError(
        microphoneFailure(failure) === "denied" ? copy.common.micDenied : copy.common.micFailed,
      );
      stop();
    }
  }

  /** One frame in, one reading out — and nothing at all while the previous one is still being read. */
  async function tick(session: MicrophoneSession, analyzer: Analyzer): Promise<void> {
    if (busyRef.current || sessionRef.current !== session) return;
    busyRef.current = true;
    try {
      const reply = await analyzer.analyse({
        kind: "tuner",
        sampleRate: session.sampleRate,
        a4Hz: a4Ref.current,
        samples: session.readFrame(),
      });
      if (reply.kind === "tuner" && sessionRef.current === session) setReading(reply.reading);
    } catch (failure) {
      console.error("Nexus: a tuner frame could not be read:", failure);
    } finally {
      busyRef.current = false;
    }
  }

  const cents = reading?.note?.centsOff ?? null;
  const nearest =
    reading?.frequencyHz == null ? null : nearestTarget(reading.frequencyHz, preset.targets);
  const inTune = cents !== null && Math.abs(cents) <= IN_TUNE_CENTS;
  const needle = cents === null ? null : Math.max(-NEEDLE_CENTS, Math.min(NEEDLE_CENTS, cents));

  return (
    <Card className="signals__card" title={copy.tabs.tuner}>
      <div className="signals__fields">
        <Select
          label={copy.tuner.presetLabel}
          className="signals__number"
          value={presetId}
          onChange={(event) => {
            setPresetId(event.target.value);
          }}
        >
          {PRESETS.map((option) => (
            <option key={option.id} value={option.id}>
              {presetLabel(option.id)}
            </option>
          ))}
        </Select>
        <NumberField
          label={copy.tuner.a4Label}
          className="signals__number"
          value={prefs.a4Hz}
          parse={parseA4Input}
          commit={(a4Hz) => {
            onChange({ a4Hz });
          }}
        />
      </div>
      <p className="nx-hint">{copy.tuner.a4Hint}</p>
      <div className="signals__actions">
        <Button
          size="sm"
          variant={listening ? "ghost" : "primary"}
          onClick={() => {
            if (listening) stop();
            else void start();
          }}
        >
          {listening ? copy.tuner.stop : copy.tuner.start}
        </Button>
        {listening && <Chip variant="data">{copy.common.listening}</Chip>}
        {inTune && <Chip variant="accent">{copy.tuner.inTune}</Chip>}
      </div>
      {error !== null && <p className="signals__error">{error}</p>}

      <div className="signals__needle-row">
        <div>
          <span className="nx-label">{copy.tuner.noteLabel}</span>
          <p className="signals__note">{reading?.note?.label ?? copy.tuner.waiting}</p>
        </div>
        <div className="signals__needle" aria-hidden="true">
          <span className="signals__needle-centre" />
          {needle !== null && (
            <span
              className={
                inTune
                  ? "signals__needle-mark signals__needle-mark--true"
                  : "signals__needle-mark"
              }
              style={{ left: `${String(50 + (needle / NEEDLE_CENTS) * 50)}%` }}
            />
          )}
        </div>
      </div>
      <StatBand
        {...(reading?.gated === true ? { caption: copy.tuner.gated } : {})}
        stats={[
          {
            label: copy.tuner.centsLabel,
            value:
              cents === null
                ? "—"
                : numberFormat({ signDisplay: "exceptZero", maximumFractionDigits: 0 }).format(cents),
          },
          {
            label: copy.tuner.frequencyLabel,
            value: reading?.frequencyHz == null ? "—" : hertz(reading.frequencyHz),
          },
          {
            label: copy.tuner.targetLabel,
            value: nearest?.target.label ?? "—",
            ...(nearest === null ? {} : { unit: hertz(nearest.target.frequencyHz) }),
          },
          {
            label: copy.tuner.clarityLabel,
            value: numberFormat({ style: "percent", maximumFractionDigits: 0 }).format(
              reading?.clarity ?? 0,
            ),
          },
        ]}
      />

      <p className="nx-hint">{copy.tuner.strings}</p>
      <ul className="signals__strings">
        {preset.targets.map((target) => (
          <li
            key={target.label}
            className={
              nearest?.target.label === target.label
                ? "signals__string signals__string--near"
                : "signals__string"
            }
          >
            <span className="signals__legend-sign">{target.label}</span>
            <span className="signals__num">{hertz(target.frequencyHz)}</span>
          </li>
        ))}
      </ul>
      <p className="nx-hint">{copy.common.deviceNote}</p>
      {mainThread && <p className="nx-hint">{copy.common.mainThreadNote}</p>}
    </Card>
  );
}
