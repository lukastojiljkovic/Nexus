import { sr } from "./copy.sr.js";

/**
 * EMERGENCY in English - the same shape as `copy.sr.ts`, checked by the compiler.
 *
 * `typeof sr` is the whole mechanism: a sentence left untranslated, a key
 * invented here, or a nested table that does not match is one compile error each.
 * The register is the app's own English: sentence case, informative, no
 * exclamation marks.
 */
export const en: typeof sr = {
  page: {
    subtitle: "The facts for whoever has to read the card instead of you.",
    loading: "Loading…",
  },
  card: {
    edit: "Edit the card",
    printA6: "Print A6",
    printCardOnA4: "Print the card on A4",
    printHint: "A6 is a sheet for the fridge; the card on A4 is credit-card sized.",
    remove: "Delete the card",
    removeQuestion: "The card leaves this page. Delete it?",
    removeNote: "The card stops being shown, and its data stays in the profile.",
    confirmRemove: "Delete",
    cancelRemove: "Cancel",
    printSaved: "The card was saved.",
  },
  empty: {
    title: "The card has not been made yet",
    body: "Write down the blood type, the allergies and the number of somebody to call. The card prints, and fits in a wallet.",
  },
  gaps: {
    title: "Before printing",
    bloodType: "No blood type is written down.",
    allergies: "Whether there are allergies is unanswered.",
    contacts: "There is nobody to call.",
    complete: "The card has everything a doctor looks for first.",
  },
  form: {
    title: "What is on the card",
    intro: "Everything here is printed on the card exactly as it is written.",
    fullName: "Name",
    dateOfBirth: "Date of birth",
    bloodType: "Blood type",
    bloodTypeUnanswered: "Not written down",
    allergies: "Allergies",
    allergiesNone: "I have no allergies",
    allergyLabel: "Allergen",
    allergySeverity: "Severity",
    severityUnanswered: "Not stated",
    addAllergy: "Add an allergy",
    conditions: "Conditions",
    conditionsNone: "I have no long-term conditions",
    addCondition: "Add a condition",
    medications: "Medications",
    medicationsNone: "I take no medications",
    medicationName: "Medication",
    medicationDose: "How it is taken",
    addMedication: "Add a medication",
    organDonor: "Organ donor",
    organDonorUnanswered: "Not written down",
    insurance: "Health insurance number",
    doctorName: "Doctor",
    doctorPhone: "Doctor's phone",
    notes: "Notes",
    printLanguage: "Language on the card",
    printSr: "Serbian",
    printEn: "English",
    printBoth: "Both languages",
    save: "Save",
    cancel: "Cancel",
    create: "Create the card",
    removeRow: "Delete this row",
    problemDate: "A date of birth must be a real day and cannot lie in the future.",
    problemName: "A name may be at most 120 characters.",
  },
  contacts: {
    title: "Emergency contacts",
    empty: "No contacts yet. Add a person and a phone number.",
    person: "Person from the address book",
    personNone: "Type the name myself",
    name: "Name",
    phone: "Phone",
    relation: "Relation",
    problem: "Choose a person from the address book, or type a name.",
    add: "Add a contact",
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    remove: "Delete",
    moveUp: "Move up",
    moveDown: "Move down",
  },
  errors: {
    load: "The card could not be loaded.",
    mutate: "The change was not saved.",
    print: "The card could not be saved as a PDF.",
  },
  widget: {
    empty: "The card has not been filled in yet.",
    loading: "Loading…",
    loadError: "The card could not be loaded.",
  },
};
