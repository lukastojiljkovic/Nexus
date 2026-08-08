/**
 * Every user-facing word this shell says, in one table.
 *
 * The desktop has the real copy layer (`apps/desktop/src/renderer/src/strings.ts`
 * — one object whose leaves are overwritten in place when the locale changes, so
 * that ~1,570 call sites never have to know). This table is deliberately NOT an
 * import of it: that one pulls in the 7,000-line Serbian table and five
 * preference modules, none of which this shell has a page for yet, and none of
 * which would be proving anything about portability.
 *
 * It is written in that table's shape so the fold-in is mechanical: no `as
 * const` (leaves must stay writable for a locale swap to work), plain nesting,
 * one section per surface. When the shells unify, this file's contents move
 * under `strings.sr.ts` and this module disappears — the call sites do not
 * change, because they already read `strings.x.y`.
 *
 * `modules` repeats fourteen labels the desktop table also has. That repetition
 * is the one thing here worth watching, and it is words rather than logic: if
 * a module is ever renamed, this is the second place to change. It exists only
 * until the fold-in removes it.
 */
export const strings = {
  app: {
    name: "Nexus",
    /** The brand glyph. The same mark the active nav row carries. */
    glyph: "✦",
  },

  shell: {
    title: "Nexus na vebu",
    subtitle: "Isti interfejs kao na računaru. Podaci stižu kada sinhronizacija proradi.",
    /** The rail's own heading, for screen readers — the rail has no visible title. */
    navLabel: "Moduli",
    themeLabel: "Tema",
    themeOptions: {
      system: "Sistem",
      dan: "Dan",
      noc: "Noć",
    },
  },

  modules: {
    dashboard: "Kontrolna tabla",
    tasks: "Zadaci",
    calendar: "Kalendar",
    notes: "Beleške",
    study: "Učenje",
    focus: "Fokus",
    files: "Datoteke",
    finance: "Finansije",
    habits: "Navike",
    fitness: "Fitnes",
    canvas: "Tabla",
    tools: "Alatke",
    priv: "Privatno",
    settings: "Podešavanja",
  },

  /** The card that demonstrates the seam by calling it and showing what comes back. */
  seam: {
    title: "Veza sa podacima",
    description:
      "Ova ljuska koristi isti ugovor kao aplikacija na računaru. Svaki poziv postoji, " +
      "ali još nema ko da odgovori na njega — zato svaki od njih odbija poziv umesto da " +
      "vrati prazno.",
    action: "Probaj: učitaj profile",
    /** Prefixes whatever the call threw, so the reader sees that the refusal is the answer. */
    resultLabel: "Odgovor",
    unexpected: "Neočekivana greška — ovo nije odbijanje ugovora.",
  },

  page: {
    emptyTitle: "Ovde još nema ničega",
    emptyDescription:
      "Moduli se sele sa računara na veb jedan po jedan. Ova strana pokazuje ljusku, " +
      "teme i komponente — ne i sadržaj.",
  },

  api: {
    /**
     * What every `NexusApi` method throws in the web build. Written as a
     * sentence a user could read, not as a developer's marker: an error that
     * escapes to an error boundary is copy whether it was meant to be or not.
     */
    notConnected: "Nexus na vebu još nije povezan sa vašim podacima.",
  },
};
