/**
 * The Kiwix catalogue, as much of it as Nexus offers, and the Metalink files it
 * downloads from.
 *
 * **Why the whole catalogue is not offered.** The Kiwix library is 3 631 packs
 * and about 5 TiB, measured in the research run this ADR cites, and most of it is
 * either out of scope for this module (TED, Khan Academy, MOOCs) or a size no
 * ordinary disk holds. What is offered below is a curated list, and every entry
 * in it is a pack the research recommended: the two Wikipedias in the flavours
 * that exist, Wiktionary and Wikibooks in Serbian and English, iFixit's repair
 * guides, Project Gutenberg's Serbian books and one English slice, and eleven
 * Stack Exchange sites. Whether a pack actually exists is decided at runtime
 * from the live feed rather than from this table.
 *
 * **Why the table carries copy rather than sizes.** A pack's size, date and URL
 * are facts about the FEED, and a number typed into this file would be wrong the
 * day Kiwix publishes a new edition. So this module carries exactly the things a
 * feed cannot say: which pack is worth offering, what to call it in each
 * language, and what its content licence requires — and it reads the rest out of
 * the feed, per pack, at the moment the user looks.
 *
 * **Two parsers and no XML library.** The Kiwix catalogue is OPDS 1.2 (Atom,
 * with the OPDS acquisition relation) and each pack's `.zim.meta4` is Metalink 4
 * (RFC 5854). Both are parsed by scanning for elements rather than by pulling in
 * a parser, which is what the existing readers in this repository do for the ICS
 * and CSV imports — the documents are machine-written, the fields this app needs
 * are six, and a general XML parser would be a dependency taken on for a
 * problem that does not have one.
 */

export interface ZimText {
  readonly sr: string;
  readonly en: string;
}

/** One pack the catalogue offers, as the OPDS feed describes it. */
export interface CataloguePack {
  /** The feed's `<name>`: the pack's own name, e.g. `wikipedia_sr_all`. */
  readonly name: string;
  /** The feed's `<flavour>`, or `null` (some packs have none). */
  readonly flavour: string | null;
  /** The declared size in bytes, from the acquisition link's `length`. */
  readonly sizeBytes: number;
  /** The `.zim.meta4` URL the pack's acquisition link points at. */
  readonly metalinkUrl: string;
  /** The feed's `dc:issued` date, or `null`. */
  readonly issued: string | null;
}

/** One pack this build offers, named and explained. */
export interface CatalogueEdition {
  /** This app's own id — stable across Kiwix re-releases, and what a download is remembered by. */
  readonly id: string;
  /** The feed's `<name>` to look for. */
  readonly name: string;
  /** The feed's `<flavour>` to look for, or `undefined` when the pack has none. */
  readonly flavour?: string;
  readonly label: ZimText;
}

/** A group of packs that share a licence, and therefore a note the user has to read. */
export interface CatalogueCollection {
  readonly id: string;
  readonly title: ZimText;
  /** The content licence, as its own identifier. */
  readonly licence: string;
  readonly note: ZimText;
  readonly editions: readonly CatalogueEdition[];
}

/** What every Wikimedia pack's note says. The research run read the terms themselves; ADR-098 cites it. */
const WIKIMEDIA_NOTE: ZimText = {
  sr: "Tekst je pod licencom CC BY-SA 4.0 i GFDL. Autorstvo se pripisuje linkom na izvornu stranicu; paket se preuzima neizmenjen.",
  en: "The text is under CC BY-SA 4.0 and GFDL. Attribution is by a link to the source page; the pack is downloaded unmodified.",
};

/**
 * The catalogue as this build offers it.
 *
 * Every entry names a pack the research run measured in the live feed on
 * 2026-10-08/09; the ids are this app's own so that renaming a pack on Kiwix's
 * side does not orphan a download the user already started, and so a download
 * progress row has a name to be remembered by.
 */
export const CATALOGUE: readonly CatalogueCollection[] = [
  {
    id: "wikipedia",
    title: { sr: "Vikipedija", en: "Wikipedia" },
    licence: "CC-BY-SA-4.0",
    note: WIKIMEDIA_NOTE,
    editions: [
      {
        id: "wikipedia-sr-mini",
        name: "wikipedia_sr_all",
        flavour: "mini",
        label: { sr: "Vikipedija na srpskom — mini", en: "Wikipedia in Serbian — mini" },
      },
      {
        id: "wikipedia-sr-nopic",
        name: "wikipedia_sr_all",
        flavour: "nopic",
        label: { sr: "Vikipedija na srpskom — bez slika", en: "Wikipedia in Serbian — no pictures" },
      },
      {
        id: "wikipedia-sr-maxi",
        name: "wikipedia_sr_all",
        flavour: "maxi",
        label: { sr: "Vikipedija na srpskom — sa slikama", en: "Wikipedia in Serbian — with pictures" },
      },
      {
        id: "wikipedia-en-mini",
        name: "wikipedia_en_all",
        flavour: "mini",
        label: { sr: "Vikipedija na engleskom — mini", en: "Wikipedia in English — mini" },
      },
      {
        id: "wikipedia-en-nopic",
        name: "wikipedia_en_all",
        flavour: "nopic",
        label: { sr: "Vikipedija na engleskom — bez slika", en: "Wikipedia in English — no pictures" },
      },
      {
        id: "wikipedia-en-maxi",
        name: "wikipedia_en_all",
        flavour: "maxi",
        label: { sr: "Vikipedija na engleskom — sa slikama", en: "Wikipedia in English — with pictures" },
      },
    ],
  },
  {
    id: "wiktionary",
    title: { sr: "Vikirečnik", en: "Wiktionary" },
    licence: "CC-BY-SA-4.0",
    note: WIKIMEDIA_NOTE,
    editions: [
      {
        id: "wiktionary-sr-nopic",
        name: "wiktionary_sr_all",
        flavour: "nopic",
        label: { sr: "Vikirečnik na srpskom", en: "Wiktionary in Serbian" },
      },
      {
        id: "wiktionary-en-nopic",
        name: "wiktionary_en_all",
        flavour: "nopic",
        label: { sr: "Vikirečnik na engleskom", en: "Wiktionary in English" },
      },
    ],
  },
  {
    id: "wikibooks",
    title: { sr: "Vikiknjige", en: "Wikibooks" },
    licence: "CC-BY-SA-4.0",
    note: WIKIMEDIA_NOTE,
    editions: [
      {
        id: "wikibooks-sr-nopic",
        name: "wikibooks_sr_all",
        flavour: "nopic",
        label: { sr: "Vikiknjige na srpskom", en: "Wikibooks in Serbian" },
      },
      {
        id: "wikibooks-en-nopic",
        name: "wikibooks_en_all",
        flavour: "nopic",
        label: { sr: "Vikiknjige na engleskom", en: "Wikibooks in English" },
      },
    ],
  },
  {
    id: "ifixit",
    title: { sr: "iFixit — uputstva za popravku", en: "iFixit — repair guides" },
    licence: "CC-BY-NC-SA-3.0",
    note: {
      sr: "Licenca CC BY-NC-SA 3.0: pripisivanje i deljenje pod istom licencom, bez komercijalne upotrebe. Sadržaj nosi i izričitu zabranu obučavanja AI modela, pa se u Nexusu koristi samo za čitanje.",
      en: "CC BY-NC-SA 3.0: attribution and share-alike, no commercial use. The content also carries an explicit ban on AI training, so Nexus only ever renders it for reading.",
    },
    editions: [
      {
        id: "ifixit-en",
        name: "ifixit_en_all",
        label: { sr: "iFixit na engleskom", en: "iFixit in English" },
      },
    ],
  },
  {
    id: "gutenberg",
    title: { sr: "Gutenberg — besplatne knjige", en: "Gutenberg — free books" },
    licence: "PD-US",
    note: {
      sr: "Tekstovi su bez autorskih prava u Sjedinjenim Državama, a Project Gutenberg zadržava pravo na ime i zahteva da se kopije ne menjaju. Nexus prikazuje tekst knjige i ne menja ga.",
      en: "The texts are free of copyright in the United States, and Project Gutenberg retains its name and requires copies to stay unmodified. Nexus renders the text and does not change it.",
    },
    editions: [
      {
        id: "gutenberg-sr",
        name: "gutenberg_sr_all",
        label: { sr: "Gutenberg na srpskom", en: "Gutenberg in Serbian" },
      },
      {
        id: "gutenberg-en-children",
        name: "gutenberg_en_lcc-pz",
        label: {
          sr: "Gutenberg na engleskom — dečja književnost",
          en: "Gutenberg in English — children's literature",
        },
      },
    ],
  },
  {
    id: "stack-exchange",
    title: { sr: "Stack Exchange — odgovori", en: "Stack Exchange — answers" },
    licence: "CC-BY-SA-4.0",
    note: {
      sr: "Odgovori su pod licencom CC BY-SA 4.0; komercijalna upotreba je dozvoljena. Pripisivanje ide uz svaki odgovor.",
      en: "The answers are under CC BY-SA 4.0, which allows commercial use. Attribution travels with each answer.",
    },
    editions: [
      edition("electronics.stackexchange.com", { sr: "Elektronika", en: "Electronics" }),
      edition("diy.stackexchange.com", { sr: "Uradi sam", en: "Home improvement" }),
      edition("mechanics.stackexchange.com", { sr: "Motori i vozila", en: "Motor vehicles" }),
      edition("ham.stackexchange.com", { sr: "Radio-amateri", en: "Amateur radio" }),
      edition("arduino.stackexchange.com", { sr: "Arduino", en: "Arduino" }),
      edition("raspberrypi.stackexchange.com", { sr: "Raspberry Pi", en: "Raspberry Pi" }),
      edition("gardening.stackexchange.com", { sr: "Bašta", en: "Gardening" }),
      edition("cooking.stackexchange.com", { sr: "Kuvanje", en: "Cooking" }),
      edition("outdoors.stackexchange.com", { sr: "Priroda i planinarenje", en: "Outdoors" }),
      edition("sustainability.stackexchange.com", { sr: "Održivost", en: "Sustainability" }),
      edition("3dprinting.stackexchange.com", { sr: "3D štampa", en: "3D printing" }),
    ],
  },
];

/**
 * The Stack Exchange packs are named `<site>_<lang>_all` and carry an EMPTY
 * `flavour` element, which is why these editions name no flavour: the feed's
 * spelling is the name, and the site's own name is what the copy shows.
 */
function edition(site: string, label: ZimText): CatalogueEdition {
  return {
    id: `stack-exchange-${site.split(".")[0] ?? site}`,
    name: `${site}_en_all`,
    label,
  };
}

/**
 * The pack one catalogue edition names, as the feed describes it, or `null`.
 *
 * The match is on `name`, and on `flavour` only when the edition names one. The
 * Stack Exchange packs have no flavour and their feed `<name>` is the bare site
 * (`electronics.stackexchange.com`), which is why an edition may leave `flavour`
 * out and still match.
 */
export function findPack(
  packs: readonly CataloguePack[],
  edition: CatalogueEdition,
): CataloguePack | null {
  for (const pack of packs) {
    if (pack.name !== edition.name) continue;
    if (edition.flavour !== undefined && edition.flavour !== "" && pack.flavour !== edition.flavour) {
      continue;
    }
    return pack;
  }
  return null;
}

/**
 * The OPDS feed's packs.
 *
 * Six fields per entry, read by scanning: `<name>`, `<flavour>`, the acquisition
 * link's `href` and `length`, `dc:issued`, `dc:language`. An entry without a name
 * or without a `.meta4` link is skipped rather than guessed at, because a pack
 * with no acquisition link is one this app cannot offer and a pack with no name
 * cannot be matched to an edition.
 */
export function parseOpdsFeed(xml: string): CataloguePack[] {
  const packs: CataloguePack[] = [];
  for (const chunk of xml.split("<entry>").slice(1)) {
    const name = element(chunk, "name");
    const href = acquisitionHref(chunk);
    if (name === null || href === null || !href.endsWith(".zim.meta4")) continue;
    packs.push({
      name,
      flavour: element(chunk, "flavour"),
      sizeBytes: acquisitionLength(chunk) ?? 0,
      metalinkUrl: href,
      issued: element(chunk, "dc:issued"),
    });
  }
  return packs;
}

/** One pack's `.meta4`: the size, the two hashes this app uses, and the mirrors in the order MirrorBrain ranked them. */
export interface CatalogueMetalink {
  readonly sizeBytes: number;
  readonly md5: string;
  readonly sha256: string;
  readonly urls: readonly string[];
}

export function parseMetalink(xml: string): CatalogueMetalink {
  const size = element(xml, "size");
  const md5 = hashOfType(xml, "md5");
  const sha256 = hashOfType(xml, "sha-256");
  const urls: string[] = [];
  for (const match of xml.matchAll(/<url[^>]*>([^<]+)<\/url>/g)) {
    const url = match[1]?.trim();
    if (url !== undefined && url !== "") urls.push(url);
  }
  if (size === null || md5 === null || sha256 === null || urls.length === 0) {
    throw new Error("This pack's Metalink file is missing a size, a hash or a mirror.");
  }
  return { sizeBytes: Number(size), md5: md5.toLowerCase(), sha256: sha256.toLowerCase(), urls };
}

/**
 * The first mirror URL this app is allowed to reach, in Metalink order.
 *
 * The rule is passed in rather than imported: the allowlist is
 * `isSessionRequestAllowed`'s, and a second copy of "which hosts" here would be
 * a second place for it to drift. `null` means no mirror in the list is
 * reachable, which is a refusal the caller turns into a sentence rather than a
 * request the download service would refuse a hop later.
 */
export function pickMirror(
  metalink: CatalogueMetalink,
  isAllowedUrl: (url: string) => boolean,
): string | null {
  for (const url of metalink.urls) {
    if (isAllowedUrl(url)) return url;
  }
  return null;
}

/** The text of the first `<tag>` in `xml`, or `null`. */
function element(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`).exec(xml);
  const value = match?.[1]?.trim();
  return value === undefined || value === "" ? null : value;
}

function hashOfType(xml: string, type: string): string | null {
  const match = new RegExp(`<hash type="${type}">([^<]+)</hash>`).exec(xml);
  return match?.[1]?.trim() ?? null;
}

function acquisitionHref(entry: string): string | null {
  const match = /<link[^>]*rel="http:\/\/opds-spec\.org\/acquisition\/open-access"[^>]*href="([^"]+)"/.exec(entry);
  if (match?.[1] !== undefined) return match[1];
  const fallback = /href="([^"]+\.zim\.meta4)"/.exec(entry);
  return fallback?.[1] ?? null;
}

function acquisitionLength(entry: string): number | null {
  const match = /<link[^>]*length="(\d+)"[^>]*>/.exec(entry);
  const value = match?.[1];
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
