/**
 * The CANVAS module through the assistant's eyes: its boards, and the three
 * things a person asks for by voice — a diagram, a note drawn as one, and a
 * note, task or event pinned to a board.
 *
 * **Who owns what.** A board's METADATA (its name, its existence) is store
 * state, so the board tools write through `CanvasStore`, the one the IPC handlers
 * call. A board's DRAWING is held in memory by the open page and autosaved from
 * there, so a write from main would be clobbered by the page's next save. The
 * drawing tools therefore create the board here, if they must, and then ask the
 * page to apply the change: `navigateTo` with an `action` the page applies
 * (`CanvasPage.tsx`, `canvasIntent.ts`).
 *
 * **Why a board is a name the model may type.** A person says „na tabli Plan",
 * not „id 0198…". So a board is named by its id or its name, the name is matched
 * ignoring case and diacritics, and an ambiguous name is refused with the
 * candidates listed.
 *
 * **Undo of a delete is not a tool.** `CanvasStore.restore` exists, but a
 * deleted board is not listed, so the model would have to name an id it was
 * never shown. The page's own undo banner is the way back.
 */

import { CanvasStore, MAX_CANVAS_BOARD_NAME_LENGTH, NoteStore, type CanvasBoard } from "@nexus/db";
import {
  CANVAS_SKETCH_LAYOUTS,
  CANVAS_SKETCH_SHAPES,
  CANVAS_SKETCH_TONES,
  MAX_CANVAS_SKETCH_NODES,
  canvasRefText,
  foldSearchText,
  noteOutlineItems,
  noteOutlineSketch,
  parseCanvasSketch,
  type AssistantLocale,
  type CanvasRefKind,
  type CanvasSketch,
  type Tool,
  type ToolResult,
} from "@nexus/core";
import { asArgs, asEnum, asIdentifier, asOptionalCount, asText } from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  failResult,
  guard,
  localDay,
  okResult,
  phrase,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface CanvasToolDeps {
  readonly profileDb: ProfileDb;
  readonly now: () => number;
}

/** How many boards a list answers with, and the most it may ask for. */
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

/** How many text labels a board's reading names before it says more exist. */
const MAX_LABELS_SHOWN = 30;

/** The title a note takes when it has none. */
const UNTITLED_NOTE: AssistantPhrase<[]> = {
  sr: () => "Beleška",
  en: () => "Note",
};

/** Which kinds of Nexus object a card may point at. */
const CARD_KINDS = ["note", "task", "event"] as const satisfies readonly CanvasRefKind[];

const NOT_FOUND_BOARD: AssistantPhrase<[board: string, known: string]> = {
  sr: (board, known) => `Nema table „${board}“. Table u ovom profilu: ${known}.`,
  en: (board, known) => `No board named “${board}”. This profile's boards: ${known}.`,
};

const AMBIGUOUS_BOARD: AssistantPhrase<[board: string, candidates: string]> = {
  sr: (board, candidates) => `Ima više tabli zvanih „${board}“: ${candidates}. Navedi id.`,
  en: (board, candidates) => `More than one board is called “${board}”: ${candidates}. Name it by its id.`,
};

const NOT_FOUND_NOTE: AssistantPhrase<[note: string]> = {
  sr: (note) => `Nema aktivne beleške „${note}“.`,
  en: (note) => `No active note matches “${note}”.`,
};

const AMBIGUOUS_NOTE: AssistantPhrase<[note: string, candidates: string]> = {
  sr: (note, candidates) => `Ima više beleški zvanih „${note}“: ${candidates}. Navedi id.`,
  en: (note, candidates) => `More than one note is called “${note}”: ${candidates}. Name it by its id.`,
};

const NOT_FOUND_CARD: AssistantPhrase<[kind: string, id: string]> = {
  sr: (kind, id) => `Ne postoji aktivan ${kind} sa id-jem „${id}“.`,
  en: (kind, id) => `No active ${kind} has the id “${id}”.`,
};

const KIND_WORD: Record<(typeof CARD_KINDS)[number], { sr: string; en: string }> = {
  note: { sr: "beleška", en: "note" },
  task: { sr: "zadatak", en: "task" },
  event: { sr: "događaj", en: "event" },
};

const LIST_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Table (${count}):`,
  en: (count) => `Boards (${count}):`,
};

const NO_BOARDS: { sr: string; en: string } = {
  sr: "Ovaj profil nema tabli.",
  en: "This profile has no boards.",
};

const TRUNCATED: AssistantPhrase<[shown: number]> = {
  sr: (shown) => `Prikazano je samo prvih ${shown} tabli.`,
  en: (shown) => `Showing only the first ${shown} boards.`,
};

const EMPTY_BOARD: AssistantPhrase<[name: string]> = {
  sr: (name) => `Tabla „${name}“ je prazna.`,
  en: (name) => `The board “${name}” is empty.`,
};

const READ_BOARD: AssistantPhrase<[name: string, id: string, elements: string]> = {
  sr: (name, id, elements) => `Tabla „${name}“ (${id}). Elementi: ${elements}.`,
  en: (name, id, elements) => `Board “${name}” (${id}). Elements: ${elements}.`,
};

const LABELS_HEADING: { sr: string; en: string } = {
  sr: "Tekstovi na tabli:",
  en: "Text on the board:",
};

const MORE_LABELS: AssistantPhrase<[shown: number]> = {
  sr: (shown) => `Prikazano je prvih ${shown} tekstova.`,
  en: (shown) => `Showing only the first ${shown} labels.`,
};

const CREATE_SUMMARY: AssistantPhrase<[name: string]> = {
  sr: (name) => `Napravi tablu „${name}“`,
  en: (name) => `Make a board called “${name}”`,
};

const RENAME_SUMMARY: AssistantPhrase<[from: string, to: string]> = {
  sr: (from, to) => `Preimenuj tablu „${from}“ u „${to}“`,
  en: (from, to) => `Rename the board “${from}” to “${to}”`,
};

const DELETE_SUMMARY: AssistantPhrase<[name: string]> = {
  sr: (name) => `Obriši tablu „${name}“ zajedno sa crtežom`,
  en: (name) => `Delete the board “${name}” with its drawing`,
};

const DRAW_SUMMARY: AssistantPhrase<[boxes: number, name: string, isNew: boolean]> = {
  sr: (boxes, name, isNew) =>
    isNew
      ? `Napravi tablu „${name}“ i nacrtaj na njoj ${boxes} kutija`
      : `Nacrtaj na tabli „${name}“ ${boxes} kutija`,
  en: (boxes, name, isNew) =>
    isNew
      ? `Make a board called “${name}” and draw ${boxes} boxes on it`
      : `Draw ${boxes} boxes on the board “${name}”`,
};

const VISUALIZE_SUMMARY: AssistantPhrase<[note: string, boxes: number]> = {
  sr: (note, boxes) => `Napravi tablu od beleške „${note}“ sa ${boxes} kutija`,
  en: (note, boxes) => `Make a board from the note “${note}” with ${boxes} boxes`,
};

const CARD_SUMMARY: AssistantPhrase<[kind: string, title: string, board: string]> = {
  sr: (kind, title, board) => `Stavi ${kind} „${title}“ na tablu „${board}“`,
  en: (kind, title, board) => `Put the ${kind} “${title}” on the board “${board}”`,
};

const CREATED: AssistantPhrase<[name: string, id: string]> = {
  sr: (name, id) => `Napravljena tabla „${name}“ (${id}).`,
  en: (name, id) => `Created board “${name}” (${id}).`,
};

const RENAMED: AssistantPhrase<[name: string, id: string]> = {
  sr: (name, id) => `Tabla je preimenovana u „${name}“ (${id}).`,
  en: (name, id) => `Renamed the board to “${name}” (${id}).`,
};

const DELETED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Obrisana tabla „${name}“.`,
  en: (name) => `Deleted the board “${name}”.`,
};

const SENT_SKETCH: AssistantPhrase<[boxes: number, name: string, id: string]> = {
  sr: (boxes, name, id) => `Poslat je crtež sa ${boxes} kutija na tablu „${name}“ (${id}).`,
  en: (boxes, name, id) => `Sent a drawing of ${boxes} boxes to the board “${name}” (${id}).`,
};

const SENT_CARD: AssistantPhrase<[kind: string, title: string, board: string]> = {
  sr: (kind, title, board) => `Poslata je kartica za ${kind} „${title}“ na tablu „${board}“.`,
  en: (kind, title, board) => `Sent the card for the ${kind} “${title}” to the board “${board}”.`,
};

/** A board's name as the store keeps it, and a note's title, are both short; a label is cut at this many characters. */
const LABEL_CHARS = 120;

export function canvasTools(deps: CanvasToolDeps): readonly Tool[] {
  /** One profile's two stores, built the way `main/index.ts` builds them for a handler. */
  function stores(profileId: string): { canvas: CanvasStore; notes: NoteStore } {
    return deps.profileDb(profileId, (db, id) => ({
      canvas: new CanvasStore(db, id),
      notes: new NoteStore(db, id),
    }));
  }

  const boards: Tool = {
    name: "canvas.boards",
    description: {
      sr: "Izlistava table u profilu, ili pokazuje jednu: broj elemenata po vrsti i tekstove na njoj. Koristi ga da nađeš ime ili id table, ili kad korisnik pita šta crtež na tabli prikazuje.",
      en: "Lists the boards in this profile, or reads one: its element count by kind and the text on it. Use it to find a board's name or id, or when the user asks what a diagram on a board says.",
    },
    parameters: {
      type: "object",
      properties: {
        board: {
          type: "string",
          minLength: 1,
          maxLength: MAX_CANVAS_BOARD_NAME_LENGTH,
          description: "The board's name or id, to read that one. Leave it out to list the boards.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIST_LIMIT,
          description: `How many boards to list. Defaults to ${DEFAULT_LIST_LIMIT}.`,
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const { canvas } = stores(context.profileId);
        const listed = canvas.listActive();
        if (args.board !== undefined) {
          const board = resolveBoard(listed, asText(args.board, "board", MAX_CANVAS_BOARD_NAME_LENGTH), context.locale);
          const { elements, labels } = readBoard(canvas, board.id);
          const lines = [
            phrase(context.locale, READ_BOARD, board.name, board.id, elements.length === 0 ? "-" : elements),
          ];
          if (labels.length === 0) lines.push(phrase(context.locale, EMPTY_BOARD, board.name));
          else {
            lines.push(text(context.locale, LABELS_HEADING));
            lines.push(...labels.slice(0, MAX_LABELS_SHOWN).map((label) => `- ${label}`));
            if (labels.length > MAX_LABELS_SHOWN) {
              lines.push(phrase(context.locale, MORE_LABELS, MAX_LABELS_SHOWN));
            }
          }
          return okResult(lines.join("\n"));
        }
        if (listed.length === 0) return okResult(text(context.locale, NO_BOARDS));
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_LIST_LIMIT) ?? DEFAULT_LIST_LIMIT;
        const shown = listed.slice(0, limit);
        const content = [
          phrase(context.locale, LIST_HEADING, listed.length),
          ...shown.map((board) => `- ${board.name} (${board.id}, ${localDay(Date.parse(board.updatedAt))})`),
        ];
        if (shown.length < listed.length) content.push(phrase(context.locale, TRUNCATED, shown.length));
        return okResult(content.join("\n"));
      }),
  };

  const create: Tool = {
    name: "canvas.create",
    description: {
      sr: "Pravi praznu tablu sa imenom. Koristi ga kad korisnik traži novu tablu; ako treba odmah nešto nacrtati, koristi canvas.draw.",
      en: "Makes an empty board with a name. Use it when the user asks for a new board; to draw something straight away, use canvas.draw.",
    },
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: MAX_CANVAS_BOARD_NAME_LENGTH,
          description: "The board's name.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const name = asText(asArgs(rawArgs).name, "name", MAX_CANVAS_BOARD_NAME_LENGTH);
        const declined = await confirmOrDecline(
          context,
          "canvas.create",
          "write",
          phrase(context.locale, CREATE_SUMMARY, name),
        );
        if (declined !== null) return declined;
        const board = stores(context.profileId).canvas.create({ name }, instantOf(deps.now()));
        return okResult(phrase(context.locale, CREATED, board.name, board.id), {
          navigateTo: { module: "canvas", item: board.id },
        });
      }),
  };

  const rename: Tool = {
    name: "canvas.rename",
    description: {
      sr: "Menja ime table. Tablu određuješ njenim imenom ili id-jem.",
      en: "Renames a board. Name the board by its current name or its id.",
    },
    parameters: {
      type: "object",
      properties: {
        board: {
          type: "string",
          minLength: 1,
          maxLength: MAX_CANVAS_BOARD_NAME_LENGTH,
          description: "The board's current name or id.",
        },
        name: {
          type: "string",
          minLength: 1,
          maxLength: MAX_CANVAS_BOARD_NAME_LENGTH,
          description: "The new name.",
        },
      },
      required: ["board", "name"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const { canvas } = stores(context.profileId);
        const board = resolveBoard(canvas.listActive(), asText(args.board, "board", MAX_CANVAS_BOARD_NAME_LENGTH), context.locale);
        const name = asText(args.name, "name", MAX_CANVAS_BOARD_NAME_LENGTH);
        const declined = await confirmOrDecline(
          context,
          "canvas.rename",
          "write",
          phrase(context.locale, RENAME_SUMMARY, board.name, name),
        );
        if (declined !== null) return declined;
        const renamed = canvas.rename(board.id, name, instantOf(deps.now()));
        return okResult(phrase(context.locale, RENAMED, renamed.name, renamed.id), {
          navigateTo: { module: "canvas", item: renamed.id },
        });
      }),
  };

  const remove: Tool = {
    name: "canvas.delete",
    description: {
      sr: "Briše tablu zajedno sa crtežom. Koristi ga samo kad korisnik traži brisanje; korisnik se pita pre toga.",
      en: "Deletes a board with its drawing. Use it only when the user asks to delete a board; the user is asked first.",
    },
    parameters: {
      type: "object",
      properties: {
        board: {
          type: "string",
          minLength: 1,
          maxLength: MAX_CANVAS_BOARD_NAME_LENGTH,
          description: "The board's name or id.",
        },
      },
      required: ["board"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const { canvas } = stores(context.profileId);
        const board = resolveBoard(canvas.listActive(), asText(asArgs(rawArgs).board, "board", MAX_CANVAS_BOARD_NAME_LENGTH), context.locale);
        const declined = await confirmOrDecline(
          context,
          "canvas.delete",
          "write",
          phrase(context.locale, DELETE_SUMMARY, board.name),
        );
        if (declined !== null) return declined;
        canvas.softDelete(board.id, instantOf(deps.now()));
        return okResult(phrase(context.locale, DELETED, board.name));
      }),
  };

  const draw: Tool = {
    name: "canvas.draw",
    description: {
      sr: "Crta dijagram na tabli: kutije i strelice između njih, raspoređene automatski. Navedi kutije i veze, nikad koordinate. Ime table koje ne postoji pravi novu tablu. Boje: mastilo, zlato, bronza, maslina, suma, zad, ruza, bordo, grafit.",
      en: "Draws a diagram on a board: boxes and the arrows between them, laid out for you. Name the boxes and their arrows, never coordinates. A board name that does not exist makes a new board. Colours: mastilo, zlato, bronza, maslina, suma, zad, ruza, bordo, grafit.",
    },
    parameters: {
      type: "object",
      properties: {
        board: {
          type: "string",
          minLength: 1,
          maxLength: MAX_CANVAS_BOARD_NAME_LENGTH,
          description: "The board's name or id. A new name makes a new board.",
        },
        sketch: SKETCH_SCHEMA,
      },
      required: ["board", "sketch"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const wanted = asText(args.board, "board", MAX_CANVAS_BOARD_NAME_LENGTH);
        const sketch = parseCanvasSketch(args.sketch);
        const { canvas } = stores(context.profileId);
        const existing = findBoard(canvas.listActive(), wanted, context.locale);
        const boxes = sketch.nodes.length;
        const declined = await confirmOrDecline(
          context,
          "canvas.draw",
          "write",
          phrase(context.locale, DRAW_SUMMARY, boxes, existing?.name ?? wanted, existing === undefined),
        );
        if (declined !== null) return declined;
        const board = existing ?? canvas.create({ name: wanted }, instantOf(deps.now()));
        return sketchResult(context.locale, board, sketch);
      }),
  };

  const visualize: Tool = {
    name: "canvas.visualize",
    description: {
      sr: "Crta belešku kao dijagram na novoj tabli: naslovi kao stablo, a wiki-veze kao strelice ka povezanim beleškama. Koristi ga kad korisnik traži da vidi ili prikaže belešku. Privatne beleške nisu dostupne.",
      en: "Draws a note as a diagram on a new board: its headings as a tree and its wiki-links as arrows to the notes they name. Use it when the user asks to see or map a note. Private notes are not reachable.",
    },
    parameters: {
      type: "object",
      properties: {
        note: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "The note's title or id.",
        },
      },
      required: ["note"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const wanted = asText(asArgs(rawArgs).note, "note", 200);
        const { canvas, notes } = stores(context.profileId);
        const note = findNote(notes.list(), wanted, context.locale);
        const title = note.title.trim() || phrase(context.locale, UNTITLED_NOTE);
        const state = notes.readForCompaction(note.id);
        const outline = noteOutlineSketch(
          title,
          noteOutlineItems(state.snapshot, state.updates.map((update) => update.bytes)),
        );
        const name = title.slice(0, MAX_CANVAS_BOARD_NAME_LENGTH);
        const declined = await confirmOrDecline(
          context,
          "canvas.visualize",
          "write",
          phrase(context.locale, VISUALIZE_SUMMARY, title, outline.nodes.length),
        );
        if (declined !== null) return declined;
        const board = canvas.create({ name }, instantOf(deps.now()));
        return sketchResult(context.locale, board, outline);
      }),
  };

  const card: Tool = {
    name: "canvas.card",
    description: {
      sr: "Stavlja belešku, zadatak ili događaj na tablu kao karticu koja vodi nazad do njega. Treba id predmeta, iz notes.search, tasks.list ili kalendara.",
      en: "Puts a note, task or event on a board as a card that links back to it. It needs the object's id, from notes.search, tasks.list or the calendar.",
    },
    parameters: {
      type: "object",
      properties: {
        board: {
          type: "string",
          minLength: 1,
          maxLength: MAX_CANVAS_BOARD_NAME_LENGTH,
          description: "The board's name or id.",
        },
        kind: { type: "string", enum: [...CARD_KINDS], description: "What the object is." },
        id: { type: "string", minLength: 1, maxLength: 64, description: "The object's id." },
      },
      required: ["board", "kind", "id"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const { canvas } = stores(context.profileId);
        const board = resolveBoard(canvas.listActive(), asText(args.board, "board", MAX_CANVAS_BOARD_NAME_LENGTH), context.locale);
        const kind = asEnum(args.kind, "kind", CARD_KINDS);
        const id = asIdentifier(args.id, "id");
        const [resolved] = canvas.resolveRefs([{ kind, id }]);
        if (resolved === undefined || resolved.missing) {
          return failResult(context.locale, phrase(context.locale, NOT_FOUND_CARD, text(context.locale, KIND_WORD[kind]), id));
        }
        const title = resolved.title.trim() || text(context.locale, KIND_WORD[kind]);
        const declined = await confirmOrDecline(
          context,
          "canvas.card",
          "write",
          phrase(context.locale, CARD_SUMMARY, text(context.locale, KIND_WORD[kind]), title, board.name),
        );
        if (declined !== null) return declined;
        return okResult(phrase(context.locale, SENT_CARD, text(context.locale, KIND_WORD[kind]), title, board.name), {
          navigateTo: {
            module: "canvas",
            item: board.id,
            action: { name: "place-card", payload: { ref: canvasRefText({ kind, id }) } },
          },
        });
      }),
  };

  /** The one answer every drawing tool gives: the page is asked to draw, and the answer says only that. */
  function sketchResult(locale: AssistantLocale, board: CanvasBoard, sketch: CanvasSketch): ToolResult {
    return okResult(phrase(locale, SENT_SKETCH, sketch.nodes.length, board.name, board.id), {
      navigateTo: { module: "canvas", item: board.id, action: { name: "sketch", payload: sketch } },
    });
  }

  return [boards, create, rename, remove, draw, visualize, card];
}

/** The sketch a model fills in: boxes, arrows and a layout. Coordinates are not in it, on purpose. */
const SKETCH_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", maxLength: 200, description: "A heading shown above the diagram." },
    nodes: {
      type: "array",
      minItems: 1,
      maxItems: MAX_CANVAS_SKETCH_NODES,
      description: "The boxes. Every id must be unique.",
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1, maxLength: 40, description: "A short id, unique in the sketch." },
          label: { type: "string", minLength: 1, maxLength: 200, description: "The text in the box." },
          shape: { type: "string", enum: [...CANVAS_SKETCH_SHAPES], description: "Default rect." },
          tone: { type: "string", enum: [...CANVAS_SKETCH_TONES], description: "A colour. Default is ink." },
        },
        required: ["id", "label"],
        additionalProperties: false,
      },
    },
    edges: {
      type: "array",
      description: "The arrows, each from one box id to another.",
      items: {
        type: "object",
        properties: {
          from: { type: "string", minLength: 1, maxLength: 40 },
          to: { type: "string", minLength: 1, maxLength: 40 },
          label: { type: "string", maxLength: 200 },
        },
        required: ["from", "to"],
        additionalProperties: false,
      },
    },
    layout: {
      type: "string",
      enum: [...CANVAS_SKETCH_LAYOUTS],
      description: "auto follows the arrows top to bottom; tree the same by depth; row, column and grid place boxes in order.",
    },
  },
  required: ["nodes"],
  additionalProperties: false,
};

/** Board lookup: an id, then a name ignoring case and diacritics. An ambiguous name is refused with its candidates. */
function findBoard(boards: readonly CanvasBoard[], value: string, locale: AssistantLocale): CanvasBoard | undefined {
  const byId = boards.find((board) => board.id === value);
  if (byId !== undefined) return byId;
  const needle = foldSearchText(value);
  const named = boards.filter((board) => foldSearchText(board.name) === needle);
  if (named.length > 1) {
    throw new Error(
      phrase(locale, AMBIGUOUS_BOARD, value, named.map((board) => `${board.name} (${board.id})`).join(", ")),
    );
  }
  return named[0];
}

function resolveBoard(boards: readonly CanvasBoard[], value: string, locale: AssistantLocale): CanvasBoard {
  const found = findBoard(boards, value, locale);
  if (found !== undefined) return found;
  throw new Error(
    phrase(locale, NOT_FOUND_BOARD, value, boards.map((board) => board.name).join(", ") || "-"),
  );
}

/** Note lookup by id, then by title, ignoring case and diacritics. */
function findNote(
  notes: readonly { id: string; title: string }[],
  value: string,
  locale: AssistantLocale,
): { id: string; title: string } {
  const byId = notes.find((note) => note.id === value);
  if (byId !== undefined) return byId;
  const needle = foldSearchText(value);
  const titled = notes.filter((note) => foldSearchText(note.title.trim()) === needle);
  if (titled.length > 1) {
    throw new Error(
      phrase(locale, AMBIGUOUS_NOTE, value, titled.map((note) => `${note.title} (${note.id})`).join(", ")),
    );
  }
  const found = titled[0];
  if (found !== undefined) return found;
  throw new Error(phrase(locale, NOT_FOUND_NOTE, value));
}

/** A board's drawing as the words a person would use: element counts by kind, and the text on it. */
function readBoard(canvas: CanvasStore, id: string): { elements: string; labels: string[] } {
  const scene = JSON.parse(canvas.readScene(id).scene) as { elements?: unknown };
  const live = (Array.isArray(scene.elements) ? scene.elements : [])
    .filter(isRecord)
    .filter((element) => element.isDeleted !== true);
  const counts = new Map<string, number>();
  for (const element of live) {
    const kind = typeof element.type === "string" ? element.type : "unknown";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const elements = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([kind, n]) => `${n} ${kind}`).join(", ");
  const labels = live
    .filter((element) => element.type === "text" && typeof element.text === "string")
    .map((element) => clip(String(element.text).replace(/\s+/g, " ").trim()))
    .filter((label) => label.length > 0);
  return { elements, labels };
}

function clip(label: string): string {
  return label.length <= LABEL_CHARS ? label : `${label.slice(0, LABEL_CHARS - 1)}…`;
}

function text(locale: AssistantLocale, copy: { readonly sr: string; readonly en: string }): string {
  return copy[locale];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The store's clock, as the ISO date-time its `now` parameter takes. */
function instantOf(atMs: number): string {
  return new Date(atMs).toISOString();
}
