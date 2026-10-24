import { describe, expect, it } from "vitest";

import type { MapPlace } from "@nexus/core";
import { SEARCH_START, answeredWith, askedFor, pickedPlace, shownResults, type SearchState } from "./searchState.js";

const PODGORICA: MapPlace = {
  id: 1,
  name: "Podgorica",
  nameCyr: "Подгорица",
  nameEn: "Podgorica",
  kind: "city",
  lat: 42.44,
  lon: 19.26,
  population: 150799,
};

const READY: SearchState = { ...SEARCH_START, status: "ready", count: 10 };

describe("the search box", () => {
  it("lists the places that answer the query, and an empty list when none does", () => {
    expect(shownResults(answeredWith(askedFor(READY, "podg"), [PODGORICA]))).toEqual([PODGORICA]);
    expect(shownResults(answeredWith(askedFor(READY, "xyz"), []))).toEqual([]);
  });

  it("lists nothing while the query is still being answered, rather than „No place matches“", () => {
    expect(shownResults(askedFor(READY, "podg"))).toBeNull();
  });

  it("lists nothing once a place is picked and the box holds its name", () => {
    const picked = pickedPlace(answeredWith(askedFor(READY, "Подгорица"), [PODGORICA]), "Podgorica");
    expect(picked.query).toBe("Podgorica");
    expect(shownResults(picked)).toBeNull();
  });

  it("lists nothing for an empty box, or while the index is read", () => {
    expect(shownResults(answeredWith(askedFor(READY, "  "), []))).toBeNull();
    expect(shownResults(answeredWith(askedFor(SEARCH_START, "podg"), []))).toEqual([]);
    expect(shownResults({ ...askedFor(SEARCH_START, "podg"), status: "loading" })).toBeNull();
  });
});
