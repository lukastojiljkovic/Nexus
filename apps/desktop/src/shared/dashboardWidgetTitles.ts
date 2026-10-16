import type { AssistantText } from "@nexus/core";

/**
 * The v0 widgets' titles, in both locales. A built-in widget declares its title as a
 * `strings` key path (`WidgetContract.title`), and only the renderer can read those strings,
 * so the pairs live here, where both the assistant (main) and the renderer can import them;
 * `dashboardWidgetTitles.test.ts` pins each one against `strings.sr.ts` and `strings.en.ts`.
 */
export const BUILTIN_WIDGET_TITLES: Readonly<Record<string, AssistantText>> = {
  "dashboard.today.title": { sr: "Danas", en: "Today" },
  "dashboard.upcoming.title": { sr: "Predstojeći zadaci", en: "Upcoming tasks" },
  "dashboard.expiring.title": { sr: "Dokumenta koja ističu", en: "Expiring documents" },
  "dashboard.urgent.title": { sr: "Hitno i kasni", en: "Urgent and late" },
  "dashboard.recentNotes.title": { sr: "Nedavne beleške", en: "Recent notes" },
  "dashboard.recentFiles.title": { sr: "Nedavne datoteke", en: "Recent files" },
  "dashboard.recentBoards.title": { sr: "Nedavne table", en: "Recent boards" },
  "dashboard.recentCircuits.title": { sr: "Nedavna kola", en: "Recent circuits" },
  "dashboard.proPacks.title": { sr: "Tvoje stručne alatke", en: "Your professional tools" },
  "dashboard.reminders.title": { sr: "Podsetnici", en: "Reminders" },
  "dashboard.quickActions.title": { sr: "Brze radnje", en: "Quick actions" },
  "dashboard.stats.title": { sr: "Statistika", en: "Stats" },
  "dashboard.renewals.title": { sr: "Predstojeće naplate", en: "Upcoming charges" },
  "dashboard.focus.title": { sr: "Fokus", en: "Focus" },
  "dashboard.habitsToday.title": { sr: "Navike danas", en: "Habits today" },
  "dashboard.fitnessToday.title": { sr: "Ishrana danas", en: "Nutrition today" },
  "dashboard.fitnessTraining.title": { sr: "Trening", en: "Workout" },
  "study.dashboardTitle": { sr: "Ispiti", en: "Exams" },
  "study.dashboardStudyTitle": { sr: "Učenje", en: "Study" },
};

/** The default board's name in both locales: the same words as `strings.sets.defaultName`, which `dashboardWidgetTitles.test.ts` pins. */
export const DASHBOARD_DEFAULT_BOARD_NAME: AssistantText = { sr: "Početna", en: "Home" };
