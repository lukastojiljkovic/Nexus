import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Button, Chip, EmptyState, Icon, ListRow, LoadingState, Select, TextField } from "@nexus/ui";
import type {
  DocumentRenewal,
  DocumentStatus,
  DocumentType,
  TrackedDocument,
} from "../../shared/ipc.js";
import { DocDeadlines } from "./DocDeadlines.js";
import {
  type DocumentFormValues,
  documentFieldChanges,
  ladderFor,
  newDocumentFields,
  reminderChoices,
  toggleReminder,
} from "./documentsForm.js";
import { localTodayKey } from "./examDates.js";
import { formatDocumentDate } from "./dateLabels.js";
import { scrollRevealedIntoView, useRevealedRow } from "./reveal.js";
import { dayUnit, strings } from "./strings.js";

// --- Field orderings (renderer mirror of @nexus/db) -------------------------
//
// The renderer never imports DB/Node code (SEC-EL-02: the wire contract stays
// self-contained), so the type order is redeclared here, matching DOCUMENT_TYPES
// in @nexus/db. The Serbian labels live in strings.ts, applied at render time.
const DOCUMENT_TYPES: readonly DocumentType[] = [
  "licna_karta",
  "pasos",
  "vozacka",
  "registracija",
  "kartica",
  "polisa",
  "custom",
];

// Status → Chip variant: on time reads as data, the reminder window as accent,
// an expired document as danger. The colour is the Chip's; never hand-rolled.
const STATUS_VARIANT: Record<DocumentStatus, "data" | "accent" | "danger"> = {
  ok: "data",
  uskoro: "accent",
  istekao: "danger",
};

/**
 * Human "time to expiry" hint from the store's derived daysUntilExpiry: future
 * days, tomorrow, today, or how long ago it lapsed. The dan/dana agreement comes
 * from `dayUnit` (21 → "dan", 22 → "dana").
 */
function daysUntilLabel(days: number): string {
  const d = strings.documents.days;
  if (days > 1) return `${d.future} ${days} ${dayUnit(days, d.unitOne, d.unitMany)}`;
  if (days === 1) return d.tomorrow;
  if (days === 0) return d.today;
  const ago = Math.abs(days);
  return `${d.pastPrefix} ${ago} ${dayUnit(ago, d.unitOne, d.unitMany)}`;
}

// --- Podsetnici (the per-document reminder ladder) --------------------------
//
// The ladder's own logic — the per-type defaults, the chips to offer, what a
// click does to them and the two payloads the wires carry — lives in
// `documentsForm.ts`, where it can be tested (no DOM library here). What is left
// in this file is the half that is copy and markup.

/**
 * A lead time as its chip label: „Na dan roka“, „7 dana ranije“. Zero is its
 * own wording — there is nothing „ranije“ about the expiry day itself — and it
 * is reachable only through the union `reminderChoices` draws, since no chip
 * offers it. The counted noun comes from `days`, the same block `daysUntilLabel`
 * counts in, so the ladder and the row's countdown agree on „dan“ and „dana“.
 */
function documentReminderLabel(days: number): string {
  const d = strings.documents.days;
  if (days === 0) return strings.documents.reminders.atDue;
  return `${days} ${dayUnit(days, d.unitOne, d.unitMany)} ${strings.documents.reminders.before}`;
}

/** DOM id for a document's row, for `scrollRevealedIntoView`. */
function documentRowDomId(documentId: string): string {
  return `document-row-${documentId}`;
}

export interface DocumentsPanelProps {
  profileId: string;
  /**
   * A pending deep-link target (021-e, CAL's own "document" search results):
   * loads that document into the edit form and marks its row, once. A bare
   * id/handler pair rather than a TasksIntent-style union, since a document
   * has exactly one reveal path — no "create" variant in this slice. Owned by
   * `CalendarPage`, which is also the one that switches to this panel's own
   * Dokumenta view in the first place.
   */
  revealDocumentId?: string | null;
  // `| undefined` is explicit (not just the bare optional `?`) because
  // `CalendarPage` forwards its OWN optional `onIntentHandled` prop here
  // as-is — under `exactOptionalPropertyTypes`, a plain `() => void` rejects
  // that forwarded value even though the property itself is optional.
  onRevealHandled?: (() => void) | undefined;
}

/**
 * The CAL Dokumenta panel (CAL-004, the founder's signature feature): a single
 * form that both adds and edits tracked documents, and a list ordered by soonest
 * expiry with a derived status chip, per-row renew, and delete-with-undo. Every
 * write goes through the documents:* IPC allowlist, so the store stays the
 * single source of truth (it derives status/daysUntilExpiry and applies the
 * per-type reminder ladder). The ladder itself is editable on this form, per
 * document — see `REMINDER_LADDER`.
 */
export function DocumentsPanel({
  profileId,
  revealDocumentId,
  onRevealHandled,
}: DocumentsPanelProps) {
  const [documents, setDocuments] = useState<TrackedDocument[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);
  const { revealedId, reveal } = useRevealedRow();

  // One form serves both modes; a non-null editingId means "editing that doc".
  const [editingId, setEditingId] = useState<string | null>(null);
  const [docType, setDocType] = useState<DocumentType>("licna_karta");
  const [label, setLabel] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  /**
   * The ladder the user has built, or `null` while the form is still following
   * the TYPE's default. One piece of state rather than a list beside a
   * `touched` flag, because those two can disagree and this cannot: „untouched“
   * is the absence of a ladder here, not a second fact about one.
   *
   * It is also what makes the rule both halves of the form need true by
   * construction — a type change re-seeds the chips while this is `null` and
   * cannot touch them once it is not, and an edit loads the document's own
   * ladder, which is why a type change inside an edit never overwrites what the
   * record already says.
   */
  const [reminderOffsets, setReminderOffsets] = useState<number[] | null>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  /**
   * The ladder the chips draw and the form will send: the user's own once a
   * chip has been touched, the type's default until then — the rule, and why it
   * is the store's own, are `ladderFor`'s.
   */
  const ladder = ladderFor(reminderOffsets, docType);

  // Inline renew: one row at a time reveals a date input + confirm affordance.
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [renewDate, setRenewDate] = useState("");
  /** The open row's renewal ledger; `null` while it is being read. */
  const [renewals, setRenewals] = useState<DocumentRenewal[] | null>(null);
  const [renewalsFailed, setRenewalsFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await window.nexus.listDocuments(profileId);
        if (active) setDocuments(list);
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load documents:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  function resetForm(): void {
    setEditingId(null);
    setDocType("licna_karta");
    setLabel("");
    setExpiryDate("");
    setNotes("");
    setReminderOffsets(null);
  }

  /**
   * Loads a document into the shared form and switches it to edit mode. The
   * document's OWN ladder comes with it: a stored record carries an explicit
   * ladder whatever the type's default is today, so the form takes it as the
   * user's own rather than re-deriving it from the type.
   */
  function startEdit(doc: TrackedDocument): void {
    setEditingId(doc.id);
    setDocType(doc.docType);
    setLabel(doc.label);
    setExpiryDate(doc.expiryDate.slice(0, 10));
    setNotes(doc.notes ?? "");
    setReminderOffsets([...doc.reminderOffsets]);
    labelRef.current?.focus();
  }

  // Consumes a pending deep-link (021-e, CAL's "document" search results):
  // loads the same edit path a row's ✎ button uses, then marks the row. Keyed
  // on `revealDocumentId`/`documents` rather than mount, so a search fired
  // while Dokumenta is already open retriggers this exactly like one that
  // switches CalendarPage into this view does, and a load race (the target
  // arrives before this panel's own list has fetched) resolves itself once
  // `documents` changes instead of being dropped.
  useEffect(() => {
    if (revealDocumentId == null) return;
    if (documents === null) return; // still loading — wait rather than deciding it's missing
    const doc = documents.find((d) => d.id === revealDocumentId);
    if (!doc) {
      onRevealHandled?.(); // deleted between indexing and clicking — do nothing else
      return;
    }
    startEdit(doc);
    reveal(doc.id);
    scrollRevealedIntoView(documentRowDomId(doc.id));
    onRevealHandled?.();
  }, [revealDocumentId, documents, reveal, onRevealHandled]);

  async function reload(): Promise<void> {
    setDocuments(await window.nexus.listDocuments(profileId));
  }

  async function submitForm(formEvent: FormEvent<HTMLFormElement>): Promise<void> {
    formEvent.preventDefault();
    const trimmedLabel = label.trim();
    if (trimmedLabel.length === 0 || expiryDate.length === 0) return;
    const values: DocumentFormValues = {
      docType,
      label: trimmedLabel,
      expiryDate,
      notes: notes.trim(),
      ladder,
    };

    try {
      if (editingId != null) {
        // In edit mode `ladder` IS the record's own — `startEdit` loaded it — so
        // a type change made here cannot overwrite the lead times the document
        // was stored with. `documentFieldChanges` owns the payload's shape.
        const updated = await window.nexus.updateDocument(
          profileId,
          editingId,
          documentFieldChanges(values),
        );
        setDocuments((prev) => prev && prev.map((d) => (d.id === updated.id ? updated : d)));
        resetForm();
      } else {
        const created = await window.nexus.createDocument(profileId, newDocumentFields(values));
        setDocuments((prev) => (prev ? [...prev, created] : [created]));
        resetForm();
        labelRef.current?.focus();
      }
    } catch (error) {
      console.error("Nexus: failed to save document:", error);
    }
  }

  /**
   * Reads the document's own renewal ledger (migration 004) when its renew row
   * opens, and only then.
   *
   * The ledger has been WRITE-ONLY for its whole life: `renewDocument` appends
   * a row on every renewal, `documents:renewals` was wired end to end — channel,
   * guarded handler, preload bridge, typed API — and **nothing ever called it**,
   * so the one place a passport's history could have been read was the export
   * archive. Opening the renew row is where that history is worth something: it
   * is the moment somebody is deciding a new expiry date, and the last few
   * answer „when did I last do this".
   */
  async function loadRenewals(id: string): Promise<void> {
    setRenewals(null);
    setRenewalsFailed(false);
    try {
      setRenewals(await window.nexus.listDocumentRenewals(profileId, id));
    } catch (error) {
      setRenewalsFailed(true);
      console.error("Nexus: failed to read the document's renewal history:", error);
    }
  }

  function startRenew(doc: TrackedDocument): void {
    setRenewingId(doc.id);
    setRenewDate(doc.expiryDate.slice(0, 10));
    void loadRenewals(doc.id);
  }

  function cancelRenew(): void {
    setRenewingId(null);
    setRenewDate("");
    setRenewals(null);
    setRenewalsFailed(false);
  }

  async function confirmRenew(doc: TrackedDocument): Promise<void> {
    if (renewDate.length === 0) return;
    try {
      const renewed = await window.nexus.renewDocument(profileId, doc.id, renewDate);
      setDocuments((prev) => prev && prev.map((d) => (d.id === renewed.id ? renewed : d)));
      cancelRenew();
    } catch (error) {
      console.error("Nexus: failed to renew document:", error);
    }
  }

  async function remove(doc: TrackedDocument): Promise<void> {
    try {
      await window.nexus.deleteDocument(profileId, doc.id);
      setDocuments((prev) => prev && prev.filter((current) => current.id !== doc.id));
      // Never leave the form or renew row bound to a doc that no longer exists.
      if (editingId === doc.id) resetForm();
      if (renewingId === doc.id) cancelRenew();
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndoId(doc.id);
    } catch (error) {
      console.error("Nexus: failed to delete document:", error);
    }
  }

  async function undo(): Promise<void> {
    if (!pendingUndoId) return;
    try {
      await window.nexus.restoreDocument(profileId, pendingUndoId);
      setPendingUndoId(null);
      // Re-fetch so the restored doc lands back in soonest-expiry order.
      await reload();
    } catch (error) {
      console.error("Nexus: failed to restore document:", error);
    }
  }

  // The store returns documents by soonest expiry, but create appends
  // optimistically, so the display order is re-derived here — expiry then id.
  const ordered =
    documents &&
    [...documents].sort(
      (a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.id.localeCompare(b.id),
    );

  return (
    <div className="documents">
      <form className="documents__form" onSubmit={submitForm}>
        {/* STACKED, and it was `inline` until its three neighbours got labels
            of their own. `inline` was right while it was the only named child
            of a row of bare boxes — a caption beside the one control that had
            a name. Now every field here draws a name above itself, and the
            odd one out would be this one: an uppercase caption to the left of
            three sentence-case labels above. The arrangement follows the row,
            which is what having it as a prop is for. */}
        <Select
          label={strings.documents.typeLabel}
          value={docType}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            setDocType(event.target.value as DocumentType)
          }
        >
          {DOCUMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {strings.documents.type[type]}
            </option>
          ))}
        </Select>
        {/* Through the component rather than around it. Two call sites focus
            this field through `labelRef`, and going around `TextField` to get
            at the input was what cost it the label — the same trade CAL's
            title made, and the reason `TextField` now takes a `ref`. */}
        <TextField
          ref={labelRef}
          className="documents__label-input"
          label={strings.documents.labelLabel}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        {/* „Ističe" was the FIRST of this form's visible labels, and for a
            while the only one: it was the one field whose name was not also
            its placeholder, so it was the one box that said nothing at all
            until it was clicked — DC-120 step 1. */}
        <TextField
          type="date"
          value={expiryDate}
          required
          label={strings.documents.expiryLabel}
          onChange={(event) => setExpiryDate(event.target.value)}
        />
        <TextField
          type="text"
          value={notes}
          label={strings.documents.notesLabel}
          onChange={(event) => setNotes(event.target.value)}
        />
        {/* Podsetnici — the ladder. The store has held `reminderOffsets` since
            the first migration and BOTH wires carry it, so this block is not a
            new capability, it is the missing half of one: without it every
            document kept its type's default for its whole life, and a pasoš
            said „Uskoro ističe“ from ninety days out whether or not that was
            any use to its owner.

            A full row of the form, like CAL's and TASK's own ladders, so the
            chips wrap under themselves rather than shoving the submit button
            around. The selection is the DERIVED ladder, not the user's list:
            untouched, the chips show what the type will be created with.

            No `<label>` element here on purpose — the name is a plain span and
            the control is a group of buttons, which is how the other two
            ladders are named as well. A wrapping `<label>` would also take the
            whole row as the accessible name of the first control in it. */}
        <div className="documents__reminders">
          <span className="documents__reminders-label">{strings.documents.reminders.label}</span>
          <div
            className="documents__reminder-chips"
            role="group"
            aria-label={strings.documents.reminders.label}
          >
            {reminderChoices(ladder).map((days) => (
              <Button
                key={days}
                size="sm"
                className="nx-segmented__option documents__reminder"
                aria-pressed={ladder.includes(days)}
                onClick={() => setReminderOffsets((prev) => toggleReminder(prev, docType, days))}
              >
                {documentReminderLabel(days)}
              </Button>
            ))}
          </div>
        </div>
        <Button type="submit" variant="primary">
          {editingId != null ? strings.documents.save : strings.documents.add}
        </Button>
        {editingId != null && (
          <Button type="button" className="documents__cancel" onClick={resetForm}>
            {strings.documents.cancel}
          </Button>
        )}
      </form>

      {pendingUndoId != null && (
        <div className="documents__undo" role="status">
          <span className="documents__undo-text">{strings.documents.deletedNotice}</span>
          <Button size="sm" className="documents__undo-action" onClick={() => void undo()}>
            {strings.documents.undo}
          </Button>
          <Button
            size="sm"
            className="documents__undo-dismiss"
            aria-label={strings.documents.dismiss}
            onClick={() => setPendingUndoId(null)}
          >
            <Icon name="close" size={14} />
          </Button>
        </div>
      )}

      {failed ? (
        <EmptyState
          title={strings.documents.emptyTitle}
          description={strings.documents.loadError}
        />
      ) : ordered === null ? (
        <LoadingState label={strings.app.loading} rows={3} />
      ) : ordered.length === 0 ? (
        <EmptyState
          title={strings.documents.emptyTitle}
          description={strings.documents.emptyDescription}
        />
      ) : (
        <>
          {/* The horizon before the list it summarises. A list answers each
              document on its own — „ističe za 41 dan", „ističe za 58 dana" —
              and leaves the reader holding four numbers to notice that three
              things fall due in the same fortnight. */}
          <DocDeadlines profileId={profileId} documents={ordered} today={localTodayKey()} />
          <div className="documents__list">
          {ordered.map((doc) => (
            <ListRow
              key={doc.id}
              leading={
                <Chip variant={STATUS_VARIANT[doc.status]}>
                  {strings.documents.status[doc.status]}
                </Chip>
              }
              trailing={
                renewingId === doc.id ? (
                  <span className="documents__renew">
                    {/* INLINE, not stacked: this row is a list row's trailing
                        edge, and a label above the box would make one row of
                        the list taller than the rest of it while it is open.
                        Beside the box the name is a caption on the same line
                        as the two buttons, and the row keeps its height. */}
                    <TextField
                      type="date"
                      layout="inline"
                      className="documents__renew-input"
                      value={renewDate}
                      label={strings.documents.renewLabel}
                      onChange={(event) => setRenewDate(event.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void confirmRenew(doc)}
                    >
                      {strings.documents.renewConfirm}
                    </Button>
                    <Button
                      size="sm"
                      className="documents__renew-cancel"
                      aria-label={strings.documents.renewCancel}
                      onClick={cancelRenew}
                    >
                      <Icon name="close" size={14} />
                    </Button>
                  </span>
                ) : (
                  <span className="documents__row-actions">
                    <Button
                      size="sm"
                      className="documents__renew-start"
                      onClick={() => startRenew(doc)}
                    >
                      {strings.documents.renew}
                    </Button>
                    <Button
                      size="sm"
                      className="documents__edit"
                      aria-label={strings.documents.editLabel}
                      onClick={() => startEdit(doc)}
                    >
                      <Icon name="pencil" size={14} />
                    </Button>
                    <Button
                      size="sm"
                      className="documents__delete"
                      aria-label={strings.documents.deleteLabel}
                      onClick={() => void remove(doc)}
                    >
                      <Icon name="trash" size={14} />
                    </Button>
                  </span>
                )
              }
            >
              <span
                id={documentRowDomId(doc.id)}
                className={
                  revealedId === doc.id ? "documents__item nx-revealed" : "documents__item"
                }
              >
                <span className="documents__heading">
                  <span className="documents__doc-label">{doc.label}</span>
                  <span className="documents__type">{strings.documents.type[doc.docType]}</span>
                </span>
                <span className="documents__meta">
                  <span className="documents__expiry">{formatDocumentDate(doc.expiryDate)}</span>
                  <span className="documents__days">{daysUntilLabel(doc.daysUntilExpiry)}</span>
                </span>
                {/* The ledger, read only while this row's renew form is open —
                    which is the moment it is worth something, because that is
                    when somebody is choosing the next expiry date. Loading and
                    failure are told apart from „no renewals yet": the last of
                    those is a real answer and the other two are not. */}
                {renewingId === doc.id && (
                  <span className="documents__renewals">
                    <span className="nx-eyebrow">
                      {strings.documents.renewalsTitle}
                    </span>
                    {renewalsFailed ? (
                      <span className="documents__renewals-note" role="alert">
                        {strings.documents.renewalsError}
                      </span>
                    ) : renewals === null ? (
                      <span className="documents__renewals-note">{strings.app.loading}</span>
                    ) : renewals.length === 0 ? (
                      <span className="documents__renewals-note">
                        {strings.documents.renewalsEmpty}
                      </span>
                    ) : (
                      renewals.map((renewal) => (
                        <span key={renewal.id} className="documents__renewal">
                          {`${formatDocumentDate(renewal.renewedAt)} — ${strings.documents.renewalsPrevious} ${formatDocumentDate(renewal.previousExpiry)}`}
                        </span>
                      ))
                    )}
                  </span>
                )}
              </span>
            </ListRow>
          ))}
          </div>
        </>
      )}
    </div>
  );
}
