# ADR-027 — Natural-language dates in task quick-add

**Status:** accepted · 2026-07-30
**Drives:** TASK-007 (M): "Natural-language date parsing in quick-add shall
work in Serbian and English, with a visible interpreted-date chip the user can
correct before saving."
**Supersedes nothing.**

## Context

Quick-add is the fast path ("type + Enter"); a due date today needs a second
field. Tasks carry **bare dates** only, so this is date parsing, not
time parsing — "u 17h" is out of scope by data model, which conveniently
removes PRD 03 §7's "u 5" ambiguity class.

## Decision

### 1. A pure, bounded parser in `packages/core`

`parseQuickAddDate(input, today)` scans the draft for the **last** date
phrase (people append their date), returning the phrase's span, the resolved
bare date, and the title with the phrase stripped. No `Date.now()`, no
locale data beyond its own tables; TDD.

The v1 phrase set is closed and documented — a bounded grammar beats a clever
one that guesses wrong silently:

- **Serbian (latinica, case-insensitive):** `danas`, `sutra`, `prekosutra`;
  `u <weekday-acc>` (ponedeljak/utorak/sredu/četvrtak/petak/subotu/nedelju);
  `sledeći/sledeceg <weekday>`; `za N dana` / `za nedelju dana`;
  `D.M` / `D.M.` / `D.M.YYYY`; `D. <month-gen>` (avgusta, septembra…).
- **English:** `today`, `tomorrow`; `on <weekday>` / bare `<weekday>`;
  `next <weekday>`; `in N days`; `<month> D` / `D <month>` (aug/august…).

Semantics, fixed:

- Plain weekday = the next occurrence **including today** (Todoist's rule).
- `sledeći X` / `next X` = the plain resolution **plus 7 days**.
- `D.M` with no year: this year, unless the date already passed — then next
  year. An unreal day (30.2) is **no match**, never a guessed date.
- Diacritic-insensitive matching (`sreda`/`среда` is out — latinica only, but
  `sledeci` without the diacritic matches).

### 2. The chip corrects, never blocks

While the draft contains a parsed phrase, the quick-add shows an interpreted
chip ("→ pet, 15. avg." + ×). On save the phrase is stripped from the title
and the date applied. The user corrects it two ways: **dismissing the chip**
(the phrase then stays in the title verbatim and no date is set — dismissal
is remembered for that exact phrase until the draft's phrase changes), or
**setting the form's own date field**, which always wins over the chip.
Saving is never blocked (PRD 03 §7).

## Consequences

- The parser is reusable as-is for CAL's quick event entry later.
- Extending the grammar is additive table work with tests, not redesign.
- The stripped-title behaviour means "platiti struju sutra" produces the task
  "platiti struju" due tomorrow — the phrase was an instruction, not content;
  the dismissal path preserves the rare opposite intent.
