import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Extension } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import { Suggestion } from "@tiptap/suggestion";
import type { SuggestionProps } from "@tiptap/suggestion";
import { strings } from "./strings.js";

/**
 * The Serbian slash menu (ADR-012): a `/`-triggered command list that turns the
 * current block into one of the v1 block types. Built on `@tiptap/suggestion`
 * (the same primitive TipTap mentions use) with a hand-rolled, tokens-styled
 * React portal for the panel — deliberately no tippy.js / floating-ui: the
 * panel is absolutely positioned at the caret via the suggestion `clientRect`.
 * Executing an item deletes the typed `/query` range, then runs the block
 * command; task lists render visual checkboxes only (they are not TASK items).
 */

/** One slash-menu command. `run` receives the live editor and the `/query` range. */
interface SlashItem {
  key: string;
  label: string;
  run: (editor: Editor, range: Range) => void;
}

/** The v1 command set, in menu order (ADR-012). Each deletes `/query` first. */
const SLASH_ITEMS: readonly SlashItem[] = [
  {
    key: "paragraph",
    label: strings.notes.slash.paragraph,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    key: "heading1",
    label: strings.notes.slash.heading1,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
  },
  {
    key: "heading2",
    label: strings.notes.slash.heading2,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
  },
  {
    key: "heading3",
    label: strings.notes.slash.heading3,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
  },
  {
    key: "bulletList",
    label: strings.notes.slash.bulletList,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    key: "orderedList",
    label: strings.notes.slash.orderedList,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    key: "taskList",
    label: strings.notes.slash.taskList,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    key: "blockquote",
    label: strings.notes.slash.blockquote,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    key: "codeBlock",
    label: strings.notes.slash.codeBlock,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    key: "divider",
    label: strings.notes.slash.divider,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

/** Case-insensitive sr-Latn substring match on the labels. */
function filterSlashItems(query: string): SlashItem[] {
  const needle = query.toLocaleLowerCase("sr-Latn");
  if (needle.length === 0) return [...SLASH_ITEMS];
  return SLASH_ITEMS.filter((item) => item.label.toLocaleLowerCase("sr-Latn").includes(needle));
}

/** The render snapshot handed to React on each open/update of the suggestion. */
export interface SlashRenderState {
  items: SlashItem[];
  command: (item: SlashItem) => void;
  rect: DOMRect | null;
}

/** Imperative hooks the extension calls; the React component owns the UI/state. */
export interface SlashHandlers {
  onStart: (state: SlashRenderState) => void;
  onUpdate: (state: SlashRenderState) => void;
  onExit: () => void;
  /** Returns true when the key was consumed by the menu (arrows / Enter). */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

function toState(props: SuggestionProps<SlashItem, SlashItem>): SlashRenderState {
  return {
    items: props.items,
    command: props.command,
    rect: props.clientRect?.() ?? null,
  };
}

/**
 * Builds the slash-menu extension, wired to a set of React handlers. Created
 * once per editor (per opened note), so the handler closures stay stable.
 */
export function createSlashExtension(handlers: SlashHandlers): Extension {
  return Extension.create({
    name: "nexusSlashMenu",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          editor: this.editor,
          char: "/",
          // Default `allowedPrefixes` ([' ']) + `startOfLine: false` already
          // restricts the trigger to a block start or a `/` after whitespace.
          items: ({ query }) => filterSlashItems(query),
          command: ({ editor, range, props }) => props.run(editor, range),
          render: () => ({
            onStart: (props) => handlers.onStart(toState(props)),
            onUpdate: (props) => handlers.onUpdate(toState(props)),
            onKeyDown: (props) => handlers.onKeyDown(props.event),
            onExit: () => handlers.onExit(),
          }),
        }),
      ];
    },
  });
}

export interface SlashMenuProps {
  state: SlashRenderState;
  /** Publishes the panel's key handler up to the extension's `onKeyDown`. */
  registerKeydown: (handler: (event: KeyboardEvent) => boolean) => void;
}

/**
 * The floating command panel: a tokens-styled surface positioned at the caret,
 * portalled to `document.body`. Keyboard (↑/↓/Enter) is routed in from the
 * ProseMirror suggestion plugin; Escape is handled by the plugin itself (it
 * dispatches `onExit`). The active row is typographic (gold + weight) over a
 * soft surface — no glow, no inset bar.
 */
export function SlashMenu({ state, registerKeydown }: SlashMenuProps) {
  const { items, command, rect } = state;
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);

  // A fresh item set (query changed) resets the highlight to the first row.
  useEffect(() => {
    setIndex(0);
    indexRef.current = 0;
  }, [items]);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  useEffect(() => {
    registerKeydown((event) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") {
        setIndex((current) => (current + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setIndex((current) => (current - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        const selected = items[indexRef.current];
        if (selected) command(selected);
        return true;
      }
      return false;
    });
  }, [items, command, registerKeydown]);

  if (!rect || items.length === 0) return null;

  return createPortal(
    <div
      className="note__slash"
      style={{ top: rect.bottom + 4, left: rect.left }}
      role="listbox"
    >
      {items.map((item, position) => (
        <button
          key={item.key}
          type="button"
          role="option"
          aria-selected={position === index}
          className={
            position === index
              ? "note__slash-item note__slash-item--active"
              : "note__slash-item"
          }
          // mousedown (not click) so the editor keeps its selection/focus.
          onMouseDown={(event) => {
            event.preventDefault();
            command(item);
          }}
          onMouseEnter={() => setIndex(position)}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
