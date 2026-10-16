/**
 * The developer tools' figures for the assistant: the number bases, data units,
 * HTTP statuses, CIDR blocks, versions, UUIDs, Base64, URL and HTML escaping, case
 * and slugs, colours and contrast.
 *
 * Each runner calls the `@nexus/core/devtools` function its surface in
 * `renderer/src/devtools/*.tsx` calls, with the same argument order, so the figures
 * agree by construction. Only a tool whose input is a few numbers, enums or short
 * strings has a runner. The rest stay `drawer.open` only: a tool that reads a file,
 * a clipboard or a key, one that generates a secret (a secret should not land in a
 * chat transcript), one whose result is random, and one whose answer is a document.
 */

import type { AssistantText } from "@nexus/core";
import {
  COLOUR_FORMATS,
  contrastReport,
  formatColour,
  parseColour,
} from "@nexus/core/devtools/colour";
import {
  base64ToText,
  htmlEscape,
  htmlUnescape,
  textToBase64,
  URL_ESCAPINGS,
  urlDecode,
  urlEncode,
} from "@nexus/core/devtools/encoding";
import {
  BASE_INPUT_MAX_LENGTH,
  BASE_MAX,
  BASE_MIN,
  convertData,
  DATA_UNITS,
  formatIntegerInBase,
  parseIntegerInBase,
} from "@nexus/core/devtools/numbers";
import { CASE_FORMATS, convertCase, slugify } from "@nexus/core/devtools/text";
import {
  describeCidr,
  findHttpStatus,
  formatSemver,
  parseCidr,
  parseSemver,
  parseSemverRange,
  parseUuid,
  satisfiesSemver,
} from "@nexus/core/devtools/system";
import { asNumber } from "../args.js";
import { text } from "../support.js";
import { figure, quantity, type ToolRunner } from "./shared.js";

/** Bounds on what the model may send: policy choices for a chat, not measurements. */
const MAX_TEXT = 1024;
const MAX_SHORT = 64;
const MAX_INPUT = 1e12;

/**
 * The longest output a line carries, in code points. A policy choice for the chat:
 * a hash or an encoded string is shown whole up to here and cut with „…" after it,
 * and the page keeps the rest.
 */
const MAX_OUTPUT = 200;

const RESULT: AssistantText = { sr: "Rezultat", en: "Result" };
const YES: AssistantText = { sr: "da", en: "yes" };
const NO: AssistantText = { sr: "ne", en: "no" };

function shown(value: string): string {
  const codePoints = [...value];
  return codePoints.length > MAX_OUTPUT ? `${codePoints.slice(0, MAX_OUTPUT).join("")}…` : value;
}

const numberBase: ToolRunner = {
  params: {
    type: "object",
    properties: {
      value: {
        type: "string",
        minLength: 1,
        maxLength: BASE_INPUT_MAX_LENGTH,
        description: "The integer, written in the source base.",
      },
      from: { type: "integer", minimum: BASE_MIN, maximum: BASE_MAX, description: "The base the value is written in." },
      to: { type: "integer", minimum: BASE_MIN, maximum: BASE_MAX, description: "The base to write it in." },
    },
    required: ["value", "from", "to"],
    additionalProperties: false,
  },
  run: (values, locale) => {
    const to = asNumber(values["to"], "to", BASE_MIN, BASE_MAX);
    const from = asNumber(values["from"], "from", BASE_MIN, BASE_MAX);
    const value = parseIntegerInBase(String(values["value"]).trim(), from);
    if (value === null) return null;
    const digits = formatIntegerInBase(value, to, { uppercase: true, group: true });
    return [figure(locale, { sr: `Osnova ${String(to)}`, en: `Base ${String(to)}` }, shown(digits))];
  },
};

/** The symbol each data unit is written with, as the page's unit list shows it; the same in both languages. */
const DATA_SYMBOLS: Readonly<Record<string, string>> = {
  byte: "B",
  "kb-dec": "kB",
  "mb-dec": "MB",
  "gb-dec": "GB",
  "tb-dec": "TB",
  "pb-dec": "PB",
  kib: "KiB",
  mib: "MiB",
  gib: "GiB",
  tib: "TiB",
  pib: "PiB",
  bit: "b",
  kbit: "kbit",
  mbit: "Mbit",
  gbit: "Gbit",
};

const dataUnit: ToolRunner = {
  params: {
    type: "object",
    properties: {
      value: { type: "number", minimum: 0, maximum: MAX_INPUT, description: "The amount to convert." },
      from: { type: "string", enum: DATA_UNITS.map((unit) => unit.id) },
      to: { type: "string", enum: DATA_UNITS.map((unit) => unit.id) },
    },
    required: ["value", "from", "to"],
    additionalProperties: false,
  },
  run: (values, locale) => {
    const to = String(values["to"]);
    const result = convertData(asNumber(values["value"], "value", 0, MAX_INPUT), String(values["from"]), to);
    return result === null ? null : [figure(locale, RESULT, `${quantity(locale, result)} ${DATA_SYMBOLS[to] ?? to}`)];
  },
};

const HTTP_NAME: AssistantText = { sr: "Status", en: "Status" };
const HTTP_NOTE: AssistantText = { sr: "Napomena", en: "Note" };
const HTTP_REFERENCE: AssistantText = { sr: "Izvor", en: "Reference" };

const httpStatus: ToolRunner = {
  params: {
    type: "object",
    properties: {
      code: { type: "integer", minimum: 100, maximum: 599, description: "The three-digit status code." },
    },
    required: ["code"],
    additionalProperties: false,
  },
  run: (values, locale) => {
    const status = findHttpStatus(asNumber(values["code"], "code", 100, 599));
    if (status === undefined) return null;
    return [
      figure(locale, HTTP_NAME, `${String(status.code)} ${status.name}`),
      figure(locale, HTTP_NOTE, text(locale, { sr: status.noteSr, en: status.noteEn })),
      figure(locale, HTTP_REFERENCE, status.reference),
    ];
  },
};

const CIDR_LABELS = {
  network: { sr: "Mreža", en: "Network" },
  netmask: { sr: "Maska", en: "Netmask" },
  broadcast: { sr: "Broadcast", en: "Broadcast" },
  firstHost: { sr: "Prvi host", en: "First host" },
  lastHost: { sr: "Poslednji host", en: "Last host" },
  usable: { sr: "Upotrebljivih adresa", en: "Usable addresses" },
} as const;

const cidr: ToolRunner = {
  params: {
    type: "object",
    properties: {
      block: {
        type: "string",
        minLength: 1,
        maxLength: MAX_SHORT,
        description: "An address with its prefix, such as 10.0.0.0/8.",
      },
    },
    required: ["block"],
    additionalProperties: false,
  },
  run: (values, locale) => {
    const input = parseCidr(String(values["block"]));
    if (input === null) return null;
    const report = describeCidr(input);
    return [
      figure(locale, CIDR_LABELS.network, `${report.network}/${String(report.prefix)}`),
      figure(locale, CIDR_LABELS.netmask, report.netmask),
      ...(report.broadcast === null ? [] : [figure(locale, CIDR_LABELS.broadcast, report.broadcast)]),
      figure(locale, CIDR_LABELS.firstHost, report.firstHost),
      figure(locale, CIDR_LABELS.lastHost, report.lastHost),
      figure(locale, CIDR_LABELS.usable, report.usable.toString()),
    ];
  },
};

const SEMVER_LABELS = {
  version: { sr: "Verzija", en: "Version" },
  inRange: { sr: "U opsegu", en: "In range" },
} as const;

const semver: ToolRunner = {
  params: {
    type: "object",
    properties: {
      version: { type: "string", minLength: 1, maxLength: MAX_SHORT, description: "A version, such as 1.4.2-rc.1." },
      range: {
        type: "string",
        minLength: 1,
        maxLength: MAX_SHORT,
        description: "Optional: a range to test the version against, such as >=1.2 <2.",
      },
    },
    required: ["version"],
    additionalProperties: false,
  },
  run: (values, locale) => {
    const version = parseSemver(String(values["version"]));
    if (version === null) return null;
    const lines = [figure(locale, SEMVER_LABELS.version, formatSemver(version))];
    if (values["range"] === undefined) return lines;
    const range = parseSemverRange(String(values["range"]));
    if (range === null) return null;
    return [...lines, figure(locale, SEMVER_LABELS.inRange, text(locale, satisfiesSemver(version, range) ? YES : NO))];
  },
};

const UUID_LABELS = {
  canonical: { sr: "Zapis", en: "Canonical" },
  variant: { sr: "Varijanta", en: "Variant" },
  version: { sr: "Verzija", en: "Version" },
  timestamp: { sr: "Vremenska oznaka", en: "Timestamp" },
} as const;

const uuid: ToolRunner = {
  params: {
    type: "object",
    properties: {
      value: { type: "string", minLength: 1, maxLength: MAX_SHORT, description: "A UUID, in any usual spelling." },
    },
    required: ["value"],
    additionalProperties: false,
  },
  run: (values, locale) => {
    const parsed = parseUuid(String(values["value"]));
    if (parsed === null) return null;
    // The version nibble means something only under the RFC 4122 variant (see `ParsedUuid`).
    const lines = [
      figure(locale, UUID_LABELS.canonical, parsed.canonical),
      figure(locale, UUID_LABELS.variant, parsed.variant),
    ];
    if (parsed.variant === "rfc4122") lines.push(figure(locale, UUID_LABELS.version, String(parsed.version)));
    if (parsed.timestampMs !== null) {
      lines.push(figure(locale, UUID_LABELS.timestamp, new Date(parsed.timestampMs).toISOString()));
    }
    return lines;
  },
};

const base64: ToolRunner = {
  params: {
    type: "object",
    properties: {
      direction: { type: "string", enum: ["encode", "decode"] },
      text: {
        type: "string",
        minLength: 1,
        maxLength: MAX_TEXT,
        description: "The text to encode, or the Base64 to decode.",
      },
    },
    required: ["direction", "text"],
    additionalProperties: false,
  },
  run: (values, locale) => {
    const input = String(values["text"]);
    if (values["direction"] === "encode") return [figure(locale, RESULT, shown(textToBase64(input)))];
    const decoded = base64ToText(input);
    return decoded.ok ? [figure(locale, RESULT, shown(decoded.value))] : null;
  },
};

const urlEncoding: ToolRunner = {
  params: {
    type: "object",
    properties: {
      direction: { type: "string", enum: ["encode", "decode"] },
      text: { type: "string", minLength: 1, maxLength: MAX_TEXT },
      escaping: {
        type: "string",
        enum: [...URL_ESCAPINGS],
        description: "component, uri or form: the rules of the context.",
      },
    },
    required: ["direction", "text", "escaping"],
    additionalProperties: false,
  },
  run: (values, locale) => {
    const input = String(values["text"]);
    const escaping = values["escaping"] as (typeof URL_ESCAPINGS)[number];
    const result = values["direction"] === "encode" ? urlEncode(input, escaping) : urlDecode(input, escaping);
    return result.ok ? [figure(locale, RESULT, shown(result.value))] : null;
  },
};

const htmlEntities: ToolRunner = {
  params: {
    type: "object",
    properties: {
      direction: { type: "string", enum: ["escape", "unescape"] },
      text: { type: "string", minLength: 1, maxLength: MAX_TEXT },
    },
    required: ["direction", "text"],
    additionalProperties: false,
  },
  run: (values, locale) => {
    const input = String(values["text"]);
    if (values["direction"] === "escape") return [figure(locale, RESULT, shown(htmlEscape(input, "minimal")))];
    const unescaped = htmlUnescape(input);
    return unescaped.ok ? [figure(locale, RESULT, shown(unescaped.value))] : null;
  },
};

const caseConvert: ToolRunner = {
  params: {
    type: "object",
    properties: {
      text: { type: "string", minLength: 1, maxLength: MAX_TEXT, description: "The identifier or words to convert." },
      format: { type: "string", enum: [...CASE_FORMATS] },
    },
    required: ["text", "format"],
    additionalProperties: false,
  },
  run: (values, locale) => {
    const format = values["format"] as (typeof CASE_FORMATS)[number];
    return [figure(locale, RESULT, shown(convertCase(String(values["text"]), format)))];
  },
};

const slug: ToolRunner = {
  params: {
    type: "object",
    properties: {
      text: { type: "string", minLength: 1, maxLength: MAX_TEXT },
    },
    required: ["text"],
    additionalProperties: false,
  },
  // The surface's defaults: hyphens, lower case, no length cap, runs of separators collapsed.
  run: (values, locale) => [figure(locale, RESULT, shown(slugify(String(values["text"]))))],
};

const colourFormats: ToolRunner = {
  params: {
    type: "object",
    properties: {
      colour: {
        type: "string",
        minLength: 1,
        maxLength: MAX_SHORT,
        description: "A colour: a CSS colour name, a hex value or a colour function.",
      },
    },
    required: ["colour"],
    additionalProperties: false,
  },
  run: (values, locale) => {
    const colour = parseColour(String(values["colour"]));
    if (colour === null) return null;
    return COLOUR_FORMATS.map((format) => figure(locale, { sr: format, en: format }, formatColour(colour, format)));
  },
};

const CONTRAST_LABELS = {
  ratio: { sr: "Odnos kontrasta", en: "Contrast ratio" },
  aaBody: { sr: "AA, tekst", en: "AA, body text" },
  aaLarge: { sr: "AA, veliki tekst", en: "AA, large text" },
  aaaBody: { sr: "AAA, tekst", en: "AAA, body text" },
  aaaLarge: { sr: "AAA, veliki tekst", en: "AAA, large text" },
  nonText: { sr: "AA, neteksti elementi", en: "AA, non-text" },
} as const;

const contrast: ToolRunner = {
  params: {
    type: "object",
    properties: {
      text: { type: "string", minLength: 1, maxLength: MAX_SHORT, description: "The text colour." },
      background: { type: "string", minLength: 1, maxLength: MAX_SHORT, description: "The background colour." },
    },
    required: ["text", "background"],
    additionalProperties: false,
  },
  run: (values, locale) => {
    const foreground = parseColour(String(values["text"]));
    const backdrop = parseColour(String(values["background"]));
    if (foreground === null || backdrop === null) return null;
    const report = contrastReport(foreground, backdrop);
    return [
      figure(locale, CONTRAST_LABELS.ratio, quantity(locale, report.ratio)),
      figure(locale, CONTRAST_LABELS.aaBody, text(locale, report.aaBody ? YES : NO)),
      figure(locale, CONTRAST_LABELS.aaLarge, text(locale, report.aaLarge ? YES : NO)),
      figure(locale, CONTRAST_LABELS.aaaBody, text(locale, report.aaaBody ? YES : NO)),
      figure(locale, CONTRAST_LABELS.aaaLarge, text(locale, report.aaaLarge ? YES : NO)),
      figure(locale, CONTRAST_LABELS.nonText, text(locale, report.nonText ? YES : NO)),
    ];
  },
};

export const DEVTOOLS_RUNNERS: Readonly<Record<string, ToolRunner>> = {
  "number-base": numberBase,
  "data-unit": dataUnit,
  "http-status": httpStatus,
  cidr,
  semver,
  uuid,
  base64,
  "url-encode": urlEncoding,
  "html-entities": htmlEntities,
  "case-convert": caseConvert,
  slug,
  "color-convert": colourFormats,
  contrast,
};
