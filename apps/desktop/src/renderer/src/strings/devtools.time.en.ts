/**
 * Time - the English copy of this category's tool surfaces.
 *
 * One entry per tool id, keyed exactly as the registration in
 * `shared/modules.ts` spells it. The tool's NAME and its one-line blurb are
 * not here: those live in the `name` and `blurb` tables of
 * `./devtools.en.ts`, because the drawer's rail needs them before any surface
 * is opened.
 *
 * Neither tool's GENERATED sentences live here. `@nexus/core/devtools/datetime`
 * builds them, in both languages: `formatRelativeEn`/`explainCronEn` beside
 * the Serbian originals, and `formatRelative`/`explainCron` pick by the
 * caller's locale, with the plural arithmetic each language needs. This table
 * holds only what a flat table CAN hold: field labels, option names and fixed
 * refusal headings.
 */
export const DEVTOOLS_TIME_EN = {
  datetime: {
    input: "Value",
    inputHint:
      "A Unix number (seconds, milliseconds, microseconds or nanoseconds), ISO 8601 or RFC 2822.",
    source: "Source",
    sourceAuto: "Detect automatically",
    sourceSeconds: "Unix seconds",
    sourceMilliseconds: "Unix milliseconds",
    sourceMicroseconds: "Unix microseconds",
    sourceNanoseconds: "Unix nanoseconds",
    sourceFiletime: "Windows FILETIME",
    sourceTicks: ".NET ticks",
    detected: "Detected as",
    now: "Now (UTC)",
    iso: "ISO 8601",
    fraction: "Fractional seconds",
    fractionAuto: "As needed",
    fraction0: "No decimals",
    fraction3: "Milliseconds (3)",
    fraction6: "Microseconds (6)",
    fraction9: "Nanoseconds (9)",
    rfc: "RFC 2822",
    rfcOutOfRange: "RFC 2822 cannot express years outside 0000–9999.",
    form: "Form",
    value: "Value",
    about: "About the instant",
    civilDate: "Date",
    weekday: "Day of week",
    isoWeek: "ISO week",
    dayOfYear: "Day of year",
    of: "of",
    leapYear: "Leap year",
    yes: "yes",
    no: "no",
    relative: "Relative",
    zone: "Time zone",
    zonePlaceholder: "Europe/Belgrade",
    inZone: "In zone",
    offset: "Offset",
    invalidZone: "Unknown time zone.",
    invalid: "Instant not recognised.",
    duration: "Duration",
    durationHint: "1h30m, 90m, 5400s, 1.5h",
    durationCompact: "Compact",
    durationWords: "Words",
    invalidDuration: "Duration not recognised.",
    durationUnrepresentable: "This duration cannot be written in this form.",
    weekdayNames: [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ],
  },
  cron: {
    input: "Cron expression",
    inputHint: "min hour day month day-of-week, six fields with seconds first, or @macro.",
    meaning: "Means",
    macro: "Macro",
    fields: "Fields",
    fields5: "5 (classic crontab)",
    fields6: "6 (with seconds)",
    offendingToken: "Offending token",
    next: "Next runs",
    count: "How many",
    zone: "Time zone",
    zoneHint: "A cron without a zone runs in UTC.",
    zonePlaceholder: "UTC",
    invalidZone: "Unknown time zone.",
    never: "This expression never fires.",
    fewer: "Fewer runs than requested — the expression fires rarely.",
    unionNote:
      "When both day-of-month and day-of-week are given as numbers, the day matches if either one matches; as soon as one of them is a wildcard, both must match.",
  },
} as const;
