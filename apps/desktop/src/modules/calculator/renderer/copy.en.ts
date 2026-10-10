import { sr } from "./copy.sr.js";

/**
 * CALCULATOR in English - the same shape as `copy.sr.ts`, checked by the
 * compiler.
 *
 * `typeof sr` is the whole mechanism: a sentence left untranslated, a key
 * invented here, or a nested table that does not match is one compile error each,
 * so this file cannot drift from the Serbian table the way a second hand-kept
 * table would. The register is the app's own English: sentence case,
 * informative, no exclamation marks.
 *
 * The keypad's names are the one place the two tables are deliberately short in
 * the same way: a symbol key is a symbol in either language, and its SPOKEN name
 * is a word each locale has its own for.
 */
export const en: typeof sr = {
  page: {
    subtitle: "One-line calculation: variables, units, history and a scientific keypad.",
    loading: "Loading…",
  },
  expression: {
    label: "Expression",
    placeholder: "e.g. 5 km to mi, 1/3, sin(30)",
    keysHint:
      "Enter keeps the expression in the history, the up and down arrows recall older ones, Esc clears the line.",
    referenceHint:
      "ans is the last result, and #1, #2 and so on are results from the history, newest first.",
    waiting: "The result is computed as you type.",
    working: "Computing…",
    commit: "Calculate",
    clear: "Clear",
    caret: "The error is at column",
  },
  keypad: {
    title: "Scientific keypad",
  },
  keys: {
    open: "Open bracket",
    close: "Close bracket",
    plus: "Plus",
    minus: "Minus",
    multiply: "Multiply",
    divide: "Divide",
    power: "Power",
    equals: "Calculate",
    root: "Square root",
    square: "Square",
    pi: "Pi",
    factorial: "Factorial",
    percent: "Percent",
    decimal: "Decimal point",
    clear: "Clear the line",
  },
  history: {
    title: "History",
    search: "Search the history",
    emptyTitle: "The history is empty",
    emptyBody: "An expression you confirm with Enter stays here, with its result.",
    noMatch: "No entry matches the search.",
    reuse: "Into the line",
    pin: "Pin",
    unpin: "Unpin",
    remove: "Delete",
    clear: "Clear the history",
    clearTitle: "Clearing the history",
    clearQuestion: "Delete every expression in the history?",
    clearNote: "Pinned entries stay, and so do the variables.",
  },
  variables: {
    title: "Variables",
    empty:
      "No variables yet. Assign a value, e.g. x = 5, or define a function, e.g. f(x) = x^2 + 1.",
    namesLabel: "Variables",
    functionsLabel: "Functions",
    forget: "Forget everything",
    forgetTitle: "Forgetting the variables",
    forgetQuestion: "Delete every variable, every function and the last result?",
  },
  errors: {
    load: "The calculator could not be loaded.",
    syntax: "The expression is not written correctly.",
    "unknown-symbol": "An unknown name in the expression.",
    "wrong-arguments": "A function is not given arguments it takes, or the expression does not finish.",
    "division-by-zero": "Division by zero is not allowed.",
    "unit-mismatch": "The units do not match.",
    "too-large": "The expression is too large to compute.",
    disabled: "That function is not allowed in the calculator.",
    timeout: "The calculation took too long and was stopped. Try a simpler expression.",
    stopped: "The calculation was interrupted. Try again.",
    noEntry: "There is no such entry in the history.",
    mutate: "The change was not saved.",
    sessionUnreadable:
      "The saved variables could not be read. Forget them so the calculator works again.",
  },
  widget: {
    empty: "No results have been computed yet.",
    loading: "Loading…",
    loadError: "The results could not be loaded.",
  },
  settings: {
    caption: "These two settings are kept with the profile, and the page changes them too.",
    hint: "The angle unit decides what sin(30) means, and the number mode how many digits a result carries.",
    saved: "Saved.",
    loadError: "The settings could not be loaded.",
    saveError: "The setting was not saved.",
  },
  confirm: {
    cancel: "Cancel",
  },
};
