# PRD 29 — Utilities (UTIL)

**Status:** draft 2026-07-05. Inputs: raw-spec §20 + utility razmišljanja
(subtitle editor, predmer i predračun → PRO), SEC-FILE (converters parse
hostile files), FUN/boosters (timer engine shared).

## 1. Purpose

The toolbelt: dozens of small, excellent, offline tools under one roof —
calculators, converters, timers, dev tools, subtitle editor. Each tool is
individually trivial; the value is having them consistent, instant, and
integrated (timer → STUDY stats; converters → DOC pipeline). Tools are
feature-flagged individually within the module (clutter control).

## 2. User stories

- As a user, I want a calculator/converter two keystrokes away (SRCH
  command mode), so that I stop opening browser tabs.
- As a student, I want Pomodoro/timers wired into my study stats, so that
  focus time counts.
- As a developer, I want base64/JSON/regex/UUID/hash tools offline, so that
  I never paste secrets into random websites (privacy pitch!).
- As a viewer, I want to fix subtitle timings, so that mismatched .srt files
  stop being painful.

## 3. User experience & flows

Utilities home: tool grid (cards view, searchable, favorites pinned; each
tool toggleable in SET). Every tool opens instantly (lazy-loaded), works
offline, and follows one layout pattern: input(s) top, result live, copy
button, history where sensible (local, clearable). All tools are launchable
from SRCH command mode ("uuid", "base64 …", "45 usd u rsd").

## 4. Functional requirements

### Core & time
- **UTIL-001 (M)** Calculator: standard + scientific mode, expression
  history, keyboard-first.
- **UTIL-002 (M)** Timer engine (shared service): countdown timers
  (multiple, named), stopwatch (laps), **Pomodoro** (work/break cycles,
  configurable, subject binding via STUDY-013, boosters hook via FUN);
  local notifications (NTF).
- **UTIL-003 (M)** Unit converter: length/mass/volume/area/temperature/
  speed/energy/pressure/data/time; searchable units; precision control.
- **UTIL-004 (M)** Currency converter: uses FIN-004 rate source with
  visible rate + age; offline uses last-known.

### Converters (files)
- **UTIL-005 (M)** Image converter: PNG/JPEG/WebP/AVIF + resize/quality;
  batch; all local, sandboxed (SEC-FILE-01/04 caps).
- **UTIL-006 (S)** Audio converter: common formats via bundled encoder
  where licensing is clean (architecture ADR: codec licensing — MP3 now
  patent-free, AAC caution); batch.
- **UTIL-007 (S)** Video converter: container remux + common transcodes,
  explicitly labeled slow/CPU-heavy; architecture decides bundled encoder
  (ffmpeg-class, license-checked build).
- **UTIL-008 (S)** Document conversions: markdown ↔ HTML, images → PDF,
  merge/split PDF; text encoding converter (UTF-8/windows-1250/1251 —
  Serbian reality for old files).

### Subtitles
- **UTIL-009 (S)** Subtitle editor: load SRT/VTT (+ common encodings),
  global offset shift, linear stretch (two-point sync), per-line edit,
  format/encoding conversion, preview against a video file (DOC player),
  save-as (SEC-FILE-07: parser fuzz-tested).

### Dev tools
- **UTIL-010 (S)** Base64 encode/decode (text + file); URL encode/decode;
  UUID v4/v7 generator (bulk); hash generator (SHA-256/512, BLAKE2, MD5
  labeled "not for security"); JSON formatter/validator (tree view);
  regex tester (highlighting, groups, common flavors note); timestamp/epoch
  converter; color picker/converter (hex/rgb/hsl); lorem generator.
  All fully offline (the privacy pitch is explicit in UI copy).

### Framework
- **UTIL-011 (M)** Tool registry: each tool declares name (sr/en), category,
  SRCH commands, flag; PRO packs register specialized calculators through
  the same registry (predmer/predračun etc. live in PRO, not UTIL).
- **UTIL-012 (C)** Inline "smart bar" parsing in SRCH: "38c u f",
  "1.5h u min" answered directly in palette.

## 5. Options & settings

Per-tool enable; favorites; Pomodoro defaults (owned here, STUDY inherits);
converter output folder (desktop).

## 6. Integrations

STUDY (Pomodoro binding + stats); FUN (break boosters); NTF (timer alarms);
FIN (rate source shared); DOC (media preview in subtitle editor; converted
outputs offered to library); SRCH (command mode, UTIL-012); PRO (registry).

## 7. Edge cases & error states

- Converter fed a corrupt/hostile file → sandbox contains it; honest error
  (DOC pipeline rules apply).
- Batch conversion partial failure → per-file report, successes kept.
- Subtitle with mixed/broken encoding → detection + manual encoding picker
  with live preview of glyphs (đčćšž test line).
- Two timers + Pomodoro simultaneously → all run; notification storm guard
  (NTF-batching).
- Very large regex input / catastrophic backtracking → execution timeout
  with explanation.
- Currency conversion with stale offline rate → age badge, no false
  confidence.

## 8. Acceptance criteria (key)

- Every tool opens < 200 ms after first use (lazy bundle cached) and works
  in airplane mode (currency shows stale-rate badge).
- "uuid" in SRCH yields a copyable UUID without opening the tool page.
- Subtitle two-point stretch syncs a drifting .srt against video preview;
  saved file plays correctly in VLC (sr chars intact, chosen encoding).
- Pomodoro session bound to "Algebra" appears in STUDY stats; break offers
  a booster if FUN enabled.
- JSON formatter handles a 10 MB file without freezing the UI (worker).
- MD5 output row carries the "not for security" label (SEC golden rules
  visibility).

## 9. Open questions

1. Bundled media encoders licensing (ffmpeg build flavor) — architecture
   ADR (affects UTIL-006/007 scope).
2. v1 tool cut: everything (M)+(S) above vs trimming converters to
   image+documents first — roadmap decision by effort.
3. Smart-bar (UTIL-012) v1? Cheap wins culture says yes if palette parser
   is trivial.

## 10. Future extensions

OCR tool; QR generator/reader; diff tool; cron builder; API tester (dev
pack); plugin-provided tools (PLUG) — registry-ready.
