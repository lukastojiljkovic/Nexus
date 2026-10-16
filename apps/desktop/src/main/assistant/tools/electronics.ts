/**
 * The ELECTRONICS module through the assistant's eyes: the bench's circuits, the
 * parts and wires on them, the simulation, the machine and the code a circuit
 * yields, and the writes that put parts and wires on a bench.
 *
 * **Every write is the store the IPC channel calls.** `elec:add-part` calls
 * `ElectronicsStore.addPart`, `elec:add-wire` calls `addWire`, and so on; a tool
 * calls the same method with the same fields, so the store's own rules (a wire's
 * ends are live parts of its circuit, a rotation is a quarter turn) decide, and
 * this file never restates them. The clock is main's, read here once per call.
 *
 * **Names, not ids.** A circuit is the name the user gave it. A part is its ref —
 * the label the bench prints, „R1" — or its id. A pin is the catalogue's own name
 * („D13", „GND"). Each is resolved before anything is written, and a refusal
 * lists what does exist, so the model corrects itself rather than guessing again.
 *
 * **The external runner is never a tool.** The runner (ADR-085 E6) is the app's
 * one process spawn, and it is consented to through its own screen, which prints
 * the literal command. A tool that started it would spawn a process on the
 * model's word, so this registry offers none and the Electronics page is where
 * it is run (`docs/deviations.md`, DEV-007).
 *
 * **A machine's measurements are not a tool either.** The nine numbers of the
 * chassis are a form the Electronics page asks for (`setChassis`); the assistant
 * reads the machine that form produced (`electronics.machine`), and opens the
 * page to change it.
 */

import type Database from "better-sqlite3-multiple-ciphers";
import { ElectronicsStore } from "@nexus/db";
import type {
  NewCircuitPart,
  StoredCircuit,
  StoredCircuitDetail,
  StoredCircuitPart,
} from "@nexus/db";
import {
  buildSimBench,
  catalogueComponent,
  COMPONENT_CATALOGUE,
  COMPONENT_KINDS,
  filterComponents,
  findComponent,
  findPin,
  foldSearchText,
  generateCode,
  generateRosPackage,
  gridCell,
  MAX_CIRCUIT_NAME_LENGTH,
  MAX_PART_LABEL_LENGTH,
  parseComponentValue,
  planBuild,
  simulateFrame,
  splitEnd,
  wireColourFor,
} from "@nexus/core";
import type {
  AssistantLocale,
  BuildPlan,
  BuildPartInput,
  BuildProblem,
  BuildWireInput,
  CodeRefusal,
  ComponentDef,
  Pin,
  PlannedPart,
  SimChannel,
  SimWave,
  Tool,
  ValueUnit,
} from "@nexus/core";
import { toCircuitDocument } from "../../elecDocument.js";
import {
  asArgs,
  asEnum,
  asNumber,
  asOptionalCount,
  asOptionalEnum,
  asOptionalText,
  asText,
} from "./args.js";
import {
  assertLive,
  clampText,
  confirmOrDecline,
  failResult,
  formatNumber,
  guard,
  okResult,
  phrase,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface ElectronicsToolDeps {
  readonly profileDb: ProfileDb;
  readonly now: () => number;
}

/** How many circuits a list answers with, and how many catalogue parts a search does. */
const MAX_LIST_ROWS = 50;
const MAX_PART_ROWS = 20;

/** The bench's own default step, and the frames a simulation answers with when the model names no count. */
const DEFAULT_TICK_MS = 100;
const MAX_TICK_MS = 10_000;
const DEFAULT_FRAMES = 5;
const MAX_FRAMES = 20;

/**
 * Bounds on what a simulated wave may say. A voltage past a kilovolt is not a
 * reading on this bench, and a period past ten minutes is not one a bench run
 * could show; both are policy choices, not measurements.
 */
const MAX_WAVE_VOLTS = 1000;
const MAX_WAVE_MS = 600_000;
const MAX_WAVE_VALUES = 16;
const WAVE_KINDS = ["constant", "square", "ramp", "steps"] as const;
const DEFAULT_DUTY_PERCENT = 50;

/** The most channels one simulation takes, and the most characters of generated code one answer carries. */
const MAX_CHANNELS = 16;
const MAX_CODE_CHARS = 4_000;

/** Build limits: a description that large is a mistake, not a circuit. */
const MAX_BUILD_PARTS = 40;
const MAX_BUILD_WIRES = 80;
const MAX_REF_CHARS = 40;
const MAX_VALUE_CHARS = 20;
const MAX_END_CHARS = 120;
const MAX_PIN_CHARS = 20;
const MAX_QUERY_CHARS = 80;

/** The symbol a value is printed with, per unit. */
const UNIT_SYMBOL: Readonly<Record<ValueUnit, string>> = {
  ohm: "Ω",
  farad: "F",
  henry: "H",
  volt: "V",
  ampere: "A",
};

const NONE_YET: AssistantPhrase<[]> = { sr: () => "još nema", en: () => "none yet" };
const NONE_LISTED: AssistantPhrase<[]> = { sr: () => "nijedno", en: () => "none" };

const LIST_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Kola (${count}):`,
  en: (count) => `Circuits (${count}):`,
};
const NO_CIRCUITS: AssistantPhrase<[]> = {
  sr: () => "Ovaj profil nema kola.",
  en: () => "This profile has no circuits.",
};
const LIST_TRUNCATED: AssistantPhrase<[count: number]> = {
  sr: (count) => `Prikazana su samo prva ${count} kola.`,
  en: (count) => `Showing only the first ${count} circuits.`,
};

const OPEN_HEAD: AssistantPhrase<[name: string, id: string, parts: number, wires: number]> = {
  sr: (name, id, parts, wires) => `Kolo „${name}“ (${id}): delova ${parts}, veza ${wires}.`,
  en: (name, id, parts, wires) => `Circuit “${name}” (${id}): ${parts} parts, ${wires} wires.`,
};
const PARTS_HEADING: AssistantPhrase<[]> = { sr: () => "Delovi:", en: () => "Parts:" };
const WIRES_HEADING: AssistantPhrase<[]> = { sr: () => "Veze:", en: () => "Wires:" };

const PART_SEARCH_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Delovi u katalogu (${count}):`,
  en: (count) => `Catalogue parts (${count}):`,
};
const NO_PART_MATCH: AssistantPhrase<[query: string]> = {
  sr: (query) => `Nijedan deo ne odgovara „${query}“.`,
  en: (query) => `No part matches “${query}”.`,
};

const SIM_HEAD: AssistantPhrase<[name: string, tickMs: number, frames: number]> = {
  sr: (name, tickMs, frames) => `Simulacija kola „${name}“, korak ${tickMs} ms, kadrova ${frames}. Ništa nije sačuvano.`,
  en: (name, tickMs, frames) => `Simulation of “${name}”, tick ${tickMs} ms, ${frames} frames. Nothing is stored.`,
};
const OVER_LOGIC: AssistantPhrase<[]> = {
  sr: () => "iznad logičkog nivoa ploče",
  en: () => "above the board's logic level",
};
const NO_CHANNELS: AssistantPhrase<[]> = {
  sr: () => "Kolo nema pinove koje bi simulacija mogla da prikaže.",
  en: () => "The circuit has no pins the simulation can show.",
};

const MACHINE_HEAD: AssistantPhrase<[name: string]> = {
  sr: (name) => `Mašina kola „${name}“:`,
  en: (name) => `The machine of “${name}”:`,
};
const MACHINE_SENSOR: AssistantPhrase<[part: string, sim: string, mount: string, topic: string]> = {
  sr: (part, sim, mount, topic) => `- ${part}: ${sim}, na strani „${mount}“, tema ${topic}`,
  en: (part, sim, mount, topic) => `- ${part}: ${sim}, on the “${mount}” side, topic ${topic}`,
};
const MACHINE_LEFT_OUT: AssistantPhrase<[parts: string]> = {
  sr: (parts) => `Nisu u opisu: ${parts}.`,
  en: (parts) => `Left out of the description: ${parts}.`,
};

const CODE_SKETCH: AssistantPhrase<[file: string, libraries: string]> = {
  sr: (file, libraries) => `Skica „${file}“. Biblioteke: ${libraries}.`,
  en: (file, libraries) => `Sketch “${file}”. Libraries: ${libraries}.`,
};
const CODE_PACKAGE: AssistantPhrase<[name: string, files: string]> = {
  sr: (name, files) => `ROS 2 paket „${name}“. Datoteke: ${files}.`,
  en: (name, files) => `ROS 2 package “${name}”. Files: ${files}.`,
};
const CODE_TRUNCATED: AssistantPhrase<[count: number]> = {
  sr: (count) => `Tekst je skraćen na ${count} znakova.`,
  en: (count) => `The text is cut to ${count} characters.`,
};

/** Why a circuit yields no answer, in one table: a missing entry is a compile error, not a blank reply. */
const CODE_REFUSED: Record<CodeRefusal, AssistantPhrase<[]>> = {
  "no-board": { sr: () => "Kolo nema ploču, pa nema kod.", en: () => "The circuit has no board, so there is no code." },
  "many-boards": {
    sr: () => "Kolo ima više ploča; kod se piše za jednu.",
    en: () => "The circuit has more than one board; code is written for one.",
  },
  "not-programmable": {
    sr: () => "Ploča ne prima kod iz ovog kola.",
    en: () => "The board does not take code from this circuit.",
  },
  "not-ros": {
    sr: () => "Ploča radi kao mikrokontroler, a ROS 2 paket ide na računar sa ROS-om.",
    en: () => "The board runs as a microcontroller, and a ROS 2 package goes to a computer running ROS.",
  },
};

const SIM_REFUSED: Record<"no-board" | "many-boards", AssistantPhrase<[]>> = {
  "no-board": {
    sr: () => "Kolo nema ploču, pa nema šta da se simulira.",
    en: () => "The circuit has no board, so there is nothing to simulate.",
  },
  "many-boards": {
    sr: () => "Kolo ima više ploča; simulacija ide za jednu.",
    en: () => "The circuit has more than one board; a simulation runs one.",
  },
};

const MACHINE_NO_CHASSIS: AssistantPhrase<[]> = {
  sr: () => "Kolo nema mašinu: njene mere nisu uneta.",
  en: () => "The circuit has no machine: its measurements have not been entered.",
};

/** Build problems, one record each: the words for a problem the description can have. */
const NOT_A_BOARD: AssistantPhrase<[name: string]> = {
  sr: (name) => `„${name}“ nije ploča. Prvo polje je ploča, npr. arduino-uno.`,
  en: (name) => `“${name}” is not a board. The board comes first, for example arduino-uno.`,
};
const BOARD_AS_PART: AssistantPhrase<[ref: string]> = {
  sr: (ref) => `Deo „${ref}“ je ploča. Kolo ima jednu ploču; navedi je kao board.`,
  en: (ref) => `The part “${ref}” is a board. A circuit has one board; name it as board.`,
};
const BUILD_DUPLICATE_REF: AssistantPhrase<[ref: string]> = {
  sr: (ref) => `Oznaka „${ref}“ se javlja dva puta. Svaki deo ima svoju oznaku.`,
  en: (ref) => `The ref “${ref}” is used twice. Each part needs its own ref.`,
};
const BAD_END: AssistantPhrase<[end: string]> = {
  sr: (end) => `„${end}“ nije u obliku oznaka.pin, npr. R1.1.`,
  en: (end) => `“${end}” is not ref.pin, such as R1.1.`,
};
const BUILD_UNKNOWN_PART: AssistantPhrase<[name: string, known: string]> = {
  sr: (name, known) => `Nema dela „${name}“. Delovi: ${known}.`,
  en: (name, known) => `No part “${name}”. The parts are: ${known}.`,
};

/** The answer a build problem gets, in the reader's language. Each case reads the fields its record takes. */
function problemSentence(locale: AssistantLocale, problem: BuildProblem): string {
  switch (problem.code) {
    case "unknown-component":
      return phrase(locale, NOT_FOUND_COMPONENT, problem.name);
    case "not-a-board":
      return phrase(locale, NOT_A_BOARD, problem.name);
    case "board-as-part":
      return phrase(locale, BOARD_AS_PART, problem.ref);
    case "duplicate-ref":
      return phrase(locale, BUILD_DUPLICATE_REF, problem.ref);
    case "bad-end":
      return phrase(locale, BAD_END, problem.end);
    case "unknown-part":
      return phrase(locale, BUILD_UNKNOWN_PART, problem.name, problem.known.join(", "));
    case "unknown-pin":
      return phrase(locale, NOT_FOUND_PIN, problem.pin, problem.part, problem.valid.join(", "));
    case "no-value":
      return phrase(locale, NO_VALUE, problem.ref);
    case "bad-value":
      return phrase(locale, BAD_VALUE, problem.value, problem.ref);
  }
}

const NOT_FOUND_CIRCUIT: AssistantPhrase<[query: string, known: string]> = {
  sr: (query, known) => `Nema kola „${query}“. Kola u profilu: ${known}.`,
  en: (query, known) => `No circuit named “${query}”. The circuits in this profile: ${known}.`,
};
const NOT_FOUND_PART: AssistantPhrase<[query: string, circuit: string, known: string]> = {
  sr: (query, circuit, known) => `Na kolu „${circuit}“ nema dela „${query}“. Delovi: ${known}.`,
  en: (query, circuit, known) => `No part “${query}” on “${circuit}”. Its parts: ${known}.`,
};
const AMBIGUOUS: AssistantPhrase<[query: string, candidates: string]> = {
  sr: (query, candidates) => `„${query}“ označava više stavki: ${candidates}. Navedi id.`,
  en: (query, candidates) => `“${query}” names more than one item: ${candidates}. Give the id.`,
};
const NOT_FOUND_COMPONENT: AssistantPhrase<[name: string]> = {
  sr: (name) => `Nema komponente „${name}“. Potraži je alatom electronics.parts.`,
  en: (name) => `No component “${name}”. Look it up with electronics.parts.`,
};
const NOT_FOUND_PIN: AssistantPhrase<[pin: string, part: string, valid: string]> = {
  sr: (pin, part, valid) => `Deo „${part}“ nema pin „${pin}“. Pinovi: ${valid}.`,
  en: (pin, part, valid) => `The part “${part}” has no pin “${pin}”. Its pins: ${valid}.`,
};
const DUPLICATE_REF: AssistantPhrase<[ref: string, circuit: string]> = {
  sr: (ref, circuit) => `Na kolu „${circuit}“ već postoji deo „${ref}“. Izaberi drugu oznaku.`,
  en: (ref, circuit) => `“${circuit}” already has a part “${ref}”. Choose another ref.`,
};
const ALREADY_WIRED: AssistantPhrase<[a: string, b: string]> = {
  sr: (a, b) => `Pinovi ${a} i ${b} su već povezani.`,
  en: (a, b) => `${a} and ${b} are already connected.`,
};
const NO_SUCH_WIRE: AssistantPhrase<[a: string, b: string]> = {
  sr: (a, b) => `Između ${a} i ${b} nema veze.`,
  en: (a, b) => `There is no wire between ${a} and ${b}.`,
};
const COMPONENT_UNKNOWN: AssistantPhrase<[ref: string]> = {
  sr: (ref) => `Deo „${ref}“ je od komponente koju ova verzija ne poznaje.`,
  en: (ref) => `The part “${ref}” is of a component this build does not know.`,
};
const NO_VALUE: AssistantPhrase<[ref: string]> = {
  sr: (ref) => `Deo „${ref}“ nema vrednost.`,
  en: (ref) => `The part “${ref}” takes no value.`,
};
const BAD_VALUE: AssistantPhrase<[value: string, ref: string]> = {
  sr: (value, ref) => `Vrednost „${value}“ za „${ref}“ nije razumljiva u jedinici tog dela.`,
  en: (value, ref) => `The value “${value}” for “${ref}” does not read in that part's unit.`,
};
const CHANNEL_UNKNOWN: AssistantPhrase<[pin: string, known: string]> = {
  sr: (pin, known) => `Ploča nema pin „${pin}“ koji bi se simulirao. Pinovi za simulaciju: ${known}.`,
  en: (pin, known) => `The board has no pin “${pin}” the simulation can drive. Pins it can: ${known}.`,
};

const BUILD_SUMMARY: AssistantPhrase<[name: string, board: string, parts: number, wires: number]> = {
  sr: (name, board, parts, wires) => `Sastavi kolo „${name}“ na ploči „${board}“ (delova: ${parts}, veza: ${wires})`,
  en: (name, board, parts, wires) => `Build “${name}” on “${board}” (parts: ${parts}, wires: ${wires})`,
};
const PLACE_SUMMARY: AssistantPhrase<[part: string, circuit: string]> = {
  sr: (part, circuit) => `Dodaj deo „${part}“ na kolo „${circuit}“`,
  en: (part, circuit) => `Add the part “${part}” to “${circuit}”`,
};
const UNPLACE_SUMMARY: AssistantPhrase<[part: string, circuit: string, wires: number]> = {
  sr: (part, circuit, wires) => `Ukloni deo „${part}“ sa kola „${circuit}“ i ${wires} veza na njemu`,
  en: (part, circuit, wires) => `Remove the part “${part}” and its ${wires} wires from “${circuit}”`,
};
const CONNECT_SUMMARY: AssistantPhrase<[a: string, b: string, circuit: string]> = {
  sr: (a, b, circuit) => `Poveži ${a} sa ${b} na kolu „${circuit}“`,
  en: (a, b, circuit) => `Connect ${a} to ${b} on “${circuit}”`,
};
const DISCONNECT_SUMMARY: AssistantPhrase<[a: string, b: string, circuit: string]> = {
  sr: (a, b, circuit) => `Prekini vezu ${a} i ${b} na kolu „${circuit}“`,
  en: (a, b, circuit) => `Disconnect ${a} and ${b} on “${circuit}”`,
};
const RENAME_SUMMARY: AssistantPhrase<[from: string, to: string]> = {
  sr: (from, to) => `Preimenuj kolo „${from}“ u „${to}“`,
  en: (from, to) => `Rename the circuit “${from}” to “${to}”`,
};
const DELETE_SUMMARY: AssistantPhrase<[name: string]> = {
  sr: (name) => `Obriši kolo „${name}“`,
  en: (name) => `Delete the circuit “${name}”`,
};

const BUILT: AssistantPhrase<[name: string, id: string, parts: number, wires: number]> = {
  sr: (name, id, parts, wires) => `Sastavljeno kolo „${name}“ (${id}): delova ${parts}, veza ${wires}.`,
  en: (name, id, parts, wires) => `Built “${name}” (${id}): ${parts} parts, ${wires} wires.`,
};
const PLACED: AssistantPhrase<[ref: string, id: string, circuit: string]> = {
  sr: (ref, id, circuit) => `Dodat deo „${ref}“ (${id}) na kolo „${circuit}“.`,
  en: (ref, id, circuit) => `Added the part “${ref}” (${id}) to “${circuit}”.`,
};
const UNPLACED: AssistantPhrase<[ref: string, id: string, wires: number]> = {
  sr: (ref, id, wires) => `Uklonjen deo „${ref}“ (${id}) i ${wires} veza na njemu.`,
  en: (ref, id, wires) => `Removed the part “${ref}” (${id}) and ${wires} wires on it.`,
};
const CONNECTED: AssistantPhrase<[a: string, b: string, id: string]> = {
  sr: (a, b, id) => `Povezano: ${a} — ${b} (${id}).`,
  en: (a, b, id) => `Connected: ${a} — ${b} (${id}).`,
};
const DISCONNECTED: AssistantPhrase<[a: string, b: string]> = {
  sr: (a, b) => `Prekinuta veza: ${a} — ${b}.`,
  en: (a, b) => `Disconnected: ${a} — ${b}.`,
};
const RENAMED: AssistantPhrase<[name: string, id: string]> = {
  sr: (name, id) => `Kolo se sada zove „${name}“ (${id}).`,
  en: (name, id) => `The circuit is now called “${name}” (${id}).`,
};
const DELETED: AssistantPhrase<[name: string, id: string]> = {
  sr: (name, id) => `Obrisano kolo „${name}“ (${id}).`,
  en: (name, id) => `Deleted the circuit “${name}” (${id}).`,
};

/** The copy's name for a component, in the reader's language: the English name is the app's own, the Serbian one is printed on the part. */
function componentName(component: ComponentDef, locale: AssistantLocale): string {
  return locale === "en" ? (component.nameEn ?? component.name) : component.name;
}

/** The ref a part is known by on the bench: its label, or its id when it has none (a part the page added before it was named). */
function refOf(part: StoredCircuitPart): string {
  return part.label.trim() === "" ? part.id : part.label.trim();
}

/** Every write's instant, from main's clock. */
function instantOf(atMs: number): string {
  return new Date(atMs).toISOString();
}

/**
 * The one row a name or an id names.
 *
 * Exact on the id first, then on the name folded (case and diacritics), so
 * „merenje" finds „Merenje". Two rows with one name are refused with their ids,
 * which is the only way the model can say which it means; none is refused with
 * the names that do exist.
 */
function pickOne<T extends { readonly id: string }>(
  rows: readonly T[],
  query: string,
  labelOf: (row: T) => string,
  locale: AssistantLocale,
  missing: (query: string, known: string) => string,
): T {
  const byId = rows.find((row) => row.id === query);
  if (byId !== undefined) return byId;
  const folded = foldSearchText(query);
  const named = rows.filter((row) => foldSearchText(labelOf(row)) === folded);
  const [only] = named;
  if (named.length === 1 && only !== undefined) return only;
  if (named.length > 1) {
    const candidates = named.map((row) => `${labelOf(row)} (${row.id})`).join(", ");
    throw new Error(phrase(locale, AMBIGUOUS, query, candidates));
  }
  const known = rows.length === 0 ? phrase(locale, NONE_LISTED) : rows.map(labelOf).join(", ");
  throw new Error(missing(query, known));
}

/** The live circuit a name or id names among the given rows. */
function circuitNamed(
  rows: readonly StoredCircuit[],
  query: string,
  locale: AssistantLocale,
): StoredCircuit {
  return pickOne(rows, query, (row) => row.name, locale, (name, known) =>
    phrase(locale, NOT_FOUND_CIRCUIT, name, known),
  );
}

/** The part a ref or id names on a circuit as it stands. */
function partNamed(
  detail: StoredCircuitDetail,
  query: string,
  locale: AssistantLocale,
): StoredCircuitPart {
  return pickOne(detail.parts, query, refOf, locale, (ref, known) =>
    phrase(locale, NOT_FOUND_PART, ref, detail.name, known),
  );
}

/** `"R1.1"` into the part it names and the catalogue pin, both read from the circuit as it stands. */
function endOn(
  detail: StoredCircuitDetail,
  text: string,
  locale: AssistantLocale,
): { readonly part: StoredCircuitPart; readonly pin: Pin } {
  const parsed = splitEnd(text);
  if (parsed === undefined) throw new Error(phrase(locale, BAD_END, text));
  const part = partNamed(detail, parsed.part, locale);
  const component = catalogueComponent(part.componentId);
  if (component === undefined) throw new Error(phrase(locale, COMPONENT_UNKNOWN, refOf(part)));
  const pin = findPin(component, parsed.pin);
  if (pin === undefined) {
    throw new Error(
      phrase(locale, NOT_FOUND_PIN, parsed.pin, refOf(part), component.pins.map((entry) => entry.id).join(", ")),
    );
  }
  return { part, pin };
}

/** The text one end of a wire is written as: `R1.1`. */
function endText(part: StoredCircuitPart, pin: Pin): string {
  return `${refOf(part)}.${pin.id}`;
}

/** A value with its unit, as the bench shows it: „4700 Ω". */
function valueText(locale: AssistantLocale, part: StoredCircuitPart): string | undefined {
  if (part.value === undefined) return undefined;
  const unit = catalogueComponent(part.componentId)?.valueUnit;
  const symbol = unit === undefined ? "" : ` ${UNIT_SYMBOL[unit]}`;
  return `${formatNumber(locale, part.value)}${symbol}`;
}

/** Parses the wave a simulated channel carries. The shape is closed by the schema; the kind decides which fields it must have. */
function waveOf(raw: unknown): SimWave {
  const wave = asArgs(raw);
  const kind = asEnum(wave.kind, "kind", WAVE_KINDS);
  const volts = (field: string): number => asNumber(wave[field], field, -MAX_WAVE_VOLTS, MAX_WAVE_VOLTS);
  const millis = (field: string): number => asNumber(wave[field], field, 1, MAX_WAVE_MS);
  switch (kind) {
    case "constant":
      return { kind, value: volts("value") };
    case "square": {
      const dutyPercent =
        wave.dutyPercent === undefined
          ? DEFAULT_DUTY_PERCENT
          : asNumber(wave.dutyPercent, "dutyPercent", 0, 100);
      return { kind, low: volts("low"), high: volts("high"), periodMs: millis("periodMs"), dutyPercent };
    }
    case "ramp":
      return { kind, from: volts("from"), to: volts("to"), periodMs: millis("periodMs") };
    case "steps": {
      if (!Array.isArray(wave.values) || wave.values.length === 0 || wave.values.length > MAX_WAVE_VALUES) {
        throw new Error(`"values" must be a list of 1 to ${String(MAX_WAVE_VALUES)} numbers.`);
      }
      const values = wave.values.map((value, index) => asNumber(value, `values[${String(index)}]`, -MAX_WAVE_VOLTS, MAX_WAVE_VOLTS));
      return { kind, values, holdMs: millis("holdMs") };
    }
  }
}

/** A part a build plan names, written into the store as the row the bench shows. */
function partInput(part: PlannedPart): NewCircuitPart {
  return {
    componentId: part.componentId,
    label: part.label,
    x: part.x,
    y: part.y,
    rotation: 0,
    ...(part.value === undefined ? {} : { value: part.value }),
  };
}

/**
 * Writes a whole plan: the circuit, its parts, then its wires. The caller runs
 * it inside one transaction, so a refusal half-way leaves no circuit behind.
 */
function writePlan(store: ElectronicsStore, name: string, plan: BuildPlan, now: string): StoredCircuit {
  const circuit = store.createCircuit({ name }, now);
  const partIds = plan.parts.map((part) => store.addPart(circuit.id, partInput(part), now).id);
  const partId = (index: number): string => {
    const id = partIds[index];
    if (id === undefined) throw new Error(`The plan names part ${String(index)}, which it does not hold.`);
    return id;
  };
  for (const wire of plan.wires) {
    store.addWire(
      circuit.id,
      {
        from: { partId: partId(wire.from.part), pinId: wire.from.pinId },
        to: { partId: partId(wire.to.part), pinId: wire.to.pinId },
        colour: wire.colour,
      },
      now,
    );
  }
  return circuit;
}

/** Reads the description a build call carries, refusing what the schema would have. */
function buildParts(value: unknown): BuildPartInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_BUILD_PARTS) {
    throw new Error(`"parts" must be a list of at most ${String(MAX_BUILD_PARTS)} parts.`);
  }
  return value.map((entry, index) => {
    const part = asArgs(entry);
    const value = asOptionalText(part.value, `parts[${String(index)}].value`, MAX_VALUE_CHARS);
    return {
      ref: asText(part.ref, `parts[${String(index)}].ref`, MAX_REF_CHARS),
      component: asText(part.component, `parts[${String(index)}].component`, MAX_END_CHARS),
      ...(value === undefined ? {} : { value }),
    };
  });
}

function buildWires(value: unknown): BuildWireInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_BUILD_WIRES) {
    throw new Error(`"wires" must be a list of at most ${String(MAX_BUILD_WIRES)} wires.`);
  }
  return value.map((entry, index) => {
    const wire = asArgs(entry);
    return {
      from: asText(wire.from, `wires[${String(index)}].from`, MAX_END_CHARS),
      to: asText(wire.to, `wires[${String(index)}].to`, MAX_END_CHARS),
    };
  });
}

/** Reads the channels a simulation drives: a board pin each, with the wave it carries. */
function asChannels(value: unknown): { readonly pin: string; readonly wave: SimWave }[] {
  if (!Array.isArray(value) || value.length > MAX_CHANNELS) {
    throw new Error(`"channels" must be a list of at most ${String(MAX_CHANNELS)} channels.`);
  }
  return value.map((entry, index) => {
    const channel = asArgs(entry);
    return {
      pin: asText(channel.pin, `channels[${String(index)}].pin`, MAX_PIN_CHARS),
      wave: waveOf(channel.wave),
    };
  });
}

/** A simulated level as the bench prints it: volts and percent carry their unit, a digital line is its bare level. */
function shownLevel(locale: AssistantLocale, channel: SimChannel | undefined, value: number): string {
  const number = formatNumber(locale, value);
  if (channel?.unit === "volts") return `${number} V`;
  if (channel?.unit === "percent") return `${number} %`;
  return number;
}

const SCHEMA_WAVE = {
  type: "object",
  properties: {
    kind: { type: "string", enum: [...WAVE_KINDS], description: "The shape of the signal." },
    value: { type: "number", description: "constant: the level." },
    low: { type: "number", description: "square: the low level." },
    high: { type: "number", description: "square: the high level." },
    dutyPercent: { type: "number", minimum: 0, maximum: 100, description: "square: percent of each period at high. Defaults to 50." },
    from: { type: "number", description: "ramp: the level it starts from." },
    to: { type: "number", description: "ramp: the level it rises to." },
    periodMs: { type: "integer", minimum: 1, maximum: MAX_WAVE_MS, description: "square and ramp: one period." },
    values: {
      type: "array",
      items: { type: "number" },
      minItems: 1,
      maxItems: MAX_WAVE_VALUES,
      description: "steps: the levels, in order.",
    },
    holdMs: { type: "integer", minimum: 1, maximum: MAX_WAVE_MS, description: "steps: how long each level is held." },
  },
  required: ["kind"],
  additionalProperties: false,
};

const circuitParam = {
  type: "string",
  minLength: 1,
  maxLength: MAX_CIRCUIT_NAME_LENGTH,
  description: "The circuit's name, or its id.",
};

const partParam = {
  type: "string",
  minLength: 1,
  maxLength: MAX_PART_LABEL_LENGTH,
  description: "The part's ref, such as R1, or its id.",
};

const endParam = {
  type: "string",
  minLength: 3,
  maxLength: MAX_END_CHARS,
  description: "One pin: the part's ref and the pin, such as R1.1 or the board's name and its pin, such as arduino-uno.D13.",
};

export function electronicsTools(deps: ElectronicsToolDeps): readonly Tool[] {
  /** One profile's store, built the way `main/index.ts` builds it for a handler. */
  function withStore<T>(profileId: string, use: (store: ElectronicsStore, db: Database.Database) => T): T {
    return deps.profileDb(profileId, (db, id) => use(new ElectronicsStore(db, id), db));
  }

  /** The live circuit a name or id names, read in full. */
  function circuitDetail(store: ElectronicsStore, query: string, locale: AssistantLocale): StoredCircuitDetail {
    const circuit = circuitNamed(store.listActive(), query, locale);
    return store.read(circuit.id);
  }

  const list: Tool = {
    name: "electronics.list",
    description: {
      sr: "Izlistava elektronska kola u profilu, sa imenima i id-jevima. Koristi ga kada korisnik pita koja kola ima ili kada treba ime kola pre nego što ga otvoriš.",
      en: "Lists the electronics circuits in this profile, with names and ids. Use it when the user asks which circuits they have, or to find a circuit's name before opening it.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        asArgs(rawArgs);
        const rows = withStore(context.profileId, (store) => store.listActive());
        if (rows.length === 0) return okResult(phrase(context.locale, NO_CIRCUITS));
        const shown = rows.slice(0, MAX_LIST_ROWS);
        const lines = shown.map((row) => `- ${row.name} (${row.id})`);
        const content = [phrase(context.locale, LIST_HEADING, rows.length), ...lines];
        if (shown.length < rows.length) content.push(phrase(context.locale, LIST_TRUNCATED, shown.length));
        return okResult(content.join("\n"));
      }),
  };

  const open: Tool = {
    name: "electronics.open",
    description: {
      sr: "Otvara jedno kolo: delove sa oznakama (npr. R1), njihove vrednosti i veze između pinova. Koristi ga pre nego što menja kolo ili objašnjava šta u njemu piše.",
      en: "Opens one circuit: its parts with their refs (such as R1), their values and the wires between their pins. Use it before changing a circuit or explaining what is on it.",
    },
    parameters: {
      type: "object",
      properties: { circuit: circuitParam },
      required: ["circuit"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const query = asText(args.circuit, "circuit", MAX_CIRCUIT_NAME_LENGTH);
        const { locale } = context;
        const detail = withStore(context.profileId, (store) => circuitDetail(store, query, locale));
        const partsById = new Map(detail.parts.map((part) => [part.id, part]));

        const partLines = detail.parts.map((part) => {
          const component = catalogueComponent(part.componentId);
          const name = component === undefined ? part.componentId : componentName(component, locale);
          const value = valueText(locale, part);
          return `- ${refOf(part)}: ${name} (${part.componentId})${value === undefined ? "" : `, ${value}`}`;
        });
        const wireLines = detail.wires.map((wire) => {
          const from = partsById.get(wire.fromPartId);
          const to = partsById.get(wire.toPartId);
          const end = (part: StoredCircuitPart | undefined, pinId: string): string =>
            part === undefined ? pinId : `${refOf(part)}.${pinId}`;
          return `- ${end(from, wire.fromPinId)} — ${end(to, wire.toPinId)} (${wire.id})`;
        });
        return okResult(
          [
            phrase(locale, OPEN_HEAD, detail.name, detail.id, detail.parts.length, detail.wires.length),
            phrase(locale, PARTS_HEADING),
            ...(partLines.length === 0 ? [`- ${phrase(locale, NONE_YET)}`] : partLines),
            phrase(locale, WIRES_HEADING),
            ...(wireLines.length === 0 ? [`- ${phrase(locale, NONE_YET)}`] : wireLines),
          ].join("\n"),
          { navigateTo: { module: "electronics", item: detail.id } },
        );
      }),
  };

  const parts: Tool = {
    name: "electronics.parts",
    description: {
      sr: "Traži komponente u katalogu, na srpskom ili engleskom („vlaga“ nalazi DHT22). Koristi ga kada korisnik traži deo, a tebi treba njegov id i imena pinova za electronics.build ili electronics.place.",
      en: "Searches the component catalogue in Serbian or English (\"humidity\" finds the DHT22). Use it when the user asks for a part and you need its id and pin names for electronics.build or electronics.place.",
    },
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: MAX_QUERY_CHARS, description: "Words to find the part by. Empty lists the catalogue." },
        kind: { type: "string", enum: [...COMPONENT_KINDS], description: "Only this kind of part." },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const query = asOptionalText(args.query, "query", MAX_QUERY_CHARS) ?? "";
        const kind = asOptionalEnum(args.kind, "kind", COMPONENT_KINDS);
        const found = filterComponents(COMPONENT_CATALOGUE, query).filter(
          (component) => kind === undefined || component.kind === kind,
        );
        if (found.length === 0) return okResult(phrase(context.locale, NO_PART_MATCH, query));
        const shown = found.slice(0, MAX_PART_ROWS);
        const lines = shown.map(
          (component) =>
            `- ${component.id}: ${componentName(component, context.locale)} (${component.kind}), pins: ${component.pins.map((pin) => pin.id).join(", ")}`,
        );
        const content = [phrase(context.locale, PART_SEARCH_HEADING, found.length), ...lines];
        return okResult(content.join("\n"));
      }),
  };

  const simulate: Tool = {
    name: "electronics.simulate",
    description: {
      sr: "Pokreće simulaciju kola za zadate ulaze i prikazuje vrednosti pinova kroz nekoliko koraka. Ništa se ne čuva. Koristi ga kada korisnik pita šta bi se desilo na kolu.",
      en: "Runs the circuit's simulation for the inputs given and reports its pin values over a few ticks. Nothing is stored. Use it when the user asks what the circuit would do.",
    },
    parameters: {
      type: "object",
      properties: {
        circuit: circuitParam,
        frames: { type: "integer", minimum: 1, maximum: MAX_FRAMES, description: `How many ticks to show. Defaults to ${String(DEFAULT_FRAMES)}.` },
        tickMs: { type: "integer", minimum: 1, maximum: MAX_TICK_MS, description: `Milliseconds per tick. Defaults to ${String(DEFAULT_TICK_MS)}.` },
        channels: {
          type: "array",
          maxItems: MAX_CHANNELS,
          description: "The board pins to drive, with the signal on each. Pins not listed sit at rest.",
          items: {
            type: "object",
            properties: {
              pin: { type: "string", minLength: 1, maxLength: MAX_PIN_CHARS, description: "A board pin, such as D2." },
              wave: SCHEMA_WAVE,
            },
            required: ["pin", "wave"],
            additionalProperties: false,
          },
        },
      },
      required: ["circuit"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const query = asText(args.circuit, "circuit", MAX_CIRCUIT_NAME_LENGTH);
        const frames = asOptionalCount(args.frames, "frames", 1, MAX_FRAMES) ?? DEFAULT_FRAMES;
        const tickMs = asOptionalCount(args.tickMs, "tickMs", 1, MAX_TICK_MS) ?? DEFAULT_TICK_MS;
        const channels = args.channels === undefined ? [] : asChannels(args.channels);
        const { locale } = context;

        const detail = withStore(context.profileId, (store) => circuitDetail(store, query, locale));
        const bench = buildSimBench(toCircuitDocument(detail), catalogueComponent);
        if (bench.kind === "refused") return failResult(locale, phrase(locale, SIM_REFUSED[bench.reason]));
        if (bench.channels.length === 0) return okResult(phrase(locale, NO_CHANNELS));

        const waves = new Map<string, SimWave>();
        for (const channel of channels) {
          const wanted = foldSearchText(channel.pin);
          const match = bench.channels.find((entry) => foldSearchText(entry.id) === wanted);
          if (match === undefined) {
            const known = bench.channels.map((entry) => entry.id).join(", ");
            return failResult(locale, phrase(locale, CHANNEL_UNKNOWN, channel.pin, known));
          }
          waves.set(match.id, channel.wave);
        }

        const lines = Array.from({ length: frames }, (_, tick) => {
          const frame = simulateFrame(bench, waves, tick, tickMs);
          const values = frame.values.map((value) => {
            const channel = bench.channels.find((entry) => entry.id === value.channel);
            const flag = value.overLogic ? ` (${phrase(locale, OVER_LOGIC)})` : "";
            return `${value.channel} ${shownLevel(locale, channel, value.value)}${flag}`;
          });
          return `- ${String(frame.ms)} ms: ${values.join(", ")}`;
        });
        return okResult([phrase(locale, SIM_HEAD, detail.name, tickMs, frames), ...lines].join("\n"));
      }),
  };

  const machine: Tool = {
    name: "electronics.machine",
    description: {
      sr: "Čita opis mašine (robota) koju kolo pokreće: senzore i teme na kojima čitaju. Važi za ploče koje rade sa ROS-om. Koristi ga kada korisnik pita kako je mašina sastavljena.",
      en: "Reads the machine description (the robot) the circuit runs: its sensors and the topics they publish. Covers boards that run ROS. Use it when the user asks how the machine is put together.",
    },
    parameters: {
      type: "object",
      properties: { circuit: circuitParam },
      required: ["circuit"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const query = asText(args.circuit, "circuit", MAX_CIRCUIT_NAME_LENGTH);
        const { locale } = context;
        const detail = withStore(context.profileId, (store) => circuitDetail(store, query, locale));
        // The robot comes from the ROS package, which carries it: `core` keeps the
        // URDF generator private so no second generation of it can disagree.
        const generated = generateRosPackage(toCircuitDocument(detail), catalogueComponent, locale);
        if (generated.kind === "refused") return failResult(locale, phrase(locale, CODE_REFUSED[generated.reason]));
        const robot = generated.robot;
        if (robot.kind === "refused") return failResult(locale, phrase(locale, MACHINE_NO_CHASSIS));

        const content = [phrase(locale, MACHINE_HEAD, detail.name)];
        for (const sensor of robot.sensors) {
          content.push(phrase(locale, MACHINE_SENSOR, sensor.part, sensor.sim, sensor.mount, sensor.topic));
        }
        if (robot.skipped.length > 0) {
          content.push(phrase(locale, MACHINE_LEFT_OUT, robot.skipped.map((entry) => entry.part).join(", ")));
        }
        return okResult(content.join("\n"));
      }),
  };

  const code: Tool = {
    name: "electronics.code",
    description: {
      sr: "Vraća kod koji Nexus generiše za kolo: skicu za Arduino ploču ili ROS 2 paket. Koristi ga kada korisnik pita za program ili za datoteke.",
      en: "Returns the code Nexus generates for the circuit: a sketch for an Arduino board, or a ROS 2 package. Use it when the user asks for the program or its files.",
    },
    parameters: {
      type: "object",
      properties: { circuit: circuitParam },
      required: ["circuit"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const query = asText(args.circuit, "circuit", MAX_CIRCUIT_NAME_LENGTH);
        const { locale } = context;
        const detail = withStore(context.profileId, (store) => circuitDetail(store, query, locale));
        const generated = generateCode(toCircuitDocument(detail), catalogueComponent, locale);
        if (generated.kind === "refused") return failResult(locale, phrase(locale, CODE_REFUSED[generated.reason]));

        if (generated.kind === "package") {
          const files = generated.files.map((file) => file.path).join(", ");
          return okResult(phrase(locale, CODE_PACKAGE, generated.name, files));
        }
        const source = clampText(generated.source, MAX_CODE_CHARS);
        const head = phrase(locale, CODE_SKETCH, generated.filename, generated.libraries.join(", ") || "-");
        const cut = source.truncated ? `\n${phrase(locale, CODE_TRUNCATED, MAX_CODE_CHARS)}` : "";
        return okResult(`${head}\n\n${source.text}${cut}`);
      }),
  };

  const build: Tool = {
    name: "electronics.build",
    description: {
      sr: "Sastavlja novo kolo iz jednog opisa: ploča, delovi i veze između pinova, sve odjednom. Koristi ga kada korisnik traži novo kolo. Pinovi se zovu kao u katalogu (D13, GND, 5V); id komponente daje electronics.parts.",
      en: "Builds a new circuit from one description: a board, its parts and the wires between their pins, in one step. Use it when the user asks for a new circuit. Pins are named as the catalogue names them (D13, GND, 5V); electronics.parts gives component ids.",
    },
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: MAX_CIRCUIT_NAME_LENGTH, description: "The circuit's name." },
        board: { type: "string", minLength: 1, maxLength: MAX_END_CHARS, description: "The board: its catalogue id, such as arduino-uno." },
        parts: {
          type: "array",
          maxItems: MAX_BUILD_PARTS,
          description: "The parts besides the board.",
          items: {
            type: "object",
            properties: {
              ref: { type: "string", minLength: 1, maxLength: MAX_REF_CHARS, description: "The part's ref, such as R1 or DHT1." },
              component: { type: "string", minLength: 1, maxLength: MAX_END_CHARS, description: "A catalogue id, such as dht22 or resistor." },
              value: { type: "string", maxLength: MAX_VALUE_CHARS, description: "The value with its unit, such as 4,7k or 10 mA." },
            },
            required: ["ref", "component"],
            additionalProperties: false,
          },
        },
        wires: {
          type: "array",
          maxItems: MAX_BUILD_WIRES,
          description: "The wires, each between two pins.",
          items: {
            type: "object",
            properties: { from: endParam, to: endParam },
            required: ["from", "to"],
            additionalProperties: false,
          },
        },
      },
      required: ["name", "board"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const name = asText(args.name, "name", MAX_CIRCUIT_NAME_LENGTH);
        const boardQuery = asText(args.board, "board", MAX_END_CHARS);
        const partInputs = buildParts(args.parts);
        const wireInputs = buildWires(args.wires);
        const { locale } = context;

        const planned = planBuild({ board: boardQuery, parts: partInputs, wires: wireInputs }, COMPONENT_CATALOGUE);
        if (planned.kind === "refused") return failResult(locale, problemSentence(locale, planned.problem));
        const boardLabel = planned.plan.parts[0]?.label ?? boardQuery;

        const declined = await confirmOrDecline(
          context,
          "electronics.build",
          "write",
          phrase(locale, BUILD_SUMMARY, name, boardLabel, partInputs.length, wireInputs.length),
        );
        if (declined !== null) return declined;

        const circuit = withStore(context.profileId, (store, db) =>
          db.transaction(() => writePlan(store, name, planned.plan, instantOf(deps.now())))(),
        );
        return okResult(phrase(locale, BUILT, circuit.name, circuit.id, partInputs.length, wireInputs.length), {
          navigateTo: { module: "electronics", item: circuit.id },
        });
      }),
  };

  const place: Tool = {
    name: "electronics.place",
    description: {
      sr: "Dodaje jedan deo na postojeće kolo. Koristi ga kada korisnik traži da se doda komponenta; ako ne znaš id komponente, prvo pozovi electronics.parts.",
      en: "Adds one part to an existing circuit. Use it when the user asks to add a component; if you do not know the component's id, call electronics.parts first.",
    },
    parameters: {
      type: "object",
      properties: {
        circuit: circuitParam,
        component: { type: "string", minLength: 1, maxLength: MAX_END_CHARS, description: "A catalogue id or name, such as dht22." },
        ref: { type: "string", minLength: 1, maxLength: MAX_REF_CHARS, description: "The part's ref, such as R3. Optional." },
        value: { type: "string", maxLength: MAX_VALUE_CHARS, description: "The value with its unit, such as 220 or 4,7k." },
      },
      required: ["circuit", "component"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const query = asText(args.circuit, "circuit", MAX_CIRCUIT_NAME_LENGTH);
        const componentQuery = asText(args.component, "component", MAX_END_CHARS);
        const ref = asOptionalText(args.ref, "ref", MAX_REF_CHARS);
        const value = asOptionalText(args.value, "value", MAX_VALUE_CHARS);
        const { locale } = context;

        const component = findComponent(componentQuery, COMPONENT_CATALOGUE);
        if (component === undefined) return failResult(locale, phrase(locale, NOT_FOUND_COMPONENT, componentQuery));
        const detail = withStore(context.profileId, (store) => circuitDetail(store, query, locale));
        const folded = ref === undefined ? undefined : foldSearchText(ref);
        if (folded !== undefined && detail.parts.some((part) => foldSearchText(refOf(part)) === folded)) {
          return failResult(locale, phrase(locale, DUPLICATE_REF, ref ?? "", detail.name));
        }
        let parsed: number | undefined;
        if (value !== undefined) {
          if (component.valueUnit === undefined) return failResult(locale, phrase(locale, NO_VALUE, component.id));
          parsed = parseComponentValue(value, component.valueUnit);
          if (parsed === undefined) return failResult(locale, phrase(locale, BAD_VALUE, value, component.id));
        }

        const name = componentName(component, locale);
        const declined = await confirmOrDecline(
          context,
          "electronics.place",
          "write",
          phrase(locale, PLACE_SUMMARY, ref ?? name, detail.name),
        );
        if (declined !== null) return declined;

        const cell = gridCell(detail.parts.length);
        const part = withStore(context.profileId, (store) =>
          store.addPart(
            detail.id,
            {
              componentId: component.id,
              label: ref ?? "",
              ...cell,
              rotation: 0,
              ...(parsed === undefined ? {} : { value: parsed }),
            },
            instantOf(deps.now()),
          ),
        );
        return okResult(phrase(locale, PLACED, refOf(part), part.id, detail.name), {
          navigateTo: { module: "electronics", item: detail.id },
        });
      }),
  };

  const unplace: Tool = {
    name: "electronics.unplace",
    description: {
      sr: "Uklanja deo sa kola zajedno sa svim vezama na njemu. Koristi ga kada korisnik traži da se deo izbaci sa kola.",
      en: "Removes a part from a circuit, with every wire on it. Use it when the user asks to take a part off a circuit.",
    },
    parameters: {
      type: "object",
      properties: { circuit: circuitParam, part: partParam },
      required: ["circuit", "part"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const query = asText(args.circuit, "circuit", MAX_CIRCUIT_NAME_LENGTH);
        const partQuery = asText(args.part, "part", MAX_PART_LABEL_LENGTH);
        const { locale } = context;

        const detail = withStore(context.profileId, (store) => circuitDetail(store, query, locale));
        const part = partNamed(detail, partQuery, locale);
        const wires = detail.wires.filter((wire) => wire.fromPartId === part.id || wire.toPartId === part.id).length;

        const declined = await confirmOrDecline(
          context,
          "electronics.unplace",
          "write",
          phrase(locale, UNPLACE_SUMMARY, refOf(part), detail.name, wires),
        );
        if (declined !== null) return declined;

        const removed = withStore(context.profileId, (store) => store.removePart(part.id, instantOf(deps.now())));
        return okResult(phrase(locale, UNPLACED, refOf(part), part.id, removed.length), {
          navigateTo: { module: "electronics", item: detail.id },
        });
      }),
  };

  const connect: Tool = {
    name: "electronics.connect",
    description: {
      sr: "Povezuje dva pina žicom. Svaki pin se zadaje kao oznaka dela i pin, npr. R1.1. Koristi ga kada korisnik traži vezu između dva dela.",
      en: "Wires two pins together, each written as the part's ref and the pin, such as R1.1. Use it when the user asks to connect two parts.",
    },
    parameters: {
      type: "object",
      properties: { circuit: circuitParam, from: endParam, to: endParam },
      required: ["circuit", "from", "to"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const query = asText(args.circuit, "circuit", MAX_CIRCUIT_NAME_LENGTH);
        const fromText = asText(args.from, "from", MAX_END_CHARS);
        const toText = asText(args.to, "to", MAX_END_CHARS);
        const { locale } = context;

        const detail = withStore(context.profileId, (store) => circuitDetail(store, query, locale));
        const from = endOn(detail, fromText, locale);
        const to = endOn(detail, toText, locale);
        const wired = detail.wires.some(
          (wire) =>
            (wire.fromPartId === from.part.id && wire.fromPinId === from.pin.id && wire.toPartId === to.part.id && wire.toPinId === to.pin.id) ||
            (wire.fromPartId === to.part.id && wire.fromPinId === to.pin.id && wire.toPartId === from.part.id && wire.toPinId === from.pin.id),
        );
        if (wired) {
          return failResult(locale, phrase(locale, ALREADY_WIRED, endText(from.part, from.pin), endText(to.part, to.pin)));
        }

        const declined = await confirmOrDecline(
          context,
          "electronics.connect",
          "write",
          phrase(locale, CONNECT_SUMMARY, endText(from.part, from.pin), endText(to.part, to.pin), detail.name),
        );
        if (declined !== null) return declined;

        const wire = withStore(context.profileId, (store) =>
          store.addWire(
            detail.id,
            {
              from: { partId: from.part.id, pinId: from.pin.id },
              to: { partId: to.part.id, pinId: to.pin.id },
              colour: wireColourFor(from.pin, to.pin),
            },
            instantOf(deps.now()),
          ),
        );
        return okResult(phrase(locale, CONNECTED, endText(from.part, from.pin), endText(to.part, to.pin), wire.id), {
          navigateTo: { module: "electronics", item: detail.id },
        });
      }),
  };

  const disconnect: Tool = {
    name: "electronics.disconnect",
    description: {
      sr: "Prekida vezu između dva pina na kolu. Koristi ga kada korisnik traži da se žica skine.",
      en: "Removes the wire between two pins on a circuit. Use it when the user asks to take a wire off.",
    },
    parameters: {
      type: "object",
      properties: { circuit: circuitParam, from: endParam, to: endParam },
      required: ["circuit", "from", "to"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const query = asText(args.circuit, "circuit", MAX_CIRCUIT_NAME_LENGTH);
        const fromText = asText(args.from, "from", MAX_END_CHARS);
        const toText = asText(args.to, "to", MAX_END_CHARS);
        const { locale } = context;

        const detail = withStore(context.profileId, (store) => circuitDetail(store, query, locale));
        const from = endOn(detail, fromText, locale);
        const to = endOn(detail, toText, locale);
        const wire = detail.wires.find(
          (entry) =>
            (entry.fromPartId === from.part.id && entry.fromPinId === from.pin.id && entry.toPartId === to.part.id && entry.toPinId === to.pin.id) ||
            (entry.fromPartId === to.part.id && entry.fromPinId === to.pin.id && entry.toPartId === from.part.id && entry.toPinId === from.pin.id),
        );
        if (wire === undefined) {
          return failResult(locale, phrase(locale, NO_SUCH_WIRE, endText(from.part, from.pin), endText(to.part, to.pin)));
        }

        const declined = await confirmOrDecline(
          context,
          "electronics.disconnect",
          "write",
          phrase(locale, DISCONNECT_SUMMARY, endText(from.part, from.pin), endText(to.part, to.pin), detail.name),
        );
        if (declined !== null) return declined;

        withStore(context.profileId, (store) => store.removeWire(wire.id, instantOf(deps.now())));
        return okResult(phrase(locale, DISCONNECTED, endText(from.part, from.pin), endText(to.part, to.pin)), {
          navigateTo: { module: "electronics", item: detail.id },
        });
      }),
  };

  const rename: Tool = {
    name: "electronics.rename",
    description: {
      sr: "Menja ime kola. Koristi ga kada korisnik traži drugo ime za kolo.",
      en: "Renames a circuit. Use it when the user asks for a different name for a circuit.",
    },
    parameters: {
      type: "object",
      properties: {
        circuit: circuitParam,
        name: { type: "string", minLength: 1, maxLength: MAX_CIRCUIT_NAME_LENGTH, description: "The new name." },
      },
      required: ["circuit", "name"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const query = asText(args.circuit, "circuit", MAX_CIRCUIT_NAME_LENGTH);
        const name = asText(args.name, "name", MAX_CIRCUIT_NAME_LENGTH);
        const { locale } = context;

        const current = withStore(context.profileId, (store) =>
          circuitNamed(store.listActive(), query, locale),
        );
        const declined = await confirmOrDecline(
          context,
          "electronics.rename",
          "write",
          phrase(locale, RENAME_SUMMARY, current.name, name),
        );
        if (declined !== null) return declined;

        const renamed = withStore(context.profileId, (store) =>
          store.renameCircuit(current.id, name, instantOf(deps.now())),
        );
        return okResult(phrase(locale, RENAMED, renamed.name, renamed.id), {
          navigateTo: { module: "electronics", item: renamed.id },
        });
      }),
  };

  const remove: Tool = {
    name: "electronics.delete",
    description: {
      sr: "Briše kolo iz profila. Koristi ga samo kada korisnik jasno traži brisanje kola.",
      en: "Deletes a circuit from this profile. Use it only when the user clearly asks to delete a circuit.",
    },
    parameters: {
      type: "object",
      properties: { circuit: circuitParam },
      required: ["circuit"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const query = asText(args.circuit, "circuit", MAX_CIRCUIT_NAME_LENGTH);
        const { locale } = context;

        const current = withStore(context.profileId, (store) =>
          circuitNamed(store.listActive(), query, locale),
        );
        const declined = await confirmOrDecline(
          context,
          "electronics.delete",
          "write",
          phrase(locale, DELETE_SUMMARY, current.name),
        );
        if (declined !== null) return declined;

        withStore(context.profileId, (store) => store.softDelete(current.id, instantOf(deps.now())));
        return okResult(phrase(locale, DELETED, current.name, current.id), {
          navigateTo: { module: "electronics" },
        });
      }),
  };

  return [list, open, parts, simulate, machine, code, build, place, unplace, connect, disconnect, rename, remove];
}
