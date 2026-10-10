/**
 * The RECORDER's own copy, in Serbian — the SHAPE every other locale of this
 * module is checked against (ADR-090).
 *
 * `copy.en.ts` is typed `typeof sr`, so a sentence left untranslated or a key
 * invented is one compile error each. The register is the app's own Serbian:
 * sentence case, no exclamation marks, and no word promising more than the code
 * does — „preostalo" is a measurement, not a guess.
 */
export const sr = {
  page: {
    // The page's own name is the module's declared name (`manifest.copy.name`),
    // which the shell already draws; this is the line under it.
    subtitle: "Glasovni i video dnevnik — snimi, pa preslušaj kada ti treba.",
    loading: "Učitavanje…",
  },
  capture: {
    title: "Snimanje",
    kindLabel: "Šta snimaš",
    kindAudio: "Zvuk",
    kindVideo: "Kamera",
    deviceLabel: "Uređaj",
    deviceDefault: "Podrazumevani uređaj",
    levelLabel: "Nivo zvuka",
    start: "Snimi",
    pause: "Pauza",
    resume: "Nastavi",
    stop: "Zaustavi",
    discard: "Odbaci",
    elapsedLabel: "Snimljeno",
    remainingLabel: "Preostalo još",
    countdown: "Snimanje počinje…",
    unsupportedAudio: "Ovaj računar ne može da snimi zvuk u formatu koji Nexus čuva.",
    unsupportedVideo:
      "Ovaj računar ne može da snimi video u formatu koji Nexus čuva.",
    permissionDenied:
      "Nexus nema pristup mikrofonu ili kameri. Otvori Podešavanja → Privatnost i bezbednost → Mikrofon (i Kamera) i dozvoli pristup aplikacijama, pa pokušaj ponovo.",
    saveFailed: "Snimak nije sačuvan. Proveri slobodan prostor i pokušaj ponovo.",
  },
  list: {
    title: "Snimci",
    searchLabel: "Pretraga",
    searchPlaceholder: "Naslov, oznaka ili beleška",
    tagLabel: "Oznaka",
    tagAll: "Sve oznake",
    emptyTitle: "Još nema snimaka",
    emptyBody:
      "Snimi prvi zapis — glasovnu belešku ili kratak video — pa mu posle daj naslov i oznake.",
    noResults: "Nijedan snimak ne odgovara pretrazi.",
    play: "Pusti",
    hide: "Sakrij",
    edit: "Izmeni",
    remove: "Obriši",
    deletedNotice: "Snimak je obrisan.",
    undo: "Vrati",
    dismiss: "Zatvori",
  },
  form: {
    editTitle: "Izmena snimka",
    titleLabel: "Naslov",
    titlePlaceholder: "Ostavi prazno za datum i vreme",
    diaryLabel: "Upiši u dnevnik",
    dateLabel: "Datum",
    tagsLabel: "Oznake",
    tagsPlaceholder: "glas, napolju",
    tagsHint: "Oznake se razdvajaju zarezom.",
    notesLabel: "Beleška",
    notesPlaceholder: "Šta je na snimku",
    save: "Sačuvaj",
    cancel: "Otkaži",
  },
  stats: {
    recordings: "Snimaka",
    audio: "Zvuk",
    video: "Video",
    limitLabel: "Najveći pojedinačni snimak",
  },
  errors: {
    load: "Nije moguće učitati snimke.",
    mutate: "Izmena nije sačuvana.",
    tags: "Previše oznaka — skrati spisak.",
    date: "Izaberi datum za upis u dnevnik.",
  },
  settings: {
    caption: "Odbrojavanje od tri sekunde pre svakog snimanja.",
    hint: "Ostavlja ti vreme da odložiš uređaj pre nego što snimanje počne.",
    saved: "Sačuvano.",
    loadError: "Nije moguće učitati podešavanje.",
    saveError: "Podešavanje nije sačuvano.",
  },
  widget: {
    empty: "Još nema snimaka.",
    loading: "Učitavanje…",
    loadError: "Nije moguće učitati snimke.",
  },
};
