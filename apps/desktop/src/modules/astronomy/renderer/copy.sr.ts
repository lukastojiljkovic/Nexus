/**
 * The astronomy corner's page copy, in Serbian — the SHAPE `copy.en.ts` is
 * checked against.
 *
 * **Why the page carries a table of its own.** The four views each bring their
 * own words (`earth/copy.ts`, `stars/copy.ts`, `sunmoon/copy.ts`) and register
 * them under their own names; this file is what the PAGE draws around them —
 * the tabs, the shared clock, the scale switch, the attribution line and the
 * settings card's caption. It registers under `astronomy` (`copy.ts`), which is
 * the module's own id and therefore the one table nobody else may take.
 *
 * **Every number in a sentence is a slot.** `{body}`, `{distance}`, `{when}` and
 * `{pack}` are written by `fill` at the call site, so a translation may move a
 * value within its sentence rather than having to reconstruct the sentence
 * around it.
 */
export const sr = {
  page: {
    subtitle:
      "Sunčev sistem, dan i noć na Zemlji, nebo večeras i Sunce i Mesec za jedno mesto — sve za isti trenutak.",
  },
  tabs: {
    solar: "Sunčev sistem",
    earth: "Dan i noć",
    stars: "Nebo večeras",
    sunmoon: "Sunce i Mesec",
  },
  clock: {
    label: "Trenutak prikaza",
    now: "Sada",
    hint: "Uvek možeš da se vratiš na sadašnji trenutak dugmetom Sada.",
    bad: "Trenutak mora biti datum i vreme, na primer 2026-10-10T20:30.",
  },
  solar: {
    scaleLabel: "Razmera",
    scaleTrue: "Prava",
    scaleReadable: "Čitljiva",
    scaleTrueHint:
      "Prava razmera: tela su na stvarnim mestima i u stvarnoj veličini, pa je Zemlja ovde manja od piksela.",
    scaleReadableHint:
      "Čitljiva razmera: rastojanja su sabijena, a tela uvećana. Redosled i pravac ostaju tačni.",
    selectHint: "Izaberi telo klikom na njega ili na njegovo ime.",
    selected: "{body} — {distance} au od Zemlje",
  },
  textures: {
    credits: "Teksture:",
    missing:
      "Fotografije tela dodaje paket „planet-textures“ — instaliraj ga u Podešavanjima, na kartici „Paketi sadržaja“.",
  },
  stars: {
    normal: "Normalno",
    nightLabel: "Crvena svetlost",
    nightHint:
      "Karta se crta jednom crvenom bojom na najtamnijoj površini, da oči prilagođene mraku ostanu takve.",
    needPlace: "Izaberi mesto da bi se karta neba nacrtala.",
  },
  settings: {
    caption: "Mesto za koje se crtaju karta neba i Sunce i Mesec.",
    hint: "Bez izabranog mesta koristi se grad iz zone ovog računara.",
    reset: "Vrati na zonu računara",
  },
};
