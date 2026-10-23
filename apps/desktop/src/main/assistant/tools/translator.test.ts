import { describe, expect, it } from "vitest";
import type { AssistantLocale, Tool, ToolContext } from "@nexus/core";
import type { DictionaryReader } from "../../../modules/translator/main/dictionary.js";
import type {
  TranslatorEntryView,
  TranslatorTopicView,
  TranslatorDirectionChoice,
} from "../../../modules/translator/shared/ipc.js";
import type { InstalledPackView } from "../../../shared/ipc.js";
import { translatorTools } from "./translator.js";

/**
 * The TRANSLATOR tools. There is no database here: the dictionary is a signed
 * pack on the machine, so these tests hand the tools a reader with the answers a
 * real pack gives, and the packs list, and pin what the model reads back.
 */

const PROFILE_ID = "0192f0f0-0000-7000-8000-000000000000";

const HELLO: TranslatorEntryView = {
  word: "hello",
  latin: null,
  pos: "interjection",
  glosses: ["used as a greeting"],
  translations: ["zdravo", "ćao"],
  url: "https://en.wiktionary.org/wiki/hello",
};

const ZDRAVO: TranslatorEntryView = {
  word: "здраво",
  latin: "zdravo",
  pos: "",
  glosses: ["hello"],
  translations: [],
  url: "https://sh.wiktionary.org/wiki/здраво",
};

const TOPICS: readonly TranslatorTopicView[] = [
  {
    id: "restaurant",
    title: "Restaurant",
    phrases: [
      { en: "Can I have the bill, please?", sr: "Mogu li račun, molim?" },
      { en: "A table for two", sr: "Sto za dvoje" },
    ],
  },
];

function dictionary(options: { installed?: boolean; entries?: readonly TranslatorEntryView[] } = {}): DictionaryReader {
  const installed = options.installed ?? true;
  return {
    status: () => ({
      installed,
      version: installed ? "2026.1.0" : null,
      counts: null,
      attribution: "Wiktionary contributors",
      licence: "CC BY-SA 4.0",
    }),
    search: (requested: TranslatorDirectionChoice, query: string) => ({
      direction: requested === "sr-en" ? "sr-en" : "en-sr",
      requested,
      key: query,
      exact: options.entries ?? [],
      prefix: [],
      truncated: false,
    }),
    phrases: () => ({ topics: installed ? TOPICS : [] }),
  };
}

function packOf(id: string): InstalledPackView {
  return {
    id,
    version: "2026.1",
    kind: "model",
    notice: null,
    title: { sr: id, en: id },
    description: { sr: "", en: "" },
    licence: { spdx: "MPL-2.0", attribution: "Mozilla", url: "https://www.mozilla.org/MPL/2.0/" },
    source: { name: "Mozilla", url: "https://www.mozilla.org/" },
    size: 1_000_000,
    fileCount: 3,
    installedAt: Date.parse("2026-10-01T00:00:00.000Z"),
  };
}

function toolsWith(options: Parameters<typeof dictionary>[0] = {}, packIds: readonly string[] = []): readonly Tool[] {
  return translatorTools({
    dictionary: dictionary(options),
    packs: { list: () => Promise.resolve(packIds.map(packOf)) },
  });
}

function toolNamed(tools: readonly Tool[], name: string): Tool {
  const found = tools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

function context(locale: AssistantLocale): ToolContext {
  return {
    profileId: PROFILE_ID,
    locale,
    signal: new AbortController().signal,
    confirm: () => Promise.resolve(true),
  };
}

describe("translator.lookup", () => {
  it("answers the entries the dictionary found, with the direction it searched and each source", async () => {
    const tool = toolNamed(toolsWith({ entries: [HELLO, ZDRAVO] }), "translator.lookup");
    const result = await tool.run({ word: "hello" }, context("en"));
    expect(result).toEqual({
      ok: true,
      content: [
        "Dictionary en-sr (2):",
        "- hello [interjection]: used as a greeting → zdravo, ćao (https://en.wiktionary.org/wiki/hello)",
        "- здраво (zdravo): hello (https://sh.wiktionary.org/wiki/здраво)",
      ].join("\n"),
    });
  });

  it("passes the direction the model chose to the reader", async () => {
    const tool = toolNamed(toolsWith({ entries: [ZDRAVO] }), "translator.lookup");
    const result = await tool.run({ word: "zdravo", direction: "sr-en" }, context("sr"));
    expect(result.content.startsWith("Rečnik sr-en (1):")).toBe(true);
  });

  it("says the dictionary is not installed, and where, rather than failing", async () => {
    const tool = toolNamed(toolsWith({ installed: false }), "translator.lookup");
    expect(await tool.run({ word: "hello" }, context("en"))).toEqual({
      ok: true,
      content:
        "The dictionary is not installed. Install the dictionary-sr-en pack on the “Content packs” card in Settings.",
    });
  });

  it("answers a word with no entry by name", async () => {
    const tool = toolNamed(toolsWith({ entries: [] }), "translator.lookup");
    expect(await tool.run({ word: "xyzzy" }, context("en"))).toEqual({
      ok: true,
      content: "No entry for “xyzzy”.",
    });
  });

  it("refuses a missing word with the schema's own message", async () => {
    const tool = toolNamed(toolsWith(), "translator.lookup");
    const result = await tool.run({}, context("en"));
    expect(result.ok).toBe(false);
    expect(result.content).toContain("word");
  });

  it("refuses a direction outside its closed vocabulary", async () => {
    const tool = toolNamed(toolsWith(), "translator.lookup");
    const result = await tool.run({ word: "hello", direction: "de-en" }, context("en"));
    expect(result.ok).toBe(false);
    expect(result.content).toContain("direction");
  });
});

describe("translator.phrases", () => {
  it("lists the topics when none is named", async () => {
    const tool = toolNamed(toolsWith(), "translator.phrases");
    expect(await tool.run({}, context("en"))).toEqual({
      ok: true,
      content: "Phrase topics (1):\n- restaurant Restaurant (2)",
    });
  });

  it("answers the phrases that contain a word, in both languages", async () => {
    const tool = toolNamed(toolsWith(), "translator.phrases");
    expect(await tool.run({ query: "račun" }, context("sr"))).toEqual({
      ok: true,
      content: "Fraze (1):\n- Restaurant: Can I have the bill, please? — Mogu li račun, molim?",
    });
  });

  it("answers one topic, found by its title ignoring case and diacritics", async () => {
    const tool = toolNamed(toolsWith(), "translator.phrases");
    const result = await tool.run({ topic: "restaurant" }, context("en"));
    expect(result.content).toBe(
      [
        "Phrases (2):",
        "- Restaurant: Can I have the bill, please? — Mogu li račun, molim?",
        "- Restaurant: A table for two — Sto za dvoje",
      ].join("\n"),
    );
  });

  it("refuses an unknown topic and names the ones there are", async () => {
    const tool = toolNamed(toolsWith(), "translator.phrases");
    expect(await tool.run({ topic: "Beach" }, context("en"))).toEqual({
      ok: false,
      content: "Failed: No topic “Beach”. Topics: Restaurant.",
    });
  });

  it("says so when no phrase matches", async () => {
    const tool = toolNamed(toolsWith(), "translator.phrases");
    expect(await tool.run({ query: "zzz" }, context("en"))).toEqual({
      ok: true,
      content: "No phrases for “zzz”.",
    });
  });

  it("says the dictionary is not installed rather than failing", async () => {
    const tool = toolNamed(toolsWith({ installed: false }), "translator.phrases");
    const result = await tool.run({}, context("en"));
    expect(result.ok).toBe(true);
    expect(result.content).toContain("not installed");
  });
});

describe("translator.translate", () => {
  it("is a navigation, since it opens a page", () => {
    expect(toolNamed(toolsWith({}, ["nllb-600m"]), "translator.translate").effect).toBe("navigate");
  });

  it("opens the Translator page on the text, with the NLLB codes of both languages, and says it cannot read the result", async () => {
    const tool = toolNamed(toolsWith({}, ["nllb-600m"]), "translator.translate");
    const result = await tool.run({ text: "Good morning.", from: "en", to: "sr" }, context("en"));
    expect(result).toEqual({
      ok: true,
      content:
        "Opened the Translator page with that text. The translation appears on that page and I cannot read it, so do not translate the text yourself.",
      navigateTo: {
        module: "translator",
        action: { name: "translate", payload: { text: "Good morning.", from: "eng_Latn", to: "srp_Cyrl" } },
      },
    });
  });

  it("takes an NLLB code as well as a language tag, and resolves a tag with a script", async () => {
    const tool = toolNamed(toolsWith({}, ["nllb-600m"]), "translator.translate");
    const result = await tool.run({ text: "你好", from: "zh-hant", to: "eng_Latn" }, context("en"));
    expect(result.navigateTo).toEqual({
      module: "translator",
      action: { name: "translate", payload: { text: "你好", from: "zho_Hant", to: "eng_Latn" } },
    });
  });

  it("leaves the source to detection when from is absent or auto", async () => {
    const tool = toolNamed(toolsWith({}, ["nllb-600m"]), "translator.translate");
    const absent = await tool.run({ text: "Dobar dan", to: "en" }, context("sr"));
    const auto = await tool.run({ text: "Dobar dan", from: "auto", to: "en" }, context("sr"));
    expect(absent.navigateTo?.action?.payload).toEqual({ text: "Dobar dan", from: "auto", to: "eng_Latn" });
    expect(auto.navigateTo?.action?.payload).toEqual({ text: "Dobar dan", from: "auto", to: "eng_Latn" });
  });

  it("refuses a language the table does not carry, and names what it takes", async () => {
    const tool = toolNamed(toolsWith({}, ["nllb-600m"]), "translator.translate");
    const source = await tool.run({ text: "Hello", from: "xx", to: "sr" }, context("en"));
    expect(source).toEqual({
      ok: false,
      content:
        "Failed: The language “xx” is not in the language table. Give an NLLB code (for example srp_Cyrl) or a language tag (for example sr).",
    });
    const target = await tool.run({ text: "Hello", from: "en", to: "xx" }, context("en"));
    expect(target.ok).toBe(false);
    expect(target.content).toContain("“xx”");
  });

  it("refuses the same language on both sides", async () => {
    const tool = toolNamed(toolsWith({}, ["nllb-600m"]), "translator.translate");
    expect(await tool.run({ text: "Hello", from: "en", to: "eng_Latn" }, context("en"))).toEqual({
      ok: false,
      content: "Failed: The source and the target language are the same (“eng_Latn”).",
    });
  });

  it("refuses when no NLLB model is installed, naming nllb-600m as the one to install", async () => {
    const tool = toolNamed(toolsWith({}, ["dictionary-sr-en"]), "translator.translate");
    expect(await tool.run({ text: "Good morning.", from: "en", to: "sr" }, context("en"))).toEqual({
      ok: false,
      content: "Failed: No NLLB model is installed. Install nllb-600m on the “Content packs” card.",
    });
  });

  it("refuses an empty text", async () => {
    const tool = toolNamed(toolsWith({}, ["nllb-600m"]), "translator.translate");
    expect((await tool.run({ text: "   ", to: "sr" }, context("en"))).ok).toBe(false);
  });
});
