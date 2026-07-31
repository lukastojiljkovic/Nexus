import { Node, mergeAttributes, wrappingInputRule } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import { DEFAULT_CALLOUT_VARIANT, normalizeCalloutVariant } from "@nexus/core";
import type { CalloutVariant } from "@nexus/core";
import { strings } from "./strings.js";

/**
 * The „Okvir" block (NOTE-011): a block container that holds ordinary blocks
 * — paragraphs, lists, a code block — and paints them with one of four closed
 * variants. Configured exactly like the blockquote it sits beside in the v1
 * set (`content: "block+"`, `defining`), so everything that already works
 * inside a quote works inside a callout: markdown shortcuts, the slash menu,
 * inline flashcards (a paragraph is still a paragraph in here, so ADR-017's
 * `cardKey` global attribute and its parser reach it untouched).
 *
 * The variant vocabulary itself lives in `@nexus/core` (`noteBlocks.ts`),
 * because the Markdown export reads back what this node writes — see that
 * file for why the ids are English while the labels are Serbian.
 *
 * No node view: the whole block is `data-callout` + `data-variant` and a
 * handful of token rules in app.css. A React view would buy nothing here —
 * there is no live data to resolve (unlike `noteLink`/`attachmentImage`) and
 * no affordance to click (unlike the toggle's chevron).
 */

/**
 * The accessible name each variant lends its block. Colour alone must not be
 * the only thing that says "this is the dangerous one", and the block is a
 * plain container with no visible label of its own — deliberately, because a
 * CSS-injected `content:` string would fork user-facing copy out of
 * `strings.ts`. `role="note"` + this name is what carries the distinction to
 * a screen reader instead.
 */
const CALLOUT_ARIA_LABELS: Record<CalloutVariant, string> = {
  info: strings.notes.callout.info,
  tip: strings.notes.callout.tip,
  warning: strings.notes.callout.warning,
  danger: strings.notes.callout.danger,
};

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      variant: {
        // Normalised on both sides of the DOM boundary: a hand-edited HTML
        // paste, or a document written by a future version that knows a fifth
        // variant, reads as the neutral one rather than as an unstyled block.
        default: DEFAULT_CALLOUT_VARIANT,
        parseHTML: (element) => normalizeCalloutVariant(element.getAttribute("data-variant")),
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-variant": normalizeCalloutVariant(attributes["variant"]),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const variant = normalizeCalloutVariant(node.attrs["variant"]);
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-callout": "",
        role: "note",
        "aria-label": CALLOUT_ARIA_LABELS[variant],
      }),
      0,
    ];
  },

  /**
   * `::: ` opens a neutral callout, `:::tip `/`:::warning `/`:::danger ` a
   * named one — the same directive spelling the Markdown export writes, so
   * what you type is what the `.md` mirror shows. Safe beside ADR-017's card
   * syntax: `parseCardBlock`'s `::` separator requires whitespace on BOTH
   * sides, which a line that opens with three colons can never satisfy.
   *
   * An unrecognised word (`:::foo `) still opens a callout, at the neutral
   * variant — the rule is a shortcut, not a validator, and silently doing
   * nothing would read as a broken keystroke.
   */
  addInputRules() {
    return [
      wrappingInputRule({
        find: /^:::([a-z]*)\s$/,
        type: this.type,
        getAttributes: (match) => ({ variant: normalizeCalloutVariant(match[1]) }),
      }),
    ];
  },
});

/**
 * The one entry point the slash menu uses, for all four variants:
 *
 * - inside a callout of a DIFFERENT variant -> restyle it in place. Re-running
 *   the command is how a callout's variant is changed at all; a nested
 *   callout is never what someone means by "make this one a warning".
 * - inside a callout of the SAME variant -> lift out of it, so the command
 *   reads like `toggleBlockquote` beside it in the menu: run it again to undo.
 * - anywhere else -> wrap the current block.
 *
 * Deliberately a plain function rather than a registered TipTap command: the
 * only caller is the slash menu, and a command would cost a global
 * `Commands` interface augmentation for nothing.
 */
export function applyCallout(editor: Editor, range: Range, variant: CalloutVariant): void {
  // Read before `deleteRange` runs — removing the typed "/query" text cannot
  // move the caret out of the block it is in, so the answer is the same either
  // way, but reading first keeps this independent of the chain's ordering.
  const inCallout = editor.isActive("callout");
  const inSameVariant = editor.isActive("callout", { variant });
  const chain = editor.chain().focus().deleteRange(range);
  if (inCallout && !inSameVariant) {
    chain.updateAttributes("callout", { variant }).run();
    return;
  }
  chain.toggleWrap("callout", { variant }).run();
}
