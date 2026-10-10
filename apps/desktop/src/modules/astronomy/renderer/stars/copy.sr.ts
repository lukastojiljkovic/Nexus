/**
 * The star map's own copy, in Serbian - the SHAPE `copy.en.ts` is checked
 * against.
 *
 * **Why the map carries its own table rather than the module's.** The
 * astronomy module's page is assembled around this component by a later run, so
 * its `renderer/copy.sr.ts` is the page's; the star map is a piece of the page
 * that knows its own words, registers them with the locale machinery when its
 * chunk loads (`copy.ts`), and can be dropped into another surface without
 * dragging the page's table with it.
 *
 * No quote marks anywhere in the copy: the search field's results are a list,
 * and a sentence with a quotation in it would need the pair this app's
 * `check:quotes` gate exists to police.
 */
export const sr = {
  canvas: {
    label: "Zvezdana karta za izabrano mesto i trenutak.",
    hint: "Prevuci da pomeriš kartu, a točkićem zumiraš. Strelice pomeraju, plus i minus zumiraju.",
  },
  search: {
    label: "Nađi zvezdu ili sazvežđe",
    noResults: "Nema tog imena na karti.",
    belowHorizon: "ispod horizonta",
    star: "zvezda",
    constellation: "sazvežđe",
    reset: "Centriraj na zenit",
  },
  body: {
    sun: "Sunce",
    moon: "Mesec",
    mercury: "Merkur",
    venus: "Venera",
    earth: "Zemlja",
    mars: "Mars",
    jupiter: "Jupiter",
    saturn: "Saturn",
    uranus: "Uran",
    neptune: "Neptun",
    pluto: "Pluton",
  },
  cardinal: {
    north: "S",
    east: "I",
    south: "J",
    west: "Z",
  },
};
