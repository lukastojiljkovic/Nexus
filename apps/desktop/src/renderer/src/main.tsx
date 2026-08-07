import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installGrain } from "@nexus/ui";
import "@nexus/tokens/css";
import "@nexus/ui/styles.css";
import "katex/dist/katex.min.css";
import "./app.css";
import { App } from "./App.js";
import { applyStoredThemePreference } from "./theme.js";
import { applyBootAccent } from "./accent.js";
import { readStoredActiveProfileId } from "./profilePrefs.js";
import { applyStoredNoteWidth } from "./notePrefs.js";

applyStoredThemePreference();
// The paper substrate, baked before first paint so no surface ever renders
// flat and then gains texture a frame later. One tile serves both themes —
// it carries alpha only, and each theme's own `--nx-material-grain-alpha`
// scales it — so switching theme stays a variable swap with no re-bake.
installGrain();
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
