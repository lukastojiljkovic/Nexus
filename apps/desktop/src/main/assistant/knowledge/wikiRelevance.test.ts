import { describe, expect, it } from "vitest";
import { wikiHits } from "./sources.js";
import { fakeWiki } from "./testFixtures.js";
import type { WikiSource } from "./types.js";

const NEVER = new AbortController().signal;

/**
 * A fake Serbian Wikipedia: the titles one packaged run really cited, spelled as
 * its index spells them, each with a lead of the shape its article opens with.
 * Keyed by TITLE, because the title is what a reader offers and a path is a
 * spelling of it (`srPath`).
 *
 * One table of leads serves every question below, because what separates them is
 * not the text but the ORDER the reader gave and what the question makes of it.
 * Each lead is the shape a real article opens with: its title as a heading, then
 * one sentence saying what the thing is.
 *
 * The suite is the gate's own (`sources.ts`'s `relevant`), which is why it needs
 * no database: nothing here is indexed, and everything is read through the
 * `WikiSource` seam.
 */
const SR_LEADS: Readonly<Record<string, string>> = {
  "Никола Тесла":
    "# Никола Тесла\n\nНикола Тесла (Смиљан, 10. јул 1856 – Њујорк, 7. јануар 1943) био је српски проналазач.",
  "Никола": "# Никола\n\nНикола је мушко име, раширено у Србији.",
  "Нико": "# Нико\n\nНико је мушко име.",
  "Тесла": "# Тесла\n\nТесла може бити презиме, јединица или назив.",
  "Музеј Николе Тесле":
    "# Музеј Николе Тесле\n\nМузеј Николе Тесле у Београду чува заоставштину Николе Тесле.",
  "Београд": "# Београд\n\nБеоград је главни град Србије.",
  "Beograd 2020": "# Beograd 2020\n\nBeograd 2020 је био пројекат уређења града.",
  "Beograd bašta": "# Beograd bašta\n\nBeograd bašta је била башта у Београду.",
  "Blu dragonsi Zemun": "# Blu dragonsi Zemun\n\nBlu dragonsi Zemun је кошаркашки клуб из Земуна.",
  "Београд (Светислав Страла)": "# Београд (Светислав Страла)\n\nБеоград је слика Светислава Страле.",
  "Француска": "# Француска\n\nФранцуска је држава у западној Европи, а главни град је Париз.",
  "Француске јужне и антарктичке земље":
    "# Француске јужне и антарктичке земље\n\nФранцуске јужне и антарктичке земље су прекоморска територија.",
  "Француске владарке": "# Француске владарке\n\nФранцуске владарке су владале у средњем веку.",
  "Француске краљице (филм)": "# Француске краљице (филм)\n\nФранцуске краљице је филм из 2018.",
  "Francusko vino": "# Francusko vino\n\nFrancusko vino је назив за вино из Француске.",
  "Град": "# Град\n\nГрад је насељено место веће од села.",
  "Дана": "# Дана\n\nДана је женско име.",
  "Имам": "# Имам\n\nИмам је верски службеник у исламу.",
  "Задатак": "# Задатак\n\nЗадатак је посао који треба обавити.",
  "Задатак (филм)": "# Задатак (филм)\n\nЗадатак је филм из 2007. године.",
  "Данас (новине)": "# Данас (новине)\n\nДанас су дневне новине у Србији.",
  "ADDA": "# ADDA\n\nADDA је организација из Данске.",
  "Ада (река)": "# Ада (река)\n\nАда је река у Србији.",
  "DNK nukleotidileksotransferaza":
    "# DNK nukleotidileksotransferaza\n\nDNK nukleotidileksotransferaza је ензим.",
};

/** The reader's own path for a title, spelled the way a ZIM spells one - which is what a citation carries. */
function srPath(title: string): string {
  return `A/${title.replace(/ /g, "_")}`;
}

/** That wiki, asked for the titles in the order a reader offered them. */
function serbianWiki(titles: readonly string[]): WikiSource {
  return fakeWiki({
    titles: titles.map((title) => ({ path: srPath(title), title })),
    articles: Object.fromEntries(
      Object.entries(SR_LEADS).map(([title, lead]) => [srPath(title), lead]),
    ),
  });
}

describe("the wiki passages a question keeps", () => {
  it("answers a question about the user's own tasks with no wiki passage at all", async () => {
    // What a Serbian library matched: an article for each name-word the question
    // contains - Дана, Имам, Задатак twice and Данас - and none of them is about
    // the tasks in front of the user.
    const wiki = serbianWiki(["Дана", "Имам", "Задатак", "Задатак (филм)", "Данас (новине)"]);

    expect(await wikiHits(wiki, "Koje zadatke imam danas?", NEVER)).toEqual([]);
  });

  it("puts the article the question names ahead of the ones that merely start with a word of it", async () => {
    const wiki = serbianWiki([
      "Град",
      "Француске јужне и антарктичке земље",
      "Француске владарке",
      "Француске краљице (филм)",
      "Francusko vino",
      "Француска",
    ]);

    const hits = await wikiHits(wiki, "Koji je glavni grad Francuske?", NEVER);

    // "Француска" was last in the reader's order, and it is the only candidate
    // whose title and lead carry both the thing asked about and the rest of the
    // question.
    expect(hits.map((hit) => hit.citation.title)).toEqual(["Француска"]);
  });

  it("takes the article the question names, and drops the shorter titles its stem reached", async () => {
    // "Нико" is a title the word "Nikola" reaches through its stem, "Никола" is
    // named by one word of the question - and only the man's own article is
    // named by one AND carries both.
    const wiki = serbianWiki(["Никола Тесла", "Никола", "Нико", "Тесла", "Музеј Николе Тесле"]);

    const hits = await wikiHits(wiki, "Ko je bio Nikola Tesla?", NEVER);

    expect(hits.map((hit) => hit.citation.title)).toEqual(["Никола Тесла", "Музеј Николе Тесле"]);
  });

  it("keeps the article a one-word question names, before the titles that only begin with it", async () => {
    const wiki = serbianWiki([
      "Београд",
      "Beograd 2020",
      "Beograd bašta",
      "Blu dragonsi Zemun",
      "Београд (Светислав Страла)",
    ]);

    const hits = await wikiHits(wiki, "Šta je Beograd?", NEVER);

    // The painting named after the city shares the whole of its title with the
    // question and stays second; the basketball club shares no word of it and is
    // gone; and the two titles that begin with the city's name carry it in half
    // of themselves, which is what puts them last.
    expect(hits.map((hit) => hit.citation.title)).toEqual([
      "Београд",
      "Београд (Светислав Страла)",
      "Beograd 2020",
      "Beograd bašta",
    ]);
  });

  it("answers an instruction about the app, not about the world, with no passage", async () => {
    // "Add" reaches ADDA, and neither of the other two titles carries a word of
    // this question at all.
    const wiki = serbianWiki(["ADDA", "Ада (река)", "DNK nukleotidileksotransferaza"]);

    expect(await wikiHits(wiki, "Add a task: buy milk tomorrow.", NEVER)).toEqual([]);
  });
});
