import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  findNoteMatches,
  matchIndexAt,
  planNoteReplacements,
  stepMatchIndex,
  type NoteFindBlock,
  type NoteFindMatch,
} from "./noteFind.js";
import { blockTextAndPositions } from "./noteFlashcard.js";
import { TOGGLE_CONTENT_NODE_NAME, TOGGLE_NODE_NAME } from "./noteToggle.js";
import { strings } from "./strings.js";

/**
 * „Pronađi u belešci" (NOTE-005, the in-note half): Ctrl+F over the open note,
 * with the global search palette keeping everything else. Three parts —
 *
 * (a) a ProseMirror plugin holding the query, the match list and which match is
 *     active, and turning them into DECORATIONS. Never content: a Yjs-backed
 *     document must not gain a mark or an attribute because somebody typed in a
 *     search box, or every reader of a shared note would see the highlights and
 *     every find would bump `updated_at`. Decorations are view-only state that
 *     the Collaboration binding never sees.
 * (b) `Zameni` / `Zameni sve`, which are the exact opposite: REAL transactions
 *     through the editor, so they undo like any other edit and reach Yjs
 *     through the same binding as a keystroke. „Zameni sve" is one transaction
 *     applied back to front (see `planNoteReplacements`) — one undo step for
 *     what the user asked for once.
 * (c) the find bar itself, a docked row rather than a dialog, so the note stays
 *     readable and the highlights stay visible while it is open.
 *
 * The pure half — matching, folding, ordering — lives in `noteFind.ts` and is
 * tested there without an editor. This file is what connects it to a document.
 */

/** Plugin state: the query as asked, what it found, and which hit is current. */
interface NoteFindPluginState {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly matches: readonly NoteFindMatch[];
  /** Index into `matches`; -1 when there is nothing to be active. */
  readonly active: number;
  readonly decorations: DecorationSet;
}

/**
 * What a transaction can tell the plugin. Everything else it needs — that the
 * document changed, where the caret is — it reads off the transaction itself.
 */
type NoteFindAction =
  | { readonly kind: "params"; readonly query: string; readonly caseSensitive: boolean }
  | { readonly kind: "active"; readonly active: number }
  /** `pos` is a PRE-transaction position; the plugin maps it forward itself. */
  | { readonly kind: "anchor"; readonly pos: number };

const NOTE_FIND_KEY = new PluginKey<NoteFindPluginState>("nexusNoteFind");

const EMPTY_STATE: NoteFindPluginState = {
  query: "",
  caseSensitive: false,
  matches: [],
  active: -1,
  decorations: DecorationSet.empty,
};

/**
 * Every textblock's plain text and position map, fed to the pure matcher.
 * `blockTextAndPositions` is `noteFlashcard.ts`'s walk, reused rather than
 * copied: it already states how inline atoms are handled, and two copies of
 * that rule would be two rules.
 */
function collectMatches(
  doc: ProseMirrorNode,
  query: string,
  caseSensitive: boolean,
): NoteFindMatch[] {
  if (query.length === 0) return [];
  const blocks: NoteFindBlock[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    blocks.push(blockTextAndPositions(node, pos));
    return false; // a textblock's children are inline — nothing below to walk
  });
  return findNoteMatches(blocks, query, caseSensitive);
}

/**
 * One inline decoration per match; the active one additionally gets the
 * stronger class. Rebuilt whole on every recompute rather than mapped forward —
 * the match list is recomputed anyway, so a mapped set could only ever disagree
 * with it.
 */
function buildDecorations(
  doc: ProseMirrorNode,
  matches: readonly NoteFindMatch[],
  active: number,
): DecorationSet {
  const decorations = matches.map((match, index) =>
    Decoration.inline(match.from, match.to, {
      class: index === active ? "note__find-hit note__find-hit--active" : "note__find-hit",
    }),
  );
  return DecorationSet.create(doc, decorations);
}

/**
 * The plugin. `apply` has one job worth spelling out: keeping the active match
 * meaningful across an edit. Typing while the bar is open moves every position
 * after the caret, so the match list is recomputed and the active index is
 * re-derived from WHERE the old active match ended up (mapped through the
 * transaction) rather than kept as a number — index 3 of the old list and index
 * 3 of the new one are not the same place, and a counter that quietly points
 * somewhere else is worse than no counter.
 */
function noteFindPlugin(): Plugin<NoteFindPluginState> {
  return new Plugin<NoteFindPluginState>({
    key: NOTE_FIND_KEY,
    state: {
      init: () => EMPTY_STATE,
      apply(tr, value, _oldState, newState) {
        const action = tr.getMeta(NOTE_FIND_KEY) as NoteFindAction | undefined;
        const params = action?.kind === "params" ? action : null;
        const query = params?.query ?? value.query;
        const caseSensitive = params?.caseSensitive ?? value.caseSensitive;
        const paramsChanged = query !== value.query || caseSensitive !== value.caseSensitive;

        // Nothing asked, nothing moved: the decorations still describe this doc.
        if (action === undefined && !paramsChanged && !tr.docChanged) return value;

        const matches =
          paramsChanged || tr.docChanged
            ? collectMatches(newState.doc, query, caseSensitive)
            : value.matches;

        let active: number;
        if (action?.kind === "active") {
          active = action.active;
        } else if (action?.kind === "anchor") {
          active = matchIndexAt(matches, tr.mapping.map(action.pos));
        } else if (paramsChanged) {
          // A fresh query starts at the caret, so the first hit offered is the
          // one nearest whatever the reader was already looking at.
          active = matchIndexAt(matches, newState.selection.from);
        } else if (tr.docChanged) {
          const previous = value.matches[value.active];
          active = matchIndexAt(
            matches,
            previous === undefined ? newState.selection.from : tr.mapping.map(previous.from),
          );
        } else {
          active = value.active;
        }
        if (active >= matches.length) active = matches.length === 0 ? -1 : matches.length - 1;

        return {
          query,
          caseSensitive,
          matches,
          active,
          decorations: buildDecorations(newState.doc, matches, active),
        };
      },
    },
    props: {
      decorations: (state) => NOTE_FIND_KEY.getState(state)?.decorations ?? DecorationSet.empty,
    },
  });
}

/**
 * Opens every collapsed „Sklopivi odeljak" around `pos`, so navigating to a
 * match never parks the caret behind `display: none`.
 *
 * This WRITES to the document — `collapsed` is a node attribute and therefore
 * content, by that block's own deliberate decision (see `noteToggle.tsx`). So
 * it is left undoable and unmarked, exactly like clicking the chevron: the
 * user asked to be taken to something hidden, and being taken there means the
 * section is open now. The alternative — a decoration that force-shows a
 * collapsed section — would leave the note lying about its own fold state the
 * moment the bar closed.
 *
 * Attribute changes move no positions, so the caller's `from`/`to` stay exactly
 * as computed and the whole thing rides in one transaction.
 */
function expandCollapsedAncestors(tr: Transaction, pos: number): void {
  const $pos = tr.doc.resolve(pos);
  const collapsed: number[] = [];
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (node.type.name !== TOGGLE_NODE_NAME) continue;
    if (node.attrs["collapsed"] !== true) continue;
    // Folding hides the BODY, never the summary — so a match in the summary of
    // a folded section is already on screen, and unfolding for it would be a
    // document write nobody asked for. Only a match inside `toggleContent`
    // earns one.
    if (depth + 1 > $pos.depth) continue;
    if ($pos.node(depth + 1).type.name !== TOGGLE_CONTENT_NODE_NAME) continue;
    collapsed.push($pos.before(depth));
  }
  for (const togglePos of collapsed) tr.setNodeAttribute(togglePos, "collapsed", false);
}

/** Replaces one match, or deletes it — `insertText` cannot build an empty text node, and an empty replace field means "take it out". */
function applyReplacement(tr: Transaction, match: NoteFindMatch, replacement: string): void {
  if (replacement.length === 0) tr.delete(match.from, match.to);
  else tr.insertText(replacement, match.from, match.to);
}

/** What the bar needs to draw its counter — the plugin state, minus the parts only the plugin uses. */
export interface NoteFindStatus {
  readonly total: number;
  /** Index of the active match, or -1 when there is none. */
  readonly active: number;
}

export function readNoteFindStatus(state: EditorState): NoteFindStatus {
  const value = NOTE_FIND_KEY.getState(state);
  if (value === undefined) return { total: 0, active: -1 };
  return { total: value.matches.length, active: value.active };
}

/**
 * Publishes the query and the case toggle into the plugin. The transaction
 * carries no document change at all, so the Collaboration binding produces no
 * Yjs update and nothing is persisted — searching a note must not modify it.
 */
export function setNoteFindParams(editor: Editor, query: string, caseSensitive: boolean): void {
  if (editor.isDestroyed) return;
  const action: NoteFindAction = { kind: "params", query, caseSensitive };
  editor.view.dispatch(editor.state.tr.setMeta(NOTE_FIND_KEY, action));
}

/**
 * Moves to the next/previous match: opens whatever was folded over it, selects
 * it, and scrolls it into view. `scrollIntoView()` on the transaction is
 * ProseMirror's own — no `behavior: "smooth"` anywhere, and @nexus/ui's blanket
 * reduced-motion rule pins `scroll-behavior` to `auto`, so there is nothing to
 * opt out of (the same reasoning as `reveal.ts`).
 *
 * Selecting the match is what makes Escape land the caret on it, ready to be
 * typed over.
 *
 * Returns whether it actually moved, so a key bound to it can decline the
 * keystroke instead of swallowing it when there is nothing to move to.
 */
export function goToNoteMatch(editor: Editor, delta: number): boolean {
  const value = NOTE_FIND_KEY.getState(editor.state);
  if (value === undefined || value.matches.length === 0) return false;
  const next = stepMatchIndex(value.matches.length, value.active, delta);
  const match = value.matches[next];
  if (match === undefined) return false;

  const tr = editor.state.tr;
  expandCollapsedAncestors(tr, match.from);
  const action: NoteFindAction = { kind: "active", active: next };
  tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).setMeta(NOTE_FIND_KEY, action);
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Puts the caret on the active match and hands focus back to the editor — what Escape does. */
export function focusActiveMatch(editor: Editor): void {
  if (editor.isDestroyed) return;
  const value = NOTE_FIND_KEY.getState(editor.state);
  const match = value === undefined ? undefined : value.matches[value.active];
  if (match !== undefined) {
    const tr = editor.state.tr;
    expandCollapsedAncestors(tr, match.from);
    editor.view.dispatch(
      tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).scrollIntoView(),
    );
  }
  editor.view.focus();
}

/**
 * „Zameni": replaces the active match and moves on. The anchor is the match's
 * END rather than its start, which is what keeps a replacement that itself
 * contains the query („a" → „aa") from re-matching in place and pinning the
 * button to one spot forever.
 */
export function replaceActiveMatch(editor: Editor, replacement: string): void {
  const value = NOTE_FIND_KEY.getState(editor.state);
  const match = value === undefined ? undefined : value.matches[value.active];
  if (match === undefined) return;
  const tr = editor.state.tr;
  expandCollapsedAncestors(tr, match.from);
  applyReplacement(tr, match, replacement);
  const action: NoteFindAction = { kind: "anchor", pos: match.to };
  tr.setMeta(NOTE_FIND_KEY, action);
  editor.view.dispatch(tr.scrollIntoView());
}

/**
 * „Zameni sve": every match, back to front, in ONE transaction — so it is one
 * undo step and one Yjs batch. The order is the whole correctness argument and
 * it lives in `planNoteReplacements`, proven there against longer, shorter and
 * empty replacements.
 *
 * Collapsed toggles are deliberately left folded here. A bulk edit has nothing
 * to navigate to, and unfolding every section that happened to contain a match
 * would rearrange the note behind the user's back; the counter already told
 * them how many hits there were, hidden ones included.
 */
export function replaceAllMatches(editor: Editor, replacement: string): void {
  const value = NOTE_FIND_KEY.getState(editor.state);
  if (value === undefined || value.matches.length === 0) return;
  const tr = editor.state.tr;
  for (const match of planNoteReplacements(value.matches)) applyReplacement(tr, match, replacement);
  editor.view.dispatch(tr);
}

/** Imperative hooks the extension calls; the React canvas owns whether the bar is mounted. */
export interface NoteFindHandlers {
  /** Ctrl+F — show the bar and put the caret in its query field. */
  onOpen: () => void;
  /** Escape inside the editor; true when the bar was open and has now been closed. */
  onEscape: () => boolean;
}

/**
 * The extension: the plugin above plus the keys, scoped to the editor surface
 * by construction — `addKeyboardShortcuts` becomes a keymap plugin on this
 * editor's view, so Ctrl+F is claimed only while a note is open and focused and
 * the shell's global chord registry (`shortcuts.ts`, which does not use F) is
 * untouched.
 *
 * Priority below the default so its Escape is consulted AFTER the `/` and `[[`
 * suggestion plugins: with a menu open, Escape belongs to the menu.
 */
export function createNoteFindExtension(handlers: NoteFindHandlers): Extension {
  return Extension.create({
    name: "nexusNoteFind",
    priority: 50,

    addProseMirrorPlugins() {
      return [noteFindPlugin()];
    },

    addKeyboardShortcuts() {
      return {
        "Mod-f": () => {
          handlers.onOpen();
          return true;
        },
        // Alternates for the bar's own Enter/Shift+Enter, usable without
        // leaving the text. They step the CURRENT query and nothing else: with
        // the bar closed there is no query (closing clears it), so they decline
        // the keystroke rather than opening a bar with nothing to show.
        F3: ({ editor }) => goToNoteMatch(editor, 1),
        "Shift-F3": ({ editor }) => goToNoteMatch(editor, -1),
        Escape: () => handlers.onEscape(),
      };
    },
  });
}

export interface NoteFindBarProps {
  editor: Editor;
  /**
   * Bumped by every Ctrl+F, which is the only thing that opens this bar — so
   * the effect below arms the field on mount AND on every re-press, without
   * ever having to ask which of the two just happened.
   */
  focusNonce: number;
  onClose: () => void;
}

/**
 * The docked bar. Quiet paper with a hairline, sticky to the top of the editor
 * pane so the counter stays readable while the hits scroll past it.
 */
export function NoteFindBar({ editor, focusNonce, onClose }: NoteFindBarProps) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [status, setStatus] = useState<NoteFindStatus>({ total: 0, active: -1 });
  const queryRef = useRef<HTMLInputElement>(null);

  const find = strings.notes.find;

  // The query and the case toggle are React state (an input must not lag its
  // own keystrokes); everything derived from them — the matches, which one is
  // active — belongs to the plugin, which is the only place that can keep them
  // honest across an edit. This effect is the one-way street between the two.
  useEffect(() => {
    setNoteFindParams(editor, query, caseSensitive);
  }, [editor, query, caseSensitive]);

  // …and this is the way back: every transaction (a keystroke in the note, a
  // replacement, a navigation) republishes the counter.
  useEffect(() => {
    const sync = () => setStatus(readNoteFindStatus(editor.state));
    sync();
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);

  useEffect(() => {
    queryRef.current?.focus();
    queryRef.current?.select();
  }, [focusNonce]);

  // Closing leaves nothing behind: the highlights belong to the bar, not to the
  // note. (Guarded because this also runs when the whole canvas is torn down.)
  useEffect(
    () => () => {
      setNoteFindParams(editor, "", false);
    },
    [editor],
  );

  const close = useCallback(() => {
    focusActiveMatch(editor);
    onClose();
  }, [editor, onClose]);

  const step = useCallback(
    (delta: number) => {
      goToNoteMatch(editor, delta);
    },
    [editor],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "Enter" || event.key === "F3") {
        event.preventDefault();
        step(event.shiftKey ? -1 : 1);
        return;
      }
      // Ctrl+F with the bar already open re-arms the field, so a second press
      // starts a new query instead of doing nothing.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        queryRef.current?.focus();
        queryRef.current?.select();
      }
    },
    [close, step],
  );

  const empty = status.total === 0;
  // One slot answers for all three states: „3/17", the quiet „Nema rezultata."
  // once something has actually been asked, and nothing at all before that.
  const counter = empty
    ? query.length > 0
      ? find.noResults
      : ""
    : `${status.active + 1}/${status.total}`;

  return (
    <div
      className="note__find"
      role="search"
      aria-label={find.regionLabel}
      onKeyDown={handleKeyDown}
    >
      <div className="note__find-row">
        <input
          ref={queryRef}
          type="text"
          className="note__find-input"
          placeholder={find.placeholder}
          aria-label={find.regionLabel}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="note__find-count" role="status" aria-label={find.countLabel}>
          {counter}
        </span>
        <button
          type="button"
          className="note__find-button"
          aria-pressed={caseSensitive}
          title={find.caseTitle}
          // mousedown (not click) so the query field keeps focus and Enter goes
          // on meaning "next" — the same idiom as the suggestion menu's rows.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setCaseSensitive((value) => !value)}
        >
          {find.caseLabel}
        </button>
        <button
          type="button"
          className="note__find-button"
          aria-label={find.previous}
          disabled={empty}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => step(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="note__find-button"
          aria-label={find.next}
          disabled={empty}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => step(1)}
        >
          ↓
        </button>
        <button
          type="button"
          className="note__find-button"
          aria-expanded={replaceOpen}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setReplaceOpen((value) => !value)}
        >
          {find.replaceToggle}
        </button>
        <button
          type="button"
          className="note__find-button"
          aria-label={find.close}
          onMouseDown={(event) => event.preventDefault()}
          onClick={close}
        >
          ×
        </button>
      </div>
      {replaceOpen && (
        <div className="note__find-row">
          <input
            type="text"
            className="note__find-input"
            placeholder={find.replacePlaceholder}
            aria-label={find.replacePlaceholder}
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
          />
          <button
            type="button"
            className="note__find-button"
            disabled={empty}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => replaceActiveMatch(editor, replacement)}
          >
            {find.replace}
          </button>
          <button
            type="button"
            className="note__find-button"
            disabled={empty}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => replaceAllMatches(editor, replacement)}
          >
            {find.replaceAll}
          </button>
        </div>
      )}
    </div>
  );
}
