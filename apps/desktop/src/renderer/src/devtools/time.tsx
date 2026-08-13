import {
  civilFromInstant,
  dayOfYear,
  EPOCH_SOURCES,
  explainCronSr,
  formatDurationCompact,
  formatDurationSr,
  formatEpochValue,
  formatInZone,
  formatIso8601,
  formatOffset,
  formatRelativeSr,
  formatRfc2822,
  isLeapYear,
  isoWeek,
  makeInstant,
  nextFireTimes,
  parseCron,
  parseDuration,
  parseEpochValue,
  parseInstant,
  zonedFields,
  type CronScheduleOptions,
  type EpochSource,
  type Instant,
  type IsoFractionDigits,
  type ParsedInstant,
} from "@nexus/core/devtools/datetime";
import { useEffect, useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import {
  ResultRow,
  ToolFailure,
  ToolInput,
  ToolOutput,
  ToolSection,
  ToolSelect,
  ToolTable,
} from "../pro/shared.js";

/**
 * „Vreme" — the 2 surfaces of this group of the developer drawer: one INSTANT
 * spelled every way it gets spelled, and one CRONTAB read out loud and run
 * forward. All arithmetic is `@nexus/core/devtools/datetime.ts`'s — nothing
 * here parses a date, computes an offset or inflects a Serbian noun; this file
 * only shapes fields and reads the module's answers onto the page.
 *
 * **The one clock in the drawer.** Both tools need „now": the instant tool
 * shows it as a live reference and measures „pre/za" against it, the cron tool
 * walks its schedule forward from it. `useNowInstant` is the SINGLE `useEffect`
 * in this file — a `setInterval` writing one state value, cleared on unmount —
 * and both components share it rather than each rolling their own timer. It
 * never touches `text` state, so a tick cannot overwrite what someone typed.
 *
 * **Two refusals are empty strings, not errors.** `formatRfc2822` and
 * `formatDurationCompact` answer `""` for a year or a duration their grammar
 * cannot spell (see their doc comments in the core module) — a `""` that a
 * naive `ToolOutput` would render as a quietly blank box. Both call sites here
 * say so explicitly through `ToolOutput`'s `empty` slot instead.
 */

/**
 * `Date.now()` is always inside `[MIN_EPOCH_MS, MAX_EPOCH_MS]`, so the fallback
 * never actually fires — `makeInstant` still returns `Instant | null`.
 */
function instantFromNow(): Instant {
  return makeInstant(Date.now()) ?? { epochMs: 0, subNs: 0 };
}

const NOW_TICK_MS = 1000;

/** The drawer's one ticking value — see the module header. */
function useNowInstant(): Instant {
  const [now, setNow] = useState<Instant>(instantFromNow);
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(instantFromNow());
    }, NOW_TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Zero-padded to two digits — display formatting only, not calendar arithmetic. */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

const FRACTION_OPTION_IDS = ["auto", "0", "3", "6", "9"] as const;
type FractionOption = (typeof FRACTION_OPTION_IDS)[number];

function fractionDigitsOf(option: FractionOption): IsoFractionDigits {
  switch (option) {
    case "auto":
      return "auto";
    case "0":
      return 0;
    case "3":
      return 3;
    case "6":
      return 6;
    case "9":
      return 9;
  }
}

/** `"auto"` (guess from the pasted text) plus every encoding `parseEpochValue` reads directly. */
const SOURCE_OPTION_IDS = ["auto", ...EPOCH_SOURCES] as const;
type SourceOption = (typeof SOURCE_OPTION_IDS)[number];

/** `text` under the chosen source — `"auto"` defers to `parseInstant`'s own guess. */
function readInstant(text: string, source: SourceOption): ParsedInstant | null {
  if (source === "auto") return parseInstant(text);
  const instant = parseEpochValue(text, source);
  if (instant === null) return null;
  return { instant, kind: "epoch", unit: null, offsetMinutes: null };
}

function DateTimeTool() {
  // Read inside the component, never at module scope — see §4.1 of the brief.
  const s = strings.devtools.time.datetime;
  const now = useNowInstant();

  const [text, setText] = useState("");
  const [source, setSource] = useState<SourceOption>("auto");
  const [fraction, setFraction] = useState<FractionOption>("auto");
  const [zone, setZone] = useState("");
  const [durationText, setDurationText] = useState("");

  const sourceLabels: Record<EpochSource, string> = {
    seconds: s.sourceSeconds,
    milliseconds: s.sourceMilliseconds,
    microseconds: s.sourceMicroseconds,
    nanoseconds: s.sourceNanoseconds,
    filetime: s.sourceFiletime,
    ticks: s.sourceTicks,
  };
  const sourceOptions = SOURCE_OPTION_IDS.map((id) => ({
    id,
    label: id === "auto" ? s.sourceAuto : sourceLabels[id],
  }));
  const fractionOptions = FRACTION_OPTION_IDS.map((id) => ({
    id,
    label:
      id === "auto"
        ? s.fractionAuto
        : id === "0"
          ? s.fraction0
          : id === "3"
            ? s.fraction3
            : id === "6"
              ? s.fraction6
              : s.fraction9,
  }));

  const trimmed = text.trim();
  const typed = trimmed !== "";
  const parsed: ParsedInstant | null = typed ? readInstant(trimmed, source) : null;
  const instant = parsed?.instant ?? null;

  const detected: string | null =
    source !== "auto" || parsed === null
      ? null
      : parsed.kind === "iso8601"
        ? s.iso
        : parsed.kind === "rfc2822"
          ? s.rfc
          : parsed.unit === null
            ? null
            : sourceLabels[parsed.unit];

  const trimmedZone = zone.trim();
  const zoneFields =
    instant === null || trimmedZone === "" ? null : zonedFields(instant, trimmedZone);
  const civil = instant === null ? null : (zoneFields ?? civilFromInstant(instant, 0));
  const week = civil === null ? null : isoWeek(civil.year, civil.month, civil.day);

  const durationTrimmed = durationText.trim();
  const durationMs = durationTrimmed === "" ? null : parseDuration(durationTrimmed);

  return (
    <>
      <ResultRow label={s.now} value={formatIso8601(now, { offsetMinutes: 0 })} />

      <div className="tool__pair">
        <ToolInput label={s.input} hint={s.inputHint} value={text} onChange={setText} mono />
        <ToolSelect label={s.source} value={source} options={sourceOptions} onChange={setSource} />
      </div>

      {!typed ? null : instant === null || civil === null || week === null ? (
        <ToolFailure>{s.invalid}</ToolFailure>
      ) : (
        <>
          {detected !== null && <ResultRow label={s.detected} value={detected} mono={false} />}

          <ToolSection>
            <ToolSelect
              label={s.fraction}
              value={fraction}
              options={fractionOptions}
              onChange={setFraction}
            />
            <ToolOutput
              label={s.iso}
              value={formatIso8601(instant, {
                offsetMinutes: 0,
                fractionDigits: fractionDigitsOf(fraction),
              })}
            />
            <ToolOutput label={s.rfc} value={formatRfc2822(instant, 0)} empty={s.rfcOutOfRange} />
          </ToolSection>

          <ToolTable
            head={[s.form, s.value]}
            rows={EPOCH_SOURCES.map((unit) => [
              sourceLabels[unit],
              formatEpochValue(instant, unit),
            ])}
          />

          <ToolSection title={s.about}>
            <ResultRow
              label={s.civilDate}
              value={`${pad2(civil.day)}.${pad2(civil.month)}.${civil.year}.`}
              mono={false}
            />
            <ResultRow
              label={s.weekday}
              value={s.weekdayNames[week.weekday - 1] ?? ""}
              mono={false}
            />
            <ResultRow label={s.isoWeek} value={`${week.year}-W${pad2(week.week)}`} />
            <ResultRow
              label={s.dayOfYear}
              value={`${dayOfYear(civil.year, civil.month, civil.day)}. ${s.of} ${
                isLeapYear(civil.year) ? 366 : 365
              }`}
              mono={false}
            />
            <ResultRow
              label={s.leapYear}
              value={isLeapYear(civil.year) ? s.yes : s.no}
              mono={false}
            />
            <ResultRow label={s.relative} value={formatRelativeSr(instant, now)} mono={false} />
          </ToolSection>

          <ToolSection title={s.zone}>
            <ToolInput
              label={s.zone}
              value={zone}
              onChange={setZone}
              placeholder={s.zonePlaceholder}
              mono
            />
            {trimmedZone === "" ? null : zoneFields === null ? (
              <ToolFailure>{s.invalidZone}</ToolFailure>
            ) : (
              <>
                <ToolOutput
                  label={s.inZone}
                  value={
                    formatInZone(instant, trimmedZone, {
                      fractionDigits: fractionDigitsOf(fraction),
                    }) ?? ""
                  }
                />
                <ResultRow label={s.offset} value={formatOffset(zoneFields.offsetMinutes)} />
              </>
            )}
          </ToolSection>
        </>
      )}

      <ToolSection title={s.duration}>
        <ToolInput
          label={s.duration}
          hint={s.durationHint}
          value={durationText}
          onChange={setDurationText}
          mono
        />
        {durationTrimmed === "" ? null : durationMs === null ? (
          <ToolFailure>{s.invalidDuration}</ToolFailure>
        ) : (
          <>
            <ToolOutput
              label={s.durationCompact}
              value={formatDurationCompact(durationMs)}
              empty={s.durationUnrepresentable}
            />
            <ToolOutput
              label={s.durationWords}
              value={formatDurationSr(durationMs)}
              empty={s.durationUnrepresentable}
            />
          </>
        )}
      </ToolSection>
    </>
  );
}

const FIRE_COUNT_IDS = ["5", "10", "20", "50"] as const;
type FireCount = (typeof FIRE_COUNT_IDS)[number];
const FIRE_COUNT_OPTIONS = FIRE_COUNT_IDS.map((id) => ({ id, label: id }));

function CronTool() {
  // Read inside the component, never at module scope — see §4.1 of the brief.
  const s = strings.devtools.time.cron;
  const after = useNowInstant();

  const [text, setText] = useState("");
  const [count, setCount] = useState<FireCount>("10");
  const [zone, setZone] = useState("");

  const trimmed = text.trim();
  const typed = trimmed !== "";
  const result = typed ? parseCron(trimmed) : null;

  const trimmedZone = zone.trim();
  const scheduleOptions: CronScheduleOptions = trimmedZone === "" ? {} : { timeZone: trimmedZone };
  const fires =
    result !== null && result.ok
      ? nextFireTimes(result.spec, after, Number(count), scheduleOptions)
      : null;
  const displayZone = trimmedZone === "" ? "UTC" : trimmedZone;

  return (
    <>
      <ToolInput label={s.input} hint={s.inputHint} value={text} onChange={setText} mono />

      {!typed ? (
        <ToolOutput label={s.meaning} value="" empty={strings.pro.common.awaitingInput} />
      ) : result === null ? null : !result.ok ? (
        <>
          <ToolFailure>{result.error.message}</ToolFailure>
          <ResultRow label={s.offendingToken} value={result.error.token} />
        </>
      ) : (
        <>
          <ToolOutput label={s.meaning} value={explainCronSr(result.spec)} multiline />
          {result.spec.macro !== null && (
            <ResultRow label={s.macro} value={result.spec.macro} />
          )}
          <ResultRow
            label={s.fields}
            value={result.spec.fieldCount === 6 ? s.fields6 : s.fields5}
            mono={false}
          />
          <p className="tool__note">{s.unionNote}</p>

          <ToolSection title={s.next}>
            <div className="tool__pair">
              <ToolSelect
                label={s.count}
                value={count}
                options={FIRE_COUNT_OPTIONS}
                onChange={setCount}
              />
              <ToolInput
                label={s.zone}
                hint={s.zoneHint}
                value={zone}
                onChange={setZone}
                placeholder={s.zonePlaceholder}
                mono
              />
            </div>
            {fires === null ? (
              <ToolFailure>{s.invalidZone}</ToolFailure>
            ) : fires.length === 0 ? (
              <p className="tool__note">{s.never}</p>
            ) : (
              <>
                <ToolTable
                  head={[s.next]}
                  rows={fires.map((instant) => [
                    formatInZone(instant, displayZone) ?? "",
                  ])}
                />
                {fires.length < Number(count) && <p className="tool__note">{s.fewer}</p>}
              </>
            )}
          </ToolSection>
        </>
      )}
    </>
  );
}

/**
 * Every id below is declared in `DEVTOOLS_TOOLS` (`shared/modules.ts`) and
 * `modules.test.ts` pins the two lists against each other in both directions —
 * a surface with no declaration is unreachable, and a declaration with no
 * surface is a row the drawer would offer and then fail to open.
 */
export const TIME_SURFACES: Readonly<Record<string, ComponentType>> = {
  datetime: DateTimeTool,
  cron: CronTool,
};
