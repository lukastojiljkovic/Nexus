import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Select, TextField } from "@nexus/ui";
import {
  METRONOME_MAX_BEATS_PER_BAR,
  METRONOME_MAX_BPM,
  METRONOME_MAX_SUBDIVISIONS,
  METRONOME_MIN_BEATS_PER_BAR,
  METRONOME_MIN_BPM,
  METRONOME_NOTE_VALUES,
  tapTempo,
  type BeatAccent,
  type MetronomeClick,
  type MetronomeSpec,
  type NoteValue,
} from "@nexus/core";
import { copy } from "../copy.js";
import { formatCount } from "../format.js";
import {
  LOOKAHEAD_INTERVAL_MS,
  clickGain,
  metronomeWindow,
  pulseAt,
  resumeCursor,
} from "../metronomeLoop.js";

/**
 * The metronome, with tap tempo (mini-apps).
 *
 * **The audio is scheduled ahead of the clock, never ticked.** `setInterval`
 * drifts and is throttled in a hidden window, so a metronome built on a tick per
 * beat wanders audibly. Instead the loop wakes every `LOOKAHEAD_INTERVAL_MS` and
 * hands the audio context every click that falls in the next quarter second,
 * each with the exact time it is to sound at; the hardware then plays it
 * whatever the main thread is doing. All the arithmetic that decides WHAT those
 * clicks are is in `metronomeLoop.ts` and in `@nexus/core`'s `beatSchedule`, so
 * what is left here is the wiring - which is why this is the one file in the
 * module that cannot be tested without an audio device.
 *
 * **The metronome keeps nothing.** It is the one tool of the nine with no state
 * a user authors: the tempo and the signature are choices for the next minute
 * rather than facts about the profile, so there is no `run` and no store write
 * here - which is also why it takes no props at all.
 *
 * **The pulse is the same data as the click.** The dot reads the clicks that
 * were already scheduled and asks which one is sounding (`pulseAt`), so the
 * picture and the sound cannot come from two different calculations. It is
 * `aria-live="off"`: announcing a beat a second to a screen reader would be the
 * loudest thing this module could do.
 */

/** One click's tone: the accented beat is higher as well as louder, so a bar is heard as a shape. */
const TONE_HZ = { accented: 1568, plain: 1046 } as const;

/** How long one click sounds, in seconds. Short enough that subdivisions stay separate at 400 BPM. */
const CLICK_SECONDS = 0.05;

const ACCENT_ORDER: readonly BeatAccent[] = ["strong", "weak", "off"];

function accentLabel(accent: BeatAccent): string {
  if (accent === "strong") return copy.metronome.beatStrong;
  if (accent === "weak") return copy.metronome.beatWeak;
  return copy.metronome.beatOff;
}

/** A bar's accents, trimmed or padded so the spec always holds one per beat. */
function accentsFor(accents: readonly BeatAccent[], beatsPerBar: number): BeatAccent[] {
  return Array.from({ length: beatsPerBar }, (_value, index) => accents[index] ?? "weak");
}

/** One click through the audio context at the instant the schedule gave it. */
function playClick(context: AudioContext, click: MetronomeClick): void {
  const gain = clickGain(click);
  if (gain <= 0) return;
  const oscillator = context.createOscillator();
  const level = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(click.onBeat ? TONE_HZ.accented : TONE_HZ.plain, click.timeSeconds);
  // An exponential ramp cannot start from zero, so it starts from near-silence;
  // the alternative - a linear ramp to full - clicks audibly at every edge.
  level.gain.setValueAtTime(0.0001, click.timeSeconds);
  level.gain.exponentialRampToValueAtTime(gain * 0.4, click.timeSeconds + 0.002);
  level.gain.exponentialRampToValueAtTime(0.0001, click.timeSeconds + CLICK_SECONDS);
  oscillator.connect(level);
  level.connect(context.destination);
  oscillator.start(click.timeSeconds);
  oscillator.stop(click.timeSeconds + CLICK_SECONDS + 0.01);
}

export function MetronomeApp() {
  const [bpm, setBpm] = useState(120);
  const [bpmText, setBpmText] = useState("120");
  const [bpmProblem, setBpmProblem] = useState(false);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [noteValue, setNoteValue] = useState<NoteValue>(4);
  const [subdivisions, setSubdivisions] = useState(1);
  const [accents, setAccents] = useState<readonly BeatAccent[]>(["strong", "weak", "weak", "weak"]);
  const [playing, setPlaying] = useState(false);
  const [pulse, setPulse] = useState<MetronomeClick | null>(null);
  const [audioProblem, setAudioProblem] = useState(false);
  const [taps, setTaps] = useState<readonly number[]>([]);

  /** The running metronome: the context, the grid's origin on its clock, and where the loop is. */
  const audio = useRef<{ context: AudioContext; origin: number; cursor: number } | null>(null);
  /** The clicks handed to the audio context, so the pulse can read the same list. */
  const scheduled = useRef<MetronomeClick[]>([]);
  /** What the loop must play, read fresh on every wake so a tempo change is heard at once. */
  const live = useRef({ bpm, beatsPerBar, noteValue, subdivisions, accents });
  useEffect(() => {
    live.current = { bpm, beatsPerBar, noteValue, subdivisions, accents };
  }, [bpm, beatsPerBar, noteValue, subdivisions, accents]);

  const stop = useCallback(() => {
    const running = audio.current;
    audio.current = null;
    scheduled.current = [];
    setPlaying(false);
    setPulse(null);
    if (running !== null) void running.context.close();
  }, []);

  const start = useCallback(() => {
    if (audio.current !== null) return;
    let context: AudioContext;
    try {
      context = new AudioContext();
    } catch (error) {
      setAudioProblem(true);
      console.error("Nexus: the metronome could not open an audio context:", error);
      return;
    }
    setAudioProblem(false);
    // A short lead so the first clicks are scheduled in the future rather than
    // at an instant that has already passed.
    const origin = context.currentTime + 0.15;
    audio.current = { context, origin, cursor: origin };
    setPlaying(true);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const handle = window.setInterval(() => {
      const running = audio.current;
      if (running === null) return;
      const now = running.context.currentTime;
      running.cursor = resumeCursor(running.cursor, now);
      const spec: MetronomeSpec = {
        startSeconds: running.origin,
        bpm: live.current.bpm,
        beatsPerBar: live.current.beatsPerBar,
        noteValue: live.current.noteValue,
        accents: accentsFor(live.current.accents, live.current.beatsPerBar),
        subdivisions: live.current.subdivisions,
      };
      const window = metronomeWindow(spec, running.cursor);
      for (const click of window.clicks) {
        playClick(running.context, click);
        scheduled.current.push(click);
      }
      running.cursor = window.toSeconds;
      // Clicks a second behind the clock can no longer be sounding, and the
      // pulse only ever looks at the newest one.
      scheduled.current = scheduled.current.filter((click) => click.timeSeconds > now - 1);
      setPulse(pulseAt(scheduled.current, now));
    }, LOOKAHEAD_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [playing]);

  // A page that is closed mid-bar must not leave an audio context running.
  useEffect(() => () => stop(), [stop]);

  /** The typed tempo, applied only when it is one the engine accepts. */
  function commitBpm(text: string): void {
    setBpmText(text);
    const value = Number(text.trim());
    if (!Number.isInteger(value) || value < METRONOME_MIN_BPM || value > METRONOME_MAX_BPM) {
      setBpmProblem(true);
      return;
    }
    setBpmProblem(false);
    setBpm(value);
  }

  function changeBeats(next: number): void {
    setAccents((current) => accentsFor(current, next));
    setBeatsPerBar(next);
  }

  function cycleAccent(beat: number): void {
    setAccents((current) => {
      const held = current[beat - 1] ?? "weak";
      const next = ACCENT_ORDER[(ACCENT_ORDER.indexOf(held) + 1) % ACCENT_ORDER.length] ?? "weak";
      return accentsFor(current, beatsPerBar).map((accent, index) =>
        index === beat - 1 ? next : accent,
      );
    });
  }

  function tap(): void {
    setTaps((current) => [...current, performance.now() / 1000].slice(-16));
  }

  const measured = tapTempo(taps);

  function applyTap(): void {
    if (measured.bpm === null) return;
    const value = Math.round(measured.bpm);
    setBpm(Math.min(METRONOME_MAX_BPM, Math.max(METRONOME_MIN_BPM, value)));
    setBpmText(String(Math.min(METRONOME_MAX_BPM, Math.max(METRONOME_MIN_BPM, value))));
    setBpmProblem(false);
  }

  const beatNumbers = Array.from({ length: beatsPerBar }, (_value, index) => index + 1);

  return (
    <div className="miniapps__app">
      <Card className="miniapps__card" title={copy.apps.metronome.name}>
        <div className="miniapps__row">
          <TextField
            label={copy.metronome.bpm}
            className="miniapps__number-field"
            inputMode="numeric"
            value={bpmText}
            onChange={(event) => commitBpm(event.target.value)}
          />
          <Select
            label={copy.metronome.beats}
            value={String(beatsPerBar)}
            onChange={(event) => changeBeats(Number(event.target.value))}
          >
            {Array.from(
              { length: METRONOME_MAX_BEATS_PER_BAR - METRONOME_MIN_BEATS_PER_BAR + 1 },
              (_value, index) => METRONOME_MIN_BEATS_PER_BAR + index,
            ).map((beats) => (
              <option key={beats} value={String(beats)}>
                {formatCount(beats)}
              </option>
            ))}
          </Select>
          <Select
            label={copy.metronome.note}
            value={String(noteValue)}
            onChange={(event) => setNoteValue(Number(event.target.value) as NoteValue)}
          >
            {METRONOME_NOTE_VALUES.map((note) => (
              <option key={note} value={String(note)}>
                {formatCount(note)}
              </option>
            ))}
          </Select>
          <Select
            label={copy.metronome.subdivisions}
            value={String(subdivisions)}
            onChange={(event) => setSubdivisions(Number(event.target.value))}
          >
            {Array.from({ length: METRONOME_MAX_SUBDIVISIONS }, (_value, index) => index + 1).map(
              (parts) => (
                <option key={parts} value={String(parts)}>
                  {formatCount(parts)}
                </option>
              ),
            )}
          </Select>
        </div>
        {bpmProblem && <p className="miniapps__field-error">{copy.metronome.bpmError}</p>}

        <div className="miniapps__row">
          <span className="miniapps__row-label">{copy.metronome.accents}</span>
          <div className="miniapps__accents">
            {beatNumbers.map((beat) => (
              <Button
                key={beat}
                size="sm"
                variant={accents[beat - 1] === "strong" ? "primary" : "ghost"}
                aria-label={`${copy.metronome.beat} ${formatCount(beat)}: ${accentLabel(accents[beat - 1] ?? "weak")}`}
                onClick={() => cycleAccent(beat)}
              >
                {`${formatCount(beat)} ${accentLabel(accents[beat - 1] ?? "weak")}`}
              </Button>
            ))}
          </div>
        </div>

        <div className="miniapps__row">
          {playing ? (
            <Button size="sm" variant="primary" onClick={stop}>
              {copy.actions.stop}
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={start}>
              {copy.actions.start}
            </Button>
          )}
          <div className="miniapps__pulse" aria-live="off">
            <span
              className={`miniapps__pulse-dot${pulse?.onBeat === true ? " miniapps__pulse-dot--beat" : ""}`}
              aria-hidden="true"
            />
            <span className="miniapps__pulse-text">
              {pulse === null
                ? copy.metronome.pulse
                : `${copy.metronome.bar} ${formatCount(pulse.bar)} - ${copy.metronome.beat} ${formatCount(pulse.beat)}`}
            </span>
          </div>
        </div>
        {audioProblem && <p className="miniapps__field-error">{copy.metronome.audioUnavailable}</p>}
      </Card>

      <Card className="miniapps__card" title={copy.metronome.tapTitle}>
        <p className="nx-hint">{copy.metronome.tapHint}</p>
        <div className="miniapps__row">
          <Button size="sm" onClick={tap}>
            {copy.metronome.tap}
          </Button>
          <span className="miniapps__readout">
            {measured.bpm === null
              ? copy.metronome.tapNone
              : `${copy.metronome.tapResult}: ${formatCount(Math.round(measured.bpm))} BPM`}
          </span>
          <Button size="sm" variant="quiet" disabled={measured.bpm === null} onClick={applyTap}>
            {copy.metronome.applyTap}
          </Button>
        </div>
      </Card>
    </div>
  );
}
