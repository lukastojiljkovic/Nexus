import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@nexus/tokens/css";
import "@nexus/ui/styles.css";
import "katex/dist/katex.min.css";
import "./app.css";
import { App } from "./App.js";
import { applyStoredThemePreference } from "./theme.js";
import { applyBootAccent } from "./accent.js";
import { readStoredActiveProfileId } from "./profilePrefs.js";
import { applyStoredNoteWidth } from "./notePrefs.js";
import { applyStoredLocale } from "./localePrefs.js";

// Before anything renders, so the first paint is already in the stored
// language rather than in Serbian for one frame.
applyStoredLocale();
applyStoredThemePreference();
// The accent is per-profile (ADR-058 §3); before first render only the RAW
// last-active id is knowable, so this is a best-effort paint that App corrects
// the moment the live profile list arrives.
applyBootAccent(readStoredActiveProfileId());
applyStoredNoteWidth();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
