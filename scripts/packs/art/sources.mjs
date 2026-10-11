// What the pack is built from: four museums' open collections, the request each
// one is asked with, and the sentence on each one's own site that says the
// material may be reused.
//
// This file is DATA, and it is separated from `build.mjs` so that the licence
// evidence is readable in one place and checkable by a test: every `quote` below
// appears verbatim in the fixture named beside it, and those fixtures are cuts
// of pages that were fetched on the date `sources.json` records.
//
// THE EVIDENCE RULE, which is the one thing this file must never drift from:
// a source with no evidence is not used. Two of the four quotes below are not a
// licence deed but a museum's own policy sentence, because that is what a museum
// publishes — and a pack that recorded "CC0" without being able to show the
// sentence it read it from would be a pack whose provenance is a rumour.

/**
 * The four sources, in the order the build's quota fill draws from them.
 *
 * `licence` is the pack-level licence the source contributes under: three
 * dedications to the public domain (CC0) and one PD/CC0 museum. `dataUrl` is
 * where the records come from, `licenceUrl` the page that says so.
 */
export const SOURCES = [
  {
    id: "met",
    name: "The Metropolitan Museum of Art — Open Access",
    licence: "CC0-1.0",
    dataUrl: "https://collectionapi.metmuseum.org/public/collection/v1",
    dataDocUrl: "https://metmuseum.github.io/",
    licenceUrl: "https://metmuseum.github.io/",
    quote:
      "To the extent possible under law, The Metropolitan Museum of Art has waived all copyright and related or neighboring rights to this dataset using the Creative Commons Zero license.",
    evidenceFixture: "fixtures/evidence/met-open-access.txt",
  },
  {
    id: "smithsonian",
    name: "Smithsonian Open Access",
    licence: "CC0-1.0",
    dataUrl: "https://api.si.edu/openaccess/api/v1.0/search",
    dataDocUrl: "http://edan.si.edu/openaccess/docs/",
    licenceUrl: "https://registry.opendata.aws/smithsonian-open-access/",
    quote:
      "On February 25th, 2020, the Smithsonian released over 2.8 million CC0 interdisciplinary 2-D and 3-D images, related metadata, and additionally, research data from researches across the Smithsonian.",
    evidenceFixture: "fixtures/evidence/smithsonian-open-access.txt",
  },
  {
    id: "rijksmuseum",
    name: "Rijksmuseum",
    licence: "PDM-1.0 / CC0-1.0",
    dataUrl: "https://data.rijksmuseum.nl/search/collection",
    dataDocUrl: "https://data.rijksmuseum.nl/docs/search/",
    licenceUrl: "https://data.rijksmuseum.nl/policy/information-and-data-policy",
    quote:
      "The Rijksmuseum provides Information and Data that are no longer, or have never been, protected by copyright with a Public Domain Mark (PDM) and/or the Creative Commons Zero 1.0 (CC0 1.0) Public Domain Dedication.",
    evidenceFixture: "fixtures/evidence/rijksmuseum-data-policy.txt",
  },
  {
    id: "commons",
    name: "Wikimedia Commons (PD-Art) with Wikidata",
    licence: "CC0-1.0 (metadata) / PD-Art (images)",
    dataUrl: "https://commons.wikimedia.org/w/api.php",
    dataDocUrl: "https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service",
    licenceUrl: "https://commons.wikimedia.org/wiki/Template:PD-Art",
    quote:
      'The official position taken by the Wikimedia Foundation is that "faithful reproductions of two-dimensional public domain works of art are public domain".',
    evidenceFixture: "fixtures/evidence/commons-pd-art.txt",
  },
];

/** The Wikidata half of the Commons source, whose own licence is this. */
export const WIKIDATA_LICENCE = {
  licence: "CC0-1.0",
  licenceUrl: "https://www.wikidata.org/wiki/Wikidata:Licensing",
  quote: "All data in Wikidata has a CC0 license.",
  evidenceFixture: "fixtures/evidence/wikidata-copyright.txt",
};

/**
 * Every page a licence sentence is read from, in the order the build fetches
 * them: the four sources, plus Wikidata, whose query output is the other half of
 * the Commons source's metadata.
 */
export const EVIDENCE_PAGES = [
  ...SOURCES.map((source) => ({
    id: source.id,
    url: source.licenceUrl,
    quote: source.quote,
    fixture: source.evidenceFixture,
  })),
  {
    id: "wikidata",
    url: WIKIDATA_LICENCE.licenceUrl,
    quote: WIKIDATA_LICENCE.quote,
    fixture: WIKIDATA_LICENCE.evidenceFixture,
  },
];

// --- The Met ---------------------------------------------------------------

/**
 * The Met departments this pack draws from.
 *
 * A department is the Met's own word for an area of the collection, and the list
 * is chosen for exactly what the pack promises: European and American painting,
 * Asian and Islamic art, drawings and prints, and the two collections that carry
 * them across the nineteenth and twentieth centuries. `isPublicDomain=true` and
 * `hasImages=true` are asked of the API and then CHECKED per object, because a
 * search index and an object record disagree the day an object's rights change.
 */
export const MET_DEPARTMENTS = [
  { id: 11, name: "European Paintings", medium: "Paintings" },
  { id: 2, name: "American Paintings and Sculpture", medium: "Paintings" },
  { id: 6, name: "Asian Art", medium: "Paintings" },
  { id: 9, name: "Drawings and Prints", medium: "Prints" },
  { id: 14, name: "Islamic Art", medium: "Paintings" },
  { id: 15, name: "The Robert Lehman Collection", medium: "Paintings" },
  { id: 21, name: "Modern and Contemporary Art", medium: "Paintings" },
];

/**
 * The Met's paginated search, v1.1. The v1 endpoint this pack first used was
 * retired on 2026-10-01 and now answers HTTP 410 with a pointer to this one.
 *
 * `medium` is not decoration. Without it the department that carries the modern
 * collection answers with whatever it holds in object-id order, and the first
 * full run of this pack filled half its Met arm with "Textile sample" and a
 * corset — objects that are neither a painting, a drawing nor a print, which is
 * what this gallery is a gallery OF. The Met's own medium taxonomy is the
 * filter: an unknown value matches nothing, so the filter cannot be silently
 * ignored.
 */
export function metSearchUrl(departmentId, { medium, limit = 40, offset = 0 } = {}) {
  const params = new URLSearchParams({
    departmentId: String(departmentId),
    isPublicDomain: "true",
    hasImages: "true",
    medium,
    limit: String(limit),
    offset: String(offset),
  });
  return `https://collectionapi.metmuseum.org/public/collection/v1.1/search?${params.toString()}`;
}

export function metObjectUrl(objectId) {
  return `https://collectionapi.metmuseum.org/public/collection/v1/objects/${String(objectId)}`;
}

// --- Smithsonian Open Access ----------------------------------------------

/**
 * The Smithsonian searches, one per unit and object type.
 *
 * `media_usage:CC0` is a search filter and `metadata_usage.access` is a record
 * field; the second is what the converter reads, because a filter that stops
 * matching must not silently become a filter that stops filtering.
 */
export const SMITHSONIAN_SEARCHES = [
  { unit: "SAAM", objectType: "Paintings" },
  { unit: "SAAM", objectType: "Drawings" },
  { unit: "NPG", objectType: "Paintings" },
  { unit: "CHNDM", objectType: "Drawings" },
  { unit: "FSG", objectType: "Paintings" },
];

/**
 * The `DEMO_KEY` api.data.gov issues for exactly this use: a handful of requests
 * per hour, enough for each unit's search page and nothing more. A build that
 * needs more sets `SMITHSONIAN_API_KEY`.
 */
export const SMITHSONIAN_DEMO_KEY = "DEMO_KEY";

export function smithsonianSearchUrl({ unit, objectType }, apiKey, { rows = 30, start = 0 } = {}) {
  const params = new URLSearchParams({
    q: `unit_code:${unit} AND media_usage:CC0 AND object_type:${objectType}`,
    api_key: apiKey,
    rows: String(rows),
    start: String(start),
  });
  return `https://api.si.edu/openaccess/api/v1.0/search?${params.toString()}`;
}

// --- Rijksmuseum -----------------------------------------------------------

/**
 * The Rijksmuseum searches: one per century, which is what spreads the pack
 * across the collection instead of leaving it the first hundred records the
 * index happens to return. The `?` in a date is the search API's own wildcard.
 */
export const RIJKS_SEARCHES = ["13??", "14??", "15??", "16??", "17??", "18??", "19??"];

/**
 * The Rijksmuseum search. It needs no key — the older keyed API this pack first
 * tried answers HTTP 410 and is gone.
 */
export function rijksSearchUrl(creationDate) {
  const params = new URLSearchParams({ type: "painting", imageAvailable: "true", creationDate });
  return `https://data.rijksmuseum.nl/search/collection?${params.toString()}`;
}

/** A Rijksmuseum Linked Art record. The `id` URL answers JSON for that Accept. */
export function rijksRecordUrl(id) {
  return id;
}

// --- Wikimedia Commons and Wikidata ---------------------------------------

const SR_LANGS = '("sr", "sr-ec", "sr-el", "sh")';

/**
 * The latest year of death a painter may have and still be out of copyright
 * today: `currentYear - 71`. Computed rather than written down, because a
 * hard-coded 1955 would quietly keep the query correct for exactly one year and
 * then start shipping works it should not.
 */
export const PD_DEATH_YEAR = new Date().getUTCFullYear() - 71;

/**
 * The two Wikidata queries behind the Commons source.
 *
 * `serbian-yugoslav-painters` is the one that makes this pack worth having for
 * its audience: painters with citizenship of Serbia or Yugoslavia, each with a
 * recorded date of death, and each painting with an image. The death date is
 * REQUIRED rather than optional, because it is the evidence the licence records
 * and a work whose painter's death year is unknown cannot be evidenced.
 *
 * `great-painters` is the same shape over a hand-written list of painters who
 * died before 1956, which is what gives the pack its depth outside the region.
 * Both are `P31 = Q3305213` (painting) exactly, not a subclass walk: a subclass
 * walk over WDQS is expensive and the class it reaches includes objects that are
 * not two-dimensional pictures, which is the one thing PD-Art rests on.
 *
 * BOTH QUERIES REFUSE AN INCEPTION AFTER THE PAINTER'S DEATH. Wikidata carries
 * a date of creation that no painting can have — `A Burial at Ornans`, by
 * Courbet (d. 1877), is recorded with `P571` of 2020 — and a gallery that
 * printed it would be printing a date the source disagrees with itself about.
 * The rule is one line and it drops the row rather than the work: a painting
 * whose only recorded date is impossible is a painting with no date, and the
 * converter already leaves those out.
 */
/**
 * The painters the `great-painters` query draws from, in the order they were
 * verified.
 *
 * EVERY ID HERE WAS LOOKED UP AND THEN CHECKED BACK. Each was resolved from the
 * painter's English name on Wikidata, and the entity was then read back for its
 * `P570` (date of death) before the id was written down here; the year beside
 * each one in the comment is what that read returned, which is why they are
 * named rather than listed as bare Q-numbers. A Q-number is easy to get wrong
 * and impossible to notice: the first draft of this list carried seven ids that
 * resolve to a football club, a political party and a politician, none of which
 * the death-year filter would have caught, because all three would simply have
 * matched no paintings at all.
 *
 * Rembrandt 1669, Vermeer 1675, Leonardo 1519, Van Gogh 1890, Blake 1827,
 * Velazquez 1660, Goya 1828, Bernini 1680, Mondrian 1944, Raphael 1520,
 * Monet 1926, Titian 1576, Caravaggio 1610, Rubens 1640, Frans Hals 1666,
 * Turner 1851, Constable 1837, Friedrich 1840, Manet 1883, Degas 1917,
 * Renoir 1919, Cezanne 1906, Pissarro 1903, Gauguin 1903, Toulouse-Lautrec 1901,
 * Seurat 1891, Klimt 1918, Munch 1944, Kandinsky 1944, Winslow Homer 1910,
 * Whistler 1903, Hokusai 1849, Hiroshige 1858, Botticelli 1510, Bellini 1516,
 * Bosch 1516, Holbein 1543, El Greco 1614, David 1825, Watteau 1721, Ingres 1867,
 * Courbet 1877, Rosa Bonheur 1899, Corinth 1925, Liebermann 1935, Durer 1528,
 * Boecklin 1901, Delacroix 1863, Millet 1875, Fragonard 1806,
 * Abanindranath Tagore 1951, Repin 1930, Levitan 1900, Aivazovsky 1900,
 * Utamaro 1806, Roerich 1947, Raja Ravi Varma 1906, Sesshu Toyo 1506,
 * Vereshchagin 1904.
 */
export const GREAT_PAINTERS = [
  "Q5598", "Q41264", "Q762", "Q5582", "Q41513", "Q297", "Q5432", "Q160538",
  "Q151803", "Q5597", "Q296", "Q47551", "Q42207", "Q5599", "Q167654", "Q159758",
  "Q159297", "Q104884", "Q40599", "Q46373", "Q39931", "Q35548", "Q134741",
  "Q37693", "Q82445", "Q34013", "Q34661", "Q41406", "Q61064", "Q344838",
  "Q203643", "Q5586", "Q200798", "Q5669", "Q17169", "Q130531", "Q48319", "Q301",
  "Q83155", "Q183221", "Q23380", "Q34618", "Q241732", "Q157610", "Q158062",
  "Q5580", "Q123071", "Q33477", "Q148458", "Q127171", "Q691796", "Q172911",
  "Q211356", "Q181568", "Q272045", "Q208993", "Q333453", "Q48514", "Q127017",
];

/**
 * The painters of Serbia and Yugoslavia, resolved first and asked for by name.
 *
 * The obvious query — paintings whose painter holds one of those citizenships —
 * is the expensive one, and WDQS answers it with `upstream request timeout` more
 * often than not: joining every painting in the collection to every person with
 * those citizenships is a question the public endpoint will not carry. Resolving
 * the PAINTERS first takes two thirds of a second, and their paintings are then
 * read through a `VALUES` list, which is the same shape as the great-painters
 * query and answers in seconds.
 *
 * The membership rule is objective and stays objective: `P27` in {Serbia
 * (Q403), Yugoslavia (Q36704)}, `P106` painter (Q1028181), and a date of death
 * the 70-year line has passed. The date of death is REQUIRED rather than
 * optional, because it is the evidence the licence string records and a work
 * whose painter's death year is unknown cannot be evidenced at all.
 */
export const REGIONAL_PAINTERS_QUERY = {
  id: "serbian-yugoslav-painters",
  query: `SELECT DISTINCT ?artist WHERE {
  ?artist wdt:P31 wd:Q5 ; wdt:P106 wd:Q1028181 ; wdt:P570 ?death ; wdt:P27 ?country .
  VALUES ?country { wd:Q403 wd:Q36704 }
  FILTER(YEAR(?death) <= ${PD_DEATH_YEAR})
}`,
};

/**
 * The paintings of a named set of painters: the one query shape this pack sends
 * to WDQS, used twice with two different lists.
 *
 * `P31 = Q3305213` (painting) exactly, not a subclass walk: a subclass walk over
 * WDQS is expensive, and the classes it reaches include objects that are not
 * two-dimensional pictures, which is the one thing PD-Art rests on.
 *
 * THE SHAPE IS FLAT, AND THAT IS MEASURED. Wrapping the same patterns in a
 * `SELECT DISTINCT ... LIMIT 300` subquery — which reads like the tidier query,
 * and is what this pack shipped first — makes WDQS choose a plan that does not
 * finish: four painters took 60.5 s through the subquery and 0.3 s without it,
 * and forty-two took under a second flat and never finished through the
 * subquery. The flat form returns one row per label combination rather than one
 * per painting, which is why the build de-duplicates by Wikidata id.
 *
 * AN INCEPTION AFTER THE PAINTER'S DEATH IS REFUSED. Wikidata carries dates of
 * creation that no painting can have — `A Burial at Ornans`, by Courbet
 * (d. 1877), is recorded with `P571` of 2020 — and a gallery that printed it
 * would be printing a date the source disagrees with itself about. The rule
 * drops the row rather than the work: a painting whose only recorded date is
 * impossible is a painting with no date, and the converter already leaves those
 * out.
 */
export function commonsPaintingsQuery(artistQids) {
  return `SELECT ?painting ?img ?titleEn ?titleSr ?artistEn ?artistSr ?death ?inception ?medium ?collectionEn WHERE {
  VALUES ?artist { ${artistQids.map((qid) => `wd:${qid}`).join(" ")} }
  ?painting wdt:P31 wd:Q3305213 ; wdt:P170 ?artist ; wdt:P18 ?img .
  ?artist wdt:P570 ?death .
  FILTER(YEAR(?death) <= ${PD_DEATH_YEAR})
  OPTIONAL { ?painting rdfs:label ?titleEn FILTER(LANG(?titleEn) = "en") }
  OPTIONAL { ?painting rdfs:label ?titleSr FILTER(LANG(?titleSr) IN ${SR_LANGS}) }
  OPTIONAL { ?artist rdfs:label ?artistEn FILTER(LANG(?artistEn) = "en") }
  OPTIONAL { ?artist rdfs:label ?artistSr FILTER(LANG(?artistSr) IN ${SR_LANGS}) }
  OPTIONAL { ?painting wdt:P571 ?inceptionDate . FILTER(YEAR(?inceptionDate) <= YEAR(?death)) BIND(YEAR(?inceptionDate) AS ?inception) }
  OPTIONAL { ?painting wdt:P186 ?mediumItem . ?mediumItem rdfs:label ?medium FILTER(LANG(?medium) = "en") }
  OPTIONAL { ?painting wdt:P195 ?collection . ?collection rdfs:label ?collectionEn FILTER(LANG(?collectionEn) = "en") }
} LIMIT ${COMMONS_ROW_LIMIT}`;
}

/**
 * The most rows one painting query may return.
 *
 * The flat query multiplies rows — a painting with three materials and two
 * collections is six rows, and the great-painters list has thousands of
 * paintings — and without a cap a fifteen-painter chunk answered with 70 MB of
 * JSON. Capped, the same chunk answers in 3.6 s with 1.8 MB and two hundred and
 * thirty-six distinct paintings, which is more than the pack can use. The cap is
 * a TOP-LEVEL `LIMIT`: the same word inside a subquery is what made WDQS pick
 * the plan that never finished.
 */
export const COMMONS_ROW_LIMIT = 1500;

export function wikidataSearchUrl(query) {
  return `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
}

/**
 * The Commons `imageinfo` call: the file's own licence tag, its pixel size, its
 * MIME type, and the scaled rendition at the pack's working width.
 *
 * `iiurlwidth=2048` asks Commons to do the resizing. Downloading the original
 * would mean pulling a 40 MB TIFF for a 2048 px result, which is a cost paid to
 * the Foundation for nothing.
 */
export function commonsImageInfoUrl(titles, width = 2048) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(width),
    titles: titles.join("|"),
  });
  return `https://commons.wikimedia.org/w/api.php?${params.toString()}`;
}

/** The `File:…` title a Wikidata `P18` value points at, as the API wants it. */
export function commonsFileTitle(filePathUrl) {
  const marker = "Special:FilePath/";
  const index = filePathUrl.indexOf(marker);
  if (index === -1) return null;
  return `File:${decodeURIComponent(filePathUrl.slice(index + marker.length)).replace(/_/g, " ")}`;
}
