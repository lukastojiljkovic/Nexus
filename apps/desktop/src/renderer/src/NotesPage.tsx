import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import type { CardsViewConfig, CollectionSchema } from "@nexus/core";
import {
  Button,
  CardsView,
  Disclosure,
  EmptyState,
  Icon,
  LoadingState,
  PageHeader,
} from "@nexus/ui";
import type {
  NoteCardDisposition,
  NoteCategory,
  NoteChecklistTasksResult,
  NoteFolder,
  NoteFolderView,
  NoteMeta,
  NoteTag,
  NoteTagLink,
} from "../../shared/ipc.js";
import { NoteCardsDeleteDialog } from "./NoteCardsDeleteDialog.js";
import { NoteChecklistTasksDialog } from "./NoteChecklistTasksDialog.js";
import { NoteEditor } from "./NoteEditor.js";
import { NOTE_ORGANIZER_PANE_ID, NoteOrganizer, type FolderSelection } from "./NoteOrganizer.js";
import { NoteRhythm, localDayOf } from "./NoteRhythm.js";
import { persistOverviewOpen, readStoredOverviewOpen } from "./overviewPrefs.js";
import { PRIV_LOCKED_EVENT } from "./privEvents.js";
import { TypedConfirmDialog } from "./TypedConfirmDialog.js";
import { localTodayKey, shiftDayKey } from "./examDates.js";
import { collator, dateTimeFormat } from "./intl.js";
import { formatClockTime } from "./timeFormat.js";
import { formatNotificationWhen } from "./notificationFormat.js";
import { NotePopover } from "./notePopover.js";
import { persistRootNoteView, readStoredRootNoteView } from "./notePrefs.js";
import { moduleName } from "./moduleName.js";
import { mergeTemplateEntries } from "./noteTemplates.js";
import { countUnit, strings } from "./strings.js";

/**
 * What „Pretvori u zadatke" made, as one Serbian line: „Napravljeno 3 zadatka,
 * od toga 1 već završen. Preskočeno 2 prazna reda." Every counted noun goes
 * through `countUnit` (1 / 2–4 / 5+), and a clause whose count is zero is left
 * out entirely — a run that skipped nothing must not say so.
 */
function formatChecklistResult(result: NoteChecklistTasksResult): string {
  const s = strings.notes.checklistTasks;
  const created = `${s.createdPrefix} ${result.created} ${countUnit(
    result.created,
    s.createdUnitOne,
    s.createdUnitFew,
    s.createdUnitMany,
  )}`;
  const completed =
    result.completed === 0
      ? ""
      : `, ${s.completedPrefix} ${result.completed} ${countUnit(
          result.completed,
          s.completedUnitOne,
          s.completedUnitFew,
          s.completedUnitMany,
        )}`;
  const skipped =
    result.skipped === 0
      ? ""
      : ` ${s.skippedPrefix} ${result.skipped} ${countUnit(
          result.skipped,
          s.skippedUnitOne,
          s.skippedUnitFew,
          s.skippedUnitMany,
        )}.`;
  return `${created}${completed}.${skipped}`;
}

/** Note-list date: compact day + month in the active locale, degrading to the raw value. */
function formatNoteDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : dateTimeFormat({ day: "2-digit", month: "short" }).format(date);
}

/**
 * A month group's own name — „jul 2026." in Serbian, "July 2026" in English —
 * for everything older than the current one.
 *
 * `timeZone: "UTC"` is load-bearing rather than tidy: the key it formats is a
 * bare `YYYY-MM`, read back as UTC midnight of the first, and in any zone
 * behind UTC that instant is the LAST day of the previous month locally. The
 * group would then be headed with the wrong month for every user west of
 * Greenwich. `NoteRhythm`'s cell formatter pins the zone for exactly this
 * reason.
 */
/** The buckets the note list is cut into, widest-window last. */
type NoteGroupKind = "pinned" | "today" | "yesterday" | "week" | "month" | "older";

interface NoteGroup {
  /**
   * React key. It carries the run's INDEX as well as its bucket, so two runs of
   * one bucket could not collide even if the store's ordering ever changed —
   * see the note in `groupNotes`.
   */
  key: string;
  /** Bucket identity, which is what decides whether a note joins the open run. */
  bucket: string;
  kind: NoteGroupKind;
  /**
   * `YYYY-MM` for `older`, the empty string otherwise — never optional, so no
   * call site has to test for absence before formatting it.
   */
  monthKey: string;
  notes: NoteMeta[];
}

/**
 * The visible notes, cut into the sticky groups the list pane draws.
 *
 * THIS NEVER REORDERS ANYTHING, and that is what makes it safe. `listNotes`
 * answers `ORDER BY pinned DESC, updated_at DESC, id DESC`, so every bucket
 * below is already CONTIGUOUS in the array: the walk opens a new group when the
 * key changes and appends otherwise. Bucketing into a map and re-emitting would
 * have produced the same headings and a different order inside them.
 *
 * The tests run narrowest-window first, so the first that matches is the most
 * specific true statement about the note. `day >= today` rather than `===`
 * catches a stamp from a skewed clock: a note „from tomorrow" belongs under
 * „Danas", not silently under „Poslednjih 7 dana".
 */
function groupNotes(notes: readonly NoteMeta[], today: string): NoteGroup[] {
  const yesterday = shiftDayKey(today, -1);
  // Seven days INCLUDING today, so this bucket picks up exactly what „danas"
  // and „juče" have not already taken.
  const weekStart = shiftDayKey(today, -6);
  const thisMonth = today.slice(0, 7);
  const groups: NoteGroup[] = [];
  for (const note of notes) {
    const day = localDayOf(note.updatedAt);
    const kind: NoteGroupKind = note.pinned
      ? "pinned"
      : day >= today
        ? "today"
        : day === yesterday
          ? "yesterday"
          : day >= weekStart
            ? "week"
            : day.slice(0, 7) === thisMonth
              ? "month"
              : "older";
    const monthKey = kind === "older" ? day.slice(0, 7) : "";
    const bucket = kind === "older" ? `older:${monthKey}` : kind;
    const last = groups[groups.length - 1];
    if (last !== undefined && last.bucket === bucket) {
      last.notes.push(note);
      continue;
    }
    // The React key is the bucket AND the run index. Contiguity makes a second
    // run of one bucket impossible under the store's ordering; this makes a
    // duplicate key impossible under ANY ordering, which is the version of the
    // guarantee that does not depend on a `ORDER BY` in another package.
    groups.push({
      key: `${bucket}#${String(groups.length)}`,
      bucket,
      kind,
      monthKey,
      notes: [note],
    });
  }
  return groups;
}

/** A group's heading. Every bucket but the per-month ones is a fixed phrase. */
function groupLabel(group: NoteGroup): string {
  switch (group.kind) {
    case "pinned":
      return strings.notes.listGroups.pinned;
    case "today":
      return strings.notes.listGroups.today;
    case "yesterday":
      return strings.notes.listGroups.yesterday;
    case "week":
      return strings.notes.listGroups.week;
    case "month":
      return strings.notes.listGroups.month;
    case "older":
      return dateTimeFormat({ month: "long", year: "numeric", timeZone: "UTC" }).format(
        new Date(`${group.monthKey}-01T00:00:00Z`),
      );
  }
}

/**
 * A row's own timestamp, given the group it sits in.
 *
 * Inside „Danas" and „Juče" the heading has already said the day, so printing
 * it again on every row would be the same four characters repeated down a
 * column — the rule against a constant word in a list. The row says the HOUR
 * there instead, which is strictly more than the date it replaces. Every other
 * bucket spans several days, so there the date is the informative half.
 */
function rowTimestamp(note: NoteMeta, kind: NoteGroupKind): string {
  return kind === "today" || kind === "yesterday"
    ? formatClockTime(note.updatedAt)
    : formatNoteDate(note.updatedAt);
}

/**
 * The two shapes the middle pane can draw, in toggle order (NOTE-002). A
 * function, not a module-scope const, so a language switch relabels the
 * toggle the next time it renders instead of freezing it at import.
 */
function viewOptions(): readonly { value: NoteFolderView; label: string }[] {
  return [
    { value: "list", label: strings.notes.viewNames.list },
    { value: "cards", label: strings.notes.viewNames.cards },
  ];
}

/**
 * `NoteMeta` through a structurally identical mapped type — `CardsView`'s bound
 * is `Record<string, unknown>`, which an interface does not satisfy but a mapped
 * type does (the `TaskFields` arrangement, TasksPage).
 */
type NoteFields = { [K in keyof NoteMeta]: NoteMeta[K] };

/**
 * The note fields the views engine could order by. Declared because `CardsView`
 * takes a schema, not because anything sorts through it: the config below
 * carries NO sort spec, so `applySort` returns its input untouched and the cards
 * land in exactly the order `listNotes` handed over — pinned first, then most
 * recently touched. That order is the feature, and re-deriving it from a sort
 * spec would be one place for the two views to disagree.
 */
const NOTE_SCHEMA: CollectionSchema = {
  fields: [
    { key: "title", type: "text" },
    { key: "pinned", type: "boolean" },
    { key: "createdAt", type: "date" },
    { key: "updatedAt", type: "date" },
  ],
};

/**
 * No sort, no filters. The tag filter has already narrowed the array by the time
 * it reaches a view (a filter is what the pane SHOWS), and the view is only how
 * the pane DRAWS it — which is why a tag-filtered or search-revealed pane
 * renders as cards exactly as an unfiltered one does.
 */
const CARDS_CONFIG: CardsViewConfig = { type: "cards" };

/** The `listNotes` filter for a folder selection: `undefined` = all, else scoped. */
function filterFor(selection: FolderSelection): { folderId?: string | null } | undefined {
  switch (selection.kind) {
    case "all":
      return undefined;
    case "unfiled":
      return { folderId: null };
    case "folder":
      return { folderId: selection.id };
  }
}

/** A pending deep-link target (021-e): reveal one note, or create a fresh one. Also backs the STUDY -> a note cross-module link (ADR-017), the app's first. */
export type NotesIntent = { kind: "reveal"; noteId: string } | { kind: "create" };

export interface NotesPageProps {
  profileId: string;
  intent?: NotesIntent | null;
  /** Reports that `intent` above has been acted on, so the caller (App.tsx) can clear it. */
  onIntentHandled?: () => void;
}

/**
 * The NOTE module page (slice a3b, tags in a3b-2): a three-pane workspace —
 * the folder organizer (left, also hosting the tag filter and tag CRUD), the
 * note list filtered by folder then narrowed client-side by the tag filter and
 * ordered pinned-first (middle), and the block editor for the selected note
 * (right). Folders, pinning, foldering, and tagging all go through the note
 * organization IPC allowlist; the editor owns the live Yjs doc, main owns
 * storage. Writes are await-then-refetch (never optimistic), the house style.
 *
 * The middle pane draws in one of two shapes (NOTE-002): the rows above, or the
 * views engine's `CardsView`. Which one is a property of the SELECTION — a
 * folder remembers its own on its row, the root in a device preference — and
 * never of what the pane is currently showing, so a tag-filtered or a
 * search-revealed pane renders in exactly the shape an unfiltered one does.
 */
export function NotesPage({ profileId, intent, onIntentHandled }: NotesPageProps) {
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [selection, setSelection] = useState<FolderSelection>({ kind: "all" });
  // Below 1345px the organizer is a drawer over the list rather than a column
  // (see `.note` in app.css). The state exists at every width; above the
  // breakpoint the pane is a column and CSS ignores it, toggle included.
  const [organizerOpen, setOrganizerOpen] = useState(false);
  // Read once, at mount: the stored value is this machine's answer, and
  // re-reading it on every render would let a second window's write change
  // this page under the reader mid-session.
  const [overviewOpen, setOverviewOpen] = useState(() => readStoredOverviewOpen("notes"));
  const organizerToggleRef = useRef<HTMLButtonElement>(null);
  const [notes, setNotes] = useState<NoteMeta[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The delete that can still be taken back, and whether it took the note's
  // generated cards with it — the undo bar names what it would bring back.
  const [pendingUndo, setPendingUndo] = useState<{ id: string; withCards: boolean } | null>(null);
  // The note whose generated cards need a decision before it can be deleted
  // (PRD 09 §7); null whenever nothing is being asked.
  const [pendingDelete, setPendingDelete] = useState<{ note: NoteMeta; cardCount: number } | null>(
    null,
  );
  // Why the last „Dupliraj" did not produce a copy, or null when nothing is
  // wrong — the transient error line the folder/tag panes already use.
  const [duplicateError, setDuplicateError] = useState<"generic" | "tooLarge" | null>(null);
  // The note whose checklist is being converted (NOTE §6), with the row count
  // the probe returned; null whenever nothing is being asked.
  const [pendingChecklist, setPendingChecklist] = useState<
    { note: NoteMeta; itemCount: number } | null
  >(null);
  // What the last „Pretvori u zadatke" has to say — the counts it made, that the
  // note had no checklist at all, or that it failed. One slot, because the three
  // are the same line in the same place.
  const [checklistNotice, setChecklistNotice] = useState<
    { kind: "done"; result: NoteChecklistTasksResult } | { kind: "empty" } | { kind: "error" } | null
  >(null);
  const [tags, setTags] = useState<NoteTag[]>([]);
  const [links, setLinks] = useState<NoteTagLink[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [categories, setCategories] = useState<NoteCategory[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  // ADR-036's create-then-apply hand-off: the blocks a freshly created note
  // should open with, tagged with the note they belong to so a slow round trip
  // can never drop them into whichever note happens to be selected by then.
  const [pendingTemplate, setPendingTemplate] = useState<
    { noteId: string; blocks: JSONContent[] } | null
  >(null);
  // The ROOT's shape (NOTE-002) — "Sve beleške" and "Bez fascikle", the two
  // selections with no folder row to remember one in. Read once from the device
  // preference; a folder's own shape comes off its row instead.
  const [rootView, setRootView] = useState<NoteFolderView>(readStoredRootNoteView);
  // Whether the PRIVATE section is unlocked right now (ADR-057 §5): the one
  // fact that decides whether „Premesti u Privatno" appears in the row menu.
  // Re-read on focus and on the panic shortcut's event — the section locks
  // underneath this page exactly as it locks underneath its own.
  const [privUnlocked, setPrivUnlocked] = useState(false);
  // The note whose move into the private section awaits its typed confirm.
  const [pendingMoveIn, setPendingMoveIn] = useState<NoteMeta | null>(null);
  const [moveInError, setMoveInError] = useState<string | null>(null);
  const [movingIn, setMovingIn] = useState(false);

  const loadFolders = useCallback(async () => {
    try {
      setFolders(await window.nexus.listNoteFolders(profileId));
    } catch (error) {
      console.error("Nexus: failed to load folders:", error);
    }
  }, [profileId]);

  const loadNotes = useCallback(async () => {
    try {
      const filter = filterFor(selection);
      const list =
        filter === undefined
          ? await window.nexus.listNotes(profileId)
          : await window.nexus.listNotes(profileId, filter);
      setNotes(list);
      setFailed(false);
      // A refused „Dupliraj" changes nothing and therefore never refetches, so
      // its line survives until the pane genuinely moves on — any other note
      // action, or a change of folder. „Pretvori u zadatke" writes only TASK
      // rows, so its line lives by exactly the same rule.
      setDuplicateError(null);
      setChecklistNotice(null);
    } catch (error) {
      setFailed(true);
      console.error("Nexus: failed to load notes:", error);
    }
  }, [profileId, selection]);

  // Fetches tags and links together, then prunes the active filter of ids the
  // profile no longer has — deleting a tag can never leave a ghost filter.
  const loadTags = useCallback(async () => {
    try {
      const [tagList, linkList] = await Promise.all([
        window.nexus.listNoteTags(profileId),
        window.nexus.listNoteTagLinks(profileId),
      ]);
      setTags(tagList);
      setLinks(linkList);
      const validIds = new Set(tagList.map((tag) => tag.id));
      setTagFilter((current) => current.filter((id) => validIds.has(id)));
    } catch (error) {
      console.error("Nexus: failed to load tags:", error);
    }
  }, [profileId]);

  // Fetches categories, then prunes the active filter of ids the profile no
  // longer has — deleting a category can never leave a ghost filter, exactly as
  // `loadTags` guarantees for a deleted tag.
  const loadCategories = useCallback(async () => {
    try {
      const list = await window.nexus.listNoteCategories(profileId);
      setCategories(list);
      const validIds = new Set(list.map((category) => category.id));
      setCategoryFilter((current) => current.filter((id) => validIds.has(id)));
    } catch (error) {
      console.error("Nexus: failed to load categories:", error);
    }
  }, [profileId]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  /**
   * Escape puts the drawer away, and the „Fascikle" button takes focus back.
   *
   * The guard is not defensive coding, it is the whole rule: a folder menu and
   * a typed-name confirmation both portal to `<body>`, so neither is a DOM
   * descendant of the drawer, and `useAnchoredPosition` closes ITS panel from a
   * document listener of its own. Two listeners see the same keystroke, and the
   * innermost surface has to be the one that closes — asking the document
   * whether such a surface is present is what distinguishes them, because by
   * the time this runs the other one has not re-rendered yet.
   */
  useEffect(() => {
    if (!organizerOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (document.querySelector('[role="dialog"], .note__menu-panel') !== null) return;
      setOrganizerOpen(false);
      organizerToggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [organizerOpen]);

  // `priv:status` answers facts, never contents, so this is safe while locked.
  useEffect(() => {
    let active = true;
    const check = () => {
      void window.nexus
        .privStatus(profileId)
        .then((status) => {
          if (active) setPrivUnlocked(status.unlocked);
        })
        .catch((error: unknown) => {
          console.error("Nexus: failed to read the private section's status:", error);
        });
    };
    check();
    window.addEventListener("focus", check);
    window.addEventListener(PRIV_LOCKED_EVENT, check);
    return () => {
      active = false;
      window.removeEventListener("focus", check);
      window.removeEventListener(PRIV_LOCKED_EVENT, check);
    };
  }, [profileId]);

  // Consumes a pending deep-link (021-e): "create" starts a fresh note;
  // "reveal" (also the STUDY -> a note cross-module link, ADR-017) selects an
  // existing one and resets both filters to "all"/none — otherwise the note
  // opens in the editor pane while an active folder/tag filter leaves the
  // middle pane showing no matching row.
  useEffect(() => {
    if (!intent) return;
    if (intent.kind === "create") {
      // `create()` is async (it awaits the IPC round trip and refetches), but
      // the intent is reported handled right away — the caller only needs to
      // know it was consumed, not that the note has finished being created.
      // `withoutContext`: this create came from the palette (021-e), so the
      // quick-capture folder, not the organizer's selection, is its home.
      void create({ withoutContext: true });
      onIntentHandled?.();
      return;
    }
    setSelectedId(intent.noteId);
    setSelection({ kind: "all" });
    setTagFilter([]);
    setCategoryFilter([]);
    onIntentHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, onIntentHandled]);

  // Stable identity on purpose: it ends up in the dep array of the canvas's
  // apply-effect, which inserts blocks. A callback that changed identity on
  // every render would put a re-fire of that effect one stray re-render away
  // from appending the same template twice.
  const clearPendingTemplate = useCallback(() => setPendingTemplate(null), []);

  // A folder mutation may have promoted children/notes — refetch both panes.
  const onFoldersChanged = useCallback(async () => {
    await loadFolders();
    await loadNotes();
  }, [loadFolders, loadNotes]);

  const tagsByNote = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of links) {
      const set = map.get(link.noteId) ?? new Set<string>();
      set.add(link.tagId);
      map.set(link.noteId, set);
    }
    return map;
  }, [links]);

  /**
   * Folder scoping already happened via IPC; the two client-side filters narrow
   * further, and they narrow DIFFERENTLY on purpose.
   *
   * The tag filter ANDs — a note must carry every selected tag — because a note
   * carries many tags and "ideja AND arhiva" is a question with answers. The
   * category filter ORs, because a note has exactly ONE category: ANDing two of
   * them could only ever produce an empty list, so the same gesture that is a
   * useful narrowing for tags would be a dead end for categories. The two
   * filters then AND with EACH OTHER, which is what makes „sastanak or dnevnik,
   * tagged hitno" expressible at all.
   */
  const visibleNotes = useMemo(() => {
    if (notes === null) return [];
    return notes.filter(
      (note) =>
        tagFilter.every((id) => tagsByNote.get(note.id)?.has(id)) &&
        (categoryFilter.length === 0 ||
          (note.categoryId !== null && categoryFilter.includes(note.categoryId))),
    );
  }, [notes, tagFilter, tagsByNote, categoryFilter]);

  function onToggleTag(id: string): void {
    setTagFilter((current) =>
      current.includes(id) ? current.filter((tagId) => tagId !== id) : [...current, id],
    );
  }

  function onClearTagFilter(): void {
    setTagFilter([]);
  }

  function onToggleCategory(id: string): void {
    setCategoryFilter((current) =>
      current.includes(id) ? current.filter((categoryId) => categoryId !== id) : [...current, id],
    );
  }

  function onClearCategoryFilter(): void {
    setCategoryFilter([]);
  }

  /**
   * Both filter axes at once — the way back out of an empty result.
   *
   * The rail's two „Poništi" links each clear one axis, and they are the only
   * ones that exist; below 1345px the rail is a drawer that is closed by
   * default, so a list emptied by a filter had no reachable undo at all. This
   * sits ON the empty state, where the dead end is.
   */
  function clearNoteFilters(): void {
    setTagFilter([]);
    setCategoryFilter([]);
  }

  /** Deleting a category uncategorizes its notes, so the list has to be refetched with the categories. */
  const onCategoriesChanged = useCallback(async () => {
    await loadCategories();
    await loadNotes();
  }, [loadCategories, loadNotes]);

  /** Sets (or clears) what KIND a note is — exactly one, so this replaces rather than adds. */
  async function setNoteCategory(note: NoteMeta, categoryId: string | null): Promise<void> {
    try {
      await window.nexus.setNoteCategory(profileId, note.id, categoryId);
      await loadNotes();
    } catch (error) {
      console.error("Nexus: failed to set a note's category:", error);
    }
  }

  async function toggleNoteTag(note: NoteMeta, tagId: string, attached: boolean): Promise<void> {
    try {
      if (attached) {
        await window.nexus.detachNoteTag(profileId, note.id, tagId);
      } else {
        await window.nexus.attachNoteTag(profileId, note.id, tagId);
      }
      await loadTags();
    } catch (error) {
      console.error("Nexus: failed to toggle note tag:", error);
    }
  }

  /**
   * Resolves a folder's default template to the blocks to append (ADR-036), or
   * null when there is nothing to apply.
   *
   * The template list is fetched here, at create time, rather than held in
   * state: one more round trip on a path that already makes several, and always
   * current — which is also what implements ADR-036's dangling-id rule for
   * free. An id whose template has since been deleted simply matches no entry,
   * and the note is created blank instead of the folder refusing to create it.
   */
  async function templateBlocksFor(folder: NoteFolder | undefined): Promise<JSONContent[] | null> {
    if (folder?.defaultTemplateId == null) return null;
    try {
      const entries = mergeTemplateEntries(await window.nexus.listNoteTemplates(profileId));
      const entry = entries.find((candidate) => candidate.id === folder.defaultTemplateId);
      const blocks = entry?.content?.content ?? null;
      return blocks !== null && blocks.length > 0 ? blocks : null;
    } catch (error) {
      // A template that cannot be read must never cost the user their note.
      console.error("Nexus: failed to resolve a folder's default template:", error);
      return null;
    }
  }

  /**
   * Creates a note and files it, then hands its folder's default template to
   * the editor (ADR-036 — the two features compose: the capture folder's
   * template applies just as any other folder's does).
   *
   * `withoutContext` is what the palette's "Nova beleška" passes: that command
   * is issued from the palette, not from the organizer, so it has no selected
   * folder to mean anything — which is exactly the case the quick-capture mark
   * exists for. The in-page button never passes it, so creating under "Sve
   * beleške" or "Bez fascikle" stays blank and unfiled, as before.
   */
  async function create(options: { withoutContext?: boolean } = {}): Promise<void> {
    try {
      // Read fresh rather than from `folders` state: a palette create (021-e)
      // can land on a NotesPage that is still mounting, whose folder state is
      // therefore an empty array — and silently ignoring the quick-capture
      // folder because a fetch had not returned yet is exactly the kind of
      // "works except when it matters" this feature cannot afford.
      const current = await window.nexus.listNoteFolders(profileId);
      const captureFolder = options.withoutContext
        ? current.find((folder) => folder.isCaptureDefault)
        : undefined;
      const targetId = captureFolder?.id ?? (selection.kind === "folder" ? selection.id : null);

      const created = await window.nexus.createNote(profileId);
      if (targetId !== null) {
        await window.nexus.setNoteFolder(profileId, created.id, targetId);
      }
      // The capture folder is not necessarily the one on screen, and a note the
      // middle list filters away reads as a create that did nothing — so the
      // pane follows the note, the same reasoning the "reveal" intent uses when
      // it resets both filters.
      if (captureFolder !== undefined) {
        setSelection({ kind: "folder", id: captureFolder.id });
        setTagFilter([]);
        // A fresh note is uncategorized, so an active category filter would
        // hide the very note the capture just made.
        setCategoryFilter([]);
      }

      const blocks = await templateBlocksFor(
        current.find((folder) => folder.id === targetId),
      );
      setPendingTemplate(blocks === null ? null : { noteId: created.id, blocks });
      setSelectedId(created.id);
      await loadNotes();
    } catch (error) {
      console.error("Nexus: failed to create note:", error);
    }
  }

  /**
   * Deleting a note asks what becomes of the flashcards it generated (PRD 09
   * §7) — but only when there are any. A note that generated none is deleted
   * on the spot, exactly as it always was: no dialog, no new friction.
   *
   * A failed count leaves the note alone rather than guessing a disposition:
   * the two answers do different things to the user's review history, which is
   * precisely why they are asked for.
   */
  async function remove(note: NoteMeta): Promise<void> {
    try {
      const cardCount = await window.nexus.countNoteCards(profileId, note.id);
      if (cardCount === 0) {
        await performDelete(note, "keep");
        return;
      }
      setPendingDelete({ note, cardCount });
    } catch (error) {
      console.error("Nexus: failed to count a note's cards:", error);
    }
  }

  async function performDelete(note: NoteMeta, cards: NoteCardDisposition): Promise<void> {
    try {
      await window.nexus.deleteNote(profileId, note.id, cards);
      if (selectedId === note.id) setSelectedId(null);
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndo({ id: note.id, withCards: cards === "delete" });
      await loadNotes();
    } catch (error) {
      console.error("Nexus: failed to delete note:", error);
    }
  }

  /**
   * Undo of the whole act: main restores the note and, when the cards went
   * with it, exactly those cards — matched on the stamp that delete wrote, so
   * cards an earlier edit removed stay removed. Cards the user chose to KEEP
   * are deliberately never touched here: keeping them was the point, and the
   * note comes back unmapped from its deck so it cannot regenerate copies of
   * them.
   */
  async function undo(): Promise<void> {
    if (!pendingUndo) return;
    try {
      await window.nexus.restoreNote(profileId, pendingUndo.id);
      setPendingUndo(null);
      await loadNotes();
    } catch (error) {
      console.error("Nexus: failed to restore note:", error);
    }
  }

  /**
   * „Dupliraj" (NOTE-010). Main does the whole copy in one transaction; the
   * page's job afterwards is to make it findable — the tag links moved too, so
   * both fetches are refreshed before the copy is selected, otherwise an active
   * tag filter would hide the note that was just made.
   *
   * The copy lands in the source's folder and carries its tags, so the current
   * selection always contains it — no filter reset, unlike the „reveal" intent.
   */
  async function duplicate(note: NoteMeta): Promise<void> {
    try {
      const result = await window.nexus.duplicateNote(profileId, note.id);
      if (!result.ok) {
        setDuplicateError("tooLarge");
        return;
      }
      await Promise.all([loadNotes(), loadTags()]);
      setSelectedId(result.note.id);
    } catch (error) {
      setDuplicateError("generic");
      console.error("Nexus: failed to duplicate note:", error);
    }
  }

  /**
   * „Pretvori u zadatke" (NOTE §6), asked from the ROW menu rather than from
   * inside the editor: main reads the note's own stored document, so the action
   * needs no open editor to work from, and putting it beside Dupliraj/Obriši
   * keeps every note-level action in one place instead of splitting them across
   * two surfaces.
   *
   * Probed first, exactly as „Obriši" probes the note's card count: a note with
   * no checklist is told so on the spot rather than being handed a list picker
   * whose only possible outcome is „Napravljeno 0 zadataka".
   */
  async function convertChecklist(note: NoteMeta): Promise<void> {
    try {
      const itemCount = await window.nexus.countNoteChecklistItems(profileId, note.id);
      if (itemCount === 0) {
        setChecklistNotice({ kind: "empty" });
        return;
      }
      setChecklistNotice(null);
      setPendingChecklist({ note, itemCount });
    } catch (error) {
      setChecklistNotice({ kind: "error" });
      console.error("Nexus: failed to count a note's checklist:", error);
    }
  }

  /**
   * The write itself. Nothing on this page changes — the note is untouched and
   * the tasks live in the TASK module — so there is no refetch, and the result
   * line is the whole feedback.
   */
  async function performChecklistConversion(note: NoteMeta, listId: string): Promise<void> {
    try {
      const result = await window.nexus.convertNoteChecklistToTasks(profileId, note.id, listId);
      setChecklistNotice({ kind: "done", result });
    } catch (error) {
      setChecklistNotice({ kind: "error" });
      console.error("Nexus: failed to convert a note's checklist:", error);
    }
  }

  /**
   * „Premesti u Privatno" (ADR-057 §5), after its typed confirm: main does the
   * whole transaction — seal, hard delete, FTS scrub, attachment migration.
   * On success the note is simply GONE from this page, which is the point;
   * both refusals leave everything untouched and are told apart by name.
   */
  async function performMoveIn(note: NoteMeta): Promise<void> {
    setMovingIn(true);
    setMoveInError(null);
    try {
      const result = await window.nexus.privMoveIn(profileId, note.id);
      if (!result.ok) {
        setMoveInError(
          result.reason === "too-large"
            ? strings.notes.moveToPriv.tooLarge
            : strings.notes.moveToPriv.tooManyAttachments,
        );
        return;
      }
      if (selectedId === note.id) setSelectedId(null);
      setPendingMoveIn(null);
      await Promise.all([loadNotes(), loadTags()]);
    } catch (error) {
      setMoveInError(strings.notes.moveToPriv.error);
      console.error("Nexus: failed to move a note into the private section:", error);
    } finally {
      setMovingIn(false);
    }
  }

  async function togglePin(note: NoteMeta): Promise<void> {
    try {
      await window.nexus.setNotePinned(profileId, note.id, !note.pinned);
      await loadNotes();
    } catch (error) {
      console.error("Nexus: failed to pin note:", error);
    }
  }

  async function moveNote(note: NoteMeta, folderId: string | null): Promise<void> {
    try {
      await window.nexus.setNoteFolder(profileId, note.id, folderId);
      await loadNotes();
    } catch (error) {
      console.error("Nexus: failed to move note:", error);
    }
  }

  const sortedFolders = folders.slice().sort((a, b) => collator().compare(a.name, b.name));
  const sortedTags = tags.slice().sort((a, b) => collator().compare(a.name, b.name));
  const sortedCategories = categories.slice().sort((a, b) => collator().compare(a.name, b.name));
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const folderNameById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.name])),
    [folders],
  );

  /**
   * Whether a row prints the folder it lives in.
   *
   * Only under „Sve beleške", where the folder is one of the few things telling
   * two rows apart. Inside a folder it would be the SAME word on every row down
   * the whole pane, and under „Bez fascikle" there is no word to print — both
   * are the rule against repeating a constant down a list, and both are decided
   * here rather than per row.
   */
  const showFolder = selection.kind === "all";

  /**
   * The list shape's sticky groups. Recomputed on every render rather than
   * memoised, and on purpose: `groupNotes` is one pass over an array that is
   * already memoised, and the day it groups against has to be TODAY's — a memo
   * keyed on the notes alone would go on labelling yesterday's rows „Danas"
   * until something else happened to refetch.
   */
  const noteGroups = groupNotes(visibleNotes, localTodayKey());

  /**
   * WHICH SHAPE the middle pane draws (NOTE-002). A folder remembers its own —
   * the answer travels with the profile, because "this is a folder of recipes,
   * show me cards" is a property of what is filed there — while the root's is a
   * device preference (`notePrefs.ts`), since neither rootless selection has a
   * row to hang a column on.
   *
   * The fallback covers the first paint, before `listNoteFolders` has returned:
   * "list" is what every folder opens as by default, so the pane never flashes a
   * shape the folder did not ask for.
   */
  const selectedFolder =
    selection.kind === "folder" ? folders.find((folder) => folder.id === selection.id) : undefined;
  const view: NoteFolderView =
    selection.kind === "folder" ? (selectedFolder?.defaultView ?? "list") : rootView;

  /** Remembers the shape this selection opens in — the store for a folder, the device for the root. */
  async function selectView(next: NoteFolderView): Promise<void> {
    if (view === next) return;
    if (selection.kind !== "folder") {
      persistRootNoteView(next);
      setRootView(next);
      return;
    }
    const folderId = selection.id;
    try {
      await window.nexus.setNoteFolderView(profileId, folderId, next);
      // Patched in place rather than refetched: a folder's view changes nothing
      // about the tree, and the whole point of the toggle is that it is instant.
      setFolders((prev) =>
        prev.map((folder) => (folder.id === folderId ? { ...folder, defaultView: next } : folder)),
      );
    } catch (error) {
      console.error("Nexus: failed to remember the folder view:", error);
    }
  }

  /**
   * One note, drawn identically in both shapes (NOTE-002): the pin, the button
   * that opens it (title, tag chips, timestamp) and the "⋯" menu — the same
   * markup, so a card is a second RENDERING of the row rather than a second
   * design of it.
   *
   * The card face therefore keeps every management affordance the row has, and
   * keeps them just as quiet: the "⋯" is already hover-revealed
   * (`.note__item-row:hover .note__row-menu`), and reusing the row's own wrapper
   * class gives a card that treatment with no second rule. The alternative —
   * a card that only opens the note, with move/tag/delete left to the organizer
   * — was rejected because the organizer has no per-note menu at all, so cards
   * would have been a view you cannot manage notes from.
   *
   * Only the TIMESTAMP differs, and by design: a row in a dense column says
   * „28. jul“, while a card has room for the instant label the dashboard's recent
   * notes and the search results already use.
   *
   * THE ROW HAS THREE LEVELS AND THERE IS NO FOURTH. The title carries the
   * name; the second line is what the note is ABOUT (its kind and its tags), in
   * one muted sentence rather than a wrapping thicket of bordered chips; the
   * third is where it lives and when it was touched, in the tertiary register.
   * A fourth level is what turns a pane of fifty notes back into a wall.
   */
  function renderNoteEntry(note: NoteMeta, timestamp: string) {
    const noteTagIds = tagsByNote.get(note.id);
    const noteTags =
      noteTagIds && noteTagIds.size > 0 ? sortedTags.filter((tag) => noteTagIds.has(tag.id)) : [];
    const noteCategory = note.categoryId === null ? undefined : categoryById.get(note.categoryId);
    const folderName =
      showFolder && note.folderId !== null ? (folderNameById.get(note.folderId) ?? null) : null;
    return (
      <>
        <button
          type="button"
          className={`note__pin${note.pinned ? " note__pin--on" : ""}`}
          aria-label={note.pinned ? strings.notes.unpin : strings.notes.pin}
          aria-pressed={note.pinned}
          onClick={() => void togglePin(note)}
        >
          {note.pinned ? <Icon name="pinFilled" size={14} /> : <Icon name="pin" size={14} />}
        </button>
        <button
          type="button"
          className={note.id === selectedId ? "note__item note__item--active" : "note__item"}
          aria-current={note.id === selectedId ? "true" : undefined}
          onClick={() => setSelectedId(note.id)}
        >
          <span className="note__item-title">
            {note.title.trim().length > 0 ? note.title : strings.notes.untitled}
          </span>
          {(noteCategory !== undefined || noteTags.length > 0) && (
            <span className="note__item-tags">
              {/* The category leads the line (NOTE-002), told apart from the
                  tags by the swatch the user gave it rather than by a second
                  design — no new colour value, no glow. An uncoloured category
                  shows the dashed dot the folder tree already uses for one. */}
              {noteCategory !== undefined && (
                <span className="note__item-tag note__item-tag--category">
                  <span
                    className="note__folder-dot"
                    data-empty={noteCategory.color === null ? "true" : undefined}
                    style={
                      noteCategory.color
                        ? { background: `var(--nx-swatch-${noteCategory.color})` }
                        : undefined
                    }
                    aria-hidden="true"
                  />
                  {noteCategory.name}
                </span>
              )}
              {noteTags.map((tag) => (
                <span key={tag.id} className="note__item-tag">
                  {tag.name}
                </span>
              ))}
            </span>
          )}
          <span className="note__item-meta">
            {folderName !== null && <span className="note__item-folder">{folderName}</span>}
            <span className="note__item-date">{timestamp}</span>
          </span>
        </button>
        <NotePopover label={strings.notes.noteMenuLabel} triggerClassName="note__row-menu">
          {(close) => (
            <>
              <span className="note__menu-label">{strings.notes.moveToFolder}</span>
              <button
                className="note__menu-item"
                role="menuitem"
                type="button"
                onClick={() => {
                  void moveNote(note, null);
                  close();
                }}
              >
                {strings.notes.unfiled}
              </button>
              {sortedFolders.map((folder) => (
                <button
                  key={folder.id}
                  className="note__menu-item"
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    void moveNote(note, folder.id);
                    close();
                  }}
                >
                  {folder.name}
                </button>
              ))}
              {/* Between the folder and the tags, in the order the three axes
                  are defined: WHERE it lives, WHAT KIND it is, WHAT it is
                  about. `menuitemradio`, not `menuitemcheckbox` — a note has
                  exactly one category, so choosing one un-chooses the last. */}
              {sortedCategories.length > 0 && (
                <>
                  <div className="note__menu-sep" role="separator" />
                  <span className="note__menu-label">{strings.notes.noteCategoryLabel}</span>
                  <button
                    className="note__menu-item note__menu-item--check"
                    role="menuitemradio"
                    type="button"
                    aria-checked={note.categoryId === null}
                    onClick={() => {
                      void setNoteCategory(note, null);
                      close();
                    }}
                  >
                    <span
                      className={`note__menu-check${note.categoryId === null ? "" : " note__menu-check--hidden"}`}
                      aria-hidden="true"
                    >
                      <Icon name="check" size={14} />
                    </span>
                    {strings.notes.noCategory}
                  </button>
                  {sortedCategories.map((category) => {
                    const chosen = note.categoryId === category.id;
                    return (
                      <button
                        key={category.id}
                        className="note__menu-item note__menu-item--check"
                        role="menuitemradio"
                        type="button"
                        aria-checked={chosen}
                        onClick={() => {
                          void setNoteCategory(note, chosen ? null : category.id);
                          close();
                        }}
                      >
                        <span
                          className={`note__menu-check${chosen ? "" : " note__menu-check--hidden"}`}
                          aria-hidden="true"
                        >
                          <Icon name="check" size={14} />
                        </span>
                        {category.name}
                      </button>
                    );
                  })}
                </>
              )}
              {sortedTags.length > 0 && (
                <>
                  <div className="note__menu-sep" role="separator" />
                  <span className="note__menu-label">{strings.notes.tagsLabel}</span>
                  {sortedTags.map((tag) => {
                    const attached = tagsByNote.get(note.id)?.has(tag.id) ?? false;
                    return (
                      <button
                        key={tag.id}
                        className="note__menu-item note__menu-item--check"
                        role="menuitemcheckbox"
                        type="button"
                        aria-checked={attached}
                        onClick={() => void toggleNoteTag(note, tag.id, attached)}
                      >
                        <span
                          className={`note__menu-check${attached ? "" : " note__menu-check--hidden"}`}
                          aria-hidden="true"
                        >
                          <Icon name="check" size={14} />
                        </span>
                        {tag.name}
                      </button>
                    );
                  })}
                </>
              )}
              <div className="note__menu-sep" role="separator" />
              <button
                className="note__menu-item"
                role="menuitem"
                type="button"
                onClick={() => {
                  void duplicate(note);
                  close();
                }}
              >
                {strings.notes.duplicate}
              </button>
              <button
                className="note__menu-item"
                role="menuitem"
                type="button"
                onClick={() => {
                  void convertChecklist(note);
                  close();
                }}
              >
                {strings.notes.checklistTasks.action}
              </button>
              {/* Only while the private section is unlocked (ADR-057 §5): a
                  locked section cannot seal anything, and offering the row
                  just to refuse it would be a lie about what is possible. */}
              {privUnlocked && (
                <button
                  className="note__menu-item"
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMoveInError(null);
                    setPendingMoveIn(note);
                    close();
                  }}
                >
                  {strings.notes.moveToPriv.action}
                </button>
              )}
              <button
                className="note__menu-item note__menu-item--danger"
                role="menuitem"
                type="button"
                onClick={() => {
                  void remove(note);
                  close();
                }}
              >
                {strings.notes.deleteLabel}
              </button>
            </>
          )}
        </NotePopover>
      </>
    );
  }

  return (
    <>
      {/* A sibling of the grid rather than a child of it: `.note` IS the
          three-column grid, so a header placed inside it would land in the
          organizer's cell. `.app__main` is already the flex column both of
          these are items of — the header is `flex: none`, the grid keeps its
          `flex: 1; min-height: 0`, and the height contract is unchanged. */}
      <PageHeader
        title={moduleName("notes")}
        sigil="notes"
        actions={
          // A disclosure for the organizer, hidden by CSS at the widths where
          // the organizer is a column and there is nothing to disclose.
          <Button
            ref={organizerToggleRef}
            className="note__org-toggle"
            aria-expanded={organizerOpen}
            aria-controls={NOTE_ORGANIZER_PANE_ID}
            onClick={() => setOrganizerOpen((open) => !open)}
          >
            {strings.notes.foldersLabel}
          </Button>
        }
      />
      {/* The library's own summary, not any one note's — a page-level sibling of
          the three-pane grid rather than a child of any one pane, so it reads as
          being about the whole profile regardless of which folder is selected.

          FOLDED, and closed until this machine says otherwise. Drawn out, the
          band and the heatmap are about five hundred pixels: at the 1120x720
          the app opens at that leaves the list a sliver with no row in it, and
          at the 900x600 floor it leaves it NOTHING — a notes page whose first
          screen has no note on it. `overviewPrefs.ts` has the whole argument.

          „Entirely below the fold" is what this said of both, and it was wrong
          in the way that matters: `.note` is a flex item, so it was CRUSHED
          rather than pushed down, and a crushed item has no box, no scrollbar
          and nothing to scroll to. It carries a floor now (`notes.css`), which
          is what makes the sentence true. */}
      <Disclosure
        label={strings.app.overviewToggle}
        open={overviewOpen}
        onToggle={(next) => {
          setOverviewOpen(next);
          persistOverviewOpen("notes", next);
        }}
      >
        <NoteRhythm profileId={profileId} />
      </Disclosure>
      {/* `data-nx-content`: the three panes ARE the module, so the audit
          asserts they reach the first screen at every swept size
          (`shots/audit.ts`, `below-fold`). */}
      <div
        className="note"
        data-nx-content
        data-organizer={organizerOpen ? "open" : "closed"}
      >
        <NoteOrganizer
          profileId={profileId}
          folders={folders}
          selection={selection}
          onSelect={(next) => {
            setSelection(next);
            // Choosing a folder is choosing what the list shows, and the drawer
            // covers the list — so it puts itself away. Tags and categories do
            // NOT close it: those are multi-select filters, and closing after
            // every toggle would make a two-tag filter a four-click job.
            setOrganizerOpen(false);
          }}
          onChanged={onFoldersChanged}
          tags={tags}
          tagFilter={tagFilter}
          onToggleTag={onToggleTag}
          onClearTagFilter={onClearTagFilter}
          onTagsChanged={loadTags}
          categories={categories}
          categoryFilter={categoryFilter}
          onToggleCategory={onToggleCategory}
          onClearCategoryFilter={onClearCategoryFilter}
          onCategoriesChanged={onCategoriesChanged}
        />

        {/* The drawer's outside-click target. A folder menu opened from inside
            the drawer portals to <body> and paints above this, so clicking one
            never reaches it — which is why dismissal is a scrim here and not a
            document listener that would have to name every portalled panel. */}
        {organizerOpen && (
          <div
            className="note__org-scrim"
            aria-hidden="true"
            onPointerDown={() => setOrganizerOpen(false)}
          />
        )}

        <div className="note__list-pane">
          <Button variant="primary" className="note__new" onClick={() => void create()}>
            {strings.notes.newNote}
          </Button>

          {/* The shape toggle (NOTE-002). Always drawn: it is a property of the
              SELECTION, not of what happens to be in it, so an empty folder is
              still a folder whose shape can be set. */}
          <div className="note__list-head">
            <div className="note__views" role="group" aria-label={strings.notes.viewLabel}>
              {viewOptions().map(({ value, label }) => (
                <Button
                  key={value}
                  size="sm"
                  className="nx-segmented__option"
                  aria-pressed={view === value}
                  onClick={() => void selectView(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {pendingUndo != null && (
            <div className="note__undo" role="status">
              <span className="note__undo-text">
                {pendingUndo.withCards
                  ? strings.notes.deletedWithCardsNotice
                  : strings.notes.deletedNotice}
              </span>
              <Button size="sm" className="note__undo-action" onClick={() => void undo()}>
                {strings.notes.undo}
              </Button>
              <Button
                size="sm"
                className="note__undo-dismiss"
                aria-label={strings.notes.dismiss}
                onClick={() => setPendingUndo(null)}
              >
                <Icon name="close" size={14} />
              </Button>
            </div>
          )}

          {duplicateError !== null && (
            <p className="note__list-error" role="status">
              {duplicateError === "tooLarge"
                ? strings.notes.duplicateTooLarge
                : strings.notes.duplicateError}
            </p>
          )}

          {checklistNotice !== null &&
            (checklistNotice.kind === "error" ? (
              <p className="note__list-error" role="status">
                {strings.notes.checklistTasks.error}
              </p>
            ) : (
              <p className="nx-hint note__list-notice" role="status">
                {checklistNotice.kind === "empty"
                  ? strings.notes.checklistTasks.empty
                  : formatChecklistResult(checklistNotice.result)}
              </p>
            ))}

          {failed ? (
            // No sigil: a module's own mark above a failure would say „there is
            // nothing here", and what happened is that we could not find out.
            <EmptyState title={strings.notes.listEmptyTitle} description={strings.notes.loadError} />
          ) : notes === null ? (
            <LoadingState label={strings.app.loading} rows={6} />
          ) : notes.length === 0 ? (
            <EmptyState
              sigil="notes"
              title={strings.notes.listEmptyTitle}
              description={strings.notes.listEmptyDescription}
            />
          ) : visibleNotes.length === 0 ? (
            // Two filters, two sentences: the description has to name the one
            // the user actually set, and only the tag filter is on when both are
            // off. With both on, the tag line is the more specific of the two.
            //
            // No `sigil`, and that is still deliberate: the module is NOT empty,
            // one filter matched nothing, and a 48px module mark here would be
            // the surface claiming a state it is not in.
            //
            // It is the PAGE shape now, against the earlier reasoning, and the
            // reason is the action. `inline` has no room for one and drops it on
            // the floor (`EmptyState` says so in its own prop doc), so the pane
            // stated a dead end and offered no way out of it — while the only
            // two „Poništi" links live in the organizer rail, which below
            // 1345px is a drawer that is closed. „Datoteke" already draws this
            // exact moment correctly (`FilesPage`'s `noMatchTitle` +
            // `clearFilters`); this is that rule, applied here too.
            <EmptyState
              title={strings.notes.filterEmptyTitle}
              description={
                tagFilter.length === 0
                  ? strings.notes.categoryFilterEmptyDescription
                  : strings.notes.tagFilterEmptyDescription
              }
              action={
                <Button size="sm" onClick={clearNoteFilters}>
                  {strings.notes.filterEmptyClear}
                </Button>
              }
            />
          ) : view === "list" ? (
            // Sticky groups, never a flat run of fifty rows. Each group is one
            // item of the outer list, so its heading sticks against the pane's
            // scroll and leaves exactly when its last row does — see `.note__group`.
            <ul className="note__list">
              {noteGroups.map((group) => (
                <li key={group.key} className="note__group">
                  <h3 className="note__group-head">
                    {groupLabel(group)}
                    {/* A number, not „12 beležaka" repeated down the pane. */}
                    <span className="note__group-count">{group.notes.length}</span>
                  </h3>
                  <ul className="note__group-items">
                    {group.notes.map((note) => (
                      <li key={note.id} className="note__item-row">
                        {renderNoteEntry(note, rowTimestamp(note, group.kind))}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            // The same notes, one card each, in the same order (the config
            // carries no sort — see CARDS_CONFIG). The wrapper owns the scroll the
            // <ul> owns in the other shape; the grid, the card frame and its
            // padding are the UI package's.
            //
            // NO GROUPS HERE, deliberately. A card grid is a gallery, and a
            // gallery cut by five headings is five short galleries; the shape
            // exists precisely for the case where you are looking rather than
            // scanning. The date on a card is the fuller instant label for the
            // same reason — nothing above it has said the day.
            <div className="note__cards">
              <CardsView<NoteFields>
                items={visibleNotes}
                schema={NOTE_SCHEMA}
                config={CARDS_CONFIG}
                itemKey={(note) => note.id}
                renderItem={(note) => (
                  <div className="note__item-row">
                    {renderNoteEntry(note, formatNotificationWhen(note.updatedAt))}
                  </div>
                )}
              />
            </div>
          )}
        </div>

        <div className="note__editor-pane">
          {selectedId != null ? (
            <NoteEditor
              key={selectedId}
              profileId={profileId}
              noteId={selectedId}
              onSaved={() => void loadNotes()}
              onOpenNote={setSelectedId}
              // Handed over only to the note it was resolved for, and dropped the
              // moment the editor reports it applied — otherwise navigating away
              // and back to that note would append the template a second time.
              initialTemplate={
                pendingTemplate?.noteId === selectedId ? pendingTemplate.blocks : null
              }
              onInitialTemplateApplied={clearPendingTemplate}
            />
          ) : (
            <div className="note__editor-empty">
              <EmptyState
                sigil="notes"
                title={strings.notes.noSelectionTitle}
                description={strings.notes.noSelectionDescription}
              />
            </div>
          )}
        </div>

        {pendingDelete != null && (
          <NoteCardsDeleteDialog
            noteTitle={
              pendingDelete.note.title.trim().length > 0
                ? pendingDelete.note.title
                : strings.notes.untitled
            }
            cardCount={pendingDelete.cardCount}
            onChoose={(disposition) => {
              const { note } = pendingDelete;
              setPendingDelete(null);
              void performDelete(note, disposition);
            }}
            onCancel={() => setPendingDelete(null)}
          />
        )}

        {pendingMoveIn != null && (
          <TypedConfirmDialog
            title={strings.notes.moveToPriv.title}
            name={
              pendingMoveIn.title.trim().length > 0 ? pendingMoveIn.title : strings.notes.untitled
            }
            warning={strings.notes.moveToPriv.warning}
            note={strings.notes.moveToPriv.keepNote}
            confirmLabel={strings.notes.moveToPriv.confirmLabel}
            confirmPlaceholder={strings.notes.moveToPriv.confirmPlaceholder}
            confirmValue={
              pendingMoveIn.title.trim().length > 0 ? pendingMoveIn.title : strings.notes.untitled
            }
            submitLabel={strings.notes.moveToPriv.submit}
            cancelLabel={strings.notes.moveToPriv.cancel}
            error={moveInError}
            busy={movingIn}
            onConfirm={() => void performMoveIn(pendingMoveIn)}
            onCancel={() => setPendingMoveIn(null)}
          />
        )}

        {pendingChecklist != null && (
          <NoteChecklistTasksDialog
            profileId={profileId}
            noteTitle={
              pendingChecklist.note.title.trim().length > 0
                ? pendingChecklist.note.title
                : strings.notes.untitled
            }
            itemCount={pendingChecklist.itemCount}
            onConvert={(listId) => {
              const { note } = pendingChecklist;
              setPendingChecklist(null);
              void performChecklistConversion(note, listId);
            }}
            onCancel={() => setPendingChecklist(null)}
          />
        )}
      </div>
    </>
  );
}
