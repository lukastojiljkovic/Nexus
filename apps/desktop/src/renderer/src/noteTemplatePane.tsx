import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Button, TextField } from "@nexus/ui";
import { NOTE_TEMPLATE_MAX_BYTES, type NoteAttachment } from "../../shared/ipc.js";
import { AttachmentImage, NoteAttachmentProvider } from "./noteAttachmentImage.js";
import { NoteLink, NoteLinkProvider } from "./noteLink.js";
import { NotePopover } from "./notePopover.js";
import { mergeTemplateEntries, type TemplateEntry } from "./noteTemplates.js";
import { isDuplicateNameError } from "./storeErrors.js";
import { strings } from "./strings.js";

/**
 * The "Šabloni" in-pane mode (ADR-016 / NOTE-009b): browse built-in and
 * user-defined templates, preview one read-only, insert it, or manage
 * ("Sačuvaj kao šablon" / rename / delete) the user-defined ones. `NoteEditor`
 * mounts this in place of the live canvas while `mode === "templates"`, the
 * same ternary "Istorija verzija" uses — the live `Y.Doc` and its flush
 * machinery stay untouched underneath.
 */

/** Templates never carry attachments (ADR-016) — a stable empty map for the preview. */
const EMPTY_ATTACHMENTS: ReadonlyMap<string, NoteAttachment> = new Map();

/** The pane's single in-place form: "Sačuvaj kao šablon", or renaming one row. */
type FormState = null | { mode: "save" } | { mode: "rename"; id: string };

export interface NoteTemplatePaneProps {
  profileId: string;
  titles: ReadonlyMap<string, string>;
  onOpenNote: (id: string) => void;
  /**
   * The open note's content, already stripped of attachment nodes, captured by
   * `NoteEditor` at the moment this pane opened (the live editor unmounts behind
   * it, so it cannot be read from here). `null` when the editor was not ready.
   */
  noteContent: JSONContent | null;
  /** Hands the chosen template's block array up; the parent applies it after switching back. */
  onInsert: (blocks: JSONContent[]) => void;
}

export function NoteTemplatePane({
  profileId,
  titles,
  onOpenNote,
  noteContent,
  onInsert,
}: NoteTemplatePaneProps) {
  const [entries, setEntries] = useState<TemplateEntry[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [draftName, setDraftName] = useState("");
  /** The pane's error LINE rather than a boolean, so a taken name can name itself. */
  const [failed, setFailed] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(false);

  // Loads on mount and after every mutation; `mergeTemplateEntries` (shared
  // with the slash menu, 009-c) does the parse/sort/merge — built-ins first,
  // then sr-Latn sorted user rows, with a corrupt stored row kept as
  // `content: null` so it's still visible to rename or delete.
  const load = useCallback(async () => {
    try {
      const rows = await window.nexus.listNoteTemplates(profileId);
      setEntries(mergeTemplateEntries(rows));
      setListFailed(false);
    } catch (error) {
      setListFailed(true);
      console.error("Nexus: failed to load note templates:", error);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-selects the first entry once loaded. Keeps the current selection
  // across a refetch when it still exists (e.g. after a rename); falls back
  // to the first entry when it doesn't (e.g. after deleting the selected row).
  useEffect(() => {
    if (entries === null) return;
    setSelectedId((previous) => {
      if (previous !== null && entries.some((entry) => entry.id === previous)) return previous;
      return entries[0]?.id ?? null;
    });
  }, [entries]);

  const selected = entries?.find((entry) => entry.id === selectedId) ?? null;
  const builtinEntries = entries?.filter((entry) => entry.builtin) ?? [];
  const userEntries = entries?.filter((entry) => !entry.builtin) ?? [];

  // Both error flags are transient and belong to the action that raised them,
  // so every entry into and exit from a form clears them — otherwise a
  // "too large" warning from an abandoned save would still be on screen after
  // an unrelated rename or delete succeeded.
  function cancelForm(): void {
    setForm(null);
    setDraftName("");
    setFailed(null);
    setTooLarge(false);
  }

  function beginSave(): void {
    setFailed(null);
    setTooLarge(false);
    setDraftName("");
    setForm({ mode: "save" });
  }

  function beginRename(entry: TemplateEntry): void {
    setFailed(null);
    setTooLarge(false);
    setDraftName(entry.name);
    setForm({ mode: "rename", id: entry.id });
  }

  async function run(action: () => Promise<void>): Promise<void> {
    try {
      setFailed(null);
      setTooLarge(false);
      await action();
      cancelForm();
      await load();
    } catch (error) {
      // A rename onto a name this profile already uses is refused by the store
      // (`save` is an upsert, so rename is the only path to it). „Pokusaj
      // ponovo" cannot succeed against that, so the taken name says so.
      setFailed(
        isDuplicateNameError(error)
          ? strings.notes.templateNameTaken
          : strings.notes.templateError,
      );
      console.error("Nexus: template action failed:", error);
    }
  }

  function submitSave(): void {
    const name = draftName.trim();
    if (name.length === 0 || noteContent === null) return;
    const json = JSON.stringify(noteContent);
    if (new TextEncoder().encode(json).byteLength > NOTE_TEMPLATE_MAX_BYTES) {
      setTooLarge(true);
      return;
    }
    setTooLarge(false);
    void run(() => window.nexus.saveNoteTemplate(profileId, name, json).then(() => undefined));
  }

  function submitRename(id: string): void {
    const name = draftName.trim();
    if (name.length === 0) return;
    void run(() => window.nexus.renameNoteTemplate(profileId, id, name));
  }

  function remove(id: string): void {
    void run(() => window.nexus.deleteNoteTemplate(profileId, id));
  }

  // Shared shape for both "Sačuvaj kao šablon" and a per-row rename —
  // NoteOrganizer's folderForm/tagForm recipe: a TextField + primary Sačuvaj +
  // Otkaži. `notes` carries the save form's two honest captions; rename has none.
  const templateForm = (onSubmit: () => void, notes?: ReactNode): ReactNode => (
    <form
      className="note__templates-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <TextField
        value={draftName}
        onChange={(event) => setDraftName(event.target.value)}
        placeholder={strings.notes.templateNamePlaceholder}
        aria-label={strings.notes.templateNamePlaceholder}
        autoFocus
      />
      {notes}
      <div className="note__folder-form-actions">
        <Button type="submit" size="sm" variant="primary">
          {strings.notes.save}
        </Button>
        <Button type="button" size="sm" onClick={cancelForm}>
          {strings.notes.cancel}
        </Button>
      </div>
    </form>
  );

  const renderRow = (entry: TemplateEntry): ReactNode => {
    if (form !== null && form.mode === "rename" && form.id === entry.id) {
      return <Fragment key={entry.id}>{templateForm(() => submitRename(entry.id))}</Fragment>;
    }
    const isSelected = entry.id === selectedId;
    return (
      <div key={entry.id} className="note__templates-row">
        <button
          type="button"
          className={
            isSelected ? "note__templates-item note__templates-item--selected" : "note__templates-item"
          }
          aria-current={isSelected ? "true" : undefined}
          onClick={() => setSelectedId(entry.id)}
        >
          <span className="note__templates-item-name">{entry.name}</span>
        </button>
        {!entry.builtin && (
          <NotePopover label={strings.notes.templateMenuLabel}>
            {(close) => (
              <>
                <button
                  type="button"
                  className="note__menu-item"
                  role="menuitem"
                  onClick={() => {
                    beginRename(entry);
                    close();
                  }}
                >
                  {strings.notes.templateRename}
                </button>
                <button
                  type="button"
                  className="note__menu-item note__menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    remove(entry.id);
                    close();
                  }}
                >
                  {strings.notes.templateDelete}
                </button>
              </>
            )}
          </NotePopover>
        )}
      </div>
    );
  };

  if (listFailed) {
    return (
      <p className="note__templates-error" role="status">
        {strings.notes.templateError}
      </p>
    );
  }

  if (entries === null) {
    return <p className="app__muted">{strings.app.loading}</p>;
  }

  // The overwrite warning only applies to the save form: comparing the
  // trimmed name exactly (not case-insensitively) against user templates,
  // since the UNIQUE index the replace relies on is case-sensitive.
  const isOverwrite =
    form !== null &&
    form.mode === "save" &&
    userEntries.some((entry) => entry.name === draftName.trim());

  return (
    <div className="note__templates">
      <div className="note__templates-list">
        <h3 className="note__templates-title">
          {strings.notes.templatesTitle} ({entries.length})
        </h3>
        <div className="note__templates-group">{strings.notes.templatesBuiltinGroup}</div>
        {builtinEntries.map(renderRow)}
        <div className="note__templates-group">{strings.notes.templatesUserGroup}</div>
        {userEntries.length === 0 ? (
          <p className="note__templates-empty">{strings.notes.templatesUserEmpty}</p>
        ) : (
          userEntries.map(renderRow)
        )}
        {form !== null && form.mode === "save" ? (
          templateForm(
            submitSave,
            <>
              <p className="note__templates-note">{strings.notes.templateSaveNote}</p>
              {isOverwrite && (
                <p className="note__templates-note">{strings.notes.templateOverwriteNote}</p>
              )}
            </>,
          )
        ) : (
          <Button
            size="sm"
            className="note__new-tag"
            disabled={noteContent === null}
            onClick={beginSave}
          >
            {strings.notes.templateSaveAs}
          </Button>
        )}
        {(failed || tooLarge) && (
          <p className="note__templates-error" role="status">
            {tooLarge ? strings.notes.templateTooLarge : failed}
          </p>
        )}
      </div>
      <div className="note__templates-preview">
        {selected !== null &&
          (selected.content === null ? (
            <p className="app__muted">{strings.notes.templateBroken}</p>
          ) : (
            <TemplatePreview
              key={selected.id}
              content={selected.content}
              titles={titles}
              onOpenNote={onOpenNote}
            />
          ))}
      </div>
      <div className="note__templates-actions">
        <button
          type="button"
          className="note__attach"
          disabled={selected === null || selected.content === null}
          onClick={() => {
            if (selected !== null && selected.content !== null) {
              onInsert(selected.content.content ?? []);
            }
          }}
        >
          {strings.notes.templateInsert}
        </button>
        <p className="note__templates-note">{strings.notes.templateInsertNote}</p>
      </div>
    </div>
  );
}

interface TemplatePreviewProps {
  content: JSONContent;
  titles: ReadonlyMap<string, string>;
  onOpenNote: (id: string) => void;
}

/**
 * The read-only render of one template. Mounted with `key={entry.id}` by the
 * parent so every selection change fully remounts it. No `Y.Doc` and no
 * `Collaboration` binding — a template is never concurrently edited (ADR-016),
 * so its JSON is fed straight into the editor as static content. Same content
 * extensions as the live `EditorCanvas`, minus `Collaboration`, `Placeholder`,
 * and the two suggestion plugins — a preview never takes input.
 */
function TemplatePreview({ content, titles, onOpenNote }: TemplatePreviewProps) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          undoRedo: false,
          heading: { levels: [1, 2, 3] },
          strike: false,
          underline: false,
          dropcursor: { color: "var(--nx-accent)", width: 2 },
          link: { openOnClick: false, autolink: true, linkOnPaste: true },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        NoteLink,
        AttachmentImage,
      ],
      editable: false,
      immediatelyRender: false,
      content,
      editorProps: { attributes: { class: "note__prosemirror" } },
    },
    // Rebuilt when the content identity changes, not only on the parent's
    // remount-by-key: saving over the *selected* template keeps its id, so a
    // key-only preview would keep rendering the pre-save body. A refetch
    // re-parses user rows into fresh objects (built-ins keep their module
    // constant), so exactly the rows that can have changed rebuild.
    [content],
  );

  return (
    <NoteAttachmentProvider value={{ byId: EMPTY_ATTACHMENTS }}>
      <NoteLinkProvider value={{ titles, onOpenNote }}>
        <EditorContent editor={editor} />
      </NoteLinkProvider>
    </NoteAttachmentProvider>
  );
}
