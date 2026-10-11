import { useEffect, useRef, useState } from "react";
import { Button, Card, Checkbox, Select, TextField } from "@nexus/ui";
import { encodeMorse, lampOnAt, morseSchedule, scheduleDurationMs, type MorseInterval } from "@nexus/core";
import { copy } from "./copy.js";

/**
 * The lamp: a full-window surface in white or red, and a Morse lamp that flashes
 * text with the signals engine's own timing.
 *
 * **Why this is one card.** Both are the same act — the screen as a light source
 * — and the difference is only whether it is steady or keyed. Reusing one
 * overlay for both means the escape hatch is written once: a surface that covers
 * the window must never be a trap, so Escape closes it and a visible button does
 * the same thing.
 *
 * **Why the red mode is a colour and not a filter.** Red at night protects dark
 * adaptation, which is what somebody using a screen as a lamp in a dark room
 * actually wants; a dimmed white screen is a different thing that leaves you
 * night-blind. Both surfaces are composed from the app's own tokens
 * (`color-mix` of the theme's surface and its danger hue) because a raw colour
 * is exactly what this repository's design rules forbid in a component.
 *
 * **Why the flashing is gated twice.** Flashing light can trigger photosensitive
 * seizures, so the first flash needs an explicit acknowledgement — and when the
 * system says the user asked for reduced motion, there is no flashing at all and
 * the card says why. The timing is `morseSchedule`'s (ITU-R M.1677-1's PARIS
 * scale, through the signals engine) and the lamp's state comes from
 * `lampOnAt` — a function of the instant, never a chain of timers, so stopping
 * stops immediately rather than after the marks already queued.
 */

/** The lamp's two surfaces. */
const LAMP_MODES = ["white", "red"] as const;
type LampMode = (typeof LAMP_MODES)[number];

/** The speed the Morse field falls back to when it does not hold a usable one. */
const DEFAULT_WPM = 12;

export function LightCard() {
  const [mode, setMode] = useState<LampMode>("white");
  const [intensity, setIntensity] = useState(1);
  const [lampOn, setLampOn] = useState(false);
  const [text, setText] = useState("");
  const [wpm, setWpm] = useState(String(DEFAULT_WPM));
  const [morseAck, setMorseAck] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [transliterated, setTransliterated] = useState<readonly string[]>([]);
  const [lit, setLit] = useState(false);
  const intervalsRef = useRef<readonly MorseInterval[]>([]);

  /** The system's own reduced-motion preference, read once and kept in step. */
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  /** Escape closes the lamp, whichever mode put it there. */
  useEffect(() => {
    if (!lampOn && !flashing) return;
    const handler = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setLampOn(false);
        setFlashing(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lampOn, flashing]);

  /** The flash: the lamp's state at each frame comes from the schedule and the clock. */
  useEffect(() => {
    if (!flashing) {
      setLit(false);
      return;
    }
    const intervals = intervalsRef.current;
    const total = scheduleDurationMs(intervals);
    const startedAt = performance.now();
    let handle = 0;
    const step = (): void => {
      const elapsed = performance.now() - startedAt;
      if (elapsed >= total) {
        setLit(false);
        setFlashing(false);
        return;
      }
      setLit(lampOnAt(intervals, elapsed));
      handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [flashing]);

  const overlayVisible = lampOn || flashing;
  const speed = Number(wpm.trim());
  const usableWpm = Number.isFinite(speed) && speed >= 1 && speed <= 60 ? speed : DEFAULT_WPM;

  return (
    <Card className="lab__card" title={copy.light.title}>
      <div className="lab__row">
        <Select
          label={copy.light.lampMode}
          value={mode}
          onChange={(event) => setMode(event.target.value as LampMode)}
        >
          {LAMP_MODES.map((option) => (
            <option key={option} value={option}>
              {copy.light.lampModes[option]}
            </option>
          ))}
        </Select>
        <label className="lab__field">
          <span className="nx-eyebrow">{copy.light.intensity}</span>
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={intensity}
            onChange={(event) => setIntensity(Number(event.target.value))}
          />
        </label>
        <Button
          size="sm"
          variant={lampOn ? "danger" : "primary"}
          onClick={() => {
            setFlashing(false);
            setLampOn(!lampOn);
          }}
        >
          {lampOn ? copy.light.lampOff : copy.light.lampOn}
        </Button>
      </div>
      <p className="nx-hint">{copy.light.lampHint}</p>

      <div className="nx-eyebrow">{copy.light.morseTitle}</div>
      <div className="lab__row">
        <TextField
          label={copy.light.morseText}
          value={text}
          maxLength={120}
          onChange={(event) => setText(event.target.value)}
        />
        <TextField
          label={copy.light.morseWpm}
          inputMode="numeric"
          value={wpm}
          onChange={(event) => setWpm(event.target.value)}
        />
        <Button
          size="sm"
          variant={flashing ? "danger" : "primary"}
          disabled={reducedMotion || !morseAck || (text.trim() === "" && !flashing)}
          onClick={() => {
            if (flashing) {
              setFlashing(false);
              return;
            }
            const schedule = morseSchedule(text, { charWpm: usableWpm });
            if (schedule.length === 0) return;
            intervalsRef.current = schedule;
            // What the engine could NOT send as itself, said out loud: a lamp
            // that silently changed somebody's text is worse than one that
            // refuses it.
            setTransliterated(encodeMorse(text).transliterated);
            setLampOn(false);
            setFlashing(true);
          }}
        >
          {flashing ? copy.light.morseStop : copy.light.morseStart}
        </Button>
      </div>
      <Checkbox
        checked={morseAck}
        disabled={reducedMotion}
        onChange={(event) => setMorseAck(event.target.checked)}
      >
        {copy.light.morseAcknowledge}
      </Checkbox>
      {reducedMotion && <p className="nx-hint">{copy.light.morseReduced}</p>}
      {transliterated.length > 0 && (
        <p className="nx-hint">{`${copy.light.morseTransliterated} ${transliterated.join(", ")}`}</p>
      )}
      <p className="nx-hint">{copy.light.morseTiming}</p>

      {overlayVisible && (
        <div
          className={`lab__lamp lab__lamp--${mode}${flashing && !lit ? " lab__lamp--off" : ""}`}
          style={{ opacity: flashing && !lit ? 0.04 : intensity }}
          role="dialog"
          aria-label={copy.light.lampLabel}
        >
          <Button
            size="sm"
            onClick={() => {
              setLampOn(false);
              setFlashing(false);
            }}
          >
            {copy.light.lampClose}
          </Button>
          <p className="lab__lamp-hint">{copy.light.lampEscape}</p>
        </div>
      )}
    </Card>
  );
}
