// The licence rules, one function per source, and nothing else in this module.
//
// A pack is a folder of somebody else's work, so the ONE decision that has to be
// right before any byte is downloaded is "may this work ship?". Every rule here
// answers that question from the source's own record of it, and answers it with
// the licence STRING that goes into `art.json` or with `null`, which means the
// work is dropped.
//
// Nothing here reads the network or the disk, so every rule is a test with an
// exact expected value. The rules are also deliberately narrow: a source that
// gains a licence this build has not met before is DROPPED rather than guessed
// at, because "the licence I did not recognise" is the one case where shipping
// the work would be cheaper than leaving it out and much more expensive than
// either.

/**
 * The Rijksmuseum's Linked Art records carry the image's rights as a
 * machine-readable type on the `VisualItem`, and these are the two ids that
 * mean open. `CC BY 4.0` is deliberately absent: a CC BY work would make the
 * pack's own licence a mixed set, and the pack is CC0/PD on purpose (the
 * Museums' own policy text says most of the collection is PDM or CC0, and the
 * CC BY arm of it is the part that would need its own attribution record).
 */
export const RIJKS_OPEN_RIGHTS = new Map([
  ["https://creativecommons.org/publicdomain/mark/1.0/", "PDM-1.0"],
  ["https://creativecommons.org/publicdomain/zero/1.0/", "CC0-1.0"],
]);

/**
 * The AAT ids the Rijksmuseum's Linked Art objects use for the fields this pack
 * reads. They are named here rather than inline so a reader can see all of the
 * vocabulary at once.
 */
export const AAT = {
  /** A brief text: on a Production it is the medium ("oil on panel"). */
  briefText: "http://vocab.getty.edu/aat/300435429",
  /** The credit line ("Purchased with the support of ..."). */
  creditLine: "http://vocab.getty.edu/aat/300026687",
  /** The artist's name, carried on a Production as a brief text of its own. */
  artistName: "http://vocab.getty.edu/aat/300435416",
  /** English, as an AAT language id; Dutch is ...300388256. */
  english: "http://vocab.getty.edu/aat/300388277",
};

/** The one dedication three of the four sources make: Met, Smithsonian, Rijksmuseum. */
export const CC0_LICENCE = "CC0-1.0";

/**
 * Whether a person has been dead long enough for their works to be out of
 * copyright on the life-plus-70-years rule, as of `today`.
 *
 * The arithmetic, spelled out because the off-by-one is the whole rule: a work
 * enters the public domain on 1 JANUARY of the year after the seventieth
 * anniversary of the author's death. So an artist who died in 1955 was out of
 * copyright on 2026-01-01, and `today` in 2026 gives `1955 <= 2026 - 71`.
 * A date of death is used as a YEAR because that is the granularity the rule
 * needs and the granularity Wikidata reliably carries.
 */
export function publicDomainByDeath(deathYear, today = new Date()) {
  if (!Number.isInteger(deathYear)) return false;
  return deathYear <= today.getUTCFullYear() - 71;
}

/**
 * The licence string a Commons PD-Art work ships under, or `null` to drop it.
 *
 * Both halves are required and they are required for different reasons.
 * `License === "pd"` is the file page's own public-domain tag, which is what
 * makes the REPRODUCTION free (Commons hosts it under PD because a faithful
 * photograph of a flat public-domain work carries no new copyright of its own);
 * the death year is what makes the UNDERLYING work free, and it is the year the
 * pack records as the evidence. A file that is CC0 (a donor's own dedication)
 * passes the same way, with the year still required as its PD evidence.
 */
export function commonsLicence(imageinfo, deathYear, today = new Date()) {
  const key = imageinfo?.extmetadata?.License?.value;
  if (typeof key !== "string") return null;
  const open = new Set(["pd", "cc0"]);
  if (!open.has(key.trim().toLowerCase())) return null;
  if (!publicDomainByDeath(deathYear, today)) return null;
  // Both spellings arrive: "Public domain" for a PD tag and "CC0" for the
  // dedication. `License` is the machine key and the one the filter used, so a
  // CC0 file is labelled by its key rather than by the prose beside it.
  if (key.trim().toLowerCase() === "cc0") return CC0_LICENCE;
  return `PD-Art (artist died ${String(deathYear)})`;
}

/**
 * The Rijksmuseum licence for one image, read off the `VisualItem`'s
 * `subject_to` list.
 *
 * A record may carry several rights statements (the Rijksmuseum states the
 * rights of the image and the metadata separately in some records); the first
 * one this build recognises wins, and a record with none this build recognises
 * is dropped rather than assumed to be free.
 */
export function rijksmuseumLicence(visualItem) {
  const rights = visualItem?.subject_to;
  if (!Array.isArray(rights)) return null;
  for (const right of rights) {
    const classified = right?.classified_as;
    if (!Array.isArray(classified)) continue;
    for (const entry of classified) {
      const id = entry?.id;
      if (typeof id === "string" && RIJKS_OPEN_RIGHTS.has(id)) return RIJKS_OPEN_RIGHTS.get(id);
    }
  }
  return null;
}

/**
 * The licence counts of a set of works, keyed by the string each work carries.
 * Used for `sources.json`, where "how many of each" is the receipt that the
 * filtering did something rather than merely ran.
 */
export function licenceCounts(works) {
  const counts = {};
  for (const work of works) counts[work.licence] = (counts[work.licence] ?? 0) + 1;
  return counts;
}
