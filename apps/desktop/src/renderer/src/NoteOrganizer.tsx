import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import { ACCENT_IDS } from "@nexus/tokens";
import { Button, TextField } from "@nexus/ui";
import type { NoteFolder, NoteFolderColor } from "../../shared/ipc.js";
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
}

/**
 * The NOTE organizer's left pane (slice a3b): "Sve beleške" / "Bez fascikle"
 * plus the nested folder tree, with inline create/rename/recolour/delete. A
 * folder's colour is one of the eight accent swatches (or none); selecting a
 * folder is typographic (gold name + weight), never a highlight bar. Deleting a
 * folder promotes its children in the store, so nothing is lost — the pane just
 * re-fetches. Foldering/pinning of individual notes lives in the middle list.
 */
export function NoteOrganizer({
  profileId,
  folders,
  selection,
  onSelect,
  onChanged,
}: NoteOrganizerProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const [draftName, setDraftName] = useState("");
  const [failed, setFailed] = useState(false);

  const tree = buildTree(folders);

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
    </div>
  );
}
