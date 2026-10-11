import { describe, expect, it } from "vitest";
import {
  foldPlaces,
  parsePlacesFile,
  rankPlaces,
  type MapPlace,
} from "./places.js";

/**
 * The place index: the file's reader, and the ranking.
 *
 * The rows below are REAL OpenStreetMap records, read 2026-10-10 through the
 * Overpass API with `node[place][name](bbox)` over six Serbian towns, and each
 * carries its own node id so the tags can be checked against
 * `https://www.openstreetmap.org/node/<id>`. Two of the names were folded by
 * hand for the ranking cases: `Čačak` folds to `cacak` (NFD-stripped), `Niš` to
 * `nis`, and the Cyrillic `Краљево` to `kraljevo` through the fold table's
 * transliteration, which is the whole reason a Cyrillic query finds a Latin row.
 */

const BEOGRAD: MapPlace = {
  id: 60571493,
  name: "Beograd",
  nameCyr: "Београд",
  nameEn: "Belgrade",
  kind: "city",
  lat: 44.8178131,
  lon: 20.4568974,
  population: 1197714,
};

const NOVI_SAD: MapPlace = {
  id: 59735022,
  name: "Novi Sad",
  nameCyr: "Нови Сад",
  nameEn: "Novi Sad",
  kind: "city",
  lat: 45.2551338,
  lon: 19.8451756,
  population: 260438,
};

const NIS: MapPlace = {
  id: 100890898,
  name: "Niš",
  nameCyr: "Ниш",
  nameEn: "Niš",
  kind: "city",
  lat: 43.3211301,
  lon: 21.8959232,
  population: 178976,
};

const CACAK: MapPlace = {
  id: 254037025,
  name: "Čačak",
  nameCyr: "Чачак",
  nameEn: "Čačak",
  kind: "city",
  lat: 43.8914332,
  lon: 20.3491624,
  population: 69598,
};

const KRALJEVO: MapPlace = {
  id: 353439335,
  name: "Kraljevo",
  nameCyr: "Краљево",
  nameEn: "Kraljevo",
  kind: "city",
  lat: 43.7234519,
  lon: 20.6870792,
  population: 57432,
};

const GRDICA: MapPlace = {
  id: 1337495902,
  name: "Grdica",
  nameCyr: "Грдица",
  nameEn: "Grdica",
  kind: "village",
  lat: 43.7421658,
  lon: 20.6850358,
  population: 742,
};

const DEDINJE: MapPlace = {
  id: 2075053872,
  name: "Dedinje",
  nameCyr: "Дедиње",
  nameEn: "Dedinje",
  kind: "quarter",
  lat: 44.7752073,
  lon: 20.4592289,
  population: null,
};

const SENJAK: MapPlace = {
  id: 2075053881,
  name: "Senjak",
  nameCyr: "Сењак",
  nameEn: "Senjak",
  kind: "neighbourhood",
  lat: 44.7913302,
  lon: 20.4358707,
  population: null,
};

const PLACES: readonly MapPlace[] = [
  BEOGRAD,
  NOVI_SAD,
  NIS,
  CACAK,
  KRALJEVO,
  GRDICA,
  DEDINJE,
  SENJAK,
];

const INDEX = foldPlaces(PLACES);

/** The drawn names of a ranked list, in order - what the page shows. */
function names(query: string, limit = 10): readonly string[] {
  return rankPlaces(INDEX, query, limit).map((hit) => hit.place.name);
}

describe("the place ranking", () => {
  it("puts an exact match first, whatever else contains it", () => {
    // `cacak` is the fold of both `Čačak` and `Чачак`: one row, exact tier.
    expect(rankPlaces(INDEX, "cacak", 5)).toEqual([{ place: CACAK, tier: 0 }]);
    expect(rankPlaces(INDEX, "ČAČAK", 5)).toEqual([{ place: CACAK, tier: 0 }]);
    expect(rankPlaces(INDEX, "чачак", 5)).toEqual([{ place: CACAK, tier: 0 }]);
  });

  it("finds a place from a prefix, in either script", () => {
    expect(names("beo")).toEqual(["Beograd"]);
    expect(names("Краљ")).toEqual(["Kraljevo"]);
    // A PREFIX beats a containment, and `dinje` is the containment case: it is
    // inside `Dedinje` and starts no word and no name.
    expect(rankPlaces(INDEX, "ni", 5).map((hit) => [hit.place.name, hit.tier])).toEqual([
      ["Niš", 1],
    ]);
    expect(rankPlaces(INDEX, "dinje", 5).map((hit) => [hit.place.name, hit.tier])).toEqual([
      ["Dedinje", 3],
    ]);
  });

  it("ranks a word inside a name above a mere containment", () => {
    // `sad` is the SECOND word of `Novi Sad`: the name does not begin with it,
    // a word inside it does, and that is tier 2 - which is the tier the prefix
    // rules above cannot reach. (`novi`, by contrast, IS a prefix of the whole
    // name, so it ranks as tier 1: the tiers are about how much of the name was
    // typed, not about which word it was.)
    expect(rankPlaces(INDEX, "sad", 5).map((hit) => [hit.place.name, hit.tier])).toEqual([
      ["Novi Sad", 2],
    ]);
    expect(rankPlaces(INDEX, "novi", 5).map((hit) => [hit.place.name, hit.tier])).toEqual([
      ["Novi Sad", 1],
    ]);
  });

  it("matches a multi-term query whose every term is a word prefix", () => {
    expect(rankPlaces(INDEX, "novi sad", 5).map((hit) => [hit.place.name, hit.tier])).toEqual([
      ["Novi Sad", 0],
    ]);
    expect(names("novi s")).toEqual(["Novi Sad"]);
    // Both terms have to land: `novi grdica` matches nothing.
    expect(names("novi grdica")).toEqual([]);
  });

  it("answers nothing for an empty query rather than the whole index", () => {
    expect(rankPlaces(INDEX, "", 5)).toEqual([]);
    expect(rankPlaces(INDEX, "   ", 5)).toEqual([]);
    expect(rankPlaces(INDEX, "beo", 0)).toEqual([]);
  });

  it("breaks a tie by kind, then by population, then by the collator", () => {
    // Three rows of ONE name and two kinds, and the coordinates are arbitrary:
    // this case is about the order, not about where these places are.
    const tie: readonly MapPlace[] = [
      {
        id: 1,
        name: "Orašac",
        nameCyr: null,
        nameEn: null,
        kind: "village",
        lat: 44,
        lon: 20,
        population: 900,
      },
      {
        id: 2,
        name: "Orašac",
        nameCyr: null,
        nameEn: null,
        kind: "village",
        lat: 44.1,
        lon: 20.1,
        population: 1200,
      },
      {
        id: 3,
        name: "Orašac",
        nameCyr: null,
        nameEn: null,
        kind: "locality",
        lat: 44.2,
        lon: 20.2,
        population: null,
      },
    ];
    const hits = rankPlaces(foldPlaces(tie), "orašac", 5);
    // One kind first (village beats locality), then the bigger population, then
    // - the two villages being otherwise identical - the smaller id.
    expect(hits.map((hit) => hit.place.id)).toEqual([2, 1, 3]);
  });

  it("sorts equal rows by the Serbian collator, not by code point", () => {
    // Njegoševo and Nova Crnja are two real Vojvodina villages whose order
    // differs between the sr-Latn collator (where `Nj` is ONE letter, after `N`)
    // and a code-point sort (where `j` < `o`). The coordinates are arbitrary.
    const pair: readonly MapPlace[] = [
      {
        id: 10,
        name: "Njegoševo",
        nameCyr: null,
        nameEn: null,
        kind: "village",
        lat: 45.7,
        lon: 19.7,
        population: null,
      },
      {
        id: 11,
        name: "Nova Crnja",
        nameCyr: null,
        nameEn: null,
        kind: "village",
        lat: 45.6,
        lon: 20.6,
        population: null,
      },
    ];
    const collator = new Intl.Collator(["sr-Latn", "sr"]);
    expect(collator.compare("Njegoševo", "Nova Crnja")).toBeGreaterThan(0);
    expect(rankPlaces(foldPlaces(pair), "n", 5).map((hit) => hit.place.name)).toEqual([
      "Nova Crnja",
      "Njegoševo",
    ]);
  });

  it("caps the answer at the caller's limit", () => {
    expect(names("a", 2)).toHaveLength(2);
    expect(names("a", 1)).toHaveLength(1);
  });
});

describe("places.json", () => {
  it("reads a whole file and answers the rows", () => {
    const file = parsePlacesFile({
      version: 1,
      region: "serbia",
      places: [
        {
          id: 60571493,
          name: "Beograd",
          nameCyr: "Београд",
          nameEn: "Belgrade",
          kind: "city",
          lat: 44.8178131,
          lon: 20.4568974,
          population: 1197714,
        },
      ],
    });
    expect(file.region).toBe("serbia");
    expect(file.places).toEqual([BEOGRAD]);
  });

  it("takes a place with no Cyrillic form, no English form and no population", () => {
    const file = parsePlacesFile({
      version: 1,
      region: "serbia",
      places: [
        {
          id: 1,
          name: "Subotica",
          nameCyr: null,
          nameEn: null,
          kind: "city",
          lat: 46.1,
          lon: 19.667,
          population: null,
        },
      ],
    });
    expect(file.places[0]).toEqual({
      id: 1,
      name: "Subotica",
      nameCyr: null,
      nameEn: null,
      kind: "city",
      lat: 46.1,
      lon: 19.667,
      population: null,
    });
  });

  it("refuses a file this build cannot read, naming what is wrong", () => {
    const good = { version: 1, region: "serbia", places: [] };
    expect(() => parsePlacesFile({ ...good, version: 2 })).toThrow(/another version/);
    expect(() => parsePlacesFile({ ...good, region: "" })).toThrow(/"region"/);
    expect(() => parsePlacesFile({ ...good, places: {} })).toThrow(/"places" must be an array/);
    expect(() => parsePlacesFile([])).toThrow(/must be an object/);

    const row = {
      id: 1,
      name: "Beograd",
      nameCyr: null,
      nameEn: null,
      kind: "city",
      lat: 44.8,
      lon: 20.4,
      population: null,
    };
    const withRow = (change: Record<string, unknown>): unknown => ({
      ...good,
      places: [{ ...row, ...change }],
    });
    expect(() => parsePlacesFile(withRow({ id: 0 }))).toThrow(/positive integer/);
    expect(() => parsePlacesFile(withRow({ id: 1.5 }))).toThrow(/positive integer/);
    expect(() => parsePlacesFile(withRow({ kind: "castle" }))).toThrow(/not a place kind/);
    expect(() => parsePlacesFile(withRow({ name: "" }))).toThrow(/1\.\.120 characters/);
    expect(() => parsePlacesFile(withRow({ nameCyr: "x".repeat(121) }))).toThrow(/1\.\.120/);
    expect(() => parsePlacesFile(withRow({ lat: 91 }))).toThrow(/-90 and 90/);
    expect(() => parsePlacesFile(withRow({ lon: -181 }))).toThrow(/-180 and 180/);
    expect(() => parsePlacesFile(withRow({ lat: "44.8" }))).toThrow(/finite number/);
    expect(() => parsePlacesFile(withRow({ population: -1 }))).toThrow(/non-negative/);
    expect(() => parsePlacesFile(withRow({ population: 12.5 }))).toThrow(/whole number/);
  });
});

