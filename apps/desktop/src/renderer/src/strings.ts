/**
 * Every user-facing string in the desktop renderer, in Serbian (launch language,
 * founder decision #2). Centralized so the later i18n extraction is a mechanical
 * move of this table into the i18n layer — no framework yet, by design.
 */
export const strings = {
  app: {
    brand: "Nexus",
    navLabel: "Glavna navigacija",
    themeToggle: "Promeni temu",
    themeDan: "Dan",
    themeNoc: "Noć",
    loading: "Učitavanje…",
    loadErrorTitle: "Pokretanje nije uspelo",
    loadErrorDescription:
      "Veza sa lokalnom bazom podataka nije uspostavljena. Zatvori aplikaciju i pokreni je ponovo.",
  },

  onboarding: {
    title: "Tvoj Nexus",
    description:
      "Nexus radi potpuno lokalno — svi podaci ostaju na ovom uređaju. Upiši ime profila i izaberi temu; sve ostalo podešavaš kasnije.",
    nameLabel: "Ime profila",
    namePlaceholder: "Upiši ime",
    themeLabel: "Tema",
    cta: "Kreni",
    saveError: "Čuvanje nije uspelo. Pokušaj ponovo.",
  },

  /** Display names for registered modules, keyed by module id. */
  modules: {
    dashboard: "Kontrolna tabla",
    tasks: "Zadaci",
    calendar: "Kalendar",
    settings: "Podešavanja",
    notes: "Beleške",
    study: "Učenje",
  } as Record<string, string>,

  dashboard: {
    emptyTitle: "Kontrolna tabla",
    emptyDescription:
      "Vidžeti stižu sa prvim modulima — zadaci, kalendar i plan učenja pojaviće se ovde čim budu spremni.",
  },

  modulePlaceholder: {
    description:
      "Ovaj modul stiže tokom v0 izgradnje. Navigacija je već spremna — sadržaj sledi.",
  },

  diagnostics: {
    title: "Stanje sistema",
    version: "Verzija",
    electron: "Electron",
    chromium: "Chromium",
    node: "Node",
    database: "Baza podataka",
  },
} as const;
