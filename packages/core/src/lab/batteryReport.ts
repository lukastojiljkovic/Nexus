/**
 * `powercfg /batteryreport /output <file> /xml` as the four facts this module
 * shows: the design capacity, the full-charge capacity, the cycle count and the
 * week of usage entries — and health as the full ÷ design ratio the REPORT
 * itself states.
 *
 * **Why the XML and not an API.** The task's own research measured this command
 * working without elevation on Windows 11 (build 26100) and recorded it; the
 * WinRT battery API needs a helper process and the WMI classes were denied in
 * that sandbox. So the numbers come from Windows' own report, which means they
 * carry Windows' own caveats: `DesignCapacity` and `FullChargeCapacity` are what
 * the battery's firmware reports, and "health" here is that ratio and nothing
 * more. The page says so in one line rather than dressing it up as a diagnosis.
 *
 * **The document is read by a reader written for it, and the reader is small on
 * purpose.** `batteryReport.ts` is the only XML in this product, so there is no
 * package for it and no `DOMParser` (main is Node; the renderer must not be the
 * one parsing it). What is below is a stack-based scanner for well-formed XML
 * with the four node shapes a machine-generated document uses: elements,
 * attributes, text and comments. It THROWS on anything else — a CDATA section is
 * read, a second root or an unclosed tag is a refusal — because the alternative
 * to refusing a document this code does not understand is to report a subset of
 * a battery's history as if it were all of it.
 *
 * **The element names are the report's, measured rather than guessed.** The
 * names below (`BatteryReport`, `Batteries/Battery`, `DesignCapacity`,
 * `FullChargeCapacity`, `CycleCount`, `RecentUsage/UsageEntry` and the
 * `UsageEntry` attributes `Timestamp`, `Ac`, `EntryType`, `ChargeCapacity`,
 * `Discharge`, `Duration`) were read off a report this repository's machine
 * generated on 2026-10-10 with the command in the file's own first line. The
 * default namespace on the root element is deliberately not compared: the
 * reader matches LOCAL names (the part after a `:`), which is what makes it work
 * whichever namespace a Windows build stamps on the document.
 *
 * **`Duration` is in 100-nanosecond ticks, and the test proves it rather than
 * asserting it.** The attribute is a .NET `TimeSpan` tick count — the report's
 * first two entries in the measured document are 9 583 711 964 8 ticks and three
 * minutes under two hours and forty minutes apart, which they can only be if a
 * tick is 100 ns. The fixture in `batteryReport.test.ts` is built with two
 * timestamps and a `Duration` that agree, so the conversion is pinned by
 * arithmetic a reader can check instead of by this sentence.
 */

/** One battery as Windows reports it. `null` where the report carried no value — a desktop's report carries none of this. */
export interface BatteryInfo {
  /** The report's own id for the pack, e.g. `GA50358`. Shown only to tell two packs apart. */
  readonly id: string | null;
  /** What the firmware says the pack was built with, in milliwatt-hours. */
  readonly designCapacityMWh: number | null;
  /** What the pack holds now at a full charge, in milliwatt-hours. */
  readonly fullChargeCapacityMWh: number | null;
  /** The pack's own cycle count, when the firmware reports one. `0` is a real answer and is kept as one. */
  readonly cycleCount: number | null;
}

/** One line of the report's `RecentUsage` table. */
export interface BatteryUsageEntry {
  /** The UTC instant the entry starts at, as the report spells it. */
  readonly at: string | null;
  /** Whether the machine was on mains power. */
  readonly ac: boolean | null;
  /** `Active`, `Suspend`, `ConnectedStandby` — the report's own word, reported unchanged. */
  readonly entryType: string | null;
  readonly chargeCapacityMWh: number | null;
  readonly dischargeMWh: number | null;
  /** How long the entry lasted, converted from the report's tick count. */
  readonly durationMs: number | null;
}

/** Everything the module reads off one report. */
export interface BatteryReport {
  /** When Windows took the report — the "as of" line the page shows beside the numbers. */
  readonly scannedAt: string | null;
  readonly batteries: readonly BatteryInfo[];
  readonly recentUsage: readonly BatteryUsageEntry[];
}

/** One 100-nanosecond tick, in milliseconds. */
const TICKS_PER_MS = 10_000;

/**
 * A report as data, or a throw.
 *
 * Throws when the document is not well-formed XML, when its root element is not
 * `BatteryReport`, or when a number the report states is not one. A report with
 * no `Batteries` at all is NOT a throw: a desktop's report is a real report that
 * says there is no battery, and the page's answer to that is its own sentence
 * rather than an error.
 */
export function parseBatteryReport(xml: string): BatteryReport {
  const root = readDocument(xml);
  if (root.name !== "BatteryReport") {
    throw new Error(`A battery report's root element is "BatteryReport", not "${root.name}".`);
  }
  const batteriesElement = child(root, "Batteries");
  const batteries =
    batteriesElement === null
      ? []
      : children(batteriesElement, "Battery").map((element) => ({
          id: textOf(element, "Id"),
          designCapacityMWh: wholeOf(element, "DesignCapacity"),
          fullChargeCapacityMWh: wholeOf(element, "FullChargeCapacity"),
          cycleCount: wholeOf(element, "CycleCount"),
        }));

  const usageElement = child(root, "RecentUsage");
  const recentUsage =
    usageElement === null
      ? []
      : children(usageElement, "UsageEntry").map((element) => ({
          at: attributeOf(element, "Timestamp"),
          ac: attributeFlag(element, "Ac"),
          entryType: attributeOf(element, "EntryType"),
          chargeCapacityMWh: attributeWhole(element, "ChargeCapacity"),
          dischargeMWh: attributeWhole(element, "Discharge"),
          durationMs: attributeDurationMs(element, "Duration"),
        }));

  const information = child(root, "ReportInformation");
  return {
    scannedAt: information === null ? null : textOf(information, "ScanTime"),
    batteries,
    recentUsage,
  };
}

/**
 * Health as the report's own ratio: the pack holds this fraction of what it was
 * built with. `null` when either number is missing or the design capacity is
 * zero — a ratio against nothing is not 100 %.
 *
 * Not clamped and not rounded: a pack whose firmware reports a full charge above
 * its design capacity exists, and hiding that here would be this file inventing
 * a plausible number. The page formats it.
 */
export function batteryHealth(battery: BatteryInfo): number | null {
  const design = battery.designCapacityMWh;
  const full = battery.fullChargeCapacityMWh;
  if (design === null || full === null || design <= 0) return null;
  return full / design;
}

// ── The reader ───────────────────────────────────────────────────────────────

/** One element of a document: its local name, its attributes, its children and its own text. */
interface XmlElement {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: XmlElement[];
  text: string;
}

/**
 * The document's single root element.
 *
 * Text outside the root is ignored when it is whitespace (an XML declaration and
 * a stylesheet instruction leave newlines behind) and refused when it is not,
 * because text beside the root is a document this reader does not understand.
 */
function readDocument(source: string): XmlElement {
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf("<", index);
    if (open < 0) {
      appendText(stack, source.slice(index), false);
      break;
    }
    appendText(stack, source.slice(index, open), false);
    index = open;
    if (source.startsWith("<?", index)) {
      index = skipTo(source, index, "?>");
      continue;
    }
    if (source.startsWith("<!--", index)) {
      index = skipTo(source, index, "-->");
      continue;
    }
    if (source.startsWith("<![CDATA[", index)) {
      const end = source.indexOf("]]>", index);
      if (end < 0) throw new Error("Unterminated CDATA section.");
      appendText(stack, source.slice(index + 9, end), true);
      index = end + 3;
      continue;
    }
    if (source.startsWith("<!", index)) {
      // A DOCTYPE or any other declaration: skipped whole. Neither Windows nor
      // anything else in this document's family nests one.
      index = skipTo(source, index, ">");
      continue;
    }
    if (source.startsWith("</", index)) {
      const close = source.indexOf(">", index);
      if (close < 0) throw new Error("Unterminated closing tag.");
      const name = localName(source.slice(index + 2, close).trim());
      const open = stack.pop();
      if (open === undefined || open.name !== name) {
        throw new Error(`Closing tag "${name}" does not match the element it closes.`);
      }
      index = close + 1;
      continue;
    }
    const parsed = readOpenTag(source, index);
    if (root === null && stack.length === 0) root = parsed.element;
    else if (stack.length === 0) throw new Error("A document may have only one root element.");
    const parent = stack[stack.length - 1];
    if (parent !== undefined) parent.children.push(parsed.element);
    if (!parsed.selfClosing) stack.push(parsed.element);
    index = parsed.next;
  }
  if (stack.length > 0) throw new Error("An element was left open at the end of the document.");
  if (root === null) throw new Error("The document has no root element.");
  return root;
}

/** Skips from a `<?`/`<!--`/`<!` opener to just past `terminator`. */
function skipTo(source: string, from: number, terminator: string): number {
  const end = source.indexOf(terminator, from);
  if (end < 0) throw new Error(`Unterminated "${terminator}".`);
  return end + terminator.length;
}

/** An opening tag, its element and where the tag ends. */
function readOpenTag(source: string, start: number): { element: XmlElement; selfClosing: boolean; next: number } {
  let index = start + 1;
  const nameStart = index;
  while (index < source.length && !/[\s/>]/.test(source[index] as string)) index += 1;
  if (index === nameStart) throw new Error("An opening tag carries no element name.");
  const attributes = new Map<string, string>();
  const name = localName(source.slice(nameStart, index));
  for (;;) {
    while (index < source.length && /\s/.test(source[index] as string)) index += 1;
    const char = source[index];
    if (char === undefined) throw new Error(`Unterminated tag <${name}>.`);
    if (char === ">") return { element: element(name, attributes), selfClosing: false, next: index + 1 };
    if (char === "/") {
      if (source[index + 1] !== ">") throw new Error(`A "/" inside <${name}> must close the tag.`);
      return { element: element(name, attributes), selfClosing: true, next: index + 2 };
    }
    const attributeStart = index;
    while (index < source.length && !/[\s=/>]/.test(source[index] as string)) index += 1;
    const attribute = localName(source.slice(attributeStart, index));
    while (index < source.length && /\s/.test(source[index] as string)) index += 1;
    if (source[index] !== "=") throw new Error(`Attribute "${attribute}" of <${name}> has no value.`);
    index += 1;
    while (index < source.length && /\s/.test(source[index] as string)) index += 1;
    const quote = source[index];
    if (quote !== '"' && quote !== "'") {
      throw new Error(`Attribute "${attribute}" of <${name}> is not quoted.`);
    }
    const valueEnd = source.indexOf(quote, index + 1);
    if (valueEnd < 0) throw new Error(`Attribute "${attribute}" of <${name}> is unterminated.`);
    attributes.set(attribute, decode(source.slice(index + 1, valueEnd)));
    index = valueEnd + 1;
  }
}

function element(name: string, attributes: ReadonlyMap<string, string>): XmlElement {
  return { name, attributes, children: [], text: "" };
}

/**
 * Appends decoded text to the innermost open element.
 *
 * Outside every element (before the root, between the root and the end) only
 * whitespace is tolerated: a machine-generated document leaves the line breaks
 * of its declaration and of its last closing tag behind, and anything else there
 * means a construction this reader has not been taught.
 */
function appendText(stack: XmlElement[], raw: string, literal: boolean): void {
  if (raw === "") return;
  const innermost = stack[stack.length - 1];
  if (innermost !== undefined) {
    innermost.text += literal ? raw : decode(raw);
    return;
  }
  if (raw.trim() !== "") throw new Error("Text may not sit beside the root element.");
}

/** A name without its namespace prefix — `battery:Battery` is `Battery`. */
function localName(name: string): string {
  const colon = name.lastIndexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}

/** The five predefined entities and numeric references; anything else is refused. */
function decode(text: string): string {
  if (!text.includes("&")) return text;
  return text.replaceAll(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    const named: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
    };
    const value = named[body];
    if (value === undefined) throw new Error(`Unknown XML entity "&${body};".`);
    return value;
  });
}

/** The first direct child with this local name, or `null`. */
function child(parent: XmlElement, name: string): XmlElement | null {
  return parent.children.find((each) => each.name === name) ?? null;
}

/** Every direct child with this local name, in document order. */
function children(parent: XmlElement, name: string): XmlElement[] {
  return parent.children.filter((each) => each.name === name);
}

/** The trimmed text of a child element, or `null` when it is absent or empty — an empty element is a value the report does not have. */
function textOf(parent: XmlElement, name: string): string | null {
  const element = child(parent, name);
  if (element === null) return null;
  const text = element.text.trim();
  return text === "" ? null : text;
}

/** A whole-number child, or `null` when absent or empty. Refuses anything that is not digits. */
function wholeOf(parent: XmlElement, name: string): number | null {
  const text = textOf(parent, name);
  if (text === null) return null;
  if (!/^\d+$/.test(text)) throw new Error(`"${name}" is not a whole number.`);
  return Number(text);
}

/** An attribute's value, or `null` when the attribute is absent or empty. */
function attributeOf(parent: XmlElement, name: string): string | null {
  const value = parent.attributes.get(name);
  if (value === undefined) return null;
  const text = value.trim();
  return text === "" ? null : text;
}

/** A whole-number attribute, or `null` when absent or empty. */
function attributeWhole(parent: XmlElement, name: string): number | null {
  const text = attributeOf(parent, name);
  if (text === null) return null;
  if (!/^\d+$/.test(text)) throw new Error(`"${name}" is not a whole number.`);
  return Number(text);
}

/** `0`/`1` as a boolean, or `null` when the attribute is absent. */
function attributeFlag(parent: XmlElement, name: string): boolean | null {
  const value = attributeWhole(parent, name);
  if (value === null) return null;
  if (value !== 0 && value !== 1) throw new Error(`"${name}" is not a flag.`);
  return value === 1;
}

/**
 * The `Duration` attribute as milliseconds, from the report's 100-nanosecond
 * ticks. A fraction of a millisecond is not rounded away: the value is written
 * as a float so the arithmetic stays reversible.
 */
function attributeDurationMs(parent: XmlElement, name: string): number | null {
  const ticks = attributeWhole(parent, name);
  return ticks === null ? null : ticks / TICKS_PER_MS;
}
