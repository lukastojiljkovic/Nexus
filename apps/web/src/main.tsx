import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@nexus/tokens/css";
import "@nexus/ui/styles.css";
import "./app.css";
import { App } from "./App.js";
import { applyStoredThemePreference } from "./theme.js";

// Before the first render, never inside it. `index.html` ships `data-theme="noc"`
// so the very first paint has a theme at all; this resolves the stored
// preference — including „system" against the OS — and rewrites the attribute.
// Doing it in an effect instead would paint Noć, then repaint Dan one frame
// later, which is the flash the desktop shell removed the same way.
applyStoredThemePreference();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
