/**
 * „Stručne alatke" — the professional drawer's own copy: its chrome, the words
 * every one of its surfaces shares, and the name of each toolkit.
 *
 * **Why this is a group of its own and not part of `devtools`.** It used to be:
 * the drawer was „Programerske alatke", its chrome and its shared surface words
 * sat in `strings/devtools.ts` beside the forty-eight tool names, and that was
 * right for as long as the drawer and the toolkit were the same thing. They are
 * not any more — `devtools` is now the copy of ONE pack (`softver`), and this is
 * the copy of the drawer that hosts it and eighteen others. A pack's tool names
 * stay with the pack; the search field, the empty state and „Kopirano" belong to
 * the room they are all standing in.
 *
 * That split is also why `titleKey: "devtools.name.riscv"` did not have to move.
 * A tool names a string in its own family's group (`ToolRegistration`), and the
 * RISC-V decoder's family did not change when its neighbours arrived.
 *
 * Nothing here is a second copy layer. This is one leaf of the same table —
 * `strings.sr.ts` spreads it in as `pro`, `strings.ts` clones the whole thing,
 * and the locale switch rewrites these leaves exactly as it rewrites the rest. A
 * consumer reads `strings.pro.…` and never imports this file.
 */

export const proSr = {
  title: "Stručne alatke",
  searchLabel: "Pretraži stručne alatke",
  searchPlaceholder: "Pretraži po imenu ili pojmu…",
  noMatches: "Nijedna alatka ne odgovara pretrazi.",
  clearSearch: "Poništi pretragu",
  emptyTitle: "Nijedna alatka nije otvorena",
  /** Says how to find one, because with a drawer this size the list is the hard part. */
  empty: "Izaberi alatku sa liste ili je pronađi pretragom.",

  /**
   * The state nothing else in the app has: the module is on and the drawer is
   * EMPTY, because every tool in it belongs to a pack and this profile has none.
   *
   * It is reachable — somebody switches „Stručne alatke" on from the Moduli
   * gallery without ever having answered the questionnaire — and it must not
   * read as a failure, because nothing failed. It says what is missing and where
   * the switch is, which is the `EmptyState` contract („says what to do, and
   * does not scold").
   */
  noPacksTitle: "Nijedan paket nije uključen",
  noPacks:
    "Alatke u ovom fioci dolaze u paketima po struci. Izaberi bar jedan da vidiš šta nosi.",
  choosePacks: "Izaberi pakete",

  /**
   * Copy the surfaces share — the words that would otherwise be written once per
   * tool and drift on about one in eight.
   *
   * Moved here from `devtools` wholesale, and the move is the point rather than
   * tidying: „Kopiraj" is the drawer's word, not the developer pack's, and a
   * quantity-take-off surface reading it out of a group called `devtools` would
   * have been the first sign that the split was drawn in the wrong place.
   */
  common: {
    copy: "Kopiraj",
    /** Replaces „Kopiraj" for a moment after a copy. Past tense: it has happened. */
    copied: "Kopirano",
    result: "Rezultat",
    input: "Ulaz",
    output: "Izlaz",
    /** Before anything has been typed — the output box says this instead of standing empty. */
    awaitingInput: "Upiši nešto gore.",
    /** The one refusal every surface can need: the text is not what this tool reads. */
    invalid: "Ovo nije oblik koji ova alatka čita.",
    bytes: "Bajtova",
    characters: "Znakova",
    lines: "Redova",
    /** Under a table that stopped early — a table that stops silently misreports its input. */
    tableCapped: "U tabeli je prvih {shown} od {total} redova.",
  },

  /**
   * The toolkits.
   *
   * **`name` is the subject; `who` is the vocabulary.** The packs are named after
   * what the work IS rather than after who does it (`TOOL_PACKS` argues why at
   * length), and that buys the design its most important property — a *geodeta*
   * recognises „Gradnja i projektovanje" without needing to be on a list. But it
   * costs the thing a job-title list gives away for free: a person scanning for
   * themselves wants to see their own word. `who` is that word, and it earns its
   * place three times over — it is read under the name in the pack picker, it is
   * what the questionnaire's cards say underneath, and its terms are folded into
   * the search index, so typing „zubar" finds „Medicina i nega".
   *
   * There is deliberately NO description of what each pack contains. That line
   * exists on screen and is composed from the registry („14 alata: Zlatni čas,
   * Dubina oštrine, Ekspozicija…"), because a hand-written list of contents is a
   * promise that goes stale the first time a tool is added, and this house does
   * not ship copy that can quietly become false.
   */
  packs: {
    gradnja: {
      name: "Gradnja i projektovanje",
      who: "arhitekte, građevinski inženjeri, geodeti, izvođači",
    },
    inzenjering: {
      name: "Struja i mašine",
      who: "elektroinženjeri, mašinci, elektroinstalateri, serviseri",
    },
    softver: {
      name: "Kod i softver",
      who: "programeri, administratori sistema, testeri",
    },
    dizajn: {
      name: "Dizajn i grafika",
      who: "grafički i UI dizajneri, ilustratori, štampari",
    },
    foto: {
      name: "Fotografija i snimanje",
      who: "fotografi, snimatelji, montažeri",
    },
    muzika: {
      name: "Muzika i produkcija",
      who: "muzičari, producenti, tonci",
    },
    prosveta: {
      name: "Nastava i ocenjivanje",
      who: "profesori, nastavnici, vaspitači, predavači",
    },
    tekst: {
      name: "Tekst i prevođenje",
      who: "prevodioci, lektori, novinari, pisci",
    },
    // No „Medicina i nega" pack, and its absence is deliberate — see
    // `TOOL_PACKS`. These two lines are what a `who` line costs when it names
    // a regulated profession: „fizioterapeuti" and „nutricionisti" both stood
    // here, and both are health professions whose presence in an audience line
    // is a clinical intended-purpose claim about everything in the pack. The
    // trades that remain are the ones the tools are honestly for.
    trening: {
      name: "Trening i forma",
      who: "treneri, takmičari, rekreativci",
    },
    kuhinja: {
      name: "Kuhinja i porcije",
      who: "ugostitelji, kuvari, poslastičari",
    },
    pravo: {
      name: "Pravo i rokovi",
      who: "advokati, pravnici, izvršitelji, notari",
    },
    racunovodstvo: {
      name: "Računovodstvo i obračuni",
      who: "računovođe, knjigovođe, revizori",
    },
    biznis: {
      name: "Svoj posao i klijenti",
      who: "preduzetnici, frilenseri, agencije, mali biznis",
    },
    nekretnine: {
      name: "Nekretnine",
      who: "agenti, procenitelji, investitori, izdavaoci",
    },
    transport: {
      name: "Vožnja i transport",
      who: "vozači, špediteri, dostavljači, taksisti",
    },
    agro: {
      name: "Poljoprivreda",
      who: "ratari, voćari, povrtari, stočari",
    },
    zanat: {
      name: "Zanat i radionica",
      who: "krojači, stolari, bravari, tapetari, obućari",
    },
    event: {
      name: "Događaji i organizacija",
      who: "organizatori događaja, venčanja, konferencija",
    },
  },

  /**
   * The notices, one per risk class (`TOOL_RISK_CLASSES`).
   *
   * **Each one says what the tool IS; none of them apologises for what it might
   * do.** That is not a tone preference, it is the whole protective mechanism.
   * A notice characterises the tool — it establishes what the thing is for and
   * who is verifying the answer — and that is what a court, and a
   * medical-device qualification, actually read. „Rezultati mogu biti netačni"
   * does the opposite: it is the vendor conceding the product may be defective,
   * about arithmetic that simply has to be right.
   *
   * Four shapes are therefore banned here, and each is banned for its own
   * reason:
   *
   *  - **Enumerating a harm.** „Ne odgovaramo za povredu" proves the harm was
   *    foreseen, and then the question is why the answer to a foreseen harm was
   *    a sentence.
   *  - **Leading with a waiver.** A notice that opens „ne snosimo odgovornost"
   *    reads as a product that expects to hurt somebody.
   *  - **Hedging the accuracy.** See above — the computation is defended by
   *    tests and by showing its formula, never by a caveat.
   *  - **Claiming compliance.** „U skladu sa propisima" is a warranty. It is the
   *    opposite of a disclaimer, and it is the one sentence that could turn this
   *    block into the thing it exists to prevent.
   *
   * And what none of them can do, so nobody mistakes them for armour: Serbian
   * obligations law does not permit excluding liability in advance for intent or
   * gross negligence, consumer law voids unfair terms outright, and no text at
   * all binds the third party who never saw it — the patient, the family in the
   * house, the client. Those are answered by the refusal list and by
   * `toolForbidsVerdict`, not here. What a notice honestly achieves is narrow
   * and worth having: the person using it cannot afterwards say they thought
   * the app was the professional.
   *
   * `line` sits on the surface, always, in the same place on every affected
   * tool. `note` is the long form in „Podešavanja". `export` is appended to a
   * copied result, because the harm nearly always happens downstream of this
   * window — in the email, the site diary, the client memo — and that line is
   * the only one of the three that travels to where the decision is made.
   */
  risk: {
    detail: "Detaljnije",
    "life-safety": {
      label: "Bezbednost",
      line: "Račun iz vrednosti koje si uneo. Ne zamenjuje proračun, proveru ni odgovornost ovlašćenog inženjera.",
      note: "Alatke u ovoj grupi računaju veličinu iz podataka koje sam uneseš. One ne biraju propis, ne određuju granicu i ne ocenjuju da li nešto zadovoljava — to je posao ovlašćenog projektanta ili izvođača, koji za tu odluku i odgovara. Granice koje uneseš prikazuju se uz rezultat da bi se videlo iz čega je dobijen.",
      export: "Nexus — informativan račun. Ne zamenjuje proračun ovlašćenog inženjera.",
    },
    wellness: {
      label: "Telo i forma",
      line: "Informativan račun. Nije medicinski ni trenažni savet.",
      note: "Alatke u ovoj grupi računaju brojeve o sopstvenom telu — masu, odnose, opterećenje na treningu — iz vrednosti koje sam uneseš. One ne postavljaju dijagnozu, ne određuju terapiju i ne zamenjuju lekara. Za zdravstvena pitanja obrati se lekaru.",
      export: "Nexus — informativan račun. Nije medicinski savet.",
    },
    "legal-procedure": {
      label: "Rokovi",
      line: "Računa datume po pravilu koje si izabrao. Izbor pravila i provera roka su pravno pitanje.",
      note: "Alatke u ovoj grupi sabiraju i oduzimaju datume po pravilu računanja koje sam izabereš — da li se prvi dan računa, kako se pomera rok koji pada u neradni dan. Taj izbor je pravno pitanje i ostaje tvoj; alatka ga samo primeni i ispiše uz rezultat. Ovo nije pravni savet.",
      export: "Nexus — informativan račun datuma. Nije pravni savet.",
    },
    financial: {
      label: "Novac",
      line: "Informativan račun iz stopa i iznosa koje si uneo. Nije poreski ni računovodstveni savet.",
      note: "Alatke u ovoj grupi računaju iz stopa i iznosa koje sam uneseš. Nijedna stopa nije ugrađena u program — koja stopa važi danas i za tvoj slučaj je pitanje propisa i tvoja odluka, pa se uneta stopa ispisuje uz rezultat. Ovo nije poreski, računovodstveni ni finansijski savet.",
      export: "Nexus — informativan račun. Nije poreski ni računovodstveni savet.",
    },
    "food-safety": {
      label: "Bezbednost hrane",
      line: "Račun iz vrednosti koje si uneo. Bezbednost hrane određuju tvoj HACCP plan i propisi.",
      note: "Alatke u ovoj grupi računaju količine i vremena iz vrednosti koje sam uneseš. One ne određuju bezbednu temperaturu, vreme ni postupak — to određuju tvoj HACCP plan i propisi, i ta ocena ostaje tvoja.",
      export: "Nexus — informativan račun. Ne određuje bezbednost hrane.",
    },
  },

  /** The „Podešavanja" card that holds every long-form notice, and the one line above them. */
  riskSection: {
    description:
      "Neke alatke računaju brojeve koji se koriste u poslu koji je zakonski uređen. Uz svaku takvu alatku stoji kratka napomena; ovde je cela.",
  },

  /**
   * The pack picker — the drawer's own dialog, a „Podešavanja" card, and the
   * questionnaire's receipt, all reading from here.
   *
   * There is deliberately no „Uskoro" line for a pack whose tools are not
   * written yet: the list is derived from the registry (`packInventory`), so
   * such a pack has no row at all. A row somebody cannot press is an
   * advertisement, and this house does not ship copy that promises.
   */
  picker: {
    title: "Paketi alatki",
    description:
      "Svaki paket dodaje alatke jedne struke. Uključi koliko god želiš — ništa se ne briše kad isključiš paket, alatke samo nestanu sa liste.",
    /** Under each card, and beside each row of the questionnaire's receipt. */
    contains: "{count} alata",
    /** The header control on the drawer itself. */
    open: "Paketi…",
    /** The way out of the dialog. „Gotovo", not „U redu": every toggle is already written by the time it is read. */
    done: "Gotovo",
    /** Under the list, once at the bottom: what a pack is NOT, said plainly so nobody hunts for a page. */
    note: "Paket je skup alatki, ne modul — ne dodaje ništa u meni sa strane i ne čuva nikakve podatke.",
    /**
     * The second line at the foot, and the only place the whole drawer is
     * characterised at once.
     *
     * This is the acknowledgement, and switching a toolkit on IS the act of
     * acknowledging — there is no modal and no „Razumem" button. A consent gate
     * would be worth less than it costs: it is dismissed without reading by the
     * second toolkit, it teaches the user that the app's warnings are furniture
     * on the way to the tool, and it would have to be re-shown to mean anything,
     * at which point it is a nag. The sentence that is read is the one standing
     * beside the thing being switched on.
     */
    responsibility:
      "Alatke računaju veličine iz vrednosti koje uneseš. One ne zamenjuju ovlašćenog stručnjaka — projektanta, lekara, advokata, računovođu — niti odluku koju on donosi i za koju odgovara.",
    /** The one failure this surface can have: the flag row did not get written. Says what it cost, which is the press. */
    saveError: "Promena nije sačuvana. Pokušaj ponovo.",
  },
} as const;
