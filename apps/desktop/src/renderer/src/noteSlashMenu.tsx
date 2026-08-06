import { Extension } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import { Suggestion } from "@tiptap/suggestion";
import type { SuggestionProps } from "@tiptap/suggestion";
import { CALLOUT_VARIANTS } from "@nexus/core";
import type { CalloutVariant } from "@nexus/core";
import { applyCallout } from "./noteCallout.js";
import { insertClozeDeletion } from "./noteFlashcard.js";
import { insertToggle } from "./noteToggle.js";
import { SuggestionMenu } from "./suggestionMenu.js";
import type { TemplateEntry } from "./noteTemplates.js";
import { strings } from "./strings.js";

/**
 * The Serbian slash menu (ADR-012): a `/`-triggered command list that turns the
 * current block into one of the v1 block types. Built on `@tiptap/suggestion`
 * (the same primitive TipTap mentions use) with a hand-rolled, tokens-styled
 * React portal for the panel — deliberately no tippy.js / floating-ui: the
 * panel is placed at the caret by `useAnchoredPosition`, off the suggestion's
 * own live `clientRect`.
 * Executing an item deletes the typed `/query` range, then runs the block
 * command; task lists render visual checkboxes only (they are not TASK items).
 *
 * NOTE-009c appends a templates section after the block commands: every
 * insertable template (ADR-016), fed live through a `getTemplates` accessor so
 * the extension — built once per editor — always sees the current list even
 * though the extension instance itself never changes. A template item's `run`
 * inserts at the caret, replacing the typed `/query`: the caret-precise
 * counterpart to the Šabloni pane's append-at-end placement.
 */

/** One slash-menu command. `run` receives the live editor and the `/query` range. */
interface SlashItem {
  key: string;
  label: string;
  run: (editor: Editor, range: Range) => void;
}

/**
 * The four callout entries (NOTE-011), built from the shared variant list so
 * a fifth variant is one label away from appearing here. Four flat rows
 * rather than a submenu or a per-block popover: the panel is one filtered
 * list by construction (`SuggestionMenu` renders exactly that), so typing
 * „/okvir" already narrows to these four — a submenu would be a second
 * interaction model, and a popover anchored to the block would be a whole
 * node view, positioning and keyboard story for a choice made once.
 *
 * `applyCallout` also restyles the callout the caret is already in, which is
 * what makes these four rows the way to CHANGE a variant, not only to create
 * one — and re-running the row that is already active lifts the block out,
 * exactly as re-running „Citat" does.
 */
const CALLOUT_SLASH_LABELS: Record<CalloutVariant, string> = {
  info: strings.notes.slash.calloutInfo,
  tip: strings.notes.slash.calloutTip,
  warning: strings.notes.slash.calloutWarning,
  danger: strings.notes.slash.calloutDanger,
};

const CALLOUT_ITEMS: readonly SlashItem[] = CALLOUT_VARIANTS.map((variant) => ({
  key: `callout:${variant}`,
  label: CALLOUT_SLASH_LABELS[variant],
  run: (editor: Editor, range: Range) => applyCallout(editor, range, variant),
}));

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
  ...CALLOUT_ITEMS,
  {
    key: "toggle",
    label: strings.notes.slash.toggle,
    run: (editor, range) => insertToggle(editor, range),
  },
  {
    key: "tableOfContents",
    label: strings.notes.slash.tableOfContents,
    // A leaf atom with no attributes: everything it shows is derived from the
    // document's headings at render time (see `noteTableOfContents.tsx`).
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: "tableOfContents" }).run(),
  },
  {
    key: "flashcard",
    label: strings.notes.slash.flashcard,
    // The scaffold is text the author types over (NOTE-006c / ADR-017) — it
    // immediately becomes a real card via `NoteFlashcard`'s key plugin.
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertContent(strings.notes.cardScaffold).run(),
  },
  {
    key: "clozeBlank",
    label: strings.notes.slash.clozeBlank,
    // The `/query` goes first, as every item's does; the deletion is then
    // inserted at the caret it left behind, numbered by `insertClozeDeletion`
    // (ADR-068) — never by the author counting braces.
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      insertClozeDeletion(editor);
    },
  },
];

/**
 * Turns the live template list into slash items, appended after the ten block
 * commands, in `mergeTemplateEntries` order (built-ins first, then user
 * templates). Keys are `template:`-prefixed so they never collide with a
 * block command's key. An entry whose `content` failed to parse (`null`) is
 * excluded — an unparseable template has nothing to insert.
 */
function templateSlashItems(templates: readonly TemplateEntry[]): SlashItem[] {
  const items: SlashItem[] = [];
  for (const entry of templates) {
    if (entry.content === null) continue;
    const blocks = entry.content.content ?? [];
    items.push({
      key: `template:${entry.id}`,
      label: `${strings.notes.slashTemplatePrefix}${entry.name}`,
      run: (editor, range) =>
        // Caret-precise counterpart to the pane's append-at-end placement
        // (ADR-016): an ordinary local edit that the Collaboration binding
        // turns into Yjs ops, same as any typed keystroke.
        editor.chain().focus().deleteRange(range).insertContent(blocks).run(),
    });
  }
  return items;
}

/**
 * Case-insensitive sr-Latn substring match over the combined list: the block
 * commands, then every insertable template. Takes the template items
 * rather than reaching for a module global, since the live set changes as
 * templates are saved/renamed/deleted.
 */
function filterSlashItems(query: string, templates: readonly SlashItem[]): SlashItem[] {
  const all = [...SLASH_ITEMS, ...templates];
  const needle = query.toLocaleLowerCase("sr-Latn");
  if (needle.length === 0) return all;
  return all.filter((item) => item.label.toLocaleLowerCase("sr-Latn").includes(needle));
}

/** The render snapshot handed to React on each open/update of the suggestion. */
export interface SlashRenderState {
  items: SlashItem[];
  command: (item: SlashItem) => void;
  /**
   * The caret's rectangle as a LIVE getter, not the rectangle itself:
   * `@tiptap/suggestion` builds `clientRect` over the decoration node and
   * re-reads it on every call, so keeping the function is what lets the panel
   * follow the caret when the editor pane scrolls under it.
   */
  getRect: () => DOMRect | null;
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
    getRect: props.clientRect ?? (() => null),
  };
}

/**
 * Builds the slash-menu extension, wired to a set of React handlers plus a
 * `getTemplates` accessor. Created once per editor (per opened note), so the
 * handler closures stay stable — but `getTemplates` is called on every `/`
 * query, so the menu always reflects the current template list without the
 * extension instance itself ever being rebuilt.
 */
export function createSlashExtension(
  handlers: SlashHandlers,
  getTemplates: () => TemplateEntry[],
): Extension {
  return Extension.create({
    name: "nexusSlashMenu",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          editor: this.editor,
          char: "/",
          // Default `allowedPrefixes` ([' ']) + `startOfLine: false` already
          // restricts the trigger to a block start or a `/` after whitespace.
          items: ({ query }) => filterSlashItems(query, templateSlashItems(getTemplates())),
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
 * The floating command panel: thin wrapper delegating to the generic
 * `SuggestionMenu` (extracted panel logic — portal/keyboard/active-row — is
 * shared with the `[[` wiki-link menu, NOTE-004b). No behavior change.
 */
export function SlashMenu({ state, registerKeydown }: SlashMenuProps) {
  const { items, command, getRect } = state;
  return (
    <SuggestionMenu
      items={items}
      getKey={(item) => item.key}
      getLabel={(item) => item.label}
      command={command}
      getRect={getRect}
      registerKeydown={registerKeydown}
    />
  );
}
