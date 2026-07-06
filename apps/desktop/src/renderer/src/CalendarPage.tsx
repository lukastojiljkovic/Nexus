import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Button, Checkbox, Chip, EmptyState, ListRow, TextField } from "@nexus/ui";
import type { Event, EventFieldChanges, NewEventFields } from "../../shared/ipc.js";
import { strings } from "./strings.js";

// --- Agenda grouping (page-level, not the views engine) ---------------------
//
// The store returns events ordered by startAt then id, but the create path
// appends optimistically, so the display order is re-derived here rather than
// trusted from insertion order. The rule matches the store's exactly — an
// all-day event's bare "YYYY-MM-DD" sorts before any timed start on that day.

/** Events bucketed by calendar day, days and rows both ascending by startAt/id. */
function groupByDay(events: Event[]): [string, Event[]][] {
  const ordered = [...events].sort(
    (a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id),
  );
  const groups = new Map<string, Event[]>();
  for (const event of ordered) {
    const key = event.startAt.slice(0, 10);
    const bucket = groups.get(key);
    if (bucket) bucket.push(event);
    else groups.set(key, [event]);
  }
  return [...groups];
}

/**
 * Day-section header in Serbian (e.g. "sreda, 8. jul"); raw key on bad input.
 * The key is a bare calendar day, so it is both parsed and formatted in UTC —
 * otherwise `new Date("YYYY-MM-DD")` (UTC midnight) would shift a day back when
 * formatted in a negative-offset timezone.
 */
function formatDay(key: string): string {
  const date = new Date(key);
  return Number.isNaN(date.getTime())
    ? key
    : new Intl.DateTimeFormat("sr-Latn", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }).format(date);
}

/** Row time label — "Ceo dan" for all-day, else HH:MM; raw start on bad input. */
function formatTime(event: Event): string {
  if (event.allDay) return strings.calendar.allDay;
  const date = new Date(event.startAt);
  return Number.isNaN(date.getTime())
    ? event.startAt
    : new Intl.DateTimeFormat("sr-Latn", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export interface CalendarPageProps {
  profileId: string;
}

/**
 * The CAL module page (v0 basics): a single form that both adds and edits
 * events, and a day-grouped chronological agenda with per-row edit and
 * delete-with-undo. Every write goes through the events:* IPC allowlist, so the
 * store stays the single source of truth (e.g. it validates startAt and derives
 * updatedAt). endAt/description/category are deferred — the form stays minimal.
 */
export function CalendarPage({ profileId }: CalendarPageProps) {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);

  // One form serves both modes; a non-null editingId means "editing that event".
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await window.nexus.listEvents(profileId);
        if (active) setEvents(list);
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load events:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  function resetForm(): void {
    setEditingId(null);
    setTitle("");
    setAllDay(false);
    setDate("");
    setTime("");
    setLocation("");
  }

  /** Loads an event into the shared form and switches it to edit mode. */
  function startEdit(event: Event): void {
    setEditingId(event.id);
    setTitle(event.title);
    setAllDay(event.allDay);
    setDate(event.startAt.slice(0, 10));
    setTime(event.allDay ? "" : event.startAt.slice(11, 16));
    setLocation(event.location ?? "");
    titleRef.current?.focus();
  }

  async function reload(): Promise<void> {
    setEvents(await window.nexus.listEvents(profileId));
  }

  async function submitForm(formEvent: FormEvent<HTMLFormElement>): Promise<void> {
    formEvent.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0 || date.length === 0) return;

    // Assemble startAt: all-day is the bare date; timed appends the time (09:00
    // by default) so the "YYYY-MM-DDTHH:MM" form clears the store's ISO check.
    const startAt = allDay ? date : `${date}T${time || "09:00"}`;
    const trimmedLocation = location.trim();

    try {
      if (editingId != null) {
        // Empty location clears the stored value; a non-empty one sets it.
        const changes: EventFieldChanges = {
          title: trimmedTitle,
          startAt,
          allDay,
          location: trimmedLocation.length > 0 ? trimmedLocation : null,
        };
        const updated = await window.nexus.updateEvent(profileId, editingId, changes);
        setEvents((prev) => prev && prev.map((e) => (e.id === updated.id ? updated : e)));
        resetForm();
      } else {
        const fields: NewEventFields = { title: trimmedTitle, startAt, allDay };
        // Only send location when present (exactOptionalPropertyTypes).
        if (trimmedLocation.length > 0) fields.location = trimmedLocation;
        const created = await window.nexus.createEvent(profileId, fields);
        setEvents((prev) => (prev ? [...prev, created] : [created]));
        resetForm();
        titleRef.current?.focus();
      }
    } catch (error) {
      console.error("Nexus: failed to save event:", error);
    }
  }

  async function remove(event: Event): Promise<void> {
    try {
      await window.nexus.deleteEvent(profileId, event.id);
      setEvents((prev) => prev && prev.filter((current) => current.id !== event.id));
      // Never leave the form bound to an event that no longer exists.
      if (editingId === event.id) resetForm();
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndoId(event.id);
    } catch (error) {
      console.error("Nexus: failed to delete event:", error);
    }
  }

  async function undo(): Promise<void> {
    if (!pendingUndoId) return;
    try {
      await window.nexus.restoreEvent(profileId, pendingUndoId);
      setPendingUndoId(null);
      // Re-fetch so the restored event lands back in chronological order.
      await reload();
    } catch (error) {
      console.error("Nexus: failed to restore event:", error);
    }
  }

  return (
    <div className="cal">
      <form className="cal__form" onSubmit={submitForm}>
        <input
          ref={titleRef}
          className="nx-textfield__input cal__title"
          value={title}
          placeholder={strings.calendar.titlePlaceholder}
          aria-label={strings.calendar.titleLabel}
          autoFocus
          onChange={(event: ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)}
        />
        <TextField
          type="date"
          value={date}
          required
          aria-label={strings.calendar.dateLabel}
          onChange={(event) => setDate(event.target.value)}
        />
        {!allDay && (
          <TextField
            type="time"
            value={time}
            aria-label={strings.calendar.timeLabel}
            onChange={(event) => setTime(event.target.value)}
          />
        )}
        <TextField
          type="text"
          value={location}
          placeholder={strings.calendar.locationPlaceholder}
          aria-label={strings.calendar.locationLabel}
          onChange={(event) => setLocation(event.target.value)}
        />
        <Checkbox checked={allDay} onChange={(event) => setAllDay(event.target.checked)}>
          {strings.calendar.allDay}
        </Checkbox>
        <Button type="submit" variant="primary">
          {editingId != null ? strings.calendar.save : strings.calendar.add}
        </Button>
        {editingId != null && (
          <Button type="button" className="cal__cancel" onClick={resetForm}>
            {strings.calendar.cancel}
          </Button>
        )}
      </form>

      {pendingUndoId != null && (
        <div className="cal__undo" role="status">
          <span className="cal__undo-text">{strings.calendar.deletedNotice}</span>
          <Button size="sm" className="cal__undo-action" onClick={() => void undo()}>
            {strings.calendar.undo}
          </Button>
          <Button
            size="sm"
            className="cal__undo-dismiss"
            aria-label={strings.calendar.dismiss}
            onClick={() => setPendingUndoId(null)}
          >
            ×
          </Button>
        </div>
      )}

      {failed ? (
        <EmptyState title={strings.calendar.emptyTitle} description={strings.calendar.loadError} />
      ) : events === null ? (
        <p className="app__muted">{strings.app.loading}</p>
      ) : events.length === 0 ? (
        <EmptyState
          title={strings.calendar.emptyTitle}
          description={strings.calendar.emptyDescription}
        />
      ) : (
        <div className="cal__agenda">
          {groupByDay(events).map(([key, dayEvents]) => (
            <section key={key} className="cal__day">
              <h2 className="cal__day-header">{formatDay(key)}</h2>
              {dayEvents.map((event) => (
                <ListRow
                  key={event.id}
                  leading={<span className="cal__time">{formatTime(event)}</span>}
                  trailing={
                    <span className="cal__row-actions">
                      <Button
                        size="sm"
                        className="cal__edit"
                        aria-label={strings.calendar.editLabel}
                        onClick={() => startEdit(event)}
                      >
                        ✎
                      </Button>
                      <Button
                        size="sm"
                        className="cal__delete"
                        aria-label={strings.calendar.deleteLabel}
                        onClick={() => void remove(event)}
                      >
                        ×
                      </Button>
                    </span>
                  }
                >
                  <span className="cal__event">
                    <span className="cal__event-title">{event.title}</span>
                    {event.location ? <Chip variant="data">{event.location}</Chip> : null}
                  </span>
                </ListRow>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
