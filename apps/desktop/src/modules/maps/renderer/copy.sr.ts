/**
 * MAPS' own copy, in Serbian — the SHAPE every other locale of this module is
 * checked against (ADR-090).
 *
 * **Why this is not in `strings.ts`.** The shell's table is part of the startup
 * chunk, and this module's page is not: a module that put its page copy there
 * would pay for it on every launch, whether or not anybody ever opened a map.
 * So the module carries its own table, `copy.ts` registers it with the locale
 * machinery the moment this chunk loads, and from that moment switching language
 * rewrites these leaves in place exactly as it rewrites the shell's.
 *
 * English is `copy.en.ts`, typed `typeof sr` — one compile error per sentence
 * left untranslated and one per key invented.
 *
 * **No sentence here uses a gendered past tense.** Serbian has no genderless
 * one (`check:address` exists because of that), and this page addresses the
 * reader directly: „Spusti tačku", not „Spustio si tačku".
 */
import type { MapPlaceKind } from "@nexus/core";

import type { RegionProblem } from "../shared/ipc.js";
import type { Continent } from "./regions/names.js";

export const sr = {
  page: {
    subtitle:
      "Mapa koja radi bez interneta — preuzmi teritoriju, kontinent ili ceo svet, pa traži mesta, spuštaj tačke i meri razdaljine.",
    loading: "Učitavanje mape…",
  },
  search: {
    label: "Pretraga mesta",
    placeholder: "npr. Čačak, Novi Sad…",
    empty: "Nema mesta koja odgovaraju.",
    results: "Rezultati pretrage",
    loading: "Priprema indeksa mesta…",
    none: "Pretraga obuhvata preuzete mape, a nijedna još nije preuzeta.",
    failed: "Indeks mesta nije pročitan, pa pretraga ne radi.",
    kinds: {
      country: "Država",
      state: "Savezna jedinica",
      region: "Region",
      province: "Pokrajina",
      district: "Distrikt",
      county: "Okrug",
      municipality: "Opština",
      city: "Grad",
      town: "Gradić",
      village: "Selo",
      suburb: "Predgrađe",
      quarter: "Četvrt",
      neighbourhood: "Kvart",
      hamlet: "Zaselak",
      isolated_dwelling: "Usamljeno imanje",
      farm: "Farma",
      locality: "Lokalitet",
      island: "Ostrvo",
    } satisfies Record<MapPlaceKind, string>,
  },
  picker: {
    hint: "Klikni na teritoriju da preuzmeš, ažuriraš ili ukloniš njenu mapu.",
    empty: "Nijedna mapa još nije preuzeta. Klikni na teritoriju da je preuzmeš.",
  },
  tools: {
    zoomIn: "Uvećaj",
    zoomOut: "Umanji",
    newPin: "Nova tačka",
    here: "Ovde sam",
    clearLocation: "Ukloni moju poziciju",
    measure: "Merenje",
    stopMeasure: "Prekini merenje",
    clearMeasure: "Obriši merenje",
    copy: "Kopiraj koordinate",
    copied: "Kopirano.",
    copyFailed: "Kopiranje nije uspelo.",
    pins: "Spisak tačaka",
    scale: "Razmernik",
    regions: "Preuzimanje mapa",
  },
  pins: {
    title: "Tačke",
    emptyTitle: "Nema tačaka",
    emptyBody: "Tačka čuva naziv, belešku i boju i ostaje na mapi. Spusti prvu dugmetom „Nova tačka“.",
    edit: "Izmeni",
    remove: "Obriši",
    hide: "Sakrij spisak",
    noteEmpty: "Bez beleške",
    pickHint: "Izaberi tačku da vidiš njenu belešku i izmeniš je.",
    detailLabel: "Izabrana tačka",
    back: "Sve tačke",
    measureHint: "Klikni na mapu da dodaš tačku merenja.",
    distance: "Razdaljina",
  },
  dialog: {
    createTitle: "Nova tačka",
    editTitle: "Izmeni tačku",
    title: "Naziv",
    note: "Beleška",
    noteHint: "Nije obavezno, najviše 2000 znakova.",
    color: "Boja",
    coordinates: "Koordinate",
    dms: "Stepeni, minuti, sekunde",
    atCentre: "Tačka se postavlja na centar mape — prvo pomeri mapu na mesto koje želiš.",
    save: "Sačuvaj",
    cancel: "Otkaži",
    titleRequired: "Naziv je obavezan i može imati najviše 120 znakova.",
    noteTooLong: "Beleška može imati najviše 2000 znakova.",
  },
  colors: {
    zlato: "Zlatna",
    bronza: "Bronzana",
    maslina: "Maslinasta",
    suma: "Šumska",
    zad: "Žad",
    ruza: "Ružina",
    bordo: "Bordo",
    grafit: "Grafitna",
  },
  attribution: {
    credit: "© OpenStreetMap contributors",
    licence: "Podaci pod licencom ODbL — https://www.openstreetmap.org/copyright",
    label: "Izvor podataka",
  },
  errors: {
    load: "Tačke nisu učitane.",
    mutate: "Izmena nije sačuvana.",
    regions: "Spisak preuzetih mapa nije učitan.",
  },
  regions: {
    close: "Zatvori karticu",
    scope: "Šta se preuzima",
    world: "Ceo svet",
    continents: {
      Africa: "Afrika",
      Antarctica: "Antarktik",
      Asia: "Azija",
      Europe: "Evropa",
      "North America": "Severna Amerika",
      Oceania: "Okeanija",
      "Seven seas (open ocean)": "Otvoreno more",
      "South America": "Južna Amerika",
    } satisfies Record<Continent, string>,
    detail: "Detaljnost",
    details: {
      overview: "Pregled",
      towns: "Naselja i putevi",
      full: "Puna detaljnost",
    },
    detailHints: {
      overview: "Gradovi i glavni putevi. Najmanja datoteka.",
      towns: "Gradovi, sela i većina puteva.",
      full: "Ulice i zgrade. Najveća datoteka.",
    },
    notInstalled: "Mapa nije preuzeta.",
    installed: "Preuzeto: {detail}, {size}, podaci od {date}.",
    update: "Dostupni su noviji podaci, od {date}.",
    preparing: "Priprema se preuzimanje…",
    downloading: "Preuzima se: {received} od {total}.",
    paused: "Pauzirano: {received} od {total}.",
    failed: "Preuzimanje je stalo.",
    otherBusy: "Preuzima se druga mapa: {name}.",
    measuring: "Računa se veličina…",
    download: "Preuzmi ({size})",
    updateAction: "Ažuriraj ({size})",
    replace: "Zameni ({size})",
    show: "Prikaži na mapi",
    remove: "Ukloni",
    pause: "Pauziraj",
    resume: "Nastavi",
    cancel: "Otkaži preuzimanje",
    removeTitle: "Ukloniti mapu?",
    removeBody: "Mapa „{name}“ ({size}) se briše sa diska. Može se ponovo preuzeti.",
    problems: {
      mode: "Preuzimanje radi samo u mrežnom režimu Preuzimanja. Promeni režim u Podešavanjima.",
      url: "Ova adresa nije dozvoljena u ovom pokretanju.",
      network: "Server sa mapama nije dostupan. Proveri vezu i pokušaj ponovo.",
      "build-changed": "Podaci na serveru su se promenili tokom preuzimanja. Pokreni ga ponovo.",
      hash: "Preuzeta datoteka nije prošla proveru i obrisana je.",
      "no-build": "Server ne nudi mapu koju ova verzija Nexusa može da prikaže.",
      "too-large": "Region je prevelik za ovu detaljnost. Izaberi manju detaljnost ili manji region.",
      "no-space": "Na disku nema dovoljno mesta za ovu mapu.",
      io: "Mapa nije mogla da se zapiše na disk.",
      busy: "Već se preuzima druga mapa.",
      region: "Ovaj region nije na spisku mape.",
    } satisfies Record<RegionProblem, string>,
  },
};
