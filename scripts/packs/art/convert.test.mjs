// The converter tests: a fixture cut from a real API response in, the work this
// pack would ship out, and a non-open work dropped.
//
// Every expected value below is read off the fixture beside it, hand-written
// from the record rather than captured from this code's own output. The
// non-open cases are the point of the file: a Met object the museum marks
// `isPublicDomain: false`, a Rijksmuseum image whose rights statement is
// `InC/1.0`, a Commons file whose licence tag is CC BY-SA 4.0, and a painter who
// died in 1973 — each of them must leave the build as `null`.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildArtJson,
  fromCommonsPainting,
  fromMetObject,
  fromRijksmuseum,
  fromSmithsonianRow,
  normaliseDownloadUrl,
  selectWorks,
  slug,
  smithsonianArtistName,
  yearOf,
} from "./convert.mjs";
import { commonsLicence, publicDomainByDeath, rijksmuseumLicence } from "./licences.mjs";

/** A fixture, parsed. The paths are relative to this file so the suite can run from the root. */
function fixture(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

/** The date every time-dependent rule is evaluated at, so the suite cannot drift. */
const TODAY = new Date("2026-10-10T00:00:00Z");

describe("the Met converter", () => {
  it("maps a CC0 object to a work, marking the licence the museum states", () => {
    const record = fixture("met-object.json");
    expect(fromMetObject(record)).toEqual({
      id: "met-45434",
      title:
        "Under the Wave off Kanagawa (Kanagawa oki nami ura), also known as The Great Wave, from the series Thirty-six Views of Mount Fuji (Fugaku sanj\u016brokkei)",
      artist: "Katsushika Hokusai",
      date: "ca. 1830\u201332",
      medium: "Woodblock print; ink and color on paper",
      museum: "The Metropolitan Museum of Art",
      credit: "H. O. Havemeyer Collection, Bequest of Mrs. H. O. Havemeyer, 1929",
      licence: "CC0-1.0",
      source: "met",
      sourceId: "45434",
      sourceUrl: "https://www.metmuseum.org/art/collection/search/45434",
      imageUrl: "https://images.metmuseum.org/CRDImages/as/original/DP130155.jpg",
    });
  });

  it("drops a record the museum does not publish under CC0", () => {
    expect(fromMetObject(fixture("met-object-not-open.json"))).toBeNull();
  });

  it("drops the licence flag alone flipping, with every other field intact", () => {
    const record = fixture("met-object.json");
    expect(fromMetObject({ ...record, isPublicDomain: false })).toBeNull();
  });

  it("drops a record the source gives no date for", () => {
    const record = fixture("met-object.json");
    expect(fromMetObject({ ...record, objectDate: "" })).toBeNull();
  });
});

describe("the Smithsonian converter", () => {
  it("maps a CC0 record to a work and cuts the life dates out of the artist line", () => {
    const rows = fixture("smithsonian-search.json").response.rows;
    // The fixture's second record; the first is the no-date case below.
    expect(fromSmithsonianRow(rows[1])).toEqual({
      id: "si-saam-1950-6-15",
      title: "Louisa Catherine Adams Clement",
      artist: "Mary Louisa Adams Clement",
      date: "ca. 1910",
      medium: "watercolor on ivory",
      museum: "Smithsonian American Art Museum",
      credit:
        "Smithsonian American Art Museum, Adams-Clement Collection, gift of Mary Louisa Adams Clement in memory of her mother, Louisa Catherine Adams Clement",
      licence: "CC0-1.0",
      source: "smithsonian",
      sourceId: "saam_1950.6.15",
      sourceUrl: "https://americanart.si.edu/collections/search/artwork/?id=4969",
      imageUrl: "https://ids.si.edu/ids/deliveryService?id=SAAM-1950.6.15_1",
    });
  });

  it("drops a CC0 record with no date, which the gallery cannot place", () => {
    const rows = fixture("smithsonian-search.json").response.rows;
    expect(fromSmithsonianRow(rows[0])).toBeNull();
  });

  it("drops a record whose metadata is open but whose image is not", () => {
    const rows = fixture("smithsonian-search.json").response.rows;
    const row = structuredClone(rows[1]);
    row.content.descriptiveNonRepeating.online_media.media[0].usage.access = "Usage conditions apply";
    expect(fromSmithsonianRow(row)).toBeNull();
  });

  it("drops a record whose metadata usage is not CC0", () => {
    const rows = fixture("smithsonian-search.json").response.rows;
    const row = structuredClone(rows[1]);
    row.content.descriptiveNonRepeating.metadata_usage.access = "Usage conditions apply";
    expect(fromSmithsonianRow(row)).toBeNull();
  });

  it("reduces an artist line to the name, leaving one without life dates alone", () => {
    expect(smithsonianArtistName("Arthur A. Marschner, born Detroit, MI 1884-died Detroit, MI 1950")).toBe(
      "Arthur A. Marschner",
    );
    expect(smithsonianArtistName("Unidentified")).toBe("Unidentified");
    expect(smithsonianArtistName("")).toBeNull();
  });
});

describe("the Rijksmuseum converter", () => {
  it("maps a Public Domain Mark painting to a work, English fields first", () => {
    expect(fromRijksmuseum(fixture("rijksmuseum-object.json"), fixture("rijksmuseum-visual.json"), fixture("rijksmuseum-digital.json"))).toEqual({
      id: "rijks-200106038",
      title: "The Stone Bridge",
      artist: "Rembrandt van Rijn",
      date: "c. 1638",
      medium: "oil on panel",
      museum: "Rijksmuseum",
      credit: "Purchased with the support of the Vereniging Rembrandt and A. Bredius, Amsterdam",
      licence: "PDM-1.0",
      source: "rijksmuseum",
      sourceId: "200106038",
      sourceUrl: "https://id.rijksmuseum.nl/200106038",
      imageUrl: "https://iiif.micr.io/mPymb/full/max/0/default.jpg",
    });
  });

  it("drops an image whose rights statement is In Copyright", () => {
    expect(
      fromRijksmuseum(
        fixture("rijksmuseum-object.json"),
        fixture("rijksmuseum-visual-in-copyright.json"),
        fixture("rijksmuseum-digital.json"),
      ),
    ).toBeNull();
  });

  it("drops a visual item with no rights statement at all", () => {
    const visual = fixture("rijksmuseum-visual.json");
    expect(rijksmuseumLicence({ ...visual, subject_to: [] })).toBeNull();
    expect(rijksmuseumLicence(undefined)).toBeNull();
  });

  it("reads the CC0 arm of the museum's own dedication", () => {
    const visual = fixture("rijksmuseum-visual.json");
    visual.subject_to[0].classified_as = [{ id: "https://creativecommons.org/publicdomain/zero/1.0/", type: "Type" }];
    expect(rijksmuseumLicence(visual)).toBe("CC0-1.0");
  });
});

describe("the Commons converter", () => {
  const rows = fixture("wikidata-paintings.json").results.bindings;
  const pages = fixture("commons-imageinfo.json").query.pages;
  const infoFor = (title) => pages.find((page) => page.title === title).imageinfo[0];

  it("maps a PD-Art painting with a public-domain file to a work", () => {
    const info = infoFor("File:Ferencz Eisenhut (1857-1903) - An Oriental School - NCM 1932-11 - Nottingham Museums.jpg");
    expect(fromCommonsPainting(rows[0], info, TODAY)).toEqual({
      id: "wd-Q119140957",
      title: "An Oriental School",
      artist: "Franz Eisenhut",
      date: "1885",
      medium: "canvas",
      museum: "Nottingham Museums",
      credit: "Wikimedia Commons",
      licence: "PD-Art (artist died 1906)",
      source: "commons",
      sourceId: "Q119140957",
      sourceUrl: "https://www.wikidata.org/wiki/Q119140957",
      imageUrl:
        "https://upload.wikimedia.org/wikipedia/commons/b/b1/Ferencz_Eisenhut_%281857-1903%29_-_An_Oriental_School_-_NCM_1932-11_-_Nottingham_Museums.jpg",
    });
  });

  it("drops a painting whose painter died after the 70-year line", () => {
    const info = infoFor("File:Ferencz Eisenhut (1857-1903) - An Oriental School - NCM 1932-11 - Nottingham Museums.jpg");
    // Q175036 is Guernica; Picasso died in 1973, so 1973 > 2026 - 71 = 1955.
    expect(fromCommonsPainting(rows[2], info, TODAY)).toBeNull();
  });

  it("drops a file whose own tag is CC BY-SA", () => {
    const info = infoFor("File:The triumph of french painting The apotheosis of Poussin, Le Sueur and Le Brune - Louvre.jpg");
    expect(fromCommonsPainting(rows[0], info, TODAY)).toBeNull();
  });

  it("drops a painting the query gave no inception year for", () => {
    const info = infoFor("File:A girl in national costume.JPG");
    expect(rows[1].painting.value).toBe("http://www.wikidata.org/entity/Q123908564");
    expect(fromCommonsPainting(rows[1], info, TODAY)).toBeNull();
  });

  it("drops a painting whose file the imageinfo call did not answer for", () => {
    expect(fromCommonsPainting(rows[0], undefined, TODAY)).toBeNull();
  });
});

describe("the licence rules", () => {
  it("puts the 70-year line exactly where the arithmetic says", () => {
    // Life plus 70 years expires on 1 January of the year AFTER the seventieth
    // anniversary, so an artist who died in 1955 is out of copyright from
    // 2026-01-01 and `1955 <= 2026 - 71` is the whole test.
    expect(publicDomainByDeath(1955, TODAY)).toBe(true);
    expect(publicDomainByDeath(1956, TODAY)).toBe(false);
    expect(publicDomainByDeath(1906, TODAY)).toBe(true);
    expect(publicDomainByDeath(1973, TODAY)).toBe(false);
    expect(publicDomainByDeath(null, TODAY)).toBe(false);
  });

  it("accepts a CC0 dedication as well as a PD tag, and nothing else", () => {
    const cc0 = { extmetadata: { License: { value: "cc0" } } };
    const bySa = { extmetadata: { License: { value: "cc-by-sa-4.0" } } };
    expect(commonsLicence(cc0, 1906, TODAY)).toBe("CC0-1.0");
    expect(commonsLicence(bySa, 1906, TODAY)).toBeNull();
    expect(commonsLicence({}, 1906, TODAY)).toBeNull();
    // A public-domain tag with a living painter's death year is still dropped:
    // the tag says the FILE is free, and the year is what says the WORK is.
    expect(commonsLicence({ extmetadata: { License: { value: "pd" } } }, 1973, TODAY)).toBeNull();
  });
});

describe("the small helpers", () => {
  it("slugifies an id segment to a-z, 0-9 and single hyphens", () => {
    expect(slug("saam_1950.6.15")).toBe("saam-1950-6-15");
    expect(slug("Q119140957")).toBe("q119140957");
    expect(slug("  A  B ")).toBe("a-b");
    expect(slug("\u010cedomir \u0106iri\u0107")).toBe("cedomir-ciric");
  });

  it("reads the year out of an ISO timestamp or a bare year", () => {
    expect(yearOf("1906-06-02T00:00:00Z")).toBe(1906);
    expect(yearOf("1885")).toBe(1885);
    expect(yearOf("n.d.")).toBeNull();
    expect(yearOf(null)).toBeNull();
  });

  it("strips the campaign parameters the Commons API adds to its own URLs", () => {
    expect(
      normaliseDownloadUrl("https://upload.wikimedia.org/a/b/File.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo"),
    ).toBe("https://upload.wikimedia.org/a/b/File.jpg");
    expect(normaliseDownloadUrl("not a url")).toBeNull();
    expect(normaliseDownloadUrl("")).toBeNull();
  });
});

describe("the pack's selection and layout", () => {
  const pool = (names) => names.map((id) => ({ id }));

  it("fills every source's quota first, then the remainder in source order", () => {
    const pools = {
      met: pool(["a", "b", "c"]),
      smithsonian: pool([]),
      rijksmuseum: pool(["d"]),
      commons: pool(["e", "f", "g", "h"]),
    };
    const quotas = { met: 2, smithsonian: 5, rijksmuseum: 1, commons: 2 };
    expect(selectWorks(pools, quotas, 8).map((work) => work.id)).toEqual(["a", "b", "d", "e", "f", "c", "g", "h"]);
  });

  it("stops when the pools run out rather than repeating a work", () => {
    const pools = { met: pool(["a", "b"]), smithsonian: pool([]), rijksmuseum: pool([]), commons: pool(["c"]) };
    const chosen = selectWorks(pools, { met: 2, smithsonian: 2, rijksmuseum: 2, commons: 2 }, 10);
    expect(chosen.map((work) => work.id)).toEqual(["a", "b", "c"]);
  });

  it("writes the reader's layout key for key, with the thumbnail beside the image", () => {
    const work = {
      id: "met-45434",
      title: "The Great Wave",
      artist: "Katsushika Hokusai",
      date: "ca. 1830",
      museum: "The Metropolitan Museum of Art",
      credit: "H. O. Havemeyer Collection",
      licence: "CC0-1.0",
      image: "images/met-45434.webp",
      thumb: "images/met-45434-thumb.webp",
    };
    const art = buildArtJson([{ work, width: 2048, height: 1500 }]);
    expect(art).toEqual({
      layout: 1,
      works: [
        {
          id: "met-45434",
          title: "The Great Wave",
          artist: "Katsushika Hokusai",
          date: "ca. 1830",
          museum: "The Metropolitan Museum of Art",
          credit: "H. O. Havemeyer Collection",
          licence: "CC0-1.0",
          image: "images/met-45434.webp",
          width: 2048,
          height: 1500,
          thumb: "images/met-45434-thumb.webp",
        },
      ],
    });
    // The KEY SET is the reader's contract, so it is asserted rather than
    // assumed: `medium` is absent when the source states none, and no field
    // beyond these eleven may appear.
    expect(Object.keys(art.works[0])).toEqual([
      "id",
      "title",
      "artist",
      "date",
      "museum",
      "credit",
      "licence",
      "image",
      "width",
      "height",
      "thumb",
    ]);
  });

  it("keeps `medium` when the source states one", () => {
    const art = buildArtJson([
      {
        work: {
          id: "met-1",
          title: "T",
          artist: "A",
          date: "1900",
          medium: "oil on canvas",
          museum: "M",
          credit: "C",
          licence: "CC0-1.0",
          image: "images/met-1.webp",
          thumb: "images/met-1-thumb.webp",
        },
        width: 10,
        height: 20,
      },
    ]);
    expect(Object.keys(art.works[0])).toEqual([
      "id",
      "title",
      "artist",
      "date",
      "medium",
      "museum",
      "credit",
      "licence",
      "image",
      "width",
      "height",
      "thumb",
    ]);
  });
});
