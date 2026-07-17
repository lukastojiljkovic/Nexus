import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import { ACCENT_IDS } from "@nexus/tokens";
import { Button, TextField } from "@nexus/ui";
import type { NoteFolder, NoteFolderColor, NoteTag } from "../../shared/ipc.js";
import { NotePopover } from "./notePopover.js";
import { strings } from "./strings.js";

/** Which slice of notes the middle list shows: everything, only unfiled, or one folder. */
export type FolderSelection =
  | { kind: "all" }
  | { kind: "unfiled" }
  | { kind: "folder"; id: string };

type Editing =
  | null
  | { mode: "rename"; id: string }
  | { mode: "recolor"; id: string }
  | { mode: "new"; parentId: string | null };

/** The tag section's own state machine, parallel to the folder one above. */
type TagEditing = null | { mode: "new" } | { mode: "rename"; id: string };

interface FolderNode extends NoteFolder {
  children: FolderNode[];
}

/** sr-Latn collation — plain "sr" mis-tailors Latin š/č/ć. */
const collator = new Intl.Collator(["sr-Latn", "sr"]);

/** Turns the flat folder list into a name-sorted tree keyed by `parentId`. */
function buildTree(folders: NoteFolder[]): FolderNode[] {
  const byParent = new Map<string | null, NoteFolder[]>();
  for (const folder of folders) {
    const siblings = byParent.get(folder.parentId) ?? [];
    siblings.push(folder);
    byParent.set(folder.parentId, siblings);
  }
  const build = (parentId: string | null): FolderNode[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => collator.compare(a.name, b.name))
      .map((folder) => ({ ...folder, children: build(folder.id) }));
  return build(null);
}

export interface NoteOrganizerProps {
  profileId: string;
  folders: NoteFolder[];
  selection: FolderSelection;
  onSelect: (selection: FolderSelection) => void;
  /** Re-fetch folders and notes after a folder mutation (the store may have promoted children). */
  onChanged: () => void | Promise<void>;
  /** All tags for the profile; tag CRUD lives here, per-note attachment lives in the note-row menu. */
  tags: NoteTag[];
  /** Ids currently active in the (AND-semantics) tag filter, applied client-side by the page. */
  tagFilter: string[];
  /** Toggles a tag id in or out of the active filter. */
  onToggleTag: (id: string) => void;
  /** Clears the active tag filter. */
  onClearTagFilter: () => void;
  /** Re-fetch tags and links after a tag mutation. */
  onTagsChanged: () => void | Promise<void>;
}

/**
 * The NOTE organizer's left pane (slice a3b): "Sve beleške" / "Bez fascikle"
 * plus the nested folder tree, with inline create/rename/recolour/delete. A
 * folder's colour is one of the eight accent swatches (or none); selecting a
 * folder is typographic (gold name + weight), never a highlight bar. Deleting a
 * folder promotes its children in the store, so nothing is lost — the pane just
 * re-fetches. Below the tree, the Oznake (tags) section (slice a3b-2) lists
 * every tag as a filter chip with inline create/rename/delete; the active
 * filter is also typographic (gold text + weight), never a fill or glow.
 * Foldering/pinning/tagging of individual notes lives in the middle list.
 */
export function NoteOrganizer({
  profileId,
  folders,
  selection,
  onSelect,
  onChanged,
  tags,
  tagFilter,
  onToggleTag,
  onClearTagFilter,
  onTagsChanged,
}: NoteOrganizerProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const [draftName, setDraftName] = useState("");
  const [failed, setFailed] = useState(false);
  const [tagEditing, setTagEditing] = useState<TagEditing>(null);
  const [tagDraftName, setTagDraftName] = useState("");
  const [tagFailed, setTagFailed] = useState(false);

  const tree = buildTree(folders);
  const sortedTags = tags.slice().sort((a, b) => collator.compare(a.name, b.name));

  function cancel(): void {
    setEditing(null);
    setDraftName("");
  }

  function beginNew(parentId: string | null): void {
    setFailed(false);
    setDraftName("");
    setEditing({ mode: "new", parentId });
  }

  function beginRename(folder: NoteFolder): void {
    setFailed(false);
    setDraftName(folder.name);
    setEditing({ mode: "rename", id: folder.id });
  }

  async function run(action: () => Promise<void>): Promise<void> {
    try {
      setFailed(false);
      await action();
      cancel();
      await onChanged();
    } catch (error) {
      setFailed(true);
      console.error("Nexus: folder action failed:", error);
    }
  }

  function submitNew(parentId: string | null): void {
    const name = draftName.trim();
    if (name.length === 0) return;
    void run(() => window.nexus.createNoteFolder(profileId, { parentId, name, color: null }).then(() => undefined));
  }

  function submitRename(id: string): void {
    const name = draftName.trim();
    if (name.length === 0) return;
    void run(() => window.nexus.updateNoteFolder(profileId, id, { name }));
  }

  function recolor(id: string, color: NoteFolderColor | null): void {
    void run(() => window.nexus.updateNoteFolder(profileId, id, { color }));
  }

  function remove(id: string): void {
    void run(async () => {
      await window.nexus.deleteNoteFolder(profileId, id);
      if (selection.kind === "folder" && selection.id === id) onSelect({ kind: "all" });
    });
  }

  function cancelTag(): void {
    setTagEditing(null);
    setTagDraftName("");
  }

  function beginNewTag(): void {
    setTagFailed(false);
    setTagDraftName("");
    setTagEditing({ mode: "new" });
  }

  function beginRenameTag(tag: NoteTag): void {
    setTagFailed(false);
    setTagDraftName(tag.name);
    setTagEditing({ mode: "rename", id: tag.id });
  }

  async function runTag(action: () => Promise<void>): Promise<void> {
    try {
      setTagFailed(false);
      await action();
      cancelTag();
      await onTagsChanged();
    } catch (error) {
      setTagFailed(true);
      console.error("Nexus: tag action failed:", error);
    }
  }

  function submitNewTag(): void {
    const name = tagDraftName.trim();
    if (name.length === 0) return;
    void runTag(() => window.nexus.createNoteTag(profileId, name).then(() => undefined));
  }

  function submitRenameTag(id: string): void {
    const name = tagDraftName.trim();
    if (name.length === 0) return;
    void runTag(() => window.nexus.renameNoteTag(profileId, id, name));
  }

  function deleteTag(id: string): void {
    void runTag(() => window.nexus.deleteNoteTag(profileId, id));
  }

  const folderForm = (onSubmit: () => void): ReactNode => (
    <form
      className="note__folder-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <TextField
        value={draftName}
        onChange={(event) => setDraftName(event.target.value)}
        placeholder={strings.notes.folderNamePlaceholder}
        aria-label={strings.notes.folderNamePlaceholder}
        autoFocus
      />
      <div className="note__folder-form-actions">
        <Button type="submit" size="sm" variant="primary">
          {strings.notes.save}
        </Button>
        <Button type="button" size="sm" onClick={cancel}>
          {strings.notes.cancel}
        </Button>
      </div>
    </form>
  );

  const tagForm = (onSubmit: () => void): ReactNode => (
    <form
      className="note__folder-form note__tag-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <TextField
        value={tagDraftName}
        onChange={(event) => setTagDraftName(event.target.value)}
        placeholder={strings.notes.tagNamePlaceholder}
        aria-label={strings.notes.tagNamePlaceholder}
        autoFocus
      />
      <div className="note__folder-form-actions">
        <Button type="submit" size="sm" variant="primary">
          {strings.notes.save}
        </Button>
        <Button type="button" size="sm" onClick={cancelTag}>
          {strings.notes.cancel}
        </Button>
      </div>
    </form>
  );

  const renderFolder = (node: FolderNode, depth: number): ReactNode => {
    const isSelected = selection.kind === "folder" && selection.id === node.id;
    const isRenaming = editing !== null && editing.mode === "rename" && editing.id === node.id;
    const isRecoloring = editing !== null && editing.mode === "recolor" && editing.id === node.id;
    const isAddingChild = editing !== null && editing.mode === "new" && editing.parentId === node.id;
    const indent = { "--note-depth": depth } as CSSProperties;

    return (
      <Fragment key={node.id}>
        <div className="note__folder-row" style={indent}>
          {isRenaming ? (
            folderForm(() => submitRename(node.id))
          ) : (
            <>
              <button
                type="button"
                className={`note__folder${isSelected ? " note__folder--active" : ""}`}
                aria-current={isSelected ? "true" : undefined}
                onClick={() => onSelect({ kind: "folder", id: node.id })}
              >
                <span
                  className="note__folder-dot"
                  data-empty={node.color === null ? "true" : undefined}
                  style={node.color ? { background: `var(--nx-swatch-${node.color})` } : undefined}
                  aria-hidden="true"
                />
                <span className="note__folder-name">{node.name}</span>
              </button>
              <NotePopover label={strings.notes.folderMenuLabel}>
                {(close) => (
                  <>
                    <button
                      className="note__menu-item"
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        beginRename(node);
                        close();
                      }}
                    >
                      {strings.notes.renameFolder}
                    </button>
                    <button
                      className="note__menu-item"
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setFailed(false);
                        setEditing({ mode: "recolor", id: node.id });
                        close();
                      }}
                    >
                      {strings.notes.recolorFolder}
                    </button>
                    <button
                      className="note__menu-item"
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        beginNew(node.id);
                        close();
                      }}
                    >
                      {strings.notes.newSubfolder}
                    </button>
                    <button
                      className="note__menu-item note__menu-item--danger"
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        remove(node.id);
                        close();
                      }}
                    >
                      {strings.notes.deleteFolder}
                    </button>
                  </>
                )}
              </NotePopover>
            </>
          )}
        </div>

        {isRecoloring && (
          <div className="note__swatch-row" style={indent} role="group" aria-label={strings.notes.recolorFolder}>
            {ACCENT_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className={`note__swatch${node.color === id ? " note__swatch--selected" : ""}`}
                style={{ background: `var(--nx-swatch-${id})` }}
                aria-label={id}
                aria-pressed={node.color === id}
                onClick={() => recolor(node.id, id)}
              />
            ))}
            <button
              type="button"
              className="note__swatch note__swatch--none"
              aria-label={strings.notes.noColor}
              aria-pressed={node.color === null}
              onClick={() => recolor(node.id, null)}
            >
              ×
            </button>
          </div>
        )}

        {isAddingChild && (
          <div className="note__folder-row" style={{ "--note-depth": depth + 1 } as CSSProperties}>
            {folderForm(() => submitNew(node.id))}
          </div>
        )}

        {node.children.map((child) => renderFolder(child, depth + 1))}
      </Fragment>
    );
  };

  const addingRoot = editing !== null && editing.mode === "new" && editing.parentId === null;

  return (
    <div className="note__org-pane">
      <div className="note__folder-row">
        <button
          type="button"
          className={`note__folder note__folder--root${selection.kind === "all" ? " note__folder--active" : ""}`}
          aria-current={selection.kind === "all" ? "true" : undefined}
          onClick={() => onSelect({ kind: "all" })}
        >
          <span className="note__folder-name">{strings.notes.allNotes}</span>
        </button>
      </div>
      <div className="note__folder-row">
        <button
          type="button"
          className={`note__folder note__folder--root${selection.kind === "unfiled" ? " note__folder--active" : ""}`}
          aria-current={selection.kind === "unfiled" ? "true" : undefined}
          onClick={() => onSelect({ kind: "unfiled" })}
        >
          <span className="note__folder-name">{strings.notes.unfiled}</span>
        </button>
      </div>

      <div className="note__org-heading">{strings.notes.foldersLabel}</div>
      <div className="note__folder-tree">{tree.map((node) => renderFolder(node, 0))}</div>

      {addingRoot ? (
        <div className="note__folder-row">{folderForm(() => submitNew(null))}</div>
      ) : (
        <Button size="sm" className="note__new-folder" onClick={() => beginNew(null)}>
          {strings.notes.newFolder}
        </Button>
      )}

      {failed && (
        <p className="note__org-error" role="status">
          {strings.notes.folderError}
        </p>
      )}

      <div className="note__org-heading">
        <span>{strings.notes.tagsLabel}</span>
        {tagFilter.length > 0 && (
          <button type="button" className="note__tag-clear" onClick={onClearTagFilter}>
            {strings.notes.clearTagFilter}
          </button>
        )}
      </div>
      <div className="note__tag-row" role="group" aria-label={strings.notes.tagFilterLabel}>
        {sortedTags.map((tag) => {
          const isRenamingTag =
            tagEditing !== null && tagEditing.mode === "rename" && tagEditing.id === tag.id;
          if (isRenamingTag) {
            return <Fragment key={tag.id}>{tagForm(() => submitRenameTag(tag.id))}</Fragment>;
          }
          const active = tagFilter.includes(tag.id);
          return (
            <div key={tag.id} className="note__tag-item">
              <button
                type="button"
                className={`note__tag${active ? " note__tag--active" : ""}`}
                aria-pressed={active}
                onClick={() => onToggleTag(tag.id)}
              >
                {tag.name}
              </button>
              <NotePopover label={strings.notes.tagMenuLabel} triggerClassName="note__tag-menu">
                {(close) => (
                  <>
                    <button
                      className="note__menu-item"
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        beginRenameTag(tag);
                        close();
                      }}
                    >
                      {strings.notes.renameTag}
                    </button>
                    <button
                      className="note__menu-item note__menu-item--danger"
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        deleteTag(tag.id);
                        close();
                      }}
                    >
                      {strings.notes.deleteTag}
                    </button>
                  </>
                )}
              </NotePopover>
            </div>
          );
        })}
      </div>

      {tagEditing !== null && tagEditing.mode === "new" ? (
        // Wrapped in a row: the form inherits flex sizing meant for row axes,
        // which would stretch it vertically as a direct child of the column pane.
        <div className="note__tag-row">{tagForm(submitNewTag)}</div>
      ) : (
        <Button size="sm" className="note__new-tag" onClick={beginNewTag}>
          {strings.notes.newTag}
        </Button>
      )}

      {tagFailed && (
        <p className="note__org-error" role="status">
          {strings.notes.tagError}
        </p>
      )}
    </div>
  );
}
