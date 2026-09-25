# ADR-054 — Fixed semester dates (CAL-010 follow-up; migration 042, interchange 1.20.0)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Implements:** the
founder's answer to batch question 10: the Semestar view anchors to **fixed
semester dates**, not a sliding four-month window.

## 1. Storage: profile data, not a device preference

Semester dates are facts about the *profile's life*, not about a device: the
upcoming study planner (STUDY-003/4/5) will need term boundaries, and a web
client must see the same term. So: **migration 042** creates
`calendar_settings` — the `dashboard_settings` singleton pattern verbatim:

```sql
CREATE TABLE calendar_settings (
  profile_id    TEXT PRIMARY KEY REFERENCES profiles(id),
  semester_start TEXT NULL CHECK (semester_start IS NULL OR semester_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  semester_end   TEXT NULL CHECK (semester_end   IS NULL OR semester_end   GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (semester_start IS NULL OR semester_end IS NULL OR semester_start <= semester_end)
)
```

Get-or-default read (both null = unset), one upsert write, both-or-neither
enforced at the store (a start without an end is not a term — the DB CHECK
permits the halves only so the store can stage them in one statement; the
store's own validation requires the pair). Bare day keys, no instants, no
zones — the calendar's native vocabulary.

**Interchange 1.20.0**: new 0..1 required-array member `calendarSettings` on
`ProfileData` (the `dashboardSettings` precedent — uniform member, pre-1.20
absence defaults to unset via the era rule, era flag per ADR-028 §7). Restore
replaces it; **foreign import does NOT import it** (a term is the target
profile's own fact — same posture as study settings, named skip line). Too-new
refusal fixtures move to **1.21.0**.

## 2. The view

- **Set**: the Semestar tab renders the configured term — every month from
  `semester_start`'s month through `semester_end`'s month, capped at **6
  mini-months** (a longer span renders the first six and says so in the
  caption; a term longer than six months is not a semester, and silently
  scrolling would break the "one screen, one term" promise). Out-of-term days
  inside the boundary months draw at reduced opacity — the term has edges and
  the eye should see them. Month navigation (←/→) is DISABLED in Semestar while
  a term is set: the whole point of a fixed term is that it does not slide.
- **Unset**: exactly today's behaviour (anchored month + next three, sliding) —
  the honest fallback, plus one quiet caption line linking to the setting
  („Podesi datume semestra u Podešavanjima."). Nothing breaks for a profile
  that never sets a term.
- `semesterGrid.ts` grows pure `termMonthKeys(start, end)` /
  `isWithinTerm(dayKey)` helpers; the density maths is untouched.

## 3. Settings UI + wire

Settings gains a **„Kalendar" card** (it does not exist yet; device preferences
like weekStart/clock stay where they are — this card is for PROFILE calendar
facts): two date inputs (Početak/Kraj semestra), save writes the pair, „Ukloni
datume" clears both (back to sliding). Wire: `calendar:get-settings` /
`calendar:set-settings` with per-field validators (`assertTrustedSender` +
`asRecord` + bare-day validation + pair rule re-checked in main). The card
registers in `settingsSearch` („semestar", „kalendar" keywords).

## 4. Consequences

- Exams/planner gain a term boundary they can later read from the same store —
  this table is deliberately named `calendar_settings`, not
  `semester_settings`, so future calendar-profile facts (e.g. a second
  semester, holidays) have a home without another migration pattern.
- One recorded simplification: ONE term at a time. Storing the next semester
  early means overwriting the current one; the founder can ask for a term list
  later and the table grows a row-per-term shape in its own ADR.
- `gatherProfileSettings`/undo snapshot must include the row (restore/undo
  parity — the ADR-041 dashboard_settings checklist applies verbatim).
