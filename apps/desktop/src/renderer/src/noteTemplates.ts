import type { JSONContent } from "@tiptap/core";
import type { NoteTemplate } from "../../shared/ipc.js";
import { strings } from "./strings.js";

/**
 * The five built-in note templates (ADR-016 / NOTE-009 slice 009-b) —
 * Sastanak, Dnevnik, Recept, Predmet, Projekat — plus `stripAttachmentNodes`,
 * used by "Sačuvaj kao šablon".
 *
 * Their Serbian body text sits inline with the structure below rather than in
 * `strings.ts`, a deliberate, documented exception to the house rule that all
 * user-facing copy lives there: a template body is structure-bearing content,
 * not a label, and splitting the two would leave both unreadable. This file
 * is therefore part of the future mechanical i18n extraction (ADR-016), same
 * as any other renderer copy — it just is not extracted yet. Template
 * *names* are NOT an exception and stay in `strings.ts` like every other
 * label (`strings.notes.templateBuiltins.*`).
 *
 * Also home to `TemplateEntry` / `mergeTemplateEntries`: the shared shape that
 * turns a profile's stored rows plus the built-ins above into the one ordered
 * list both the Šabloni pane (009-b) and the slash menu (009-c) render from,
 * so the parse/sort/merge logic exists exactly once.
 */

export interface BuiltinTemplate {
  /** `builtin:`-prefixed — the prefix is what makes these non-renameable and non-deletable. */
  id: string;
  name: string;
  /** Always a full `{ type: "doc", content: [...] }` node. */
  content: JSONContent;
}

// Small local builders so each template body below stays ~8 readable lines.

function heading(level: 1 | 2 | 3, text: string): JSONContent {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
}

function paragraph(text?: string): JSONContent {
  return text === undefined
    ? { type: "paragraph" }
    : { type: "paragraph", content: [{ type: "text", text }] };
}

/** One empty bullet, ready to type into. */
function bullets(): JSONContent {
  return { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] };
}

/** One empty numbered item, ready to type into. */
function ordered(): JSONContent {
  return { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] };
}

/** One empty, unchecked task, ready to type into. */
function tasks(): JSONContent {
  return {
    type: "taskList",
    content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] }],
  };
}

function doc(...content: JSONContent[]): JSONContent {
  return { type: "doc", content };
}

export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = [
  {
    id: "builtin:sastanak",
    name: strings.notes.templateBuiltins.sastanak,
    content: doc(
      heading(1, "Sastanak"),
      paragraph("Datum:"),
      paragraph("Učesnici:"),
      heading(2, "Dnevni red"),
      bullets(),
      heading(2, "Beleške"),
      paragraph(),
      heading(2, "Zaključci i zadaci"),
      tasks(),
    ),
  },
  {
    id: "builtin:dnevnik",
    name: strings.notes.templateBuiltins.dnevnik,
    content: doc(
      heading(1, "Dnevnik"),
      heading(2, "Šta se danas desilo"),
      paragraph(),
      heading(2, "Šta sam naučio"),
      paragraph(),
      heading(2, "Plan za sutra"),
      tasks(),
    ),
  },
  {
    id: "builtin:recept",
    name: strings.notes.templateBuiltins.recept,
    content: doc(
      heading(1, "Naziv jela"),
      paragraph("Porcije:"),
      paragraph("Vreme pripreme:"),
      heading(2, "Sastojci"),
      bullets(),
      heading(2, "Priprema"),
      ordered(),
      heading(2, "Napomene"),
      paragraph(),
    ),
  },
  {
    id: "builtin:predmet",
    name: strings.notes.templateBuiltins.predmet,
    content: doc(
      heading(1, "Predmet"),
      paragraph("Profesor:"),
      paragraph("Ispit:"),
      heading(2, "Ciljevi"),
      bullets(),
      heading(2, "Literatura"),
      bullets(),
      heading(2, "Beleške sa predavanja"),
      paragraph(),
      heading(2, "Obaveze"),
      tasks(),
    ),
  },
  {
    id: "builtin:projekat",
    name: strings.notes.templateBuiltins.projekat,
    content: doc(
      heading(1, "Projekat"),
      paragraph("Cilj:"),
      paragraph("Rok:"),
      heading(2, "Koraci"),
      tasks(),
      heading(2, "Beleške"),
      paragraph(),
      heading(2, "Otvorena pitanja"),
      bullets(),
    ),
  },
];

/** sr-Latn collation for user templates — plain "sr" mis-tailors Latin š/č/ć. */
const collator = new Intl.Collator(["sr-Latn", "sr"]);

/** One template row, covering both the built-in and user-defined sources. */
export interface TemplateEntry {
  id: string;
  name: string;
  builtin: boolean;
  /** `null` for a stored row whose JSON failed to parse — the row still lists. */
  content: JSONContent | null;
}

/**
 * Built-ins first (their authored order above), then the profile's stored
 * rows sr-Latn sorted by name. A row whose JSON fails to parse is kept with
 * `content: null` rather than dropped, so a corrupt template is still visible
 * to rename or delete. Shared by the Šabloni pane (009-b) and the slash menu
 * (009-c) — the parse/sort/merge logic exists exactly once.
 */
export function mergeTemplateEntries(rows: readonly NoteTemplate[]): TemplateEntry[] {
  const userEntries: TemplateEntry[] = rows
    .map((row): TemplateEntry => {
      let content: JSONContent | null;
      try {
        content = JSON.parse(row.content) as JSONContent;
      } catch (error) {
        content = null;
        console.error("Nexus: failed to parse template content:", error);
      }
      return { id: row.id, name: row.name, builtin: false, content };
    })
    .sort((a, b) => collator.compare(a.name, b.name));
  const builtinEntries: TemplateEntry[] = BUILTIN_TEMPLATES.map((template) => ({
    id: template.id,
    name: template.name,
    builtin: true,
    content: template.content,
  }));
  return [...builtinEntries, ...userEntries];
}

/**
 * Removes every `attachmentImage` node from a captured document (ADR-016): those
 * nodes carry an attachment id owned by the *source* note, so inserted anywhere else
 * they resolve to nothing and render the removed-attachment placeholder — a template
 * that always looks broken. `noteLink` nodes are deliberately kept: a link to a real
 * note stays valid from any note.
 */
export function stripAttachmentNodes(node: JSONContent): JSONContent {
  if (node.content === undefined) return { ...node };
  return {
    ...node,
    content: node.content
      .filter((child) => child.type !== "attachmentImage")
      .map(stripAttachmentNodes),
  };
}
