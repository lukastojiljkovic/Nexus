import type { ModuleManifest } from "@nexus/core";

/**
 * The compiled-in modules' name and one-line description, in both locales: the
 * same words as `strings.modules` and `strings.settings.moduleDescriptions` in the
 * renderer. Main cannot read those strings, so the assistant's `app.modules`
 * reads these, and `builtinModuleCopy.test.ts` fails the moment the two disagree.
 */
export const BUILTIN_MODULE_COPY: Partial<Record<string, NonNullable<ModuleManifest["copy"]>>> = {
  dashboard: {
    name: { sr: "Kontrolna tabla", en: "Dashboard" },
    description: {
      sr: "Pregled dana na jednom mestu — obaveze, zadaci i dokumenta koja ističu.",
      en: "Your day at a glance — commitments, tasks and expiring documents.",
    },
  },
  tasks: {
    name: { sr: "Zadaci", en: "Tasks" },
    description: {
      sr: "Zadaci sa listom i tablom, prioritetima i rokovima.",
      en: "Tasks with list and board views, priorities and deadlines.",
    },
  },
  calendar: {
    name: { sr: "Kalendar", en: "Calendar" },
    description: {
      sr: "Događaji, agenda i praćenje isteka dokumenata.",
      en: "Events, an agenda and document expiry tracking.",
    },
  },
  settings: {
    name: { sr: "Podešavanja", en: "Settings" },
    description: {
      sr: "Profil, izgled, moduli i obaveštenja.",
      en: "Profile, appearance, modules and notifications.",
    },
  },
  notes: {
    name: { sr: "Beleške", en: "Notes" },
    description: {
      sr: "Beleške sa blok-editorom — markdown prečice i „/“ meni za formatiranje.",
      en: "Notes with a block editor — Markdown shortcuts and a “/” menu for formatting.",
    },
  },
  study: {
    name: { sr: "Učenje", en: "Study" },
    description: {
      sr: "Predmeti, ispiti, kartice za učenje i planovi pripreme za ispite.",
      en: "Subjects, exams, study cards and exam preparation plans.",
    },
  },
  priv: {
    name: { sr: "Privatno", en: "Private" },
    description: {
      sr: "Šifrovane privatne beleške — otključavaju se posebno i ne pojavljuju se u pretrazi.",
      en: "Encrypted private notes — unlocked separately and never shown in search.",
    },
  },
  files: {
    name: { sr: "Datoteke", en: "Files" },
    description: {
      sr: "Sve datoteke priložene uz beleške, zadatke i predmete, na jednom mestu.",
      en: "Every file attached to notes, tasks and subjects, in one place.",
    },
  },
  finance: {
    name: { sr: "Finansije", en: "Finance" },
    description: {
      sr: "Računi, transakcije i prenosi — stanje se računa iz onoga što upišeš.",
      en: "Accounts, transactions and transfers — the balance is worked out from what you enter.",
    },
  },
  habits: {
    name: { sr: "Navike", en: "Habits" },
    description: {
      sr: "Dnevne i nedeljne navike — niz, istorija i ono što se danas očekuje.",
      en: "Daily and weekly habits — streak, history and what is expected today.",
    },
  },
  focus: {
    name: { sr: "Fokus", en: "Focus" },
    description: {
      sr: "Pomodoro tajmer i istorija fokusa — isti tajmer koji „Učenje“ koristi.",
      en: "A Pomodoro timer and focus history — the same timer “Study” uses.",
    },
  },
  fitness: {
    name: { sr: "Fitnes", en: "Fitness" },
    description: {
      sr: "Ishrana i trening — obroci i dnevni ciljevi, dnevnik treninga sa rutinama i katalogom vežbi.",
      en: "Nutrition and training — meals and daily targets, a training log with routines and an exercise catalogue.",
    },
  },
  tools: {
    name: { sr: "Alatke", en: "Tools" },
    description: {
      sr: "Pretvarači jedinica i svakodnevni računi — procenat, PDV, kredit i cena po jedinici.",
      en: "Unit converters and everyday sums — percentage, VAT, loans and unit price.",
    },
  },
  canvas: {
    name: { sr: "Tabla", en: "Board" },
    description: {
      sr: "Beskonačna tabla za crtanje, dijagrame i skice — sa karticama koje vode na druge module.",
      en: "An endless board for drawing, diagrams and sketches — with cards that lead to other modules.",
    },
  },
  electronics: {
    name: { sr: "Elektronika", en: "Electronics" },
    description: {
      sr: "Radna površina za Arduino i Raspberry — postavi ploče i senzore iz kataloga i poveži ih žicama.",
      en: "A workbench for Arduino and Raspberry — place boards and sensors from the catalogue and wire them up.",
    },
  },
  pro: {
    name: { sr: "Stručne alatke", en: "Professional tools" },
    description: {
      sr: "Alatke po strukama — uključuješ pakete koji ti trebaju, a fioka pokazuje samo njih.",
      en: "Tools by trade — turn on the packs you need, and the drawer shows only those.",
    },
  },
};
