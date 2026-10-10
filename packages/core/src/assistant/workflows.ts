/**
 * Workflows: named recipes a user can start from a list.
 *
 * A free-form chat asks a person to know what to ask for. A workflow is the
 * other half of the same assistant: a goal in the user's words, a short
 * checklist the model follows, and the tools the recipe is allowed to touch -
 * so „Plan my day" starts with the tasks and the calendar already in hand
 * rather than with a prompt the user has to compose.
 *
 * **The shape is the deliverable, and the built-ins are data.** The store that
 * lets a user write their own workflow lands with the module itself (the next
 * wave); a user-defined workflow is this same object, and nothing here depends
 * on where it came from. `tools` is a list of tool NAMES rather than `Tool`
 * objects, because a workflow outlives one turn's registry: the module narrows
 * the turn's tools with {@link toolsForWorkflow} when the recipe starts, and a
 * name the registry does not carry simply selects nothing.
 *
 * **A workflow is a narrowing, never new authority.** It cannot add a tool the
 * page did not offer, it cannot skip the confirmation a `write` tool asks for,
 * and the safety recipe is bound by the same rules as every other turn
 * (`prompts.ts`): knowledge first, the safety notice when a safety pack is the
 * source, and 112 before anything the assistant can say.
 */

import type { AssistantLocale, AssistantText, Tool } from "./contract.js";

export interface AssistantWorkflow {
  /** Kebab-case, unique: the store's key and the page's anchor. */
  readonly id: string;
  /** What the list shows. */
  readonly name: AssistantText;
  /** One sentence: what the recipe is for. */
  readonly goal: AssistantText;
  /** The steps the model follows, in order, as short sentences. */
  readonly checklist: readonly AssistantText[];
  /** Tool names the recipe may use, exactly as `ToolSpec.name` spells them. */
  readonly tools: readonly string[];
}

/** The labels of the rendered brief; the one string pair a brief needs. */
const BRIEF_LABELS = {
  goal: { sr: "Cilj", en: "Goal" },
  checklist: { sr: "Koraci", en: "Checklist" },
  tools: { sr: "Dozvoljene alatke", en: "Allowed tools" },
} satisfies Readonly<Record<string, AssistantText>>;

/**
 * The four built-ins.
 *
 * „Stranded" is the founder's own scenario - a person waiting for a helicopter
 * in the middle of nowhere, talking the situation through with the assistant -
 * and it is the reason the safety rules exist, so it is the recipe with the
 * most specific checklist: knowledge first, the notice in full, the emergency
 * card, the offline map, short calm steps, and the phone call that comes before
 * all of it. The map is named as „when one is installed" rather than by a
 * location, because no map module exists yet and a workflow must not promise a
 * page the app cannot open.
 */
export const ASSISTANT_WORKFLOWS: readonly AssistantWorkflow[] = [
  {
    id: "plan-day",
    name: { sr: "Isplaniraj mi dan", en: "Plan my day" },
    goal: {
      sr: "Napravi plan dana od zadataka i događaja koje aplikacija već ima.",
      en: "Build a plan for the day from the tasks and events the app already holds.",
    },
    checklist: [
      {
        sr: "Pogledaj otvorene zadatke za danas i za naredne dane.",
        en: "Read the tasks that are open for today and for the days after it.",
      },
      {
        sr: "Pogledaj događaje u kalendaru za taj dan.",
        en: "Read the calendar events for that day.",
      },
      {
        sr: "Predloži raspored koji poštuje vremena sastanaka i ostavlja pauze.",
        en: "Propose a schedule that respects meeting times and leaves breaks.",
      },
      {
        sr: "Ponudi da zapišeš nove zadatke; svaki zapis traži potvrdu.",
        en: "Offer to save new tasks; every write asks the user first.",
      },
      {
        sr: "Ne izmišljaj zadatke, događaje ni vremena.",
        en: "Never invent tasks, events or times.",
      },
    ],
    tools: ["tasks.list", "calendar.list", "tasks.create", "app.open"],
  },
  {
    id: "note-to-tasks",
    name: { sr: "Pretvori belešku u zadatke", en: "Turn this note into tasks" },
    goal: {
      sr: "Izdvoji konkretne zadatke iz jedne beleške i ponudi da se zapišu.",
      en: "Pull the concrete tasks out of one note and offer to save them.",
    },
    checklist: [
      {
        sr: "Pročitaj belešku na koju se korisnik poziva.",
        en: "Read the note the user is pointing at.",
      },
      {
        sr: "Izdvoji svaku obavezu koju tekst beleške pominje.",
        en: "List every obligation the note's own text states.",
      },
      {
        sr: "Za svaki zadatak predloži naslov i rok, ako ga tekst pominje.",
        en: "For each task, suggest a title and a due date when the text names one.",
      },
      {
        sr: "Pre zapisa pokaži šta će se promeniti.",
        en: "Show what will change before anything is written.",
      },
      {
        sr: "Nikad ne zapisuj bez potvrde i ne dodaj obaveze kojih u tekstu nema.",
        en: "Never write without confirmation, and never add an obligation the text does not carry.",
      },
    ],
    tools: ["notes.read", "tasks.create", "app.open"],
  },
  {
    id: "what-to-read",
    name: { sr: "Šta da čitam o ovome", en: "What should I read about this" },
    goal: {
      sr: "Nađi u građi ono što korisnika zanima i pokaži odakle je.",
      en: "Find what the user is asking about in the knowledge base and show where it came from.",
    },
    checklist: [
      {
        sr: "Pretraži građu samo kroz alat za pretragu.",
        en: "Search the knowledge only through the search tool.",
      },
      {
        sr: "Citiraj svaki izvor brojem iz bloka sa građom.",
        en: "Cite every source by its number in the knowledge block.",
      },
      {
        sr: "Ako nema ničega, reci da građa ne pokriva tu temu.",
        en: "When there is nothing, say that the knowledge does not cover the topic.",
      },
      {
        sr: "Ne izmišljaj naslove, autore ni izvore.",
        en: "Never invent titles, authors or sources.",
      },
    ],
    tools: ["knowledge.search"],
  },
  {
    id: "stranded",
    name: { sr: "Zaglavljen: pomozi mi kroz ovo", en: "Stranded: help me through it" },
    goal: {
      sr: "Vodi korisnika kroz bezbednosnu situaciju mirno, korak po korak, iz građe, i pokaži mu gde je pomoć.",
      en: "Walk the user through a safety situation calmly, step by step, from the knowledge, and point at where help is.",
    },
    checklist: [
      {
        sr: "Prvo pozovi 112 ako ima signala; to je prvi korak i ništa ga ne zamenjuje.",
        en: "First, if there is a signal, call 112; that is the first step and nothing replaces it.",
      },
      {
        sr: "Pretraži građu pre svakog saveta i citiraj svaki izvor.",
        en: "Search the knowledge before giving any advice, and cite every source.",
      },
      {
        sr: "Daj kratke i mirne korake, jedan po jedan.",
        en: "Give short, calm steps, one at a time.",
      },
      {
        sr: "Kad se odgovor oslanja na bezbednosni paket, dodaj obaveštenje o bezbednosti u celosti.",
        en: "When the answer draws on a safety pack, add the safety notice in full.",
      },
      {
        sr: "Ponudi da otvoriš karticu za hitne slučajeve i oflajn mapu, ako je instalirana.",
        en: "Offer to open the emergency card and the offline map, when one is installed.",
      },
      {
        sr: "Ne izmišljaj lekove, doze, rute ni brojeve.",
        en: "Never invent medicines, doses, routes or numbers.",
      },
    ],
    tools: ["knowledge.search", "app.open"],
  },
];

/** One built-in by id, for a page that received an id rather than the object. */
export function findWorkflow(id: string): AssistantWorkflow | undefined {
  return ASSISTANT_WORKFLOWS.find((workflow) => workflow.id === id);
}

/**
 * The subset of a turn's tools a workflow allows, in the registry's order.
 *
 * Filtering rather than reordering matters: the page passes the turn's tools,
 * the prompt lists them in the order it receives, and a recipe that reshuffled
 * them would make two runs of the same conversation produce two different
 * prompts.
 */
export function toolsForWorkflow(
  workflow: AssistantWorkflow,
  tools: readonly Tool[],
): readonly Tool[] {
  return tools.filter((tool) => workflow.tools.includes(tool.name));
}

/**
 * The recipe as text, for the user message that starts it.
 *
 * The goal, the numbered checklist and the allowed tools, in the language the
 * turn is running in - the next wave composes this into the user message, and a
 * page may show it as the recipe's description. The tool NAMES stay as they
 * are: they are identifiers, not copy.
 */
export function renderWorkflowBrief(workflow: AssistantWorkflow, locale: AssistantLocale): string {
  const lines = [
    `${BRIEF_LABELS.goal[locale]}: ${workflow.goal[locale]}`,
    `${BRIEF_LABELS.checklist[locale]}:`,
    ...workflow.checklist.map((step, index) => `${index + 1}. ${step[locale]}`),
    `${BRIEF_LABELS.tools[locale]}: ${workflow.tools.join(", ")}`,
  ];
  return lines.join("\n");
}
