import { useEffect, useState } from "react";
import { MIME_FAMILIES, isInlineImageMime } from "@nexus/core";
import { Button, EmptyState, PageHeader } from "@nexus/ui";
import type {
  DocAttachmentEntry,
  DocAttachmentList,
  DocAttachmentModule,
  DocMimeFamily,
} from "../../shared/ipc.js";
import { AttachmentPreviewDialog } from "./attachmentPreview.js";
import { attachmentPreviewKind, type AttachmentPreviewKind } from "./attachmentPreviewKind.js";
import { fileExtensionMark, formatFileSize, totalFileBytes } from "./fileRows.js";
import { persistFileView, readStoredFileView, FILE_VIEWS, type FileView } from "./filePrefs.js";
import { NotePopover } from "./notePopover.js";
import { SEARCH_DEBOUNCE_MS, formatContextDate } from "./searchShared.js";
import { countUnit, strings } from "./strings.js";
import { moduleName } from "./moduleName.js";

/**
 * Datoteke (DOC) — one place for every file in the profile.
 *
 * Nexus has stored attachments on three surfaces for a long time (a note's
 * „Prilozi", a task's „Prilozi", a subject's „Materijali"), and each of them
 * answers one question well: what is attached to THIS record. None of them
 * answers the other one — where is that file I attached three weeks ago — and
 * this page is only that: a browse surface over the union those three tables
 * already form.
 *
 * **It reads and it navigates. It does not own anything.**
 *
 * - The read is `doc:list-attachments`, whose store unions the three tables and
 *   never dedupes by blob hash: one PDF on a note and on a task is two
 *   attachments with two owners, and collapsing them would hide one of them
 *   from the very surface built to show every one.
 * - „Pregledaj" is the EXISTING preview — the house dialog for images and
 *   text/markdown, the hardened window for PDFs — offered on exactly the rows
 *   `attachmentPreviewKind` says the app can render, never a list of its own.
 * - „Otvori" is the existing per-module open, with its main-owned temp-file
 *   discipline. The renderer names ids; it never sees a path or a hash.
 * - „Idi na…" rides the shell's own intent mechanism (021-e) — the same one the
 *   search palette opens a result with — so there is one way into a note from
 *   elsewhere in the app, not two.
 *
 * **There is deliberately no delete here, and that is a decision rather than a
 * gap.** An attachment's removal belongs to the surface that owns it: that is
 * where the row sits in context, and that is where its undo already lives. A
 * fourth delete path would need a fourth undo — and a file deleted from a list
 * that never showed which note it was illustrating is exactly the mistake no
 * undo should have to catch. „Idi na…" is the answer: go to where it belongs,
 * and remove it there.
 *
 * **Private files are not filtered out of this page; they were never in it.**
 * A sealed note's attachments live inside its envelope, not in any table the
 * union reads — the exclusion is structural, which is the only form strong
 * enough for that section's central invariant.
 */

export interface FilesPageProps {
  profileId: string;
  /**
   * Opens the note/task/subject a file hangs off — the shell's own reveal
   * dispatcher (`App.tsx`), shared with the search palette. Not optional: „Idi
   * na…" is this page's whole answer to „where is this", and a version of the
   * page without it would be a list with nowhere to go.
   */
  onOpenOwner: (ownerKind: DocAttachmentModule, ownerId: string) => void;
}

/** The owner-kind chips, in the order the bar offers them; `null` is „Sve" — the absence of a filter, not a fourth one. */
const OWNER_FILTERS: readonly (DocAttachmentModule | null)[] = [null, "note", "task", "subject"];

/** Where one read has got to — the dashboard widgets' three-state boundary (ADR-045 §4), applied to a page that performs exactly one read. */
type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: DocAttachmentList }
  | { status: "failed" };

/** What „Pregledaj" opened, when it opened the in-app dialog rather than the PDF window. */
type OpenPreview = { entry: DocAttachmentEntry; kind: Exclude<AttachmentPreviewKind, "pdf"> };

export function FilesPage({ profileId, onOpenOwner }: FilesPageProps) {
  const s = strings.files;
  const [ownerKind, setOwnerKind] = useState<DocAttachmentModule | null>(null);
  const [family, setFamily] = useState<DocMimeFamily | null>(null);
  const [query, setQuery] = useState("");
  // The page's own copy of the device preference: the Settings card decides
  // what „Datoteke" OPENS in, this toggle decides what the current visit looks
  // like — and switching here is remembered, so the two never disagree about
  // what the last answer was.
  const [view, setView] = useState<FileView>(() => readStoredFileView());
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<OpenPreview | null>(null);
  const [actionFailed, setActionFailed] = useState(false);

  // Debounced like the search page's, and for its reason: the query is a filter
  // the store runs, and a round trip per keystroke would ask the database four
  // questions on the way to the one that matters. The filters change rarely
  // enough to ride the same timer without anyone noticing.
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const data = await window.nexus.listAttachments(profileId, { ownerKind, family, query });
          if (active) setState({ status: "ready", data });
        } catch (error) {
          if (active) setState({ status: "failed" });
          console.error("Nexus: failed to list attachments:", error);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [profileId, ownerKind, family, query, attempt]);

  /** The on-page toggle writes the same key the Settings card does — one answer to „which shape", wherever it was given. */
  function changeView(next: FileView): void {
    persistFileView(next);
    setView(next);
  }

  /** „Otvori": the existing per-module open channel, chosen by the row's own owner kind. */
  async function openWithSystem(entry: DocAttachmentEntry): Promise<void> {
    setActionFailed(false);
    try {
      switch (entry.ownerKind) {
        case "note":
          await window.nexus.openNoteAttachment(profileId, entry.ownerId, entry.id);
          return;
        case "task":
          await window.nexus.openTaskAttachment(profileId, entry.ownerId, entry.id);
          return;
        case "subject":
          await window.nexus.openSubjectAttachment(profileId, entry.ownerId, entry.id);
          return;
      }
    } catch (error) {
      setActionFailed(true);
      console.error("Nexus: failed to open a file:", error);
    }
  }

  /** The PDF half of „Pregledaj" (ADR-064): the dedicated hardened window, asked for by ids only. */
  async function previewPdf(entry: DocAttachmentEntry): Promise<void> {
    setActionFailed(false);
    try {
      await window.nexus.previewAttachment(profileId, entry.ownerKind, entry.ownerId, entry.id);
    } catch (error) {
      setActionFailed(true);
      console.error("Nexus: failed to preview a file:", error);
    }
  }

  function ownerLabel(entry: DocAttachmentEntry): string {
    const title = entry.ownerTitle.trim();
    return title.length > 0 ? title : s.untitledOwner;
  }

  /** The actions every row and every card carries — one menu, one set, whichever shape is on screen. */
  function renderMenu(entry: DocAttachmentEntry) {
    const previewKind = attachmentPreviewKind(entry.mime, entry.fileName, entry.sizeBytes);
    return (
      <NotePopover label={s.menuLabel} triggerClassName="doc__menu">
        {(close) => (
          <>
            {previewKind !== null && (
              <button
                type="button"
                className="note__menu-item"
                role="menuitem"
                onClick={() => {
                  if (previewKind === "pdf") void previewPdf(entry);
                  else setPreview({ entry, kind: previewKind });
                  close();
                }}
              >
                {s.preview}
              </button>
            )}
            <button
              type="button"
              className="note__menu-item"
              role="menuitem"
              onClick={() => {
                void openWithSystem(entry);
                close();
              }}
            >
              {s.open}
            </button>
            <div className="note__menu-sep" role="separator" />
            {/* Where the file LIVES — and, deliberately, where it is removed.
                See the module comment: a delete here would need a fourth undo. */}
            <button
              type="button"
              className="note__menu-item"
              role="menuitem"
              onClick={() => {
                onOpenOwner(entry.ownerKind, entry.ownerId);
                close();
              }}
            >
              {s.goTo}
            </button>
          </>
        )}
      </NotePopover>
    );
  }

  function renderList(entries: readonly DocAttachmentEntry[]) {
    return (
      <div className="doc__list">
        <div className="doc__list-head" aria-hidden="true">
          <span>{s.columns.name}</span>
          <span>{s.columns.owner}</span>
          <span>{s.columns.size}</span>
          <span>{s.columns.date}</span>
          <span />
        </div>
        {entries.map((entry) => (
          <div key={entry.id} className="doc__row">
            <span className="doc__row-name" title={entry.fileName}>
              {entry.fileName}
            </span>
            <button
              type="button"
              className="doc__row-owner"
              title={ownerLabel(entry)}
              onClick={() => onOpenOwner(entry.ownerKind, entry.ownerId)}
            >
              <span className="doc__row-owner-kind">{s.owners[entry.ownerKind]}</span>
              <span className="doc__row-owner-title">{ownerLabel(entry)}</span>
            </button>
            <span className="doc__row-size">{formatFileSize(entry.sizeBytes)}</span>
            <span className="doc__row-date">{formatContextDate(entry.createdAt)}</span>
            {renderMenu(entry)}
          </div>
        ))}
      </div>
    );
  }

  function renderGrid(entries: readonly DocAttachmentEntry[]) {
    return (
      <div className="doc__grid">
        {entries.map((entry) => {
          const mark = fileExtensionMark(entry.fileName);
          return (
            <div key={entry.id} className="doc__card">
              <div className="doc__card-thumb">
                {isInlineImageMime(entry.mime) ? (
                  // The very URL the notes panel's own thumbnails use — one
                  // served blob protocol, not a second path to the same bytes.
                  <img
                    className="doc__card-image"
                    src={`nx-blob://${entry.sha256}`}
                    alt={entry.fileName}
                  />
                ) : (
                  <span className="doc__card-mark" role="img" aria-label={s.fileMarkLabel}>
                    {mark}
                  </span>
                )}
              </div>
              <span className="doc__card-name" title={entry.fileName}>
                {entry.fileName}
              </span>
              <button
                type="button"
                className="doc__card-owner"
                title={ownerLabel(entry)}
                onClick={() => onOpenOwner(entry.ownerKind, entry.ownerId)}
              >
                {ownerLabel(entry)}
              </button>
              <span className="doc__card-meta">
                {`${formatFileSize(entry.sizeBytes)} · ${formatContextDate(entry.createdAt)}`}
              </span>
              {renderMenu(entry)}
            </div>
          );
        })}
      </div>
    );
  }

  /**
   * What is on screen, in numbers this page derived from the rows it is
   * drawing. When the read hit its cap the count is a FLOOR („500+") and the
   * size is prefixed with „najmanje" — both are true of the rows in hand, and
   * neither claims a total nothing measured.
   */
  function renderSummary(data: DocAttachmentList) {
    const count = data.entries.length;
    const bytes = formatFileSize(totalFileBytes(data.entries));
    const unit = data.truncated
      ? s.summaryUnitMany
      : countUnit(count, s.summaryUnitOne, s.summaryUnitFew, s.summaryUnitMany);
    return (
      <div className="doc__meta">
        <span className="doc__count">
          {`${data.truncated ? `${count}+` : count} ${unit} · ${
            data.truncated ? `${s.summaryAtLeast} ${bytes}` : bytes
          }`}
        </span>
      </div>
    );
  }

  const filtered = ownerKind !== null || family !== null || query.trim().length > 0;

  function renderBody(data: DocAttachmentList) {
    if (data.entries.length === 0) {
      // Two different situations. „You have no files" and „nothing matches
      // these filters" are not the same sentence, and saying one of them for
      // both would be a lie about whichever it is not.
      return filtered ? (
        <EmptyState
          title={s.noMatchTitle}
          description={s.noMatchDescription}
          action={
            <Button size="sm" onClick={clearFilters}>
              {s.clearFilters}
            </Button>
          }
        />
      ) : (
        <EmptyState title={s.emptyTitle} description={s.emptyDescription} />
      );
    }
    return (
      <>
        {renderSummary(data)}
        {data.truncated && <p className="doc__truncated">{s.truncatedNote}</p>}
        {view === "lista" ? renderList(data.entries) : renderGrid(data.entries)}
      </>
    );
  }

  function clearFilters(): void {
    setOwnerKind(null);
    setFamily(null);
    setQuery("");
  }

  return (
    <section className="doc">
      <PageHeader
        title={moduleName("files")}
        // „Sve datoteke priložene uz beleške, zadatke i predmete." is what this
        // page IS, so it belongs under the title rather than beside the view
        // switcher — a sentence sitting in a row of buttons reads as a control
        // that lost its button.
        subtitle={s.caption}
        actions={
          <>
            <div className="doc__view" role="group" aria-label={s.viewLabel}>
              {FILE_VIEWS.map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={view === option ? "primary" : "ghost"}
                  aria-pressed={view === option}
                  onClick={() => changeView(option)}
                >
                  {s.views[option]}
                </Button>
              ))}
            </div>
          </>
        }
      />

      <div className="doc__filters">
        <input
          type="text"
          className="nx-textfield__input doc__search"
          placeholder={s.searchPlaceholder}
          aria-label={s.searchLabel}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="doc__chips" role="group" aria-label={s.ownerFilterLabel}>
          {OWNER_FILTERS.map((option) => (
            <Button
              key={option ?? "all"}
              size="sm"
              className={ownerKind === option ? "doc__chip doc__chip--active" : "doc__chip"}
              aria-pressed={ownerKind === option}
              onClick={() => setOwnerKind(option)}
            >
              {option === null ? s.owners.all : s.owners[option]}
            </Button>
          ))}
        </div>
        <div className="doc__chips" role="group" aria-label={s.familyFilterLabel}>
          <Button
            size="sm"
            className={family === null ? "doc__chip doc__chip--active" : "doc__chip"}
            aria-pressed={family === null}
            onClick={() => setFamily(null)}
          >
            {s.familyAll}
          </Button>
          {MIME_FAMILIES.map((option) => (
            <Button
              key={option}
              size="sm"
              className={family === option ? "doc__chip doc__chip--active" : "doc__chip"}
              aria-pressed={family === option}
              onClick={() => setFamily(option)}
            >
              {s.families[option]}
            </Button>
          ))}
        </div>
      </div>

      {actionFailed && (
        <p className="doc__action-error" role="status">
          {s.actionError}
        </p>
      )}

      {state.status === "loading" ? (
        <div className="doc__skeleton" role="status" aria-label={strings.app.loading}>
          <span className="doc__skeleton-line" />
          <span className="doc__skeleton-line" />
          <span className="doc__skeleton-line" />
        </div>
      ) : state.status === "failed" ? (
        <div className="doc__failure" role="alert">
          <p className="doc__error">{s.error}</p>
          <Button size="sm" onClick={() => setAttempt((value) => value + 1)}>
            {s.retry}
          </Button>
        </div>
      ) : (
        renderBody(state.data)
      )}

      {preview !== null && (
        <AttachmentPreviewDialog
          profileId={profileId}
          module={preview.entry.ownerKind}
          ownerId={preview.entry.ownerId}
          attachment={preview.entry}
          kind={preview.kind}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  );
}
