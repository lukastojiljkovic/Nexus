// One converter per source: the raw record the source returned, in, and this
// pack's own work record out — or `null`, which is how a work the rules refuse
// leaves the build.
//
// The converters are pure and they are the tested surface of this pack. A
// fixture is a few KB cut verbatim from a real API response, the expected value
// beside it is written out by hand from that fixture, and `convert.test.mjs`
// holds the two together. Nothing here touches the network, the disk or sharp.
//
// THE LAYOUT IS SOMEBODY ELSE'S. `{ layout: 1, works: [ … ] }` with the fields
// below is what the Culture module's reader parses (the run that builds that
// reader was told this pack uses exactly it), so this file may not add a field
// to a work, rename one, or make one optional that the reader requires. The one
// addition is `thumb`, which the reader was told about in the same breath: it is
// an extra key, and a reader that does not know it ignores it.

import { AAT, CC0_LICENCE, commonsLicence, rijksmuseumLicence } from "./licences.mjs";

/**
 * @typedef {object} ArtWork
 * @property {string} id Stable and unique inside the pack; also the image's base
 *   name, so it carries the provenance (`met-45434`, `wd-Q12418`).
 * @property {string} title
 * @property {string} artist
 * @property {string} date The source's own wording ("ca. 1830–32"), never parsed.
 * @property {string=} medium Absent when the source states none.
 * @property {string} museum
 * @property {string} credit
 * @property {string} licence
 * @property {string} image `images/<id>.webp`, relative to the pack's root.
 * @property {number} width
 * @property {number} height
 * @property {string} thumb `images/<id>-thumb.webp`.
 * @property {string} source One of `met`, `smithsonian`, `rijksmuseum`, `commons`.
 * @property {string} sourceId The id the source itself uses.
 * @property {string} sourceUrl The page a reader can go to.
 * @property {string} imageUrl Where the image bytes are downloaded from.
 */

/** The four source ids, in the order the build draws its quotas from them. */
export const SOURCE_ORDER = ["met", "smithsonian", "rijksmuseum", "commons"];

/**
 * Whitespace collapsed and the ends trimmed, or `null` when nothing is left.
 *
 * The sources pad their text (the Met's titles carry newlines from a CSV
 * export; the Rijksmuseum's credit lines arrive as two language halves of one
 * string) and an empty string would reach the reader as a blank line. One
 * function does it so no converter invents its own idea of "empty".
 */
export function cleanText(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned === "" ? null : cleaned;
}

/** The first of `values` that survives {@link cleanText}. */
function firstText(...values) {
  for (const value of values) {
    const cleaned = cleanText(value);
    if (cleaned !== null) return cleaned;
  }
  return null;
}

/**
 * A pack id segment: lower case, `a-z0-9`, single hyphens, no leading or
 * trailing hyphen. Full Unicode would be legal in JSON and unusable in the file
 * name beside it, so the ASCII fold happens here, once.
 */
export function slug(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The year out of an ISO timestamp or a bare year string, or `null`. */
export function yearOf(value) {
  const text = cleanText(value);
  if (text === null) return null;
  const match = /(\d{3,4})/.exec(text);
  if (match === null) return null;
  const year = Number.parseInt(match[1], 10);
  return Number.isInteger(year) ? year : null;
}

// --- The Met ---------------------------------------------------------------

/**
 * One Met object, or `null`.
 *
 * The Met's CSV-backed API answers with `isPublicDomain: false` on objects it
 * does not publish under CC0, and those are the ones that must not ship: the
 * flag is the museum's own statement, and its absence is indistinguishable from
 * a record whose licence was never filled in. `primaryImage` is the full-size
 * JPEG — `primaryImageSmall` is deliberately not used, because the pack resizes
 * to 2048 px and a smaller source would only lose detail on the way.
 */
export function fromMetObject(record) {
  if (typeof record !== "object" || record === null) return null;
  if (record.isPublicDomain !== true) return null;
  const objectId = record.objectID;
  if (!Number.isInteger(objectId)) return null;
  const title = cleanText(record.title);
  const artist = cleanText(record.artistDisplayName);
  const date = cleanText(record.objectDate);
  const imageUrl = cleanText(record.primaryImage);
  if (title === null || artist === null || date === null || imageUrl === null) return null;
  return {
    id: `met-${String(objectId)}`,
    title,
    artist,
    date,
    ...(cleanText(record.medium) === null ? {} : { medium: cleanText(record.medium) }),
    museum: "The Metropolitan Museum of Art",
    credit: firstText(record.creditLine, "The Metropolitan Museum of Art"),
    licence: CC0_LICENCE,
    source: "met",
    sourceId: String(objectId),
    sourceUrl: firstText(record.objectURL, `https://www.metmuseum.org/art/collection/search/${String(objectId)}`),
    imageUrl,
  };
}

// --- Smithsonian Open Access ----------------------------------------------

/**
 * The unit codes this build asks for, and the museum each one is. Kept as a
 * table rather than read from the record because the record's own
 * `data_source` is a free-text line ("Smithsonian American Art Museum") and the
 * pack wants the same word on every work from a unit.
 */
export const SMITHSONIAN_UNITS = new Map([
  ["SAAM", { museum: "Smithsonian American Art Museum", query: "unit_code:SAAM" }],
  ["NPG", { museum: "National Portrait Gallery", query: "unit_code:NPG" }],
  ["CHNDM", { museum: "Cooper Hewitt, Smithsonian Design Museum", query: "unit_code:CHNDM" }],
  ["FSG", { museum: "National Museum of Asian Art", query: "unit_code:FSG" }],
]);

/**
 * A Smithsonian artist line, reduced to the name.
 *
 * EDAN states the life dates inside the name: "Arthur A. Marschner, born
 * Detroit, MI 1884-died Detroit, MI 1950". The pack's `artist` field is the
 * artist, so the clause after the first comma that begins a life-date phrase is
 * cut — a markup-only change to the source's own text, with no word rewritten.
 */
export function smithsonianArtistName(content) {
  const text = cleanText(content);
  if (text === null) return null;
  const name = text.split(/,\s*(?:born|died|active|\()/i)[0];
  return cleanText(name);
}

/** The first `content` of a freetext block whose label is `label`. */
function freetext(row, block, label) {
  const entries = row?.content?.freetext?.[block];
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    if (entry?.label === label) return cleanText(entry.content);
  }
  return null;
}

/**
 * One Smithsonian Open Access record, or `null`.
 *
 * CC0 is stated twice in the record — once for the metadata
 * (`metadata_usage.access`) and once per image (`online_media.media[].usage.access`)
 * — and both are required here, because it is the IMAGE that ships. A record
 * whose image is not CC0 while its metadata is is exactly the record this rule
 * exists to catch.
 */
export function fromSmithsonianRow(row) {
  if (typeof row !== "object" || row === null) return null;
  const unit = SMITHSONIAN_UNITS.get(row.unitCode);
  if (unit === undefined) return null;
  const meta = row.content?.descriptiveNonRepeating;
  if (meta?.metadata_usage?.access !== "CC0") return null;
  const media = meta?.online_media?.media;
  if (!Array.isArray(media) || media.length === 0) return null;
  const image = media[0];
  if (image?.usage?.access !== "CC0") return null;
  const imageUrl = cleanText(image.content);
  const recordId = cleanText(meta.record_ID);
  const title = cleanText(meta.title?.content) ?? cleanText(row.title);
  const artist = smithsonianArtistName(freetext(row, "name", "Artist") ?? freetext(row, "name", "Artist/Maker"));
  const date = freetext(row, "date", "Date");
  if (imageUrl === null || recordId === null || title === null || artist === null || date === null) return null;
  const medium = freetext(row, "physicalDescription", "Medium");
  return {
    id: `si-${slug(recordId)}`,
    title,
    artist,
    date,
    ...(medium === null ? {} : { medium }),
    museum: unit.museum,
    credit: firstText(freetext(row, "creditLine", "Credit Line"), unit.museum),
    licence: CC0_LICENCE,
    source: "smithsonian",
    sourceId: recordId,
    sourceUrl:
      firstText(meta.record_link, meta.guid) ??
      `https://www.si.edu/object/${slug(recordId)}`,
    imageUrl,
  };
}

// --- Rijksmuseum -----------------------------------------------------------

/** The trailing integer of a `https://id.rijksmuseum.nl/<n>` URL, or `null`. */
export function rijksmuseumPid(id) {
  const text = cleanText(id);
  if (text === null) return null;
  const match = /(\d+)\s*$/.exec(text);
  return match === null ? null : match[1];
}

/** The English half of a Linked Art name list, falling back to its first name. */
function linkedArtName(entries) {
  if (!Array.isArray(entries)) return null;
  const names = entries.filter((entry) => entry?.type === "Name" && cleanText(entry.content) !== null);
  const english = names.find((entry) =>
    Array.isArray(entry.language) && entry.language.some((language) => language?.id === AAT.english),
  );
  return cleanText((english ?? names[0])?.content);
}

/** The first `referred_to_by` whose `classified_as` carries `aatClass`. */
function linkedArtByClass(entries, aatClass) {
  if (!Array.isArray(entries)) return null;
  const matching = entries.filter((entry) =>
    Array.isArray(entry?.classified_as) && entry.classified_as.some((type) => type?.id === aatClass),
  );
  const english = matching.find((entry) =>
    Array.isArray(entry.language) && entry.language.some((language) => language?.id === AAT.english),
  );
  return cleanText((english ?? matching[0])?.content);
}

/**
 * One Rijksmuseum painting, or `null`, from the three Linked Art records the
 * search id resolves through: the object, the visual item that carries the
 * image's rights, and the digital object that carries its address.
 *
 * The rights live on the VISUAL ITEM and nowhere else in the record, which is
 * why the converter takes all three: a build that stopped after the object would
 * have the title and no way to know whether the image may ship.
 */
export function fromRijksmuseum(object, visualItem, digitalObject) {
  if (typeof object !== "object" || object === null) return null;
  const pid = rijksmuseumPid(object.id);
  if (pid === null) return null;
  const licence = rijksmuseumLicence(visualItem);
  if (licence === null) return null;
  const accessPoint = digitalObject?.access_point;
  const imageUrl = Array.isArray(accessPoint) ? cleanText(accessPoint[0]?.id) : null;
  if (imageUrl === null) return null;
  const title = linkedArtName(object.identified_by);
  const production = object.produced_by;
  const artist = linkedArtByClass(production?.referred_to_by, AAT.artistName);
  const date = cleanText(linkedArtName(production?.timespan?.identified_by)) ?? cleanText(production?.timespan?.begin_of_the_begin);
  if (title === null || artist === null || date === null) return null;
  const medium = linkedArtByClass(object.referred_to_by, AAT.briefText);
  return {
    id: `rijks-${pid}`,
    title,
    artist,
    date,
    ...(medium === null ? {} : { medium }),
    museum: "Rijksmuseum",
    credit: firstText(linkedArtByClass(object.referred_to_by, AAT.creditLine), "Rijksmuseum, Amsterdam"),
    licence,
    source: "rijksmuseum",
    sourceId: pid,
    sourceUrl: `https://id.rijksmuseum.nl/${pid}`,
    imageUrl,
  };
}

// --- Wikimedia Commons, with Wikidata's metadata ---------------------------

/** The `value` of one SPARQL binding, or `null`. */
function binding(row, name) {
  return cleanText(row?.[name]?.value);
}

/**
 * The entity id at the end of a Wikidata entity URL (`…/entity/Q12418` → `Q12418`).
 * The upper-case Q is kept because it is the id Wikidata itself prints, and it is
 * what a reader pasting the work's id into a browser would have to type.
 */
function wikidataId(url) {
  const text = cleanText(url);
  if (text === null) return null;
  const tail = text.slice(text.lastIndexOf("/") + 1);
  return /^Q\d+$/.test(tail) ? tail : null;
}

/**
 * One Commons painting, or `null`.
 *
 * The metadata is Wikidata's (CC0) and the image is Commons' (PD-Art), and both
 * are required: `imageinfo` is the Commons `imageinfo` API's answer for the
 * `P18` file, and it is the only place the file's own licence tag can be read.
 * The death year travels in with the row because it is the evidence the licence
 * string quotes, and a query that returns a painting whose painter has no death
 * year recorded cannot be shipped at all.
 */
export function fromCommonsPainting(row, imageinfo, today = new Date()) {
  const qid = wikidataId(binding(row, "painting"));
  if (qid === null) return null;
  const deathYear = yearOf(binding(row, "death"));
  const licence = commonsLicence(imageinfo, deathYear, today);
  if (licence === null || deathYear === null) return null;
  const fileUrl = cleanText(normaliseDownloadUrl(imageinfo?.thumburl ?? imageinfo?.url));
  if (fileUrl === null) return null;
  const title = firstText(binding(row, "titleEn"), binding(row, "titleSr"), binding(row, "titleAny"));
  const artist = firstText(binding(row, "artistEn"), binding(row, "artistSr"), binding(row, "artistAny"));
  const date = binding(row, "inception");
  if (title === null || artist === null || date === null) return null;
  const medium = binding(row, "medium");
  return {
    id: `wd-${qid}`,
    title,
    artist,
    date,
    ...(medium === null ? {} : { medium }),
    museum: firstText(binding(row, "collectionEn"), binding(row, "collectionAny"), "Wikimedia Commons"),
    credit: "Wikimedia Commons",
    licence,
    source: "commons",
    sourceId: qid,
    sourceUrl: `https://www.wikidata.org/wiki/${qid}`,
    imageUrl: fileUrl,
  };
}

/**
 * The download URL without its query string.
 *
 * The Commons `imageinfo` API decorates the URLs it returns with its own
 * campaign parameters (`?utm_source=commons.wikimedia.org&…`). They identify the
 * caller rather than the file, so they are stripped before the address is stored
 * or fetched — the bytes at the bare URL are the same bytes, and a pack whose
 * metadata carried somebody's analytics id would be a pack that leaked it.
 */
export function normaliseDownloadUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  try {
    const url = new URL(trimmed);
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

// --- The layout ------------------------------------------------------------

/**
 * Which works ship, from one pool per source.
 *
 * The rule, in the two steps it actually runs: every source contributes up to
 * its QUOTA first, in {@link SOURCE_ORDER}; then, if the pack is still short
 * because a source had less to give (or was skipped), the remainder is filled
 * round-robin from what is left, in the same order. The pack therefore holds
 * exactly `target` works whenever the pools together hold that many, and it
 * holds fewer only when they do not.
 *
 * A quota rather than a single global cut, because the sources are not
 * interchangeable: a pack that took its first 300 candidates from the Met would
 * be a Met catalogue, and the Serbian and Yugoslav painters that make this pack
 * worth having for its audience live in one source only.
 */
export function selectWorks(pools, quotas, target) {
  const chosen = [];
  const cursor = new Map();
  for (const source of SOURCE_ORDER) {
    const pool = pools[source] ?? [];
    const take = Math.min(quotas[source] ?? 0, pool.length);
    chosen.push(...pool.slice(0, take));
    cursor.set(source, take);
  }
  while (chosen.length < target) {
    let progressed = false;
    for (const source of SOURCE_ORDER) {
      if (chosen.length >= target) break;
      const pool = pools[source] ?? [];
      const index = cursor.get(source) ?? 0;
      if (index >= pool.length) continue;
      chosen.push(pool[index]);
      cursor.set(source, index + 1);
      progressed = true;
    }
    if (!progressed) break;
  }
  return chosen;
}

/**
 * The pack's `art.json`, from works that already carry their measured pixel
 * size. The key order is the reader's, not this file's convenience.
 */
export function buildArtJson(entries) {
  return {
    layout: 1,
    works: entries.map(({ work, width, height }) => ({
      id: work.id,
      title: work.title,
      artist: work.artist,
      date: work.date,
      ...(work.medium === undefined ? {} : { medium: work.medium }),
      museum: work.museum,
      credit: work.credit,
      licence: work.licence,
      image: work.image,
      width,
      height,
      thumb: work.thumb,
    })),
  };
}
