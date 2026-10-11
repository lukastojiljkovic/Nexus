/**
 * BIBLIOTEKA's own copy, in Serbian - the SHAPE every other locale of this
 * module is checked against (ADR-090).
 *
 * **Why this is not in `strings.ts`.** The shell's table is part of the startup
 * chunk and this module's page is not: a module that put its page copy there
 * would pay for it on every launch, whether or not anybody ever opened a book.
 * `copy.ts` registers this table with the locale machinery the moment this chunk
 * loads, and from that moment switching language rewrites these leaves in place
 * exactly as it rewrites the shell's.
 *
 * English is `copy.en.ts`, typed `typeof sr` - one compile error per sentence
 * left untranslated and one per key invented. No `as const`, for the reason
 * `Tajmeri`'s own table gives.
 *
 * Two tables here are read with a COMPUTED key (`kinds[item.kind]`,
 * `statuses[item.status]`), because a closed vocabulary is exactly what an index
 * is for: the compiler checks that every member has a word, and `check:copy`
 * counts the whole subtree as read because the code that indexes it knows the
 * vocabulary's boundary.
 */
export const sr = {
  page: {
    subtitle: "Knjige, filmovi i serije - šta je na listi želja, šta je u toku i šta je završeno.",
    loading: "Učitavanje…",
  },
  kinds: {
    book: "Knjiga",
    film: "Film",
    series: "Serija",
  },
  statuses: {
    planned: "Želim",
    "in-progress": "U toku",
    done: "Završeno",
    dropped: "Napušteno",
  },
  units: {
    pages: "str.",
    episodes: "ep.",
  },
  add: {
    heading: "Brzi unos",
    titleLabel: "Naslov",
    titlePlaceholder: "npr. Na Drini ćuprija",
    kindLabel: "Vrsta",
    submit: "Dodaj",
    hint: "Za početak je dovoljan naslov - napredak, ocenu i utiske dopisuješ kasnije.",
  },
  filters: {
    searchLabel: "Pretraga",
    searchPlaceholder: "Naslov, autor, oznaka",
    kindLabel: "Vrsta",
    kindAny: "Sve vrste",
    statusLabel: "Status",
    statusAny: "Svi statusi",
    sortLabel: "Poređaj",
    sortActivity: "Po aktivnosti",
    sortTitle: "Po naslovu",
    sortYear: "Po godini",
    sortRating: "Po oceni",
  },
  list: {
    heading: "Na polici",
    totalLabel: "ukupno",
    emptyTitle: "Biblioteka je prazna",
    emptyBody:
      "Ovde stoji sve što čitaš i gledaš. Dodaj prvi naslov - knjigu, film ili seriju - pa mu dopiši napredak i utiske.",
    noneTitle: "Nema rezultata",
    noneBody: "Nijedan naslov ne odgovara pretrazi i filtrima. Obriši pretragu ili vrati filtere na „sve“.",
    startedOn: "Početo",
    finishedOn: "Završeno",
  },
  detail: {
    heading: "Naslov",
    editHeading: "Podaci o naslovu",
    titleLabel: "Naslov",
    originalTitleLabel: "Originalni naslov",
    creatorsLabel: "Autori, reditelji, tvorci",
    creatorsHint: "Odvoji zarezom. Redosled ostaje kako je napisan.",
    yearLabel: "Godina",
    statusLabel: "Status",
    ratingLabel: "Ocena",
    ratingNone: "Bez ocene",
    pagesReadLabel: "Pročitano strana",
    pagesTotalLabel: "Ukupno strana",
    seasonLabel: "Sezona",
    episodeLabel: "Epizoda",
    seasonsTotalLabel: "Ukupno sezona",
    episodesTotalLabel: "Ukupno epizoda",
    tagsLabel: "Oznake",
    tagsHint: "Odvoji zarezom, najviše 20 oznaka.",
    summaryLabel: "Kratak opis",
    save: "Sačuvaj izmene",
    reset: "Vrati na sačuvano",
    delete: "Obriši naslov",
    close: "Zatvori",
  },
  passes: {
    heading: "Čitanja i gledanja",
    caption: "Jedan red je jedno čitanje ili gledanje. Najnoviji određuje status i ocenu naslova.",
    empty: "Još nema zabeleženog čitanja ili gledanja.",
    startedLabel: "Početo",
    finishedLabel: "Završeno",
    ratingLabel: "Ocena",
    add: "Zabeleži",
    remove: "Obriši",
  },
  thoughts: {
    heading: "Utisci",
    caption: "Beleške o naslovu, onim redom kojim su nastale.",
    empty: "Još nema utisaka.",
    dateLabel: "Datum",
    textLabel: "Utisak",
    textPlaceholder: "Å ta ti je ostalo posle ovog naslova…",
    add: "Dodaj utisak",
    save: "Sačuvaj",
    edit: "Uredi",
    remove: "Obriši",
    cancel: "Otkaži",
  },
  collections: {
    heading: "Zbirke",
    caption: "Tvoje liste, svojim redom. Jedan naslov može biti u više zbirki.",
    nameLabel: "Naziv zbirke",
    namePlaceholder: "npr. Letnje čitanje",
    descriptionLabel: "Opis",
    create: "Napravi zbirku",
    empty: "Još nema zbirki. Napravi prvu - recimo „Za čitanje na odmoru“ - pa u nju dodaj naslove iz liste.",
    open: "Prikaži naslove",
    close: "Sakrij naslove",
    rename: "Preimenuj",
    save: "Sačuvaj",
    cancel: "Otkaži",
    remove: "Obriši zbirku",
    removeItem: "Ukloni iz zbirke",
    moveUp: "Pomeri gore",
    moveDown: "Pomeri dole",
    itemMissing: "Naslov više nije u biblioteci.",
  },
  suggestions: {
    heading: "Predložene zbirke",
    caption: "Liste iz instaliranih paketa. Preuzimanjem se kopiraju u tvoje zbirke; naslovi koje već imaš se ne dupliraju.",
    empty: "Nijedan instalirani paket ne nosi predložene zbirke.",
    small: "Mala zbirka",
    view: "Prikaži šta sadrži",
    hide: "Sakrij",
    adopt: "Preuzmi",
    adopted: "Preuzeto",
    itemsLabel: "naslova",
    sourceLabel: "Izvor",
    licenceLabel: "Licenca",
    yearUnknown: "godina nepoznata",
  },
  undo: {
    item: "Naslov je obrisan.",
    collection: "Zbirka je obrisana.",
    action: "Vrati",
    dismiss: "Odbaci",
  },
  errors: {
    load: "Biblioteku nije moguće učitati.",
    mutate: "Izmena nije sačuvana. Pokušaj ponovo.",
    suggestion: "Zbirka iz paketa nije preuzeta.",
    title: "Naslov je obavezan i može imati najviše 300 znakova.",
    number: "Polja sa brojevima primaju samo cele brojeve iz dozvoljenog opsega.",
    thought: "Utisak je obavezan i može imati najviše 4000 znakova.",
    collectionName: "Naziv zbirke je obavezan i može imati najviše 120 znakova.",
  },
  widget: {
    empty: "Ništa se trenutno ne čita ni ne gleda.",
    loading: "Učitavanje…",
    loadError: "Trenutna čitanja nije moguće učitati.",
  },
};
