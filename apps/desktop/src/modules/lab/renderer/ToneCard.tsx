import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Card, Checkbox, Chip, Select, TextField } from "@nexus/ui";
import { WAVE_KINDS, renderWave, sweepFrequency, type WaveKind } from "@nexus/core";
import { activeLocale } from "../../../renderer/src/strings.js";
import { copy } from "./copy.js";
import { formatMeasure, formatPercent } from "./reading.js";

/**
 * The tone generator and the oscilloscope.
 *
 * **The two rules that decide this file.** A tone generator is a device that can
 * damage hearing, so it does not play on open, it does not play before an
 * acknowledgement, and its level starts at the BOTTOM of the slider and is
 * applied as a short ramp rather than a jump (a gain that steps from zero to a
 * third of full scale is a click at every start). And a scope is a microphone,
 * so the microphone is opened by a click and its stream goes into the analyser
 * and NEVER into the destination — a scope that played the room back would be a
 * feedback loop, which is why `startScope` connects one node and not two.
 *
 * **Why the noise comes from `@nexus/core`.** White and pink noise are rendered
 * by `renderWave`, the same function the tests pin sample for sample: a page that
 * rolled its own noise would be a page whose noise nothing had ever measured,
 * and the two noise kinds are the ones a spectrum is usually used to look at.
 *
 * **Why the FFT is not in a worker and not in this file.** `getFloatFrequencyData`
 * is Chromium's own FFT on its own audio thread; the page copies the numbers out
 * and draws them. The only arithmetic here is what a scope always has — where the
 * trace starts (the trigger), and which bin is loudest.
 */

/** How loud the generator starts. Low on purpose: see the file header. */
const START_LEVEL = 0.05;

/** The sweep the „pređi preko opsega" switch runs, and how long it takes. */
const SWEEP_FROM_HZ = 20;
const SWEEP_TO_HZ = 20_000;
const SWEEP_SECONDS = 12;

/**
 * The time/div steps the scope offers.
 *
 * Keyed by the label's own string rather than by a number, because the copy
 * table's keys ARE strings and indexing it with `String(ms)` would be a cast
 * from `string` to the five literals the table declares — a cast that would
 * survive a sixth division being added and silently label it with nothing.
 */
const TIME_DIVISIONS = [
  { key: "0.5", ms: 0.5 },
  { key: "1", ms: 1 },
  { key: "2", ms: 2 },
  { key: "5", ms: 5 },
  { key: "10", ms: 10 },
] as const;
type TimeDivisionKey = (typeof TIME_DIVISIONS)[number]["key"];

/** The loudest bin below this is the analyser's own noise rather than a tone. */
const FREQUENCY_FLOOR_DB = -90;

/** The bottom of the spectrum's drawing scale, in dBFS. */
const SPECTRUM_FLOOR_DB = -100;

export function ToneCard() {
  const [acknowledged, setAcknowledged] = useState(false);
  const [kind, setKind] = useState<WaveKind>("sine");
  const [frequency, setFrequency] = useState("440");
  const [level, setLevel] = useState(START_LEVEL);
  const [sweeping, setSweeping] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [micProblem, setMicProblem] = useState(false);
  const [trigger, setTrigger] = useState(0);
  const [timeDivision, setTimeDivision] = useState<TimeDivisionKey>("2");
  const [scopeFrequency, setScopeFrequency] = useState<number | null>(null);
  /** The step the scope draws, as the milliseconds its own table names. */
  const timeDivisionMs = TIME_DIVISIONS.find((entry) => entry.key === timeDivision)?.ms ?? 2;
  /**
   * The level row's name, as an id.
   *
   * The control is named BY REFERENCE rather than by the wrapping label, and
   * that is `check:names`'s rule: this row prints the level AND the percentage
   * beside it, and a label that wraps a control gives it its whole text content
   * as a name — so the reader would hear „jačina 10 %" as one utterance. The
   * span the user reads is what names the slider, and the figure follows it.
   */
  const levelLabelId = useId();

  const contextRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioScheduledSourceNode | null>(null);
  const sweepRef = useRef<{ startedAt: number } | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const stopGenerator = useCallback(() => {
    const source = sourceRef.current;
    sourceRef.current = null;
    sweepRef.current = null;
    setPlaying(false);
    if (source !== null) {
      try {
        source.stop();
        source.disconnect();
      } catch (stopFailure) {
        console.error("Nexus: the generator did not stop cleanly:", stopFailure);
      }
    }
  }, []);

  /**
   * Everything the generator owns is torn down when the page goes: a page that
   * left a tone playing would be a page you cannot leave, and a page that left
   * the microphone open would be a light that stays on.
   */
  useEffect(() => {
    return () => {
      stopGenerator();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void contextRef.current?.close().catch(() => undefined);
      contextRef.current = null;
    };
  }, [stopGenerator]);

  const startGenerator = useCallback(async () => {
    stopGenerator();
    const context = contextRef.current ?? new AudioContext();
    contextRef.current = context;
    if (context.state === "suspended") await context.resume();
    const gain = gainRef.current ?? context.createGain();
    gainRef.current = gain;
    gain.gain.cancelScheduledValues(context.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, context.currentTime);
    gain.gain.linearRampToValueAtTime(level, context.currentTime + 0.05);
    gain.connect(context.destination);

    if (kind === "white" || kind === "pink") {
      const rendered = renderWave({
        kind,
        sampleRate: Math.round(context.sampleRate),
        frames: Math.round(context.sampleRate),
        seed: 1,
      });
      const buffer = context.createBuffer(1, rendered.samples.length, context.sampleRate);
      buffer.copyToChannel(Float32Array.from(rendered.samples), 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      source.start();
      sourceRef.current = source;
      setPlaying(true);
      return;
    }

    const tone = Number(frequency.trim());
    if (!Number.isFinite(tone)) return;
    const oscillator = context.createOscillator();
    oscillator.type = kind;
    oscillator.frequency.value = tone;
    oscillator.connect(gain);
    oscillator.start();
    sourceRef.current = oscillator;
    sweepRef.current = sweeping ? { startedAt: context.currentTime } : null;
    setPlaying(true);
  }, [frequency, kind, level, stopGenerator, sweeping]);

  // While the sweep runs, the oscillator's frequency is re-derived every frame
  // from `sweepFrequency` — the same function the engine's tests pin.
  useEffect(() => {
    if (!playing || !sweeping || kind === "white" || kind === "pink") return;
    let handle = 0;
    const step = (): void => {
      const context = contextRef.current;
      const source = sourceRef.current;
      const sweep = sweepRef.current;
      if (context !== null && source instanceof OscillatorNode && sweep !== null) {
        source.frequency.value = sweepFrequency({
          fromHz: SWEEP_FROM_HZ,
          toHz: SWEEP_TO_HZ,
          seconds: SWEEP_SECONDS,
          atSeconds: context.currentTime - sweep.startedAt,
          logarithmic: true,
        });
      }
      handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [playing, sweeping, kind]);

  const startScope = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const context = contextRef.current ?? new AudioContext();
      contextRef.current = context;
      if (context.state === "suspended") await context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2_048;
      analyser.smoothingTimeConstant = 0.6;
      // ONE connection, and deliberately not to `destination`: the scope listens
      // to the room, it does not play it back.
      context.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
      setMicReady(true);
      setMicProblem(false);
    } catch (micFailure) {
      setMicProblem(true);
      setMicReady(false);
      console.error("Nexus: the microphone could not be opened:", micFailure);
    }
  }, []);

  const stopScope = useCallback(() => {
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setMicReady(false);
    setScopeFrequency(null);
    for (const canvas of [waveCanvasRef.current, spectrumCanvasRef.current]) {
      const context = canvas?.getContext("2d");
      if (canvas !== null && context != null) context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  useEffect(() => {
    if (!micReady) return;
    let handle = 0;
    const draw = (): void => {
      const analyser = analyserRef.current;
      const waveCanvas = waveCanvasRef.current;
      const spectrumCanvas = spectrumCanvasRef.current;
      if (analyser !== null && waveCanvas !== null && spectrumCanvas !== null) {
        const time = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(time);
        const spectrum = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(spectrum);
        drawWaveform(waveCanvas, time, trigger, timeDivisionMs, analyser.context.sampleRate);
        drawSpectrum(spectrumCanvas, spectrum, analyser.context.sampleRate, analyser.fftSize);
        setScopeFrequency(
          dominantFrequency(spectrum, analyser.context.sampleRate, analyser.fftSize),
        );
      }
      handle = requestAnimationFrame(draw);
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [micReady, trigger, timeDivision]);

  return (
    <Card className="lab__card" title={copy.tone.title}>
      <p className="nx-hint">{copy.tone.warning}</p>
      <Checkbox checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}>
        {copy.tone.acknowledge}
      </Checkbox>
      <div className="lab__row">
        <Select
          label={copy.tone.kind}
          value={kind}
          disabled={playing}
          onChange={(event) => setKind(event.target.value as WaveKind)}
        >
          {WAVE_KINDS.map((option) => (
            <option key={option} value={option}>
              {copy.tone.kinds[option]}
            </option>
          ))}
        </Select>
        <TextField
          label={copy.tone.frequency}
          inputMode="numeric"
          value={frequency}
          disabled={playing || sweeping || kind === "white" || kind === "pink"}
          onChange={(event) => setFrequency(event.target.value)}
        />
        <Checkbox checked={sweeping} onChange={(event) => setSweeping(event.target.checked)}>
          {copy.tone.sweep}
        </Checkbox>
        <Button
          size="sm"
          variant={playing ? "danger" : "primary"}
          disabled={!acknowledged}
          onClick={() => {
            if (playing) stopGenerator();
            else void startGenerator();
          }}
        >
          {playing ? copy.tone.stop : copy.tone.play}
        </Button>
        {playing && <Chip variant="data">{copy.tone.playing}</Chip>}
      </div>
      <label className="lab__field">
        <span className="nx-eyebrow" id={levelLabelId}>
          {copy.tone.level}
        </span>
        <input
          type="range"
          aria-labelledby={levelLabelId}
          min={0}
          max={0.5}
          step={0.01}
          value={level}
          onChange={(event) => {
            const next = Number(event.target.value);
            setLevel(next);
            const gain = gainRef.current;
            const context = contextRef.current;
            if (gain !== null && context !== null) {
              gain.gain.setTargetAtTime(next, context.currentTime, 0.02);
            }
          }}
        />
        <span className="lab__value">{formatPercent(level * 2, activeLocale())}</span>
      </label>

      <div className="lab__panel">
        <div className="lab__row">
          <Button
            size="sm"
            variant={micReady ? "danger" : "ghost"}
            onClick={() => (micReady ? stopScope() : void startScope())}
          >
            {micReady ? copy.tone.micStop : copy.tone.micStart}
          </Button>
          <Select
            label={copy.tone.timeDiv}
            value={String(timeDivision)}
            onChange={(event) => setTimeDivision(event.target.value as TimeDivisionKey)}
          >
            {TIME_DIVISIONS.map((division) => (
              <option key={division.key} value={division.key}>
                {copy.tone.timeDivisions[division.key]}
              </option>
            ))}
          </Select>
          <label className="lab__field">
            <span className="nx-eyebrow">{copy.tone.trigger}</span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={trigger}
              onChange={(event) => setTrigger(Number(event.target.value))}
            />
          </label>
          <span className="nx-hint">
            {`${copy.tone.frequencyReadout}: ${
              scopeFrequency === null
                ? "—"
                : `${formatMeasure(scopeFrequency, 0, activeLocale())} Hz`
            }`}
          </span>
        </div>
        {micProblem && <p className="nx-hint">{copy.tone.micProblem}</p>}
        <canvas
          ref={waveCanvasRef}
          className="lab__canvas"
          width={640}
          height={160}
          role="img"
          aria-label={copy.tone.waveLabel}
        />
        <canvas
          ref={spectrumCanvasRef}
          className="lab__canvas"
          width={640}
          height={160}
          role="img"
          aria-label={copy.tone.spectrumLabel}
        />
        <p className="nx-hint">{copy.tone.inputNote}</p>
      </div>
    </Card>
  );
}

/**
 * The waveform, aligned to the trigger.
 *
 * The trigger is what makes a scope readable: without it a periodic signal slides
 * across the screen at the rate its phase drifts. So the drawing starts at the
 * first upward crossing of the trigger level inside the displayed window, and
 * when there is no crossing the trace is drawn from the start — a scope showing
 * an untriggered signal is telling the truth about it.
 *
 * `timeDivision` decides how much of the buffer is on screen: ten divisions of
 * that many milliseconds, converted to samples through the context's own rate.
 */
function drawWaveform(
  canvas: HTMLCanvasElement,
  samples: Float32Array,
  trigger: number,
  timeDivisionMs: number,
  sampleRate: number,
): void {
  const context = canvas.getContext("2d");
  if (context === null) return;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = cssColour("--nx-border", canvas);
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();

  const visible = Math.max(
    2,
    Math.min(samples.length, Math.round((timeDivisionMs / 1000) * sampleRate * 10)),
  );
  const from = Math.max(0, samples.length - visible);
  const start = from + triggerIndex(samples.subarray(from), trigger);
  const count = Math.max(2, Math.min(samples.length - start, visible));
  context.strokeStyle = cssColour("--nx-data", canvas);
  context.beginPath();
  for (let index = 0; index < count; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[start + index] ?? 0));
    const x = (index / (count - 1)) * width;
    const y = height / 2 - (value * height) / 2;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}

/** The spectrum as bars, from the analyser's decibel bins — the shape a spectrum has on every scope. */
function drawSpectrum(
  canvas: HTMLCanvasElement,
  spectrum: Float32Array,
  sampleRate: number,
  fftSize: number,
): void {
  const context = canvas.getContext("2d");
  if (context === null) return;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  // Only the audible bins are drawn: above 20 kHz there is nothing a person
  // hears, and the analyser measured nothing there anyway.
  const audibleBins = Math.min(
    spectrum.length,
    Math.max(1, Math.ceil((20_000 / sampleRate) * (fftSize / 2))),
  );
  const barWidth = width / audibleBins;
  context.fillStyle = cssColour("--nx-data", canvas);
  for (let bin = 0; bin < audibleBins; bin += 1) {
    const decibels = Math.max(SPECTRUM_FLOOR_DB, spectrum[bin] ?? SPECTRUM_FLOOR_DB);
    const barHeight =
      ((decibels - SPECTRUM_FLOOR_DB) / -SPECTRUM_FLOOR_DB) * height;
    context.fillRect(bin * barWidth, height - barHeight, Math.max(1, barWidth - 1), barHeight);
  }
}

/** The first upward crossing of the trigger level, or 0 when the buffer holds none. */
function triggerIndex(samples: Float32Array, trigger: number): number {
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1] ?? 0;
    const current = samples[index] ?? 0;
    if (previous < trigger && current >= trigger) return index;
  }
  return 0;
}

/** The loudest bin, as a frequency — how the readout says „this is the tone in the room". */
function dominantFrequency(
  spectrum: Float32Array,
  sampleRate: number,
  fftSize: number,
): number | null {
  let best = -Infinity;
  let bestBin = -1;
  for (let bin = 1; bin < spectrum.length; bin += 1) {
    const value = spectrum[bin] ?? -Infinity;
    if (value > best) {
      best = value;
      bestBin = bin;
    }
  }
  if (bestBin < 0 || best < FREQUENCY_FLOOR_DB) return null;
  return (bestBin * sampleRate) / fftSize;
}

/** A token's value as a canvas needs it — `getComputedStyle` is where a CSS variable becomes a colour. */
function cssColour(variable: string, element: HTMLElement): string {
  const value = getComputedStyle(element).getPropertyValue(variable).trim();
  // The fallback is `currentColor`, which the canvas resolves against the
  // element's own ink: a drawing that lost its variable would still be visible
  // rather than silently absent.
  return value === "" ? "currentColor" : value;
}
