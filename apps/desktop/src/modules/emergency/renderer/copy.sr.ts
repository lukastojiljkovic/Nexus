/**
 * EMERGENCY's own page copy, in Serbian - the SHAPE every other locale of this
 * module is checked against (ADR-090).
 *
 * **The card's headings are NOT here, and that is the one thing to know about
 * this table.** `shared/cardText.ts` holds them, in both languages at once,
 * because the card prints in whichever languages the user chose and therefore
 * cannot have "the current language" for a heading. This table is what the
 * interface says: the labels of the form, the actions on the card, the sentences
 * an empty state and an error use.
 *
 * English is `copy.en.ts`, typed `typeof sr` - one compile error per sentence left
 * untranslated and one per key invented.
 */
export const sr = {
  page: {
    // The header's own title is the module's name, which the shell draws from
    // the manifest; this is the line under it.
    subtitle: "Podaci za onog ko čita karticu umesto tebe.",
    loading: "Učitavanje…",
  },
  card: {
    edit: "Uredi karticu",
    printA6: "Štampaj A6",
    printCardOnA4: "Štampaj karticu na A4",
    printHint: "A6 je list za frižider; kartica na A4 je veličine platne kartice.",
    remove: "Obriši karticu",
    removeQuestion: "Kartica se sklanja sa stranice. Da li da je obrišem?",
    removeNote: "Kartica prestaje da se prikazuje, a njeni podaci ostaju sačuvani u profilu.",
    confirmRemove: "Obriši",
    cancelRemove: "Otkaži",
    printSaved: "Kartica je sačuvana.",
  },
  empty: {
    title: "Kartica još nije napravljena",
    body: "Upiši krvnu grupu, alergije i broj osobe koju treba pozvati. Kartica se štampa i staje u novčanik.",
  },
  gaps: {
    title: "Pre štampanja",
    bloodType: "Krvna grupa nije upisana.",
    allergies: "Nije odgovoreno da li ima alergija.",
    contacts: "Nema nijednog kontakta koga bi neko pozvao.",
    complete: "Kartica ima sve što lekar traži prvo.",
  },
  form: {
    title: "Podaci na kartici",
    intro: "Sve što upišeš stoji na kartici onako kako je upisano.",
    fullName: "Ime i prezime",
    dateOfBirth: "Datum rođenja",
    bloodType: "Krvna grupa",
    bloodTypeUnanswered: "Nije upisano",
    allergies: "Alergije",
    allergiesNone: "Nemam alergije",
    allergyLabel: "Alergen",
    allergySeverity: "Težina reakcije",
    severityUnanswered: "Nije navedena",
    addAllergy: "Dodaj alergiju",
    conditions: "Stanja",
    conditionsNone: "Nemam hronična stanja",
    addCondition: "Dodaj stanje",
    medications: "Lekovi",
    medicationsNone: "Ne uzimam lekove",
    medicationName: "Lek",
    medicationDose: "Kako se uzima",
    addMedication: "Dodaj lek",
    organDonor: "Donor organa",
    organDonorUnanswered: "Nije upisano",
    insurance: "Broj zdravstvenog osiguranja",
    doctorName: "Izabrani lekar",
    doctorPhone: "Telefon lekara",
    notes: "Napomene",
    printLanguage: "Jezik na kartici",
    printSr: "Srpski",
    printEn: "Engleski",
    printBoth: "Oba jezika",
    save: "Sačuvaj",
    cancel: "Otkaži",
    create: "Napravi karticu",
    removeRow: "Obriši red",
    problemDate: "Datum rođenja mora biti stvarni dan i ne može biti u budućnosti.",
    problemName: "Ime može imati najviše 120 znakova.",
  },
  contacts: {
    title: "Kontakti za hitne slučajeve",
    empty: "Još nema kontakata. Dodaj osobu i broj telefona.",
    person: "Osoba iz imenika",
    personNone: "Unesi ime ručno",
    name: "Ime",
    phone: "Telefon",
    relation: "Odnos",
    problem: "Izaberi osobu iz imenika ili upiši ime.",
    add: "Dodaj kontakt",
    edit: "Izmeni",
    save: "Sačuvaj",
    cancel: "Otkaži",
    remove: "Obriši",
    moveUp: "Pomeri gore",
    moveDown: "Pomeri dole",
  },
  errors: {
    load: "Karticu nije moguće učitati.",
    mutate: "Izmena nije sačuvana.",
    print: "Karticu nije moguće sačuvati kao PDF.",
  },
  widget: {
    empty: "Kartica još nije popunjena.",
    loading: "Učitavanje…",
    loadError: "Karticu nije moguće učitati.",
  },
};
