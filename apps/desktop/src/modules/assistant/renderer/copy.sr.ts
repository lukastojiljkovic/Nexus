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
    /**
     * Šta se kaže kada se krug završi bez odgovora, po kodu koji je petlja
     * poslala (`packages/core/src/assistant/contract.ts`). Ključ je sam kod, pa
     * novi kod bez rečenice ne prolazi tipove; `aborted` je Zaustavi koji je
     * korisnik sam pritisnuo.
     */
    errors: {
      "no-model": "Nema modela koji može da odgovori.",
      "model-failed": "Model nije uspeo da odgovori.",
      "tool-failed": "Alatka nije uspela, pa je odgovor možda nepotpun.",
      "step-limit": "Odgovor je prekinut: krug je potrošio sve korake.",
      "context-full": "Odgovor je prekinut: kontekst je pun.",
      aborted: "Zaustavljeno.",
    },
    /**
     * Red o alatkama: šta je alatka radila i dokle je stigla. Naziv alatke je
     * adresa koju model izgovara (`tasks.create`), a ne reč kojom čovek čita
     * svoj račun, pa se svaka imenuje svojom radnjom.
     */
    tools: {
      /** Radnja svake alatke koju registar ima, pod imenom koje registar deklariše (`main/assistant/tools/*.ts`). */
      labels: {
        "app.open": "Otvaranje stranice",
        "app.modules": "Čitanje spiska modula",
        "app.search": "Pretraga aplikacije",
        "search.history": "Čitanje istorije pretrage",
        "search.forget": "Brisanje pretrage iz istorije",
        "search.rebuild": "Obnavljanje indeksa pretrage",
        "calculator.history": "Čitanje istorije kalkulatora",
        "calendar.create": "Dodavanje događaja",
        "calendar.events": "Čitanje događaja",
        "canvas.boards": "Čitanje tabli",
        "canvas.card": "Stavljanje predmeta na tablu",
        "canvas.create": "Pravljenje table",
        "canvas.delete": "Brisanje table",
        "canvas.draw": "Crtanje dijagrama",
        "canvas.rename": "Preimenovanje table",
        "canvas.visualize": "Crtanje beleške",
        "car.due": "Čitanje šta dospeva na automobilu",
        "car.fill": "Beleženje sipanja",
        "cookbook.recipe": "Čitanje recepta",
        "cookbook.search": "Pretraga recepata",
        "culture.plan": "Dodavanje plana",
        "culture.programme": "Čitanje programa",
        "dashboard.arrange": "Uređivanje kontrolne table",
        "dashboard.board": "Izmena table kontrolne table",
        "dashboard.boards": "Čitanje tabli kontrolne table",
        "dashboard.widgets": "Čitanje kontrolne table",
        "electronics.build": "Sastavljanje kola",
        "electronics.code": "Čitanje koda",
        "electronics.connect": "Povezivanje dva pina",
        "electronics.delete": "Brisanje kola",
        "electronics.disconnect": "Uklanjanje veze",
        "electronics.list": "Čitanje kola",
        "electronics.machine": "Čitanje mašine",
        "electronics.open": "Otvaranje kola",
        "electronics.parts": "Traženje dela",
        "electronics.place": "Dodavanje dela",
        "electronics.rename": "Preimenovanje kola",
        "electronics.simulate": "Simulacija kola",
        "electronics.unplace": "Uklanjanje dela",
        "emergency.card": "Čitanje kartice za hitne slučajeve",
        "habits.checkin": "Beleženje navike",
        "habits.today": "Čitanje današnjih navika",
        "lab.logs": "Čitanje dnevnika laboratorije",
        "lab.readings": "Čitanje očitavanja",
        "library.add": "Dodavanje u biblioteku",
        "library.shelf": "Čitanje biblioteke",
        "maps.pins": "Čitanje tačaka na mapi",
        "miniapps.kept": "Čitanje šta pamte mini aplikacije",
        "notes.append": "Dodavanje u belešku",
        "notes.categories": "Čitanje kategorija beleški",
        "notes.category": "Izmena kategorije beleške",
        "notes.checklist": "Pretvaranje liste u zadatke",
        "notes.create": "Dodavanje beleške",
        "notes.delete": "Brisanje beleške",
        "notes.duplicate": "Kopiranje beleške",
        "notes.flashcards": "Izbor špila za kartice beleške",
        "notes.folder": "Izmena fascikle",
        "notes.folders": "Čitanje fascikli",
        "notes.read": "Čitanje beleške",
        "notes.restore": "Vraćanje beleške",
        "notes.search": "Pretraga beležaka",
        "notes.tag": "Izmena oznake beleške",
        "notes.tags": "Čitanje oznaka",
        "notes.templates": "Čitanje šablona beleški",
        "notes.update": "Izmena beleške",
        "notes.versions": "Čitanje verzija beleške",
        "packs.list": "Čitanje instaliranih paketa",
        "pantry.add": "Dodavanje u ostavu",
        "pantry.expiring": "Čitanje šta ističe",
        "reader.progress": "Čitanje napretka čitanja",
        "recorder.list": "Čitanje snimaka",
        "tasks.complete": "Završavanje zadatka",
        "tasks.create": "Dodavanje zadatka",
        "tasks.list": "Čitanje zadataka",
        "tasks.reschedule": "Premeštanje zadatka",
        "timers.list": "Čitanje tajmera",
        "timers.start": "Pokretanje tajmera",
        "web.read": "Čitanje web stranice",
        "web.search": "Pretraga weba",
        "wiki.recent": "Čitanje istorije referenci",
      },
      /** Alatka kojoj se poziv više ne nalazi u razgovoru: imena nema, pa se imenuje ovako. */
      unnamed: "Alatka",
      /** Dokle je poziv stigao, jednom rečju. */
      states: {
        running: "u toku",
        done: "urađeno",
        failed: "nije urađeno",
      },
    },
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
    useForAnswers: "Koristi za odgovore",
    answersYourQuestions: "Odgovara na tvoja pitanja",
    useRecommended: "Koristi preporučeni model",
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
