import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { ageAtOccurrence, birthdayOccurrencesInRange, shiftDayKey } from "@nexus/core";
import { Button, Chip, EmptyState, ListRow, LoadingState, TextField } from "@nexus/ui";
import type { NewPersonFields, Person, PersonFieldChanges, PersonKind } from "../../shared/ipc.js";
import { localTodayKey } from "./examDates.js";
import { strings } from "./strings.js";

// --- Field orderings (renderer mirror of @nexus/db) -------------------------
//
// The renderer never imports DB/Node code (SEC-EL-02: the wire contract stays
// self-contained), so the kind order is redeclared here, matching PERSON_KINDS
// in @nexus/db. The Serbian labels live in strings.ts, applied at render time.
const PERSON_KINDS: readonly PersonKind[] = ["birthday", "anniversary"];

/** The year window `PeopleStore` accepts; mirrored here only as input affordances (min/max), never as the check. */
const MIN_PERSON_YEAR = 1900;
const MAX_PERSON_YEAR = 2100;

/**
 * A leap year, used only to answer "is this (month, day) a real day in SOME
 * year?" — the exact question, against the exact year, `PeopleStore` asks, so
 * 29 February passes here too. Mirrored rather than imported because this side
 * of the wire never loads DB code.
 */
const LEAP_PROBE_YEAR = 2024;

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

/** Serbian Latin collation — plain `localeCompare` misorders š/č/ć (see the views engine). */
const collator = new Intl.Collator(["sr-Latn", "sr"]);

const monthNameFormatter = new Intl.DateTimeFormat("sr-Latn", { month: "long", timeZone: "UTC" });

/**
 * The twelve Serbian month names, derived from the same `Intl` source
 * CalendarPage's own nav labels read rather than retyped into strings.ts — one
 * wording for the whole module, and nothing to keep in sync. Serbian month
 * names are already lower-case and nominative in both formatting contexts, so
 * the select and the row labels can share them.
 */
const MONTH_NAMES: readonly string[] = MONTHS.map((month) =>
  monthNameFormatter.format(new Date(Date.UTC(LEAP_PROBE_YEAR, month - 1, 1))),
);

/** A month's Serbian name; degrades to its number on an out-of-range month (unreachable — the store bounds it). */
function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month);
}

/** Membership against the closed list, narrowing the kind `<select>`'s raw string without an assertion (the house `asPriority` idiom). */
function asPersonKind(value: string): PersonKind {
  for (const kind of PERSON_KINDS) if (kind === value) return kind;
  return "birthday";
}

/** The yearless recurring date as "29. februar". */
function formatRecurringDate(person: Person): string {
  return `${person.day}. ${monthName(person.month)}`;
}

/**
 * The client-side twin of `PeopleStore`'s pair check: `(2, 30)` and `(4, 31)`
 * each satisfy both per-column ranges and are still no calendar day. Validated
 * against a leap year so 29 February passes — leap-day birthdays exist, and the
 * calendar celebrates them on the 28th in the years that lack a 29th.
 */
function isRealMonthDay(month: number, day: number): boolean {
  const probe = new Date(Date.UTC(LEAP_PROBE_YEAR, month - 1, day));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * How old this person is today — read off their MOST RECENT celebration, which
 * is the one that has actually happened. `thisYear - birthYear` alone is a year
 * too many for anyone whose date has not come round yet (born in December, ask
 * in July), and the coming celebration answers a different question: the age
 * they will TURN, which is what a calendar bar shows on that day.
 *
 * A 366-day window back always contains that occurrence: everyone recurs
 * annually, and a 29 February person is clamped to the 28th rather than
 * skipped, so there is never a year without one. Null when the year is unknown
 * — and also for a person whose only occurrence in the window predates the
 * year they were born, which `ageAtOccurrence` refuses rather than render as a
 * negative age.
 */
function currentAge(person: Person, todayKey: string): number | null {
  if (person.year === null) return null;
  const past = birthdayOccurrencesInRange(person, {
    from: shiftDayKey(todayKey, -366),
    // Inclusive, so on the day itself the age shown is the one just turned.
    to: todayKey,
  });
  const latest = past[past.length - 1];
  return latest === undefined ? null : ageAtOccurrence(person, latest);
}

export interface PeoplePanelProps {
  profileId: string;
}

/**
 * The CAL Ljudi panel (CAL-007, ADR-026): a single form that both adds and
 * edits people, and a list ordered by name with the Serbian collator. A person
 * is a name plus a yearless (month, day) that recurs forever — which is why the
 * form has no date input at all, but a day and a month select: there is no year
 * to pick. Every write goes through the people:* IPC allowlist, so the store
 * stays the single source of truth (it owns the (month, day) pair check, the
 * year window, and the timestamps).
 *
 * The rows this panel edits are the same rows the calendar grids draw as
 * birthday bars — clicking one of those bars is what brings the user here.
 */
export function PeoplePanel({ profileId }: PeoplePanelProps) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);

  // One form serves both modes; a non-null editingId means "editing that person".
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PersonKind>("birthday");
  const [day, setDay] = useState(1);
  const [month, setMonth] = useState(1);
  const [year, setYear] = useState("");
  const [note, setNote] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await window.nexus.listPeople(profileId);
        if (active) setPeople(list);
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load people:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  function resetForm(): void {
    setEditingId(null);
    setName("");
    setKind("birthday");
    setDay(1);
    setMonth(1);
    setYear("");
    setNote("");
    setSaveFailed(false);
  }

  /** Loads a person into the shared form and switches it to edit mode. */
  function startEdit(person: Person): void {
    setEditingId(person.id);
    setName(person.name);
    setKind(person.kind);
    setDay(person.day);
    setMonth(person.month);
    setYear(person.year === null ? "" : String(person.year));
    setNote(person.note ?? "");
    setSaveFailed(false);
    nameRef.current?.focus();
  }

  async function reload(): Promise<void> {
    setPeople(await window.nexus.listPeople(profileId));
  }

  async function submitForm(formEvent: FormEvent<HTMLFormElement>): Promise<void> {
    formEvent.preventDefault();
    const trimmedName = name.trim();
    // The store refuses an unreal pair; the submit button is already disabled
    // for one, so this is the belt to that guard's braces.
    if (trimmedName.length === 0 || !isRealMonthDay(month, day)) return;

    const trimmedYear = year.trim();
    // An empty year field is "unknown", never the number zero.
    const parsedYear = trimmedYear.length > 0 ? Number(trimmedYear) : null;
    const trimmedNote = note.trim();
    setSaveFailed(false);

    try {
      if (editingId != null) {
        // An emptied year/note field clears the stored value; a filled one sets it.
        const changes: PersonFieldChanges = {
          name: trimmedName,
          kind,
          month,
          day,
          year: parsedYear,
          note: trimmedNote.length > 0 ? trimmedNote : null,
        };
        const updated = await window.nexus.updatePerson(profileId, editingId, changes);
        setPeople((prev) => prev && prev.map((p) => (p.id === updated.id ? updated : p)));
        resetForm();
      } else {
        const fields: NewPersonFields = { name: trimmedName, kind, month, day };
        // Only send what was filled in (exactOptionalPropertyTypes).
        if (parsedYear !== null) fields.year = parsedYear;
        if (trimmedNote.length > 0) fields.note = trimmedNote;
        const created = await window.nexus.createPerson(profileId, fields);
        setPeople((prev) => (prev ? [...prev, created] : [created]));
        resetForm();
        nameRef.current?.focus();
      }
    } catch (error) {
      setSaveFailed(true);
      console.error("Nexus: failed to save a person:", error);
    }
  }

  async function remove(person: Person): Promise<void> {
    try {
      await window.nexus.deletePerson(profileId, person.id);
      setPeople((prev) => prev && prev.filter((current) => current.id !== person.id));
      // Never leave the form bound to a person who no longer exists.
      if (editingId === person.id) resetForm();
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndoId(person.id);
    } catch (error) {
      console.error("Nexus: failed to delete a person:", error);
    }
  }

  async function undo(): Promise<void> {
    if (!pendingUndoId) return;
    try {
      await window.nexus.restorePerson(profileId, pendingUndoId);
      setPendingUndoId(null);
      // Re-fetch so the restored person lands back in name order.
      await reload();
    } catch (error) {
      console.error("Nexus: failed to restore a person:", error);
    }
  }

  const s = strings.calendar.people;
  const todayKey = localTodayKey();
  // The store returns people by SQLite's binary collation, which mis-tailors
  // Serbian Latin, and create appends optimistically — so the display order is
  // re-derived here with the house collator.
  const ordered =
    people && [...people].sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));

  // One error line, two causes: an impossible date (live, as the selects move)
  // or a write the store refused.
  const dateIsReal = isRealMonthDay(month, day);
  const errorLine = !dateIsReal ? s.invalidDate : saveFailed ? s.saveError : null;

  return (
    <div className="people">
      <form className="people__form" onSubmit={submitForm}>
        <input
          ref={nameRef}
          className="nx-textfield__input people__name-input"
          value={name}
          placeholder={s.namePlaceholder}
          aria-label={s.nameLabel}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
        />
        <select
          className="people__select"
          value={kind}
          aria-label={s.kindLabel}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            setKind(asPersonKind(event.target.value))
          }
        >
          {PERSON_KINDS.map((value) => (
            <option key={value} value={value}>
              {s.kind[value]}
            </option>
          ))}
        </select>
        <select
          className="people__select"
          value={day}
          aria-label={s.dayLabel}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => setDay(Number(event.target.value))}
        >
          {DAYS.map((value) => (
            <option key={value} value={value}>
              {value}.
            </option>
          ))}
        </select>
        <select
          className="people__select"
          value={month}
          aria-label={s.monthLabel}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => setMonth(Number(event.target.value))}
        >
          {MONTHS.map((value) => (
            <option key={value} value={value}>
              {monthName(value)}
            </option>
          ))}
        </select>
        <TextField
          type="number"
          className="people__year"
          value={year}
          min={MIN_PERSON_YEAR}
          max={MAX_PERSON_YEAR}
          step={1}
          placeholder={s.yearLabel}
          aria-label={s.yearLabel}
          onChange={(event) => setYear(event.target.value)}
        />
        <TextField
          type="text"
          value={note}
          placeholder={s.notePlaceholder}
          aria-label={s.noteLabel}
          onChange={(event) => setNote(event.target.value)}
        />
        <Button type="submit" variant="primary" disabled={!dateIsReal}>
          {editingId != null ? s.save : s.add}
        </Button>
        {editingId != null && (
          <Button type="button" className="people__cancel" onClick={resetForm}>
            {s.cancel}
          </Button>
        )}
        {errorLine != null && (
          <p className="people__error" role="alert">
            {errorLine}
          </p>
        )}
      </form>

      {pendingUndoId != null && (
        <div className="people__undo" role="status">
          <span className="people__undo-text">{s.deletedNotice}</span>
          <Button size="sm" className="people__undo-action" onClick={() => void undo()}>
            {s.undo}
          </Button>
          <Button
            size="sm"
            className="people__undo-dismiss"
            aria-label={s.dismiss}
            onClick={() => setPendingUndoId(null)}
          >
            ×
          </Button>
        </div>
      )}

      {failed ? (
        <EmptyState title={s.emptyTitle} description={s.loadError} />
      ) : ordered === null ? (
        <LoadingState label={strings.app.loading} rows={3} />
      ) : ordered.length === 0 ? (
        <EmptyState title={s.emptyTitle} description={s.emptyDescription} />
      ) : (
        <div className="people__list">
          {ordered.map((person) => {
            const age = currentAge(person, todayKey);
            return (
              <ListRow
                key={person.id}
                leading={<Chip>{s.kind[person.kind]}</Chip>}
                trailing={
                  <span className="people__row-actions">
                    <Button
                      size="sm"
                      className="people__edit"
                      aria-label={s.editLabel}
                      onClick={() => startEdit(person)}
                    >
                      ✎
                    </Button>
                    <Button
                      size="sm"
                      className="people__delete"
                      aria-label={s.deleteLabel}
                      onClick={() => void remove(person)}
                    >
                      ×
                    </Button>
                  </span>
                }
              >
                <span className="people__item">
                  <span className="people__heading">
                    <span className="people__name">{person.name}</span>
                    <span className="people__date">{formatRecurringDate(person)}</span>
                  </span>
                  {(person.year !== null || person.note != null) && (
                    <span className="people__meta">
                      {person.year !== null && (
                        <span className="people__years">
                          {person.year}
                          {age !== null && ` · ${age} ${s.yearsUnit}`}
                        </span>
                      )}
                      {person.note != null && <span className="people__note">{person.note}</span>}
                    </span>
                  )}
                </span>
              </ListRow>
            );
          })}
        </div>
      )}
    </div>
  );
}
