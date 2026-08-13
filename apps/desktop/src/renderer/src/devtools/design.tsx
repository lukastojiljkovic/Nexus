import {
  CSS_EASINGS,
  CSS_EASING_NAMES,
  GRADIENT_KINDS,
  GRADIENT_SPACES,
  HARMONY_KINDS,
  MIX_SPACES,
  colourName,
  compositeOver,
  contrastReport,
  easingAt,
  formatColour,
  gradientCss,
  harmony,
  isInGamut,
  isLegalEasing,
  mixColours,
  parseColour,
  sampleEasing,
  sampleGradient,
  tintsAndShades,
  toHex,
  toOklch,
  COLOUR_FORMATS,
  type ColourFormat,
  type CssEasingName,
  type CubicBezierEasing,
  type EasingSample,
  type GradientKind,
  type GradientSpace,
  type GradientStop,
  type HarmonyKind,
  type MixSpace,
  type Srgb,
} from "@nexus/core/devtools/colour";
import { parseToolNumber } from "@nexus/core";
import { Button, Chip, Icon } from "@nexus/ui";
import { useMemo, useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import {
  CopyButton,
  ResultRow,
  ToolFailure,
  ToolInput,
  ToolOutput,
  ToolSection,
  ToolSelect,
  ToolTable,
} from "../pro/shared.js";

/**
 * „Boje i dizajn" — the 6 surfaces of this group of the developer drawer.
 *
 * One file per category rather than one map for all forty-eight, because the
 * map is the seam every surface is added at: a single file would be the one
 * place every future tool has to touch, and the place two people writing two
 * unrelated tools collide. `proToolSurfaces.tsx` composes the nine.
 *
 * Every id below is declared in `DEVTOOLS_TOOLS` (`shared/modules.ts`) and
 * `modules.test.ts` pins the two lists against each other in both directions —
 * a surface with no declaration is unreachable, and a declaration with no
 * surface is a row the drawer would offer and then fail to open.
 *
 * **The colour rule.** `@nexus/core/devtools/colour` is the only place a CSS
 * colour is ever parsed or formatted; nothing here re-derives an sRGB byte, a
 * WCAG ratio or an easing curve. And no literal colour ever appears in THIS
 * file's own source — every swatch is painted from a string that came out of
 * `parseColour`/`formatColour`/`toHex` at render time, never from a hex or
 * `rgb()` typed into a default or a placeholder. Where a field needs a
 * starting value before the user has typed anything, the field is simply left
 * empty and the surface says so (`common.awaitingInput`) rather than seeding
 * it with a colour this file would have to write down.
 *
 * The tools this file owes:
 *   - `color-convert`
 *   - `color-palette`
 *   - `gradient`
 *   - `cubic-bezier`
 *   - `contrast`
 *   - `color-mixer`
 */

/* -------------------------------------------------------------------------- */
/* Shared visual primitives                                                   */
/* -------------------------------------------------------------------------- */

/** The edge length of a single answer swatch — the converter, the composite result. */
const SWATCH_SIZE = "3rem";
/** The edge length of one cell in a ramp/harmony/space row, where several sit side by side. */
const RAMP_SWATCH_SIZE = "2.75rem";
/** The gradient preview strip's fixed height — geometry, not colour. */
const BAR_HEIGHT = "3rem";
/** The easing curve's square plot size, in SVG user units. */
const CURVE_SIZE = 240;

/**
 * A colour swatch, painted from a computed CSS string — never a literal.
 *
 * Reuses `.tool__bit`, the drawer's one „small bordered cell" rule, rather
 * than inventing a swatch class: the border and radius are the existing
 * token-backed rule, and only the two things that make this cell a SWATCH
 * (its size and its background) are set inline, which is exactly the
 * geometry-and-colour carve-out the drawer's CSS policy allows.
 */
function Swatch({ colour, size = RAMP_SWATCH_SIZE }: { colour: string; size?: string }) {
  return (
    <span
      className="tool__bit"
      aria-hidden="true"
      style={{ width: size, height: size, background: colour }}
    />
  );
}

/** A swatch with a copy button whose own label IS the hex value — one control, two jobs. */
function SwatchCopy({ colour }: { colour: Srgb }) {
  const hex = toHex(colour);
  return (
    <div className="tool__field">
      <Swatch colour={hex} />
      <CopyButton value={hex} label={hex} />
    </div>
  );
}

/** A row of `SwatchCopy` cells — a ramp, a harmony set, a row of mix results. */
function SwatchRow({ colours }: { colours: readonly Srgb[] }) {
  return (
    <div className="tool__bits">
      {colours.map((colour, index) => (
        // Positional samples off a computed ramp/harmony, which carry no id of
        // their own — the index is their identity, as in `ToolTable`.
        <SwatchCopy key={index} colour={colour} />
      ))}
    </div>
  );
}

/** A pass/fail verdict — never colour alone, per house rule; the WORD is what reads. */
function PassFailChip({
  pass,
  passLabel,
  failLabel,
}: {
  pass: boolean;
  passLabel: string;
  failLabel: string;
}) {
  return <Chip variant={pass ? "data" : "danger"}>{pass ? passLabel : failLabel}</Chip>;
}

/**
 * The last non-null `value` this hook was given, so a surface whose CURRENT
 * input is momentarily invalid keeps showing its last good answer instead of
 * blanking — the palette ramp and the gradient preview both name this as
 * their behaviour on a bad edit.
 *
 * This calls `setState` during render, which is React's own documented shape
 * for „remember something from a previous render" — not `useEffect`, which
 * this drawer reserves for a subscription or a timer, neither of which this
 * is: the value being remembered is a pure function of an earlier render.
 */
function useLastValid<T>(value: T | null): T | null {
  const [last, setLast] = useState<T | null>(null);
  if (value !== null && value !== last) setLast(value);
  return value ?? last;
}

/** One draft row shared by the gradient's stops and the mixer's parts: a colour, and one number. */
interface ColourNumberDraft {
  readonly key: number;
  readonly colourText: string;
  readonly numberText: string;
}

/** Every draft row parsed, or `null` the moment any row's colour or number does not read. */
function collectColourNumberPairs(
  drafts: readonly ColourNumberDraft[],
): readonly { readonly colour: Srgb; readonly value: number }[] | null {
  const result: { colour: Srgb; value: number }[] = [];
  for (const draft of drafts) {
    const colour = parseColour(draft.colourText);
    const value = parseToolNumber(draft.numberText);
    if (colour === null || value === null) return null;
    result.push({ colour, value });
  }
  return result;
}

/**
 * One row of the gradient's stop list or the mixer's part list — a colour
 * field, a number field, and a remove button once there is more than one row
 * left to remove down to. The two tools differ only in what the number MEANS
 * (a position, a weight), which is why this takes generic labels rather than
 * knowing either domain.
 */
function ColourNumberRow({
  colourLabel,
  colourValue,
  onColourChange,
  colourError,
  numberLabel,
  numberValue,
  onNumberChange,
  numberError,
  onRemove,
  removeLabel,
}: {
  colourLabel: string;
  colourValue: string;
  onColourChange: (value: string) => void;
  colourError: string | undefined;
  numberLabel: string;
  numberValue: string;
  onNumberChange: (value: string) => void;
  numberError: string | undefined;
  onRemove: (() => void) | undefined;
  removeLabel: string;
}) {
  return (
    <div className="tool__pair">
      <ToolInput
        label={colourLabel}
        value={colourValue}
        onChange={onColourChange}
        error={colourError}
        mono
      />
      <ToolInput
        label={numberLabel}
        value={numberValue}
        onChange={onNumberChange}
        error={numberError}
        mono
      />
      {onRemove !== undefined && (
        <Button
          className="tool__row-remove"
          aria-label={removeLabel}
          title={removeLabel}
          onClick={onRemove}
        >
          <Icon name="close" />
        </Button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 1 — color-convert                                                          */
/* -------------------------------------------------------------------------- */

function ColorConvertTool() {
  const s = strings.devtools.design["color-convert"];
  const common = strings.pro.common;
  const [text, setText] = useState("");

  const colour = useMemo(() => parseColour(text), [text]);
  const typed = text.trim() !== "";

  return (
    <>
      <ToolInput
        label={s.input}
        value={text}
        onChange={setText}
        placeholder={s.inputPlaceholder}
        mono
      />
      {!typed ? (
        <p className="tool__note">{common.awaitingInput}</p>
      ) : colour === null ? (
        <ToolFailure>{s.invalid}</ToolFailure>
      ) : (
        <>
          <Swatch colour={formatColour(colour, "hex")} size={SWATCH_SIZE} />
          {!isInGamut(colour) && <p className="tool__note">{s.outOfGamut}</p>}
          <div className="tool__results">
            {COLOUR_FORMATS.map((format: ColourFormat) => {
              const value = formatColour(colour, format);
              return (
                <ResultRow
                  key={format}
                  label={s.formats[format]}
                  value={
                    <>
                      {value}
                      <CopyButton value={value} />
                    </>
                  }
                />
              );
            })}
            <ResultRow label={s.name} value={colourName(colour) ?? s.noName} mono={false} />
          </div>
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* 2 — color-palette                                                          */
/* -------------------------------------------------------------------------- */

const DEFAULT_PALETTE_STEPS = "5";

function ColorPaletteTool() {
  const s = strings.devtools.design["color-palette"];
  const common = strings.pro.common;
  const [baseText, setBaseText] = useState("");
  const [stepsText, setStepsText] = useState(DEFAULT_PALETTE_STEPS);
  const [harmonyKind, setHarmonyKind] = useState<HarmonyKind>(HARMONY_KINDS[0]);

  const base = useMemo(() => parseColour(baseText), [baseText]);
  const stepsValue = parseToolNumber(stepsText);
  const rawRamp = useMemo(
    () => (base === null || stepsValue === null ? null : tintsAndShades(base, stepsValue)),
    [base, stepsValue],
  );
  const ramp = useLastValid(rawRamp);

  const typed = baseText.trim() !== "";
  const colourInvalid = typed && base === null;
  const stepsInvalid = base !== null && rawRamp === null;

  return (
    <>
      <div className="tool__pair">
        <ToolInput
          label={s.base}
          value={baseText}
          onChange={setBaseText}
          placeholder={s.basePlaceholder}
          error={colourInvalid ? s.invalid : undefined}
          mono
        />
        <ToolInput
          label={s.steps}
          value={stepsText}
          onChange={setStepsText}
          error={stepsInvalid ? s.invalidSteps : undefined}
          mono
        />
      </div>
      {!typed ? (
        <p className="tool__note">{common.awaitingInput}</p>
      ) : (
        <>
          {ramp !== null && (
            <div className="tool__results">
              <div className="nx-eyebrow tool__results-heading">{s.tints}</div>
              <SwatchRow colours={ramp.tints} />
              <div className="nx-eyebrow tool__results-heading">{s.shades}</div>
              <SwatchRow colours={ramp.shades} />
            </div>
          )}
          {base !== null && (
            <ToolSection title={s.harmony}>
              <ToolSelect
                label={s.harmony}
                value={harmonyKind}
                onChange={setHarmonyKind}
                options={HARMONY_KINDS.map((kind: HarmonyKind) => ({
                  id: kind,
                  label: s.kind[kind],
                }))}
              />
              {toOklch(base).c < 1e-4 && <p className="tool__note">{s.greyNote}</p>}
              <SwatchRow colours={harmony(base, harmonyKind)} />
            </ToolSection>
          )}
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* 3 — gradient                                                                */
/* -------------------------------------------------------------------------- */

const DEFAULT_GRADIENT_ANGLE = "90";
const DEFAULT_GRADIENT_SAMPLES = "48";
let gradientStopKeySeq = 0;
function nextGradientStopKey(): number {
  gradientStopKeySeq += 1;
  return gradientStopKeySeq;
}

function initialGradientStops(): ColourNumberDraft[] {
  return [
    { key: nextGradientStopKey(), colourText: "", numberText: "0" },
    { key: nextGradientStopKey(), colourText: "", numberText: "100" },
  ];
}

/** The sampled gradient as a filled strip, not discrete swatches — a preview, not a palette. */
function GradientBar({ samples }: { samples: readonly Srgb[] }) {
  return (
    <div
      className="tool__output"
      style={{ display: "flex", flexDirection: "row", padding: 0, height: BAR_HEIGHT }}
    >
      {samples.map((colour, index) => (
        // Positional samples along the gradient's own length, which carry no id.
        <span key={index} style={{ flex: "1 1 0%", background: toHex(colour) }} />
      ))}
    </div>
  );
}

function GradientTool() {
  const s = strings.devtools.design.gradient;
  const common = strings.pro.common;
  const [stops, setStops] = useState<ColourNumberDraft[]>(initialGradientStops);
  const [kind, setKind] = useState<GradientKind>(GRADIENT_KINDS[0]);
  const [space, setSpace] = useState<GradientSpace>(GRADIENT_SPACES[0]);
  const [angleText, setAngleText] = useState(DEFAULT_GRADIENT_ANGLE);
  const [samplesText, setSamplesText] = useState(DEFAULT_GRADIENT_SAMPLES);

  function updateStop(key: number, patch: Partial<ColourNumberDraft>): void {
    setStops((current) => current.map((stop) => (stop.key === key ? { ...stop, ...patch } : stop)));
  }

  const pairs = useMemo(() => collectColourNumberPairs(stops), [stops]);
  const angleValue = parseToolNumber(angleText);
  const angleDeg = kind === "radial" || angleValue === null ? undefined : angleValue;
  const samplesValue = parseToolNumber(samplesText);

  const spec = useMemo(() => {
    if (pairs === null) return null;
    const gradientStops: GradientStop[] = pairs.map((pair) => ({
      colour: pair.colour,
      position: pair.value / 100,
    }));
    return { kind, stops: gradientStops, space, ...(angleDeg === undefined ? {} : { angleDeg }) };
  }, [pairs, kind, space, angleDeg]);

  const rawCss = useMemo(() => (spec === null ? null : gradientCss(spec)), [spec]);
  const css = useLastValid(rawCss);

  const rawSamples = useMemo(() => {
    if (spec === null || rawCss === null || samplesValue === null) return null;
    return sampleGradient(spec, samplesValue);
  }, [spec, rawCss, samplesValue]);
  const previewSamples = useLastValid(rawSamples);

  const anyStopTyped = stops.some((stop) => stop.colourText.trim() !== "");
  const stopsInvalid = pairs !== null && rawCss === null;
  const samplesInvalid = pairs !== null && rawCss !== null && rawSamples === null;

  return (
    <>
      <ToolSection>
        {stops.map((stop) => (
          <ColourNumberRow
            key={stop.key}
            colourLabel={s.colour}
            colourValue={stop.colourText}
            onColourChange={(value) => {
              updateStop(stop.key, { colourText: value });
            }}
            colourError={
              stop.colourText.trim() !== "" && parseColour(stop.colourText) === null
                ? s.invalid
                : undefined
            }
            numberLabel={s.position}
            numberValue={stop.numberText}
            onNumberChange={(value) => {
              updateStop(stop.key, { numberText: value });
            }}
            numberError={
              stop.numberText.trim() !== "" && parseToolNumber(stop.numberText) === null
                ? common.invalid
                : undefined
            }
            onRemove={
              stops.length > 2
                ? () => {
                    setStops((current) => current.filter((s2) => s2.key !== stop.key));
                  }
                : undefined
            }
            removeLabel={s.removeStop}
          />
        ))}
        <Button
          onClick={() => {
            setStops((current) => [
              ...current,
              { key: nextGradientStopKey(), colourText: "", numberText: "100" },
            ]);
          }}
        >
          {s.addStop}
        </Button>
        {stopsInvalid && <ToolFailure>{s.invalidStops}</ToolFailure>}
      </ToolSection>

      <div className="tool__pair">
        <ToolSelect
          label={s.kind}
          value={kind}
          onChange={setKind}
          options={GRADIENT_KINDS.map((k: GradientKind) => ({ id: k, label: s.kindLabel[k] }))}
        />
        <ToolSelect
          label={s.space}
          value={space}
          onChange={setSpace}
          options={GRADIENT_SPACES.map((sp: GradientSpace) => ({
            id: sp,
            label: s.spaceLabel[sp],
          }))}
          {...(space === "oklab" ? { hint: s.spaceHint } : {})}
        />
      </div>
      <div className="tool__pair">
        {kind !== "radial" && (
          <ToolInput
            label={s.angle}
            value={angleText}
            onChange={setAngleText}
            error={angleText.trim() !== "" && angleValue === null ? common.invalid : undefined}
            mono
          />
        )}
        <ToolInput
          label={s.samples}
          value={samplesText}
          onChange={setSamplesText}
          error={samplesInvalid ? s.invalidSamples : undefined}
          mono
        />
      </div>

      {!anyStopTyped ? (
        <p className="tool__note">{common.awaitingInput}</p>
      ) : (
        <>
          {previewSamples !== null && <GradientBar samples={previewSamples} />}
          {css !== null && <ToolOutput label={s.css} value={css} />}
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* 4 — cubic-bezier                                                            */
/* -------------------------------------------------------------------------- */

const DEFAULT_BEZIER_PRESET: CssEasingName = "ease";
const DEFAULT_BEZIER_TIME = "0.5";
const DEFAULT_BEZIER_SAMPLES = "120";

function bezierCss(easing: CubicBezierEasing): string {
  return `cubic-bezier(${easing.x1}, ${easing.y1}, ${easing.x2}, ${easing.y2})`;
}

/**
 * The curve, plotted from `sampleEasing` — an SVG path rather than a canvas,
 * per the drawer's own rule: it is simpler here and it scales for free. The
 * y-domain is fitted to whatever the samples actually reach so a bounce that
 * overshoots is never clipped, and 0/1 stay in frame even for a curve that
 * never leaves them.
 */
function EasingCurve({
  samples,
  time,
  progress,
}: {
  samples: readonly EasingSample[];
  time: number | null;
  progress: number | null;
}) {
  const progresses = samples.map((sample) => sample.progress);
  const minY = Math.min(0, ...progresses);
  const maxY = Math.max(1, ...progresses);
  const span = maxY - minY;

  const sx = (t: number): number => t * CURVE_SIZE;
  const sy = (p: number): number => CURVE_SIZE - ((p - minY) / span) * CURVE_SIZE;

  const path = samples
    .map((sample, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command} ${sx(sample.time).toFixed(2)} ${sy(sample.progress).toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      width={CURVE_SIZE}
      height={CURVE_SIZE}
      viewBox={`0 0 ${CURVE_SIZE} ${CURVE_SIZE}`}
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <line
        x1={0}
        y1={sy(0)}
        x2={CURVE_SIZE}
        y2={sy(0)}
        style={{ stroke: "var(--nx-border-subtle)" }}
      />
      <line
        x1={0}
        y1={sy(1)}
        x2={CURVE_SIZE}
        y2={sy(1)}
        style={{ stroke: "var(--nx-border-subtle)" }}
      />
      <line
        x1={sx(0)}
        y1={sy(0)}
        x2={sx(1)}
        y2={sy(1)}
        strokeDasharray="4 4"
        style={{ stroke: "var(--nx-text-muted)" }}
      />
      <path d={path} fill="none" strokeWidth={2} style={{ stroke: "var(--nx-accent)" }} />
      {time !== null && progress !== null && (
        <>
          <line
            x1={sx(time)}
            y1={sy(minY)}
            x2={sx(time)}
            y2={sy(progress)}
            strokeDasharray="2 3"
            style={{ stroke: "var(--nx-border-subtle)" }}
          />
          <circle cx={sx(time)} cy={sy(progress)} r={4} style={{ fill: "var(--nx-accent)" }} />
        </>
      )}
    </svg>
  );
}

function CubicBezierTool() {
  const s = strings.devtools.design["cubic-bezier"];
  const common = strings.pro.common;
  const preset0 = CSS_EASINGS[DEFAULT_BEZIER_PRESET];
  const [presetId, setPresetId] = useState<CssEasingName | "custom">(DEFAULT_BEZIER_PRESET);
  const [x1Text, setX1Text] = useState(String(preset0.x1));
  const [y1Text, setY1Text] = useState(String(preset0.y1));
  const [x2Text, setX2Text] = useState(String(preset0.x2));
  const [y2Text, setY2Text] = useState(String(preset0.y2));
  const [timeText, setTimeText] = useState(DEFAULT_BEZIER_TIME);
  const [samplesText, setSamplesText] = useState(DEFAULT_BEZIER_SAMPLES);

  function applyPreset(id: CssEasingName | "custom"): void {
    setPresetId(id);
    if (id === "custom") return;
    const easing = CSS_EASINGS[id];
    setX1Text(String(easing.x1));
    setY1Text(String(easing.y1));
    setX2Text(String(easing.x2));
    setY2Text(String(easing.y2));
  }

  function editControlPoint(setter: (value: string) => void, value: string): void {
    setter(value);
    setPresetId("custom");
  }

  const x1 = parseToolNumber(x1Text);
  const y1 = parseToolNumber(y1Text);
  const x2 = parseToolNumber(x2Text);
  const y2 = parseToolNumber(y2Text);
  const easing: CubicBezierEasing | null =
    x1 === null || y1 === null || x2 === null || y2 === null ? null : { x1, y1, x2, y2 };
  const legalEasing: CubicBezierEasing | null =
    easing !== null && isLegalEasing(easing) ? easing : null;

  const timeValue = parseToolNumber(timeText);
  const progress =
    legalEasing !== null && timeValue !== null ? easingAt(legalEasing, timeValue) : null;
  const samplesValue = parseToolNumber(samplesText);
  const curve =
    legalEasing !== null && samplesValue !== null
      ? sampleEasing(legalEasing, samplesValue)
      : null;

  const timeInvalid = legalEasing !== null && timeText.trim() !== "" && progress === null;
  const samplesInvalid = legalEasing !== null && samplesText.trim() !== "" && curve === null;

  const presetOptions: readonly { id: CssEasingName | "custom"; label: string }[] = [
    ...CSS_EASING_NAMES.map((name: CssEasingName) => ({ id: name, label: name })),
    { id: "custom", label: s.custom },
  ];

  return (
    <>
      <ToolSelect
        label={s.preset}
        value={presetId}
        onChange={applyPreset}
        options={presetOptions}
      />
      <div className="tool__pair">
        <ToolInput
          label={s.x1}
          value={x1Text}
          onChange={(v) => {
            editControlPoint(setX1Text, v);
          }}
          mono
        />
        <ToolInput
          label={s.y1}
          value={y1Text}
          onChange={(v) => {
            editControlPoint(setY1Text, v);
          }}
          mono
        />
      </div>
      <div className="tool__pair">
        <ToolInput
          label={s.x2}
          value={x2Text}
          onChange={(v) => {
            editControlPoint(setX2Text, v);
          }}
          mono
        />
        <ToolInput
          label={s.y2}
          value={y2Text}
          onChange={(v) => {
            editControlPoint(setY2Text, v);
          }}
          mono
        />
      </div>
      {easing === null && <ToolFailure>{common.invalid}</ToolFailure>}
      {easing !== null && legalEasing === null && <ToolFailure>{s.illegal}</ToolFailure>}

      {legalEasing !== null && curve !== null && (
        <EasingCurve samples={curve} time={timeValue} progress={progress} />
      )}

      <div className="tool__pair">
        <ToolInput
          label={s.time}
          value={timeText}
          onChange={setTimeText}
          error={timeInvalid ? s.invalidTime : undefined}
          mono
        />
        <ToolInput
          label={s.samples}
          value={samplesText}
          onChange={setSamplesText}
          error={samplesInvalid ? s.invalidSamples : undefined}
          mono
        />
      </div>
      {progress !== null && (
        <p className="tool__figure">
          <span className="tool__figure-value">{progress.toFixed(4)}</span>
          <span className="tool__figure-unit">{s.progress}</span>
        </p>
      )}
      {progress !== null && (progress < 0 || progress > 1) && (
        <p className="tool__note">{s.overshoot}</p>
      )}

      {legalEasing !== null && <ToolOutput label={s.css} value={bezierCss(legalEasing)} />}

      <ToolSection title={s.referenceTitle}>
        <ToolTable
          head={[s.preset, s.css]}
          rows={CSS_EASING_NAMES.map((name: CssEasingName) => [
            name,
            bezierCss(CSS_EASINGS[name]),
          ])}
        />
      </ToolSection>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* 5 — contrast                                                                */
/* -------------------------------------------------------------------------- */

function ContrastTool() {
  const s = strings.devtools.design.contrast;
  const [textText, setTextText] = useState("");
  const [backgroundText, setBackgroundText] = useState("");

  const text = useMemo(() => parseColour(textText), [textText]);
  const background = useMemo(() => parseColour(backgroundText), [backgroundText]);

  const typed = textText.trim() !== "" || backgroundText.trim() !== "";
  const textInvalid = textText.trim() !== "" && text === null;
  const backgroundInvalid = backgroundText.trim() !== "" && background === null;
  const translucent =
    (text !== null && text.alpha < 1) || (background !== null && background.alpha < 1);

  const report =
    text === null || background === null ? null : contrastReport(text, background);

  return (
    <>
      <div className="tool__pair">
        <ToolInput
          label={s.text}
          value={textText}
          onChange={setTextText}
          error={textInvalid ? s.invalid : undefined}
          mono
        />
        <ToolInput
          label={s.background}
          value={backgroundText}
          onChange={setBackgroundText}
          error={backgroundInvalid ? s.invalid : undefined}
          mono
        />
        <Button
          className="tool__swap"
          aria-label={s.swap}
          title={s.swap}
          onClick={() => {
            setTextText(backgroundText);
            setBackgroundText(textText);
          }}
        >
          <Icon name="swap" />
        </Button>
      </div>

      {!typed ? (
        <p className="tool__note">{strings.pro.common.awaitingInput}</p>
      ) : text !== null && background !== null && report !== null ? (
        <>
          <div className="tool__output" style={{ background: formatColour(background, "hex") }}>
            <span
              className="tool__output-body"
              style={{ color: formatColour(text, "hex") }}
            >
              {s.preview}
            </span>
          </div>

          <p className="tool__figure">
            <span className="tool__figure-value">{report.ratio.toFixed(2)}</span>
            <span className="tool__figure-unit">: 1 — {s.ratio}</span>
          </p>
          <div className="tool__results">
            <ResultRow
              label={s.level.aaBody}
              value={<PassFailChip pass={report.aaBody} passLabel={s.pass} failLabel={s.fail} />}
              mono={false}
            />
            <ResultRow
              label={s.level.aaLarge}
              value={<PassFailChip pass={report.aaLarge} passLabel={s.pass} failLabel={s.fail} />}
              mono={false}
            />
            <ResultRow
              label={s.level.aaaBody}
              value={<PassFailChip pass={report.aaaBody} passLabel={s.pass} failLabel={s.fail} />}
              mono={false}
            />
            <ResultRow
              label={s.level.aaaLarge}
              value={
                <PassFailChip pass={report.aaaLarge} passLabel={s.pass} failLabel={s.fail} />
              }
              mono={false}
            />
            <ResultRow
              label={s.level.nonText}
              value={<PassFailChip pass={report.nonText} passLabel={s.pass} failLabel={s.fail} />}
              mono={false}
            />
            <ResultRow label={s.apca} value={report.apcaLc.toFixed(1)} />
          </div>
          <p className="tool__note">{s.apcaHint}</p>
          {translucent && <p className="tool__note">{s.alphaHint}</p>}
        </>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* 6 — color-mixer                                                             */
/* -------------------------------------------------------------------------- */

let mixerPartKeySeq = 0;
function nextMixerPartKey(): number {
  mixerPartKeySeq += 1;
  return mixerPartKeySeq;
}

function initialMixerParts(): ColourNumberDraft[] {
  return [
    { key: nextMixerPartKey(), colourText: "", numberText: "1" },
    { key: nextMixerPartKey(), colourText: "", numberText: "1" },
  ];
}

function ColorMixerTool() {
  const s = strings.devtools.design["color-mixer"];
  const [parts, setParts] = useState<ColourNumberDraft[]>(initialMixerParts);
  const [sourceText, setSourceText] = useState("");
  const [backdropText, setBackdropText] = useState("");

  function updatePart(key: number, patch: Partial<ColourNumberDraft>): void {
    setParts((current) => current.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  const pairs = useMemo(() => collectColourNumberPairs(parts), [parts]);
  const colourParts = useMemo(
    () => (pairs === null ? null : pairs.map((p) => ({ colour: p.colour, weight: p.value }))),
    [pairs],
  );
  const mixResults = useMemo(() => {
    if (colourParts === null) return null;
    const result: { space: MixSpace; colour: Srgb }[] = [];
    for (const space of MIX_SPACES) {
      const mixed = mixColours(colourParts, space);
      if (mixed === null) return null;
      result.push({ space, colour: mixed });
    }
    return result;
  }, [colourParts]);

  const anyPartTyped = parts.some((p) => p.colourText.trim() !== "");
  const zeroSum = colourParts !== null && mixResults === null;

  const source = useMemo(() => parseColour(sourceText), [sourceText]);
  const backdrop = useMemo(() => parseColour(backdropText), [backdropText]);
  const composite = source !== null && backdrop !== null ? compositeOver(source, backdrop) : null;

  return (
    <>
      <ToolSection>
        {parts.map((part) => (
          <ColourNumberRow
            key={part.key}
            colourLabel={s.colours}
            colourValue={part.colourText}
            onColourChange={(value) => {
              updatePart(part.key, { colourText: value });
            }}
            colourError={
              part.colourText.trim() !== "" && parseColour(part.colourText) === null
                ? s.invalid
                : undefined
            }
            numberLabel={s.weight}
            numberValue={part.numberText}
            onNumberChange={(value) => {
              updatePart(part.key, { numberText: value });
            }}
            numberError={(() => {
              if (part.numberText.trim() === "") return undefined;
              const value = parseToolNumber(part.numberText);
              return value === null || value < 0 ? s.invalidWeight : undefined;
            })()}
            onRemove={
              parts.length > 2
                ? () => {
                    setParts((current) => current.filter((p) => p.key !== part.key));
                  }
                : undefined
            }
            removeLabel={s.removeColour}
          />
        ))}
        <Button
          onClick={() => {
            setParts((current) => [
              ...current,
              { key: nextMixerPartKey(), colourText: "", numberText: "1" },
            ]);
          }}
        >
          {s.addColour}
        </Button>
        {zeroSum && <ToolFailure>{s.invalidWeight}</ToolFailure>}
      </ToolSection>

      {!anyPartTyped ? (
        <p className="tool__note">{strings.pro.common.awaitingInput}</p>
      ) : (
        mixResults !== null && (
          <div className="tool__results">
            <div className="nx-eyebrow tool__results-heading">{s.result}</div>
            {mixResults.map((entry) => (
              <ResultRow
                key={entry.space}
                label={s.spaceLabel[entry.space]}
                value={<SwatchCopy colour={entry.colour} />}
              />
            ))}
          </div>
        )
      )}

      <ToolSection title={s.composite}>
        <div className="tool__pair">
          <ToolInput label={s.source} value={sourceText} onChange={setSourceText} mono />
          <ToolInput label={s.backdrop} value={backdropText} onChange={setBackdropText} mono />
        </div>
        {composite !== null && <SwatchCopy colour={composite} />}
        <p className="tool__note">{s.compositeHint}</p>
      </ToolSection>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* The map                                                                     */
/* -------------------------------------------------------------------------- */

export const DESIGN_SURFACES: Readonly<Record<string, ComponentType>> = {
  "color-convert": ColorConvertTool,
  "color-palette": ColorPaletteTool,
  gradient: GradientTool,
  "cubic-bezier": CubicBezierTool,
  contrast: ContrastTool,
  "color-mixer": ColorMixerTool,
};
