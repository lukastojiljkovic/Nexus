/**
 * Serbian — the launch language, and the SOURCE OF TRUTH for every other.
 *
 * This module holds the table and nothing else: no lookup helper, no plural
 * rule, no locale state. Those live in `strings.ts`, which is what the app
 * imports; nothing outside this file may import `sr` directly, because a
 * consumer bound to `sr` would be bound to Serbian forever no matter what the
 * user picked.
 *
 * `as const` is load-bearing twice over. It gives every leaf a literal type, so
 * `keyof typeof strings.study.rating` still names the real keys at the ~40 call
 * sites that depend on it — and it is what `Strings` below widens FROM, which
 * is how a second locale gets checked for completeness by the compiler instead
 * of by hand.
 */
import type { SmartListId, ToolTaskGroup } from "@nexus/core";
import { devtoolsSr } from "./strings/devtools.js";
import { electronicsSr } from "./strings/electronics.js";
import { proSr } from "./strings/pro.js";
import type {
  ApkgImportSkipCode,
  ApkgReadErrorCode,
  ArchiveReadErrorCode,
  CsvImportColumnRole,
  CsvImportReadErrorCode,
  CsvImportRowDropCode,
  DashboardPickErrorCode,
  FinCsvImportAmountFormat,
  FinCsvImportColumnRole,
  FinCsvImportDateFormat,
  FinCsvImportRefusalCode,
  FinCsvImportRowDropCode,
  FinCsvImportRowSkipCode,
  FinCsvImportSignConvention,
  IcsImportReadErrorCode,
  IcsImportSkipCode,
  ImportDuplicateType,
  ImportSkipCode,
  LlmImportAnswerProblem,
  LlmImportKind,
  LlmImportSkipReason,
  LlmPromptLanguage,
  MarkdownImportSkipCode,
  PackRefusalCode,
  ProfilePicturePickErrorCode,
  RestoreModuleCounts,
  RestoreProblemCode,
  SyncAdoptProblem,
  SyncEnableProblem,
  SyncProblem,
  SyncReconnectProblem,
} from "../../shared/ipc.js";
import type { ClockPreference } from "./calendarPrefs.js";
import type { CanvasStrokeWidthId, CanvasToolId } from "./canvasTools.js";
import type { BlockedInToday } from "./taskPrefs.js";
import type { WeekStartPreference } from "./weekStart.js";

export const sr = {
  app: {
    brand: "Nexus",
    navLabel: "Glavna navigacija",
    /**
     * The navigation groups, translated — the sidebar's headings, the
     * launcher's sections and the module galleries' headings, ONE table because
     * they are one list (ADR-093). Keys are `ModuleGroup` from `@nexus/core`;
     * Culture and Play have no module in this build, and a group with no enabled
     * member never renders, so neither costs anything until the modules it is
     * for exist. One word each, because this is a 220px rail.
     *
     * „Život" is the word this rail already used for the group the change
     * replaces, and it keeps it. „Stvaranje" is also the name of a „Priprema"
     * answer about a week, which is a reuse rather than a collision: the answer
     * and the group name the same way of spending a day.
     */
    navGroups: {
      plan: "Planiranje",
      knowledge: "Znanje",
      life: "Život",
      culture: "Kultura",
      make: "Stvaranje",
      play: "Igra",
      shell: "Nexus",
    } satisfies Record<string, string>,
    /**
     * The pinned shortlist's heading (ADR-086; ADR-093 §3): the modules at the
     * top of the rail. It began as „the ones this profile's answers put there"
     * and the pin toggle on every row made it a list the user edits too —
     * „Za tebe" covers both, and the word is chosen against „Omiljeno" because
     * nobody ticked these as favourites and half of them were never clicked.
     * „Podešavanja → Kako je Nexus podešen za tebe" is where the questionnaire
     * says why it placed what it placed.
     */
    navPinned: "Za tebe",
    /**
     * Pinning and the launcher (ADR-093 §3 and §4).
     *
     * `pinFull` says the number out loud rather than leaving a disabled control
     * to explain itself: the shortlist holds `MAX_PINNED_MODULES`, and a pin
     * that silently does nothing is the shape of defect this house fixes by
     * saying what the rule is.
     *
     * The launcher's `label` is one string for the rail's foot row AND the
     * overlay's heading, because they are one surface — the row that opens the
     * panel and the panel that appears have to read as the same thing.
     */
    pinModule: "Zakači {name} na vrh",
    unpinModule: "Otkači {name}",
    pinFull: "Na vrhu je već pet modula. Otkači neki da bi zakačio ovaj.",
    launcher: {
      label: "Svi moduli",
      description: "Svaki uključen modul, po oblastima. Ukucaj deo naziva da suziš listu.",
      searchLabel: "Pretraga modula",
      close: "Zatvori",
    },
    /**
     * The fold over a module landing's chart — NOTE, TASK, UČENJE and NAVIKE.
     *
     * One word, and the SAME word on all four, because it is one control the
     * user learns once. It is deliberately not each chart's own name: the chart
     * still carries that above itself when it opens, and a trigger repeating
     * the heading it is about to reveal reads as the page saying „Ritam
     * pisanja" twice.
     *
     * A noun and not a verb („Prikaži…") because the triangle already says the
     * verb and says it in both directions, which a label cannot do without
     * changing under the pointer.
     */
    overviewToggle: "Pregled",
    themeToggle: "Promeni temu",
    themeDan: "Dan",
    themeNoc: "Noć",
    /**
     * The drawn window frame (`TitleBar.tsx`). Three controls that used to be
     * the operating system's, so their names have to be the ones a Serbian
     * Windows already uses — this is the one strip in the app where inventing
     * vocabulary would be a usability defect rather than a voice.
     */
    window: {
      minimize: "Umanji",
      maximize: "Uvećaj",
      restore: "Vrati veličinu",
      close: "Zatvori prozor",
    },
    /**
     * The app menu, behind the mark (founder, 2026-08-08). Removing the OS
     * frame removed the OS menu bar with it, and this is where what it held
     * came back — plus the shell's own commands, so „gde su opcije" has one
     * answer instead of two.
     *
     * The two section names are the ones a Serbian Windows already uses, for
     * the same reason the window controls above are: a menu is the last place
     * in a product to invent vocabulary.
     */
    menu: {
      label: "Meni aplikacije",
      viewSection: "Prikaz",
      zoomIn: "Uvećaj prikaz",
      zoomOut: "Umanji prikaz",
      zoomReset: "Stvarna veličina",
      fullScreenEnter: "Preko celog ekrana",
      fullScreenLeave: "Napusti ceo ekran",
      windowSection: "Prozor",
      /** The shell's own rows, named here because `App` builds them and `TitleBar` only draws them. */
      search: "Pretraga",
      settings: "Podešavanja",
      shortcuts: "Prečice na tastaturi",
    },
    loading: "Učitavanje…",
    /**
     * Asked before a file is removed, by all THREE attachment panels — notes,
     * tasks and a subject's materials. One block rather than three, because it
     * is one act: the row is hard-deleted and the encrypted copy on disk goes
     * with it when nothing else references that blob. Every one of the three
     * used to do that on a single click of a „⋯" menu item, with no undo
     * anywhere behind it.
     */
    attachmentDelete: {
      title: "Ukloniti datoteku?",
      question: "Priložena kopija se briše zauvek i ne može se vratiti.",
      /** The one reassurance that is true: the original on disk was never touched. */
      note: "Original na tvom računaru ostaje netaknut.",
      confirm: "Ukloni",
      cancel: "Otkaži",
    },
    /**
     * The autosave line, shared by every surface that writes without being
     * asked — the board and the note editor today, whatever comes next
     * tomorrow. The saved label carries a CLOCK because a bare „Sačuvano" is
     * still on screen an hour after the last write and therefore proves
     * nothing; see `SaveIndicator` for why the absence of this line was read
     * as the absence of saving.
     */
    saveSaving: "Čuvanje…",
    saveSavedPrefix: "Sačuvano u",
    /**
     * An editor's last write failed after its page was gone (DC-148). The shell
     * says it, because the page that would have is not there, and names the
     * note or the board, because nothing else on screen points at it. A private
     * note is never named: its title is private content, and this line is shown
     * above every page.
     */
    unsavedExit: {
      note: "Poslednje izmene u belešci „{title}“ nisu sačuvane.",
      noteTooLarge:
        "Poslednje izmene u belešci „{title}“ nisu sačuvane — deo je prevelik da bi se sačuvao odjednom.",
      privNote:
        "Poslednje izmene u jednoj privatnoj belešci nisu sačuvane. Naslov se ne prikazuje van Privatnog.",
      privNoteTooLarge:
        "Poslednje izmene u jednoj privatnoj belešci nisu sačuvane — beleška je prevelika. Naslov se ne prikazuje van Privatnog.",
      board: "Poslednje izmene na tabli „{name}“ nisu sačuvane. Otvori je i proveri crtež.",
      boardTooLarge:
        "Poslednje izmene na tabli „{name}“ nisu sačuvane — ubačene slike zauzimaju previše prostora.",
      retry: "Pokušaj ponovo",
      retryFailed: "Ni ponovni pokušaj nije uspeo.",
      dismiss: "Zatvori obaveštenje",
    },
    loadErrorTitle: "Pokretanje nije uspelo",
    loadErrorDescription:
      "Veza sa lokalnom bazom podataka nije uspostavljena. Zatvori aplikaciju i pokreni je ponovo.",
    /**
     * One page could not be drawn — its file did not load, or it failed while
     * rendering (`PageSlot` in `routes.tsx`). The shell around it still works,
     * which is why the copy points at the sidebar first: another module is one
     * click away, and a restart is the remedy only if this page is the one
     * that is needed.
     */
    pageErrorTitle: "Ekran nije učitan",
    pageErrorDescription:
      "Ovaj deo aplikacije nije mogao da se prikaže. Izaberi drugi modul u bočnoj traci ili zatvori aplikaciju i pokreni je ponovo.",
  },

  /**
   * ADR-089 — the network mode. One block for the choice screen (shown once,
   * before the unlock screen) and for the card in Podešavanja, because the two
   * must say the same thing about the same two options. The copy is written so
   * that an upgrading user does not read it as a first run: it asks a question
   * about this computer, it never welcomes anybody.
   */
  network: {
    chooseTitle: "Kako Nexus sme da koristi mrežu?",
    chooseIntro:
      "Izaberi režim za ovaj računar. Odluka se pamti i možeš je promeniti kasnije u Podešavanjima.",
    offlineTitle: "Samo bez mreže",
    offlineBody:
      "Nexus ne otvara nijednu vezu ka internetu. Ništa ne napušta ovaj računar — ni tvoji podaci, ni provera nove verzije.",
    updatesTitle: "Bez mreže + provere ažuriranja",
    updatesBody:
      "Nexus se javlja samo GitHub-u, i to isključivo da proveri i preuzme novu verziju sebe. Tvoje beleške i podaci ne napuštaju računar; GitHub vidi tvoju IP adresu, kao i svaki sajt.",
    downloadsTitle: "Bez mreže + provere ažuriranja + preuzimanja",
    downloadsBody:
      "Sve što dozvoljava režim „Bez mreže + provere ažuriranja“, i preuzimanja koja pokreneš. Ništa se ne preuzima samo — preuzimanje počinje kad ga pokreneš, i to samo sa adresa ugrađenih u aplikaciju, a ono što stigne proverava se pre nego što Nexus to upotrebi.",
    chooseConfirm: "Nastavi",
    chooseHint:
      "Ako zatvoriš prozor bez izbora, Nexus ostaje u režimu „Samo bez mreže“ i pitaće te ponovo pri sledećem pokretanju.",
    cardIntro:
      "Režim važi za ceo računar, i svaki režim dozvoljava sve što i prethodni. „Samo bez mreže“ ne otvara nijednu vezu; „Bez mreže + provere ažuriranja“ dodatno proverava i preuzima novu verziju Nexusa; „Bez mreže + provere ažuriranja + preuzimanja“ dodatno preuzima ono što pokreneš.",
    save: "Sačuvaj izbor",
    saved: "Izbor je sačuvan.",
    restartNote: "Promena režima važi od sledećeg pokretanja Nexusa.",
    restartNow: "Restartuj Nexus",
    restartError: "Nexus nije mogao da se restartuje. Zatvori ga i otvori ponovo.",
    saveError: "Izbor nije sačuvan. Pokušaj ponovo.",
    aboutTitle: "Ažuriranja",
    aboutOff:
      "Provere ažuriranja su isključene. Uključi ih u kartici „Mreža i ažuriranja“ u kategoriji Privatnost.",
    aboutOpenCard: "Otvori „Mreža i ažuriranja“",
    checkNow: "Proveri sada",
    checking: "Proveravam…",
    upToDate: "Imaš najnoviju verziju.",
    available: "Dostupna je nova verzija: {version}.",
    install: "Preuzmi i pokreni instalaciju",
    installing: "Preuzimam…",
    installHint:
      "Ništa se ne preuzima pre ovog klika. Nexus proverava potpis instalacije, pokreće je i zatvara se. Instalacija se zatim izvodi tiho i, kada završi, sama otvara novu verziju.",
    portableNote:
      "Ovaj primerak Nexusa se pokreće sa USB-a, pa nikad ne instalira sopstveno ažuriranje: sve što čuva ostaje na USB-u. Novu verziju preuzmi sa stranice izdanja i zameni fasciklu na USB-u.",
    later: "Kasnije",
    releasePage: "Stranica izdanja",
    notesTitle: "Šta je novo",
    problemTitle: "Proveru nije bilo moguće završiti.",
    problem: {
      "rate-limited": "GitHub trenutno ograničava broj provera. Pokušaj ponovo kasnije.",
      network: "Veza sa mrežom nije dostupna. Proveri internet i pokušaj ponovo.",
      unexpected: "Odgovor GitHub-a nije bilo moguće pročitati. Pokušaj ponovo kasnije.",
      asset: "Uz to izdanje nema instalacione datoteke za Windows. Otvori stranicu izdanja.",
      signature:
        "Potpis datoteke sa proverom nije ispravan. Preuzimanje je zaustavljeno pre nego što je instalacija počela.",
      hash: "Preuzeta datoteka ne odgovara svojoj proveri. Obrisana je i nije pokrenuta.",
      portable:
        "Primerak koji se pokreće sa USB-a nikad ne instalira sopstveno ažuriranje. Otvori stranicu izdanja i zameni fasciklu na USB-u.",
    },
  },

  /**
   * ADR-065 — the four-screen questionnaire: ime + tema, uloga, oblasti,
   * podsetnici. Every screen is skippable, and the copy never pretends
   * otherwise: each answer says what it changes and that Podešavanja can undo
   * it later, because that is the only honest way to ask four questions before
   * anybody has seen the app.
   */
  onboarding: {
    /** Screen 1 — the original ONB-lite content, unchanged. */
    title: "Tvoj Nexus",
    description:
      "Nexus radi potpuno lokalno — svi podaci ostaju na ovom uređaju. Upiši ime profila i izaberi temu; sve ostalo podešavaš kasnije.",
    /**
     * The business first entry (ADR-058 §5): the same naming screen, minus the
     * theme group — the theme is device-wide and was chosen long before a
     * second profile existed — so the copy asks for exactly what the screen
     * still asks for: a name.
     */
    titleBusiness: "Poslovni profil",
    descriptionBusiness:
      "Poslovni profil drži posao odvojeno od ličnog — ima svoje zadatke, beleške i podešavanja, pod istim nalogom. Upiši mu ime; sve ostalo podešavaš kasnije.",
    nameLabel: "Ime profila",
    namePlaceholder: "Upiši ime",
    themeLabel: "Tema",
    /**
     * ADR-086's four questions, and what makes them different from the two they
     * replaced: every one of them is about the PERSON and none is about the
     * software. „Do you want the Finance module" is the questionnaire asking the
     * user to do its job; „do you want Nexus to keep an eye on money" is a
     * question anybody can answer about themselves. The mapping from the second
     * to the first lives in `buildProfilePlan`, where it can be argued with.
     */
    week: {
      title: "Na šta ti odlazi nedelja?",
      description: "Izaberi najviše dve — one na koje stvarno ode najviše vremena.",
      /** Said out loud, the „remindersNoChoice" idiom: choosing nothing is an answer here. */
      noChoice: "Ako ništa ne izabereš, Nexus kreće standardno.",
      shapes: {
        posao: { name: "Posao", desc: "Radim za nekoga — zadaci, sastanci, rokovi." },
        skola: { name: "Škola i fakultet", desc: "Predavanja, ispiti, učenje." },
        dom: { name: "Dom i porodica", desc: "Kuća, računi, obaveze koje ne čekaju." },
        kondicija: { name: "Trening i zdravlje", desc: "Vežbanje, navike, san i ishrana." },
        stvaranje: { name: "Stvaranje", desc: "Pišem, crtam, gradim nešto svoje." },
        firma: { name: "Svoja firma", desc: "Klijenti, ponude, naplata." },
      } satisfies Record<string, { name: string; desc: string }>,
    },
    /**
     * The screen that replaced eighteen toolkit cards with one text field.
     *
     * The cards were „the same taxonomy with fewer boxes": eighteen packs
     * regrouped, and a person outside the eighteen still has nowhere to be. A
     * field the user writes their own word into fails OPEN — the lexicon reads
     * „zidar" in every case Serbian inflects it into — and the activity chips
     * below the rule are the net for whoever it does not know.
     */
    trade: {
      title: "Čime se baviš?",
      description:
        "Napiši svojim rečima. Nexus prepoznaje posao i dodaje alatke za njega — ništa ne menja tvoje podatke.",
      label: "Tvoj posao",
      placeholder: "npr. stolar, advokat, fotografkinja, vodim knjige",
      /** The recognition receipt. Quotes the person's own word back, then what it opened. */
      heard: "Prepoznato",
      /** Removing one chip un-says it — the recognition is a suggestion, not a verdict. */
      remove: "Ukloni",
      activitiesLabel: "Ili izaberi šta radiš:",
      noChoice:
        "Ako ne prepoznam ništa, ništa se ne dodaje — stručne alatke uključuješ kasnije, kad zatrebaju.",
      /** One per `TRADE_ACTIVITIES` id. A verb, because the question is what somebody DOES. */
      activities: {
        "mere-sece": "Merim i sečem",
        ponude: "Pravim ponude i predračune",
        teren: "Radim na terenu",
        predaje: "Držim nastavu",
        ugovori: "Pišem ugovore",
        vozi: "Vozim i isporučujem",
        kuva: "Kuvam",
        snima: "Snimam i fotografišem",
        kod: "Pišem kod",
        svira: "Sviram",
        knjige: "Vodim knjige",
        dogadjaji: "Organizujem događaje",
        trenira: "Treniram druge",
        prevodi: "Prevodim i lektorišem",
        laboratorija: "Radim u laboratoriji",
        instalacije: "Postavljam instalacije",
        sistemi: "Održavam mreže i sisteme",
        servis: "Servisiram vozila",
        jedrim: "Jedrim",
        letim: "Letim",
        "merim-teren": "Merim teren i koordinate",
        radio: "Radim sa radiom",
        solar: "Montiram solarne sisteme",
      } satisfies Record<string, string>,
    },
    /** Not what somebody does but HOW — and it decides what every module opens on. */
    tempo: {
      title: "Kako ti izgleda dan?",
      description: "Izaberi jedno — po ovome Nexus bira šta ti prvo pokazuje.",
      noChoice: "Ako preskočiš, sve ostaje kako je i menjaš u hodu.",
      options: {
        planer: { name: "Planiram unapred", desc: "Volim da vidim ceo mesec pre nego što krene." },
        reaktivan: { name: "Rešavam kako naiđe", desc: "Bitno mi je šta je danas i šta kasni." },
        beleznik: { name: "Prvo zapišem", desc: "Sve ide u beleške, pa se posle složi." },
      } satisfies Record<string, { name: string; desc: string }>,
    },
    /** Asked about CONTENT, never about modules — the honest form of the same question. */
    keep: {
      title: "Šta hoćeš da ti Nexus drži na oku?",
      description: "Izaberi koliko god hoćeš, ili ništa.",
      noChoice: "Ništa od ovoga nije obavezno — sve se uključuje i isključuje kasnije.",
      options: {
        novac: { name: "Novac", desc: "Računi, pretplate, ko još nije platio." },
        zdravlje: { name: "Zdravlje i navike", desc: "Ono što se meri iz dana u dan." },
        dokumenta: { name: "Dokumenta", desc: "Ugovori, lične isprave, rokovi važenja." },
        ideje: { name: "Ideje i beleške", desc: "Da mi ništa ne propadne." },
        privatno: {
          name: "Nešto samo moje",
          desc: "Zaključana sekcija — otvara se posebnom lozinkom.",
        },
      } satisfies Record<string, { name: string; desc: string }>,
    },
    /**
     * The „Priprema" screen. It narrates REAL steps — each line is a thing that
     * is actually being written — because a progress screen that invents its
     * stages is the one kind of loading screen a user is right to resent.
     */
    prepare: {
      title: "Sklapam tvoj Nexus",
      description: "Nameštam početnu, meni i boje prema tvojim odgovorima.",
      stages: {
        packs: "Uključujem alatke",
        modules: "Nameštam module",
        board: "Slažem početnu",
        look: "Biram boju i ritam",
        done: "Završavam",
      } satisfies Record<string, string>,
    },
    /**
     * „Evo tvog Nexusa" — the receipt.
     *
     * Every line is generated from `plan.reasons`, so the app can only say what
     * it actually did: a decision with no sentence here is a decision law 4
     * makes unrepresentable. The screen exists because an app that reshapes
     * itself without saying so is an app that feels broken rather than personal.
     */
    reveal: {
      title: "Evo tvog Nexusa",
      description: "Ovako smo ga složili. Sve može da se menja — u Podešavanjima, kad god.",
      /** The Serbian list conjunction (`joinList`) — „A, B i C". */
      and: "i",
      heard: "Tvoje reči",
      /**
       * The participle is a VERB here („složili smo ih") and not an adjective
       * agreeing with the noun, which it cannot be: a composed board is 3–6
       * cards, so `{unit}` is „kartice" at three and „kartica" — genitive
       * plural — at five, and one modifier cannot be right for both.
       */
      board: "Početna ti ima {count} {unit} — složili smo ih prema tvojim odgovorima.",
      boardUnitOne: "karticu",
      boardUnitFew: "kartice",
      boardUnitMany: "kartica",
      packs: "Uključene su alatke za: {packs}.",
      nav: "U meniju su ti prvi: {modules}.",
      priv: "Privatna sekcija je uključena — otvara se posebnom lozinkom.",
      calendar: "Kalendar se otvara na prikazu „{view}“.",
      accent: "Boja aplikacije je {colour}.",
      /** What a run where nothing was answered says. Not an apology: it is a legitimate answer. */
      nothing: "Bez odgovora Nexus kreće standardno — sve podešavaš kad zatreba.",
      enter: "Uđi u Nexus",
      /** The escape hatch, quiet: ADR-065's two checkbox screens survive as this. */
      advanced: "Podesi ručno",
    },
    /**
     * „Napredno" — ADR-065's two screens, kept.
     *
     * They were the whole questionnaire and are now the override: reachable from
     * the reveal and from Podešavanja, never on the path. A person who wants to
     * tick thirty-two boxes should be able to; nobody should have to.
     */
    advancedTitle: "Podesi ručno",
    advancedDescription:
      "Ovde biraš tačno šta hoćeš. Ista lista stoji i u Podešavanjima → Moduli, pa ništa ovde nije poslednja prilika.",
    advancedSave: "Sačuvaj",
    /**
     * Screen 2 — „Tvoja nedelja". Which toolkits „Stručne alatke" carries.
     *
     * **It asks about the WEEK, not about the person, and that is the whole
     * question.** „Šta te najbolje opisuje?" — five buttons, student to
     * preduzetnik — is what stood here, and generalising it to the professions
     * Nexus serves would have meant asking somebody to find their job title in a
     * list of twenty-two. Serbian titles do not survive that: a „geodeta" or a
     * „strukovni vaspitač" is on nobody's list and would land on „Nešto drugo",
     * which carries no information at all. A subject fails open where a title
     * fails closed — the geodeta reads „Gradnja i projektovanje" and knows.
     *
     * The description says what the answer does, on the old line's terms
     * exactly: a suggestion, changeable, and reversible later.
     */
    /** Said out loud, the „remindersNoChoice" idiom: picking nothing is a real answer here, not a skipped step. */
    packsNoChoice: "Ako ništa ne izabereš, Nexus kreće bez stručnih alatki — dodaješ ih kad zatrebaju.",
    /** Screen 3 — oblasti. The module names and one-line descriptions are the gallery's own (`settings.moduleDescriptions`), never respelled. */
    modulesTitle: "Šta ti treba?",
    /** Screen 4 — podsetnici; the three choices reuse `settings.notificationPresets`, so a word means the same set everywhere. */
    /**
     * The demo offer on the last screen — a personal first run only. Says what
     * it is (a SECOND profile, not a change to this one), what is in it, and
     * that it can be removed, because all three are what somebody needs in
     * order to say yes without wondering what they just agreed to.
     */
    demoLabel: "Dodaj i „Demo“ profil",
    demoHint:
      "Drugi profil u ovom nalogu, pun primera — zadaci, beleške, finansije, učenje, " +
      "navike i ishrana — da vidiš kako Nexus izgleda kada je pun. Tvoj profil ostaje " +
      "prazan i netaknut, a „Demo“ možeš obrisati kad god poželiš.",
    remindersTitle: "Podsetnici",
    remindersDescription: "Koliko obaveštenja želiš od Nexusa?",
    /** Said out loud rather than left as a surprise: no pick here is a valid answer, and the one-time question (NTF-008) simply stays where it was. */
    remindersNoChoice: "Ako ne izabereš, Nexus će pitati kada prvi podsetnik bude spreman.",
    /** Screen chrome. „Korak 2 od 4“ is composed in JSX around the number, the `settings.backup.savedPrefix` idiom. */
    stepPrefix: "Korak",
    stepOf: "od",
    next: "Dalje",
    back: "Nazad",
    start: "Počni",
    /** First run only: stop asking and take what the flow already holds. */
    skip: "Preskoči",
    /** Rerun only: leave without writing anything — see `Onboarding.tsx` for why a rerun cannot „skip to Osnovno“. */
    cancel: "Otkaži",
    /** The same flow reopened from Podešavanja (SET). Screen 1 shows the current name, screen 3 the live modules. */
    rerunTitle: "Ponovo podesi Nexus",
    rerunDescription:
      "Ista pitanja kao pri prvom pokretanju. Kreće od onoga što sada imaš i menja samo ono što promeniš.",
    /**
     * The one genuine starter row (ADR-065 §4): a real, useful, deletable note
     * written through the ordinary note path. Markdown, because that is what
     * `parseMarkdownNote` reads and what the note editor renders back. Every
     * sentence is checkable in the app — no invented numbers, no promises the
     * build does not keep, and no printed keyboard chord (they are remappable,
     * ADR-040, so the note points at the screen that shows the live ones).
     */
    welcomeNote: {
      title: "Dobro došli u Nexus",
      body: `# Dobro došli u Nexus

Ovo je tvoja prva beleška — promeni je ili obriši, tvoja je.

- Svi podaci ostaju na ovom uređaju. Nexus ne šalje ništa na internet.
- Oblasti uključuješ i isključuješ u Podešavanjima → Moduli.
- Prečice na tastaturi vidiš i menjaš u Podešavanjima → Prečice.

Kada ti zatreba nešto novo — zadatak, događaj ili beleška — počni odavde.
`,
    },
    saveError: "Čuvanje nije uspelo. Pokušaj ponovo.",
  },

  /** Local account lock screen (ADR-018 / AUTH-002..005, extended by ADR-044 / AUTH-006): picker → create → Kit za oporavak → unlock → recovery, plus the shared error map and the sidebar lock/switch actions. */
  auth: {
    validation: {
      tooWeak: "Pristupni kod mora imati bar 8 karaktera, uz najmanje jedno slovo i jednu cifru.",
      mismatch: "Kodovi se ne poklapaju.",
      labelRequired: "Upiši ime naloga.",
    },
    create: {
      title: "Zaštiti svoj Nexus",
      intro: "Postavi pristupni kod koji će štititi sve tvoje podatke na ovom računaru.",
      additionalTitle: "Novi nalog",
      additionalIntro:
        "Novi nalog ima svoj pristupni kod i svoje podatke — ništa se ne deli sa nalozima koji već postoje.",
      labelLabel: "Ime naloga",
      labelPlaceholder: "npr. Lični",
      // The registry that holds this name is plaintext by design (ADR-044): it
      // is what the lock screen lists before anything is unlocked. Said plainly
      // where the name is typed, never buried in a settings page.
      labelNote: "Ovo ime je vidljivo na zaključanom ekranu.",
      passcodeLabel: "Pristupni kod",
      passcodePlaceholder: "Najmanje 8 karaktera, slovo i cifra",
      confirmLabel: "Potvrdi pristupni kod",
      confirmPlaceholder: "Ponovi pristupni kod",
      note: "Svi podaci se šifruju ovim kodom. Ako ga zaboraviš, jedini put nazad je Kit za oporavak koji dobijaš u sledećem koraku — bez koda i bez Kita podaci ostaju trajno nedostupni.",
      submit: "Napravi nalog",
    },
    keystoreUnavailable: {
      title: "Sistemski trezor nije dostupan",
      description:
        "Nexus čuva deo ključa za šifrovanje u sistemskom trezoru Windows-a, a on trenutno nije dostupan na ovom Windows nalogu — bez njega se lokalni nalog ne može napraviti. Proveri da li je ovaj Windows nalog ispravno postavljen i pokušaj ponovo.",
    },
    recoveryKit: {
      title: "Kit za oporavak",
      description:
        "Ovaj kod se prikazuje samo jednom. Zapiši ga i sačuvaj odvojeno od računara — ako ikada zaboraviš pristupni kod, ovo je jedini način da ponovo uđeš u svoje podatke.",
      copy: "Kopiraj",
      copied: "Kopirano",
      // Gender-neutral by construction: Serbian past participles agree with the
      // speaker, and "Zapisao sam" would address only half the users.
      confirmCheckbox: "Kod je zapisan i sačuvan",
      continue: "Nastavi",
    },
    unlock: {
      title: "Nexus je zaključan",
      description: "Unesi pristupni kod da nastaviš.",
      passcodeLabel: "Pristupni kod",
      passcodePlaceholder: "Upiši pristupni kod",
      submit: "Otključaj",
      forgot: "Zaboravljen pristupni kod?",
      retryPrefix: "Previše pokušaja — probaj ponovo za",
      otherAccount: "Drugi nalog",
    },
    /** The account picker (ADR-044 / AUTH-006) — shown ahead of the lock screen whenever this device holds more than one account. */
    picker: {
      title: "Izaberi nalog",
      description: "Na ovom računaru postoji više naloga. Svaki ima svoj pristupni kod i svoje podatke.",
      stateLocked: "Zaključan",
      stateRecovery: "Traži Kit za oporavak",
      stateKeystoreUnavailable: "Sistemski trezor nije dostupan",
      rename: "Preimenuj",
      renameFieldLabel: "Novo ime naloga",
      renameSave: "Sačuvaj",
      renameCancel: "Otkaži",
      renameError: "Preimenovanje nije uspelo. Pokušaj ponovo.",
      /**
       * Deleting an account (ADR-048 / AUTH-022). Immediate, with no undo and
       * no grace period, so every sentence here is written to be understood
       * BEFORE the field is reached: what goes, that it cannot be taken back,
       * and where an export would have to happen (advisory — never a
       * precondition). The warning is composed around the account's own name in
       * JSX, the `restore.replaceWarningPrefix` idiom.
       */
      delete: "Obriši",
      deleteTitle: "Brisanje naloga",
      deleteWarning: "Svi podaci naloga biće trajno obrisani. Ovo se ne može opozvati.",
      deleteExportNote:
        "Ako želiš izvoz podataka, otključaj nalog i uradi ga u Podešavanjima pre brisanja.",
      /** The typed confirmation IS the gate — there is no passcode here (an account from another device could not answer one). */
      deleteConfirmLabel: "Ime naloga za potvrdu",
      deleteConfirmPlaceholder: "Upiši tačno ime naloga",
      deleteSubmit: "Obriši nalog",
      deleteCancel: "Otkaži",
      deleteError: "Brisanje nije uspelo. Pokušaj ponovo.",
      add: "Dodaj nalog",
      back: "Nazad na izbor naloga",
    },
    recovery: {
      title: "Oporavak pristupa",
      descriptionForgot:
        "Unesi kod iz svog Kita za oporavak i postavi novi pristupni kod za ovaj uređaj.",
      descriptionOtherDevice:
        "Ovi podaci dolaze sa drugog računara ili Windows naloga, pa pristupni kod odavde ne važi. Otključaj ih Kitom za oporavak izdatim pri pravljenju naloga i postavi novi pristupni kod za ovaj uređaj.",
      codeLabel: "Kod za oporavak",
      codePlaceholder: "Upiši kod za oporavak",
      newPasscodeLabel: "Novi pristupni kod",
      newPasscodePlaceholder: "Najmanje 8 karaktera, slovo i cifra",
      confirmLabel: "Potvrdi novi pristupni kod",
      confirmPlaceholder: "Ponovi novi pristupni kod",
      submit: "Otključaj",
      back: "Nazad na otključavanje",
    },
    /** AuthErrorReason → Serbian, one sentence each; `generic` is the exhaustive-switch fallback. */
    error: {
      notInitialized: "Nalog na ovom uređaju još ne postoji.",
      alreadyInitialized: "Nalog na ovom uređaju već postoji.",
      wrongPasscode: "Pogrešan pristupni kod.",
      wrongRecoveryCode: "Kod za oporavak nije ispravan.",
      throttled: "Previše pokušaja — sačekaj da prođe vreme ispod.",
      weakPasscode: "Pristupni kod mora imati bar 8 karaktera, uz najmanje jedno slovo i jednu cifru.",
      keystoreUnavailable: "Sistemski trezor za ključeve nije dostupan na ovom Windows nalogu.",
      otherDevice: "Ovi podaci dolaze sa drugog računara ili Windows naloga — otključaj Kitom za oporavak.",
      corruptKeychain: "Fajl sa ključevima je oštećen i ne može se pročitati.",
      generic: "Radnja nije uspela. Pokušaj ponovo.",
    },
    lockAction: "Zaključaj",
    /** Sidebar, only when this device holds more than one account: locks the open one, which brings the picker back (ADR-044). */
    switchAction: "Promeni nalog",
  },

  /**
   * More than one profile per account (ADR-058): the sidebar switcher and the
   * passcode gate every switch passes (AUTH-024). „Profil“ and „nalog“ are
   * DIFFERENT axes — a nalog is a lock-screen identity with its own passcode
   * and database, a profil is a compartment inside the open one — and the copy
   * keeps the two words strictly apart: this block never says „nalog“ except
   * to name whose pristupni kod the gate asks for.
   */
  profiles: {
    /**
     * „Posao“ is three things at once, deliberately one spelling: the kind
     * marker beside a business profile's name, the display fallback for a
     * business profile still carrying the empty-name ONB-lite sentinel, and
     * therefore the text a delete of such a profile is confirmed by typing.
     */
    businessLabel: "Posao",
    switcherLabel: "Promena profila",
    createBusiness: "Novi poslovni profil",
    /**
     * The second way to the demo profile — the first is a checkbox at the end
     * of the first run. „Dodaj" rather than „Napravi": what makes it worth
     * having is the data that comes with it, not the empty profile.
     */
    createDemo: "Dodaj demo profil",
    createError: "Pravljenje profila nije uspelo. Pokušaj ponovo.",
    /**
     * The passcode gate in front of EVERY switch (AUTH-024). The error map is
     * the lock screen's own (`authErrorMessage`), never respelled here — a
     * wrong passcode is the same sentence wherever it is typed.
     */
    switchTitle: "Prelazak na profil",
    switchQuestion: "Unesi pristupni kod naloga da pređeš na ovaj profil.",
    switchPasscodeLabel: "Pristupni kod",
    switchConfirm: "Potvrdi",
    switchCancel: "Otkaži",
  },

  /** Display names for registered modules, keyed by module id. */
  modules: {
    dashboard: "Kontrolna tabla",
    tasks: "Zadaci",
    calendar: "Kalendar",
    settings: "Podešavanja",
    notes: "Beleške",
    study: "Učenje",
    priv: "Privatno",
    files: "Datoteke",
    finance: "Finansije",
    habits: "Navike",
    focus: "Fokus",
    fitness: "Fitnes",
    tools: "Alatke",
    canvas: "Tabla",
    electronics: "Elektronika",
    pro: "Stručne alatke",
  } satisfies Record<string, string>,

  dashboard: {
    /** Time-of-day salutations: jutro < 12h, dan 12–18h, veče ≥ 18h. */
    greeting: {
      jutro: "Dobro jutro",
      dan: "Dobar dan",
      vece: "Dobro veče",
    },
    /**
     * The compact day strip (DASH-009) — the one muted line under the date
     * carrying the day's live essentials. A header element, not a widget: it
     * has no title and no empty state, because a strip with nothing to say is
     * simply not drawn.
     */
    strip: {
      /**
       * Stands in for the hour on an event that has none left to name — an
       * all-day event, or a multi-day one that began before today: „danas ·
       * Godišnjica". Lower-case, like the widget's own `taskTag`/`personTag`
       * leads, because it is a label and not the start of a sentence.
       */
      dayLong: "danas",
      /**
       * A focus timer is running right now. „Fokus u toku" alone under the
       * first minute; „Fokus u toku: 25 min" once there is a duration worth
       * naming (`formatDurationMinutes` appends it).
       */
      focusRunning: "Fokus u toku",
      /**
       * The same phase, paused (UTIL slice b). Its own wording rather than a
       * suffix, because the figure beside it is FROZEN — „Fokus u toku: 25 min"
       * on a number that has stopped moving would be the one lie the strip can
       * tell.
       */
      focusPaused: "Fokus je pauziran",
    },
    /**
     * The summary band over the grid — „kako stojim?" answered before „šta mi
     * je na spisku?".
     *
     * Every figure is COUNTED from rows this page itself read, through the
     * owning module's own predicates; nothing here is estimated and nothing is
     * a projection. A figure whose module is switched off is not drawn at all
     * rather than drawn as a zero, because a calendar that is not installed has
     * not reported an empty day.
     */
    summary: {
      eventsToday: "Događaji danas",
      /** Tasks whose rok is today — TASK's own „Danas“ list, counted. */
      tasksToday: "Rokovi danas",
      /** Tasks whose rok is already past — TASK's own „Kasni“ list, counted. */
      tasksLate: "Kasni",
      focus: "Fokus danas",
      /** The unit beside the focus figure; the „Fokus“ card states the same day as a duration. */
      focusUnit: "min",
      /**
       * Drawn ONLY while a phase is actually running, which is exactly when the
       * figure is a lower bound rather than a total: the engine writes a
       * session when one is stopped, so the minutes a timer is earning right
       * now are in no row yet and cannot be counted honestly.
       */
      focusRunningNote: "bez sesije koja upravo traje",
    },
    /** Danas widget — today's events, birthdays, and tasks due today. */
    today: {
      title: "Danas",
      empty: "Nema obaveza danas 🎉",
      /**
       * The kind of a row that has no time to show, as the LEADING MARK's
       * accessible name — never as visible text.
       *
       * It used to be printed on every task row, which meant the word „zadatak"
       * ran down the card once per row and said the same thing every time. A
       * word that is constant down a list is the column's name and not its
       * data; the mark carries it now, and this copy is what a screen reader is
       * told instead of being told nothing.
       */
      taskTag: "zadatak",
      /** The same, for the birthday/anniversary mark — the one leading whose kind really does vary row to row. */
      personTag: {
        birthday: "rođendan",
        anniversary: "godišnjica",
      },
    },
    /** Predstojeći zadaci widget — the next active tasks. */
    upcoming: {
      title: "Predstojeći zadaci",
      empty: "Nema aktivnih zadataka",
    },
    /** Dokumenta koja ističu widget — documents past the reminder threshold. */
    expiring: {
      title: "Dokumenta koja ističu",
      empty: "Sva dokumenta su u redu ✅",
    },
    /**
     * Hitno i kasni widget — TASK's „Kasni“ and „Hitno“ smart lists (ADR-049)
     * read as one card. The empty line has to answer for both halves at once,
     * which is why it names them both rather than saying „nema zadataka“.
     */
    urgent: {
      title: "Hitno i kasni",
      empty: "Ništa ne kasni i ništa nije hitno",
    },
    /** Nedavne beleške widget — the notes touched most recently (NOTE's first card). */
    recentNotes: {
      title: "Nedavne beleške",
      empty: "Još nema beležaka",
    },
    /**
     * ADR-086's four cards, for four of the five modules that published none —
     * „Alatke" is the fifth and deliberately still has none, because its
     * history is a fact about this DEVICE rather than about the profile.
     *
     * Each empty line says what is MISSING rather than that something went
     * wrong: a fresh profile has no files and no boards, and that is not a
     * failure to report.
     */
    recentFiles: {
      title: "Nedavne datoteke",
      empty: "Još nema datoteka",
      /** DOC's own word for a carrier with no title — the page draws the same one. */
      untitledOwner: "Bez naslova",
    },
    recentBoards: {
      title: "Nedavne table",
      empty: "Još nema tabli",
    },
    recentCircuits: {
      title: "Nedavna kola",
      empty: "Još nema kola",
    },
    /** Not „nedavno": a profile has the toolkits it chose, so this lists them all. */
    proPacks: {
      title: "Tvoje stručne alatke",
      empty: "Nijedan paket još nije uključen",
    },
    /** FIN slice d: what the subscriptions' rules say is coming — never a row, always the schedule. */
    renewals: {
      title: "Predstojeće naplate",
      empty: "Nema naplata u ovom periodu",
    },
    /**
     * UTIL slice b's card: the phase running right now, or — when nothing is —
     * how much focus today has actually held. Two states and no third, because
     * those are the only two true things a card about a timer can say.
     */
    focus: {
      title: "Fokus",
      /** Nothing runs and nothing was focused today. An invitation, not a scolding. */
      empty: "Danas još nema fokusa",
      /** Leads the figure when nothing runs: „Danas · 1 h 15 min". */
      todayLabel: "Danas",
      /** Leads a running phase's remaining/elapsed clock. */
      runningLabel: "U toku",
      /** The same phase with its clock frozen. */
      pausedLabel: "Pauzirano",
      /** The phase is past its plan — the card says so rather than showing 00:00. */
      overrunLabel: "Prekoračeno",
    },
    /** HABIT slice c's card: today's expected habits, tickable in place. */
    habitsToday: {
      title: "Navike danas",
      /** Nothing is expected today — which is a fact about the schedule, not a scolding. */
      empty: "Danas se ne očekuje nijedna navika",
      /** The row's tick, as a label for a screen reader — the page's own wording. */
      tick: "Označi kao urađeno",
      /** The compact niz chip. The counted noun rides along (`habitFormat.ts`) — „Niz: 3" cannot say three WHAT, and for a quota habit it is weeks. */
      streakLabel: "Niz",
    },
    /**
     * FIT slice b's card: today's calories, against the calorie goal when there
     * is one. Read-only — logging a meal takes a food, an amount and a slot,
     * which is a form rather than the one bit „Navike danas" ticks in place.
     */
    fitnessToday: {
      title: "Ishrana danas",
      /** Nothing logged today. An invitation, and deliberately not a reminder that you have not eaten. */
      empty: "Danas još nema upisanih obroka",
      /** Under the figure when a calorie goal is set — „od 2.000 kcal". */
      ofGoalPrefix: "od",
      /** The chip on a day past its calorie goal. States a fact; there is no advice anywhere on this card. */
      overGoal: "Preko cilja",
    },
    /**
     * FIT slice d's card: this week's training, and the routine that has gone
     * longest without being done.
     *
     * **It is not „the next routine on the plan", because there is no plan.** A
     * routine is a SHAPE and holds nothing about when (ADR-081 §6), so the card
     * states the fact it actually knows — when that routine was last done — and
     * lets the reader draw the conclusion. Calling it „na redu" would be the
     * dashboard inventing a schedule the module deliberately does not have.
     */
    fitnessTraining: {
      title: "Trening",
      empty: "Ove nedelje još nema treninga",
      weekLabel: "Ove nedelje",
      /**
       * A session in progress outranks the count — it is the one thing on this
       * card that is happening rather than having happened. It is the whole row
       * title and carries no separate „U toku" tag beside it: the two said the
       * same thing, and one of them was sitting in the gutter every other card
       * uses for a time.
       */
      openTitle: "Trening u toku",
      sessionUnitOne: "trening",
      sessionUnitFew: "treninga",
      sessionUnitMany: "treninga",
      lastDoneLabel: "Poslednji put",
      neverDone: "Još nijednom",
    },
    /**
     * A single widget's own boundary (ADR-045 section 4): each card loads and
     * fails alone, so this copy is per-card and deliberately says nothing about
     * the page — the four cards beside it are fine.
     */
    widget: {
      error: "Podaci se ne mogu učitati.",
      retry: "Pokušaj ponovo",
    },
    /** The layout itself could not be read — the one failure that is the page's own. */
    layoutError: "Raspored kartica se ne može učitati.",
    /** Edit mode (ADR-045 section 5) — the header actions and each card's „⋯“ menu. */
    /**
     * The board with no cards on it, and the board still being read. Until
     * 2026-08-07 it had neither: an empty board drew an empty grid with no
     * word on it, and a loading one drew nothing at all — two states that
     * look identical to somebody who has just opened the app.
     */
    emptyTitle: "Na tabli još nema ničega",
    emptyDescription: "Uredi tablu i dodaj vidžet — svaki uključen modul nudi bar jedan.",
    edit: {
      enter: "Uredi",
      done: "Gotovo",
      add: "Dodaj vidžet",
      /** Names one card's „⋯“; the widget's own title is appended, since five of them share the page. */
      menuLabel: "Radnje nad karticom",
      moveUp: "Pomeri gore",
      moveDown: "Pomeri dole",
      sizeLabel: "Veličina",
      /** The three presets, named for how wide they draw — never by their stored letter. */
      size: {
        S: "Mala",
        M: "Srednja",
        L: "Velika",
      },
      remove: "Ukloni",
      /** Tooltip on the title strip, which is also the drag grip. */
      dragHint: "Prevuci da promeniš redosled",
      failed: "Promena rasporeda nije uspela. Pokušaj ponovo.",
      /**
       * Removing the last card leaves no rows, and no rows IS the default
       * arrangement — so the five come back. Said the moment it happens,
       * because nothing else on screen would explain them.
       */
      defaultRestored: "Uklonjena je poslednja kartica — vraćen je podrazumevani raspored.",
    },
    /** „Dodaj vidžet“ — the catalogue of what the enabled modules publish. */
    gallery: {
      title: "Dodaj vidžet",
      empty: "Nijedan uključen modul nema kartice.",
      add: "Dodaj",
      /** Beside a widget already on the layout; v1 places each of them once. */
      added: "već dodat",
      close: "Zatvori",
    },
    /**
     * Named dashboards (DASH-008 / ADR-055): the typographic switcher beside
     * the greeting, its popover, and the edit-mode manage actions. The default
     * board is named here in COPY ONLY — it is not a row, which is exactly why
     * it can be neither renamed nor deleted.
     */
    sets: {
      /** The default board's display name. */
      defaultName: "Početna",
      /** Accessible label on the switcher trigger; its visible content is the active board's name. */
      switcherLabel: "Izbor table",
      /** Accessible label on the „⋯“ manage menu beside the switcher (edit mode only). */
      manageLabel: "Radnje nad tablama",
      /** In the switcher list (edit mode only) AND in the manage menu: opens the name line. */
      create: "Nova tabla…",
      rename: "Preimenuj tablu",
      remove: "Obriši tablu",
      /** The inline name line the switcher row becomes — the tasks-rail idiom. */
      namePlaceholder: "Naziv table",
      createLabel: "Nova tabla",
      renameLabel: "Preimenuj tablu",
      save: "Sačuvaj",
      cancel: "Otkaži",
      /**
       * The house confirm (the recurrence-dialog recipe) for deleting a board:
       * what goes is the ARRANGEMENT — the content the cards read lives in its
       * modules and is untouched, and saying so is what makes the question
       * answerable.
       */
      deleteDialog: {
        title: "Obriši tablu",
        question:
          "Briše se samo raspored kartica na ovoj tabli. Sadržaj — zadaci, događaji, beleške — ostaje netaknut.",
        confirm: "Obriši",
        cancel: "Otkaži",
      },
      /** A set write that did not land — the layout's own `edit.failed`, for the boards. */
      failed: "Promena tabli nije uspela. Pokušaj ponovo.",
    },
    /**
     * Per-widget configuration (DASH-004 / ADR-059): the edit-mode „Podesi…"
     * entry and the form the card's ⋯ menu becomes. Field labels resolve BY
     * THE KEY a contract declares (`fields.<key>`), and a choice option by the
     * `labelKey` path it carries — both through `lookupString`, exactly as
     * widget titles do, so an option may just as well point at another
     * module's copy (the period windows reuse `tasks.smart.names`).
     */
    config: {
      open: "Podesi…",
      /** The form's way back to the card's actions, same menu, same open. */
      back: "Nazad",
      /** One label per declared key, shared across widgets on purpose. */
      fields: {
        count: "Broj redova",
        period: "Period",
        horizon: "Vremenski okvir",
        lists: "Liste zadataka",
      },
      /** The leading count option on a widget that ships uncapped: no cap at all. */
      countAll: "Sve",
      /** The empty selection over task lists — every list counts. */
      allLists: "Sve liste",
      /** The lists could not be read for the form; the card itself is untouched. */
      listsError: "Liste se ne mogu učitati.",
      period: {
        svi: "Svi zadaci",
      },
      horizon: {
        prag: "Prema podsetniku dokumenta",
        svi: "Svi predstojeći",
        "30": "30 dana",
        "60": "60 dana",
        "90": "90 dana",
      },
    },
  },

  modulePlaceholder: {
    /**
     * The guard `App.tsx`'s render chain falls through to, for a module the
     * registry knows and no branch draws.
     *
     * It named a RELEASE until 2026-09-22 — „stiže tokom v0 izgradnje" — in a
     * product that was then at 1.2.0, which is Class A in the one place a
     * version number is least likely to be re-read: user-facing copy. The sentence says what is
     * true of any such module on any build instead, and names no version, so it
     * cannot go stale the same way twice. The second half is the load-bearing
     * one — a user who meets this page has to be told the rest of the app is
     * fine, because a screen that says nothing reads as a broken application.
     */
    description:
      "Modul je u katalogu, ali njegov ekran još nije napravljen. Ostalo u aplikaciji radi normalno.",
  },

  tasks: {
    /**
     * „Priliv i odliv" — TASK's signature graphic. Two banded series over
     * weeks: how many tasks came into existence, and how many were closed.
     *
     * The caption names THREE things the drawing cannot show, and it names them
     * because each one makes the closed series a FLOOR rather than a count: a
     * deleted task leaves the list entirely (its creation disappears from
     * history too), reopening a task clears its completion instant, and a
     * recurring task stamps no completion at all until its rule is exhausted.
     * A chart that let any of those pass silently would be reporting a figure
     * it knows is short.
     */
    chart: {
      heading: "Priliv i odliv",
      createdLabel: "Nastalo",
      completedLabel: "Zatvoreno",
      caption:
        "Po nedelji: koliko je zadataka nastalo i koliko ih je zatvoreno. „Zatvoreno“ je donja granica — obrisan zadatak nestaje sa istorijom, ponovo otvoren zadatak gubi datum završetka, a zadatak koji se ponavlja upisuje završetak tek kada se serija istroši.",
      descriptionLead: "Priliv i odliv po nedelji",
      weekUnitOne: "nedelju",
      weekUnitFew: "nedelje",
      weekUnitMany: "nedelja",
      emptyReason: "Grafik se crta čim postoji bar jedan zadatak sa datumom nastanka.",
    },
    /**
     * The band above the rows: „how am I doing", answered before „what is on
     * the list". A page holding sixty rows cannot be read row by row, and the
     * question somebody arrives with is not about any single one of them.
     *
     * Every figure is counted from the tasks this page has actually loaded —
     * the whole profile, never the rail's current selection, exactly as the
     * chart beneath it is. THE LAST ONE IS A FLOOR: `completedAt` is the only
     * evidence a closure leaves, and it is lost three ways (a deleted task
     * takes its history with it, reopening one clears the instant, a recurring
     * one stamps nothing until its rule is exhausted — see `chart.caption`).
     * So it carries a note saying so; a derived number whose source is lossy
     * reads as a total unless the drawing says otherwise.
     */
    summary: {
      open: "Otvoreno",
      today: "Za danas",
      overdue: "Kasni",
      closed: "Zatvoreno",
      /** The window „Zatvoreno“ counts, set beside the figure rather than folded into its label. */
      closedUnit: "za 7 dana",
      /** One line under that figure — the whole reason is in `chart.caption` right beneath it. */
      closedNote: "Donja granica",
    },
    quickAddPlaceholder: "Novi zadatak — upiši i pritisni Enter",
    quickAddSubmit: "Dodaj",
    /**
     * The disclosure over the capture form’s detail fields (rok, prioritet,
     * lista, sekcija, oznake, podsetnici). They used to be permanently open
     * above the list, which is roughly half the viewport spent on a form
     * that most captures never touch — a title and Enter is the whole act.
     * Editing an existing task opens them regardless: that IS the details.
     */
    detailsShow: "Detalji",
    detailsHide: "Sakrij detalje",
    /** What the marker on a CLOSED disclosure means, for a reader who cannot see a bullet. */
    detailsSet: "Neka polja su popunjena",
    quickAddLabel: "Novi zadatak",
    viewLabel: "Prikaz",
    viewList: "Lista",
    viewKanban: "Tabla",
    viewCards: "Kartice",
    viewCalendar: "Kalendar",
    /**
     * The per-view controls above the rows (ADR-050): what the shown scope is
     * ordered by, what a board's columns come from, and what is filtered out.
     * Each is remembered per LIST and per VIEW, so a board grouped by sekcija
     * and a list sorted by rok can both be true of the same list at once.
     */
    controls: {
      /** Names the row of selects for a screen reader — „Prikaz“ alone is the toggle beside it. */
      regionLabel: "Podešavanja prikaza",
      sortLabel: "Redosled",
      /**
       * The first option, and the one a list opens on: no sort at all, so the
       * rows stay in the order the user dragged them into. It is a real choice,
       * not an absence — which is why it is worded rather than left blank.
       */
      sortManual: "Ručni redosled",
      /**
       * The sortable fields. Deliberately NOT status/prioritet: the views
       * engine collates a select field by its stored VALUE, which would order
       * prioritet as high–low–medium–none — a sort that looks like a feature
       * and behaves like an accident. Grouping a board by them is what answers
       * that question honestly.
       */
      sortField: {
        title: "Naslov",
        dueDate: "Rok",
        startDate: "Počinje",
        completedAt: "Završen",
        done: "Urađeno",
      },
      groupLabel: "Grupisanje",
      group: {
        status: "Status",
        priority: "Prioritet",
        section: "Sekcija",
      },
      statusLabel: "Status",
      statusAll: "Svi statusi",
      priorityLabel: "Prioritet",
      priorityAll: "Svi prioriteti",
      /**
       * The board's null column when it is grouped by sekcija: the list itself,
       * where a task with no heading lives. Always drawn, empty or not — it is a
       * real place to drop something back into, not a leftovers pile.
       */
      bodyColumn: "Telo liste",
      /** The card's own „⋯“ menu — the keyboard way to do what the drag does. */
      cardMenuLabel: "Premesti karticu",
      moveLeft: "Pomeri levo",
      moveRight: "Pomeri desno",
      /**
       * The board's column configuration (ADR-060). The „Kolone“ popover lists
       * every column of the current grouping — hidden ones included, so hiding
       * is always reversible — and the chip states how many the board is not
       * drawing, because a column that quietly vanished would read as lost
       * work. The rows' ↑/↓ move within the popover's top-to-bottom list, which
       * IS the board's left-to-right order.
       */
      columns: "Kolone",
      columnsLabel: "Kolone table",
      /** The column head's own „⋯“ menu; rendered with the column's title after it. */
      columnMenuLabel: "Radnje nad kolonom",
      hideColumn: "Sakrij kolonu",
      columnUp: "Pomeri gore",
      columnDown: "Pomeri dole",
      /** The quiet chip beside the controls; rendered with the count after it: „Skrivene kolone: 2“. */
      hiddenColumns: "Skrivene kolone:",
      /**
       * Shown in place of the rows when the view's own filter matches nothing.
       * Its own sentence rather than the oznake one: the two hide rows for
       * different reasons, and an answer that named the wrong filter would send
       * the user to clear a control that is not the one holding the rows back.
       */
      filterEmptyDescription: "Nijedan zadatak ne odgovara izabranom filteru.",
    },
    /** The month grid over the selected list (ADR-050) — one bar per task, between „Počinje“ and „Rok“. */
    calendar: {
      regionLabel: "Kalendar zadataka",
      prevMonth: "Prethodni mesec",
      nextMonth: "Sledeći mesec",
      today: "Danas",
      /** Heading of the strip under the grid: a task with no rok has no day to sit on, and dragging it onto one is what gives it a rok. */
      undatedLabel: "Bez roka",
      /** Trailing word of the muted „+3 još“ a day shows when its bars outrun the lanes. */
      moreSuffix: "još",
    },
    emptyTitle: "Nema zadataka",
    emptyDescription:
      "Zapiši prvi zadatak u polje iznad — dovoljno je ime i Enter.",
    loadError: "Zadaci se trenutno ne mogu učitati. Pokušaj ponovo kasnije.",
    editLabel: "Izmeni zadatak",
    deleteLabel: "Obriši zadatak",
    /** The per-row „⋯“ menu: tags to attach plus „Sačuvaj kao šablon“, so its name is the row, not one of them. */
    rowMenuLabel: "Radnje nad zadatkom",
    deletedNotice: "Zadatak obrisan",
    undo: "Vrati",
    dismiss: "Zatvori",
    /** The add/edit form's own save failing at the store/IPC boundary. */
    saveError: "Zadatak nije sačuvan. Pokušaj ponovo.",
    /**
     * Generic fallback for every task write outside the form and outside the
     * rail/tag/dependency sections above (each of which reports its own
     * failure): complete, toggle, move, re-prioritise, delete, undo, a
     * subtask — the HABIT page's own `actionError` shape.
     */
    actionError: "Radnja nije uspela. Pokušaj ponovo.",
    /**
     * A due date recognised in the quick-add line itself (TASK-007) — "Kupi
     * mleko sutra". The chip shows what will be saved before Enter is pressed,
     * so the reading is always correctable rather than surprising.
     */
    quickDate: {
      /** Names the live region that announces the recognised date. */
      regionLabel: "Prepoznat rok",
      /** Tooltip on the chip — says what happens on save. */
      chipTitle: "Rok prepoznat iz naslova — primeniće se pri čuvanju",
      dismissLabel: "Zanemari prepoznat rok",
    },
    /** Detail fields of the shared add/edit form (the quick-add line stays the fast path). */
    dueDateLabel: "Rok",
    /**
     * The day a task becomes actionable (TASK-001), beside „Rok“ on the same
     * form row. „Počinje“ rather than „Početak“: the field answers *when* it
     * starts, and the smart lists read it as exactly that — a task that starts
     * after today is not yet something to do today.
     */
    startDateLabel: "Počinje",
    priorityLabel: "Prioritet",
    save: "Sačuvaj",
    cancel: "Otkaži",
    /**
     * The "Podsetnik" chip row on the task form (ADR-028) — the same shape as
     * `calendar.reminders`, counted in DAYS rather than minutes, because a
     * task's deadline is a day. Every chip's label is built from these by one
     * formatter, so the fixed ladder and an offset loaded from a stored task
     * read the same way: "Na dan roka", "1 dan ranije", "3 dana ranije".
     */
    reminders: {
      label: "Podsetnik",
      /** Shown in place of the chips while the form has no (valid) rok to count back from — the store refuses that combination. */
      needsDate: "Postavi rok da bi podsetnik bio moguć.",
      /** The zero-day chip: the reminder fires on the due day itself, at the morning hour. */
      atDue: "Na dan roka",
      /** Trailing word of every non-zero lead time; the counted day noun takes `dayUnit`. */
      before: "ranije",
    },
    /** Per-row „+” and the inline line it opens (TASK-008). A subtask starts as a bare name; rok/prioritet/ponavljanje are set afterwards through the ✎ form, like on any task. */
    addSubtaskLabel: "Dodaj podzadatak",
    subtaskPlaceholder: "Novi podzadatak — upiši i pritisni Enter",
    /** Tooltip on the `2/5` roll-up chip; the number alone cannot say what it counts. */
    subtaskProgressTitle: "Završeni podzadaci",
    /**
     * The open-subtasks question (PRD 03 §4). Completing a parent reaches rows
     * the user did not tick, so it is asked rather than assumed — no default,
     * and Otkaži is the way out that changes nothing.
     */
    subtasks: {
      title: "Podzadaci",
      question: "Zadatak ima otvorene podzadatke.",
      completeAll: "Završi i podzadatke",
      completeOne: "Završi samo zadatak",
      cancel: "Otkaži",
    },
    /**
     * Pregledi (ADR-049) — the five VIRTUAL lists the rail draws ABOVE „Liste“.
     * They are queries, not places: nothing is filed into one, which is why the
     * section has no „Nova …“ action and why its rows carry neither the hover
     * cluster nor a drop target.
     *
     * The names are flat-keyed by the wire id, the way `status` and `priority`
     * below are — one label per value, resolved by lookup rather than by a
     * switch that could go stale when a sixth view is added.
     */
    smart: {
      /** Heading of the rail's first section, above „Liste“. */
      heading: "Pregledi",
      /** Names the group of view rows for a screen reader — „Pregledi“ alone says little out of context, exactly as with `lists.railLabel`. */
      regionLabel: "Pregledi zadataka",
      names: {
        danas: "Danas",
        sledecih7: "Sledećih 7 dana",
        hitno: "Hitno",
        kasni: "Kasni",
        zavrseno: "Završeno",
      } satisfies Record<SmartListId, string>,
      /**
       * Each view's own empty state. Calm statements of fact, never the list's
       * „zapiši prvi zadatak“ invitation: there is no typing into a view, so an
       * invitation here would point at a field that is not on screen.
       */
      empty: {
        danas: "Nema zadataka za danas.",
        sledecih7: "Nema zadataka u narednih sedam dana.",
        hitno: "Nema zadataka visokog prioriteta.",
        kasni: "Ništa ne kasni.",
        zavrseno: "Još nijedan zadatak nije završen.",
      } satisfies Record<SmartListId, string>,
      /** Tooltip on the muted count beside „Danas“ and „Kasni“ — a bare number cannot say what it counts. */
      countTitle: "Broj zadataka u pregledu",
      /**
       * „Završeno“ is bounded (ADR-039 §4): the first 100, then „Prikaži još“.
       * Worded as „Prikazano prvih 100 od 340“ — the counts are stated after
       * the words, where Serbian owes no numeral agreement.
       */
      shownPrefix: "Prikazano prvih",
      shownOf: "od",
      showMore: "Prikaži još",
      /** The collapsed disclosure beneath „Završeno“ holding everything past the archive boundary — drawn as „Arhiva (N)“, the count by the page. */
      archiveTitle: "Arhiva",
      /**
       * „Završeno“'s empty state once every finished task has aged into the
       * archive: „Sve završeno starije od 30 dana je u arhivi.“ The day count
       * (TASK_ARCHIVE_AFTER_DAYS) is stated between the halves at the call
       * site, and „dana“ after „od“ holds for any count the constant could
       * become — genitive, so 21, 30 and 60 all read the same.
       */
      allArchivedPrefix: "Sve završeno starije od",
      allArchivedSuffix: "dana je u arhivi.",
      /** Tooltip on the row chip that names a task's list — inside a view the rows come from every list at once. */
      listChipTitle: "Lista kojoj zadatak pripada",
    },
    /**
     * Dated group headings over the rows. Sixty rows in one run cannot be
     * scanned; the same sixty in six dated runs of ten can, and the heading is
     * what makes each run answerable at a glance.
     *
     * Only three days get a WORD. Every other day within a week of today is
     * drawn as its own weekday and date by `formatQuickDate`, so a heading is
     * never a relative phrase the reader has to count backwards from („za 3
     * nedelje“ says nothing a calendar can be checked against).
     *
     * Past that week the rows collapse into „Ranije“ and „Kasnije“ — one
     * heading each, not one per day. A day-per-heading rule reads well on
     * „Sledećih 7 dana“ and falls apart on „Kasni“, where thirty overdue tasks
     * are spread over four months and would take thirty headings.
     *
     * The headings are only drawn where the ROW ORDER is itself by that date —
     * a view's derived order, or a list sorted by rok/počinje/završen. Under a
     * manual order they would cut the arrangement the user made into pieces.
     */
    groups: {
      today: "Danas",
      tomorrow: "Sutra",
      yesterday: "Juče",
      /**
       * The two long tails, worded so each holds for any banded date: a rok
       * more than a week gone is late and a completion more than a week gone is
       * old, and „ranije“ is true of both without the heading needing to know
       * which field it is drawn over.
       */
      earlier: "Ranije",
      later: "Kasnije",
      /**
       * The trailing run: rows the banded date is simply not set on.
       *
       * „Bez datuma“ rather than „Bez roka“, and that is not pedantry: the same
       * heading is drawn over a list sorted by „Završen“, where every unfinished
       * task lands in this band — calling them „bez roka“ would state something
       * about their deadlines that the band knows nothing about.
       */
      noDate: "Bez datuma",
      /** Tooltip on the count beside a heading — a bare number cannot say what it counts. */
      countTitle: "Broj zadataka u grupi",
    },
    /**
     * The list rail and the sections inside a list (TASK-004 / ADR-029).
     *
     * The Inbox is deliberately NOT named here: it is a stored, renamable row
     * like any other list, so the rail renders `list.name` and the delete
     * dialog's "move them there" choice names it from the same row — a
     * hard-coded „Inbox“ would go stale the moment the founder renames it to
     * „Prijemno“.
     */
    lists: {
      /** Heading above the rail; the rail's own accessible name is a touch longer, since „Liste“ alone says little out of context. */
      title: "Liste",
      railLabel: "Liste zadataka",
      newList: "Nova lista",
      newSubList: "Nova podlista",
      listNamePlaceholder: "Ime liste",
      renameListLabel: "Preimenuj listu",
      deleteListLabel: "Obriši listu",
      /** The rail row's own „⋯“ menu, which holds the two ordering actions below. */
      listMenuLabel: "Radnje nad listom",
      /** The section heading's „⋯“ menu — the same two actions, one scope in. */
      sectionMenuLabel: "Radnje nad sekcijom",
      /**
       * Shared by both menus, because it is one gesture in two scopes: a list
       * steps among its siblings, a section within its list. Always both, the
       * one at the end of its scope simply disabled — a menu whose items come
       * and go is one the user has to re-read every time.
       */
      moveUp: "Pomeri gore",
      moveDown: "Pomeri dole",
      save: "Sačuvaj",
      cancel: "Otkaži",
      /** Shown under the rail when a list/section action failed — the inline editor stays open with what was typed still in it. */
      actionError: "Radnja nije uspela. Pokušaj ponovo.",
      deletedNotice: "Lista obrisana",
      /**
       * What to do with the tasks of a list being deleted. The two choices lose
       * different things, so there is no default and no primary button; Otkaži
       * is the way out that changes nothing.
       */
      dialog: {
        title: "Brisanje liste",
        question: "Šta sa zadacima iz ove liste?",
        /** Followed by the Inbox's own stored name in quotes — see the block comment above. */
        moveToInboxPrefix: "Premesti u",
        deleteTasks: "Obriši i zadatke",
        cancel: "Otkaži",
      },
      /** The add/edit form's heading select, shown only where the list has headings to pick. */
      sectionLabel: "Sekcija",
      noSection: "Bez sekcije",
      newSection: "Nova sekcija",
      sectionNamePlaceholder: "Ime sekcije",
      renameSectionLabel: "Preimenuj sekciju",
      deleteSectionLabel: "Obriši sekciju",
      /**
       * A heading is a user-named container and the delete is HARD, so it takes
       * the typed-name confirmation the folder rail takes. The warning states
       * the reassuring half plainly, because it is the half that decides the
       * answer: the tasks are not deleted with it, they move to the list body.
       */
      deleteSectionDialog: {
        title: "Brisanje sekcije",
        warning:
          "Sekcija se trajno briše. Zadaci iz nje se premeštaju u telo liste — nijedan se ne gubi.",
        confirmLabel: "Naziv sekcije za potvrdu",
        confirmPlaceholder: "Upiši tačan naziv",
        submit: "Obriši",
        cancel: "Otkaži",
      },
    },
    /**
     * Oznake (migration 023) — the NOTE module's tag wording one module over,
     * key for key with `strings.notes`' tag block (`tagsLabel` → `label`,
     * `tagNamePlaceholder` → `namePlaceholder`, `tagError` → `actionError`, …),
     * unprefixed because the block itself already says „tag“. Identical Serbian
     * where the sentence is identical: a label is a label whichever entity
     * carries it, so the two modules must not word it two ways.
     */
    tags: {
      label: "Oznake",
      newTag: "Nova oznaka",
      namePlaceholder: "Naziv oznake",
      rename: "Preimenuj",
      /** Accessible name of the rename field — the action in full, like `lists.renameSectionLabel`; the menu item itself stays the short „Preimenuj“. */
      renameLabel: "Preimenuj oznaku",
      delete: "Obriši oznaku",
      /** The rail chip's own „⋯“ menu (rename/delete one tag). */
      menuLabel: "Radnje nad oznakom",
      // „Oznake zadatka" named a per-task „⋯" menu that no longer exists: tag
      // attachment was folded into the generic row menu, which announces itself
      // as `rowMenuLabel` and holds the tag checkboxes inside it. The key
      // outlived the menu and its own comment kept describing it, which is how
      // a copy table starts documenting an app that is not there.
      filterLabel: "Filter po oznakama",
      clearFilter: "Poništi",
      actionError: "Radnja nad oznakom nije uspela. Pokušaj ponovo.",
      /** The one refusal a user can act on — a rename onto a taken name. NOTE's rail says the same about its own tags. */
      duplicate: "Oznaka sa tim imenom već postoji.",
      /**
       * NOTE's own `deleteTagDialog`, one module over and for the identical
       * reason: `taskTagStore.delete` is a HARD delete whose links go with it
       * through the schema's CASCADE, and there is no restore endpoint behind
       * it. This rail had been deleting on a single click of a danger menu item
       * while the note rail asked — the same act, two answers.
       */
      deleteTagDialog: {
        title: "Brisanje oznake",
        warning:
          "Oznaka se trajno briše i uklanja sa svakog zadatka koji je nosi. Zadaci sami ostaju netaknuti.",
        confirmLabel: "Naziv oznake za potvrdu",
        confirmPlaceholder: "Upiši tačan naziv",
        submit: "Obriši",
        cancel: "Otkaži",
      },
      /** Shown in place of the rows when the tag filter matches nothing in the selected list. */
      filterEmptyDescription: "Nijedan zadatak ne odgovara izabranim oznakama.",
    },
    /**
     * Prilozi (migration 024) — files hung off a task. The NOTE panel's wording
     * one module over, and deliberately the SAME Serbian wherever the sentence
     * is the same: „Prilozi“, „Priloži datoteku“, „Otvori“, „Sačuvaj kao…“ mean
     * exactly what they mean on a note, and two phrasings for one action would
     * only be two things to learn.
     *
     * Only the strings a task genuinely words differently live here: the
     * section is visible only while EDITING (a task that has not been created
     * has no id to hang a file off), the file picker is a native dialog rather
     * than a drop zone, and the per-row chip counts.
     */
    attachments: {
      title: "Prilozi",
      attach: "Priloži datoteku",
      /** „Pregledaj" (DOC / ADR-064) — the NOTE panel's word, offered only on rows the app can render itself. */
      preview: "Pregledaj",
      open: "Otvori",
      saveAs: "Sačuvaj kao…",
      remove: "Ukloni prilog",
      /** The per-attachment „⋯“ menu, mirroring `tags.menuLabel`'s shape. */
      menuLabel: "Radnje nad prilogom",
      /** Shown when the picker refused one or more files for size. The 50 MB bound is the store's own (`MAX_TASK_ATTACHMENT_BYTES`), stated here as a plain fact rather than counted files — the count varies, the limit does not. */
      tooLarge: "Datoteke veće od 50 MB se ne mogu priložiti.",
      actionError: "Radnja nad prilogom nije uspela. Pokušaj ponovo.",
      /**
       * The muted row/card chip: „1 prilog“ / „3 priloga“ — Serbian numeral
       * agreement via `dayUnit`, the same two-form rule every other counted
       * noun in this file uses.
       */
      chipUnitOne: "prilog",
      chipUnitMany: "priloga",
      /** Tooltip on that chip; the number alone cannot say what it counts. */
      chipTitle: "Priloženih datoteka",
    },
    /**
     * Šabloni (ADR-035 / TASK-010) — a saved task shape, captured from a row's
     * „⋯“ menu and applied from the toolbar. Worded like `notes.template*`
     * where the sentence is the same, since it is the same idea one module
     * over: `templateSaveAs` → `saveAs`, `templateNamePlaceholder` →
     * `namePlaceholder`, `templateError` → `actionError`. The block already
     * says „šablon“, so nothing inside it repeats the word.
     */
    templates: {
      /** The toolbar button, and the heading inside both popovers. */
      title: "Šabloni",
      /** Accessible name of the toolbar button's menu. */
      menuLabel: "Šabloni zadataka",
      /** Shown in place of the list when the profile has no templates yet. */
      empty: "Još nemaš šablone zadataka.",
      /** The action in a task row's „⋯“ menu. */
      saveAs: "Sačuvaj kao šablon",
      namePlaceholder: "Naziv šablona",
      /** Accessible name of the name field — the action in full, like `lists.renameSectionLabel`. */
      nameLabel: "Sačuvaj zadatak kao šablon",
      /** Said BEFORE the fact, not after: saving under an existing name is how a template is edited. */
      overwriteNote: "Postojeći naziv se zamenjuje.",
      /** Tooltip on a template's name in the list — the click applies it. */
      applyTitle: "Napravi zadatak od ovog šablona",
      delete: "Obriši šablon",
      actionError: "Radnja nad šablonom nije uspela. Pokušaj ponovo.",
    },
    /**
     * Zavisnosti (migration 029 / ADR-037) — "this one first". The block lives
     * in the EDIT form only: a task that does not exist yet has no id for the
     * other end of an edge to name.
     *
     * „Blokiran“ is a statement about the task, not an instruction: completing a
     * blocked task is never refused, the chip only says the order it was put in
     * is not finished yet — which is why its tooltip explains rather than warns.
     */
    dependencies: {
      label: "Zavisnosti",
      /** The picker's trigger, and its accessible name — a named action, not a row's „⋯“ overflow. */
      add: "Dodaj zavisnost",
      /** Placeholder and accessible name of the picker's filter field. */
      searchPlaceholder: "Pretraži zadatke",
      /** Shown in the picker when the profile has no task that could be a condition (all done, or all downstream of this one). */
      pickerEmpty: "Nema zadatka koji može biti uslov.",
      /** Shown in the picker when what was typed matches nothing among the candidates. */
      pickerNoMatches: "Nema rezultata.",
      /** Stands in for the list while the edited task waits on nothing. */
      none: "Ovaj zadatak ne čeka ni na jedan drugi.",
      removeLabel: "Ukloni zavisnost",
      /** Beside a blocker that is already finished — the edge is real, it just no longer holds anything up. */
      doneHint: "završeno",
      /** The row/card chip on a task at least one of whose blockers is still open. */
      blockedChip: "Blokiran",
      blockedChipTitle: "Čeka zadatak koji još nije završen",
      actionError: "Radnja nad zavisnošću nije uspela. Pokušaj ponovo.",
    },
    /**
     * Izbor (ADR-038) — the batch mode over the list view: pick rows, then move,
     * re-prioritise, re-date or delete them in one go.
     *
     * „Izabrano: 5“ rather than a counted noun on purpose: Serbian numerals take
     * three forms (1 / 2–4 / 5+) while `dayUnit` knows two, and a picked-task
     * count is freely variable — so the number is stated after a colon, where no
     * agreement is owed. „Obrisano zadataka: 5“ works the same way: the genitive
     * plural is the invariant form after a stated count.
     */
    bulk: {
      /** The toolbar toggle that enters and leaves the mode; active state is typographic, like the view toggle beside it. */
      mode: "Izbor",
      /** Names the action bar that appears once at least one row is picked. */
      regionLabel: "Radnje nad izabranim zadacima",
      /** The per-row pick control that replaces the drag grip while the mode is on. */
      pickLabel: "Izaberi zadatak",
      /** Followed by the number of rows picked. */
      selected: "Izabrano:",
      move: "Premesti…",
      /** Header inside the move menu — it lists the rail's lists, indented as the rail draws them. */
      moveLabel: "Premesti u listu",
      priority: "Prioritet…",
      priorityLabel: "Postavi prioritet",
      due: "Rok…",
      dueLabel: "Postavi rok",
      clearDue: "Ukloni rok",
      delete: "Obriši",
      /**
       * Shown in the action bar when the store refused the batch. It names the
       * one refusal a user can actually run into — clearing a rok that a
       * repetition or a reminder counts from — because nothing was changed and
       * the way out is to adjust the selection.
       */
      actionError:
        "Radnja nije uspela — ništa nije promenjeno. Rok se ne može ukloniti zadatku koji se ponavlja ili ima podsetnik.",
      /** Followed by the number of tasks the batch delete removed; the offer itself is the same one-slot undo a single delete uses. */
      deletedNotice: "Obrisano zadataka:",
    },
    /** Kanban column titles, keyed by task status value (labels are presentation). */
    status: {
      todo: "Za rad",
      doing: "U toku",
      done: "Završeno",
    },
    /**
     * Priority labels. `none` is the form select's own "no priority" option and
     * never becomes a chip — the row rendering skips that value entirely.
     */
    priority: {
      none: "Bez prioriteta",
      low: "Nizak",
      medium: "Srednji",
      high: "Visok",
    },
  },

  /**
   * Recurrence (ADR-024) — shared by the task form and the event form, so it
   * belongs to neither. The custom controls are deliberately LABELLED FIELDS
   * ("Na svakih: 3") rather than a sentence ("na svaka 3 dana"): Serbian
   * numerals take three forms (1 / 2–4 / 5+) while `dayUnit` knows two, so a
   * counted noun beside a freely typed number would be wrong at some counts.
   * The one counted phrase that survives is "Posle N ponavljanja", where the
   * genitive "ponavljanja" is the correct form at every N.
   */
  recurrence: {
    fieldLabel: "Ponavljanje",
    /** Shown in place of the controls while the form has no (valid) date to phase a rule from. */
    needsDate: "Postavi datum da bi ponavljanje bilo moguće.",
    /** The preset select, in menu order; `custom` opens the fields below it. */
    preset: {
      none: "Ne ponavlja se",
      daily: "Svakog dana",
      weekdays: "Radnim danima",
      weekly: "Svake nedelje",
      monthly: "Svakog meseca",
      yearly: "Svake godine",
      custom: "Prilagođeno…",
    },
    freqLabel: "Učestalost",
    freq: {
      daily: "Dnevno",
      weekdays: "Radnim danima",
      weekly: "Nedeljno",
      monthly: "Mesečno",
      yearly: "Godišnje",
    },
    intervalLabel: "Na svakih",
    daysLabel: "Dani",
    /** Monday-first, matching `RecurrenceWeekday`'s own 0 = Monday indexing. */
    weekdayShort: ["Pon", "Uto", "Sre", "Čet", "Pet", "Sub", "Ned"],
    weekday: ["ponedeljak", "utorak", "sreda", "četvrtak", "petak", "subota", "nedelja"],
    monthlyModeLabel: "Način",
    monthlyModeDate: "Po datumu",
    monthlyModeOrdinal: "Po danu u nedelji",
    monthDayLabel: "Dan u mesecu",
    ordinalLabel: "Redosled",
    /**
     * Keyed by `RecurrenceOrdinal` as a string; `-1` is the month's last such
     * weekday. Rendered as its own select beside the weekday's, never joined
     * into a phrase — "prvi" agrees with utorak but not with sreda.
     */
    ordinal: {
      "1": "prvi",
      "2": "drugi",
      "3": "treći",
      "4": "četvrti",
      "-1": "poslednji",
    } satisfies Record<string, string>,
    weekdayLabel: "Dan",
    endLabel: "Završetak",
    endNever: "Nikad",
    endUntil: "Do datuma",
    endCount: "Posle N ponavljanja",
    endUntilLabel: "Datum završetka",
    endCountLabel: "Broj ponavljanja",
    endCountUnit: "ponavljanja",
    /** Accessible name of the ↻ marker on a recurring row/chip. */
    marker: "Ponavlja se",
    /** After completing one occurrence of a recurring task; the next date follows. */
    nextOccurrence: "Sledeći put:",
    /**
     * The three-way scope dialog. PRD 04: editing or deleting one occurrence of
     * a series never picks a scope silently, so this is a real choice with no
     * default — Otkaži is the only way out that changes nothing.
     */
    scope: {
      title: "Ponavljajući događaj",
      questionEdit: "Na koje termine se izmena odnosi?",
      questionDelete: "Koje termine treba obrisati?",
      this: "Samo ovaj",
      future: "Ovaj i budući",
      all: "Svi",
      cancel: "Otkaži",
    },
  },

  notes: {
    /**
     * „Ritam pisanja" — NOTE's signature graphic: a year of days, shaded by how
     * much was written or touched on each.
     *
     * It is honestly a FLOOR and the caption says so. A note keeps two instants
     * — when it was made and when it was last changed — and nothing in
     * between, so a note edited on nine different days contributes exactly two
     * shaded squares. There is no third instant to read and inventing one would
     * mean claiming edits that were never recorded.
     *
     * A word count is deliberately absent from this and from everywhere else:
     * the text of a note never leaves its own document, and a library-wide
     * figure would mean opening and replaying every note in the profile to
     * print one number.
     */
    chart: {
      heading: "Ritam pisanja",
      caption:
        "Jedan kvadrat je jedan dan. Broji se dan kada je beleška napravljena i dan njene poslednje izmene — ranije izmene se ne pamte, pa je ovo najmanje što se desilo, ne tačan zbir.",
      descriptionLead: "Ritam pisanja",
      descriptionDays: "dana sa upisom",
      legendSome: "Jedna ili dve",
      legendMore: "Tri do pet",
      legendMost: "Šest i više",
      emptyReason: "Ritam se crta čim postoji bar jedna beleška.",
      /**
       * The three figures in the band the rhythm is drawn beside. Two are
       * exact counts of rows the page genuinely loaded; the middle one is a
       * FLOOR, and its `note` says so in the same breath — a lower bound set
       * in 24px type reads as a total unless the drawing itself objects.
       */
      statNotes: "Beleške",
      statDays: "Dana sa upisom",
      /** Reads as „47 od 182" — the denominator is how many days are actually drawn, not the window's nominal length. */
      statDaysOf: "od",
      statDaysNote: "Najmanje toliko — pamte se dan nastanka i dan poslednje izmene, ništa između.",
      statPinned: "Zakačeno",
    },
    newNote: "Nova beleška",
    untitled: "Bez naslova",
    listEmptyTitle: "Nema beležaka",
    listEmptyDescription:
      "Kreiraj prvu belešku dugmetom iznad — piše se u editoru sa desne strane.",
    noSelectionTitle: "Nijedna beleška nije izabrana",
    noSelectionDescription: "Izaberi belešku sa leve strane ili kreiraj novu.",
    placeholder: "Počni da pišeš, ili otkucaj „/“ za komande…",
    deleteLabel: "Obriši belešku",
    deletedNotice: "Beleška obrisana",
    /**
     * „Dupliraj" (NOTE-010). The copy's own „ (kopija)" mark is written into
     * the document by the main process and therefore lives there
     * (`main/noteDuplicate.ts`) — main cannot import this file, the same split
     * `notificationStrings.ts` documents.
     */
    duplicate: "Dupliraj",
    duplicateError: "Dupliranje beleške nije uspelo. Pokušaj ponovo.",
    duplicateTooLarge: "Beleška je prevelika da bi se duplirala odjednom.",
    undo: "Vrati",
    dismiss: "Zatvori",
    loadError: "Beleške se trenutno ne mogu učitati. Pokušaj ponovo kasnije.",
    editorLoadError: "Beleška se ne može učitati. Pokušaj ponovo.",
    saveError: "Čuvanje beleške nije uspelo — pokušaćemo ponovo pri sledećoj izmeni.",
    saveTooLarge:
      "Deo beleške je prevelik da bi se sačuvao odjednom. Podeli veliki umetnuti sadržaj na manje delove.",
    /** Organizer (slice a3b): the folder tree, filters, per-note pin/move. */
    allNotes: "Sve beleške",
    unfiled: "Bez fascikle",
    foldersLabel: "Fascikle",
    newFolder: "Nova fascikla",
    newSubfolder: "Nova podfascikla",
    renameFolder: "Preimenuj",
    recolorFolder: "Promeni boju",
    /** Heading over the folder's own move menu — the note row's „Premesti u fasciklu", one axis up. */
    moveFolderTo: "Premesti u",
    /** Out of every folder, to the top of the tree — a folder's „Bez fascikle". */
    folderToRoot: "Na vrh",
    deleteFolder: "Obriši fasciklu",
    noColor: "Bez boje",
    folderNamePlaceholder: "Naziv fascikle",
    folderMenuLabel: "Radnje nad fasciklom",
    /** Folder preferences (ADR-036): the default template submenu + the quick-capture toggle. */
    folderTemplate: "Podrazumevani šablon",
    folderTemplateNone: "Bez šablona",
    folderCaptureDefault: "Fascikla za brzi unos",
    folderCaptureDefaultOn: "Nova beleška bez konteksta ide ovde.",
    moveToFolder: "Premesti u fasciklu",
    noteMenuLabel: "Više opcija",
    pin: "Zakači",
    unpin: "Otkači",
    /**
     * The per-folder view toggle (NOTE-002). The same two words the TASK
     * toggle uses for the same two shapes — one vocabulary across the app —
     * keyed by the stored value, so the toggle names a shape by looking it up
     * rather than by a parallel list that could fall out of step with the set.
     */
    viewLabel: "Prikaz",
    viewNames: {
      list: "Lista",
      cards: "Kartice",
    },
    /**
     * The note list's sticky group headings. A pane of fifty rows run flat is
     * not a list, it is a wall, and these are the cuts through it.
     *
     * The store hands the rows over ordered `pinned DESC, updated_at DESC`, so
     * these buckets are already contiguous — grouping only ever inserts a
     * heading, it never reorders a row.
     *
     * Anything older than „ovog meseca" is named by its OWN month („jul
     * 2026."), formatted from the date through `Intl` rather than written out
     * here: a hand-typed list of twelve Serbian month names is a second
     * calendar to keep in step with the one `Intl` already has.
     */
    listGroups: {
      pinned: "Zakačeno",
      today: "Danas",
      yesterday: "Juče",
      week: "Poslednjih 7 dana",
      month: "Ovog meseca",
    },
    save: "Sačuvaj",
    cancel: "Otkaži",
    folderError: "Radnja nad fasciklom nije uspela. Pokušaj ponovo.",
    /**
     * The typed-name confirmation before a folder delete (no undo exists for
     * this write, unlike a note's — see `TypedConfirmDialog`, shared outright
     * with PRIV's own hard-delete). Nothing inside the folder is lost: its
     * subfolders and notes are promoted to its own parent first, which is
     * exactly what the warning says.
     */
    deleteFolderDialog: {
      title: "Brisanje fascikle",
      warning:
        "Fascikla se trajno briše. Njene podfascikle i beleške se premeštaju u nadređenu fasciklu — ništa od toga se ne gubi.",
      confirmLabel: "Naziv fascikle za potvrdu",
      confirmPlaceholder: "Upiši tačan naziv",
      submit: "Obriši",
      cancel: "Otkaži",
    },
    /** Tags (slice a3b-2): filter chips + tag CRUD + per-note tag editor. */
    tagsLabel: "Oznake",
    newTag: "Nova oznaka",
    tagNamePlaceholder: "Naziv oznake",
    renameTag: "Preimenuj",
    deleteTag: "Obriši oznaku",
    tagMenuLabel: "Radnje nad oznakom",
    tagFilterLabel: "Filter po oznakama",
    clearTagFilter: "Poništi",
    tagError: "Radnja nad oznakom nije uspela. Pokušaj ponovo.",
    /** The one refusal a user can act on: the name is taken. FIN has said this since its rail shipped; this rail asked for a retry that could not work. */
    tagDuplicate: "Oznaka sa tim imenom već postoji.",
    tagFilterEmptyDescription: "Nijedna beleška ne odgovara izabranim oznakama.",
    /** The typed-name confirmation before a tag delete — no undo exists for this write. */
    deleteTagDialog: {
      title: "Brisanje oznake",
      warning: "Oznaka se trajno briše i uklanja sa svake beleške koja je nosi. Beleške same ostaju netaknute.",
      confirmLabel: "Naziv oznake za potvrdu",
      confirmPlaceholder: "Upiši tačan naziv",
      submit: "Obriši",
      cancel: "Otkaži",
    },
    /**
     * Kategorije (NOTE-002, migration 049) — the third organizational axis:
     * a folder says WHERE a note lives, an oznaka says WHAT IT IS ABOUT, a
     * kategorija says WHAT KIND it is (sastanak, ideja, dnevnik, recept).
     *
     * The wording is deliberately the FOLDER block's, not the tag block's,
     * wherever the sentence is the same („Preimenuj“, „Promeni boju“): a
     * category is managed by the same row, with the same swatch, so two
     * phrasings for one action would only be two things to learn. Only
     * „Bez kategorije“ is its own, because it is the answer to a question no
     * folder or tag asks.
     */
    categoriesLabel: "Kategorije",
    newCategory: "Nova kategorija",
    categoryNamePlaceholder: "Naziv kategorije",
    renameCategory: "Preimenuj",
    recolorCategory: "Promeni boju",
    deleteCategory: "Obriši kategoriju",
    categoryMenuLabel: "Radnje nad kategorijom",
    categoryFilterLabel: "Filter po kategorijama",
    clearCategoryFilter: "Poništi",
    categoryError: "Radnja nad kategorijom nije uspela. Pokušaj ponovo.",
    /** As `tagDuplicate`: the store refuses a duplicate name, so the line names that instead of asking for a retry against a UNIQUE index. */
    categoryDuplicate: "Kategorija sa tim imenom već postoji.",
    categoryFilterEmptyDescription: "Nijedna beleška ne pripada izabranim kategorijama.",
    /**
     * The title and the way OUT of a filter that matched nothing.
     *
     * The two sentences above say WHICH filter emptied the list; neither of
     * them could undo it, and the two „Poništi" links that can live in the
     * organizer rail — which is a closed drawer below 1345px. So on a narrow
     * window the pane stated a dead end and offered nothing, which is the
     * „Datoteke" rule (`files.noMatchTitle` + `files.clearFilters`) applied
     * everywhere except here. The button clears BOTH axes, because with both
     * set the reader cannot tell which one to drop and „try one, then the
     * other" is not an affordance.
     */
    filterEmptyTitle: "Nema beležaka po ovim filterima",
    filterEmptyClear: "Poništi filtere",
    /** The typed-name confirmation before a category delete — no undo exists for this write. Its notes are never deleted, only uncategorized (see the store's own `ON DELETE SET NULL`). */
    deleteCategoryDialog: {
      title: "Brisanje kategorije",
      warning: "Kategorija se trajno briše. Beleške koje su u njoj postaju bez kategorije — ni jedna se ne briše.",
      confirmLabel: "Naziv kategorije za potvrdu",
      confirmPlaceholder: "Upiši tačan naziv",
      submit: "Obriši",
      cancel: "Otkaži",
    },
    /** The per-note picker in the row menu — „Bez kategorije“ is a real choice there, not an empty state. */
    noteCategoryLabel: "Kategorija",
    noCategory: "Bez kategorije",
    /** Wiki-links (slice b): the `[[` link menu + the backlinks panel. */
    backlinksTitle: "Povratne veze",
    wikiLinkMissing: "Nedostupna beleška",
    /** Attachments (NOTE-003b): the Prilozi panel + in-document image blocks. */
    attachmentsTitle: "Prilozi",
    attach: "Priloži datoteku",
    /** „Pregledaj" (DOC / ADR-064) — offered only on rows the app can render itself; the dialog's own copy lives in `attachmentPreview` below. */
    attachmentPreview: "Pregledaj",
    attachmentOpen: "Otvori",
    attachmentSaveAs: "Sačuvaj kao…",
    attachmentRemove: "Ukloni prilog",
    attachmentMenuLabel: "Radnje nad prilogom",
    attachmentTooLarge: "Datoteka je veća od 50 MB i ne može se priložiti.",
    attachmentError: "Radnja nad prilogom nije uspela. Pokušaj ponovo.",
    attachmentMissing: "Prilog je uklonjen.",
    /** Version history (NOTE-008b): the in-pane browser + restore flow. */
    historyTitle: "Istorija verzija",
    historyOpen: "Istorija verzija",
    backToEditing: "Nazad na uređivanje",
    historyEmpty: "Još nema sačuvanih verzija — nastaju automatski tokom pisanja.",
    historyRestore: "Vrati ovu verziju",
    historyRestoreNote: "Trenutno stanje se automatski čuva kao verzija pre vraćanja.",
    historyError: "Radnja nad verzijama nije uspela. Pokušaj ponovo.",
    /** Templates (NOTE-009b): the in-pane picker, save-as-template, manage. */
    templatesTitle: "Šabloni",
    templatesOpen: "Šabloni",
    templatesBuiltinGroup: "Ugrađeni",
    templatesUserGroup: "Moji šabloni",
    templatesUserEmpty: "Još nemaš svoje šablone.",
    templateInsert: "Umetni šablon",
    templateInsertNote: "Šablon se dodaje na kraj beleške.",
    templateSaveAs: "Sačuvaj kao šablon",
    templateSaveNote: "Prilozi se ne čuvaju u šablonu.",
    templateNamePlaceholder: "Naziv šablona",
    templateOverwriteNote: "Šablon sa tim nazivom već postoji — biće zamenjen.",
    templateRename: "Preimenuj",
    templateDelete: "Obriši šablon",
    templateMenuLabel: "Radnje nad šablonom",
    templateBroken: "Ovaj šablon se ne može prikazati.",
    templateTooLarge: "Beleška je prevelika da bi se sačuvala kao šablon.",
    templateError: "Radnja nad šablonima nije uspela. Pokušaj ponovo.",
    /**
     * Only a RENAME can hit this — saving is an upsert and replaces instead of
     * refusing, which is what `templateOverwriteNote` says. „Biće zamenjen" is
     * therefore false for a rename, so this one gets its own sentence rather
     * than borrowing that one.
     */
    templateNameTaken: "Šablon sa tim imenom već postoji.",
    /** Prefix for a template's slash-menu label (NOTE-009c), e.g. "Šablon: Sastanak". */
    slashTemplatePrefix: "Šablon: ",
    templateBuiltins: {
      sastanak: "Sastanak",
      dnevnik: "Dnevnik",
      recept: "Recept",
      predmet: "Predmet",
      projekat: "Projekat",
    },
    /** Slash-menu command labels (block conversions), in menu order. */
    slash: {
      paragraph: "Paragraf",
      heading1: "Naslov 1",
      heading2: "Naslov 2",
      heading3: "Naslov 3",
      bulletList: "Lista",
      orderedList: "Numerisana lista",
      taskList: "Lista zadataka",
      blockquote: "Citat",
      codeBlock: "Blok koda",
      divider: "Razdvajač",
      calloutInfo: "Okvir: napomena",
      calloutTip: "Okvir: savet",
      calloutWarning: "Okvir: upozorenje",
      calloutDanger: "Okvir: opasnost",
      toggle: "Sklopivi odeljak",
      tableOfContents: "Sadržaj",
      flashcard: "Kartica (pitanje :: odgovor)",
      /** Wraps the selection in a new `{{cN::…}}` deletion, numbered for the author (ADR-068). */
      clozeBlank: "Praznina (cloze)",
    },
    /**
     * Callout variants (NOTE-011). These name the block for a screen reader —
     * the block itself carries no visible label, so colour is not the only
     * thing distinguishing a warning from a note.
     */
    callout: {
      info: "Napomena",
      tip: "Savet",
      warning: "Upozorenje",
      danger: "Opasnost",
    },
    /** The collapsible section's chevron (NOTE-011) — its label states what the click will do. */
    toggleExpand: "Rasklopi odeljak",
    toggleCollapse: "Sklopi odeljak",
    /** The live table of contents (NOTE-011). */
    tocTitle: "Sadržaj",
    tocEmpty: "Ova beleška nema naslova.",
    /** Inline flashcards (NOTE-006c / ADR-017): the `::` / `{{…}}` syntax + the deck-mapping bar. */
    cardsLabel: "Kartice",
    cardsUnmapped: "Ova beleška pravi kartice za učenje. Izaberi špil:",
    cardsDeckSelectLabel: "Špil za kartice",
    cardsDeckPlaceholder: "Izaberi špil",
    cardsNoDecks: "Napravi špil u modulu Učenje da bi kartice iz ove beleške imale gde da odu.",
    cardsDeckPrefix: "Špil: ",
    cardsChangeDeck: "Promeni špil",
    cardsCancelChange: "Otkaži",
    cardsError: "Kartice nisu sačuvane. Pokušaj ponovo.",
    cardScaffold: "Pitanje :: Odgovor",
    /**
     * What becomes of the flashcards a note generated when the note is deleted
     * (PRD 09 §7). The two choices lose different things — one keeps the review
     * history in the deck, the other takes those cards out of study — so there
     * is no default and no primary button; Otkaži is the way out that changes
     * nothing. A note that generated no cards is never asked.
     */
    cardsDialog: {
      title: "Brisanje beleške",
      /**
       * The counted phrase, e.g. „3 kartice nastale iz ove beleške“. Noun and
       * participle inflect together in Serbian (1 / 2–4 / 5+), so the whole
       * phrase goes through `countUnit` rather than the noun alone.
       */
      countOne: "kartica nastala iz ove beleške",
      countFew: "kartice nastale iz ove beleške",
      countMany: "kartica nastalih iz ove beleške",
      question: "Šta sa njima?",
      /** Says what „keep“ means, since the cards outlive the note that wrote them. */
      keepNote: "Zadržane kartice ostaju u svom špilu, sa istorijom učenja.",
      keep: "Zadrži kartice",
      deleteCards: "Obriši i kartice",
      cancel: "Otkaži",
    },
    /** The undo bar after „Obriši i kartice“ — it took more than the note, and says so. */
    deletedWithCardsNotice: "Beleška i kartice obrisane",
    /**
     * „Pretvori u zadatke“ (NOTE §6). The editor's checkboxes are a mark on the
     * page and nothing more; this is the one action that promotes them into real
     * TASK rows. Offered only when the note actually has rows to convert (the
     * `cards-count` probe's own rule), so `empty` is what a note WITHOUT them
     * hears instead of a dialog that could only report doing nothing.
     */
    checklistTasks: {
      /** The row „⋯“ entry. A verb: it says what pressing it does, not what the note contains. */
      action: "Pretvori u zadatke",
      title: "Pretvori u zadatke",
      /** The counted phrase, e.g. „3 stavke iz liste u ovoj belešci“ — noun and preposition inflect together, hence `countUnit`. */
      countOne: "stavka iz liste u ovoj belešci",
      countFew: "stavke iz liste u ovoj belešci",
      countMany: "stavki iz liste u ovoj belešci",
      question: "Izaberi listu zadataka u koju idu.",
      /** The non-destructive rule, said before the action rather than discovered after it. */
      keepNote: "Beleška ostaje nepromenjena — lista se prepisuje, ne seli.",
      listLabel: "Lista zadataka",
      convert: "Pretvori",
      cancel: "Otkaži",
      /** „Napravljeno 3 zadatka“ — the `markdownImport` result recipe: an invariant participle + `countUnit`. */
      createdPrefix: "Napravljeno",
      createdUnitOne: "zadatak",
      createdUnitFew: "zadatka",
      createdUnitMany: "zadataka",
      /** Appended only when a ticked box carried across: „, od toga 2 već završena“. */
      completedPrefix: "od toga",
      completedUnitOne: "već završen",
      completedUnitFew: "već završena",
      completedUnitMany: "već završenih",
      /** Appended only when a row had no text to be a title: „Preskočeno 2 prazna reda.“ */
      skippedPrefix: "Preskočeno",
      skippedUnitOne: "prazan red",
      skippedUnitFew: "prazna reda",
      skippedUnitMany: "praznih redova",
      /** What a note with no checklist hears — a statement, not a failure. */
      empty: "Ova beleška nema listu sa kvačicama.",
      error: "Zadaci nisu napravljeni. Pokušaj ponovo.",
      /** The picker has nothing to offer only if the profile has no lists at all, which the Inbox makes impossible — said anyway rather than showing an empty select. */
      noLists: "Napravi listu u modulu Zadaci da bi stavke imale gde da odu.",
      /** Shown instead of `noLists` when the fetch itself rejected — an empty picker must not be read as "this profile has no lists". */
      loadError: "Liste zadataka se trenutno ne mogu učitati. Pokušaj ponovo.",
    },
    /**
     * „Pronađi u belešci“ (NOTE-005): the Ctrl+F bar docked above the open
     * note. Its own copy, deliberately not borrowed from the global search
     * palette — that one searches everything the profile holds, this one
     * searches the note on screen, and telling the two apart is the whole
     * point of naming the note in the placeholder.
     */
    find: {
      /** Names the bar for a screen reader, and doubles as the query field's placeholder. */
      regionLabel: "Pronađi u belešci",
      placeholder: "Pronađi u belešci",
      /** The counter slot's own name — it announces „3/17“, which says nothing on its own. */
      countLabel: "Rezultati u belešci",
      /** Stands in the counter slot when the query matches nothing. Quiet: a full stop, no exclamation, no icon. */
      noResults: "Nema rezultata.",
      previous: "Prethodno",
      next: "Sledeće",
      /** The case toggle reads „Aa“; what it does is in its title, since two letters cannot say it. */
      caseLabel: "Aa",
      caseTitle: "Razlikuj velika i mala slova",
      /**
       * Reveals the replace row. A NOUN („Zamena“) rather than the verb, so it
       * can never be mistaken for the „Zameni“ button it uncovers.
       */
      replaceToggle: "Zamena",
      replacePlaceholder: "Zameni sa",
      replace: "Zameni",
      replaceAll: "Zameni sve",
      close: "Zatvori",
    },
    /** „Premesti u Privatno“ (ADR-057 §5) — the row-menu action and its typed-confirm dialog. Offered only while the private section is unlocked. */
    moveToPriv: {
      action: "Premesti u Privatno",
      title: "Premeštanje u Privatno",
      warning:
        "Beleška se šifruje i nestaje iz Beleški, pretrage, izvoza i rezervnih kopija — istorija verzija i veze sa drugim beleškama se brišu.",
      /** The two things that deliberately SURVIVE the move, said before the field. */
      keepNote:
        "Kartice za učenje nastale iz beleške ostaju u svom špilu, bez veze sa njom; zadaci napravljeni iz njene liste ostaju u Zadacima.",
      confirmLabel: "Naslov beleške za potvrdu",
      confirmPlaceholder: "Upiši tačan naslov",
      submit: "Premesti",
      cancel: "Otkaži",
      tooLarge: "Beleška je prevelika za privatnu sekciju.",
      tooManyAttachments: "Beleška ima previše priloga — privatna beleška ih nosi najviše 50.",
      error: "Premeštanje nije uspelo. Ništa nije promenjeno — pokušaj ponovo.",
    },
  },

  /**
   * Private notes (PRIV v1 / ADR-057): the sealed section. Every sentence here
   * is HONEST about guarantees — what locking protects, what deletion means,
   * what opting out of the Recovery Kit costs — never marketing. Masculine
   * second person, the house register.
   */
  priv: {
    /**
     * Every other module in the app got a signature graphic in this pass. This
     * one deliberately did not, and saying so is better product than leaving a
     * conspicuous gap for somebody to read as an oversight and „fix" later.
     *
     * The reason is not technical. A heatmap of when the private section is
     * opened, or how many notes it holds, is itself a fact about the person —
     * visible over their shoulder, and readable by anyone who gets as far as
     * the locked screen. The section exists so that a class of information has
     * no picture; drawing its shape would defeat it.
     */
    noChartNote:
      "Ovde namerno nema nijednog grafika. Slika koja pokazuje kada i koliko koristiš privatne beleške i sama je podatak o tebi — i vidi se preko ramena.",
    /** First open, nothing set up yet: the two-sentence honest explanation, the credential choice, the kit step. */
    setup: {
      title: "Privatne beleške",
      // ADR-057 §6 changed the export half of this promise: private notes CAN
      // ride in a manual, password-protected export while the section is
      // unlocked — automatic backups still never carry them.
      intro:
        "Privatne beleške se šifruju posebnim ključem i čitljive su samo dok je ova sekcija otključana — ne pojavljuju se u pretrazi, na kontrolnoj tabli ni u automatskim rezervnim kopijama. U ručni izvoz ulaze samo dok je sekcija otključana i samo uz lozinku arhive.",
      introSecond:
        "Ako izgubiš i lozinku i kod za oporavak, sadržaj je nepovratno izgubljen — ne postoji pomoćni ulaz, ni za tebe ni za aplikaciju.",
      credentialLabel: "Čime se sekcija otključava",
      useAccountPasscode: "Pristupnim kodom naloga",
      useAccountPasscodeNote: "Isti kod koji otključava aplikaciju otključava i ovu sekciju.",
      useSeparate: "Posebnom lozinkom",
      useSeparateNote: "Lozinka koju znaš samo ti — ko zna kod naloga, ne zna i nju.",
      accountPasscodeLabel: "Pristupni kod naloga",
      accountPasscodePlaceholder: "Upiši pristupni kod",
      passphraseLabel: "Lozinka za privatne beleške",
      passphrasePlaceholder: "Najmanje 8 karaktera, slovo i cifra",
      confirmLabel: "Potvrdi lozinku",
      confirmPlaceholder: "Ponovi lozinku",
      kitLabel: "Kod za oporavak",
      kitRegenerate: "Obnovi kod za oporavak",
      kitRegenerateNote:
        "Pravi se novi kod za oporavak koji otvara i nalog i privatne beleške. Stari kod odmah prestaje da važi — prepiši preko njega novi.",
      kitOptOut: "Bez koda za oporavak",
      kitOptOutNote:
        "Zaboravljena lozinka tada znači trajno izgubljene privatne beleške. Nema trećeg puta.",
      /** The informed opt-out's own gate — the dead end, restated as the thing being agreed to. */
      kitOptOutConfirm: "Razumem: bez lozinke i bez koda, privatne beleške su nepovratne.",
      submit: "Uključi privatne beleške",
      mismatch: "Lozinke se ne poklapaju.",
      weak: "Lozinka mora imati bar 8 karaktera, uz najmanje jedno slovo i jednu cifru.",
      alreadySetUp: "Sekcija je već podešena — otključaj je svojom lozinkom.",
    },
    /** Set up but locked: one field, the throttle countdown reuses the lock screen's own prefix. */
    lock: {
      title: "Privatne beleške su zaključane",
      description: "Unesi lozinku za privatne beleške. Dok su zaključane, sadržaj je šifrovan i nedostupan.",
      descriptionAccount: "Unesi pristupni kod naloga. Dok su zaključane, sadržaj je šifrovan i nedostupan.",
      fieldLabel: "Lozinka",
      fieldLabelAccount: "Pristupni kod",
      placeholder: "Upiši lozinku",
      placeholderAccount: "Upiši pristupni kod",
      submit: "Otključaj",
      wrongCredential: "Pogrešna lozinka.",
      wrongPasscode: "Pogrešan pristupni kod.",
      error: "Otključavanje nije uspelo. Pokušaj ponovo.",
    },
    /** The unlocked section: header, list, search, delete. */
    section: {
      lockNow: "Zaključaj",
      newNote: "Nova beleška",
      searchLabel: "Pretraga privatnih beležaka",
      searchPlaceholder: "Pretraži privatne beleške…",
      emptyTitle: "Nema privatnih beležaka",
      emptyDescription: "Napravi prvu dugmetom iznad — sve ovde ostaje šifrovano na disku.",
      searchEmpty: "Nijedna privatna beleška ne odgovara upitu.",
      /** A row whose sealed container no longer opens: named, dead, honest. */
      unreadable: "Nečitljiva beleška",
      loadError: "Privatne beleške se trenutno ne mogu učitati. Pokušaj ponovo.",
      noSelectionTitle: "Nijedna beleška nije izabrana",
      noSelectionDescription: "Izaberi belešku sa leve strane ili napravi novu.",
      deleteLabel: "Obriši",
      moveOut: "Premesti u Beleške",
      noteMenuLabel: "Više opcija",
    },
    /** The private editor's own surfaces — save channel, attachments, the honest v1 limits. */
    editor: {
      loadError: "Beleška se ne može otvoriti. Pokušaj ponovo.",
      saveError: "Čuvanje nije uspelo — pokušaćemo ponovo pri sledećoj izmeni.",
      saveTooLarge: "Beleška je prevelika da bi se sačuvala. Skrati je ili podeli na više beležaka.",
      attachmentsTitle: "Prilozi",
      attach: "Priloži datoteku",
      attachmentTooLarge: "Datoteka je veća od 100 MB i ne može se priložiti.",
      attachmentError: "Prilaganje nije uspelo. Pokušaj ponovo.",
      /** The recorded v1 limit, said where the files live: no external opening, no plaintext temp copies. */
      attachmentsNote:
        "Prilozi su šifrovani i otvaraju se samo ovde, dok je sekcija otključana — bez otvaranja u spoljnim programima.",
      /**
       * The sealed version history (ADR-057) — the private twin of „Istorija
       * verzija". Verzije su šifrovane kao i sama beleška, pa se otvara jedna
       * po jedna, i sve to postoji samo dok je sekcija otključana.
       */
      history: {
        open: "Istorija verzija",
        back: "Nazad na uređivanje",
        title: "Istorija verzija",
        empty:
          "Još nema sačuvanih verzija — nastaju automatski tokom pisanja i pri zatvaranju beleške.",
        restore: "Vrati ovu verziju",
        restoreNote: "Trenutno stanje se čuva kao verzija pre vraćanja, pa je i ovaj korak povratan.",
        error: "Radnja nad verzijama nije uspela. Pokušaj ponovo.",
        /** The preview column's label for the selected version's own title. */
        previewLabel: "Naslov u ovoj verziji",
      },
    },
    /**
     * The best-effort clipboard guard (PRIV-012): copying inside the section
     * offers a 30-second auto-clear. Honest about its own reach — clearing
     * needs the app focused at that moment, and another copy elsewhere
     * replaces the content anyway.
     */
    clipboard: {
      notice: "Kopirano — klipbord se briše za 30 s ako je Nexus tada u prvom planu.",
      cancel: "Zadrži u klipbordu",
    },
    /** Typed-confirm HARD delete — no trash, no undo, and the copy says so before the field. */
    deleteDialog: {
      title: "Brisanje privatne beleške",
      warning: "Beleška i njeni prilozi biće odmah i trajno obrisani. Nema korpe i nema opoziva.",
      confirmLabel: "Naslov beleške za potvrdu",
      confirmPlaceholder: "Upiši tačan naslov",
      submit: "Obriši trajno",
      cancel: "Otkaži",
      error: "Brisanje nije uspelo. Pokušaj ponovo.",
    },
    /** „Premesti u Beleške“ — the move OUT, with the consequence stated plainly: it becomes searchable. */
    moveOutDialog: {
      title: "Premeštanje u Beleške",
      warning:
        "Beleška se dešifruje i postaje obična beleška — vidljiva u Beleškama, u pretrazi, u izvozima i rezervnim kopijama.",
      confirmLabel: "Naslov beleške za potvrdu",
      confirmPlaceholder: "Upiši tačan naslov",
      submit: "Premesti",
      cancel: "Otkaži",
      tooLarge: "Beleška je prevelika da bi se premestila odjednom.",
      error: "Premeštanje nije uspelo. Ništa nije promenjeno — pokušaj ponovo.",
    },
  },

  calendar: {
    /**
     * „Sat dana" — CAL's signature graphic, and deliberately the one thing the
     * grid cannot say. A month view shows WHICH DAYS are busy; nobody can read
     * off it that every evening after seven is gone and every morning is free.
     * The ring is the same period folded onto a single 24-hour dial, so the
     * shape of a life shows up instead of the shape of a month.
     *
     * All-day events carry no hour and are excluded rather than parked at
     * midnight — a spike at 00 that is really „ceo dan" is a fabricated hour.
     */
    chart: {
      heading: "Sat dana",
      caption:
        "Koliko događaja počinje u kom satu, kroz period koji je trenutno na ekranu. Celodnevni događaji nemaju sat i ne ulaze u ovaj krug.",
      descriptionLead: "Sat dana",
      descriptionBusiest: "najviše u",
      hourSuffix: "h",
      emptyReason:
        "Krug se crta čim u prikazanom periodu postoji bar jedan događaj sa vremenom.",
    },
    viewLabel: "Prikaz",
    viewMesec: "Mesec",
    viewNedelja: "Nedelja",
    viewDan: "Dan",
    viewSemestar: "Semestar",
    viewAgenda: "Agenda",
    viewDokumenta: "Dokumenta",
    viewLjudi: "Ljudi",
    /**
     * Drawn above the field, not inside it. It was both — a `titlePlaceholder`
     * and a `titleLabel` holding the same string, one of them grey and gone
     * the moment anything was typed — until DC-120 step 2 kept the one that
     * stays on screen.
     */
    titleLabel: "Naziv događaja",
    dateLabel: "Datum",
    /**
     * „Od", not „Vreme". It was the latter while it was an `aria-label` a
     * screen reader read on its own; drawn on screen it stands beside
     * `endTimeLabel`, and „Vreme"/„Do" is half a pair.
     */
    timeLabel: "Od",
    /** End-time field (week/day view, ADR-020) — next to the start-time field, timed events only. */
    endTimeLabel: "Do",
    /** Client-side guard mirroring EventStore's own "end must not be before start" check. */
    endBeforeStart: "Vreme završetka mora biti posle vremena početka.",
    /** Submitting the form with no title types in — said instead of doing nothing. */
    invalidTitle: "Upiši naziv događaja.",
    /** Defensive twin of `invalidTitle`: the date field is `required`, so this is normally unreachable, but a silent no-op is never the fallback. */
    invalidDate: "Izaberi datum događaja.",
    /** The form's own save failing at the store/IPC boundary. */
    saveError: "Događaj nije sačuvan. Pokušaj ponovo.",
    /**
     * The parenthesis came from the placeholder this replaced, and is the
     * reason the label is not simply „Mesto“: it is the one thing the grey
     * text said that the name did not, and it said it only while the field
     * was empty. The same shape as `devtools.system.altLabel` and the
     * finance year field — an optional field says so in its own name.
     */
    locationLabel: "Mesto (opciono)",
    allDay: "Ceo dan",
    add: "Dodaj",
    save: "Sačuvaj",
    cancel: "Otkaži",
    editLabel: "Izmeni događaj",
    deleteLabel: "Obriši događaj",
    emptyTitle: "Nema događaja",
    emptyDescription: "Dodaj prvi događaj u formi iznad — naziv i datum su dovoljni.",
    loadError: "Događaji se trenutno ne mogu učitati. Pokušaj ponovo kasnije.",
    deletedNotice: "Događaj obrisan",
    undo: "Vrati",
    dismiss: "Zatvori",
    /** Generic fallback for delete/undo/move/series-resolve failures — the HABIT `actionError` shape, outside the live form. */
    actionError: "Radnja nije uspela. Pokušaj ponovo.",
    /** Source-filter toggle chips (month grid + agenda share one set of toggles). */
    sourcesLabel: "Izvori",
    sourceEvents: "Događaji",
    sourceTasks: "Zadaci",
    sourceExams: "Ispiti",
    sourceBlocks: "Učenje",
    sourceBirthdays: "Rođendani",
    /** FIN slice d: the days a subscription's rule says money goes out. */
    sourceSubscriptions: "Pretplate",
    /**
     * The cross-profile overlay chip (CAL-005 / ADR-058 §5) — labelled by what
     * it SHOWS, so the pair is kind-dependent: „Poslovni kalendar“ while the
     * personal profile is active, „Privatni kalendar“ while the business one
     * is. The chip exists only when the account has another profile at all.
     */
    sourceOverlayBusiness: "Poslovni kalendar",
    sourceOverlayPrivate: "Privatni kalendar",
    /**
     * The foreign items that chip brings in: read-only guests. The ⇄ glyph
     * marks each one; clicking opens a small popover headed by the origin
     * profile's own name, and its one action routes through the same
     * passcode-gated switch every profile change passes (AUTH-024).
     */
    overlay: {
      /** Accessible name of the ⇄ origin glyph. */
      markerLabel: "Događaj iz drugog profila",
      /** Accessible name of the origin popover (and of the agenda row's „⋯“ that opens it); the visible heading is the profile's name. */
      popoverLabel: "Poreklo događaja",
      /** Why the event cannot be opened here — said in the popover, before the one action it offers. */
      originNote: "Događaj pripada ovom profilu i ovde se ne može menjati.",
      switchAction: "Prebaci profil",
      /** Quiet inline line when the overlay fetch fails; the profile's own calendar is unaffected. */
      loadError: "Kalendar drugog profila se trenutno ne može učitati.",
    },
    /**
     * The "Podsetnici" chip row on the event form (CAL-006). Every chip's label
     * is built from these by one formatter, so the fixed ladder and an offset
     * loaded from a stored event read the same way: "U vreme početka",
     * "10 min ranije", "1 h ranije", "1 dan ranije", "3 dana ranije".
     */
    reminders: {
      label: "Podsetnici",
      atStart: "U vreme početka",
      minutesUnit: "min",
      hoursUnit: "h",
      /** Trailing word of every non-zero lead time; the day form takes `dayUnit`. */
      before: "ranije",
    },
    /**
     * Šabloni (CAL-009) — a saved event shape, captured from the form while an
     * event is open in it and applied from that same form's toolbar onto the day
     * the form names. Worded field for field like `tasks.templates`, since it is
     * the same idea one module over; only the two sentences that mention what is
     * created differ, because one makes a task and this one makes a „događaj“.
     * The block already says „šablon“, so nothing inside it repeats the word.
     */
    templates: {
      /** The toolbar button, and the heading inside both popovers. */
      title: "Šabloni",
      /** Accessible name of the toolbar button's menu. */
      menuLabel: "Šabloni događaja",
      /** Shown in place of the list when the profile has no templates yet. */
      empty: "Još nemaš šablone događaja.",
      /** The action in the „⋯“ menu beside the open event's form. */
      saveAs: "Sačuvaj kao šablon",
      /** Accessible name of that „⋯“ menu — the surface it belongs to, said in full. */
      saveMenuLabel: "Šablon ovog događaja",
      /**
       * DRAWN above the field now (DC-120 step 2), which is what changed the
       * wording. While it was only heard it was the action in full — „Sačuvaj
       * događaj kao šablon“ — because a screen reader met the box with no
       * surrounding text. On screen the surroundings are already there: the
       * panel is headed „Šabloni“ and the button under the field says
       * „Sačuvaj“, so a label repeating the action would be the third copy of
       * it. A label names the field; the button names the action.
       *
       * `tasks.templates.nameLabel` is still the old shape, and so are the
       * seven other names `InlineNameForm` passes to an `aria-label`. That is
       * the TASK surface, and it changes on its own pass.
       */
      nameLabel: "Naziv šablona",
      /** Said BEFORE the fact, not after: saving under an existing name is how a template is edited. */
      overwriteNote: "Postojeći naziv se zamenjuje.",
      /** Tooltip on a template's name in the list — the click applies it. */
      applyTitle: "Napravi događaj od ovog šablona",
      /** Caption above the list: a template carries no date, so the day it lands on is worth naming out loud. */
      applyDayLabel: "Primenjuje se na",
      delete: "Obriši šablon",
      actionError: "Radnja nad šablonom nije uspela. Pokušaj ponovo.",
    },
    /**
     * ISO week numbers (CAL-010) — the quiet gutter label down the left of the
     * month grid, and the week view's header corner.
     *
     * „ned.“ (nedelja) — the founder's choice (2026-07-31) over „sed.“
     * (sedmica). „Nedelja“ is also „Sunday“, and the label sits beside a row
     * of weekday shorts ending in „ned“; the lower-case styling with the
     * trailing dot is what keeps it reading as a different kind of label, and
     * the hover title says in full which reading is meant.
     */
    weekNumber: {
      /** Header above the gutter, and the prefix in the week view's corner. */
      abbrev: "ned.",
      /** Hover text — says out loud which of the several week numberings this is. */
      title: "Nedelja u godini (ISO 8601)",
    },
    /**
     * Semestar (CAL-010) — four months at once: the month the calendar is on
     * plus the next three, each day carrying only how much it holds. It is an
     * overview and nothing else — no drag, no creating, one click that opens
     * the day it names.
     */
    semester: {
      /** Accessible name of the four-month grid. */
      regionLabel: "Pregled semestra",
      /** Caption under the grid — what a dot and a ring mean, said once. */
      legend: "Tačka — dan sa obavezama · prsten — ispit",
      /** One quiet line while no term is set (ADR-054) — plain text, not a link; it names where the dates live. */
      unsetHint: "Podesi datume semestra u Podešavanjima.",
      /** Said when a set term runs past six months and the grid shows only its first six. */
      truncated: "Semestar je duži od šest meseci — prikazano je prvih šest.",
      /** Appended to a day's accessible name when it holds something: „3 stavke“. */
      itemsOne: "stavka",
      itemsFew: "stavke",
      itemsMany: "stavki",
      /** Appended to that name when the day holds an exam — what its ring says. */
      examMark: "ispit",
    },
    /**
     * The half-day markers of the 12-hour clock (CAL §5), used only when this
     * device is set to it. „AM“/„PM“ rather than a Serbian phrase on purpose:
     * they are exactly what `Intl.DateTimeFormat` with `{ hour12: true }`
     * itself produces for this locale, so a user who switches clocks sees the
     * form their OS shows them everywhere else.
     */
    clock: {
      am: "AM",
      pm: "PM",
    },
    /** Tag chip on a read-only task row in the agenda (ADR-020). */
    taskTag: "Zadatak",
    /** Tag chip on a read-only renewal row in the agenda (FIN slice d). */
    subscriptionTag: "Pretplata",
    /** Grid navigation (ADR-020): prev/today/next — one pair of labels shared by Mesec/Nedelja/Dan, since each shifts by its own period. */
    prevPeriod: "Prethodni period",
    nextPeriod: "Sledeći period",
    today: "Danas",
    showMore: "još",
    showLess: "Prikaži manje",
    /**
     * The Ljudi panel (CAL-007). Month names are NOT listed here: they are
     * derived from `Intl.DateTimeFormat` with `{ month: "long" }`, the
     * same source every other date label on this page already reads, so the
     * select and the rows cannot drift from the calendar's own wording.
     */
    people: {
      /** Kind labels, keyed by person-kind value (labels are presentation). */
      kind: {
        birthday: "Rođendan",
        anniversary: "Godišnjica",
      },
      /**
       * Drawn above the field (DC-120 step 2). „Ime", not the „Ime osobe"
       * that used to sit inside it as grey text: a label stands under a
       * heading that already says whose panel this is, where a placeholder
       * standing alone had to say „of a person" out loud.
       */
      nameLabel: "Ime",
      kindLabel: "Vrsta",
      dayLabel: "Dan",
      monthLabel: "Mesec",
      yearLabel: "Godina (opciono)",
      /**
       * „(opciono)" came from the placeholder this replaced — the one thing
       * the grey text said that the name did not, said only while the field
       * was empty. `documents.notesLabel` and `calendar.locationLabel` took
       * the same parenthesis for the same reason.
       */
      noteLabel: "Beleška (opciono)",
      add: "Dodaj",
      save: "Sačuvaj",
      cancel: "Otkaži",
      editLabel: "Izmeni osobu",
      deleteLabel: "Obriši osobu",
      emptyTitle: "Nema ljudi",
      emptyDescription: "Dodaj prvu osobu u formi iznad — ime, vrsta i datum su dovoljni.",
      loadError: "Ljudi se trenutno ne mogu učitati. Pokušaj ponovo kasnije.",
      /** Client-side guard mirroring PeopleStore's own (month, day) pair check. */
      invalidDate: "Taj datum ne postoji ni u jednom mesecu.",
      saveError: "Osoba nije sačuvana. Pokušaj ponovo.",
      deletedNotice: "Osoba obrisana",
      undo: "Vrati",
      dismiss: "Zatvori",
      /**
       * Age / anniversary count on a row: "1996 · 30 god." The abbreviated
       * "god." is deliberate — it is correct at every number, while the spelled
       * forms need three (1 godina / 2–4 godine / 5+ godina) and `dayUnit`
       * knows two.
       */
      yearsUnit: "god.",
    },
  },

  documents: {
    /**
     * „Rokovi" — DOC's signature graphic: every tracked document as a lane on
     * one horizon, with today standing in it.
     *
     * A list of „ističe za 41 dan" answers each document one at a time; the
     * horizon answers the question people actually have, which is „šta mi sve
     * ističe do kraja godine" — and it answers it by position, so two documents
     * expiring in the same fortnight are visibly a problem before either one
     * turns red.
     *
     * The lane's LENGTH is the current validity period, which is only known
     * where a renewal recorded when it began. A document entered once with an
     * expiry and no renewal history has no start date anywhere in the store,
     * and its lane is a MARK at the expiry rather than a span from an invented
     * beginning.
     */
    chart: {
      heading: "Rokovi",
      caption:
        "Vodoravno je vreme, a uspravna crta je danas. Traka se crta samo tamo gde je upisano produženje — dokument bez istorije produženja nema poznat početak važenja, pa nosi samo oznaku roka.",
      descriptionLead: "Rokovi",
      descriptionDocuments: "dokumenata",
      descriptionSoonest: "prvi ističe",
      descriptionExpired: "isteklo",
      todayLabel: "danas",
      emptyReason: "Horizont se crta čim dodaš prvi dokument sa rokom.",
    },
    /** Type-label map, keyed by document type value (labels are presentation). */
    type: {
      licna_karta: "Lična karta",
      pasos: "Pasoš",
      vozacka: "Vozačka dozvola",
      registracija: "Registracija vozila",
      kartica: "Bankovna kartica",
      polisa: "Polisa osiguranja",
      custom: "Ostalo",
    },
    /** Status-chip labels, keyed by derived expiry status value. */
    status: {
      ok: "U redu",
      uskoro: "Uskoro ističe",
      istekao: "Isteklo",
    },
    typeLabel: "Vrsta dokumenta",
    /**
     * Drawn above the field. It was a `labelPlaceholder` and a `labelLabel`
     * holding the same string — one grey and gone the moment anything was
     * typed — until DC-120 step 2 kept the one that stays on screen.
     */
    labelLabel: "Naziv dokumenta",
    expiryLabel: "Ističe",
    /**
     * „(opciono)" came from the placeholder this replaced: it was the one
     * thing the grey text said that the name did not, and it said it only
     * while the field was empty. `calendar.locationLabel` took the same
     * parenthesis for the same reason on the same day.
     */
    notesLabel: "Beleška (opciono)",
    add: "Dodaj",
    save: "Sačuvaj",
    cancel: "Otkaži",
    renew: "Obnovi",
    /**
     * „Novi rok", not „Novi datum isteka", and the two words came off a
     * measurement rather than a preference. Drawn (DC-120 step 2) this is a
     * caption INSIDE a list row's trailing edge, beside the date box and two
     * buttons, and at the 900px minimum the longer string took enough of the
     * line that the row's own document name truncated to „Poli…". „Rok" is
     * the panel's own word for the same thing — the block above the list is
     * headed „ROKOVI" — so the short form is not a shortening of the meaning.
     */
    renewLabel: "Novi rok",
    renewConfirm: "Potvrdi",
    renewCancel: "Otkaži obnovu",
    /**
     * The renewal ledger (migration 004), shown under the open renew form. It
     * had been written on every renewal and readable nowhere in the app — the
     * `documents:renewals` channel existed end to end with no caller — so a
     * document's own history lived only inside the export archive.
     */
    renewalsTitle: "Ranije obnove",
    /** „obnovljeno 5. maj 2026 — do 5. maj 2026" — what the old expiry WAS. */
    renewalsPrevious: "do",
    /** A real answer: this document has never been renewed. Distinct from the two lines below it. */
    renewalsEmpty: "Ovaj dokument još nije obnavljan.",
    renewalsError: "Istorija obnova se ne može učitati.",
    editLabel: "Izmeni dokument",
    deleteLabel: "Obriši dokument",
    emptyTitle: "Nema dokumenata",
    emptyDescription:
      "Dodaj prvi dokument u formi iznad — vrsta, naziv i datum isteka su dovoljni.",
    loadError: "Dokumenti se trenutno ne mogu učitati. Pokušaj ponovo kasnije.",
    deletedNotice: "Dokument obrisan",
    undo: "Vrati",
    dismiss: "Zatvori",
    /** Days-until phrasing; "za N dana" / "isteklo pre N dan(a)" build inline. */
    days: {
      tomorrow: "sutra",
      today: "danas ističe",
      future: "za",
      pastPrefix: "isteklo pre",
      unitOne: "dan",
      unitMany: "dana",
    },
    /**
     * „Podsetnici“ — the per-document reminder ladder, in whole days before the
     * rok. It is the one thing about a document the store has always been able
     * to hold and no screen could set: `reminderOffsets` travels on the create
     * and the update wire alike, and the form sent neither, so every document
     * kept whatever its type's default was on the day it was made. Worth a
     * control at all because the list's own chip turns over at the WIDEST lead
     * time — a ladder is what decides when a row starts saying „Uskoro ističe“.
     *
     * Worded like `tasks.reminders` and `calendar.reminders`, one module over
     * and for their reason: one ladder of lead times, one set of words, only
     * the unit differs. The counted noun is this panel's own `days` block
     * („7 dana ranije“), and only the trailing word and the zero case are new.
     * „rok“ is already this panel's word for the expiry date — the horizon
     * above the list is headed „Rokovi“ and the renew form's field is „Novi
     * rok“ — so the expiry day is „Na dan roka“ here exactly as the due day is
     * there.
     *
     * PLURAL, where TASK says „Podsetnik“: what a document carries is a SET of
     * warnings, which is what the chip row shows, and it is the form CAL's
     * event ladder already wears.
     */
    reminders: {
      label: "Podsetnici",
      /**
       * The zero-day chip. No chip offers it — the offered set starts at one
       * day, because a warning on the expiry day tells nobody anything they can
       * still act on — so this is reachable only through the union, for a
       * ladder that arrived from another device carrying one.
       */
      atDue: "Na dan roka",
      /**
       * Trailing word of every non-zero lead time; the counted day noun is
       * `days.unitOne` / `days.unitMany`, the block the row's countdown uses.
       */
      before: "ranije",
    },
  },

  /**
   * Datoteke (DOC) — the one place every file in the profile is listed, however
   * it got there. The copy follows the three attachment panels it reads from
   * („Pregledaj" / „Otvori" are their words, not new ones), with two additions
   * this surface needs and they do not.
   *
   * „Idi na…" is the first: a browse list has to say where a file LIVES, and
   * the answer is a link to the note, task or subject that carries it — which
   * is also the page's answer to „obriši", deliberately. Removing a file
   * belongs to the surface that owns it, where its undo already lives.
   *
   * The second is the summary, and every word of it is a number the page
   * derived from the rows it is drawing. `truncatedNote` exists because the
   * read stops at a cap: past it the count is a FLOOR and the sentence says so,
   * rather than implying a total nothing measured.
   */
  files: {
    /**
     * „Šta zauzima prostor" — FILES's signature graphic: one bar per kind of
     * file, sized by bytes rather than by count, because ten photographs and
     * ten notes-in-text are not the same amount of disk.
     *
     * The index answers with at most 500 newest entries. When it truncates, the
     * total is a FLOOR and the caption changes to say so — a progress bar
     * labelled with a number that silently excluded older files would be the
     * most quietly wrong figure in the product.
     */
    chart: {
      heading: "Šta zauzima prostor",
      caption: "Zbir veličina po vrsti datoteke.",
      descriptionLead: "Šta zauzima prostor",
      emptyReason: "Pregled se crta čim postoji bar jedna priložena datoteka.",
    },
    /**
     * Every sentence this page says about the 500-entry cap, in pieces, because
     * the NUMBER is never written here: it comes from `DOC_ATTACHMENT_LIST_LIMIT`
     * — the very constant the store caps on — so no caption can outlive the cap
     * it names. The three surfaces that must say it (the graphic's caption, the
     * band's lower-bound note, the read-aloud sentence) all build it from the
     * same two halves, so they cannot drift apart either.
     */
    cap: {
      lead: "Prikazano je",
      newest: "najnovijih.",
      chartTail: "najnovijih datoteka, pa je ovo najmanje što zauzimaju — ne ukupno.",
    },
    /** Said once, under the band, when the read was capped — the advice, not the number. */
    truncatedAdvice: "Suzi pretragu ili filtere da vidiš ostale.",
    /**
     * The band above the graphic. Two figures, both derived from exactly the rows
     * on screen — and when the read hit its cap the count is a floor („500+") and
     * the size says in its own note that older files were never weighed.
     */
    band: {
      files: "Datoteke",
      total: "Ukupno",
      floorNote: "Najmanje — starije datoteke nisu uračunate.",
    },
    caption: "Sve datoteke priložene uz beleške, zadatke i predmete.",
    searchPlaceholder: "Pretraži po nazivu datoteke ili nosiocu…",
    searchLabel: "Pretraga datoteka",
    /** Owner-kind chips; „Sve" clears the filter rather than being a filter of its own. */
    ownerFilterLabel: "Gde je priložena",
    owners: {
      all: "Sve",
      note: "Beleške",
      task: "Zadaci",
      subject: "Predmeti",
    },
    /** Mime-family chips, keyed by `MIME_FAMILIES`. */
    familyFilterLabel: "Vrsta datoteke",
    families: {
      slika: "Slike",
      pdf: "PDF",
      tekst: "Tekst",
      ostalo: "Ostalo",
    },
    familyAll: "Sve vrste",
    /** The list/grid toggle — the same two shapes the Settings card names. */
    viewLabel: "Prikaz",
    views: {
      lista: "Lista",
      mreza: "Mreža",
    },
    /** Column headings for the dense list. */
    columns: {
      name: "Naziv",
      owner: "Gde je",
      size: "Veličina",
      date: "Dodato",
    },
    /** The „⋯" menu on a row or a card, mirroring `study.materials.menuLabel`. */
    menuLabel: "Radnje nad datotekom",
    preview: "Pregledaj",
    open: "Otvori",
    /**
     * The copy-out, spelled exactly as the note, task and subject panels spell
     * it — this page borrows their three write channels, so it must not invent
     * a fourth wording for the one action.
     */
    saveAs: "Sačuvaj kao…",
    goTo: "Idi na…",
    /** What a note with no title is called here — the same word Beleške uses for it. */
    untitledOwner: "Bez naslova",
    /** Alt text for a grid thumbnail is the file name; this labels the typographic mark a non-image gets instead. */
    fileMarkLabel: "Datoteka",
    /** The counted noun beside a per-family figure — „12 datoteke". */
    summaryUnitOne: "datoteka",
    summaryUnitFew: "datoteke",
    summaryUnitMany: "datoteka",
    /** Two different situations, two different sentences — one of them would be a lie about the other. */
    emptyTitle: "Nema priloženih datoteka",
    emptyDescription:
      "Datoteke se ovde pojavljuju kada ih priložiš uz belešku, zadatak ili predmet.",
    noMatchTitle: "Nema datoteka po ovim filterima",
    noMatchDescription: "Promeni pretragu ili isključi neki filter.",
    clearFilters: "Poništi filtere",
    /** The isolated failure of this one read, with the way to ask again — the dashboard widgets' recipe. */
    error: "Datoteke se trenutno ne mogu učitati.",
    retry: "Pokušaj ponovo",
    actionError: "Radnja nad datotekom nije uspela. Pokušaj ponovo.",
  },

  study: {
    /**
     * „Plan i stvarnost" — STUDY's signature graphic. Two banded series over
     * days: the minutes the plan asked for, and the minutes the focus timer
     * actually measured.
     *
     * They are two different KINDS of fact and the chart says so rather than
     * blending them into an „adherence" percentage: a block stores planned
     * minutes and a status, never an actual duration, so the only measured time
     * in the product comes from FOCUS. Drawing them side by side is the honest
     * comparison; drawing one bar labelled „učinak" would be an invented
     * figure standing where two real ones belong.
     */
    chart: {
      heading: "Plan i stvarnost",
      plannedLabel: "Planirano",
      actualLabel: "Izmereno",
      minuteUnit: "min",
      caption:
        "Po danu: minuti koje je plan tražio i minuti koje je fokus stvarno izmerio. Blok pamti planirano vreme i ishod, nikada stvarno trajanje — izmereno vreme dolazi samo iz fokusa.",
      descriptionLead: "Plan i stvarnost",
      descriptionPlanned: "planirano",
      descriptionActual: "izmereno",
      emptyReason: "Grafik se crta čim postoji planiran ili izmeren minut.",
    },
    /**
     * The band the hub opens with — „kako stojim" answered before „šta je na
     * spisku".
     *
     * Every figure is counted out of what the page has ALREADY loaded: the špil
     * counts it draws the špil rows from, the 30-day statistics it draws the
     * section at the bottom from, and the exam list itself. Nothing here asks
     * the store a question of its own, and nothing here is a figure this module
     * went looking for — which is the only way a number this large on a page
     * can be trusted.
     */
    overview: {
      dueLabel: "Za ponavljanje",
      newLabel: "Nove kartice",
      matureLabel: "Zrele kartice",
      /**
       * The maturity census is over the WHOLE collection, while everything in
       * „Poslednjih 30 dana" below is windowed — so the figure says which of
       * the two it is, in the same breath.
       */
      matureNote: "u celoj kolekciji",
      examLabel: "Sledeći ispit",
      /** The figure when no exam is ahead. Never a zero, which reads as „danas". */
      examNone: "—",
      examNoneNote: "nema zakazanih",
    },
    /**
     * Drawn above the field. It was a `namePlaceholder` and a `nameLabel`
     * holding one string, the grey copy of which left the moment anything was
     * typed — DC-120 step 2 keeps the one that stays.
     */
    nameLabel: "Naziv predmeta",
    /**
     * „(opciono)“ came off the placeholder this replaced: the one thing the
     * grey text said that the name did not, said only while the field was
     * empty. Four other fields took the same parenthesis on the same day.
     */
    semesterLabel: "Semestar (opciono)",
    colorLabel: "Boja",
    /** Colour-dot names, keyed by subject colour value (labels are presentation). */
    color: {
      jade: "Žad",
      gold: "Zlatna",
      bronze: "Bronzana",
      burgundy: "Bordo",
      crimson: "Grimizna",
      graphite: "Grafit",
    },
    add: "Dodaj predmet",
    save: "Sačuvaj",
    cancel: "Otkaži",
    editLabel: "Izmeni predmet",
    archiveLabel: "Arhiviraj",
    unarchiveLabel: "Vrati iz arhive",
    deleteLabel: "Obriši predmet",
    deletedNotice: "Predmet obrisan",
    undo: "Vrati",
    dismiss: "Zatvori",
    emptyTitle: "Nema predmeta",
    /** „u formi iznad" until the form moved behind „Dodaj predmet" — the sentence had to stop pointing at a form nobody can see. */
    emptyDescription: "Dodaj prvi predmet — naziv je dovoljan.",
    loadError: "Predmeti se trenutno ne mogu učitati. Pokušaj ponovo kasnije.",
    showArchived: "Prikaži arhivirano",
    hideArchived: "Sakrij arhivirano",
    noExams: "Nema zakazanih ispita za ovaj predmet.",
    addExam: "Dodaj ispit",
    saveExam: "Sačuvaj",
    cancelExam: "Otkaži",
    /** Exam-type labels, keyed by exam type value (labels are presentation). */
    examType: {
      pismeni: "Pismeni",
      usmeni: "Usmeni",
      kolokvijum: "Kolokvijum",
    },
    examTypeLabel: "Vrsta ispita",
    examDateLabel: "Datum ispita",
    /** „(opciono)“ from the placeholder, as `semesterLabel` above. */
    examScopeLabel: "Gradivo (opciono)",
    editExamLabel: "Izmeni ispit",
    deleteExamLabel: "Obriši ispit",
    deletedExamNotice: "Ispit obrisan",
    /** Countdown chip phrasing; "za N dan(a)" builds inline via `dayUnit`. */
    countdown: {
      today: "danas",
      tomorrow: "sutra",
      future: "za",
      unitOne: "dan",
      unitMany: "dana",
      past: "prošao",
    },
    calendarTag: "Ispit",
    dashboardTitle: "Ispiti",
    dashboardEmpty: "Nema zakazanih ispita.",
    /** Dashboard "Učenje" widget (streak + today's focus minutes). */
    dashboardStudyTitle: "Učenje",
    dashboardFocusTodayLabel: "Fokus danas",

    // --- Materials (Materijali), under each subject (STUDY-001) -------------
    /**
     * A subject's own files — the scanned skripta, the slides, last year's
     * paper. The wording follows the TASK page's „Prilozi" block field for
     * field; only the noun changes, because a file hanging off a course is
     * called a material and not an attachment.
     */
    materials: {
      title: "Materijali",
      add: "Dodaj materijal",
      empty: "Nema materijala za ovaj predmet.",
      /** „Pregledaj" (DOC / ADR-064) — the attachment panels' word, offered only on rows the app can render itself. */
      preview: "Pregledaj",
      open: "Otvori",
      saveAs: "Sačuvaj kao…",
      remove: "Ukloni materijal",
      /** The per-material „⋯“ menu, mirroring `tasks.attachments.menuLabel`. */
      menuLabel: "Radnje nad materijalom",
      /** Shown when the picker refused one or more files for size. The 50 MB bound is the store's own (`MAX_SUBJECT_ATTACHMENT_BYTES`). */
      tooLarge: "Datoteke veće od 50 MB se ne mogu priložiti.",
      actionError: "Radnja nad materijalom nije uspela. Pokušaj ponovo.",
    },

    // --- Linked notes (Povezane beleške), under each subject (STUDY-001) ----
    /**
     * The notes a user has filed under a course. „Povezane" rather than
     * „Priložene": nothing is copied here — the note stays in Beleške and this
     * section only points at it, which is exactly what opening one does.
     */
    linkedNotes: {
      title: "Povezane beleške",
      add: "Poveži belešku",
      empty: "Nema povezanih beleški za ovaj predmet.",
      /** Accessible label on a chip: the chip itself shows only the title. */
      openLabel: "Otvori belešku",
      unlink: "Ukloni vezu",
      /** The picker's own empty state — the profile has no note left to link. */
      pickerEmpty: "Nema beleški za povezivanje.",
      pickerLabel: "Izaberi belešku",
      actionError: "Povezivanje beleške nije uspelo. Pokušaj ponovo.",
    },

    // --- Study log (Dnevnik učenja), under each subject (STUDY-014) ---------
    /**
     * What actually happened on this course, day by day, newest first — built
     * from the ponavljanja, the fokus sessions, the plan blocks and the exams
     * the app already records. „Dnevnik" rather than „Istorija": it reads as a
     * record kept along the way, which is what it is; nothing here can be
     * edited.
     *
     * The section is collapsed until asked for (see StudyPage), so its toggle
     * names the thing it opens, exactly as the plan card's block toggle does.
     */
    log: {
      title: "Dnevnik učenja",
      show: "Prikaži dnevnik",
      hide: "Sakrij dnevnik",
      empty: "Još nema zabeleženog učenja.",
      loadError: "Dnevnik učenja se trenutno ne može učitati. Pokušaj ponovo kasnije.",
      /** Widens the window by another 60 days; hidden once nothing older exists. */
      showMore: "Prikaži još",
      /**
       * „5 ponavljanja" — the counted noun takes all three Serbian forms
       * (1 / 2–4 / 5+), so it goes through `countUnit`.
       */
      reviewOne: "ponavljanje",
      reviewFew: "ponavljanja",
      reviewMany: "ponavljanja",
      /** „45 min fokusa" — the duration itself comes from `formatDurationMinutes`. */
      focusSuffix: "fokusa",
      /** „plan 30 min" — what the plan asked of the day, whatever came of it. */
      planPrefix: "plan",
      /** Milestone chip on a day that carries an exam: „Ispit: Pismeni". */
      examTag: "Ispit",
    },

    // --- Decks (Špilovi), under each subject --------------------------------
    decksTitle: "Špilovi",
    noDecks: "Nema špilova za ovaj predmet.",
    addDeck: "Dodaj špil",
    saveDeck: "Sačuvaj",
    cancelDeck: "Otkaži",
    /** Drawn above the field; its placeholder held the same string. */
    deckNameLabel: "Naziv špila",
    editDeckLabel: "Izmeni špil",
    deleteDeckLabel: "Obriši špil",
    deletedDeckNotice: "Špil obrisan",
    newCount: "nove",
    dueCount: "za ponavljanje",
    openCards: "Kartice",
    studyDeck: "Uči",
    studyAll: "Uči sve",

    // --- Card management (deck drill-in) ------------------------------------
    cardsBack: "← Nazad",
    cardsEmptyTitle: "Nema kartica",
    /** The card form is BELOW this empty state, never above it — the sentence used to point the wrong way. */
    cardsEmptyDescription: "Dodaj prvu karticu — prednja i zadnja strana su dovoljne.",
    loadCardsError: "Kartice se trenutno ne mogu učitati. Pokušaj ponovo kasnije.",
    addCard: "Dodaj karticu",
    saveCard: "Sačuvaj",
    cancelCard: "Otkaži",
    /**
     * The two card faces, drawn above their boxes. Each had a placeholder
     * holding its own label word for word; the statement and step fields of a
     * PROBLEM card kept theirs, because those are worked examples rather than
     * names, and that is the whole distinction DC-120 step 2 turns on.
     */
    frontLabel: "Prednja strana",
    backLabel: "Zadnja strana",
    deckSelectLabel: "Špil",
    mathHint: "Koristi $…$ za matematičke izraze.",
    editCardLabel: "Izmeni karticu",

    // --- Cloze cards (STUDY-006 / ADR-042) ----------------------------------
    /**
     * The Osnovna/Cloze/Zadatak segmented toggle above the card form. Indexed
     * by the renderer's `CardForm`, NOT by `CardKind`: „Zadatak" is a third
     * FORM of a `basic` card, not a third kind (ADR-046).
     */
    cardKindLabel: "Vrsta kartice",
    cardForm: {
      basic: "Osnovna",
      cloze: "Cloze",
      problem: "Zadatak",
    },
    clozeLabel: "Tekst sa prazninama",
    clozePlaceholder: "Glavni grad Srbije je {{c1::Beograd}}.",
    clozeHint:
      "Stavi {{…}} oko svakog dela koji treba da bude skriven. Broj u {{c1::…}} kaže kojoj kartici praznina pripada — dve praznine sa istim brojem su jedna kartica.",
    /**
     * Wraps the selection in a new deletion and numbers it (ADR-068). A verb:
     * it says what pressing it does, and it is the reason the author never has
     * to count braces or renumber anything by hand.
     */
    clozeAddBlank: "Dodaj prazninu",
    /**
     * The live line under the cloze field: "3 praznine → 3 kartice". Both
     * counted nouns take three Serbian forms (1 / 2–4 / 5+), so they go
     * through `countUnit` rather than `dayUnit`.
     */
    clozeCount: {
      arrow: "→",
      blankOne: "praznina",
      blankFew: "praznine",
      blankMany: "praznina",
      cardOne: "kartica",
      cardFew: "kartice",
      cardMany: "kartica",
      /** Shown instead of the count line while the text has no deletion; creation stays disabled. */
      none: "Nema praznina — dodaj {{…}} da bi nastala kartica.",
    },
    /** Inline refusal when an edit drops the very deletion this card asks about — by NUMBER, not by position (ADR-068). */
    clozeOrdinalMissing: "Ova kartica pita prazninu koju novi tekst više ne sadrži.",

    // --- Problem cards (ADR-046) --------------------------------------------
    /** The statement — the same field a basic card calls its front, named for what it is here. */
    problemStatementLabel: "Tekst zadatka",
    problemStatementPlaceholder: "Nađi izvod funkcije $f(x)=x^2$ u tački $x=1$.",
    problemStepsLabel: "Rešenje po koracima",
    problemStepsPlaceholder: "Izvod je $2x$.\n--\nU tački $x=1$ to je $2$.",
    problemStepsHint: "Odvoji korake redom koji sadrži samo --",
    /**
     * The live line under the solution field: "3 koraka". The counted noun
     * takes all three Serbian forms (1 / 2–4 / 5+), so it goes through
     * `countUnit`, exactly like the cloze count above it.
     */
    problemStepCount: {
      stepOne: "korak",
      stepFew: "koraka",
      stepMany: "koraka",
      /** Shown instead of the count while the solution has no step; creation stays disabled. */
      none: "Nema koraka — upiši rešenje da bi nastala kartica.",
    },
    /** Reveal button on a problem card: each press uncovers the next step. */
    revealNextStep: "Sledeći korak",
    /** Inline fallback when saving a card fails for any other reason. */
    saveCardError: "Kartica nije sačuvana. Pokušaj ponovo.",
    /** Screen-reader label for the masked blank in the review surface. */
    clozeBlankLabel: "skriveni deo",
    deleteCardLabel: "Obriši karticu",
    deletedCardNotice: "Kartica obrisana",
    /** Card-state chip labels; Learning and Relearning share one label (both "in progress"). */
    cardState: {
      new: "Nova",
      learning: "Uči se",
      review: "Na ponavljanju",
    },
    cardDueLabel: "Sledeće ponavljanje",
    /** Source-link control for a note-generated card (ADR-017 / STUDY-008). */
    cardSourcePrefix: "Iz beleške: ",
    cardSourceLabel: "Otvori izvornu belešku",
    cardSourceMissing: "Iz beleške (nedostupna)",

    // --- Review session (keyboard-first) ------------------------------------
    reviewTitle: "Učenje",
    reviewExit: "Prekini",
    revealAnswer: "Prikaži odgovor",
    /** Grade-button labels, keyed by CardRating value (1–4, Again..Easy). */
    rating: {
      again: "Ponovo",
      hard: "Teško",
      good: "Dobro",
      easy: "Lako",
    },
    reviewUndo: "Opozovi",
    reviewHint: "Space — odgovor · 1–4 — ocena · U — opozovi · Esc — izlaz",
    reviewCompleteTitle: "Sve obnovljeno za sada.",
    reviewCompleteLabel: "Ocenjeno kartica",
    reviewBack: "Nazad",

    /**
     * End-of-session summary (STUDY-009). Quiet on purpose: the session is
     * over, so this reports what it was — how the ratings fell, how long it
     * took — rather than congratulating anyone. The four rating labels are
     * `rating` above, reused: the same word must mean the same button.
     */
    summary: {
      durationLabel: "Trajanje",
      /** Shown only when the profile's daily review cap actually cut this queue short (STUDY-007). */
      capReached: "Dnevni limit ponavljanja je dostignut.",
    },

    /**
     * Interleaved practice (STUDY-010 / ADR-047): pick špilovi, get one mixed
     * session across them. „Vežbanje" against „Učenje" is the whole distinction
     * on screen — the ordinary reviewer works through what is due, practice
     * deliberately jumps between topics.
     */
    practice: {
      open: "Vežbaj",
      title: "Vežbanje",
      decksLabel: "Špilovi",
      problemsOnly: "Samo zadaci",
      start: "Počni",
      empty: "Nema kartica za vežbanje u ovom izboru.",
      close: "Otkaži",
      /** The chip naming a card's špil, shown only when a session spans more than one. */
      deckChipLabel: "Špil",
    },

    // --- Exam study plans (Planovi učenja, STUDY piece 3b) -------------------
    plansTitle: "Planovi učenja",
    todayTitle: "Danas za učenje",
    todayEmpty: "Danas nema planiranih blokova učenja.",
    newPlan: "Novi plan",
    addPlan: "Dodaj plan",
    savePlan: "Sačuvaj",
    cancelPlan: "Otkaži",
    planExamLabel: "Ispit",
    planStartLabel: "Početak učenja",
    planMinutesLabel: "Minuta dnevno",
    planBoostLabel: "Duplo vremena poslednjih 7 dana",
    planEdit: "Izmeni",
    planDelete: "Obriši",
    deletedPlanNotice: "Plan obrisan",
    plansEmpty: "Još nema planova učenja.",
    noPlannableExams: "Nema predstojećih ispita za novi plan.",
    /** Plan summary building blocks — "60 min/dan · duplo poslednjih 7 dana". */
    planPerDay: "min/dan",
    planBoostSummary: "duplo poslednjih 7 dana",
    /** Progress phrasing — "3 od 12 urađeno" builds inline. */
    planProgressOf: "od",
    planProgressDone: "urađeno",
    minutesUnit: "min",
    planShowBlocks: "Prikaži blokove",
    planHideBlocks: "Sakrij blokove",
    blockDoneLabel: "Označi blok kao urađen",
    /** Study-block status chip labels, keyed by status value (labels are presentation). */
    blockStatus: {
      planned: "planirano",
      done: "urađeno",
      missed: "propušteno",
    },
    /** Tag chip on read-only study-block rows in the calendar agenda. */
    planCalendarTag: "Učenje",
    /** PlanStore/IPC validation failures mapped to Serbian; `generic` is the fallback. */
    planError: {
      duplicate: "Ovaj ispit već ima aktivan plan.",
      examPast: "Ispit mora biti u budućnosti.",
      startAfterExam: "Početak učenja mora biti pre datuma ispita.",
      minutesRange: "Dnevni minuti moraju biti između 15 i 480.",
      weekdayRange: "Minuti po danu moraju biti celi brojevi od 0 do 480, bar jedan veći od nule.",
      generic: "Čuvanje plana nije uspelo. Pokušaj ponovo.",
    },
    /**
     * Plan-restore failure, mapped separately from `planError`: a stale undo
     * offer that can never succeed again (typically the exam gained a newer
     * active plan in the meantime) rather than a live form's validation.
     */
    planRestoreError: {
      duplicate: "Plan nije vraćen — ispit u međuvremenu ima nov aktivan plan.",
      generic: "Vraćanje plana nije uspelo.",
    },

    // --- Exam topics & the honest planner (ADR-063, slice b) -----------------
    /**
     * Block kind, keyed by the wire's closed `StudyBlockKind` domain. A
     * coverage block renders PLAIN — it is the ordinary case and a chip on
     * every row would be noise — so only revision/recall are ever drawn, but
     * all three are keyed here so the calendar can index by the raw value.
     */
    blockKind: {
      coverage: "obrada",
      revision: "obnavljanje",
      recall: "prisećanje",
    },
    /** Pin toggle on future block rows; the titles say exactly what a pin means. */
    blockPin: "Zakači",
    blockUnpin: "Otkači",
    blockPinTitle: "Zakačen blok preživljava svako ponovno planiranje.",
    blockUnpinTitle: "Otkači blok — sledeće planiranje može da ga pomeri.",
    /** Title on the „Vežbaj" deep link a recall block offers when its topic drills from a špil. */
    blockPracticeTitle: "Pokreni ponavljanje špila ove teme.",
    /** Title on rows inside the final-7-days window (the exam-week posture). */
    examWeekTitle: "Poslednjih 7 dana pred ispit",
    /**
     * Plan health (ADR-063 invariant 5) — building blocks joined inline around
     * the minutes count: „U preostale dane ne staje još 120 min učenja." and
     * „Ispit je prošao — 90 min učenja je ostalo propušteno." Honest reporting,
     * never a silently stretched day.
     */
    healthOverflowPrefix: "U preostale dane ne staje još",
    healthOverflowSuffix: "min učenja.",
    healthExamPassedPrefix: "Ispit je prošao —",
    healthExamPassedSuffix: "min učenja je ostalo propušteno.",
    /**
     * The plan card's scope line (STUDY-004): how many of the exam's topics the
     * user has accepted out of the plan. Three Serbian forms after the count —
     * „1 tema je van plana." / „2 teme su van plana." / „5 tema je van plana."
     */
    scopeCountUnitOne: "tema je van plana.",
    scopeCountUnitFew: "teme su van plana.",
    scopeCountUnitMany: "tema je van plana.",
    /**
     * The scope-cut conversation (STUDY-004): a computed proposal the user must
     * explicitly accept — nothing is ever cut by the machine.
     */
    scopeCut: {
      open: "Predlog skraćenja",
      title: "Predlog skraćenja",
      intro: "Da bi plan stao u preostalo vreme, ove teme bi izašle iz plana:",
      /** „75 min preostalo" beside each proposed topic. */
      minutesSuffix: "min preostalo",
      empty: "Nema tema čije bi isključivanje oslobodilo dovoljno vremena.",
      loadError: "Predlog se trenutno ne može učitati. Pokušaj ponovo.",
      accept: "Prihvati",
      decline: "Odustani",
    },
    /**
     * The exam's topic list inside the plan form (ADR-063). Rank order is both
     * curriculum order and scope-cut priority, which is what the hint says.
     */
    topics: {
      title: "Teme",
      hint: "Redosled je i prioritet — teme sa dna prve izlaze iz plana.",
      empty: "Bez tema plan ostaje jednostavan — jedan blok učenja dnevno.",
      nameLabel: "Naziv teme",
      addPlaceholder: "Nova tema",
      add: "Dodaj temu",
      moveUp: "Pomeri temu naviše",
      moveDown: "Pomeri temu naniže",
      remove: "Obriši temu",
      /**
       * The store soft-deletes a topic and promotes its plan blocks off it —
       * but it has no `restore`, and there is no `topics:restore` channel, so
       * from the user's side the act is final. Until this dialog it fired on a
       * bare „×" beside a list row. The warning states the consequence that
       * costs something and is not obvious: the plan keeps its blocks, they
       * simply stop naming this topic.
       */
      deleteDialog: {
        title: "Brisanje teme",
        warning:
          "Tema se briše i ne može se vratiti. Blokovi u planu ostaju, samo prestaju da nose njeno ime.",
        confirmLabel: "Naziv teme za potvrdu",
        confirmPlaceholder: "Upiši tačan naziv",
        submit: "Obriši",
        cancel: "Otkaži",
      },
      confidenceLabel: "Pouzdanje",
      confidenceUnknown: "Nepoznato",
      /** Muted „izvedeno: 72" beside an unknown manual confidence a LIVE linked špil resolved. */
      derivedPrefix: "izvedeno:",
      deckLabel: "Špil teme",
      deckNone: "Bez špila",
      /**
       * A stored link whose deck is no longer live (the store's `deckMissing`)
       * — one label for both the row's muted chip and the picker's stale
       * option, so the row says the same thing twice rather than lying „Bez
       * špila" once. The title also states the consequence: a dead špil stops
       * feeding the derived confidence, which is why the „izvedeno" hint beside
       * such a row is gone rather than stale.
       */
      deckMissing: "Nedostupan špil",
      deckMissingTitle:
        "Špil ove teme više ne postoji — pouzdanje se više ne izvodi iz njega. Izaberi drugi špil ili ukloni vezu.",
      /** Chip on a topic the user accepted out of the plan (STUDY-004). */
      cutChip: "van plana",
      /** The un-cut action — the only affordance anywhere that returns a cut topic to the plan. */
      uncut: "Vrati u plan",
      uncutTitle: "Vrati temu u plan — sledeće planiranje je ponovo obuhvata.",
      actionError: "Radnja nad temom nije uspela. Pokušaj ponovo.",
    },
    /** Per-weekday minutes Pon..Ned (the labels reuse `recurrence.weekdayShort`). */
    weekdayMinutesLabel: "Minuti po danu",
    weekdayMinutesHint: "Ostavi sve jednako i svaki dan nosi iste dnevne minute.",

    // --- Study stats + focus timer (Statistika i fokus, STUDY piece 4b) ------
    statsTitle: "Statistika i fokus",
    focusTitle: "Tajmer fokusa",
    focusSubjectLabel: "Predmet za fokus",
    focusStart: "Pokreni fokus",
    focusStop: "Zaustavi",
    focusDiscard: "Odbaci",
    focusNoSubjects: "Nema aktivnih predmeta — dodaj predmet da bi pokrenuo tajmer fokusa.",
    focusUnknownSubject: "Nepoznat predmet",
    /**
     * The running phase belongs to no subject — a Pomodoro started from „Fokus"
     * on the same timer (UTIL slice b). Different from „Nepoznat predmet", which
     * means a subject that WAS named and is no longer readable.
     */
    focusNoSubject: "Bez predmeta",
    /** Streak line — "Niz učenja: N dana" + "Najduži niz: M" building blocks. */
    streakLabel: "Niz učenja",
    streakUnitOne: "dan",
    streakUnitMany: "dana",
    streakZero: "Još nema niza učenja — počni danas.",
    streakBestLabel: "Najduži niz",
    statsRecentTitle: "Poslednjih 30 dana",
    statsMinutesTitle: "Minuti po predmetu",
    statsOtherSubject: "Ostalo",
    statsEmpty: "Još nema podataka o učenju u poslednjih 30 dana.",
    statsReviewsLabel: "Ponavljanja",
    /** Block summary — "Blokovi: 5 urađeno · 2 propušteno" builds inline. */
    statsBlocksLabel: "Blokovi",
    statsBlocksDone: "urađeno",
    statsBlocksMissed: "propušteno",
    /**
     * Maturity summary (STUDY-013) — „Sazrele kartice: 4 (ukupno 37 zrelih)"
     * builds inline. The count is the range's; the total in brackets is a live
     * census of the whole collection.
     */
    statsMaturedLabel: "Sazrele kartice",
    statsMaturedTotalPrefix: "ukupno",
    statsMaturedTotalSuffix: "zrelih",
    /**
     * Plan adherence (STUDY-013) — „Praćenje plana: 82%", or the em dash when
     * no block was due in the period, since there is no percentage to give.
     */
    statsAdherenceLabel: "Praćenje plana",
    statsAdherenceNone: "—",
    focusSessionsTitle: "Nedavne sesije fokusa",
    focusSessionsEmpty: "Nema sesija fokusa u poslednjih 7 dana.",
    deleteFocusSessionLabel: "Obriši sesiju fokusa",
    deletedFocusSessionNotice: "Sesija fokusa obrisana",
    /**
     * Shared fallback for the subject/exam/deck/focus-session/card delete and
     * undo actions (and the plan delete, which otherwise shares no copy with
     * `planError`/`planRestoreError`): all are the same shape — a simple
     * delete-with-undo, no validation of its own — so one line covers all of
     * them, exactly like every other module's generic `actionError`.
     */
    actionError: "Radnja nije uspela. Pokušaj ponovo.",
  },

  notifications: {
    bellLabel: "Obaveštenja",
    empty: "Nema novih obaveštenja.",
    /** Shown in place of the list when the initial load failed — distinct from `empty`, which is a real answer. */
    loadError: "Obaveštenja se trenutno ne mogu učitati. Pokušaj ponovo kasnije.",
    /** Shown when a snooze or dismiss failed — the row stays exactly as it was. */
    actionError: "Radnja nije uspela. Pokušaj ponovo.",
    dismissLabel: "Ukloni obaveštenje",
    snoozedUntil: "odloženo do",
    /** Source tag chip on each center row, keyed by NotificationSource value. */
    sourceTag: {
      document: "Dokument",
      exam: "Ispit",
      "study-day": "Učenje",
      event: "Događaj",
      task: "Zadatak",
      security: "Bezbednost",
      subscription: "Pretplata",
      habit: "Navika",
    },
    /** Snooze preset button labels, keyed by SnoozePreset value. */
    snoozePreset: {
      "10m": "10 min",
      "1h": "1 h",
      tonight: "Večeras",
      "tomorrow-morning": "Sutra ujutru",
    },
    /**
     * NTF-009: the one-click snooze, which uses the profile's default preset.
     * Deliberately unlabelled with a duration — main reads the default at the
     * moment of the click, so any duration printed here could be a lie the
     * instant the preference changes in another window. The four presets beside
     * it still say exactly what they do.
     */
    snoozeDefaultAction: "Odloži",
    settings: {
      show: "Podešavanja obaveštenja",
      hide: "Sakrij podešavanja",
      /** Shown in place of the whole body when the settings fetch itself rejected — the disclosure must never open onto nothing with no explanation. */
      loadError: "Podešavanja obaveštenja se trenutno ne mogu učitati. Pokušaj ponovo.",
      quietFromLabel: "Tiho od",
      quietToLabel: "Tiho do",
      quietSave: "Sačuvaj",
      quietClear: "Očisti",
      quietHint: "Podsetnici sačekaju kraj tihih sati; poslednje upozorenje ipak stiže.",
      quietPairingError: "Oba vremena moraju biti popunjena, ili oba prazna.",
      morningHourLabel: "Jutarnji podsetnik u",
      /** NTF-009: which preset the center's plain „Odloži“ button reaches for. */
      snoozeDefaultLabel: "Podrazumevano odlaganje",
      snoozeDefaultHint: "Dugme „Odloži“ u obaveštenjima koristi ovaj izbor.",
      /** Source toggle checkbox labels, keyed by NotificationSource value. */
      sourceToggle: {
        document: "Dokumenta",
        exam: "Ispiti",
        "study-day": "Učenje",
        event: "Događaji",
        task: "Zadaci",
        security: "Bezbednost",
        subscription: "Pretplate",
        habit: "Navike",
      },
      /** NTF-007: why the „Bezbednost“ toggle is on and greyed out. */
      alwaysOnCaption: "Bezbednosna obaveštenja se ne mogu isključiti.",
      saveError: "Čuvanje podešavanja nije uspelo. Pokušaj ponovo.",
    },
    /**
     * The one-time appetite question (NTF-008 / ADR-033), put at the first
     * moment Nexus is actually about to remind. Asked once, ever — so the copy
     * never promises a second chance, and the quiet "Zadrži podrazumevano" is a
     * real answer, not an escape. The three choices reuse
     * `settings.notificationPresets` labels: the same word must mean the same
     * set here and on the Settings page.
     */
    appetite: {
      title: "Koliko da te Nexus podseća?",
      question:
        "Prvi podsetnik je spreman. Izaberi koliko obaveštenja želiš — kasnije sve možeš promeniti u Podešavanjima.",
      keepDefault: "Zadrži podrazumevano",
      saveError: "Čuvanje izbora nije uspelo. Pokušaj ponovo.",
    },
  },

  /**
   * Finansije (FIN slice b). The copy states the module's two structural rules
   * out loud wherever the user could otherwise be surprised by them: totals are
   * per currency because Nexus holds no exchange rate, and a transfer is one
   * act between two of your own accounts rather than an expense with an odd
   * category.
   *
   * Every amount the user sees is produced by `money.ts` — there is no number
   * in this table.
   */
  finance: {
    /**
     * „Tok stanja" — FIN's signature graphic: what the money actually did,
     * day by day, in ONE currency.
     *
     * One chart per currency and never a combined one. Nothing in this product
     * converts between currencies — there is no rate anywhere and there
     * deliberately will not be one — so a single line summing dinars and euros
     * would be the one fabricated number FIN has spent its whole design
     * refusing.
     *
     * A transfer between two of your own accounts moves nothing in or out of
     * the total, and the line is flat across it. That is correct and is said
     * out loud, because a ledger row that visibly „happened" and visibly did
     * nothing to the curve otherwise reads as a bug.
     */
    chart: {
      heading: "Tok stanja",
      caption:
        "Zbir svih računa u ovoj valuti, dan po dan. Prenos između dva sopstvena računa ne menja zbir, pa se na liniji ne vidi.",
      descriptionLead: "Stanje u valuti",
      descriptionFrom: "od",
      descriptionTo: "na",
      emptyReason: "Linija se crta čim u ovom mesecu postoji bar jedna stavka.",
    },
    loadErrorTitle: "Finansije nisu učitane",
    loadError: "Učitavanje finansija nije uspelo. Zatvori i ponovo otvori stranicu.",
    /** The one line every failed write falls back to when `financeErrorMessage` recognizes nothing more specific. */
    actionError: "Radnja nije uspela. Pokušaj ponovo.",
    undo: "Opozovi",
    dismiss: "Zatvori",
    /** The three halves of the page: the book you write into, the month you read back, and the charges that repeat. */
    pages: {
      label: "Prikaz",
      ledger: "Knjiga",
      report: "Izveštaj",
      subscriptions: "Pretplate",
    },
    /**
     * The statement importer's disclosure on this page (FIN slice e). Closed by
     * default: importing a statement is something you do a few times a month,
     * and the ledger is what you came here to look at.
     */
    importDisclosure: {
      show: "Uvoz izvoda (.csv)…",
      hide: "Sakrij uvoz izvoda",
    },
    accounts: {
      heading: "Računi",
      /** The rail's "no account filter" row — a view over every account, not an account. */
      all: "Svi računi",
      archivedHeading: "Arhivirani",
      archivedChip: "Arhiviran",
      newAccount: "Novi račun",
      nameLabel: "Naziv računa",
      namePlaceholder: "Tekući račun",
      kindLabel: "Vrsta",
      currencyLabel: "Valuta",
      /** Three letters, ISO-4217 — the field says the shape rather than offering a list Nexus would have to invent. */
      currencyHint: "Troslovna oznaka, npr. RSD",
      openingLabel: "Početno stanje",
      openingHint: "Stanje na dan kada dodaješ račun. Kasnije se ne menja samo od sebe.",
      kinds: {
        cash: "Gotovina",
        current: "Tekući račun",
        card: "Kartica",
        savings: "Štednja",
      },
      save: "Sačuvaj",
      cancel: "Otkaži",
      edit: "Izmeni",
      archive: "Arhiviraj",
      unarchive: "Vrati iz arhive",
      delete: "Obriši",
      /** The row's „⋯" — everything that can be DONE to an account, behind one control. */
      menuLabel: "Radnje nad računom",
      deletedNotice: "Račun je obrisan, zajedno sa svojim transakcijama.",
      /** The invitation a profile with no accounts sees — never a sample row. */
      emptyTitle: "Još nema računa",
      emptyDescription:
        "Dodaj prvi račun i Nexus će voditi njegovo stanje — sam ga izračunava iz početnog stanja i transakcija.",
      invalidCurrency: "Valuta mora biti troslovna oznaka, na primer RSD.",
      invalidOpening: "Početno stanje nije ispravan iznos.",
      invalidName: "Naziv računa ne može biti prazan.",
    },
    /**
     * The band at the top of the page — „Ukupno" and, on „Knjiga", what came in
     * and went out of the rows currently on screen. The figures are the message,
     * so the explanation is a CAPTION under them and never the paragraph beside
     * them it used to be.
     */
    totals: {
      heading: "Ukupno",
      /**
       * Said out loud, because the absence of one number is the design and not
       * an omission: without kursa nijedan zbir preko valuta ne bi bio istinit.
       */
      caption: "Po valuti — Nexus nema kurs, pa se stanja u različitim valutama nikada ne sabiraju.",
      /**
       * The same, plus the two things the flow figures beside „Ukupno" would
       * otherwise be misread as: they cover the PRIKAZANE rows (a filter changes
       * them) and they leave prenosi out, because a prenos is neither prihod
       * nor rashod anywhere in this module.
       */
      captionLedger:
        "Ukupno je zbir aktivnih računa. Prihod i rashod se odnose na prikazane stavke; prenosi se ne računaju. Nexus nema kurs, pa se valute nikada ne sabiraju.",
      /** Where a balance would stand for a currency the profile keeps no active account in — never a zero, which would be a claim. */
      noBalance: "—",
      /** Shown while the profile has accounts but every one of them is archived. */
      none: "Nema aktivnih računa.",
    },
    categories: {
      heading: "Kategorije",
      newCategory: "Nova kategorija",
      namePlaceholder: "Hrana",
      kinds: {
        income: "Prihod",
        expense: "Rashod",
      },
      delete: "Obriši",
      /** Stated on the delete affordance itself: what survives matters more than what goes. */
      deleteHint: "Transakcije ostaju — samo gube kategoriju.",
      /**
       * The hint above was doing the whole job: a HARD delete (`DELETE FROM
       * fin_categories`, unlike an account's) fired on one click of a bare „×",
       * with no restore endpoint behind it, while NOTE's identical category rail
       * asked for the name back. The warning also states the part the hint left
       * out — a budget limit set on this category goes with it, and that one
       * does NOT survive the way the transactions do.
       */
      deleteDialog: {
        title: "Brisanje kategorije",
        warning:
          "Kategorija se trajno briše, zajedno sa limitom potrošnje ako ga ima. Transakcije ostaju — samo gube kategoriju.",
        confirmLabel: "Naziv kategorije za potvrdu",
        confirmPlaceholder: "Upiši tačan naziv",
        submit: "Obriši",
        cancel: "Otkaži",
      },
      empty: "Još nema kategorija.",
      duplicate: "Kategorija sa tim imenom već postoji.",
      invalidName: "Ime kategorije ne može biti prazno.",
      /** The chip opens the editor, which does both things — hence „Uredi" rather than „Preimenuj". */
      edit: "Uredi",
      editHint: "Preimenuj kategoriju ili joj postavi budžet.",
    },
    /**
     * Budžeti (FIN slice c). Edited where categories are edited, because a
     * budget IS a category's monthly limit and has no life of its own.
     *
     * The copy states the two things the user would otherwise have to guess:
     * a limit is per currency (there is no kurs to fold two into one), and it
     * belongs only to a rashod category — a prihod category would want a
     * target, which compares the other way around.
     */
    budgets: {
      heading: "Budžet",
      /** On a category chip that carries one — a word, never an amount: one category can hold one limit per currency. */
      marker: "limit",
      hint: "Mesečni limit, po valuti — Nexus nema kurs, pa se limiti u različitim valutama nikada ne sabiraju.",
      incomeOnly: "Budžet ima samo rashodna kategorija: limit ograničava trošak.",
      currencyLabel: "Valuta",
      amountLabel: "Mesečni limit",
      set: "Postavi",
      /** On the × beside one currency's allowance. */
      clearHint: "Uklanja limit samo u ovoj valuti.",
      none: "Nema postavljen limit.",
      needsAccount: "Prvo dodaj račun — limit se postavlja u valuti nekog tvog računa.",
      invalidAmount: "Limit mora biti iznos veći od nule. Ako ga ne želiš, ukloni ga.",
    },
    /**
     * Izveštaj (FIN slice c) — what ONE month held, and nothing beyond it.
     *
     * The copy is bound by the honesty rule the whole module is built on: the
     * report states what happened. There is no prognoza, no procena, no „ovim
     * tempom ćeš…" anywhere in this table, because there is no such number
     * anywhere in the code that fills it.
     */
    report: {
      previousMonth: "Prethodni mesec",
      nextMonth: "Sledeći mesec",
      thisMonth: "Ovaj mesec",
      income: "Prihod",
      expense: "Rashod",
      /** Under a section's head, only when something in it actually has a limit — otherwise the mark has nothing to explain. */
      barsCaption: "Traka je potrošeno, crta je limit.",
      noBudget: "nema limita",
      over: "preko limita",
      /** A currency that only saw income this month — its own fact, not an empty page. */
      noSpending: "Nema rashoda u ovoj valuti ovog meseca.",
      /** Shown only when some line actually went negative: the minus is a fact, not a bug. */
      refundNote: "Minus znači da su povraćaji tog meseca bili veći od troška.",
      /** The caption the whole report stands on — said out loud so nobody waits for a prediction that will never come. */
      caption:
        "Samo ovaj mesec i samo po valuti. Nexus ne predviđa potrošnju i ne procenjuje limit umesto tebe.",
      emptyTitle: "Ovaj mesec je prazan",
      emptyDescription:
        "Nema ni prihoda ni rashoda u ovom mesecu. Prenos između tvojih računa se ovde ne računa — to nije ni prihod ni rashod.",
      loadErrorTitle: "Izveštaj nije učitan",
      loadError: "Učitavanje izveštaja nije uspelo. Izaberi mesec ponovo.",
    },
    ledger: {
      /** The entry form is a disclosure now: the ledger is read far more often than it is written to. */
      newTransaction: "Nova transakcija",
      /**
       * How many rows the filters left standing — the one thing a filtered
       * ledger owes the reader that the rows themselves cannot say.
       */
      itemsOne: "stavka",
      itemsFew: "stavke",
      itemsMany: "stavki",
      emptyTitle: "Još nema transakcija",
      emptyDescription: "Dodaj prvu transakciju — iznos, opis i datum su dovoljni.",
      /** When a filter matches nothing, which is a different fact from an empty ledger. */
      filterEmptyTitle: "Ništa ne odgovara filterima",
      filterEmptyDescription: "Promeni račun, kategoriju ili period da vidiš više.",
      uncategorized: "Bez kategorije",
      transfer: "Prenos",
      /** Between the two account names on a transfer row: „Tekući → Štednja". */
      transferArrow: "→",
      deletedNotice: "Transakcija je obrisana.",
      edit: "Izmeni",
      delete: "Obriši",
    },
    form: {
      /** The three acts the one form can perform; the choice decides the sign and what the row may carry. */
      kindExpense: "Rashod",
      kindIncome: "Prihod",
      kindTransfer: "Prenos",
      kindLabel: "Vrsta unosa",
      amountLabel: "Iznos",
      amountPlaceholder: "0,00",
      payeeLabel: "Opis",
      payeePlaceholder: "Prodavnica",
      dateLabel: "Datum",
      accountLabel: "Račun",
      fromAccountLabel: "Sa računa",
      toAccountLabel: "Na račun",
      categoryLabel: "Kategorija",
      categoryNone: "Bez kategorije",
      noteLabel: "Beleška",
      submitAdd: "Dodaj",
      submitSave: "Sačuvaj",
      cancel: "Otkaži",
      invalidAmount: "Iznos nije ispravan. Upiši ga kao 1234,56.",
      zeroAmount: "Iznos ne može biti nula.",
      missingCounter: "Izaberi i račun sa kojeg i račun na koji ide prenos.",
      needsAccount: "Prvo dodaj račun — transakcija mora negde da stane.",
    },
    filters: {
      categoryLabel: "Filter po kategoriji",
      categoryAll: "Sve kategorije",
      categoryNone: "Bez kategorije",
      /** Names the „Od – Do" pair as ONE control, so each half needs only its own short name. */
      periodLabel: "Period",
      fromLabel: "Od",
      toLabel: "Do",
      clear: "Poništi filtere",
      invalidPeriod: "„Od“ ne može biti posle „Do“.",
    },
    views: {
      /** Its own name, distinct from `pages.label`: two groups on one screen both announced „Prikaz" name nothing. */
      label: "Oblik knjige",
      list: "Lista",
      cards: "Kartice",
    },
    /**
     * The refusals the three stores name (FIN slice a). Each one is matched off
     * the store's own message text, exactly as `planErrorMessage` does for
     * STUDY — the store stays the authority on what is rejected, and this is
     * only how the page says it in Serbian.
     */
    error: {
      transferSameAccount: "Prenos ide između dva različita računa.",
      transferCurrency:
        "Prenos ne može da pređe iz jedne valute u drugu — Nexus nema kurs. Upiši dve obične transakcije.",
      transferCategory: "Prenos nema kategoriju: to nije ni prihod ni rashod.",
      /** The store's refusal to put a limit on an income category, said in Serbian. */
      budgetOnIncome: "Budžet ide samo na rashodnu kategoriju — prihod se ne ograničava.",
      budgetAmount: "Limit mora biti iznos veći od nule.",
      notFound: "Taj zapis više ne postoji. Osveži stranicu.",
      /** The store's refusal of a schedule it cannot read (FIN slice d). */
      recurrenceInvalid: "Ponavljanje nije ispravno postavljeno.",
    },
    /**
     * Pretplate (FIN slice d) — the charges that repeat. The copy is bound by
     * the same honesty the report is: what is „predstojeće" comes from the RULE,
     * and Nexus never writes a charge before its day arrives, which is said out
     * loud in `caption` so nobody looks for a balance that already counts it.
     */
    subscriptions: {
      newSubscription: "Nova pretplata",
      caption:
        "Naplata se upisuje tek onog dana kada se dogodi — do tada je ovo samo raspored. Upisana naplata je obična transakcija: možeš je izmeniti ili obrisati.",
      emptyTitle: "Još nema pretplata",
      emptyDescription:
        "Dodaj ono što se naplaćuje samo od sebe — pretplatu, članarinu, ratu. Nexus će upisati svaku naplatu na njen dan.",
      needsAccountTitle: "Prvo dodaj račun",
      needsAccountDescription: "Pretplata se naplaćuje sa računa, pa najpre treba da postoji jedan.",
      nameLabel: "Naziv",
      namePlaceholder: "Netflix",
      amountLabel: "Iznos",
      accountLabel: "Račun",
      categoryLabel: "Kategorija",
      startLabel: "Prva naplata",
      reminderLabel: "Podseti me",
      reminderNone: "Bez podsetnika",
      /** The lead-time options, in days — the ones a renewal is actually worth hearing about. */
      reminderOptions: {
        "0": "Na dan naplate",
        "1": "Dan ranije",
        "3": "Tri dana ranije",
        "7": "Nedelju dana ranije",
      },
      noteLabel: "Beleška",
      save: "Sačuvaj",
      cancel: "Otkaži",
      edit: "Izmeni",
      delete: "Obriši",
      /** The row's „⋯": brisanje is the one act on a subscription that clicking the same button again does not undo. */
      menuLabel: "Još radnji",
      deletedNotice: "Pretplata je obrisana.",
      /**
       * Pauza (ADR-074) — „zadrži pretplatu, ali me ne naplaćuj". A state of its
       * own beside brisanje: the row stays in the list, stays izmenjiva, and
       * simply stops being charged. „Nastavi“ pokreće naplatu od prve naredne po
       * pravilu — meseci provedeni na pauzi se nikada ne naplaćuju unazad, što je
       * cela razlika u odnosu na „obriši pa napravi ponovo“.
       */
      pause: "Pauziraj",
      resume: "Nastavi",
      /** The chip on a paused row — a statement about the pretplata, never a warning: ništa nije odbijeno. */
      pausedChip: "Pauzirano",
      pausedChipTitle: "Naplata je zaustavljena. „Nastavi“ je pokreće od prve naredne.",
      /** What stands where the next charge's date would be, on a row that will not be charged. */
      pausedNext: "Bez naplate",
      /** A series past its `until`/`count` end: nothing more will be charged. */
      finished: "Nema više naplata",
      /** The chip on a row that reminds, beside the lead time. */
      reminderChip: "Podsetnik",
      /** The little list under the form: what the rule will charge next. */
      upcomingHeading: "Predstojeće naplate",
      upcomingEmpty: "Nema naplata u naredna tri meseca.",
      invalidName: "Upiši naziv pretplate.",
      invalidAmount: "Iznos nije ispravan. Upiši ga kao 1234,56.",
      zeroAmount: "Iznos ne može biti nula.",
      invalidStart: "Izaberi datum prve naplate.",
      /** The one thing the form decides that the ledger form does not: which way the money goes. */
      directionLabel: "Smer",
      directionOut: "Naplata",
      directionIn: "Priliv",
    },
  },

  /**
   * Navike (HABIT slice b). The copy states the module's two structural rules
   * wherever the user could otherwise be surprised: a niz breaks only after a
   * period that is OVER, and every figure is a fraction of what the schedule
   * actually asked for — there is no percentage anywhere on this page, because a
   * percentage invites the reading that something was measured continuously.
   *
   * Nothing here is a number: the fractions are built from what the store
   * returned, and the unit of a measured habit („čaša", „km") is the user's own
   * word, printed exactly as typed rather than inflected — Nexus does not know
   * how to decline a word it was handed.
   */
  habits: {
    loadErrorTitle: "Navike nisu učitane",
    loadError: "Učitavanje navika nije uspelo. Zatvori i ponovo otvori stranicu.",
    /** The one line every failed write falls back to when `habitErrorMessage` recognizes nothing more specific. */
    actionError: "Radnja nije uspela. Pokušaj ponovo.",
    undo: "Opozovi",
    dismiss: "Zatvori",
    /**
     * The band above the wall. Every figure in it is counted off rows this page
     * has genuinely loaded — today's tick state, the live habits, the longest
     * niz actually standing — and the third one is ABSENT rather than zero when
     * no niz is running, because „0 dana" beside no habit's name is a figure
     * about nobody.
     */
    band: {
      today: "Urađeno danas",
      active: "Aktivne navike",
      /** Label-first, so the count needs no numeral agreement: „Arhivirano: 3". */
      archived: "Arhivirano",
      streak: "Najduži niz u toku",
    },
    /**
     * „Zid navika" — the module's signature graphic: every habit as a row, every
     * day as a square, the whole regimen's texture at once.
     *
     * Deliberately NOT a second version of the per-habit calendar below it. That
     * one answers „how is THIS habit going" and is a control — its cells are
     * buttons and are sized like ones. The wall answers „is my regimen alive",
     * is read at a glance, and is only ever looked at: a square that small is
     * texture, not a target, and two places to correct the same day is how they
     * would start disagreeing.
     */
    wall: {
      heading: "Zid navika",
      /** The window comes from `WALL_WEEKS`, so this line never names a number the drawing does not honour. */
      captionPrefix: "Poslednjih",
      caption:
        "Jedan kvadrat je jedan dan jedne navike. Prazno mesto znači da tog dana navika nije ni tražena — kvota ne traži nijedan dan posebno.",
      /**
       * The read-aloud sentence is composed from these and the counts
       * themselves, so it cannot drift from the picture. Label-first („ispunjeno
       * 41") rather than counted-noun („41 ispunjen dan") on purpose: a tally
       * read out label-first needs no numeral agreement at all, and three
       * counted nouns would have cost nine strings to inflect correctly.
       */
      descriptionLead: "Zid navika",
      descriptionDone: "ispunjeno",
      descriptionPartial: "započeto",
      descriptionMissed: "propušteno",
      legendDone: "Ispunjeno",
      /** Only a MEASURED habit can be half-done; a binary one has no middle. */
      legendPartial: "Započeto",
      legendMissed: "Propušteno",
      /** A wall with no habits is absent, not an empty lattice waiting to be filled. */
      emptyReason: "Zid se crta čim postoji bar jedna navika.",
      /** Said once: the picture is not where a day is corrected. */
      note: "Zid se samo gleda. Dan se ispravlja u kalendaru same navike, ispod.",
    },
    /**
     * „Danas" is the CHECKLIST — the one act this page is opened for. It is a
     * short table rather than a second copy of the register below it: the same
     * habits are here, but what is said about them is today's state, and every
     * word that would otherwise repeat down the column („Niz", „ove nedelje")
     * is said once in the head instead.
     */
    today: {
      heading: "Danas",
      /**
       * Said above the list, because the mix is otherwise puzzling: a habit with
       * fixed days shows up on those days, while one with a weekly quota shows
       * up every day — any day counts towards its week.
       */
      caption: "Navike koje se danas očekuju. One sa nedeljnom kvotom stoje ovde svaki dan.",
      /** The column heads. Each of them carries a word that would otherwise be retyped on every row. */
      columnHabit: "Navika",
      columnWeek: "Ove nedelje",
      columnStreak: "Niz",
      columnToday: "Danas",
      /** Nothing is scheduled for today — a different fact from having no habits at all. */
      emptyTitle: "Danas nema ničega.",
      emptyDescription: "Sve što vodiš stoji ispod, u „Sve navike“.",
    },
    /**
     * „Sve navike" is the REGISTER, and that is the whole difference between it
     * and „Danas": this list says what each habit ASKS FOR — its raspored, its
     * cilj, its podsetnik — and it is the only place a habit is made, changed,
     * archived or deleted. „Danas" says what has been done about them today and
     * offers no management at all, so the two lists never repeat one another
     * even when they hold the same habits.
     */
    all: {
      heading: "Sve navike",
      caption:
        "Šta svaka navika traži od tebe. Ovde se navika pravi, menja, arhivira i briše; otvori je za istoriju i brojeve.",
      /** The row's disclosure — one verb each way, since the row itself is the label. */
      expand: "Prikaži detalje",
      collapse: "Sakrij detalje",
      /** The invitation a profile with no habits sees — never a sample habit. */
      emptyTitle: "Još nema navika",
      emptyDescription:
        "Dodaj prvu naviku — reci koliko često je radiš i Nexus vodi niz i istoriju umesto tebe.",
      newHabit: "Nova navika",
      edit: "Izmeni",
      archive: "Arhiviraj",
      unarchive: "Vrati iz arhive",
      delete: "Obriši",
      /** The register row's third level: the hour a habit nudges at, when it has one. */
      reminderPrefix: "Podsetnik",
      /** An archived row states itself in words rather than in a chip: it is a fact about the navika, never a warning. */
      archived: "Arhivirano",
      archivedTitle: "Više se ne očekuje. Istorija i statistika ostaju.",
      deletedNotice: "Navika je obrisana, zajedno sa svojom istorijom.",
    },
    /** The habit's own details, under an expanded row. */
    detail: {
      /**
       * Opens both „Poslednjih N …" headings — the history grid's weeks and the
       * completion figure's days. The NUMBER is never written here: it comes
       * from the constant that actually governs the span (`HISTORY_WEEKS`,
       * `HABIT_WINDOW_DAYS`), so a heading cannot outlive the window it names,
       * and the counted noun inflects through `countUnit`/`dayUnit` beside it.
       */
      windowPrefix: "Poslednjih",
      /** The legend names the grid's three states, so a colour never has to be guessed. */
      legendDone: "Urađeno",
      legendMissed: "Propušteno",
      legendOff: "Nije se očekivalo",
      streakCurrent: "Trenutni niz",
      streakBest: "Najduži",
      /** Trailing noun of the fraction, agreeing with the number of periods (`countUnit` / `dayUnit`). */
      dayUnitOne: "dan",
      dayUnitMany: "dana",
      weekUnitOne: "nedelja",
      weekUnitFew: "nedelje",
      weekUnitMany: "nedelja",
      /** What „11/13 dana" is a fraction OF — said out loud, because the denominator is not „30". */
      windowDaysCaption: "Od dana koje raspored očekuje. Dan koji još traje se ne računa.",
      windowWeeksCaption: "Od nedelja sa kvotom. Nedelja koja još traje se ne računa.",
      /** A habit with nothing behind it yet: no niz, no fraction, and no invented zero. */
      noHistory: "Još nema upisanih dana.",
      /**
       * Slice c: what a click on a history cell does, as the cell's own label
       * after the date („sreda, 8. jul 2026.: označi kao urađeno"). Two verbs and
       * no third, because the cell has exactly two states a click can move it
       * between.
       */
      cellMark: "označi kao urađeno",
      cellUnmark: "poništi kao urađeno",
      /**
       * Why some squares respond and some do not — said out loud, because „this
       * one is inert" is not something a colour can express. Both refusals are
       * the same refusal main makes (`asHabitEntryDay`).
       */
      gridHint:
        "Klikni na dan da ga ispraviš. Dani koje raspored nije tražio, kao i dani pre nego što je navika napravljena, ne mogu se upisati.",
    },
    /** How a habit's schedule reads on a row. */
    schedule: {
      everyDay: "Svaki dan",
      /** Prefix of the quota reading, e.g. „3× nedeljno". */
      perWeekSuffix: "× nedeljno",
      /** Short weekday names, ISO order (1 = ponedeljak), for the picker and the row summary. */
      weekdayShort: ["Pon", "Uto", "Sre", "Čet", "Pet", "Sub", "Ned"],
      weekdayLong: [
        "ponedeljak",
        "utorak",
        "sreda",
        "četvrtak",
        "petak",
        "subota",
        "nedelja",
      ],
    },
    form: {
      newTitle: "Nova navika",
      editTitle: "Izmena navike",
      nameLabel: "Naziv",
      namePlaceholder: "Voda",
      colorLabel: "Boja",
      noColor: "Bez boje",
      /** The Dani/Kvota switch — the module's two kinds, and there is no third. */
      kindLabel: "Raspored",
      kindDays: "Dani",
      kindQuota: "Kvota",
      kindDaysHint: "Očekuje se tačno onih dana koje izabereš.",
      kindQuotaHint: "Bilo koji dani u nedelji — bitno je koliko puta, ne koji dan.",
      weekdaysLabel: "Dani u nedelji",
      everyDay: "Svaki dan",
      perWeekLabel: "Puta nedeljno",
      /** The optional pair. Clearing the target clears the unit, because the store refuses a unit with nothing to count. */
      targetLabel: "Dnevni cilj",
      targetPlaceholder: "8",
      targetHint: "Ostavi prazno za naviku koja se samo čekira.",
      unitLabel: "Jedinica",
      unitPlaceholder: "čaša",
      unitHint: "Jedinica ide uz cilj — bez cilja se briše.",
      /**
       * Slice c: the hour a habit nudges at, or nothing at all — which is what
       * every habit ships with. The hint states the two rules that keep the
       * reminder from becoming noise, because a user who knows them will trust
       * it enough to set one.
       */
      reminderLabel: "Podseti me",
      /** The time field that appears once the switch is on — its own label, because the switch's says something else. */
      reminderTimeLabel: "Vreme podsetnika",
      reminderHint:
        "Stiže samo onim danima kada se navika očekuje, i samo ako do tada nije urađena.",
      save: "Sačuvaj",
      cancel: "Otkaži",
      invalidName: "Upiši naziv navike.",
      invalidWeekdays: "Izaberi bar jedan dan u nedelji.",
      invalidTarget: "Dnevni cilj mora biti ceo broj veći od nule.",
      /** Its own line, because „nije ceo broj" would be a lie about a number that simply exceeds the store's ceiling. */
      targetTooLarge: "Dnevni cilj je prevelik.",
      invalidUnit: "Jedinica je predugačka.",
      invalidSchedule: "Raspored nije ispravan.",
      unitNeedsTarget: "Jedinica bez cilja nema šta da meri — upiši cilj ili obriši jedinicu.",
      notFound: "Ta navika više nije tu. Osveži stranicu.",
    },
    /** The measured habit's stepper in „Danas". */
    stepper: {
      increase: "Dodaj jedan",
      decrease: "Oduzmi jedan",
      /** The binary habit's tick, as a label for a screen reader. */
      check: "Označi kao urađeno",
    },
  },

  /**
   * Fokus (UTIL slice b) — the ONE focus timer's own page. The copy states the
   * module's structural rules wherever the screen could otherwise mislead:
   *
   * - **A phase past its plan says so.** „Prekoračeno" and a `+` clock, never a
   *   00:00 that reads like a phase that quietly ended. Nothing ends by itself.
   * - **A paused phase says it is paused** and its figure is frozen, so no word
   *   here suggests time is still being counted.
   * - **A break is named as a break.** „Pauza" and „Duga pauza" are phases with
   *   their own rows, and today's summary states them even at zero — somebody
   *   who never stops has to be able to see that.
   * - Nothing here is a number and nothing is invented: every figure comes from
   *   phases that really ran, and a day with none says so in words.
   */
  focus: {
    /**
     * „Trake pažnje" — FOCUS's signature graphic: today's finished phases laid
     * on one time axis, so the RHYTHM of the day shows — three long blocks
     * before noon and nothing after, or twelve fragments with breaks between
     * them.
     *
     * A phase's bar is wall clock, start to end, because that is the span it
     * occupied in the day. The MINUTES figure beside it subtracts pauses,
     * because that is the attention it actually held. Those two are not the
     * same number and the caption says so, rather than letting a reader
     * discover it by comparing them.
     *
     * There is no „prekinuto" lane. A cancelled timer is never written down at
     * all, so a bucket for it would be permanently empty and would read as
     * „you never abandon anything", which is a claim the data cannot make.
     */
    chart: {
      heading: "Trake pažnje",
      workLane: "Rad",
      shortBreakLane: "Kratka pauza",
      longBreakLane: "Duga pauza",
      caption:
        "Današnje faze na jednoj vremenskoj osi. Traka ide od početka do kraja faze, pa uključuje i pauze unutar nje; izmereni minuti pored ne uključuju.",
      descriptionLead: "Trake pažnje danas",
      descriptionPhases: "faza",
      nowLabel: "sada",
      emptyReason: "Trake se crtaju čim danas postoji bar jedna završena faza.",
    },
    loadErrorTitle: "Fokus nije učitan",
    loadError: "Učitavanje fokusa nije uspelo. Zatvori i ponovo otvori stranicu.",
    actionError: "Radnja nije uspela. Pokušaj ponovo.",
    undo: "Opozovi",
    dismiss: "Zatvori",
    /** The three phase kinds, named the same way everywhere they appear. */
    kind: {
      work: "Rad",
      short_break: "Pauza",
      long_break: "Duga pauza",
    },
    /** The running phase, front and centre. */
    running: {
      /** Above the clock: „U toku · Rad". */
      heading: "U toku",
      pausedHeading: "Pauzirano",
      /**
       * Said under the clock once the plan is behind you. It states a fact and
       * asks for nothing: the phase is still running, and closing it is yours.
       */
      overrun: "Prekoračeno — faza i dalje teče dok je ne završiš.",
      /** Below the clock: what this phase is attached to, when it is attached to anything. */
      subjectPrefix: "Predmet",
      taskPrefix: "Zadatak",
      /** An open-ended phase — STUDY's shape, and what „Fokus" shows if one is running. */
      openEnded: "Bez planiranog kraja",
      pause: "Pauziraj",
      resume: "Nastavi",
      stop: "Završi",
      /** Ends the phase without recording it — the same act „Učenje" calls „Odbaci". */
      discard: "Odbaci",
      discardTitle: "Zatvori fazu bez upisivanja u istoriju.",
      /** Asked before the discard actually runs (shared with STUDY's own „Odbaci" — same phase, same act, one dialog). */
      discardDialog: {
        title: "Odbacivanje faze",
        question: "Faza se zatvara bez upisivanja u istoriju — proteklo vreme se gubi.",
        confirm: "Odbaci",
        cancel: "Otkaži",
      },
    },
    /** Nothing runs: what to start, and what to attach to it. */
    idle: {
      heading: "Sledeća faza",
      /**
       * Said above the start button. The cycle is what the config says, and this
       * is where the user learns that the next phase was decided rather than
       * chosen for them.
       */
      caption: "Nexus predlaže sledeću fazu po tvom ciklusu. Možeš pokrenuti bilo koju.",
      start: "Pokreni",
      /**
       * The explicit starts, offered only for the kinds the suggestion is NOT.
       * „Pokreni" and „Pokreni rad" used to sit side by side doing the identical
       * thing whenever the cycle suggested work — two buttons at the same volume
       * for one act, which is the „one surface, one primary" rule broken by a
       * duplicate rather than by a second colour.
       */
      startWork: "Pokreni rad",
      startShortBreak: "Pokreni pauzu",
      startLongBreak: "Pokreni dugu pauzu",
      /** The optional attachment — a subject, a task, or neither, which is the ordinary case. */
      attachLabel: "Uz šta radiš",
      attachNone: "Ni uz šta",
      attachTaskGroup: "Zadaci",
      attachSubjectGroup: "Predmeti",
      /** What a phase is CALLED — the snapshot that keeps a row readable once its task is gone. */
      labelLabel: "Naziv faze",
      labelPlaceholder: "Pisanje izveštaja",
      labelHint: "Ostaje upisan uz fazu i kada zadatka više ne bude.",
      // A „Minuta" label lived here for a field this panel does not have and
      // should not: a phase's length is the Pomodoro shape, and that is the
      // settings quartet („Rad (minuta)" and its three siblings), not something
      // retyped before every phase. Deleted rather than given a control,
      // because the control would be a second place to say one number.
    },
    /** Today's phases, and the week behind them. */
    today: {
      heading: "Danas",
      /** Per-kind summary — „Rad: 4 faze · 1 h 40 min". Every kind is shown, zeros included. */
      phaseUnitOne: "faza",
      phaseUnitFew: "faze",
      phaseUnitMany: "faza",
      /**
       * Said when today holds nothing at all. Drawn INLINE — one list inside a
       * page that already carries the timer panel — so the two halves are joined
       * into one sentence and the title ends in a full stop rather than running
       * straight into the invitation after it.
       */
      emptyTitle: "Danas još nema nijedne faze.",
      emptyDescription:
        "Pokreni prvu fazu — Nexus vodi vreme, pauze i istoriju umesto tebe.",
      /** The zero that has something to say: no break was taken all day. */
      noBreaks: "Danas nijedna pauza.",
    },
    /** The short history under today — the last week, newest first. */
    history: {
      heading: "Poslednjih 7 dana",
      empty: "Nema faza u poslednjih 7 dana.",
      /** A row's action; one pending undo at a time, exactly as everywhere else. */
      delete: "Obriši",
      deletedNotice: "Faza je obrisana.",
      /** The chip on a phase that ran past its plan — a fact about the row, never a warning. */
      overrunChip: "Prekoračeno",
      /** The chip on a phase with no plan at all — STUDY's timer, honestly labelled. */
      openEndedChip: "Bez plana",
    },
  },

  /**
   * Alatke (UTIL slice c) — the tool drawer.
   *
   * **Every tool here converts a PHYSICAL quantity or works something out from
   * numbers the user typed.** There is no currency converter and there will not
   * be one: Nexus does not convert money between currencies, because a rate an
   * offline app cannot verify is a number that silently misstates money. Each
   * currency is tracked on its own terms instead — which is what „Finansije"
   * already tells the user („Nexus nema kurs").
   *
   * **`loanCaveat` is the one line in this group that is not a label.** An
   * annuity figure that does not say what it assumed cannot be checked, and a
   * user comparing it to a bank's offer will find the bank's number higher. The
   * caveat says why, on screen, in the calm register the rest of the app uses.
   */
  tools: {
    title: "Alatke",
    searchLabel: "Pretraži alatke",
    searchPlaceholder: "Pretraži alatke…",
    /** Nothing matched what was typed. Says what to do, and does not scold. */
    noMatches: "Nijedna alatka ne odgovara pretrazi.",
    clearSearch: "Poništi pretragu",
    /**
     * Every `ToolCategory` in Serbian, both drawers' worth, in one map.
     *
     * One map rather than one per drawer because a category belongs to a
     * drawer through `TOOL_CATEGORY_DRAWER` and not through where its label
     * happens to be stored — and a second map is how a category ends up
     * labelled in one place and rendered as a raw id in the other.
     */
    category: {
      conversion: "Pretvaranje",
      calculation: "Računanje",
      numbers: "Brojevi i bitovi",
      riscv: "RISC-V",
      encoding: "Kodiranje",
      data: "Podaci",
      text: "Tekst",
      design: "Boje i dizajn",
      crypto: "Kriptografija",
      system: "Mreža i sistem",
      time: "Vreme",
      geometry: "Mere i geometrija",
      materials: "Materijal i utrošak",
      structure: "Opterećenje i nosivost",
      electrical: "Struja",
      media: "Slika, zvuk i video",
      body: "Telo i trening",
      finance: "Novac",
    },
    /**
     * The line under the drawer's name. Composed from the registry, never
     * written down — see the same key in `strings/pro.ts`.
     */
    subtitle: "{count} {unit}",
    /** Numeral agreement for the count above — three forms, through `countUnit`. */
    unitTool: { one: "alatka", few: "alatke", many: "alatki" },
    /** Shared by every converter surface. */
    convert: {
      valueLabel: "Vrednost",
      fromLabel: "Iz",
      toLabel: "U",
      swap: "Zameni mesta",
      /** The one refusal a converter has: the text is not a number this grammar admits. */
      invalid: "Upiši broj — decimale sa zarezom, bez tačke za hiljade.",
    },
    /** Tool display names, keyed by tool id — `ToolRegistration.titleKey` points at these. */
    name: {
      duzina: "Dužina",
      masa: "Masa",
      zapremina: "Zapremina",
      temperatura: "Temperatura",
      povrsina: "Površina",
      brzina: "Brzina",
      podaci: "Podaci",
      procenat: "Procenat",
      pdv: "PDV",
      kredit: "Kredit",
      "jedinicna-cena": "Cena po jedinici",
    } satisfies Record<string, string>,
    /**
     * Unit names, keyed by `UnitDef.id`.
     *
     * The data units spell their factor out — „kB (1000 B)" against „KiB
     * (1024 B)" — because those two are different quantities that look like the
     * same word, and a drawer that offered one „kilobajt" would be wrong for
     * whoever meant the other. The US volume units name their country for the
     * same reason: an imperial gallon is not a US one.
     */
    unit: {
      mm: "milimetar (mm)",
      cm: "centimetar (cm)",
      dm: "decimetar (dm)",
      m: "metar (m)",
      km: "kilometar (km)",
      in: "inč (in)",
      ft: "stopa (ft)",
      yd: "jard (yd)",
      mi: "milja (mi)",
      nmi: "nautička milja (nmi)",
      mg: "miligram (mg)",
      g: "gram (g)",
      dag: "dekagram (dag)",
      kg: "kilogram (kg)",
      t: "tona (t)",
      oz: "unca (oz)",
      lb: "funta (lb)",
      ml: "mililitar (ml)",
      cl: "centilitar (cl)",
      dl: "decilitar (dl)",
      l: "litar (l)",
      hl: "hektolitar (hl)",
      m3: "kubni metar (m³)",
      "floz-us": "tečna unca (SAD)",
      "gal-us": "galon (SAD)",
      degc: "stepen Celzijusa (°C)",
      degf: "stepen Farenhajta (°F)",
      k: "kelvin (K)",
      mm2: "kvadratni milimetar (mm²)",
      cm2: "kvadratni centimetar (cm²)",
      m2: "kvadratni metar (m²)",
      ar: "ar (a)",
      ha: "hektar (ha)",
      km2: "kvadratni kilometar (km²)",
      ft2: "kvadratna stopa (ft²)",
      ac: "aker (ac)",
      ms: "metar u sekundi (m/s)",
      kmh: "kilometar na sat (km/h)",
      mph: "milja na sat (mi/h)",
      kn: "čvor (kn)",
      bit: "bit (b)",
      byte: "bajt (B)",
      "kb-dec": "kilobajt — kB (1000 B)",
      "mb-dec": "megabajt — MB (1000 kB)",
      "gb-dec": "gigabajt — GB (1000 MB)",
      "tb-dec": "terabajt — TB (1000 GB)",
      kib: "kibibajt — KiB (1024 B)",
      mib: "mebibajt — MiB (1024 KiB)",
      gib: "gibibajt — GiB (1024 MiB)",
      tib: "tebibajt — TiB (1024 GiB)",
    } satisfies Record<string, string>,
    /** „Podaci" says the thing its two conventions exist for, once, above the fields. */
    dataNote:
      "kB i KiB nisu ista količina — kB je 1000 bajtova, KiB je 1024. Obe konvencije su na listi, pa izaberi onu koju tvoj izvor koristi.",
    percent: {
      ofTitle: "Koliko je P% od X",
      ofPercent: "P (%)",
      ofValue: "X",
      whatTitle: "X je koliko % od Y",
      whatPart: "X",
      whatWhole: "Y",
      applyTitle: "X uvećano ili umanjeno za P%",
      applyValue: "X",
      applyPercent: "P (%) — negativno za umanjenje",
      changeTitle: "Promena sa X na Y, u procentima",
      changeFrom: "X (staro)",
      changeTo: "Y (novo)",
    },
    pdv: {
      amountLabel: "Iznos",
      rateLabel: "Stopa",
      /** The two rates the law has — `PDV_RATES` in Serbian. */
      rateStandard: "Opšta (20%)",
      rateReduced: "Posebna (10%)",
      directionLabel: "Smer",
      /** „Dodaj" takes a net price up; „Izdvoji" takes the PDV out of a price that already includes it. */
      directionAdd: "Dodaj PDV na iznos bez PDV-a",
      directionExtract: "Izdvoji PDV iz iznosa sa PDV-om",
      netLabel: "Osnovica (bez PDV-a)",
      vatLabel: "PDV",
      grossLabel: "Ukupno (sa PDV-om)",
      /** Says why „izdvoji" is not „20% od ukupnog" — the everyday mistake this tool prevents. */
      note: "Izdvajanje nije 20% od ukupnog iznosa: PDV je obračunat na osnovicu, pa se ukupno deli sa 1,20 (odnosno 1,10).",
    },
    loan: {
      principalLabel: "Iznos kredita",
      rateLabel: "Nominalna kamatna stopa (% godišnje)",
      monthsLabel: "Broj rata (meseci)",
      paymentLabel: "Mesečna rata",
      totalPaidLabel: "Ukupno plaćeno",
      totalInterestLabel: "Ukupna kamata",
      /**
       * The caveat, on screen rather than only in a comment. Three facts in the
       * order they matter: which rate this is, what is not counted, and what
       * that means for the number a bank will quote.
       */
      caveat:
        "Računato po nominalnoj kamatnoj stopi (NKS), sa mesečnim pripisom i jednakim ratama koje dospevaju na kraju meseca. Naknade, osiguranje i drugi troškovi nisu uračunati — ovo zato nije efektivna kamatna stopa (EKS), pa će ponuda banke po pravilu biti viša.",
      invalid: "Upiši iznos veći od nule, stopu od nule naviše i ceo broj meseci.",
    },
    unitPrice: {
      packageLabel: "Pakovanje",
      priceLabel: "Cena",
      quantityLabel: "Količina",
      add: "Dodaj pakovanje",
      remove: "Ukloni",
      unitPriceLabel: "Cena po jedinici",
      cheapest: "Najjeftinije",
      /** How much dearer per unit than the cheapest row — never „ušteda", which would imply a purchase. */
      premium: "skuplje po jedinici",
      /** Says the one thing this tool does NOT do, so „500 g" and „1 kg" are not compared as 500 and 1. */
      note: "Uporedi pakovanja izražena u istoj jedinici. Ako su različite, prvo ih pretvori alatkama „Masa“ i „Zapremina“.",
      invalid: "Svako pakovanje treba cenu i količinu veće od nule.",
    },
  },

  /**
   * Ishrana (FIT slice b). Two rules run through every line below.
   *
   * **Nothing here advises.** There is no recommended intake, no „trebalo bi",
   * no verdict on a day. The goals are whatever the user set in „Podešavanja",
   * the totals are whatever was logged, and a day past a goal says „preko cilja"
   * — a fact about two numbers — and stops there.
   *
   * **Nothing here is a health claim.** `referenceOnly` is the one sentence the
   * page says about what these numbers are, said once and calmly, and it is the
   * honest one: a food diary is a record, not a nutritionist.
   */
  /**
   * „Programerske alatke" — the developer drawer's copy.
   *
   * Its own group rather than more keys under `tools`, because the two drawers
   * are two products that happen to share a host: „Alatke" says „Izaberi
   * alatku sa liste" to somebody converting a recipe, and this one is talking
   * to a person who came looking for a specific instrument and knows its name.
   * The CATEGORY labels are deliberately NOT duplicated here — they live in
   * `tools.category`, one map for both drawers, for the reason stated there.
   *
   * `name` and `blurb` are keyed by tool id and are what `ToolRegistration`'s
   * `titleKey` / `blurbKey` point at. Every id in `DEVTOOLS_TOOLS` has an entry
   * in both, and `modules.test.ts` fails if one is missing — a tool whose name
   * did not resolve would render its own id in the rail.
   */
  /* The `softver` pack's forty-eight tools — one file per category, see `strings/devtools.ts`. */
  devtools: devtoolsSr,
  /* „Stručne alatke" — the drawer that hosts every pack, see `strings/pro.ts`. */
  pro: proSr,
  /**
   * The tool finder — one search across every tool in BOTH drawers, drawn at the
   * head of „Alatke“ and „Stručne alatke“ alike.
   *
   * A group of its own rather than keys under `tools`, because it belongs to
   * neither drawer: the same component stands in both rooms and searches the
   * whole catalogue at once, so hanging its copy under one drawer's group would
   * have the other drawer's page reading it by name.
   *
   * `groups` is the eight `TOOL_TASK_GROUPS`, and one map serves both drawers on
   * `tools.category`'s exact reasoning — a second map is how a group ends up
   * labelled in one place and rendered as a raw id in the other.
   */
  toolFinder: {
    searchLabel: "Pretraži sve alatke",
    searchPlaceholder: "Nađi alatku po imenu, pojmu ili struci…",
    groupsLabel: "Grupe po potrebi",
    /** Section headings over an empty box. „Omiljene“ first is the whole point of starring. */
    favourites: "Omiljene",
    recent: "Nedavno",
    allTools: "Sve alatke",
    /** Nothing matched. Says what happened, and does not scold — `tools.noMatches`' tone. */
    noMatches: "Nijedna alatka ne odgovara.",
    clearSearch: "Poništi pretragu",
    /** The star's two states, as the accessible name of one button. */
    starAdd: "Dodaj u omiljene",
    starRemove: "Ukloni iz omiljenih",
    /** The keyboard line under the list, `search.hint`'s shape and the same keys. */
    hint: "↑↓ kretanje · Enter otvori · Esc poništi",
    groups: {
      money: "Novac i fakture",
      dates: "Datumi i rokovi",
      measure: "Mere i pretvaranje",
      text: "Tekst i dokumenti",
      design: "Dizajn i mediji",
      build: "Izgradnja i popravka",
      data: "Podaci i kod",
      study: "Učenje i nastava",
    } satisfies Record<ToolTaskGroup, string>,
  },
  /* „Elektronika" — the workbench, see `strings/electronics.ts`. */
  electronics: electronicsSr,
  fitness: {
    loadErrorTitle: "Ishrana nije učitana",
    loadError: "Učitavanje dnevnika ishrane nije uspelo. Zatvori i ponovo otvori stranicu.",
    actionError: "Radnja nije uspela. Pokušaj ponovo.",
    undo: "Opozovi",
    dismiss: "Zatvori",
    /**
     * PRD FIT: said ONCE, under the day's totals, where the numbers it is about
     * actually are. It states what the data is and what it is not, and asks for
     * nothing.
     */
    referenceOnly:
      "Vrednosti su informativne — preuzete iz javnih tabela sastava namirnica ili unete ručno. Nisu medicinski savet.",
    /** The day strip above everything: which day is open, and how to walk. */
    day: {
      previous: "Prethodni dan",
      next: "Sledeći dan",
      today: "Danas",
      /** Said in place of „Sledeći dan" at the end of the walk: there is no tomorrow to record. */
      noFuture: "Dnevnik se vodi unazad — sutrašnji obrok još nije obrok.",
    },
    /**
     * The five slots, in the order a day happens. „Užina" appears twice in life
     * and would appear twice on screen, so each says WHICH one it is — the
     * stored values are `uzina1`/`uzina2` and the labels have to carry the
     * difference the keys do.
     */
    slot: {
      dorucak: "Doručak",
      uzina1: "Prepodnevna užina",
      rucak: "Ručak",
      uzina2: "Popodnevna užina",
      vecera: "Večera",
    },
    /** The day's four figures, against whatever goals are set. */
    totals: {
      heading: "Ukupno za dan",
      /** The four macros the goals cover, named once and used everywhere. */
      macro: {
        kcal: "Kalorije",
        protein: "Proteini",
        carbs: "Ugljeni hidrati",
        fat: "Masti",
      },
      /** The three that ride every snapshot but have no goal — shown as plain figures where a food is inspected. */
      extra: {
        fiber: "Vlakna",
        sugar: "Šećeri",
        sodiumMg: "Natrijum",
      },
      unitKcal: "kcal",
      unitGram: "g",
      unitMilligram: "mg",
      /** A macro with no goal set. No number is invented for it — the figure stands alone. */
      noGoal: "bez cilja",
      /** A macro past a goal meant as a CEILING (kcal, UH, masti). A fact about two numbers, never a warning. */
      over: "preko cilja",
      /**
       * A macro past a goal meant as a FLOOR — protein, the one goal people set
       * in order to REACH it. Saying „preko cilja" there, in the same colour an
       * overspent envelope wears, would turn eating enough protein into a
       * warning; this is the same fact read the way the user meant the goal.
       */
      reached: "cilj ispunjen",
      /** Nothing has been logged for this day at all. */
      emptyDay: "Za ovaj dan još nema ničega.",
      /** Points at the one place goals are set, once, under the bars. */
      setGoals: "Dnevne ciljeve postavljaš u Podešavanjima, u kartici „Fitnes“.",
    },
    /** Adding something to a meal: the search, the amount, and what the food says about itself. */
    picker: {
      add: "Dodaj namirnicu",
      cancel: "Otkaži",
      searchLabel: "Pretraži namirnice",
      searchPlaceholder: "npr. jaje, hleb, jogurt…",
      /** Nothing matched. The next sentence is the way out, and it is a real one. */
      noResults: "Nema namirnice sa tim imenom.",
      noResultsHint: "Dodaj je u „Moje namirnice“ ispod — sa brojevima sa deklaracije.",
      /** Shown instead of `noResults` when the search itself rejected — an empty list must not be read as "nothing matched". */
      searchError: "Pretraga namirnica trenutno ne radi. Pokušaj ponovo.",
      /** Before anything is typed: the box has nothing to rank, and says so. */
      idle: "Upiši ime namirnice.",
      /** The chosen food's own line: the amount, and its household measures beside it. */
      amountLabel: "Količina (g)",
      amountPlaceholder: "100",
      /** The one-tap amounts a food carries. Absent for foods that are weighed — brašno has no „1 komad”. */
      servingsLabel: "Uobičajene mere",
      /** On a result row: takes you to the amount, and does not log anything yet. */
      choose: "Izaberi",
      /** Out of the chosen food, back to the list — a different act from closing the picker, so a different word. */
      back: "Nazad na listu",
      submit: "Upiši",
      /** Per-100 g preview above the amount field, so the number is seen before it is logged. */
      per100gLabel: "Na 100 g",
      /** What the chosen amount actually comes to — the same arithmetic the day total uses. */
      portionLabel: "Ova količina",
      /** The chip on a food the user added themselves. */
      mine: "Moja namirnica",
    },
    /**
     * Where a number came from. Every food can answer this, which is the reason
     * the catalogue was built the way it was — and one kind must answer it
     * louder than the rest.
     */
    source: {
      heading: "Odakle ovaj broj",
      usda: "USDA FoodData Central",
      official: "Zvanična tabela sastava",
      derived: "Izračunato iz recepta",
      /** A founder-decided figure where no public source pins one down. It never pretends to be measured. */
      stated: "Procena",
      /** The label in front of the citation's own reference. */
      refLabel: "Oznaka",
      /**
       * The citation address. Shown as TEXT rather than as a link: this app
       * opens no external links yet (see `setWindowOpenHandler`), and a link
       * that did nothing would be worse than an address that can be copied.
       */
      urlLabel: "Adresa",
      /** A derived food's working: what went in, and how much of it. */
      recipeLabel: "Recept",
      yieldLabel: "Daje",
      /**
       * A food the user added. It cites nothing, and the absence is the honest
       * one: the app asserts a catalogue number and must be able to prove it,
       * while this is somebody's claim about their own food.
       */
      userFood: "Tvoja namirnica — vrednosti su unete ručno.",
      /** A `stated` food's two mandatory fields — the uncertainty ships WITH the value. */
      basisLabel: "Osnov",
      rangeLabel: "Objavljeni raspon",
      /** Said beside a `stated` food wherever it is picked or reviewed, so a decided number never looks measured. */
      statedNote:
        "Za ovu namirnicu ne postoji javni izvor — broj je procena i stvarna vrednost varira. Ako je izmeriš, upiši je kao svoju namirnicu.",
      /** The food's own sentence about itself: what it covers, how it was prepared, why a drink is logged in grams. */
      notesLabel: "Napomena",
    },
    /** One logged row: what, how much, and what it came to. */
    item: {
      /**
       * Row actions, quiet until hover, exactly as every other list in this app.
       *
       * „Izmeni stavku" and no longer „Izmeni količinu": the same form now also
       * moves the row between meals, and a label naming one of the two fields
       * would send anyone looking for the other one to the delete button.
       */
      edit: "Izmeni stavku",
      /** The slot picker inside that form — the fix for „upisao sam ovo pod doručak, a bila je užina". */
      slotLabel: "Obrok",
      remove: "Ukloni",
      removedNotice: "Stavka je uklonjena.",
      save: "Sačuvaj",
      cancel: "Otkaži",
      /** A meal with nothing in it. Five sections are always drawn; four of them are usually this. */
      emptySlot: "Prazno",
      /** The per-meal figure beside a slot's heading. */
      slotTotal: "Ukupno",
    },
    /** „Moje namirnice": what the catalogue does not have, in the user's own words and numbers. */
    foods: {
      heading: "Moje namirnice",
      caption:
        "Ono čega nema u ugrađenoj listi — „mamin ajvar“, domaći brend, dodatak ishrani. Brojeve prepiši sa deklaracije, na 100 g.",
      newFood: "Nova namirnica",
      edit: "Izmeni",
      delete: "Obriši",
      deletedNotice: "Namirnica je obrisana.",
      /** Deleting a food says nothing about what was eaten — the log keeps its own numbers. */
      deleteNote: "Već upisani obroci ostaju netaknuti.",
      emptyTitle: "Još nema tvojih namirnica",
      emptyDescription:
        "Ugrađena lista pokriva veći deo svakodnevne ishrane. Ovde dodaješ ono čega u njoj nema.",
      expand: "Prikaži detalje",
      collapse: "Sakrij detalje",
    },
    /** The one form, serving both a new food and an edit — the FIN rail's shape. */
    form: {
      newTitle: "Nova namirnica",
      editTitle: "Izmena namirnice",
      nameLabel: "Naziv",
      namePlaceholder: "Mamin ajvar",
      categoryLabel: "Grupa",
      /** The header above the seven numbers. Per 100 g, because that is the basis every label already agrees on. */
      macrosLabel: "Na 100 g",
      /** Said under the seven fields: a packet in the hand beats any table. */
      macrosHint: "Prepiši sa deklaracije. Za pića se 100 ml upisuje kao 100 g.",
      notesLabel: "Napomena",
      notesPlaceholder: "Šta tačno je ovo, kako je pripremljeno…",
      /** The household measures the picker offers as one-tap amounts. */
      servingsLabel: "Uobičajene mere",
      servingsHint: "Nije obavezno. Brašno se meri, a ne broji.",
      /**
       * The two fields of one measure, drawn above their boxes. The
       * placeholders below them STAY: „1 kašika" and „15" are a worked example
       * of the pair — a quantity with its unit, and what it weighs — rather
       * than either field's name, which is the distinction DC-120 step 2 turns
       * on. Before these existed the example was the only name, so a filled row
       * read „kašika · 15 · ×".
       */
      servingNameLabel: "Mera",
      servingGramsLabel: "Masa (g)",
      servingLabelPlaceholder: "1 kašika",
      servingGramsPlaceholder: "15",
      addServing: "Dodaj meru",
      removeServing: "Ukloni meru",
      save: "Sačuvaj",
      cancel: "Otkaži",
      /** Refusals, in the vocabulary the store speaks. */
      invalidName: "Naziv je obavezan.",
      invalidCategory: "Izaberi grupu.",
      invalidNumber: "Upiši broj — najviše dve decimale, bez tačke za hiljade.",
      invalidServing: "Mera treba naziv i težinu u gramima.",
      notFound: "Ova namirnica više ne postoji.",
    },
    /** The seventeen shelves, as the catalogue's own Serbian keys name them. */
    category: {
      zitarice: "Žitarice",
      pekarsko: "Pekarski proizvodi",
      testenina: "Testenine",
      mahunarke: "Mahunarke",
      povrce: "Povrće",
      voce: "Voće",
      meso: "Meso",
      riba: "Riba i plodovi mora",
      jaja: "Jaja",
      mlecno: "Mlečni proizvodi",
      orasasti: "Orašasti plodovi i semenke",
      masti: "Masti i ulja",
      slatkisi: "Slatkiši",
      grickalice: "Grickalice",
      pica: "Pića",
      jela: "Gotova jela",
      zacini: "Začini",
    },
    /**
     * The page's two halves (ADR-081 §9). FIT is ONE hub — a person tracking
     * their body does not think of food and training as two applications — so
     * this is a section switch inside one page and not a second module.
     */
    sections: {
      label: "Odeljak",
      /** Keyed by `FitSection` so the switch reads `s[option]` and cannot fall through to a wrong label. */
      body: "Mapa tela",
      nutrition: "Ishrana",
      training: "Trening",
      measurements: "Merenja",
    },
    /**
     * „Merenja" (FIT slice d, ADR-081 §8 and §8a). The module's most dangerous
     * surface, because every number on it is one an app is tempted to invent —
     * and three rules keep it honest.
     *
     * **The scale is noisy and the page says so.** Body weight swings a kilo or
     * two a day on water and gut contents. The number and the line are both a
     * 7-day moving average; the raw readings are drawn behind it so nothing is
     * hidden; and a change is only called a change when the AVERAGES differ,
     * never yesterday against today.
     *
     * **Nexus computes no body-fat percentage.** The tape and skinfold formulas
     * carry ±4 percentage points, which is more than a year of real change. The
     * field takes what the user's own caliper or scale reported, and says so.
     *
     * **Every expenditure figure names the tier that produced it and what would
     * reach the tier above.** That sentence IS the feature: a number with
     * nothing beside it gets a digit of trust it never earned.
     */
    measure: {
      loadErrorTitle: "Merenja nisu učitana",
      loadError: "Učitavanje merenja nije uspelo. Zatvori i ponovo otvori stranicu.",
      actionError: "Radnja nije uspela. Pokušaj ponovo.",
      /** Facts about a person rather than observations — they change rarely and are entered once. */
      profile: {
        heading: "Podaci o telu",
        caption:
          "Pol, datum rođenja, visina i nivo aktivnosti. Koriste se samo za procenu potrošnje i menjaju se retko.",
        sexLabel: "Pol",
        /** „Nije uneto" is a real state, not a default — its absence is what closes the Mifflin–St Jeor tier, and the page says that where it matters. */
        sexNone: "Nije uneto",
        sexMale: "Muško",
        sexFemale: "Žensko",
        birthLabel: "Datum rođenja",
        /** Said where the field is: the age is derived, so it can never go stale. */
        birthHint: "Godine se računaju iz datuma, pa ne zastarevaju.",
        heightLabel: "Visina (cm)",
        activityLabel: "Nivo aktivnosti",
        activity: {
          sedentary: "Sedeći način života",
          light: "Lako aktivan",
          moderate: "Umereno aktivan",
          active: "Aktivan",
          "very-active": "Vrlo aktivan",
        },
        /** ADR-081 §8a says this out loud because a user who does not know it will trust the wrong digit. */
        activityHint:
          "Faktori aktivnosti su najgrublji deo celog računa — vrednosti iz literature se dosta razlikuju.",
        save: "Sačuvaj podatke",
        saved: "Podaci o telu su sačuvani.",
        invalidHeight: "Upiši visinu u centimetrima.",
        invalidBirth: "Upiši datum rođenja.",
      },
      /** One day's reading. Only the weight makes the row an observation. */
      entry: {
        heading: "Novo merenje",
        dayLabel: "Dan",
        weightLabel: "Težina (kg)",
        bodyFatLabel: "Procenat masti (%)",
        muscleLabel: "Mišići",
        muscleUnitLabel: "Jedinica",
        muscleUnitPercent: "%",
        muscleUnitKg: "kg",
        /** The unit travels with the number — converting at entry would store a figure the app computed while dressing it as one the scale measured. */
        muscleHint: "Upiši jedinicu koju je vaga pokazala — Nexus je ne pretvara u drugu.",
        waterLabel: "Voda (%)",
        circumferencesLabel: "Obimi (cm)",
        site: {
          neck: "Vrat",
          chest: "Grudi",
          upperArm: "Nadlaktica",
          waist: "Struk",
          hip: "Kukovi",
          thigh: "Butina",
        },
        save: "Sačuvaj merenje",
        remove: "Obriši merenje",
        /** Said once, where the fields are. */
        hint: "Obavezna je samo težina. Nexus ne računa procenat masti — upiši ono što ti je vaga ili kaliper pokazao.",
        invalidWeight: "Upiši težinu u kilogramima.",
        invalidNumber: "Upiši broj.",
        /** Editing a day that already has a reading overwrites it, which is what a correction is. */
        overwrites: "Za taj dan već postoji merenje — čuvanje ga menja.",
      },
      /** The trend, and the sentence that explains why it is a trend at all. */
      trend: {
        heading: "Težina",
        caption:
          "Linija je prosek od sedam dana, tačke su pojedinačna merenja. Težina varira kilogram-dva dnevno na vodi i hrani, pa se promena čita sa proseka — nikad juče prema danas.",
        currentLabel: "Trend sada",
        changeLabel: "Promena",
        unitKg: "kg",
        /** „−0,6 kg za 23 dana" — the actual span, never the one that was asked for. */
        overPrefix: "za",
        dayUnitOne: "dan",
        dayUnitFew: "dana",
        dayUnitMany: "dana",
        rangeLabel: "Period",
        range90: "90 dana",
        range365: "Godina",
        rangeAll: "Sve",
        noTrendTitle: "Trenda još nema",
        noTrend: "Trend se crta iz bar dva dana merenja.",
        emptyTitle: "Još nema merenja",
        emptyDescription: "Upiši prvo merenje i trend će se pojaviti ovde.",
        chartLabel: "Kretanje težine",
      },
      /** Shown ONLY while there is no body-fat reading, and labelled for what it is. */
      bmi: {
        label: "BMI",
        caveat:
          "Populaciona mera za probir — mišićavu osobu čita kao gojaznu. Prikazuje se samo dok nema izmerenog procenta masti.",
      },
      /** Three tiers, and the app always says which one produced the number. */
      energy: {
        heading: "Dnevna potrošnja",
        unit: "kcal",
        method: {
          measured: "Izračunato iz tvojih podataka",
          "katch-mcardle": "Katch–McArdle, po izmerenom procentu masti",
          "mifflin-st-jeor": "Mifflin–St Jeor, populaciona formula",
        },
        noneTitle: "Potrošnja se još ne može proceniti",
        noneDescription: "Unesi podatke o telu i bar jedno merenje.",
        /** The sentence ADR-081 §8a calls „the feature": what it would take to reach the tier above. */
        nextLabel: "Za precizniju procenu",
        missing: {
          profile: "unesi podatke o telu",
          sex: "unesi pol",
          measurement: "upiši bar jedno merenje",
          "body-fat": "izmeri procenat masti",
          history: "beleži obroke i težinu",
          "window-days": "beleži duže",
          "intake-coverage": "beleži obroke češće",
          "trend-readings": "meri se češće",
          "plausible-result": "podaci još ne daju smislen broj",
        },
        /** What an estimate RESTS ON, said beside it — the same posture a `stated` food's basis takes. */
        assumption: {
          "population-equation": "jednačina je izvedena iz drugih ljudi, ne iz tebe",
          "sex-term-proxies-composition": "član za pol stoji umesto sastava tela",
          "activity-multiplier": "pomnoženo faktorom aktivnosti",
          "energy-density": "korišćeno 7.700 kcal po kilogramu telesne mase",
          "unlogged-days-imputed": "za dane bez upisa uzet je prosek upisanih",
        },
        workingLabel: "Račun",
        workingIntake: "Prosečan unos",
        workingDelta: "Promena trend-težine",
        workingDays: "Razmak između trendova",
        workingCoverage: "Dana sa upisanim obrocima",
        windowNote: "Računa se iz poslednjih 14 dana.",
      },
      /** A suggestion, offered and never applied — the same rule FIN's exchange rate follows. */
      suggest: {
        heading: "Predlog dnevnog cilja",
        goalLabel: "Cilj",
        goal: { lose: "Smršati", maintain: "Održati", gain: "Dobiti" },
        rateLabel: "Nedeljno (kg)",
        /** No default rate anywhere: „pola kile nedeljno" is a recommendation, and this app makes none. */
        rateHint: "Nexus ne predlaže tempo — upiši koliko nedeljno želiš, pa ćemo izračunati unos.",
        resultLabel: "Predloženi unos",
        adopt: "Postavi kao cilj kalorija",
        adopted: "Cilj kalorija je postavljen.",
        note: "Predlog postaje cilj tek kad ga sam postaviš. Ostala tri cilja se ne diraju.",
        invalidRate: "Upiši koliko kilograma nedeljno.",
      },
    },
    /**
     * „Trening" (FIT slice c). Two rules run through every line, and they are the
     * same two „Ishrana" is written under, restated for a domain where the
     * temptation is stronger.
     *
     * **Nothing here coaches.** No suggested weight, no „trebalo bi da povećaš",
     * no verdict on a session. The app records what was lifted and says what the
     * numbers are; deciding what to do next is the lifter's, and an app that
     * decided it would have to be right about deloads, failed weeks and injuries
     * it knows nothing about.
     *
     * **Nothing here is invented.** There is no calorie burn, no estimated
     * one-rep max above ten reps and no tonnage for a metric that has none —
     * every one of those is a refusal with a reason (`training.ts`), and the copy
     * SAYS the refusal rather than leaving a suspicious blank.
     */
    training: {
      loadErrorTitle: "Trening nije učitan",
      loadError: "Učitavanje treninga nije uspelo. Zatvori i ponovo otvori stranicu.",
      /**
       * „Serija" counted, in all three Serbian forms — 1 serija, 2 serije, 5
       * serija. ONE set of forms for the whole section, because it is one noun:
       * the session summary, the tonnage coverage line, a routine's target and a
       * history row all count the same thing, and four copies of this would be
       * four chances to get the teens wrong.
       */
      setsUnit: { one: "serija", few: "serije", many: "serija" },
      /**
       * The band „Trening" opens with: what the last seven days actually held.
       *
       * Counted out of the sessions this section has ALREADY loaded — the window
       * is shorter than the shortest range the history list offers, so the band
       * never costs a read of its own and can never disagree with the list under
       * it. Only FINISHED sessions count, for `progressSets`' reason: a session
       * still open is one in the middle of happening.
       *
       * Tonnage carries the same coverage caveat here that it carries inside a
       * session. A week's total that silently dropped the planks and the pull-ups
       * is exactly the failure `setTonnage`'s refusal exists to prevent, and a
       * figure this large is the last place to start pretending otherwise.
       */
      summary: {
        setsLabel: "Tvrde serije",
        sessionsLabel: "Treninzi",
        /**
         * The eyebrow over the band, composed with the window constant itself
         * so it cannot outlive the window it names — „POSLEDNJIH 7 DANA".
         */
        windowLead: "Poslednjih",
        windowDayUnit: "dana",
        /** Under the band: what the three figures did and did not count. */
        note: "Broji se samo ono što je upisano i završeno; zagrevanje se nigde ne broji.",
      },
      /** The session in progress — there is at most one, which the schema itself guarantees. */
      session: {
        heading: "Trening u toku",
        /** A session started without a routine. Named, rather than left blank: a blank would read as a session missing its name. */
        adHoc: "Slobodan trening",
        elapsedLabel: "Traje",
        elapsedUnit: "min",
        finish: "Završi trening",
        finishError: "Trening nije mogao da se završi. Pokušaj ponovo.",
        /**
         * The way out of a session started by mistake. Without it the only exit
         * is „Završi" — which would leave an empty finished session in the
         * history to be deleted from there, and a log full of sessions nobody
         * did is a log nobody trusts. Undoable, like every other delete here.
         */
        discard: "Odbaci trening",
        addExercise: "Dodaj vežbu",
        notesLabel: "Beleška o treningu",
        notesPlaceholder: "Kako je išlo, kako se osećaš…",
        notesSave: "Sačuvaj belešku",
        empty: "Još nijedna serija nije upisana.",
        /** The session's own two figures. Never one figure called „obim" — see `tonnageCoverage`. */
        setsLabel: "Radne serije",
        tonnageLabel: "Tonaža",
        tonnageUnit: "kg",
        /**
         * Said whenever a session held sets the tonnage could not count — a
         * plank, a run, a pull-up. „Tonaža: 4.280 kg — računato na 14 od 18
         * serija." Without it the figure implies it covered everything, which is
         * exactly the failure `setTonnage`'s refusal exists to prevent.
         */
        tonnageCoverage: "računato na",
        tonnageCoverageOf: "od",
        /** Shown instead of a tonnage when NOTHING in the session had one. A zero would be a claim about the work. */
        tonnageNone: "Tonaža se za ove vežbe ne računa",
        warmupNote: "Zagrevanje se ne računa u obim.",
      },
      /** One logged set, and the form that writes the next one. */
      set: {
        log: "Upiši",
        edit: "Izmeni",
        save: "Sačuvaj",
        cancel: "Otkaži",
        remove: "Obriši seriju",
        /** A set is removed for good — it was a typo, not history. Said where removing is possible. */
        removeNote: "Obrisana serija se ne vraća.",
        kindLabel: "Vrsta serije",
        kind: {
          warmup: "Zagrevanje",
          working: "Radna",
          drop: "Drop",
          failure: "Do otkaza",
        },
        /**
         * RIR rather than RPE (ADR-081 §4): „koliko ti je još ostalo" is a
         * question a person can answer, and a field people answer wrongly is
         * worse than one they leave empty.
         */
        rirLabel: "RIR",
        rirHint: "Koliko ti je ponavljanja još ostalo. 0–5, prazno ako ne znaš.",
        /**
         * The five fields, named by what they MEAN. „Pomoć" and „Dodatna težina"
         * are two labels over one column, because assistance getting smaller is
         * the improvement while added weight getting bigger is — see `SET_FIELDS`.
         */
        field: {
          weight: "Težina (kg)",
          assist: "Pomoć (kg)",
          reps: "Ponavljanja",
          seconds: "Sekunde",
          distance: "Metri",
        },
        unitKg: "kg",
        /** Abbreviated on purpose: „10 ponavljanja" and „2 ponavljanja" decline, and a set list is not the place to fight Serbian numerals. */
        unitReps: "pon.",
        unitSeconds: "s",
        unitMeters: "m",
        /** Between the load and the count in a set's one-line reading: „60 kg × 10". */
        times: "×",
        /** In front of the load for `weighted_reps` and `assisted_reps` — added, and taken away. */
        addedPrefix: "+",
        assistPrefix: "−",
        /** A number the set does not record. Never a zero, which would be a claim. */
        missing: "—",
        invalidNumber: "Upiši broj.",
        invalidWhole: "Upiši ceo broj.",
        actionError: "Serija nije upisana. Pokušaj ponovo.",
      },
      /** ADR-081 §1.1: the single most used number in any training app. */
      lastTime: {
        label: "Prošli put",
        none: "Prvi put",
      },
      target: {
        label: "Cilj",
        /** „3 × 8–12" — sets, then the rep range. A missing half simply is not drawn. */
        repsRange: "–",
      },
      /**
       * What a routine ASKS FOR, met by the session that is running.
       *
       * Migration 061 gave a routine line four more things to prescribe — a
       * hold, a load, a distance and a rest — and „Rutine" learned to write all
       * of them. For a while the session did not read any of them back, which
       * made the prescription a note to self rather than a plan the app runs.
       * Everything under this key is that gap closed: the form starts from what
       * the routine asks, the countdown lasts as long as the line says, and
       * each exercise says how far through its sets it is.
       */
      prescription: {
        /** Working sets logged against the routine's own count — „2/3". Warm-ups are not part of a prescription of three. */
        setsLabel: "Serije po rutini",
        /** The rest THIS line asks for, as opposed to the bar's preset. */
        restLabel: "Odmor po rutini",
        /** A line that prescribes zero rest — a real instruction, and not the same as prescribing nothing. */
        restNone: "Bez odmora",
        /** Said once under the log form, because a prefilled field nobody explained is a number somebody may not notice is a suggestion. */
        prefillNote:
          "Polja kreću od poslednje upisane serije; kada nje nema, od onoga što rutina traži.",
        /** How much of the routine has been touched at all — lines with at least one working set, over lines in the routine. */
        sessionLabel: "Urađeno po rutini",
      },
      /**
       * The rest countdown (ADR-081 §7). The note is not decoration: the founder's
       * one-timer rule is about what the product RECORDS, and this records
       * nothing — so the surface says so where the timer is, rather than leaving
       * somebody to wonder why their „Fokus" statistics did not move.
       */
      rest: {
        heading: "Odmor",
        stop: "Prekini",
        done: "Odmor je gotov",
        lengthLabel: "Dužina odmora",
        note: "Odbrojavanje se nigde ne beleži i nije deo statistike u „Fokusu“.",
        error: "Odmor nije mogao da se pokrene.",
      },
      /** What the section shows when nothing is open. */
      start: {
        heading: "Novi trening",
        adHoc: "Slobodan trening",
        fromRoutine: "Počni",
        dayLabel: "Dan",
        caption: "Počni od rutine ili slobodno — vežbe možeš dodavati u toku treninga.",
        error: "Trening nije mogao da se započne. Pokušaj ponovo.",
        /** The schema allows exactly one open session, so this refusal is a real state rather than a race. */
        alreadyOpen: "Jedan trening je već u toku.",
      },
      /** Finished sessions, newest first. */
      history: {
        heading: "Poslednji treninzi",
        emptyTitle: "Još nema upisanih treninga",
        emptyDescription: "Kad završiš prvi trening, pojaviće se ovde.",
        /** Ranges the list can be read over. A day is a range of one, so these are the same read. */
        rangeLabel: "Period",
        range30: "30 dana",
        range90: "90 dana",
        range365: "Godina",
        open: "Otvori",
        close: "Zatvori",
        /** Reopening a finished session for a correction. Refused while another is open. */
        reopen: "Nastavi",
        reopenBlocked: "Ne može dok je drugi trening u toku.",
        /**
         * Correcting the DAY a finished session is filed under.
         *
         * „Nastavi" reopens the sets and leaves the date alone, so a session
         * logged on the wrong day used to be fixable only by deleting it and
         * repeating every set. The write always existed (`fitUpdateWorkout`
         * takes `day`); the control did not.
         */
        dayLabel: "Datum treninga",
        dayCorrect: "Premesti na ovaj datum",
        delete: "Obriši trening",
        deletedNotice: "Trening je obrisan.",
        adHoc: "Slobodan trening",
      },
      /**
       * Routines (ADR-081 §6). A routine is a SHAPE — the order of the exercises
       * and what each one is aiming at — and holds nothing about when. The
       * caption says that out loud, because every other fitness app calls the
       * same thing a „plan" and means a calendar.
       */
      routines: {
        heading: "Rutine",
        caption: "Rutina je oblik treninga: redosled vežbi i ciljevi, bez datuma.",
        newRoutine: "Nova rutina",
        newTitle: "Nova rutina",
        editTitle: "Izmena rutine",
        nameLabel: "Naziv",
        namePlaceholder: "npr. Gornji dan A",
        notesLabel: "Beleška",
        notesPlaceholder: "npr. zagrevanje 10 min pre prve vežbe",
        itemsLabel: "Vežbe",
        /** Names the two fields, because „nije uspelo" over a form of them names none. */
        invalidRange: "„Ponavljanja od“ ne može biti veće od „do“.",
        addItem: "Dodaj vežbu",
        removeItem: "Ukloni",
        moveUp: "Pomeri gore",
        moveDown: "Pomeri dole",
        targetSetsLabel: "Serije",
        repsMinLabel: "Ponavljanja od",
        repsMaxLabel: "Ponavljanja do",
        /**
         * Migration 061's four targets — drawn only for the fields the
         * line's metric actually names (`SET_FIELDS`), same as one set of it
         * would be logged. `targetWeightLabel` and `targetAssistLabel` are
         * two captions over the one stored column, for the same reason the
         * log form gives them two: added load and taken-away assistance are
         * opposite facts about the same lift.
         */
        targetWeightLabel: "Težina (kg)",
        targetAssistLabel: "Pomoć (kg)",
        targetSecondsLabel: "Trajanje (s)",
        targetDistanceLabel: "Razdaljina (m)",
        restSecondsLabel: "Odmor (s)",
        /** On the rest field itself — the one target where empty and zero mean two different things and both are real answers. */
        restSecondsHint: "0 znači bez odmora, pravo u sledeću seriju. Prazno znači podrazumevani odmor treninga.",
        targetHint: "Ciljevi nisu obavezni — prazno polje znači da cilja nema.",
        save: "Sačuvaj rutinu",
        cancel: "Otkaži",
        edit: "Izmeni",
        delete: "Obriši",
        deletedNotice: "Rutina je obrisana.",
        emptyTitle: "Još nema rutina",
        emptyDescription: "Sačuvaj oblik treninga koji ponavljaš i sledeći put kreni od njega.",
        invalidName: "Rutina treba naziv.",
        needsItems: "Rutina treba bar jednu vežbu.",
        /**
         * A line naming an exercise that no longer resolves — one of the
         * profile's own since deleted, or a catalogue entry a later build
         * dropped. The line keeps the name it was written with and cannot be
         * logged against; saying so beats an empty row nobody can explain.
         */
        missingExercise: "Ova vežba više ne postoji",
      },
      /**
       * „Moje vežbe" — the profile's own, and only those. The catalogue ships
       * with the app and is not a table, so there is nothing here that could edit
       * a catalogue entry: „Ishrana" says the same thing about foods, for the
       * same reason.
       */
      exercises: {
        heading: "Moje vežbe",
        caption: "Katalog aplikacije se ne menja — ovde su samo tvoje vežbe.",
        newExercise: "Nova vežba",
        newTitle: "Nova vežba",
        editTitle: "Izmena vežbe",
        nameLabel: "Naziv",
        namePlaceholder: "npr. Potisak sa klupe uskim hvatom",
        nameEnLabel: "Naziv na engleskom",
        nameEnPlaceholder: "npr. close-grip bench press",
        nameEnHint: "Nije obavezno. Pretraga ga koristi, prikaz ne — pola sveta traži „RDL“.",
        primaryLabel: "Glavni mišići",
        secondaryLabel: "Pomoćni mišići",
        equipmentLabel: "Sprava",
        patternLabel: "Obrazac pokreta",
        metricLabel: "Šta jedna serija beleži",
        /**
         * The one field of this form that decides how the exercise behaves
         * everywhere else, so it is the one with an explanation under it.
         */
        metricHint:
          "Bira koja polja se upisuju uz seriju i kako se računa obim. Plank nema tonažu, a pomoć na spravi se oduzima.",
        unilateralLabel: "Jednostrano (po strani)",
        unilateralHint: "Osam ponavljanja jednoručnog veslanja je osam PO STRANI.",
        notesLabel: "Beleška",
        notesPlaceholder: "npr. postavka klupe, hvat",
        save: "Sačuvaj",
        cancel: "Otkaži",
        edit: "Izmeni",
        delete: "Obriši",
        deletedNotice: "Vežba je obrisana.",
        /** Said where deleting is possible: what goes is the exercise, never what was lifted with it. */
        deleteNote: "Brisanje vežbe ne dira serije koje su već upisane.",
        emptyTitle: "Nema tvojih vežbi",
        emptyDescription:
          "Katalog pokriva najveći deo. Dodaj vežbu ako radiš nešto što u njemu ne postoji.",
        invalidName: "Vežba treba naziv.",
        needsPrimary: "Izaberi bar jedan glavni mišić.",
        actionError: "Radnja nije uspela. Pokušaj ponovo.",
      },
      /**
       * „Napredak" (FIT slice d, ADR-081 §5). Two figures that are never
       * conflated and a set of records that only exist where their question
       * does.
       *
       * **„Tvrde serije po mišiću" and „tonaža" are separate on purpose.** Hard
       * sets per muscle group is what current training science uses for
       * hypertrophy and what a person can act on; tonnage means something for
       * the strength lifts and nothing for a plank or a run. An app that shows
       * one number called „obim" is hiding which of the two it picked.
       */
      progress: {
        heading: "Napredak",
        caption:
          "Računa se iz upisanih serija — ništa se ne čuva posebno, pa se ne može razmimoići sa dnevnikom. Zagrevanje se nigde ne broji.",
        rangeLabel: "Period",
        range90: "90 dana",
        range365: "Godina",
        emptyTitle: "Još nema šta da se računa",
        emptyDescription: "Upiši prvi trening i napredak će se pojaviti ovde.",
        /** Weekly volume — the figure a week is actually balanced against. */
        volumeHeading: "Nedeljni obim",
        /**
         * The drawn weekly-volume chart. Its read-aloud sentence is composed
         * from these fragments and the figures themselves, so it can never
         * describe bars other than the ones on screen.
         */
        volumeChartCaption: "Jedan stubac je jedna nedelja. Zagrevanje se nigde ne broji.",
        volumeChartLead: "Tvrdih serija po nedelji",
        volumeChartAcross: "kroz",
        volumeChartPeak: "najviše u nedelji od",
        volumeWeekUnitOne: "nedelju",
        volumeWeekUnitFew: "nedelje",
        volumeWeekUnitMany: "nedelja",
        tonnageLabel: "Tonaža",
        daysLabel: "Dana",
        muscleHeading: "Tvrde serije po mišiću",
        /** Said where the per-muscle counts are: the snapshot carries primaries, and that is the right vocabulary rather than a limitation. */
        muscleNote:
          "Serija se broji glavnim mišićima vežbe. Pomoćni se ne broje — jedan potisak sa klupe bi inače bio i grudi i tricepsi i ramena.",
        /**
         * „Mapa tela" — FIT's signature graphic, and the one question a sorted
         * list of chips answers only in sequence: WHAT DID I NOT TRAIN. Twenty
         * chips read one by one; a silhouette with two pale shoulders reads at
         * once.
         *
         * The bands are a DRAWING decision and are stated as such in the
         * caption. Nothing here claims a muscle is „undertrained" — the app does
         * not know a person's programme, and inventing that verdict is exactly
         * the kind of figure this house refuses.
         */
        bodyMap: {
          heading: "Mapa tela",
          /**
           * Every NUMBER in this caption comes from the constant that actually
           * governs it (`WINDOW_DAYS`, the two band edges, `MUSCLE_GROUPS`),
           * exactly as the habit grid's heading does — so the sentence cannot
           * outlive the drawing it explains.
           */
          captionLead: "Zasićenost je broj tvrdih serija po mišiću u poslednjih",
          captionDayUnit: "dana",
          captionBands: "nijanse:",
          captionAndUp: "i više",
          captionTail:
            "Bledo znači nijedna serija, a ne da je mišić zapostavljen — to zavisi od plana koji Nexus ne zna.",
          front: "Napred",
          back: "Nazad",
          descriptionOf: "od",
          descriptionTrained: "mišićnih grupa je dobilo bar jednu tvrdu seriju",
          /** The truth behind the picture, as text and as chips — the map is only the shortcut. */
          untouchedHeading: "Bez ijedne serije u poslednjih",
          untouchedNone: "Svaka mišićna grupa je dobila bar jednu seriju u ovom periodu.",
          setsSuffix: "ser.",
          /** A muscle's own label, read on hover: „Grudi: 6 ser. · poslednji put 5. avg 2026.". */
          lastPrefix: "poslednji put",
          neverTrained: "bez serije u ovom periodu",
          /**
           * „Mapa tela" as its own section (founder, 2026-08-08). The map used
           * to answer one question — šta nisam trenirao — and now answers the
           * other direction too: koji mišić radi koja vežba, i šta ta vežba
           * pogađa. The copy below is that second direction.
           */
          sectionNote:
            "Klikni na mišićnu grupu — na telu ili u spisku ispod — pa na vežbu, da vidiš šta ta vežba pogađa.",
          pickerLabel: "Mišićne grupe",
          pickHint: "Izaberi mišićnu grupu da vidiš vežbe koje je treniraju.",
          weekHeading: "Poslednjih",
          clear: "Poništi izbor",
          backToWeek: "Nazad",
          drawnFront: "Nacrtan na prednjoj strani.",
          drawnBack: "Nacrtan na zadnjoj strani.",
          primaryHeading: "Vežbe kojima je ovo cilj",
          primaryNone: "Nijedna vežba u spisku nema ovu grupu kao primarnu.",
          secondaryHeading: "Vežbe koje ga još angažuju",
          secondaryNone: "Nijedna vežba u spisku ga ne angažuje sekundarno.",
          /** The one chip that tells the shipped catalogue and the profile's own rows apart. */
          mine: "Moja",
          factEquipment: "Sprava",
          factPattern: "Obrazac pokreta",
          factMetric: "Serija beleži",
          factSide: "Izvođenje",
          factUnilateral: "Jednostrano (po strani)",
          factBilateral: "Obostrano",
          hitsPrimary: "Primarno",
          hitsSecondary: "Sekundarno",
          /**
           * While an exercise is chosen the shading stops being a count and
           * becomes a claim about the movement. Saying so is not a nicety: a
           * shade that means two things without announcing which is the module
           * changing the rules under the reader.
           */
          exerciseCaption: "Zasićenost sada prikazuje šta pogađa vežba",
          rolePrimary: "primarno",
          roleSecondary: "sekundarno",
          roleNone: "ne angažuje se",
          /** The catalogue carries no instructions, on purpose — see `ExerciseEntry`. */
          noHowTo:
            "Nexus ne opisuje izvođenje vežbe: to je tekst koji se prepisuje iz tuđih proizvoda, a poluopisan bi bio gori od nikakvog.",
        },
        /** Personal records, derived on read. A stored PR row and a set table can disagree, and only one of them is the truth. */
        recordsHeading: "Lični rekordi",
        record: {
          heaviest: "Najteža serija",
          bestOneRm: "Procenjeni 1RM",
          mostReps: "Najviše ponavljanja",
          longestHold: "Najduže držanje",
          leastAssistance: "Najmanja pomoć",
        },
        /** The estimate is published WITH its formula named and refused above ten reps — see `estimateOneRepMax`. */
        oneRmNote:
          "Procena 1RM se računa po Epli formuli i samo iz serija do deset ponavljanja — iznad toga objavljene formule prestaju da opisuju isti pokret.",
        /** No calorie burn anywhere, said out loud rather than left as a suspicious gap. */
        noBurnNote:
          "Nexus ne prikazuje potrošene kalorije na treningu: bez pulsa i merenja to bi bio broj sa greškom većom od obroka koji bi trebalo da pokrije.",
      },
      /** One ranked list over the catalogue and the profile's own — one channel, one definition of „best match". */
      picker: {
        searchLabel: "Pretraga vežbi",
        searchPlaceholder: "npr. potisak, RDL, zgib…",
        idle: "Počni da kucaš da bi našao vežbu.",
        noResults: "Nijedna vežba ne odgovara pretrazi.",
        noResultsHint: "Proveri naziv ili dodaj svoju vežbu u „Moje vežbe“.",
        searchError: "Pretraga nije uspela. Pokušaj ponovo.",
        choose: "Izaberi",
        cancel: "Otkaži",
        /** The one chip that tells the two sources apart. */
        mine: "Moja",
      },
      /** The twenty muscle groups, as the closed vocabulary names them. */
      muscle: {
        grudi: "Grudi",
        latovi: "Latovi",
        romboidi: "Romboidi",
        trapez: "Trapez",
        "donja-ledja": "Donja leđa",
        "prednja-ramena": "Prednja ramena",
        "bocna-ramena": "Bočna ramena",
        "zadnja-ramena": "Zadnja ramena",
        biceps: "Biceps",
        triceps: "Triceps",
        podlaktica: "Podlaktica",
        kvadriceps: "Kvadriceps",
        "zadnja-loza": "Zadnja loža",
        gluteusi: "Gluteusi",
        adduktori: "Adduktori",
        abduktori: "Abduktori",
        listovi: "Listovi",
        trbusnjaci: "Trbušnjaci",
        "kosi-trbusni": "Kosi trbušni",
        "fleksori-kuka": "Fleksori kuka",
      },
      /** What provides the resistance — never „what is in the room". */
      equipment: {
        sipka: "Šipka",
        "ez-sipka": "EZ šipka",
        "t-sipka": "T-šipka",
        bucice: "Bučice",
        girja: "Girja",
        sprava: "Sprava",
        smit: "Smit mašina",
        kabl: "Kabl",
        "sopstvena-tezina": "Sopstvena težina",
        guma: "Guma",
        karike: "Karike",
        trx: "TRX",
        medicinka: "Medicinka",
        tocak: "Točak za trbušnjake",
        vijaca: "Vijača",
        "traka-za-trcanje": "Traka za trčanje",
        bicikl: "Bicikl",
        veslac: "Veslač",
        elipticna: "Eliptična",
        stepper: "Stepper",
      },
      /** The shape of the movement — the vocabulary a week is actually balanced against. */
      pattern: {
        "horizontalni-potisak": "Horizontalni potisak",
        "vertikalni-potisak": "Vertikalni potisak",
        "horizontalno-privlacenje": "Horizontalno privlačenje",
        "vertikalno-privlacenje": "Vertikalno privlačenje",
        cucanj: "Čučanj",
        "pregib-kuka": "Pregib u kuku",
        iskorak: "Iskorak",
        nosenje: "Nošenje",
        olimpijski: "Olimpijski",
        trup: "Trup",
        izolacija: "Izolacija",
        kardio: "Kardio",
      },
      /** What one set records (ADR-081 §3) — the field that makes the schema honest. */
      metric: {
        weight_reps: "Težina × ponavljanja",
        reps: "Ponavljanja",
        weighted_reps: "Dodatna težina × ponavljanja",
        assisted_reps: "Pomoć × ponavljanja",
        time: "Vreme",
        weight_time: "Težina × vreme",
        distance_time: "Rastojanje × vreme",
      },
    },
  },

  /**
   * Tabla (CANV slice a) — the infinite canvas.
   *
   * **„Mermaid dijagram“ is the module's one piece of copy that explains rather
   * than labels, and it has to.** Excalidraw converts a mermaid definition into
   * EDITABLE shapes, which is exactly the „nacrtaj mi bazu pa je doteraj rukom“
   * case this feature exists for — but the conversion used to happen SILENTLY on
   * paste, for any text starting with „graph“, „gantt“, „pie“ and a dozen other
   * ordinary words. So the trigger is now this button and only this button, and
   * the copy says what will happen before it happens.
   *
   * The drawing surface itself carries no Serbian copy at all in this slice, and
   * that is a fact worth stating rather than a gap: the editor's own toolbar is
   * temporary (see `CanvasPage.tsx`), and translating a UI that is about to be
   * replaced would mean writing the same words twice.
   */
  canvas: {
    /** Above the board strip. Reuses nothing from `strings.modules` — this line names the SECTION, not the sidebar entry. */
    boardsLabel: "Table",
    /**
     * The second line of a row in the board list, before the instant itself:
     * „izmenjeno 14:32", „izmenjeno 5. avg, 09:10".
     *
     * A prefix and a formatted time rather than one sentence, exactly as
     * `app.saveSavedPrefix` is — the formatter decides how much of a date the
     * instant needs, and a full sentence here would have to guess.
     */
    boardUpdatedPrefix: "izmenjeno",
    /** The board a profile gets the first time it opens the page. */
    firstBoardName: "Tabla",
    newBoard: "Nova tabla",
    /** The name field of the create/rename form — one field, one label, used by both. */
    nameLabel: "Naziv table",
    namePlaceholder: "Šema baze",
    save: "Sačuvaj",
    cancel: "Otkaži",
    rename: "Preimenuj",
    delete: "Obriši",
    /** One pending undo at a time, exactly as everywhere else. */
    undo: "Opozovi",
    deletedNotice: "Tabla je obrisana.",
    dismiss: "Zatvori",
    /** The mermaid action — see this section's own header for why it is a button. */
    mermaid: "Mermaid dijagram",
    mermaidTitle: "Napiši mermaid definiciju i pretvori je u oblike koje možeš dalje uređivati.",
    loadErrorTitle: "Tabla nije učitana",
    loadError: "Učitavanje tabli nije uspelo. Zatvori i ponovo otvori stranicu.",
    actionError: "Radnja nije uspela. Pokušaj ponovo.",
    /**
     * The autosave failed. It says what is true — the drawing is on screen and
     * NOT on disk — because „sačuvano“ that silently was not is the one thing a
     * canvas must never imply.
     */
    saveError: "Crtež nije sačuvan. Poslednje izmene su samo na ekranu.",
    /**
     * The one refusal a user can actually cause: a scene past
     * `MAX_CANVAS_SCENE_LENGTH`, which in practice means pasted images. It names
     * the cause rather than the number, because the number is not something
     * anybody can act on.
     */
    tooLarge: "Tabla je prevelika da bi se sačuvala — ubačene slike zauzimaju previše prostora.",
    /**
     * The same two failures, for a board that was LEFT before its last write
     * landed — a switch within the autosave delay. That board's save line is
     * gone and so is its drawing, so these go in the page notice instead, and
     * say which board they mean without claiming the one now open failed.
     */
    leftSaveError: "Poslednje izmene na prethodnoj tabli nisu sačuvane. Otvori je i proveri crtež.",
    leftTooLarge:
      "Poslednje izmene na prethodnoj tabli nisu sačuvane — ubačene slike zauzimaju previše prostora.",
    /** Nothing drawn yet, and no board either. */
    emptyTitle: "Još nema nijedne table",
    emptyDescription: "Napravi tablu i crtaj — dijagrami, skice, mape ideja.",
    /**
     * Our own toolbar (CANV slice b1) — the whole reason Excalidraw's chrome is
     * hidden. Its own UI ships 54 locales, none of them Serbian and none
     * addable, so every word a person drawing reads is written here instead.
     *
     * The eight colour names are NOT repeated here: they are
     * `settings.appearance.accentNames`, the same eight the „Izgled" picker
     * shows, so a colour is called one thing in this product.
     */
    toolbar: {
      /** Names the whole bar for a screen reader; each group below names itself too. */
      label: "Alatke table",
      toolLabel: "Alatka",
      tool: {
        selection: "Izbor",
        hand: "Pomeranje",
        rectangle: "Pravougaonik",
        diamond: "Romb",
        ellipse: "Elipsa",
        arrow: "Strelica",
        line: "Linija",
        freedraw: "Olovka",
        text: "Tekst",
        image: "Slika",
        eraser: "Gumica",
      } satisfies Record<CanvasToolId, string>,
      /**
       * Every tool's `title` names the editor's own key: „Pravougaonik ·
       * prečica R". The keys work with or without this bar, so hiding them
       * would be teaching the slower route.
       */
      shortcut: "prečica",
      strokeLabel: "Boja poteza",
      /** The ink swatch — `--nx-text`, the colour a new board already draws in. */
      inkName: "Mastilo",
      fillLabel: "Ispuna",
      /** The default, and the first swatch in the fill row: a shape with no fill at all. */
      fillNone: "Bez ispune",
      widthLabel: "Debljina",
      width: {
        tanko: "Tanko",
        srednje: "Srednje",
        debelo: "Debelo",
      } satisfies Record<CanvasStrokeWidthId, string>,
      zoomLabel: "Uvećanje",
      /** „Uvećaj" and „Umanji" are the buttons' accessible names; what they show is − and +. */
      zoomIn: "Uvećaj",
      zoomOut: "Umanji",
      /** The readout is the button: clicking the percentage puts it back to 100%. */
      zoomReset: "Vrati uvećanje na 100%",
      zoomFit: "Uklopi",
      zoomFitTitle: "Uklopi ceo crtež u prozor",
      /** „Dodaj karticu" (CANV slice c) — a drawing action, so it sits with them. */
      addCard: "Dodaj karticu",
      addCardTitle: "Stavi belešku, zadatak ili događaj na tablu kao karticu.",
    },
    /**
     * Kartice (CANV slice c) — a Nexus object pinned to a board.
     *
     * The KIND of a card („Beleška", „Zadatak", „Događaj") is not written here:
     * it is `strings.search.kindSingular`, the same three words the search row
     * beside it uses, so an object is called one thing in this product.
     */
    card: {
      /** A note that was never named. The store hands back the empty title the row really has; the fallback is the surface's job. */
      untitled: "Bez naslova",
      /** The action every resolved card carries — it opens the object on its own module's page. */
      open: "Otvori",
      /**
       * Replaces Excalidraw's own English „Click to interact" hint, which
       * `app.css` hides.
       *
       * It says the FIRST of the two clicks, because that is the one nobody
       * expects: the editor keeps a card's DOM inert until a click in its
       * middle arms it, so a person who clicks „Otvori" straight away gets
       * nothing and has no way to know why.
       */
      hint: "Klikni na karticu da je aktiviraš",
      /**
       * The object is gone — deleted, or another profile's. Said plainly, and
       * with the removal offered rather than performed: a note being deleted is
       * not a reason for Nexus to quietly take something off somebody's board.
       */
      missingTitle: "Objekta više nema",
      missingBody: "Kartica ostaje na tabli dok je ne ukloniš.",
      remove: "Ukloni karticu",
      /**
       * The card points at something that is not a Nexus object at all — a
       * hand-edited scene file, or an element pasted in from elsewhere. Nexus
       * draws this instead of loading it, and says so rather than showing an
       * empty frame.
       */
      foreignTitle: "Nepoznata kartica",
      foreignBody: "Ova kartica ne pokazuje ni na šta u Nexusu, pa se ne otvara.",
    },
    /** The resolve failed, so the cards on screen have no titles to show. Named separately from `saveError`: nothing is at risk here, only unreadable. */
    cardsError: "Kartice nisu učitane, pa im se ne vide naslovi.",
    /**
     * „Dodaj karticu"'s picker (CANV slice c) — the profile's beleške, zadaci
     * and događaji, over the search channels the palette already uses.
     *
     * It reuses `strings.search.recentGroup`, `strings.search.emptyResults` and
     * `strings.search.kindSingular` outright: this is the same list of objects
     * the palette shows, narrowed to the three kinds a card can point at, and
     * a second set of words for it would be a second surface pretending to be
     * a different one.
     */
    picker: {
      title: "Dodaj karticu",
      description: "Izaberi belešku, zadatak ili događaj — kartica ide na sredinu table.",
      searchLabel: "Pretraga objekata",
      placeholder: "Pretraži beleške, zadatke i događaje…",
      /** The search itself failed. The picker stays open with an empty list rather than closing under the user. */
      error: "Pretraga nije uspela. Pokušaj ponovo.",
    },
  },

  settings: {
    // The page title reuses `strings.modules.settings` — no duplicate copy.
    /**
     * SET-014: the filter above the section cards. The "nothing matched" line
     * is deliberately NOT repeated here — it reuses the search palette's own
     * `strings.search.emptyResults`, which says exactly this and nothing else.
     */
    searchPlaceholder: "Pretraži podešavanja…",
    /**
     * The second line of the „nema rezultata“ empty state. The title itself is
     * the search palette's own `strings.search.emptyResults`, reused — this
     * says the one thing that is specific to a FILTER rather than to a search:
     * nothing is lost, the cards come back the moment the box is cleared.
     */
    searchEmptyDescription: "Obriši pretragu da bi se vratili svi odeljci.",
    /**
     * SET-015: the eight categories the rail lists, and the one line each of
     * them says about itself. `categoryTitle` is the rail row and the pane
     * heading; `categorySummary` is the subtitle under the heading (and the
     * second line of a row on the narrow root).
     */
    categoryTitle: {
      profile: "Profil i sigurnost",
      appearance: "Izgled",
      keyboard: "Tastatura",
      modules: "Prikaz",
      notifications: "Obaveštenja",
      data: "Podaci",
      privacy: "Privatnost",
      about: "O aplikaciji",
    },
    categorySummary: {
      profile: "Ime i slika, profili, pristupni kod i automatsko zaključavanje",
      appearance: "Jezik, tema, boja naglaska, nedelja i sat",
      keyboard: "Prečice na tastaturi",
      modules: "Koji delovi Nexusa su uključeni i podešavanja svakog modula",
      notifications: "Šta te obaveštava i kada",
      data: "Rezervna kopija, vraćanje, uvoz i izvoz",
      privacy: "Mreža i ažuriranja, šta se čuva i gde, istorija pretrage",
      about: "Verzija, lokacija podataka i licence",
    },
    /** The rail's own landmark name — a name, never drawn. */
    categoriesLabel: "Kategorije podešavanja",
    /** The back button's accessible name; the visible text is the chevron plus `{name}`. */
    backTo: "Nazad: {name}",
    /** The two sub-page lists (SET-015). */
    moduleSettingsList: "Podešavanja modula",
    importExportList: "Uvoz i izvoz",
    /**
     * The rail badge's accessible text — its visible content is the bare
     * count. The numeral agrees with the count, so the form is picked with
     * `dayUnit` at the call site and `{n}` is filled in with the number.
     */
    searchResultCountOne: "{n} rezultat",
    searchResultCountMany: "{n} rezultata",
    /**
     * The gear a module page wears beside its title (`moduleSettingsGear.tsx`):
     * the accessible name of the button that opens Podešavanja directly at that
     * module's card. One entry per module that publishes a card, spelled for
     * the PHRASE rather than glued together from `sectionTitle` — Serbian puts
     * the module in the accusative, so „za Zadatke“ and „za Kontrolnu tablu“
     * are not forms any template can build from the nominative names the rest
     * of the app holds. The module's own name is kept verbatim, as `moduleName`
     * and every other sentence that names one does.
     */
    moduleSettingsButton: {
      dashboard: "Podešavanja za Kontrolnu tablu",
      tasks: "Podešavanja za Zadatke",
      calendar: "Podešavanja za Kalendar",
      notes: "Podešavanja za Beleške",
      priv: "Podešavanja za Privatne beleške",
      files: "Podešavanja za Datoteke",
      study: "Podešavanja za Učenje",
      finance: "Podešavanja za Finansije",
      habits: "Podešavanja za Navike",
      fitness: "Podešavanja za Fitnes",
      focus: "Podešavanja za Fokus",
      tools: "Podešavanja za Alatke",
    },
    /**
     * The same name for a module this table has no phrase for — one added to
     * the registry before its copy is written. It names the module in the
     * nominative, which is what `moduleName` holds, so the phrasing is one that
     * needs no case a template could not form.
     */
    moduleSettingsButtonFallback: "Podešavanja: {name}",
    /** Section-card titles, in the order they appear on the page. */
    sectionTitle: {
      profile: "Profil",
      profiles: "Profili",
      security: "Sigurnost",
      appearance: "Izgled",
      tasks: "Zadaci",
      notes: "Beleške",
      priv: "Privatne beleške",
      files: "Datoteke",
      shortcuts: "Prečice",
      dashboard: "Kontrolna tabla",
      study: "Učenje",
      calendar: "Kalendar",
      finance: "Finansije",
      habits: "Navike",
      focus: "Fokus",
      fitness: "Fitnes",
      tools: "Alatke",
      setup: "Kako je Nexus podešen za tebe",
      modules: "Moduli",
      packs: "Paketi alatki",
      risk: "Napomene uz stručne alatke",
      notifications: "Obaveštenja",
      backup: "Rezervna kopija i vraćanje",
      /**
       * The eight sub-pages of „Uvoz i izvoz" (SET-015). The text is the one
       * the block inside each already draws, so a list row and its card name
       * the same thing rather than two spellings of it.
       */
      "import-archive": "Uvoz iz arhive",
      "import-ics": "Uvoz kalendara (.ics)",
      "export-ics": "Izvoz kalendara",
      "import-apkg": "Uvoz iz Anki (.apkg)",
      "import-csv": "Uvoz zadataka (.csv)",
      "import-fin-csv": "Uvoz izvoda (.csv)",
      "import-llm": "Uvoz preko AI asistenta",
      "import-markdown": "Uvoz belešaka (.md)",
      sync: "Sinhronizacija",
      network: "Mreža i ažuriranja",
      privacy: "Podaci i privatnost",
      about: "O aplikaciji",
      licences: "Licence",
      "content-packs": "Paketi sadržaja",
    },
    /**
     * SET §5: the per-card „Vrati na podrazumevano“. One block of copy for
     * every card that has the link, because the act is the same act each time
     * — only the card's own name changes, and the dialog shows that rather
     * than repeating it in a sentence per section.
     *
     * The question states the two bounds the reset actually respects, since
     * both are things the user would otherwise have to trust: it reaches only
     * this card, and only this device.
     */
    reset: {
      /** The quiet link at the foot of a card. */
      action: "Vrati na podrazumevano",
      title: "Vrati na podrazumevano",
      question:
        "Podešavanja ovog odeljka vraćaju se na podrazumevana. Menja se samo ovaj uređaj — ništa u tvojim podacima se ne dira.",
      confirm: "Vrati podrazumevano",
      cancel: "Otkaži",
    },
    profile: {
      nameLabel: "Ime",
      save: "Sačuvaj",
      saveError: "Čuvanje nije uspelo — ime mora imati 1–80 karaktera.",
      /**
       * SET-001: the profile picture. „Slika profila“ names the block; the
       * caption states the automatic crop out loud rather than letting the user
       * discover it — an interactive crop is deliberately not built (the
       * renderer would have to handle the image bytes, which it never does),
       * and a promise the app cannot keep is worse than a plain sentence.
       */
      pictureLabel: "Slika profila",
      pictureCaption: "Slika se automatski opseca na kvadrat.",
      pickPicture: "Izaberi sliku",
      /** Also the picture's own alt text: it is decoration, so it says what it is rather than describing it. */
      pictureAlt: "Slika profila",
      removePicture: "Ukloni sliku",
      /** One sentence per `ProfilePicturePickErrorCode`: the file was refused, and why. */
      pictureRejected: {
        "too-large": "Slika je prevelika — najviše 10 MB.",
        "unsupported-format": "Ovaj format nije podržan. Koristi PNG, JPEG, GIF ili WebP.",
        unreadable: "Fajl nije moguće pročitati.",
        /** The format IS allowed but the decoder could not open it — a different sentence, because the user's next step is different. */
        undecodable: "Ovu sliku nije moguće obraditi. Pokušaj sa PNG ili JPEG fajlom.",
      } satisfies Record<ProfilePicturePickErrorCode, string>,
      /** A rejected IPC call (not one of the named reasons above). */
      pictureError: "Promena slike nije uspela. Pokušaj ponovo.",
    },
    /**
     * „Profili“ card (SET-003 / ADR-058): the account's profiles, the ONE
     * business profile v1 allows, and a delete that never touches the personal
     * anchor. The kind marker, the empty-name fallback and the switch-gate copy
     * live in the top-level `profiles` block — the sidebar switcher reads the
     * same words, and two spellings of „Posao“ would eventually disagree.
     */
    profiles: {
      caption:
        "Poslovni profil drži posao odvojeno od privatnog — svoje zadatke, beleške i podešavanja, pod istim nalogom i istim pristupnim kodom.",
      /** The active row's second line; the name itself carries the gold active state. */
      activeMarker: "Trenutno aktivan",
      /** Shown once a business profile is created here: what happened, and that naming comes at first entry (the ONB-lite sentinel, said out loud). */
      createdNotice: "Poslovni profil je napravljen. Ime mu daješ pri prvom ulasku.",
      /** The offer beside the notice — the same passcode gate every switch passes. */
      switchToNew: "Pređi na novi profil",
      delete: "Obriši",
      /**
       * Deleting a business profile (ADR-058, the ADR-048 typed-name idiom).
       * Immediate and irreversible, so the warning is read BEFORE the field:
       * what goes, and that it cannot be taken back. Confirmed by typing the
       * profile's display name — for an unnamed business profile that is
       * „Posao“, its fallback label everywhere else too.
       */
      deleteTitle: "Brisanje profila",
      deleteWarning: "Svi podaci profila biće trajno obrisani. Ovo se ne može opozvati.",
      deleteConfirmLabel: "Ime profila za potvrdu",
      deleteConfirmPlaceholder: "Upiši tačno ime profila",
      deleteSubmit: "Obriši profil",
      deleteCancel: "Otkaži",
      deleteError: "Brisanje nije uspelo. Pokušaj ponovo.",
    },
    /** Sigurnost section (ADR-018 / AUTH): change passcode, regenerate the Recovery Kit, idle auto-lock. */
    security: {
      changeTitle: "Promeni pristupni kod",
      currentLabel: "Trenutni kod",
      newLabel: "Novi kod",
      confirmLabel: "Potvrdi novi kod",
      save: "Sačuvaj",
      changeSuccess: "Pristupni kod je promenjen.",
      recoveryTitle: "Novi kod za oporavak",
      recoveryWarning:
        "Pravljenje novog koda odmah poništava stari — ako je stari negde zapisan, prepiši preko njega novi.",
      regenerate: "Napravi novi kod za oporavak",
      autoLockTitle: "Automatsko zaključavanje",
      autoLockHint: "Nexus se sam zaključava posle ovoliko neaktivnosti.",
      /** AUTO_LOCK_MINUTES values as select option labels, keyed by the numeric value as a string. */
      autoLockOptions: {
        "5": "Posle 5 minuta",
        "15": "Posle 15 minuta",
        "30": "Posle 30 minuta",
        "60": "Posle 1 sata",
        "0": "Nikad",
      } satisfies Record<string, string>,
      askPasscodeTitle: "Traži pristupni kod",
      askPasscodeHint:
        "Nexus traži pristupni kod kada se pokrene, osim ako je od poslednjeg otključavanja prošlo manje od izabranog vremena. Zaključavanje aplikacije briše zapamćeni ključ, pa sledeće pokretanje ponovo traži kod.",
      /** UNLOCK_SETTINGS members as option labels, keyed by the member itself. */
      askPasscodeOptions: {
        "every-time": "Svaki put kad se Nexus pokrene",
        "1h": "Posle 1 sata",
        "8h": "Posle 8 sati",
        "1d": "Posle 1 dana",
        "7d": "Posle 7 dana",
        never: "Nikad",
      } satisfies Record<string, string>,
      askPasscodeWarning:
        "Svako ko može da koristi ovaj Windows nalog može da otvori Nexus bez pristupnog koda u tom periodu.",
      askPasscodePasscodeLabel: "Pristupni kod",
      askPasscodeSaved: "Podešavanje je sačuvano.",
      /** Keyed by UnlockSettingUnavailableReason, read through `lookup` so the table keeps literal keys. */
      askPasscodeUnavailable: {
        keystore:
          "Ovaj računar trenutno ne može bezbedno da čuva ključ, pa Nexus uvek traži pristupni kod.",
        "plaintext-backend":
          "Na ovom sistemu ključ bi se čuvao kao običan tekst, pa Nexus uvek traži pristupni kod.",
      } satisfies Record<string, string>,
    },
    /** Theme-preference option labels; Dan/Noć reuse `strings.app.themeDan/themeNoc`. */
    appearance: {
      system: "Sistemski",
      /**
       * The language of the whole interface.
       *
       * Offers exactly what `LOCALES` holds, and today that is one entry. It is
       * shown all the same rather than hidden until a second language exists,
       * because the control IS the answer to „gde se menja jezik" and a
       * settings row reading „Jezik: Srpski" is an ordinary, honest thing for a
       * one-language product to say. Hiding it would leave the machinery
       * invisible and the question unanswered.
       *
       * A translation, when it is written, is one file and one line in
       * `LOCALES` — and it appears here without anybody editing this row.
       */
      languageLabel: "Jezik",
      /** Keyed by locale code; read through `lookup` so the table keeps literal keys. */
      languageNames: {
        sr: "Srpski",
        en: "English",
      } satisfies Record<string, string>,
      languageHint:
        "Menja se odmah, bez ponovnog pokretanja. Spisak nudi jezike koji su prevedeni — obaveštenja koja šalje sistem prate isti izbor.",
      /** Names the theme segmented row now that a second one (the week start) stands beside it. */
      themeLabel: "Tema",
      /** What „Sistemski“ actually follows — the one thing about this row that is not visible from the three option names. */
      themeHint: "„Sistemski“ prati podešavanje svetle ili tamne teme na ovom računaru.",
      accentLabel: "Boja akcenta",
      /** Accent swatch names, keyed by AccentId (SET's 8-accent palette). */
      accentNames: {
        zlato: "Zlato",
        bronza: "Bronza",
        maslina: "Maslina",
        suma: "Šuma",
        zad: "Žad",
        ruza: "Ruža",
        bordo: "Bordo",
        grafit: "Grafit",
      } satisfies Record<string, string>,
      /** PRD 04 §5: the weekday the calendar's month grid and week view open on. */
      weekStartLabel: "Prvi dan nedelje",
      weekStartOptions: {
        monday: "Ponedeljak",
        sunday: "Nedelja",
      } satisfies Record<WeekStartPreference, string>,
      /**
       * CAL §5, beside the week start and for the same reason: both describe
       * how this machine reads a calendar. The duration is what the create
       * form seeds an end time with; the clock is how every calendar time is
       * DRAWN — the time fields themselves stay whatever form the system draws
       * them in, which the caption says out loud rather than leaving to be
       * discovered.
       */
      eventDurationLabel: "Podrazumevano trajanje događaja",
      eventDurationOptions: {
        "30": "30 minuta",
        "60": "1 sat",
        "90": "1 sat i 30 minuta",
        "120": "2 sata",
      } satisfies Record<string, string>,
      clockLabel: "Prikaz vremena",
      clockOptions: {
        "24h": "24-časovni (14:00)",
        "12h": "12-časovni (2:00 PM)",
      } satisfies Record<ClockPreference, string>,
      clockHint: "Polja za unos vremena zadržavaju oblik koji crta sistem.",
    },
    /**
     * Zadaci section (ADR-049): a device preference over the „Danas“ and
     * „Sledećih 7 dana“ views, beside the Beleške card below and for the same
     * reason — it describes how this machine reads one module, not what the
     * profile holds, so it belongs to that module rather than to „Izgled“.
     */
    tasks: {
      blockedInTodayLabel: "Blokirani zadaci u pregledu Danas",
      blockedInTodayCaption:
        "Zadatak koji čeka na drugi zadatak. Važi i za pregled „Sledećih 7 dana“.",
      blockedInTodayOptions: {
        sakrij: "Sakrij",
        prikazi: "Prikaži",
      } satisfies Record<BlockedInToday, string>,
    },
    /** Beleške section (ADR-036): the note editor's reading measure and its markdown shortcuts. */
    notes: {
      widthLabel: "Širina editora",
      widthNames: {
        uska: "Uska",
        normalna: "Normalna",
        siroka: "Široka",
      } satisfies Record<string, string>,
      markdownLabel: "Markdown prečice",
      markdownCaption:
        "Kucanje „# “, „- “ ili „> “ odmah pretvara blok. „/“ meni radi i kada je isključeno.",
    },
    /**
     * Privatne beleške card (PRIV v1 / ADR-057) — shown only while the
     * „Privatno" module is enabled. The kit status line states a fact the
     * user chose at setup, in the honest register the whole section keeps.
     */
    priv: {
      caption:
        "Privatne beleške su šifrovana sekcija koja se otključava odvojeno od ostatka aplikacije.",
      notSetUp: "Sekcija se podešava pri prvom otvaranju modula Privatno.",
      autoLockLabel: "Automatsko zaključavanje sekcije",
      autoLockHint: "Sekcija se sama zaključava posle ovoliko minuta bez rada u njoj.",
      /** „Posle N minuta“ — after „posle" the genitive holds for every count, so one form serves all sixty options. */
      autoLockOptionPrefix: "Posle",
      minuteUnit: "minuta",
      lockOnMinimizeLabel: "Zaključaj pri minimizovanju prozora",
      kitStatusSet: "Kod za oporavak je podešen — isti kod otvara i nalog i privatne beleške.",
      kitStatusMissing:
        "Bez koda za oporavak — ako zaboraviš lozinku, privatne beleške su nepovratno izgubljene.",
      saveError: "Čuvanje nije uspelo. Pokušaj ponovo.",
      loadError: "Podešavanja privatnih beležaka se trenutno ne mogu učitati.",
    },
    /**
     * Datoteke card (DOC): the shape „Datoteke" opens in. The caption says the
     * one thing this card could otherwise be feared to do — nothing here
     * touches a file, and the page it configures cannot delete one either.
     */
    files: {
      caption: "Odnosi se samo na ovaj uređaj — datoteke se ovde ne menjaju.",
      viewLabel: "Podrazumevani prikaz",
      viewNames: {
        lista: "Lista",
        mreza: "Mreža",
      } satisfies Record<string, string>,
      viewHint: "Prikaz se može promeniti i na samoj stranici, za tekuće gledanje.",
    },
    /**
     * Kontrolna tabla section (SET-006 / ADR-041): the dashboard's own
     * background image and how far it is dimmed behind the widgets.
     */
    dashboard: {
      caption: "Slika stoji iza kartica na kontrolnoj tabli.",
      /** Alt text for the current-background thumbnail — the image is decoration, so it says what it is rather than describing it. */
      thumbnailAlt: "Trenutna pozadina kontrolne table",
      pick: "Izaberi sliku…",
      clear: "Ukloni",
      dimLabel: "Zatamnjenje",
      /** Hidden while no background is set — a slider with nothing to dim is a control with no effect. */
      dimHint: "Veće zatamnjenje znači mirniju pozadinu i čitljiviji tekst.",
      /** One sentence per `DashboardPickErrorCode`: the file was refused, and why. Never a re-encode. */
      rejected: {
        "too-large": "Slika je prevelika — najviše 20 MB.",
        "unsupported-format": "Ovaj format nije podržan. Koristi PNG, JPEG, GIF ili WebP.",
        unreadable: "Fajl nije moguće pročitati.",
      } satisfies Record<DashboardPickErrorCode, string>,
      /** A rejected IPC call (not one of the named reasons above). */
      error: "Promena pozadine nije uspela. Pokušaj ponovo.",
    },
    /**
     * Učenje section (STUDY-007): how hard the scheduler aims, and how much of
     * it lands on one day. Three settings, one card — they are read together on
     * every session, and a user deciding "less per day" usually means all of it.
     */
    study: {
      caption: "Podešava kako se ponavljanja raspoređuju i koliko ih dnevno stiže.",
      retentionLabel: "Ciljana zapamćenost",
      /** Suffix on the preset the scheduler uses when nothing was ever chosen. */
      retentionDefault: "podrazumevano",
      retentionHint:
        "Veća vrednost znači kraće razmake i manje zaboravljanja, ali i više ponavljanja svakog dana.",
      newPerDayLabel: "Novih kartica dnevno",
      newPerDayHint: "Koliko novih kartica jedna sesija najviše nudi. Nula znači samo obnavljanje.",
      reviewCapLabel: "Dnevni limit ponavljanja",
      reviewCapHint: "Prazno polje znači bez limita. Nove kartice se ne računaju u ovaj limit.",
      /** Placeholder in the empty cap field — the field's own empty state, said out loud. */
      reviewCapPlaceholder: "bez limita",
      /** The one thing about this card a user could otherwise get wrong: nothing already scheduled moves. */
      retroNotice: "Promena važi od sledećeg ponavljanja — već zakazane kartice ostaju kako jesu.",
      error: "Čuvanje podešavanja učenja nije uspelo. Pokušaj ponovo.",
    },
    /**
     * Kalendar section (CAL-010 / ADR-054): the semester's fixed dates the
     * Semestar view anchors to. A PROFILE fact, unlike the week start and the
     * clock, which are device preferences and stay in „Izgled" — which is why
     * this is its own card rather than two more rows there.
     */
    calendar: {
      caption:
        "Datumi semestra drže pregled „Semestar“ na istim mesecima. Bez njih pregled klizi od tekućeg meseca.",
      /** Heading over the two date fields — also the SET-014 hit label. */
      datesLabel: "Datumi semestra",
      startLabel: "Početak semestra",
      endLabel: "Kraj semestra",
      save: "Sačuvaj",
      clear: "Ukloni datume",
      /** The pair rule, said before main and the store refuse it: both dates, in order. */
      invalidPair: "Unesi oba datuma — semestar ima i početak i kraj.",
      invalidOrder: "Kraj semestra ne može biti pre početka.",
      saved: "Datumi semestra su sačuvani.",
      cleared: "Datumi semestra su uklonjeni.",
      error: "Čuvanje datuma semestra nije uspelo. Pokušaj ponovo.",
    },
    /**
     * Finansije (FIN slice b). ONE control, and the card says exactly what it
     * does and does not reach: the currency of your money lives on each
     * account, and this only decides which code „Novi račun" opens on — which
     * is also why it is a DEVICE preference and why the card offers a reset.
     */
    finance: {
      caption:
        "Valuta se bira po računu. Ovo je samo kod na koji se otvara obrazac za novi račun — postojeći računi se ne diraju.",
      primaryCurrencyLabel: "Podrazumevana valuta",
      primaryCurrencyHint: "Troslovna oznaka po ISO 4217, na primer RSD ili EUR.",
      invalidCurrency: "Upiši troslovnu oznaku valute, na primer RSD.",
      saved: "Podrazumevana valuta je sačuvana.",
    },
    /**
     * HABIT slice c's card. The caption says what the control does NOT do first,
     * because „podrazumevani podsetnik" reads like a switch that turns reminders
     * on for everything, and it is the opposite: nothing reminds until a habit is
     * given a time of its own.
     */
    habits: {
      caption:
        "Podsetnik se postavlja po navici. Ovo je samo vreme koje se upiše kada uključiš podsetnik na nekoj navici — postojeće navike se ne diraju.",
      defaultReminderLabel: "Podrazumevano vreme podsetnika",
      defaultReminderHint: "Važi samo na ovom uređaju.",
      saved: "Podrazumevano vreme je sačuvano.",
    },
    /**
     * UTIL slice b's card — the Pomodoro shape, and nothing else. The caption
     * says what the four numbers do NOT do first, because „podešavanja fokusa"
     * reads like something that could rewrite what already happened, and it is
     * the opposite: a finished phase carries the length it actually ran for.
     *
     * Each field names its own bound, since the form refuses out of range and a
     * refusal the user could have avoided is a refusal that should have been a
     * hint.
     */
    focus: {
      caption:
        "Dužine faza i koliko radnih faza ide pre duge pauze. Važi za faze koje tek pokreneš — završene faze zadržavaju vreme koje su stvarno trajale.",
      workLabel: "Rad (minuta)",
      shortBreakLabel: "Pauza (minuta)",
      longBreakLabel: "Duga pauza (minuta)",
      cyclesLabel: "Radnih faza pre duge pauze",
      hint: "Važi samo na ovom uređaju.",
      saved: "Podešavanja fokusa su sačuvana.",
      /** The one refusal, pointed at the field the engine named — never a generic „nešto nije u redu". */
      invalid: "Vrednost je van dozvoljenog opsega.",
    },
    /**
     * FIT slice b's card — the four daily goals, and NOTHING that reads like
     * advice. The caption says three things in order, each of which a user would
     * otherwise have to guess: the goals are theirs, an empty field means there
     * is no goal (which is different from a goal of zero), and nothing on any
     * screen turns a goal into a verdict.
     *
     * This is the one module card with a PROFILE storage and therefore no „Vrati
     * na podrazumevano": there is no default to go back to — absent is what the
     * app ships with, and emptying the fields is already how you get there.
     */
    fitness: {
      caption:
        "Dnevni ciljevi za „Ishranu“. Svaki je zaseban i nijedan nije obavezan — prazno polje znači da cilja nema. Nexus ne predlaže vrednosti i ne ocenjuje dan.",
      kcalLabel: "Kalorije (kcal)",
      proteinLabel: "Proteini (g)",
      carbsLabel: "Ugljeni hidrati (g)",
      fatLabel: "Masti (g)",
      /** Says what „prazno" means, once, where the fields are — because 0 and absent are different claims. */
      hint: "Ostavi prazno za „bez cilja“. Nula je cilj, prazno polje nije.",
      saved: "Ciljevi su sačuvani.",
      invalid: "Upiši broj — najviše dve decimale, bez tačke za hiljade.",
      loadError: "Ciljevi se ne mogu učitati.",
      saveError: "Čuvanje ciljeva nije uspelo. Pokušaj ponovo.",
    },
    /**
     * UTIL slice c's card — ONE control, and the restraint is FIN's and DOC's
     * exactly: the drawer has no preferences to speak of, only the rate its PDV
     * tool opens on. A shopkeeper works at one rate nearly always, and opening
     * on theirs saves a click every single time.
     *
     * `choice` rather than `value` here, unlike FIN's currency field, because
     * the domain really is closed: the law has two rates, so enumerating them
     * decides nothing on the user's behalf.
     */
    tools: {
      caption:
        "Stopa na koju se „PDV“ otvara. Menja samo početnu vrednost polja — svaki račun možeš prebaciti na drugu stopu.",
      defaultVatLabel: "Podrazumevana stopa PDV-a",
      hint: "Važi samo na ovom uređaju.",
      saved: "Podrazumevana stopa je sačuvana.",
    },
    /** One-line module descriptions for the gallery, keyed by module id. */
    moduleDescriptions: {
      dashboard: "Pregled dana na jednom mestu — obaveze, zadaci i dokumenta koja ističu.",
      tasks: "Zadaci sa listom i tablom, prioritetima i rokovima.",
      calendar: "Događaji, agenda i praćenje isteka dokumenata.",
      settings: "Profil, izgled, moduli i obaveštenja.",
      notes: "Beleške sa blok-editorom — markdown prečice i „/“ meni za formatiranje.",
      study: "Predmeti, ispiti, kartice za učenje i planovi pripreme za ispite.",
      priv: "Šifrovane privatne beleške — otključavaju se posebno i ne pojavljuju se u pretrazi.",
      files: "Sve datoteke priložene uz beleške, zadatke i predmete, na jednom mestu.",
      finance: "Računi, transakcije i prenosi — stanje se računa iz onoga što upišeš.",
      habits: "Dnevne i nedeljne navike — niz, istorija i ono što se danas očekuje.",
      focus: "Pomodoro tajmer i istorija fokusa — isti tajmer koji „Učenje“ koristi.",
      fitness:
        "Ishrana i trening — obroci i dnevni ciljevi, dnevnik treninga sa rutinama i katalogom vežbi.",
      tools: "Pretvarači jedinica i svakodnevni računi — procenat, PDV, kredit i cena po jedinici.",
      canvas: "Beskonačna tabla za crtanje, dijagrame i skice — sa karticama koje vode na druge module.",
      electronics:
        "Radna površina za Arduino i Raspberry — postavi ploče i senzore iz kataloga i poveži ih žicama.",
      pro:
        "Alatke po strukama — uključuješ pakete koji ti trebaju, a fioka pokazuje samo njih.",
    } satisfies Record<string, string>,
    /**
     * The gallery's group headings are the navigation groups' own names
     * (`strings.app.navGroups`), not a second set: the gallery, the onboarding
     * chooser and the rail list the same modules under the same words, and
     * ADR-093 collapsed the two tables into one so a group cannot be called two
     * things. The older, longer headings („Sadržaj i znanje") are gone with
     * them.
     */
    modulesAlwaysOn: "Uvek uključeno",
    modulesToggleError: "Promena nije uspela. Pokušaj ponovo.",
    /**
     * ADR-101: the „Prikaz" card — what this DEVICE shows, and in what order.
     * One setting for the whole app rather than one per profile, so the words
     * here say „this Nexus" rather than „this profile".
     */
    visibility: {
      hint: "Isključeni moduli nestaju sa strane, iz pokretača, sa kontrolne table, iz pretrage i iz obaveštenja. Podaci ostaju — kad modul ponovo uključiš, sve je tu.",
      orderHint: "Grupe i module raspoređuješ prevlačenjem ili dugmićima za pomeranje.",
      moveUp: "Pomeri {name} gore",
      moveDown: "Pomeri {name} dole",
      moveGroupUp: "Pomeri grupu {name} gore",
      moveGroupDown: "Pomeri grupu {name} dole",
      reset: "Vrati podrazumevani raspored",
    },
    /**
     * ADR-065 §5, moved by ADR-086 — the one row that reopens the
     * questionnaire.
     *
     * It used to sit at the foot of „Moduli", on the argument that the
     * questionnaire's third screen WAS that gallery. It is not any more: the
     * flow asks four questions about the person and decides the board, the
     * sidebar, the accent and the calendar as well as the modules, so the row
     * belongs on the card that explains all of that. The gallery survives
     * inside the flow as „Podesi ručno", which is an override rather than a
     * step.
     *
     * The caption states the two things a rerun could otherwise be feared to
     * do, since it starts from what the profile has and writes only what
     * changes.
     */
    onboardingRerunTitle: "Tvoji odgovori",
    onboardingRerunAction: "Ponovo pokreni upitnik",
    onboardingRerunCaption:
      "Ista pitanja kao pri prvom pokretanju — kreće od onoga što sada imaš i menja samo ono što promeniš.",
    /**
     * ADR-086 §5 — „Kako je Nexus podešen za tebe".
     *
     * The card exists because an app that reshapes itself and never says so is
     * an app that feels broken rather than personal. It rebuilds the plan from
     * the stored ANSWERS, so what it says is what the current build would do
     * with what the person actually said — never a sentence written beside a
     * decision and free to drift from it.
     */
    setup: {
      description:
        "Nexus se složio prema tvojim odgovorima pri prvom pokretanju. Evo šta je od toga izašlo.",
      /** No stored answers: not an apology, and not a nag — the standard app is a legitimate answer. */
      none: "Pitanja nisu popunjena, pa Nexus stoji standardno. Sve možeš da podesiš i odavde, ručno.",
      /**
       * Forgetting is separated from changing, and it says exactly what it
       * does: the answers go, the app stays as it is. A person who wants the
       * standard app back gets it by turning things off, not by deleting a
       * record — otherwise „zaboravi" would be an undo nobody asked for.
       */
      forget: "Zaboravi odgovore",
      forgetHint:
        "Briše sačuvane odgovore sa ovog uređaja. Ništa se ne vraća unazad — aplikacija ostaje kako jeste.",
    },
    /** NTF-008 appetite presets — shortcuts over the per-source toggles below. */
    notificationPresets: {
      /** The row's own name, so the three buttons stop being an unlabelled bar at the top of the card. */
      label: "Koliko obaveštenja",
      minimal: "Minimalno",
      normal: "Normalno",
      all: "Sve",
      caption: "Prečice za izvore ispod.",
    },
    /**
     * Rezervna kopija (IMEX slice a1, extended to NOTE and then to archive
     * encryption by ADR-022) — the full-export button plus its confirmation
     * and error lines. `encryptedNotice` and `plaintextNotice` are
     * ALTERNATIVES, one per branch of the encrypt checkbox: never both at
     * once, and the plaintext one is only ever reached through its own
     * separate confirmation.
     */
    backup: {
      description:
        "Izvezi sve svoje podatke u jednu arhivu — otvoreni formati (JSON i CSV), beleške kao Markdown fajlovi i prilozi u originalnom obliku, sve čitljivo i upotrebljivo bez Nexusa.",
      /**
       * IMEX-003 — the module picker, closed by default because the default IS
       * everything and the description above already says so. The module names
       * themselves are read off `settings.restore.modules`, the one archive-module
       * vocabulary this screen has.
       */
      modulesToggle: "Šta se izvozi",
      /** The disclosure's own summary when nothing is unticked; a subset shows „4/6“ instead, which needs no words at all. */
      modulesAll: "sve",
      /** Shown under the picker when every box is unticked — the state the export button is disabled in. */
      modulesEmpty: "Izaberi bar jedan modul.",
      encryptLabel: "Zaštiti arhivu lozinkom",
      encryptedNotice:
        "Arhiva se šifruje tvojom lozinkom — Argon2id i AES-256-GCM. Lozinku ne čuvamo nigde.",
      passphraseLabel: "Lozinka",
      passphraseConfirmLabel: "Potvrdi lozinku",
      passphraseHint:
        "Najmanje 12 karaktera. Ako je izgubiš, arhiva se više ne može otvoriti — ni mi je ne možemo otvoriti umesto tebe.",
      passphraseTooShort: "Lozinka mora imati najmanje 12 karaktera.",
      passphraseTooLong: "Lozinka može imati najviše 256 karaktera.",
      passphraseMismatch: "Lozinke se ne poklapaju.",
      plaintextNotice:
        "Baza podataka je šifrovana tvojim pristupnim kodom, ali ova arhiva nije — čuvaj je na sigurnom mestu.",
      plaintextConfirmLabel:
        "Razumem da arhiva neće biti šifrovana i da je može otvoriti svako ko dođe do fajla.",
      exportButton: "Izvezi sve podatke…",
      savedPrefix: "Sačuvano:",
      savedEncryptedSuffix: "šifrovano",
      /** "N zapis"/"N zapisa" — Serbian numeral agreement via `dayUnit`. */
      recordsUnitOne: "zapis",
      recordsUnitMany: "zapisa",
      /**
       * Shown only when `missingAttachments > 0` (ADR-022): "Nedostaje N
       * prilog(a) — arhiva je ipak sačuvana." Numeral agreement via `dayUnit`,
       * mirroring `recordsUnitOne`/`recordsUnitMany`. The closing clause
       * deliberately carries no pronoun: "bez njih" would be wrong at a count
       * of one, and this line has to read correctly at every count.
       */
      missingAttachmentsPrefix: "Nedostaje",
      missingAttachmentsUnitOne: "prilog",
      missingAttachmentsUnitMany: "priloga",
      missingAttachmentsSuffix: "— arhiva je ipak sačuvana.",
      /**
       * Privatne beleške u izvozu (ADR-057 §6). The included line renders as
       * „… (N).“ with the count in parentheses — deliberately, so one form
       * reads correctly at every count (a declined „beleške/beležaka“ would
       * need three). Shown whenever `privateNotes > 0`: the user must never
       * learn from a zip listing that their most guarded notes left the app.
       * The two skip sentences map the result's `privateNotesSkipped` codes —
       * exactly one is ever shown, and only when there was something to skip.
       */
      privateNotesIncludedPrefix: "U arhivu su uključene i privatne beleške",
      privateNotesSkippedLocked: "Privatne beleške nisu izvezene — sekcija je zaključana.",
      privateNotesSkippedPlaintext: "Privatne beleške nisu izvezene jer se izvozi bez lozinke.",
      error: "Izvoz nije uspeo. Pokušaj ponovo.",
    },
    /**
     * Automatska rezervna kopija (SET-011 / ADR-056) — the scheduled half of
     * the same "Rezervna kopija" card. There is deliberately NO plaintext
     * wording anywhere in this block: a scheduled archive is always encrypted,
     * and the copy never has to explain a choice that does not exist. The
     * passphrase hint is borrowed from `backup.passphraseHint` in the JSX —
     * same rule, same sentence, spelled once.
     *
     * `runErrors` mirrors the wire's `BackupRunErrorCode`; `unknown` catches a
     * code a newer build recorded that this one cannot name.
     */
    autoBackup: {
      title: "Automatska rezervna kopija",
      description:
        "Nexus sam pravi šifrovanu arhivu celog profila u izabranoj fascikli — dnevno ili nedeljno, dok je aplikacija otključana. Propušten termin se nadoknađuje pri prvom sledećem otključavanju.",
      enableLabel: "Uključi automatsku rezervnu kopiju",
      /** Shown while the toggle is disabled — names the two prerequisites instead of leaving a dead checkbox unexplained. */
      enableHint: "Pre uključivanja izaberi fasciklu i postavi lozinku.",
      cadenceLabel: "Učestalost",
      cadenceOptions: {
        daily: "Dnevno",
        weekly: "Nedeljno",
      },
      folderLabel: "Fascikla",
      folderPick: "Izaberi fasciklu…",
      folderNone: "Fascikla nije izabrana.",
      keepLastLabel: "Koliko kopija se čuva",
      keepLastHint: "Posle svake uspešne kopije, starije od ovog broja se brišu.",
      /** Labels for `BACKUP_KEEP_LAST_CHOICES`, keyed by the numeric value as a string — Serbian numeral agreement spelled per choice. */
      keepLastOptions: {
        "2": "2 kopije",
        "3": "3 kopije",
        "5": "5 kopija",
        "10": "10 kopija",
        "20": "20 kopija",
        "50": "50 kopija",
      } satisfies Record<string, string>,
      passphraseTitle: "Lozinka arhive",
      /** One label, two moments: the button SETS a first passphrase and CHANGES an existing one — `passphraseStatusSet` says which state the card is in. */
      passphraseSave: "Postavi lozinku",
      passphraseChange: "Promeni lozinku",
      passphraseStatusSet: "Lozinka je postavljena.",
      /** The one fact a change must say out loud: it reaches only future runs. */
      passphraseFutureNote:
        "Nova lozinka važi za buduće kopije — ranije napravljeni fajlovi ostaju pod starom.",
      runNow: "Napravi odmah",
      lastRunPrefix: "Poslednja:",
      lastRunOk: "uspešna",
      lastRunFailed: "nije uspela",
      lastRunNever: "Još nije napravljena nijedna kopija.",
      /** One clause per `BackupRunErrorCode`, composed into „nije uspela — <razlog>, <vreme>". */
      runErrors: {
        "folder-unreachable": "fascikla nije dostupna",
        "passphrase-unreadable": "sačuvanu lozinku nije moguće pročitati",
        "write-failed": "pisanje arhive nije uspelo",
        unknown: "nepoznata greška",
      } satisfies Record<string, string>,
      error: "Radnja nije uspela. Pokušaj ponovo.",
    },
    /**
     * Izvoz kalendara (CAL-008) — the small `.ics` action beside the full
     * export in the same "Rezervna kopija" card. Its own block rather than more
     * keys on `backup`, because it is a different file in a different format
     * with its own result line; it borrows `backup.savedPrefix` for the path,
     * which is the same sentence saying the same thing.
     *
     * `description` names the one thing the user has to know before clicking:
     * this file is not protected, because no other calendar could open it if it
     * were.
     */
    calendarExport: {
      title: "Izvoz kalendara",
      description:
        "Izvezi samo kalendar kao .ics — standardni format koji Google kalendar, Apple kalendar i Outlook otvaraju. Fajl nije zaštićen lozinkom, jer ga tako nijedan drugi kalendar ne bi mogao otvoriti.",
      button: "Izvezi kalendar (.ics)",
      /** "N događaj"/"N događaja" — Serbian numeral agreement via `dayUnit`. */
      eventsUnitOne: "događaj",
      eventsUnitMany: "događaja",
      /**
       * Shown only when `skipped > 0`: "N događaj(a) nije izvezeno — datum
       * početka nije ispravan." Numeral agreement via `dayUnit`, and the reason
       * sits outside the counted phrase so it reads correctly at every count.
       */
      skippedPrefix: "Nije izvezeno:",
      skippedSuffix: "— datum početka nije ispravan.",
      error: "Izvoz kalendara nije uspeo. Pokušaj ponovo.",
    },
    /**
     * Vraćanje iz arhive (IMEX slice 3d, ADR-023) — the restore flow that sits
     * below the export in the same "Rezervna kopija" card, plus the post-reload
     * undo banner the app shell renders (`App.tsx`).
     *
     * `description` says the two things the user must know before picking a
     * file, in plain words: a restore REPLACES this profile's contents, and the
     * one-step undo lasts only until the app is locked or closed.
     *
     * `unreadable` and `problems` are typed against the wire's own closed code
     * domains, so a code added in `shared/ipc.ts` is a compile error here rather
     * than a silently missing sentence at the moment a user needs it.
     */
    restore: {
      title: "Vraćanje iz arhive",
      description:
        "Vrati podatke iz arhive napravljene izvozom iznad. Sve što je sada u ovom profilu biće obrisano i zamenjeno sadržajem arhive — vraćanje možeš opozvati jednim klikom, ali samo dok ne zaključaš ili ne zatvoriš aplikaciju.",
      pickButton: "Izaberi arhivu…",
      pickedPrefix: "Izabrano:",
      passphraseLabel: "Lozinka arhive",
      previewButton: "Prikaži pregled",
      previewRunning: "Čitanje arhive…",
      /** Preview header: the archive's own manifest facts, beside its file name. */
      createdLabel: "Napravljena",
      versionLabel: "Verzija",
      sourceLabel: "Profil u arhivi",
      /**
       * The replace warning, composed around the target profile's name in JSX
       * (the `savedPrefix` idiom) rather than through a placeholder — there is
       * no interpolation layer here, and inventing one for a single sentence
       * would outlive its usefulness.
       */
      replaceWarningPrefix: "Sve što je sada u profilu",
      replaceWarningSuffix: "biće obrisano i zamenjeno sadržajem arhive.",
      /**
       * Row labels of the current-vs-incoming table, keyed by
       * `RestoreModuleCounts`'s own five keys — deliberately NOT
       * `strings.modules`, whose key set is the module registry's, not this one.
       *
       * Also what the export's „Šta se izvozi“ picker labels its checkboxes with
       * (IMEX-003): the same eight archive modules, named once.
       *
       * „Finansije“ appeared here from FIN slice a onward — before the module
       * had a page — and „Navike“ arrives on exactly those terms from HABIT
       * slice a: the archive vocabulary is the interchange's, not the registry's
       * (see the note above), and a backup that silently omitted a row it
       * actually carries would be the far worse lie. Until habits have a screen
       * the row simply reads 0 on both sides, which is true.
       *
       * „Ishrana“ joins on the same terms from FIT slice a, and its label names
       * what the module actually carries: the user's own foods, their food diary
       * and their daily goals. The app's own food catalogue is counted nowhere,
       * because it ships inside the app rather than in the archive.
       */
      modules: {
        tasks: "Zadaci",
        calendar: "Kalendar",
        study: "Učenje",
        notifications: "Obaveštenja",
        notes: "Beleške",
        dashboard: "Kontrolna tabla",
        finance: "Finansije",
        habits: "Navike",
        fitness: "Fitnes",
        canvas: "Tabla",
        // ELEC joins on „Navike"'s terms: the archive vocabulary is the
        // interchange's, not the registry's, so the row appears here as soon
        // as the archive carries the rows — and reads 0 on both sides until
        // the module has a screen, which is true.
        electronics: "Elektronika",
      } satisfies Record<keyof RestoreModuleCounts, string>,
      columnCurrent: "Sada",
      columnIncoming: "Iz arhive",
      /**
       * Shown only when `corruptBlobs > 0`: "Arhiva sadrži N prilog(a) sa
       * oštećenim sadržajem — …". Numeral agreement via `dayUnit`, and the
       * qualifier deliberately sits OUTSIDE the counted phrase — "N oštećen
       * prilog" and "N oštećenih priloga" would need three forms, while a
       * bare "prilog"/"priloga" reads correctly at every count.
       */
      corruptBlobsPrefix: "Arhiva sadrži",
      corruptBlobsUnitOne: "prilog",
      corruptBlobsUnitMany: "priloga",
      corruptBlobsSuffix: "sa oštećenim sadržajem — te datoteke neće biti vraćene.",
      /**
       * Privatne beleške u pregledu (ADR-057 §6). The carries line renders as
       * „… (N).“ — the count in parentheses, one form for every count (the
       * export block's own arrangement) — and is shown WHENEVER the archive
       * carries private notes, restorable or not: someone confirming a
       * restore must see that this file holds somebody's private section.
       * The skip sentence joins it only while the target's section is locked
       * or not set up; in the preview's own tense (the corrupt-blob line's
       * precedent), because nothing has been skipped yet.
       */
      privateNotesIncomingPrefix: "Arhiva sadrži i privatne beleške",
      privateNotesSkippedNotice:
        "Privatne beleške iz arhive neće biti vraćene — otključaj privatnu sekciju pre vraćanja.",
      applyButton: "Vrati podatke",
      cancelButton: "Otkaži",
      applying: "Vraćanje u toku…",
      applied: "Podaci su vraćeni. Aplikacija se osvežava…",
      /** A rejected pick/preview call (not one of the typed statuses below). */
      readError: "Čitanje arhive nije uspelo. Pokušaj ponovo.",
      /** A rejected apply call; the preview itself stays valid, so this invites a retry. */
      error: "Vraćanje nije uspelo. Pokušaj ponovo.",
      /** `{ status: "no-file" }`: main no longer holds the pick this screen was showing. */
      noFileError: "Arhiva više nije izabrana. Izaberi je ponovo.",
      /** The post-reload banner (App.tsx), shown for as long as the undo is live. */
      undoBanner: "Podaci su vraćeni iz rezervne kopije.",
      undoButton: "Opozovi",
      undoDismiss: "Sakrij obaveštenje",
      undoError: "Opoziv nije uspeo. Pokušaj ponovo.",
      /** One sentence per `ArchiveReadErrorCode`: the archive could not be opened at all. */
      unreadable: {
        "not-an-archive": "Ovaj fajl nije Nexus arhiva.",
        "passphrase-required": "Arhiva je zaštićena lozinkom — upiši lozinku arhive.",
        "passphrase-wrong": "Pogrešna lozinka za ovu arhivu.",
        damaged: "Arhiva je oštećena i ne može se pročitati.",
        "too-large": "Arhiva prelazi bezbednosna ograničenja i zato je odbijena.",
      } satisfies Record<ArchiveReadErrorCode, string>,
      /**
       * One sentence per `RestoreProblemCode`: the archive opened, but its
       * contents did not check out. Honest about what is wrong without naming
       * internals — the machine-readable part (file, line, field) is rendered
       * beside each sentence, muted, straight from the problem itself.
       */
      problems: {
        "missing-manifest": "Arhivi nedostaje manifest — bez njega se ne zna šta sadrži.",
        "invalid-manifest": "Manifest arhive nije ispravan.",
        "unsupported-schema-version":
          "Arhiva je napravljena u novijoj verziji Nexusa i ova verzija ne može da je pročita.",
        "missing-data-file": "Arhivi nedostaje fajl sa podacima koji njen manifest navodi.",
        "checksum-mismatch":
          "Sadržaj fajla se ne poklapa sa njegovim kontrolnim zbirom — arhiva je oštećena ili je menjana.",
        "invalid-json": "Fajl sa podacima nije ispravan JSON.",
        "unknown-record-type": "Arhiva sadrži vrstu zapisa koju ova verzija ne poznaje.",
        "invalid-record": "Zapis u arhivi nije ispravan.",
        "duplicate-id": "Isti zapis se u arhivi pojavljuje više puta.",
        "unknown-reference": "Zapis upućuje na nešto čega u arhivi nema.",
        "reference-cycle": "Zapisi u arhivi upućuju jedni na druge u krug.",
        "invalid-ydoc": "Sadržaj beleške u arhivi nije ispravan.",
        "missing-ydoc": "Belešci u arhivi nedostaje sadržaj.",
        "missing-blob": "Prilogu nedostaje datoteka u arhivi — zapis se vraća bez nje.",
        // ADR-058: arhiva se vraća samo u profil svoje vrste (lični ↔ poslovni).
        "profile-kind-mismatch":
          "Arhiva pripada drugoj vrsti profila (lični/poslovni) i ne može se vratiti u ovaj profil — izaberi profil iste vrste.",
        // ADR-090: arhiva nosi podatke modula koji ova verzija ne poznaje.
        "unknown-module":
          "Arhiva sadrži podatke modula koji ova verzija ne poznaje — ažuriraj Nexus ili uvezi arhivu u verziji koja ju je napravila.",
        // ADR-090: modul je tu, ali njegove podatke ova verzija ne ume da pročita.
        "invalid-module-data":
          "Arhiva sadrži podatke modula zapisane u novijoj verziji — ova verzija Nexusa ne može da ih pročita.",
      } satisfies Record<RestoreProblemCode, string>,
    },
    /**
     * Uvoz iz arhive (ADR-043 §5) — the ADDITIVE sibling of the restore block
     * above, in the same "Rezervna kopija" card and through the same
     * pick → passphrase → preview → confirm flow.
     *
     * Only what actually differs is spelled here. Everything the two flows
     * share — the passphrase field, the preview/running lines, the picked-file
     * prefix, the manifest labels, the `unreadable`/`problems` sentences, the
     * corrupt-blob line, the module row labels, „Otkaži“ — is read straight off
     * `strings.settings.restore` by the component, because the flows are
     * identical there by design and a second spelling would drift.
     *
     * `description` states the contract the whole card turns on and that the
     * restore description states in reverse: an import ADDS, a restore
     * REPLACES.
     *
     * `skips` is typed against the wire's own closed `ImportSkipCode` domain,
     * so a code added in `shared/ipc.ts` is a compile error here rather than a
     * silently missing sentence in the one screen that has to be honest about
     * what will not arrive.
     */
    import: {
      title: "Uvoz iz arhive",
      description:
        "Dodaj sadržaj tuđe arhive — ili svog drugog profila — u ovaj profil. Uvoz ništa ne briše: sve što već imaš ostaje na svom mestu, a sadržaj arhive dolazi pored toga, kao novi zapisi. Uvoz možeš opozvati jednim klikom, ali samo dok ne zaključaš ili ne zatvoriš aplikaciju.",
      /** Preview header, beside the archive's own manifest facts (which reuse restore's labels). */
      targetLabel: "Uvozi se u",
      encryptedBadge: "Šifrovana arhiva",
      /**
       * The per-module table's four columns — `ImportModuleCounts`' own
       * arithmetic, in its own order: `parsed = imported + merged + skipped`.
       */
      columnParsed: "U arhivi",
      columnImported: "Uvozi se",
      columnMerged: "Spojeno",
      columnSkipped: "Preskočeno",
      /** Says what the two middle columns mean before the user has to guess — merging is the part nobody expects. */
      tableCaption:
        "„Spojeno“ su zapisi koji su se poklopili sa nečim što već imaš — oznaka istog imena, veza koja već postoji. Sve „preskočeno“ je, razlog po razlog, izlistano ispod.",
      /** Heading above the skip list; rendered only when the plan actually skips something. */
      skipsTitle: "Šta se ne uvozi",
      /**
       * Heading above the parse warnings. A restore's preview needs none — it
       * shows one list — while an import shows the grouped skip report AND the
       * row-by-row detail behind it, and two unlabeled lists in a row would
       * read as one.
       */
      warningsTitle: "Upozorenja pri čitanju arhive",
      /**
       * One sentence per `ImportSkipCode`. The first seven are rows salvage
       * mode could not read — the „oštećen red“ family, worded so it is clear
       * the ARCHIVE is at fault and the rest of it still arrives. The rest
       * are skipped BY DESIGN, and each says whose choice wins and why.
       *
       * The default task list is deliberately never named („Inbox“): it is a
       * stored, renamable row, exactly as `strings.tasks.lists` explains.
       */
      skips: {
        "unknown-record-type":
          "Oštećen red — vrsta zapisa koju ova verzija Nexusa ne poznaje; ostatak arhive se uvozi normalno.",
        "invalid-record": "Oštećen red — zapis nije ispravan i zato se preskače.",
        "duplicate-id": "Oštećen red — isti zapis se u arhivi pojavljuje više puta; uzima se prvi.",
        "unknown-reference": "Oštećen red — zapis upućuje na nešto čega u arhivi nema.",
        "reference-cycle": "Oštećen red — zapisi u arhivi upućuju jedni na druge u krug.",
        "missing-ydoc": "Oštećen red — belešci u arhivi nedostaje sadržaj.",
        "invalid-ydoc": "Oštećen red — sadržaj beleške u arhivi nije ispravan.",
        "settings-not-imported":
          "Podešavanja iz arhive se ne uvoze — moduli i obaveštenja ostaju onako kako su podešeni na ovom uređaju.",
        "notifications-not-imported":
          "Zabeležena obaveštenja se ne uvoze — taj spisak pripada profilu u kom je nastao.",
        "dashboard-settings-not-imported":
          "Pozadina kontrolne table se ne uvozi — izgled tvoje table ostaje tvoj.",
        "dashboard-sets-not-imported":
          "Imenovane table iz arhive se ne uvoze — tvoje table ostaju tvoje.",
        "dashboard-widgets-not-imported":
          "Raspored kontrolne table se ne uvozi — tvoja tabla ostaje kakva jeste.",
        "study-settings-not-imported":
          "Podešavanja učenja iz arhive se ne uvoze — tvoja ciljana zapamćenost i dnevni limiti ostaju tvoji.",
        // Migration 057: kalorijski i makro ciljevi su odluka o sopstvenom telu,
        // vezana za profil — tuđi se ne preuzimaju.
        "fit-targets-not-imported":
          "Ciljevi ishrane iz arhive se ne uvoze — tvoje kalorije i makronutrijenti ostaju tvoji.",
        // Migration 060: pol, datum rođenja, visina i nivo aktivnosti su
        // odluka o sopstvenom telu, vezana za profil — tuđi se ne preuzimaju.
        "fit-body-profile-not-imported":
          "Podaci o telu iz arhive se ne uvoze — tvoji podaci ostaju tvoji.",
        // Migration 060: merenje je vezano za (profil, dan) — tuđe merenje bi
        // se ili sudarilo sa tvojim za taj dan, ili ga tiho udvostručilo.
        "fit-measurements-not-imported":
          "Merenja tela iz arhive se ne uvoze — tvoja istorija merenja ostaje tvoja.",
        "calendar-settings-not-imported":
          "Datumi semestra iz arhive se ne uvoze — tvoj kalendar ostaje na tvom rasporedu.",
        "profile-picture-not-imported":
          "Slika profila iz arhive se ne uvozi — tvoja slika ostaje tvoja.",
        // ADR-057 §6: privatne beleške se nikada ne uvoze — tuđe otključane
        // tajne se ne zapečaćuju pod tvojim ključem.
        "private-notes-not-imported":
          "Privatne beleške iz arhive se ne uvoze — privatna sekcija je lična i ne prenosi se u tuđ profil.",
        "template-name-taken": "Šablon istog imena već postoji kod tebe — tvoj se zadržava.",
        "source-inbox-collapsed":
          "Podrazumevana lista iz arhive se ne pravi ponovo — njeni zadaci ulaze u tvoju podrazumevanu listu.",
        "duplicate-of-existing": "Već postoji kod tebe — preskočeno po tvom izboru.",
        // Migration 051: sudar je oko MESTA (kategorija + valuta), ne oko
        // imena, pa mu treba sopstvena rečenica.
        "budget-slot-taken":
          "Za tu kategoriju već imaš budžet u toj valuti — tvoj iznos ostaje.",
      } satisfies Record<ImportSkipCode, string>,
      /**
       * „Već postoji kod tebe“ (ADR-051 / IMEX-008) — the choice rows above the
       * skip list. One row per duplicate group the plan detected, each naming
       * what the group is, how many rows it covers, and — the part that makes
       * the choice answerable — WHAT „isto“ means for it, in words.
       *
       * The heading is a statement of fact, not a warning: nothing is wrong, the
       * archive simply overlaps with what this profile already has, and the user
       * decides which way that goes.
       */
      duplicatesTitle: "Već postoji kod tebe",
      duplicatesCaption:
        "Ovo iz arhive poklapa se sa nečim što već imaš. Podrazumevano se preskače. Ako ti ipak treba, uvozi se kao zaseban, nov zapis — ono što već imaš se ni u jednom slučaju ne menja.",
      /**
       * What each group IS, in the module's own word („Ljudi“ is the panel
       * CAL-007 calls it, „Prilozi“ the one every attachment block calls it), and
       * what „isto“ means for it. Two closed maps over the wire's own
       * `ImportDuplicateType`, so a group added in `shared/ipc.ts` is a compile
       * error here rather than a row the screen cannot label — which for a row
       * that asks the user a question would be the worst possible gap.
       */
      duplicateLabels: {
        event: "Događaji",
        person: "Ljudi",
        document: "Dokumenti",
        attachment: "Prilozi",
      } satisfies Record<ImportDuplicateType, string>,
      duplicateIdentities: {
        event: "isti naslov i vreme",
        person: "isto ime i datum",
        document: "ista vrsta i naziv",
        // One group for all three attachment tables: the identity is the file.
        attachment: "ista datoteka",
      } satisfies Record<ImportDuplicateType, string>,
      /** The two-state control. „Uvezi svejedno“ says out loud that this is the deliberate choice, not the ordinary one. */
      duplicateSkipButton: "Preskoči",
      duplicateImportButton: "Uvezi svejedno",
      /** The group's accessible name, since the two buttons alone do not say what they are answering. */
      duplicateChoiceLabel: "Šta sa poklapanjima",
      /** A rejected re-plan; the preview on screen stays valid, so this invites a retry rather than starting over. */
      duplicateError: "Izbor nije mogao da se primeni. Pokušaj ponovo.",
      /**
       * The corrupt-blob line's closing clause only: the count, its numeral
       * agreement and the „Arhiva sadrži“ opening are the restore's, and only
       * the verb differs — those files are not RETURNED here, they are not
       * imported.
       */
      corruptBlobsSuffix: "sa oštećenim sadržajem — te datoteke neće biti uvezene.",
      applyButton: "Uvezi",
      applying: "Uvoz u toku…",
      applied: "Podaci su uvezeni. Aplikacija se osvežava…",
      /** A rejected apply call; the preview itself stays valid, so this invites a retry. */
      error: "Uvoz nije uspeo. Pokušaj ponovo.",
      /** The post-reload banner (App.tsx) when the undo slot holds an IMPORT — the button, the dismiss label and the error line are the restore's, since undoing is one mechanism. */
      undoBanner: "Podaci su uvezeni iz arhive.",
    },
    /**
     * Uvoz iz Anki (.apkg) — ADR-052 / STUDY-011, the block beside „Uvoz iz
     * arhive" and deliberately its sibling in shape: pick → choose → preview →
     * confirm, the same undo banner afterwards. What differs is what it is
     * reading and therefore what it has to be honest about.
     *
     * The copy's whole job is that honesty. An Anki deck carries things this
     * app does not model — media files, SM-2 review history, Anki tags, custom
     * card templates — and the description says so BEFORE the user picks a file
     * rather than leaving them to notice afterwards. `skips` then names, one
     * counted line at a time, exactly what did not make it out of THIS deck.
     *
     * Everything the flow shares with its two siblings — „Izabrano:", „Otkaži",
     * the preview-running line — is read straight off `strings.settings.restore`
     * by the component, exactly as the import block reads it, because a second
     * spelling of one sentence is a sentence that will drift.
     *
     * `unreadable` and `skips` are typed against the wire's own closed domains,
     * so a code added in `shared/ipc.ts` is a compile error here rather than a
     * silently missing sentence in the one screen that has to be honest.
     */
    apkgImport: {
      title: "Uvoz iz Anki (.apkg)",
      description:
        "Uvezi Anki špil kao Nexus kartice. Špilovi ulaze u oblast koju izabereš, a ništa što već imaš se ne menja. Kartice kreću kao nove: istorija učenja, slike, zvuk i Anki oznake se ne prenose — sve što ne stigne piše, komad po komad, u pregledu pre uvoza. Uvoz možeš opozvati jednim klikom, ali samo dok ne zaključaš ili ne zatvoriš aplikaciju.",
      pickButton: "Izaberi .apkg fajl…",
      /** The subject picker — the one decision only the user can make, since an .apkg has no subject of its own. */
      subjectLabel: "Oblast za uvezene špilove",
      /** The „make one" option, first in the list because a first Anki import usually has nowhere to land yet. */
      newSubjectOption: "Nova oblast…",
      newSubjectLabel: "Naziv nove oblasti",
      newSubjectPlaceholder: "npr. Anatomija",
      previewButton: "Prikaži pregled",
      previewRunning: "Čitanje špila…",
      /** Preview header: what the file holds, and where it is going. */
      subjectPrefix: "Oblast:",
      subjectNewSuffix: "— biće napravljena",
      columnSource: "U špilu",
      columnPlanned: "Uvozi se",
      rowDecks: "Špilovi",
      rowNotes: "Beleške",
      rowCards: "Kartice",
      skipsTitle: "Šta se ne uvozi",
      /**
       * One sentence per `ApkgImportSkipCode`, each saying what was lost and —
       * where it is not obvious — why this app cannot carry it. The wording
       * never blames the user's deck for a difference between two programs.
       */
      skips: {
        "unknown-notetype":
          "Beleška koristi tip kartice koji špil ne opisuje ili koji ova verzija ne ume da pročita — bez njega se ne zna šta je pitanje, a šta odgovor.",
        "unknown-deck": "Kartica pripada špilu kog u fajlu nema.",
        "empty-note": "Beleška nema teksta na prednjoj strani.",
        "empty-deck": "Prazan špil se ne pravi — u njemu nije ostala nijedna kartica.",
        "template-unsupported":
          "Anki šablon koji ova verzija ne ume da prikaže — uvoze se osnovna i obrnuta kartica.",
        "cloze-nested": "Praznina unutar praznine — takva beleška se ne može zapisati.",
        "cloze-no-deletions": "Beleška je „cloze“, a nema nijednu prazninu.",
        "cloze-unrepresentable":
          "Praznine u belešci se ne mogu tačno zapisati u Nexus obliku, pa se beleška preskače u celini — pogrešno postavljena praznina bila bi gora od nijedne.",
        "cloze-hint-dropped": "Nagoveštaj uz prazninu se ne prenosi — ostaje sama praznina.",
        "extra-fields-dropped":
          "Dodatna polja beleške se ne prenose — kartica ima prednju i zadnju stranu.",
        "media-stripped": "Slike i zvuk se ne prenose; kartice stižu kao čist tekst.",
        "tags-dropped": "Anki oznake se ne prenose.",
        "history-dropped":
          "Istorija učenja se ne prenosi — kartice kreću kao nove. Odložene i sakrivene kartice stižu na isti način.",
        "card-without-note": "Kartica upućuje na belešku koje u špilu nema.",
      } satisfies Record<ApkgImportSkipCode, string>,
      /** One sentence per `ApkgReadErrorCode`: the file could not be read at all. */
      unreadable: {
        "not-an-apkg": "Ovaj fajl nije Anki špil.",
        "no-collection": "U ovom fajlu nema Anki kolekcije — nije .apkg špil.",
        "unsupported-schema":
          "Špil je u verziji Anki baze koju ova verzija ne čita — verovatno je iz novijeg Ankija. Čitaju se i najnoviji format i izvoz sa opcijom „Support older Anki versions“, pa špil izvezi ponovo iz Ankija i pokušaj opet.",
        "zstd-unavailable": "Ovo izdanje ne može da otvori zstd sažimanje koje ovaj špil koristi.",
        damaged: "Špil je oštećen i ne može se pročitati.",
        "too-large": "Špil prelazi bezbednosna ograničenja i zato je odbijen.",
      } satisfies Record<ApkgReadErrorCode, string>,
      applyButton: "Uvezi",
      applying: "Uvoz u toku…",
      applied: "Kartice su uvezene. Aplikacija se osvežava…",
      /** A rejected pick/preview call (not one of the typed statuses above). */
      readError: "Čitanje špila nije uspelo. Pokušaj ponovo.",
      /** A rejected apply call; the preview itself stays valid, so this invites a retry. */
      error: "Uvoz nije uspeo. Pokušaj ponovo.",
      /** `{ status: "no-file" }`: main no longer holds the pick this screen was showing. */
      noFileError: "Špil više nije izabran. Izaberi ga ponovo.",
      /** Shown when the deck translates to nothing at all — the „Uvezi" button is hidden, because there is nothing to confirm. */
      nothingToImport: "Iz ovog špila nema šta da se uvede — razlozi su izlistani iznad.",
      /** The post-reload banner (App.tsx) when the undo slot holds an Anki import. */
      undoBanner: "Kartice su uvezene iz Anki špila.",
    },
    /**
     * Uvoz zadataka (.csv) — ADR-062, the block beside „Uvoz iz Anki" and its
     * sibling in shape, one step longer: pick → MAP → preview → confirm, the
     * same undo banner afterwards. The extra step is the one thing a CSV
     * cannot answer for itself — it has no fixed schema — so the mapping
     * dialog asks the user which column is which, with the header table's own
     * SUGGESTION pre-filled, never silently committed.
     *
     * The copy's whole job is the honesty the flow promises: every loss is
     * named per row („Red 12"), the destination is ONE list said out loud, and
     * a mapped „Lista" column's cells are counted as not-carried rather than
     * quietly flattened.
     *
     * Everything shared with the sibling flows — „Izabrano:", „Otkaži" — is
     * read off `strings.settings.restore` by the component, exactly as the
     * `.apkg` block reads it. `roles`, `unreadable` and `drops` are typed
     * against the wire's own closed domains, so a value added in
     * `shared/ipc.ts` is a compile error here rather than a silently missing
     * sentence.
     */
    csvImport: {
      title: "Uvoz zadataka (.csv)",
      description:
        "Uvezi zadatke iz CSV tabele — izvoza iz drugog alata ili ručno vođenog spiska. Ti kažeš koja kolona je šta, svi zadaci ulaze u jednu listu koju izabereš, a ništa što već imaš se ne menja. Sve što ne može da se pročita piše, red po red, u pregledu pre uvoza. Uvoz možeš opozvati jednim klikom, ali samo dok ne zaključaš ili ne zatvoriš aplikaciju.",
      pickButton: "Izaberi .csv fajl…",
      reading: "Čitanje tabele…",
      /** The mapping dialog (SET §, ADR-062): a row per detected column, the two parse toggles, and the destination list. */
      mapTitle: "Mapiranje kolona",
      mapQuestion: "Reci koja kolona je šta — predloženo je već upisano, potvrdi ili promeni.",
      /** How an unnamed column introduces itself when the file has no header row: „Kolona 3". */
      columnFallbackPrefix: "Kolona",
      /** The muted sample line under each header, prefixed so three values do not read as a sentence. */
      samplesLabel: "Primeri:",
      roleLabel: "Uloga kolone",
      /**
       * One option label per `CsvImportColumnRole`. „Lista (ne uvozi se)" says
       * the role's own truth in the select itself: the import cilja jednu
       * listu, so a list column is recognised but its cells are not carried.
       */
      roles: {
        title: "Naziv zadatka",
        description: "Opis",
        dueDate: "Rok",
        priority: "Prioritet",
        status: "Status",
        list: "Lista (ne uvozi se)",
        section: "Sekcija",
        tags: "Oznake",
        ignore: "Ne uvozi se",
      } satisfies Record<CsvImportColumnRole, string>,
      /** Under the column rows: why the confirm button is asleep until exactly one column is the title. */
      titleRequired: "Tačno jedna kolona mora biti Naziv zadatka.",
      delimiterLabel: "Razdvajanje kolona",
      delimiterComma: "Zapeta (,)",
      delimiterSemicolon: "Tačka-zapeta (;)",
      headerLabel: "Prvi red je zaglavlje",
      /** The destination — ONE list for the whole file (ADR-062), existing or named into being. */
      listLabel: "Lista za uvezene zadatke",
      newListOption: "Nova lista…",
      newListLabel: "Naziv nove liste",
      newListPlaceholder: "npr. Uvoz",
      confirmButton: "Prikaži pregled",
      /** A rejected map call; the dialog stays open, so this invites a retry. */
      mapError: "Mapiranje nije moglo da se primeni. Pokušaj ponovo.",
      /** The plan preview under the dialog: where it goes, what arrives, what does not. */
      listPrefix: "Lista:",
      listNewSuffix: "— biće napravljena",
      rowRows: "Redova u tabeli",
      rowTasks: "Uvozi se zadataka",
      /** Rendered only when non-zero: blank spreadsheet lines are not losses, but the arithmetic still says where they went. */
      blankRowsPrefix: "Praznih redova:",
      /** Back to the mapping dialog — the same rows, the same suggestions, a fresh plan on confirm. */
      remapButton: "Izmeni mapiranje",
      dropsTitle: "Šta se ne uvozi",
      /** How a dropped row names itself: „Red 12" — the data row's own number, header excluded, as the spreadsheet shows it. */
      dropRowPrefix: "Red",
      /**
       * One sentence per `CsvImportRowDropCode`. The due-date sentence says the
       * task still arrives — losing the date must never read as losing the row.
       */
      drops: {
        "empty-title": "Nema naziva zadatka — red se preskače.",
        "bad-due-date":
          "Rok nije mogao da se pročita (dvocifrena godina se odbija, ne pogađa se vek) — zadatak se uvozi bez roka.",
      } satisfies Record<CsvImportRowDropCode, string>,
      /** The mapped-„Lista" count line: prefix, then the number, then this suffix. */
      listCellsDroppedPrefix: "Vrednosti kolone „Lista“:",
      listCellsDroppedSuffix:
        "— ne prenose se; svi zadaci ulaze u listu izabranu iznad.",
      /** One sentence per `CsvImportReadErrorCode`: the file could not be turned into columns at all. */
      unreadable: {
        "too-large": "Tabela prelazi bezbednosna ograničenja (5 MB) i zato je odbijena.",
        empty: "U ovom fajlu nema redova sa podacima.",
        "too-many-columns": "Tabela ima previše kolona za mapiranje.",
        unreadable: "Fajl nije mogao da se pročita. Pokušaj ponovo.",
      } satisfies Record<CsvImportReadErrorCode, string>,
      applyButton: "Uvezi",
      applying: "Uvoz u toku…",
      applied: "Zadaci su uvezeni. Aplikacija se osvežava…",
      /** A rejected pick/preview call (not one of the typed statuses above). */
      readError: "Čitanje tabele nije uspelo. Pokušaj ponovo.",
      /** A rejected apply call; the plan itself stays valid, so this invites a retry. */
      error: "Uvoz nije uspeo. Pokušaj ponovo.",
      /** `{ status: "no-file" }`: main no longer holds the pick this screen was showing. */
      noFileError: "Fajl više nije izabran. Izaberi ga ponovo.",
      /** Shown when the mapping translates to nothing at all — the „Uvezi" button is hidden, because there is nothing to confirm. */
      nothingToImport: "Iz ove tabele nema šta da se uveze — razlozi su izlistani iznad.",
      /** The post-reload banner (App.tsx) when the undo slot holds a CSV import. */
      undoBanner: "Zadaci su uvezeni iz CSV tabele.",
    },
    /**
     * Uvoz izvoda (.csv) → Finansije — FIN slice e. The task CSV import's
     * sibling in shape (pick → mapiranje → pregled → potvrda) and its opposite
     * in tone: this one is about money, so every sentence here says what was
     * READ and what was REFUSED rather than merely what arrived.
     */
    finCsvImport: {
      title: "Uvoz izvoda (.csv)",
      description:
        "Uvezi promete iz bankarskog izvoda u jedan svoj račun. Ti kažeš koja kolona je datum, a koja iznos — i da li je iznos jedna kolona sa predznakom ili odvojene kolone za isplatu i uplatu. Format brojeva i datuma se utvrđuje nad celom kolonom; ako fajl dopušta dva čitanja, uvoz se odbija umesto da pogađa. Isti izvod možeš uvesti dva puta bez duplikata — svaki već uvezen red se preskače i piše u pregledu.",
      pickButton: "Izaberi izvod (.csv)…",
      reading: "Čitanje izvoda…",
      /** Shown instead of the pick button when the profile has no account to import into. */
      noAccounts: "Prvo napravi račun — izvod ulazi u račun koji izabereš, a račun nosi valutu koju izvod ne može da donese.",
      mapTitle: "Mapiranje kolona izvoda",
      mapQuestion: "Reci koja kolona je šta — predloženo je već upisano, potvrdi ili promeni.",
      columnFallbackPrefix: "Kolona",
      samplesLabel: "Primeri:",
      roleLabel: "Uloga kolone",
      /**
       * One option label per `FinCsvImportColumnRole`. „Isplata"/„Uplata" name
       * the two split columns by MEANING — money leaving and money arriving —
       * because „duguje"/„potražuje" mean opposite things depending on whose
       * books are being read.
       */
      roles: {
        date: "Datum",
        amount: "Iznos (sa predznakom)",
        outflow: "Isplata (odliv)",
        inflow: "Uplata (priliv)",
        payee: "Primalac",
        note: "Opis",
        currency: "Valuta",
        ignore: "Ne uvozi se",
      } satisfies Record<FinCsvImportColumnRole, string>,
      /** Under the column rows: why the confirm button is asleep. */
      dateRequired: "Jedna kolona mora biti Datum.",
      amountRequired:
        "Iznos mora biti ili jedna kolona sa predznakom, ili kolone Isplata i/ili Uplata — nikad oboje.",
      delimiterLabel: "Razdvajanje kolona",
      delimiterComma: "Zapeta (,)",
      delimiterSemicolon: "Tačka-zapeta (;)",
      headerLabel: "Prvi red je zaglavlje",
      /** The destination — ONE existing account for the whole file; its currency governs every amount. */
      accountLabel: "Račun u koji izvod ulazi",
      accountHint: "Valuta ovog računa važi za ceo izvod. Izvod u drugoj valuti se odbija — Nexus nema kurs.",
      /** The sign convention: stated by the user, never sniffed. */
      signLabel: "Šta znači predznak u koloni Iznos",
      signs: {
        "negative-is-expense": "Minus = trošak, plus = priliv",
        "positive-is-expense": "Plus = trošak, minus = priliv",
      } satisfies Record<FinCsvImportSignConvention, string>,
      confirmButton: "Prikaži pregled",
      mapError: "Mapiranje nije moglo da se primeni. Pokušaj ponovo.",
      /** The plan preview: where it goes, how it was read, what arrives, what does not. */
      accountPrefix: "Račun:",
      rowRows: "Redova u izvodu",
      rowTransactions: "Uvozi se prometa",
      blankRowsPrefix: "Praznih redova:",
      remapButton: "Izmeni mapiranje",
      /** The two conventions the file was READ under — said out loud, never left to trust. */
      formatsTitle: "Kako je fajl pročitan",
      amountFormatLabel: "Brojevi",
      amountFormats: {
        "decimal-comma": "1.234,56 — zapeta je decimalna",
        "decimal-dot": "1,234.56 — tačka je decimalna",
      } satisfies Record<FinCsvImportAmountFormat, string>,
      dateFormatLabel: "Datumi",
      dateFormats: {
        iso: "2026-08-31",
        "dmy-dot": "31.08.2026.",
        "dmy-slash": "31/08/2026 — dan/mesec/godina",
        "mdy-slash": "08/31/2026 — mesec/dan/godina",
      } satisfies Record<FinCsvImportDateFormat, string>,
      signFormatLabel: "Predznak",
      dropsTitle: "Šta se ne uvozi",
      dropRowPrefix: "Red",
      /** One sentence per `FinCsvImportRowDropCode`. Only the last one keeps the row. */
      drops: {
        "bad-date": "Datum nije mogao da se pročita — red se preskače.",
        "no-amount": "Nema iznosa (ili je nula) — red se preskače.",
        "both-amounts": "Popunjene su i Isplata i Uplata — ne pogađa se koja važi, red se preskače.",
        "bad-amount": "Iznos nije mogao da se pročita u utvrđenom formatu — red se preskače.",
        "text-truncated": "Opis je duži nego što ledger drži pa je skraćen — promet se uvozi.",
      } satisfies Record<FinCsvImportRowDropCode, string>,
      /** The re-import block: every already-imported row, named (migration 052). */
      skipsTitle: "Već uvezeno",
      skipsCaption:
        "Ovi redovi su prepoznati po otisku prometa (datum, iznos, opis i redni broj među istovetnim redovima) i ne uvoze se ponovo.",
      skips: {
        "already-imported": "Ovaj promet već stoji u ledgeru.",
        "already-imported-deleted": "Ovaj promet je bio uvezen pa obrisan — ostaje obrisan.",
      } satisfies Record<FinCsvImportRowSkipCode, string>,
      /** The FILE-level refusals: the importer could not read it CONFIDENTLY, so it read none of it. */
      refusalTitle: "Izvod je odbijen",
      refusalColumnPrefix: "Kolona:",
      refusalSamplePrefix: "Sporna vrednost:",
      refusals: {
        "ambiguous-amount-format":
          "Iznosi u ovoj koloni dopuštaju dva čitanja koja daju različite brojeve. Novac se ne pogađa — sredi format u fajlu (jedna decimalna oznaka za celu kolonu) pa pokušaj ponovo.",
        "unreadable-amount-format":
          "Nijedna vrednost u ovoj koloni ne čita se kao iznos. Verovatno je mapirana pogrešna kolona.",
        "ambiguous-date-format":
          "Datumi u ovoj koloni dopuštaju i dan/mesec i mesec/dan, a dva čitanja daju različite dane. Uvoz se odbija umesto da pogađa.",
        "unreadable-date-format":
          "Nijedna vrednost u ovoj koloni ne čita se kao datum. Verovatno je mapirana pogrešna kolona.",
        "foreign-currency":
          "Izvod je u drugoj valuti nego izabrani račun. Nexus ne drži kurs — nema poštenog načina da ga pretvori — pa se ovaj izvod ne uvozi u ovaj račun.",
      } satisfies Record<FinCsvImportRefusalCode, string>,
      unreadable: {
        "too-large": "Izvod prelazi bezbednosna ograničenja (5 MB) i zato je odbijen.",
        empty: "U ovom fajlu nema redova sa podacima.",
        "too-many-columns": "Izvod ima previše kolona za mapiranje.",
        unreadable: "Fajl nije mogao da se pročita. Pokušaj ponovo.",
      } satisfies Record<CsvImportReadErrorCode, string>,
      applyButton: "Uvezi",
      applying: "Uvoz u toku…",
      applied: "Promet je uvezen. Aplikacija se osvežava…",
      readError: "Čitanje izvoda nije uspelo. Pokušaj ponovo.",
      error: "Uvoz nije uspeo. Pokušaj ponovo.",
      noFileError: "Fajl više nije izabran. Izaberi ga ponovo.",
      /** Shown when everything was either skipped or dropped — there is nothing to confirm. */
      nothingToImport: "Iz ovog izvoda nema šta da se uveze — razlozi su izlistani iznad.",
      /** The post-reload banner (App.tsx) when the undo slot holds a statement import. */
      undoBanner: "Promet je uvezen iz bankarskog izvoda.",
    },
    /**
     * Uvoz kalendara (.ics) — ADR-061, the block beside „Uvoz iz Anki" and
     * deliberately its sibling in shape: pick → preview → confirm, the same
     * undo banner afterwards. One step SHORTER than the Anki flow — an `.ics`
     * needs no subject choice, its events land straight in the calendar — so
     * the only question left on the screen is ADR-051's duplicate one, asked
     * with the import block's own „Preskoči / Uvezi svejedno" pair.
     *
     * The copy's whole job is honesty about what a calendar file cannot carry:
     * reminders (alarms are counted and left behind), a repeat rule Nexus does
     * not have (the first occurrence arrives, said per line), and any zone a
     * foreign calendar wrote (times land on THIS računar's clock). `skips` and
     * `unreadable` are typed against the wire's own closed domains, so a code
     * added in `shared/ipc.ts` is a compile error here rather than a silently
     * missing sentence.
     */
    icsImport: {
      title: "Uvoz kalendara (.ics)",
      description:
        "Uvezi događaje iz .ics fajla — iz Google kalendara, Outlooka ili bilo koje druge aplikacije koja ga izveze. Uvoz ništa ne briše: događaji dolaze pored onih koje već imaš. Podsetnici se ne prenose, a vreme zapisano u drugoj vremenskoj zoni preračunava se na sat ovog računara. Sve što ne stigne piše, komad po komad, u pregledu pre uvoza. Uvoz možeš opozvati jednim klikom, ali samo dok ne zaključaš ili ne zatvoriš aplikaciju.",
      pickButton: "Izaberi .ics fajl…",
      previewRunning: "Čitanje kalendara…",
      /** The preview's two columns: what the file holds, and how much of it arrives. */
      columnSource: "U fajlu",
      columnPlanned: "Uvozi se",
      rowEvents: "Događaji",
      skipsTitle: "Šta se ne uvozi",
      /**
       * One sentence per `IcsImportSkipCode`, each saying what was lost and —
       * where it is not obvious — why this app cannot carry it. The wording
       * never blames the user's calendar for a difference between two programs.
       */
      skips: {
        "invalid-start": "Događaj nema ispravan početak (DTSTART), pa se preskače.",
        "unknown-timezone":
          "Događaj navodi vremensku zonu koju ovaj računar ne poznaje, pa se preskače — pogađanje pomeraja pomerilo bi ga za više sati.",
        "empty-summary": "Događaj nema naslov, pa se preskače.",
        "invalid-end": "Kraj događaja nije ispravan — događaj se uvozi bez trajanja.",
        "invalid-exdate": "Izuzeti datum ponavljanja nije ispravan, pa se izostavlja.",
        "recurrence-unmappable":
          "Pravilo ponavljanja ne postoji u Nexusu — uvozi se samo prvi termin, kao jednokratan događaj.",
        "detached-override":
          "Pojedinačno pomeren termin tuđe serije uvozi se kao zaseban, jednokratan događaj.",
        "categories-dropped": "Događaj ima više kategorija — prenosi se prva.",
      } satisfies Record<IcsImportSkipCode, string>,
      /**
       * The lead-in of one component line: „Sadržaj vrste VTODO se ne uvozi —
       * 3“. The NAME between the two halves is the file's own (VTODO, VALARM,
       * X-…), which no closed map could label — and the honest sentence is the
       * same for all of them: Nexus reads events out of a calendar, nothing
       * else.
       */
      componentPrefix: "Sadržaj vrste",
      componentSuffix: "se ne uvozi — Nexus iz kalendara čita samo događaje.",
      /** One sentence per `IcsImportReadErrorCode`: the file could not be read at all. */
      unreadable: {
        "too-large": "Fajl prelazi bezbednosna ograničenja i zato je odbijen.",
        "not-a-calendar": "Ovaj fajl nije iCalendar (.ics) kalendar.",
      } satisfies Record<IcsImportReadErrorCode, string>,
      /**
       * Shown only when the planner recognised events this profile already has
       * (ADR-051). The sentence says which way the plan currently goes, and the
       * choice beside it — the import block's own „Preskoči / Uvezi svejedno"
       * pair, read from `settings.import` so the flows cannot drift — is how
       * the user says otherwise.
       */
      duplicatesPrefix: "Već imaš",
      duplicatesUnitOne: "događaj",
      duplicatesUnitFew: "događaja",
      duplicatesUnitMany: "događaja",
      duplicatesSuffix: "iz ovog fajla — oni se ne uvoze ponovo.",
      /** The same sentence's other ending, once a re-preview said „uvezi svejedno": nothing merges, the rows arrive as new. */
      duplicatesSuffixImported: "iz ovog fajla — ipak se uvoze, kao novi događaji.",
      applyButton: "Uvezi",
      applying: "Uvoz u toku…",
      applied: "Događaji su uvezeni. Aplikacija se osvežava…",
      /** A rejected pick/preview call (not one of the typed statuses above). */
      readError: "Čitanje kalendara nije uspelo. Pokušaj ponovo.",
      /** A rejected apply call; the preview itself stays valid, so this invites a retry. */
      error: "Uvoz nije uspeo. Pokušaj ponovo.",
      /** `{ status: "no-file" }`: main no longer holds the pick this screen was showing. */
      noFileError: "Fajl više nije izabran. Izaberi ga ponovo.",
      /** Shown when the file translates to nothing at all — the „Uvezi" button is hidden, because there is nothing to confirm. */
      nothingToImport: "Iz ovog fajla nema šta da se uvede — razlozi su izlistani iznad.",
      /** The post-reload banner (App.tsx) when the undo slot holds an .ics import. */
      undoBanner: "Događaji su uvezeni iz kalendara (.ics).",
    },
    /**
     * Uvoz preko AI asistenta (IMEX-005) — the one block in this card whose
     * „reader" is a person and a chat window.
     *
     * The copy's whole job is to be unambiguous about what Nexus does and does
     * not do: it WRITES an instruction and READS an answer, and it never talks
     * to a model. `description` says that in the first two sentences, because a
     * user who assumed otherwise would be assuming their content leaves the
     * device — the single most important thing this app promises it does not do.
     *
     * The flow is the import block's, one step shorter: choose what → copy the
     * instruction → paste the answer → preview → confirm, with the same shared
     * undo banner afterwards. Everything the three flows have in common — the
     * „Otkaži" button, the undo copy — is read straight off
     * `strings.settings.restore` by the component.
     *
     * `unreadable`, `skips` and `kinds` are typed against the wire's own closed
     * domains, so a code added in `shared/ipc.ts` is a compile error here rather
     * than a silently missing sentence.
     */
    llmImport: {
      title: "Uvoz preko AI asistenta",
      description:
        "Nexus ti napiše uputstvo, ti ga zajedno sa svojim tekstom nalepiš u razgovor sa svojim AI asistentom (ChatGPT, Claude, Gemini…), a odgovor koji dobiješ vratiš ovde. Nexus ni sa jednim modelom ne razgovara: ništa sa ovog uređaja ne odlazi nigde samo od sebe — ti biraš šta ćeš i gde nalepiti. Uvoz ništa ne briše i možeš ga opozvati jednim klikom, ali samo dok ne zaključaš ili ne zatvoriš aplikaciju.",
      /** Step 1 — what is being imported. The three kinds the app can build a row from with no further decision. */
      kindLabel: "Šta uvoziš",
      kinds: {
        tasks: "Zadatke",
        events: "Događaje",
        cards: "Kartice",
      } satisfies Record<LlmImportKind, string>,
      /** The same three, lowercase, for the middle of a sentence — `kinds` is written for a picker option, which is a different place in a different case. */
      kindsInline: {
        tasks: "zadatke",
        events: "događaje",
        cards: "kartice za učenje",
      } satisfies Record<LlmImportKind, string>,
      /** The prompt's own language — not the content's; the instruction tells the assistant to keep that. */
      languageLabel: "Jezik uputstva",
      languages: {
        sr: "Srpski",
        en: "Engleski",
      } satisfies Record<LlmPromptLanguage, string>,
      /** Step 2 — the clipboard button and the sentence that says what to do with what it copied. */
      copyButton: "Kopiraj uputstvo",
      copied: "Uputstvo je kopirano",
      copyError: "Kopiranje nije uspelo. Uputstvo možeš označiti i kopirati ručno iz polja ispod.",
      copyHint:
        "Nalepi uputstvo u razgovor sa asistentom, a ispod njega svoj tekst. Odgovor koji dobiješ vrati u polje ispod.",
      /** The prompt itself, shown so „Kopiraj" is never a black box — and so a failed clipboard write still leaves a way through. */
      promptLabel: "Uputstvo",
      promptShow: "Prikaži uputstvo",
      promptHide: "Sakrij uputstvo",
      /** Step 3 — the answer. */
      answerLabel: "Odgovor asistenta",
      answerPlaceholder: "Nalepi ovde ono što ti je asistent odgovorio…",
      /** The deck choice, shown only for cards: an odgovor iz ćaskanja names no deck, and a Nexus card lives in one. Two paths — a deck the profile already has, or one this import creates. */
      deckChoiceLabel: "Gde ulaze kartice",
      deckExistingOption: "Postojeći špil",
      deckNewOption: "Novi špil",
      deckLabel: "Špil za uvezene kartice",
      deckPlaceholder: "Izaberi špil",
      /** The new-deck form: a name, and the subject the deck lives under — a špil cannot exist outside an oblast. */
      newDeckLabel: "Naziv novog špila",
      newDeckPlaceholder: "npr. Ćelija",
      newDeckSubjectLabel: "Oblast za novi špil",
      newDeckSubjectPlaceholder: "Izaberi oblast",
      /** Shown under „Postojeći špil" when the profile has none — the way out is the other path, one click away. */
      noDecks: "Još nemaš nijedan špil — izaberi „Novi špil“ da ga napraviš ovde.",
      /** Shown instead of the whole deck choice when the profile has no subject at all — an honest dead end with the way out named, because a new deck needs an oblast to live in. */
      noSubjects:
        "Još nemaš nijednu oblast. Napravi je na stranici Učenje, pa se vrati ovde — svaki špil živi u jednoj oblasti.",
      previewButton: "Pregledaj",
      previewRunning: "Čitanje odgovora…",
      /** The preview's three numbers, which answer three different questions. */
      rowRecords: "Zapisa u odgovoru",
      rowAccepted: "Pročitano",
      rowPlanned: "Uvozi se",
      /** Said under the table, because „Uvozi se" being larger than „Pročitano" surprises anyone who has not met cloze cards. */
      cardsCaption:
        "Jedna rečenica sa više praznina postaje više kartica — po jedna za svaku prazninu.",
      /**
       * Shown only when the planner recognised events this profile already has
       * (ADR-051). The sentence says which way the plan currently goes, and the
       * choice beside it — the import block's own „Preskoči / Uvezi svejedno"
       * pair, read from `settings.import` so the two flows cannot drift — is
       * how the user says otherwise.
       */
      duplicatesPrefix: "Već imaš",
      duplicatesUnitOne: "događaj",
      duplicatesUnitFew: "događaja",
      duplicatesUnitMany: "događaja",
      duplicatesSuffix: "iz ovog odgovora — oni se ne uvoze ponovo.",
      /** The same sentence's other ending, once a re-plan said „uvezi svejedno": nothing merges, the rows arrive as new. */
      duplicatesSuffixImported: "iz ovog odgovora — ipak se uvoze, kao novi događaji.",
      /** Shown only when unknown keys were dropped, so „uvezeno je manje polja nego što sam video" is never a surprise. */
      droppedPrefix: "Odbačeno je",
      droppedUnitOne: "polje",
      droppedUnitFew: "polja",
      droppedUnitMany: "polja",
      droppedSuffix: "koje Nexus ne poznaje.",
      skipsTitle: "Šta se ne uvozi",
      /** How a skipped record names itself: „Zapis 3" — the answer's own position, so the user can find it in their chat. */
      skipRecordPrefix: "Zapis",
      /**
       * One sentence per `LlmImportSkipReason`. Each says what was wrong with
       * that one record and — where it helps — what to ask for instead. The
       * wording never blames the user for what a model wrote.
       */
      skips: {
        "not-an-object": "Nije zapis — na tom mestu u odgovoru stoji nešto drugo.",
        "missing-field": "Nedostaje obavezno polje.",
        "invalid-field": "Polje nije u traženom obliku (pogrešan datum, vreme ili vrednost van spiska).",
        "text-too-long": "Tekst polja je predugačak.",
        "unknown-card-shape":
          "Kartica nije ni par pitanje/odgovor ni rečenica sa prazninama — mora biti tačno jedno od to dvoje.",
        "no-cloze-deletion": "Rečenica nema nijednu prazninu u {{dvostrukim vitičastim zagradama}}.",
        "over-record-cap": "Preko granice od 500 zapisa po odgovoru.",
      } satisfies Record<LlmImportSkipReason, string>,
      /**
       * One sentence per `LlmImportAnswerProblem`: the paste could not be read
       * at all. Each ends with what to do next, because every one of these is
       * fixed in the chat window rather than here.
       */
      unreadable: {
        empty: "Nije nalepljen nikakav odgovor.",
        "too-long": "Odgovor je prevelik. Podeli tekst na manje delove i uvezi ih redom.",
        "no-json":
          "U odgovoru nema JSON-a. Asistent je verovatno odgovorio rečenicom — zamoli ga da odgovori isključivo JSON-om, tačno kao u uputstvu.",
        "not-json":
          "Ono što je asistent poslao nije ispravan JSON (najčešće zarez posle poslednjeg elementa). Zamoli ga da pošalje isti odgovor kao ispravan JSON.",
        "not-an-envelope":
          "Ovo nije odgovor u obliku koji uputstvo traži. Proveri da li je nalepljen ceo odgovor, sa „nexus-llm“ na početku.",
        "unsupported-version":
          "Odgovor je u obliku koji ova verzija Nexusa ne čita. Kopiraj uputstvo ponovo i pitaj iznova.",
        "unknown-kind": "Odgovor navodi vrstu zapisa koju Nexus ne poznaje.",
      } satisfies Record<LlmImportAnswerProblem, string>,
      /** The answer was readable, but for a different kind than the picker says — fixed by changing the picker, not the chat. */
      kindMismatchPrefix: "Ovaj odgovor sadrži",
      kindMismatchSuffix: "— a izbor iznad je druga vrsta. Promeni izbor ili pitaj ponovo.",
      applyButton: "Uvezi",
      applying: "Uvoz u toku…",
      applied: "Podaci su uvezeni. Aplikacija se osvežava…",
      /** Shown when nothing at all survived the read — the „Uvezi" button is hidden, because there is nothing to confirm. */
      nothingToImport: "Iz ovog odgovora nema šta da se uvede — razlozi su izlistani iznad.",
      /** A rejected preview call (not one of the typed statuses above). */
      readError: "Čitanje odgovora nije uspelo. Pokušaj ponovo.",
      /** A rejected apply call; the preview itself stays valid, so this invites a retry. */
      error: "Uvoz nije uspeo. Pokušaj ponovo.",
      /** The post-reload banner (App.tsx) when the undo slot holds an LLM import. */
      undoBanner: "Podaci su uvezeni preko AI asistenta.",
    },
    /**
     * Uvoz beležaka (.md) — IMEX-007's markdown slice, the quiet fourth block
     * of the „Rezervna kopija" card. Not an archive flow and worded so nobody
     * mistakes it for one: no preview, no undo banner, no passphrase — files
     * in, notes out, and the result line says exactly what landed.
     *
     * Two buttons rather than one because the native dialog cannot be both a
     * file picker and a folder picker on Windows (see `markdownImport.ts`), and
     * the copy names that plainly instead of hiding it behind one word.
     *
     * `skips` is typed against the wire's own closed `MarkdownImportSkipCode`
     * domain, so a code added in `shared/ipc.ts` is a compile error here rather
     * than a file that silently did not arrive.
     */
    markdownImport: {
      title: "Uvoz beležaka (.md)",
      description:
        "Uvezi Markdown fajlove kao beleške — svaki fajl postaje jedna beleška u izabranoj fascikli. Naslov je prvi „# “ iz fajla, a ako ga nema, ime samog fajla. Slike se ne prenose: ostaju kao tekst sa svojom putanjom.",
      folderLabel: "Fascikla za uvezene beleške",
      /** The unfiled root — the same place a note created from the notes page lands. */
      rootOption: "Bez fascikle",
      filesButton: "Izaberi .md fajlove…",
      folderButton: "Izaberi fasciklu…",
      /** Said beside the folder button, because a folder pick reaches into subfolders and that must not be a surprise. */
      folderHint: "Fascikla se čita zajedno sa podfasciklama; sve beleške ulaze u izabranu fasciklu.",
      running: "Uvoz u toku…",
      /** „Uvezeno 3 beleške" — full Serbian numeral agreement via `countUnit`. */
      createdPrefix: "Uvezeno",
      createdUnitOne: "beleška",
      createdUnitFew: "beleške",
      createdUnitMany: "beležaka",
      /** Shown when the pick produced nothing at all — no file in it could become a note. */
      createdNone: "Nijedna beleška nije uvezena.",
      /** Shown only when `imagesAsText > 0`: the slice imports no files, and the user hears it here rather than discovering it in a note. */
      imagesPrefix: "Slike nisu prenete:",
      imagesUnitOne: "slika je ostala",
      imagesUnitFew: "slike su ostale",
      imagesUnitMany: "slika je ostalo",
      imagesSuffix: "kao tekst sa putanjom.",
      skipsTitle: "Šta nije uvezeno",
      skips: {
        "too-large": "Fajl je veći od 1 MB.",
        "too-long": "Sadržaj fajla je preveliki za jednu belešku.",
        unreadable: "Fajl se ne može pročitati.",
        empty: "Fajl je prazan.",
        "too-many": "Uvozi se najviše 200 fajlova odjednom — ovaj i svi posle njega su preskočeni.",
        "not-markdown": "Nije Markdown fajl (.md ili .markdown).",
      } satisfies Record<MarkdownImportSkipCode, string>,
      error: "Uvoz beležaka nije uspeo. Pokušaj ponovo.",
    },
    /**
     * „Sinhronizacija“ (the cloud half of SET-010).
     *
     * Same house style as the privacy card below: every sentence is a fact
     * about how the thing is built, checkable in the source, rather than a
     * reassurance. „Ključ ostaje na tvojim uređajima" is `key_wraps` holding
     * wraps and never a key; „server ne čita ime uređaja" is `device-name.ts`
     * sealing it under a subkey of MK before it is posted; „prikazuje se samo
     * sada" is the recovery code being derived, shown, and never written
     * anywhere — not to the database, not to the log, not to the server.
     *
     * `errors` is typed `Record<SyncEnableProblem, string>`, so a refusal the
     * protocol can produce and this table does not name is a compile error
     * rather than an empty message box in front of a user. The sentences are
     * deliberately about what to DO next; several distinct protocol refusals
     * therefore share one sentence, because the user's next move is the same
     * and the distinction is ours, not theirs.
     *
     * ON HOLD (2026-10-08, `shared/syncHold.ts`): `SYNC_ON_HOLD` keeps the card
     * out of the settings page, its search index and the screenshot sweep, so
     * no sentence here reaches a user. The table stays typed and complete
     * because turning the work back on is flipping one constant.
     */
    sync: {
      description:
        "Nexus može da čuva šifrovanu kopiju tvojih podataka na Nexus nalogu i da je deli sa veb aplikacijom. Server vidi samo šifrovan sadržaj — ključ ostaje na tvojim uređajima.",
      /** The switch, and the one thing about it a user has to be told up front. */
      cloudLabel: "Dozvoli mrežni pristup",
      cloudHint: "Dok je isključeno, Nexus ne otvara nijednu vezu ka internetu — nijednu jedinu.",
      cloudRestart: "Promena važi od sledećeg pokretanja Nexusa.",
      /** No project baked into this build: the card says so instead of failing later. */
      unconfigured: "Ova verzija Nexusa nije povezana ni sa jednim serverom, pa sinhronizacija nije dostupna.",
      enableTitle: "Uključi sinhronizaciju na ovom računaru",
      enableIntro:
        "Nalog i potvrdu u dva koraka praviš u veb aplikaciji. Ovde upisuješ isti imejl i lozinku i jedan kod iz aplikacije za potvrdu.",
      emailLabel: "Imejl naloga",
      passwordLabel: "Lozinka naloga",
      passwordHint: "Lozinka ne napušta ovaj računar — server dobija samo vrednost izvedenu iz nje.",
      totpLabel: "Kod iz aplikacije za potvrdu",
      deviceNameLabel: "Ime ovog računara",
      deviceNameHint: "Ime se šifruje pre slanja — server ga ne čita.",
      submit: "Uključi sinhronizaciju",
      working: "Uključujem…",
      /** Shown once, and the copy has to make that unmistakable. */
      recoveryTitle: "Kod za oporavak sinhronizacije",
      recoveryIntro:
        "Prepiši ovaj kod i čuvaj ga van računara. Prikazuje se samo sada i nigde se ne čuva. Bez njega i bez uparenog uređaja nema povratka do ključa naloga.",
      recoveryDone: "Prepisao sam kod",
      statusOn: "Sinhronizacija je uključena na ovom računaru.",
      accountLabel: "Nalog",
      deviceLabel: "Uređaj",
      enabledAtLabel: "Uključeno",
      signedOut: "Ovaj računar trenutno nije prijavljen na nalog.",
      connecting: "Povezivanje…",
      reconnectTitle: "Poveži ovaj računar ponovo",
      /**
       * Says what happened, in the user's terms, and what it costs. „Prijava je
       * istekla" rather than „sesija je opozvana": the most common cause is
       * another računar uključivao sinhronizaciju, which ends every other
       * prijava on the account, and none of that is the user's vocabulary.
       */
      reconnectIntro:
        "Prijava ovog računara na nalog više ne važi — to se dešava kada se drugi uređaj poveže na nalog ili kada se odjaviš sa svih uređaja. Ključ je i dalje ovde; treba samo nova prijava.",
      reconnectPasswordHint:
        "Lozinka ostaje na ovom računaru. Šalje se vrednost izvedena iz nje, nikada sama lozinka.",
      reconnectSubmit: "Poveži",
      reconnectError: "Povezivanje nije uspelo. Pokušaj ponovo.",
      reconnectErrors: {
        invalid_credentials: "Pogrešna lozinka.",
        email_not_confirmed: "Potvrdi imejl adresu u veb aplikaciji, pa pokušaj ponovo.",
        invalid_code: "Kod za potvrdu nije prihvaćen. Sačekaj sledeći kod i pokušaj ponovo.",
        mfa_not_enrolled: "Nalog nema potvrdu u dva koraka. Uključi je u veb aplikaciji, pa se vrati ovde.",
        session_expired: "Prijava je istekla. Pokušaj ponovo.",
        rate_limited: "Previše pokušaja. Sačekaj nekoliko minuta.",
        unavailable: "Server trenutno ne odgovara. Pokušaj kasnije.",
        unknown: "Nešto nije prošlo. Pokušaj ponovo.",
        unauthenticated: "Prijava nije prošla. Pokušaj ponovo.",
        session_not_live: "Prijava više ne važi. Pokušaj ponovo.",
        session_not_aal1: "Prijava nije prošla kako treba. Pokušaj ponovo.",
        not_enabled: "Ovaj nalog još nema ključ. Uključi sinhronizaciju.",
        // The two that are NOT „try again", and whose sentences must say so:
        // this machine no longer holds the account's key, and no number of
        // attempts changes that.
        proof_rejected:
          "Ovaj računar nema ključ ovog naloga. Upari ga sa uređajem koji ključ ima ili upotrebi kod za oporavak.",
        master_key_unreadable:
          "Ključ sačuvan na ovom računaru ne može da se otvori. Upari računar sa uređajem koji ključ ima ili upotrebi kod za oporavak.",
        too_many_devices:
          "Nalog već ima najviše dozvoljenih računara. Odjavi jedan u veb aplikaciji, pa pokušaj ponovo.",
        account_mismatch: "Prijava ne pripada nalogu sačuvanom na ovom računaru.",
        register_failed: "Server nije uspeo da poveže ovaj računar. Pokušaj kasnije.",
        rejected_by_schema: "Server je odbio podatke. Prijavi grešku.",
        cloud_off: "Mrežni pristup je isključen za ovo pokretanje.",
        locked: "Otključaj Nexus, pa pokušaj ponovo.",
        not_enabled_here: "Sinhronizacija nije uključena na ovom računaru.",
        bad_request: "Podaci nisu ispravni. Proveri ime računara.",
      } satisfies Record<SyncReconnectProblem, string>,
      /**
       * The account has a key this computer did not mint. Not an error — a fork
       * in the road, and since the adoption screen exists the sentence names the
       * road rather than describing it: „upotrebi kod za oporavak" was true and
       * pointed at nothing the user could press.
       */
      alreadyMinted:
        "Ovaj nalog već ima ključ, a ovaj računar ga nema. Poveži ovaj računar kodom za oporavak sa naloga.",
      /**
       * Joining an account that already has a key — the answer to
       * {@link alreadyMinted}, and the second option on the enable card.
       *
       * The copy has one job the rest of this card does not: to make it clear
       * WHICH code is wanted. „Kod za oporavak" and „kod iz aplikacije za
       * potvrdu" are both six-to-thirty characters of code typed into the same
       * form, and a user who confuses them spends a step-up and a revoked
       * session to find out. So the label names where the code came from, not
       * what it is.
       */
      adoptChoiceTitle: "Ovaj računar se pridružuje nalogu koji već postoji",
      adoptChoiceHint:
        "Izaberi ovo ako je sinhronizacija već uključena na nekom tvom uređaju. Treba ti kod za oporavak koji je tada prepisan.",
      adoptTitle: "Poveži ovaj računar sa postojećim nalogom",
      adoptIntro:
        "Upiši podatke naloga i kod za oporavak prepisan pri prvom uključivanju sinhronizacije. Ovaj računar time dobija ključ naloga i njegovi podaci se spajaju sa ostalim uređajima.",
      recoveryCodeLabel: "Kod za oporavak sa naloga",
      recoveryCodeHint:
        "Onaj prepisan kada je sinhronizacija uključena na prvom uređaju — ne kod iz aplikacije za potvrdu. Ni on ne napušta ovaj računar.",
      adoptChoiceAction: "Poveži postojeći nalog",
      adoptBackAction: "Ipak uključi sinhronizaciju iznova",
      adoptSubmit: "Poveži ovaj računar",
      adoptWorking: "Povezujem…",
      adoptError: "Povezivanje sa nalogom nije uspelo. Pokušaj ponovo.",
      /**
       * Typed against the protocol's own union, like the two tables above it, so
       * a refusal the flow can produce and this table does not name is a compile
       * error rather than an empty box in front of a user.
       *
       * Two sentences here carry the whole design of this screen. `not_minted`
       * must NOT blame the code — the account simply never had a key, and
       * retyping is the one thing that cannot help, so it sends the user at
       * „uključi sinhronizaciju" instead. And `recovery_code_rejected` must not
       * suggest anything else is wrong, because nothing else is.
       */
      adoptErrors: {
        invalid_credentials: "Pogrešan imejl ili lozinka.",
        email_not_confirmed: "Potvrdi imejl adresu u veb aplikaciji, pa pokušaj ponovo.",
        invalid_code: "Kod za potvrdu nije prihvaćen. Sačekaj sledeći kod i pokušaj ponovo.",
        mfa_not_enrolled: "Nalog nema potvrdu u dva koraka. Uključi je u veb aplikaciji, pa se vrati ovde.",
        mfa_ambiguous: "Nalog ima više načina potvrde. Ostavi jedan u veb aplikaciji, pa pokušaj ponovo.",
        session_expired: "Prijava je istekla. Pokušaj ponovo.",
        rate_limited: "Previše pokušaja. Sačekaj nekoliko minuta.",
        unavailable: "Server trenutno ne odgovara. Pokušaj kasnije.",
        unknown: "Nešto nije prošlo. Pokušaj ponovo.",
        step_up_failed: "Potvrda u dva koraka nije prošla do kraja. Pokušaj ponovo.",
        unauthenticated: "Prijava nije prošla. Pokušaj ponovo.",
        session_not_live: "Prijava više ne važi. Pokušaj ponovo.",
        session_not_aal1: "Prijava nije prošla kako treba. Pokušaj ponovo.",
        not_enabled: "Ovaj nalog još nema ključ. Uključi sinhronizaciju umesto povezivanja.",
        // The account never minted. Retyping the code is the one thing that
        // cannot help, so the sentence must not send the user at the code.
        not_minted:
          "Na ovom nalogu sinhronizacija nikada nije uključena, pa nema ključa za preuzimanje. Uključi sinhronizaciju na ovom računaru.",
        // And this one must not suggest anything else is wrong, because nothing
        // else is: the account, the password and the second factor all passed.
        recovery_code_rejected:
          "Kod za oporavak nije prihvaćen. Prepiši ga tačno onako kako je zapisan i pokušaj ponovo.",
        bootstrap_failed: "Server nije dozvolio ovom računaru pristup nalogu. Pokušaj kasnije.",
        proof_rejected: "Ključ dobijen kodom za oporavak nije prihvaćen. Prijavi grešku.",
        too_many_devices:
          "Nalog već ima najviše dozvoljenih računara. Odjavi jedan u veb aplikaciji, pa pokušaj ponovo.",
        register_failed: "Server nije uspeo da poveže ovaj računar. Pokušaj kasnije.",
        rejected_by_schema: "Server je odbio podatke. Prijavi grešku.",
        cloud_off: "Mrežni pristup je isključen za ovo pokretanje.",
        locked: "Otključaj Nexus, pa pokušaj ponovo.",
        already_enabled: "Sinhronizacija je već uključena na ovom računaru.",
        bad_request: "Podaci nisu ispravni. Proveri ime računara.",
      } satisfies Record<SyncAdoptProblem, string>,
      disconnectTitle: "Odjavi ovaj računar",
      disconnectWarning:
        "Uređaj se povlači sa naloga i ovaj računar zaboravlja svoju kopiju ključa. Podaci ostaju ovde i otvaraju se pristupnim kodom kao i do sada; povratak na nalog ide preko uparivanja sa drugim uređajem ili preko koda za oporavak.",
      disconnect: "Odjavi ovaj računar",
      disconnectConfirm: "Odjavi",
      disconnectCancel: "Otkaži",
      errors: {
        invalid_credentials: "Pogrešan imejl ili lozinka.",
        email_not_confirmed: "Potvrdi imejl adresu u veb aplikaciji, pa pokušaj ponovo.",
        invalid_code: "Kod za potvrdu nije prihvaćen. Sačekaj sledeći kod i pokušaj ponovo.",
        mfa_not_enrolled: "Nalog nema potvrdu u dva koraka. Uključi je u veb aplikaciji, pa se vrati ovde.",
        mfa_ambiguous: "Nalog ima više načina potvrde. Ostavi jedan u veb aplikaciji, pa pokušaj ponovo.",
        session_expired: "Prijava je istekla. Pokušaj ponovo.",
        rate_limited: "Previše pokušaja. Sačekaj nekoliko minuta.",
        unavailable: "Server trenutno ne odgovara. Pokušaj kasnije.",
        unknown: "Nešto nije prošlo. Pokušaj ponovo.",
        step_up_failed: "Potvrda u dva koraka nije prošla do kraja. Pokušaj ponovo.",
        unauthenticated: "Prijava nije prošla. Pokušaj ponovo.",
        session_not_live: "Prijava više ne važi. Pokušaj ponovo.",
        second_factor_required: "Nalogu je potrebna potvrda u dva koraka.",
        factor_must_predate_session: "Potvrda u dva koraka nije prošla do kraja. Pokušaj ponovo.",
        sessions_from_different_accounts: "Prijave ne pripadaju istom nalogu. Pokušaj ponovo.",
        sessions_must_differ: "Prijava nije prošla kako treba. Pokušaj ponovo.",
        rejected_by_schema: "Server je odbio podatke. Prijavi grešku.",
        mint_failed: "Server nije uspeo da napravi ključ naloga. Pokušaj kasnije.",
        round_trip_mismatch:
          "Server nije sačuvao ono što je ovaj računar poslao, pa sinhronizacija nije uključena. Pokušaj ponovo; ako se ponovi, prijavi grešku.",
        cloud_off: "Mrežni pristup je isključen za ovo pokretanje.",
        locked: "Otključaj Nexus, pa pokušaj ponovo.",
        already_enabled: "Sinhronizacija je već uključena na ovom računaru.",
        bad_request: "Podaci nisu ispravni. Proveri ime računara.",
      } satisfies Record<SyncEnableProblem, string>,
      error: "Uključivanje sinhronizacije nije uspelo. Pokušaj ponovo.",
      disconnectError: "Odjava nije uspela. Pokušaj ponovo.",
      /**
       * What sync is doing right now.
       *
       * One headline sentence, never two: `problems` carries the reason when
       * there is one, and `synced`/`running`/`idle` cover the case where there
       * is none. Same discipline as `errors` — the table is `satisfies
       * Record<SyncProblem, string>`, so a reason the core adds and nobody names
       * here breaks the build rather than reaching the user as an empty row.
       */
      activity: {
        title: "Stanje sinhronizacije",
        running: "Sinhronizacija je u toku…",
        synced: "Sve je usklađeno.",
        idle: "Čeka se prva sinhronizacija.",
        nextAt: "Sledeća provera u {time}.",
        lastAt: "Poslednja provera u {time}.",
        applied: "Preuzeto",
        pushed: "Poslato",
        owed: "Na čekanju",
        quarantined: "Nečitljivo",
        now: "Sinhronizuj sada",
        working: "Radi…",
        problems: {
          cloud_off: "Mrežni pristup je isključen za ovo pokretanje.",
          not_enabled: "Sinhronizacija nije uključena na ovom računaru.",
          locked: "Nexus je zaključan, pa nema ključa za sinhronizaciju.",
          signed_out: "Prijava više ne važi. Prijavi se ponovo niže na ovoj kartici.",
          offline: "Server nije dostupan. Pokušaj se ponavlja sam.",
          forbidden:
            "Prijava je istekla ili je ovaj računar povučen sa naloga. Prijavi se ponovo niže na ovoj kartici.",
          malformed: "Server je poslao podatke koje ova verzija ne razume.",
          key_unavailable:
            "Ovaj računar nema ključ za ovaj profil. Upari ga sa uređajem koji ga ima ili upotrebi kod za oporavak.",
          contested: "Ključ je upisan, pa pročitan kao prazan. Pokušaj ponovo.",
          nonce_reuse:
            "Bezbednosna provera je zaustavila sinhronizaciju za ovaj profil. Ključ mora da se zameni pre nastavka.",
        } satisfies Record<SyncProblem, string>,
      },
    },
    /**
     * „Podaci i privatnost“ (SET-010, local half): six plain sentences, each
     * one a fact about how this build is put together rather than a promise.
     * Five of them are drawn while sync is ON HOLD — `sync` below stays in the
     * table but `SettingsPage` does not print it (`shared/syncHold.ts`) — so
     * what a user reads is the five that are still true of this build.
     *
     * The sentences have deliberately nothing to operate — no toggle, no
     * link, no „saznaj više“. A privacy panel with a switch on it is a panel
     * about a setting; those are about what is already true, and every
     * sentence is checkable in the source:
     *
     *  - `storage`   — `packages/db/src/database.ts` opens every profile
     *                  database through SQLCipher (`PRAGMA cipher`/`key`), and
     *                  `main/auth.ts` unwraps that key from the passcode
     *                  (Argon2id → AES-GCM, ADR-018).
     *  - `noTelemetry` — there is no telemetry or analytics dependency, and no
     *                  such code, anywhere in the tree.
     *  - `offline`   — the only socket in the tree is `net.fetch` in
     *                  `main/sync/electronFetch.ts`, which `check:egress` pins
     *                  to that one file, and it is unreachable unless the cloud
     *                  switch is on: `createCloudPorts` returns `null`
     *                  otherwise. The packaged renderer's CSP is `default-src
     *                  'self'; connect-src 'self'`, unchanged.
     *  - `sync`      — the other half of the same fact, because a card that
     *                  lists what leaves the device has to name what leaves it
     *                  once the user turns sync on: ciphertext, plus the row
     *                  metadata migration 003 keeps in the clear. NOT DRAWN
     *                  while the work is on hold; the leaf is kept for the day
     *                  it is turned back on.
     *  - `exports`   — `main/imex.ts` writes to a path chosen in the system
     *                  save dialog, sealed under a passphrase-derived key when
     *                  one is given (ADR-022).
     *  - `deletion`  — `main/accounts.ts`'s `deleteAccount` erases the
     *                  account's directory, key chain included; there is no
     *                  undo and no grace period.
     *
     * The ONE thing to operate is `searchHistory` (SRCH-009), and it belongs
     * here rather than anywhere else: it is the only place in the app where
     * something is stored *about how you used it* instead of *what you made*,
     * so the card that lists what is stored is where a user goes to erase it.
     * Search is a SHELL surface, not a module (no manifest, no gallery row, no
     * flag), so its control is hand-composed on this page — never routed
     * through the per-module settings contract, which is for modules and says
     * so in as many words.
     */
    privacy: {
      storage:
        "Svi tvoji podaci — beleške, zadaci, događaji, kartice i prilozi — stoje na ovom uređaju, u bazi koja je šifrovana. Ključ se otključava tvojim pristupnim kodom i nigde se ne šalje.",
      noTelemetry:
        "Nexus ne prikuplja telemetriju ni analitiku. Nema brojača, nema izveštaja o korišćenju, nema profilisanja.",
      /**
       * The local half of the network story, stated with its condition
       * attached. „Offline" here means the mode this device is in: while it is
       * on, Nexus opens no connection, not even a version check. The mode is
       * the first card of this category (ADR-089), which is where the last
       * sentence sends the reader, and it is the only place the answer changes.
       */
      offline:
        "Dok je mrežni pristup isključen, Nexus ne otvara nijednu vezu ka internetu — ni provere verzije. Režim menjaš u kartici „Mreža i ažuriranja“.",
      sync: "Ako uključiš sinhronizaciju, na server odlazi šifrovan sadržaj — uz podatak koji ga je uređaj poslao i kada. Ključ ostaje na tvojim uređajima; server ga nema i ne može da pročita ono što čuva.",
      exports:
        "Izvoz je običan fajl: ti biraš gde se čuva, a arhivu možeš zaštititi lozinkom pri pravljenju.",
      deletion:
        "Brisanje naloga trajno uništava njegove podatke, zajedno sa ključem kojim su šifrovani. Nema opoziva i nema perioda čekanja.",
      /**
       * SRCH-009. The caption states the three facts a user would otherwise
       * have to trust: what is kept, where it stays, and that it never rides
       * in an izvoz — each one true of migration 050 by construction, not by
       * a filter somebody remembered to write.
       */
      searchHistory: {
        title: "Istorija pretrage",
        caption:
          "Nexus pamti poslednjih 20 pretraga ovog profila, da bi mogao brzo da ih ponoviš. Ostaju u šifrovanoj bazi na ovom uređaju, ne prelaze u drugi profil i ne ulaze u izvoz ni u rezervnu kopiju.",
        clear: "Obriši istoriju pretrage",
        /** Below the button: how many entries are there right now, or that there are none. */
        empty: "Nema sačuvanih pretraga.",
        countOne: "sačuvana pretraga",
        countFew: "sačuvane pretrage",
        countMany: "sačuvanih pretraga",
        error: "Brisanje istorije pretrage nije uspelo. Pokušaj ponovo.",
      },
    },
    /**
     * ADR-091 — „Paketi sadržaja". A content pack is a signed folder of public
     * content (offline Wikipedia, a map, a dataset) installed from a disk or a
     * USB stick and kept beside the encrypted database rather than inside it.
     *
     * The card has to say three things a user cannot see: what a pack IS, that
     * it is accepted only when Nexus's own key signed it, and that the licence
     * and the attribution travel with the content because the licence requires
     * it. `problem` is one sentence per `PackRefusalCode`, in the same shape as
     * `network.problem` — the codes are main's, and the words are this table's.
     */
    contentPacks: {
      intro:
        "Paket je fascikla javnog sadržaja — na primer cela Vikipedija za čitanje bez interneta, mapa ili skup podataka — koju Nexus prihvata samo ako je potpisana ključem Nexusa. Sadržaj ostaje na ovom uređaju, u fascikli pored šifrovane baze, i ne ulazi u rezervnu kopiju profila.",
      emptyTitle: "Nema instaliranih paketa.",
      emptyBody:
        "Paket donosiš kao fasciklu na disku ili na USB-u: u njoj su pack.json, njegov potpis i sam sadržaj. Ovde vidiš šta je instalirano, možeš da proveriš sadržaj i da ukloniš paket.",
      install: "Instaliraj iz fascikle…",
      installHint:
        "Nexus prvo proverava potpis i svaki heš, pa tek onda kopira. Ništa se ne šalje na internet i ništa iz profila se ne dira.",
      verify: "Proveri",
      verifying: "Provera…",
      remove: "Ukloni",
      candidateTitle: "Instalirati ovaj paket?",
      candidateQuestion: "U fascikli je „{title}“, verzija {version}, veličine {size}.",
      candidateHint:
        "Potpis je već proveren. Instaliranje kopira sadržaj u fasciklu paketa na ovom uređaju i dodaje ga na listu.",
      installConfirm: "Instaliraj",
      removeTitle: "Ukloniti paket?",
      removeQuestion: "Sadržaj paketa se briše sa ovog uređaja. Podaci profila se ne diraju.",
      removeConfirm: "Ukloni",
      cancel: "Otkaži",
      versionLabel: "Verzija",
      sizeLabel: "Veličina",
      filesLabel: "Datoteke",
      licenceLabel: "Licenca",
      attributionLabel: "Atribucija",
      sourceLabel: "Izvor",
      verifyOk: "Sadržaj je proveren i odgovara potpisanom manifestu.",
      progressCopy: "Kopiranje: {file}",
      progressVerify: "Provera: {file}",
      progressCount: "{done} od {total}",
      problemTitle: "Paket nije prihvaćen.",
      problem: {
        "not-a-pack": "U izabranoj fascikli nema čitljivog pack.json.",
        "not-a-directory": "Paket je fascikla; izaberi fasciklu u kojoj je pack.json.",
        "manifest-unreadable": "pack.json se ne može pročitati.",
        "manifest-too-large": "pack.json je veći nego što manifest sme da bude.",
        signature: "Potpis na pack.json nije važeći, pa paket nije instaliran.",
        "format-unknown": "Format ovog paketa je noviji od ove verzije Nexusa.",
        "id-invalid": "Oznaka paketa nije ispravna.",
        "version-invalid": "Verzija paketa nije ispravna.",
        "kind-unknown": "Vrsta sadržaja ovog paketa nije poznata.",
        "title-invalid": "Naziv paketa nije ispravan.",
        "description-invalid": "Opis paketa nije ispravan.",
        "files-invalid": "Spisak datoteka u manifestu nije ispravan.",
        "path-invalid": "Manifest navodi putanju koju Nexus ne prihvata.",
        "path-duplicate": "Manifest dva puta navodi istu datoteku.",
        "path-duplicate-case": "Manifest navodi dve datoteke koje su na Windowsu jedna.",
        "hash-invalid": "Heš u manifestu nije ispravan.",
        "size-invalid": "Veličina u manifestu nije ispravna.",
        limit: "Paket je veći, ili navodi više datoteka, nego što je dozvoljeno.",
        "licence-invalid": "Podaci o licenci u manifestu nisu ispravni.",
        "source-invalid": "Podaci o izvoru u manifestu nisu ispravni.",
        "min-app-version-invalid": "Najniža verzija aplikacije u manifestu nije ispravna.",
        "min-app-version-too-new": "Ovaj paket traži noviju verziju Nexusa.",
        "older-than-installed": "Novija verzija ovog paketa je već instalirana.",
        symlink: "Paket sadrži simbolički link, što nije dozvoljeno.",
        "not-a-file": "U paketu je nešto što nije ni datoteka ni fascikla.",
        "missing-file": "Datoteka koju manifest navodi ne postoji u paketu.",
        "extra-file": "U paketu je datoteka koju manifest ne navodi.",
        "size-mismatch": "Veličina datoteke se ne poklapa sa manifestom.",
        "hash-mismatch": "Sadržaj datoteke se ne poklapa sa hešom u manifestu.",
        "no-space": "Na disku nema dovoljno mesta za ovaj paket.",
        "no-candidate": "Nijedan paket nije izabran.",
        "not-found": "Ovaj paket nije instaliran.",
        io: "Paket se ne može pročitati ili upisati.",
        "notice-invalid": "Oznaka bezbednosne napomene u manifestu nije ispravna.",
        "catalogue-unreadable": "Katalog paketa se ne može pročitati.",
        "catalogue-signature": "Potpis kataloga nije važeći, pa katalog nije prihvaćen.",
        "catalogue-host": "Katalog upućuje na adresu sa koje Nexus ne sme da preuzima.",
        "catalogue-entry": "Unos u katalogu nije ispravan, ili ovaj paket nije u katalogu.",
        "downloads-off": "Preuzimanje je isključeno. Uključi „Preuzimanja“ u privatnosti.",
        "download-failed": "Preuzimanje nije uspelo. Pokušaj ponovo.",
        busy: "Drugo preuzimanje je već u toku, ili je ovo već pokrenuto.",
        "tool-invalid": "Podaci o programu koji paket nosi nisu ispravni.",
      } satisfies Record<PackRefusalCode, string>,
      /** ADR-103: the catalogue the card draws and the download it can start. */
      catalogueTitle: "Katalog paketa",
      catalogueHint:
        "Katalog je spisak paketa koji mogu da se preuzmu; potpisuje ga isti ključ kojim su potpisani i sami paketi, pa se prikazuje samo ono što je Nexus zaista objavio. Detalji pokazuju licencu, atribuciju i izvor pre nego što se bilo šta preuzme.",
      catalogueRefresh: "Osveži katalog",
      catalogueEmpty: "U katalogu trenutno nema paketa.",
      catalogueModeOff:
        "Preuzimanje je isključeno. Uključi „Preuzimanja“ u privatnosti da bi preuzimao pakete.",
      catalogueDetails: "Detalji",
      download: "Preuzmi",
      downloadPause: "Pauza",
      downloadResume: "Nastavi",
      downloadCancel: "Otkaži",
      downloadHint:
        "Preuzimanje ide preko usluge za preuzimanje, datoteku po datoteku, i svaki heš se proverava dok se piše. Ako se veza prekine, možeš da pauziraš i nastaviš; ako server ne ume da nastavi preuzimanje, ta datoteka ide ispočetka.",
      downloadProgressDownload: "Preuzimanje: {file}",
      downloadProgressInstall: "Instaliranje: {file}",
      stateNotInstalled: "Nije instaliran",
      stateInstalled: "Instaliran",
      stateUpdate: "Dostupno ažuriranje",
      installedVersionLabel: "Instalirana verzija",
      error: "Radnja nije uspela. Pokušaj ponovo.",
    },
    about: {
      version: "Verzija",
      electron: "Electron",
      chromium: "Chromium",
      node: "Node",
      dataLocation: "Lokacija podataka",
      /** ADR-103: every installed pack's licence, attribution and source, on the About card. */
      packLicences: "Licence paketa",
      packLicencesHint:
        "Svaki instalirani paket nosi svoju licencu, svoju atribuciju i svoj izvor. Veza se otvara u tvom pregledaču, nikada u Nexusovoj mreži.",
      packLicencesEmpty: "Nema instaliranih paketa.",
    },
    /**
     * „Licence": the notices this product owes for other people's code.
     *
     * The copy states what the card IS and never thanks anybody: MIT, BSD,
     * Apache-2.0 and the OFL each require the notice to travel with the
     * distribution, so this is an obligation being discharged, not a courtesy.
     * Every sentence is true of `data/licences.json` by construction — the
     * generator reads each notice off disk and `licences.test.ts` refuses a file
     * where an entry claims a text it does not carry.
     *
     * The three status lines are the honest half. A user who opens a package
     * with no licence text must be told that is what happened, in the same
     * place they went looking for the text — an empty panel would read as a
     * bug, and a silently substituted notice would be a lie.
     */
    licences: {
      caption:
        "Nexus je napravljen i na tuđem radu — na bibliotekama otvorenog koda i na fontovima. Njihove licence traže jedno: da obaveštenje o autorstvu putuje zajedno sa programom. Ovde je, doslovno i u celini.",
      packagesTitle: "Biblioteke",
      fontsTitle: "Fontovi",
      /**
       * The one thing about the fonts a user could not check for themselves:
       * they are files in the installer, not a web request that happens to be
       * cached. „Offline" is the promise the whole app makes, so the card that
       * lists the fonts is where it gets stated about them.
       */
      fontsCaption:
        "Fontovi za crtanje isporučuju se u samoj aplikaciji i učitavaju se sa diska — nijedan se ne preuzima sa mreže.",
      /** Per-row hint on the button that opens one entry's notice; `aria-expanded` carries the state itself. */
      expand: "Prikaži tekst licence",
      collapse: "Sakrij tekst licence",
      /** Names the scrollable notice block for a screen reader — a scroll region has to be reachable and named. */
      noticeLabel: "Tekst licence",
      /** Above the notice: the file every character of it was read from. */
      source: "Pročitano iz",
      /** Shown instead of a licence id when nothing established one. */
      unknownLicence: "nije utvrđeno",
      /** In place of the notice, when the package names a licence but ships no copy of it. */
      declaredOnly:
        "Paket navodi ovu licencu u svom manifestu, ali uz sebe ne isporučuje njen tekst. Ovde stoji ono što se moglo pročitati — tekst se ne izmišlja.",
      /** In place of a licence id, when nothing on disk establishes one. */
      notEstablished:
        "Licenca nije utvrđena ni iz jednog fajla koji se isporučuje. Ispod je sve što sam fajl o sebi navodi.",
      /**
       * The notices are ~650 KB of text and arrive as their own chunk when this
       * card first mounts (see `LicencesSection`), so there is a moment — short,
       * but real — with nothing to show. Said rather than left blank, because a
       * card that renders its title and then nothing reads as broken.
       */
      loading: "Učitavanje licenci…",
      loadError: "Licence nisu učitane. Zatvori i ponovo otvori Podešavanja.",
      /**
       * Electron is listed like any other dependency, but what it CARRIES is
       * not: Chromium and Node.js are inside the runtime, and their own notices
       * ship as a separate file beside the executable rather than in this list.
       * Said once, under the library group, because a user who wonders where
       * Chromium is would otherwise conclude it was forgotten.
       */
      chromium:
        "Electron u sebi nosi Chromium i Node.js. Njihova puna obaveštenja o licencama isporučuju se uz aplikaciju, u fajlu LICENSES.chromium.html pored izvršnog fajla.",
    },
  },

  /** Global search palette (021-d / ADR-021): nav label, the input
   *  placeholder, kind labels (singular for a result row's own kind
   *  tag; plural for both the filter chips and the per-kind group headings),
   *  the two non-kind group headings, the key-hint footer, the empty-result
   *  line, and the local command labels `searchCommands.ts` matches against.
   *  The sidebar's shortcut badge is deliberately NOT copy: it renders the
   *  live palette binding through `formatChord` (ADR-040), so a remap is
   *  reflected there instead of a printed "Ctrl+K" going quietly stale. */
  search: {
    navLabel: "Pretraga",
    placeholder: "Pretraži zadatke, beleške, događaje…",
    kindFilterLabel: "Filter po vrsti",
    recentGroup: "Nedavno",
    commandsGroup: "Komande",
    /**
     * The command group over an EMPTY box, which is a short curated offer
     * rather than the whole registry — „Idi na…" duplicates the sidebar and the
     * index repair is a tool, so neither is what somebody opens the palette
     * for with nothing in mind. „Komande" is kept for the typed and the „>"
     * lists, which really are all of them.
     */
    quickActionsGroup: "Brze radnje",
    emptyResults: "Nema rezultata.",
    /** Shown instead of `emptyResults` when the fetch itself rejected — a failure is not an empty result and must not read as one. */
    searchError: "Pretraga trenutno ne radi. Pokušaj ponovo.",
    hint: "↑↓ kretanje · Enter otvori · Esc zatvori",
    /**
     * SRCH-009: the profile's remembered QUERIES, which are a different list
     * from „Nedavno" above — that one shows what you opened, this one what you
     * looked for. The heading says „pretrage" precisely so the two groups can
     * never be read as one.
     */
    historyGroup: "Nedavne pretrage",
    /** The „×" on a history row — a label, since the glyph alone says nothing to a screen reader. */
    historyRemove: "Ukloni iz istorije",
    /**
     * Replaces the key hints while a history row is the active one: Enter
     * FILLS the box here instead of opening something (the query must be
     * visible before it runs — no surface may silently execute a search the
     * user cannot see), and Delete forgets the row.
     */
    historyHint: "↑↓ kretanje · Enter popuni · Delete ukloni · Esc zatvori",
    /**
     * The operator grammar, named quietly in the footer beside the key hints —
     * `#oznaka` filters by tag (zadaci i beleške), `rok:`/`due:` by date. The
     * values are the closed set `parseSearchQuery` accepts, written out rather
     * than abbreviated so the line teaches the whole grammar at a glance.
     */
    operatorHint: "#oznaka · rok:danas / sutra / nedelja / 2026-08-15",
    /** The palette's bottom row, which hands the current query to the full page (ADR-039 §5). */
    showAllResults: "Prikaži sve rezultate",
    /**
     * Marks a result whose match landed inside an attached file's CONTENTS
     * rather than in anything the row shows (SRCH-008). Without it the row
     * would appear to match nothing at all — the one thing a result must never
     * do. Deliberately says „u sadržaju priloga", not „u prilogu": the file's
     * NAME is already searchable and already highlights, so what this reports
     * is specifically the text inside it.
     */
    fromAttachment: "poklapanje u sadržaju priloga",
    kindSingular: {
      task: "Zadatak",
      event: "Događaj",
      note: "Beleška",
      document: "Dokument",
      subject: "Predmet",
      exam: "Ispit",
      deck: "Špil",
      card: "Kartica",
      attachment: "Prilog",
      circuit: "Kolo",
    },
    kindPlural: {
      task: "Zadaci",
      event: "Događaji",
      note: "Beleške",
      document: "Dokumenti",
      subject: "Predmeti",
      exam: "Ispiti",
      deck: "Špilovi",
      card: "Kartice",
      attachment: "Prilozi",
      circuit: "Kola",
    },
    /** `searchCommands.ts`'s fixed command list; "Promeni temu" itself reuses `strings.app.themeToggle` rather than duplicating it here. */
    commands: {
      goToPrefix: "Idi na: ",
      // PRD 08 SRCH-003: one quick-create command per creatable entity,
      // between the "Idi na" group and the theme toggle.
      newTask: "Novi zadatak",
      newEvent: "Novi događaj",
      newNote: "Nova beleška",
      newTransaction: "Nova transakcija",
      /**
       * ADR-049: one command per task view, between the quick-creates and the
       * shell actions. Prefixed with the module rather than „Idi na“, because
       * it lands on a VIEW inside Zadaci, not on the module's front door.
       */
      smartListPrefix: "Zadaci: ",
      lock: "Zaključaj aplikaciju",
      rebuildIndex: "Ponovo izgradi indeks pretrage",
      rebuildDonePrefix: "Indeks je ponovo izgrađen:",
      rebuildRecordsUnitOne: "zapis",
      rebuildRecordsUnitMany: "zapisa",
      rebuildError: "Ponovno izgrađivanje indeksa nije uspelo.",
    },
    /**
     * The full search page (ADR-039): its header and the two facet rows. The
     * page reuses the palette's `placeholder`, `kindSingular`/`kindPlural`
     * and `emptyResults` above rather than restating them — the two surfaces
     * mean the same things and must read the same way.
     */
    page: {
      title: "Pretraga",
      /** Follows the LIVE palette chord the page renders before it (ADR-040) — never a printed "Ctrl+K". */
      shortcutHint: "otvara brzu pretragu",
      /** Names the query grammar, the way the palette's footer does — including `rok:`, which the page inherits from ADR-030 unchanged. */
      grammarHint: "z: b: d: filtriraju po vrsti · #oznaka · rok:danas / sutra / nedelja / 2026-08-15",
      allKinds: "Sve",
      tagFilterLabel: "Filter po oznaci",
      browseHeading: "Nedavno",
      /** Tooltip on the date column when it falls back to the entry's last edit. */
      updatedLabel: "Poslednja izmena",
      resultsUnitOne: "rezultat",
      resultsUnitMany: "rezultata",
      /** Shown instead of an exact count once candidate sourcing hit its bound. */
      truncatedNote: "Prikazano je prvih 500 rezultata — suzite pretragu za precizniji spisak.",
      showMore: "Prikaži još",
      emptyTitle: "Nema rezultata",
      emptyDescription: "Probajte drugu reč ili uklonite neki filter.",
    },
  },

  /**
   * „Pregledaj" — the in-app attachment preview dialog (DOC / ADR-064), one
   * component shared by the three attachment surfaces: an image lightbox, an
   * escaped text pane, or a read-only markdown render. The menu item's word
   * lives with each surface's own strings; the PDF window needs no copy at all
   * (its title is the stored file name and its chrome is Chromium's own).
   */
  attachmentPreview: {
    close: "Zatvori",
    error: "Pregled priloga nije uspeo. Pokušaj ponovo.",
  },

  /**
   * Keyboard shortcuts (ADR-040 / SET-013): the Settings card that remaps the
   * core set, and the reference overlay that documents every key in the app.
   *
   * `actions` names the five remappable actions. „Zaključaj aplikaciju"
   * deliberately reads the same as the palette command above: they are the same
   * action reached two ways, and one of them saying something else would be a
   * lie about what the chord does.
   *
   * `reference` is documentation, so the rule is simple: a context that adds a
   * key adds a row here, or the reference is wrong. Descriptions name what the
   * key does, never where the key lives — the group heading already says that.
   */
  shortcuts: {
    cardCaption:
      "Prečice se pamte na ovom uređaju — ne putuju uz profil ni uz rezervnu kopiju.",
    showAll: "Prikaži sve prečice",
    change: "Promeni",
    reset: "Vrati",
    resetAll: "Vrati sve",
    capturePrompt: "Pritisni novu kombinaciju…",
    captureHint: "Esc otkazuje.",
    /** Refusal shown when the captured combination is something typing could produce. */
    refuseUnbindable: "Kombinacija mora da drži Ctrl ili Alt, ili da bude taster F1–F12.",
    /** Refusal for the GLOBAL row only: the OS binds a physical key, so punctuation and layout-specific characters cannot be registered. */
    refuseGlobal:
      "Globalna prečica mora da drži Ctrl ili Alt i da koristi slovo, cifru ili taster F1–F12.",
    /** Prefixes the name of whatever already holds the captured combination. */
    takenPrefix: "Zauzeto: ",
    /** Caption under the global row — what „globalna" actually means. */
    globalHint: "Radi i kada Nexus nije u prvom planu.",
    /** The one runtime failure a global registration has: another application already holds the combination. */
    globalTaken: "Prečica je zauzeta na nivou sistema.",
    actions: {
      palette: "Komandna paleta",
      /** Says „ili u Zadacima" because that is now literally what it does — see `createInModule`'s default arm. The old copy promised the active module and delivered nothing on ten of fourteen. */
      quickCreate: "Novi unos u aktivnom modulu (ili u Zadacima)",
      globalCapture: "Brzi unos zadatka — globalna prečica",
      lock: "Zaključaj aplikaciju",
      privLock: "Zaključaj privatne beleške",
      settings: "Otvori Podešavanja",
      shortcutsHelp: "Prikaži prečice",
    },
    dialogTitle: "Prečice na tastaturi",
    dialogClose: "Zatvori",
    groups: {
      global: "Globalno",
      modules: "Moduli",
      palette: "Paleta",
      tasks: "Zadaci",
      calendar: "Kalendar",
      study: "Učenje",
      notes: "Beleške",
      notesFind: "Pretraga u belešci",
    },
    /** The reserved Ctrl+1…Ctrl+9 family: positional, so it is described rather than named. */
    moduleNavLabel: "Prelazak na modul po redosledu",
    moduleNavCaption: "Redosled je isti kao u bočnoj traci; važi za prvih devet modula.",
    captions: {
      calendar: "Dok je mreža kalendara u fokusu.",
      study: "Tokom učenja kartica.",
      notes: "Na početku reda u editoru beleški.",
      /** The find bar's keys work anywhere in the note, unlike the markdown shortcuts above them — hence a group of its own. */
      notesFind: "Dok je otvorena beleška; pretražuje samo nju.",
    },
    reference: {
      paletteMove: "Kretanje kroz rezultate",
      paletteOpen: "Otvori rezultat ili pokreni komandu",
      paletteClose: "Zatvori paletu",
      tasksSubtask: "Dodaj podzadatak iz reda za unos",
      tasksCancel: "Otkaži unos u redu ili zatvori pitanje",
      tasksExitSelection: "Izađi iz režima Izbor",
      calendarShift: "Prethodni ili sledeći period",
      calendarToday: "Vrati se na danas",
      studyReveal: "Prikaži odgovor",
      studyGrade: "Oceni karticu — Ponovo, Teško, Dobro, Lako",
      studyUndo: "Opozovi poslednju ocenu",
      studyExit: "Izađi iz učenja",
      notesHeading: "Naslov 1, 2 ili 3",
      notesBulletList: "Lista",
      notesOrderedList: "Numerisana lista",
      notesBlockquote: "Citat",
      notesCodeBlock: "Blok koda",
      notesSlash: "Meni komandi za blokove",
      notesLink: "Veza ka drugoj belešci",
      /** Mod-Shift-C in the note editor (ADR-068): the number is assigned, never typed. */
      notesCloze: "Napravi prazninu od izabranog teksta",
      notesHistory: "Opozovi i ponovi izmenu",
      notesFindOpen: "Otvori traku za pretragu u belešci",
      notesFindStep: "Sledeći ili prethodni rezultat",
      notesFindClose: "Zatvori traku i vrati kursor na rezultat",
    },
  },
} as const;

/**
 * The shape every locale must fill, derived from Serbian rather than declared
 * beside it — so the two can never drift, and so adding a string is one edit
 * rather than two.
 *
 * The mapping widens string LEAVES (`"Zadaci"` becomes `string`, or no other
 * locale could ever be assignable) while preserving the nesting and every
 * modifier. A locale declared `: Strings` therefore fails to compile with one
 * error per string it has not translated, and one per key it invented — which
 * is the whole reason this is a typed table and not a bag of dotted keys.
 */
export type LocaleShape<T> = {
  readonly [K in keyof T]: T[K] extends string
    ? string
    : // A FUNCTION LEAF IS A CRASH, NOT A STYLE. The live table is
      // `structuredClone(sr)`, and `structuredClone` throws `DataCloneError` on a
      // function — so one function anywhere in this tree takes the whole module
      // down at import time, before a single pixel. This arm used to map
      // functions through unchanged, which meant the type invited exactly the
      // thing the runtime cannot carry; `never` turns it into a compile error at
      // the leaf that wrote it. Interpolated copy is a template plus
      // `fill(template, values)` from `strings.ts`.
      T[K] extends (...args: never[]) => unknown
      ? never
      : LocaleShape<T[K]>;
};

export type Strings = LocaleShape<typeof sr>;
