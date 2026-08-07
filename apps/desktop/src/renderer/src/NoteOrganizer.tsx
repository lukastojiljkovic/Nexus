import { Fragment, useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ACCENT_IDS } from "@nexus/tokens";
import { Button, Icon, TextField } from "@nexus/ui";
import type { NoteCategory, NoteFolder, NoteFolderColor, NoteTag } from "../../shared/ipc.js";
import { NotePopover } from "./notePopover.js";
import { mergeTemplateEntries, type TemplateEntry } from "./noteTemplates.js";
import { isDuplicateNameError } from "./storeErrors.js";
import { strings } from "./strings.js";
import { TypedConfirmDialog } from "./TypedConfirmDialog.js";

/** Which slice of notes the middle list shows: everything, only unfiled, or one folder. */
export type FolderSelection =
  | { kind: "all" }
  | { kind: "unfiled" }
  | { kind: "folder"; id: string };

type Editing =
  | null
  | { mode: "rename"; id: string }
  | { mode: "recolor"; id: string }
  // ADR-036: the default-template picker opens as a second-level row under the
  // folder, exactly like the colour swatches — the popover would otherwise have
  // to host a nested menu whose length grows with the profile's own templates.
  | { mode: "template"; id: string }
  | { mode: "new"; parentId: string | null };

/** The tag section's own state machine, parallel to the folder one above. */
type TagEditing = null | { mode: "new" } | { mode: "rename"; id: string };

/**
 * The category section's own state machine (NOTE-002). Closer to the FOLDER's
 * than to the tag's, because a category row is a folder row: it carries a
 * swatch, so it has a `recolor` mode the tags have no use for. It carries no
 * `parentId`, so it has no „new child" mode and never will.
 */
type CategoryEditing =
  | null
  | { mode: "new" }
  | { mode: "rename"; id: string }
  | { mode: "recolor"; id: string };

interface FolderNode extends NoteFolder {
  children: FolderNode[];
}

/**
 * The pane's own element id. A constant rather than a prop because the notes
 * page renders exactly one organizer: below 1345px that pane is a drawer, and
 * the „Fascikle" disclosure that opens it lives in the page header, too far
 * away to share a `useId`.
 */
export const NOTE_ORGANIZER_PANE_ID = "note-organizer";

/** sr-Latn collation — plain "sr" mis-tailors Latin š/č/ć. */
const collator = new Intl.Collator(["sr-Latn", "sr"]);

/**
 * Every id in one subtree, the node itself included — precisely the destinations
 * a move must not offer. `NoteOrgStore.moveFolder` refuses a self-move and a
 * descendant move anyway, but a menu that lists a destination and then fails is
 * a menu that lied: the refusal belongs where the choice is made.
 */
function subtreeIds(node: FolderNode): Set<string> {
  const ids = new Set<string>();
  const walk = (current: FolderNode): void => {
    ids.add(current.id);
    current.children.forEach(walk);
  };
  walk(node);
  return ids;
}

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
  /** All categories for the profile; category CRUD lives here, per-note assignment lives in the note-row menu. */
  categories: NoteCategory[];
  /** Ids currently active in the (OR-semantics) category filter, applied client-side by the page. */
  categoryFilter: string[];
  /** Toggles a category id in or out of the active filter. */
  onToggleCategory: (id: string) => void;
  /** Clears the active category filter. */
  onClearCategoryFilter: () => void;
  /** Re-fetch categories and notes after a category mutation (a delete uncategorizes its notes). */
  onCategoriesChanged: () => void | Promise<void>;
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
 *
 * Below the tags, Kategorije (NOTE-002) — the third axis. Its rows reuse the
 * FOLDER row's markup outright (swatch dot, name, „⋯" menu, the same inline
 * rename form and the same swatch picker), because a category is renamed and
 * recoloured by exactly the affordances a folder is; only its INDENT is
 * absent, since the list is flat. Selecting a category row toggles the filter
 * rather than navigating, so it is `aria-pressed` like a tag chip, not
 * `aria-current` like a folder.
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
  categories,
  categoryFilter,
  onToggleCategory,
  onClearCategoryFilter,
  onCategoriesChanged,
}: NoteOrganizerProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const [draftName, setDraftName] = useState("");
  const [failed, setFailed] = useState(false);
  const [tagEditing, setTagEditing] = useState<TagEditing>(null);
  const [tagDraftName, setTagDraftName] = useState("");
  /** The tag rail's error line — the SENTENCE, not a boolean, so a taken name can say which one. */
  const [tagFailed, setTagFailed] = useState<string | null>(null);
  const [categoryEditing, setCategoryEditing] = useState<CategoryEditing>(null);
  const [categoryDraftName, setCategoryDraftName] = useState("");
  /** The category rail's error line — the SENTENCE, not a boolean (see `tagFailed`). */
  const [categoryFailed, setCategoryFailed] = useState<string | null>(null);
  // Folder/tag/category deletes have no undo (unlike a note's) — the typed-name
  // confirmation is what the rest of the app substitutes for it (see PRIV's own
  // hard-delete). Closing the dialog fires the delete; a failure surfaces in
  // the section's existing `note__org-error` line below, exactly as a rename
  // or recolour failure already does.
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<NoteFolder | null>(null);
  const [pendingDeleteTag, setPendingDeleteTag] = useState<NoteTag | null>(null);
  const [pendingDeleteCategory, setPendingDeleteCategory] = useState<NoteCategory | null>(null);
  // The template picker's own list (ADR-036), through the same
  // `mergeTemplateEntries` the Šabloni pane and the slash menu read — built-ins
  // first, then this profile's rows sr-Latn sorted — so a folder's default is
  // named here exactly as it is named everywhere else.
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);

  const loadTemplates = useCallback(async () => {
    try {
      setTemplates(mergeTemplateEntries(await window.nexus.listNoteTemplates(profileId)));
    } catch (error) {
      console.error("Nexus: failed to load note templates:", error);
    }
  }, [profileId]);

  // Fetched whenever a picker OPENS rather than once on mount — the same
  // refresh-on-entry policy `NoteEditor` uses for the slash menu's list. The
  // Šabloni pane lives in the editor pane, so this component never unmounts
  // while a template is saved, renamed or deleted; without the refetch its list
  // would drift out of step with the profile's real templates.
  useEffect(() => {
    if (editing === null || editing.mode !== "template") return;
    void loadTemplates();
  }, [editing, loadTemplates]);

  const tree = buildTree(folders);
  const sortedTags = tags.slice().sort((a, b) => collator.compare(a.name, b.name));
  const sortedCategories = categories.slice().sort((a, b) => collator.compare(a.name, b.name));

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

  function chooseTemplate(id: string, templateId: string | null): void {
    void run(() => window.nexus.setNoteFolderTemplate(profileId, id, templateId));
  }

  /**
   * Toggles the profile's quick-capture mark (ADR-036). Passing `null` clears
   * it, so re-pressing the marked folder turns the feature off rather than
   * leaving the user with no way to unset it — the mark is a singleton, and
   * "move it elsewhere" cannot express "nowhere".
   */
  function toggleCapture(id: string, isCurrent: boolean): void {
    void run(() => window.nexus.setNoteFolderCaptureDefault(profileId, isCurrent ? null : id));
  }

  /**
   * Re-parents a folder (NOTE / `note-folders:move`). The channel, the handler,
   * the store method and its four tests all shipped with the folder tree and
   * **no surface ever called them**, so nesting was decided once, at creation:
   * a folder filed in the wrong place could only be deleted and rebuilt, and
   * deleting it promotes its children to the grandparent, which flattens the
   * subtree the user was trying to keep.
   *
   * A menu rather than a drag, unlike TASK's answer to the same problem. The
   * note row two panes over already moves a note by exactly this shape — a
   * „Premesti u fasciklu" heading over „Bez fascikle" and the flat folder list —
   * so a folder is moved by the affordance the user has already learned in this
   * module, and by one that a keyboard can reach.
   */
  function move(id: string, newParentId: string | null): void {
    void run(() => window.nexus.moveNoteFolder(profileId, id, newParentId));
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
    setTagFailed(null);
    setTagDraftName("");
    setTagEditing({ mode: "new" });
  }

  function beginRenameTag(tag: NoteTag): void {
    setTagFailed(null);
    setTagDraftName(tag.name);
    setTagEditing({ mode: "rename", id: tag.id });
  }

  async function runTag(action: () => Promise<void>): Promise<void> {
    try {
      setTagFailed(null);
      await action();
      cancelTag();
      await onTagsChanged();
    } catch (error) {
      // „Pokušaj ponovo" is the one action that fails identically forever
      // against a UNIQUE index, so a taken name says so instead. FIN has mapped
      // this exact refusal since its rail shipped; NOTE's never did.
      setTagFailed(isDuplicateNameError(error) ? strings.notes.tagDuplicate : strings.notes.tagError);
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

  function cancelCategory(): void {
    setCategoryEditing(null);
    setCategoryDraftName("");
  }

  async function runCategory(action: () => Promise<void>): Promise<void> {
    try {
      setCategoryFailed(null);
      await action();
      cancelCategory();
      await onCategoriesChanged();
    } catch (error) {
      setCategoryFailed(
        isDuplicateNameError(error)
          ? strings.notes.categoryDuplicate
          : strings.notes.categoryError,
      );
      console.error("Nexus: category action failed:", error);
    }
  }

  function beginNewCategory(): void {
    setCategoryFailed(null);
    setCategoryDraftName("");
    setCategoryEditing({ mode: "new" });
  }

  function beginRenameCategory(category: NoteCategory): void {
    setCategoryFailed(null);
    setCategoryDraftName(category.name);
    setCategoryEditing({ mode: "rename", id: category.id });
  }

  function submitNewCategory(): void {
    const name = categoryDraftName.trim();
    if (name.length === 0) return;
    void runCategory(() =>
      window.nexus.createNoteCategory(profileId, { name, color: null }).then(() => undefined),
    );
  }

  function submitRenameCategory(id: string): void {
    const name = categoryDraftName.trim();
    if (name.length === 0) return;
    void runCategory(() => window.nexus.updateNoteCategory(profileId, id, { name }));
  }

  function recolorCategory(id: string, color: NoteFolderColor | null): void {
    void runCategory(() => window.nexus.updateNoteCategory(profileId, id, { color }));
  }

  /**
   * Deleting a category never deletes a note — its notes simply become
   * uncategorized (migration 049's `ON DELETE SET NULL`). The filter is cleared
   * of the removed id by the page's own refetch, exactly as a deleted tag's is.
   */
  function removeCategory(id: string): void {
    void runCategory(() => window.nexus.deleteNoteCategory(profileId, id));
  }

  /**
   * The inline create/rename form — ONE recipe for all three sections, because
   * naming a folder, an oznaka and a kategorija is the same act with a
   * different word in the placeholder. `className` is the only thing a section
   * genuinely varies: the tag chips add `.note__tag-form`, whose
   * `flex-basis: 100%` makes the form take a whole wrap row instead of sitting
   * between two chips.
   */
  const nameForm = (spec: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    onSubmit: () => void;
    onCancel: () => void;
    className?: string;
  }): ReactNode => (
    <form
      className={`note__folder-form${spec.className === undefined ? "" : ` ${spec.className}`}`}
      onSubmit={(event) => {
        event.preventDefault();
        spec.onSubmit();
      }}
    >
      <TextField
        value={spec.value}
        onChange={(event) => spec.onChange(event.target.value)}
        placeholder={spec.placeholder}
        aria-label={spec.placeholder}
        autoFocus
      />
      <div className="note__folder-form-actions">
        <Button type="submit" size="sm" variant="primary">
          {strings.notes.save}
        </Button>
        <Button type="button" size="sm" onClick={spec.onCancel}>
          {strings.notes.cancel}
        </Button>
      </div>
    </form>
  );

  const folderForm = (onSubmit: () => void): ReactNode =>
    nameForm({
      value: draftName,
      onChange: setDraftName,
      placeholder: strings.notes.folderNamePlaceholder,
      onSubmit,
      onCancel: cancel,
    });

  const tagForm = (onSubmit: () => void): ReactNode =>
    nameForm({
      value: tagDraftName,
      onChange: setTagDraftName,
      placeholder: strings.notes.tagNamePlaceholder,
      onSubmit,
      onCancel: cancelTag,
      className: "note__tag-form",
    });

  /**
   * The eight accent swatches plus „Bez boje" — ONE recipe, used by the folder
   * tree and the category list alike, because a swatch picker is a swatch
   * picker: selection is a 2px text-coloured ring, never a fill or a glow.
   * `style` carries the folder's depth indent; a category is flat and passes
   * none.
   */
  const swatchRow = (
    current: NoteFolderColor | null,
    onPick: (color: NoteFolderColor | null) => void,
    label: string,
    style?: CSSProperties,
  ): ReactNode => (
    <div className="note__swatch-row" style={style} role="group" aria-label={label}>
      {ACCENT_IDS.map((id) => (
        <button
          key={id}
          type="button"
          className={`note__swatch${current === id ? " note__swatch--selected" : ""}`}
          style={{ background: `var(--nx-swatch-${id})` }}
          aria-label={id}
          aria-pressed={current === id}
          onClick={() => onPick(id)}
        />
      ))}
      <button
        type="button"
        className="note__swatch note__swatch--none"
        aria-label={strings.notes.noColor}
        aria-pressed={current === null}
        onClick={() => onPick(null)}
      >
        <Icon name="swatchNone" size={14} />
      </button>
    </div>
  );

  const categoryForm = (onSubmit: () => void): ReactNode =>
    nameForm({
      value: categoryDraftName,
      onChange: setCategoryDraftName,
      placeholder: strings.notes.categoryNamePlaceholder,
      onSubmit,
      onCancel: cancelCategory,
    });

  const renderCategory = (category: NoteCategory): ReactNode => {
    const isRenaming =
      categoryEditing !== null &&
      categoryEditing.mode === "rename" &&
      categoryEditing.id === category.id;
    const isRecoloring =
      categoryEditing !== null &&
      categoryEditing.mode === "recolor" &&
      categoryEditing.id === category.id;
    const active = categoryFilter.includes(category.id);

    return (
      <Fragment key={category.id}>
        <div className="note__folder-row">
          {isRenaming ? (
            categoryForm(() => submitRenameCategory(category.id))
          ) : (
            <>
              <button
                type="button"
                className={`note__folder${active ? " note__folder--active" : ""}`}
                // `aria-pressed`, not `aria-current`: this row filters the list
                // rather than navigating to a place, exactly like a tag chip.
                aria-pressed={active}
                onClick={() => onToggleCategory(category.id)}
              >
                <span
                  className="note__folder-dot"
                  data-empty={category.color === null ? "true" : undefined}
                  style={
                    category.color ? { background: `var(--nx-swatch-${category.color})` } : undefined
                  }
                  aria-hidden="true"
                />
                <span className="note__folder-name">{category.name}</span>
              </button>
              <NotePopover label={strings.notes.categoryMenuLabel}>
                {(close) => (
                  <>
                    <button
                      className="note__menu-item"
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        beginRenameCategory(category);
                        close();
                      }}
                    >
                      {strings.notes.renameCategory}
                    </button>
                    <button
                      className="note__menu-item"
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setCategoryFailed(null);
                        setCategoryEditing({ mode: "recolor", id: category.id });
                        close();
                      }}
                    >
                      {strings.notes.recolorCategory}
                    </button>
                    <div className="note__menu-sep" role="separator" />
                    <button
                      className="note__menu-item note__menu-item--danger"
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setPendingDeleteCategory(category);
                        close();
                      }}
                    >
                      {strings.notes.deleteCategory}
                    </button>
                  </>
                )}
              </NotePopover>
            </>
          )}
        </div>

        {isRecoloring &&
          swatchRow(
            category.color,
            (color) => recolorCategory(category.id, color),
            strings.notes.recolorCategory,
          )}
      </Fragment>
    );
  };

  const renderFolder = (node: FolderNode, depth: number): ReactNode => {
    const isSelected = selection.kind === "folder" && selection.id === node.id;
    const isRenaming = editing !== null && editing.mode === "rename" && editing.id === node.id;
    const isRecoloring = editing !== null && editing.mode === "recolor" && editing.id === node.id;
    const isPickingTemplate =
      editing !== null && editing.mode === "template" && editing.id === node.id;
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
                {node.isCaptureDefault && (
                  <span
                    className="note__folder-capture"
                    // `role="img"` so the glyph is announced by its label
                    // rather than read out as a character — a bare aria-label
                    // on a roleless span is not reliably exposed.
                    role="img"
                    title={strings.notes.folderCaptureDefaultOn}
                    aria-label={strings.notes.folderCaptureDefaultOn}
                  >
                    •
                  </span>
                )}
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
                    {/* „Premesti u" — the note row's own move menu, one axis
                        up. The destinations exclude this folder and everything
                        under it (`subtreeIds`), and „Na vrh" is left out when
                        the folder is already there, so every line offered is a
                        line that will work. */}
                    {(() => {
                      const forbidden = subtreeIds(node);
                      const destinations = folders
                        .filter((candidate) => !forbidden.has(candidate.id) && candidate.id !== node.parentId)
                        .sort((a, b) => collator.compare(a.name, b.name));
                      if (destinations.length === 0 && node.parentId === null) return null;
                      return (
                        <>
                          <div className="note__menu-sep" role="separator" />
                          <span className="note__menu-label">{strings.notes.moveFolderTo}</span>
                          {node.parentId !== null && (
                            <button
                              className="note__menu-item"
                              role="menuitem"
                              type="button"
                              onClick={() => {
                                move(node.id, null);
                                close();
                              }}
                            >
                              {strings.notes.folderToRoot}
                            </button>
                          )}
                          {destinations.map((destination) => (
                            <button
                              key={destination.id}
                              className="note__menu-item"
                              role="menuitem"
                              type="button"
                              onClick={() => {
                                move(node.id, destination.id);
                                close();
                              }}
                            >
                              {destination.name}
                            </button>
                          ))}
                        </>
                      );
                    })()}
                    <div className="note__menu-sep" role="separator" />
                    <button
                      className="note__menu-item"
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setFailed(false);
                        setEditing({ mode: "template", id: node.id });
                        close();
                      }}
                    >
                      {strings.notes.folderTemplate}
                    </button>
                    <button
                      className="note__menu-item note__menu-item--check"
                      role="menuitemcheckbox"
                      type="button"
                      aria-checked={node.isCaptureDefault}
                      onClick={() => {
                        toggleCapture(node.id, node.isCaptureDefault);
                        close();
                      }}
                    >
                      <span
                        className={`note__menu-check${node.isCaptureDefault ? "" : " note__menu-check--hidden"}`}
                        aria-hidden="true"
                      >
                        <Icon name="check" size={14} />
                      </span>
                      {strings.notes.folderCaptureDefault}
                    </button>
                    <div className="note__menu-sep" role="separator" />
                    <button
                      className="note__menu-item note__menu-item--danger"
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setPendingDeleteFolder(node);
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

        {isRecoloring &&
          swatchRow(
            node.color,
            (color) => recolor(node.id, color),
            strings.notes.recolorFolder,
            indent,
          )}

        {isPickingTemplate && (
          <div
            className="note__template-row"
            style={indent}
            role="group"
            aria-label={strings.notes.folderTemplate}
          >
            <button
              type="button"
              className={`note__template-option${
                node.defaultTemplateId === null ? " note__template-option--selected" : ""
              }`}
              aria-pressed={node.defaultTemplateId === null}
              onClick={() => chooseTemplate(node.id, null)}
            >
              {strings.notes.folderTemplateNone}
            </button>
            {templates.map((entry) => {
              const selected = node.defaultTemplateId === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`note__template-option${selected ? " note__template-option--selected" : ""}`}
                  aria-pressed={selected}
                  onClick={() => chooseTemplate(node.id, entry.id)}
                >
                  {entry.name}
                </button>
              );
            })}
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
    <div className="note__org-pane" id={NOTE_ORGANIZER_PANE_ID}>
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
                        setPendingDeleteTag(tag);
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

      {tagFailed !== null && (
        <p className="note__org-error" role="status">
          {tagFailed}
        </p>
      )}

      <div className="note__org-heading">
        <span>{strings.notes.categoriesLabel}</span>
        {categoryFilter.length > 0 && (
          <button type="button" className="note__tag-clear" onClick={onClearCategoryFilter}>
            {strings.notes.clearCategoryFilter}
          </button>
        )}
      </div>
      <div
        className="note__folder-tree"
        role="group"
        aria-label={strings.notes.categoryFilterLabel}
      >
        {sortedCategories.map(renderCategory)}
      </div>

      {categoryEditing !== null && categoryEditing.mode === "new" ? (
        <div className="note__folder-row">{categoryForm(submitNewCategory)}</div>
      ) : (
        <Button size="sm" className="note__new-folder" onClick={beginNewCategory}>
          {strings.notes.newCategory}
        </Button>
      )}

      {categoryFailed !== null && (
        <p className="note__org-error" role="status">
          {categoryFailed}
        </p>
      )}

      {pendingDeleteFolder !== null && (
        <TypedConfirmDialog
          title={strings.notes.deleteFolderDialog.title}
          name={pendingDeleteFolder.name}
          warning={strings.notes.deleteFolderDialog.warning}
          confirmLabel={strings.notes.deleteFolderDialog.confirmLabel}
          confirmPlaceholder={strings.notes.deleteFolderDialog.confirmPlaceholder}
          confirmValue={pendingDeleteFolder.name}
          submitLabel={strings.notes.deleteFolderDialog.submit}
          cancelLabel={strings.notes.deleteFolderDialog.cancel}
          danger
          onConfirm={() => {
            const folder = pendingDeleteFolder;
            setPendingDeleteFolder(null);
            remove(folder.id);
          }}
          onCancel={() => setPendingDeleteFolder(null)}
        />
      )}

      {pendingDeleteTag !== null && (
        <TypedConfirmDialog
          title={strings.notes.deleteTagDialog.title}
          name={pendingDeleteTag.name}
          warning={strings.notes.deleteTagDialog.warning}
          confirmLabel={strings.notes.deleteTagDialog.confirmLabel}
          confirmPlaceholder={strings.notes.deleteTagDialog.confirmPlaceholder}
          confirmValue={pendingDeleteTag.name}
          submitLabel={strings.notes.deleteTagDialog.submit}
          cancelLabel={strings.notes.deleteTagDialog.cancel}
          danger
          onConfirm={() => {
            const tag = pendingDeleteTag;
            setPendingDeleteTag(null);
            deleteTag(tag.id);
          }}
          onCancel={() => setPendingDeleteTag(null)}
        />
      )}

      {pendingDeleteCategory !== null && (
        <TypedConfirmDialog
          title={strings.notes.deleteCategoryDialog.title}
          name={pendingDeleteCategory.name}
          warning={strings.notes.deleteCategoryDialog.warning}
          confirmLabel={strings.notes.deleteCategoryDialog.confirmLabel}
          confirmPlaceholder={strings.notes.deleteCategoryDialog.confirmPlaceholder}
          confirmValue={pendingDeleteCategory.name}
          submitLabel={strings.notes.deleteCategoryDialog.submit}
          cancelLabel={strings.notes.deleteCategoryDialog.cancel}
          danger
          onConfirm={() => {
            const category = pendingDeleteCategory;
            setPendingDeleteCategory(null);
            removeCategory(category.id);
          }}
          onCancel={() => setPendingDeleteCategory(null)}
        />
      )}
    </div>
  );
}
