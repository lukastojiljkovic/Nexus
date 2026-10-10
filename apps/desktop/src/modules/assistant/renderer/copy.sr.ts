/**
 * ASISTENT's own copy, in Serbian — the SHAPE every other locale of this module
 * is checked against (ADR-090).
 *
 * **Why this is not in `strings.ts`.** The shell's table is part of the startup
 * chunk and this module's page is not: copy that lived there would be paid for on
 * every launch, whether or not anybody ever opened the assistant. So the module
 * carries its own table, `copy.ts` registers it with the locale machinery the
 * moment this chunk loads, and from that moment a language switch rewrites these
 * leaves in place exactly as it rewrites the shell's.
 *
 * English is `copy.en.ts`, typed `typeof sr` — one compile error per sentence
 * left untranslated and one per key invented.
 *
 * No `as const`: the literal type of a sentence is not something either locale
 * should be pinned to.
 */
export const sr = {
  page: {
    subtitle: "Razgovor sa lokalnim modelom — bez interneta, sa tvojim podacima.",
    loading: "Učitavanje…",
  },
  rail: {
    title: "Razgovori",
    new: "Nova konverzacija",
    empty: "Još nema razgovora. Novi počinje prvim pitanjem.",
    rename: "Preimenuj",
    save: "Sačuvaj",
    cancel: "Otkaži",
    delete: "Obriši",
    models: "Modeli",
    confirmDeleteTitle: "Obriši razgovor",
    confirmDeleteBody:
      "Ovaj razgovor i sve njegove poruke se brišu. Vraćanje nije moguće.",
    confirmDelete: "Obriši",
  },
  thread: {
    emptyTitle: "Pitaj nešto",
    emptyBody:
      "Asistent poznaje tvoje beleške, zadatke, događaje i priručnik same aplikacije, i odgovara bez interneta. Izaberi razgovor ili napiši pitanje ispod.",
    thinking: "Razmišljam…",
    stopped: "Zaustavljeno.",
    tools: "Alatke",
  },
  composer: {
    placeholder: "Pitanje ili nalog",
    hint: "Enter šalje poruku, Shift+Enter prelazi u novi red.",
    send: "Pošalji",
    stop: "Zaustavi",
  },
  workflows: {
    title: "Recepti",
    hint: "Recept pokreće razgovor sa koracima koji su već sastavljeni. Svaki zapis i dalje traži potvrdu.",
  },
  confirm: {
    title: "Potvrda",
    question: "Alatka traži dozvolu pre nego što nastavi.",
    allow: "Dozvoli",
    deny: "Ne",
  },
  citations: {
    sources: "Izvori",
  },
  setup: {
    title: "Modeli",
    close: "Zatvori",
    intro:
      "Asistent radi na ovom računaru: model se preuzima jednom i posle radi bez interneta.",
    hardwareTitle: "Ovaj računar",
    ram: "Memorija",
    cpu: "Procesorske niti",
    gpu: "Grafička kartica",
    noGpu: "Bez grafičke kartice — model radi na procesoru.",
    picksTitle: "Preporuka za ovaj računar",
    unavailable: "Ponuda modela trenutno nije dostupna.",
    installed: "Instaliran",
    serves: "Služi",
    size: "Veličina",
    licence: "Licenca",
    download: "Preuzmi",
    stop: "Zaustavi",
    resume: "Nastavi",
    import: "Uvezi .gguf",
    remove: "Obriši",
    removeTitle: "Obriši model",
    removeBody:
      "Datoteka modela se briše sa ovog računara. Kasnije može ponovo da se preuzme.",
    removeConfirm: "Obriši",
    progress: "Preuzimanje",
    downloadFailed: "Preuzimanje nije uspelo.",
    downloadStopped: "Preuzimanje je zaustavljeno i može da se nastavi.",
    searchTitle: "Pretraga Hugging Face",
    searchPlaceholder: "npr. qwen2.5 7b instruct gguf",
    search: "Pretraži",
    searchEmpty: "Nema rezultata za taj upit.",
    searchHint:
      "Rezultat se preuzima samo u režimu mreže „Preuzimanja“, a svaka datoteka se proverava prema SHA-256 koji objavljuje Hugging Face.",
    needsDownloads:
      "Preuzimanje radi samo u režimu mreže „Preuzimanja“. Otvori Podešavanja, pa Privatnost, pa karticu „Mreža“.",
    openSettings: "Otvori podešavanja",
    installedTitle: "Instalirani modeli",
    noModel: "Još nema instaliranog modela.",
    tierIntelligence: "Inteligencija",
    tierBalance: "Ravnoteža",
    tierSpeed: "Brzina",
  },
  knowledge: {
    indexed: "Indeksirano odlomaka",
    pending: "Izvora čeka",
    embedder: "Model za vektore",
    noEmbedder: "Bez modela za vektore — pretraga radi samo po tekstu.",
    rebuild: "Obnovi indeks",
  },
  web: {
    sentence:
      "Kada je pretraga weba uključena, asistent šalje tvoj upit provajderu koji alatka navede. Ništa drugo ne napušta ovaj računar.",
    modeBlocked:
      "Režim mreže trenutno ne dozvoljava nijednu vezu, pa pretraga weba ne radi.",
  },
  settings: {
    hint: "Asistent radi bez interneta osim pretrage weba, koja je isključena dok je ne uključiš.",
    saved: "Sačuvano.",
  },
  errors: {
    load: "Asistent nije učitan.",
    action: "Izmena nije sačuvana.",
    send: "Poruka nije poslata.",
  },
};
