import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@nexus/tokens/css";
import "@nexus/ui/styles.css";
import "katex/dist/katex.min.css";
import "./app.css";
import { App } from "./App.js";
import { applyStoredThemePreference } from "./theme.js";
import { applyStoredAccent } from "./accent.js";
import { applyStoredNoteWidth } from "./notePrefs.js";

applyStoredThemePreference();
applyStoredAccent();
applyStoredNoteWidth();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
