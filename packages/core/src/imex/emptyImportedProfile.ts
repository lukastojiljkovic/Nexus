import type { ProfileData } from "./exportArchive.js";

/**
 * Every collection of a `ProfileData`, empty. The base an importer that reads
 * only some modules spreads its own rows over: the result is typed
 * `ProfileData` as a whole, so a member added to that interface later fails to
 * compile here rather than silently arriving absent from every such importer.
 */
export function emptyImportedProfile(): ProfileData {
  return {
    tasks: [],
    taskLists: [],
    taskSections: [],
    taskTags: [],
    taskTagLinks: [],
    taskAttachments: [],
    taskTemplates: [],
    taskDependencies: [],
    events: [],
    eventTemplates: [],
    documents: [],
    renewals: [],
    people: [],
    calendarSettings: [],
    subjects: [],
    subjectAttachments: [],
    subjectNoteLinks: [],
    exams: [],
    decks: [],
    cards: [],
    reviewLog: [],
    examTopics: [],
    plans: [],
    blocks: [],
    focusSessions: [],
    studySettings: [],
    notifications: [],
    notes: [],
    noteFolders: [],
    noteTags: [],
    noteCategories: [],
    noteTagLinks: [],
    noteTemplates: [],
    noteAttachments: [],
    noteVersions: [],
    dashboardSettings: [],
    dashboardSets: [],
    dashboardWidgets: [],
    // No importer here reads a ledger (migration 051): empty, like every other
    // module these importers do not read.
    finAccounts: [],
    finCategories: [],
    finRecurring: [],
    finTransactions: [],
    finBudgets: [],
    // Nor any habits (migration 055): empty, like every other module this
    // importer does not read.
    habits: [],
    habitEntries: [],
    // Nor any food log (migration 058): empty, like every other module this
    // importer does not read.
    fitFoods: [],
    fitMealItems: [],
    fitTargets: [],
    // Nor any training log (migration 060): empty, like every other module this
    // importer does not read.
    fitExercises: [],
    fitRoutines: [],
    fitRoutineItems: [],
    fitWorkouts: [],
    fitWorkoutSets: [],
    fitMeasurements: [],
    fitBodyProfile: [],
    canvasBoards: [],
    circuits: [],
    circuitChassis: [],
    circuitParts: [],
    circuitWires: [],
    // No kit-module data: a translator produces rows for the collections it
    // understands, and a module's own payload is written by that module
    // (ADR-090). Empty here, on every other field's terms.
    modules: [],
  };
}
