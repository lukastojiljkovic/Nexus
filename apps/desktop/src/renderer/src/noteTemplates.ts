import type { JSONContent } from "@tiptap/core";
import type { BuiltinNoteTemplateId } from "@nexus/core";
import type { NoteTemplate } from "../../shared/ipc.js";
import { collator } from "./intl.js";
import { activeLocale, strings } from "./strings.js";

/**
 * The five built-in note templates (ADR-016 / NOTE-009 slice 009-b) —
 * Sastanak, Dnevnik, Recept, Predmet, Projekat — plus `stripAttachmentNodes`,
 * used by "Sačuvaj kao šablon".
 *
 * Their body text sits inline with the structure below rather than in
 * `strings.ts`, a deliberate, documented exception to the house rule that all
 * user-facing copy lives there: a template body is structure-bearing content,
 * not a label, and splitting the two would leave both unreadable. Each
 * built-in therefore carries its body twice, `bodySr` beside `bodyEn`, and
 * `content` reads the ACTIVE locale — a getter rather than a field, for the
 * reason `name` is one. What gets inserted is a snapshot of that reading, so a
 * template copied into a note never retranslates afterwards, exactly like the
 * persisted defaults `main/shellStrings.ts` documents. Template *names* are
 * NOT an exception and stay in `strings.ts` like every other label
 * (`strings.notes.templateBuiltins.*`), which is what keeps the picker and the
 * body it inserts in one language.
 *
 * Also home to `TemplateEntry` / `mergeTemplateEntries`: the shared shape that
 * turns a profile's stored rows plus the built-ins above into the one ordered
 * list both the Šabloni pane (009-b) and the slash menu (009-c) render from,
 * so the parse/sort/merge logic exists exactly once.
 */

export interface BuiltinTemplate {
  /**
   * `builtin:`-prefixed — the prefix is what makes these non-renameable and
   * non-deletable. Typed as `BuiltinNoteTemplateId` (`@nexus/core`) rather than
   * a bare string since ADR-036: `NoteOrgStore` validates a folder's default
   * template against that same constant list, so a respelled id here would be a
   * compile error instead of a folder whose template silently never applies.
   */
  id: BuiltinNoteTemplateId;
  name: string;
  /** The body inserted while Serbian is served. Always a full `{ type: "doc", content: [...] }` node. */
  readonly bodySr: JSONContent;
  /**
   * The body inserted while English is served — the same structure, heading
   * for heading, so the two cannot drift into two different templates.
   */
  readonly bodyEn: JSONContent;
  /** The body for the active locale. Always a full `{ type: "doc", content: [...] }` node. */
  readonly content: JSONContent;
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

// `name` is a getter on every entry below, not a captured field — this array
// is built once at import, so a plain field would freeze the Serbian name
// forever; the getter re-reads `strings` wherever a name is read instead.
export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = [
  {
    id: "builtin:sastanak",
    get name() {
      return strings.notes.templateBuiltins.sastanak;
    },
    bodySr: doc(
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
    bodyEn: doc(
      heading(1, "Meeting"),
      paragraph("Date:"),
      paragraph("Attendees:"),
      heading(2, "Agenda"),
      bullets(),
      heading(2, "Notes"),
      paragraph(),
      heading(2, "Decisions and tasks"),
      tasks(),
    ),
    get content() {
      return activeLocale() === "en" ? this.bodyEn : this.bodySr;
    },
  },
  {
    id: "builtin:dnevnik",
    get name() {
      return strings.notes.templateBuiltins.dnevnik;
    },
    bodySr: doc(
      heading(1, "Dnevnik"),
      heading(2, "Šta se danas desilo"),
      paragraph(),
      heading(2, "Šta sam naučio"),
      paragraph(),
      heading(2, "Plan za sutra"),
      tasks(),
    ),
    bodyEn: doc(
      heading(1, "Journal"),
      heading(2, "What happened today"),
      paragraph(),
      heading(2, "What I learned"),
      paragraph(),
      heading(2, "Plan for tomorrow"),
      tasks(),
    ),
    get content() {
      return activeLocale() === "en" ? this.bodyEn : this.bodySr;
    },
  },
  {
    id: "builtin:recept",
    get name() {
      return strings.notes.templateBuiltins.recept;
    },
    bodySr: doc(
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
    bodyEn: doc(
      heading(1, "Dish name"),
      paragraph("Servings:"),
      paragraph("Preparation time:"),
      heading(2, "Ingredients"),
      bullets(),
      heading(2, "Method"),
      ordered(),
      heading(2, "Notes"),
      paragraph(),
    ),
    get content() {
      return activeLocale() === "en" ? this.bodyEn : this.bodySr;
    },
  },
  {
    id: "builtin:predmet",
    get name() {
      return strings.notes.templateBuiltins.predmet;
    },
    bodySr: doc(
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
    bodyEn: doc(
      heading(1, "Course"),
      paragraph("Teacher:"),
      paragraph("Exam:"),
      heading(2, "Objectives"),
      bullets(),
      heading(2, "Reading list"),
      bullets(),
      heading(2, "Lecture notes"),
      paragraph(),
      heading(2, "Obligations"),
      tasks(),
    ),
    get content() {
      return activeLocale() === "en" ? this.bodyEn : this.bodySr;
    },
  },
  {
    id: "builtin:projekat",
    get name() {
      return strings.notes.templateBuiltins.projekat;
    },
    bodySr: doc(
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
    bodyEn: doc(
      heading(1, "Project"),
      paragraph("Goal:"),
      paragraph("Deadline:"),
      heading(2, "Steps"),
      tasks(),
      heading(2, "Notes"),
      paragraph(),
      heading(2, "Open questions"),
      bullets(),
    ),
    get content() {
      return activeLocale() === "en" ? this.bodyEn : this.bodySr;
    },
  },
];

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
 * rows sorted by name in the active locale. A row whose JSON fails to parse is kept with
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
    .sort((a, b) => collator().compare(a.name, b.name));
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
