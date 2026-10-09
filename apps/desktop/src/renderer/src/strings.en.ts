/**
 * English - the second locale, translated from `strings.sr.ts` and checked
 * against it by the compiler.
 *
 * This module holds the table and nothing else: no lookup helper, no plural
 * rule, no locale state. Those live in `strings.ts`, which is what the app
 * imports; nothing outside this file may import `en` directly, because a
 * consumer bound to `en` would be bound to English forever no matter what the
 * user picked.
 *
 * `as const` is load-bearing here: it keeps every key of every nested table
 * literal, so `strings.ts` can check this whole object against `Strings` - the
 * shape derived from Serbian in `strings.sr.ts` - with one compile error per
 * leaf left untranslated and one per key invented.
 *
 * English plurals use Serbian's three slots unchanged: `one` takes the
 * singular, and `few` and `many` both take the plural, because English's own
 * `Intl.PluralRules` only ever answers `one` or `other`.
 */
import type { SmartListId } from "@nexus/core";
import { devtoolsEn } from "./strings/devtools.en.js";
import { electronicsEn } from "./strings/electronics.en.js";
import { proEn } from "./strings/pro.en.js";
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

export const en = {
  app: {
    brand: "Nexus",
    navLabel: "Main navigation",
    /**
     * The registry's own category names, translated. The manifests have always
     * carried the grouping and the sidebar rendered the groups — it simply
     * threw the NAMES away, so fourteen modules read as one undifferentiated
     * list (STATUS §5 C item 13). Keys are `ModuleCategory` from `@nexus/core`;
     * a category with no enabled member never renders, so an unused one costs
     * nothing. One word each, because this is a 220px rail.
     */
    navCategories: {
      "Core experience": "Essentials",
      "Content & knowledge": "Content",
      "Life hubs": "Life",
      "Professional & utilities": "Work",
      "Growth & platform": "Growth",
    } satisfies Record<string, string>,
    /**
     * The sidebar's one heading that is not a category (ADR-086): the modules
     * this profile's own answers put at the top. „Za tebe" and not „Omiljeno" —
     * nobody marked these as favourites, the app placed them, and the honest
     * word says so. „Podešavanja → Kako je Nexus podešen za tebe" is where it
     * says why, and where somebody changes it.
     */
    navPinned: "For you",
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
    overviewToggle: "Overview",
    themeToggle: "Switch theme",
    themeDan: "Day",
    themeNoc: "Night",
    /**
     * The drawn window frame (`TitleBar.tsx`). Three controls that used to be
     * the operating system's, so their names have to be the ones a Serbian
     * Windows already uses — this is the one strip in the app where inventing
     * vocabulary would be a usability defect rather than a voice.
     */
    window: {
      minimize: "Minimize",
      maximize: "Maximize",
      restore: "Restore",
      close: "Close window",
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
      label: "App menu",
      viewSection: "View",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      zoomReset: "Actual size",
      fullScreenEnter: "Enter full screen",
      fullScreenLeave: "Leave full screen",
      windowSection: "Window",
      /** The shell's own rows, named here because `App` builds them and `TitleBar` only draws them. */
      search: "Search",
      settings: "Settings",
      shortcuts: "Keyboard shortcuts",
    },
    loading: "Loading…",
    /**
     * Asked before a file is removed, by all THREE attachment panels — notes,
     * tasks and a subject's materials. One block rather than three, because it
     * is one act: the row is hard-deleted and the encrypted copy on disk goes
     * with it when nothing else references that blob. Every one of the three
     * used to do that on a single click of a „⋯" menu item, with no undo
     * anywhere behind it.
     */
    attachmentDelete: {
      title: "Remove this file?",
      question: "The attached copy is deleted for good and cannot be brought back.",
      /** The one reassurance that is true: the original on disk was never touched. */
      note: "The original on your computer stays untouched.",
      confirm: "Remove",
      cancel: "Cancel",
    },
    /**
     * The autosave line, shared by every surface that writes without being
     * asked — the board and the note editor today, whatever comes next
     * tomorrow. The saved label carries a CLOCK because a bare „Sačuvano" is
     * still on screen an hour after the last write and therefore proves
     * nothing; see `SaveIndicator` for why the absence of this line was read
     * as the absence of saving.
     */
    saveSaving: "Saving…",
    saveSavedPrefix: "Saved at",
    /**
     * An editor's last write failed after its page was gone (DC-148). The shell
     * says it, because the page that would have is not there, and names the
     * note or the board, because nothing else on screen points at it. A private
     * note is never named: its title is private content, and this line is shown
     * above every page.
     */
    unsavedExit: {
      note: "The latest edits to the note “{title}” were not saved.",
      noteTooLarge:
        "The latest edits to the note “{title}” were not saved — part of it is too large to save in one go.",
      privNote:
        "The latest edits to a private note were not saved. The title is not shown outside Private.",
      privNoteTooLarge:
        "The latest edits to a private note were not saved — the note is too large. The title is not shown outside Private.",
      board: "The latest edits to the board “{name}” were not saved. Open it and check the drawing.",
      boardTooLarge:
        "The latest edits to the board “{name}” were not saved — the inserted images take up too much space.",
      retry: "Try again",
      retryFailed: "The retry did not work either.",
      dismiss: "Dismiss notification",
    },
    loadErrorTitle: "Startup failed",
    loadErrorDescription:
      "The connection to the local database could not be established. Close the app and start it again.",
    /**
     * One page could not be drawn — its file did not load, or it failed while
     * rendering (`PageSlot` in `routes.tsx`). The shell around it still works,
     * which is why the copy points at the sidebar first: another module is one
     * click away, and a restart is the remedy only if this page is the one
     * that is needed.
     */
    pageErrorTitle: "Screen failed to load",
    pageErrorDescription:
      "This part of the app could not be displayed. Pick another module in the sidebar, or close the app and start it again.",
  },

  /**
   * ADR-089 — the network mode. One block for the choice screen (shown once,
   * before the unlock screen) and for the card in Settings, because the two
   * must say the same thing about the same two options. The copy is written so
   * that an upgrading user does not read it as a first run: it asks a question
   * about this computer, it never welcomes anybody.
   */
  network: {
    chooseTitle: "How may Nexus use the network?",
    chooseIntro:
      "Choose a mode for this computer. The choice is remembered, and you can change it later in Settings.",
    offlineTitle: "Offline only",
    offlineBody:
      "Nexus opens no connection to the internet. Nothing leaves this computer — neither your data nor a check for a new version.",
    updatesTitle: "Offline + update checks",
    updatesBody:
      "Nexus contacts GitHub only, and only to check for and download a new version of itself. Your notes and data never leave this computer; GitHub sees your IP address, as any website does.",
    chooseConfirm: "Continue",
    chooseHint:
      "If you close the window without choosing, Nexus stays in “Offline only” and asks again on the next start.",
    cardIntro:
      "The mode is for the whole computer. “Offline only” opens no connection; “Offline + update checks” allows only checking for and downloading a new version of Nexus.",
    save: "Save the choice",
    saved: "The choice is saved.",
    restartNote: "The change takes effect the next time Nexus starts.",
    restartNow: "Restart Nexus",
    restartError: "Nexus could not restart. Close it and open it again.",
    saveError: "The choice was not saved. Try again.",
    aboutTitle: "Updates",
    aboutOff:
      "Update checks are off. Turn them on in the “Network and updates” card under Privacy.",
    aboutOpenCard: "Open “Network and updates”",
    checkNow: "Check now",
    checking: "Checking…",
    upToDate: "You have the newest version.",
    available: "A new version is available: {version}.",
    install: "Download and install",
    installing: "Downloading…",
    installHint:
      "Nothing downloads until you press this. Nexus checks the installer's signature, starts it and closes.",
    later: "Later",
    releasePage: "Release page",
    notesTitle: "What is new",
    problemTitle: "The check could not be finished.",
    problem: {
      "rate-limited": "GitHub is limiting the number of checks right now. Try again later.",
      network: "The network connection is unavailable. Check your internet and try again.",
      unexpected: "The reply from GitHub could not be read. Try again later.",
      asset: "That release has no Windows installer. Open the release page.",
      signature:
        "The signature on the checksum file is not valid. The download stopped before anything was installed.",
      hash: "The downloaded file does not match its checksum. It was deleted and not started.",
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
    title: "Your Nexus",
    description:
      "Nexus works entirely offline — all your data stays on this device. Enter a profile name and pick a theme; you can set up everything else later.",
    /**
     * The business first entry (ADR-058 §5): the same naming screen, minus the
     * theme group — the theme is device-wide and was chosen long before a
     * second profile existed — so the copy asks for exactly what the screen
     * still asks for: a name.
     */
    titleBusiness: "Business profile",
    descriptionBusiness:
      "A business profile keeps work separate from personal — it has its own tasks, notes and settings, under the same account. Give it a name; you can set up everything else later.",
    nameLabel: "Profile name",
    namePlaceholder: "Enter a name",
    themeLabel: "Theme",
    /**
     * ADR-086's four questions, and what makes them different from the two they
     * replaced: every one of them is about the PERSON and none is about the
     * software. „Do you want the Finance module" is the questionnaire asking the
     * user to do its job; „do you want Nexus to keep an eye on money" is a
     * question anybody can answer about themselves. The mapping from the second
     * to the first lives in `buildProfilePlan`, where it can be argued with.
     */
    week: {
      title: "What does your week go on?",
      description: "Pick at most two — the ones that really take up most of your time.",
      /** Said out loud, the „remindersNoChoice" idiom: choosing nothing is an answer here. */
      noChoice: "If you pick nothing, Nexus starts with the defaults.",
      shapes: {
        posao: { name: "Work", desc: "I work for someone — tasks, meetings, deadlines." },
        skola: { name: "School and university", desc: "Lectures, exams, study." },
        dom: { name: "Home and family", desc: "The house, bills, chores that will not wait." },
        kondicija: { name: "Training and health", desc: "Exercise, habits, sleep and nutrition." },
        stvaranje: { name: "Making things", desc: "I write, draw, build something of my own." },
        firma: { name: "My own business", desc: "Clients, quotes, invoicing." },
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
      title: "What do you do?",
      description:
        "Write it in your own words. Nexus recognises the work and adds tools for it — nothing touches your data.",
      label: "Your work",
      placeholder: "e.g. carpenter, lawyer, photographer, I keep the books",
      /** The recognition receipt. Quotes the person's own word back, then what it opened. */
      heard: "Recognised",
      /** Removing one chip un-says it — the recognition is a suggestion, not a verdict. */
      remove: "Remove",
      activitiesLabel: "Or pick what you do:",
      noChoice:
        "If nothing is recognised, nothing is added — you can turn professional tools on later, when you need them.",
      /** One per `TRADE_ACTIVITIES` id. A verb, because the question is what somebody DOES. */
      activities: {
        "mere-sece": "I measure and cut",
        ponude: "I make quotes and estimates",
        teren: "I work on site",
        predaje: "I teach",
        ugovori: "I draft contracts",
        vozi: "I drive and deliver",
        kuva: "I cook",
        snima: "I shoot video and photos",
        kod: "I write code",
        svira: "I play music",
        knjige: "I keep the books",
        dogadjaji: "I organise events",
        trenira: "I train others",
        prevodi: "I translate and proofread",
      } satisfies Record<string, string>,
    },
    /** Not what somebody does but HOW — and it decides what every module opens on. */
    tempo: {
      title: "What does your day look like?",
      description: "Pick one — Nexus uses it to decide what to show you first.",
      noChoice: "If you skip this, everything stays as it is and you can change it as you go.",
      options: {
        planer: { name: "I plan ahead", desc: "I like to see the whole month before it starts." },
        reaktivan: { name: "I deal with things as they come", desc: "What matters to me is what is due today and what is late." },
        beleznik: { name: "I write it down first", desc: "Everything goes into notes, then falls into place later." },
      } satisfies Record<string, { name: string; desc: string }>,
    },
    /** Asked about CONTENT, never about modules — the honest form of the same question. */
    keep: {
      title: "What would you like Nexus to keep an eye on?",
      description: "Pick as many as you like, or none.",
      noChoice: "None of this is required — everything can be turned on and off later.",
      options: {
        novac: { name: "Money", desc: "Bills, subscriptions, who has not paid yet." },
        zdravlje: { name: "Health and habits", desc: "The things you measure day after day." },
        dokumenta: { name: "Documents", desc: "Contracts, ID papers, expiry dates." },
        ideje: { name: "Ideas and notes", desc: "So nothing slips past me." },
        privatno: {
          name: "Something just for me",
          desc: "A locked section — opened with its own password.",
        },
      } satisfies Record<string, { name: string; desc: string }>,
    },
    /**
     * The „Priprema" screen. It narrates REAL steps — each line is a thing that
     * is actually being written — because a progress screen that invents its
     * stages is the one kind of loading screen a user is right to resent.
     */
    prepare: {
      title: "Putting your Nexus together",
      description: "Setting up your dashboard, menu and colours from your answers.",
      stages: {
        packs: "Turning on tools",
        modules: "Setting up modules",
        board: "Arranging your dashboard",
        look: "Picking colour and pace",
        done: "Finishing up",
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
      title: "Here is your Nexus",
      description: "This is how we put it together. Everything can be changed — in Settings, whenever you like.",
      /** The Serbian list conjunction (`joinList`) — „A, B i C". */
      and: "and",
      heard: "Your words",
      /**
       * The participle is a VERB here („složili smo ih") and not an adjective
       * agreeing with the noun, which it cannot be: a composed board is 3–6
       * cards, so `{unit}` is „kartice" at three and „kartica" — genitive
       * plural — at five, and one modifier cannot be right for both.
       */
      board: "Your dashboard has {count} {unit} — we arranged them from your answers.",
      boardUnitOne: "card",
      boardUnitFew: "cards",
      boardUnitMany: "cards",
      packs: "Tools are on for: {packs}.",
      nav: "Your menu starts with: {modules}.",
      priv: "The private section is on — it opens with its own password.",
      calendar: "The calendar opens in the “{view}” view.",
      accent: "The app colour is {colour}.",
      /** What a run where nothing was answered says. Not an apology: it is a legitimate answer. */
      nothing: "With no answers, Nexus starts with the defaults — you can set everything up when you need it.",
      enter: "Enter Nexus",
      /** The escape hatch, quiet: ADR-065's two checkbox screens survive as this. */
      advanced: "Set up manually",
    },
    /**
     * „Napredno" — ADR-065's two screens, kept.
     *
     * They were the whole questionnaire and are now the override: reachable from
     * the reveal and from Podešavanja, never on the path. A person who wants to
     * tick thirty-two boxes should be able to; nobody should have to.
     */
    advancedTitle: "Set up manually",
    advancedDescription:
      "Here you choose exactly what you want. The same list is in Settings → Modules, so nothing here is your last chance.",
    advancedSave: "Save",
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
    packsNoChoice: "If you pick nothing, Nexus starts without professional tools — you can add them when you need them.",
    /** Screen 3 — oblasti. The module names and one-line descriptions are the gallery's own (`settings.moduleDescriptions`), never respelled. */
    modulesTitle: "What do you need?",
    /** Screen 4 — podsetnici; the three choices reuse `settings.notificationPresets`, so a word means the same set everywhere. */
    /**
     * The demo offer on the last screen — a personal first run only. Says what
     * it is (a SECOND profile, not a change to this one), what is in it, and
     * that it can be removed, because all three are what somebody needs in
     * order to say yes without wondering what they just agreed to.
     */
    demoLabel: "Also add a “Demo” profile",
    demoHint:
      "A second profile in this account, full of examples — tasks, notes, finance, study, habits and nutrition — so you can see what Nexus looks like when it is full. Your own profile stays empty and untouched, and you can delete “Demo” whenever you like.",
    remindersTitle: "Reminders",
    remindersDescription: "How many notifications would you like from Nexus?",
    /** Said out loud rather than left as a surprise: no pick here is a valid answer, and the one-time question (NTF-008) simply stays where it was. */
    remindersNoChoice: "If you pick nothing, Nexus will ask when the first reminder is ready.",
    /** Screen chrome. „Korak 2 od 4“ is composed in JSX around the number, the `settings.backup.savedPrefix` idiom. */
    stepPrefix: "Step",
    stepOf: "of",
    next: "Next",
    back: "Back",
    start: "Start",
    /** First run only: stop asking and take what the flow already holds. */
    skip: "Skip",
    /** Rerun only: leave without writing anything — see `Onboarding.tsx` for why a rerun cannot „skip to Osnovno“. */
    cancel: "Cancel",
    /** The same flow reopened from Podešavanja (SET). Screen 1 shows the current name, screen 3 the live modules. */
    rerunTitle: "Set up Nexus again",
    rerunDescription:
      "The same questions as on the first run. It starts from what you have now and changes only what you change.",
    /**
     * The one genuine starter row (ADR-065 §4): a real, useful, deletable note
     * written through the ordinary note path. Markdown, because that is what
     * `parseMarkdownNote` reads and what the note editor renders back. Every
     * sentence is checkable in the app — no invented numbers, no promises the
     * build does not keep, and no printed keyboard chord (they are remappable,
     * ADR-040, so the note points at the screen that shows the live ones).
     */
    welcomeNote: {
      title: "Welcome to Nexus",
      body: "# Welcome to Nexus\n\nThis is your first note — change it or delete it, it is yours.\n\n- All your data stays on this device. Nexus sends nothing to the internet.\n- You turn areas on and off in Settings → Modules.\n- You can see and change keyboard shortcuts in Settings → Shortcuts.\n\nWhen you need something new — a task, an event or a note — start here.\n",
    },
    saveError: "Saving failed. Try again.",
  },

  /** Local account lock screen (ADR-018 / AUTH-002..005, extended by ADR-044 / AUTH-006): picker → create → Kit za oporavak → unlock → recovery, plus the shared error map and the sidebar lock/switch actions. */
  auth: {
    validation: {
      tooWeak: "The passcode must be at least 8 characters, with at least one letter and one digit.",
      mismatch: "The codes do not match.",
      labelRequired: "Enter an account name.",
    },
    create: {
      title: "Protect your Nexus",
      intro: "Set a passcode that will protect all your data on this computer.",
      additionalTitle: "New account",
      additionalIntro:
        "A new account has its own passcode and its own data — nothing is shared with accounts that already exist.",
      labelLabel: "Account name",
      labelPlaceholder: "e.g. Personal",
      // The registry that holds this name is plaintext by design (ADR-044): it
      // is what the lock screen lists before anything is unlocked. Said plainly
      // where the name is typed, never buried in a settings page.
      labelNote: "This name is visible on the lock screen.",
      passcodeLabel: "Passcode",
      passcodePlaceholder: "At least 8 characters, a letter and a digit",
      confirmLabel: "Confirm passcode",
      confirmPlaceholder: "Repeat the passcode",
      note: "All your data is encrypted with this code. If you forget it, the only way back is the recovery kit you get in the next step — without the code and the kit, the data stays permanently out of reach.",
      submit: "Create account",
    },
    keystoreUnavailable: {
      title: "System vault unavailable",
      description:
        "Nexus keeps part of the encryption key in the Windows system vault, and it is currently unavailable on this Windows account — without it, a local account cannot be created. Check that this Windows account is set up correctly and try again.",
    },
    recoveryKit: {
      title: "Recovery kit",
      description:
        "This code is shown only once. Write it down and keep it somewhere other than the computer — if you ever forget your passcode, this is the only way back into your data.",
      copy: "Copy",
      copied: "Copied",
      // Gender-neutral by construction: Serbian past participles agree with the
      // speaker, and "Zapisao sam" would address only half the users.
      confirmCheckbox: "The code is written down and kept safe",
      continue: "Continue",
    },
    unlock: {
      title: "Nexus is locked",
      description: "Enter your passcode to continue.",
      passcodeLabel: "Passcode",
      passcodePlaceholder: "Enter your passcode",
      submit: "Unlock",
      forgot: "Forgot your passcode?",
      retryPrefix: "Too many attempts — try again in",
      otherAccount: "Another account",
    },
    /** The account picker (ADR-044 / AUTH-006) — shown ahead of the lock screen whenever this device holds more than one account. */
    picker: {
      title: "Choose an account",
      description: "There are several accounts on this computer. Each has its own passcode and its own data.",
      stateLocked: "Locked",
      stateRecovery: "Needs a recovery kit",
      stateKeystoreUnavailable: "System vault unavailable",
      rename: "Rename",
      renameFieldLabel: "New account name",
      renameSave: "Save",
      renameCancel: "Cancel",
      renameError: "Renaming failed. Try again.",
      /**
       * Deleting an account (ADR-048 / AUTH-022). Immediate, with no undo and
       * no grace period, so every sentence here is written to be understood
       * BEFORE the field is reached: what goes, that it cannot be taken back,
       * and where an export would have to happen (advisory — never a
       * precondition). The warning is composed around the account's own name in
       * JSX, the `restore.replaceWarningPrefix` idiom.
       */
      delete: "Delete",
      deleteTitle: "Delete account",
      deleteWarning: "All the account's data will be permanently deleted. This cannot be undone.",
      deleteExportNote:
        "If you want to export your data, unlock the account and do it in Settings before deleting.",
      /** The typed confirmation IS the gate — there is no passcode here (an account from another device could not answer one). */
      deleteConfirmLabel: "Account name to confirm",
      deleteConfirmPlaceholder: "Enter the exact account name",
      deleteSubmit: "Delete account",
      deleteCancel: "Cancel",
      deleteError: "Deleting failed. Try again.",
      add: "Add account",
      back: "Back to account selection",
    },
    recovery: {
      title: "Access recovery",
      descriptionForgot:
        "Enter the code from your recovery kit and set a new passcode for this device.",
      descriptionOtherDevice:
        "This data comes from another computer or Windows account, so the passcode from here does not apply. Unlock it with the recovery kit issued when the account was created and set a new passcode for this device.",
      codeLabel: "Recovery code",
      codePlaceholder: "Enter the recovery code",
      newPasscodeLabel: "New passcode",
      newPasscodePlaceholder: "At least 8 characters, a letter and a digit",
      confirmLabel: "Confirm new passcode",
      confirmPlaceholder: "Repeat the new passcode",
      submit: "Unlock",
      back: "Back to unlock",
    },
    /** AuthErrorReason → Serbian, one sentence each; `generic` is the exhaustive-switch fallback. */
    error: {
      notInitialized: "There is no account on this device yet.",
      alreadyInitialized: "There is already an account on this device.",
      wrongPasscode: "Wrong passcode.",
      wrongRecoveryCode: "The recovery code is not correct.",
      throttled: "Too many attempts — wait for the time below to pass.",
      weakPasscode: "The passcode must be at least 8 characters, with at least one letter and one digit.",
      keystoreUnavailable: "The system key vault is unavailable on this Windows account.",
      otherDevice: "This data comes from another computer or Windows account — unlock it with a recovery kit.",
      corruptKeychain: "The key file is damaged and cannot be read.",
      generic: "The action failed. Try again.",
    },
    lockAction: "Lock",
    /** Sidebar, only when this device holds more than one account: locks the open one, which brings the picker back (ADR-044). */
    switchAction: "Switch account",
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
    businessLabel: "Work",
    switcherLabel: "Switch profile",
    createBusiness: "New business profile",
    /**
     * The second way to the demo profile — the first is a checkbox at the end
     * of the first run. „Dodaj" rather than „Napravi": what makes it worth
     * having is the data that comes with it, not the empty profile.
     */
    createDemo: "Add a demo profile",
    createError: "Creating the profile failed. Try again.",
    /**
     * The passcode gate in front of EVERY switch (AUTH-024). The error map is
     * the lock screen's own (`authErrorMessage`), never respelled here — a
     * wrong passcode is the same sentence wherever it is typed.
     */
    switchTitle: "Switch to profile",
    switchQuestion: "Enter the account passcode to switch to this profile.",
    switchPasscodeLabel: "Passcode",
    switchConfirm: "Confirm",
    switchCancel: "Cancel",
  },

  /** Display names for registered modules, keyed by module id. */
  modules: {
    dashboard: "Dashboard",
    tasks: "Tasks",
    calendar: "Calendar",
    settings: "Settings",
    notes: "Notes",
    study: "Study",
    priv: "Private",
    files: "Files",
    finance: "Finance",
    habits: "Habits",
    focus: "Focus",
    fitness: "Fitness",
    tools: "Tools",
    canvas: "Board",
    electronics: "Electronics",
    pro: "Professional tools",
  } satisfies Record<string, string>,

  dashboard: {
    /** Time-of-day salutations: jutro < 12h, dan 12–18h, veče ≥ 18h. */
    greeting: {
      jutro: "Good morning",
      dan: "Good afternoon",
      vece: "Good evening",
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
      dayLong: "today",
      /**
       * A focus timer is running right now. „Fokus u toku" alone under the
       * first minute; „Fokus u toku: 25 min" once there is a duration worth
       * naming (`formatDurationMinutes` appends it).
       */
      focusRunning: "Focus running",
      /**
       * The same phase, paused (UTIL slice b). Its own wording rather than a
       * suffix, because the figure beside it is FROZEN — „Fokus u toku: 25 min"
       * on a number that has stopped moving would be the one lie the strip can
       * tell.
       */
      focusPaused: "Focus is paused",
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
      eventsToday: "Events today",
      /** Tasks whose rok is today — TASK's own „Danas“ list, counted. */
      tasksToday: "Due today",
      /** Tasks whose rok is already past — TASK's own „Kasni“ list, counted. */
      tasksLate: "Late",
      focus: "Focus today",
      /** The unit beside the focus figure; the „Fokus“ card states the same day as a duration. */
      focusUnit: "min",
      /**
       * Drawn ONLY while a phase is actually running, which is exactly when the
       * figure is a lower bound rather than a total: the engine writes a
       * session when one is stopped, so the minutes a timer is earning right
       * now are in no row yet and cannot be counted honestly.
       */
      focusRunningNote: "no session running right now",
    },
    /** Danas widget — today's events, birthdays, and tasks due today. */
    today: {
      title: "Today",
      empty: "Nothing on today 🎉",
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
      taskTag: "task",
      /** The same, for the birthday/anniversary mark — the one leading whose kind really does vary row to row. */
      personTag: {
        birthday: "birthday",
        anniversary: "anniversary",
      },
    },
    /** Predstojeći zadaci widget — the next active tasks. */
    upcoming: {
      title: "Upcoming tasks",
      empty: "No active tasks",
    },
    /** Dokumenta koja ističu widget — documents past the reminder threshold. */
    expiring: {
      title: "Expiring documents",
      empty: "All documents are fine ✅",
    },
    /**
     * Hitno i kasni widget — TASK's „Kasni“ and „Hitno“ smart lists (ADR-049)
     * read as one card. The empty line has to answer for both halves at once,
     * which is why it names them both rather than saying „nema zadataka“.
     */
    urgent: {
      title: "Urgent and late",
      empty: "Nothing is late and nothing is urgent",
    },
    /** Nedavne beleške widget — the notes touched most recently (NOTE's first card). */
    recentNotes: {
      title: "Recent notes",
      empty: "No notes yet",
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
      title: "Recent files",
      empty: "No files yet",
      /** DOC's own word for a carrier with no title — the page draws the same one. */
      untitledOwner: "Untitled",
    },
    recentBoards: {
      title: "Recent boards",
      empty: "No boards yet",
    },
    recentCircuits: {
      title: "Recent circuits",
      empty: "No circuits yet",
    },
    /** Not „nedavno": a profile has the toolkits it chose, so this lists them all. */
    proPacks: {
      title: "Your professional tools",
      empty: "No pack is on yet",
    },
    /** FIN slice d: what the subscriptions' rules say is coming — never a row, always the schedule. */
    renewals: {
      title: "Upcoming charges",
      empty: "No charges in this period",
    },
    /**
     * UTIL slice b's card: the phase running right now, or — when nothing is —
     * how much focus today has actually held. Two states and no third, because
     * those are the only two true things a card about a timer can say.
     */
    focus: {
      title: "Focus",
      /** Nothing runs and nothing was focused today. An invitation, not a scolding. */
      empty: "No focus today yet",
      /** Leads the figure when nothing runs: „Danas · 1 h 15 min". */
      todayLabel: "Today",
      /** Leads a running phase's remaining/elapsed clock. */
      runningLabel: "Running",
      /** The same phase with its clock frozen. */
      pausedLabel: "Paused",
      /** The phase is past its plan — the card says so rather than showing 00:00. */
      overrunLabel: "Overrun",
    },
    /** HABIT slice c's card: today's expected habits, tickable in place. */
    habitsToday: {
      title: "Habits today",
      /** Nothing is expected today — which is a fact about the schedule, not a scolding. */
      empty: "No habits are expected today",
      /** The row's tick, as a label for a screen reader — the page's own wording. */
      tick: "Mark as done",
      /** The compact niz chip. The counted noun rides along (`habitFormat.ts`) — „Niz: 3" cannot say three WHAT, and for a quota habit it is weeks. */
      streakLabel: "Streak",
    },
    /**
     * FIT slice b's card: today's calories, against the calorie goal when there
     * is one. Read-only — logging a meal takes a food, an amount and a slot,
     * which is a form rather than the one bit „Navike danas" ticks in place.
     */
    fitnessToday: {
      title: "Nutrition today",
      /** Nothing logged today. An invitation, and deliberately not a reminder that you have not eaten. */
      empty: "No meals logged today yet",
      /** Under the figure when a calorie goal is set — „od 2.000 kcal". */
      ofGoalPrefix: "of",
      /** The chip on a day past its calorie goal. States a fact; there is no advice anywhere on this card. */
      overGoal: "Over target",
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
      title: "Workout",
      empty: "No workouts this week yet",
      weekLabel: "This week",
      /**
       * A session in progress outranks the count — it is the one thing on this
       * card that is happening rather than having happened. It is the whole row
       * title and carries no separate „U toku" tag beside it: the two said the
       * same thing, and one of them was sitting in the gutter every other card
       * uses for a time.
       */
      openTitle: "Workout in progress",
      sessionUnitOne: "workout",
      sessionUnitFew: "workouts",
      sessionUnitMany: "workouts",
      lastDoneLabel: "Last done",
      neverDone: "Never yet",
    },
    /**
     * A single widget's own boundary (ADR-045 section 4): each card loads and
     * fails alone, so this copy is per-card and deliberately says nothing about
     * the page — the four cards beside it are fine.
     */
    widget: {
      error: "The data cannot be loaded.",
      retry: "Try again",
    },
    /** The layout itself could not be read — the one failure that is the page's own. */
    layoutError: "The card layout cannot be loaded.",
    /** Edit mode (ADR-045 section 5) — the header actions and each card's „⋯“ menu. */
    /**
     * The board with no cards on it, and the board still being read. Until
     * 2026-08-07 it had neither: an empty board drew an empty grid with no
     * word on it, and a loading one drew nothing at all — two states that
     * look identical to somebody who has just opened the app.
     */
    emptyTitle: "There is nothing on the dashboard yet",
    emptyDescription: "Edit the dashboard and add a widget — every module that is on offers at least one.",
    edit: {
      enter: "Edit",
      done: "Done",
      add: "Add widget",
      /** Names one card's „⋯“; the widget's own title is appended, since five of them share the page. */
      menuLabel: "Card actions",
      moveUp: "Move up",
      moveDown: "Move down",
      sizeLabel: "Size",
      /** The three presets, named for how wide they draw — never by their stored letter. */
      size: {
        S: "Small",
        M: "Medium",
        L: "Large",
      },
      remove: "Remove",
      /** Tooltip on the title strip, which is also the drag grip. */
      dragHint: "Drag to reorder",
      failed: "Changing the layout failed. Try again.",
      /**
       * Removing the last card leaves no rows, and no rows IS the default
       * arrangement — so the five come back. Said the moment it happens,
       * because nothing else on screen would explain them.
       */
      defaultRestored: "The last card was removed — the default layout is back.",
    },
    /** „Dodaj vidžet“ — the catalogue of what the enabled modules publish. */
    gallery: {
      title: "Add widget",
      empty: "No module that is on has any cards.",
      add: "Add",
      /** Beside a widget already on the layout; v1 places each of them once. */
      added: "already added",
      close: "Close",
    },
    /**
     * Named dashboards (DASH-008 / ADR-055): the typographic switcher beside
     * the greeting, its popover, and the edit-mode manage actions. The default
     * board is named here in COPY ONLY — it is not a row, which is exactly why
     * it can be neither renamed nor deleted.
     */
    sets: {
      /** The default board's display name. */
      defaultName: "Home",
      /** Accessible label on the switcher trigger; its visible content is the active board's name. */
      switcherLabel: "Board selection",
      /** Accessible label on the „⋯“ manage menu beside the switcher (edit mode only). */
      manageLabel: "Board actions",
      /** In the switcher list (edit mode only) AND in the manage menu: opens the name line. */
      create: "New board…",
      rename: "Rename board",
      remove: "Delete board",
      /** The inline name line the switcher row becomes — the tasks-rail idiom. */
      namePlaceholder: "Board name",
      createLabel: "New board",
      renameLabel: "Rename board",
      save: "Save",
      cancel: "Cancel",
      /**
       * The house confirm (the recurrence-dialog recipe) for deleting a board:
       * what goes is the ARRANGEMENT — the content the cards read lives in its
       * modules and is untouched, and saying so is what makes the question
       * answerable.
       */
      deleteDialog: {
        title: "Delete board",
        question:
          "Only the card layout on this board is deleted. The content — tasks, events, notes — stays untouched.",
        confirm: "Delete",
        cancel: "Cancel",
      },
      /** A set write that did not land — the layout's own `edit.failed`, for the boards. */
      failed: "Changing boards failed. Try again.",
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
      open: "Configure…",
      /** The form's way back to the card's actions, same menu, same open. */
      back: "Back",
      /** One label per declared key, shared across widgets on purpose. */
      fields: {
        count: "Number of rows",
        period: "Period",
        horizon: "Time range",
        lists: "Task lists",
      },
      /** The leading count option on a widget that ships uncapped: no cap at all. */
      countAll: "All",
      /** The empty selection over task lists — every list counts. */
      allLists: "All lists",
      /** The lists could not be read for the form; the card itself is untouched. */
      listsError: "The lists cannot be loaded.",
      period: {
        svi: "All tasks",
      },
      horizon: {
        prag: "By the document's reminder",
        svi: "All upcoming",
        "30": "30 days",
        "60": "60 days",
        "90": "90 days",
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
      "The module is in the catalogue, but its screen is not built yet. The rest of the app works normally.",
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
      heading: "Inflow and outflow",
      createdLabel: "Created",
      completedLabel: "Closed",
      caption:
        "Per week: how many tasks were created and how many were closed. “Closed” is a lower bound — a deleted task disappears with its history, a reopened task loses its completion date, and a repeating task records completion only once the set runs out.",
      descriptionLead: "Inflow and outflow per week",
      weekUnitOne: "week",
      weekUnitFew: "weeks",
      weekUnitMany: "weeks",
      emptyReason: "The chart appears as soon as there is at least one task with a creation date.",
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
      open: "Open",
      today: "Due today",
      overdue: "Late",
      closed: "Closed",
      /** The window „Zatvoreno“ counts, set beside the figure rather than folded into its label. */
      closedUnit: "in 7 days",
      /** One line under that figure — the whole reason is in `chart.caption` right beneath it. */
      closedNote: "Lower bound",
    },
    quickAddPlaceholder: "New task — type and press Enter",
    quickAddSubmit: "Add",
    /**
     * The disclosure over the capture form’s detail fields (rok, prioritet,
     * lista, sekcija, oznake, podsetnici). They used to be permanently open
     * above the list, which is roughly half the viewport spent on a form
     * that most captures never touch — a title and Enter is the whole act.
     * Editing an existing task opens them regardless: that IS the details.
     */
    detailsShow: "Details",
    detailsHide: "Hide details",
    /** What the marker on a CLOSED disclosure means, for a reader who cannot see a bullet. */
    detailsSet: "Some fields are filled in",
    quickAddLabel: "New task",
    viewLabel: "View",
    viewList: "List",
    viewKanban: "Board",
    viewCards: "Cards",
    viewCalendar: "Calendar",
    /**
     * The per-view controls above the rows (ADR-050): what the shown scope is
     * ordered by, what a board's columns come from, and what is filtered out.
     * Each is remembered per LIST and per VIEW, so a board grouped by sekcija
     * and a list sorted by rok can both be true of the same list at once.
     */
    controls: {
      /** Names the row of selects for a screen reader — „Prikaz“ alone is the toggle beside it. */
      regionLabel: "View controls",
      sortLabel: "Order",
      /**
       * The first option, and the one a list opens on: no sort at all, so the
       * rows stay in the order the user dragged them into. It is a real choice,
       * not an absence — which is why it is worded rather than left blank.
       */
      sortManual: "Manual order",
      /**
       * The sortable fields. Deliberately NOT status/prioritet: the views
       * engine collates a select field by its stored VALUE, which would order
       * prioritet as high–low–medium–none — a sort that looks like a feature
       * and behaves like an accident. Grouping a board by them is what answers
       * that question honestly.
       */
      sortField: {
        title: "Title",
        dueDate: "Due",
        startDate: "Starts",
        completedAt: "Completed",
        done: "Done",
      },
      groupLabel: "Grouping",
      group: {
        status: "Status",
        priority: "Priority",
        section: "Section",
      },
      statusLabel: "Status",
      statusAll: "All statuses",
      priorityLabel: "Priority",
      priorityAll: "All priorities",
      /**
       * The board's null column when it is grouped by sekcija: the list itself,
       * where a task with no heading lives. Always drawn, empty or not — it is a
       * real place to drop something back into, not a leftovers pile.
       */
      bodyColumn: "List body",
      /** The card's own „⋯“ menu — the keyboard way to do what the drag does. */
      cardMenuLabel: "Move card",
      moveLeft: "Move left",
      moveRight: "Move right",
      /**
       * The board's column configuration (ADR-060). The „Kolone“ popover lists
       * every column of the current grouping — hidden ones included, so hiding
       * is always reversible — and the chip states how many the board is not
       * drawing, because a column that quietly vanished would read as lost
       * work. The rows' ↑/↓ move within the popover's top-to-bottom list, which
       * IS the board's left-to-right order.
       */
      columns: "Columns",
      columnsLabel: "Board columns",
      /** The column head's own „⋯“ menu; rendered with the column's title after it. */
      columnMenuLabel: "Column actions",
      hideColumn: "Hide column",
      columnUp: "Move up",
      columnDown: "Move down",
      /** The quiet chip beside the controls; rendered with the count after it: „Skrivene kolone: 2“. */
      hiddenColumns: "Hidden columns:",
      /**
       * Shown in place of the rows when the view's own filter matches nothing.
       * Its own sentence rather than the oznake one: the two hide rows for
       * different reasons, and an answer that named the wrong filter would send
       * the user to clear a control that is not the one holding the rows back.
       */
      filterEmptyDescription: "No task matches the selected filter.",
    },
    /** The month grid over the selected list (ADR-050) — one bar per task, between „Počinje“ and „Rok“. */
    calendar: {
      regionLabel: "Task calendar",
      prevMonth: "Previous month",
      nextMonth: "Next month",
      today: "Today",
      /** Heading of the strip under the grid: a task with no rok has no day to sit on, and dragging it onto one is what gives it a rok. */
      undatedLabel: "No due date",
      /** Trailing word of the muted „+3 još“ a day shows when its bars outrun the lanes. */
      moreSuffix: "more",
    },
    emptyTitle: "No tasks",
    emptyDescription:
      "Write your first task in the field above — a name and Enter is enough.",
    loadError: "Tasks cannot be loaded right now. Try again later.",
    editLabel: "Edit task",
    deleteLabel: "Delete task",
    /** The per-row „⋯“ menu: tags to attach plus „Sačuvaj kao šablon“, so its name is the row, not one of them. */
    rowMenuLabel: "Task actions",
    deletedNotice: "Task deleted",
    undo: "Undo",
    dismiss: "Dismiss",
    /** The add/edit form's own save failing at the store/IPC boundary. */
    saveError: "The task was not saved. Try again.",
    /**
     * Generic fallback for every task write outside the form and outside the
     * rail/tag/dependency sections above (each of which reports its own
     * failure): complete, toggle, move, re-prioritise, delete, undo, a
     * subtask — the HABIT page's own `actionError` shape.
     */
    actionError: "The action failed. Try again.",
    /**
     * A due date recognised in the quick-add line itself (TASK-007) — "Kupi
     * mleko sutra". The chip shows what will be saved before Enter is pressed,
     * so the reading is always correctable rather than surprising.
     */
    quickDate: {
      /** Names the live region that announces the recognised date. */
      regionLabel: "Recognised due date",
      /** Tooltip on the chip — says what happens on save. */
      chipTitle: "Due date recognised from the title — it will be applied when you save",
      dismissLabel: "Ignore the recognised due date",
    },
    /** Detail fields of the shared add/edit form (the quick-add line stays the fast path). */
    dueDateLabel: "Due date",
    /**
     * The day a task becomes actionable (TASK-001), beside „Rok“ on the same
     * form row. „Počinje“ rather than „Početak“: the field answers *when* it
     * starts, and the smart lists read it as exactly that — a task that starts
     * after today is not yet something to do today.
     */
    startDateLabel: "Starts",
    priorityLabel: "Priority",
    save: "Save",
    cancel: "Cancel",
    /**
     * The "Podsetnik" chip row on the task form (ADR-028) — the same shape as
     * `calendar.reminders`, counted in DAYS rather than minutes, because a
     * task's deadline is a day. Every chip's label is built from these by one
     * formatter, so the fixed ladder and an offset loaded from a stored task
     * read the same way: "Na dan roka", "1 dan ranije", "3 dana ranije".
     */
    reminders: {
      label: "Reminder",
      /** Shown in place of the chips while the form has no (valid) rok to count back from — the store refuses that combination. */
      needsDate: "Set a due date to enable a reminder.",
      /** The zero-day chip: the reminder fires on the due day itself, at the morning hour. */
      atDue: "On the due date",
      /** Trailing word of every non-zero lead time; the counted day noun takes `dayUnit`. */
      before: "before",
    },
    /** Per-row „+” and the inline line it opens (TASK-008). A subtask starts as a bare name; rok/prioritet/ponavljanje are set afterwards through the ✎ form, like on any task. */
    addSubtaskLabel: "Add subtask",
    subtaskPlaceholder: "New subtask — type and press Enter",
    /** Tooltip on the `2/5` roll-up chip; the number alone cannot say what it counts. */
    subtaskProgressTitle: "Completed subtasks",
    /**
     * The open-subtasks question (PRD 03 §4). Completing a parent reaches rows
     * the user did not tick, so it is asked rather than assumed — no default,
     * and Otkaži is the way out that changes nothing.
     */
    subtasks: {
      title: "Subtasks",
      question: "The task has open subtasks.",
      completeAll: "Complete the subtasks too",
      completeOne: "Complete just the task",
      cancel: "Cancel",
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
      heading: "Views",
      /** Names the group of view rows for a screen reader — „Pregledi“ alone says little out of context, exactly as with `lists.railLabel`. */
      regionLabel: "Task views",
      names: {
        danas: "Today",
        sledecih7: "Next 7 days",
        hitno: "Urgent",
        kasni: "Late",
        zavrseno: "Completed",
      } satisfies Record<SmartListId, string>,
      /**
       * Each view's own empty state. Calm statements of fact, never the list's
       * „zapiši prvi zadatak“ invitation: there is no typing into a view, so an
       * invitation here would point at a field that is not on screen.
       */
      empty: {
        danas: "No tasks for today.",
        sledecih7: "No tasks in the next seven days.",
        hitno: "No high-priority tasks.",
        kasni: "Nothing is late.",
        zavrseno: "No task has been completed yet.",
      } satisfies Record<SmartListId, string>,
      /** Tooltip on the muted count beside „Danas“ and „Kasni“ — a bare number cannot say what it counts. */
      countTitle: "Number of tasks in the view",
      /**
       * „Završeno“ is bounded (ADR-039 §4): the first 100, then „Prikaži još“.
       * Worded as „Prikazano prvih 100 od 340“ — the counts are stated after
       * the words, where Serbian owes no numeral agreement.
       */
      shownPrefix: "Showing the first",
      shownOf: "of",
      showMore: "Show more",
      /** The collapsed disclosure beneath „Završeno“ holding everything past the archive boundary — drawn as „Arhiva (N)“, the count by the page. */
      archiveTitle: "Archive",
      /**
       * „Završeno“'s empty state once every finished task has aged into the
       * archive: „Sve završeno starije od 30 dana je u arhivi.“ The day count
       * (TASK_ARCHIVE_AFTER_DAYS) is stated between the halves at the call
       * site, and „dana“ after „od“ holds for any count the constant could
       * become — genitive, so 21, 30 and 60 all read the same.
       */
      allArchivedPrefix: "Everything completed more than",
      allArchivedSuffix: "days ago is in the archive.",
      /** Tooltip on the row chip that names a task's list — inside a view the rows come from every list at once. */
      listChipTitle: "The list this task belongs to",
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
      today: "Today",
      tomorrow: "Tomorrow",
      yesterday: "Yesterday",
      /**
       * The two long tails, worded so each holds for any banded date: a rok
       * more than a week gone is late and a completion more than a week gone is
       * old, and „ranije“ is true of both without the heading needing to know
       * which field it is drawn over.
       */
      earlier: "Earlier",
      later: "Later",
      /**
       * The trailing run: rows the banded date is simply not set on.
       *
       * „Bez datuma“ rather than „Bez roka“, and that is not pedantry: the same
       * heading is drawn over a list sorted by „Završen“, where every unfinished
       * task lands in this band — calling them „bez roka“ would state something
       * about their deadlines that the band knows nothing about.
       */
      noDate: "No date",
      /** Tooltip on the count beside a heading — a bare number cannot say what it counts. */
      countTitle: "Number of tasks in the group",
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
      title: "Lists",
      railLabel: "Task lists",
      newList: "New list",
      newSubList: "New sublist",
      listNamePlaceholder: "List name",
      renameListLabel: "Rename list",
      deleteListLabel: "Delete list",
      /** The rail row's own „⋯“ menu, which holds the two ordering actions below. */
      listMenuLabel: "List actions",
      /** The section heading's „⋯“ menu — the same two actions, one scope in. */
      sectionMenuLabel: "Section actions",
      /**
       * Shared by both menus, because it is one gesture in two scopes: a list
       * steps among its siblings, a section within its list. Always both, the
       * one at the end of its scope simply disabled — a menu whose items come
       * and go is one the user has to re-read every time.
       */
      moveUp: "Move up",
      moveDown: "Move down",
      save: "Save",
      cancel: "Cancel",
      /** Shown under the rail when a list/section action failed — the inline editor stays open with what was typed still in it. */
      actionError: "The action failed. Try again.",
      deletedNotice: "List deleted",
      /**
       * What to do with the tasks of a list being deleted. The two choices lose
       * different things, so there is no default and no primary button; Otkaži
       * is the way out that changes nothing.
       */
      dialog: {
        title: "Delete list",
        question: "What should happen to the tasks in this list?",
        /** Followed by the Inbox's own stored name in quotes — see the block comment above. */
        moveToInboxPrefix: "Move to",
        deleteTasks: "Delete the tasks too",
        cancel: "Cancel",
      },
      /** The add/edit form's heading select, shown only where the list has headings to pick. */
      sectionLabel: "Section",
      noSection: "No section",
      newSection: "New section",
      sectionNamePlaceholder: "Section name",
      renameSectionLabel: "Rename section",
      deleteSectionLabel: "Delete section",
      /**
       * A heading is a user-named container and the delete is HARD, so it takes
       * the typed-name confirmation the folder rail takes. The warning states
       * the reassuring half plainly, because it is the half that decides the
       * answer: the tasks are not deleted with it, they move to the list body.
       */
      deleteSectionDialog: {
        title: "Delete section",
        warning:
          "The section is permanently deleted. Its tasks move into the list body — none of them is lost.",
        confirmLabel: "Section name to confirm",
        confirmPlaceholder: "Enter the exact name",
        submit: "Delete",
        cancel: "Cancel",
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
      label: "Tags",
      newTag: "New tag",
      namePlaceholder: "Tag name",
      rename: "Rename",
      /** Accessible name of the rename field — the action in full, like `lists.renameSectionLabel`; the menu item itself stays the short „Preimenuj“. */
      renameLabel: "Rename tag",
      delete: "Delete tag",
      /** The rail chip's own „⋯“ menu (rename/delete one tag). */
      menuLabel: "Tag actions",
      // „Oznake zadatka" named a per-task „⋯" menu that no longer exists: tag
      // attachment was folded into the generic row menu, which announces itself
      // as `rowMenuLabel` and holds the tag checkboxes inside it. The key
      // outlived the menu and its own comment kept describing it, which is how
      // a copy table starts documenting an app that is not there.
      filterLabel: "Filter by tag",
      clearFilter: "Clear",
      actionError: "The tag action failed. Try again.",
      /** The one refusal a user can act on — a rename onto a taken name. NOTE's rail says the same about its own tags. */
      duplicate: "A tag with that name already exists.",
      /**
       * NOTE's own `deleteTagDialog`, one module over and for the identical
       * reason: `taskTagStore.delete` is a HARD delete whose links go with it
       * through the schema's CASCADE, and there is no restore endpoint behind
       * it. This rail had been deleting on a single click of a danger menu item
       * while the note rail asked — the same act, two answers.
       */
      deleteTagDialog: {
        title: "Delete tag",
        warning:
          "The tag is permanently deleted and removed from every task that carries it. The tasks themselves stay untouched.",
        confirmLabel: "Tag name to confirm",
        confirmPlaceholder: "Enter the exact name",
        submit: "Delete",
        cancel: "Cancel",
      },
      /** Shown in place of the rows when the tag filter matches nothing in the selected list. */
      filterEmptyDescription: "No task matches the selected tags.",
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
      title: "Attachments",
      attach: "Attach a file",
      /** „Pregledaj" (DOC / ADR-064) — the NOTE panel's word, offered only on rows the app can render itself. */
      preview: "Preview",
      open: "Open",
      saveAs: "Save as…",
      remove: "Remove attachment",
      /** The per-attachment „⋯“ menu, mirroring `tags.menuLabel`'s shape. */
      menuLabel: "Attachment actions",
      /** Shown when the picker refused one or more files for size. The 50 MB bound is the store's own (`MAX_TASK_ATTACHMENT_BYTES`), stated here as a plain fact rather than counted files — the count varies, the limit does not. */
      tooLarge: "Files larger than 50 MB cannot be attached.",
      actionError: "The attachment action failed. Try again.",
      /**
       * The muted row/card chip: „1 prilog“ / „3 priloga“ — Serbian numeral
       * agreement via `dayUnit`, the same two-form rule every other counted
       * noun in this file uses.
       */
      chipUnitOne: "attachment",
      chipUnitMany: "attachments",
      /** Tooltip on that chip; the number alone cannot say what it counts. */
      chipTitle: "Files attached",
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
      title: "Templates",
      /** Accessible name of the toolbar button's menu. */
      menuLabel: "Task templates",
      /** Shown in place of the list when the profile has no templates yet. */
      empty: "You have no task templates yet.",
      /** The action in a task row's „⋯“ menu. */
      saveAs: "Save as template",
      namePlaceholder: "Template name",
      /** Accessible name of the name field — the action in full, like `lists.renameSectionLabel`. */
      nameLabel: "Save task as template",
      /** Said BEFORE the fact, not after: saving under an existing name is how a template is edited. */
      overwriteNote: "The existing name is replaced.",
      /** Tooltip on a template's name in the list — the click applies it. */
      applyTitle: "Create a task from this template",
      delete: "Delete template",
      actionError: "The template action failed. Try again.",
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
      label: "Dependencies",
      /** The picker's trigger, and its accessible name — a named action, not a row's „⋯“ overflow. */
      add: "Add dependency",
      /** Placeholder and accessible name of the picker's filter field. */
      searchPlaceholder: "Search tasks",
      /** Shown in the picker when the profile has no task that could be a condition (all done, or all downstream of this one). */
      pickerEmpty: "No task can be a prerequisite.",
      /** Shown in the picker when what was typed matches nothing among the candidates. */
      pickerNoMatches: "No results.",
      /** Stands in for the list while the edited task waits on nothing. */
      none: "This task is not waiting on any other.",
      removeLabel: "Remove dependency",
      /** Beside a blocker that is already finished — the edge is real, it just no longer holds anything up. */
      doneHint: "completed",
      /** The row/card chip on a task at least one of whose blockers is still open. */
      blockedChip: "Blocked",
      blockedChipTitle: "Waiting on a task that is not finished yet",
      actionError: "The dependency action failed. Try again.",
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
      mode: "Select",
      /** Names the action bar that appears once at least one row is picked. */
      regionLabel: "Actions on selected tasks",
      /** The per-row pick control that replaces the drag grip while the mode is on. */
      pickLabel: "Select task",
      /** Followed by the number of rows picked. */
      selected: "Selected:",
      move: "Move…",
      /** Header inside the move menu — it lists the rail's lists, indented as the rail draws them. */
      moveLabel: "Move to list",
      priority: "Priority…",
      priorityLabel: "Set priority",
      due: "Due…",
      dueLabel: "Set due date",
      clearDue: "Clear due date",
      delete: "Delete",
      /**
       * Shown in the action bar when the store refused the batch. It names the
       * one refusal a user can actually run into — clearing a rok that a
       * repetition or a reminder counts from — because nothing was changed and
       * the way out is to adjust the selection.
       */
      actionError:
        "The action failed — nothing was changed. A due date cannot be cleared on a repeating task or one with a reminder.",
      /** Followed by the number of tasks the batch delete removed; the offer itself is the same one-slot undo a single delete uses. */
      deletedNotice: "Tasks deleted:",
    },
    /** Kanban column titles, keyed by task status value (labels are presentation). */
    status: {
      todo: "To do",
      doing: "In progress",
      done: "Done",
    },
    /**
     * Priority labels. `none` is the form select's own "no priority" option and
     * never becomes a chip — the row rendering skips that value entirely.
     */
    priority: {
      none: "No priority",
      low: "Low",
      medium: "Medium",
      high: "High",
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
    fieldLabel: "Repeats",
    /** Shown in place of the controls while the form has no (valid) date to phase a rule from. */
    needsDate: "Set a date to enable repeating.",
    /** The preset select, in menu order; `custom` opens the fields below it. */
    preset: {
      none: "Does not repeat",
      daily: "Every day",
      weekdays: "On weekdays",
      weekly: "Every week",
      monthly: "Every month",
      yearly: "Every year",
      custom: "Custom…",
    },
    freqLabel: "Frequency",
    freq: {
      daily: "Daily",
      weekdays: "Weekdays",
      weekly: "Weekly",
      monthly: "Monthly",
      yearly: "Yearly",
    },
    intervalLabel: "Every",
    daysLabel: "Days",
    /** Monday-first, matching `RecurrenceWeekday`'s own 0 = Monday indexing. */
    weekdayShort: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    weekday: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    monthlyModeLabel: "Mode",
    monthlyModeDate: "By date",
    monthlyModeOrdinal: "By weekday",
    monthDayLabel: "Day of month",
    ordinalLabel: "Position",
    /**
     * Keyed by `RecurrenceOrdinal` as a string; `-1` is the month's last such
     * weekday. Rendered as its own select beside the weekday's, never joined
     * into a phrase — "prvi" agrees with utorak but not with sreda.
     */
    ordinal: {
      "1": "first",
      "2": "second",
      "3": "third",
      "4": "fourth",
      "-1": "last",
    } satisfies Record<string, string>,
    weekdayLabel: "Day",
    endLabel: "End",
    endNever: "Never",
    endUntil: "On a date",
    endCount: "After N repeats",
    endUntilLabel: "End date",
    endCountLabel: "Number of repeats",
    endCountUnit: "repeats",
    /** Accessible name of the ↻ marker on a recurring row/chip. */
    marker: "Repeats",
    /** After completing one occurrence of a recurring task; the next date follows. */
    nextOccurrence: "Next:",
    /**
     * The three-way scope dialog. PRD 04: editing or deleting one occurrence of
     * a series never picks a scope silently, so this is a real choice with no
     * default — Otkaži is the only way out that changes nothing.
     */
    scope: {
      title: "Repeating event",
      questionEdit: "Which occurrences does the change apply to?",
      questionDelete: "Which occurrences should be deleted?",
      this: "This one only",
      future: "This and future ones",
      all: "All",
      cancel: "Cancel",
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
      heading: "Writing rhythm",
      caption:
        "One square is one day. The day a note was created and the day of its last edit are counted — earlier edits are not remembered, so this is the least that happened, not an exact total.",
      descriptionLead: "Writing rhythm",
      descriptionDays: "days with writing",
      legendSome: "One or two",
      legendMore: "Three to five",
      legendMost: "Six or more",
      emptyReason: "The rhythm appears as soon as there is at least one note.",
      /**
       * The three figures in the band the rhythm is drawn beside. Two are
       * exact counts of rows the page genuinely loaded; the middle one is a
       * FLOOR, and its `note` says so in the same breath — a lower bound set
       * in 24px type reads as a total unless the drawing itself objects.
       */
      statNotes: "Notes",
      statDays: "Days with writing",
      /** Reads as „47 od 182" — the denominator is how many days are actually drawn, not the window's nominal length. */
      statDaysOf: "of",
      statDaysNote: "At least that many — the creation day and the day of the last edit are remembered, nothing in between.",
      statPinned: "Pinned",
    },
    newNote: "New note",
    untitled: "Untitled",
    listEmptyTitle: "No notes",
    listEmptyDescription:
      "Create your first note with the button above — you write in the editor on the right.",
    noSelectionTitle: "No note is selected",
    noSelectionDescription: "Pick a note on the left or create a new one.",
    placeholder: "Start writing, or type “/” for commands…",
    deleteLabel: "Delete note",
    deletedNotice: "Note deleted",
    /**
     * „Dupliraj" (NOTE-010). The copy's own „ (kopija)" mark is written into
     * the document by the main process and therefore lives there
     * (`main/noteDuplicate.ts`) — main cannot import this file, the same split
     * `notificationStrings.ts` documents.
     */
    duplicate: "Duplicate",
    duplicateError: "Duplicating the note failed. Try again.",
    duplicateTooLarge: "The note is too large to duplicate in one go.",
    undo: "Undo",
    dismiss: "Dismiss",
    loadError: "Notes cannot be loaded right now. Try again later.",
    editorLoadError: "The note cannot be loaded. Try again.",
    saveError: "Saving the note failed — we will try again on your next edit.",
    saveTooLarge:
      "Part of the note is too large to save in one go. Split the large pasted content into smaller parts.",
    /** Organizer (slice a3b): the folder tree, filters, per-note pin/move. */
    allNotes: "All notes",
    unfiled: "No folder",
    foldersLabel: "Folders",
    newFolder: "New folder",
    newSubfolder: "New subfolder",
    renameFolder: "Rename",
    recolorFolder: "Change colour",
    /** Heading over the folder's own move menu — the note row's „Premesti u fasciklu", one axis up. */
    moveFolderTo: "Move to",
    /** Out of every folder, to the top of the tree — a folder's „Bez fascikle". */
    folderToRoot: "To the top",
    deleteFolder: "Delete folder",
    noColor: "No colour",
    folderNamePlaceholder: "Folder name",
    folderMenuLabel: "Folder actions",
    /** Folder preferences (ADR-036): the default template submenu + the quick-capture toggle. */
    folderTemplate: "Default template",
    folderTemplateNone: "No template",
    folderCaptureDefault: "Quick-capture folder",
    folderCaptureDefaultOn: "A new note with no context goes here.",
    moveToFolder: "Move to folder",
    noteMenuLabel: "More options",
    pin: "Pin",
    unpin: "Unpin",
    /**
     * The per-folder view toggle (NOTE-002). The same two words the TASK
     * toggle uses for the same two shapes — one vocabulary across the app —
     * keyed by the stored value, so the toggle names a shape by looking it up
     * rather than by a parallel list that could fall out of step with the set.
     */
    viewLabel: "View",
    viewNames: {
      list: "List",
      cards: "Cards",
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
      pinned: "Pinned",
      today: "Today",
      yesterday: "Yesterday",
      week: "Last 7 days",
      month: "This month",
    },
    save: "Save",
    cancel: "Cancel",
    folderError: "The folder action failed. Try again.",
    /**
     * The typed-name confirmation before a folder delete (no undo exists for
     * this write, unlike a note's — see `TypedConfirmDialog`, shared outright
     * with PRIV's own hard-delete). Nothing inside the folder is lost: its
     * subfolders and notes are promoted to its own parent first, which is
     * exactly what the warning says.
     */
    deleteFolderDialog: {
      title: "Delete folder",
      warning:
        "The folder is permanently deleted. Its subfolders and notes move to the parent folder — none of them is lost.",
      confirmLabel: "Folder name to confirm",
      confirmPlaceholder: "Enter the exact name",
      submit: "Delete",
      cancel: "Cancel",
    },
    /** Tags (slice a3b-2): filter chips + tag CRUD + per-note tag editor. */
    tagsLabel: "Tags",
    newTag: "New tag",
    tagNamePlaceholder: "Tag name",
    renameTag: "Rename",
    deleteTag: "Delete tag",
    tagMenuLabel: "Tag actions",
    tagFilterLabel: "Filter by tag",
    clearTagFilter: "Clear",
    tagError: "The tag action failed. Try again.",
    /** The one refusal a user can act on: the name is taken. FIN has said this since its rail shipped; this rail asked for a retry that could not work. */
    tagDuplicate: "A tag with that name already exists.",
    tagFilterEmptyDescription: "No note matches the selected tags.",
    /** The typed-name confirmation before a tag delete — no undo exists for this write. */
    deleteTagDialog: {
      title: "Delete tag",
      warning: "The tag is permanently deleted and removed from every note that carries it. The notes themselves stay untouched.",
      confirmLabel: "Tag name to confirm",
      confirmPlaceholder: "Enter the exact name",
      submit: "Delete",
      cancel: "Cancel",
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
    categoriesLabel: "Categories",
    newCategory: "New category",
    categoryNamePlaceholder: "Category name",
    renameCategory: "Rename",
    recolorCategory: "Change colour",
    deleteCategory: "Delete category",
    categoryMenuLabel: "Category actions",
    categoryFilterLabel: "Filter by category",
    clearCategoryFilter: "Clear",
    categoryError: "The category action failed. Try again.",
    /** As `tagDuplicate`: the store refuses a duplicate name, so the line names that instead of asking for a retry against a UNIQUE index. */
    categoryDuplicate: "A category with that name already exists.",
    categoryFilterEmptyDescription: "No note belongs to the selected categories.",
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
    filterEmptyTitle: "No notes match these filters",
    filterEmptyClear: "Clear filters",
    /** The typed-name confirmation before a category delete — no undo exists for this write. Its notes are never deleted, only uncategorized (see the store's own `ON DELETE SET NULL`). */
    deleteCategoryDialog: {
      title: "Delete category",
      warning: "The category is permanently deleted. Notes in it become uncategorised — none is deleted.",
      confirmLabel: "Category name to confirm",
      confirmPlaceholder: "Enter the exact name",
      submit: "Delete",
      cancel: "Cancel",
    },
    /** The per-note picker in the row menu — „Bez kategorije“ is a real choice there, not an empty state. */
    noteCategoryLabel: "Category",
    noCategory: "No category",
    /** Wiki-links (slice b): the `[[` link menu + the backlinks panel. */
    backlinksTitle: "Backlinks",
    wikiLinkMissing: "Missing note",
    /** Attachments (NOTE-003b): the Prilozi panel + in-document image blocks. */
    attachmentsTitle: "Attachments",
    attach: "Attach a file",
    /** „Pregledaj" (DOC / ADR-064) — offered only on rows the app can render itself; the dialog's own copy lives in `attachmentPreview` below. */
    attachmentPreview: "Preview",
    attachmentOpen: "Open",
    attachmentSaveAs: "Save as…",
    attachmentRemove: "Remove attachment",
    attachmentMenuLabel: "Attachment actions",
    attachmentTooLarge: "The file is larger than 50 MB and cannot be attached.",
    attachmentError: "The attachment action failed. Try again.",
    attachmentMissing: "The attachment was removed.",
    /** Version history (NOTE-008b): the in-pane browser + restore flow. */
    historyTitle: "Version history",
    historyOpen: "Version history",
    backToEditing: "Back to editing",
    historyEmpty: "No saved versions yet — they are created automatically while you write.",
    historyRestore: "Restore this version",
    historyRestoreNote: "The current state is saved automatically as a version before restoring.",
    historyError: "The version action failed. Try again.",
    /** Templates (NOTE-009b): the in-pane picker, save-as-template, manage. */
    templatesTitle: "Templates",
    templatesOpen: "Templates",
    templatesBuiltinGroup: "Built-in",
    templatesUserGroup: "My templates",
    templatesUserEmpty: "You have no templates of your own yet.",
    templateInsert: "Insert template",
    templateInsertNote: "The template is added at the end of the note.",
    templateSaveAs: "Save as template",
    templateSaveNote: "Attachments are not saved in a template.",
    templateNamePlaceholder: "Template name",
    templateOverwriteNote: "A template with that name already exists — it will be replaced.",
    templateRename: "Rename",
    templateDelete: "Delete template",
    templateMenuLabel: "Template actions",
    templateBroken: "This template cannot be displayed.",
    templateTooLarge: "The note is too large to be saved as a template.",
    templateError: "The template action failed. Try again.",
    /**
     * Only a RENAME can hit this — saving is an upsert and replaces instead of
     * refusing, which is what `templateOverwriteNote` says. „Biće zamenjen" is
     * therefore false for a rename, so this one gets its own sentence rather
     * than borrowing that one.
     */
    templateNameTaken: "A template with that name already exists.",
    /** Prefix for a template's slash-menu label (NOTE-009c), e.g. "Šablon: Sastanak". */
    slashTemplatePrefix: "Template: ",
    templateBuiltins: {
      sastanak: "Meeting",
      dnevnik: "Journal",
      recept: "Recipe",
      predmet: "Subject",
      projekat: "Project",
    },
    /** Slash-menu command labels (block conversions), in menu order. */
    slash: {
      paragraph: "Paragraph",
      heading1: "Heading 1",
      heading2: "Heading 2",
      heading3: "Heading 3",
      bulletList: "Bullet list",
      orderedList: "Numbered list",
      taskList: "Task list",
      blockquote: "Quote",
      codeBlock: "Code block",
      divider: "Divider",
      calloutInfo: "Callout: note",
      calloutTip: "Callout: tip",
      calloutWarning: "Callout: warning",
      calloutDanger: "Callout: danger",
      toggle: "Toggle section",
      tableOfContents: "Table of contents",
      flashcard: "Card (question :: answer)",
      /** Wraps the selection in a new `{{cN::…}}` deletion, numbered for the author (ADR-068). */
      clozeBlank: "Blank (cloze)",
    },
    /**
     * Callout variants (NOTE-011). These name the block for a screen reader —
     * the block itself carries no visible label, so colour is not the only
     * thing distinguishing a warning from a note.
     */
    callout: {
      info: "Note",
      tip: "Tip",
      warning: "Warning",
      danger: "Danger",
    },
    /** The collapsible section's chevron (NOTE-011) — its label states what the click will do. */
    toggleExpand: "Expand section",
    toggleCollapse: "Collapse section",
    /** The live table of contents (NOTE-011). */
    tocTitle: "Table of contents",
    tocEmpty: "This note has no headings.",
    /** Inline flashcards (NOTE-006c / ADR-017): the `::` / `{{…}}` syntax + the deck-mapping bar. */
    cardsLabel: "Cards",
    cardsUnmapped: "This note creates study cards. Pick a deck:",
    cardsDeckSelectLabel: "Card deck",
    cardsDeckPlaceholder: "Choose a deck",
    cardsNoDecks: "Create a deck in the Study module so the cards from this note have somewhere to go.",
    cardsDeckPrefix: "Deck: ",
    cardsChangeDeck: "Change deck",
    cardsCancelChange: "Cancel",
    cardsError: "The cards were not saved. Try again.",
    cardScaffold: "Question :: Answer",
    /**
     * What becomes of the flashcards a note generated when the note is deleted
     * (PRD 09 §7). The two choices lose different things — one keeps the review
     * history in the deck, the other takes those cards out of study — so there
     * is no default and no primary button; Otkaži is the way out that changes
     * nothing. A note that generated no cards is never asked.
     */
    cardsDialog: {
      title: "Delete note",
      /**
       * The counted phrase, e.g. „3 kartice nastale iz ove beleške“. Noun and
       * participle inflect together in Serbian (1 / 2–4 / 5+), so the whole
       * phrase goes through `countUnit` rather than the noun alone.
       */
      countOne: "card made from this note",
      countFew: "cards made from this note",
      countMany: "cards made from this note",
      question: "What should happen to them?",
      /** Says what „keep“ means, since the cards outlive the note that wrote them. */
      keepNote: "Kept cards stay in their deck, with their study history.",
      keep: "Keep the cards",
      deleteCards: "Delete the cards too",
      cancel: "Cancel",
    },
    /** The undo bar after „Obriši i kartice“ — it took more than the note, and says so. */
    deletedWithCardsNotice: "Note and cards deleted",
    /**
     * „Pretvori u zadatke“ (NOTE §6). The editor's checkboxes are a mark on the
     * page and nothing more; this is the one action that promotes them into real
     * TASK rows. Offered only when the note actually has rows to convert (the
     * `cards-count` probe's own rule), so `empty` is what a note WITHOUT them
     * hears instead of a dialog that could only report doing nothing.
     */
    checklistTasks: {
      /** The row „⋯“ entry. A verb: it says what pressing it does, not what the note contains. */
      action: "Convert to tasks",
      title: "Convert to tasks",
      /** The counted phrase, e.g. „3 stavke iz liste u ovoj belešci“ — noun and preposition inflect together, hence `countUnit`. */
      countOne: "item from the checklist in this note",
      countFew: "items from the checklist in this note",
      countMany: "items from the checklist in this note",
      question: "Pick the task list they should go into.",
      /** The non-destructive rule, said before the action rather than discovered after it. */
      keepNote: "The note stays unchanged — the list is copied, not moved.",
      listLabel: "Task list",
      convert: "Convert",
      cancel: "Cancel",
      /** „Napravljeno 3 zadatka“ — the `markdownImport` result recipe: an invariant participle + `countUnit`. */
      createdPrefix: "Created",
      createdUnitOne: "task",
      createdUnitFew: "tasks",
      createdUnitMany: "tasks",
      /** Appended only when a ticked box carried across: „, od toga 2 već završena“. */
      completedPrefix: "of them",
      completedUnitOne: "already done",
      completedUnitFew: "already done",
      completedUnitMany: "already done",
      /** Appended only when a row had no text to be a title: „Preskočeno 2 prazna reda.“ */
      skippedPrefix: "Skipped",
      skippedUnitOne: "blank line",
      skippedUnitFew: "blank lines",
      skippedUnitMany: "blank lines",
      /** What a note with no checklist hears — a statement, not a failure. */
      empty: "This note has no checklist.",
      error: "The tasks were not created. Try again.",
      /** The picker has nothing to offer only if the profile has no lists at all, which the Inbox makes impossible — said anyway rather than showing an empty select. */
      noLists: "Create a list in the Tasks module so the items have somewhere to go.",
      /** Shown instead of `noLists` when the fetch itself rejected — an empty picker must not be read as "this profile has no lists". */
      loadError: "Task lists cannot be loaded right now. Try again.",
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
      regionLabel: "Find in note",
      placeholder: "Find in note",
      /** The counter slot's own name — it announces „3/17“, which says nothing on its own. */
      countLabel: "Matches in note",
      /** Stands in the counter slot when the query matches nothing. Quiet: a full stop, no exclamation, no icon. */
      noResults: "No results.",
      previous: "Previous",
      next: "Next",
      /** The case toggle reads „Aa“; what it does is in its title, since two letters cannot say it. */
      caseLabel: "Aa",
      caseTitle: "Match case",
      /**
       * Reveals the replace row. A NOUN („Zamena“) rather than the verb, so it
       * can never be mistaken for the „Zameni“ button it uncovers.
       */
      replaceToggle: "Replace",
      replacePlaceholder: "Replace with",
      replace: "Replace",
      replaceAll: "Replace all",
      close: "Close",
    },
    /** „Premesti u Privatno“ (ADR-057 §5) — the row-menu action and its typed-confirm dialog. Offered only while the private section is unlocked. */
    moveToPriv: {
      action: "Move to Private",
      title: "Move to Private",
      warning:
        "The note is encrypted and disappears from Notes, search, exports and backups — its version history and links to other notes are deleted.",
      /** The two things that deliberately SURVIVE the move, said before the field. */
      keepNote:
        "Study cards made from the note stay in their deck, with no link to it; tasks made from its checklist stay in Tasks.",
      confirmLabel: "Note title to confirm",
      confirmPlaceholder: "Enter the exact title",
      submit: "Move",
      cancel: "Cancel",
      tooLarge: "The note is too large for the private section.",
      tooManyAttachments: "The note has too many attachments — a private note carries at most 50.",
      error: "Moving failed. Nothing was changed — try again.",
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
      "There is deliberately no chart here. A picture showing when and how much you use private notes is itself data about you — and it can be read over your shoulder.",
    /** First open, nothing set up yet: the two-sentence honest explanation, the credential choice, the kit step. */
    setup: {
      title: "Private notes",
      // ADR-057 §6 changed the export half of this promise: private notes CAN
      // ride in a manual, password-protected export while the section is
      // unlocked — automatic backups still never carry them.
      intro:
        "Private notes are encrypted with a separate key and readable only while this section is unlocked — they do not appear in search, on the dashboard or in automatic backups. They are included in a manual export only while the section is unlocked, and only with the archive password.",
      introSecond:
        "If you lose both the password and the recovery code, the content is irrecoverably lost — there is no back door, not for you and not for the app.",
      credentialLabel: "What unlocks this section",
      useAccountPasscode: "The account passcode",
      useAccountPasscodeNote: "The same code that unlocks the app unlocks this section.",
      useSeparate: "A separate password",
      useSeparateNote: "A password only you know — whoever knows the account code does not know this too.",
      accountPasscodeLabel: "Account passcode",
      accountPasscodePlaceholder: "Enter your passcode",
      passphraseLabel: "Private notes password",
      passphrasePlaceholder: "At least 8 characters, a letter and a digit",
      confirmLabel: "Confirm password",
      confirmPlaceholder: "Repeat the password",
      kitLabel: "Recovery code",
      kitRegenerate: "Regenerate the recovery code",
      kitRegenerateNote:
        "A new recovery code is made that opens both the account and the private notes. The old code stops working immediately — write the new one over it.",
      kitOptOut: "No recovery code",
      kitOptOutNote:
        "A forgotten password then means permanently lost private notes. There is no third way.",
      /** The informed opt-out's own gate — the dead end, restated as the thing being agreed to. */
      kitOptOutConfirm: "I understand: without the password and without the code, private notes are irrecoverable.",
      submit: "Turn on private notes",
      mismatch: "The passwords do not match.",
      weak: "The password must be at least 8 characters, with at least one letter and one digit.",
      alreadySetUp: "The section is already set up — unlock it with your password.",
    },
    /** Set up but locked: one field, the throttle countdown reuses the lock screen's own prefix. */
    lock: {
      title: "Private notes are locked",
      description: "Enter the private notes password. While they are locked, the content is encrypted and out of reach.",
      descriptionAccount: "Enter the account passcode. While they are locked, the content is encrypted and out of reach.",
      fieldLabel: "Password",
      fieldLabelAccount: "Passcode",
      placeholder: "Enter your password",
      placeholderAccount: "Enter your passcode",
      submit: "Unlock",
      wrongCredential: "Wrong password.",
      wrongPasscode: "Wrong passcode.",
      error: "Unlocking failed. Try again.",
    },
    /** The unlocked section: header, list, search, delete. */
    section: {
      lockNow: "Lock",
      newNote: "New note",
      searchLabel: "Search private notes",
      searchPlaceholder: "Search private notes…",
      emptyTitle: "No private notes",
      emptyDescription: "Make your first one with the button above — everything here stays encrypted on disk.",
      searchEmpty: "No private note matches your search.",
      /** A row whose sealed container no longer opens: named, dead, honest. */
      unreadable: "Unreadable note",
      loadError: "Private notes cannot be loaded right now. Try again.",
      noSelectionTitle: "No note is selected",
      noSelectionDescription: "Pick a note on the left or make a new one.",
      deleteLabel: "Delete",
      moveOut: "Move to Notes",
      noteMenuLabel: "More options",
    },
    /** The private editor's own surfaces — save channel, attachments, the honest v1 limits. */
    editor: {
      loadError: "The note cannot be opened. Try again.",
      saveError: "Saving failed — we will try again on your next edit.",
      saveTooLarge: "The note is too large to save. Shorten it or split it into several notes.",
      attachmentsTitle: "Attachments",
      attach: "Attach a file",
      attachmentTooLarge: "The file is larger than 100 MB and cannot be attached.",
      attachmentError: "Attaching failed. Try again.",
      /** The recorded v1 limit, said where the files live: no external opening, no plaintext temp copies. */
      attachmentsNote:
        "Attachments are encrypted and open only here, while the section is unlocked — never in outside programs.",
      /**
       * The sealed version history (ADR-057) — the private twin of „Istorija
       * verzija". Verzije su šifrovane kao i sama beleška, pa se otvara jedna
       * po jedna, i sve to postoji samo dok je sekcija otključana.
       */
      history: {
        open: "Version history",
        back: "Back to editing",
        title: "Version history",
        empty:
          "No saved versions yet — they are created automatically while you write and when the note closes.",
        restore: "Restore this version",
        restoreNote: "The current state is saved as a version before restoring, so this step is reversible too.",
        error: "The version action failed. Try again.",
        /** The preview column's label for the selected version's own title. */
        previewLabel: "Title in this version",
      },
    },
    /**
     * The best-effort clipboard guard (PRIV-012): copying inside the section
     * offers a 30-second auto-clear. Honest about its own reach — clearing
     * needs the app focused at that moment, and another copy elsewhere
     * replaces the content anyway.
     */
    clipboard: {
      notice: "Copied — the clipboard is cleared after 30 s if Nexus is in the foreground then.",
      cancel: "Keep on the clipboard",
    },
    /** Typed-confirm HARD delete — no trash, no undo, and the copy says so before the field. */
    deleteDialog: {
      title: "Delete private note",
      warning: "The note and its attachments will be deleted immediately and permanently. There is no bin and no undo.",
      confirmLabel: "Note title to confirm",
      confirmPlaceholder: "Enter the exact title",
      submit: "Delete permanently",
      cancel: "Cancel",
      error: "Deleting failed. Try again.",
    },
    /** „Premesti u Beleške“ — the move OUT, with the consequence stated plainly: it becomes searchable. */
    moveOutDialog: {
      title: "Move to Notes",
      warning:
        "The note is decrypted and becomes an ordinary note — visible in Notes, in search, in exports and backups.",
      confirmLabel: "Note title to confirm",
      confirmPlaceholder: "Enter the exact title",
      submit: "Move",
      cancel: "Cancel",
      tooLarge: "The note is too large to move in one go.",
      error: "Moving failed. Nothing was changed — try again.",
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
      heading: "Hour of day",
      caption:
        "How many events start in each hour, across the period currently on screen. All-day events have no hour and do not enter this ring.",
      descriptionLead: "Hour of day",
      descriptionBusiest: "busiest at",
      hourSuffix: "h",
      emptyReason:
        "The ring appears as soon as there is at least one timed event in the period shown.",
    },
    viewLabel: "View",
    viewMesec: "Month",
    viewNedelja: "Week",
    viewDan: "Day",
    viewSemestar: "Semester",
    viewAgenda: "Agenda",
    viewDokumenta: "Documents",
    viewLjudi: "People",
    /**
     * Drawn above the field, not inside it. It was both — a `titlePlaceholder`
     * and a `titleLabel` holding the same string, one of them grey and gone
     * the moment anything was typed — until DC-120 step 2 kept the one that
     * stays on screen.
     */
    titleLabel: "Event title",
    dateLabel: "Date",
    /**
     * „Od", not „Vreme". It was the latter while it was an `aria-label` a
     * screen reader read on its own; drawn on screen it stands beside
     * `endTimeLabel`, and „Vreme"/„Do" is half a pair.
     */
    timeLabel: "From",
    /** End-time field (week/day view, ADR-020) — next to the start-time field, timed events only. */
    endTimeLabel: "To",
    /** Client-side guard mirroring EventStore's own "end must not be before start" check. */
    endBeforeStart: "The end time must be after the start time.",
    /** Submitting the form with no title types in — said instead of doing nothing. */
    invalidTitle: "Enter an event title.",
    /** Defensive twin of `invalidTitle`: the date field is `required`, so this is normally unreachable, but a silent no-op is never the fallback. */
    invalidDate: "Pick an event date.",
    /** The form's own save failing at the store/IPC boundary. */
    saveError: "The event was not saved. Try again.",
    /**
     * The parenthesis came from the placeholder this replaced, and is the
     * reason the label is not simply „Mesto“: it is the one thing the grey
     * text said that the name did not, and it said it only while the field
     * was empty. The same shape as `devtools.system.altLabel` and the
     * finance year field — an optional field says so in its own name.
     */
    locationLabel: "Location (optional)",
    allDay: "All day",
    add: "Add",
    save: "Save",
    cancel: "Cancel",
    editLabel: "Edit event",
    deleteLabel: "Delete event",
    emptyTitle: "No events",
    emptyDescription: "Add your first event in the form above — a title and a date are enough.",
    loadError: "Events cannot be loaded right now. Try again later.",
    deletedNotice: "Event deleted",
    undo: "Undo",
    dismiss: "Dismiss",
    /** Generic fallback for delete/undo/move/series-resolve failures — the HABIT `actionError` shape, outside the live form. */
    actionError: "The action failed. Try again.",
    /** Source-filter toggle chips (month grid + agenda share one set of toggles). */
    sourcesLabel: "Sources",
    sourceEvents: "Events",
    sourceTasks: "Tasks",
    sourceExams: "Exams",
    sourceBlocks: "Study",
    sourceBirthdays: "Birthdays",
    /** FIN slice d: the days a subscription's rule says money goes out. */
    sourceSubscriptions: "Subscriptions",
    /**
     * The cross-profile overlay chip (CAL-005 / ADR-058 §5) — labelled by what
     * it SHOWS, so the pair is kind-dependent: „Poslovni kalendar“ while the
     * personal profile is active, „Privatni kalendar“ while the business one
     * is. The chip exists only when the account has another profile at all.
     */
    sourceOverlayBusiness: "Business calendar",
    sourceOverlayPrivate: "Private calendar",
    /**
     * The foreign items that chip brings in: read-only guests. The ⇄ glyph
     * marks each one; clicking opens a small popover headed by the origin
     * profile's own name, and its one action routes through the same
     * passcode-gated switch every profile change passes (AUTH-024).
     */
    overlay: {
      /** Accessible name of the ⇄ origin glyph. */
      markerLabel: "Event from another profile",
      /** Accessible name of the origin popover (and of the agenda row's „⋯“ that opens it); the visible heading is the profile's name. */
      popoverLabel: "Event origin",
      /** Why the event cannot be opened here — said in the popover, before the one action it offers. */
      originNote: "The event belongs to this profile and cannot be changed here.",
      switchAction: "Switch profile",
      /** Quiet inline line when the overlay fetch fails; the profile's own calendar is unaffected. */
      loadError: "The other profile's calendar cannot be loaded right now.",
    },
    /**
     * The "Podsetnici" chip row on the event form (CAL-006). Every chip's label
     * is built from these by one formatter, so the fixed ladder and an offset
     * loaded from a stored event read the same way: "U vreme početka",
     * "10 min ranije", "1 h ranije", "1 dan ranije", "3 dana ranije".
     */
    reminders: {
      label: "Reminders",
      atStart: "At the start time",
      minutesUnit: "min",
      hoursUnit: "h",
      /** Trailing word of every non-zero lead time; the day form takes `dayUnit`. */
      before: "before",
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
      title: "Templates",
      /** Accessible name of the toolbar button's menu. */
      menuLabel: "Event templates",
      /** Shown in place of the list when the profile has no templates yet. */
      empty: "You have no event templates yet.",
      /** The action in the „⋯“ menu beside the open event's form. */
      saveAs: "Save as template",
      /** Accessible name of that „⋯“ menu — the surface it belongs to, said in full. */
      saveMenuLabel: "Template for this event",
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
      nameLabel: "Template name",
      /** Said BEFORE the fact, not after: saving under an existing name is how a template is edited. */
      overwriteNote: "The existing name is replaced.",
      /** Tooltip on a template's name in the list — the click applies it. */
      applyTitle: "Create an event from this template",
      /** Caption above the list: a template carries no date, so the day it lands on is worth naming out loud. */
      applyDayLabel: "Applied to",
      delete: "Delete template",
      actionError: "The template action failed. Try again.",
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
      abbrev: "wk",
      /** Hover text — says out loud which of the several week numberings this is. */
      title: "Week of year (ISO 8601)",
    },
    /**
     * Semestar (CAL-010) — four months at once: the month the calendar is on
     * plus the next three, each day carrying only how much it holds. It is an
     * overview and nothing else — no drag, no creating, one click that opens
     * the day it names.
     */
    semester: {
      /** Accessible name of the four-month grid. */
      regionLabel: "Semester overview",
      /** Caption under the grid — what a dot and a ring mean, said once. */
      legend: "Dot — a day with commitments · ring — an exam",
      /** One quiet line while no term is set (ADR-054) — plain text, not a link; it names where the dates live. */
      unsetHint: "Set the semester dates in Settings.",
      /** Said when a set term runs past six months and the grid shows only its first six. */
      truncated: "The semester is longer than six months — the first six are shown.",
      /** Appended to a day's accessible name when it holds something: „3 stavke“. */
      itemsOne: "item",
      itemsFew: "items",
      itemsMany: "items",
      /** Appended to that name when the day holds an exam — what its ring says. */
      examMark: "exam",
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
    taskTag: "Task",
    /** Tag chip on a read-only renewal row in the agenda (FIN slice d). */
    subscriptionTag: "Subscription",
    /** Grid navigation (ADR-020): prev/today/next — one pair of labels shared by Mesec/Nedelja/Dan, since each shifts by its own period. */
    prevPeriod: "Previous period",
    nextPeriod: "Next period",
    today: "Today",
    showMore: "more",
    showLess: "Show less",
    /**
     * The Ljudi panel (CAL-007). Month names are NOT listed here: they are
     * derived from `Intl.DateTimeFormat` with `{ month: "long" }`, the
     * same source every other date label on this page already reads, so the
     * select and the rows cannot drift from the calendar's own wording.
     */
    people: {
      /** Kind labels, keyed by person-kind value (labels are presentation). */
      kind: {
        birthday: "Birthday",
        anniversary: "Anniversary",
      },
      /**
       * Drawn above the field (DC-120 step 2). „Ime", not the „Ime osobe"
       * that used to sit inside it as grey text: a label stands under a
       * heading that already says whose panel this is, where a placeholder
       * standing alone had to say „of a person" out loud.
       */
      nameLabel: "First name",
      kindLabel: "Type",
      dayLabel: "Day",
      monthLabel: "Month",
      yearLabel: "Year (optional)",
      /**
       * „(opciono)" came from the placeholder this replaced — the one thing
       * the grey text said that the name did not, said only while the field
       * was empty. `documents.notesLabel` and `calendar.locationLabel` took
       * the same parenthesis for the same reason.
       */
      noteLabel: "Note (optional)",
      add: "Add",
      save: "Save",
      cancel: "Cancel",
      editLabel: "Edit person",
      deleteLabel: "Delete person",
      emptyTitle: "No people",
      emptyDescription: "Add your first person in the form above — a name, a type and a date are enough.",
      loadError: "People cannot be loaded right now. Try again later.",
      /** Client-side guard mirroring PeopleStore's own (month, day) pair check. */
      invalidDate: "That date does not exist in any month.",
      saveError: "The person was not saved. Try again.",
      deletedNotice: "Person deleted",
      undo: "Undo",
      dismiss: "Dismiss",
      /**
       * Age / anniversary count on a row: "1996 · 30 god." The abbreviated
       * "god." is deliberate — it is correct at every number, while the spelled
       * forms need three (1 godina / 2–4 godine / 5+ godina) and `dayUnit`
       * knows two.
       */
      yearsUnit: "yrs",
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
      heading: "Deadlines",
      caption:
        "Time runs along the horizontal axis and the vertical line is today. A bar is drawn only where a renewal is recorded — a document with no renewal history has no known start of validity, so it carries only a deadline marker.",
      descriptionLead: "Deadlines",
      descriptionDocuments: "documents",
      descriptionSoonest: "first to expire",
      descriptionExpired: "expired",
      todayLabel: "today",
      emptyReason: "The timeline appears as soon as you add your first document with a deadline.",
    },
    /** Type-label map, keyed by document type value (labels are presentation). */
    type: {
      licna_karta: "ID card",
      pasos: "Passport",
      vozacka: "Driving licence",
      registracija: "Vehicle registration",
      kartica: "Bank card",
      polisa: "Insurance policy",
      custom: "Other",
    },
    /** Status-chip labels, keyed by derived expiry status value. */
    status: {
      ok: "OK",
      uskoro: "Expiring soon",
      istekao: "Expired",
    },
    typeLabel: "Document type",
    /**
     * Drawn above the field. It was a `labelPlaceholder` and a `labelLabel`
     * holding the same string — one grey and gone the moment anything was
     * typed — until DC-120 step 2 kept the one that stays on screen.
     */
    labelLabel: "Document name",
    expiryLabel: "Expires",
    /**
     * „(opciono)" came from the placeholder this replaced: it was the one
     * thing the grey text said that the name did not, and it said it only
     * while the field was empty. `calendar.locationLabel` took the same
     * parenthesis for the same reason on the same day.
     */
    notesLabel: "Note (optional)",
    add: "Add",
    save: "Save",
    cancel: "Cancel",
    renew: "Renew",
    /**
     * „Novi rok", not „Novi datum isteka", and the two words came off a
     * measurement rather than a preference. Drawn (DC-120 step 2) this is a
     * caption INSIDE a list row's trailing edge, beside the date box and two
     * buttons, and at the 900px minimum the longer string took enough of the
     * line that the row's own document name truncated to „Poli…". „Rok" is
     * the panel's own word for the same thing — the block above the list is
     * headed „ROKOVI" — so the short form is not a shortening of the meaning.
     */
    renewLabel: "New deadline",
    renewConfirm: "Confirm",
    renewCancel: "Cancel renewal",
    /**
     * The renewal ledger (migration 004), shown under the open renew form. It
     * had been written on every renewal and readable nowhere in the app — the
     * `documents:renewals` channel existed end to end with no caller — so a
     * document's own history lived only inside the export archive.
     */
    renewalsTitle: "Earlier renewals",
    /** „obnovljeno 5. maj 2026 — do 5. maj 2026" — what the old expiry WAS. */
    renewalsPrevious: "to",
    /** A real answer: this document has never been renewed. Distinct from the two lines below it. */
    renewalsEmpty: "This document has not been renewed yet.",
    renewalsError: "The renewal history cannot be loaded.",
    editLabel: "Edit document",
    deleteLabel: "Delete document",
    emptyTitle: "No documents",
    emptyDescription:
      "Add your first document in the form above — a type, a name and an expiry date are enough.",
    loadError: "Documents cannot be loaded right now. Try again later.",
    deletedNotice: "Document deleted",
    undo: "Undo",
    dismiss: "Dismiss",
    /** Days-until phrasing; "za N dana" / "isteklo pre N dan(a)" build inline. */
    days: {
      tomorrow: "tomorrow",
      today: "expires today",
      future: "in",
      pastPrefix: "expired",
      unitOne: "day",
      unitMany: "days",
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
      label: "Reminders",
      /**
       * The zero-day chip. No chip offers it — the offered set starts at one
       * day, because a warning on the expiry day tells nobody anything they can
       * still act on — so this is reachable only through the union, for a
       * ladder that arrived from another device carrying one.
       */
      atDue: "On the due date",
      /**
       * Trailing word of every non-zero lead time; the counted day noun is
       * `days.unitOne` / `days.unitMany`, the block the row's countdown uses.
       */
      before: "before",
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
      heading: "What takes up space",
      caption: "Total size by file type.",
      descriptionLead: "What takes up space",
      emptyReason: "The overview appears as soon as there is at least one attached file.",
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
      lead: "Showing the",
      newest: "newest.",
      chartTail: "newest files, so this is the least they take up — not the total.",
    },
    /** Said once, under the band, when the read was capped — the advice, not the number. */
    truncatedAdvice: "Narrow the search or filters to see the rest.",
    /**
     * The band above the graphic. Two figures, both derived from exactly the rows
     * on screen — and when the read hit its cap the count is a floor („500+") and
     * the size says in its own note that older files were never weighed.
     */
    band: {
      files: "Files",
      total: "Total",
      floorNote: "At least — older files are not counted.",
    },
    caption: "All files attached to notes, tasks and subjects.",
    searchPlaceholder: "Search by file name or owner…",
    searchLabel: "File search",
    /** Owner-kind chips; „Sve" clears the filter rather than being a filter of its own. */
    ownerFilterLabel: "Where it is attached",
    owners: {
      all: "All",
      note: "Notes",
      task: "Tasks",
      subject: "Subjects",
    },
    /** Mime-family chips, keyed by `MIME_FAMILIES`. */
    familyFilterLabel: "File type",
    families: {
      slika: "Images",
      pdf: "PDF",
      tekst: "Text",
      ostalo: "Other",
    },
    familyAll: "All types",
    /** The list/grid toggle — the same two shapes the Settings card names. */
    viewLabel: "View",
    views: {
      lista: "List",
      mreza: "Grid",
    },
    /** Column headings for the dense list. */
    columns: {
      name: "Name",
      owner: "Where",
      size: "Size",
      date: "Added",
    },
    /** The „⋯" menu on a row or a card, mirroring `study.materials.menuLabel`. */
    menuLabel: "File actions",
    preview: "Preview",
    open: "Open",
    /**
     * The copy-out, spelled exactly as the note, task and subject panels spell
     * it — this page borrows their three write channels, so it must not invent
     * a fourth wording for the one action.
     */
    saveAs: "Save as…",
    goTo: "Go to…",
    /** What a note with no title is called here — the same word Beleške uses for it. */
    untitledOwner: "Untitled",
    /** Alt text for a grid thumbnail is the file name; this labels the typographic mark a non-image gets instead. */
    fileMarkLabel: "File",
    /** The counted noun beside a per-family figure — „12 datoteke". */
    summaryUnitOne: "file",
    summaryUnitFew: "files",
    summaryUnitMany: "files",
    /** Two different situations, two different sentences — one of them would be a lie about the other. */
    emptyTitle: "No attached files",
    emptyDescription:
      "Files appear here when you attach them to a note, a task or a subject.",
    noMatchTitle: "No files match these filters",
    noMatchDescription: "Change the search or turn off a filter.",
    clearFilters: "Clear filters",
    /** The isolated failure of this one read, with the way to ask again — the dashboard widgets' recipe. */
    error: "Files cannot be loaded right now.",
    retry: "Try again",
    actionError: "The file action failed. Try again.",
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
      heading: "Plan and reality",
      plannedLabel: "Planned",
      actualLabel: "Measured",
      minuteUnit: "min",
      caption:
        "Per day: the minutes the plan asked for and the minutes focus actually measured. A block remembers the planned time and the outcome, never the actual duration — measured time comes only from focus.",
      descriptionLead: "Plan and reality",
      descriptionPlanned: "planned",
      descriptionActual: "measured",
      emptyReason: "The chart appears as soon as there is a planned or measured minute.",
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
      dueLabel: "Due for review",
      newLabel: "New cards",
      matureLabel: "Mature cards",
      /**
       * The maturity census is over the WHOLE collection, while everything in
       * „Poslednjih 30 dana" below is windowed — so the figure says which of
       * the two it is, in the same breath.
       */
      matureNote: "across the whole collection",
      examLabel: "Next exam",
      /** The figure when no exam is ahead. Never a zero, which reads as „danas". */
      examNone: "—",
      examNoneNote: "none scheduled",
    },
    /**
     * Drawn above the field. It was a `namePlaceholder` and a `nameLabel`
     * holding one string, the grey copy of which left the moment anything was
     * typed — DC-120 step 2 keeps the one that stays.
     */
    nameLabel: "Subject name",
    /**
     * „(opciono)“ came off the placeholder this replaced: the one thing the
     * grey text said that the name did not, said only while the field was
     * empty. Four other fields took the same parenthesis on the same day.
     */
    semesterLabel: "Semester (optional)",
    colorLabel: "Colour",
    /** Colour-dot names, keyed by subject colour value (labels are presentation). */
    color: {
      jade: "Jade",
      gold: "Gold",
      bronze: "Bronze",
      burgundy: "Burgundy",
      crimson: "Crimson",
      graphite: "Graphite",
    },
    add: "Add subject",
    save: "Save",
    cancel: "Cancel",
    editLabel: "Edit subject",
    archiveLabel: "Archive",
    unarchiveLabel: "Restore from archive",
    deleteLabel: "Delete subject",
    deletedNotice: "Subject deleted",
    undo: "Undo",
    dismiss: "Dismiss",
    emptyTitle: "No subjects",
    /** „u formi iznad" until the form moved behind „Dodaj predmet" — the sentence had to stop pointing at a form nobody can see. */
    emptyDescription: "Add your first subject — a name is enough.",
    loadError: "Subjects cannot be loaded right now. Try again later.",
    showArchived: "Show archived",
    hideArchived: "Hide archived",
    noExams: "No exams scheduled for this subject.",
    addExam: "Add exam",
    saveExam: "Save",
    cancelExam: "Cancel",
    /** Exam-type labels, keyed by exam type value (labels are presentation). */
    examType: {
      pismeni: "Written",
      usmeni: "Oral",
      kolokvijum: "Midterm",
    },
    examTypeLabel: "Exam type",
    examDateLabel: "Exam date",
    /** „(opciono)“ from the placeholder, as `semesterLabel` above. */
    examScopeLabel: "Scope (optional)",
    editExamLabel: "Edit exam",
    deleteExamLabel: "Delete exam",
    deletedExamNotice: "Exam deleted",
    /** Countdown chip phrasing; "za N dan(a)" builds inline via `dayUnit`. */
    countdown: {
      today: "today",
      tomorrow: "tomorrow",
      future: "in",
      unitOne: "day",
      unitMany: "days",
      past: "passed",
    },
    calendarTag: "Exam",
    dashboardTitle: "Exams",
    dashboardEmpty: "No exams scheduled.",
    /** Dashboard "Učenje" widget (streak + today's focus minutes). */
    dashboardStudyTitle: "Study",
    dashboardFocusTodayLabel: "Focus today",

    // --- Materials (Materijali), under each subject (STUDY-001) -------------
    /**
     * A subject's own files — the scanned skripta, the slides, last year's
     * paper. The wording follows the TASK page's „Prilozi" block field for
     * field; only the noun changes, because a file hanging off a course is
     * called a material and not an attachment.
     */
    materials: {
      title: "Materials",
      add: "Add material",
      empty: "No materials for this subject.",
      /** „Pregledaj" (DOC / ADR-064) — the attachment panels' word, offered only on rows the app can render itself. */
      preview: "Preview",
      open: "Open",
      saveAs: "Save as…",
      remove: "Remove material",
      /** The per-material „⋯“ menu, mirroring `tasks.attachments.menuLabel`. */
      menuLabel: "Material actions",
      /** Shown when the picker refused one or more files for size. The 50 MB bound is the store's own (`MAX_SUBJECT_ATTACHMENT_BYTES`). */
      tooLarge: "Files larger than 50 MB cannot be attached.",
      actionError: "The material action failed. Try again.",
    },

    // --- Linked notes (Povezane beleške), under each subject (STUDY-001) ----
    /**
     * The notes a user has filed under a course. „Povezane" rather than
     * „Priložene": nothing is copied here — the note stays in Beleške and this
     * section only points at it, which is exactly what opening one does.
     */
    linkedNotes: {
      title: "Linked notes",
      add: "Link a note",
      empty: "No linked notes for this subject.",
      /** Accessible label on a chip: the chip itself shows only the title. */
      openLabel: "Open note",
      unlink: "Unlink",
      /** The picker's own empty state — the profile has no note left to link. */
      pickerEmpty: "No notes to link.",
      pickerLabel: "Choose a note",
      actionError: "Linking the note failed. Try again.",
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
      title: "Study log",
      show: "Show log",
      hide: "Hide log",
      empty: "No study recorded yet.",
      loadError: "The study log cannot be loaded right now. Try again later.",
      /** Widens the window by another 60 days; hidden once nothing older exists. */
      showMore: "Show more",
      /**
       * „5 ponavljanja" — the counted noun takes all three Serbian forms
       * (1 / 2–4 / 5+), so it goes through `countUnit`.
       */
      reviewOne: "review",
      reviewFew: "reviews",
      reviewMany: "reviews",
      /** „45 min fokusa" — the duration itself comes from `formatDurationMinutes`. */
      focusSuffix: "focus",
      /** „plan 30 min" — what the plan asked of the day, whatever came of it. */
      planPrefix: "plan",
      /** Milestone chip on a day that carries an exam: „Ispit: Pismeni". */
      examTag: "Exam",
    },

    // --- Decks (Špilovi), under each subject --------------------------------
    decksTitle: "Decks",
    noDecks: "No decks for this subject.",
    addDeck: "Add deck",
    saveDeck: "Save",
    cancelDeck: "Cancel",
    /** Drawn above the field; its placeholder held the same string. */
    deckNameLabel: "Deck name",
    editDeckLabel: "Edit deck",
    deleteDeckLabel: "Delete deck",
    deletedDeckNotice: "Deck deleted",
    newCount: "new",
    dueCount: "due",
    openCards: "Cards",
    studyDeck: "Study",
    studyAll: "Study all",

    // --- Card management (deck drill-in) ------------------------------------
    cardsBack: "← Back",
    cardsEmptyTitle: "No cards",
    /** The card form is BELOW this empty state, never above it — the sentence used to point the wrong way. */
    cardsEmptyDescription: "Add your first card — a front and a back are enough.",
    loadCardsError: "Cards cannot be loaded right now. Try again later.",
    addCard: "Add card",
    saveCard: "Save",
    cancelCard: "Cancel",
    /**
     * The two card faces, drawn above their boxes. Each had a placeholder
     * holding its own label word for word; the statement and step fields of a
     * PROBLEM card kept theirs, because those are worked examples rather than
     * names, and that is the whole distinction DC-120 step 2 turns on.
     */
    frontLabel: "Front",
    backLabel: "Back",
    deckSelectLabel: "Deck",
    mathHint: "Use $…$ for maths expressions.",
    editCardLabel: "Edit card",

    // --- Cloze cards (STUDY-006 / ADR-042) ----------------------------------
    /**
     * The Osnovna/Cloze/Zadatak segmented toggle above the card form. Indexed
     * by the renderer's `CardForm`, NOT by `CardKind`: „Zadatak" is a third
     * FORM of a `basic` card, not a third kind (ADR-046).
     */
    cardKindLabel: "Card type",
    cardForm: {
      basic: "Basic",
      cloze: "Cloze",
      problem: "Problem",
    },
    clozeLabel: "Text with blanks",
    clozePlaceholder: "The capital of Serbia is {{c1::Belgrade}}.",
    clozeHint:
      "Put {{…}} around each part that should be hidden. The number in {{c1::…}} says which card the blank belongs to — two blanks with the same number are one card.",
    /**
     * Wraps the selection in a new deletion and numbers it (ADR-068). A verb:
     * it says what pressing it does, and it is the reason the author never has
     * to count braces or renumber anything by hand.
     */
    clozeAddBlank: "Add blank",
    /**
     * The live line under the cloze field: "3 praznine → 3 kartice". Both
     * counted nouns take three Serbian forms (1 / 2–4 / 5+), so they go
     * through `countUnit` rather than `dayUnit`.
     */
    clozeCount: {
      arrow: "→",
      blankOne: "blank",
      blankFew: "blanks",
      blankMany: "blanks",
      cardOne: "card",
      cardFew: "cards",
      cardMany: "cards",
      /** Shown instead of the count line while the text has no deletion; creation stays disabled. */
      none: "No blanks — add {{…}} to create a card.",
    },
    /** Inline refusal when an edit drops the very deletion this card asks about — by NUMBER, not by position (ADR-068). */
    clozeOrdinalMissing: "This card asks for a blank the new text no longer contains.",

    // --- Problem cards (ADR-046) --------------------------------------------
    /** The statement — the same field a basic card calls its front, named for what it is here. */
    problemStatementLabel: "Problem statement",
    problemStatementPlaceholder: "Find the derivative of $f(x)=x^2$ at $x=1$.",
    problemStepsLabel: "Step-by-step solution",
    problemStepsPlaceholder: "The derivative is $2x$.\n--\nAt $x=1$ that is $2$.",
    problemStepsHint: "Separate the steps with a line that contains only --",
    /**
     * The live line under the solution field: "3 koraka". The counted noun
     * takes all three Serbian forms (1 / 2–4 / 5+), so it goes through
     * `countUnit`, exactly like the cloze count above it.
     */
    problemStepCount: {
      stepOne: "step",
      stepFew: "steps",
      stepMany: "steps",
      /** Shown instead of the count while the solution has no step; creation stays disabled. */
      none: "No steps — write the solution to create a card.",
    },
    /** Reveal button on a problem card: each press uncovers the next step. */
    revealNextStep: "Next step",
    /** Inline fallback when saving a card fails for any other reason. */
    saveCardError: "The card was not saved. Try again.",
    /** Screen-reader label for the masked blank in the review surface. */
    clozeBlankLabel: "hidden part",
    deleteCardLabel: "Delete card",
    deletedCardNotice: "Card deleted",
    /** Card-state chip labels; Learning and Relearning share one label (both "in progress"). */
    cardState: {
      new: "New",
      learning: "Learning",
      review: "In review",
    },
    cardDueLabel: "Next review",
    /** Source-link control for a note-generated card (ADR-017 / STUDY-008). */
    cardSourcePrefix: "From note: ",
    cardSourceLabel: "Open the source note",
    cardSourceMissing: "From note (missing)",

    // --- Review session (keyboard-first) ------------------------------------
    reviewTitle: "Study",
    reviewExit: "End",
    revealAnswer: "Show answer",
    /** Grade-button labels, keyed by CardRating value (1–4, Again..Easy). */
    rating: {
      again: "Again",
      hard: "Hard",
      good: "Good",
      easy: "Easy",
    },
    reviewUndo: "Undo",
    reviewHint: "Space — answer · 1–4 — rating · U — undo · Esc — exit",
    reviewCompleteTitle: "Everything is reviewed for now.",
    reviewCompleteLabel: "Cards rated",
    reviewBack: "Back",

    /**
     * End-of-session summary (STUDY-009). Quiet on purpose: the session is
     * over, so this reports what it was — how the ratings fell, how long it
     * took — rather than congratulating anyone. The four rating labels are
     * `rating` above, reused: the same word must mean the same button.
     */
    summary: {
      durationLabel: "Duration",
      /** Shown only when the profile's daily review cap actually cut this queue short (STUDY-007). */
      capReached: "The daily review limit has been reached.",
    },

    /**
     * Interleaved practice (STUDY-010 / ADR-047): pick špilovi, get one mixed
     * session across them. „Vežbanje" against „Učenje" is the whole distinction
     * on screen — the ordinary reviewer works through what is due, practice
     * deliberately jumps between topics.
     */
    practice: {
      open: "Practise",
      title: "Practice",
      decksLabel: "Decks",
      problemsOnly: "Problems only",
      start: "Start",
      empty: "No cards to practise in this selection.",
      close: "Cancel",
      /** The chip naming a card's špil, shown only when a session spans more than one. */
      deckChipLabel: "Deck",
    },

    // --- Exam study plans (Planovi učenja, STUDY piece 3b) -------------------
    plansTitle: "Study plans",
    todayTitle: "Today's study",
    todayEmpty: "No study blocks planned for today.",
    newPlan: "New plan",
    addPlan: "Add plan",
    savePlan: "Save",
    cancelPlan: "Cancel",
    planExamLabel: "Exam",
    planStartLabel: "Study start",
    planMinutesLabel: "Minutes per day",
    planBoostLabel: "Double the time in the last 7 days",
    planEdit: "Edit",
    planDelete: "Delete",
    deletedPlanNotice: "Plan deleted",
    plansEmpty: "No study plans yet.",
    noPlannableExams: "No upcoming exams for a new plan.",
    /** Plan summary building blocks — "60 min/dan · duplo poslednjih 7 dana". */
    planPerDay: "min/day",
    planBoostSummary: "double in the last 7 days",
    /** Progress phrasing — "3 od 12 urađeno" builds inline. */
    planProgressOf: "of",
    planProgressDone: "done",
    minutesUnit: "min",
    planShowBlocks: "Show blocks",
    planHideBlocks: "Hide blocks",
    blockDoneLabel: "Mark block as done",
    /** Study-block status chip labels, keyed by status value (labels are presentation). */
    blockStatus: {
      planned: "planned",
      done: "done",
      missed: "missed",
    },
    /** Tag chip on read-only study-block rows in the calendar agenda. */
    planCalendarTag: "Study",
    /** PlanStore/IPC validation failures mapped to Serbian; `generic` is the fallback. */
    planError: {
      duplicate: "This exam already has an active plan.",
      examPast: "The exam must be in the future.",
      startAfterExam: "The study start must be before the exam date.",
      minutesRange: "Daily minutes must be between 15 and 480.",
      weekdayRange: "Minutes per day must be whole numbers from 0 to 480, with at least one above zero.",
      generic: "Saving the plan failed. Try again.",
    },
    /**
     * Plan-restore failure, mapped separately from `planError`: a stale undo
     * offer that can never succeed again (typically the exam gained a newer
     * active plan in the meantime) rather than a live form's validation.
     */
    planRestoreError: {
      duplicate: "The plan was not restored — the exam now has a new active plan.",
      generic: "Restoring the plan failed.",
    },

    // --- Exam topics & the honest planner (ADR-063, slice b) -----------------
    /**
     * Block kind, keyed by the wire's closed `StudyBlockKind` domain. A
     * coverage block renders PLAIN — it is the ordinary case and a chip on
     * every row would be noise — so only revision/recall are ever drawn, but
     * all three are keyed here so the calendar can index by the raw value.
     */
    blockKind: {
      coverage: "coverage",
      revision: "revision",
      recall: "recall",
    },
    /** Pin toggle on future block rows; the titles say exactly what a pin means. */
    blockPin: "Pin",
    blockUnpin: "Unpin",
    blockPinTitle: "A pinned block survives every replan.",
    blockUnpinTitle: "Unpin the block — the next replan may move it.",
    /** Title on the „Vežbaj" deep link a recall block offers when its topic drills from a špil. */
    blockPracticeTitle: "Start reviewing this topic's deck.",
    /** Title on rows inside the final-7-days window (the exam-week posture). */
    examWeekTitle: "The last 7 days before the exam",
    /**
     * Plan health (ADR-063 invariant 5) — building blocks joined inline around
     * the minutes count: „U preostale dane ne staje još 120 min učenja." and
     * „Ispit je prošao — 90 min učenja je ostalo propušteno." Honest reporting,
     * never a silently stretched day.
     */
    healthOverflowPrefix: "The remaining days do not fit another",
    healthOverflowSuffix: "min of study.",
    healthExamPassedPrefix: "The exam has passed —",
    healthExamPassedSuffix: "min of study was left missed.",
    /**
     * The plan card's scope line (STUDY-004): how many of the exam's topics the
     * user has accepted out of the plan. Three Serbian forms after the count —
     * „1 tema je van plana." / „2 teme su van plana." / „5 tema je van plana."
     */
    scopeCountUnitOne: "topic is out of the plan.",
    scopeCountUnitFew: "topics are out of the plan.",
    scopeCountUnitMany: "topics are out of the plan.",
    /**
     * The scope-cut conversation (STUDY-004): a computed proposal the user must
     * explicitly accept — nothing is ever cut by the machine.
     */
    scopeCut: {
      open: "Suggested cut",
      title: "Suggested cut",
      intro: "For the plan to fit the remaining time, these topics would leave the plan:",
      /** „75 min preostalo" beside each proposed topic. */
      minutesSuffix: "min left",
      empty: "No topic can be dropped to free enough time.",
      loadError: "The suggestion cannot be loaded right now. Try again.",
      accept: "Accept",
      decline: "Decline",
    },
    /**
     * The exam's topic list inside the plan form (ADR-063). Rank order is both
     * curriculum order and scope-cut priority, which is what the hint says.
     */
    topics: {
      title: "Topics",
      hint: "The order is also the priority — topics at the bottom leave the plan first.",
      empty: "With no topics the plan stays simple — one study block a day.",
      nameLabel: "Topic name",
      addPlaceholder: "New topic",
      add: "Add topic",
      moveUp: "Move topic up",
      moveDown: "Move topic down",
      remove: "Delete topic",
      /**
       * The store soft-deletes a topic and promotes its plan blocks off it —
       * but it has no `restore`, and there is no `topics:restore` channel, so
       * from the user's side the act is final. Until this dialog it fired on a
       * bare „×" beside a list row. The warning states the consequence that
       * costs something and is not obvious: the plan keeps its blocks, they
       * simply stop naming this topic.
       */
      deleteDialog: {
        title: "Delete topic",
        warning:
          "The topic is deleted and cannot be brought back. The blocks in the plan stay, they simply stop carrying its name.",
        confirmLabel: "Topic name to confirm",
        confirmPlaceholder: "Enter the exact name",
        submit: "Delete",
        cancel: "Cancel",
      },
      confidenceLabel: "Confidence",
      confidenceUnknown: "Unknown",
      /** Muted „izvedeno: 72" beside an unknown manual confidence a LIVE linked špil resolved. */
      derivedPrefix: "derived:",
      deckLabel: "Topic deck",
      deckNone: "No deck",
      /**
       * A stored link whose deck is no longer live (the store's `deckMissing`)
       * — one label for both the row's muted chip and the picker's stale
       * option, so the row says the same thing twice rather than lying „Bez
       * špila" once. The title also states the consequence: a dead špil stops
       * feeding the derived confidence, which is why the „izvedeno" hint beside
       * such a row is gone rather than stale.
       */
      deckMissing: "Missing deck",
      deckMissingTitle:
        "This topic's deck no longer exists — confidence is no longer derived from it. Pick another deck or remove the link.",
      /** Chip on a topic the user accepted out of the plan (STUDY-004). */
      cutChip: "out of plan",
      /** The un-cut action — the only affordance anywhere that returns a cut topic to the plan. */
      uncut: "Back into the plan",
      uncutTitle: "Put the topic back in the plan — the next replan includes it again.",
      actionError: "The topic action failed. Try again.",
    },
    /** Per-weekday minutes Pon..Ned (the labels reuse `recurrence.weekdayShort`). */
    weekdayMinutesLabel: "Minutes per day",
    weekdayMinutesHint: "Leave them all equal and every day carries the same daily minutes.",

    // --- Study stats + focus timer (Statistika i fokus, STUDY piece 4b) ------
    statsTitle: "Statistics and focus",
    focusTitle: "Focus timer",
    focusSubjectLabel: "Subject to focus on",
    focusStart: "Start focus",
    focusStop: "Stop",
    focusDiscard: "Discard",
    focusNoSubjects: "No active subjects — add a subject to start the focus timer.",
    focusUnknownSubject: "Unknown subject",
    /**
     * The running phase belongs to no subject — a Pomodoro started from „Fokus"
     * on the same timer (UTIL slice b). Different from „Nepoznat predmet", which
     * means a subject that WAS named and is no longer readable.
     */
    focusNoSubject: "No subject",
    /** Streak line — "Niz učenja: N dana" + "Najduži niz: M" building blocks. */
    streakLabel: "Study streak",
    streakUnitOne: "day",
    streakUnitMany: "days",
    streakZero: "No study streak yet — start today.",
    streakBestLabel: "Longest streak",
    statsRecentTitle: "Last 30 days",
    statsMinutesTitle: "Minutes per subject",
    statsOtherSubject: "Other",
    statsEmpty: "No study data in the last 30 days yet.",
    statsReviewsLabel: "Reviews",
    /** Block summary — "Blokovi: 5 urađeno · 2 propušteno" builds inline. */
    statsBlocksLabel: "Blocks",
    statsBlocksDone: "done",
    statsBlocksMissed: "missed",
    /**
     * Maturity summary (STUDY-013) — „Sazrele kartice: 4 (ukupno 37 zrelih)"
     * builds inline. The count is the range's; the total in brackets is a live
     * census of the whole collection.
     */
    statsMaturedLabel: "Cards matured",
    statsMaturedTotalPrefix: "in total",
    statsMaturedTotalSuffix: "mature",
    /**
     * Plan adherence (STUDY-013) — „Praćenje plana: 82%", or the em dash when
     * no block was due in the period, since there is no percentage to give.
     */
    statsAdherenceLabel: "Plan adherence",
    statsAdherenceNone: "—",
    focusSessionsTitle: "Recent focus sessions",
    focusSessionsEmpty: "No focus sessions in the last 7 days.",
    deleteFocusSessionLabel: "Delete focus session",
    deletedFocusSessionNotice: "Focus session deleted",
    /**
     * Shared fallback for the subject/exam/deck/focus-session/card delete and
     * undo actions (and the plan delete, which otherwise shares no copy with
     * `planError`/`planRestoreError`): all are the same shape — a simple
     * delete-with-undo, no validation of its own — so one line covers all of
     * them, exactly like every other module's generic `actionError`.
     */
    actionError: "The action failed. Try again.",
  },

  notifications: {
    bellLabel: "Notifications",
    empty: "No new notifications.",
    /** Shown in place of the list when the initial load failed — distinct from `empty`, which is a real answer. */
    loadError: "Notifications cannot be loaded right now. Try again later.",
    /** Shown when a snooze or dismiss failed — the row stays exactly as it was. */
    actionError: "The action failed. Try again.",
    dismissLabel: "Dismiss notification",
    snoozedUntil: "snoozed until",
    /** Source tag chip on each center row, keyed by NotificationSource value. */
    sourceTag: {
      document: "Document",
      exam: "Exam",
      "study-day": "Study",
      event: "Event",
      task: "Task",
      security: "Security",
      subscription: "Subscription",
      habit: "Habit",
    },
    /** Snooze preset button labels, keyed by SnoozePreset value. */
    snoozePreset: {
      "10m": "10 min",
      "1h": "1 h",
      tonight: "Tonight",
      "tomorrow-morning": "Tomorrow morning",
    },
    /**
     * NTF-009: the one-click snooze, which uses the profile's default preset.
     * Deliberately unlabelled with a duration — main reads the default at the
     * moment of the click, so any duration printed here could be a lie the
     * instant the preference changes in another window. The four presets beside
     * it still say exactly what they do.
     */
    snoozeDefaultAction: "Snooze",
    settings: {
      show: "Notification settings",
      hide: "Hide settings",
      /** Shown in place of the whole body when the settings fetch itself rejected — the disclosure must never open onto nothing with no explanation. */
      loadError: "Notification settings cannot be loaded right now. Try again.",
      quietFromLabel: "Quiet from",
      quietToLabel: "Quiet until",
      quietSave: "Save",
      quietClear: "Clear",
      quietHint: "Reminders wait for the quiet hours to end; the final warning still arrives.",
      quietPairingError: "Both times must be filled in, or both empty.",
      morningHourLabel: "Morning reminder at",
      /** NTF-009: which preset the center's plain „Odloži“ button reaches for. */
      snoozeDefaultLabel: "Default snooze",
      snoozeDefaultHint: "The “Snooze” button in notifications uses this choice.",
      /** Source toggle checkbox labels, keyed by NotificationSource value. */
      sourceToggle: {
        document: "Documents",
        exam: "Exams",
        "study-day": "Study",
        event: "Events",
        task: "Tasks",
        security: "Security",
        subscription: "Subscriptions",
        habit: "Habits",
      },
      /** NTF-007: why the „Bezbednost“ toggle is on and greyed out. */
      alwaysOnCaption: "Security notifications cannot be turned off.",
      saveError: "Saving the settings failed. Try again.",
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
      title: "How much should Nexus remind you?",
      question:
        "Your first reminder is ready. Pick how many notifications you want — you can change everything later in Settings.",
      keepDefault: "Keep the default",
      saveError: "Saving the choice failed. Try again.",
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
      heading: "Balance over time",
      caption:
        "The total of all accounts in this currency, day by day. A transfer between two of your own accounts does not change the total, so it does not show on the line.",
      descriptionLead: "Balance in currency",
      descriptionFrom: "from",
      descriptionTo: "to",
      emptyReason: "The line appears as soon as there is at least one item this month.",
    },
    loadErrorTitle: "Finance failed to load",
    loadError: "Loading finance failed. Close and reopen the page.",
    /** The one line every failed write falls back to when `financeErrorMessage` recognizes nothing more specific. */
    actionError: "The action failed. Try again.",
    undo: "Undo",
    dismiss: "Dismiss",
    /** The three halves of the page: the book you write into, the month you read back, and the charges that repeat. */
    pages: {
      label: "View",
      ledger: "Ledger",
      report: "Report",
      subscriptions: "Subscriptions",
    },
    /**
     * The statement importer's disclosure on this page (FIN slice e). Closed by
     * default: importing a statement is something you do a few times a month,
     * and the ledger is what you came here to look at.
     */
    importDisclosure: {
      show: "Import a statement (.csv)…",
      hide: "Hide statement import",
    },
    accounts: {
      heading: "Accounts",
      /** The rail's "no account filter" row — a view over every account, not an account. */
      all: "All accounts",
      archivedHeading: "Archived",
      archivedChip: "Archived",
      newAccount: "New account",
      nameLabel: "Account name",
      namePlaceholder: "Current account",
      kindLabel: "Type",
      currencyLabel: "Currency",
      /** Three letters, ISO-4217 — the field says the shape rather than offering a list Nexus would have to invent. */
      currencyHint: "Three-letter code, e.g. RSD",
      openingLabel: "Opening balance",
      openingHint: "The balance on the day you add the account. It does not change on its own later.",
      kinds: {
        cash: "Cash",
        current: "Current account",
        card: "Card",
        savings: "Savings",
      },
      save: "Save",
      cancel: "Cancel",
      edit: "Edit",
      archive: "Archive",
      unarchive: "Restore from archive",
      delete: "Delete",
      /** The row's „⋯" — everything that can be DONE to an account, behind one control. */
      menuLabel: "Account actions",
      deletedNotice: "The account was deleted, along with its transactions.",
      /** The invitation a profile with no accounts sees — never a sample row. */
      emptyTitle: "No accounts yet",
      emptyDescription:
        "Add your first account and Nexus will track its balance — it works it out from the opening balance and the transactions.",
      invalidCurrency: "The currency must be a three-letter code, for example RSD.",
      invalidOpening: "The opening balance is not a valid amount.",
      invalidName: "The account name cannot be empty.",
    },
    /**
     * The band at the top of the page — „Ukupno" and, on „Knjiga", what came in
     * and went out of the rows currently on screen. The figures are the message,
     * so the explanation is a CAPTION under them and never the paragraph beside
     * them it used to be.
     */
    totals: {
      heading: "Totals",
      /**
       * Said out loud, because the absence of one number is the design and not
       * an omission: without kursa nijedan zbir preko valuta ne bi bio istinit.
       */
      caption: "Per currency — Nexus has no exchange rate, so balances in different currencies are never added together.",
      /**
       * The same, plus the two things the flow figures beside „Ukupno" would
       * otherwise be misread as: they cover the PRIKAZANE rows (a filter changes
       * them) and they leave prenosi out, because a prenos is neither prihod
       * nor rashod anywhere in this module.
       */
      captionLedger:
        "The total is the sum of active accounts. Income and expense refer to the items shown; transfers are not counted. Nexus has no exchange rate, so currencies are never added together.",
      /** Where a balance would stand for a currency the profile keeps no active account in — never a zero, which would be a claim. */
      noBalance: "—",
      /** Shown while the profile has accounts but every one of them is archived. */
      none: "No active accounts.",
    },
    categories: {
      heading: "Categories",
      newCategory: "New category",
      namePlaceholder: "Food",
      kinds: {
        income: "Income",
        expense: "Expense",
      },
      delete: "Delete",
      /** Stated on the delete affordance itself: what survives matters more than what goes. */
      deleteHint: "The transactions stay — they just lose the category.",
      /**
       * The hint above was doing the whole job: a HARD delete (`DELETE FROM
       * fin_categories`, unlike an account's) fired on one click of a bare „×",
       * with no restore endpoint behind it, while NOTE's identical category rail
       * asked for the name back. The warning also states the part the hint left
       * out — a budget limit set on this category goes with it, and that one
       * does NOT survive the way the transactions do.
       */
      deleteDialog: {
        title: "Delete category",
        warning:
          "The category is permanently deleted, along with its spending limit if it has one. The transactions stay — they just lose the category.",
        confirmLabel: "Category name to confirm",
        confirmPlaceholder: "Enter the exact name",
        submit: "Delete",
        cancel: "Cancel",
      },
      empty: "No categories yet.",
      duplicate: "A category with that name already exists.",
      invalidName: "The category name cannot be empty.",
      /** The chip opens the editor, which does both things — hence „Uredi" rather than „Preimenuj". */
      edit: "Edit",
      editHint: "Rename the category or set its budget.",
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
      heading: "Budget",
      /** On a category chip that carries one — a word, never an amount: one category can hold one limit per currency. */
      marker: "limit",
      hint: "A monthly limit, per currency — Nexus has no exchange rate, so limits in different currencies are never added together.",
      incomeOnly: "Only an expense category has a budget: the limit caps the spending.",
      currencyLabel: "Currency",
      amountLabel: "Monthly limit",
      set: "Set",
      /** On the × beside one currency's allowance. */
      clearHint: "Removes the limit in this currency only.",
      none: "No limit set.",
      needsAccount: "Add an account first — the limit is set in the currency of one of your accounts.",
      invalidAmount: "The limit must be an amount above zero. If you do not want one, remove it.",
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
      previousMonth: "Previous month",
      nextMonth: "Next month",
      thisMonth: "This month",
      income: "Income",
      expense: "Expense",
      /** Under a section's head, only when something in it actually has a limit — otherwise the mark has nothing to explain. */
      barsCaption: "The bar is what was spent, the line is the limit.",
      noBudget: "no limit",
      over: "over the limit",
      /** A currency that only saw income this month — its own fact, not an empty page. */
      noSpending: "No expense in this currency this month.",
      /** Shown only when some line actually went negative: the minus is a fact, not a bug. */
      refundNote: "A minus means the refunds that month were larger than the spending.",
      /** The caption the whole report stands on — said out loud so nobody waits for a prediction that will never come. */
      caption:
        "This month only, and per currency only. Nexus does not forecast spending or guess a limit for you.",
      emptyTitle: "This month is empty",
      emptyDescription:
        "There is neither income nor expense this month. A transfer between your accounts is not counted here — it is neither income nor expense.",
      loadErrorTitle: "The report failed to load",
      loadError: "Loading the report failed. Pick the month again.",
    },
    ledger: {
      /** The entry form is a disclosure now: the ledger is read far more often than it is written to. */
      newTransaction: "New transaction",
      /**
       * How many rows the filters left standing — the one thing a filtered
       * ledger owes the reader that the rows themselves cannot say.
       */
      itemsOne: "item",
      itemsFew: "items",
      itemsMany: "items",
      emptyTitle: "No transactions yet",
      emptyDescription: "Add your first transaction — an amount, a description and a date are enough.",
      /** When a filter matches nothing, which is a different fact from an empty ledger. */
      filterEmptyTitle: "Nothing matches the filters",
      filterEmptyDescription: "Change the account, category or period to see more.",
      uncategorized: "No category",
      transfer: "Transfer",
      /** Between the two account names on a transfer row: „Tekući → Štednja". */
      transferArrow: "→",
      deletedNotice: "The transaction was deleted.",
      edit: "Edit",
      delete: "Delete",
    },
    form: {
      /** The three acts the one form can perform; the choice decides the sign and what the row may carry. */
      kindExpense: "Expense",
      kindIncome: "Income",
      kindTransfer: "Transfer",
      kindLabel: "Entry type",
      amountLabel: "Amount",
      amountPlaceholder: "0.00",
      payeeLabel: "Description",
      payeePlaceholder: "Shop",
      dateLabel: "Date",
      accountLabel: "Account",
      fromAccountLabel: "From account",
      toAccountLabel: "To account",
      categoryLabel: "Category",
      categoryNone: "No category",
      noteLabel: "Note",
      submitAdd: "Add",
      submitSave: "Save",
      cancel: "Cancel",
      invalidAmount: "The amount is not valid. Enter it as 1234.56.",
      zeroAmount: "The amount cannot be zero.",
      missingCounter: "Pick both the account the transfer leaves and the account it goes to.",
      needsAccount: "Add an account first — a transaction has to sit somewhere.",
    },
    filters: {
      categoryLabel: "Filter by category",
      categoryAll: "All categories",
      categoryNone: "No category",
      /** Names the „Od – Do" pair as ONE control, so each half needs only its own short name. */
      periodLabel: "Period",
      fromLabel: "From",
      toLabel: "To",
      clear: "Clear filters",
      invalidPeriod: "“From” cannot be after “To”.",
    },
    views: {
      /** Its own name, distinct from `pages.label`: two groups on one screen both announced „Prikaz" name nothing. */
      label: "Ledger layout",
      list: "List",
      cards: "Cards",
    },
    /**
     * The refusals the three stores name (FIN slice a). Each one is matched off
     * the store's own message text, exactly as `planErrorMessage` does for
     * STUDY — the store stays the authority on what is rejected, and this is
     * only how the page says it in Serbian.
     */
    error: {
      transferSameAccount: "A transfer goes between two different accounts.",
      transferCurrency:
        "A transfer cannot cross from one currency to another — Nexus has no exchange rate. Enter two ordinary transactions.",
      transferCategory: "A transfer has no category: it is neither income nor expense.",
      /** The store's refusal to put a limit on an income category, said in Serbian. */
      budgetOnIncome: "A budget goes only on an expense category — income is not capped.",
      budgetAmount: "The limit must be an amount above zero.",
      notFound: "That record no longer exists. Refresh the page.",
      /** The store's refusal of a schedule it cannot read (FIN slice d). */
      recurrenceInvalid: "The repeat is not set up correctly.",
    },
    /**
     * Pretplate (FIN slice d) — the charges that repeat. The copy is bound by
     * the same honesty the report is: what is „predstojeće" comes from the RULE,
     * and Nexus never writes a charge before its day arrives, which is said out
     * loud in `caption` so nobody looks for a balance that already counts it.
     */
    subscriptions: {
      newSubscription: "New subscription",
      caption:
        "A charge is recorded only on the day it happens — until then this is just a schedule. A recorded charge is an ordinary transaction: you can edit or delete it.",
      emptyTitle: "No subscriptions yet",
      emptyDescription:
        "Add what charges itself — a subscription, a membership, an instalment. Nexus will record each charge on its day.",
      needsAccountTitle: "Add an account first",
      needsAccountDescription: "A subscription is charged to an account, so one has to exist first.",
      nameLabel: "Name",
      namePlaceholder: "Netflix",
      amountLabel: "Amount",
      accountLabel: "Account",
      categoryLabel: "Category",
      startLabel: "First charge",
      reminderLabel: "Remind me",
      reminderNone: "No reminder",
      /** The lead-time options, in days — the ones a renewal is actually worth hearing about. */
      reminderOptions: {
        "0": "On the day of the charge",
        "1": "A day before",
        "3": "Three days before",
        "7": "A week before",
      },
      noteLabel: "Note",
      save: "Save",
      cancel: "Cancel",
      edit: "Edit",
      delete: "Delete",
      /** The row's „⋯": brisanje is the one act on a subscription that clicking the same button again does not undo. */
      menuLabel: "More actions",
      deletedNotice: "The subscription was deleted.",
      /**
       * Pauza (ADR-074) — „zadrži pretplatu, ali me ne naplaćuj". A state of its
       * own beside brisanje: the row stays in the list, stays izmenjiva, and
       * simply stops being charged. „Nastavi“ pokreće naplatu od prve naredne po
       * pravilu — meseci provedeni na pauzi se nikada ne naplaćuju unazad, što je
       * cela razlika u odnosu na „obriši pa napravi ponovo“.
       */
      pause: "Pause",
      resume: "Resume",
      /** The chip on a paused row — a statement about the pretplata, never a warning: ništa nije odbijeno. */
      pausedChip: "Paused",
      pausedChipTitle: "The charge is stopped. “Resume” starts it again from the next one.",
      /** What stands where the next charge's date would be, on a row that will not be charged. */
      pausedNext: "No charge",
      /** A series past its `until`/`count` end: nothing more will be charged. */
      finished: "No more charges",
      /** The chip on a row that reminds, beside the lead time. */
      reminderChip: "Reminder",
      /** The little list under the form: what the rule will charge next. */
      upcomingHeading: "Upcoming charges",
      upcomingEmpty: "No charges in the next three months.",
      invalidName: "Enter the subscription name.",
      invalidAmount: "The amount is not valid. Enter it as 1234.56.",
      zeroAmount: "The amount cannot be zero.",
      invalidStart: "Pick the date of the first charge.",
      /** The one thing the form decides that the ledger form does not: which way the money goes. */
      directionLabel: "Direction",
      directionOut: "Charge",
      directionIn: "Incoming",
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
    loadErrorTitle: "Habits failed to load",
    loadError: "Loading habits failed. Close and reopen the page.",
    /** The one line every failed write falls back to when `habitErrorMessage` recognizes nothing more specific. */
    actionError: "The action failed. Try again.",
    undo: "Undo",
    dismiss: "Dismiss",
    /**
     * The band above the wall. Every figure in it is counted off rows this page
     * has genuinely loaded — today's tick state, the live habits, the longest
     * niz actually standing — and the third one is ABSENT rather than zero when
     * no niz is running, because „0 dana" beside no habit's name is a figure
     * about nobody.
     */
    band: {
      today: "Done today",
      active: "Active habits",
      /** Label-first, so the count needs no numeral agreement: „Arhivirano: 3". */
      archived: "Archived",
      streak: "Longest current streak",
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
      heading: "Habit wall",
      /** The window comes from `WALL_WEEKS`, so this line never names a number the drawing does not honour. */
      captionPrefix: "The last",
      caption:
        "One square is one day of one habit. An empty space means the habit was not asked for that day — a quota does not ask for any particular day.",
      /**
       * The read-aloud sentence is composed from these and the counts
       * themselves, so it cannot drift from the picture. Label-first („ispunjeno
       * 41") rather than counted-noun („41 ispunjen dan") on purpose: a tally
       * read out label-first needs no numeral agreement at all, and three
       * counted nouns would have cost nine strings to inflect correctly.
       */
      descriptionLead: "Habit wall",
      descriptionDone: "done",
      descriptionPartial: "started",
      descriptionMissed: "missed",
      legendDone: "Done",
      /** Only a MEASURED habit can be half-done; a binary one has no middle. */
      legendPartial: "Started",
      legendMissed: "Missed",
      /** A wall with no habits is absent, not an empty lattice waiting to be filled. */
      emptyReason: "The wall appears as soon as there is at least one habit.",
      /** Said once: the picture is not where a day is corrected. */
      note: "The wall is for looking only. A day is corrected in the habit's own calendar, below.",
    },
    /**
     * „Danas" is the CHECKLIST — the one act this page is opened for. It is a
     * short table rather than a second copy of the register below it: the same
     * habits are here, but what is said about them is today's state, and every
     * word that would otherwise repeat down the column („Niz", „ove nedelje")
     * is said once in the head instead.
     */
    today: {
      heading: "Today",
      /**
       * Said above the list, because the mix is otherwise puzzling: a habit with
       * fixed days shows up on those days, while one with a weekly quota shows
       * up every day — any day counts towards its week.
       */
      caption: "The habits expected today. Those with a weekly quota appear here every day.",
      /** The column heads. Each of them carries a word that would otherwise be retyped on every row. */
      columnHabit: "Habit",
      columnWeek: "This week",
      columnStreak: "Streak",
      columnToday: "Today",
      /** Nothing is scheduled for today — a different fact from having no habits at all. */
      emptyTitle: "Nothing for today.",
      emptyDescription: "Everything you track is below, under “All habits”.",
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
      heading: "All habits",
      caption:
        "What each habit asks of you. This is where a habit is made, changed, archived and deleted; open it for history and numbers.",
      /** The row's disclosure — one verb each way, since the row itself is the label. */
      expand: "Show details",
      collapse: "Hide details",
      /** The invitation a profile with no habits sees — never a sample habit. */
      emptyTitle: "No habits yet",
      emptyDescription:
        "Add your first habit — say how often you do it and Nexus keeps the streak and history for you.",
      newHabit: "New habit",
      edit: "Edit",
      archive: "Archive",
      unarchive: "Restore from archive",
      delete: "Delete",
      /** The register row's third level: the hour a habit nudges at, when it has one. */
      reminderPrefix: "Reminder",
      /** An archived row states itself in words rather than in a chip: it is a fact about the navika, never a warning. */
      archived: "Archived",
      archivedTitle: "It is no longer expected. The history and statistics stay.",
      deletedNotice: "The habit was deleted, along with its history.",
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
      windowPrefix: "The last",
      /** The legend names the grid's three states, so a colour never has to be guessed. */
      legendDone: "Done",
      legendMissed: "Missed",
      legendOff: "Not expected",
      streakCurrent: "Current streak",
      streakBest: "Longest",
      /** Trailing noun of the fraction, agreeing with the number of periods (`countUnit` / `dayUnit`). */
      dayUnitOne: "day",
      dayUnitMany: "days",
      weekUnitOne: "week",
      weekUnitFew: "weeks",
      weekUnitMany: "weeks",
      /** What „11/13 dana" is a fraction OF — said out loud, because the denominator is not „30". */
      windowDaysCaption: "Of the days the schedule expects. A day still in progress does not count.",
      windowWeeksCaption: "Of the weeks with a quota. A week still in progress does not count.",
      /** A habit with nothing behind it yet: no niz, no fraction, and no invented zero. */
      noHistory: "No days recorded yet.",
      /**
       * Slice c: what a click on a history cell does, as the cell's own label
       * after the date („sreda, 8. jul 2026.: označi kao urađeno"). Two verbs and
       * no third, because the cell has exactly two states a click can move it
       * between.
       */
      cellMark: "mark as done",
      cellUnmark: "unmark as done",
      /**
       * Why some squares respond and some do not — said out loud, because „this
       * one is inert" is not something a colour can express. Both refusals are
       * the same refusal main makes (`asHabitEntryDay`).
       */
      gridHint:
        "Click a day to correct it. Days the schedule did not ask for, and days before the habit was created, cannot be recorded.",
    },
    /** How a habit's schedule reads on a row. */
    schedule: {
      everyDay: "Every day",
      /** Prefix of the quota reading, e.g. „3× nedeljno". */
      perWeekSuffix: "× a week",
      /** Short weekday names, ISO order (1 = ponedeljak), for the picker and the row summary. */
      weekdayShort: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      weekdayLong: [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ],
    },
    form: {
      newTitle: "New habit",
      editTitle: "Edit habit",
      nameLabel: "Name",
      namePlaceholder: "Water",
      colorLabel: "Colour",
      noColor: "No colour",
      /** The Dani/Kvota switch — the module's two kinds, and there is no third. */
      kindLabel: "Schedule",
      kindDays: "Days",
      kindQuota: "Quota",
      kindDaysHint: "Expected on exactly the days you pick.",
      kindQuotaHint: "Any days of the week — what matters is how many times, not which day.",
      weekdaysLabel: "Days of the week",
      everyDay: "Every day",
      perWeekLabel: "Times a week",
      /** The optional pair. Clearing the target clears the unit, because the store refuses a unit with nothing to count. */
      targetLabel: "Daily target",
      targetPlaceholder: "8",
      targetHint: "Leave it empty for a habit you simply tick off.",
      unitLabel: "Unit",
      unitPlaceholder: "glass",
      unitHint: "The unit goes with the target — without a target it is cleared.",
      /**
       * Slice c: the hour a habit nudges at, or nothing at all — which is what
       * every habit ships with. The hint states the two rules that keep the
       * reminder from becoming noise, because a user who knows them will trust
       * it enough to set one.
       */
      reminderLabel: "Remind me",
      /** The time field that appears once the switch is on — its own label, because the switch's says something else. */
      reminderTimeLabel: "Reminder time",
      reminderHint:
        "It arrives only on days the habit is expected, and only if it is not done by then.",
      save: "Save",
      cancel: "Cancel",
      invalidName: "Enter the habit name.",
      invalidWeekdays: "Pick at least one day of the week.",
      invalidTarget: "The daily target must be a whole number above zero.",
      /** Its own line, because „nije ceo broj" would be a lie about a number that simply exceeds the store's ceiling. */
      targetTooLarge: "The daily target is too large.",
      invalidUnit: "The unit is too long.",
      invalidSchedule: "The schedule is not valid.",
      unitNeedsTarget: "A unit with no target has nothing to measure — enter a target or clear the unit.",
      notFound: "That habit is no longer there. Refresh the page.",
    },
    /** The measured habit's stepper in „Danas". */
    stepper: {
      increase: "Add one",
      decrease: "Subtract one",
      /** The binary habit's tick, as a label for a screen reader. */
      check: "Mark as done",
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
      heading: "Attention bars",
      workLane: "Work",
      shortBreakLane: "Short break",
      longBreakLane: "Long break",
      caption:
        "Today's phases on one time axis. A bar runs from the start to the end of the phase, so it includes the breaks inside it; the measured minutes beside it do not.",
      descriptionLead: "Attention bars today",
      descriptionPhases: "phases",
      nowLabel: "now",
      emptyReason: "The bars appear as soon as there is at least one finished phase today.",
    },
    loadErrorTitle: "Focus failed to load",
    loadError: "Loading focus failed. Close and reopen the page.",
    actionError: "The action failed. Try again.",
    undo: "Undo",
    dismiss: "Dismiss",
    /** The three phase kinds, named the same way everywhere they appear. */
    kind: {
      work: "Work",
      short_break: "Break",
      long_break: "Long break",
    },
    /** The running phase, front and centre. */
    running: {
      /** Above the clock: „U toku · Rad". */
      heading: "Running",
      pausedHeading: "Paused",
      /**
       * Said under the clock once the plan is behind you. It states a fact and
       * asks for nothing: the phase is still running, and closing it is yours.
       */
      overrun: "Overrun — the phase keeps running until you finish it.",
      /** Below the clock: what this phase is attached to, when it is attached to anything. */
      subjectPrefix: "Subject",
      taskPrefix: "Task",
      /** An open-ended phase — STUDY's shape, and what „Fokus" shows if one is running. */
      openEnded: "No planned end",
      pause: "Pause",
      resume: "Resume",
      stop: "Finish",
      /** Ends the phase without recording it — the same act „Učenje" calls „Odbaci". */
      discard: "Discard",
      discardTitle: "Close the phase without recording it in the history.",
      /** Asked before the discard actually runs (shared with STUDY's own „Odbaci" — same phase, same act, one dialog). */
      discardDialog: {
        title: "Discard phase",
        question: "The phase closes without being recorded in the history — the time that passed is lost.",
        confirm: "Discard",
        cancel: "Cancel",
      },
    },
    /** Nothing runs: what to start, and what to attach to it. */
    idle: {
      heading: "Next phase",
      /**
       * Said above the start button. The cycle is what the config says, and this
       * is where the user learns that the next phase was decided rather than
       * chosen for them.
       */
      caption: "Nexus suggests the next phase from your cycle. You can start any of them.",
      start: "Start",
      /**
       * The explicit starts, offered only for the kinds the suggestion is NOT.
       * „Pokreni" and „Pokreni rad" used to sit side by side doing the identical
       * thing whenever the cycle suggested work — two buttons at the same volume
       * for one act, which is the „one surface, one primary" rule broken by a
       * duplicate rather than by a second colour.
       */
      startWork: "Start work",
      startShortBreak: "Start a break",
      startLongBreak: "Start a long break",
      /** The optional attachment — a subject, a task, or neither, which is the ordinary case. */
      attachLabel: "What you are working on",
      attachNone: "Nothing",
      attachTaskGroup: "Tasks",
      attachSubjectGroup: "Subjects",
      /** What a phase is CALLED — the snapshot that keeps a row readable once its task is gone. */
      labelLabel: "Phase name",
      labelPlaceholder: "Writing the report",
      labelHint: "It stays recorded with the phase even when the task is gone.",
      // A „Minuta" label lived here for a field this panel does not have and
      // should not: a phase's length is the Pomodoro shape, and that is the
      // settings quartet („Rad (minuta)" and its three siblings), not something
      // retyped before every phase. Deleted rather than given a control,
      // because the control would be a second place to say one number.
    },
    /** Today's phases, and the week behind them. */
    today: {
      heading: "Today",
      /** Per-kind summary — „Rad: 4 faze · 1 h 40 min". Every kind is shown, zeros included. */
      phaseUnitOne: "phase",
      phaseUnitFew: "phases",
      phaseUnitMany: "phases",
      /**
       * Said when today holds nothing at all. Drawn INLINE — one list inside a
       * page that already carries the timer panel — so the two halves are joined
       * into one sentence and the title ends in a full stop rather than running
       * straight into the invitation after it.
       */
      emptyTitle: "No phases today yet.",
      emptyDescription:
        "Start your first phase — Nexus keeps the time, the breaks and the history for you.",
      /** The zero that has something to say: no break was taken all day. */
      noBreaks: "No breaks today.",
    },
    /** The short history under today — the last week, newest first. */
    history: {
      heading: "Last 7 days",
      empty: "No phases in the last 7 days.",
      /** A row's action; one pending undo at a time, exactly as everywhere else. */
      delete: "Delete",
      deletedNotice: "The phase was deleted.",
      /** The chip on a phase that ran past its plan — a fact about the row, never a warning. */
      overrunChip: "Overrun",
      /** The chip on a phase with no plan at all — STUDY's timer, honestly labelled. */
      openEndedChip: "No plan",
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
    title: "Tools",
    searchLabel: "Search tools",
    searchPlaceholder: "Search tools…",
    /** Nothing matched what was typed. Says what to do, and does not scold. */
    noMatches: "No tool matches the search.",
    clearSearch: "Clear search",
    /**
     * Every `ToolCategory` in Serbian, both drawers' worth, in one map.
     *
     * One map rather than one per drawer because a category belongs to a
     * drawer through `TOOL_CATEGORY_DRAWER` and not through where its label
     * happens to be stored — and a second map is how a category ends up
     * labelled in one place and rendered as a raw id in the other.
     */
    category: {
      conversion: "Conversion",
      calculation: "Calculation",
      numbers: "Numbers and bits",
      riscv: "RISC-V",
      encoding: "Encoding",
      data: "Data",
      text: "Text",
      design: "Colour and design",
      crypto: "Cryptography",
      system: "Network and system",
      time: "Time",
      geometry: "Measures and geometry",
      materials: "Material and usage",
      structure: "Load and capacity",
      electrical: "Electricity",
      media: "Image, sound and video",
      body: "Body and training",
      finance: "Money",
    },
    /**
     * The line under the drawer's name. Composed from the registry, never
     * written down — see the same key in `strings/pro.ts`.
     */
    subtitle: "{count} {unit}",
    /** Numeral agreement for the count above — three forms, through `countUnit`. */
    unitTool: { one: "tool", few: "tools", many: "tools" },
    /** Shared by every converter surface. */
    convert: {
      valueLabel: "Value",
      fromLabel: "From",
      toLabel: "To",
      swap: "Swap",
      /** The one refusal a converter has: the text is not a number this grammar admits. */
      invalid: "Enter a number — decimals with a point, no thousands separator.",
    },
    /** Tool display names, keyed by tool id — `ToolRegistration.titleKey` points at these. */
    name: {
      duzina: "Length",
      masa: "Mass",
      zapremina: "Volume",
      temperatura: "Temperature",
      povrsina: "Area",
      brzina: "Speed",
      podaci: "Data",
      procenat: "Percentage",
      pdv: "VAT",
      kredit: "Loan",
      "jedinicna-cena": "Unit price",
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
      mm: "millimetre (mm)",
      cm: "centimetre (cm)",
      dm: "decimetre (dm)",
      m: "metre (m)",
      km: "kilometre (km)",
      in: "inch (in)",
      ft: "foot (ft)",
      yd: "yard (yd)",
      mi: "mile (mi)",
      nmi: "nautical mile (nmi)",
      mg: "milligram (mg)",
      g: "gram (g)",
      dag: "decagram (dag)",
      kg: "kilogram (kg)",
      t: "tonne (t)",
      oz: "ounce (oz)",
      lb: "pound (lb)",
      ml: "millilitre (ml)",
      cl: "centilitre (cl)",
      dl: "decilitre (dl)",
      l: "litre (l)",
      hl: "hectolitre (hl)",
      m3: "cubic metre (m³)",
      "floz-us": "fluid ounce (US)",
      "gal-us": "gallon (US)",
      degc: "degree Celsius (°C)",
      degf: "degree Fahrenheit (°F)",
      k: "kelvin (K)",
      mm2: "square millimetre (mm²)",
      cm2: "square centimetre (cm²)",
      m2: "square metre (m²)",
      ar: "are (a)",
      ha: "hectare (ha)",
      km2: "square kilometre (km²)",
      ft2: "square foot (ft²)",
      ac: "acre (ac)",
      ms: "metre per second (m/s)",
      kmh: "kilometre per hour (km/h)",
      mph: "mile per hour (mi/h)",
      kn: "knot (kn)",
      bit: "bit (b)",
      byte: "byte (B)",
      "kb-dec": "kilobyte — kB (1000 B)",
      "mb-dec": "megabyte — MB (1000 kB)",
      "gb-dec": "gigabyte — GB (1000 MB)",
      "tb-dec": "terabyte — TB (1000 GB)",
      kib: "kibibyte — KiB (1024 B)",
      mib: "mebibyte — MiB (1024 KiB)",
      gib: "gibibyte — GiB (1024 MiB)",
      tib: "tebibyte — TiB (1024 GiB)",
    } satisfies Record<string, string>,
    /** „Podaci" says the thing its two conventions exist for, once, above the fields. */
    dataNote:
      "kB and KiB are not the same amount — kB is 1000 bytes, KiB is 1024. Both conventions are in the list, so pick the one your source uses.",
    percent: {
      ofTitle: "How much is P% of X",
      ofPercent: "P (%)",
      ofValue: "X",
      whatTitle: "X is what % of Y",
      whatPart: "X",
      whatWhole: "Y",
      applyTitle: "X increased or decreased by P%",
      applyValue: "X",
      applyPercent: "P (%) — negative to decrease",
      changeTitle: "Change from X to Y, in percent",
      changeFrom: "X (old)",
      changeTo: "Y (new)",
    },
    pdv: {
      amountLabel: "Amount",
      rateLabel: "Rate",
      /** The two rates the law has — `PDV_RATES` in Serbian. */
      rateStandard: "Standard (20%)",
      rateReduced: "Reduced (10%)",
      directionLabel: "Direction",
      /** „Dodaj" takes a net price up; „Izdvoji" takes the PDV out of a price that already includes it. */
      directionAdd: "Add VAT to an amount without VAT",
      directionExtract: "Extract VAT from an amount with VAT",
      netLabel: "Base (without VAT)",
      vatLabel: "VAT",
      grossLabel: "Total (with VAT)",
      /** Says why „izdvoji" is not „20% od ukupnog" — the everyday mistake this tool prevents. */
      note: "Extraction is not 20% of the total amount: VAT is charged on the base, so the total is divided by 1.20 (or 1.10).",
    },
    loan: {
      principalLabel: "Loan amount",
      rateLabel: "Nominal interest rate (% a year)",
      monthsLabel: "Number of instalments (months)",
      paymentLabel: "Monthly payment",
      totalPaidLabel: "Total paid",
      totalInterestLabel: "Total interest",
      /**
       * The caveat, on screen rather than only in a comment. Three facts in the
       * order they matter: which rate this is, what is not counted, and what
       * that means for the number a bank will quote.
       */
      caveat:
        "Calculated at the nominal interest rate, with monthly accrual and equal instalments due at the end of the month. Fees, insurance and other costs are not included — so this is not the effective interest rate, and the bank's offer will as a rule be higher.",
      invalid: "Enter an amount above zero, a rate of zero or more, and a whole number of months.",
    },
    unitPrice: {
      packageLabel: "Package",
      priceLabel: "Price",
      quantityLabel: "Quantity",
      add: "Add package",
      remove: "Remove",
      unitPriceLabel: "Unit price",
      cheapest: "Cheapest",
      /** How much dearer per unit than the cheapest row — never „ušteda", which would imply a purchase. */
      premium: "more per unit",
      /** Says the one thing this tool does NOT do, so „500 g" and „1 kg" are not compared as 500 and 1. */
      note: "Compare packages expressed in the same unit. If they differ, convert them first with the “Mass” and “Volume” tools.",
      invalid: "Every package needs a price and a quantity above zero.",
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
  devtools: devtoolsEn,
  /* „Stručne alatke" — the drawer that hosts every pack, see `strings/pro.ts`. */
  pro: proEn,
  /* „Elektronika" — the workbench, see `strings/electronics.ts`. */
  electronics: electronicsEn,
  fitness: {
    loadErrorTitle: "Nutrition failed to load",
    loadError: "Loading the nutrition log failed. Close and reopen the page.",
    actionError: "The action failed. Try again.",
    undo: "Undo",
    dismiss: "Dismiss",
    /**
     * PRD FIT: said ONCE, under the day's totals, where the numbers it is about
     * actually are. It states what the data is and what it is not, and asks for
     * nothing.
     */
    referenceOnly:
      "The values are for information — taken from public food composition tables or entered by hand. They are not medical advice.",
    /** The day strip above everything: which day is open, and how to walk. */
    day: {
      previous: "Previous day",
      next: "Next day",
      today: "Today",
      /** Said in place of „Sledeći dan" at the end of the walk: there is no tomorrow to record. */
      noFuture: "The log goes backwards — tomorrow's meal is not a meal yet.",
    },
    /**
     * The five slots, in the order a day happens. „Užina" appears twice in life
     * and would appear twice on screen, so each says WHICH one it is — the
     * stored values are `uzina1`/`uzina2` and the labels have to carry the
     * difference the keys do.
     */
    slot: {
      dorucak: "Breakfast",
      uzina1: "Mid-morning snack",
      rucak: "Lunch",
      uzina2: "Afternoon snack",
      vecera: "Dinner",
    },
    /** The day's four figures, against whatever goals are set. */
    totals: {
      heading: "Total for the day",
      /** The four macros the goals cover, named once and used everywhere. */
      macro: {
        kcal: "Calories",
        protein: "Protein",
        carbs: "Carbohydrates",
        fat: "Fat",
      },
      /** The three that ride every snapshot but have no goal — shown as plain figures where a food is inspected. */
      extra: {
        fiber: "Fibre",
        sugar: "Sugars",
        sodiumMg: "Sodium",
      },
      unitKcal: "kcal",
      unitGram: "g",
      unitMilligram: "mg",
      /** A macro with no goal set. No number is invented for it — the figure stands alone. */
      noGoal: "no target",
      /** A macro past a goal meant as a CEILING (kcal, UH, masti). A fact about two numbers, never a warning. */
      over: "over target",
      /**
       * A macro past a goal meant as a FLOOR — protein, the one goal people set
       * in order to REACH it. Saying „preko cilja" there, in the same colour an
       * overspent envelope wears, would turn eating enough protein into a
       * warning; this is the same fact read the way the user meant the goal.
       */
      reached: "target met",
      /** Nothing has been logged for this day at all. */
      emptyDay: "Nothing for this day yet.",
      /** Points at the one place goals are set, once, under the bars. */
      setGoals: "You set the daily targets in Settings, on the “Fitness” card.",
    },
    /** Adding something to a meal: the search, the amount, and what the food says about itself. */
    picker: {
      add: "Add food",
      cancel: "Cancel",
      searchLabel: "Search foods",
      searchPlaceholder: "e.g. egg, bread, yoghurt…",
      /** Nothing matched. The next sentence is the way out, and it is a real one. */
      noResults: "No food with that name.",
      noResultsHint: "Add it under “My foods” below — with the numbers from the label.",
      /** Shown instead of `noResults` when the search itself rejected — an empty list must not be read as "nothing matched". */
      searchError: "Food search is not working right now. Try again.",
      /** Before anything is typed: the box has nothing to rank, and says so. */
      idle: "Enter the food name.",
      /** The chosen food's own line: the amount, and its household measures beside it. */
      amountLabel: "Amount (g)",
      amountPlaceholder: "100",
      /** The one-tap amounts a food carries. Absent for foods that are weighed — brašno has no „1 komad”. */
      servingsLabel: "Common measures",
      /** On a result row: takes you to the amount, and does not log anything yet. */
      choose: "Choose",
      /** Out of the chosen food, back to the list — a different act from closing the picker, so a different word. */
      back: "Back to the list",
      submit: "Enter",
      /** Per-100 g preview above the amount field, so the number is seen before it is logged. */
      per100gLabel: "Per 100 g",
      /** What the chosen amount actually comes to — the same arithmetic the day total uses. */
      portionLabel: "This amount",
      /** The chip on a food the user added themselves. */
      mine: "My food",
    },
    /**
     * Where a number came from. Every food can answer this, which is the reason
     * the catalogue was built the way it was — and one kind must answer it
     * louder than the rest.
     */
    source: {
      heading: "Where this number comes from",
      usda: "USDA FoodData Central",
      official: "Official composition table",
      derived: "Calculated from the recipe",
      /** A founder-decided figure where no public source pins one down. It never pretends to be measured. */
      stated: "Estimate",
      /** The label in front of the citation's own reference. */
      refLabel: "Reference",
      /**
       * The citation address. Shown as TEXT rather than as a link: this app
       * opens no external links yet (see `setWindowOpenHandler`), and a link
       * that did nothing would be worse than an address that can be copied.
       */
      urlLabel: "URL",
      /** A derived food's working: what went in, and how much of it. */
      recipeLabel: "Recipe",
      yieldLabel: "Yields",
      /**
       * A food the user added. It cites nothing, and the absence is the honest
       * one: the app asserts a catalogue number and must be able to prove it,
       * while this is somebody's claim about their own food.
       */
      userFood: "Your food — the values were entered by hand.",
      /** A `stated` food's two mandatory fields — the uncertainty ships WITH the value. */
      basisLabel: "Basis",
      rangeLabel: "Published range",
      /** Said beside a `stated` food wherever it is picked or reviewed, so a decided number never looks measured. */
      statedNote:
        "There is no public source for this food — the number is an estimate and the real value varies. If you measure it, enter it as your own food.",
      /** The food's own sentence about itself: what it covers, how it was prepared, why a drink is logged in grams. */
      notesLabel: "Note",
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
      edit: "Edit item",
      /** The slot picker inside that form — the fix for „upisao sam ovo pod doručak, a bila je užina". */
      slotLabel: "Meal",
      remove: "Remove",
      removedNotice: "The item was removed.",
      save: "Save",
      cancel: "Cancel",
      /** A meal with nothing in it. Five sections are always drawn; four of them are usually this. */
      emptySlot: "Empty",
      /** The per-meal figure beside a slot's heading. */
      slotTotal: "Total",
    },
    /** „Moje namirnice": what the catalogue does not have, in the user's own words and numbers. */
    foods: {
      heading: "My foods",
      caption:
        "The things the built-in list does not have — “mum's ajvar”, a local brand, a supplement. Copy the numbers from the label, per 100 g.",
      newFood: "New food",
      edit: "Edit",
      delete: "Delete",
      deletedNotice: "The food was deleted.",
      /** Deleting a food says nothing about what was eaten — the log keeps its own numbers. */
      deleteNote: "Meals already logged stay untouched.",
      emptyTitle: "No foods of your own yet",
      emptyDescription:
        "The built-in list covers most everyday food. Here you add what it does not have.",
      expand: "Show details",
      collapse: "Hide details",
    },
    /** The one form, serving both a new food and an edit — the FIN rail's shape. */
    form: {
      newTitle: "New food",
      editTitle: "Edit food",
      nameLabel: "Name",
      namePlaceholder: "Mum's ajvar",
      categoryLabel: "Group",
      /** The header above the seven numbers. Per 100 g, because that is the basis every label already agrees on. */
      macrosLabel: "Per 100 g",
      /** Said under the seven fields: a packet in the hand beats any table. */
      macrosHint: "Copy them from the label. For drinks, 100 ml is entered as 100 g.",
      notesLabel: "Note",
      notesPlaceholder: "What exactly this is, how it was prepared…",
      /** The household measures the picker offers as one-tap amounts. */
      servingsLabel: "Common measures",
      servingsHint: "Optional. Flour is measured, not counted.",
      /**
       * The two fields of one measure, drawn above their boxes. The
       * placeholders below them STAY: „1 kašika" and „15" are a worked example
       * of the pair — a quantity with its unit, and what it weighs — rather
       * than either field's name, which is the distinction DC-120 step 2 turns
       * on. Before these existed the example was the only name, so a filled row
       * read „kašika · 15 · ×".
       */
      servingNameLabel: "Measure",
      servingGramsLabel: "Weight (g)",
      servingLabelPlaceholder: "1 tablespoon",
      servingGramsPlaceholder: "15",
      addServing: "Add measure",
      removeServing: "Remove measure",
      save: "Save",
      cancel: "Cancel",
      /** Refusals, in the vocabulary the store speaks. */
      invalidName: "A name is required.",
      invalidCategory: "Pick a group.",
      invalidNumber: "Enter a number — at most two decimals, no thousands separator.",
      invalidServing: "A measure needs a name and a weight in grams.",
      notFound: "This food no longer exists.",
    },
    /** The seventeen shelves, as the catalogue's own Serbian keys name them. */
    category: {
      zitarice: "Grains",
      pekarsko: "Bakery products",
      testenina: "Pasta",
      mahunarke: "Legumes",
      povrce: "Vegetables",
      voce: "Fruit",
      meso: "Meat",
      riba: "Fish and seafood",
      jaja: "Eggs",
      mlecno: "Dairy",
      orasasti: "Nuts and seeds",
      masti: "Fats and oils",
      slatkisi: "Sweets",
      grickalice: "Snacks",
      pica: "Drinks",
      jela: "Ready meals",
      zacini: "Seasoning",
    },
    /**
     * The page's two halves (ADR-081 §9). FIT is ONE hub — a person tracking
     * their body does not think of food and training as two applications — so
     * this is a section switch inside one page and not a second module.
     */
    sections: {
      label: "Section",
      /** Keyed by `FitSection` so the switch reads `s[option]` and cannot fall through to a wrong label. */
      body: "Body map",
      nutrition: "Nutrition",
      training: "Training",
      measurements: "Measurements",
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
      loadErrorTitle: "Measurements failed to load",
      loadError: "Loading measurements failed. Close and reopen the page.",
      actionError: "The action failed. Try again.",
      /** Facts about a person rather than observations — they change rarely and are entered once. */
      profile: {
        heading: "Body details",
        caption:
          "Sex, date of birth, height and activity level. They are used only to estimate expenditure and rarely change.",
        sexLabel: "Sex",
        /** „Nije uneto" is a real state, not a default — its absence is what closes the Mifflin–St Jeor tier, and the page says that where it matters. */
        sexNone: "Not set",
        sexMale: "Male",
        sexFemale: "Female",
        birthLabel: "Date of birth",
        /** Said where the field is: the age is derived, so it can never go stale. */
        birthHint: "Age is worked out from the date, so it never goes stale.",
        heightLabel: "Height (cm)",
        activityLabel: "Activity level",
        activity: {
          sedentary: "Sedentary",
          light: "Lightly active",
          moderate: "Moderately active",
          active: "Active",
          "very-active": "Very active",
        },
        /** ADR-081 §8a says this out loud because a user who does not know it will trust the wrong digit. */
        activityHint:
          "Activity factors are the roughest part of the whole calculation — published values differ a good deal.",
        save: "Save details",
        saved: "The body details were saved.",
        invalidHeight: "Enter the height in centimetres.",
        invalidBirth: "Enter the date of birth.",
      },
      /** One day's reading. Only the weight makes the row an observation. */
      entry: {
        heading: "New measurement",
        dayLabel: "Day",
        weightLabel: "Weight (kg)",
        bodyFatLabel: "Body fat (%)",
        muscleLabel: "Muscle",
        muscleUnitLabel: "Unit",
        muscleUnitPercent: "%",
        muscleUnitKg: "kg",
        /** The unit travels with the number — converting at entry would store a figure the app computed while dressing it as one the scale measured. */
        muscleHint: "Enter the unit the scale showed — Nexus does not convert it to another.",
        waterLabel: "Water (%)",
        circumferencesLabel: "Circumferences (cm)",
        site: {
          neck: "Neck",
          chest: "Chest",
          upperArm: "Upper arm",
          waist: "Waist",
          hip: "Hips",
          thigh: "Thigh",
        },
        save: "Save measurement",
        remove: "Delete measurement",
        /** Said once, where the fields are. */
        hint: "Only the weight is required. Nexus does not calculate body fat — enter what the scale or callipers showed you.",
        invalidWeight: "Enter the weight in kilograms.",
        invalidNumber: "Enter a number.",
        /** Editing a day that already has a reading overwrites it, which is what a correction is. */
        overwrites: "There is already a measurement for that day — saving replaces it.",
      },
      /** The trend, and the sentence that explains why it is a trend at all. */
      trend: {
        heading: "Weight",
        caption:
          "The line is a seven-day average, the dots are individual measurements. Weight varies a kilogram or two a day with water and food, so the change is read from the average — never yesterday against today.",
        currentLabel: "Trend now",
        changeLabel: "Change",
        unitKg: "kg",
        /** „−0,6 kg za 23 dana" — the actual span, never the one that was asked for. */
        overPrefix: "over",
        dayUnitOne: "day",
        dayUnitFew: "days",
        dayUnitMany: "days",
        rangeLabel: "Range",
        range90: "90 days",
        range365: "A year",
        rangeAll: "All",
        noTrendTitle: "No trend yet",
        noTrend: "The trend is drawn from at least two days of measurements.",
        emptyTitle: "No measurements yet",
        emptyDescription: "Enter your first measurement and the trend will appear here.",
        chartLabel: "Weight over time",
      },
      /** Shown ONLY while there is no body-fat reading, and labelled for what it is. */
      bmi: {
        label: "BMI",
        caveat:
          "A population screening measure — it reads a muscular person as obese. It is shown only while there is no measured body fat.",
      },
      /** Three tiers, and the app always says which one produced the number. */
      energy: {
        heading: "Daily expenditure",
        unit: "kcal",
        method: {
          measured: "Calculated from your data",
          "katch-mcardle": "Katch–McArdle, from the measured body fat",
          "mifflin-st-jeor": "Mifflin–St Jeor, a population formula",
        },
        noneTitle: "Expenditure cannot be estimated yet",
        noneDescription: "Enter the body details and at least one measurement.",
        /** The sentence ADR-081 §8a calls „the feature": what it would take to reach the tier above. */
        nextLabel: "For a more precise estimate",
        missing: {
          profile: "enter the body details",
          sex: "enter the sex",
          measurement: "enter at least one measurement",
          "body-fat": "measure the body fat",
          history: "log meals and weight",
          "window-days": "log for longer",
          "intake-coverage": "log meals more often",
          "trend-readings": "measure yourself more often",
          "plausible-result": "the data does not give a meaningful number yet",
        },
        /** What an estimate RESTS ON, said beside it — the same posture a `stated` food's basis takes. */
        assumption: {
          "population-equation": "the equation is derived from other people, not from you",
          "sex-term-proxies-composition": "a term for sex stands in for body composition",
          "activity-multiplier": "multiplied by an activity factor",
          "energy-density": "7,700 kcal per kilogram of body mass was used",
          "unlogged-days-imputed": "for days with no log, the average of the logged days was used",
        },
        workingLabel: "The calculation",
        workingIntake: "Average intake",
        workingDelta: "Change in trend weight",
        workingDays: "Gap between trends",
        workingCoverage: "Days with meals logged",
        windowNote: "Calculated from the last 14 days.",
      },
      /** A suggestion, offered and never applied — the same rule FIN's exchange rate follows. */
      suggest: {
        heading: "Suggested daily target",
        goalLabel: "Goal",
        goal: { lose: "Lose", maintain: "Maintain", gain: "Gain" },
        rateLabel: "Per week (kg)",
        /** No default rate anywhere: „pola kile nedeljno" is a recommendation, and this app makes none. */
        rateHint: "Nexus does not suggest a pace — enter how much a week you want, and we will work out the intake.",
        resultLabel: "Suggested intake",
        adopt: "Set as the calorie target",
        adopted: "The calorie target was set.",
        note: "The suggestion becomes a target only when you set it yourself. The other three targets are left alone.",
        invalidRate: "Enter how many kilograms a week.",
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
      loadErrorTitle: "Training failed to load",
      loadError: "Loading training failed. Close and reopen the page.",
      /**
       * „Serija" counted, in all three Serbian forms — 1 serija, 2 serije, 5
       * serija. ONE set of forms for the whole section, because it is one noun:
       * the session summary, the tonnage coverage line, a routine's target and a
       * history row all count the same thing, and four copies of this would be
       * four chances to get the teens wrong.
       */
      setsUnit: { one: "set", few: "sets", many: "sets" },
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
        setsLabel: "Hard sets",
        sessionsLabel: "Workouts",
        /**
         * The eyebrow over the band, composed with the window constant itself
         * so it cannot outlive the window it names — „POSLEDNJIH 7 DANA".
         */
        windowLead: "The last",
        windowDayUnit: "days",
        /** Under the band: what the three figures did and did not count. */
        note: "Only what is logged and finished counts; warm-ups are never counted.",
      },
      /** The session in progress — there is at most one, which the schema itself guarantees. */
      session: {
        heading: "Workout in progress",
        /** A session started without a routine. Named, rather than left blank: a blank would read as a session missing its name. */
        adHoc: "Freestyle workout",
        elapsedLabel: "Elapsed",
        elapsedUnit: "min",
        finish: "Finish workout",
        finishError: "The workout could not be finished. Try again.",
        /**
         * The way out of a session started by mistake. Without it the only exit
         * is „Završi" — which would leave an empty finished session in the
         * history to be deleted from there, and a log full of sessions nobody
         * did is a log nobody trusts. Undoable, like every other delete here.
         */
        discard: "Discard workout",
        addExercise: "Add exercise",
        notesLabel: "Workout note",
        notesPlaceholder: "How it went, how you feel…",
        notesSave: "Save note",
        empty: "No set is logged yet.",
        /** The session's own two figures. Never one figure called „obim" — see `tonnageCoverage`. */
        setsLabel: "Working sets",
        tonnageLabel: "Tonnage",
        tonnageUnit: "kg",
        /**
         * Said whenever a session held sets the tonnage could not count — a
         * plank, a run, a pull-up. „Tonaža: 4.280 kg — računato na 14 od 18
         * serija." Without it the figure implies it covered everything, which is
         * exactly the failure `setTonnage`'s refusal exists to prevent.
         */
        tonnageCoverage: "calculated on",
        tonnageCoverageOf: "of",
        /** Shown instead of a tonnage when NOTHING in the session had one. A zero would be a claim about the work. */
        tonnageNone: "Tonnage is not calculated for these exercises",
        warmupNote: "Warm-ups are not counted in the volume.",
      },
      /** One logged set, and the form that writes the next one. */
      set: {
        log: "Log",
        edit: "Edit",
        save: "Save",
        cancel: "Cancel",
        remove: "Delete set",
        /** A set is removed for good — it was a typo, not history. Said where removing is possible. */
        removeNote: "A deleted set does not come back.",
        kindLabel: "Set type",
        kind: {
          warmup: "Warm-up",
          working: "Working",
          drop: "Drop",
          failure: "To failure",
        },
        /**
         * RIR rather than RPE (ADR-081 §4): „koliko ti je još ostalo" is a
         * question a person can answer, and a field people answer wrongly is
         * worse than one they leave empty.
         */
        rirLabel: "RIR",
        rirHint: "How many reps you had left. 0–5, empty if you do not know.",
        /**
         * The five fields, named by what they MEAN. „Pomoć" and „Dodatna težina"
         * are two labels over one column, because assistance getting smaller is
         * the improvement while added weight getting bigger is — see `SET_FIELDS`.
         */
        field: {
          weight: "Weight (kg)",
          assist: "Assistance (kg)",
          reps: "Reps",
          seconds: "Seconds",
          distance: "Metres",
        },
        unitKg: "kg",
        /** Abbreviated on purpose: „10 ponavljanja" and „2 ponavljanja" decline, and a set list is not the place to fight Serbian numerals. */
        unitReps: "reps",
        unitSeconds: "s",
        unitMeters: "m",
        /** Between the load and the count in a set's one-line reading: „60 kg × 10". */
        times: "×",
        /** In front of the load for `weighted_reps` and `assisted_reps` — added, and taken away. */
        addedPrefix: "+",
        assistPrefix: "−",
        /** A number the set does not record. Never a zero, which would be a claim. */
        missing: "—",
        invalidNumber: "Enter a number.",
        invalidWhole: "Enter a whole number.",
        actionError: "The set was not logged. Try again.",
      },
      /** ADR-081 §1.1: the single most used number in any training app. */
      lastTime: {
        label: "Last time",
        none: "First time",
      },
      target: {
        label: "Target",
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
        setsLabel: "Sets from the routine",
        /** The rest THIS line asks for, as opposed to the bar's preset. */
        restLabel: "Rest from the routine",
        /** A line that prescribes zero rest — a real instruction, and not the same as prescribing nothing. */
        restNone: "No rest",
        /** Said once under the log form, because a prefilled field nobody explained is a number somebody may not notice is a suggestion. */
        prefillNote:
          "The fields start from the last logged set; when there is none, from what the routine asks for.",
        /** How much of the routine has been touched at all — lines with at least one working set, over lines in the routine. */
        sessionLabel: "Done from the routine",
      },
      /**
       * The rest countdown (ADR-081 §7). The note is not decoration: the founder's
       * one-timer rule is about what the product RECORDS, and this records
       * nothing — so the surface says so where the timer is, rather than leaving
       * somebody to wonder why their „Fokus" statistics did not move.
       */
      rest: {
        heading: "Rest",
        stop: "Stop",
        done: "The rest is over",
        lengthLabel: "Rest length",
        note: "The countdown is not recorded anywhere and is not part of the statistics in “Focus”.",
        error: "The rest could not be started.",
      },
      /** What the section shows when nothing is open. */
      start: {
        heading: "New workout",
        adHoc: "Freestyle workout",
        fromRoutine: "Start",
        dayLabel: "Day",
        caption: "Start from a routine or freestyle — you can add exercises during the workout.",
        error: "The workout could not be started. Try again.",
        /** The schema allows exactly one open session, so this refusal is a real state rather than a race. */
        alreadyOpen: "A workout is already in progress.",
      },
      /** Finished sessions, newest first. */
      history: {
        heading: "Recent workouts",
        emptyTitle: "No workouts logged yet",
        emptyDescription: "When you finish your first workout, it will appear here.",
        /** Ranges the list can be read over. A day is a range of one, so these are the same read. */
        rangeLabel: "Range",
        range30: "30 days",
        range90: "90 days",
        range365: "A year",
        open: "Open",
        close: "Close",
        /** Reopening a finished session for a correction. Refused while another is open. */
        reopen: "Resume",
        reopenBlocked: "Not while another workout is in progress.",
        /**
         * Correcting the DAY a finished session is filed under.
         *
         * „Nastavi" reopens the sets and leaves the date alone, so a session
         * logged on the wrong day used to be fixable only by deleting it and
         * repeating every set. The write always existed (`fitUpdateWorkout`
         * takes `day`); the control did not.
         */
        dayLabel: "Workout date",
        dayCorrect: "Move to this date",
        delete: "Delete workout",
        deletedNotice: "The workout was deleted.",
        adHoc: "Freestyle workout",
      },
      /**
       * Routines (ADR-081 §6). A routine is a SHAPE — the order of the exercises
       * and what each one is aiming at — and holds nothing about when. The
       * caption says that out loud, because every other fitness app calls the
       * same thing a „plan" and means a calendar.
       */
      routines: {
        heading: "Routines",
        caption: "A routine is a shape of workout: an order of exercises and targets, with no date.",
        newRoutine: "New routine",
        newTitle: "New routine",
        editTitle: "Edit routine",
        nameLabel: "Name",
        namePlaceholder: "e.g. Upper day A",
        notesLabel: "Note",
        notesPlaceholder: "e.g. 10 min warm-up before the first exercise",
        itemsLabel: "Exercises",
        /** Names the two fields, because „nije uspelo" over a form of them names none. */
        invalidRange: "“Reps from” cannot be larger than “to”.",
        addItem: "Add exercise",
        removeItem: "Remove",
        moveUp: "Move up",
        moveDown: "Move down",
        targetSetsLabel: "Sets",
        repsMinLabel: "Reps from",
        repsMaxLabel: "Reps to",
        /**
         * Migration 061's four targets — drawn only for the fields the
         * line's metric actually names (`SET_FIELDS`), same as one set of it
         * would be logged. `targetWeightLabel` and `targetAssistLabel` are
         * two captions over the one stored column, for the same reason the
         * log form gives them two: added load and taken-away assistance are
         * opposite facts about the same lift.
         */
        targetWeightLabel: "Weight (kg)",
        targetAssistLabel: "Assistance (kg)",
        targetSecondsLabel: "Duration (s)",
        targetDistanceLabel: "Distance (m)",
        restSecondsLabel: "Rest (s)",
        /** On the rest field itself — the one target where empty and zero mean two different things and both are real answers. */
        restSecondsHint: "0 means no rest, straight into the next set. Empty means the workout's default rest.",
        targetHint: "Targets are optional — an empty field means there is no target.",
        save: "Save routine",
        cancel: "Cancel",
        edit: "Edit",
        delete: "Delete",
        deletedNotice: "The routine was deleted.",
        emptyTitle: "No routines yet",
        emptyDescription: "Save the shape of workout you repeat and start from it next time.",
        invalidName: "A routine needs a name.",
        needsItems: "A routine needs at least one exercise.",
        /**
         * A line naming an exercise that no longer resolves — one of the
         * profile's own since deleted, or a catalogue entry a later build
         * dropped. The line keeps the name it was written with and cannot be
         * logged against; saying so beats an empty row nobody can explain.
         */
        missingExercise: "This exercise no longer exists",
      },
      /**
       * „Moje vežbe" — the profile's own, and only those. The catalogue ships
       * with the app and is not a table, so there is nothing here that could edit
       * a catalogue entry: „Ishrana" says the same thing about foods, for the
       * same reason.
       */
      exercises: {
        heading: "My exercises",
        caption: "The app's catalogue does not change — only your own exercises are here.",
        newExercise: "New exercise",
        newTitle: "New exercise",
        editTitle: "Edit exercise",
        nameLabel: "Name",
        namePlaceholder: "e.g. Close-grip bench press",
        nameEnLabel: "English name",
        nameEnPlaceholder: "e.g. close-grip bench press",
        nameEnHint: "Optional. Search uses it, the display does not — half the world looks for “RDL”.",
        primaryLabel: "Primary muscles",
        secondaryLabel: "Secondary muscles",
        equipmentLabel: "Equipment",
        patternLabel: "Movement pattern",
        metricLabel: "What one set records",
        /**
         * The one field of this form that decides how the exercise behaves
         * everywhere else, so it is the one with an explanation under it.
         */
        metricHint:
          "Chooses which fields are logged with a set and how volume is calculated. A plank has no tonnage, and assistance on a machine is subtracted.",
        unilateralLabel: "Unilateral (per side)",
        unilateralHint: "Eight reps of a one-arm row is eight PER SIDE.",
        notesLabel: "Note",
        notesPlaceholder: "e.g. bench setting, grip",
        save: "Save",
        cancel: "Cancel",
        edit: "Edit",
        delete: "Delete",
        deletedNotice: "The exercise was deleted.",
        /** Said where deleting is possible: what goes is the exercise, never what was lifted with it. */
        deleteNote: "Deleting an exercise does not touch sets already logged.",
        emptyTitle: "No exercises of your own",
        emptyDescription:
          "The catalogue covers most of it. Add an exercise if you do something it does not have.",
        invalidName: "An exercise needs a name.",
        needsPrimary: "Pick at least one primary muscle.",
        actionError: "The action failed. Try again.",
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
        heading: "Progress",
        caption:
          "It is calculated from the logged sets — nothing is stored separately, so it cannot drift from the log. Warm-ups are never counted.",
        rangeLabel: "Range",
        range90: "90 days",
        range365: "A year",
        emptyTitle: "Nothing to calculate yet",
        emptyDescription: "Log your first workout and progress will appear here.",
        /** Weekly volume — the figure a week is actually balanced against. */
        volumeHeading: "Weekly volume",
        /**
         * The drawn weekly-volume chart. Its read-aloud sentence is composed
         * from these fragments and the figures themselves, so it can never
         * describe bars other than the ones on screen.
         */
        volumeChartCaption: "One bar is one week. Warm-ups are never counted.",
        volumeChartLead: "Hard sets per week",
        volumeChartAcross: "across",
        volumeChartPeak: "most in a week of",
        volumeWeekUnitOne: "week",
        volumeWeekUnitFew: "weeks",
        volumeWeekUnitMany: "weeks",
        tonnageLabel: "Tonnage",
        daysLabel: "Days",
        muscleHeading: "Hard sets per muscle",
        /** Said where the per-muscle counts are: the snapshot carries primaries, and that is the right vocabulary rather than a limitation. */
        muscleNote:
          "A set is counted towards the exercise's primary muscles. Secondary muscles are not counted — otherwise one bench press would be chest and triceps and shoulders.",
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
          heading: "Body map",
          /**
           * Every NUMBER in this caption comes from the constant that actually
           * governs it (`WINDOW_DAYS`, the two band edges, `MUSCLE_GROUPS`),
           * exactly as the habit grid's heading does — so the sentence cannot
           * outlive the drawing it explains.
           */
          captionLead: "Saturation is the number of hard sets per muscle in the last",
          captionDayUnit: "days",
          captionBands: "shades:",
          captionAndUp: "and up",
          captionTail:
            "Pale means no sets, not that the muscle is neglected — that depends on a plan Nexus does not know.",
          front: "Front",
          back: "Back",
          descriptionOf: "of",
          descriptionTrained: "muscle groups got at least one hard set",
          /** The truth behind the picture, as text and as chips — the map is only the shortcut. */
          untouchedHeading: "No sets at all in the last",
          untouchedNone: "Every muscle group got at least one set in this period.",
          setsSuffix: "sets",
          /** A muscle's own label, read on hover: „Grudi: 6 ser. · poslednji put 5. avg 2026.". */
          lastPrefix: "last done",
          neverTrained: "no sets in this period",
          /**
           * „Mapa tela" as its own section (founder, 2026-08-08). The map used
           * to answer one question — šta nisam trenirao — and now answers the
           * other direction too: koji mišić radi koja vežba, i šta ta vežba
           * pogađa. The copy below is that second direction.
           */
          sectionNote:
            "Click a muscle group — on the body or in the list below — then an exercise, to see what that exercise hits.",
          pickerLabel: "Muscle groups",
          pickHint: "Pick a muscle group to see the exercises that train it.",
          weekHeading: "The last",
          clear: "Clear selection",
          backToWeek: "Back",
          drawnFront: "Drawn on the front.",
          drawnBack: "Drawn on the back.",
          primaryHeading: "Exercises that target this",
          primaryNone: "No exercise in the list has this group as primary.",
          secondaryHeading: "Exercises that also engage it",
          secondaryNone: "No exercise in the list engages it secondarily.",
          /** The one chip that tells the shipped catalogue and the profile's own rows apart. */
          mine: "Mine",
          factEquipment: "Equipment",
          factPattern: "Movement pattern",
          factMetric: "A set records",
          factSide: "Execution",
          factUnilateral: "Unilateral (per side)",
          factBilateral: "Bilateral",
          hitsPrimary: "Primary",
          hitsSecondary: "Secondary",
          /**
           * While an exercise is chosen the shading stops being a count and
           * becomes a claim about the movement. Saying so is not a nicety: a
           * shade that means two things without announcing which is the module
           * changing the rules under the reader.
           */
          exerciseCaption: "Saturation now shows what the exercise hits",
          rolePrimary: "primary",
          roleSecondary: "secondary",
          roleNone: "not engaged",
          /** The catalogue carries no instructions, on purpose — see `ExerciseEntry`. */
          noHowTo:
            "Nexus does not describe how to perform an exercise: that is text copied from other products, and a half-described one would be worse than none.",
        },
        /** Personal records, derived on read. A stored PR row and a set table can disagree, and only one of them is the truth. */
        recordsHeading: "Personal records",
        record: {
          heaviest: "Heaviest set",
          bestOneRm: "Estimated 1RM",
          mostReps: "Most reps",
          longestHold: "Longest hold",
          leastAssistance: "Least assistance",
        },
        /** The estimate is published WITH its formula named and refused above ten reps — see `estimateOneRepMax`. */
        oneRmNote:
          "The 1RM estimate uses the Epley formula and only sets of up to ten reps — beyond that the published formulas stop describing the same movement.",
        /** No calorie burn anywhere, said out loud rather than left as a suspicious gap. */
        noBurnNote:
          "Nexus does not show calories burned in a workout: without a heart rate and a measurement that would be a number with an error larger than the meal it is meant to cover.",
      },
      /** One ranked list over the catalogue and the profile's own — one channel, one definition of „best match". */
      picker: {
        searchLabel: "Exercise search",
        searchPlaceholder: "e.g. bench press, RDL, pull-up…",
        idle: "Start typing to find an exercise.",
        noResults: "No exercise matches the search.",
        noResultsHint: "Check the name, or add your own exercise under “My exercises”.",
        searchError: "The search failed. Try again.",
        choose: "Choose",
        cancel: "Cancel",
        /** The one chip that tells the two sources apart. */
        mine: "Mine",
      },
      /** The twenty muscle groups, as the closed vocabulary names them. */
      muscle: {
        grudi: "Chest",
        latovi: "Lats",
        romboidi: "Rhomboids",
        trapez: "Traps",
        "donja-ledja": "Lower back",
        "prednja-ramena": "Front delts",
        "bocna-ramena": "Side delts",
        "zadnja-ramena": "Rear delts",
        biceps: "Biceps",
        triceps: "Triceps",
        podlaktica: "Forearms",
        kvadriceps: "Quadriceps",
        "zadnja-loza": "Hamstrings",
        gluteusi: "Glutes",
        adduktori: "Adductors",
        abduktori: "Abductors",
        listovi: "Calves",
        trbusnjaci: "Abs",
        "kosi-trbusni": "Obliques",
        "fleksori-kuka": "Hip flexors",
      },
      /** What provides the resistance — never „what is in the room". */
      equipment: {
        sipka: "Barbell",
        "ez-sipka": "EZ bar",
        "t-sipka": "T-bar",
        bucice: "Dumbbells",
        girja: "Kettlebell",
        sprava: "Machine",
        smit: "Smith machine",
        kabl: "Cable",
        "sopstvena-tezina": "Bodyweight",
        guma: "Resistance band",
        karike: "Rings",
        trx: "TRX",
        medicinka: "Medicine ball",
        tocak: "Ab wheel",
        vijaca: "Skipping rope",
        "traka-za-trcanje": "Treadmill",
        bicikl: "Bike",
        veslac: "Rowing machine",
        elipticna: "Elliptical",
        stepper: "Stepper",
      },
      /** The shape of the movement — the vocabulary a week is actually balanced against. */
      pattern: {
        "horizontalni-potisak": "Horizontal push",
        "vertikalni-potisak": "Vertical push",
        "horizontalno-privlacenje": "Horizontal pull",
        "vertikalno-privlacenje": "Vertical pull",
        cucanj: "Squat",
        "pregib-kuka": "Hip hinge",
        iskorak: "Lunge",
        nosenje: "Carry",
        olimpijski: "Olympic",
        trup: "Core",
        izolacija: "Isolation",
        kardio: "Cardio",
      },
      /** What one set records (ADR-081 §3) — the field that makes the schema honest. */
      metric: {
        weight_reps: "Weight × reps",
        reps: "Reps",
        weighted_reps: "Added weight × reps",
        assisted_reps: "Assistance × reps",
        time: "Time",
        weight_time: "Weight × time",
        distance_time: "Distance × time",
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
    boardsLabel: "Boards",
    /**
     * The second line of a row in the board list, before the instant itself:
     * „izmenjeno 14:32", „izmenjeno 5. avg, 09:10".
     *
     * A prefix and a formatted time rather than one sentence, exactly as
     * `app.saveSavedPrefix` is — the formatter decides how much of a date the
     * instant needs, and a full sentence here would have to guess.
     */
    boardUpdatedPrefix: "edited",
    /** The board a profile gets the first time it opens the page. */
    firstBoardName: "Board",
    newBoard: "New board",
    /** The name field of the create/rename form — one field, one label, used by both. */
    nameLabel: "Board name",
    namePlaceholder: "Database schema",
    save: "Save",
    cancel: "Cancel",
    rename: "Rename",
    delete: "Delete",
    /** One pending undo at a time, exactly as everywhere else. */
    undo: "Undo",
    deletedNotice: "The board was deleted.",
    dismiss: "Dismiss",
    /** The mermaid action — see this section's own header for why it is a button. */
    mermaid: "Mermaid diagram",
    mermaidTitle: "Write a Mermaid definition and turn it into shapes you can keep editing.",
    loadErrorTitle: "Board failed to load",
    loadError: "Loading boards failed. Close and reopen the page.",
    actionError: "The action failed. Try again.",
    /**
     * The autosave failed. It says what is true — the drawing is on screen and
     * NOT on disk — because „sačuvano“ that silently was not is the one thing a
     * canvas must never imply.
     */
    saveError: "The drawing was not saved. The latest edits are only on screen.",
    /**
     * The one refusal a user can actually cause: a scene past
     * `MAX_CANVAS_SCENE_LENGTH`, which in practice means pasted images. It names
     * the cause rather than the number, because the number is not something
     * anybody can act on.
     */
    tooLarge: "The board is too large to save — the inserted images take up too much space.",
    /**
     * The same two failures, for a board that was LEFT before its last write
     * landed — a switch within the autosave delay. That board's save line is
     * gone and so is its drawing, so these go in the page notice instead, and
     * say which board they mean without claiming the one now open failed.
     */
    leftSaveError: "The latest edits to the previous board were not saved. Open it and check the drawing.",
    leftTooLarge:
      "The latest edits to the previous board were not saved — the inserted images take up too much space.",
    /** Nothing drawn yet, and no board either. */
    emptyTitle: "No boards yet",
    emptyDescription: "Make a board and draw — diagrams, sketches, mind maps.",
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
      label: "Board tools",
      toolLabel: "Tool",
      tool: {
        selection: "Select",
        hand: "Pan",
        rectangle: "Rectangle",
        diamond: "Diamond",
        ellipse: "Ellipse",
        arrow: "Arrow",
        line: "Line",
        freedraw: "Pen",
        text: "Text",
        image: "Image",
        eraser: "Eraser",
      } satisfies Record<CanvasToolId, string>,
      /**
       * Every tool's `title` names the editor's own key: „Pravougaonik ·
       * prečica R". The keys work with or without this bar, so hiding them
       * would be teaching the slower route.
       */
      shortcut: "shortcut",
      strokeLabel: "Stroke colour",
      /** The ink swatch — `--nx-text`, the colour a new board already draws in. */
      inkName: "Ink",
      fillLabel: "Fill",
      /** The default, and the first swatch in the fill row: a shape with no fill at all. */
      fillNone: "No fill",
      widthLabel: "Width",
      width: {
        tanko: "Thin",
        srednje: "Medium",
        debelo: "Thick",
      } satisfies Record<CanvasStrokeWidthId, string>,
      zoomLabel: "Zoom",
      /** „Uvećaj" and „Umanji" are the buttons' accessible names; what they show is − and +. */
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      /** The readout is the button: clicking the percentage puts it back to 100%. */
      zoomReset: "Reset zoom to 100%",
      zoomFit: "Fit",
      zoomFitTitle: "Fit the whole drawing in the window",
      /** „Dodaj karticu" (CANV slice c) — a drawing action, so it sits with them. */
      addCard: "Add card",
      addCardTitle: "Put a note, task or event on the board as a card.",
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
      untitled: "Untitled",
      /** The action every resolved card carries — it opens the object on its own module's page. */
      open: "Open",
      /**
       * Replaces Excalidraw's own English „Click to interact" hint, which
       * `app.css` hides.
       *
       * It says the FIRST of the two clicks, because that is the one nobody
       * expects: the editor keeps a card's DOM inert until a click in its
       * middle arms it, so a person who clicks „Otvori" straight away gets
       * nothing and has no way to know why.
       */
      hint: "Click a card to bring it forward",
      /**
       * The object is gone — deleted, or another profile's. Said plainly, and
       * with the removal offered rather than performed: a note being deleted is
       * not a reason for Nexus to quietly take something off somebody's board.
       */
      missingTitle: "The item is gone",
      missingBody: "The card stays on the board until you remove it.",
      remove: "Remove card",
      /**
       * The card points at something that is not a Nexus object at all — a
       * hand-edited scene file, or an element pasted in from elsewhere. Nexus
       * draws this instead of loading it, and says so rather than showing an
       * empty frame.
       */
      foreignTitle: "Unknown card",
      foreignBody: "This card does not point to anything in Nexus, so it does not open.",
    },
    /** The resolve failed, so the cards on screen have no titles to show. Named separately from `saveError`: nothing is at risk here, only unreadable. */
    cardsError: "The cards were not loaded, so their titles are not shown.",
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
      title: "Add card",
      description: "Pick a note, task or event — the card goes to the middle of the board.",
      searchLabel: "Item search",
      placeholder: "Search notes, tasks and events…",
      /** The search itself failed. The picker stays open with an empty list rather than closing under the user. */
      error: "The search failed. Try again.",
    },
  },

  settings: {
    // The page title reuses `strings.modules.settings` — no duplicate copy.
    /**
     * SET-014: the filter above the section cards. The "nothing matched" line
     * is deliberately NOT repeated here — it reuses the search palette's own
     * `strings.search.emptyResults`, which says exactly this and nothing else.
     */
    searchPlaceholder: "Search settings…",
    /**
     * The second line of the „nema rezultata“ empty state. The title itself is
     * the search palette's own `strings.search.emptyResults`, reused — this
     * says the one thing that is specific to a FILTER rather than to a search:
     * nothing is lost, the cards come back the moment the box is cleared.
     */
    searchEmptyDescription: "Clear the search to bring back all sections.",
    /**
     * SET-015: the eight categories the rail lists, and the one line each of
     * them says about itself. `categoryTitle` is the rail row and the pane
     * heading; `categorySummary` is the subtitle under the heading (and the
     * second line of a row on the narrow root).
     */
    categoryTitle: {
      profile: "Profile and security",
      appearance: "Appearance",
      keyboard: "Keyboard",
      modules: "Modules",
      notifications: "Notifications",
      data: "Data",
      privacy: "Privacy",
      about: "About",
    },
    categorySummary: {
      profile: "Name and picture, profiles, passcode and auto-lock",
      appearance: "Language, theme, accent colour, week and clock",
      keyboard: "Keyboard shortcuts",
      modules: "Which parts of Nexus are on, and each module's settings",
      notifications: "What notifies you, and when",
      data: "Backup, restore, import, export and sync",
      privacy: "Network and updates, what is stored and where, search history",
      about: "Version, data location and licences",
    },
    /** The rail's own landmark name — a name, never drawn. */
    categoriesLabel: "Settings categories",
    /** The back button's accessible name; the visible text is the chevron plus `{name}`. */
    backTo: "Back to {name}",
    /** The two sub-page lists (SET-015). */
    moduleSettingsList: "Module settings",
    importExportList: "Import and export",
    /**
     * The rail badge's accessible text — its visible content is the bare
     * count. The numeral agrees with the count, so the form is picked with
     * `dayUnit` at the call site and `{n}` is filled in with the number.
     */
    searchResultCountOne: "1 result",
    searchResultCountMany: "{n} results",
    /** Section-card titles, in the order they appear on the page. */
    sectionTitle: {
      profile: "Profile",
      profiles: "Profiles",
      security: "Security",
      appearance: "Appearance",
      tasks: "Tasks",
      notes: "Notes",
      priv: "Private notes",
      files: "Files",
      shortcuts: "Shortcuts",
      dashboard: "Dashboard",
      study: "Study",
      calendar: "Calendar",
      finance: "Finance",
      habits: "Habits",
      focus: "Focus",
      fitness: "Fitness",
      tools: "Tools",
      setup: "How Nexus is set up for you",
      modules: "Modules",
      packs: "Tool packs",
      risk: "Notes on the professional tools",
      notifications: "Notifications",
      backup: "Backup and restore",
      /**
       * The eight sub-pages of „Import and export" (SET-015). The text is the
       * one the block inside each already draws, so a list row and its card
       * name the same thing rather than two spellings of it.
       */
      "import-archive": "Import from an archive",
      "import-ics": "Import a calendar (.ics)",
      "export-ics": "Calendar export",
      "import-apkg": "Import from Anki (.apkg)",
      "import-csv": "Import tasks (.csv)",
      "import-fin-csv": "Import a statement (.csv)",
      "import-llm": "Import via an AI assistant",
      "import-markdown": "Import notes (.md)",
      sync: "Sync",
      network: "Network and updates",
      privacy: "Data and privacy",
      about: "About",
      licences: "Licences",
      "content-packs": "Content packs",
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
      action: "Reset to defaults",
      title: "Reset to defaults",
      question:
        "The settings in this section go back to their defaults. Only this device changes — nothing in your data is touched.",
      confirm: "Reset to defaults",
      cancel: "Cancel",
    },
    profile: {
      nameLabel: "Name",
      save: "Save",
      saveError: "Saving failed — the name must be 1–80 characters.",
      /**
       * SET-001: the profile picture. „Slika profila“ names the block; the
       * caption states the automatic crop out loud rather than letting the user
       * discover it — an interactive crop is deliberately not built (the
       * renderer would have to handle the image bytes, which it never does),
       * and a promise the app cannot keep is worse than a plain sentence.
       */
      pictureLabel: "Profile picture",
      pictureCaption: "The picture is cropped to a square automatically.",
      pickPicture: "Choose a picture",
      /** Also the picture's own alt text: it is decoration, so it says what it is rather than describing it. */
      pictureAlt: "Profile picture",
      removePicture: "Remove picture",
      /** One sentence per `ProfilePicturePickErrorCode`: the file was refused, and why. */
      pictureRejected: {
        "too-large": "The picture is too large — at most 10 MB.",
        "unsupported-format": "This format is not supported. Use PNG, JPEG, GIF or WebP.",
        unreadable: "The file cannot be read.",
        /** The format IS allowed but the decoder could not open it — a different sentence, because the user's next step is different. */
        undecodable: "This picture cannot be processed. Try a PNG or JPEG file.",
      } satisfies Record<ProfilePicturePickErrorCode, string>,
      /** A rejected IPC call (not one of the named reasons above). */
      pictureError: "Changing the picture failed. Try again.",
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
        "A business profile keeps work separate from personal — its own tasks, notes and settings, under the same account and the same passcode.",
      /** The active row's second line; the name itself carries the gold active state. */
      activeMarker: "Currently active",
      /** Shown once a business profile is created here: what happened, and that naming comes at first entry (the ONB-lite sentinel, said out loud). */
      createdNotice: "The business profile was created. You name it the first time you enter.",
      /** The offer beside the notice — the same passcode gate every switch passes. */
      switchToNew: "Switch to the new profile",
      delete: "Delete",
      /**
       * Deleting a business profile (ADR-058, the ADR-048 typed-name idiom).
       * Immediate and irreversible, so the warning is read BEFORE the field:
       * what goes, and that it cannot be taken back. Confirmed by typing the
       * profile's display name — for an unnamed business profile that is
       * „Posao“, its fallback label everywhere else too.
       */
      deleteTitle: "Delete profile",
      deleteWarning: "All the profile's data will be permanently deleted. This cannot be undone.",
      deleteConfirmLabel: "Profile name to confirm",
      deleteConfirmPlaceholder: "Enter the exact profile name",
      deleteSubmit: "Delete profile",
      deleteCancel: "Cancel",
      deleteError: "Deleting failed. Try again.",
    },
    /** Sigurnost section (ADR-018 / AUTH): change passcode, regenerate the Recovery Kit, idle auto-lock. */
    security: {
      changeTitle: "Change passcode",
      currentLabel: "Current passcode",
      newLabel: "New passcode",
      confirmLabel: "Confirm new passcode",
      save: "Save",
      changeSuccess: "The passcode was changed.",
      recoveryTitle: "New recovery code",
      recoveryWarning:
        "Making a new code cancels the old one immediately — if the old one is written down anywhere, write the new one over it.",
      regenerate: "Make a new recovery code",
      autoLockTitle: "Auto-lock",
      autoLockHint: "Nexus locks itself after this much inactivity.",
      /** AUTO_LOCK_MINUTES values as select option labels, keyed by the numeric value as a string. */
      autoLockOptions: {
        "5": "After 5 minutes",
        "15": "After 15 minutes",
        "30": "After 30 minutes",
        "60": "After 1 hour",
        "0": "Never",
      } satisfies Record<string, string>,
    },
    /** Theme-preference option labels; Dan/Noć reuse `strings.app.themeDan/themeNoc`. */
    appearance: {
      system: "System",
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
      languageLabel: "Language",
      /** Keyed by locale code; read through `lookup` so the table keeps literal keys. */
      languageNames: {
        sr: "Serbian",
        en: "English",
      } satisfies Record<string, string>,
      languageHint:
        "It changes immediately, with no restart. The list offers the languages that are translated — notifications sent by the system follow the same choice.",
      /** Names the theme segmented row now that a second one (the week start) stands beside it. */
      themeLabel: "Theme",
      /** What „Sistemski“ actually follows — the one thing about this row that is not visible from the three option names. */
      themeHint: "“System” follows the light or dark theme setting on this computer.",
      accentLabel: "Accent colour",
      /** Accent swatch names, keyed by AccentId (SET's 8-accent palette). */
      accentNames: {
        zlato: "Gold",
        bronza: "Bronze",
        maslina: "Olive",
        suma: "Forest",
        zad: "Jade",
        ruza: "Rose",
        bordo: "Burgundy",
        grafit: "Graphite",
      } satisfies Record<string, string>,
      /** PRD 04 §5: the weekday the calendar's month grid and week view open on. */
      weekStartLabel: "First day of the week",
      weekStartOptions: {
        monday: "Monday",
        sunday: "Sunday",
      } satisfies Record<WeekStartPreference, string>,
      /**
       * CAL §5, beside the week start and for the same reason: both describe
       * how this machine reads a calendar. The duration is what the create
       * form seeds an end time with; the clock is how every calendar time is
       * DRAWN — the time fields themselves stay whatever form the system draws
       * them in, which the caption says out loud rather than leaving to be
       * discovered.
       */
      eventDurationLabel: "Default event duration",
      eventDurationOptions: {
        "30": "30 minutes",
        "60": "1 hour",
        "90": "1 hour 30 minutes",
        "120": "2 hours",
      } satisfies Record<string, string>,
      clockLabel: "Time format",
      clockOptions: {
        "24h": "24-hour (14:00)",
        "12h": "12-hour (2:00 PM)",
      } satisfies Record<ClockPreference, string>,
      clockHint: "Time entry fields keep the shape the system draws.",
    },
    /**
     * Zadaci section (ADR-049): a device preference over the „Danas“ and
     * „Sledećih 7 dana“ views, beside the Beleške card below and for the same
     * reason — it describes how this machine reads one module, not what the
     * profile holds, so it belongs to that module rather than to „Izgled“.
     */
    tasks: {
      blockedInTodayLabel: "Blocked tasks in the Today view",
      blockedInTodayCaption:
        "A task that is waiting on another task. Also applies to the “Next 7 days” view.",
      blockedInTodayOptions: {
        sakrij: "Hide",
        prikazi: "Show",
      } satisfies Record<BlockedInToday, string>,
    },
    /** Beleške section (ADR-036): the note editor's reading measure and its markdown shortcuts. */
    notes: {
      widthLabel: "Editor width",
      widthNames: {
        uska: "Narrow",
        normalna: "Normal",
        siroka: "Wide",
      } satisfies Record<string, string>,
      markdownLabel: "Markdown shortcuts",
      markdownCaption:
        "Typing “# ”, “- ” or “> ” converts the block straight away. The “/” menu works even when this is off.",
    },
    /**
     * Privatne beleške card (PRIV v1 / ADR-057) — shown only while the
     * „Privatno" module is enabled. The kit status line states a fact the
     * user chose at setup, in the honest register the whole section keeps.
     */
    priv: {
      caption:
        "Private notes are an encrypted section unlocked separately from the rest of the app.",
      notSetUp: "The section is set up the first time you open the Private module.",
      autoLockLabel: "Section auto-lock",
      autoLockHint: "The section locks itself after this many minutes without work in it.",
      /** „Posle N minuta“ — after „posle" the genitive holds for every count, so one form serves all sixty options. */
      autoLockOptionPrefix: "After",
      minuteUnit: "minutes",
      lockOnMinimizeLabel: "Lock when the window is minimised",
      kitStatusSet: "The recovery code is set — the same code opens both the account and the private notes.",
      kitStatusMissing:
        "No recovery code — if you forget the password, the private notes are irrecoverably lost.",
      saveError: "Saving failed. Try again.",
      loadError: "The private note settings cannot be loaded right now.",
    },
    /**
     * Datoteke card (DOC): the shape „Datoteke" opens in. The caption says the
     * one thing this card could otherwise be feared to do — nothing here
     * touches a file, and the page it configures cannot delete one either.
     */
    files: {
      caption: "Applies to this device only — files are not changed here.",
      viewLabel: "Default view",
      viewNames: {
        lista: "List",
        mreza: "Grid",
      } satisfies Record<string, string>,
      viewHint: "The view can also be changed on the page itself, for the current look.",
    },
    /**
     * Kontrolna tabla section (SET-006 / ADR-041): the dashboard's own
     * background image and how far it is dimmed behind the widgets.
     */
    dashboard: {
      caption: "The picture sits behind the cards on the dashboard.",
      /** Alt text for the current-background thumbnail — the image is decoration, so it says what it is rather than describing it. */
      thumbnailAlt: "Current dashboard background",
      pick: "Choose a picture…",
      clear: "Remove",
      dimLabel: "Dimming",
      /** Hidden while no background is set — a slider with nothing to dim is a control with no effect. */
      dimHint: "More dimming means a calmer background and more readable text.",
      /** One sentence per `DashboardPickErrorCode`: the file was refused, and why. Never a re-encode. */
      rejected: {
        "too-large": "The picture is too large — at most 20 MB.",
        "unsupported-format": "This format is not supported. Use PNG, JPEG, GIF or WebP.",
        unreadable: "The file cannot be read.",
      } satisfies Record<DashboardPickErrorCode, string>,
      /** A rejected IPC call (not one of the named reasons above). */
      error: "Changing the background failed. Try again.",
    },
    /**
     * Učenje section (STUDY-007): how hard the scheduler aims, and how much of
     * it lands on one day. Three settings, one card — they are read together on
     * every session, and a user deciding "less per day" usually means all of it.
     */
    study: {
      caption: "Sets how reviews are scheduled and how many arrive each day.",
      retentionLabel: "Target retention",
      /** Suffix on the preset the scheduler uses when nothing was ever chosen. */
      retentionDefault: "default",
      retentionHint:
        "A higher value means shorter intervals and less forgetting, but also more reviews every day.",
      newPerDayLabel: "New cards per day",
      newPerDayHint: "How many new cards one session offers at most. Zero means review only.",
      reviewCapLabel: "Daily review limit",
      reviewCapHint: "An empty field means no limit. New cards do not count towards this limit.",
      /** Placeholder in the empty cap field — the field's own empty state, said out loud. */
      reviewCapPlaceholder: "no limit",
      /** The one thing about this card a user could otherwise get wrong: nothing already scheduled moves. */
      retroNotice: "The change applies from the next review — cards already scheduled stay as they are.",
      error: "Saving the study settings failed. Try again.",
    },
    /**
     * Kalendar section (CAL-010 / ADR-054): the semester's fixed dates the
     * Semestar view anchors to. A PROFILE fact, unlike the week start and the
     * clock, which are device preferences and stay in „Izgled" — which is why
     * this is its own card rather than two more rows there.
     */
    calendar: {
      caption:
        "The semester dates keep the “Semester” view on the same months. Without them the view slides from the current month.",
      /** Heading over the two date fields — also the SET-014 hit label. */
      datesLabel: "Semester dates",
      startLabel: "Semester start",
      endLabel: "Semester end",
      save: "Save",
      clear: "Remove dates",
      /** The pair rule, said before main and the store refuse it: both dates, in order. */
      invalidPair: "Enter both dates — a semester has a start and an end.",
      invalidOrder: "The semester end cannot be before the start.",
      saved: "The semester dates were saved.",
      cleared: "The semester dates were removed.",
      error: "Saving the semester dates failed. Try again.",
    },
    /**
     * Finansije (FIN slice b). ONE control, and the card says exactly what it
     * does and does not reach: the currency of your money lives on each
     * account, and this only decides which code „Novi račun" opens on — which
     * is also why it is a DEVICE preference and why the card offers a reset.
     */
    finance: {
      caption:
        "The currency is chosen per account. This is only the code the form for a new account opens with — existing accounts are not touched.",
      primaryCurrencyLabel: "Default currency",
      primaryCurrencyHint: "A three-letter code per ISO 4217, for example RSD or EUR.",
      invalidCurrency: "Enter the three-letter currency code, for example RSD.",
      saved: "The default currency was saved.",
    },
    /**
     * HABIT slice c's card. The caption says what the control does NOT do first,
     * because „podrazumevani podsetnik" reads like a switch that turns reminders
     * on for everything, and it is the opposite: nothing reminds until a habit is
     * given a time of its own.
     */
    habits: {
      caption:
        "A reminder is set per habit. This is only the time filled in when you turn on a reminder on a habit — existing habits are not touched.",
      defaultReminderLabel: "Default reminder time",
      defaultReminderHint: "Applies to this device only.",
      saved: "The default time was saved.",
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
        "Phase lengths and how many work phases run before a long break. Applies to phases you start from now on — finished phases keep the time they actually lasted.",
      workLabel: "Work (minutes)",
      shortBreakLabel: "Break (minutes)",
      longBreakLabel: "Long break (minutes)",
      cyclesLabel: "Work phases before a long break",
      hint: "Applies to this device only.",
      saved: "The focus settings were saved.",
      /** The one refusal, pointed at the field the engine named — never a generic „nešto nije u redu". */
      invalid: "The value is outside the allowed range.",
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
        "Daily targets for “Nutrition”. Each is separate and none is required — an empty field means there is no target. Nexus does not suggest values or grade the day.",
      kcalLabel: "Calories (kcal)",
      proteinLabel: "Protein (g)",
      carbsLabel: "Carbohydrates (g)",
      fatLabel: "Fat (g)",
      /** Says what „prazno" means, once, where the fields are — because 0 and absent are different claims. */
      hint: "Leave it empty for “no target”. Zero is a target, an empty field is not.",
      saved: "The targets were saved.",
      invalid: "Enter a number — at most two decimals, no thousands separator.",
      loadError: "The targets cannot be loaded.",
      saveError: "Saving the targets failed. Try again.",
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
        "The rate the “VAT” tool opens with. Changes only the field's starting value — any calculation can be switched to another rate.",
      defaultVatLabel: "Default VAT rate",
      hint: "Applies to this device only.",
      saved: "The default rate was saved.",
    },
    /** One-line module descriptions for the gallery, keyed by module id. */
    moduleDescriptions: {
      dashboard: "Your day at a glance — commitments, tasks and expiring documents.",
      tasks: "Tasks with list and board views, priorities and deadlines.",
      calendar: "Events, an agenda and document expiry tracking.",
      settings: "Profile, appearance, modules and notifications.",
      notes: "Notes with a block editor — Markdown shortcuts and a “/” menu for formatting.",
      study: "Subjects, exams, study cards and exam preparation plans.",
      priv: "Encrypted private notes — unlocked separately and never shown in search.",
      files: "Every file attached to notes, tasks and subjects, in one place.",
      finance: "Accounts, transactions and transfers — the balance is worked out from what you enter.",
      habits: "Daily and weekly habits — streak, history and what is expected today.",
      focus: "A Pomodoro timer and focus history — the same timer “Study” uses.",
      fitness:
        "Nutrition and training — meals and daily targets, a training log with routines and an exercise catalogue.",
      tools: "Unit converters and everyday sums — percentage, VAT, loans and unit price.",
      canvas: "An endless board for drawing, diagrams and sketches — with cards that lead to other modules.",
      electronics:
        "A workbench for Arduino and Raspberry — place boards and sensors from the catalogue and wire them up.",
      pro:
        "Tools by trade — turn on the packs you need, and the drawer shows only those.",
    } satisfies Record<string, string>,
    /** Category-group headings above the module gallery, keyed by registry category. */
    moduleCategories: {
      "Core experience": "Essentials",
      "Content & knowledge": "Content and knowledge",
      "Life hubs": "Life hubs",
      "Professional & utilities": "Professional and utilities",
      "Growth & platform": "Growth and platform",
    } satisfies Record<string, string>,
    modulesAlwaysOn: "Always on",
    modulesToggleError: "The change failed. Try again.",
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
    onboardingRerunTitle: "Your answers",
    onboardingRerunAction: "Run the questionnaire again",
    onboardingRerunCaption:
      "The same questions as on the first run — it starts from what you have now and changes only what you change.",
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
        "Nexus was put together from your answers on the first run. Here is what came out of them.",
      /** No stored answers: not an apology, and not a nag — the standard app is a legitimate answer. */
      none: "The questions were not answered, so Nexus stands at its defaults. You can set everything from here as well, by hand.",
      /**
       * Forgetting is separated from changing, and it says exactly what it
       * does: the answers go, the app stays as it is. A person who wants the
       * standard app back gets it by turning things off, not by deleting a
       * record — otherwise „zaboravi" would be an undo nobody asked for.
       */
      forget: "Forget the answers",
      forgetHint:
        "Deletes the saved answers from this device. Nothing is reverted — the app stays as it is.",
    },
    /** NTF-008 appetite presets — shortcuts over the per-source toggles below. */
    notificationPresets: {
      /** The row's own name, so the three buttons stop being an unlabelled bar at the top of the card. */
      label: "How many notifications",
      minimal: "Minimal",
      normal: "Normal",
      all: "All",
      caption: "Shortcuts for the sources below.",
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
        "Export all your data into one archive — open formats (JSON and CSV), notes as Markdown files and attachments in their original form, all readable and usable without Nexus.",
      /**
       * IMEX-003 — the module picker, closed by default because the default IS
       * everything and the description above already says so. The module names
       * themselves are read off `settings.restore.modules`, the one archive-module
       * vocabulary this screen has.
       */
      modulesToggle: "What gets exported",
      /** The disclosure's own summary when nothing is unticked; a subset shows „4/6“ instead, which needs no words at all. */
      modulesAll: "all",
      /** Shown under the picker when every box is unticked — the state the export button is disabled in. */
      modulesEmpty: "Pick at least one module.",
      encryptLabel: "Protect the archive with a password",
      encryptedNotice:
        "The archive is encrypted with your password — Argon2id and AES-256-GCM. The password is not stored anywhere.",
      passphraseLabel: "Password",
      passphraseConfirmLabel: "Confirm password",
      passphraseHint:
        "At least 12 characters. If you lose it, the archive can no longer be opened — we cannot open it for you either.",
      passphraseTooShort: "The password must be at least 12 characters.",
      passphraseTooLong: "The password can be at most 256 characters.",
      passphraseMismatch: "The passwords do not match.",
      plaintextNotice:
        "The database is encrypted with your passcode, but this archive is not — keep it somewhere safe.",
      plaintextConfirmLabel:
        "I understand that the archive will not be encrypted and that anyone who gets the file can open it.",
      exportButton: "Export all data…",
      savedPrefix: "Saved:",
      savedEncryptedSuffix: "encrypted",
      /** "N zapis"/"N zapisa" — Serbian numeral agreement via `dayUnit`. */
      recordsUnitOne: "record",
      recordsUnitMany: "records",
      /**
       * Shown only when `missingAttachments > 0` (ADR-022): "Nedostaje N
       * prilog(a) — arhiva je ipak sačuvana." Numeral agreement via `dayUnit`,
       * mirroring `recordsUnitOne`/`recordsUnitMany`. The closing clause
       * deliberately carries no pronoun: "bez njih" would be wrong at a count
       * of one, and this line has to read correctly at every count.
       */
      missingAttachmentsPrefix: "Missing",
      missingAttachmentsUnitOne: "attachment",
      missingAttachmentsUnitMany: "attachments",
      missingAttachmentsSuffix: "— the archive was saved anyway.",
      /**
       * Privatne beleške u izvozu (ADR-057 §6). The included line renders as
       * „… (N).“ with the count in parentheses — deliberately, so one form
       * reads correctly at every count (a declined „beleške/beležaka“ would
       * need three). Shown whenever `privateNotes > 0`: the user must never
       * learn from a zip listing that their most guarded notes left the app.
       * The two skip sentences map the result's `privateNotesSkipped` codes —
       * exactly one is ever shown, and only when there was something to skip.
       */
      privateNotesIncludedPrefix: "The archive also includes the private notes",
      privateNotesSkippedLocked: "The private notes were not exported — the section is locked.",
      privateNotesSkippedPlaintext: "The private notes were not exported because the export has no password.",
      error: "The export failed. Try again.",
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
      title: "Automatic backup",
      description:
        "Nexus makes an encrypted archive of the whole profile itself, in the folder you pick — daily or weekly, while the app is unlocked. A missed slot is made up at the next unlock.",
      enableLabel: "Turn on automatic backup",
      /** Shown while the toggle is disabled — names the two prerequisites instead of leaving a dead checkbox unexplained. */
      enableHint: "Before turning it on, pick a folder and set a password.",
      cadenceLabel: "Frequency",
      cadenceOptions: {
        daily: "Daily",
        weekly: "Weekly",
      },
      folderLabel: "Folder",
      folderPick: "Choose a folder…",
      folderNone: "No folder is chosen.",
      keepLastLabel: "How many copies are kept",
      keepLastHint: "After each successful copy, ones older than this number are deleted.",
      /** Labels for `BACKUP_KEEP_LAST_CHOICES`, keyed by the numeric value as a string — Serbian numeral agreement spelled per choice. */
      keepLastOptions: {
        "2": "2 copies",
        "3": "3 copies",
        "5": "5 copies",
        "10": "10 copies",
        "20": "20 copies",
        "50": "50 copies",
      } satisfies Record<string, string>,
      passphraseTitle: "Archive password",
      /** One label, two moments: the button SETS a first passphrase and CHANGES an existing one — `passphraseStatusSet` says which state the card is in. */
      passphraseSave: "Set a password",
      passphraseChange: "Change the password",
      passphraseStatusSet: "The password is set.",
      /** The one fact a change must say out loud: it reaches only future runs. */
      passphraseFutureNote:
        "The new password applies to future copies — files made earlier stay under the old one.",
      runNow: "Make one now",
      lastRunPrefix: "Last:",
      lastRunOk: "successful",
      lastRunFailed: "failed",
      lastRunNever: "No copy has been made yet.",
      /** One clause per `BackupRunErrorCode`, composed into „nije uspela — <razlog>, <vreme>". */
      runErrors: {
        "folder-unreachable": "the folder is not reachable",
        "passphrase-unreadable": "the saved password cannot be read",
        "write-failed": "writing the archive failed",
        unknown: "unknown error",
      } satisfies Record<string, string>,
      error: "The action failed. Try again.",
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
      title: "Calendar export",
      description:
        "Export just the calendar as .ics — the standard format Google Calendar, Apple Calendar and Outlook open. The file is not password-protected, because then no other calendar could open it.",
      button: "Export calendar (.ics)",
      /** "N događaj"/"N događaja" — Serbian numeral agreement via `dayUnit`. */
      eventsUnitOne: "event",
      eventsUnitMany: "events",
      /**
       * Shown only when `skipped > 0`: "N događaj(a) nije izvezeno — datum
       * početka nije ispravan." Numeral agreement via `dayUnit`, and the reason
       * sits outside the counted phrase so it reads correctly at every count.
       */
      skippedPrefix: "Not exported:",
      skippedSuffix: "— the start date is not valid.",
      error: "The calendar export failed. Try again.",
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
      title: "Restore from an archive",
      description:
        "Restore data from an archive made by the export above. Everything now in this profile will be deleted and replaced by the archive's contents — you can undo the restore with one click, but only until you lock or close the app.",
      pickButton: "Choose an archive…",
      pickedPrefix: "Chosen:",
      passphraseLabel: "Archive password",
      previewButton: "Show a preview",
      previewRunning: "Reading the archive…",
      /** Preview header: the archive's own manifest facts, beside its file name. */
      createdLabel: "Made",
      versionLabel: "Version",
      sourceLabel: "Profile in the archive",
      /**
       * The replace warning, composed around the target profile's name in JSX
       * (the `savedPrefix` idiom) rather than through a placeholder — there is
       * no interpolation layer here, and inventing one for a single sentence
       * would outlive its usefulness.
       */
      replaceWarningPrefix: "Everything now in the profile",
      replaceWarningSuffix: "will be deleted and replaced by the archive's contents.",
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
        tasks: "Tasks",
        calendar: "Calendar",
        study: "Study",
        notifications: "Notifications",
        notes: "Notes",
        dashboard: "Dashboard",
        finance: "Finance",
        habits: "Habits",
        fitness: "Fitness",
        canvas: "Board",
        // ELEC joins on „Navike"'s terms: the archive vocabulary is the
        // interchange's, not the registry's, so the row appears here as soon
        // as the archive carries the rows — and reads 0 on both sides until
        // the module has a screen, which is true.
        electronics: "Electronics",
      } satisfies Record<keyof RestoreModuleCounts, string>,
      columnCurrent: "Now",
      columnIncoming: "From the archive",
      /**
       * Shown only when `corruptBlobs > 0`: "Arhiva sadrži N prilog(a) sa
       * oštećenim sadržajem — …". Numeral agreement via `dayUnit`, and the
       * qualifier deliberately sits OUTSIDE the counted phrase — "N oštećen
       * prilog" and "N oštećenih priloga" would need three forms, while a
       * bare "prilog"/"priloga" reads correctly at every count.
       */
      corruptBlobsPrefix: "The archive contains",
      corruptBlobsUnitOne: "attachment",
      corruptBlobsUnitMany: "attachments",
      corruptBlobsSuffix: "with damaged content — those files will not be restored.",
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
      privateNotesIncomingPrefix: "The archive also contains private notes",
      privateNotesSkippedNotice:
        "The private notes from the archive will not be restored — unlock the private section before restoring.",
      applyButton: "Restore data",
      cancelButton: "Cancel",
      applying: "Restoring…",
      applied: "The data was restored. The app is refreshing…",
      /** A rejected pick/preview call (not one of the typed statuses below). */
      readError: "Reading the archive failed. Try again.",
      /** A rejected apply call; the preview itself stays valid, so this invites a retry. */
      error: "The restore failed. Try again.",
      /** `{ status: "no-file" }`: main no longer holds the pick this screen was showing. */
      noFileError: "The archive is no longer chosen. Choose it again.",
      /** The post-reload banner (App.tsx), shown for as long as the undo is live. */
      undoBanner: "The data was restored from a backup.",
      undoButton: "Undo",
      undoDismiss: "Dismiss notification",
      undoError: "The undo failed. Try again.",
      /** One sentence per `ArchiveReadErrorCode`: the archive could not be opened at all. */
      unreadable: {
        "not-an-archive": "This file is not a Nexus archive.",
        "passphrase-required": "The archive is password-protected — enter the archive password.",
        "passphrase-wrong": "Wrong password for this archive.",
        damaged: "The archive is damaged and cannot be read.",
        "too-large": "The archive exceeds the safety limits and was refused.",
      } satisfies Record<ArchiveReadErrorCode, string>,
      /**
       * One sentence per `RestoreProblemCode`: the archive opened, but its
       * contents did not check out. Honest about what is wrong without naming
       * internals — the machine-readable part (file, line, field) is rendered
       * beside each sentence, muted, straight from the problem itself.
       */
      problems: {
        "missing-manifest": "The archive has no manifest — without it there is no knowing what it holds.",
        "invalid-manifest": "The archive's manifest is not valid.",
        "unsupported-schema-version":
          "The archive was made in a newer version of Nexus and this version cannot read it.",
        "missing-data-file": "The archive is missing a data file its manifest lists.",
        "checksum-mismatch":
          "The file's contents do not match its checksum — the archive is damaged or was altered.",
        "invalid-json": "The data file is not valid JSON.",
        "unknown-record-type": "The archive contains a record type this version does not know.",
        "invalid-record": "A record in the archive is not valid.",
        "duplicate-id": "The same record appears more than once in the archive.",
        "unknown-reference": "A record points to something the archive does not have.",
        "reference-cycle": "Records in the archive point at each other in a circle.",
        "invalid-ydoc": "A note's content in the archive is not valid.",
        "missing-ydoc": "A note in the archive is missing its content.",
        "missing-blob": "An attachment is missing its file in the archive — the record is restored without it.",
        // ADR-058: arhiva se vraća samo u profil svoje vrste (lični ↔ poslovni).
        "profile-kind-mismatch":
          "The archive belongs to another profile type (personal/business) and cannot be restored into this profile — pick a profile of the same type.",
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
      title: "Import from an archive",
      description:
        "Add the contents of someone else's archive — or your own other profile — to this profile. An import deletes nothing: everything you already have stays where it is, and the archive's contents come alongside as new records. You can undo the import with one click, but only until you lock or close the app.",
      /** Preview header, beside the archive's own manifest facts (which reuse restore's labels). */
      targetLabel: "Importing into",
      encryptedBadge: "Encrypted archive",
      /**
       * The per-module table's four columns — `ImportModuleCounts`' own
       * arithmetic, in its own order: `parsed = imported + merged + skipped`.
       */
      columnParsed: "In the archive",
      columnImported: "Importing",
      columnMerged: "Merged",
      columnSkipped: "Skipped",
      /** Says what the two middle columns mean before the user has to guess — merging is the part nobody expects. */
      tableCaption:
        "“Merged” are records that matched something you already have — a tag with the same name, a link that already exists. Everything “skipped” is listed below, reason by reason.",
      /** Heading above the skip list; rendered only when the plan actually skips something. */
      skipsTitle: "What is not imported",
      /**
       * Heading above the parse warnings. A restore's preview needs none — it
       * shows one list — while an import shows the grouped skip report AND the
       * row-by-row detail behind it, and two unlabeled lists in a row would
       * read as one.
       */
      warningsTitle: "Warnings while reading the archive",
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
          "Damaged row — a record type this version of Nexus does not know; the rest of the archive imports normally.",
        "invalid-record": "Damaged row — the record is not valid and is skipped.",
        "duplicate-id": "Damaged row — the same record appears more than once in the archive; the first is taken.",
        "unknown-reference": "Damaged row — a record points to something the archive does not have.",
        "reference-cycle": "Damaged row — records in the archive point at each other in a circle.",
        "missing-ydoc": "Damaged row — a note in the archive is missing its content.",
        "invalid-ydoc": "Damaged row — a note's content in the archive is not valid.",
        "settings-not-imported":
          "Settings from the archive are not imported — modules and notifications stay as they are set on this device.",
        "notifications-not-imported":
          "Recorded notifications are not imported — that list belongs to the profile it was made in.",
        "dashboard-settings-not-imported":
          "The dashboard background is not imported — your dashboard's look stays yours.",
        "dashboard-sets-not-imported":
          "Named dashboards from the archive are not imported — your dashboards stay yours.",
        "dashboard-widgets-not-imported":
          "The dashboard layout is not imported — your dashboard stays as it is.",
        "study-settings-not-imported":
          "Study settings from the archive are not imported — your target retention and daily limits stay yours.",
        // Migration 057: kalorijski i makro ciljevi su odluka o sopstvenom telu,
        // vezana za profil — tuđi se ne preuzimaju.
        "fit-targets-not-imported":
          "Nutrition targets from the archive are not imported — your calories and macros stay yours.",
        // Migration 060: pol, datum rođenja, visina i nivo aktivnosti su
        // odluka o sopstvenom telu, vezana za profil — tuđi se ne preuzimaju.
        "fit-body-profile-not-imported":
          "Body details from the archive are not imported — your details stay yours.",
        // Migration 060: merenje je vezano za (profil, dan) — tuđe merenje bi
        // se ili sudarilo sa tvojim za taj dan, ili ga tiho udvostručilo.
        "fit-measurements-not-imported":
          "Body measurements from the archive are not imported — your measurement history stays yours.",
        "calendar-settings-not-imported":
          "Semester dates from the archive are not imported — your calendar stays on your schedule.",
        "profile-picture-not-imported":
          "The profile picture from the archive is not imported — your picture stays yours.",
        // ADR-057 §6: privatne beleške se nikada ne uvoze — tuđe otključane
        // tajne se ne zapečaćuju pod tvojim ključem.
        "private-notes-not-imported":
          "Private notes from the archive are not imported — the private section is personal and does not travel into someone else's profile.",
        "template-name-taken": "A template with the same name already exists for you — yours is kept.",
        "source-inbox-collapsed":
          "The default list from the archive is not created again — its tasks go into your default list.",
        "duplicate-of-existing": "It already exists for you — skipped by your choice.",
        // Migration 051: sudar je oko MESTA (kategorija + valuta), ne oko
        // imena, pa mu treba sopstvena rečenica.
        "budget-slot-taken":
          "You already have a budget for that category in that currency — your amount stays.",
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
      duplicatesTitle: "Already exists for you",
      duplicatesCaption:
        "This from the archive matches something you already have. By default it is skipped. If you want it anyway, it is imported as a separate, new record — what you already have is not changed in either case.",
      /**
       * What each group IS, in the module's own word („Ljudi“ is the panel
       * CAL-007 calls it, „Prilozi“ the one every attachment block calls it), and
       * what „isto“ means for it. Two closed maps over the wire's own
       * `ImportDuplicateType`, so a group added in `shared/ipc.ts` is a compile
       * error here rather than a row the screen cannot label — which for a row
       * that asks the user a question would be the worst possible gap.
       */
      duplicateLabels: {
        event: "Events",
        person: "People",
        document: "Documents",
        attachment: "Attachments",
      } satisfies Record<ImportDuplicateType, string>,
      duplicateIdentities: {
        event: "the same title and time",
        person: "the same name and date",
        document: "the same type and name",
        // One group for all three attachment tables: the identity is the file.
        attachment: "the same file",
      } satisfies Record<ImportDuplicateType, string>,
      /** The two-state control. „Uvezi svejedno“ says out loud that this is the deliberate choice, not the ordinary one. */
      duplicateSkipButton: "Skip",
      duplicateImportButton: "Import anyway",
      /** The group's accessible name, since the two buttons alone do not say what they are answering. */
      duplicateChoiceLabel: "What to do with matches",
      /** A rejected re-plan; the preview on screen stays valid, so this invites a retry rather than starting over. */
      duplicateError: "The choice could not be applied. Try again.",
      /**
       * The corrupt-blob line's closing clause only: the count, its numeral
       * agreement and the „Arhiva sadrži“ opening are the restore's, and only
       * the verb differs — those files are not RETURNED here, they are not
       * imported.
       */
      corruptBlobsSuffix: "with damaged content — those files will not be imported.",
      applyButton: "Import",
      applying: "Importing…",
      applied: "The data was imported. The app is refreshing…",
      /** A rejected apply call; the preview itself stays valid, so this invites a retry. */
      error: "The import failed. Try again.",
      /** The post-reload banner (App.tsx) when the undo slot holds an IMPORT — the button, the dismiss label and the error line are the restore's, since undoing is one mechanism. */
      undoBanner: "The data was imported from an archive.",
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
      title: "Import from Anki (.apkg)",
      description:
        "Import an Anki deck as Nexus cards. The decks go into the area you pick, and nothing you already have is changed. Cards arrive as new: study history, images, audio and Anki tags are not carried over — everything that does not make it is written out, piece by piece, in the preview before the import. You can undo the import with one click, but only until you lock or close the app.",
      pickButton: "Choose an .apkg file…",
      /** The subject picker — the one decision only the user can make, since an .apkg has no subject of its own. */
      subjectLabel: "Area for the imported decks",
      /** The „make one" option, first in the list because a first Anki import usually has nowhere to land yet. */
      newSubjectOption: "New area…",
      newSubjectLabel: "Name of the new area",
      newSubjectPlaceholder: "e.g. Anatomy",
      previewButton: "Show a preview",
      previewRunning: "Reading the deck…",
      /** Preview header: what the file holds, and where it is going. */
      subjectPrefix: "Area:",
      subjectNewSuffix: "— will be created",
      columnSource: "In the deck",
      columnPlanned: "Importing",
      rowDecks: "Decks",
      rowNotes: "Notes",
      rowCards: "Cards",
      skipsTitle: "What is not imported",
      /**
       * One sentence per `ApkgImportSkipCode`, each saying what was lost and —
       * where it is not obvious — why this app cannot carry it. The wording
       * never blames the user's deck for a difference between two programs.
       */
      skips: {
        "unknown-notetype":
          "The note uses a card type the deck does not describe or that this version cannot read — without it there is no knowing what is the question and what is the answer.",
        "unknown-deck": "The card belongs to a deck that is not in the file.",
        "empty-note": "The note has no text on the front.",
        "empty-deck": "An empty deck is not created — not a single card was left in it.",
        "template-unsupported":
          "An Anki template this version cannot display — basic and reversed cards are imported.",
        "cloze-nested": "A blank inside a blank — such a note cannot be recorded.",
        "cloze-no-deletions": "The note is a “cloze”, but has no blank at all.",
        "cloze-unrepresentable":
          "The blanks in the note cannot be recorded exactly in Nexus's form, so the note is skipped whole — a wrongly placed blank would be worse than none.",
        "cloze-hint-dropped": "The hint beside a blank is not carried over — just the blank remains.",
        "extra-fields-dropped":
          "The note's extra fields are not carried over — a card has a front and a back.",
        "media-stripped": "Images and audio are not carried over; the cards arrive as plain text.",
        "tags-dropped": "Anki tags are not carried over.",
        "history-dropped":
          "Study history is not carried over — the cards arrive as new. Suspended and buried cards arrive the same way.",
        "card-without-note": "The card points to a note that is not in the deck.",
      } satisfies Record<ApkgImportSkipCode, string>,
      /** One sentence per `ApkgReadErrorCode`: the file could not be read at all. */
      unreadable: {
        "not-an-apkg": "This file is not an Anki deck.",
        "no-collection": "There is no Anki collection in this file — it is not an .apkg deck.",
        "unsupported-schema":
          "The deck is in a version of the Anki database this version does not read — it is probably from a newer Anki. Both the newest format and exports with “Support older Anki versions” are read, so export the deck from Anki again and try once more.",
        "zstd-unavailable": "This build cannot open the zstd compression this deck uses.",
        damaged: "The deck is damaged and cannot be read.",
        "too-large": "The deck exceeds the safety limits and was refused.",
      } satisfies Record<ApkgReadErrorCode, string>,
      applyButton: "Import",
      applying: "Importing…",
      applied: "The cards were imported. The app is refreshing…",
      /** A rejected pick/preview call (not one of the typed statuses above). */
      readError: "Reading the deck failed. Try again.",
      /** A rejected apply call; the preview itself stays valid, so this invites a retry. */
      error: "The import failed. Try again.",
      /** `{ status: "no-file" }`: main no longer holds the pick this screen was showing. */
      noFileError: "The deck is no longer chosen. Choose it again.",
      /** Shown when the deck translates to nothing at all — the „Uvezi" button is hidden, because there is nothing to confirm. */
      nothingToImport: "There is nothing to import from this deck — the reasons are listed above.",
      /** The post-reload banner (App.tsx) when the undo slot holds an Anki import. */
      undoBanner: "The cards were imported from an Anki deck.",
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
      title: "Import tasks (.csv)",
      description:
        "Import tasks from a CSV table — an export from another tool or a hand-kept list. You say which column is what, all the tasks go into one list you pick, and nothing you already have is changed. Everything that cannot be read is written out, row by row, in the preview before the import. You can undo the import with one click, but only until you lock or close the app.",
      pickButton: "Choose a .csv file…",
      reading: "Reading the table…",
      /** The mapping dialog (SET §, ADR-062): a row per detected column, the two parse toggles, and the destination list. */
      mapTitle: "Column mapping",
      mapQuestion: "Say which column is what — a suggestion is already filled in, confirm or change it.",
      /** How an unnamed column introduces itself when the file has no header row: „Kolona 3". */
      columnFallbackPrefix: "Column",
      /** The muted sample line under each header, prefixed so three values do not read as a sentence. */
      samplesLabel: "Examples:",
      roleLabel: "Column role",
      /**
       * One option label per `CsvImportColumnRole`. „Lista (ne uvozi se)" says
       * the role's own truth in the select itself: the import cilja jednu
       * listu, so a list column is recognised but its cells are not carried.
       */
      roles: {
        title: "Task title",
        description: "Description",
        dueDate: "Due date",
        priority: "Priority",
        status: "Status",
        list: "List (not imported)",
        section: "Section",
        tags: "Tags",
        ignore: "Not imported",
      } satisfies Record<CsvImportColumnRole, string>,
      /** Under the column rows: why the confirm button is asleep until exactly one column is the title. */
      titleRequired: "Exactly one column must be Task title.",
      delimiterLabel: "Column separator",
      delimiterComma: "Comma (,)",
      delimiterSemicolon: "Semicolon (;)",
      headerLabel: "The first row is a header",
      /** The destination — ONE list for the whole file (ADR-062), existing or named into being. */
      listLabel: "List for the imported tasks",
      newListOption: "New list…",
      newListLabel: "Name of the new list",
      newListPlaceholder: "e.g. Import",
      confirmButton: "Show a preview",
      /** A rejected map call; the dialog stays open, so this invites a retry. */
      mapError: "The mapping could not be applied. Try again.",
      /** The plan preview under the dialog: where it goes, what arrives, what does not. */
      listPrefix: "List:",
      listNewSuffix: "— will be created",
      rowRows: "Rows in the table",
      rowTasks: "Tasks importing",
      /** Rendered only when non-zero: blank spreadsheet lines are not losses, but the arithmetic still says where they went. */
      blankRowsPrefix: "Blank rows:",
      /** Back to the mapping dialog — the same rows, the same suggestions, a fresh plan on confirm. */
      remapButton: "Change the mapping",
      dropsTitle: "What is not imported",
      /** How a dropped row names itself: „Red 12" — the data row's own number, header excluded, as the spreadsheet shows it. */
      dropRowPrefix: "Row",
      /**
       * One sentence per `CsvImportRowDropCode`. The due-date sentence says the
       * task still arrives — losing the date must never read as losing the row.
       */
      drops: {
        "empty-title": "No task title — the row is skipped.",
        "bad-due-date":
          "The due date could not be read (a two-digit year is refused, the century is not guessed) — the task is imported without a due date.",
      } satisfies Record<CsvImportRowDropCode, string>,
      /** The mapped-„Lista" count line: prefix, then the number, then this suffix. */
      listCellsDroppedPrefix: "Values in the “List” column:",
      listCellsDroppedSuffix:
        "— not carried over; all tasks go into the list chosen above.",
      /** One sentence per `CsvImportReadErrorCode`: the file could not be turned into columns at all. */
      unreadable: {
        "too-large": "The table exceeds the safety limits (5 MB) and was refused.",
        empty: "There are no rows with data in this file.",
        "too-many-columns": "The table has too many columns to map.",
        unreadable: "The file could not be read. Try again.",
      } satisfies Record<CsvImportReadErrorCode, string>,
      applyButton: "Import",
      applying: "Importing…",
      applied: "The tasks were imported. The app is refreshing…",
      /** A rejected pick/preview call (not one of the typed statuses above). */
      readError: "Reading the table failed. Try again.",
      /** A rejected apply call; the plan itself stays valid, so this invites a retry. */
      error: "The import failed. Try again.",
      /** `{ status: "no-file" }`: main no longer holds the pick this screen was showing. */
      noFileError: "The file is no longer chosen. Choose it again.",
      /** Shown when the mapping translates to nothing at all — the „Uvezi" button is hidden, because there is nothing to confirm. */
      nothingToImport: "There is nothing to import from this table — the reasons are listed above.",
      /** The post-reload banner (App.tsx) when the undo slot holds a CSV import. */
      undoBanner: "The tasks were imported from a CSV table.",
    },
    /**
     * Uvoz izvoda (.csv) → Finansije — FIN slice e. The task CSV import's
     * sibling in shape (pick → mapiranje → pregled → potvrda) and its opposite
     * in tone: this one is about money, so every sentence here says what was
     * READ and what was REFUSED rather than merely what arrived.
     */
    finCsvImport: {
      title: "Import a statement (.csv)",
      description:
        "Import transactions from a bank statement into one of your accounts. You say which column is the date and which is the amount — and whether the amount is one signed column or separate columns for outflow and inflow. The number and date format is determined across the whole column; if the file allows two readings, the import is refused rather than guessed. The same statement can be imported twice without duplicates — every already-imported row is skipped and written out in the preview.",
      pickButton: "Choose a statement (.csv)…",
      reading: "Reading the statement…",
      /** Shown instead of the pick button when the profile has no account to import into. */
      noAccounts: "Create an account first — the statement goes into the account you pick, and the account carries the currency the statement cannot bring with it.",
      mapTitle: "Statement column mapping",
      mapQuestion: "Say which column is what — a suggestion is already filled in, confirm or change it.",
      columnFallbackPrefix: "Column",
      samplesLabel: "Examples:",
      roleLabel: "Column role",
      /**
       * One option label per `FinCsvImportColumnRole`. „Isplata"/„Uplata" name
       * the two split columns by MEANING — money leaving and money arriving —
       * because „duguje"/„potražuje" mean opposite things depending on whose
       * books are being read.
       */
      roles: {
        date: "Date",
        amount: "Amount (signed)",
        outflow: "Outflow (money out)",
        inflow: "Inflow (money in)",
        payee: "Payee",
        note: "Description",
        currency: "Currency",
        ignore: "Not imported",
      } satisfies Record<FinCsvImportColumnRole, string>,
      /** Under the column rows: why the confirm button is asleep. */
      dateRequired: "One column must be Date.",
      amountRequired:
        "The amount must be either one signed column, or Outflow and/or Inflow columns — never both.",
      delimiterLabel: "Column separator",
      delimiterComma: "Comma (,)",
      delimiterSemicolon: "Semicolon (;)",
      headerLabel: "The first row is a header",
      /** The destination — ONE existing account for the whole file; its currency governs every amount. */
      accountLabel: "Account the statement goes into",
      accountHint: "This account's currency applies to the whole statement. A statement in another currency is refused — Nexus has no exchange rate.",
      /** The sign convention: stated by the user, never sniffed. */
      signLabel: "What the sign in the Amount column means",
      signs: {
        "negative-is-expense": "Minus = expense, plus = income",
        "positive-is-expense": "Plus = expense, minus = income",
      } satisfies Record<FinCsvImportSignConvention, string>,
      confirmButton: "Show a preview",
      mapError: "The mapping could not be applied. Try again.",
      /** The plan preview: where it goes, how it was read, what arrives, what does not. */
      accountPrefix: "Account:",
      rowRows: "Rows in the statement",
      rowTransactions: "Transactions importing",
      blankRowsPrefix: "Blank rows:",
      remapButton: "Change the mapping",
      /** The two conventions the file was READ under — said out loud, never left to trust. */
      formatsTitle: "How the file was read",
      amountFormatLabel: "Numbers",
      amountFormats: {
        "decimal-comma": "1,234.56 — comma is the decimal separator",
        "decimal-dot": "1.234,56 — dot is the decimal separator",
      } satisfies Record<FinCsvImportAmountFormat, string>,
      dateFormatLabel: "Dates",
      dateFormats: {
        iso: "2026-08-31",
        "dmy-dot": "31.08.2026",
        "dmy-slash": "31/08/2026 — day/month/year",
        "mdy-slash": "08/31/2026 — month/day/year",
      } satisfies Record<FinCsvImportDateFormat, string>,
      signFormatLabel: "Sign",
      dropsTitle: "What is not imported",
      dropRowPrefix: "Row",
      /** One sentence per `FinCsvImportRowDropCode`. Only the last one keeps the row. */
      drops: {
        "bad-date": "The date could not be read — the row is skipped.",
        "no-amount": "There is no amount (or it is zero) — the row is skipped.",
        "both-amounts": "Both Outflow and Inflow are filled in — which one applies is not guessed, the row is skipped.",
        "bad-amount": "The amount could not be read in the determined format — the row is skipped.",
        "text-truncated": "The description is longer than the ledger holds, so it was shortened — the transaction is imported.",
      } satisfies Record<FinCsvImportRowDropCode, string>,
      /** The re-import block: every already-imported row, named (migration 052). */
      skipsTitle: "Already imported",
      skipsCaption:
        "These rows were recognised by the transaction's fingerprint (date, amount, description and position among identical rows) and are not imported again.",
      skips: {
        "already-imported": "This transaction is already in the ledger.",
        "already-imported-deleted": "This transaction was imported and then deleted — it stays deleted.",
      } satisfies Record<FinCsvImportRowSkipCode, string>,
      /** The FILE-level refusals: the importer could not read it CONFIDENTLY, so it read none of it. */
      refusalTitle: "The statement was refused",
      refusalColumnPrefix: "Column:",
      refusalSamplePrefix: "The value in question:",
      refusals: {
        "ambiguous-amount-format":
          "The amounts in this column allow two readings that give different numbers. Money is not guessed — fix the format in the file (one decimal marker for the whole column) and try again.",
        "unreadable-amount-format":
          "No value in this column reads as an amount. The wrong column was probably mapped.",
        "ambiguous-date-format":
          "The dates in this column allow both day/month and month/day, and the two readings give different days. The import is refused rather than guessed.",
        "unreadable-date-format":
          "No value in this column reads as a date. The wrong column was probably mapped.",
        "foreign-currency":
          "The statement is in a different currency than the chosen account. Nexus holds no exchange rate — there is no honest way to convert it — so this statement is not imported into this account.",
      } satisfies Record<FinCsvImportRefusalCode, string>,
      unreadable: {
        "too-large": "The statement exceeds the safety limits (5 MB) and was refused.",
        empty: "There are no rows with data in this file.",
        "too-many-columns": "The statement has too many columns to map.",
        unreadable: "The file could not be read. Try again.",
      } satisfies Record<CsvImportReadErrorCode, string>,
      applyButton: "Import",
      applying: "Importing…",
      applied: "The transactions were imported. The app is refreshing…",
      readError: "Reading the statement failed. Try again.",
      error: "The import failed. Try again.",
      noFileError: "The file is no longer chosen. Choose it again.",
      /** Shown when everything was either skipped or dropped — there is nothing to confirm. */
      nothingToImport: "There is nothing to import from this statement — the reasons are listed above.",
      /** The post-reload banner (App.tsx) when the undo slot holds a statement import. */
      undoBanner: "The transactions were imported from a bank statement.",
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
      title: "Import a calendar (.ics)",
      description:
        "Import events from an .ics file — from Google Calendar, Outlook or any other app that exports one. The import deletes nothing: the events come alongside the ones you already have. Reminders are not carried over, and a time written in another time zone is recalculated to this computer's clock. Everything that does not make it is written out, piece by piece, in the preview before the import. You can undo the import with one click, but only until you lock or close the app.",
      pickButton: "Choose an .ics file…",
      previewRunning: "Reading the calendar…",
      /** The preview's two columns: what the file holds, and how much of it arrives. */
      columnSource: "In the file",
      columnPlanned: "Importing",
      rowEvents: "Events",
      skipsTitle: "What is not imported",
      /**
       * One sentence per `IcsImportSkipCode`, each saying what was lost and —
       * where it is not obvious — why this app cannot carry it. The wording
       * never blames the user's calendar for a difference between two programs.
       */
      skips: {
        "invalid-start": "The event has no valid start (DTSTART), so it is skipped.",
        "unknown-timezone":
          "The event names a time zone this computer does not know, so it is skipped — guessing the offset would move it by several hours.",
        "empty-summary": "The event has no title, so it is skipped.",
        "invalid-end": "The event's end is not valid — the event is imported without a duration.",
        "invalid-exdate": "An excluded recurrence date is not valid, so it is left out.",
        "recurrence-unmappable":
          "The repeat rule does not exist in Nexus — only the first occurrence is imported, as a one-off event.",
        "detached-override":
          "An individually moved occurrence of someone else's series is imported as a separate, one-off event.",
        "categories-dropped": "The event has several categories — the first is carried over.",
      } satisfies Record<IcsImportSkipCode, string>,
      /**
       * The lead-in of one component line: „Sadržaj vrste VTODO se ne uvozi —
       * 3“. The NAME between the two halves is the file's own (VTODO, VALARM,
       * X-…), which no closed map could label — and the honest sentence is the
       * same for all of them: Nexus reads events out of a calendar, nothing
       * else.
       */
      componentPrefix: "Content of type",
      componentSuffix: "is not imported — Nexus reads only events from a calendar.",
      /** One sentence per `IcsImportReadErrorCode`: the file could not be read at all. */
      unreadable: {
        "too-large": "The file exceeds the safety limits and was refused.",
        "not-a-calendar": "This file is not an iCalendar (.ics) calendar.",
      } satisfies Record<IcsImportReadErrorCode, string>,
      /**
       * Shown only when the planner recognised events this profile already has
       * (ADR-051). The sentence says which way the plan currently goes, and the
       * choice beside it — the import block's own „Preskoči / Uvezi svejedno"
       * pair, read from `settings.import` so the flows cannot drift — is how
       * the user says otherwise.
       */
      duplicatesPrefix: "You already have",
      duplicatesUnitOne: "event",
      duplicatesUnitFew: "events",
      duplicatesUnitMany: "events",
      duplicatesSuffix: "from this file — they are not imported again.",
      /** The same sentence's other ending, once a re-preview said „uvezi svejedno": nothing merges, the rows arrive as new. */
      duplicatesSuffixImported: "from this file — they are imported anyway, as new events.",
      applyButton: "Import",
      applying: "Importing…",
      applied: "The events were imported. The app is refreshing…",
      /** A rejected pick/preview call (not one of the typed statuses above). */
      readError: "Reading the calendar failed. Try again.",
      /** A rejected apply call; the preview itself stays valid, so this invites a retry. */
      error: "The import failed. Try again.",
      /** `{ status: "no-file" }`: main no longer holds the pick this screen was showing. */
      noFileError: "The file is no longer chosen. Choose it again.",
      /** Shown when the file translates to nothing at all — the „Uvezi" button is hidden, because there is nothing to confirm. */
      nothingToImport: "There is nothing to import from this file — the reasons are listed above.",
      /** The post-reload banner (App.tsx) when the undo slot holds an .ics import. */
      undoBanner: "The events were imported from a calendar (.ics).",
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
      title: "Import via an AI assistant",
      description:
        "Nexus writes you an instruction, you paste it together with your text into a chat with your AI assistant (ChatGPT, Claude, Gemini…), and paste the answer you get back here. Nexus talks to no model: nothing from this device leaves on its own — you choose what to paste and where. The import deletes nothing and you can undo it with one click, but only until you lock or close the app.",
      /** Step 1 — what is being imported. The three kinds the app can build a row from with no further decision. */
      kindLabel: "What you are importing",
      kinds: {
        tasks: "Tasks",
        events: "Events",
        cards: "Cards",
      } satisfies Record<LlmImportKind, string>,
      /** The same three, lowercase, for the middle of a sentence — `kinds` is written for a picker option, which is a different place in a different case. */
      kindsInline: {
        tasks: "tasks",
        events: "events",
        cards: "study cards",
      } satisfies Record<LlmImportKind, string>,
      /** The prompt's own language — not the content's; the instruction tells the assistant to keep that. */
      languageLabel: "Instruction language",
      languages: {
        sr: "Serbian",
        en: "English",
      } satisfies Record<LlmPromptLanguage, string>,
      /** Step 2 — the clipboard button and the sentence that says what to do with what it copied. */
      copyButton: "Copy the instruction",
      copied: "The instruction was copied",
      copyError: "Copying failed. You can select the instruction in the field below and copy it by hand.",
      copyHint:
        "Paste the instruction into the chat with the assistant, and your text below it. Paste the answer you get back into the field below.",
      /** The prompt itself, shown so „Kopiraj" is never a black box — and so a failed clipboard write still leaves a way through. */
      promptLabel: "Instruction",
      promptShow: "Show the instruction",
      promptHide: "Hide the instruction",
      /** Step 3 — the answer. */
      answerLabel: "The assistant's answer",
      answerPlaceholder: "Paste what the assistant answered here…",
      /** The deck choice, shown only for cards: an odgovor iz ćaskanja names no deck, and a Nexus card lives in one. Two paths — a deck the profile already has, or one this import creates. */
      deckChoiceLabel: "Where the cards go",
      deckExistingOption: "An existing deck",
      deckNewOption: "A new deck",
      deckLabel: "Deck for the imported cards",
      deckPlaceholder: "Choose a deck",
      /** The new-deck form: a name, and the subject the deck lives under — a špil cannot exist outside an oblast. */
      newDeckLabel: "Name of the new deck",
      newDeckPlaceholder: "e.g. Cell",
      newDeckSubjectLabel: "Area for the new deck",
      newDeckSubjectPlaceholder: "Choose an area",
      /** Shown under „Postojeći špil" when the profile has none — the way out is the other path, one click away. */
      noDecks: "You have no deck yet — pick “A new deck” to make one here.",
      /** Shown instead of the whole deck choice when the profile has no subject at all — an honest dead end with the way out named, because a new deck needs an oblast to live in. */
      noSubjects:
        "You have no area yet. Make one on the Study page, then come back here — every deck lives in one area.",
      previewButton: "Review",
      previewRunning: "Reading the answer…",
      /** The preview's three numbers, which answer three different questions. */
      rowRecords: "Records in the answer",
      rowAccepted: "Read",
      rowPlanned: "Importing",
      /** Said under the table, because „Uvozi se" being larger than „Pročitano" surprises anyone who has not met cloze cards. */
      cardsCaption:
        "One sentence with several blanks becomes several cards — one for each blank.",
      /**
       * Shown only when the planner recognised events this profile already has
       * (ADR-051). The sentence says which way the plan currently goes, and the
       * choice beside it — the import block's own „Preskoči / Uvezi svejedno"
       * pair, read from `settings.import` so the two flows cannot drift — is
       * how the user says otherwise.
       */
      duplicatesPrefix: "You already have",
      duplicatesUnitOne: "event",
      duplicatesUnitFew: "events",
      duplicatesUnitMany: "events",
      duplicatesSuffix: "from this answer — they are not imported again.",
      /** The same sentence's other ending, once a re-plan said „uvezi svejedno": nothing merges, the rows arrive as new. */
      duplicatesSuffixImported: "from this answer — they are imported anyway, as new events.",
      /** Shown only when unknown keys were dropped, so „uvezeno je manje polja nego što sam video" is never a surprise. */
      droppedPrefix: "Discarded",
      droppedUnitOne: "field",
      droppedUnitFew: "fields",
      droppedUnitMany: "fields",
      droppedSuffix: "that Nexus does not know.",
      skipsTitle: "What is not imported",
      /** How a skipped record names itself: „Zapis 3" — the answer's own position, so the user can find it in their chat. */
      skipRecordPrefix: "Record",
      /**
       * One sentence per `LlmImportSkipReason`. Each says what was wrong with
       * that one record and — where it helps — what to ask for instead. The
       * wording never blames the user for what a model wrote.
       */
      skips: {
        "not-an-object": "Not a record — there is something else in that place in the answer.",
        "missing-field": "A required field is missing.",
        "invalid-field": "The field is not in the required form (wrong date, time, or a value outside the list).",
        "text-too-long": "The field's text is too long.",
        "unknown-card-shape":
          "The card is neither a question/answer pair nor a sentence with blanks — it must be exactly one of the two.",
        "no-cloze-deletion": "The sentence has no blank in {{double curly braces}}.",
        "over-record-cap": "Over the limit of 500 records per answer.",
      } satisfies Record<LlmImportSkipReason, string>,
      /**
       * One sentence per `LlmImportAnswerProblem`: the paste could not be read
       * at all. Each ends with what to do next, because every one of these is
       * fixed in the chat window rather than here.
       */
      unreadable: {
        empty: "No answer was pasted.",
        "too-long": "The answer is too large. Split the text into smaller parts and import them in turn.",
        "no-json":
          "There is no JSON in the answer. The assistant probably answered with a sentence — ask it to answer with JSON only, exactly as in the instruction.",
        "not-json":
          "What the assistant sent is not valid JSON (usually a comma after the last element). Ask it to send the same answer as valid JSON.",
        "not-an-envelope":
          "This is not an answer in the form the instruction asks for. Check that the whole answer was pasted, with “nexus-llm” at the start.",
        "unsupported-version":
          "The answer is in a form this version of Nexus does not read. Copy the instruction again and ask anew.",
        "unknown-kind": "The answer names a record type Nexus does not know.",
      } satisfies Record<LlmImportAnswerProblem, string>,
      /** The answer was readable, but for a different kind than the picker says — fixed by changing the picker, not the chat. */
      kindMismatchPrefix: "This answer contains",
      kindMismatchSuffix: "— but the choice above is another type. Change the choice or ask again.",
      applyButton: "Import",
      applying: "Importing…",
      applied: "The data was imported. The app is refreshing…",
      /** Shown when nothing at all survived the read — the „Uvezi" button is hidden, because there is nothing to confirm. */
      nothingToImport: "There is nothing to import from this answer — the reasons are listed above.",
      /** A rejected preview call (not one of the typed statuses above). */
      readError: "Reading the answer failed. Try again.",
      /** A rejected apply call; the preview itself stays valid, so this invites a retry. */
      error: "The import failed. Try again.",
      /** The post-reload banner (App.tsx) when the undo slot holds an LLM import. */
      undoBanner: "The data was imported via an AI assistant.",
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
      title: "Import notes (.md)",
      description:
        "Import Markdown files as notes — each file becomes one note in the folder you pick. The title is the first “# ” in the file, or the file's own name if there is none. Images are not carried over: they stay as text with their path.",
      folderLabel: "Folder for the imported notes",
      /** The unfiled root — the same place a note created from the notes page lands. */
      rootOption: "No folder",
      filesButton: "Choose .md files…",
      folderButton: "Choose a folder…",
      /** Said beside the folder button, because a folder pick reaches into subfolders and that must not be a surprise. */
      folderHint: "The folder is read together with its subfolders; all the notes go into the chosen folder.",
      running: "Importing…",
      /** „Uvezeno 3 beleške" — full Serbian numeral agreement via `countUnit`. */
      createdPrefix: "Imported",
      createdUnitOne: "note",
      createdUnitFew: "notes",
      createdUnitMany: "notes",
      /** Shown when the pick produced nothing at all — no file in it could become a note. */
      createdNone: "No note was imported.",
      /** Shown only when `imagesAsText > 0`: the slice imports no files, and the user hears it here rather than discovering it in a note. */
      imagesPrefix: "Images were not carried over:",
      imagesUnitOne: "image stayed",
      imagesUnitFew: "images stayed",
      imagesUnitMany: "images stayed",
      imagesSuffix: "as text with a path.",
      skipsTitle: "What was not imported",
      skips: {
        "too-large": "The file is larger than 1 MB.",
        "too-long": "The file's content is too large for one note.",
        unreadable: "The file cannot be read.",
        empty: "The file is empty.",
        "too-many": "At most 200 files are imported at once — this one and all after it were skipped.",
        "not-markdown": "Not a Markdown file (.md or .markdown).",
      } satisfies Record<MarkdownImportSkipCode, string>,
      error: "The note import failed. Try again.",
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
     */
    sync: {
      description:
        "Nexus can keep an encrypted copy of your data on a Nexus account and share it with the web app. The server sees only encrypted content — the key stays on your devices.",
      /** The switch, and the one thing about it a user has to be told up front. */
      cloudLabel: "Allow network access",
      cloudHint: "While it is off, Nexus opens no connection to the internet — not a single one.",
      cloudRestart: "The change applies from the next start of Nexus.",
      /** No project baked into this build: the card says so instead of failing later. */
      unconfigured: "This version of Nexus is not connected to any server, so sync is not available.",
      enableTitle: "Turn on sync on this computer",
      enableIntro:
        "You make the account and two-step verification in the web app. Here you enter the same email and password and one code from the authenticator app.",
      emailLabel: "Account email",
      passwordLabel: "Account password",
      passwordHint: "The password does not leave this computer — the server receives only a value derived from it.",
      totpLabel: "Code from the authenticator app",
      deviceNameLabel: "Name of this computer",
      deviceNameHint: "The name is encrypted before it is sent — the server does not read it.",
      submit: "Turn on sync",
      working: "Turning on…",
      /** Shown once, and the copy has to make that unmistakable. */
      recoveryTitle: "Sync recovery code",
      recoveryIntro:
        "Write this code down and keep it off the computer. It is shown only now and stored nowhere. Without it and without a paired device there is no way back to the account key.",
      recoveryDone: "I have written the code down",
      statusOn: "Sync is on on this computer.",
      accountLabel: "Account",
      deviceLabel: "Device",
      enabledAtLabel: "Turned on",
      signedOut: "This computer is currently not signed in to the account.",
      connecting: "Connecting…",
      reconnectTitle: "Reconnect this computer",
      /**
       * Says what happened, in the user's terms, and what it costs. „Prijava je
       * istekla" rather than „sesija je opozvana": the most common cause is
       * another računar uključivao sinhronizaciju, which ends every other
       * prijava on the account, and none of that is the user's vocabulary.
       */
      reconnectIntro:
        "This computer's sign-in to the account is no longer valid — that happens when another device connects to the account or when you sign out of all devices. The key is still here; only a new sign-in is needed.",
      reconnectPasswordHint:
        "The password stays on this computer. A value derived from it is sent, never the password itself.",
      reconnectSubmit: "Connect",
      reconnectError: "Connecting failed. Try again.",
      reconnectErrors: {
        invalid_credentials: "Wrong password.",
        email_not_confirmed: "Confirm the email address in the web app, then try again.",
        invalid_code: "The verification code was not accepted. Wait for the next code and try again.",
        mfa_not_enrolled: "The account has no two-step verification. Turn it on in the web app, then come back here.",
        session_expired: "The sign-in has expired. Try again.",
        rate_limited: "Too many attempts. Wait a few minutes.",
        unavailable: "The server is not responding right now. Try later.",
        unknown: "Something did not go through. Try again.",
        unauthenticated: "The sign-in did not go through. Try again.",
        session_not_live: "The sign-in is no longer valid. Try again.",
        session_not_aal1: "The sign-in did not go through properly. Try again.",
        not_enabled: "This account has no key yet. Turn on sync.",
        // The two that are NOT „try again", and whose sentences must say so:
        // this machine no longer holds the account's key, and no number of
        // attempts changes that.
        proof_rejected:
          "This computer does not have the account's key. Pair it with a device that has the key, or use the recovery code.",
        master_key_unreadable:
          "The key saved on this computer cannot be opened. Pair the computer with a device that has the key, or use the recovery code.",
        too_many_devices:
          "The account already has the maximum number of computers. Sign one out in the web app, then try again.",
        account_mismatch: "The sign-in does not belong to the account saved on this computer.",
        register_failed: "The server failed to connect this computer. Try later.",
        rejected_by_schema: "The server rejected the data. Report a bug.",
        cloud_off: "Network access is off for this run.",
        locked: "Unlock Nexus, then try again.",
        not_enabled_here: "Sync is not on on this computer.",
        bad_request: "The data is not valid. Check the computer name.",
      } satisfies Record<SyncReconnectProblem, string>,
      /**
       * The account has a key this computer did not mint. Not an error — a fork
       * in the road, and since the adoption screen exists the sentence names the
       * road rather than describing it: „upotrebi kod za oporavak" was true and
       * pointed at nothing the user could press.
       */
      alreadyMinted:
        "This account already has a key, but this computer does not. Connect this computer with the account's recovery code.",
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
      adoptChoiceTitle: "This computer is joining an account that already exists",
      adoptChoiceHint:
        "Choose this if sync is already on on one of your devices. You need the recovery code that was written down then.",
      adoptTitle: "Connect this computer to an existing account",
      adoptIntro:
        "Enter the account details and the recovery code written down when sync was first turned on. This computer then gets the account key and its data merges with the other devices.",
      recoveryCodeLabel: "Recovery code from the account",
      recoveryCodeHint:
        "The one written down when sync was turned on on the first device — not the code from the authenticator app. It does not leave this computer either.",
      adoptChoiceAction: "Connect an existing account",
      adoptBackAction: "Turn on sync from scratch instead",
      adoptSubmit: "Connect this computer",
      adoptWorking: "Connecting…",
      adoptError: "Connecting to the account failed. Try again.",
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
        invalid_credentials: "Wrong email or password.",
        email_not_confirmed: "Confirm the email address in the web app, then try again.",
        invalid_code: "The verification code was not accepted. Wait for the next code and try again.",
        mfa_not_enrolled: "The account has no two-step verification. Turn it on in the web app, then come back here.",
        mfa_ambiguous: "The account has more than one verification method. Leave one in the web app, then try again.",
        session_expired: "The sign-in has expired. Try again.",
        rate_limited: "Too many attempts. Wait a few minutes.",
        unavailable: "The server is not responding right now. Try later.",
        unknown: "Something did not go through. Try again.",
        step_up_failed: "Two-step verification did not complete. Try again.",
        unauthenticated: "The sign-in did not go through. Try again.",
        session_not_live: "The sign-in is no longer valid. Try again.",
        session_not_aal1: "The sign-in did not go through properly. Try again.",
        not_enabled: "This account has no key yet. Turn on sync instead of connecting.",
        // The account never minted. Retyping the code is the one thing that
        // cannot help, so the sentence must not send the user at the code.
        not_minted:
          "Sync has never been turned on on this account, so there is no key to fetch. Turn on sync on this computer.",
        // And this one must not suggest anything else is wrong, because nothing
        // else is: the account, the password and the second factor all passed.
        recovery_code_rejected:
          "The recovery code was not accepted. Copy it exactly as written and try again.",
        bootstrap_failed: "The server did not allow this computer access to the account. Try later.",
        proof_rejected: "The key obtained with the recovery code was not accepted. Report a bug.",
        too_many_devices:
          "The account already has the maximum number of computers. Sign one out in the web app, then try again.",
        register_failed: "The server failed to connect this computer. Try later.",
        rejected_by_schema: "The server rejected the data. Report a bug.",
        cloud_off: "Network access is off for this run.",
        locked: "Unlock Nexus, then try again.",
        already_enabled: "Sync is already on on this computer.",
        bad_request: "The data is not valid. Check the computer name.",
      } satisfies Record<SyncAdoptProblem, string>,
      disconnectTitle: "Sign this computer out",
      disconnectWarning:
        "The device is withdrawn from the account and this computer forgets its copy of the key. The data stays here and opens with the passcode as before; getting back to the account goes through pairing with another device or through the recovery code.",
      disconnect: "Sign this computer out",
      disconnectConfirm: "Sign out",
      disconnectCancel: "Cancel",
      errors: {
        invalid_credentials: "Wrong email or password.",
        email_not_confirmed: "Confirm the email address in the web app, then try again.",
        invalid_code: "The verification code was not accepted. Wait for the next code and try again.",
        mfa_not_enrolled: "The account has no two-step verification. Turn it on in the web app, then come back here.",
        mfa_ambiguous: "The account has more than one verification method. Leave one in the web app, then try again.",
        session_expired: "The sign-in has expired. Try again.",
        rate_limited: "Too many attempts. Wait a few minutes.",
        unavailable: "The server is not responding right now. Try later.",
        unknown: "Something did not go through. Try again.",
        step_up_failed: "Two-step verification did not complete. Try again.",
        unauthenticated: "The sign-in did not go through. Try again.",
        session_not_live: "The sign-in is no longer valid. Try again.",
        second_factor_required: "The account requires two-step verification.",
        factor_must_predate_session: "Two-step verification did not complete. Try again.",
        sessions_from_different_accounts: "The sign-ins do not belong to the same account. Try again.",
        sessions_must_differ: "The sign-in did not go through properly. Try again.",
        rejected_by_schema: "The server rejected the data. Report a bug.",
        mint_failed: "The server failed to make the account key. Try later.",
        round_trip_mismatch:
          "The server did not save what this computer sent, so sync was not turned on. Try again; if it repeats, report a bug.",
        cloud_off: "Network access is off for this run.",
        locked: "Unlock Nexus, then try again.",
        already_enabled: "Sync is already on on this computer.",
        bad_request: "The data is not valid. Check the computer name.",
      } satisfies Record<SyncEnableProblem, string>,
      error: "Turning on sync failed. Try again.",
      disconnectError: "Signing out failed. Try again.",
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
        title: "Sync status",
        running: "Sync is running…",
        synced: "Everything is in step.",
        idle: "Waiting for the first sync.",
        nextAt: "Next check at {time}.",
        lastAt: "Last check at {time}.",
        applied: "Fetched",
        pushed: "Sent",
        owed: "Pending",
        quarantined: "Unreadable",
        now: "Sync now",
        working: "Working…",
        problems: {
          cloud_off: "Network access is off for this run.",
          not_enabled: "Sync is not on on this computer.",
          locked: "Nexus is locked, so there is no key to sync with.",
          signed_out: "The sign-in is no longer valid. Sign in again further down this card.",
          offline: "The server is not reachable. The attempt repeats on its own.",
          forbidden:
            "The sign-in has expired or this computer has been withdrawn from the account. Sign in again further down this card.",
          malformed: "The server sent data this version does not understand.",
          key_unavailable:
            "This computer does not have the key for this profile. Pair it with a device that has it, or use the recovery code.",
          contested: "The key was written but read back as empty. Try again.",
          nonce_reuse:
            "A safety check stopped sync for this profile. The key must be replaced before continuing.",
        } satisfies Record<SyncProblem, string>,
      },
    },
    /**
     * „Podaci i privatnost“ (SET-010, local half): six plain sentences, each
     * one a fact about how this build is put together rather than a promise.
     *
     * The six sentences have deliberately nothing to operate — no toggle, no
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
     *                  metadata migration 003 keeps in the clear.
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
        "All your data — notes, tasks, events, cards and attachments — sits on this device, in an encrypted database. The key is unlocked by your passcode and is never sent anywhere.",
      noTelemetry:
        "Nexus collects no telemetry or analytics. No counters, no usage reports, no profiling.",
      /**
       * The local half of the network story, stated with its condition
       * attached. „Offline" here means the mode this device is in: while it is
       * on, Nexus opens no connection, not even a version check. The mode is
       * the first card of this category (ADR-089), which is where the last
       * sentence sends the reader, and it is the only place the answer changes.
       */
      offline:
        "While network access is off, Nexus opens no connection to the internet — not even version checks. You change the mode in the “Network and updates” card.",
      sync: "If you turn on sync, encrypted content goes to the server — along with the fact that the device sent it and when. The key stays on your devices; the server does not have it and cannot read what it keeps.",
      exports:
        "An export is an ordinary file: you choose where it is kept, and you can protect the archive with a password when making it.",
      deletion:
        "Deleting an account permanently destroys its data, along with the key it was encrypted with. There is no undo and no waiting period.",
      /**
       * SRCH-009. The caption states the three facts a user would otherwise
       * have to trust: what is kept, where it stays, and that it never rides
       * in an izvoz — each one true of migration 050 by construction, not by
       * a filter somebody remembered to write.
       */
      searchHistory: {
        title: "Search history",
        caption:
          "Nexus remembers the last 20 searches of this profile, so you can repeat them quickly. They stay in the encrypted database on this device, do not cross into another profile and do not go into an export or a backup.",
        clear: "Delete search history",
        /** Below the button: how many entries are there right now, or that there are none. */
        empty: "No saved searches.",
        countOne: "saved search",
        countFew: "saved searches",
        countMany: "saved searches",
        error: "Deleting the search history failed. Try again.",
      },
    },
    /**
     * ADR-091 — the „Paketi sadržaja" card. See the Serbian table's block for
     * what the card has to say and why; the two tables carry the same keys, so
     * the compiler is what keeps them honest.
     */
    contentPacks: {
      intro:
        "A pack is a folder of public content — offline Wikipedia, a map, a dataset — and Nexus accepts it only when it is signed with Nexus's own key. The content stays on this device, in a folder beside the encrypted database, and it is not part of a profile backup.",
      emptyTitle: "No packs are installed.",
      emptyBody:
        "You bring a pack as a folder on a disk or a USB stick: pack.json, its signature, and the content itself. Here you can see what is installed, verify it, and remove a pack.",
      install: "Install from a folder…",
      installHint:
        "Nexus checks the signature and every hash first, and only then copies. Nothing is sent to the internet and nothing in your profile is touched.",
      verify: "Verify",
      verifying: "Verifying…",
      remove: "Remove",
      candidateTitle: "Install this pack?",
      candidateQuestion: "The folder holds “{title}”, version {version}, {size}.",
      candidateHint:
        "The signature is already verified. Installing copies the content into this device's packs folder and adds it to the list.",
      installConfirm: "Install",
      removeTitle: "Remove the pack?",
      removeQuestion: "The pack's content is deleted from this device. Your profile data is not touched.",
      removeConfirm: "Remove",
      cancel: "Cancel",
      versionLabel: "Version",
      sizeLabel: "Size",
      filesLabel: "Files",
      licenceLabel: "Licence",
      attributionLabel: "Attribution",
      sourceLabel: "Source",
      verifyOk: "The content was verified and matches the signed manifest.",
      progressCopy: "Copying: {file}",
      progressVerify: "Verifying: {file}",
      progressCount: "{done} of {total}",
      problemTitle: "The pack was not accepted.",
      problem: {
        "not-a-pack": "The chosen folder has no readable pack.json.",
        "not-a-directory": "A pack is a folder; choose the folder that holds pack.json.",
        "manifest-unreadable": "pack.json cannot be read.",
        "manifest-too-large": "pack.json is larger than a manifest may be.",
        signature: "The signature on pack.json is not valid, so the pack was not installed.",
        "format-unknown": "This pack's format is newer than this version of Nexus.",
        "id-invalid": "The pack's id is not valid.",
        "version-invalid": "The pack's version is not valid.",
        "kind-unknown": "This pack's kind of content is not known.",
        "title-invalid": "The pack's title is not valid.",
        "description-invalid": "The pack's description is not valid.",
        "files-invalid": "The list of files in the manifest is not valid.",
        "path-invalid": "The manifest names a path this app will not accept.",
        "path-duplicate": "The manifest names the same file twice.",
        "path-duplicate-case": "The manifest names two files that are one file on Windows.",
        "hash-invalid": "A hash in the manifest is not valid.",
        "size-invalid": "A size in the manifest is not valid.",
        limit: "The pack is larger, or lists more files, than is allowed.",
        "licence-invalid": "The licence details in the manifest are not valid.",
        "source-invalid": "The source details in the manifest are not valid.",
        "min-app-version-invalid": "The minimum app version in the manifest is not valid.",
        "min-app-version-too-new": "This pack needs a newer version of Nexus.",
        symlink: "The pack contains a symbolic link, which is not allowed.",
        "not-a-file": "The pack holds something that is neither a file nor a folder.",
        "missing-file": "A file the manifest names is not in the pack.",
        "extra-file": "The pack holds a file the manifest does not name.",
        "size-mismatch": "A file's size does not match the manifest.",
        "hash-mismatch": "A file's content does not match the hash in the manifest.",
        "no-space": "There is not enough room on this disk for the pack.",
        "no-candidate": "No pack has been chosen.",
        "not-found": "That pack is not installed.",
        io: "The pack could not be read or written.",
      } satisfies Record<PackRefusalCode, string>,
      error: "That did not work. Try again.",
    },
    about: {
      version: "Version",
      electron: "Electron",
      chromium: "Chromium",
      node: "Node",
      dataLocation: "Data location",
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
        "Nexus is built on other people's work too — on open-source libraries and on fonts. Their licences ask for one thing: that the attribution notice travels together with the program. Here it is, verbatim and in full.",
      packagesTitle: "Libraries",
      fontsTitle: "Fonts",
      /**
       * The one thing about the fonts a user could not check for themselves:
       * they are files in the installer, not a web request that happens to be
       * cached. „Offline" is the promise the whole app makes, so the card that
       * lists the fonts is where it gets stated about them.
       */
      fontsCaption:
        "The drawing fonts ship inside the app itself and are loaded from disk — none is fetched from the network.",
      /** Per-row hint on the button that opens one entry's notice; `aria-expanded` carries the state itself. */
      expand: "Show the licence text",
      collapse: "Hide the licence text",
      /** Names the scrollable notice block for a screen reader — a scroll region has to be reachable and named. */
      noticeLabel: "Licence text",
      /** Above the notice: the file every character of it was read from. */
      source: "Read from",
      /** Shown instead of a licence id when nothing established one. */
      unknownLicence: "not established",
      /** In place of the notice, when the package names a licence but ships no copy of it. */
      declaredOnly:
        "The package names this licence in its manifest, but does not ship its text with it. What could be read is here — the text is not invented.",
      /** In place of a licence id, when nothing on disk establishes one. */
      notEstablished:
        "The licence was not established from any shipped file. Below is everything the file itself says about itself.",
      /**
       * The notices are ~650 KB of text and arrive as their own chunk when this
       * card first mounts (see `LicencesSection`), so there is a moment — short,
       * but real — with nothing to show. Said rather than left blank, because a
       * card that renders its title and then nothing reads as broken.
       */
      loading: "Loading licences…",
      loadError: "The licences were not loaded. Close and reopen Settings.",
      /**
       * Electron is listed like any other dependency, but what it CARRIES is
       * not: Chromium and Node.js are inside the runtime, and their own notices
       * ship as a separate file beside the executable rather than in this list.
       * Said once, under the library group, because a user who wonders where
       * Chromium is would otherwise conclude it was forgotten.
       */
      chromium:
        "Electron carries Chromium and Node.js inside it. Their full licence notices ship with the app, in the file LICENSES.chromium.html beside the executable.",
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
    navLabel: "Search",
    placeholder: "Search tasks, notes, events…",
    kindFilterLabel: "Filter by type",
    recentGroup: "Recent",
    commandsGroup: "Commands",
    /**
     * The command group over an EMPTY box, which is a short curated offer
     * rather than the whole registry — „Idi na…" duplicates the sidebar and the
     * index repair is a tool, so neither is what somebody opens the palette
     * for with nothing in mind. „Komande" is kept for the typed and the „>"
     * lists, which really are all of them.
     */
    quickActionsGroup: "Quick actions",
    emptyResults: "No results.",
    /** Shown instead of `emptyResults` when the fetch itself rejected — a failure is not an empty result and must not read as one. */
    searchError: "Search is not working right now. Try again.",
    hint: "↑↓ move · Enter open · Esc close",
    /**
     * SRCH-009: the profile's remembered QUERIES, which are a different list
     * from „Nedavno" above — that one shows what you opened, this one what you
     * looked for. The heading says „pretrage" precisely so the two groups can
     * never be read as one.
     */
    historyGroup: "Recent searches",
    /** The „×" on a history row — a label, since the glyph alone says nothing to a screen reader. */
    historyRemove: "Remove from history",
    /**
     * Replaces the key hints while a history row is the active one: Enter
     * FILLS the box here instead of opening something (the query must be
     * visible before it runs — no surface may silently execute a search the
     * user cannot see), and Delete forgets the row.
     */
    historyHint: "↑↓ move · Enter fill · Delete remove · Esc close",
    /**
     * The operator grammar, named quietly in the footer beside the key hints —
     * `#oznaka` filters by tag (zadaci i beleške), `rok:`/`due:` by date. The
     * values are the closed set `parseSearchQuery` accepts, written out rather
     * than abbreviated so the line teaches the whole grammar at a glance.
     */
    operatorHint: "#tag · due:today / tomorrow / week / 2026-08-15",
    /** The palette's bottom row, which hands the current query to the full page (ADR-039 §5). */
    showAllResults: "Show all results",
    /**
     * Marks a result whose match landed inside an attached file's CONTENTS
     * rather than in anything the row shows (SRCH-008). Without it the row
     * would appear to match nothing at all — the one thing a result must never
     * do. Deliberately says „u sadržaju priloga", not „u prilogu": the file's
     * NAME is already searchable and already highlights, so what this reports
     * is specifically the text inside it.
     */
    fromAttachment: "match in the attachment's content",
    kindSingular: {
      task: "Task",
      event: "Event",
      note: "Note",
      document: "Document",
      subject: "Subject",
      exam: "Exam",
      deck: "Deck",
      card: "Card",
      attachment: "Attachment",
      circuit: "Circuit",
    },
    kindPlural: {
      task: "Tasks",
      event: "Events",
      note: "Notes",
      document: "Documents",
      subject: "Subjects",
      exam: "Exams",
      deck: "Decks",
      card: "Cards",
      attachment: "Attachments",
      circuit: "Circuits",
    },
    /** `searchCommands.ts`'s fixed command list; "Promeni temu" itself reuses `strings.app.themeToggle` rather than duplicating it here. */
    commands: {
      goToPrefix: "Go to: ",
      // PRD 08 SRCH-003: one quick-create command per creatable entity,
      // between the "Idi na" group and the theme toggle.
      newTask: "New task",
      newEvent: "New event",
      newNote: "New note",
      newTransaction: "New transaction",
      /**
       * ADR-049: one command per task view, between the quick-creates and the
       * shell actions. Prefixed with the module rather than „Idi na“, because
       * it lands on a VIEW inside Zadaci, not on the module's front door.
       */
      smartListPrefix: "Tasks: ",
      lock: "Lock the app",
      rebuildIndex: "Rebuild the search index",
      rebuildDonePrefix: "The index was rebuilt:",
      rebuildRecordsUnitOne: "record",
      rebuildRecordsUnitMany: "records",
      rebuildError: "Rebuilding the index failed.",
    },
    /**
     * The full search page (ADR-039): its header and the two facet rows. The
     * page reuses the palette's `placeholder`, `kindSingular`/`kindPlural`
     * and `emptyResults` above rather than restating them — the two surfaces
     * mean the same things and must read the same way.
     */
    page: {
      title: "Search",
      /** Follows the LIVE palette chord the page renders before it (ADR-040) — never a printed "Ctrl+K". */
      shortcutHint: "opens quick search",
      /** Names the query grammar, the way the palette's footer does — including `rok:`, which the page inherits from ADR-030 unchanged. */
      grammarHint: "z: b: d: filter by type · #tag · due:today / tomorrow / week / 2026-08-15",
      allKinds: "All",
      tagFilterLabel: "Filter by tag",
      browseHeading: "Recent",
      /** Tooltip on the date column when it falls back to the entry's last edit. */
      updatedLabel: "Last edited",
      resultsUnitOne: "result",
      resultsUnitMany: "results",
      /** Shown instead of an exact count once candidate sourcing hit its bound. */
      truncatedNote: "The first 500 results are shown — narrow the search for a more precise list.",
      showMore: "Show more",
      emptyTitle: "No results",
      emptyDescription: "Try another word or remove a filter.",
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
    close: "Close",
    error: "Previewing the attachment failed. Try again.",
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
      "Shortcuts are remembered on this device — they do not travel with the profile or with a backup.",
    showAll: "Show all shortcuts",
    change: "Change",
    reset: "Reset",
    resetAll: "Reset all",
    capturePrompt: "Press a new combination…",
    captureHint: "Esc cancels.",
    /** Refusal shown when the captured combination is something typing could produce. */
    refuseUnbindable: "The combination must hold Ctrl or Alt, or be an F1–F12 key.",
    /** Refusal for the GLOBAL row only: the OS binds a physical key, so punctuation and layout-specific characters cannot be registered. */
    refuseGlobal:
      "A global shortcut must hold Ctrl or Alt and use a letter, a digit or an F1–F12 key.",
    /** Prefixes the name of whatever already holds the captured combination. */
    takenPrefix: "Taken: ",
    /** Caption under the global row — what „globalna" actually means. */
    globalHint: "Works even when Nexus is not in the foreground.",
    /** The one runtime failure a global registration has: another application already holds the combination. */
    globalTaken: "The shortcut is taken at the system level.",
    actions: {
      palette: "Command palette",
      /** Says „ili u Zadacima" because that is now literally what it does — see `createInModule`'s default arm. The old copy promised the active module and delivered nothing on ten of fourteen. */
      quickCreate: "New entry in the active module (or in Tasks)",
      globalCapture: "Quick task entry — a global shortcut",
      lock: "Lock the app",
      privLock: "Lock the private notes",
      settings: "Open Settings",
      shortcutsHelp: "Show shortcuts",
    },
    dialogTitle: "Keyboard shortcuts",
    dialogClose: "Close",
    groups: {
      global: "Global",
      modules: "Modules",
      palette: "Palette",
      tasks: "Tasks",
      calendar: "Calendar",
      study: "Study",
      notes: "Notes",
      notesFind: "Find in note",
    },
    /** The reserved Ctrl+1…Ctrl+9 family: positional, so it is described rather than named. */
    moduleNavLabel: "Switch module in order",
    moduleNavCaption: "The order is the same as in the sidebar; it applies to the first nine modules.",
    captions: {
      calendar: "While the calendar grid has focus.",
      study: "During card study.",
      notes: "At the start of a line in the note editor.",
      /** The find bar's keys work anywhere in the note, unlike the markdown shortcuts above them — hence a group of its own. */
      notesFind: "While a note is open; searches only that note.",
    },
    reference: {
      paletteMove: "Move through the results",
      paletteOpen: "Open a result or run a command",
      paletteClose: "Close the palette",
      tasksSubtask: "Add a subtask from the entry row",
      tasksCancel: "Cancel the entry in the row or close the question",
      tasksExitSelection: "Leave Select mode",
      calendarShift: "Previous or next period",
      calendarToday: "Go back to today",
      studyReveal: "Show answer",
      studyGrade: "Rate the card — Again, Hard, Good, Easy",
      studyUndo: "Undo the last rating",
      studyExit: "Leave study",
      notesHeading: "Heading 1, 2 or 3",
      notesBulletList: "Bullet list",
      notesOrderedList: "Numbered list",
      notesBlockquote: "Quote",
      notesCodeBlock: "Code block",
      notesSlash: "The block commands menu",
      notesLink: "Link to another note",
      /** Mod-Shift-C in the note editor (ADR-068): the number is assigned, never typed. */
      notesCloze: "Make a blank from the selected text",
      notesHistory: "Undo and redo an edit",
      notesFindOpen: "Open the find bar in the note",
      notesFindStep: "Next or previous match",
      notesFindClose: "Close the bar and put the cursor back on the match",
    },
  },
} as const;

/**
 * No `LocaleShape`/`Strings` here. The shape of a locale is declared ONCE, in
 * `strings.sr.ts`, and `strings.ts` checks every member of `LOCALES` against it
 * (`satisfies Record<string, Strings>`) - so a leaf this file forgot to
 * translate, or one it invented, is a compile error at the table rather than a
 * second declaration that could itself drift.
 */
