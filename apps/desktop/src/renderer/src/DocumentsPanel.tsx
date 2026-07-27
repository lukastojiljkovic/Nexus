import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Button, Chip, EmptyState, ListRow, TextField } from "@nexus/ui";
import type {
  DocumentFieldChanges,
  DocumentStatus,
  DocumentType,
  NewDocumentFields,
  TrackedDocument,
} from "../../shared/ipc.js";
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
 * Expiry date for the row — "8. jul 2026." in Serbian; raw string on bad input.
 * A tracked expiry is a bare calendar date, so it is parsed and formatted in UTC
 * (mirrors CalendarPage's formatDay) — otherwise UTC midnight would shift a day
 * back when formatted in a negative-offset timezone.
 */
function formatExpiry(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : new Intl.DateTimeFormat("sr-Latn", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}

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
 * per-type reminder ladder). Per-document ladder editing is deferred.
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
  const labelRef = useRef<HTMLInputElement>(null);

  // Inline renew: one row at a time reveals a date input + confirm affordance.
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [renewDate, setRenewDate] = useState("");

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
  }

  /** Loads a document into the shared form and switches it to edit mode. */
  function startEdit(doc: TrackedDocument): void {
    setEditingId(doc.id);
    setDocType(doc.docType);
    setLabel(doc.label);
    setExpiryDate(doc.expiryDate.slice(0, 10));
    setNotes(doc.notes ?? "");
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
    const trimmedNotes = notes.trim();

    try {
      if (editingId != null) {
        // Empty notes clears the stored value; a non-empty one sets it.
        const changes: DocumentFieldChanges = {
          docType,
          label: trimmedLabel,
          expiryDate,
          notes: trimmedNotes.length > 0 ? trimmedNotes : null,
        };
        const updated = await window.nexus.updateDocument(profileId, editingId, changes);
        setDocuments((prev) => prev && prev.map((d) => (d.id === updated.id ? updated : d)));
        resetForm();
      } else {
        // No reminderOffsets — the store applies the per-type default ladder.
        const fields: NewDocumentFields = { docType, label: trimmedLabel, expiryDate };
        // Only send notes when present (exactOptionalPropertyTypes).
        if (trimmedNotes.length > 0) fields.notes = trimmedNotes;
        const created = await window.nexus.createDocument(profileId, fields);
        setDocuments((prev) => (prev ? [...prev, created] : [created]));
        resetForm();
        labelRef.current?.focus();
      }
    } catch (error) {
      console.error("Nexus: failed to save document:", error);
    }
  }

  function startRenew(doc: TrackedDocument): void {
    setRenewingId(doc.id);
    setRenewDate(doc.expiryDate.slice(0, 10));
  }

  function cancelRenew(): void {
    setRenewingId(null);
    setRenewDate("");
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
        <select
          className="documents__select"
          value={docType}
          aria-label={strings.documents.typeLabel}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            setDocType(event.target.value as DocumentType)
          }
        >
          {DOCUMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {strings.documents.type[type]}
            </option>
          ))}
        </select>
        <input
          ref={labelRef}
          className="nx-textfield__input documents__label-input"
          value={label}
          placeholder={strings.documents.labelPlaceholder}
          aria-label={strings.documents.labelLabel}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setLabel(event.target.value)}
        />
        <TextField
          type="date"
          value={expiryDate}
          required
          aria-label={strings.documents.expiryLabel}
          onChange={(event) => setExpiryDate(event.target.value)}
        />
        <TextField
          type="text"
          value={notes}
          placeholder={strings.documents.notesPlaceholder}
          aria-label={strings.documents.notesLabel}
          onChange={(event) => setNotes(event.target.value)}
        />
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
            ×
          </Button>
        </div>
      )}

      {failed ? (
        <EmptyState
          title={strings.documents.emptyTitle}
          description={strings.documents.loadError}
        />
      ) : ordered === null ? (
        <p className="app__muted">{strings.app.loading}</p>
      ) : ordered.length === 0 ? (
        <EmptyState
          title={strings.documents.emptyTitle}
          description={strings.documents.emptyDescription}
        />
      ) : (
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
                    <input
                      type="date"
                      className="nx-textfield__input documents__renew-input"
                      value={renewDate}
                      aria-label={strings.documents.renewLabel}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        setRenewDate(event.target.value)
                      }
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
                      ×
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
                      ✎
                    </Button>
                    <Button
                      size="sm"
                      className="documents__delete"
                      aria-label={strings.documents.deleteLabel}
                      onClick={() => void remove(doc)}
                    >
                      ×
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
                  <span className="documents__expiry">{formatExpiry(doc.expiryDate)}</span>
                  <span className="documents__days">{daysUntilLabel(doc.daysUntilExpiry)}</span>
                </span>
              </span>
            </ListRow>
          ))}
        </div>
      )}
    </div>
  );
}
