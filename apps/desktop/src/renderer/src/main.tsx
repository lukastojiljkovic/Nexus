import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@nexus/tokens/css";
import "@nexus/ui/styles.css";
import "katex/dist/katex.min.css";
import "./app.css";
import { App } from "./App.js";
import { applyStoredTheme } from "./theme.js";

applyStoredTheme();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
