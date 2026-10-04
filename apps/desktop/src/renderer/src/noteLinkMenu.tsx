import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion } from "@tiptap/suggestion";
import type { SuggestionProps } from "@tiptap/suggestion";
import type { NoteMeta } from "../../shared/ipc.js";
import { lowerCase } from "./intl.js";
import { SuggestionMenu } from "./suggestionMenu.js";
import { strings } from "./strings.js";

/**
 * The `[[` wiki-link autocomplete (ADR-013 / NOTE-004b), mirroring
 * `noteSlashMenu.tsx`'s structure exactly (same `onStart/onUpdate/onExit/
 * onKeyDown` handler pattern, same render-state shape). A dedicated
 * `PluginKey` is required: two `Suggestion` plugins sharing the default key
 * would collide with the slash menu's.
 */

/** Case-insensitive substring match on the title, folded in the ACTIVE locale; a blank title only ever matches the empty query. */
function matchesQuery(note: NoteMeta, needle: string): boolean {
  const title = note.title.trim();
  if (title.length === 0) return needle.length === 0;
  return lowerCase(note.title).includes(needle);
}

/** The render snapshot handed to React on each open/update of the suggestion. */
export interface NoteLinkRenderState {
  items: NoteMeta[];
  command: (item: NoteMeta) => void;
  /** The caret's rectangle as a LIVE getter — see `SlashRenderState.getRect`. */
  getRect: () => DOMRect | null;
}

/** Imperative hooks the extension calls; the React component owns the UI/state. */
export interface NoteLinkHandlers {
  onStart: (state: NoteLinkRenderState) => void;
  onUpdate: (state: NoteLinkRenderState) => void;
  onExit: () => void;
  /** Returns true when the key was consumed by the menu (arrows / Enter). */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export interface NoteLinkExtensionOptions {
  profileId: string;
  /** Excluded from the results — a note never links to itself. */
  currentNoteId: string;
}

function toState(props: SuggestionProps<NoteMeta, NoteMeta>): NoteLinkRenderState {
  return {
    items: props.items,
    command: props.command,
    getRect: props.clientRect ?? (() => null),
  };
}

/**
 * Builds the wiki-link menu extension, wired to a set of React handlers.
 * Created once per editor (per opened note), so the handler closures stay
 * stable.
 */
export function createNoteLinkExtension(
  handlers: NoteLinkHandlers,
  { profileId, currentNoteId }: NoteLinkExtensionOptions,
): Extension {
  return Extension.create({
    name: "nexusNoteLinkMenu",
    addProseMirrorPlugins() {
      return [
        Suggestion<NoteMeta, NoteMeta>({
          editor: this.editor,
          pluginKey: new PluginKey("nexusNoteLinkSuggestion"),
          char: "[[",
          allowSpaces: true,
          startOfLine: false,
          items: async ({ query }) => {
            try {
              const notes = await window.nexus.listNotes(profileId);
              const needle = lowerCase(query);
              return notes
                .filter((note) => note.id !== currentNoteId)
                .filter((note) => matchesQuery(note, needle))
                .slice(0, 8);
            } catch (error) {
              console.error("Nexus: failed to load notes for the wiki-link menu:", error);
              return [];
            }
          },
          command: ({ editor, range, props }) => {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent([
                { type: "noteLink", attrs: { noteId: props.id, label: props.title } },
                { type: "text", text: " " },
              ])
              .run();
          },
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

export interface NoteLinkMenuProps {
  state: NoteLinkRenderState;
  /** Publishes the panel's key handler up to the extension's `onKeyDown`. */
  registerKeydown: (handler: (event: KeyboardEvent) => boolean) => void;
}

/** The floating note picker: delegates to the generic `SuggestionMenu`. */
export function NoteLinkMenu({ state, registerKeydown }: NoteLinkMenuProps) {
  const { items, command, getRect } = state;
  return (
    <SuggestionMenu
      items={items}
      getKey={(item) => item.id}
      getLabel={(item) => (item.title.trim().length > 0 ? item.title : strings.notes.untitled)}
      command={command}
      getRect={getRect}
      registerKeydown={registerKeydown}
    />
  );
}
