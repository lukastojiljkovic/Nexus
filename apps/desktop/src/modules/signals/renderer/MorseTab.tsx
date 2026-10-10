import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Chip, Disclosure, StatBand, TextArea } from "@nexus/ui";
import { decodeMorse, morseAlphabet, type MorseInterval } from "@nexus/core";
import { numberFormat } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { copy } from "./copy.js";
import { NumberField } from "./fields.js";
import { MorseKeyer, morseConfidence } from "./keyer.js";
import { microphoneFailure, startMicrophone, type MicrophoneSession } from "./microphone.js";
import {
  morseCodeToText,
  planMorseMessage,
  textToMorseCode,
  type MorsePlan,
} from "./morseText.js";
import { parsePitchInput, parseWpmInput } from "./prefs.js";
import type { TabProps } from "./tabs.js";
import { playTone, type ToneSession } from "./tone.js";

/**
 * MORSE: text and code, the tone and its speed, the screen as a lamp, and the
 * decoder that reads a hand key off the microphone.
 *
 * **The text field is the message and the code field is a view of it.** The tone,
 * the lamp and the decoder all speak about ONE message, so it has one home — the
 * text — and „U Morse"/„U tekst" are conversions that write the other field. Two
 * independent fields would leave the Play button ambiguous about which message it
 * means.
 *
 * **The tone and the flash share the engine's schedule.** `morseSchedule` turns
 * the message into keyed intervals once; the tone hands them to the audio clock
 * and the lamp steps through the same list, which is what makes the lamp a way of
 * sending the message rather than a decoration.
 *
 * **The decoder is the one place in this module where an engine runs on the page
 * thread, and it is deliberate.** YIN — the tuner's engine — is a few million
 * operations per frame and runs in the worker; the Morse decoder reads a list of
 * a few dozen intervals that the keyer built from level readings, and the keyer
 * needs the instant each reading arrived, which is the page's own clock. What is
 * heavy here is the capture, and that belongs to the audio thread.
 */

export function MorseTab({ prefs, onChange }: TabProps) {
  const [text, setText] = useState("");
  const [code, setCode] = useState("");
  /** The characters the last „U Morse" had to send as other ones. */
  const [sent, setSent] = useState<readonly string[]>([]);
  /** The tokens the last „U tekst" could not read as a code. */
  const [unknown, setUnknown] = useState<readonly string[]>([]);

  // One plan for the tone and the lamp, from the field that holds the message.
  const plan = planMorseMessage(text, prefs.wpm, prefs.messageWpm);

  return (
    <>
      <Card className="signals__card" title={copy.morse.title}>
        <div className="signals__pair">
          <TextArea
            label={copy.morse.textLabel}
            className="signals__message"
            rows={3}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
          <TextArea
            label={copy.morse.codeLabel}
            className="signals__message signals__message--code"
            rows={3}
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
            }}
          />
        </div>
        <div className="signals__actions">
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              const result = textToMorseCode(text);
              setCode(result.code);
              setSent(result.transliterated);
              setUnknown([]);
            }}
          >
            {copy.morse.toCode}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const result = morseCodeToText(code);
              setText(result.text);
              setUnknown(result.unknown);
              setSent([]);
            }}
          >
            {copy.morse.toText}
          </Button>
        </div>
        <p className="nx-hint">{copy.morse.wordsHint}</p>
        {sent.length > 0 && (
          <p className="nx-hint">
            {copy.morse.transliterated} <span className="signals__code">{sent.join(" ")}</span>
          </p>
        )}
        {unknown.length > 0 && (
          <p className="signals__error">
            {copy.morse.unknownTokens}{" "}
            <span className="signals__code">{unknown.join(" ")}</span>
          </p>
        )}
      </Card>

      <PlaybackCard prefs={prefs} onChange={onChange} plan={plan} />
      <LampCard plan={plan} />
      <AlphabetCard />
      <DecodeCard />
    </>
  );
}

// --- Ton i brzina -------------------------------------------------------------

/** The beat note: the engine's two speeds, the pitch, and a Play that hands the whole schedule to the audio clock. */
function PlaybackCard({
  prefs,
  onChange,
  plan,
}: TabProps & { readonly plan: MorsePlan | null }) {
  const [tone, setTone] = useState<ToneSession | null>(null);

  // A tone that outlived its card would be a tone nobody can stop.
  useEffect(
    () => () => {
      tone?.stop();
    },
    [tone],
  );

  return (
    <Card className="signals__card" title={copy.morse.playback}>
      <div className="signals__fields">
        <NumberField
          label={copy.morse.speedLabel}
          className="signals__number"
          value={prefs.wpm}
          parse={parseWpmInput}
          commit={(wpm) => {
            // Farnsworth may only slow a message down, so raising the characters
            // above the message pulls the message up with them — the engine
            // refuses the other order outright.
            onChange({ wpm, messageWpm: Math.min(prefs.messageWpm, wpm) });
          }}
        />
        <NumberField
          label={copy.morse.messageSpeedLabel}
          className="signals__number"
          value={prefs.messageWpm}
          parse={parseWpmInput}
          commit={(messageWpm) => {
            onChange({ messageWpm: Math.min(messageWpm, prefs.wpm) });
          }}
        />
        <NumberField
          label={copy.morse.pitchLabel}
          className="signals__number"
          value={prefs.pitchHz}
          parse={parsePitchInput}
          commit={(pitchHz) => {
            onChange({ pitchHz });
          }}
        />
      </div>
      <p className="nx-hint">{copy.morse.messageSpeedHint}</p>
      <div className="signals__actions">
        <Button
          size="sm"
          variant="primary"
          disabled={plan === null}
          onClick={() => {
            if (plan === null) return;
            setTone(playTone(plan.intervals, prefs.pitchHz));
          }}
        >
          {copy.morse.play}
        </Button>
        <Button
          size="sm"
          disabled={tone === null}
          onClick={() => {
            tone?.stop();
            setTone(null);
          }}
        >
          {copy.morse.stop}
        </Button>
        {plan === null ? (
          <span className="nx-hint">{copy.morse.silence}</span>
        ) : (
          <span className="signals__readout">
            {copy.morse.durationLabel}{" "}
            {numberFormat({ style: "unit", unit: "second", unitDisplay: "short" }).format(
              plan.totalMs / 1000,
            )}
          </span>
        )}
      </div>
    </Card>
  );
}

// --- Treptanje -----------------------------------------------------------------

/**
 * The screen as a lamp: a full-window white/black area, behind a warning the user
 * has to read and click through.
 *
 * **The warning is the point of this card, not a formality.** Flashing light is a
 * documented trigger for photosensitive seizures, so the flash is not started by
 * the same click that offers it: the first press opens the warning, and only the
 * second starts the lamp. Nothing flashes before that.
 *
 * **The lamp is drawn with the app's own ink and ground** — `--nx-text` and
 * `--nx-bg` — which are a near-black and a near-white in both themes, so „white"
 * and „black" are said with tokens rather than with two raw colours, and the
 * flash reads the same in Dan and in Noć.
 */
function LampCard({ plan }: { readonly plan: MorsePlan | null }) {
  /** The open warning, which is what the first press produces. */
  const [warned, setWarned] = useState(false);
  /** The running schedule, or null. */
  const [running, setRunning] = useState<readonly MorseInterval[] | null>(null);
  const [bright, setBright] = useState(false);
  /** Whether a lamp has been stopped or has run out — the one thing the card says afterwards. */
  const [finished, setFinished] = useState(false);
  const stopRef = useRef<HTMLButtonElement | null>(null);

  const halt = useCallback((): void => {
    setRunning(null);
    setFinished(true);
  }, []);

  /**
   * The lamp steps through the schedule on ABSOLUTE offsets from one start
   * instant, so a late timer never accumulates into the message: each step asks
   * the clock how far into the schedule it should be and waits the remainder.
   * A timer is the right instrument for a VISUAL flash; the tone, which has to be
   * exact, is scheduled on the audio clock instead (`tone.ts`).
   */
  useEffect(() => {
    if (running === null) return;
    const startedAt = performance.now();
    let index = 0;
    let offset = 0;
    let timer = 0;
    const step = (): void => {
      const interval = running[index];
      if (interval === undefined) {
        halt();
        return;
      }
      setBright(interval.on);
      offset += interval.ms;
      index += 1;
      timer = window.setTimeout(step, Math.max(0, startedAt + offset - performance.now()));
    };
    step();
    return () => {
      window.clearTimeout(timer);
    };
  }, [running, halt]);

  /**
   * Escape closes what it opened, and Tab has nowhere to go but the Stop button:
   * the lamp covers the page, so the page's own controls are not on screen while
   * it burns.
   */
  useEffect(() => {
    if (running === null && !warned) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        halt();
        setWarned(false);
        return;
      }
      if (event.key === "Tab" && running !== null) {
        event.preventDefault();
        stopRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [running, warned, halt]);

  return (
    <Card className="signals__card" title={copy.morse.lamp}>
      {warned ? (
        <div className="signals__warning">
          <p className="signals__warning-title">{copy.morse.lampWarningTitle}</p>
          <p className="nx-hint">{copy.morse.lampWarningBody}</p>
          <div className="signals__actions">
            <Button
              size="sm"
              variant="danger"
              disabled={plan === null}
              onClick={() => {
                setWarned(false);
                setFinished(false);
                setRunning(plan?.intervals ?? null);
              }}
            >
              {copy.morse.lampStart}
            </Button>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                setWarned(false);
              }}
            >
              {copy.common.stop}
            </Button>
          </div>
        </div>
      ) : (
        <div className="signals__actions">
          <Button
            size="sm"
            disabled={plan === null}
            onClick={() => {
              setFinished(false);
              setWarned(true);
            }}
          >
            {copy.morse.lamp}
          </Button>
          <span className="nx-hint">{copy.morse.lampKeyHint}</span>
        </div>
      )}
      {finished && !warned && running === null && (
        <p className="nx-hint">{copy.morse.lampStopped}</p>
      )}
      {running !== null && (
        <div
          className={
            bright ? "signals__lamp signals__lamp--bright" : "signals__lamp signals__lamp--dark"
          }
          role="dialog"
          aria-modal="true"
          aria-label={copy.morse.lamp}
        >
          <div className="signals__lamp-bar">
            <Button ref={stopRef} size="sm" variant="primary" onClick={halt}>
              {copy.morse.lampStop}
            </Button>
            <span className="signals__readout">{copy.morse.lampKeyHint}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

// --- Alfabet ------------------------------------------------------------------

/** Annex 1 as it is printed: the sign and its code, one line each — the table the engine's alphabet was read from. */
function AlphabetCard() {
  const [open, setOpen] = useState(false);
  const alphabet = morseAlphabet();
  return (
    <Card className="signals__card">
      <Disclosure
        label={copy.morse.alphabetTitle}
        summary={copy.morse.alphabetHint}
        open={open}
        onToggle={setOpen}
      >
        <ul className="signals__legend">
          {alphabet.map((entry, index) => (
            // The printed sign is not unique — a character and the procedural
            // signal that shares its code print the same mark — so the row's
            // position is part of its key.
            <li key={`${String(index)}-${entry.code}`} className="signals__legend-row">
              <span className="signals__legend-sign">{entry.symbol}</span>
              <span className="signals__code">{entry.code}</span>
            </li>
          ))}
        </ul>
      </Disclosure>
    </Card>
  );
}

// --- Dekodiranje sa mikrofona -------------------------------------------------

/** How often the envelope is read while decoding: 4 ms is a fifth of a dit at 60 WPM, the fastest this module offers. */
const READ_INTERVAL_MS = 4;

/** What one decode has to say: the message so far, the sender's measured speed, and how much of it looked like Morse. */
interface DecodeReading {
  readonly text: string;
  readonly unitMs: number;
  readonly wpm: number;
  readonly ambiguous: boolean;
  readonly confidence: number | null;
  readonly marks: number;
}

function DecodeCard() {
  const [listening, setListening] = useState(false);
  const [keying, setKeying] = useState(false);
  const [reading, setReading] = useState<DecodeReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<MicrophoneSession | null>(null);
  const keyerRef = useRef<MorseKeyer | null>(null);
  const timerRef = useRef(0);

  const stop = useCallback((): void => {
    window.clearInterval(timerRef.current);
    timerRef.current = 0;
    sessionRef.current?.stop();
    sessionRef.current = null;
    keyerRef.current = null;
    setListening(false);
    setKeying(false);
  }, []);

  // A session that outlived its card would go on listening to a room.
  useEffect(
    () => () => {
      stop();
    },
    [stop],
  );

  async function start(): Promise<void> {
    try {
      const session = await startMicrophone();
      const keyer = new MorseKeyer();
      sessionRef.current = session;
      keyerRef.current = keyer;
      setError(null);
      setReading(null);
      setListening(true);
      let wasKeying = false;
      timerRef.current = window.setInterval(() => {
        const current = sessionRef.current;
        const active = keyerRef.current;
        if (current === null || active === null) return;
        const completed = active.push({
          levelDb: current.readLevelDb(),
          atMs: current.nowMs(),
        });
        // State moves only on a CHANGE: a reading every four milliseconds must
        // not become a render every four milliseconds.
        if (active.keying !== wasKeying) {
          wasKeying = active.keying;
          setKeying(active.keying);
        }
        if (completed.length === 0) return;
        const intervals = active.intervals();
        const decoded = decodeMorse(intervals);
        setReading({
          text: decoded.text,
          unitMs: decoded.unitMs,
          wpm: decoded.wpm,
          ambiguous: decoded.ambiguous,
          confidence: morseConfidence(intervals, decoded.unitMs),
          marks: intervals.filter((interval) => interval.on).length,
        });
      }, READ_INTERVAL_MS);
    } catch (failure) {
      console.error("Nexus: the Morse decoder could not open the microphone:", failure);
      setError(
        microphoneFailure(failure) === "denied" ? copy.common.micDenied : copy.common.micFailed,
      );
      stop();
    }
  }

  return (
    <Card className="signals__card" title={copy.morse.decode}>
      <div className="signals__actions">
        <Button
          size="sm"
          variant={listening ? "ghost" : "primary"}
          onClick={() => {
            if (listening) stop();
            else void start();
          }}
        >
          {listening ? copy.common.stop : copy.common.start}
        </Button>
        {listening && <Chip variant="data">{copy.common.listening}</Chip>}
        {listening && (
          <span
            className={keying ? "signals__key signals__key--down" : "signals__key"}
            aria-hidden="true"
          />
        )}
      </div>
      <p className="nx-hint">{copy.morse.decodeHint}</p>
      {error !== null && <p className="signals__error">{error}</p>}
      {reading === null ? (
        <p className="nx-hint">{copy.morse.nothingHeard}</p>
      ) : (
        <>
          <p className="signals__decode-text">{reading.text}</p>
          <StatBand
            caption={copy.morse.confidenceHint}
            stats={[
              {
                label: copy.morse.unit,
                value: numberFormat({
                  style: "unit",
                  unit: "millisecond",
                  unitDisplay: "short",
                  maximumFractionDigits: 1,
                }).format(reading.unitMs),
              },
              {
                label: copy.morse.wpm,
                value: numberFormat({ maximumFractionDigits: 1 }).format(reading.wpm),
              },
              {
                label: copy.morse.confidence,
                value:
                  reading.confidence === null
                    ? copy.morse.nothingHeard
                    : numberFormat({ style: "percent", maximumFractionDigits: 0 }).format(
                        reading.confidence,
                      ),
              },
              {
                label: copy.morse.heard,
                value: numberFormat({ maximumFractionDigits: 0 }).format(reading.marks),
              },
            ]}
          />
          {reading.ambiguous && <p className="nx-hint">{copy.morse.guessed}</p>}
        </>
      )}
      <p className="nx-hint">{copy.common.deviceNote}</p>
    </Card>
  );
}
